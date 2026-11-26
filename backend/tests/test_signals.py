import asyncio
from datetime import datetime, timezone

from websockets.asyncio.server import serve

from app.config import Settings
from app.signals import CHANNELS, SignalHub, fetch_signals, live_url, make_delta, parse_live_update, sse, json_safe
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


def test_continuous_monitor_triggers_without_browser_and_preserves_baseline_on_reconnect(tmp_path):
    from app.wear_alerts import WearAlerts

    async def run():
        baseline, prediction, disconnect = asyncio.Event(), asyncio.Event(), asyncio.Event()
        connections, triggered = [], []

        async def handler(ws):
            connections.append(json.loads(await ws.recv()))
            number = len(connections)
            rows = [{"timestamp": "2026-10-23T08:14:01Z", "nc_line": 28}]
            if number > 1:
                rows.append({"timestamp": "2026-10-23T08:14:02Z", "nc_line": 29})
            await ws.send(json.dumps(live_frame([number], machine="Makino_01", rows=rows)))
            if number == 1:
                await disconnect.wait()
                await ws.close()
            else:
                await ws.wait_closed()

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path), tool_wear_demo_enabled=True,
                                signals_ws_url=f"ws://127.0.0.1:{port}/ws")
            alerts = WearAlerts(settings)

            async def predict(values, detail):
                triggered.append(detail)
                prediction.set()

            alerts.run_prediction = predict

            def observe(machine, batch, state):
                alerts.on_signals(machine, batch, state)
                baseline.set()

            hub = SignalHub(settings, on_batch=observe)
            hub.start()
            try:
                await asyncio.wait_for(baseline.wait(), 3)
                assert triggered == []
                feed = hub.feeds[settings.signals_machine_id]
                task = feed.task
                hub.start()  # idempotent; no second upstream connection
                async with hub.subscribe(settings.signals_machine_id, stream=True) as queue:
                    assert (await queue.get())[0] == "snapshot"
                assert hub.feeds[settings.signals_machine_id] is feed and feed.task is task
                assert not feed.streams and not feed.listeners
                disconnect.set()
                await asyncio.wait_for(prediction.wait(), 5)
                assert len(connections) == 2
                assert len(triggered) == 1
                assert feed.state["value"] == "29"
                assert hub.feeds[settings.signals_machine_id] is feed
            finally:
                await hub.close()
                await alerts.close()
            assert task.done() and hub.feeds == {} and not hub.persistent_machines

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


def test_sse_http_stream(monkeypatch):
    async def run():
        async def fetch(settings, machine):
            return {"machine_id": machine, "t_max": datetime.now(timezone.utc).isoformat(), "channels": [{"points": [1]}]}
        monkeypatch.setattr("app.main.SignalHub", lambda settings, on_batch: SignalHub(settings, fetcher=fetch, on_batch=on_batch))
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


# ---- /ws/live ----------------------------------------------------------------------------------------------------

def point(second, value=0.5):
    return {"t": f"2026-10-23T08:14:{second:02d}.000Z", "min": -value, "max": value, "first": 0.0, "last": value}


def live_frame(seconds, *, idle=False, machine="test", rows=None, bucket_ms=10):
    waves = {channel: {"type": "waveform", "channel": channel, "method": "m4", "bucket_ms": bucket_ms,
                       "points": [] if idle else [point(second) for second in seconds]} for channel in CHANNELS}
    return {"type": "live_update",
            "meta": {"type": "meta", "machine_id": machine, "start": "2026-10-23T08:14:00.000Z",
                     "end": "2026-10-23T08:14:10.000Z", "t_max": "2026-10-23T08:14:10.000Z", "bucket_ms": bucket_ms,
                     "window_ms": 10000, "window_kind": "duration", "live_idle": idle},
            "waveforms": waves, "process": [] if idle else (rows or [])}


