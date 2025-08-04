const core = require('@actions/core');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Bundle test mode detection - exit after requires if in test mode
if (process.argv.includes('--bundle-test') || process.env.BUNDLE_TEST === '1') {
  console.log('Bundle test mode: all requires completed successfully');
  process.exit(0);
}

async function run() {
  try {
    // Main action - read state from pre action and set outputs
    const enabled = core.getState('mitmproxy-enabled') || core.getInput('enabled') || 'true';
    
    if (enabled === 'true') {
      core.info('mitmproxy is running and capturing stream...');
      
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
          const mitmproxyDir = core.getState('mitmproxy-dir');
          if (mitmproxyDir) {
            core.exportVariable('CURL_HOME', mitmproxyDir);
            const curlrcPath = path.join(mitmproxyDir, '.curlrc');
            fs.writeFileSync(curlrcPath, 'ssl-no-revoke\n');
            core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}, CURL_HOME=${mitmproxyDir}`);
            core.info(`Created .curlrc file at: ${curlrcPath}`);
          } else {
            core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}`);
          }
        } else {
          core.info(`Set environment variables: http_proxy=${proxyUrl}, https_proxy=${proxyUrl}`);
        }
      }
      
      try {
        // Get the directory from state
        let mitmproxyDir = core.getState('mitmproxy-dir');
        
        // If not available in state, construct the expected path in RUNNER_TEMP
        if (!mitmproxyDir) {
          const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
          mitmproxyDir = path.join(runnerTemp, 'mitmproxy-logger-action');
          core.info(`Constructed mitmproxy directory: ${mitmproxyDir}`);
        } else {
          core.info(`Using mitmproxy directory from state: ${mitmproxyDir}`);
        }
        
        // Get proxy URL from state or construct it
        let proxyUrl = core.getState('mitmproxy-proxy-url');
        if (!proxyUrl) {
          proxyUrl = `http://${listenHost}:${listenPort}`;
        }
        core.setOutput('proxy-url', proxyUrl);
        
        // Get stream file from state
        let streamFile = core.getState('mitmproxy-stream-file');
        if (!streamFile) {
          // Fallback: look for any .mitm files in the mitmproxy directory
          if (fs.existsSync(mitmproxyDir)) {
            const mitmFiles = fs.readdirSync(mitmproxyDir).filter(f => f.endsWith('.mitm'));
            if (mitmFiles.length > 0) {
              streamFile = path.join(mitmproxyDir, mitmFiles[0]);
              core.info(`Found stream file: ${streamFile}`);
            }
          }
        }
        
        if (streamFile) {
          core.setOutput('stream-file', streamFile);
          core.info(`Set stream file output: ${streamFile}`);
        } else {
          core.setOutput('stream-file', '');
          core.warning('No stream file found');
        }
        
        // Get CA certificate path from state
        const cacertPath = core.getState('mitmproxy-cacert-path') || '';
        core.setOutput('cacert-path', cacertPath);
        if (cacertPath) {
          core.info(`Set CA certificate path output: ${cacertPath}`);
        } else {
          core.info('No CA certificate path available');
        }
        
        core.info(`Set outputs: proxy-url=${proxyUrl}, stream-file=${streamFile || ''}, cacert-path=${cacertPath}`);
      } catch (error) {
        core.warning(`Could not set outputs from state: ${error.message}`);
        // Set basic outputs even if we can't read the stream file
        const proxyUrl = `http://${listenHost}:${listenPort}`;
        core.setOutput('proxy-url', proxyUrl);
        core.setOutput('stream-file', '');
        core.setOutput('cacert-path', '');
        core.info(`Set outputs: proxy-url=${proxyUrl}, stream-file=, cacert-path=`);
      }
      
      core.info('Stream will be automatically uploaded when the action completes.');
    } else {
      core.info('mitmproxy is disabled.');
      // Set empty outputs when disabled
      core.setOutput('proxy-url', '');
      core.setOutput('stream-file', '');
      core.setOutput('cacert-path', '');
    }
  } catch (error) {
    core.setFailed(`Main action failed: ${error.message}`);
  }
}

run();