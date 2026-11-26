# Tool wear alert Kafka consumer handoff

The backend publishes a notification when the operator reacts to a tool wear prediction alert. The NUC distinguishes the two kinds of message by the `action` field:

| `action` | When it is sent | What the NUC should do |
| --- | --- | --- |
| `inspection` | The operator answered **Yes, laser inspection** in the "Tool wear prediction alert" popup | Start the laser inspection (and the capture, as before) |
| `second_run` | The operator answered **Yes, rework** in the "Laser inspection result" popup, after the new wear values arrived | Start the second run |

The alert itself no longer produces a Kafka message. Temi is unchanged: it is still triggered right after the alert, once per alert, and never for a second run.

| Setting | Value |
| --- | --- |
| Bootstrap server | `172.20.114.237:9094` by default. The backend uses `MICROSCOPE_KAFKA_BOOTSTRAP_SERVERS`. |
| Security | `PLAINTEXT`, with no SASL credentials in the current publisher configuration. The NUC needs network access to the bootstrap and advertised broker addresses. |
| Topic | `makino_tool_wear_alert`. Provision it before enabling the publisher. Use 1 partition and replication factor 1 for the single-broker demo. |
| Publisher client ID | `pqm-cnc-wear-alerts` |
| Producer delivery | `acks=all`, idempotence enabled, persistent retries on delivery failure |
| NUC group ID | Suggested `makino-microscope-wear-alerts`. Use a stable group ID. |
| NUC offset policy | Use `latest` for the first live-only demo run and start the consumer before publishing. On restart, resume the committed group offsets. |
| Key | UTF-8 `eventId` UUID string (unique per message) |
| Headers | `schemaVersion=1.1.0`, `contentType=application/json`, `action=inspection` or `second_run`, all UTF-8 |
| Value | UTF-8 JSON |

`inspection` message (the old alert message, with `action` and `eventId` added and `schemaVersion` raised to 1.1.0):

```json
{
  "schemaVersion": "1.1.0",
  "eventType": "tool_wear_alert",
  "action": "inspection",
  "eventId": "0b9d6c52-7a3e-4c0e-9a4f-3f1f4f7f5b11",
  "alertId": "46f07dbe-72ed-4605-834f-e1c024a0677e",
  "machineId": "Makino_01",
  "toolNo": "25",
  "metrics": ["diameter", "length"],
  "timestampUtc": "2026-11-19T06:08:45.421000+00:00",
  "source": "mock"
}
```

`second_run` message (nothing but the identifiers; the `action` is what matters):

```json
{
  "schemaVersion": "1.1.0",
  "eventType": "tool_wear_alert",
  "action": "second_run",
  "eventId": "6c1f0f0e-52f4-4d0e-8d38-0d6a2a5a9c77",
  "alertId": "46f07dbe-72ed-4605-834f-e1c024a0677e",
  "machineId": "Makino_01",
  "toolNo": "25",
  "timestampUtc": "2026-11-19T06:12:10.118000+00:00",
  "source": "mock"
}
```

Field notes:

- `action` (and the `action` header) is the only field the NUC needs to branch on. Ignore any value it does not know.
- `eventId` is unique per message and is also the Kafka key. Use it for de-duplication: an `inspection` and a `second_run` for the same alert share one `alertId` but have different `eventId` values.
- `alertId` is the tool wear alert both messages belong to (at most one `inspection` and one `second_run` per alert).
- `metrics` (only in `inspection`) lists the metrics that crossed their thresholds; one prediction can raise both. `toolNo` is a string, `timestampUtc` is ISO 8601 UTC (the time the operator answered), and `source` identifies the demo.
- The messages contain no image and no wear values. Continue publishing captures to `makino_microscope_image` using the existing image schema.

Persist processed `eventId` values and commit the Kafka offset after the NUC has accepted the job durably. Delivery can repeat after a retry or restart, so de-duplicate on `eventId`, not on `alertId` (de-duplicating on `alertId` would drop the `second_run`).

**Rollout.** Update the NUC consumer first, so it branches on `action` and ignores unknown values, then deploy the backend. A consumer that still treats every message as a capture request would start a capture for a `second_run` message. Messages that were already queued before the upgrade have no `action` or `eventId` and are published as `inspection` (header `schemaVersion=1.0.0`, key `alertId`).

## Enable and verify

Add these settings to the deployed server's `backend.env`, then recreate the backend with Compose.

```dotenv
TOOL_WEAR_DEMO_ENABLED=true
TOOL_WEAR_ALERT_KAFKA_ENABLED=true
TOOL_WEAR_ALERT_KAFKA_TOPIC=makino_tool_wear_alert
TOOL_WEAR_ALERT_TEMI_ENABLED=false
```

Use these demo controls on an access-controlled deployment. The threshold and mock submission endpoints have no separate application authentication.

