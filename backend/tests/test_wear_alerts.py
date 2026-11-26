import asyncio
from datetime import datetime, timedelta, timezone
import json
import httpx
import sqlite3
import pytest
from contextlib import closing
from types import SimpleNamespace

from fastapi import HTTPException

from app import wear_alerts
from app.config import Settings
from app.wear_alerts import MockPrediction, QualitySpec, WearAlerts, WearValues, mock_prediction
from app.wear_series import PREDICTION_SERIES


def make_service(tmp_path):
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path),
                        tool_wear_demo_enabled=True, tool_wear_alert_kafka_enabled=True,
                        tool_wear_alert_temi_enabled=False)
    return settings, WearAlerts(settings)


def test_first_cutting_reads_initial_window_and_finishes_at_29(tmp_path):
    _, service = make_service(tmp_path)
    machine = service.settings.signals_machine_id
    state = {}
    service.on_signals(machine, {"process": [{"timestamp": "2026-11-25T00:00:01Z", "nc_line": 5}]}, state)
    assert service.snapshot()["cutting"] == {"run": 1, "status": "cutting", "alertId": None}
    assert service.update_first_cutting("29")
    assert service.snapshot()["cutting"]["status"] == "finished"
    assert not service.update_first_cutting("1")
    service.reset()
    assert service.update_first_cutting("5")
    assert service.update_first_cutting("22")
    assert service.snapshot()["cutting"]["status"] == "finished"
    assert not service.update_first_cutting("29")
    service.reset()
    service.on_signals(machine, {"process": [
        {"timestamp": "2026-11-25T00:00:01Z", "nc_line": 1},
        {"timestamp": "2026-11-25T00:00:02Z", "nc_line": 29},
    ]}, {})
    assert service.snapshot()["cutting"]["status"] == "finished"


def test_second_cutting_delays_then_finishes_on_range_prediction(tmp_path):
    async def run():
        settings, service = make_service(tmp_path)
        settings.tool_wear_second_run_cutting_delay_seconds = 0
        alert = make_alert(service)
        confirm(service, alert)
        service.simulate_wear(alert["alertId"], WearValues(diameter=0.08, length=0.03))
        receive_photo(service)
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(wear_alerts=service)))
        await wear_alerts.second_run(request, alert["alertId"])
        timer = service.cutting_task
        assert service.cutting["status"] == "pending"
        await timer
        assert service.cutting["status"] == "cutting"
        await wear_alerts.second_run(request, alert["alertId"])
        assert service.cutting_task is timer  # repeated confirmation does not restart the delay
        assert not service.update_first_cutting("29")
        service.start_auto_prediction("72", "73", "range")
        await asyncio.gather(*service.background)
        assert service.cutting["status"] == "finished"
        await service.close()
    asyncio.run(run())


def test_second_prediction_before_delay_cancels_cutting_and_reset_clears_state(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.arm_second_cutting("a")
        timer = service.cutting_task
        await service.run_prediction(MockPrediction())
        await asyncio.gather(timer, return_exceptions=True)
        assert timer.cancelled() and service.cutting["status"] == "finished"
        service.arm_second_cutting("a")
        assert service.cutting_task is None  # late duplicate must not turn purple again
        service.arm_second_cutting("b")
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(wear_alerts=service)))
        await wear_alerts.reset(request)
        assert service.cutting == {"run": 1, "status": "waiting", "alertId": None}
        assert service.cutting_task is None
        service.arm_second_cutting("c")
        timer = service.cutting_task
        await service.close()
        assert timer.done()
    asyncio.run(run())


def confirm(service, alert):
    """The operator chose "Yes, laser inspection" for this alert (this is what queues the Kafka notification)."""
    return service.start_inspection(alert["alertId"])


def receive_photo(service, **overrides):
    inspection = service.snapshot()["inspection"]
    image = {"captureId": f'photo-{inspection["alertId"]}', "machineId": inspection["machineId"],
             "toolNo": inspection["toolNo"],
             "receivedAt": (datetime.fromisoformat(inspection["confirmedAt"]) + timedelta(milliseconds=1)).isoformat()}
    service.log_photo({**image, **overrides})
    return image