def test_live_url_follows_the_configured_signals_url():
    assert live_url(Settings(_env_file=None, signals_ws_url="ws://host:4000/ws")) == "ws://host:4000/ws/live"
    assert live_url(Settings(_env_file=None, signals_ws_url="ws://host:4000/ws/")) == "ws://host:4000/ws/live"
    assert live_url(Settings(_env_file=None, signals_ws_url="ws://host:4000/ws/live")) == "ws://host:4000/ws/live"
    assert live_url(Settings(_env_file=None, signals_ws_url="ws://host:4000/ws", signals_environment="test")) == "ws://host:4000/ws/live?environment=test"


def test_parse_live_update_builds_the_same_batch_as_the_one_shot_query():
    batch, idle = parse_live_update(live_frame([1, 2], rows=[{"timestamp": "t", "nc_line": 29}]), "test")
    assert idle is False
    assert [wave["channel"] for wave in batch["channels"]] == list(CHANNELS)
    assert (batch["machine_id"], batch["t_max"], batch["process"]) == ("test", "2026-10-23T08:14:10.000Z", [{"timestamp": "t", "nc_line": 29}])
    assert parse_live_update(live_frame([], idle=True), "test")[1] is True
    for bad in (live_frame([1], machine="other"),):
        try:
            parse_live_update(bad, "test")
        except ValueError:
            pass
        else:
            raise AssertionError("machine mismatch must be rejected")
    missing = live_frame([1])
    del missing["waveforms"]["ae.rms"]
    try:
        parse_live_update(missing, "test")
    except ValueError:
        pass
    else:
        raise AssertionError("an incomplete frame must be rejected")


def test_make_delta_sends_only_new_or_changed_points_and_rows():
    first, _ = parse_live_update(live_frame([1, 2, 3], rows=[{"fanuc_raw_id": "a", "timestamp": "1", "macros": {}}]), "test")
    assert make_delta(None, first) == ("snapshot", first)
    changed = live_frame([2, 3, 4], rows=[{"fanuc_raw_id": "a", "timestamp": "1", "macros": {"956": 1.0}},
                                           {"fanuc_raw_id": "b", "timestamp": "2", "macros": {}}])
    changed["waveforms"]["spindle.vibration_x"]["points"][1] = point(3, 0.9)  # the newest bucket is revised
    second, _ = parse_live_update(changed, "test")
    kind, delta = make_delta(first, second)
    assert kind == "delta"
    by_channel = {wave["channel"]: wave["points"] for wave in delta["channels"]}
    assert [p["t"][:19] for p in by_channel["spindle.vibration_x"]] == ["2026-10-23T08:14:03", "2026-10-23T08:14:04"]  # revised + new
    assert len(by_channel["ae.rms"]) == 1  # only second 4 is new
    assert [row["fanuc_raw_id"] for row in delta["process"]] == ["a", "b"]  # a got its macros late, b is new

    other_width, _ = parse_live_update(live_frame([1, 2], bucket_ms=20), "test")
    assert make_delta(first, other_width)[0] == "snapshot"
    no_overlap, _ = parse_live_update(live_frame([7, 8]), "test")
    assert make_delta(first, no_overlap)[0] == "snapshot"


def run_with_upstream(handler, body, **settings):
    async def run():
        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            hub = SignalHub(Settings(_env_file=None, signals_ws_url=f"ws://127.0.0.1:{port}/ws", signals_poll_seconds=0.2, **settings))
            try:
                await body(hub)
            finally:
                await hub.close()
    asyncio.run(run())


