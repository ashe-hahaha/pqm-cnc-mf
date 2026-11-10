import asyncio
import json
import sqlite3
from contextlib import closing
from types import SimpleNamespace

from app.config import Settings
from app.wear_alerts import MockPrediction, WearAlerts, WearValues


def test_mock_crossings_persist_and_enqueue_only_new_alerts(tmp_path):
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path),
                        tool_wear_demo_enabled=True, tool_wear_alert_kafka_enabled=True,
                        tool_wear_alert_temi_enabled=False)
    service = WearAlerts(settings)
    assert service.snapshot()["thresholds"] == {"diameter": 999, "length": 999}
    service.set_thresholds(WearValues(diameter=1, length=2))

    assert service.record(MockPrediction(diameter=1, length=2))["alert"] is None
    alert = service.record(MockPrediction(diameter=2, length=3))["alert"]
    assert alert["metrics"] == ["diameter", "length"]
    assert service.record(MockPrediction(diameter=3, length=4))["alert"] is None

    restarted = WearAlerts(settings)
    assert restarted.snapshot()["alerts"][0]["alertId"] == alert["alertId"]
    assert restarted.record(MockPrediction(diameter=0, length=4))["alert"] is None
    next_alert = restarted.record(MockPrediction(diameter=2, length=4))["alert"]
    assert next_alert["metrics"] == ["diameter"]

    with closing(sqlite3.connect(restarted.path)) as db:
        rows = db.execute("SELECT destination, body FROM outbox ORDER BY seq").fetchall()
    assert [destination for destination, _ in rows] == ["kafka", "kafka"]
    assert [json.loads(body)["alertId"] for _, body in rows] == [
        alert["alertId"], next_alert["alertId"],
    ]
    assert "prediction" not in json.loads(rows[0][1])


def test_kafka_publisher_sends_consumer_contract(tmp_path, monkeypatch):
    event = {"schemaVersion": "1.0.0", "eventType": "tool_wear_alert", "alertId": "test"}
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
