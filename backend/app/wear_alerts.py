import asyncio
import json
import logging
import math
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
from app.kafka_receipts import KafkaReceiptTracker
from app.measurements import tool_measurement, quality_measurement
from app.wear_history import tool_key
from app.wear_series import FIXED_QUALITY_BY_BALLOON
from app.wear_series import (B9_QUALITY_MEASUREMENTS, DEFAULT_QUALITY_SPEC, DEFAULT_WEAR_THRESHOLDS, HISTORICAL_WEAR_MEASUREMENTS, FIXED_QUALITY_SERIES, FIXED_QUALITY_MEASUREMENTS, PREDICTION_SERIES, QUALITY_BALLOON_CODE, QUALITY_BALLOON_ID,
                             TOOL_NO)

def history_timestamp(anchor: datetime, index: int) -> str:
    """Entry ten is current; earlier entries alternate four/five days apart."""
    days = sum(4 if step % 2 else 5 for step in range(index, 10))
    return (anchor - timedelta(days=days)).isoformat()


logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/tool-wear/demo")
METRICS = ("diameter", "length")
RESET_RECORDS = 9  # predictions the demo is reset to (series entries #1 … #9)
HISTORY_RETURNED = 10  # predictions included in the snapshot (sliding window)
EVENTS_RETURNED = 100  # events included in the snapshot
EVENTS_KEPT = 1000  # events retained in the database
NC_LINE_FIELD = "nc_line"  # controller process-row field watched for the auto trigger
NC_COOLDOWN_S = 10  # minimum time between automatic triggers
NC_QC_VALUES = frozenset(("91", "92", "93"))  # QC sampling lines; no prediction is started
QC_MACRO = "106"  # key of the process row's `macros` object that holds the measured diameter (mm)
NC_RANGE_LOW, NC_RANGE_HIGH = 73, 74  # first entry into this range (inclusive) also triggers
FAILURE_EVENT_INTERVAL_S = 30  # at most one "Notification failed" event per alert and destination in this time
KAFKA_SCHEMA_VERSION = "1.1.0"
ACTION_INSPECTION = "inspection"  # Kafka `action`: the operator confirmed a laser inspection
ACTION_SECOND_RUN = "second_run"  # Kafka `action`: the operator asked for a second run after the inspection
INSPECTION_OPEN = ("awaiting_result", "result_ready")  # statuses that are still waiting for the operator or the controller
WEAR_EPSILON = 1e-6  # mm; a wear value that differs by more than this counts as a new value


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


def nc_trigger_values(settings: Settings):
    """Configured trigger values, normalised, in the order they were written."""
    values = (normalize_nc(item) for item in settings.tool_wear_nc_trigger_values.split(","))
    return [value for value in dict.fromkeys(values) if value is not None]


