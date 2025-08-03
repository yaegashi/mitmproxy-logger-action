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
      core.saveState('enabled', enabled);
      core.saveState('listen-host', listenHost);
      core.saveState('listen-port', listenPort);
      core.info('mitmproxy setup completed, main action will set outputs');
    } else {
      core.saveState('enabled', 'false');
      core.info('mitmproxy is disabled');
    }
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();