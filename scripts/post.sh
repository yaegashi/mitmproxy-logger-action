#!/bin/bash
set -e

# Check if mitmproxy was enabled
if [ "$INPUT_ENABLED" != "true" ]; then
    echo "mitmproxy was disabled, nothing to clean up..."
    exit 0
fi

echo "Starting mitmproxy cleanup and artifact upload..."

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

# Check if traffic file exists and has content
if [ -z "$TRAFFIC_FILE" ]; then
    echo "No traffic file specified, skipping artifact upload..."
    exit 0
fi

if [ ! -f "$TRAFFIC_FILE" ]; then
    echo "Traffic file not found: $TRAFFIC_FILE"
    echo "Creating empty traffic file for artifact upload..."
    touch "$TRAFFIC_FILE"
fi

# Get file size
FILE_SIZE=$(stat -c%s "$TRAFFIC_FILE" 2>/dev/null || echo "0")
echo "Traffic file size: $FILE_SIZE bytes"

# Create archive name
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_NAME="mitmproxy_traffic_${TIMESTAMP}"

# Compress the traffic file
echo "Compressing traffic file..."
COMPRESSED_FILE="${TRAFFIC_DIR}/${ARCHIVE_NAME}.tar.gz"
tar -czf "$COMPRESSED_FILE" -C "$(dirname "$TRAFFIC_FILE")" "$(basename "$TRAFFIC_FILE")"

# Encrypt the compressed file if passphrase is provided
if [ -n "$INPUT_PASSPHRASE" ]; then
    echo "Encrypting traffic file..."
    ENCRYPTED_FILE="${TRAFFIC_DIR}/${ARCHIVE_NAME}.tar.gz.enc"
    
    # Use openssl for encryption
    openssl enc -aes-256-cbc -salt -pbkdf2 -in "$COMPRESSED_FILE" -out "$ENCRYPTED_FILE" -pass pass:"$INPUT_PASSPHRASE"
    
    # Remove unencrypted file
    rm "$COMPRESSED_FILE"
    FINAL_FILE="$ENCRYPTED_FILE"
    echo "Traffic file encrypted successfully"
else
    echo "No passphrase provided, skipping encryption"
    FINAL_FILE="$COMPRESSED_FILE"
fi

# Upload as artifact using GitHub Actions
echo "Uploading artifact..."
echo "Final file: $FINAL_FILE"

# Create artifacts directory structure that GitHub Actions expects
ARTIFACT_DIR="${TRAFFIC_DIR}/artifacts"
mkdir -p "$ARTIFACT_DIR"
cp "$FINAL_FILE" "$ARTIFACT_DIR/"

# Use GitHub's upload-artifact action via environment
echo "Setting up artifact upload..."
echo "ARTIFACT_PATH=$ARTIFACT_DIR" >> $GITHUB_ENV
echo "ARTIFACT_NAME=${ARCHIVE_NAME}" >> $GITHUB_ENV

# Also include logs
cp "${TRAFFIC_DIR}/mitmdump.log" "$ARTIFACT_DIR/" 2>/dev/null || echo "No log file to include"

echo "Cleanup and preparation completed successfully"
echo "Artifact will be available as: ${ARCHIVE_NAME}"
echo "Files prepared in: $ARTIFACT_DIR"