def test_deferred_tasks_persist_and_complete_once_without_sending_when_deferred(tmp_path):
    settings, service = make_service(tmp_path)
    alert = make_alert(service)
    task = service.snapshot()["tasks"][0]
    assert task["id"] == f'inspection:{alert["alertId"]}' and not task["deferred"]
    before = outbox(service)
    service.defer_task(task["id"])
    service.defer_task(task["id"])
    assert outbox(service) == before  # postponing is never a machine command
    other_client = WearAlerts(settings)
    assert other_client.snapshot()["tasks"][0]["deferred"]
    other_client.start_inspection(alert["alertId"])
    service.start_inspection(alert["alertId"])
    assert service.snapshot()["tasks"] == []
    assert len(outbox(service)) == len(before) + 1
    receive_photo(service)
    rework = other_client.snapshot()["tasks"][0]
    assert rework["kind"] == "rework" and rework["inspection"]["result"] is None
    service.defer_task(rework["id"])
    assert other_client.snapshot()["tasks"][0]["deferred"]
    service.on_wear("25", 0.08, 0.03, "2026-11-26T01:00:00Z")
    assert other_client.snapshot()["tasks"][0]["inspection"]["result"]["actual"]["diameter"] == 0.08
    service.request_second_run(alert["alertId"])
    other_client.request_second_run(alert["alertId"])
    assert other_client.snapshot()["tasks"] == []
    assert len(outbox(service)) == len(before) + 2
    with pytest.raises(HTTPException) as error:
        service.defer_task(rework["id"])
    assert error.value.status_code == 409
    service.reset()
    assert other_client.snapshot()["tasks"] == []
    with closing(sqlite3.connect(service.path)) as db:
        assert db.execute("SELECT COUNT(*) FROM deferred_tasks").fetchone()[0] == 0


def test_task_list_includes_old_alerts_and_excludes_superseded_inspections(tmp_path):
    _, service = make_service(tmp_path)
    alerts = [make_alert(service) for _ in range(22)]
    assert len(service.snapshot()["tasks"]) == 22  # not truncated by the snapshot's 20-alert limit
    confirm(service, alerts[0])
    receive_photo(service)
    rework_id = f'rework:{alerts[0]["alertId"]}'
    service.defer_task(rework_id)
    confirm(service, alerts[1])
    assert rework_id not in {task["id"] for task in service.snapshot()["tasks"]}


