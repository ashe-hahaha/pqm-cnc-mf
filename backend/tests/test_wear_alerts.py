import asyncio
import json
import httpx
import sqlite3
from contextlib import closing
from types import SimpleNamespace

from app import wear_alerts
from app.config import Settings
from app.wear_alerts import MockPrediction, QualitySpec, WearAlerts, WearValues, mock_prediction
from app.wear_series import PREDICTION_SERIES


def make_service(tmp_path):
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path),
                        tool_wear_demo_enabled=True, tool_wear_alert_kafka_enabled=True,
                        tool_wear_alert_temi_enabled=False)
    return settings, WearAlerts(settings)


def test_predictions_cycle_through_series_and_persist_cursor(tmp_path):
    settings, service = make_service(tmp_path)
    count = len(PREDICTION_SERIES)
    assert service.snapshot()["nextIndex"] == 1

    first = service.record(MockPrediction())["prediction"]
    assert (first["index"], first["toolNo"]) == (1, "25")
    assert (first["diameter"], first["length"], first["quality"]) == PREDICTION_SERIES[0]
    assert first["balloonId"] == "b1"

    restarted = WearAlerts(settings)
    assert restarted.snapshot()["nextIndex"] == 2
    for _ in range(count - 1):
        last = restarted.record(MockPrediction())["prediction"]
    assert last["index"] == count
    assert restarted.record(MockPrediction())["prediction"]["index"] == 1  # wraps around


def test_selected_index_is_used_then_cycle_continues(tmp_path):
    _, service = make_service(tmp_path)
    picked = service.record(MockPrediction(index=4))["prediction"]
    assert picked["index"] == 4
    assert service.snapshot()["nextIndex"] == 5
    assert service.record(MockPrediction())["prediction"]["index"] == 5


def test_every_exceeding_prediction_alerts_and_enqueues(tmp_path):
    _, service = make_service(tmp_path)
    service.set_thresholds(WearValues(diameter=0.1, length=999))

    assert service.record(MockPrediction(index=9))["alert"] is None  # 0.07 mm, normal
    first = service.record(MockPrediction(index=10))["alert"]  # 0.35 mm, the abnormal value
    second = service.record(MockPrediction(index=10))["alert"]  # still above, alerts again
    assert first["metrics"] == ["diameter"] and second["metrics"] == ["diameter"]
    assert first["alertId"] != second["alertId"]

    snapshot = service.snapshot()
    assert [item["index"] for item in snapshot["history"]] == [9, 10, 10]
    tool_wear_alerts = [item for item in snapshot["alerts"] if item["kind"] == "tool_wear"]
    assert tool_wear_alerts[0]["alertId"] == second["alertId"]
    with closing(sqlite3.connect(service.path)) as db:
        rows = db.execute("SELECT destination, body FROM outbox ORDER BY seq").fetchall()
    assert [destination for destination, _ in rows] == ["kafka", "kafka"]
    assert [json.loads(body)["alertId"] for _, body in rows] == [first["alertId"], second["alertId"]]
    assert json.loads(rows[0][1])["toolNo"] == "25"
    assert "prediction" not in json.loads(rows[0][1])


def test_history_is_a_sliding_window_of_ten(tmp_path):
    _, service = make_service(tmp_path)
    for _ in range(13):
        service.record(MockPrediction())
    assert [item["index"] for item in service.snapshot()["history"]] == [4, 5, 6, 7, 8, 9, 10, 1, 2, 3]


def test_kafka_publisher_sends_consumer_contract(tmp_path, monkeypatch):
    event = {"schemaVersion": "1.0.0", "eventType": "tool_wear_alert", "alertId": "test", "toolNo": "25"}
    sent = []

    class Producer:
        def __init__(self, **options):
            assert options["acks"] == "all"
            assert options["enable_idempotence"] is True

        async def start(self):
            pass

        async def send_and_wait(self, topic, *, key, value, headers):
            sent.append((topic, key, json.loads(value), dict(headers)))
            return SimpleNamespace(partition=0, offset=1)

        async def stop(self):
            pass

    monkeypatch.setattr("app.wear_alerts.AIOKafkaProducer", Producer)
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path))
    asyncio.run(WearAlerts(settings).publish(event))
    assert sent == [(settings.tool_wear_alert_kafka_topic, b"test", event, {
        "schemaVersion": b"1.0.0", "contentType": b"application/json",
    })]


