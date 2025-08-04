# mitmproxy-logger-action

A GitHub Action that automatically captures HTTP/HTTPS traffic using mitmproxy during your workflow and uploads the traffic data as encrypted artifacts. The action handles the complete lifecycle - from installing and starting the proxy to stopping it and uploading artifacts when your job completes.

**✅ Cross-platform:** Works on Ubuntu, macOS, and Windows runners.

## Features

- Starts mitmdump proxy on specified host/port
- Logs all HTTP/HTTPS traffic to a file
- **Automatic CA certificate installation** for seamless HTTPS interception
- Compresses and encrypts traffic logs with a passphrase
- Uploads traffic data as GitHub Actions artifacts
- Configurable proxy settings
- Easy cleanup and artifact management
- **Cross-platform support** (Ubuntu, macOS, Windows)
- **Pure Node.js implementation** (no bash scripts required)

## Usage

### Basic Usage (Ubuntu/macOS)

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
        id: mitmproxy
        uses: yaegashi/mitmproxy-logger-action@v1
        with:
          enabled: true
          listen-host: '127.0.0.1'
          listen-port: '8080'
          install-cacert: true
          set-envvars: true
          passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
      
      # Your test steps that generate HTTP traffic
      - name: Run tests
        run: |
          # With set-envvars: true (default), proxy environment variables are automatically set
          # Alternatively, you can configure your application manually:
          # export http_proxy=${{ steps.mitmproxy.outputs.proxy-url }}
          # export https_proxy=${{ steps.mitmproxy.outputs.proxy-url }}
          
          # Run your tests
          npm test
      
      # mitmproxy will automatically stop and upload artifacts when the job completes
```

### Basic Usage (Windows)

```yaml
name: Test with mitmproxy logging on Windows
on: [push]

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      # Setup Python (required for mitmproxy)
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.x'
      
      # Start mitmproxy logging
      - name: Start mitmproxy
        id: mitmproxy
        uses: yaegashi/mitmproxy-logger-action@v1
        with:
          enabled: true
          listen-host: '127.0.0.1'
          listen-port: '8080'
          install-cacert: true
          set-envvars: true
          passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
      
      # Your test steps that generate HTTP traffic
      - name: Run tests
        shell: powershell
        run: |
          # With set-envvars: true (default), proxy environment variables are automatically set
          # Alternatively, you can configure your application manually:
          # $env:http_proxy = "${{ steps.mitmproxy.outputs.proxy-url }}"
          # $env:https_proxy = "${{ steps.mitmproxy.outputs.proxy-url }}"
          
          # Run your tests
          npm test
      
      # mitmproxy will automatically stop and upload artifacts when the job completes
```

The action automatically handles:
- Installing mitmproxy dependencies (pre-step)
- Starting the proxy server (pre-step)  
- Stopping the proxy server (post-step)
- Compressing and encrypting traffic files (post-step)
- Uploading artifacts to GitHub Actions (post-step)

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `enabled` | Enable mitmproxy logging (true/false) | No | `true` |
| `listen-host` | Proxy listen address | No | `127.0.0.1` |
| `listen-port` | Proxy listen port | No | `8080` |
| `install-cacert` | Install mitmproxy CA certificate to system trust store (true/false) | No | `true` |
| `set-envvars` | Set proxy environment variables automatically (true/false) | No | `true` |
| `passphrase` | Passphrase for artifact encryption | Yes | - |

## Outputs

| Output | Description |
|--------|-------------|
| `proxy-url` | URL of the started proxy (e.g., `http://127.0.0.1:8080`) |
| `stream-file` | Path to the stream log file |
| `cacert-path` | Path to the CA certificate file |

## Certificate Installation

The action automatically installs mitmproxy's CA certificate to the system trust store when `install-cacert` is set to `true` (default). This enables seamless HTTPS traffic interception without certificate warnings.

### Platform Support

