#!/bin/bash
set -e

# Check if mitmproxy was enabled
if [ "$INPUT_ENABLED" != "true" ]; then
    echo "mitmproxy was disabled, nothing to stop..."
    exit 0
fi

echo "Stopping mitmproxy and uploading artifacts..."

TRAFFIC_DIR="${GITHUB_WORKSPACE}/mitmproxy-traffic"
PID_FILE="${TRAFFIC_DIR}/mitmdump.pid"

# Stop mitmdump if it's running
if [ -f "$PID_FILE" ]; then
    MITMDUMP_PID=$(cat "$PID_FILE")
    echo "Stopping mitmdump process (PID: $MITMDUMP_PID)..."
    
    if kill -0 "$MITMDUMP_PID" 2>/dev/null; then
        # Gracefully stop mitmdump
        kill -TERM "$MITMDUMP_PID"
        
        # Wait a few seconds for graceful shutdown
        sleep 3
        
        # Force kill if still running
        if kill -0 "$MITMDUMP_PID" 2>/dev/null; then
            echo "Force killing mitmdump..."
            kill -KILL "$MITMDUMP_PID"
        fi
    fi
    
    rm -f "$PID_FILE"
    echo "mitmdump stopped successfully"
else
    echo "No PID file found, mitmdump may not have been started"
fi

echo "mitmproxy stopped. Use upload-artifacts.sh to upload the traffic data."