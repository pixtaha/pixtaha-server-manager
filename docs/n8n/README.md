# n8n workflows

## Server Manager Alerts (`server-manager-alerts.json`)
Real-time critical alerts to Telegram. Separate from the daily report workflow.

```
Alert Webhook (POST /webhook/server-alert, Header Auth "Server Manager Report Token")
  -> Ingest Heartbeat (Postgres "Server Manager DB Writer": server_manager.ingest_heartbeat)
  -> Format Telegram Messages (Code) -> Send Telegram Alert (Telegram)
Every 5 Minutes (Schedule)
  -> Check Offline Servers (Postgres: server_manager.offline_check(15))
  -> Format Telegram Messages -> Send Telegram Alert
```

- The collector (1.1.0+) posts a heartbeat every 5 minutes with new `alerts[]` and `resolved[]` (see `collector/README.md`).
- `ingest_heartbeat` dedupes in Postgres (`server_manager.active_alerts`) and returns only events to send; every event is logged in `server_manager.alert_events`.
- Messages: `🔴 CRITICAL`, `✅ RESOLVED` (with duration), `⚫ SERVER OFFLINE` (no heartbeat for 15+ min, once), `🟢 BACK ONLINE`. Times in Cairo.
- Settings: successful executions are not saved (a heartbeat every 5 minutes per server, and request headers carry the token); failed executions are kept.

The export has no credential IDs and no chat ID. To import by hand: n8n -> Workflows -> Import from file, then pick the three credentials on their nodes, set the chat ID in "Send Telegram Alert", and publish after migration `0006_alerts_heartbeat.sql` is applied.