1. Start the NUC consumer. In Tool Wear, set the thresholds (for example `0.1` mm for diameter).
2. Trigger mock predictions until the abnormal one (#10) raises the "Tool wear prediction alert" popup. Nothing is published to Kafka yet.
3. Click **Yes, laser inspection**. The NUC receives the `inspection` message. In the Mock tool wear prediction panel, enter new Diameter and Tool length wear values and click **Simulate new wear** (a real controller row with new `xWearMm` / `zWearMm` values does the same).
4. The "Laser inspection result" popup shows the measured wear against the prediction. Click **Yes, rework**. The NUC receives the `second_run` message.
5. Compare `eventId` from the NUC message with the backend logs. The log `Tool wear notification published to Kafka` includes the action, the acknowledged topic, partition and offset. A resulting capture produces `Microscope image received from Kafka`.

```sh
sudo docker compose logs -f backend
```

Thresholds, prediction state, alert history and pending deliveries are stored in a separate SQLite database inside the existing microscope volume.

## Laser inspection flow

1. An alert fires: the "Tool wear prediction alert" popup asks "Do you want to perform a laser inspection?". Temi is triggered (unchanged).
2. **Yes, laser inspection** (`POST /api/tool-wear/demo/alerts/{alertId}/inspection`): the backend stores the tool's current actual wear as the baseline, starts waiting, and queues the Kafka `inspection` message. **Not now** closes the popup and does nothing else. A newer confirmation for the same tool replaces an inspection that is still open.
3. While waiting, every controller row of that tool is checked. When a row carries both `xWearMm` (diameter) and `zWearMm` (tool length) and at least one differs from the baseline by more than 1e-6 mm (or no baseline existed), the inspection result is stored once: the actual values, the predicted values and thresholds of the alert, and which metrics are still above their threshold.
4. The "Laser inspection result" popup appears (also after a page reload while the result is waiting). **Yes, rework** (`POST /api/tool-wear/demo/inspections/{alertId}/second-run`) queues the Kafka `second_run` message once; repeated clicks send nothing more. **Not now** (`.../dismiss`) closes the inspection; a dismissed inspection cannot be reopened, only a new alert starts another.
5. The state is in the `inspections` table of `wear-alerts.sqlite3` and in the `inspection` field of `GET /api/tool-wear/demo`. Reset demo clears it. The event log shows Laser inspection confirmed, Inspection result received and Second run requested.
6. Demo helper: `POST /api/tool-wear/demo/inspections/{alertId}/simulate-wear` with `{"diameter": 0.06, "length": 0.04}` behaves like a controller row.

Like the NC line trigger, the wear check only runs while a page is subscribed to `/api/signals/stream`.

To enable Temi, set `TOOL_WEAR_ALERT_TEMI_ENABLED=true` and supply `TOOL_WEAR_ALERT_TEMI_URL`. The current adapter sends an HTTP POST with an empty body and `Idempotency-Key: <alertId>`. Set `TOOL_WEAR_ALERT_TEMI_TOKEN` if the endpoint expects a Bearer token. Confirm the request contract with the Temi endpoint owner before enabling it.

## NC line 自动触发

页面打开（有 `/api/signals/stream` 连接）期间，后端检查 controller `process` 行的 `nc_line` 字段，满足下面任一条件时自动执行一次与手动 Trigger 相同的预测流程（事件详情显示 `NC line x → 29`）：

- **触发值**：值从别的值（含 null）变为触发值，默认 `29`（逗号分隔，可写多个），用 `TOOL_WEAR_NC_TRIGGER_VALUES` 修改。
- **区间触发**：值首次进入 73–74（含两端，常量 `NC_RANGE_LOW` / `NC_RANGE_HIGH`）时触发；已在区间内变化（73 → 74）不重复触发，离开区间再进入才再次触发。
- **第二次 prediction**：仅由进入 NC 73–74 触发，已移除定时保底。
- 通知过期：待发送的告警通知超过 `TOOL_WEAR_ALERT_EXPIRE_SECONDS`（默认 600 秒，`0` 表示不过期）仍未发出，就直接丢弃，并在 event log 记一条 `Notification expired`（一次清理合并成一条，写明丢弃的数量）。这样 Temi 或 Kafka 停机一段时间后恢复，不会把积压的旧告警一次性补发。失败重试仍是 2、4、8…最多 60 秒的指数退避，过期前一直重试。
- 预测的模拟耗时（`Prediction started` 到 `Prediction completed` 之间）由 `TOOL_WEAR_PREDICTION_DELAY_SECONDS` 设置，默认 `0`（立即出结果），手动和自动触发共用。
- 字段名固定为 `nc_line`（`app/wear_alerts.py` 的 `NC_LINE_FIELD`）。
- **QC 采样（93）**：`nc_line` 变为 `93` 时不启动预测，只读取同一行 `macros["956"]`（实测直径，mm；`macros` 为字符串宏号 → 浮点数的对象，没有时是 `{}`），保存为 B9 的 Last QC（常量 `NC_QC_VALUE` / `QC_MACRO`）。值缺失或不是有限数字时 Last QC 保持不变，并在 event log 记一条 `QC not available`。值写入 `wear-alerts.sqlite3` 的 `last_qc` 表，重启后保留，Reset demo 会清除；通过 `GET /api/tool-wear/demo` 的 `lastQc` 字段返回，前端显示在 Selected Balloon Detail 的 Last QC（仅 B9）。**演示设置**：实测直径超出 B9 公差（后端 `quality_spec`，默认 18 ± 0.1）时，Last QC 不显示真实值，而显示固定的合格值 `TOOL_WEAR_QC_PASS_VALUE`（默认 18.067）；真实值只记录在 event log 和后端日志里。`TOOL_WEAR_QC_MASK_OUT_OF_SPEC=false` 可关闭这个替换。
- 页面刚打开后的第一批数据只记录当前值，不触发；自动触发之间至少间隔 10 秒（触发值和区间触发共用同一个冷却）；预测进行中不重复触发，被冷却挡掉的触发直接丢弃、不补发。
- 只按 `timestamp` 比上次更新的行判断，重叠窗口和数据库停写时重复返回的旧行不会重复触发。
- 实时质量气球（B9，见 `wear_series.py`）的公差保存在后端 `wear-alerts.sqlite3` 的 `quality_spec` 表（默认 18 / +0.1 / -0.1），手动和自动触发都用它判断 quality 告警。
- 状态（是否在监测、最近的 `nc_line`、最近一次自动触发时间）在 `GET /api/tool-wear/demo` 的 `ncWatch` 字段和页面触发面板中显示。
