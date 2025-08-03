const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function run() {
  try {
    // This is the pre action - install and start mitmproxy
    const enabled = core.getInput('enabled') || 'true';
    const listenHost = core.getInput('listen-host') || '127.0.0.1';
    const listenPort = core.getInput('listen-port') || '8080';
    const passphrase = core.getInput('passphrase');

    // Check if mitmproxy is enabled
    if (enabled !== 'true') {
      core.info('mitmproxy is disabled, skipping...');
      core.saveState('mitmproxy-enabled', 'false');
      return;
    }

    core.info('Starting mitmproxy logger...');

    // Install mitmproxy if not already installed
    try {
      await exec.exec('mitmdump', ['--version'], { silent: true });
      core.info('mitmproxy is already installed');
    } catch (error) {
      core.info('Installing mitmproxy...');
      await exec.exec('pip', ['install', 'mitmproxy']);
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

    const logFd = fs.openSync(logFile, 'a');

    // On Windows, we need to handle process spawning differently
    let mitmdumpProcess;
    if (os.platform() === 'win32') {
      // Use spawn to get the process object for Windows
      const { spawn } = require('child_process');
      mitmdumpProcess = spawn('mitmdump', mitmdumpArgs, {
        detached: false,
        stdio: ['ignore', logFd, logFd]
      });

      // Save the PID for cleanup
      fs.writeFileSync(pidFile, mitmdumpProcess.pid.toString());
    } else {
      // Use exec for Unix systems, redirecting output to log file
      const { spawn } = require('child_process');
      mitmdumpProcess = spawn('mitmdump', mitmdumpArgs, {
        detached: true,
        stdio: ['ignore', logFd, logFd]
      });

      // Save the PID for cleanup
      fs.writeFileSync(pidFile, mitmdumpProcess.pid.toString());
      
      // Unref the process so it doesn't keep the Node.js process alive
      mitmdumpProcess.unref();
    }

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

    // Save outputs for JavaScript to read
    const proxyUrl = `http://${listenHost}:${listenPort}`;

    // Save traffic file path for later use
    fs.writeFileSync(path.join(trafficDir, 'traffic_file_path.txt'), trafficFile);

    // Save proxy URL for JavaScript to read
    fs.writeFileSync(path.join(trafficDir, 'proxy_url.txt'), proxyUrl);

    core.info(`mitmproxy started successfully at ${proxyUrl}`);
    core.info(`PID: ${mitmdumpProcess.pid}`);
    core.info(`Traffic file: ${trafficFile}`);

    // Save state for main action to set outputs (outputs from pre are not accessible in workflows)
    core.saveState('mitmproxy-enabled', enabled);
    core.saveState('mitmproxy-listen-host', listenHost);
    core.saveState('mitmproxy-listen-port', listenPort);
    core.saveState('mitmproxy-temp-dir', trafficDir);
    core.saveState('mitmproxy-traffic-file', trafficFile);
    core.saveState('mitmproxy-pid', mitmdumpProcess.pid.toString());
    core.saveState('mitmproxy-proxy-url', proxyUrl);

    core.info('mitmproxy setup completed, main action will set outputs');
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();