- **Ubuntu/Linux**: Installs to `/usr/local/share/ca-certificates/` and updates system CA bundle
- **macOS**: Adds to System keychain as trusted root certificate  
- **Windows**: Imports to Root certificate store using `certutil`

### Environment Variables

When `set-envvars` is set to `true` (default), the action automatically sets these proxy environment variables:
- `http_proxy`: Set to the proxy URL (e.g., `http://127.0.0.1:8080`)  
- `https_proxy`: Set to the proxy URL (e.g., `http://127.0.0.1:8080`)
- `CURL_HOME`: Set to `--ssl-no-revoke` for better SSL handling

### Disabling Environment Variables

To disable automatic environment variable setting:

```yaml
- name: Start mitmproxy
  uses: yaegashi/mitmproxy-logger-action@v1
  with:
    set-envvars: false
    passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
```

### Disabling Certificate Installation

To disable automatic certificate installation:

```yaml
- name: Start mitmproxy
  uses: yaegashi/mitmproxy-logger-action@v1
  with:
    install-cacert: false
    passphrase: ${{ secrets.MITMPROXY_PASSPHRASE }}
```

## Platform Support

### Ubuntu/macOS
- Full support for all features
- Password-protected ZIP encryption using yazl library
- Compression using ZIP format

### Windows
- Full support for all features  
- **Note:** Requires Python to be available (use `actions/setup-python@v4`)
- Password-protected ZIP encryption using yazl library
- Compression using ZIP format
- See `examples/basic-usage-windows.yml` for a complete Windows example

## Security Notes

- The `passphrase` input should be stored as a GitHub secret
- Traffic files are encrypted using password-protected ZIP format before upload
- Temporary files are cleaned up after artifact creation
- The proxy only listens on localhost by default

### Windows Security Notes
- Full encryption support using password-protected ZIP format
- No additional dependencies required for encryption

## Decrypting Traffic Files

To decrypt the uploaded stream files:

```bash
# Download and extract the artifact
unzip mitmproxy-stream.zip
cd artifacts/

# Extract the password-protected ZIP file
unzip -P your-passphrase mitmproxy_stream_*.zip

# View traffic with mitmproxy
mitmweb -r stream_*.mitm
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
   - Check if your application supports http_proxy/https_proxy environment variables
   - Verify the proxy is running with `curl -x http://127.0.0.1:8080 http://httpbin.org/get`

2. **No traffic captured**
   - Make sure your application is configured to use the proxy
   - Check that http_proxy and https_proxy environment variables are set
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
- Stream data file with all captured HTTP/HTTPS requests

### Testing Locally

You can test the action locally by running the Node.js scripts directly:

```bash
# Set up environment variables
export INPUT_ENABLED="true"
export INPUT_LISTEN_HOST="127.0.0.1"
export INPUT_LISTEN_PORT="8080"
export INPUT_INSTALL_CERTIFICATE="true"
export INPUT_PASSPHRASE="your-test-passphrase"
export RUNNER_TEMP="/tmp"

# Install dependencies
npm install

# Build the action
npm run build

# Start mitmproxy (pre action)
node dist/pre/index.js

# Test proxy
curl -x http://127.0.0.1:8080 http://httpbin.org/get

# Stop and upload (post action)
node dist/post/index.js
```

On Windows PowerShell:
```powershell
# Set up environment variables
$env:INPUT_ENABLED = "true"
$env:INPUT_LISTEN_HOST = "127.0.0.1"
$env:INPUT_LISTEN_PORT = "8080"
$env:INPUT_INSTALL_CERTIFICATE = "true"
$env:INPUT_PASSPHRASE = "your-test-passphrase"
$env:RUNNER_TEMP = "$env:TEMP"

# Install dependencies
npm install

# Build the action
npm run build

# Start mitmproxy (pre action)
node dist/pre/index.js

# Test proxy
Invoke-WebRequest -Uri "http://httpbin.org/get" -Proxy "http://127.0.0.1:8080" -UseBasicParsing

# Stop and upload (post action)  
node dist/post/index.js
```

## License

This project is licensed under the MIT License.
