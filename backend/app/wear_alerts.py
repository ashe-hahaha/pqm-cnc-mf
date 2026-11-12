import asyncio
import json
import logging
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from aiokafka import AIOKafkaProducer
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import Settings
from app.signals import sse
from app.wear_series import DEFAULT_QUALITY_SPEC, PREDICTION_SERIES, QUALITY_BALLOON_ID, TOOL_NO

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/tool-wear/demo")
METRICS = ("diameter", "length")
RESET_RECORDS = 8  # predictions the demo is reset to (series entries #1 … #8)
HISTORY_RETURNED = 10  # predictions included in the snapshot (sliding window)
EVENTS_RETURNED = 100  # events included in the snapshot
EVENTS_KEPT = 1000  # events retained in the database
NC_LINE_FIELD = "nc_line"  # controller process-row field watched for the auto trigger
NC_COOLDOWN_S = 10  # minimum time between automatic triggers
FAILURE_EVENT_INTERVAL_S = 30  # at most one "Notification failed" event per alert and destination in this time


class WearValues(BaseModel):
    diameter: float = Field(ge=0, allow_inf_nan=False)
    length: float = Field(ge=0, allow_inf_nan=False)


class QualitySpec(BaseModel):
    """Tolerance of the quality balloon (stored by the backend): nominal +upperTol / -lowerTol."""
    nominal: float = Field(allow_inf_nan=False)
    upperTol: float = Field(ge=0, allow_inf_nan=False)
    lowerTol: float = Field(ge=0, allow_inf_nan=False)


class MockPrediction(BaseModel):
    """Trigger request. `index` (1-based) picks a series entry; omitted = next in the cycle."""
    index: int | None = Field(default=None, ge=1, le=len(PREDICTION_SERIES))


def normalize_nc(value):
    """Compare NC line values regardless of type: 25, 25.0 and "25" are the same value; empty is None."""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if value is None or str(value).strip() == "":
        return None
    return str(value).strip()


def nc_line_rising(previous, current, trigger):
    """Auto-trigger rule (kept separate so it is easy to replace): the value changes from something else to the trigger."""
    return current == trigger and previous != trigger


