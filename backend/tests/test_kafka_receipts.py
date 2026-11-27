import asyncio
import json
import sqlite3
from contextlib import closing
from types import SimpleNamespace

import pytest
from aiokafka.structs import TopicPartition

from app.config import Settings
from app.kafka_receipts import KafkaReceiptTracker
from app.wear_alerts import WearAlerts


@pytest.fixture
def setup(tmp_path, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("app.kafka_receipts.time.time", lambda: clock[0])
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path), tool_wear_alert_consumer_group="nuc-jobs")
    events = []
    tracker = KafkaReceiptTracker(settings, tmp_path / "receipts.sqlite3",
                                  lambda label, tool, **kw: events.append({"label": label, "tool": tool, **kw}))
    return tracker, clock, events


def track(tracker, event_id="e1", offset=7, partition=0, action="inspection"):
    tracker.track({"eventId": event_id, "alertId": "a1", "toolNo": "25", "action": action}, "commands", partition, offset)


def rows(tracker):
    with closing(sqlite3.connect(tracker.path)) as db:
        return db.execute("SELECT id, status, published, deadline, body FROM kafka_receipts ORDER BY id").fetchall()


class Admin:
    def __init__(self, offsets=None):
        self.offsets = offsets or {}
        self.error = None
        self.calls = []

    async def list_consumer_group_offsets(self, group, partitions):
        self.calls.append((group, partitions))
        if self.error:
            raise self.error
        return self.offsets


def test_check_interval_log_interval_and_commit_must_be_strictly_greater(setup):
    tracker, clock, events = setup
    track(tracker)
    admin = Admin({TopicPartition("commands", 0): SimpleNamespace(offset=7)})

    async def run():
        clock[0] = 1009
        await tracker.check_once(admin)
        assert admin.calls == []
        clock[0] = 1010
        await tracker.check_once(admin)
        assert rows(tracker)[0][1] == "pending" and events == []
        clock[0] = 1030
        await tracker.check_once(admin)
        assert events[-1]["label"] == "Awaiting consumer commit"
        clock[0] = 1040
        admin.offsets[TopicPartition("commands", 0)] = SimpleNamespace(offset=8)
        await tracker.check_once(admin)
        assert rows(tracker)[0][1] == "committed"
        assert events[-1]["label"] == "Consumer offset committed"
        assert "not an execution ACK" in events[-1]["detail"]
        calls = len(admin.calls)
        clock[0] = 1200
        await tracker.check_once(admin)
        assert len(admin.calls) == calls
    asyncio.run(run())


def test_missing_offsets_query_errors_and_deadline_are_distinct(setup):
    tracker, clock, events = setup
    track(tracker)
    admin = Admin()

    async def run():
        clock[0] = 1010
        await tracker.check_once(admin)
        assert events[-1]["label"] == "Consumer commit check unavailable"
        assert "no committed offset" in events[-1]["detail"]
        clock[0] = 1020
        await tracker.check_once(admin)
        assert len(events) == 1
        clock[0] = 1030
        admin.error = ConnectionError("private error text")
        await tracker.check_once(admin)
        assert "query failed: ConnectionError" in events[-1]["detail"]
        assert "private error text" not in events[-1]["detail"]
        assert rows(tracker)[0][1] == "pending"
        clock[0] = 1300
        calls = len(admin.calls)
        await tracker.check_once(admin)
        assert rows(tracker)[0][1] == "timed_out"
        assert events[-1]["label"] == "Consumption confirmation timed out"
        assert len(admin.calls) == calls  # timeout never publishes or queries again
    asyncio.run(run())


def test_both_actions_partition_isolation_and_one_query_per_group(setup):
    tracker, clock, events = setup
    track(tracker)
    track(tracker)  # same published receipt is not duplicated
    track(tracker, "e2", partition=1, action="second_run")
    track(tracker, "e1", offset=8)  # a physical duplicate at another offset remains independently traceable
    admin = Admin({TopicPartition("commands", 0): SimpleNamespace(offset=8),
                   TopicPartition("commands", 1): SimpleNamespace(offset=-1)})
    clock[0] = 1010
    asyncio.run(tracker.check_once(admin))
    assert len(rows(tracker)) == 3 and [row[1] for row in rows(tracker)] == ["committed", "pending", "pending"]
    assert len(admin.calls) == 1 and admin.calls[0][0] == "nuc-jobs"
    assert set(admin.calls[0][1]) == {TopicPartition("commands", 0), TopicPartition("commands", 1)}
    assert any("second_run" in event["detail"] for event in events)


