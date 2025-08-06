const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Bundle test mode detection - exit after requires if in test mode
if (process.argv.includes('--bundle-test') || process.env.BUNDLE_TEST === '1') {
  console.log('Bundle test mode: all requires completed successfully');
  process.exit(0);
}

async function waitForCACertificate(certPath, maxAttempts = 10, delayMs = 1000) {
  let attempts = 0;
  while (!fs.existsSync(certPath) && attempts < maxAttempts) {
    core.info(`Waiting for CA certificate to be generated... (attempt ${attempts + 1}/${maxAttempts})`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    attempts++;
  }
  return fs.existsSync(certPath);
}

async function installMitmproxyCertificate(mitmproxyDir) {
  try {
    const certPath = path.join(mitmproxyDir, 'mitmproxy-ca-cert.pem');

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

    return certPath;
  } catch (error) {
    core.warning(`Certificate installation failed: ${error.message}`);
    return '';
  }
}

async function downloadStandaloneMitmproxy() {
  const platform = os.platform();
  const arch = os.arch();
  
  core.info(`Detected platform: ${platform}, architecture: ${arch}`);
  
  // Create directory in RUNNER_TEMP for mitmproxy standalone
  const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
  const mitmproxyStandaloneDir = path.join(runnerTemp, 'mitmproxy-standalone');
  fs.mkdirSync(mitmproxyStandaloneDir, { recursive: true });
  
  let downloadUrl;
  let fileName;
  let executableName = 'mitmdump';
  
  // Try to get the latest version first, fallback to known stable version
  let version = '10.4.2'; // Fallback version
  try {
    core.info('Attempting to get latest mitmproxy version...');
    let latestVersionOutput = '';
    await exec.exec('curl', ['-s', 'https://api.github.com/repos/mitmproxy/mitmproxy/releases/latest'], {
      listeners: {
        stdout: (data) => {
          latestVersionOutput += data.toString();
        }
      },
      ignoreReturnCode: true
    });
    
    if (latestVersionOutput) {
      const releaseData = JSON.parse(latestVersionOutput);
      if (releaseData.tag_name) {
        version = releaseData.tag_name.replace('v', '');
        core.info(`Found latest version: ${version}`);
      }
    }
  } catch (error) {
    core.info(`Could not fetch latest version, using fallback: ${version}`);
  }
  
  // Determine download URL based on platform
  if (platform === 'linux') {
    if (arch === 'x64') {
      downloadUrl = `https://snapshots.mitmproxy.org/${version}/mitmproxy-${version}-linux-x86_64.tar.gz`;
      fileName = `mitmproxy-${version}-linux-x86_64.tar.gz`;
    } else {
      throw new Error(`Unsupported Linux architecture: ${arch}`);
    }
  } else if (platform === 'darwin') {
    downloadUrl = `https://snapshots.mitmproxy.org/${version}/mitmproxy-${version}-macos-x86_64.tar.gz`;
    fileName = `mitmproxy-${version}-macos-x86_64.tar.gz`;
  } else if (platform === 'win32') {
    downloadUrl = `https://snapshots.mitmproxy.org/${version}/mitmproxy-${version}-windows-x86_64.zip`;
    fileName = `mitmproxy-${version}-windows-x86_64.zip`;
    executableName = 'mitmdump.exe';
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  
  const downloadPath = path.join(mitmproxyStandaloneDir, fileName);
  
  core.info(`Downloading mitmproxy ${version} standalone from: ${downloadUrl}`);
  
  // Download using curl with retry
  try {
    await exec.exec('curl', ['-L', '-o', downloadPath, downloadUrl, '--fail', '--retry', '3']);
  } catch (error) {
    core.warning(`Failed to download from snapshots URL, trying GitHub releases...`);
    // Fallback to GitHub releases
    const githubUrl = `https://github.com/mitmproxy/mitmproxy/releases/download/v${version}/${fileName}`;
    core.info(`Trying GitHub releases URL: ${githubUrl}`);
    await exec.exec('curl', ['-L', '-o', downloadPath, githubUrl, '--fail', '--retry', '3']);
  }
  
  core.info(`Downloaded to: ${downloadPath}`);
  
  // Verify download
  const stats = fs.statSync(downloadPath);
  core.info(`Download size: ${stats.size} bytes`);
  if (stats.size < 1024) {
    throw new Error('Downloaded file is too small, likely an error page');
  }
  
  // Extract based on file type
  if (fileName.endsWith('.tar.gz')) {
    await exec.exec('tar', ['-xzf', downloadPath, '-C', mitmproxyStandaloneDir]);
  } else if (fileName.endsWith('.zip')) {
    // On Windows, use PowerShell to extract ZIP
    if (platform === 'win32') {
      await exec.exec('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -Path '${downloadPath}' -DestinationPath '${mitmproxyStandaloneDir}' -Force`
      ]);
    } else {
      await exec.exec('unzip', ['-o', downloadPath, '-d', mitmproxyStandaloneDir]);
    }
  }
  
  // Find the mitmdump executable
  const extractedFiles = fs.readdirSync(mitmproxyStandaloneDir);
  let mitmdumpPath = null;
  
  // Look for mitmdump directly or in subdirectories
  for (const item of extractedFiles) {
    const itemPath = path.join(mitmproxyStandaloneDir, item);
    if (fs.statSync(itemPath).isDirectory()) {
      const subFiles = fs.readdirSync(itemPath);
      if (subFiles.includes(executableName)) {
        mitmdumpPath = path.join(itemPath, executableName);
        break;
      }
    } else if (item === executableName) {
      mitmdumpPath = itemPath;
      break;
    }
  }
  
  if (!mitmdumpPath) {
    // Try a more extensive search
    core.info('Primary search failed, doing recursive search...');
    const findRecursive = (dir, targetName) => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          const result = findRecursive(fullPath, targetName);
          if (result) return result;
        } else if (item === targetName) {
          return fullPath;
        }
      }
      return null;
    };
    
    mitmdumpPath = findRecursive(mitmproxyStandaloneDir, executableName);
  }
  
  if (!mitmdumpPath) {
    core.info(`Available files: ${JSON.stringify(extractedFiles, null, 2)}`);
    throw new Error(`Could not find ${executableName} in extracted files`);
  }
  
  // Make executable on Unix systems
  if (platform !== 'win32') {
    await exec.exec('chmod', ['+x', mitmdumpPath]);
  }
  
  core.info(`mitmproxy standalone installed at: ${mitmdumpPath}`);
  
  // Verify installation
  await exec.exec(mitmdumpPath, ['--version']);
  
  return mitmdumpPath;
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

    // Download and install standalone mitmproxy
    let mitmdumpPath;
    try {
      core.info('Installing mitmproxy standalone version...');
      mitmdumpPath = await downloadStandaloneMitmproxy();
    } catch (error) {
      core.setFailed(`Failed to install mitmproxy standalone: ${error.message}`);
      return;
    }

    // Create directory in RUNNER_TEMP to avoid workspace cleanup issues
    const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
    const mitmproxyDir = path.join(runnerTemp, 'mitmproxy-logger-action');

    fs.mkdirSync(mitmproxyDir, { recursive: true });

    // Generate stream file name with timestamp
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const streamFile = path.join(mitmproxyDir, `stream_${timestamp}.mitm`);

    // Start mitmdump in background
    core.info(`Starting mitmdump on ${listenHost}:${listenPort}`);
    core.info(`Traffic will be saved to: ${streamFile}`);

    const logFile = path.join(mitmproxyDir, 'mitmdump.log');
    const pidFile = path.join(mitmproxyDir, 'mitmdump.pid');

    // Start mitmdump with flow file output
    const mitmdumpArgs = [
      '--listen-host', listenHost,
      '--listen-port', listenPort,
      '--save-stream-file', streamFile,
      '--set', `confdir=${mitmproxyDir}`
    ];

    // Open log file for mitmdump stdout and stderr
    const logFd = fs.openSync(logFile, 'a');

    // Spawn mitmdump process using the standalone binary path
    const mitmdumpProcess = spawn(mitmdumpPath, mitmdumpArgs, {
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
      certPath = await installMitmproxyCertificate(mitmproxyDir);
    } else {
      // Even if not installing, the certificate might still be generated by mitmproxy
      const potentialCertPath = path.join(mitmproxyDir, 'mitmproxy-ca-cert.pem');
      // Wait to see if certificate is generated
      const certificateFound = await waitForCACertificate(potentialCertPath, 5, 1000);
      if (certificateFound) {
        certPath = potentialCertPath;
        core.info(`CA certificate generated at: ${certPath} (not installed)`);
      }
    }

    // Save outputs for JavaScript to read
    const proxyUrl = `http://${listenHost}:${listenPort}`;

    core.info(`mitmproxy started successfully at ${proxyUrl}`);
    core.info(`PID: ${mitmdumpProcess.pid}`);
    core.info(`Stream file: ${streamFile}`);

    // Save state for main action to set outputs (outputs from pre are not accessible in workflows)
    core.saveState('mitmproxy-enabled', enabled);
    core.saveState('mitmproxy-listen-host', listenHost);
    core.saveState('mitmproxy-listen-port', listenPort);
    core.saveState('mitmproxy-install-cacert', installCacert);
    core.saveState('mitmproxy-set-envvars', setEnvvars);
    core.saveState('mitmproxy-dir', mitmproxyDir);
    core.saveState('mitmproxy-stream-file', streamFile);
    core.saveState('mitmproxy-pid', mitmdumpProcess.pid.toString());
    core.saveState('mitmproxy-proxy-url', proxyUrl);
    core.saveState('mitmproxy-cacert-path', certPath);
    core.saveState('mitmproxy-binary-path', mitmdumpPath);

    core.info('mitmproxy setup completed, main action will set outputs');
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();