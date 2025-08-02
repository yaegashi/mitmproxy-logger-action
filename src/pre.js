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

    // Set environment variables for the script
    process.env.INPUT_ENABLED = enabled;
    process.env.INPUT_LISTEN_HOST = listenHost;
    process.env.INPUT_LISTEN_PORT = listenPort;
    process.env.INPUT_PASSPHRASE = passphrase;

    // Get the action path and run the start script
    // When running in GitHub Actions, GITHUB_ACTION_PATH points to the action root
    // When building/testing locally, we need to go up from dist/pre to the repository root
    const actionPath = process.env.GITHUB_ACTION_PATH || path.resolve(__dirname, '..', '..');
    const scriptPath = path.join(actionPath, 'scripts', 'start.sh');
    
    await exec.exec('bash', [scriptPath]);
    
    // Read the outputs that the script wrote and set them properly for GitHub Actions
    if (enabled === 'true') {
      try {
        const workspaceDir = process.env.GITHUB_WORKSPACE;
        const trafficDir = path.join(workspaceDir, 'mitmproxy-traffic');
        
        // Read traffic file path and save as state for post action
        const trafficFilePath = path.join(trafficDir, 'traffic_file_path.txt');
        if (fs.existsSync(trafficFilePath)) {
          const trafficFile = fs.readFileSync(trafficFilePath, 'utf8').trim();
          core.saveState('traffic-file', trafficFile);
          core.setOutput('traffic-file', trafficFile);
        }
        
        // Set the proxy URL output (the script creates this but we need to set it properly)
        const proxyUrl = `http://${listenHost}:${listenPort}`;
        core.setOutput('proxy-url', proxyUrl);
        
        core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=${fs.existsSync(trafficFilePath) ? fs.readFileSync(trafficFilePath, 'utf8').trim() : 'not found'}`);
      } catch (error) {
        core.warning(`Could not save traffic file state: ${error.message}`);
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