def test_restart_preserves_group_offset_and_original_deadline(setup):
    tracker, clock, events = setup
    track(tracker)
    clock[0] = 1200
    restarted = KafkaReceiptTracker(tracker.settings, tracker.path, tracker.log_event)
    assert rows(restarted)[0][2:4] == (1000, 1300)
    body = json.loads(rows(restarted)[0][4])
    assert (body["group"], body["offset"]) == ("nuc-jobs", 7)
    asyncio.run(restarted.check_once(Admin({TopicPartition("commands", 0): SimpleNamespace(offset=8)})))
    assert rows(restarted)[0][1] == "committed"


def test_unconfigured_group_is_explicit_and_does_not_query(setup):
    tracker, clock, events = setup
    tracker.settings.tool_wear_alert_consumer_group = " "
    track(tracker)
    assert rows(tracker)[0][1] == "unconfigured"
    assert events[-1]["label"] == "Kafka consumption tracking unavailable"
    clock[0] = 1010
    admin = Admin()
    asyncio.run(tracker.check_once(admin))
    assert admin.calls == []


def test_admin_start_failure_is_logged_and_client_is_closed(setup):
    tracker, clock, events = setup
    closed = []

    class BrokenAdmin:
        def __init__(self, **options):
            assert options["client_id"] == "pqm-cnc-consumption-check"

        async def start(self):
            raise ConnectionError()

        async def close(self):
            closed.append(True)

    tracker.admin_factory = BrokenAdmin
    track(tracker)
    clock[0] = 1010
    asyncio.run(tracker.check_once())
    assert closed == [True] and rows(tracker)[0][1] == "pending"
    assert events[-1]["label"] == "Consumer commit check unavailable"


def test_reset_during_query_does_not_recreate_receipt_or_emit_late_confirmation(setup):
    tracker, clock, events = setup
    track(tracker)

    async def run():
        started, release = asyncio.Event(), asyncio.Event()

        class SlowAdmin:
            async def list_consumer_group_offsets(self, group, partitions):
                started.set()
                await release.wait()
                return {TopicPartition("commands", 0): SimpleNamespace(offset=8)}

        clock[0] = 1010
        task = asyncio.create_task(tracker.check_once(SlowAdmin()))
        await started.wait()
        with closing(sqlite3.connect(tracker.path)) as db, db:
            db.execute("DELETE FROM kafka_receipts")
        release.set()
        await task
        assert rows(tracker) == [] and events == []
    asyncio.run(run())


def test_successful_publish_is_not_retried_if_tracking_fails(tmp_path, monkeypatch):
    sent = []

    class Producer:
        def __init__(self, **options): pass
        async def start(self): pass
        async def stop(self): pass
        async def send_and_wait(self, *args, **kw):
            sent.append(kw)
            return SimpleNamespace(partition=0, offset=7)

    monkeypatch.setattr("app.wear_alerts.AIOKafkaProducer", Producer)
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path))
    service = WearAlerts(settings)
    monkeypatch.setattr(service.kafka_receipts, "track", lambda *args: (_ for _ in ()).throw(RuntimeError()))
    asyncio.run(service.publish({"eventId": "e1", "alertId": "a1", "toolNo": "25", "action": "inspection"}))
    assert len(sent) == 1
    assert service.snapshot()["events"][-1]["label"] == "Kafka consumption tracking unavailable"


def test_monitor_runs_with_backend_lifecycle_and_reset_clears_receipts(tmp_path, monkeypatch):
    async def run():
        settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path), tool_wear_alert_kafka_enabled=True,
                            tool_wear_alert_consumer_group="nuc-jobs")
        service = WearAlerts(settings)
        track(service.kafka_receipts)
        assert rows(service.kafka_receipts)[0][1] == "pending"
        service.reset()
        assert rows(service.kafka_receipts) == []
        started, stopped = asyncio.Event(), asyncio.Event()

        async def monitor():
            started.set()
            try:
                await asyncio.Future()
            finally:
                stopped.set()

        monkeypatch.setattr(service.kafka_receipts, "run", monitor)
        service.start()
        await asyncio.wait_for(started.wait(), 1)
        await service.close()
        assert stopped.is_set() and all(task.done() for task in service.tasks)
    asyncio.run(run())