def test_prediction_events_are_sent_in_order_and_persisted(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.set_thresholds(WearValues(diameter=0.1, length=999))
        listener = asyncio.Queue()
        service.listeners.add(listener)
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(wear_alerts=service)))
        task = asyncio.create_task(mock_prediction(request, MockPrediction(index=10)))
        kind, started = await asyncio.wait_for(listener.get(), timeout=1)
        assert kind == "wear_event"
        assert started["label"] == "Prediction started"
        assert service.snapshot()["prediction"] is None
        await task
        assert listener.get_nowait()[1]["label"] == "Prediction completed"
        assert listener.get_nowait()[1]["label"] == "Alert triggered"
        # Persisted in the same order; one "queued" event per enabled destination (Kafka here).
        assert [event["label"] for event in service.snapshot()["events"]] == [
            "Prediction started", "Prediction completed", "Alert triggered",
            "Notification queued", "Quality alert triggered",
        ]

    asyncio.run(run())


def test_quality_alert_follows_the_stored_tolerance(tmp_path):
    settings, service = make_service(tmp_path)
    assert service.snapshot()["qualitySpec"] == {"nominal": 18, "upperTol": 0.1, "lowerTol": 0.1}
    # Default spec 18 ± 0.1 mm: #9 (18.0088) is fine, #10 (18.15) is above USL 18.1.
    assert service.record(MockPrediction(index=9))["qualityAlert"] is None
    alert = service.record(MockPrediction(index=10))["qualityAlert"]
    assert (alert["kind"], alert["balloonId"], alert["side"], alert["value"], alert["limit"]) == ("quality", "b1", "upper", 18.15, 18.1)

    # A wider tolerance makes the same value acceptable again.
    service.set_quality_spec(QualitySpec(nominal=18, upperTol=0.2, lowerTol=0.1))
    assert service.record(MockPrediction(index=10))["qualityAlert"] is None
    # A tighter one alerts on a value that used to be fine, and survives a restart.
    service.set_quality_spec(QualitySpec(nominal=18, upperTol=0.005, lowerTol=0))
    restarted = WearAlerts(settings)
    assert restarted.snapshot()["qualitySpec"]["upperTol"] == 0.005
    assert restarted.record(MockPrediction(index=9))["qualityAlert"]["limit"] == 18.005
    # Below the lower limit alerts too.
    restarted.set_quality_spec(QualitySpec(nominal=18.02, upperTol=0.02, lowerTol=0.01))
    lower = restarted.record(MockPrediction(index=1))["qualityAlert"]
    assert (lower["side"], lower["limit"]) == ("lower", 18.01)


def batch(*rows):
    return {"process": [{"timestamp": f"2026-11-12T02:30:{second:02d}.000Z", "nc_line": value}
                        for second, value in rows]}


