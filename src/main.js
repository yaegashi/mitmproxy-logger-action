const core = require('@actions/core');

async function run() {
  try {
    // Main action - this just logs that mitmproxy is running
    const enabled = core.getInput('enabled') || 'true';
    
    if (enabled === 'true') {
      core.info('mitmproxy is running and capturing traffic...');
      core.info('Traffic will be automatically uploaded when the action completes.');
    } else {
      core.info('mitmproxy is disabled.');
    }
  } catch (error) {
    core.setFailed(`Main action failed: ${error.message}`);
  }
}

run();