import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.sources import SourceError
from app.wear_history import WearHistoryService, normalize, reduce_points


def row(stamp, x, z, tool=None):
    return {"timestamp_epoch": stamp, "process_values.tool_no": tool,
            "process_values.tool_wear_x_mm": x, "process_values.tool_wear_z_mm": z}


def test_latest_bounds_use_process_table_and_null_tool_is_retained():
    async def run():
        calls = []
        def handler(request):
            calls.append(request)
            assert request.url.params["environment"] == "test"
            if request.url.path == "/api/events":
                data = {"ranges": [{"machine_id": "M1", "tables": [
                    {"table": "sensor_values", "t_max_epoch": 99000000},
                    {"table": "process_values", "t_max_epoch": 7200000}]}]}
                return httpx.Response(200, text=f"event: ready\ndata: {json.dumps(data)}\n\n")
            assert request.url.path == "/api/history/fanuc_tool_wear"
            assert request.url.params["format"] == "json_record"
            assert "tool_no" not in request.url.params
            assert int(request.url.params["end_time_epoch"]) == 7200001
            assert int(request.url.params["start_time_epoch"]) == 3600001
            return httpx.Response(200, json={"machine_id": "M1", "data": [row(7200000, -0.2, 0, None), row(7000000, None, 0.3, 6)]})
        client = httpx.AsyncClient(base_url="http://test/", transport=httpx.MockTransport(handler))
        service = WearHistoryService(Settings(_env_file=None, history_environment="test"), client)
        result = await service.query("M1", None, None, None, 60, 1000)
        assert result["totalPoints"] == 2
        assert result["data"][-1]["toolNo"] is None
        assert result["data"][-1]["xWearMm"] == -0.2
        assert result["data"][-1]["zWearMm"] == 0
        assert await service.query("M1", None, None, None, 60, 1000) == result
        assert len(calls) == 2
        await service.close()
    asyncio.run(run())


def test_normalization_keeps_unknown_tool_and_segments_gaps():
    points = normalize([row(1000, -1, 0, None), row(2000, float("nan"), 0.1, 6), row(3000, 0.3, 0.2, None), row(4000, 0.4, 0.3, 9)])
    assert len(points) == 4
    assert points[1]["xWearMm"] is None
    assert points[0]["xSegment"] != points[2]["xSegment"]
    assert points[2]["zSegment"] != points[3]["zSegment"]
    assert len(normalize([row(1000, 1, 2), row(2000, 1, 2, 9)], "6")) == 1


def test_reduction_covers_full_window_and_extrema():
    points = normalize([row(i * 1000, 99 if i == 43 else -88 if i == 78 else 0, 0) for i in range(100)])
    reduced = reduce_points(points, 18)
    assert len(reduced) <= 18
    assert reduced[0] == points[0] and reduced[-1] == points[-1]
    assert max(p["xWearMm"] for p in reduced) == 99
    assert min(p["xWearMm"] for p in reduced) == -88


def test_http_api_custom_window_and_missing_tool(tmp_path):
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path))
    with TestClient(create_app(settings)) as client:
        def handler(request):
            return httpx.Response(200, json={"machine_id": "M1", "data": [row(1000, 0.1, 0.2), row(2000, 0.2, 0.3)]})
        client.app.state.wear_history.client = httpx.AsyncClient(base_url="http://test/", transport=httpx.MockTransport(handler))
        response = client.get("/api/tool-wear/history", params={"machine_id": "M1", "start": "1970-01-01T00:00:01Z", "end": "1970-01-01T00:00:02Z"})
        assert response.status_code == 200
        assert response.json()["data"][0]["toolNo"] is None
        assert len(response.json()["data"]) == 1  # end-exclusive
        assert client.get("/api/tool-wear/history", params={"start": "1970-01-01T00:00:01Z"}).status_code == 400


def test_no_process_rows_returns_empty_without_querying_sensor_history():
    async def run():
        def handler(request):
            assert request.url.path == "/api/events"
            return httpx.Response(200, text='event: ready\ndata: {"ranges":[]}\n\n')
        service = WearHistoryService(Settings(_env_file=None), httpx.AsyncClient(base_url="http://test/", transport=httpx.MockTransport(handler)))
        assert (await service.query("M1", None, None, None, 60, 1000))["data"] == []
        await service.close()
    asyncio.run(run())


@pytest.mark.parametrize("failure,code", [("timeout", 504), ("503", 502)])
def test_upstream_errors(failure, code):
    async def run():
        def handler(request):
            if failure == "timeout":
                raise httpx.ReadTimeout("test", request=request)
            return httpx.Response(503)
        service = WearHistoryService(Settings(_env_file=None), httpx.AsyncClient(base_url="http://test/", transport=httpx.MockTransport(handler)))
        with pytest.raises(SourceError) as error:
            await service.query("M1", None, None, None, 60, 1000)
        assert error.value.status_code == code
        await service.close()
    asyncio.run(run())
