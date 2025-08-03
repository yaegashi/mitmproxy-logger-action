const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function waitForCACertificate(certPath, maxAttempts = 10, delayMs = 1000) {
  let attempts = 0;
  while (!fs.existsSync(certPath) && attempts < maxAttempts) {
    core.info(`Waiting for CA certificate to be generated... (attempt ${attempts + 1}/${maxAttempts})`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    attempts++;
  }
  return fs.existsSync(certPath);
}

async function installMitmproxyCertificate(trafficDir) {
  try {
    const certPath = path.join(trafficDir, 'mitmproxy-ca-cert.pem');

    // Wait for certificate to be generated
    const certificateFound = await waitForCACertificate(certPath, 10, 1000);

    if (!certificateFound) {
      core.warning('mitmproxy CA certificate not found, skipping installation');
      return '';
    }

    core.info(`Found CA certificate at: ${certPath}`);

    // Install certificate based on platform
    const platform = os.platform();

    if (platform === 'linux') {
      // Ubuntu/Debian - copy to ca-certificates directory
      try {
        let targetDir;
        if (fs.existsSync('/usr/local/share/ca-certificates/')) {
          targetDir = '/usr/local/share/ca-certificates/';
        } else if (fs.existsSync('/etc/ssl/certs/')) {
          targetDir = '/etc/ssl/certs/';
        } else {
          core.warning('No suitable CA certificates directory found on Linux. Skipping certificate installation.');
          return certPath;
        }
        const targetPath = path.join(targetDir, 'mitmproxy-ca-cert.crt');
        await exec.exec('sudo', ['cp', certPath, targetPath], { ignoreReturnCode: true });
        // Only run update-ca-certificates if using the Debian/Ubuntu directory
        if (targetDir === '/usr/local/share/ca-certificates/') {
          await exec.exec('sudo', ['update-ca-certificates'], { ignoreReturnCode: true });
        }
        core.info('Successfully installed CA certificate on Linux');
      } catch (error) {
        core.warning(`Failed to install CA certificate on Linux: ${error.message}`);
      }
    } else if (platform === 'darwin') {
      // macOS - add to keychain
      try {
        // Use the user's login keychain instead of the system keychain, and do not use sudo
        await exec.exec('security', ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', `${os.homedir()}/Library/Keychains/login.keychain-db`, certPath], { ignoreReturnCode: true });
        core.info('Successfully installed CA certificate on macOS (user keychain)');
      } catch (error) {
        core.warning(`Failed to install CA certificate on macOS: ${error.message}`);
      }
    } else if (platform === 'win32') {
      // Windows - add to certificate store
      try {
        await exec.exec('powershell', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
          `@('LocalMachine', 'CurrentUser') | ForEach-Object { Import-Certificate -FilePath '${certPath}' -CertStoreLocation "Cert:\\$_\\Root" -Confirm:$false }`
        ], { ignoreReturnCode: true });
        core.info('Successfully installed CA certificate on Windows');
      } catch (error) {
        core.warning(`Failed to install CA certificate on Windows: ${error.message}`);
      }
    } else {
      core.warning(`Certificate installation not supported on platform: ${platform}`);
    }

    // Also set environment variable for applications that respect it
    core.exportVariable('REQUESTS_CA_BUNDLE', certPath);
    core.exportVariable('SSL_CERT_FILE', certPath);
    core.info('Set CA certificate environment variables');

    return certPath;
  } catch (error) {
    core.warning(`Certificate installation failed: ${error.message}`);
    return '';
  }
}

async function run() {
  try {
    // This is the pre action - install and start mitmproxy
    const enabled = core.getInput('enabled') || 'true';
    const listenHost = core.getInput('listen-host') || '127.0.0.1';
    const listenPort = core.getInput('listen-port') || '8080';
    const installCacert = core.getInput('install-cacert') || 'true';
    const setEnvvars = core.getInput('set-envvars') || 'true';

    // Check if mitmproxy is enabled
    if (enabled !== 'true') {
      core.info('mitmproxy is disabled, skipping...');
      core.saveState('mitmproxy-enabled', 'false');
      core.saveState('mitmproxy-install-cacert', installCacert);
      core.saveState('mitmproxy-set-envvars', setEnvvars);
      return;
    }

    core.info('Starting mitmproxy logger...');

    // Install mitmproxy if not already installed
    try {
      await exec.exec('mitmdump', ['--version'], { silent: true });
      core.info('mitmproxy is already installed');
    } catch (error) {
      core.info('Installing mitmproxy...');
      await exec.exec('pip', ['install', '--upgrade', 'mitmproxy']);
    }

    // Create traffic directory in RUNNER_TEMP to avoid workspace cleanup issues
    const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
    const trafficDir = path.join(runnerTemp, 'mitmproxy-action-traffic');

    fs.mkdirSync(trafficDir, { recursive: true });

    // Generate traffic file name with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const trafficFile = path.join(trafficDir, `traffic_${timestamp}.mitm`);

    // Start mitmdump in background
    core.info(`Starting mitmdump on ${listenHost}:${listenPort}`);
    core.info(`Traffic will be saved to: ${trafficFile}`);

    const logFile = path.join(trafficDir, 'mitmdump.log');
    const pidFile = path.join(trafficDir, 'mitmdump.pid');

    // Start mitmdump with flow file output
    const mitmdumpArgs = [
      '--listen-host', listenHost,
      '--listen-port', listenPort,
      '--save-stream-file', trafficFile,
      '--set', `confdir=${trafficDir}`
    ];

    // Open log file for mitmdump stdout and stderr
    const logFd = fs.openSync(logFile, 'a');

    // Spawn mitmdump process
    const { spawn } = require('child_process');
    const mitmdumpProcess = spawn('mitmdump', mitmdumpArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });

    // Save the PID for cleanup
    fs.writeFileSync(pidFile, mitmdumpProcess.pid.toString());

    // Unref the process so it doesn't keep the Node.js process alive
    mitmdumpProcess.unref();

    // Close the log file descriptor to avoid leaks
    fs.closeSync(logFd);

    // Wait a moment for the proxy to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if the process is still running
    if (mitmdumpProcess.killed || mitmdumpProcess.exitCode !== null) {
      core.error('Failed to start mitmdump. Check logs:');
      if (fs.existsSync(logFile)) {
        const logs = fs.readFileSync(logFile, 'utf8');
        core.error(logs);
      }
      throw new Error('Failed to start mitmdump');
    }

    // Install CA certificate if requested
    let certPath = null;
    if (installCacert === 'true') {
      core.info('Installing mitmproxy CA certificate...');
      certPath = await installMitmproxyCertificate(trafficDir);
    } else {
      // Even if not installing, the certificate might still be generated by mitmproxy
      const potentialCertPath = path.join(trafficDir, 'mitmproxy-ca-cert.pem');
      // Wait to see if certificate is generated
      const certificateFound = await waitForCACertificate(potentialCertPath, 5, 1000);
      if (certificateFound) {
        certPath = potentialCertPath;
        core.info(`CA certificate generated at: ${certPath} (not installed)`);
      }
    }

    // Save outputs for JavaScript to read
    const proxyUrl = `http://${listenHost}:${listenPort}`;

    // Set environment variables if requested
    if (setEnvvars === 'true') {
      core.info('Setting proxy environment variables...');
      core.exportVariable('http_proxy', proxyUrl);
      core.exportVariable('https_proxy', proxyUrl);
      
      // Only set CURL_OPTIONS on Windows
      if (os.platform() === 'win32') {
        core.exportVariable('CURL_OPTIONS', '--ssl-no-revoke');
        core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}, CURL_OPTIONS=--ssl-no-revoke`);
      } else {
        core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}`);
      }
    }

    // Traffic file path and proxy URL are saved in state for later use

    core.info(`mitmproxy started successfully at ${proxyUrl}`);
    core.info(`PID: ${mitmdumpProcess.pid}`);
    core.info(`Traffic file: ${trafficFile}`);

    // Save state for main action to set outputs (outputs from pre are not accessible in workflows)
    core.saveState('mitmproxy-enabled', enabled);
    core.saveState('mitmproxy-listen-host', listenHost);
    core.saveState('mitmproxy-listen-port', listenPort);
    core.saveState('mitmproxy-install-cacert', installCacert);
    core.saveState('mitmproxy-set-envvars', setEnvvars);
    core.saveState('mitmproxy-temp-dir', trafficDir);
    core.saveState('mitmproxy-traffic-file', trafficFile);
    core.saveState('mitmproxy-pid', mitmdumpProcess.pid.toString());
    core.saveState('mitmproxy-proxy-url', proxyUrl);
    core.saveState('mitmproxy-cacert-path', certPath);

    core.info('mitmproxy setup completed, main action will set outputs');
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();