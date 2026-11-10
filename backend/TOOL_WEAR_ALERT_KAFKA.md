# Tool wear alert Kafka consumer handoff

The backend publishes a notification when a mock wear prediction crosses the configured diameter or length threshold. The NUC can use it to trigger a capture.

| Setting | Value |
| --- | --- |
| Bootstrap server | `172.20.114.237:9094` by default. The backend uses `MICROSCOPE_KAFKA_BOOTSTRAP_SERVERS`. |
| Security | `PLAINTEXT`, with no SASL credentials in the current publisher configuration. The NUC needs network access to the bootstrap and advertised broker addresses. |
| Topic | `makino_tool_wear_alert`. Provision it before enabling the publisher. Use 1 partition and replication factor 1 for the single-broker demo. |
| Publisher client ID | `pqm-cnc-wear-alerts` |
| Producer delivery | `acks=all`, idempotence enabled, persistent retries on delivery failure |
| NUC group ID | Suggested `makino-microscope-wear-alerts`. Use a stable group ID. |
| NUC offset policy | Use `latest` for the first live-only demo run and start the consumer before publishing. On restart, resume the committed group offsets. |
| Key | UTF-8 `alertId` UUID string |
| Headers | `schemaVersion=1.0.0`, `contentType=application/json`, both UTF-8 |
| Value | UTF-8 JSON |

```json
{
  "schemaVersion": "1.0.0",
  "eventType": "tool_wear_alert",
  "alertId": "46f07dbe-72ed-4605-834f-e1c024a0677e",
  "machineId": "Makino_01",
  "toolNo": "167",
  "metrics": ["diameter", "length"],
  "timestampUtc": "2026-11-10T06:08:45.421000+00:00",
  "source": "mock"
}
```

`metrics` contains the metric names that newly crossed their thresholds. One prediction can raise both in one event. `toolNo` is a string, `timestampUtc` is ISO 8601 UTC, and `source` identifies the demo prediction. The message contains no image. Continue publishing captures to `makino_microscope_image` using the existing image schema.

Persist processed `alertId` values and commit the Kafka offset after the NUC has accepted the capture job durably. Delivery can repeat after a retry or restart, so use `alertId` to avoid starting another capture for the same alert.

## Enable and verify

Add these settings to the deployed server's `backend.env`, then recreate the backend with Compose.

```dotenv
TOOL_WEAR_DEMO_ENABLED=true
TOOL_WEAR_ALERT_KAFKA_ENABLED=true
TOOL_WEAR_ALERT_KAFKA_TOPIC=makino_tool_wear_alert
TOOL_WEAR_ALERT_TEMI_ENABLED=false
```

Use these demo controls on an access-controlled deployment. The threshold and mock submission endpoints have no separate application authentication.

1. Start the NUC consumer. In Tool Wear, set both thresholds to `0.1` mm.
2. In Product Quality, submit a mock prediction for tool `167` with diameter and length both `0`, then submit diameter `0.2` and length `0`. The first prediction resets the crossing state.
3. Compare `alertId` from the NUC message with the backend logs. The log `Tool wear alert published to Kafka` includes the acknowledged topic, partition and offset. A resulting capture produces `Microscope image received from Kafka`.

```sh
sudo docker compose logs -f backend
```

Thresholds, prediction state, alert history and pending deliveries are stored in a separate SQLite database inside the existing microscope volume.

To enable Temi, set `TOOL_WEAR_ALERT_TEMI_ENABLED=true` and supply `TOOL_WEAR_ALERT_TEMI_URL`. The current adapter sends an HTTP POST with the alert JSON above and `Idempotency-Key: <alertId>`. Set `TOOL_WEAR_ALERT_TEMI_TOKEN` if the endpoint expects a Bearer token. Confirm the request contract with the Temi endpoint owner before enabling it.
