"""Read-only consumer commit tracking. A commit is not a machine execution ACK."""
import asyncio
import json
import sqlite3
import time
from contextlib import closing

from aiokafka.admin import AIOKafkaAdminClient
from aiokafka.structs import TopicPartition


class KafkaReceiptTracker:
    def __init__(self, settings, path, log_event, admin_factory=AIOKafkaAdminClient):
        self.settings, self.path, self.log_event = settings, path, log_event
        self.admin_factory = admin_factory
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("""CREATE TABLE IF NOT EXISTS kafka_receipts (
                id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL,
                published REAL NOT NULL, deadline REAL NOT NULL, next_check REAL NOT NULL,
                last_log REAL NOT NULL, check_state TEXT NOT NULL DEFAULT ''
            )""")

    def track(self, event, topic, partition, offset):
        now = time.time()
        event_id = event.get("eventId") or event["alertId"]
        receipt_id = f"{event_id}:{topic}:{partition}:{offset}"
        group = self.settings.tool_wear_alert_consumer_group.strip()
        body = {"eventId": event_id, "alertId": event["alertId"], "action": event.get("action", "inspection"),
                "toolNo": event["toolNo"], "topic": topic, "partition": partition, "offset": offset, "group": group}
        with closing(sqlite3.connect(self.path)) as db, db:
            inserted = db.execute("INSERT OR IGNORE INTO kafka_receipts VALUES (?, ?, ?, ?, ?, ?, ?, '')",
                                  (receipt_id, json.dumps(body), "pending" if group else "unconfigured", now,
                                   now + self.settings.tool_wear_alert_consume_timeout_seconds,
                                   now + self.settings.tool_wear_alert_consume_check_seconds, now)).rowcount
        if inserted and not group:
            self.log_event("Kafka consumption tracking unavailable", body["toolNo"],
                           detail=f'{body["action"]} · eventId={event_id} · target consumer group is not configured',
                           event_id=f"{receipt_id}:unconfigured")

    def update(self, receipt_id, body, now, *, status="pending", state="waiting", label=None, detail=""):
        # Conditional update prevents a late query from recreating a receipt cleared by Reset.
        with closing(sqlite3.connect(self.path)) as db, db:
            changed = db.execute("""UPDATE kafka_receipts SET status=?, next_check=?, check_state=?,
                last_log=CASE WHEN ? THEN ? ELSE last_log END WHERE id=? AND status='pending'""",
                                 (status, now + self.settings.tool_wear_alert_consume_check_seconds, state,
                                  bool(label), now, receipt_id)).rowcount
        if changed and label:
            self.log_event(label, body["toolNo"],
                           detail=f'{body["action"]} · eventId={body["eventId"]} · group={body["group"]} · '
                                  f'{body["topic"]}[{body["partition"]}] offset={body["offset"]} · {detail}',
                           event_id=f"{receipt_id}:{state}:{now}")

    async def check_once(self, admin=None):
        now = time.time()
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute("SELECT id, body, published, deadline, last_log, check_state FROM kafka_receipts "
                              "WHERE status='pending' AND (next_check<=? OR deadline<=?)", (now, now)).fetchall()
        due = []
        for receipt_id, encoded, published, deadline, last_log, previous_state in rows:
            body = json.loads(encoded)
            if now >= deadline:
                self.update(receipt_id, body, now, status="timed_out", state="timeout",
                            label="Consumption confirmation timed out", detail="No commit confirmation before deadline; no automatic resend")
            else:
                due.append((receipt_id, body, published, last_log, previous_state))
        if not due:
            return
        owned, client = admin is None, admin
        try:
            if owned:
                client = self.admin_factory(bootstrap_servers=self.settings.microscope_kafka_bootstrap_servers,
                                            client_id="pqm-cnc-consumption-check", request_timeout_ms=5000)
                async with asyncio.timeout(5):
                    await client.start()
            # One read-only query per group for all due messages, never join a consumer group or fetch records.
            groups = {body["group"] for _, body, *_ in due}
            offsets, failures = {}, {}
            for group in groups:
                partitions = list({TopicPartition(body["topic"], body["partition"])
                                   for _, body, *_ in due if body["group"] == group})
                try:
                    async with asyncio.timeout(5):
                        offsets[group] = await client.list_consumer_group_offsets(group, partitions=partitions)
                except Exception as exc:
                    failures[group] = type(exc).__name__
        except Exception as exc:
            offsets, failures = {}, {body["group"]: type(exc).__name__ for _, body, *_ in due}
        finally:
            if owned and client is not None:
                try:
                    async with asyncio.timeout(5):
                        await client.close()
                except Exception:
                    pass
        for receipt_id, body, published, last_log, previous_state in due:
            checked = time.time()
            offset = offsets.get(body["group"], {}).get(TopicPartition(body["topic"], body["partition"]))
            committed = offset.offset if offset is not None else -1
            error = failures.get(body["group"])
            state = f"error:{error}" if error else "missing" if committed < 0 else "committed" if committed > body["offset"] else "waiting"
            label = None
            if state == "committed":
                label = "Consumer offset committed"
            elif (state != previous_state and state != "waiting") or checked - last_log >= self.settings.tool_wear_alert_consume_log_seconds:
                label = "Awaiting consumer commit" if state == "waiting" else "Consumer commit check unavailable"
            self.update(receipt_id, body, checked, status="committed" if state == "committed" else "pending",
                        state=state, label=label,
                        detail=f'elapsed={int(checked - published)}s · ' + (f"query failed: {error}" if error else
                               "no committed offset" if committed < 0 else f"committed offset={committed}; this is not an execution ACK"))

    async def run(self):
        while True:
            try:
                await self.check_once()
            except Exception as exc:
                # Monitoring failure must never requeue a machine command or stop delivery.
                self.log_event("Kafka consumption monitor error", None, detail=type(exc).__name__)
            await asyncio.sleep(self.settings.tool_wear_alert_consume_check_seconds)