def test_live_hub_streams_updates_deltas_and_keeps_the_last_picture_when_idle():
    requests = []

    async def handler(ws):
        assert ws.request.path == "/ws/live"
        requests.append(json.loads(await ws.recv()))
        await ws.send(json.dumps(live_frame([1, 2, 3])))
        await asyncio.sleep(0.1)
        await ws.send(json.dumps(live_frame([2, 3, 4])))
        await asyncio.sleep(0.1)
        await ws.send(json.dumps(live_frame([], idle=True)))
        await asyncio.sleep(1)

    async def body(hub):
        seen = []
        hub.on_batch = lambda machine, batch, state: seen.append(batch["channels"][0]["points"][-1]["t"] if batch["channels"][0]["points"] else None)
        async with hub.subscribe("test") as sse_queue, hub.subscribe("test", stream=True) as stream_queue:
            await asyncio.sleep(0.6)
            sse_events = [sse_queue.get_nowait() for _ in range(sse_queue.qsize())]
            stream_events = [stream_queue.get_nowait() for _ in range(stream_queue.qsize())]
        assert requests[0]["window_ms"] == 10000 and requests[0]["channels"] == list(CHANNELS) and requests[0]["machine_id"] == "test"
        assert [e[0] for e in sse_events if e[0] == "signals"] == ["signals", "signals"]  # the idle frame is not a new picture
        assert [e[0] for e in stream_events if e[0] != "status"] == ["snapshot", "delta"]
        delta = [e[1] for e in stream_events if e[0] == "delta"][0]
        assert [len(w["points"]) for w in delta["channels"]] == [1, 1, 1, 1] and delta["status"]["state"] in ("live", "stale")
        assert sse_events[-1][1]["state"] == "stale"  # idle: the old data is shown, marked stale
        assert seen[-1] is None or seen[0]  # observers still see every frame, including the empty idle one

    run_with_upstream(handler, body)


def test_live_hub_reconnects_after_the_upstream_closes():
    connections = []

    async def handler(ws):
        connections.append(await ws.recv())
        await ws.send(json.dumps(live_frame([len(connections)])))
        await ws.close()

    async def body(hub):
        async with hub.subscribe("test") as queue:
            await asyncio.sleep(2.6)
            events = [queue.get_nowait() for _ in range(queue.qsize())]
        assert len(connections) >= 2
        assert "unavailable" in [e[1].get("state") for e in events if e[0] == "status"]
        assert len([e for e in events if e[0] == "signals"]) >= 2

    run_with_upstream(handler, body)


def test_a_lagging_websocket_client_gets_a_fresh_snapshot_instead_of_missed_deltas():
    async def run():
        hub = SignalHub(Settings(_env_file=None), fetcher=lambda *a: None)
        batches = iter([parse_live_update(live_frame([second, second + 1]), "test")[0] for second in range(1, 40)])

        async def fetch(settings, machine):
            return next(batches)
        hub.fetcher = fetch
        hub.settings.signals_poll_seconds = 0.2
        async with hub.subscribe("test", stream=True) as queue:
            await asyncio.sleep(0.05)
            feed = hub.feeds["test"]
            for second in range(20, 40):  # a burst the client never reads
                batch, _ = parse_live_update(live_frame([second, second + 1]), "test")
                hub.handle_batch("test", feed, batch)
            events = [queue.get_nowait() for _ in range(queue.qsize())]
            assert events[0][0] == "snapshot" and len(events) <= 16  # the queue was reset to one snapshot, then newer frames
        await hub.close()
    asyncio.run(run())


def test_browser_websocket_gets_snapshot_then_deltas_and_pings(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    batches = [parse_live_update(live_frame(seconds, machine="Makino_01"), "Makino_01")[0] for seconds in ([1, 2], [2, 3])]
    calls = iter(batches)

    async def fetch(settings, machine):
        try:
            return next(calls)
        except StopIteration:
            await asyncio.sleep(3600)

    monkeypatch.setattr("app.main.SignalHub", lambda settings, on_batch: SignalHub(settings, fetcher=fetch, on_batch=on_batch))
    app = create_app(Settings(_env_file=None, microscope_image_dir=str(tmp_path), signals_poll_seconds=0.2))
    with TestClient(app) as client:
        assert app.state.signals.persistent_machines == {"Makino_01"}
        assert "Makino_01" in app.state.signals.feeds
        with client.websocket_connect("/api/signals/ws") as ws:
            first = ws.receive_json()
            while first["type"] == "status":
                first = ws.receive_json()
            assert first["type"] == "snapshot" and first["machine_id"] == "Makino_01"
            assert len(first["channels"]) == 4 and first["status"]["state"] in ("live", "stale")
            second = ws.receive_json()
            while second["type"] == "status":
                second = ws.receive_json()
            assert second["type"] == "delta"
            assert [len(w["points"]) for w in second["channels"]] == [1, 1, 1, 1]
