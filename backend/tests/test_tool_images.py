import asyncio
import base64
import hashlib
import io
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app
from app.tool_images import ImageStore, InvalidCapture, ToolImageService


def capture(**changes):
    stream = io.BytesIO()
    Image.new("RGB", (8, 6), "red").save(stream, format="PNG")
    data = stream.getvalue()
    value = dict(schemaVersion="1.0.0", captureId=str(uuid4()), machineId="Makino_01", toolNo="167",
                 timestampUtc="2026-11-03T09:20:20Z", contentType="image/png", payloadEncoding="base64",
                 payload=base64.b64encode(data).decode(), width=8, height=6, imageBytes=len(data),
                 sha256=hashlib.sha256(data).hexdigest(), inspectionResult="Wear checked", measurements=[])
    return {**value, **changes}, data


def test_store_dedupe_and_receive_order_survive_restart(tmp_path):
    store = ImageStore(str(tmp_path), 100000)
    first, data = capture()
    saved = store.save(json.dumps(first).encode())
    assert "payload" not in saved
    assert store.save(json.dumps(first).encode()) is None
    second, _ = capture(timestampUtc="2020-01-01T00:00:00Z", toolNo="9")
    saved_second = store.save(json.dumps(second).encode())
    assert saved_second["receivedSequence"] > saved["receivedSequence"]
    assert store.save(json.dumps(first).encode()) is None
    restarted = ImageStore(str(tmp_path), 100000)
    assert restarted.latest()["captureId"] == second["captureId"]
    assert restarted.image(first["captureId"])[0].read_bytes() == data


@pytest.mark.parametrize("changes,reason", [
    ({"payloadEncoding": "none", "payload": None}, "image_payload_not_provided"),
    ({"payload": "!bad!"}, "invalid_base64"),
    ({"sha256": "0" * 64}, "image_size_or_hash_mismatch"),
    ({"width": 99}, "image_format_or_dimensions_mismatch"),
    ({"contentType": "image/jpeg"}, "image_format_or_dimensions_mismatch"),
    ({"schemaVersion": "2"}, "unsupported_schema_or_timestamp"),
])
def test_rejects_invalid_images(tmp_path, changes, reason):
    value, _ = capture(**changes)
    with pytest.raises(InvalidCapture, match=reason):
        ImageStore(str(tmp_path), 100000).save(json.dumps(value).encode())


def test_consumer_saves_then_commits_and_notifies(tmp_path):
    async def run():
        service = ToolImageService(Settings(_env_file=None, microscope_image_dir=str(tmp_path)))
        value, _ = capture()
        record = SimpleNamespace(value=json.dumps(value).encode(), topic="test", partition=0, offset=10)
        commits = []
        class Consumer:
            async def commit(self, offset):
                assert service.store.latest()["captureId"] == value["captureId"]
                commits.append(offset)
        async with service.subscribe() as queue:
            queue.get_nowait()
            await service.process_record(Consumer(), record)
            event, payload = queue.get_nowait()
            assert event == "image" and payload["toolNo"] == "167"
            assert next(iter(commits[0].values())) == 11
            await service.process_record(Consumer(), record)
            assert queue.empty()  # replay after commit failure does not update the photo
        assert not service.listeners
    asyncio.run(run())


def test_bad_record_is_recorded_and_committed(tmp_path):
    async def run():
        service = ToolImageService(Settings(_env_file=None, microscope_image_dir=str(tmp_path)))
        class Consumer:
            async def commit(self, offsets):
                with service.store.connect() as db:
                    assert db.execute("SELECT reason FROM rejected").fetchone()[0] == "invalid_capture_schema"
        await service.process_record(Consumer(), SimpleNamespace(value=b"bad", topic="test", partition=0, offset=0))
        assert service.store.latest() is None
    asyncio.run(run())


def test_file_failure_does_not_commit(tmp_path, monkeypatch):
    async def run():
        service = ToolImageService(Settings(_env_file=None, microscope_image_dir=str(tmp_path)))
        def fail(value):
            raise OSError("disk unavailable")
        monkeypatch.setattr(service.store, "save", fail)
        class Consumer:
            async def commit(self, offsets):
                raise AssertionError("must not advance offset")
        with pytest.raises(OSError):
            await service.process_record(Consumer(), SimpleNamespace(value=b"{}", topic="test", partition=0, offset=0))
    asyncio.run(run())


def test_image_http_api(tmp_path):
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path))
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/tool-images/latest").json() == {"image": None, "status": {"state": "disabled"}}
        value, raw = capture()
        client.app.state.tool_images.store.save(json.dumps(value).encode())
        latest = client.get("/api/tool-images/latest").json()["image"]
        assert "payload" not in latest
        response = client.get(latest["imageUrl"])
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content == raw
        assert client.get(f"/api/tool-images/{uuid4()}/image").status_code == 404
        assert client.get("/api/tool-images/not-a-uuid/image").status_code == 422


def test_background_consumer_receives_without_dashboard_and_closes(tmp_path):
    async def run():
        value, _ = capture()
        saved = asyncio.Event()
        stopped = asyncio.Event()
        options = {}
        class Consumer:
            def __init__(self, topic, **kwargs):
                options.update(kwargs)
                assert topic == "makino_microscope_image"
                self.first = True
            async def start(self):
                pass
            def __aiter__(self):
                return self
            async def __anext__(self):
                if self.first:
                    self.first = False
                    return SimpleNamespace(value=json.dumps(value).encode(), topic="test", partition=0, offset=5)
                await asyncio.Event().wait()
            async def commit(self, offsets):
                saved.set()
            async def stop(self):
                stopped.set()
        service = ToolImageService(Settings(_env_file=None, microscope_kafka_enabled=True, microscope_image_dir=str(tmp_path)), consumer_factory=Consumer)
        service.start()
        try:
            await asyncio.wait_for(saved.wait(), timeout=3)
            assert not service.listeners
            assert service.store.latest()["captureId"] == value["captureId"]
            assert options["enable_auto_commit"] is False
            assert options["max_partition_fetch_bytes"] > 50000000
            async with service.subscribe() as queue:
                assert queue.get_nowait() == ("status", {"state": "connected"})
                assert queue.get_nowait()[1]["captureId"] == value["captureId"]
        finally:
            await service.close()
        assert stopped.is_set()
    asyncio.run(run())
