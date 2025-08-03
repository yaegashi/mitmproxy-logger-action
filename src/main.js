const core = require('@actions/core');
const path = require('path');
const fs = require('fs');

async function run() {
  try {
    // Main action - read state from pre action and set outputs
    const enabled = core.getState('enabled') || core.getInput('enabled') || 'true';
    
    if (enabled === 'true') {
      core.info('mitmproxy is running and capturing traffic...');
      
      // Read the proxy configuration from state (set by pre action)
      const listenHost = core.getState('listen-host') || core.getInput('listen-host') || '127.0.0.1';
      const listenPort = core.getState('listen-port') || core.getInput('listen-port') || '8080';
      
      try {
        const workspaceDir = process.env.GITHUB_WORKSPACE;
        const trafficDir = path.join(workspaceDir, 'mitmproxy-traffic');
        
        // Wait a moment for the script to finish writing files (if it hasn't already)
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
        core.warning(`Could not read traffic file state: ${error.message}`);
        // Set basic outputs even if we can't read the traffic file
        const proxyUrl = `http://${listenHost}:${listenPort}`;
        core.setOutput('proxy-url', proxyUrl);
        core.setOutput('traffic-file', '');
        core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=`);
      }
      
      core.info('Traffic will be automatically uploaded when the action completes.');
    } else {
      core.info('mitmproxy is disabled.');
      // Set empty outputs when disabled
      core.setOutput('proxy-url', '');
      core.setOutput('traffic-file', '');
    }
  } catch (error) {
    core.setFailed(`Main action failed: ${error.message}`);
  }
}

run();