class WearAlerts:
    PREDICTION_DELAY_S = 3

    def __init__(self, settings: Settings):
        self.settings = settings
        self.nc = {"value": None, "seenAt": None, "lastTriggerAt": None}
        self.nc_last_trigger = None  # monotonic time of the last automatic trigger
        self.prediction_running = False
        self.background: set[asyncio.Task] = set()
        self.path = Path(settings.microscope_image_dir) / "wear-alerts.sqlite3"
        self.tasks: list[asyncio.Task] = []
        self.listeners: set[asyncio.Queue] = set()
        self.last_failure_event: dict[tuple[str, str], float] = {}
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS thresholds (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                INSERT OR IGNORE INTO thresholds VALUES (1, '{"diameter":999,"length":999}');
                CREATE TABLE IF NOT EXISTS predictions (
                    seq INTEGER PRIMARY KEY, machine TEXT NOT NULL, tool TEXT NOT NULL, body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS predictions_tool ON predictions(machine, tool, seq);
                CREATE TABLE IF NOT EXISTS quality_spec (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY, next_index INTEGER NOT NULL);
                INSERT OR IGNORE INTO cursor VALUES (1, 0);
                INSERT OR IGNORE INTO quality_spec VALUES (1, '{"nominal":0.0,"upperTol":0.02,"lowerTol":0.0}');
                CREATE TABLE IF NOT EXISTS alerts (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS outbox (
                    seq INTEGER PRIMARY KEY, destination TEXT NOT NULL, body TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, due REAL NOT NULL DEFAULT 0
                );
            """)

    def snapshot(self):
        with closing(sqlite3.connect(self.path)) as db:
            thresholds = db.execute("SELECT body FROM thresholds WHERE id=1").fetchone()[0]
            prediction = db.execute("SELECT body FROM predictions ORDER BY seq DESC LIMIT 1").fetchone()
            history = db.execute("SELECT body FROM predictions WHERE tool=? ORDER BY seq DESC LIMIT ?",
                                 (TOOL_NO, HISTORY_RETURNED)).fetchall()
            cursor = db.execute("SELECT next_index FROM cursor WHERE id=1").fetchone()[0]
            alerts = db.execute("SELECT body FROM alerts ORDER BY seq DESC LIMIT 20").fetchall()
            events = db.execute("SELECT body FROM events ORDER BY seq DESC LIMIT ?", (EVENTS_RETURNED,)).fetchall()
            pending = db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
            spec = db.execute("SELECT body FROM quality_spec WHERE id=1").fetchone()[0]
        return {"enabled": self.settings.tool_wear_demo_enabled, "thresholds": json.loads(thresholds),
                "prediction": json.loads(prediction[0]) if prediction else None,
                "history": [json.loads(row[0]) for row in reversed(history)],
                "series": [{"index": i + 1, "diameter": d, "length": l, "quality": q}
                           for i, (d, l, q) in enumerate(PREDICTION_SERIES)],
                "qualityBalloonId": QUALITY_BALLOON_ID, "qualitySpec": json.loads(spec),
                "ncWatch": self.nc_status(),
                "nextIndex": cursor % len(PREDICTION_SERIES) + 1,
                "destinations": self.destinations, "pendingNotifications": pending,
                "alerts": [json.loads(row[0]) for row in alerts],
                "events": [json.loads(row[0]) for row in reversed(events)]}

    def set_thresholds(self, values: WearValues):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE thresholds SET body=? WHERE id=1", (values.model_dump_json(),))
        return values

    def get_quality_spec(self, db=None):
        if db is not None:
            return QualitySpec.model_validate_json(db.execute("SELECT body FROM quality_spec WHERE id=1").fetchone()[0])
        with closing(sqlite3.connect(self.path)) as db:
            return self.get_quality_spec(db)

    def set_quality_spec(self, spec: QualitySpec):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE quality_spec SET body=? WHERE id=1", (spec.model_dump_json(),))
        return spec

    def nc_status(self):
        seen = self.nc["seenAt"]
        running = seen is not None and time.monotonic() - seen < max(5, 3 * self.settings.signals_poll_seconds)
        return {"field": NC_LINE_FIELD, "triggerValue": self.settings.tool_wear_nc_trigger_value,
                "running": running, "value": self.nc["value"], "lastTriggerAt": self.nc["lastTriggerAt"]}

    def on_signals(self, machine, batch, state):
        """Watch the controller NC line in every signal batch (only runs while a page is subscribed).

        `state` lives as long as the subscription: the first batch after a page opens only records the current value.
        """
        if machine != self.settings.signals_machine_id:
            return
        trigger = normalize_nc(self.settings.tool_wear_nc_trigger_value)
        rows = sorted((row for row in batch.get("process", []) if row.get("timestamp")),
                      key=lambda row: row["timestamp"])
        first = "last_timestamp" not in state
        changed = False
        fire = None
        for row in rows:
            if not first and row["timestamp"] <= state["last_timestamp"]:
                continue  # windows overlap and a stopped database repeats old rows
            current = normalize_nc(row.get(NC_LINE_FIELD))
            if not first and nc_line_rising(state["value"], current, trigger):
                fire = (state["value"], current)
            if current != state.get("value"):
                changed = True
            state["value"] = current
            state["last_timestamp"] = row["timestamp"]
        self.nc["seenAt"] = time.monotonic()
        if state.get("value") != self.nc["value"]:
            self.nc["value"] = state.get("value")
            changed = True
        if fire:
            self.start_auto_prediction(*fire)
        elif changed:
            self.notify_listeners()

    def start_auto_prediction(self, previous, current):
        now = time.monotonic()
        if not self.settings.tool_wear_demo_enabled or self.prediction_running:
            return
        if self.nc_last_trigger is not None and now - self.nc_last_trigger < NC_COOLDOWN_S:
            logger.info("NC line trigger ignored (cooldown) %s -> %s", previous, current)
            return
        self.nc_last_trigger = now
        self.nc["lastTriggerAt"] = datetime.now(timezone.utc).isoformat()
        logger.info("NC line %s -> %s: starting prediction", previous, current)
        task = asyncio.create_task(self.run_prediction(
            MockPrediction(), detail=f"NC line {previous if previous is not None else 'null'} → {current}"))
        self.background.add(task)
        task.add_done_callback(self.background.discard)

    async def run_prediction(self, values: MockPrediction, detail="Mock prediction"):
        """Manual and automatic triggers share this flow: events, prediction, alerts and notifications."""
        self.prediction_running = True
        try:
            self.log_event("Prediction started", TOOL_NO, detail=detail)
            await asyncio.sleep(self.PREDICTION_DELAY_S)
            result = await asyncio.to_thread(self.record, values)
            self.log_prediction_results(result)
            self.notify_listeners()
            return result
        finally:
            self.prediction_running = False

    def log_prediction_results(self, result):
        service = self
        prediction = result["prediction"]
        service.log_event("Prediction completed", TOOL_NO, timestamp=prediction["timestampUtc"],
                          detail=f'#{prediction["index"]} · Diameter {prediction["diameter"]} mm · Length {prediction["length"]} mm · B1 {prediction["quality"]} mm')
        alert = result["alert"]
        if alert:
            detail = " · ".join(
                f'{metric.capitalize()} {prediction[metric]} mm > {alert["thresholds"][metric]} mm'
                for metric in alert["metrics"]
            )
            service.log_event("Alert triggered", TOOL_NO, timestamp=alert["timestampUtc"],
                              detail=detail, event_id=f'{alert["alertId"]}:alert')
            for destination in service.destinations:
                service.log_event("Notification queued", TOOL_NO, detail=service.destination_label(destination),
                                  event_id=f'{alert["alertId"]}:{destination}:queued')
        quality_alert = result["qualityAlert"]
        if quality_alert:
            comparison = ">" if quality_alert["side"] == "upper" else "<"
            service.log_event("Quality alert triggered", TOOL_NO, timestamp=quality_alert["timestampUtc"],
                              detail=f'{quality_alert["balloonId"].upper()} {quality_alert["value"]} mm {comparison} '
                                     f'{"USL" if quality_alert["side"] == "upper" else "LSL"} {round(quality_alert["limit"], 6)} mm',
                              event_id=f'{quality_alert["alertId"]}:alert')

    def reset(self):
        """Back to a known demo state: only the first RESET_RECORDS predictions, no alerts, events or pending sends.

        Thresholds are kept. The next automatic trigger continues with the following series entry.
        """
        now = datetime.now(timezone.utc)
        machine = self.settings.signals_machine_id
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            for table in ("predictions", "alerts", "outbox"):
                db.execute(f"DELETE FROM {table}")
            for i, (diameter, length, quality) in enumerate(PREDICTION_SERIES[:RESET_RECORDS]):
                stamp = (now - timedelta(minutes=RESET_RECORDS - i)).isoformat()
                prediction = {"predictionId": str(uuid4()), "machineId": machine, "toolNo": TOOL_NO,
                              "timestampUtc": stamp, "source": "mock", "index": i + 1,
                              "diameter": diameter, "length": length,
                              "balloonId": QUALITY_BALLOON_ID, "quality": quality, "exceeded": []}
                db.execute("INSERT INTO predictions(machine, tool, body) VALUES (?, ?, ?)",
                           (machine, TOOL_NO, json.dumps(prediction)))
            db.execute("UPDATE cursor SET next_index=? WHERE id=1", (RESET_RECORDS % len(PREDICTION_SERIES),))
        logger.info("Tool wear demo reset to the first %s predictions", RESET_RECORDS)

    def record(self, values: MockPrediction):
        now = datetime.now(timezone.utc).isoformat()
        machine, tool = self.settings.signals_machine_id, TOOL_NO
        alert = quality_alert = None
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            spec = self.get_quality_spec(db)
            usl, lsl = round(spec.nominal + spec.upperTol, 9), round(spec.nominal - spec.lowerTol, 9)
            cursor = db.execute("SELECT next_index FROM cursor WHERE id=1").fetchone()[0]
            position = (values.index - 1) if values.index else cursor % len(PREDICTION_SERIES)
            diameter, length, quality = PREDICTION_SERIES[position]
            db.execute("UPDATE cursor SET next_index=? WHERE id=1", ((position + 1) % len(PREDICTION_SERIES),))
            prediction = {"predictionId": str(uuid4()), "machineId": machine, "toolNo": tool,
                          "timestampUtc": now, "source": "mock", "index": position + 1,
                          "diameter": diameter, "length": length,
                          "balloonId": QUALITY_BALLOON_ID, "quality": quality}
            thresholds = json.loads(db.execute("SELECT body FROM thresholds WHERE id=1").fetchone()[0])
            # Every metric above its threshold alerts, even if the previous prediction was also above.
            triggered = [metric for metric in METRICS if prediction[metric] > thresholds[metric]]
            db.execute("INSERT INTO predictions(machine, tool, body) VALUES (?, ?, ?)",
                       (machine, tool, json.dumps({**prediction, "exceeded": triggered})))
            if triggered:
                event = {"schemaVersion": "1.0.0", "eventType": "tool_wear_alert",
                         "alertId": str(uuid4()), "machineId": machine, "toolNo": tool,
                         "metrics": triggered, "timestampUtc": now, "source": "mock"}
                alert = {**event, "kind": "tool_wear", "prediction": prediction, "thresholds": thresholds}
                db.execute("INSERT INTO alerts(body) VALUES (?)", (json.dumps(alert),))
                for destination in self.destinations:
                    db.execute("INSERT INTO outbox(destination, body) VALUES (?, ?)",
                               (destination, json.dumps(event)))
            # Quality: alert when the predicted value leaves the tolerance band (events + Alerts only, no Kafka).
            if quality > usl or quality < lsl:
                side = "upper" if quality > usl else "lower"
                quality_alert = {"kind": "quality", "alertId": str(uuid4()), "machineId": machine,
                                 "toolNo": tool, "balloonId": QUALITY_BALLOON_ID, "timestampUtc": now,
                                 "source": "mock", "value": quality, "side": side,
                                 "limit": usl if side == "upper" else lsl,
                                 "spec": {**spec.model_dump(), "usl": usl, "lsl": lsl}, "prediction": prediction}
                db.execute("INSERT INTO alerts(body) VALUES (?)", (json.dumps(quality_alert),))
        if quality_alert:
            logger.info("Quality alert triggered alertId=%s machine=%s balloon=%s value=%s limit=%s",
                        quality_alert["alertId"], machine, QUALITY_BALLOON_ID, quality, quality_alert["limit"])
        if alert:
            logger.info("Tool wear alert triggered alertId=%s machine=%s tool=%s metrics=%s",
                        alert["alertId"], machine, tool, ",".join(triggered))
        return {"prediction": prediction, "alert": alert, "qualityAlert": quality_alert}

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
            self.log_event("Notification sent", event["toolNo"], detail=f"Kafka · {topic}",
                           event_id=f'{event["alertId"]}:kafka')
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
            # The Temi trigger takes no payload: an empty POST (the alert is identified by the header only).
            response = await client.post(self.settings.tool_wear_alert_temi_url, headers=headers)
            response.raise_for_status()
        logger.info("Temi API triggered alertId=%s status=%s", event["alertId"], response.status_code)
        self.log_event("Notification sent", event["toolNo"], detail="Temi API",
                       event_id=f'{event["alertId"]}:temi')

    def destination_label(self, destination):
        if destination == "kafka":
            return f"Kafka · {self.settings.tool_wear_alert_kafka_topic}"
        return "Temi API"

    def note_delivery_failure(self, destination, event, attempts, exc):
        """Log a failed send; the page gets a (rate-limited) event so failures are visible there too."""
        logger.warning("Tool wear alert delivery failed destination=%s alertId=%s error=%s",
                       destination, event["alertId"], type(exc).__name__)
        key, now = (event["alertId"], destination), time.monotonic()
        last = self.last_failure_event.get(key)
        if last is None or now - last >= FAILURE_EVENT_INTERVAL_S:
            self.last_failure_event[key] = now
            self.log_event("Notification failed", event["toolNo"],
                           detail=f"{self.destination_label(destination)} · {type(exc).__name__} · attempt {attempts + 1}")

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
                    self.note_delivery_failure(destination, event, attempts, exc)
                    with db:
                        db.execute("UPDATE outbox SET attempts=attempts+1, due=unixepoch()+? WHERE seq=?",
                                   (min(60, 2 ** min(attempts + 1, 6)), seq))
                else:
                    self.last_failure_event.pop((event["alertId"], destination), None)
                    with db:
                        db.execute("DELETE FROM outbox WHERE seq=?", (seq,))

    @property
    def destinations(self):
        return [name for name, enabled in (
            ("kafka", self.settings.tool_wear_alert_kafka_enabled),
            ("temi", self.settings.tool_wear_alert_temi_enabled),
        ) if enabled]

    def start(self):
        logger.info("Tool wear alert destinations: %s (kafka=%s topic=%s, temi=%s)",
                    ",".join(self.destinations) or "none", self.settings.microscope_kafka_bootstrap_servers,
                    self.settings.tool_wear_alert_kafka_topic, bool(self.settings.tool_wear_alert_temi_url))
        self.tasks = [asyncio.create_task(self.deliver(name)) for name in self.destinations]

    def notify_listeners(self, event="updated", payload=None):
        for listener in self.listeners:
            if listener.full():
                listener.get_nowait()
            listener.put_nowait((event, payload or {}))

    def log_event(self, label, tool_no, *, timestamp=None, detail=None, event_id=None):
        event = {
            "id": event_id or str(uuid4()), "label": label, "toolNo": tool_no,
            "timestampUtc": timestamp or datetime.now(timezone.utc).isoformat(),
            "detail": detail,
        }
        with closing(sqlite3.connect(self.path)) as db, db:
            inserted = db.execute("INSERT OR IGNORE INTO events(id, body) VALUES (?, ?)",
                                  (event["id"], json.dumps(event))).rowcount
            if inserted:
                db.execute("DELETE FROM events WHERE seq <= (SELECT MAX(seq) FROM events) - ?", (EVENTS_KEPT,))
        if inserted:  # a repeated id (e.g. a redelivered photo) is already stored and broadcast
            self.notify_listeners("wear_event", event)

    def log_photo(self, image):
        self.log_event("Photo received", image["toolNo"], timestamp=image["receivedAt"],
                       detail=image["machineId"], event_id=f'{image["captureId"]}:photo')

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


@router.put("/quality-spec")
async def set_quality_spec(request: Request, spec: QualitySpec):
    service = enabled_service(request)
    result = await asyncio.to_thread(service.set_quality_spec, spec)
    service.notify_listeners()
    return result


@router.post("/prediction")
async def mock_prediction(request: Request, values: MockPrediction):
    return await enabled_service(request).run_prediction(values)


@router.post("/reset")
async def reset(request: Request):
    service = enabled_service(request)
    await asyncio.to_thread(service.reset)
    service.notify_listeners("reset")
    service.notify_listeners()
    return service.snapshot()


@router.get("/events")
async def prediction_events(request: Request):
    service = request.app.state.wear_alerts

    async def events():
        listener = asyncio.Queue(maxsize=128)
        service.listeners.add(listener)
        try:
            yield sse("updated", {})
            while not await request.is_disconnected():
                try:
                    event, payload = await asyncio.wait_for(listener.get(), timeout=15)
                    yield sse(event, payload)
                except TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            service.listeners.discard(listener)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
