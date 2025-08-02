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
    const actionPath = process.env.GITHUB_ACTION_PATH || path.resolve(__dirname, '..');
    const scriptPath = path.join(actionPath, 'scripts', 'start.sh');
    
    await exec.exec('bash', [scriptPath]);
    
    // The script writes to $GITHUB_OUTPUT which is handled automatically by Actions
    // But we need to save traffic file for the post action
    if (enabled === 'true') {
      try {
        const workspaceDir = process.env.GITHUB_WORKSPACE;
        const trafficFilePath = path.join(workspaceDir, 'mitmproxy-traffic', 'traffic_file_path.txt');
        if (fs.existsSync(trafficFilePath)) {
          const trafficFile = fs.readFileSync(trafficFilePath, 'utf8').trim();
          core.saveState('traffic-file', trafficFile);
        }
      } catch (error) {
        core.warning(`Could not save traffic file state: ${error.message}`);
      }
    }
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();