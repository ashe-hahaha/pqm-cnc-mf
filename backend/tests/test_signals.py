import asyncio
from datetime import datetime, timezone

from websockets.asyncio.server import serve

from app.config import Settings
from app.signals import CHANNELS, SignalHub, fetch_signals, sse, json_safe
import json
import socket
import httpx
import uvicorn
from app.main import create_app


def test_ws_protocol():
    async def run():
        async def handler(ws):
            request = json.loads(await ws.recv())
            assert request["include_process"] is True
            assert request["window_kind"] == "duration"
            assert request["channels"] == list(CHANNELS)
            await ws.send(json.dumps({"type": "meta", "machine_id": "test", "start": "2026-10-29T00:00:00Z", "end": "2026-10-29T00:00:10Z", "t_max": "2026-10-29T00:00:09Z"}))
            for channel in CHANNELS:
                await ws.send(json.dumps({"type": "waveform", "channel": channel, "method": "m4", "bucket_ms": 10, "points": []}))
            await ws.send('{"type":"process","rows":[{"AE":NaN,"AP":Infinity,"feed_rate":2000}]}')
            await ws.send('{"type":"done"}')
        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            result = await fetch_signals(Settings(_env_file=None, signals_ws_url=f"ws://127.0.0.1:{port}"), "test")
            assert len(result["channels"]) == 4
            assert result["process"] == [{"AE": None, "AP": None, "feed_rate": 2000}]
    asyncio.run(run())


def test_nonfinite_values_are_null_in_sse():
    payload = {"process": [{"AE": float("nan"), "AP": float("inf"), "wear": -float("inf"), "zero": 0}]}
    encoded = sse("signals", payload).split("data: ", 1)[1].strip()
    decoded = json.loads(encoded, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    assert decoded == {"process": [{"AE": None, "AP": None, "wear": None, "zero": 0}]}


def test_shared_poll_and_cleanup():
    async def run():
        calls = 0
        async def fetch(settings, machine):
            nonlocal calls
            calls += 1
            return {"t_max": datetime.now(timezone.utc).isoformat(), "channels": [{"points": [1]}]}
        hub = SignalHub(Settings(_env_file=None), fetcher=fetch)
        async with hub.subscribe("test") as one:
            async with hub.subscribe("test") as two:
                await asyncio.sleep(0.02)
                assert calls == 1
                assert len(hub.feeds["test"].listeners) == 2
                assert any(one.get_nowait()[0] == "signals" for _ in range(one.qsize()))
            assert "test" in hub.feeds
        assert hub.feeds == {}
        await hub.close()
    asyncio.run(run())


def test_upstream_failure_keeps_stream_alive():
    async def run():
        async def fail(settings, machine):
            raise ConnectionError("private upstream detail")
        hub = SignalHub(Settings(_env_file=None), fetcher=fail)
        async with hub.subscribe("test") as queue:
            await asyncio.sleep(0.02)
            events = [queue.get_nowait() for _ in range(queue.qsize())]
            assert events[-1][1]["state"] == "unavailable"
            assert "private" not in sse(*events[-1])
    asyncio.run(run())


def test_stale_data_and_duplicate_suppression():
    async def run():
        async def fetch(settings, machine):
            return {"t_max": "2000-01-01T00:00:00Z", "channels": [{"points": [1]}]}
        hub = SignalHub(Settings(_env_file=None, signals_poll_seconds=0.2), fetcher=fetch)
        async with hub.subscribe("test") as queue:
            await asyncio.sleep(0.25)
            events = [queue.get_nowait() for _ in range(queue.qsize())]
            assert len([e for e in events if e[0] == "signals"]) == 1
            assert events[-1][1]["state"] == "stale"
    asyncio.run(run())


def test_sse_http_stream():
    async def run():
        app = create_app(Settings(_env_file=None))
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
        task = asyncio.create_task(server.serve(sockets=[sock]))
        try:
            async with asyncio.timeout(5):
                while not server.started:
                    await asyncio.sleep(0.01)
                async def fetch(settings, machine):
                    return {"machine_id": machine, "t_max": datetime.now(timezone.utc).isoformat(), "channels": [{"points": [1]}]}
                app.state.signals.fetcher = fetch
                async with httpx.AsyncClient() as client:
                    async with client.stream("GET", f"http://127.0.0.1:{port}/api/signals/stream") as response:
                        assert response.status_code == 200
                        assert response.headers["content-type"].startswith("text/event-stream")
                        async for line in response.aiter_lines():
                            if line == "event: signals":
                                break
                        else:
                            raise AssertionError("No signals event")
        finally:
            server.should_exit = True
            await asyncio.wait_for(task, 5)
            sock.close()
    asyncio.run(run())
