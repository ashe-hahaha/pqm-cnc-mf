import asyncio
import json
import logging
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from aiokafka import AIOKafkaProducer
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import Settings
from app.signals import sse

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/tool-wear/demo")
METRICS = ("diameter", "length")


class WearValues(BaseModel):
    diameter: float = Field(ge=0, allow_inf_nan=False)
    length: float = Field(ge=0, allow_inf_nan=False)


class MockPrediction(WearValues):
    toolNo: str = Field(default="167", min_length=1, max_length=64)


class WearAlerts:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.path = Path(settings.microscope_image_dir) / "wear-alerts.sqlite3"
        self.tasks: list[asyncio.Task] = []
        self.listeners: set[asyncio.Event] = set()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS thresholds (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                INSERT OR IGNORE INTO thresholds VALUES (1, '{"diameter":999,"length":999}');
                CREATE TABLE IF NOT EXISTS predictions (
                    seq INTEGER PRIMARY KEY, machine TEXT NOT NULL, tool TEXT NOT NULL, body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS predictions_tool ON predictions(machine, tool, seq);
                CREATE TABLE IF NOT EXISTS alerts (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS outbox (
                    seq INTEGER PRIMARY KEY, destination TEXT NOT NULL, body TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, due REAL NOT NULL DEFAULT 0
                );
            """)

    def snapshot(self):
        with closing(sqlite3.connect(self.path)) as db:
            thresholds = db.execute("SELECT body FROM thresholds WHERE id=1").fetchone()[0]
            prediction = db.execute("SELECT body FROM predictions ORDER BY seq DESC LIMIT 1").fetchone()
            alerts = db.execute("SELECT body FROM alerts ORDER BY seq DESC LIMIT 20").fetchall()
        return {"enabled": self.settings.tool_wear_demo_enabled, "thresholds": json.loads(thresholds),
                "prediction": json.loads(prediction[0]) if prediction else None,
                "alerts": [json.loads(row[0]) for row in alerts]}

    def set_thresholds(self, values: WearValues):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE thresholds SET body=? WHERE id=1", (values.model_dump_json(),))
        return values

    def record(self, values: MockPrediction):
        now = datetime.now(timezone.utc).isoformat()
        prediction = {"predictionId": str(uuid4()), "machineId": self.settings.signals_machine_id,
                      "timestampUtc": now, "source": "mock", **values.model_dump()}
        machine, tool = prediction["machineId"], values.toolNo
        alert = None
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            thresholds = json.loads(db.execute("SELECT body FROM thresholds WHERE id=1").fetchone()[0])
            row = db.execute(
                "SELECT body FROM predictions WHERE machine=? AND tool=? ORDER BY seq DESC LIMIT 1",
                (machine, tool),
            ).fetchone()
            previous = json.loads(row[0]) if row else {}
            exceeded = [metric for metric in METRICS if prediction[metric] > thresholds[metric]]
            triggered = [metric for metric in exceeded if metric not in previous.get("exceeded", [])]
            db.execute("INSERT INTO predictions(machine, tool, body) VALUES (?, ?, ?)",
                       (machine, tool, json.dumps({**prediction, "exceeded": exceeded})))
            if triggered:
                event = {"schemaVersion": "1.0.0", "eventType": "tool_wear_alert",
                         "alertId": str(uuid4()), "machineId": machine, "toolNo": tool,
                         "metrics": triggered, "timestampUtc": now, "source": "mock"}
                alert = {**event, "prediction": prediction, "thresholds": thresholds}
                db.execute("INSERT INTO alerts(body) VALUES (?)", (json.dumps(alert),))
                for destination in self.destinations:
                    db.execute("INSERT INTO outbox(destination, body) VALUES (?, ?)",
                               (destination, json.dumps(event)))
        if alert:
            logger.info("Tool wear alert triggered alertId=%s machine=%s tool=%s metrics=%s",
                        alert["alertId"], machine, tool, ",".join(triggered))
        return {"prediction": prediction, "alert": alert}

    async def publish(self, event):
        topic = self.settings.tool_wear_alert_kafka_topic
        producer = AIOKafkaProducer(
            bootstrap_servers=self.settings.microscope_kafka_bootstrap_servers,
            client_id="pqm-cnc-wear-alerts", acks="all", enable_idempotence=True,
            request_timeout_ms=10000,
        )
        try:
            async with asyncio.timeout(10):
                await producer.start()
                result = await producer.send_and_wait(
                    topic, key=event["alertId"].encode(), value=json.dumps(event).encode(),
                    headers=[("schemaVersion", b"1.0.0"), ("contentType", b"application/json")],
                )
            logger.info("Tool wear alert published to Kafka alertId=%s topic=%s partition=%s offset=%s",
                        event["alertId"], topic, result.partition, result.offset)
        finally:
            async with asyncio.timeout(5):
                await producer.stop()

    async def notify_temi(self, event):
        logger.info("Temi API trigger requested alertId=%s", event["alertId"])
        token = self.settings.tool_wear_alert_temi_token.get_secret_value()
        headers = {"Idempotency-Key": event["alertId"]}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(self.settings.tool_wear_alert_temi_url, json=event, headers=headers)
            response.raise_for_status()
        logger.info("Temi API triggered alertId=%s status=%s", event["alertId"], response.status_code)

    async def deliver(self, destination):
        with closing(sqlite3.connect(self.path)) as db:
            while True:
                row = db.execute(
                    "SELECT seq, body, attempts FROM outbox WHERE destination=? AND due<=unixepoch() ORDER BY seq LIMIT 1",
                    (destination,),
                ).fetchone()
                if row is None:
                    await asyncio.sleep(1)
                    continue
                seq, body, attempts = row
                event = json.loads(body)
                try:
                    if destination == "kafka":
                        await self.publish(event)
                    else:
                        await self.notify_temi(event)
                except Exception as exc:
                    logger.warning("Tool wear alert delivery failed destination=%s alertId=%s error=%s",
                                   destination, event["alertId"], type(exc).__name__)
                    with db:
                        db.execute("UPDATE outbox SET attempts=attempts+1, due=unixepoch()+? WHERE seq=?",
                                   (min(60, 2 ** min(attempts + 1, 6)), seq))
                else:
                    with db:
                        db.execute("DELETE FROM outbox WHERE seq=?", (seq,))

    @property
    def destinations(self):
        return [name for name, enabled in (
            ("kafka", self.settings.tool_wear_alert_kafka_enabled),
            ("temi", self.settings.tool_wear_alert_temi_enabled),
        ) if enabled]

    def start(self):
        self.tasks = [asyncio.create_task(self.deliver(name)) for name in self.destinations]

    def notify_listeners(self):
        for listener in self.listeners:
            listener.set()

    async def close(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)


def enabled_service(request: Request) -> WearAlerts:
    service = request.app.state.wear_alerts
    if not service.settings.tool_wear_demo_enabled:
        raise HTTPException(403, "Tool wear demo is disabled")
    return service


@router.get("")
def snapshot(request: Request):
    return request.app.state.wear_alerts.snapshot()


@router.put("/thresholds")
async def set_thresholds(request: Request, values: WearValues):
    service = enabled_service(request)
    result = await asyncio.to_thread(service.set_thresholds, values)
    service.notify_listeners()
    return result


@router.post("/prediction")
async def mock_prediction(request: Request, values: MockPrediction):
    service = enabled_service(request)
    result = await asyncio.to_thread(service.record, values)
    service.notify_listeners()
    return result


@router.get("/events")
async def prediction_events(request: Request):
    service = request.app.state.wear_alerts

    async def events():
        listener = asyncio.Event()
        service.listeners.add(listener)
        try:
            yield sse("updated", {})
            while not await request.is_disconnected():
                try:
                    await asyncio.wait_for(listener.wait(), timeout=15)
                    listener.clear()
                    yield sse("updated", {})
                except TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            service.listeners.discard(listener)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
