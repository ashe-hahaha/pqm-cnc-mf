import asyncio
import json
import httpx
import sqlite3
from contextlib import closing
from types import SimpleNamespace

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
    assert service.snapshot()["qualitySpec"] == {"nominal": 0, "upperTol": 0.02, "lowerTol": 0}
    # Default spec 0 … 0.02 mm: #9 (0.0088) is fine, #10 (0.027) is above USL.
    assert service.record(MockPrediction(index=9))["qualityAlert"] is None
    alert = service.record(MockPrediction(index=10))["qualityAlert"]
    assert (alert["kind"], alert["balloonId"], alert["side"], alert["value"], alert["limit"]) == ("quality", "b1", "upper", 0.027, 0.02)

    # A wider tolerance makes the same value acceptable again.
    service.set_quality_spec(QualitySpec(nominal=0, upperTol=0.05, lowerTol=0))
    assert service.record(MockPrediction(index=10))["qualityAlert"] is None
    # A tighter one alerts on a value that used to be fine, and survives a restart.
    service.set_quality_spec(QualitySpec(nominal=0, upperTol=0.005, lowerTol=0))
    restarted = WearAlerts(settings)
    assert restarted.snapshot()["qualitySpec"]["upperTol"] == 0.005
    assert restarted.record(MockPrediction(index=9))["qualityAlert"]["limit"] == 0.005
    # Below the lower limit alerts too.
    restarted.set_quality_spec(QualitySpec(nominal=0.02, upperTol=0.02, lowerTol=0.01))
    lower = restarted.record(MockPrediction(index=1))["qualityAlert"]
    assert (lower["side"], lower["limit"]) == ("lower", 0.01)


def batch(*rows):
    return {"process": [{"timestamp": f"2026-11-12T02:30:{second:02d}.000Z", "nc_line": value}
                        for second, value in rows]}


def test_nc_line_watcher_triggers_only_on_a_change_to_the_trigger_value(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.PREDICTION_DELAY_S = 0
        machine, state = service.settings.signals_machine_id, {}
        watch = lambda *rows: service.on_signals(machine, batch(*rows), state)

        watch((1, 20), (2, 20))            # first batch after opening: only recorded
        watch((1, 20), (2, 20), (3, 21))   # overlapping window, a new value that is not 25
        watch((2, 20), (3, 21), (4, "25"))  # string 25 matches; this one triggers
        await asyncio.gather(*service.background)
        assert [item["index"] for item in service.snapshot()["history"]] == [1]
        assert service.snapshot()["ncWatch"]["value"] == "25"
        assert service.snapshot()["ncWatch"]["running"] is True
        assert service.snapshot()["ncWatch"]["lastTriggerAt"]
        started = [e for e in service.snapshot()["events"] if e["label"] == "Prediction started"]
        assert started[0]["detail"] == "NC line 21 → 25"

        watch((4, 25), (5, 25), (6, 25))   # staying at 25 does not trigger again
        watch((4, 25), (5, 25), (6, 25))   # repeated old rows neither
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1

    asyncio.run(run())


def test_nc_line_watcher_first_batch_cooldown_and_null(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.PREDICTION_DELAY_S = 0
        machine = service.settings.signals_machine_id

        state = {}
        service.on_signals(machine, batch((1, 25)), state)  # already 25 when the page opens
        service.on_signals(machine, {"process": []}, state)
        await asyncio.gather(*service.background)
        assert service.snapshot()["prediction"] is None

        service.on_signals(machine, batch((2, None)), state)  # null updates the previous value
        service.on_signals(machine, batch((3, 25)), state)    # null -> 25 triggers
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1

        service.on_signals(machine, batch((4, 24), (5, 25)), state)  # 10 s cooldown ignores this one
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1

        service.nc_last_trigger -= 11
        service.on_signals(machine, batch((6, 24), (7, 25)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 2

        # Another machine, a different trigger value and a closed page (new state) behave as configured.
        service.on_signals("Other", batch((8, 24), (9, 25)), {})
        service.settings.tool_wear_nc_trigger_value = "30"
        service.nc_last_trigger -= 11
        service.on_signals(machine, batch((10, 29), (11, 30)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 3

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
