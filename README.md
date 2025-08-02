# mitmproxy-logger-action

A GitHub Action that starts mitmproxy to log HTTP/HTTPS traffic during your workflow and uploads the traffic data as an encrypted artifact.

## Features

- Starts mitmdump proxy on specified host/port
- Logs all HTTP/HTTPS traffic to a file
- Compresses and encrypts traffic logs with a passphrase
- Uploads traffic data as GitHub Actions artifacts
- Configurable proxy settings
- Easy cleanup and artifact management

## Usage

### Basic Usage

```yaml
name: Test with mitmproxy logging
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Start mitmproxy logging
      - name: Start mitmproxy
        uses: yaegashi/mitmproxy-logger-action@v1
        with:
          enabled: true
          listen-host: '127.0.0.1'
          listen-port: '8080'
          passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
      
      # Your test steps that generate HTTP traffic
      - name: Run tests
        run: |
          # Configure your application to use the proxy
          export HTTP_PROXY=http://127.0.0.1:8080
          export HTTPS_PROXY=http://127.0.0.1:8080
          # Run your tests
          npm test
      
      # Stop mitmproxy and upload artifacts
      - name: Stop mitmproxy
        if: always()
        uses: yaegashi/mitmproxy-logger-action/stop@v1
        with:
          enabled: true
      
      - name: Prepare traffic artifacts
        if: always()
        id: artifacts
        uses: yaegashi/mitmproxy-logger-action/upload@v1
        with:
          enabled: true
          passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
      
      - name: Upload artifacts to GitHub
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mitmproxy-traffic
          path: ${{ steps.artifacts.outputs.artifact-path }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `enabled` | Enable mitmproxy logging (true/false) | No | `true` |
| `listen-host` | Proxy listen address | No | `127.0.0.1` |
| `listen-port` | Proxy listen port | No | `8080` |
| `passphrase` | Passphrase for artifact encryption | Yes | - |

## Outputs

| Output | Description |
|--------|-------------|
| `proxy-url` | URL of the started proxy (e.g., `http://127.0.0.1:8080`) |
| `traffic-file` | Path to the traffic log file |

## Security Notes

- The `passphrase` input should be stored as a GitHub secret
- Traffic files are encrypted using AES-256-CBC before upload
- Temporary files are cleaned up after artifact creation
- The proxy only listens on localhost by default

## Decrypting Traffic Files

To decrypt the uploaded traffic files:

```bash
# Download and extract the artifact
unzip mitmproxy-traffic.zip
cd artifacts/

# Decrypt the file
openssl enc -aes-256-cbc -d -pbkdf2 -in mitmproxy_traffic_*.tar.gz.enc -out decrypted.tar.gz
# Enter your passphrase when prompted

# Extract the traffic file
tar -xzf decrypted.tar.gz

# View traffic with mitmproxy
mitmweb -r traffic_*.mitm
```

## Advanced Usage

### Conditional Logging

```yaml
- name: Start mitmproxy
  uses: yaegashi/mitmproxy-logger-action@v1
  with:
    enabled: ${{ github.event_name == 'pull_request' }}
    passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
```

### Custom Port Configuration

```yaml
- name: Start mitmproxy
  uses: yaegashi/mitmproxy-logger-action@v1
  with:
    listen-host: '0.0.0.0'  # Listen on all interfaces
    listen-port: '9090'     # Custom port
    passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
```

## Troubleshooting

### Common Issues

1. **Proxy connection failed**
   - Ensure the specified port is not already in use
   - Check if your application supports HTTP_PROXY/HTTPS_PROXY environment variables
   - Verify the proxy is running with `curl -x http://127.0.0.1:8080 http://httpbin.org/get`

2. **No traffic captured**
   - Make sure your application is configured to use the proxy
   - Check that HTTP_PROXY and HTTPS_PROXY environment variables are set
   - Some applications may need additional proxy configuration

3. **Certificate errors (HTTPS)**
   - mitmproxy generates its own CA certificate
   - For HTTPS traffic, applications may need to accept the mitmproxy CA
   - The CA certificate is available in the traffic artifacts

4. **Missing passphrase secret**
   - Create a secret in your repository: Settings → Secrets → Actions
   - Add a new secret named `MITMPROXY_PASSPHRASE` with your chosen passphrase
   - Reference it in your workflow as `${{ secrets.MITMPROXY_PASSPHRASE }}`

5. **Permission denied errors**
   - The action requires write permissions to create temporary files
   - Ensure your workflow has sufficient permissions

### Debug Information

To see detailed logs, check the uploaded artifacts which include:
- `mitmdump.log` - mitmproxy startup and operation logs
- Traffic data file with all captured HTTP/HTTPS requests

### Testing Locally

You can test the scripts locally (outside GitHub Actions):
```bash
export GITHUB_WORKSPACE="/tmp/test"
export INPUT_ENABLED="true"
export INPUT_LISTEN_HOST="127.0.0.1"
export INPUT_LISTEN_PORT="8080"
export INPUT_PASSPHRASE="your-test-passphrase"

# Start mitmproxy
./scripts/start.sh

# Test proxy
curl -x http://127.0.0.1:8080 http://httpbin.org/get

# Stop and upload
./scripts/stop.sh
./scripts/upload-artifacts.sh
```

## License

This project is licensed under the MIT License.