def nc_in_range(value):
    """True when a normalised NC line value is a number inside NC_RANGE_LOW..NC_RANGE_HIGH (inclusive)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return NC_RANGE_LOW <= number <= NC_RANGE_HIGH


def nc_trigger_kind(previous, current, triggers):
    """Auto-trigger rule (kept separate so it is easy to replace).

    "start": the line changes to a trigger value (default 29).
    "range": the line enters NC_RANGE_LOW..NC_RANGE_HIGH from outside it (moving inside the range does not count).
    None: no trigger.
    """
    if previous == current:
        return None
    if current in triggers:
        return "start"
    if nc_in_range(current) and not nc_in_range(previous):
        return "range"
    return None


def wear_from_row(row):
    """Actual (diameter, length) wear in mm from a controller row: xWearMm / zWearMm, or the older tool_wear_*_mm names."""
    def pick(*keys):
        for key in keys:
            value = row.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                return float(value)
        return None
    return pick("xWearMm", "tool_wear_x_mm"), pick("zWearMm", "tool_wear_z_mm")


def event_key(event):
    """Unique id of an outgoing notification (Kafka key). Events queued before schema 1.1.0 only have `alertId`."""
    return event.get("eventId") or event["alertId"]


def qc_from_row(row):
    """Measured diameter (mm) from a process row's `macros` map (string macro number -> float); None if unusable."""
    macros = row.get("macros")
    value = macros.get(QC_MACRO) if isinstance(macros, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


class WearAlerts:

    def __init__(self, settings: Settings):
        self.settings = settings
        self.PREDICTION_DELAY_S = settings.tool_wear_prediction_delay_seconds  # simulated prediction time
        self.nc = {"value": None, "seenAt": None, "lastTriggerAt": None}
        self.nc_last_trigger = None  # monotonic time of the last automatic trigger
        self.prediction_running = False
        self.cutting = {"run": 1, "status": "waiting", "alertId": None}
        self.cutting_task: asyncio.Task | None = None
        self.first_run_prediction_started = False
        self.latest_wear: dict[str, tuple[float | None, float | None]] = {}  # tool -> last seen (diameter, length) wear
        self.background: set[asyncio.Task] = set()
        self.path = Path(settings.microscope_image_dir) / "wear-alerts.sqlite3"
        self.tasks: list[asyncio.Task] = []
        self.listeners: set[asyncio.Queue] = set()
        self.last_failure_event: dict[tuple[str, str], float] = {}
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS thresholds (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS settings_migrations (name TEXT PRIMARY KEY);
                INSERT OR IGNORE INTO thresholds VALUES (1, '{"diameter":999,"length":999}');
                CREATE TABLE IF NOT EXISTS predictions (
                    seq INTEGER PRIMARY KEY, machine TEXT NOT NULL, tool TEXT NOT NULL, body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS predictions_tool ON predictions(machine, tool, seq);
                CREATE TABLE IF NOT EXISTS quality_spec (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history_clock (id INTEGER PRIMARY KEY, anchor TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS last_qc (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS demo_tool_measurement (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY, next_index INTEGER NOT NULL);
                INSERT OR IGNORE INTO cursor VALUES (1, 0);
                CREATE TABLE IF NOT EXISTS alerts (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS deferred_tasks (id TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS inspections (
                    seq INTEGER PRIMARY KEY, alert_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS outbox (
                    seq INTEGER PRIMARY KEY, destination TEXT NOT NULL, body TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, due REAL NOT NULL DEFAULT 0
                );
            """)
            db.execute("INSERT OR IGNORE INTO history_clock VALUES (1, ?)", (datetime.now(timezone.utc).isoformat(),))
            default = QualitySpec(nominal=DEFAULT_QUALITY_SPEC[0], upperTol=DEFAULT_QUALITY_SPEC[1],
                                  lowerTol=DEFAULT_QUALITY_SPEC[2])
            db.execute("INSERT OR IGNORE INTO quality_spec VALUES (1, ?)", (default.model_dump_json(),))
            if db.execute("INSERT OR IGNORE INTO settings_migrations VALUES ('wear-series-20261126')").rowcount:
                db.execute("UPDATE thresholds SET body=? WHERE id=1", (json.dumps(DEFAULT_WEAR_THRESHOLDS),))
                # Update saved prediction history once; preserve quality, ids and timestamps.
                for seq, body in db.execute("SELECT seq, body FROM predictions").fetchall():
                    prediction = json.loads(body)
                    index = prediction.get("index")
                    if isinstance(index, int) and 1 <= index <= len(PREDICTION_SERIES):
                        prediction.update(diameter=PREDICTION_SERIES[index - 1][0], length=PREDICTION_SERIES[index - 1][1],
                                          measured=HISTORICAL_WEAR_MEASUREMENTS.get(index))
                        prediction["exceeded"] = [key for key in METRICS if prediction[key] > DEFAULT_WEAR_THRESHOLDS[key]]
                        db.execute("UPDATE predictions SET body=? WHERE seq=?", (json.dumps(prediction), seq))

            if db.execute("INSERT OR IGNORE INTO settings_migrations VALUES ('quality-dimensions-20261126')").rowcount:
                db.execute("UPDATE quality_spec SET body=? WHERE id=1", (default.model_dump_json(),))
                for seq, body in db.execute("SELECT seq, body FROM predictions").fetchall():
                    prediction = json.loads(body)
                    index = prediction.get("index")
                    if isinstance(index, int) and 1 <= index <= len(PREDICTION_SERIES):
                        prediction["quality"] = PREDICTION_SERIES[index - 1][2]
                        db.execute("UPDATE predictions SET body=? WHERE seq=?", (json.dumps(prediction), seq))

            if db.execute("INSERT OR IGNORE INTO settings_migrations VALUES ('quality-005-markers-20261126')").rowcount:
                db.execute("UPDATE quality_spec SET body=? WHERE id=1", (default.model_dump_json(),))
                for seq, body in db.execute("SELECT seq, body FROM predictions").fetchall():
                    prediction = json.loads(body)
                    index = prediction.get("index")
                    prediction["qcValue"] = B9_QUALITY_MEASUREMENTS.get(index)
                    if index == 10:
                        prediction["quality"] = PREDICTION_SERIES[9][2]
                    db.execute("UPDATE predictions SET body=? WHERE seq=?", (json.dumps(prediction), seq))

            if db.execute("INSERT OR IGNORE INTO settings_migrations VALUES ('quality-004-20261127')").rowcount:
                db.execute("UPDATE quality_spec SET body=? WHERE id=1", (default.model_dump_json(),))

            if db.execute("INSERT OR IGNORE INTO settings_migrations VALUES ('restore-raw-qc-20261127')").rowcount:
                row = db.execute("SELECT body FROM last_qc WHERE id=1").fetchone()
                if row:
                    qc = json.loads(row[0])
                    qc.update(quality_measurement(qc.get("rawValue", qc["value"])))
                    db.execute("UPDATE last_qc SET body=? WHERE id=1", (json.dumps(qc),))

            if db.execute("INSERT OR IGNORE INTO settings_migrations VALUES ('restore-raw-tool-20261127')").rowcount:
                row = db.execute("SELECT body FROM demo_tool_measurement WHERE id=1").fetchone()
                if row:
                    measurement = json.loads(row[0])
                    raw = measurement.get("rawValue")
                    if isinstance(raw, dict):
                        measurement.update(**raw, **tool_measurement(raw))
                        measurement.pop("fallback", None)
                        db.execute("UPDATE demo_tool_measurement SET body=? WHERE id=1", (json.dumps(measurement),))
                for seq, body in db.execute("SELECT seq, body FROM inspections").fetchall():
                    inspection = json.loads(body)
                    result = inspection.get("result")
                    if not result:
                        continue
                    raw = result.get("rawActual") or result.get("measurement", {}).get("rawValue")
                    if not isinstance(raw, dict):
                        continue
                    result.update(actual={**result["actual"], **raw}, rawActual=raw, measurement=tool_measurement(raw))
                    result["exceeded"] = [key for key in METRICS if result["actual"][key] > result["thresholds"][key]]
                    db.execute("UPDATE inspections SET body=? WHERE seq=?", (json.dumps(inspection), seq))

        self.kafka_receipts = KafkaReceiptTracker(settings, self.path, self.log_event)

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
            last_qc = db.execute("SELECT body FROM last_qc WHERE id=1").fetchone()
            tool_measurement = db.execute("SELECT body FROM demo_tool_measurement WHERE id=1").fetchone()
            inspection = db.execute("SELECT body FROM inspections ORDER BY seq DESC LIMIT 1").fetchone()
            tasks = self.pending_tasks(db)
            anchor_stamp = db.execute("SELECT anchor FROM history_clock WHERE id=1").fetchone()[0]
        history_points = [json.loads(row[0]) for row in reversed(history)]
        measured_history = [point for point in history_points if point.get("qcValue") is not None]
        historical_qc = ({"value": measured_history[-1]["qcValue"],
                          "timestampUtc": measured_history[-1]["timestampUtc"],
                          "predictionId": measured_history[-1]["predictionId"]} if measured_history else None)
        ninth = next((point for point in history_points if point.get("index") == 9), None)
        anchor = datetime.fromisoformat(ninth["timestampUtc"]) + timedelta(days=4) if ninth else datetime.fromisoformat(anchor_stamp)
        def dated(series):
            return [{**point, "timestampUtc": history_timestamp(anchor, point["index"])} for point in series]
        return {"enabled": self.settings.tool_wear_demo_enabled, "thresholds": json.loads(thresholds),
                "prediction": json.loads(prediction[0]) if prediction else None,
                "history": history_points,
                "series": [{"index": i + 1, "diameter": d, "length": l, "quality": q}
                           for i, (d, l, q) in enumerate(PREDICTION_SERIES)],
                "fixedQualitySeries": dated([{"index": i + 1, "quality": q, "qcValue": FIXED_QUALITY_MEASUREMENTS.get(i + 1)}
                                       for i, q in enumerate(FIXED_QUALITY_SERIES)]),
                "fixedQualitySpec": {"nominal": DEFAULT_QUALITY_SPEC[0], "upperTol": DEFAULT_QUALITY_SPEC[1], "lowerTol": DEFAULT_QUALITY_SPEC[2]},
                "fixedQualityByBalloon": {key: dated(series) for key, series in FIXED_QUALITY_BY_BALLOON.items()},
                "qualityBalloonId": QUALITY_BALLOON_ID, "qualitySpec": json.loads(spec),
                "lastQc": json.loads(last_qc[0]) if last_qc else historical_qc,
                "toolMeasurement": json.loads(tool_measurement[0]) if tool_measurement else None,
                "ncWatch": self.nc_status(),
                "cutting": dict(self.cutting),
                "inspection": json.loads(inspection[0]) if inspection else None,
                "tasks": tasks,
                "nextIndex": cursor % len(PREDICTION_SERIES) + 1,
                "destinations": self.destinations, "pendingNotifications": pending,
                "alerts": [json.loads(row[0]) for row in alerts],
                "events": [json.loads(row[0]) for row in reversed(events)]}

    def pending_tasks(self, db):
        deferred = {row[0] for row in db.execute("SELECT id FROM deferred_tasks")}
        inspections = {row[0]: json.loads(row[1]) for row in db.execute("SELECT alert_id, body FROM inspections")}
        tasks = []
        for (body,) in db.execute("SELECT body FROM alerts ORDER BY seq DESC"):
            alert = json.loads(body)
            if alert.get("kind") != "tool_wear" or alert["alertId"] in inspections:
                continue
            task_id = f'inspection:{alert["alertId"]}'
            tasks.append({"id": task_id, "kind": "inspection", "deferred": task_id in deferred,
                          "timestampUtc": alert["timestampUtc"], "toolNo": alert["toolNo"], "alert": alert})
        for inspection in inspections.values():
            if inspection["status"] != "result_ready" or not inspection.get("image"):
                continue
            task_id = f'rework:{inspection["alertId"]}'
            tasks.append({"id": task_id, "kind": "rework", "deferred": task_id in deferred,
                          "timestampUtc": inspection["image"]["receivedAt"], "toolNo": inspection["toolNo"],
                          "inspection": inspection})
        return sorted(tasks, key=lambda task: task["timestampUtc"], reverse=True)

    def defer_task(self, task_id):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if not any(task["id"] == task_id for task in self.pending_tasks(db)):
                raise HTTPException(409, "Task is no longer pending")
            db.execute("INSERT OR IGNORE INTO deferred_tasks VALUES (?)", (task_id,))
        return {"id": task_id, "deferred": True}

    def update_first_cutting(self, line):
        if not self.settings.tool_wear_demo_enabled or self.cutting["run"] != 1:
            return False
        status = self.cutting["status"]
        try:
            number = float(line)
        except (ValueError, TypeError):
            return False
        if number in (22, 29) and status != "finished":
            self.cutting = {**self.cutting, "status": "finished"}
        elif 1 <= number <= 10 and status == "waiting":
            self.cutting = {**self.cutting, "status": "cutting"}
        else:
            return False
        return True

    def cancel_cutting_timer(self):
        if self.cutting_task is not None:
            self.cutting_task.cancel()
            self.cutting_task = None

    def arm_second_cutting(self, alert_id):
        # Called on the event loop after the inspection transaction commits.
        if self.cutting["alertId"] == alert_id:
            return
        self.cancel_cutting_timer()
        self.cutting = {"run": 2, "status": "pending", "alertId": alert_id}
        self.cutting_task = asyncio.create_task(self.start_second_cutting(alert_id))

    async def start_second_cutting(self, alert_id):
        await asyncio.sleep(self.settings.tool_wear_second_run_cutting_delay_seconds)
        if self.cutting["alertId"] == alert_id and self.cutting["status"] == "pending":
            self.cutting = {**self.cutting, "status": "cutting"}
            self.notify_listeners()

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
        return {"field": NC_LINE_FIELD, "triggerValues": nc_trigger_values(self.settings),
                "rangeValues": [NC_RANGE_LOW, NC_RANGE_HIGH],
                "running": running, "value": self.nc["value"], "lastTriggerAt": self.nc["lastTriggerAt"]}

    def on_signals(self, machine, batch, state):
        """Watch the controller NC line in every signal batch, independently of browser subscriptions.

        `state` lives with the machine feed: only its first batch establishes a baseline.
        """
        if machine != self.settings.signals_machine_id:
            return
        triggers = nc_trigger_values(self.settings)
        rows = sorted((row for row in batch.get("process", []) if row.get("timestamp")),
                      key=lambda row: row["timestamp"])
        first = "last_timestamp" not in state
        changed = False
        fires = []
        qc_rows = []
        wear_rows = []
        for row in rows:
            if not first and row["timestamp"] <= state["last_timestamp"]:
                continue  # windows overlap and a stopped database repeats old rows
            current = normalize_nc(row.get(NC_LINE_FIELD))
            changed |= self.update_first_cutting(current)
            kind = None if first else nc_trigger_kind(state["value"], current, triggers)
            if kind:
                fires.append((state["value"], current, kind))
            if not first and current in NC_QC_VALUES:
                qc_rows.append(row)  # allow a later row in the range to supply the first valid macro
            if current != state.get("value"):
                changed = True
            state["value"] = current
            state["last_timestamp"] = row["timestamp"]
            wear_rows.append((normalize_nc(row.get("tool_no")), *wear_from_row(row), row["timestamp"]))
        self.nc["seenAt"] = time.monotonic()
        if first and rows:
            logger.info("Controller baseline established machine=%s nc_line=%s timestamp=%s",
                        machine, state.get("value"), state.get("last_timestamp"))
        if state.get("value") != self.nc["value"]:
            self.nc["value"] = state.get("value")
            changed = True
        if qc_rows:
            # Do not let a later line overwrite an earlier valid measurement in the same batch.
            qc_row = next((row for row in qc_rows if qc_from_row(row) is not None), qc_rows[0])
            self.record_qc(qc_row)
        result_ready = False
        for tool, diameter, length, stamp in wear_rows:  # the feed's initial batch only records baseline values
            result_ready |= self.on_wear(tool, diameter, length, stamp, detect=not first)
        if result_ready:
            self.notify_listeners()
        for fire in fires:  # in line order; the shared cooldown lets only the first one through
            self.start_auto_prediction(*fire)
        if changed:
            self.notify_listeners()

    def on_wear(self, tool, diameter, length, stamp, detect=True):
        """Remember the latest actual wear of a tool; a new value completes the tool's waiting laser inspections."""
        if tool is None:
            return False
        previous = self.latest_wear.get(tool, (None, None))
        self.latest_wear[tool] = (diameter if diameter is not None else previous[0],
                                  length if length is not None else previous[1])
        if not detect or diameter is None or length is None:
            return False
        return self.complete_inspections(tool, diameter, length, stamp)

    def complete_inspections(self, tool, diameter, length, stamp):
        """Both wear values arrived and at least one differs from the value seen at confirmation: result is ready."""
        completed = []
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            for seq, body in db.execute("SELECT seq, body FROM inspections").fetchall():
                inspection = json.loads(body)
                if (inspection["status"] == "superseded"
                        or inspection["status"] == "dismissed" and not inspection.get("image")
                        or inspection.get("result") is not None or normalize_nc(inspection["toolNo"]) != tool):
                    continue
                baseline = inspection["baseline"]
                if all(baseline[metric] is not None and abs(value - baseline[metric]) <= WEAR_EPSILON
                       for metric, value in (("diameter", diameter), ("length", length))):
                    continue  # still the value from before the inspection
                actual = {"diameter": diameter, "length": length}
                thresholds = inspection["thresholds"]
                checked = tool_measurement(actual)
                inspection["result"] = {
                    "timestampUtc": stamp, "actual": actual, "predicted": inspection["predicted"],
                    "rawActual": checked["rawValue"], "measurement": checked,
                    "thresholds": thresholds,
                    "exceeded": [metric for metric in METRICS if actual[metric] > thresholds[metric]],
                }
                db.execute("UPDATE inspections SET body=? WHERE seq=?", (json.dumps(inspection), seq))
                measurement = {"toolNo": inspection["toolNo"], "machineId": inspection["machineId"],
                               "timestampUtc": stamp, **actual, **checked}
                db.execute("INSERT OR IGNORE INTO demo_tool_measurement VALUES (1, ?)", (json.dumps(measurement),))
                completed.append(inspection)
        for inspection in completed:
            self.log_event("Inspection result received", inspection["toolNo"], timestamp=inspection["result"]["timestampUtc"],
                           detail=f'Diameter wear {diameter} mm · Tool length wear {length} mm',
                           event_id=f'{inspection["alertId"]}:result')
        return bool(completed)

    def kafka_event(self, action, alert_id, machine, tool, now, **extra):
        """Notification for the NUC consumer: `action` tells an inspection request from a second run."""
        return {"schemaVersion": KAFKA_SCHEMA_VERSION, "eventType": "tool_wear_alert", "action": action,
                "eventId": str(uuid4()), "alertId": alert_id, "machineId": machine, "toolNo": tool,
                **extra, "timestampUtc": now, "source": "mock"}

    def queue_kafka(self, db, event):
        """Queue a notification for Kafka only (Temi is only notified when the alert itself fires)."""
        if "kafka" not in self.destinations:
            return False
        db.execute("INSERT INTO outbox(destination, body) VALUES (?, ?)", ("kafka", json.dumps(event)))
        return True

    def get_inspection(self, db, alert_id):
        row = db.execute("SELECT body FROM inspections WHERE alert_id=?", (alert_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def start_inspection(self, alert_id):
        """Operator chose "laser inspection": remember the wear seen now, wait for a new value, notify Kafka (inspection)."""
        now = datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            existing = self.get_inspection(db, alert_id)
            if existing:
                return existing  # a repeated confirmation changes nothing and sends nothing
            row = db.execute("SELECT body FROM alerts WHERE json_extract(body, '$.alertId')=? "
                             "AND json_extract(body, '$.kind')='tool_wear'", (alert_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Unknown tool wear alert")
            alert = json.loads(row[0])
            tool = alert["toolNo"]
            for seq, body in db.execute("SELECT seq, body FROM inspections").fetchall():  # one open inspection per tool
                other = json.loads(body)
                if other["status"] in INSPECTION_OPEN and other["toolNo"] == tool:
                    other["status"] = "superseded"
                    db.execute("UPDATE inspections SET body=? WHERE seq=?", (json.dumps(other), seq))
            diameter, length = self.latest_wear.get(normalize_nc(tool), (None, None))
            inspection = {"alertId": alert_id, "machineId": alert["machineId"], "toolNo": tool,
                          "status": "awaiting_result", "confirmedAt": now, "metrics": alert["metrics"],
                          "baseline": {"diameter": diameter, "length": length},
                          "predicted": {metric: alert["prediction"][metric] for metric in METRICS},
                          "thresholds": alert["thresholds"], "result": None, "image": None}
            db.execute("INSERT INTO inspections(alert_id, body) VALUES (?, ?)", (alert_id, json.dumps(inspection)))
            event = self.kafka_event(ACTION_INSPECTION, alert_id, alert["machineId"], tool, now, metrics=alert["metrics"])
            queued = self.queue_kafka(db, event)
        self.log_event("Laser inspection confirmed", tool, detail="Waiting for inspection image and wear values",
                       event_id=f"{alert_id}:inspection")
        if queued:
            self.log_event("Notification queued", tool, detail=f"{self.destination_label('kafka')} · {ACTION_INSPECTION}",
                           event_id=f'{event["eventId"]}:kafka:queued')
        return inspection

    def request_second_run(self, alert_id):
        """Operator chose "second run" after seeing the inspection result: notify Kafka (second_run) once."""
        now = datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            inspection = self.get_inspection(db, alert_id)
            if inspection is None:
                raise HTTPException(404, "Unknown inspection")
            if inspection["status"] == "second_run_requested":
                return inspection
            if inspection["status"] != "result_ready":
                raise HTTPException(409, "No inspection image to act on")
            inspection["status"] = "second_run_requested"
            db.execute("UPDATE inspections SET body=? WHERE alert_id=?", (json.dumps(inspection), alert_id))
            event = self.kafka_event(ACTION_SECOND_RUN, alert_id, inspection["machineId"], inspection["toolNo"], now)
            queued = self.queue_kafka(db, event)
        self.log_event("Second run requested", inspection["toolNo"], event_id=f'{alert_id}:second_run')
        if queued:
            self.log_event("Notification queued", inspection["toolNo"],
                           detail=f"{self.destination_label('kafka')} · {ACTION_SECOND_RUN}",
                           event_id=f'{event["eventId"]}:kafka:queued')
        return inspection

    def dismiss_inspection(self, alert_id):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            inspection = self.get_inspection(db, alert_id)
            if inspection is None:
                raise HTTPException(404, "Unknown inspection")
            if inspection["status"] in INSPECTION_OPEN:
                inspection["status"] = "dismissed"
                db.execute("UPDATE inspections SET body=? WHERE alert_id=?", (json.dumps(inspection), alert_id))
        return inspection

    def simulate_wear(self, alert_id, values: WearValues):
        """Demo: inject the controller's new wear values for a waiting inspection (same path as a real controller row)."""
        with closing(sqlite3.connect(self.path)) as db:
            inspection = self.get_inspection(db, alert_id)
        if inspection is None:
            raise HTTPException(404, "Unknown inspection")
        if inspection["status"] == "superseded" or inspection.get("result") is not None:
            raise HTTPException(409, "Inspection is not waiting for wear values")
        tool = normalize_nc(inspection["toolNo"])
        self.on_wear(tool, values.diameter, values.length, datetime.now(timezone.utc).isoformat())
        self.notify_listeners()
        with closing(sqlite3.connect(self.path)) as db:
            return self.get_inspection(db, alert_id)

    def record_qc(self, row):
        """A new row in NC 91–93: retain this demo's first valid macro measurement."""
        if not self.settings.tool_wear_demo_enabled:
            return
        value = qc_from_row(row)
        if value is None:
            logger.info("NC line %s: no valid macro %s value, last QC unchanged", row.get(NC_LINE_FIELD), QC_MACRO)
            self.log_event("QC not available", TOOL_NO, detail=f"NC line {row.get(NC_LINE_FIELD)} · macro {QC_MACRO} missing or invalid")
            return
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM last_qc WHERE id=1").fetchone():
                return  # one quality measurement per demo; Reset clears it
            qc = {"value": value, "timestampUtc": row["timestamp"], "machineId": self.settings.signals_machine_id,
                  "toolNo": row.get("tool_no"), "macro": QC_MACRO}
            prediction = db.execute("SELECT body FROM predictions WHERE json_extract(body, '$.run')=2 ORDER BY seq DESC LIMIT 1").fetchone()
            qc["predictionId"] = json.loads(prediction[0])["predictionId"] if prediction else None
            qc.update(quality_measurement(value))
            db.execute("INSERT OR REPLACE INTO last_qc VALUES (1, ?)", (json.dumps(qc),))
        detail = f"Diameter {round(value, 6)} mm · macro {QC_MACRO}"
        logger.info("NC line %s: last QC (macro %s) = %s mm", row.get(NC_LINE_FIELD), QC_MACRO, value)
        self.log_event("QC measured", TOOL_NO, detail=detail)
        self.notify_listeners()

    def start_auto_prediction(self, previous, current, kind="start"):
        """NC-triggered prediction only; no timer-based fallback."""
        now = time.monotonic()
        first_run_end = kind == "start" and current in ("22", "29")
        if first_run_end and (self.first_run_prediction_started or self.cutting["run"] != 1):
            logger.info("NC line %s ignored: first-run prediction already handled", current)
            return
        if not self.settings.tool_wear_demo_enabled or self.prediction_running:
            logger.info("NC line %s trigger ignored %s -> %s (%s)", kind, previous, current,
                        "demo disabled" if not self.settings.tool_wear_demo_enabled else "prediction running")
            return
        if self.nc_last_trigger is not None and now - self.nc_last_trigger < NC_COOLDOWN_S:
            logger.info("NC line %s trigger ignored (cooldown) %s -> %s", kind, previous, current)
            return
        self.nc_last_trigger = now
        if first_run_end:
            self.first_run_prediction_started = True
        self.nc["lastTriggerAt"] = datetime.now(timezone.utc).isoformat()
        detail = f"NC line {previous if previous is not None else 'null'} → {current}"
        logger.info("NC line %s -> %s (%s): starting prediction", previous, current, kind)
        task = asyncio.create_task(self.run_prediction(MockPrediction(), detail=detail))
        self.background.add(task)
        task.add_done_callback(self.background.discard)

    async def run_prediction(self, values: MockPrediction, detail="Mock prediction"):
        """Manual and automatic triggers share this flow: events, prediction, alerts and notifications."""
        self.prediction_running = True
        second_run = self.cutting["alertId"] if self.cutting["run"] == 2 else None
        try:
            self.log_event("Prediction started", TOOL_NO, detail=detail)
            if self.PREDICTION_DELAY_S > 0:
                await asyncio.sleep(self.PREDICTION_DELAY_S)
            result = await asyncio.to_thread(self.record, values)
            self.log_prediction_results(result)
            if second_run is not None and self.cutting["alertId"] == second_run:
                self.cancel_cutting_timer()
                self.cutting = {**self.cutting, "status": "finished"}
            self.notify_listeners()
            return result
        finally:
            self.prediction_running = False

    def log_prediction_results(self, result):
        service = self
        prediction = result["prediction"]
        service.log_event("Prediction completed", TOOL_NO, timestamp=prediction["timestampUtc"],
                          detail=f'#{prediction["index"]} · Diameter {prediction["diameter"]} mm · Length {prediction["length"]} mm · {QUALITY_BALLOON_CODE} {prediction["quality"]} mm')
        alert = result["alert"]
        if alert:
            detail = " · ".join(
                f'{metric.capitalize()} {prediction[metric]} mm > {alert["thresholds"][metric]} mm'
                for metric in alert["metrics"]
            )
            service.log_event("Alert triggered", TOOL_NO, timestamp=alert["timestampUtc"],
                              detail=detail, event_id=f'{alert["alertId"]}:alert')
            for destination in service.alert_destinations:
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
        self.cutting = {"run": 1, "status": "waiting", "alertId": None}
        now = datetime.now(timezone.utc)
        self.first_run_prediction_started = False
        machine = self.settings.signals_machine_id
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            for table in ("predictions", "alerts", "outbox", "last_qc", "inspections", "demo_tool_measurement", "deferred_tasks", "kafka_receipts"):
                db.execute(f"DELETE FROM {table}")
            db.execute("INSERT OR REPLACE INTO history_clock VALUES (1, ?)", (now.isoformat(),))
            for i, (diameter, length, quality) in enumerate(PREDICTION_SERIES[:RESET_RECORDS]):
                stamp = history_timestamp(now, i + 1)
                prediction = {"predictionId": str(uuid4()), "machineId": machine, "toolNo": TOOL_NO,
                              "timestampUtc": stamp, "source": "mock", "index": i + 1,
                              "diameter": diameter, "length": length,
                              "balloonId": QUALITY_BALLOON_ID, "quality": quality, "exceeded": []}
                prediction["measured"] = HISTORICAL_WEAR_MEASUREMENTS.get(i + 1)
                prediction["qcValue"] = B9_QUALITY_MEASUREMENTS.get(i + 1)
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
            prediction["run"] = self.cutting["run"]
            prediction["measured"] = HISTORICAL_WEAR_MEASUREMENTS.get(position + 1)
            prediction["qcValue"] = B9_QUALITY_MEASUREMENTS.get(position + 1)
            if prediction["run"] == 2:
                qc_row = db.execute("SELECT body FROM last_qc WHERE id=1").fetchone()
                if qc_row:
                    qc = json.loads(qc_row[0])
                    if not qc.get("predictionId"):
                        qc["predictionId"] = prediction["predictionId"]
                        qc.update(quality_measurement(qc.get("rawValue", qc["value"])))
                        db.execute("UPDATE last_qc SET body=? WHERE id=1", (json.dumps(qc),))
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
                for destination in self.alert_destinations:
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
                action = event.get("action", ACTION_INSPECTION)
                result = await producer.send_and_wait(
                    topic, key=event_key(event).encode(), value=json.dumps(event).encode(),
                    headers=[("schemaVersion", event.get("schemaVersion", "1.0.0").encode()),
                             ("contentType", b"application/json"), ("action", action.encode())],
                )
            self.log_event("Notification sent", event["toolNo"], detail=f"Kafka · {topic} · {action}",
                           event_id=f'{event_key(event)}:kafka')
            try:
                self.kafka_receipts.track(event, topic, result.partition, result.offset)
            except Exception:
                logger.exception("Kafka publish succeeded but consumption tracking could not be saved eventId=%s", event_key(event))
                try:
                    self.log_event("Kafka consumption tracking unavailable", event["toolNo"],
                                   detail=f"eventId={event_key(event)} · could not save tracking record; publish succeeded")
                except Exception:
                    logger.exception("Could not log Kafka tracking failure")
            logger.info("Tool wear notification published to Kafka action=%s alertId=%s eventId=%s topic=%s partition=%s offset=%s",
                        action, event["alertId"], event_key(event), topic, result.partition, result.offset)
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
        key, now = (event_key(event), destination), time.monotonic()
        last = self.last_failure_event.get(key)
        if last is None or now - last >= FAILURE_EVENT_INTERVAL_S:
            self.last_failure_event[key] = now
            self.log_event("Notification failed", event["toolNo"],
                           detail=f"{self.destination_label(destination)} · {type(exc).__name__} · attempt {attempts + 1}")

    def expire_outbox(self, db, destination):
        """Drop pending notifications older than `tool_wear_alert_expire_seconds` (0 = keep forever).

        A stale alert is not worth sending (e.g. a robot trigger long after the event), so a destination that was
        down for a while does not replay its whole backlog when it comes back. One event per sweep is logged.
        """
        limit = self.settings.tool_wear_alert_expire_seconds
        if limit <= 0:
            return
        now = datetime.now(timezone.utc)
        expired = []
        for seq, body in db.execute("SELECT seq, body FROM outbox WHERE destination=?", (destination,)).fetchall():
            event = json.loads(body)
            try:
                age = (now - datetime.fromisoformat(event["timestampUtc"])).total_seconds()
            except (KeyError, TypeError, ValueError):
                continue
            if age > limit:
                expired.append((seq, event))
        if not expired:
            return
        with db:
            db.executemany("DELETE FROM outbox WHERE seq=?", [(seq,) for seq, _ in expired])
        for _, event in expired:
            self.last_failure_event.pop((event_key(event), destination), None)
        logger.warning("Tool wear alert notifications expired destination=%s count=%s older_than=%ss",
                       destination, len(expired), limit)
        self.log_event("Notification expired", expired[0][1]["toolNo"],
                       detail=f"{self.destination_label(destination)} · {len(expired)} older than {limit / 60:g} min, dropped")

    async def deliver(self, destination):
        with closing(sqlite3.connect(self.path)) as db:
            while True:
                self.expire_outbox(db, destination)
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
                    self.last_failure_event.pop((event_key(event), destination), None)
                    with db:
                        db.execute("DELETE FROM outbox WHERE seq=?", (seq,))

    @property
    def alert_destinations(self):
        """Destinations notified when an alert fires: Kafka is not among them, it only hears about operator actions."""
        return [name for name in self.destinations if name != "kafka"]

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
        if self.settings.tool_wear_alert_kafka_enabled:
            self.tasks.append(asyncio.create_task(self.kafka_receipts.run()))

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
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            # A capture can complete only the newest waiting inspection for its machine/tool.
            for seq, body in db.execute("SELECT seq, body FROM inspections ORDER BY seq DESC").fetchall():
                inspection = json.loads(body)
                if (inspection["status"] != "awaiting_result" or inspection.get("image") is not None
                        or image["machineId"] != inspection["machineId"]
                        or tool_key(image["toolNo"]) != tool_key(inspection["toolNo"])):
                    continue
                if datetime.fromisoformat(image["receivedAt"].replace("Z", "+00:00")) <= datetime.fromisoformat(inspection["confirmedAt"]):
                    continue
                inspection["image"] = {"captureId": image["captureId"], "receivedAt": image["receivedAt"]}
                inspection["status"] = "result_ready"
                db.execute("UPDATE inspections SET body=? WHERE seq=?", (json.dumps(inspection), seq))
                break
        self.notify_listeners()

    async def close(self):
        cutting_task = self.cutting_task
        self.cancel_cutting_timer()
        if cutting_task is not None:
            await asyncio.gather(cutting_task, return_exceptions=True)
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


@router.post("/alerts/{alert_id}/inspection")
async def confirm_inspection(request: Request, alert_id: str):
    service = enabled_service(request)
    result = await asyncio.to_thread(service.start_inspection, alert_id)
    service.notify_listeners()
    return result


@router.post("/inspections/{alert_id}/second-run")
async def second_run(request: Request, alert_id: str):
    service = enabled_service(request)
    result = await asyncio.to_thread(service.request_second_run, alert_id)
    service.arm_second_cutting(alert_id)
    service.notify_listeners()
    return result


@router.post("/tasks/{task_id}/defer")
async def defer_task(request: Request, task_id: str):
    service = enabled_service(request)
    result = await asyncio.to_thread(service.defer_task, task_id)
    service.notify_listeners()
    return result


@router.post("/inspections/{alert_id}/dismiss")
async def dismiss_inspection(request: Request, alert_id: str):
    service = enabled_service(request)
    result = await asyncio.to_thread(service.dismiss_inspection, alert_id)
    service.notify_listeners()
    return result


@router.post("/inspections/{alert_id}/simulate-wear")
async def simulate_wear(request: Request, alert_id: str, values: WearValues):
    return await asyncio.to_thread(enabled_service(request).simulate_wear, alert_id, values)


@router.post("/reset")
async def reset(request: Request):
    service = enabled_service(request)
    service.cancel_cutting_timer()
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
