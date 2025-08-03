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
        // First try to get the temporary directory from state
        let trafficDir = core.getState('temp-traffic-dir');
        
        // If not available in state, try to read from workspace communication file, 
        // or construct the expected path
        if (!trafficDir) {
          const workspaceDir = process.env.GITHUB_WORKSPACE;
          const workspaceTrafficDir = path.join(workspaceDir, 'mitmproxy-traffic');
          const tempDirFile = path.join(workspaceTrafficDir, 'temp_dir_path.txt');
          
          if (fs.existsSync(tempDirFile)) {
            trafficDir = fs.readFileSync(tempDirFile, 'utf8').trim();
            core.info(`Found temporary traffic directory: ${trafficDir}`);
          } else {
            // Try to construct the expected path in RUNNER_TEMP
            const runnerTemp = process.env.RUNNER_TEMP;
            if (runnerTemp) {
              trafficDir = path.join(runnerTemp, 'mitmproxy-action-traffic');
              core.info(`Constructed temporary traffic directory: ${trafficDir}`);
            } else {
              // Final fallback to old behavior
              trafficDir = workspaceTrafficDir;
              core.warning(`Could not find temporary directory path, falling back to: ${trafficDir}`);
            }
          }
        } else {
          core.info(`Using temporary traffic directory from state: ${trafficDir}`);
        }
        
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
        
        // Read PID and save as state for post action
        const pidFilePath = path.join(trafficDir, 'mitmdump.pid');
        let mitmproxyPid = '';
        if (fs.existsSync(pidFilePath)) {
          mitmproxyPid = fs.readFileSync(pidFilePath, 'utf8').trim();
          core.saveState('mitmdump-pid', mitmproxyPid);
          core.info(`Saved mitmdump PID: ${mitmproxyPid}`);
        } else {
          core.warning(`PID file not found at: ${pidFilePath}`);
        }
        
        // Read traffic file path and save as state for post action
        const trafficFilePath = path.join(trafficDir, 'traffic_file_path.txt');
        let trafficFile = '';
        if (fs.existsSync(trafficFilePath)) {
          trafficFile = fs.readFileSync(trafficFilePath, 'utf8').trim();
          core.saveState('traffic-file', trafficFile);
          core.setOutput('traffic-file', trafficFile);
          core.info(`Saved traffic file path: ${trafficFile}`);
        } else {
          core.warning(`Traffic file path not found at: ${trafficFilePath}`);
          // Try to find any .mitm files in the traffic directory as fallback
          if (fs.existsSync(trafficDir)) {
            const mitmFiles = fs.readdirSync(trafficDir).filter(f => f.endsWith('.mitm'));
            if (mitmFiles.length > 0) {
              trafficFile = path.join(trafficDir, mitmFiles[0]);
              core.saveState('traffic-file', trafficFile);
              core.setOutput('traffic-file', trafficFile);
              core.info(`Found and saved traffic file: ${trafficFile}`);
            } else {
              core.setOutput('traffic-file', '');
            }
          } else {
            core.setOutput('traffic-file', '');
          }
        }
        
        // Save traffic directory path as well for post action
        core.saveState('traffic-dir', trafficDir);
        
        core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=${trafficFile}`);
      } catch (error) {
        core.warning(`Could not set outputs from traffic files: ${error.message}`);
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