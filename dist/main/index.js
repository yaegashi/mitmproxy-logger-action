/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 781:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

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
const path = __nccwpck_require__(928);
const fs = __nccwpck_require__(896);

async function run() {
  try {
    // Main action - read state from pre action and set outputs
    const enabled = core.getState('mitmproxy-enabled') || core.getInput('enabled') || 'true';
    
    if (enabled === 'true') {
      core.info('mitmproxy is running and capturing traffic...');
      
      // Read the proxy configuration from state (set by pre action)
      const listenHost = core.getState('mitmproxy-listen-host') || core.getInput('listen-host') || '127.0.0.1';
      const listenPort = core.getState('mitmproxy-listen-port') || core.getInput('listen-port') || '8080';
      
      try {
        // Get the temporary directory from state
        let trafficDir = core.getState('mitmproxy-temp-dir');
        
        // If not available in state, construct the expected path in RUNNER_TEMP
        if (!trafficDir) {
          const runnerTemp = process.env.RUNNER_TEMP;
          if (runnerTemp) {
            trafficDir = path.join(runnerTemp, 'mitmproxy-action-traffic');
            core.info(`Constructed temporary traffic directory: ${trafficDir}`);
          } else {
            throw new Error('Could not determine temporary directory path');
          }
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
        
        core.info(`Set outputs: proxy-url=${proxyUrl}, traffic-file=${trafficFile || ''}`);
      } catch (error) {
        core.warning(`Could not set outputs from state: ${error.message}`);
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
module.exports = __webpack_exports__;
/******/ })()
;