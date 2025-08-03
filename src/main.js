const core = require('@actions/core');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function run() {
  try {
    // Main action - read state from pre action and set outputs
    const enabled = core.getState('mitmproxy-enabled') || core.getInput('enabled') || 'true';
    
    if (enabled === 'true') {
      core.info('mitmproxy is running and capturing traffic...');
      
      // Read the proxy configuration from state (set by pre action)
      const listenHost = core.getState('mitmproxy-listen-host') || core.getInput('listen-host') || '127.0.0.1';
      const listenPort = core.getState('mitmproxy-listen-port') || core.getInput('listen-port') || '8080';
      const setEnvvars = core.getState('mitmproxy-set-envvars') || core.getInput('set-envvars') || 'false';
      
      // Set environment variables if requested (moved from pre step to main step)
      if (setEnvvars === 'true') {
        const proxyUrl = `http://${listenHost}:${listenPort}`;
        core.info('Setting proxy environment variables...');
        core.exportVariable('http_proxy', proxyUrl);
        core.exportVariable('https_proxy', proxyUrl);
        
        // For Windows, set CURL_HOME and create .curlrc with ssl-no-revoke
        if (os.platform() === 'win32') {
          const trafficDir = core.getState('mitmproxy-temp-dir');
          if (trafficDir) {
            core.exportVariable('CURL_HOME', trafficDir);
            const curlrcPath = path.join(trafficDir, '.curlrc');
            fs.writeFileSync(curlrcPath, 'ssl-no-revoke\n');
            core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}, CURL_HOME=${trafficDir}`);
            core.info(`Created .curlrc file at: ${curlrcPath}`);
          } else {
            core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}`);
          }
        } else {
          core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}`);
        }
      }
      
      try {
        // Get the temporary directory from state
        let trafficDir = core.getState('mitmproxy-temp-dir');
        
        // If not available in state, construct the expected path in RUNNER_TEMP
        if (!trafficDir) {
          const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
          trafficDir = path.join(runnerTemp, 'mitmproxy-action-traffic');
          core.info(`Constructed temporary traffic directory: ${trafficDir}`);
        } else {
          core.info(`Using temporary traffic directory from state: ${trafficDir}`);
        }
        
        // Get proxy URL from state or construct it
        let proxyUrl = core.getState('mitmproxy-proxy-url');
        if (!proxyUrl) {
          proxyUrl = `http://${listenHost}:${listenPort}`;
        }
        core.setOutput('proxy-url', proxyUrl);
        
        // Get traffic file from state
        let trafficFile = core.getState('mitmproxy-traffic-file');
        if (!trafficFile) {
          // Fallback: look for any .mitm files in the traffic directory
          if (fs.existsSync(trafficDir)) {
            const mitmFiles = fs.readdirSync(trafficDir).filter(f => f.endsWith('.mitm'));
            if (mitmFiles.length > 0) {
              trafficFile = path.join(trafficDir, mitmFiles[0]);
              core.info(`Found traffic file: ${trafficFile}`);
            }
          }
        }
        
        if (trafficFile) {
          core.setOutput('traffic-file', trafficFile);
          core.info(`Set traffic file output: ${trafficFile}`);
        } else {
          core.setOutput('traffic-file', '');
          core.warning('No traffic file found');
        }
        
        // Get CA certificate path from state
        const cacertPath = core.getState('mitmproxy-cacert-path') || '';
        core.setOutput('cacert-path', cacertPath);
        if (cacertPath) {
          core.info(`Set CA certificate path output: ${cacertPath}`);
        } else {
          core.info('No CA certificate path available');
        }
        
        core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=${trafficFile || ''}, cacert-path=${cacertPath}`);
      } catch (error) {
        core.warning(`Could not set outputs from state: ${error.message}`);
        // Set basic outputs even if we can't read the traffic file
        const proxyUrl = `http://${listenHost}:${listenPort}`;
        core.setOutput('proxy-url', proxyUrl);
        core.setOutput('traffic-file', '');
        core.setOutput('cacert-path', '');
        core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=, cacert-path=`);
      }
      
      core.info('Traffic will be automatically uploaded when the action completes.');
    } else {
      core.info('mitmproxy is disabled.');
      // Set empty outputs when disabled
      core.setOutput('proxy-url', '');
      core.setOutput('traffic-file', '');
      core.setOutput('cacert-path', '');
    }
  } catch (error) {
    core.setFailed(`Main action failed: ${error.message}`);
  }
}

run();