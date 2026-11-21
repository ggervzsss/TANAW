REALTIME_HEARTBEAT_SECONDS = 30
# The outbox worker is woken right after this process commits a write, so these
# delays bound only how late it notices rows written elsewhere (for example the
# sample-data CLI). While idle the delay doubles from the first value to the cap.
REALTIME_OUTBOX_POLL_SECONDS = 0.5
REALTIME_OUTBOX_IDLE_POLL_MAX_SECONDS = 10.0
REALTIME_OUTBOX_BATCH_SIZE = 100
REALTIME_BROKER_RECONNECT_SECONDS = 1.0
