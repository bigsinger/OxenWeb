#!/bin/sh
set -eu
printf '%s\n' "$$" > "$OXEN_LOCAL_PID_FILE"
exec "$OXEN_SERVER_BIN" start --ip 127.0.0.1 --port "$1" --config-dir "$OXEN_CONFIG_DIR"