def test_nc_line_watcher_triggers_on_a_change_to_a_trigger_value(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.PREDICTION_DELAY_S = 0
        machine, state = service.settings.signals_machine_id, {}
        watch = lambda *rows: service.on_signals(machine, batch(*rows), state)
        assert service.snapshot()["ncWatch"]["triggerValues"] == ["29"]

        watch((1, 20), (2, 20))            # first batch after opening: only recorded
        watch((1, 20), (2, 20), (3, 21))   # overlapping window, a new value that is not a trigger value
        watch((2, 20), (3, 21), (4, "29"))  # string 29 matches; this one triggers
        await asyncio.gather(*service.background)
        assert [item["index"] for item in service.snapshot()["history"]] == [1]
        assert service.snapshot()["ncWatch"]["value"] == "29"
        assert service.snapshot()["ncWatch"]["running"] is True
        assert service.snapshot()["ncWatch"]["lastTriggerAt"]
        started = [e for e in service.snapshot()["events"] if e["label"] == "Prediction started"]
        assert started[0]["detail"] == "NC line 21 → 29"

        watch((4, 29), (5, 29), (6, 29))   # staying at 29 does not trigger again
        watch((4, 29), (5, 29), (6, 29))   # repeated old rows neither
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1

        service.nc_last_trigger -= 11      # past the cooldown
        watch((7, 74))                     # 29 -> 74 enters the 73-74 range: a second kind of trigger
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 2
        started = [e for e in service.snapshot()["events"] if e["label"] == "Prediction started"]
        assert started[-1]["detail"] == "NC line 29 → 74"
        assert service.snapshot()["ncWatch"]["fallbackPending"] is False  # the range trigger cancelled the fallback

    asyncio.run(run())


def test_nc_line_watcher_first_batch_cooldown_and_null(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.PREDICTION_DELAY_S = 0
        machine = service.settings.signals_machine_id

        state = {}
        service.on_signals(machine, batch((1, 74)), state)  # already 74 when the page opens
        service.on_signals(machine, {"process": []}, state)
        await asyncio.gather(*service.background)
        assert service.snapshot()["prediction"] is None

        service.on_signals(machine, batch((2, None)), state)  # null updates the previous value
        service.on_signals(machine, batch((3, 74)), state)    # null -> 74 triggers
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1

        service.on_signals(machine, batch((4, 30), (5, 29)), state)  # 10 s cooldown ignores this one (shared by all triggers)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1

        service.nc_last_trigger -= 11
        service.on_signals(machine, batch((6, 30), (7, 29)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 2
        service.cancel_fallback()

        # Another machine and a different configuration (with spaces, a duplicate and numbers) behave as configured.
        service.on_signals("Other", batch((8, 30), (9, 29)), {})
        service.settings.tool_wear_nc_trigger_values = " 30 , 31,30"
        assert service.snapshot()["ncWatch"]["triggerValues"] == ["30", "31"]
        service.nc_last_trigger -= 11
        service.on_signals(machine, batch((10, 29), (11, 30.0)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 3

    asyncio.run(run())


def test_nc_range_triggers_only_on_first_entry(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.PREDICTION_DELAY_S = 0
        machine, state = service.settings.signals_machine_id, {}
        history = lambda: len(service.snapshot()["history"])

        async def watch(*rows):
            service.nc_last_trigger = None  # isolate the rule from the cooldown
            service.on_signals(machine, batch(*rows), state)
            await asyncio.gather(*service.background)

        await watch((1, 20))                              # first batch: only recorded
        await watch((2, 72), (3, 75), (4, "abc"))         # just outside the range / not a number: no trigger
        assert history() == 0
        await watch((5, 73))                              # first entry (lower bound is inclusive)
        assert history() == 1
        await watch((6, 74), (7, 73.0), (8, "74"), (9, 73))  # moving inside the range does not trigger again
        assert history() == 1
        await watch((10, 80))                             # leaving does not trigger
        assert history() == 1
        await watch((11, "74"))                           # re-entering (upper bound is inclusive) triggers
        assert history() == 2
        started = [e for e in service.snapshot()["events"] if e["label"] == "Prediction started"]
        assert [e["detail"] for e in started] == ["NC line abc → 73", "NC line 80 → 74"]

    asyncio.run(run())


def test_nc_fallback_fires_once_after_the_delay_and_enters_cooldown(tmp_path, monkeypatch):
    async def run():
        monkeypatch.setattr(wear_alerts, "NC_COOLDOWN_S", 0.05)
        settings, service = make_service(tmp_path)
        settings.tool_wear_nc_fallback_seconds = 0.2
        service.PREDICTION_DELAY_S = 0
        machine, state = settings.signals_machine_id, {}
        assert service.snapshot()["ncWatch"]["fallbackSeconds"] == 0.2

        service.on_signals(machine, batch((1, 20)), state)
        service.on_signals(machine, batch((2, 29)), state)  # first trigger arms the fallback
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1
        assert service.snapshot()["ncWatch"]["fallbackPending"] is True
        first_trigger = service.nc_last_trigger

        await asyncio.sleep(0.5)                            # no 73-74 within the delay -> second trigger
        await asyncio.gather(*service.background)
        snapshot = service.snapshot()
        assert len(snapshot["history"]) == 2
        assert snapshot["ncWatch"]["fallbackPending"] is False
        started = [e for e in snapshot["events"] if e["label"] == "Prediction started"]
        assert started[-1]["detail"].startswith("NC line fallback")
        assert service.nc_last_trigger > first_trigger      # the fallback entered the cooldown too

        await asyncio.sleep(0.5)                            # it fires only once
        assert len(service.snapshot()["history"]) == 2

    asyncio.run(run())


def test_nc_fallback_is_cancelled_by_a_range_trigger_and_can_be_disabled(tmp_path, monkeypatch):
    async def run():
        monkeypatch.setattr(wear_alerts, "NC_COOLDOWN_S", 0.05)
        settings, service = make_service(tmp_path)
        settings.tool_wear_nc_fallback_seconds = 0.3
        service.PREDICTION_DELAY_S = 0
        machine, state = settings.signals_machine_id, {}
        status = lambda: service.snapshot()["ncWatch"]["fallbackPending"]

        service.on_signals(machine, batch((1, 20)), state)
        service.on_signals(machine, batch((2, 29)), state)
        service.on_signals(machine, batch((3, 73)), state)  # inside the cooldown: ignored, fallback stays armed
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1 and status() is True

        await asyncio.sleep(0.1)                            # cooldown over
        service.on_signals(machine, batch((4, 20), (5, 74)), state)  # entering the range again triggers and cancels
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 2 and status() is False
        await asyncio.sleep(0.5)
        assert len(service.snapshot()["history"]) == 2      # the fallback never fired

        service.cancel_fallback()
        settings.tool_wear_nc_fallback_seconds = 0          # 0 disables the fallback
        await asyncio.sleep(0.1)
        service.on_signals(machine, batch((6, 20), (7, 29)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 3 and status() is False

        settings.tool_wear_nc_fallback_seconds = 5          # a new start trigger re-arms; reset-like cancel clears it
        await asyncio.sleep(0.1)
        service.on_signals(machine, batch((8, 20), (9, 29)), state)
        await asyncio.gather(*service.background)
        assert status() is True
        service.cancel_fallback()
        assert status() is False

    asyncio.run(run())


def qc_batch(*rows):
    """rows: (second, nc_line, macros) -> a process batch whose rows carry a `macros` map."""
    return {"process": [{"timestamp": f"2026-11-12T02:31:{second:02d}.000Z", "nc_line": line, "macros": macros}
                        for second, line, macros in rows]}


def test_nc_line_93_samples_the_measured_diameter_without_a_prediction(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.PREDICTION_DELAY_S = 0
        machine, state = service.settings.signals_machine_id, {}
        watch = lambda *rows: service.on_signals(machine, qc_batch(*rows), state)
        last_qc = lambda: service.snapshot()["lastQc"]
        assert last_qc() is None

        watch((1, 92, {"956": 9.5}))                       # first batch: only recorded, even if it is 93 later
        watch((2, 93, {"956": 18.012}), (3, 93, {"956": 18.02}))  # arrival at 93 samples once (first row of the stay)
        await asyncio.gather(*service.background)
        assert last_qc()["value"] == 18.012 and last_qc()["macro"] == "956"
        assert last_qc()["timestampUtc"] == "2026-11-12T02:31:02.000Z"
        assert service.snapshot()["history"] == []         # no prediction was started
        assert service.snapshot()["ncWatch"]["fallbackPending"] is False
        labels = [e["label"] for e in service.snapshot()["events"]]
        assert labels == ["QC measured"]

        watch((4, 93, {"956": 18.03}))                       # still at 93: no new sample
        assert last_qc()["value"] == 18.012

        for i, macros in enumerate(({}, {"955": 1.0}, {"956": None}, {"956": float("nan")}, None, {"956": "x"})):
            watch((10 + 2 * i, 40, {}))
            watch((11 + 2 * i, 93, macros))                # no usable value: last QC stays, a note is logged
            assert last_qc()["value"] == 18.012
        assert [e["label"] for e in service.snapshot()["events"]].count("QC not available") == 6

        watch((30, 40, {}))
        watch((31, 93, {"956": 18}))                       # integers are fine; a newer value replaces the old one
        assert last_qc()["value"] == 18.0

        restarted = WearAlerts(service.settings)           # persisted
        assert restarted.snapshot()["lastQc"]["value"] == 18.0
        service.reset()
        assert service.snapshot()["lastQc"] is None        # Reset demo clears it

    asyncio.run(run())


def test_out_of_spec_qc_is_shown_as_the_fixed_passing_value(tmp_path):
    async def run():
        settings, service = make_service(tmp_path)
        machine, state = settings.signals_machine_id, {}
        seconds = iter(range(1, 100))

        def measure(value):
            service.on_signals(machine, qc_batch((next(seconds), 40, {})), state)
            service.on_signals(machine, qc_batch((next(seconds), 93, {"956": value})), state)
            return service.snapshot()["lastQc"]["value"]

        service.on_signals(machine, qc_batch((next(seconds), 40, {})), state)  # first batch
        assert measure(18.05) == 18.05                  # inside 18 ± 0.1 (default spec): shown as measured
        assert measure(18.1) == 18.1 and measure(17.9) == 17.9   # the limits themselves pass
        assert measure(18.2) == 18.067                  # above USL: the fixed passing value
        assert measure(17.5) == 18.067                  # below LSL
        details = [e["detail"] for e in service.snapshot()["events"] if e["label"] == "QC measured"]
        assert "18.2 mm" in details[-2] and "shown as 18.067 mm" in details[-2]  # the real value stays in the event log
        assert "shown as" not in details[0]

        service.set_quality_spec(QualitySpec(nominal=18.2, upperTol=0.05, lowerTol=0.05))  # follows the stored tolerance
        assert measure(18.2) == 18.2
        settings.tool_wear_qc_mask_out_of_spec = False  # the demo substitution can be switched off
        assert measure(19.0) == 19.0

    asyncio.run(run())


def test_quality_alerts_are_listed_but_never_sent_to_kafka(tmp_path):
    _, service = make_service(tmp_path)
    result = service.record(MockPrediction(index=10))
    assert result["alert"] is None  # default tool wear thresholds are far above
    alerts = service.snapshot()["alerts"]
    assert [a["kind"] for a in alerts] == ["quality"]
    with closing(sqlite3.connect(service.path)) as db:
        assert db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] == 0


def test_reset_restores_the_first_eight_predictions(tmp_path):
    _, service = make_service(tmp_path)
    service.set_thresholds(WearValues(diameter=0.1, length=999))
    for _ in range(12):
        service.record(MockPrediction())
    assert service.snapshot()["alerts"]

    service.reset()
    snapshot = service.snapshot()
    assert [item["index"] for item in snapshot["history"]] == list(range(1, 9))
    assert snapshot["nextIndex"] == 9
    assert snapshot["alerts"] == []
    assert snapshot["thresholds"]["diameter"] == 0.1  # thresholds survive a reset
    stamps = [item["timestampUtc"] for item in snapshot["history"]]
    assert stamps == sorted(stamps)
    with closing(sqlite3.connect(service.path)) as db:
        assert db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] == 0
    assert service.record(MockPrediction())["prediction"]["index"] == 9


def test_events_persist_across_restart_and_dedupe(tmp_path):
    settings, service = make_service(tmp_path)
    service.log_event("Prediction started", "25", detail="Mock prediction", event_id="a")
    service.log_event("Prediction completed", "25", event_id="b")
    service.log_event("Prediction started", "25", event_id="a")  # duplicate id is ignored

    events = WearAlerts(settings).snapshot()["events"]
    assert [event["id"] for event in events] == ["a", "b"]
    assert events[0]["label"] == "Prediction started"


def test_snapshot_reports_destinations_and_pending_notifications(tmp_path):
    _, service = make_service(tmp_path)
    assert service.snapshot()["destinations"] == ["kafka"]
    assert service.snapshot()["pendingNotifications"] == 0
    service.set_thresholds(WearValues(diameter=0.1, length=999))
    service.record(MockPrediction(index=10))
    assert service.snapshot()["pendingNotifications"] == 1


def test_delivery_failures_are_logged_as_events_but_rate_limited(tmp_path):
    _, service = make_service(tmp_path)
    event = {"alertId": "alert-1", "toolNo": "25"}
    service.note_delivery_failure("kafka", event, 0, TimeoutError())
    service.note_delivery_failure("kafka", event, 1, TimeoutError())  # within the interval: no second event
    service.note_delivery_failure("temi", event, 0, ValueError())  # another destination: its own event

    details = [e["detail"] for e in service.snapshot()["events"] if e["label"] == "Notification failed"]
    assert details == ["Kafka · makino_tool_wear_alert · TimeoutError · attempt 1", "Temi API · ValueError · attempt 1"]


def test_temi_trigger_is_an_empty_post_with_the_alert_id_as_idempotency_key(tmp_path, monkeypatch):
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200)

    real_client = httpx.AsyncClient
    monkeypatch.setattr("app.wear_alerts.httpx.AsyncClient",
                        lambda **options: real_client(transport=httpx.MockTransport(handler), **options))
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path), tool_wear_alert_temi_enabled=True,
                        tool_wear_alert_temi_url="http://172.20.115.53:3002/Trigger")
    service = WearAlerts(settings)
    asyncio.run(service.notify_temi({"alertId": "alert-1", "toolNo": "25"}))

    request = seen[0]
    assert (request.method, str(request.url)) == ("POST", "http://172.20.115.53:3002/Trigger")
    assert request.content == b""
    assert request.headers["Idempotency-Key"] == "alert-1"
    assert "authorization" not in request.headers
    assert [e["detail"] for e in service.snapshot()["events"]] == ["Temi API"]
