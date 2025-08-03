const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');
const fs = require('fs');

async function run() {
  try {
    // This is the pre action - install and start mitmproxy
    const enabled = core.getInput('enabled') || 'true';
    const listenHost = core.getInput('listen-host') || '127.0.0.1';
    const listenPort = core.getInput('listen-port') || '8080';
    const passphrase = core.getInput('passphrase');

    // Get the action path and run the start script
    // When running in GitHub Actions, GITHUB_ACTION_PATH points to the action root
    // When building/testing locally, we need to go up from dist/pre to the repository root
    const actionPath = process.env.GITHUB_ACTION_PATH || path.resolve(__dirname, '..', '..');
    const scriptPath = path.join(actionPath, 'scripts', 'start.sh');
    
    // Pass environment variables to the script, especially GITHUB_OUTPUT
    await exec.exec('bash', [scriptPath], {
      env: {
        ...process.env,
        INPUT_ENABLED: enabled,
        INPUT_LISTEN_HOST: listenHost,
        INPUT_LISTEN_PORT: listenPort,
        INPUT_PASSPHRASE: passphrase
      }
    });
    
    // Save state for main action to set outputs (outputs from pre are not accessible in workflows)
    if (enabled === 'true') {
      // Save inputs as state so main can access them
      core.saveState('mitmproxy-enabled', enabled);
      core.saveState('mitmproxy-listen-host', listenHost);
      core.saveState('mitmproxy-listen-port', listenPort);
      
      // Read the temporary directory path directly from RUNNER_TEMP
      const runnerTemp = process.env.RUNNER_TEMP;
      if (runnerTemp) {
        const tempDir = path.join(runnerTemp, 'mitmproxy-action-traffic');
        core.saveState('mitmproxy-temp-dir', tempDir);
        core.info(`Saved temporary traffic directory: ${tempDir}`);
        
        // Wait a moment for the script to finish writing files
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Read and save additional file paths from the temporary directory
        try {
          const trafficFilePath = path.join(tempDir, 'traffic_file_path.txt');
          const pidFilePath = path.join(tempDir, 'mitmdump.pid');
          const proxyUrlPath = path.join(tempDir, 'proxy_url.txt');
          
          if (fs.existsSync(trafficFilePath)) {
            const trafficFile = fs.readFileSync(trafficFilePath, 'utf8').trim();
            core.saveState('mitmproxy-traffic-file', trafficFile);
          }
          
          if (fs.existsSync(pidFilePath)) {
            const pid = fs.readFileSync(pidFilePath, 'utf8').trim();
            core.saveState('mitmproxy-pid', pid);
          }
          
          if (fs.existsSync(proxyUrlPath)) {
            const proxyUrl = fs.readFileSync(proxyUrlPath, 'utf8').trim();
            core.saveState('mitmproxy-proxy-url', proxyUrl);
          }
        } catch (error) {
          core.warning(`Could not read some temporary files: ${error.message}`);
        }
      } else {
        core.warning('RUNNER_TEMP environment variable not available');
      }
      
      core.info('mitmproxy setup completed, main action will set outputs');
    } else {
      core.saveState('mitmproxy-enabled', 'false');
      core.info('mitmproxy is disabled');
    }
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();