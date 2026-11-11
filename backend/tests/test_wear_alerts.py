import asyncio
import json
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


def test_prediction_events_are_sent_in_order_without_persisting(tmp_path):
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
        assert "events" not in service.snapshot()
        with closing(sqlite3.connect(service.path)) as db:
            assert db.execute("SELECT name FROM sqlite_master WHERE name='events'").fetchone() is None

    asyncio.run(run())


def test_quality_alert_follows_the_tolerance_sent_with_the_trigger(tmp_path):
    _, service = make_service(tmp_path)
    # Default spec 0 … 0.02 mm: #9 (0.0088) is fine, #10 (0.027) is above USL.
    assert service.record(MockPrediction(index=9))["qualityAlert"] is None
    alert = service.record(MockPrediction(index=10))["qualityAlert"]
    assert (alert["kind"], alert["balloonId"], alert["side"], alert["value"], alert["limit"]) == ("quality", "b1", "upper", 0.027, 0.02)

    # A wider tolerance from the UI makes the same value acceptable again.
    wide = QualitySpec(nominal=0, upperTol=0.05, lowerTol=0)
    assert service.record(MockPrediction(index=10, qualitySpec=wide))["qualityAlert"] is None
    # A tighter one alerts on a value that used to be fine.
    tight = QualitySpec(nominal=0, upperTol=0.005, lowerTol=0)
    assert service.record(MockPrediction(index=9, qualitySpec=tight))["qualityAlert"]["limit"] == 0.005
    # Below the lower limit alerts too.
    low = QualitySpec(nominal=0.02, upperTol=0.02, lowerTol=0.01)
    lower = service.record(MockPrediction(index=1, qualitySpec=low))["qualityAlert"]
    assert (lower["side"], lower["limit"]) == ("lower", 0.01)


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