def test_no_prediction_timer_after_first_run_end(tmp_path, monkeypatch):
    async def run():
        _, service = make_service(tmp_path)
        monkeypatch.setattr(wear_alerts, "NC_COOLDOWN_S", 0)
        state, machine = {}, service.settings.signals_machine_id
        service.on_signals(machine, batch((1, 5)), state)
        service.on_signals(machine, batch((2, 22)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1
        assert not hasattr(service, "nc_fallback")
        assert "fallbackSeconds" not in service.snapshot()["ncWatch"]
        service.on_signals(machine, batch((3, 50)), state)
        await asyncio.sleep(0)
        assert len(service.snapshot()["history"]) == 1
        service.on_signals(machine, batch((4, 73)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 2
        await service.close()
    asyncio.run(run())


def test_image_first_opens_popup_and_wear_can_arrive_after_rework(tmp_path):
    _, service = make_service(tmp_path)
    alert = make_alert(service)
    confirmation = confirm(service, alert)
    receive_photo(service, receivedAt=confirmation["confirmedAt"], captureId="old")
    receive_photo(service, machineId="other", captureId="wrong-machine")
    receive_photo(service, toolNo="167", captureId="wrong-tool")
    assert service.snapshot()["inspection"]["status"] == "awaiting_result"
    image = receive_photo(service, toolNo="025")
    ready = service.snapshot()["inspection"]
    assert ready["status"] == "result_ready" and ready["result"] is None
    assert ready["image"]["captureId"] == image["captureId"]
    service.request_second_run(alert["alertId"])
    receive_photo(service, captureId="duplicate-later")
    assert service.snapshot()["inspection"]["status"] == "second_run_requested"
    assert service.on_wear("25", 0.08, 0.03, "2026-11-26T01:00:00Z")
    snapshot = service.snapshot()
    assert snapshot["inspection"]["status"] == "second_run_requested"
    assert snapshot["inspection"]["result"]["actual"]["diameter"] == 0.08
    assert snapshot["toolMeasurement"]["diameter"] == 0.08
    assert WearAlerts(service.settings).snapshot()["inspection"]["image"] == ready["image"]


def test_finished_balloon_quality_history_is_all_within_default_tolerance(tmp_path):
    _, service = make_service(tmp_path)
    snapshot = service.snapshot()
    fixed = snapshot["fixedQualitySeries"]
    assert [point["index"] for point in fixed] == list(range(1, 11))
    assert all(17.9 <= point["quality"] <= 18.1 for point in fixed)
    assert fixed[-1]["quality"] == 18.0095
    assert snapshot["series"][-1]["quality"] == 18.15


def test_predictions_cycle_through_series_and_persist_cursor(tmp_path):
    settings, service = make_service(tmp_path)
    count = len(PREDICTION_SERIES)
    assert service.snapshot()["nextIndex"] == 1

    first = service.record(MockPrediction())["prediction"]
    assert (first["index"], first["toolNo"]) == (1, "25")
    assert (first["diameter"], first["length"], first["quality"]) == PREDICTION_SERIES[0]
    assert first["balloonId"] == "b9"

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
        assert db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] == 0  # Kafka hears nothing until the operator acts

    confirm(service, first)
    confirm(service, second)
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
    event = {"schemaVersion": "1.1.0", "eventType": "tool_wear_alert", "action": "second_run",
             "eventId": "event-1", "alertId": "test", "toolNo": "25"}
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
    assert sent == [(settings.tool_wear_alert_kafka_topic, b"event-1", event, {
        "schemaVersion": b"1.1.0", "contentType": b"application/json", "action": b"second_run",
    })]
    sent.clear()  # an event queued before schema 1.1.0 (no action, no eventId) is still an inspection request
    legacy = {"schemaVersion": "1.0.0", "eventType": "tool_wear_alert", "alertId": "old", "toolNo": "25"}
    asyncio.run(WearAlerts(settings).publish(legacy))
    assert sent == [(settings.tool_wear_alert_kafka_topic, b"old", legacy, {
        "schemaVersion": b"1.0.0", "contentType": b"application/json", "action": b"inspection",
    })]


def test_prediction_events_are_sent_in_order_and_persisted(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        service.PREDICTION_DELAY_S = 0.2  # a visible gap between "started" and the result
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
        # Persisted in the same order. Kafka is not notified at alert time, so there is no "queued" event here.
        assert [event["label"] for event in service.snapshot()["events"]] == [
            "Prediction started", "Prediction completed", "Alert triggered", "Quality alert triggered",
        ]

    asyncio.run(run())


def test_quality_alert_follows_the_stored_tolerance(tmp_path):
    settings, service = make_service(tmp_path)
    assert service.snapshot()["qualitySpec"] == {"nominal": 18, "upperTol": 0.1, "lowerTol": 0.1}
    # Default spec 18 ± 0.1 mm: #9 (18.0088) is fine, #10 (18.15) is above USL 18.1.
    assert service.record(MockPrediction(index=9))["qualityAlert"] is None
    alert = service.record(MockPrediction(index=10))["qualityAlert"]
    assert (alert["kind"], alert["balloonId"], alert["side"], alert["value"], alert["limit"]) == ("quality", "b9", "upper", 18.15, 18.1)

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
        assert service.snapshot()["ncWatch"]["triggerValues"] == ["22", "29"]

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

    asyncio.run(run())


@pytest.mark.parametrize("end,other", [(22, 29), (29, 22)])
def test_first_run_end_predicts_once_for_either_end_line(tmp_path, monkeypatch, end, other):
    async def run():
        monkeypatch.setattr(wear_alerts, "NC_COOLDOWN_S", 0)
        settings, service = make_service(tmp_path)
        machine, state = settings.signals_machine_id, {}
        service.on_signals(machine, batch((1, 5)), state)
        assert service.cutting["status"] == "cutting"
        service.on_signals(machine, batch((2, end)), state)
        await asyncio.gather(*service.background)
        assert service.cutting["status"] == "finished"
        assert len(service.snapshot()["history"]) == 1
        service.on_signals(machine, batch((3, other), (4, 20), (5, end)), state)
        await asyncio.gather(*service.background)
        assert len(service.snapshot()["history"]) == 1  # no duplicate, even with cooldown disabled
        service.reset()
        service.on_signals(machine, batch((6, 5), (7, end)), state)
        await asyncio.gather(*service.background)
        assert service.snapshot()["prediction"]["index"] == 9
        assert service.first_run_prediction_started
        await service.close()
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
        watch((31, 93, {"956": 18}))                       # one measurement per demo; later values do not replace it
        assert last_qc()["value"] == 18.012

        restarted = WearAlerts(service.settings)           # persisted
        assert restarted.snapshot()["lastQc"]["value"] == 18.012
        service.reset()
        assert service.snapshot()["lastQc"] is None        # Reset demo clears it

    asyncio.run(run())


def test_demo_measurements_persist_once_and_qc_waits_for_rework_prediction(tmp_path):
    async def run():
        _, service = make_service(tmp_path)
        alert = make_alert(service)
        confirm(service, alert)
        service.on_wear("25", 0.08, 0.03, "2026-11-26T01:00:00Z")
        measured = service.snapshot()["toolMeasurement"]
        assert (measured["diameter"], measured["length"]) == (0.08, 0.03)
        another = make_alert(service)
        confirm(service, another)
        service.on_wear("25", 0.09, 0.04, "2026-11-26T01:01:00Z")
        assert service.snapshot()["toolMeasurement"] == measured
        service.arm_second_cutting(another["alertId"])
        service.record_qc({"timestamp": "2026-11-26T01:02:00Z", "macros": {"956": 18.02}})
        assert service.snapshot()["lastQc"]["predictionId"] is None
        result = await service.run_prediction(MockPrediction(index=1))
        qc = service.snapshot()["lastQc"]
        assert qc["predictionId"] == result["prediction"]["predictionId"]
        service.record_qc({"timestamp": "2026-11-26T01:03:00Z", "macros": {"956": 18.03}})
        assert service.snapshot()["lastQc"] == qc
        restarted = WearAlerts(service.settings)
        assert restarted.snapshot()["lastQc"] == qc
        assert restarted.snapshot()["toolMeasurement"] == measured
        service.reset()
        assert service.snapshot()["lastQc"] is None and service.snapshot()["toolMeasurement"] is None
        await service.close()
    asyncio.run(run())


def test_out_of_spec_qc_is_shown_as_the_fixed_passing_value(tmp_path):
    async def run():
        settings, service = make_service(tmp_path)
        machine, state = settings.signals_machine_id, {}
        seconds = iter(range(1, 100))

        def measure(value):
            service.reset()  # each case is a separate demo, with one quality measurement
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


def test_prediction_delay_comes_from_the_setting(tmp_path):
    settings, service = make_service(tmp_path)
    assert settings.tool_wear_prediction_delay_seconds == 0 and service.PREDICTION_DELAY_S == 0  # default: immediate

    async def run(delay):
        settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path), tool_wear_demo_enabled=True,
                            tool_wear_prediction_delay_seconds=delay)
        service = WearAlerts(settings)
        started = asyncio.get_running_loop().time()
        await service.run_prediction(MockPrediction())
        return asyncio.get_running_loop().time() - started

    assert asyncio.run(run(0)) < 0.15
    assert asyncio.run(run(0.3)) >= 0.29


def test_stale_pending_notifications_expire_and_are_logged(tmp_path):
    settings, service = make_service(tmp_path)
    service.set_thresholds(WearValues(diameter=0.1, length=999))
    old, fresh = service.record(MockPrediction(index=10))["alert"], service.record(MockPrediction(index=10))["alert"]
    confirm(service, old), confirm(service, fresh)
    # Make the first notification 11 minutes old (limit: 10 minutes).
    with closing(sqlite3.connect(service.path)) as db, db:
        body, seq = db.execute("SELECT body, seq FROM outbox WHERE body LIKE ?", (f'%{old["alertId"]}%',)).fetchone()
        event = json.loads(body)
        event["timestampUtc"] = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()
        db.execute("UPDATE outbox SET body=? WHERE seq=?", (json.dumps(event), seq))
    assert settings.tool_wear_alert_expire_seconds == 600 and service.snapshot()["pendingNotifications"] == 2

    settings.tool_wear_alert_expire_seconds = 0                        # 0 = never expire
    with closing(sqlite3.connect(service.path)) as db:
        service.expire_outbox(db, "kafka")
    assert service.snapshot()["pendingNotifications"] == 2

    settings.tool_wear_alert_expire_seconds = 600
    with closing(sqlite3.connect(service.path)) as db:
        service.expire_outbox(db, "temi")                              # another destination's queue is not touched
        assert service.snapshot()["pendingNotifications"] == 2
        service.expire_outbox(db, "kafka")
    assert service.snapshot()["pendingNotifications"] == 1             # only the fresh one is left
    with closing(sqlite3.connect(service.path)) as db:
        assert fresh["alertId"] in db.execute("SELECT body FROM outbox").fetchone()[0]
    expired = [e for e in service.snapshot()["events"] if e["label"] == "Notification expired"]
    assert len(expired) == 1 and "Kafka" in expired[0]["detail"] and "1 older than 10 min" in expired[0]["detail"]

    with closing(sqlite3.connect(service.path)) as db:
        service.expire_outbox(db, "kafka")                             # nothing more to drop, no extra event
    assert len([e for e in service.snapshot()["events"] if e["label"] == "Notification expired"]) == 1


def test_the_delivery_loop_drops_expired_notifications_instead_of_sending_them(tmp_path):
    async def run():
        settings, service = make_service(tmp_path)
        service.set_thresholds(WearValues(diameter=0.1, length=999))
        alert = service.record(MockPrediction(index=10))["alert"]
        confirm(service, alert)
        with closing(sqlite3.connect(service.path)) as db, db:
            body, seq = db.execute("SELECT body, seq FROM outbox").fetchone()
            event = json.loads(body)
            event["timestampUtc"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
            db.execute("UPDATE outbox SET body=? WHERE seq=?", (json.dumps(event), seq))
        sent = []

        async def publish(event):
            sent.append(event["alertId"])
        service.publish = publish
        task = asyncio.create_task(service.deliver("kafka"))
        await asyncio.sleep(0.2)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert sent == [] and alert["alertId"]
        assert service.snapshot()["pendingNotifications"] == 0
        assert [e["label"] for e in service.snapshot()["events"]].count("Notification expired") == 1

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
    alert = service.record(MockPrediction(index=10))["alert"]
    assert service.snapshot()["pendingNotifications"] == 0
    confirm(service, alert)
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


# ---- laser inspection → result → second run -------------------------------------------------------------------

def make_alert(service, tool="25"):
    service.set_thresholds(WearValues(diameter=0.1, length=0.05))
    return service.record(MockPrediction(index=10))["alert"]  # diameter 0.35 and length 0.18: both above


def outbox(service):
    with closing(sqlite3.connect(service.path)) as db:
        return [(destination, json.loads(body)) for destination, body in db.execute("SELECT destination, body FROM outbox ORDER BY seq")]


def test_alert_only_notifies_temi_and_kafka_waits_for_the_operator(tmp_path):
    settings = Settings(_env_file=None, microscope_image_dir=str(tmp_path), tool_wear_demo_enabled=True,
                        tool_wear_alert_kafka_enabled=True, tool_wear_alert_temi_enabled=True,
                        tool_wear_alert_temi_url="http://temi.invalid/trigger")
    service = WearAlerts(settings)
    alert = make_alert(service)
    assert [destination for destination, _ in outbox(service)] == ["temi"]  # unchanged: Temi right after the alert

    inspection = confirm(service, alert)
    assert inspection["status"] == "awaiting_result"
    rows = outbox(service)
    assert [destination for destination, _ in rows] == ["temi", "kafka"]
    kafka = rows[1][1]
    assert (kafka["schemaVersion"], kafka["eventType"], kafka["action"]) == ("1.1.0", "tool_wear_alert", "inspection")
    assert (kafka["alertId"], kafka["machineId"], kafka["toolNo"], kafka["metrics"]) == (
        alert["alertId"], settings.signals_machine_id, "25", ["diameter", "length"])
    assert kafka["eventId"] and kafka["eventId"] != kafka["alertId"]

    confirm(service, alert)  # confirming twice does not queue a second message
    assert len(outbox(service)) == 2


def test_inspection_result_arrives_with_a_new_wear_value_then_second_run_is_sent_once(tmp_path):
    _, service = make_service(tmp_path)
    alert = make_alert(service)
    service.on_wear("25", 0.01, 0.02, "2026-11-19T01:00:00+00:00")  # seen before the inspection: the baseline
    inspection = confirm(service, alert)
    assert inspection["baseline"] == {"diameter": 0.01, "length": 0.02}

    # The same values again, another tool, or only one of the two values: still waiting.
    assert service.on_wear("25", 0.01, 0.02, "2026-11-19T01:00:01+00:00") is False
    assert service.on_wear("99", 0.2, 0.2, "2026-11-19T01:00:02+00:00") is False
    assert service.on_wear("25", 0.2, None, "2026-11-19T01:00:03+00:00") is False
    assert service.snapshot()["inspection"]["status"] == "awaiting_result"

    assert service.on_wear("25", 0.08, 0.03, "2026-11-19T01:00:04+00:00") is True
    result = service.snapshot()["inspection"]
    assert result["status"] == "awaiting_result"  # wear alone must not open the popup
    assert result["result"] == {
        "timestampUtc": "2026-11-19T01:00:04+00:00", "actual": {"diameter": 0.08, "length": 0.03},
        "predicted": {"diameter": 0.35, "length": 0.18}, "thresholds": {"diameter": 0.1, "length": 0.05},
        "exceeded": [],  # back within both thresholds
    }
    assert "Inspection result received" in [e["label"] for e in service.snapshot()["events"]]
    assert service.on_wear("25", 0.5, 0.5, "2026-11-19T01:00:05+00:00") is False  # a result is only recorded once
    assert service.snapshot()["inspection"]["result"]["actual"] == {"diameter": 0.08, "length": 0.03}

    receive_photo(service)
    assert service.snapshot()["inspection"]["status"] == "result_ready"
    service.request_second_run(alert["alertId"])
    service.request_second_run(alert["alertId"])  # a repeated click sends nothing more
    rows = outbox(service)
    assert [body["action"] for _, body in rows] == ["inspection", "second_run"]
    second = rows[1][1]
    assert second["alertId"] == alert["alertId"] and second["eventId"] != rows[0][1]["eventId"]
    assert "metrics" not in second and "prediction" not in second and "result" not in second  # nothing else rides along
    assert service.snapshot()["inspection"]["status"] == "second_run_requested"
    assert "Second run requested" in [e["label"] for e in service.snapshot()["events"]]


def test_a_still_exceeding_result_is_reported_and_no_baseline_means_the_first_pair_counts(tmp_path):
    _, service = make_service(tmp_path)
    alert = make_alert(service)
    assert confirm(service, alert)["baseline"] == {"diameter": None, "length": None}  # nothing measured before the inspection
    assert service.on_wear("25", 0.2, 0.01, "2026-11-19T02:00:00+00:00") is True
    assert service.snapshot()["inspection"]["result"]["exceeded"] == ["diameter"]


def test_second_run_needs_a_result_and_dismissing_closes_the_inspection(tmp_path):
    _, service = make_service(tmp_path)
    alert = make_alert(service)
    for call in (service.request_second_run, service.dismiss_inspection):
        try:
            call("unknown")
        except HTTPException as exc:
            assert exc.status_code == 404
        else:
            raise AssertionError("expected 404")
    try:
        service.start_inspection("unknown")
    except HTTPException as exc:
        assert exc.status_code == 404
    confirm(service, alert)
    try:
        service.request_second_run(alert["alertId"])  # no result yet
    except HTTPException as exc:
        assert exc.status_code == 409
    else:
        raise AssertionError("expected 409")
    service.dismiss_inspection(alert["alertId"])
    assert service.snapshot()["inspection"]["status"] == "dismissed"
    assert service.on_wear("25", 0.2, 0.2, "2026-11-19T03:00:00+00:00") is False  # nothing is waiting any more
    assert [body["action"] for _, body in outbox(service)] == ["inspection"]


def test_a_newer_confirmation_supersedes_the_open_inspection_of_the_same_tool(tmp_path):
    _, service = make_service(tmp_path)
    first, second = make_alert(service), make_alert(service)
    confirm(service, first)
    confirm(service, second)
    with closing(sqlite3.connect(service.path)) as db:
        states = [json.loads(body)["status"] for (body,) in db.execute("SELECT body FROM inspections ORDER BY seq")]
    assert states == ["superseded", "awaiting_result"]
    service.on_wear("25", 0.3, 0.3, "2026-11-19T04:00:00+00:00")
    assert service.snapshot()["inspection"]["alertId"] == second["alertId"]
    assert service.snapshot()["inspection"]["status"] == "awaiting_result"


def test_controller_rows_in_signal_batches_complete_the_inspection_and_reset_clears_it(tmp_path):
    settings, service = make_service(tmp_path)
    alert = make_alert(service)
    state = {}
    row = lambda stamp, x, z, tool=25: {"timestamp": stamp, "tool_no": tool, "xWearMm": x, "zWearMm": z}
    service.on_signals(settings.signals_machine_id, {"process": [row("2026-11-19T05:00:00Z", 0.01, 0.02)]}, state)
    assert confirm(service, alert)["baseline"] == {"diameter": 0.01, "length": 0.02}
    service.on_signals(settings.signals_machine_id, {"process": [row("2026-11-19T05:00:01Z", 0.01, 0.02)]}, state)
    assert service.snapshot()["inspection"]["status"] == "awaiting_result"
    service.on_signals(settings.signals_machine_id, {"process": [
        row("2026-11-19T05:00:01Z", 0.99, 0.99),  # an old timestamp (overlapping window) is ignored
        {"timestamp": "2026-11-19T05:00:02Z", "tool_no": 25.0, "tool_wear_x_mm": 0.04, "tool_wear_z_mm": 0.02},
    ]}, state)
    assert service.snapshot()["inspection"]["result"]["actual"] == {"diameter": 0.04, "length": 0.02}

    service.reset()
    assert service.snapshot()["inspection"] is None


def test_simulated_wear_takes_the_same_path_as_a_controller_row(tmp_path):
    _, service = make_service(tmp_path)
    alert = make_alert(service)
    confirm(service, alert)
    result = service.simulate_wear(alert["alertId"], WearValues(diameter=0.06, length=0.04))
    assert result["status"] == "awaiting_result" and result["result"]["actual"] == {"diameter": 0.06, "length": 0.04}
    try:
        service.simulate_wear(alert["alertId"], WearValues(diameter=0.1, length=0.1))
    except HTTPException as exc:
        assert exc.status_code == 409
