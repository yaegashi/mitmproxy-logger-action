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
      
      // Try to read the temporary directory path from the communication file
      try {
        const fs = require('fs');
        const path = require('path');
        const workspaceDir = process.env.GITHUB_WORKSPACE;
        const workspaceTrafficDir = path.join(workspaceDir, 'mitmproxy-traffic');
        const tempDirFile = path.join(workspaceTrafficDir, 'temp_dir_path.txt');
        
        // Give the script time to write the file
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (fs.existsSync(tempDirFile)) {
          const tempDir = fs.readFileSync(tempDirFile, 'utf8').trim();
          core.saveState('temp-traffic-dir', tempDir);
          core.info(`Saved temporary traffic directory: ${tempDir}`);
        } else {
          core.warning(`Temporary directory path file not found: ${tempDirFile}`);
        }
      } catch (error) {
        core.warning(`Could not read temporary directory path: ${error.message}`);
      }
      
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