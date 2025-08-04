# mitmproxy-logger-action Specification

## Overview

This GitHub Action provides automated HTTP/HTTPS traffic capture using mitmproxy during CI/CD workflows. It handles the complete lifecycle from proxy installation and startup to traffic capture, encryption, and artifact upload.

## Architecture

### Lifecycle Hooks

The action uses GitHub Actions' lifecycle hooks for proper sequencing:

1. **Pre Hook** (`src/pre.js`): Install and start mitmproxy
2. **Main Hook** (`src/main.js`): Set outputs for workflow consumption 
3. **Post Hook** (`src/post.js`): Stop mitmproxy and upload artifacts

### State Management

Communication between lifecycle hooks uses:
- **State API**: `core.saveState()` / `core.getState()` for configuration data
- **File System**: Temporary files in `RUNNER_TEMP` for proxy artifacts
- **Process Management**: PID files for process cleanup

## Core Features

### 1. Proxy Server Management

- **Installation**: Automatic mitmproxy installation via pip if not present
- **Startup**: Background mitmdump process with configurable host/port
- **Cleanup**: Graceful process termination with fallback to force kill

### 2. CA Certificate Installation

The `install-certificate` feature provides automatic CA certificate installation:

#### Supported Platforms

- **Linux (Ubuntu/Debian)**: 
  - Copies certificate to `/usr/local/share/ca-certificates/`
  - Runs `update-ca-certificates` to update system trust store
  
- **macOS**:
  - Adds certificate to System keychain using `security` command
  - Sets trusted root certificate authority status
  
- **Windows**:
  - Imports certificate to Root certificate store using `certutil`
  - Enables system-wide HTTPS interception

#### Environment Variables

Additionally sets environment variables for applications:
- `CURL_HOME`: Specifies the location of `.curlrc` for setting `ssl-no-revoke` (Windows only)

### 3. Stream Capture

- **Format**: Native mitmproxy flow format (.mitm files)
- **Location**: `RUNNER_TEMP/mitmproxy-logger-action/`
- **Conversion**: Automatic HAR format generation for web compatibility
- **Storage**: Timestamped files to avoid conflicts

### 4. Artifact Management

- **Compression**: Password-protected ZIP archive using yazl library
- **Encryption**: Built-in ZIP encryption with passphrase protection
- **Contents**: Stream files (.mitm, .har), logs, CA certificates
- **Upload**: GitHub Actions artifact API for secure storage

## Configuration

### Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable mitmproxy logging |
| `listen-host` | string | `127.0.0.1` | Proxy server bind address |
| `listen-port` | string | `8080` | Proxy server port |
| `install-cacert` | boolean | `true` | Install CA certificate to system trust store |
| `set-envvars` | boolean | `false` | Set proxy environment variables automatically |
| `passphrase` | string | required | Encryption passphrase for artifacts |

### Outputs

| Output | Description |
|--------|-------------|
| `proxy-url` | Full proxy URL (e.g., `http://127.0.0.1:8080`) |
| `stream-file` | Path to captured stream file |
| `cacert-path` | Path to the CA certificate file |

## Implementation Details

### Directory Structure

```
RUNNER_TEMP/mitmproxy-logger-action/
├── stream_YYYYMMDDTHHMMSSZ.mitm         # Stream capture file
├── stream_YYYYMMDDTHHMMSSZ.har          # HAR format conversion
├── mitmdump.log                         # Proxy server logs
├── mitmdump.pid                         # Process ID file
├── mitmproxy-ca-cert.pem               # CA certificate
└── artifacts/                           # Upload staging area
    └── mitmproxy_stream_YYYYMMDDTHHMMSSZ.zip  # Password-protected ZIP
```

### Error Handling

- **Graceful Degradation**: Action continues if certificate installation fails
- **Process Management**: Robust PID-based cleanup with platform-specific handling
- **Artifact Creation**: Empty files created if no traffic captured
- **Logging**: Comprehensive logging for debugging workflow issues

### Security Considerations

- **Local Binding**: Proxy binds to localhost by default for security
- **Encrypted Storage**: All artifacts encrypted using password-protected ZIP format before upload
- **Temporary Cleanup**: Automatic cleanup of sensitive temporary files
- **Certificate Scope**: CA certificates only affect current runner environment

## Development Guidelines

### Building

```bash
npm install
npm run build
```

This creates bundled distributions in `dist/` directory using ncc.

### Testing Locally

Set environment variables and run individual hooks:

```bash
export INPUT_ENABLED="true"
export INPUT_LISTEN_HOST="127.0.0.1" 
export INPUT_LISTEN_PORT="8080"
export INPUT_INSTALL_CACERT="true"
export INPUT_PASSPHRASE="test-passphrase"
export RUNNER_TEMP="/tmp"

# Start proxy
node dist/pre/index.js

# Set outputs  
node dist/main/index.js

# Test stream capture
curl -x http://127.0.0.1:8080 http://httpbin.org/get

# Cleanup and upload
node dist/post/index.js
```

### Platform Testing

Verify certificate installation on each supported platform:

- **Ubuntu**: Check `/usr/local/share/ca-certificates/` and run `update-ca-certificates`
- **macOS**: Verify keychain trust settings with `security find-certificate`
- **Windows**: Check certificate store with `certutil -store Root`

### Dependencies

- `@actions/core`: GitHub Actions runtime API
- `@actions/exec`: Process execution utilities  
- `@actions/artifact`: Artifact upload API
- `yazl`: ZIP archive creation with password protection
- `@vercel/ncc`: Bundling for distribution

## Future Enhancements

### Planned Features

1. **Custom Certificate**: Support for user-provided CA certificates
2. **Traffic Filtering**: Include/exclude patterns for captured requests
3. **Real-time Monitoring**: Live traffic statistics during capture
4. **Multiple Formats**: Additional export formats (PCAP, JSON, etc.)

### API Compatibility

- Maintain backward compatibility for existing workflows
- Use semantic versioning for breaking changes
- Provide migration guides for major version updates

## Troubleshooting

### Common Issues

1. **Certificate Installation Failures**: Usually due to insufficient permissions
2. **Port Conflicts**: Check for existing services on configured port
3. **Process Cleanup**: Orphaned processes may require manual cleanup
4. **Artifact Upload**: Verify GitHub token permissions for artifact operations

### Debug Information

Enable detailed logging by examining:
- Action step logs in GitHub Actions
- `mitmdump.log` in uploaded artifacts
- Process state files in `RUNNER_TEMP`

### Validation

Verify correct operation:
```bash
# Test proxy connectivity
curl -x http://127.0.0.1:8080 http://httpbin.org/get

# Check certificate installation (Linux)
openssl verify -CAfile /usr/local/share/ca-certificates/mitmproxy-ca-cert.crt

# Verify stream capture
ls -la $RUNNER_TEMP/mitmproxy-logger-action/

# Test password-protected ZIP extraction
unzip -P your-passphrase mitmproxy_stream_*.zip
```