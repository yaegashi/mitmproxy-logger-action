/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 422:
/***/ ((module) => {

module.exports = eval("require")("@actions/artifact");


/***/ }),

/***/ 781:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 579:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


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
const exec = __nccwpck_require__(579);
const artifact = __nccwpck_require__(422);
const path = __nccwpck_require__(928);
const fs = __nccwpck_require__(896);

async function run() {
  try {
    // This is the post action - stop mitmproxy and upload artifacts
    const enabled = core.getInput('enabled') || 'true';
    const passphrase = core.getInput('passphrase');

    if (enabled !== 'true') {
      core.info('mitmproxy was disabled, nothing to clean up...');
      return;
    }

    core.info('Starting mitmproxy cleanup and artifact upload...');

    // Set environment variables for the script
    process.env.INPUT_ENABLED = enabled;
    process.env.INPUT_PASSPHRASE = passphrase;
    
    // Get traffic file from state if available
    const trafficFile = core.getState('traffic-file');
    if (trafficFile) {
      process.env.TRAFFIC_FILE = trafficFile;
    }

    // Stop mitmproxy first
    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const trafficDir = path.join(workspaceDir, 'mitmproxy-traffic');
    const pidFile = path.join(trafficDir, 'mitmdump.pid');

    if (fs.existsSync(pidFile)) {
      const pid = fs.readFileSync(pidFile, 'utf8').trim();
      core.info(`Stopping mitmdump process (PID: ${pid})...`);
      
      try {
        // Try to kill the process gracefully
        await exec.exec('kill', ['-TERM', pid], { ignoreReturnCode: true });
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
        
        // Force kill if still running
        await exec.exec('kill', ['-KILL', pid], { ignoreReturnCode: true });
        fs.unlinkSync(pidFile);
        core.info('mitmdump stopped successfully');
      } catch (error) {
        core.warning(`Error stopping mitmdump: ${error.message}`);
      }
    } else {
      core.info('No PID file found, mitmdump may not have been started');
    }

    // Now prepare and upload artifacts
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `mitmproxy_traffic_${timestamp}`;
    
    // Find the traffic file
    let actualTrafficFile = trafficFile;
    if (!actualTrafficFile && fs.existsSync(path.join(trafficDir, 'traffic_file_path.txt'))) {
      actualTrafficFile = fs.readFileSync(path.join(trafficDir, 'traffic_file_path.txt'), 'utf8').trim();
    }

    if (!actualTrafficFile || !fs.existsSync(actualTrafficFile)) {
      core.info('No traffic file found. Creating an empty one for completeness...');
      fs.mkdirSync(trafficDir, { recursive: true });
      actualTrafficFile = path.join(trafficDir, 'traffic_empty.mitm');
      fs.writeFileSync(actualTrafficFile, '');
    }

    const fileSize = fs.statSync(actualTrafficFile).size;
    core.info(`Traffic file: ${actualTrafficFile}`);
    core.info(`Traffic file size: ${fileSize} bytes`);

    // Create artifacts directory
    const artifactDir = path.join(trafficDir, 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });

    // Compress the traffic file
    core.info('Compressing traffic file...');
    const compressedFile = path.join(artifactDir, `${archiveName}.tar.gz`);
    await exec.exec('tar', ['-czf', compressedFile, '-C', path.dirname(actualTrafficFile), path.basename(actualTrafficFile)]);

    let finalFile = compressedFile;

    // Encrypt if passphrase is provided
    if (passphrase) {
      core.info('Encrypting traffic file...');
      const encryptedFile = path.join(artifactDir, `${archiveName}.tar.gz.enc`);
      await exec.exec('openssl', [
        'enc', '-aes-256-cbc', '-salt', '-pbkdf2',
        '-in', compressedFile,
        '-out', encryptedFile,
        '-pass', `pass:${passphrase}`
      ]);
      fs.unlinkSync(compressedFile);
      finalFile = encryptedFile;
      core.info('Traffic file encrypted successfully');
    } else {
      core.warning('No passphrase provided, file will not be encrypted');
    }

    // Include logs if available
    const logFile = path.join(trafficDir, 'mitmdump.log');
    if (fs.existsSync(logFile)) {
      fs.copyFileSync(logFile, path.join(artifactDir, 'mitmdump.log'));
      core.info('Included mitmdump log file');
    }

    // Upload artifacts using GitHub Actions artifact API
    try {
      const artifactClient = new artifact.DefaultArtifactClient();
      const files = fs.readdirSync(artifactDir).map(file => path.join(artifactDir, file));
      
      core.info(`Uploading artifacts: ${files.map(f => path.basename(f)).join(', ')}`);
      
      const uploadResponse = await artifactClient.uploadArtifact(
        archiveName,
        files,
        artifactDir,
        {
          continueOnError: false
        }
      );

      if (uploadResponse.failedItems && uploadResponse.failedItems.length > 0) {
        core.warning(`Some files failed to upload: ${uploadResponse.failedItems.join(', ')}`);
      } else {
        core.info(`Successfully uploaded artifact: ${archiveName}`);
        core.info(`Artifact ID: ${uploadResponse.id}`);
        core.info(`Artifact size: ${uploadResponse.size} bytes`);
      }
    } catch (error) {
      core.setFailed(`Failed to upload artifacts: ${error.message}`);
      return;
    }

    core.info('Cleanup and artifact upload completed successfully');
  } catch (error) {
    core.setFailed(`Post action failed: ${error.message}`);
  }
}

run();
module.exports = __webpack_exports__;
/******/ })()
;