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
    
    // The bash script sets outputs via $GITHUB_OUTPUT
    // We also set them via core.setOutput() as a fallback to ensure they're available
    if (enabled === 'true') {
      try {
        const workspaceDir = process.env.GITHUB_WORKSPACE;
        const trafficDir = path.join(workspaceDir, 'mitmproxy-traffic');
        
        // Wait a moment for the script to finish writing files
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Set the proxy URL output by reading from the file created by the script
        const proxyUrlPath = path.join(trafficDir, 'proxy_url.txt');
        let proxyUrl = '';
        
        if (fs.existsSync(proxyUrlPath)) {
          proxyUrl = fs.readFileSync(proxyUrlPath, 'utf8').trim();
        } else {
          // Fallback to constructing the URL if file doesn't exist
          proxyUrl = `http://${listenHost}:${listenPort}`;
        }
        core.setOutput('proxy-url', proxyUrl);
        
        // Read traffic file path and save as state for post action
        const trafficFilePath = path.join(trafficDir, 'traffic_file_path.txt');
        if (fs.existsSync(trafficFilePath)) {
          const trafficFile = fs.readFileSync(trafficFilePath, 'utf8').trim();
          core.saveState('traffic-file', trafficFile);
          core.setOutput('traffic-file', trafficFile);
          core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=${trafficFile}`);
        } else {
          core.warning(`Traffic file path not found at: ${trafficFilePath}`);
          core.setOutput('traffic-file', '');
          core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=`);
        }
      } catch (error) {
        core.warning(`Could not save traffic file state: ${error.message}`);
        // Set basic outputs even if we can't read the traffic file
        const proxyUrl = `http://${listenHost}:${listenPort}`;
        core.setOutput('proxy-url', proxyUrl);
        core.setOutput('traffic-file', '');
      }
    } else {
      // Set empty outputs when disabled
      core.setOutput('proxy-url', '');
      core.setOutput('traffic-file', '');
    }
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();