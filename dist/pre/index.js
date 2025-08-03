/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 781:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 579:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 317:
/***/ ((module) => {

"use strict";
module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 857:
/***/ ((module) => {

"use strict";
module.exports = require("os");

/***/ }),

/***/ 928:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const core = __nccwpck_require__(781);
const exec = __nccwpck_require__(579);
const path = __nccwpck_require__(928);
const fs = __nccwpck_require__(896);
const os = __nccwpck_require__(857);

async function run() {
  try {
    // This is the pre action - install and start mitmproxy
    const enabled = core.getInput('enabled') || 'true';
    const listenHost = core.getInput('listen-host') || '127.0.0.1';
    const listenPort = core.getInput('listen-port') || '8080';
    const passphrase = core.getInput('passphrase');

    // Check if mitmproxy is enabled
    if (enabled !== 'true') {
      core.info('mitmproxy is disabled, skipping...');
      core.saveState('mitmproxy-enabled', 'false');
      return;
    }

    core.info('Starting mitmproxy logger...');

    // Install mitmproxy if not already installed
    try {
      await exec.exec('mitmdump', ['--version'], { silent: true });
      core.info('mitmproxy is already installed');
    } catch (error) {
      core.info('Installing mitmproxy...');
      await exec.exec('pip', ['install', '--upgrade', 'mitmproxy']);
    }

    // Create traffic directory in RUNNER_TEMP to avoid workspace cleanup issues
    const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
    const trafficDir = path.join(runnerTemp, 'mitmproxy-action-traffic');

    fs.mkdirSync(trafficDir, { recursive: true });

    // Generate traffic file name with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const trafficFile = path.join(trafficDir, `traffic_${timestamp}.mitm`);

    // Start mitmdump in background
    core.info(`Starting mitmdump on ${listenHost}:${listenPort}`);
    core.info(`Traffic will be saved to: ${trafficFile}`);

    const logFile = path.join(trafficDir, 'mitmdump.log');
    const pidFile = path.join(trafficDir, 'mitmdump.pid');

    // Start mitmdump with flow file output
    const mitmdumpArgs = [
      '--listen-host', listenHost,
      '--listen-port', listenPort,
      '--save-stream-file', trafficFile,
      '--set', `confdir=${trafficDir}`
    ];

    // Open log file for mitmdump stdout and stderr
    const logFd = fs.openSync(logFile, 'a');

    // Spawn mitmdump process
    const { spawn } = __nccwpck_require__(317);
    const mitmdumpProcess = spawn('mitmdump', mitmdumpArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });

    // Save the PID for cleanup
    fs.writeFileSync(pidFile, mitmdumpProcess.pid.toString());

    // Unref the process so it doesn't keep the Node.js process alive
    mitmdumpProcess.unref();

    // Close the log file descriptor to avoid leaks
    fs.closeSync(logFd);

    // Wait a moment for the proxy to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if the process is still running
    if (mitmdumpProcess.killed || mitmdumpProcess.exitCode !== null) {
      core.error('Failed to start mitmdump. Check logs:');
      if (fs.existsSync(logFile)) {
        const logs = fs.readFileSync(logFile, 'utf8');
        core.error(logs);
      }
      throw new Error('Failed to start mitmdump');
    }

    // Save outputs for JavaScript to read
    const proxyUrl = `http://${listenHost}:${listenPort}`;

    // Save traffic file path for later use
    fs.writeFileSync(path.join(trafficDir, 'traffic_file_path.txt'), trafficFile);

    // Save proxy URL for JavaScript to read
    fs.writeFileSync(path.join(trafficDir, 'proxy_url.txt'), proxyUrl);

    core.info(`mitmproxy started successfully at ${proxyUrl}`);
    core.info(`PID: ${mitmdumpProcess.pid}`);
    core.info(`Traffic file: ${trafficFile}`);

    // Save state for main action to set outputs (outputs from pre are not accessible in workflows)
    core.saveState('mitmproxy-enabled', enabled);
    core.saveState('mitmproxy-listen-host', listenHost);
    core.saveState('mitmproxy-listen-port', listenPort);
    core.saveState('mitmproxy-temp-dir', trafficDir);
    core.saveState('mitmproxy-traffic-file', trafficFile);
    core.saveState('mitmproxy-pid', mitmdumpProcess.pid.toString());
    core.saveState('mitmproxy-proxy-url', proxyUrl);

    core.info('mitmproxy setup completed, main action will set outputs');
  } catch (error) {
    core.setFailed(`Pre action failed: ${error.message}`);
  }
}

run();
module.exports = __webpack_exports__;
/******/ })()
;