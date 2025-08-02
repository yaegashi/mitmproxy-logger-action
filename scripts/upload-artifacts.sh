#!/bin/bash
set -e

# Check if mitmproxy was enabled
if [ "$INPUT_ENABLED" != "true" ]; then
    echo "mitmproxy was disabled, no artifacts to upload..."
    exit 0
fi

echo "Preparing mitmproxy artifacts for upload..."

TRAFFIC_DIR="${GITHUB_WORKSPACE}/mitmproxy-traffic"

# Find the traffic file
TRAFFIC_FILE=""
if [ -n "$INPUT_TRAFFIC_FILE" ]; then
    TRAFFIC_FILE="$INPUT_TRAFFIC_FILE"
elif [ -f "${TRAFFIC_DIR}/traffic_file_path.txt" ]; then
    TRAFFIC_FILE=$(cat "${TRAFFIC_DIR}/traffic_file_path.txt")
else
    # Find the most recent .mitm file
    TRAFFIC_FILE=$(find "$TRAFFIC_DIR" -name "*.mitm" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
fi

if [ -z "$TRAFFIC_FILE" ] || [ ! -f "$TRAFFIC_FILE" ]; then
    echo "No traffic file found. Creating an empty one for completeness..."
    TRAFFIC_FILE="${TRAFFIC_DIR}/traffic_empty.mitm"
    touch "$TRAFFIC_FILE"
fi

# Get file size
FILE_SIZE=$(stat -c%s "$TRAFFIC_FILE" 2>/dev/null || echo "0")
echo "Traffic file: $TRAFFIC_FILE"
echo "Traffic file size: $FILE_SIZE bytes"

# Create archive name
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_NAME="mitmproxy_traffic_${TIMESTAMP}"

# Create artifacts directory
ARTIFACT_DIR="${TRAFFIC_DIR}/artifacts"
mkdir -p "$ARTIFACT_DIR"

# Compress the traffic file
echo "Compressing traffic file..."
COMPRESSED_FILE="${ARTIFACT_DIR}/${ARCHIVE_NAME}.tar.gz"
tar -czf "$COMPRESSED_FILE" -C "$(dirname "$TRAFFIC_FILE")" "$(basename "$TRAFFIC_FILE")"

# Encrypt the compressed file if passphrase is provided
if [ -n "$INPUT_PASSPHRASE" ]; then
    echo "Encrypting traffic file..."
    ENCRYPTED_FILE="${ARTIFACT_DIR}/${ARCHIVE_NAME}.tar.gz.enc"
    
    # Use openssl for encryption
    openssl enc -aes-256-cbc -salt -pbkdf2 -in "$COMPRESSED_FILE" -out "$ENCRYPTED_FILE" -pass pass:"$INPUT_PASSPHRASE"
    
    # Remove unencrypted file
    rm "$COMPRESSED_FILE"
    FINAL_FILE="$ENCRYPTED_FILE"
    echo "Traffic file encrypted successfully"
else
    echo "Warning: No passphrase provided, file will not be encrypted"
    FINAL_FILE="$COMPRESSED_FILE"
fi

# Also include logs if available
if [ -f "${TRAFFIC_DIR}/mitmdump.log" ]; then
    cp "${TRAFFIC_DIR}/mitmdump.log" "$ARTIFACT_DIR/"
    echo "Included mitmdump log file"
fi

echo "Artifacts prepared successfully in: $ARTIFACT_DIR"
echo "Main artifact file: $(basename "$FINAL_FILE")"
echo ""
echo "To upload as GitHub artifact, add this step to your workflow:"
echo "- uses: actions/upload-artifact@v4"
echo "  with:"
echo "    name: ${ARCHIVE_NAME}"
echo "    path: ${ARTIFACT_DIR}"