#!/bin/bash
set -e

# Check if mitmproxy is enabled
if [ "$INPUT_ENABLED" != "true" ]; then
    echo "mitmproxy is disabled, skipping..."
    # JavaScript will handle setting empty outputs
    exit 0
fi

echo "Starting mitmproxy logger..."

# Install mitmproxy if not already installed
if ! command -v mitmdump &> /dev/null; then
    echo "Installing mitmproxy..."
    pip install mitmproxy
fi

# Create traffic directory in RUNNER_TEMP to avoid workspace cleanup issues
TRAFFIC_DIR="${RUNNER_TEMP}/mitmproxy-action-traffic"
mkdir -p "$TRAFFIC_DIR"

# Generate traffic file name with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TRAFFIC_FILE="${TRAFFIC_DIR}/traffic_${TIMESTAMP}.mitm"

# Start mitmdump in background
echo "Starting mitmdump on ${INPUT_LISTEN_HOST}:${INPUT_LISTEN_PORT}"
echo "Traffic will be saved to: $TRAFFIC_FILE"

# Start mitmdump with flow file output
mitmdump \
    --listen-host "$INPUT_LISTEN_HOST" \
    --listen-port "$INPUT_LISTEN_PORT" \
    --save-stream-file "$TRAFFIC_FILE" \
    --set confdir="$TRAFFIC_DIR" \
    > "${TRAFFIC_DIR}/mitmdump.log" 2>&1 &

# Save the PID for cleanup
MITMDUMP_PID=$!
echo "$MITMDUMP_PID" > "${TRAFFIC_DIR}/mitmdump.pid"

# Wait a moment for the proxy to start
sleep 2

# Check if the process is still running
if ! kill -0 "$MITMDUMP_PID" 2>/dev/null; then
    echo "Failed to start mitmdump. Check logs:"
    cat "${TRAFFIC_DIR}/mitmdump.log"
    exit 1
fi

# Save outputs for JavaScript to read
PROXY_URL="http://${INPUT_LISTEN_HOST}:${INPUT_LISTEN_PORT}"

# Save traffic file path for later use
echo "$TRAFFIC_FILE" > "${TRAFFIC_DIR}/traffic_file_path.txt"

# Save proxy URL for JavaScript to read
echo "$PROXY_URL" > "${TRAFFIC_DIR}/proxy_url.txt"

echo "mitmproxy started successfully at $PROXY_URL"
echo "PID: $MITMDUMP_PID"
echo "Traffic file: $TRAFFIC_FILE"

# Write outputs to GITHUB_OUTPUT if available (though pre outputs aren't accessible, main will read the files)
if [ -n "$GITHUB_OUTPUT" ]; then
    echo "proxy-url=$PROXY_URL" >> "$GITHUB_OUTPUT"
    echo "traffic-file=$TRAFFIC_FILE" >> "$GITHUB_OUTPUT"
fi