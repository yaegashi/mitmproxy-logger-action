const core = require('@actions/core');
const exec = require('@actions/exec');
const artifact = require('@actions/artifact');
const path = require('path');
const fs = require('fs');
const os = require('os');
const yazl = require('yazl');

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

    // Get traffic file and PID from state
    const trafficFile = core.getState('mitmproxy-traffic-file');
    const savedPid = core.getState('mitmproxy-pid');
    let trafficDir = core.getState('mitmproxy-temp-dir');
    
    // If not available in state, construct the expected path in RUNNER_TEMP
    if (!trafficDir) {
      const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
      trafficDir = path.join(runnerTemp, 'mitmproxy-action-traffic');
      core.info(`Constructed temporary traffic directory: ${trafficDir}`);
    } else {
      core.info(`Using traffic directory from state: ${trafficDir}`);
    }

    // Stop mitmproxy first - try to use PID from state, fallback to file
    const pidFile = path.join(trafficDir, 'mitmdump.pid');
    let pid = savedPid;

    if (pid) {
      core.info(`Using PID from state: ${pid}`);
    } else if (fs.existsSync(pidFile)) {
      core.info(`PID not found in state, checking PID file at: ${pidFile}`);
      pid = fs.readFileSync(pidFile, 'utf8').trim();
      core.info(`Using PID from file: ${pid}`);
    }
    
    if (pid) {
      core.info(`Stopping mitmdump process (PID: ${pid})...`);
      
      try {
        if (os.platform() === 'win32') {
          // Windows: graceful shutdown with SIGINT, then force kill if needed
          try {
            process.kill(Number(pid), 'SIGINT');
            core.info('Sent SIGINT to mitmdump process');
          } catch (e) {
            core.warning(`Failed to send SIGINT: ${e.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds

          // Check if process is still running
          let stillRunning = false;
          try {
            process.kill(Number(pid), 0);
            stillRunning = true;
          } catch (e) {
            stillRunning = false;
          }
          if (stillRunning) {
            core.info('Process still running after SIGINT, using taskkill...');
            await exec.exec('taskkill', ['/PID', pid, '/F'], { ignoreReturnCode: true });
          }
        } else {
          // Unix process termination
          // Check if process is still running first
          const { exitCode } = await exec.getExecOutput('kill', ['-0', pid], { ignoreReturnCode: true });
          if (exitCode === 0) {
            // Process is running, try to kill it gracefully
            await exec.exec('kill', ['-TERM', pid], { ignoreReturnCode: true });
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
            
            // Check if still running and force kill if needed
            const { exitCode: stillRunning } = await exec.getExecOutput('kill', ['-0', pid], { ignoreReturnCode: true });
            if (stillRunning === 0) {
              await exec.exec('kill', ['-KILL', pid], { ignoreReturnCode: true });
            }
          }
        }
        
        // Clean up PID file
        if (fs.existsSync(pidFile)) {
          fs.unlinkSync(pidFile);
        }
        core.info('mitmdump stopped successfully');
      } catch (error) {
        core.warning(`Error stopping mitmdump: ${error.message}`);
      }
    } else {
      core.info(`No PID available. Checking if traffic directory exists...`);
      if (fs.existsSync(trafficDir)) {
        core.info(`Traffic directory exists: ${trafficDir}`);
        const files = fs.readdirSync(trafficDir);
        core.info(`Files in traffic directory: ${files.join(', ')}`);
      } else {
        core.info(`Traffic directory does not exist: ${trafficDir}`);
      }
    }

    // Now prepare and upload artifacts
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `mitmproxy_traffic_${timestamp}`;
    
    // Find the traffic file - use state only (no file system search)
    let actualTrafficFile = trafficFile;
    
    if (!actualTrafficFile) {
      // Check for any .mitm files in the traffic directory
      core.info('Checking for any traffic files in directory...');
      if (fs.existsSync(trafficDir)) {
        const mitmFiles = fs.readdirSync(trafficDir).filter(f => f.endsWith('.mitm'));
        if (mitmFiles.length > 0) {
          actualTrafficFile = path.join(trafficDir, mitmFiles[0]);
          core.info(`Found traffic file: ${actualTrafficFile}`);
        }
      }
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

    // Convert .mitm to .har using mitmdump hardump
    let harFile = null;
    if (actualTrafficFile && fs.existsSync(actualTrafficFile)) {
      const baseName = path.basename(actualTrafficFile, '.mitm');
      harFile = path.join(path.dirname(actualTrafficFile), `${baseName}.har`);
      
      core.info('Converting .mitm to .har using mitmdump hardump...');
      try {
        await exec.exec('mitmdump', [
          '--no-server', 
          '--rfile', actualTrafficFile, 
          '--set', `hardump=${harFile}`
        ]);
        core.info(`Successfully converted to HAR: ${harFile}`);
      } catch (error) {
        core.warning(`HAR conversion failed (mitmdump version may not support hardump): ${error.message}`);
        // Create empty HAR file to ensure consistency
        const emptyHar = {
          log: {
            version: "1.2",
            creator: { name: "mitmproxy-logger-action", version: "1.0.0" },
            entries: []
          }
        };
        fs.writeFileSync(harFile, JSON.stringify(emptyHar, null, 2));
        core.info('Created empty HAR file due to conversion failure');
      }
    }

    // Create artifacts directory
    const artifactDir = path.join(trafficDir, 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });

    // Create ZIP archive with both .mitm and .har files
    core.info('Creating ZIP archive...');
    const zipFile = path.join(artifactDir, `${archiveName}.zip`);
    
    await new Promise((resolve, reject) => {
      const zipArchive = new yazl.ZipFile();
      
      // Add .mitm file
      if (actualTrafficFile && fs.existsSync(actualTrafficFile)) {
        zipArchive.addFile(actualTrafficFile, path.basename(actualTrafficFile));
        core.info(`Added to ZIP: ${path.basename(actualTrafficFile)}`);
      }
      
      // Add .har file
      if (harFile && fs.existsSync(harFile)) {
        zipArchive.addFile(harFile, path.basename(harFile));
        core.info(`Added to ZIP: ${path.basename(harFile)}`);
      }
      
      // Add logs if available
      const logFile = path.join(trafficDir, 'mitmdump.log');
      if (fs.existsSync(logFile)) {
        zipArchive.addFile(logFile, 'mitmdump.log');
        core.info('Added mitmdump log file to ZIP');
      }
      
      zipArchive.end();
      
      zipArchive.outputStream.pipe(fs.createWriteStream(zipFile))
        .on('close', () => {
          core.info(`ZIP archive created: ${zipFile}`);
          resolve();
        })
        .on('error', reject);
    });

    let finalFile = zipFile;

    // Encrypt ZIP with password if passphrase is provided
    if (passphrase) {
      core.info('Creating password-protected ZIP archive...');
      const encryptedZipFile = path.join(artifactDir, `${archiveName}_encrypted.zip`);
      
      await new Promise((resolve, reject) => {
        const zipArchive = new yazl.ZipFile();
        
        // Add .mitm file with encryption
        if (actualTrafficFile && fs.existsSync(actualTrafficFile)) {
          zipArchive.addFile(actualTrafficFile, path.basename(actualTrafficFile), {
            password: passphrase
          });
          core.info(`Added encrypted to ZIP: ${path.basename(actualTrafficFile)}`);
        }
        
        // Add .har file with encryption
        if (harFile && fs.existsSync(harFile)) {
          zipArchive.addFile(harFile, path.basename(harFile), {
            password: passphrase
          });
          core.info(`Added encrypted to ZIP: ${path.basename(harFile)}`);
        }
        
        // Add logs if available with encryption
        const logFile = path.join(trafficDir, 'mitmdump.log');
        if (fs.existsSync(logFile)) {
          zipArchive.addFile(logFile, 'mitmdump.log', {
            password: passphrase
          });
          core.info('Added encrypted mitmdump log file to ZIP');
        }
        
        zipArchive.end();
        
        zipArchive.outputStream.pipe(fs.createWriteStream(encryptedZipFile))
          .on('close', () => {
            core.info(`Password-protected ZIP archive created: ${encryptedZipFile}`);
            // Remove unencrypted ZIP
            if (fs.existsSync(zipFile)) {
              fs.unlinkSync(zipFile);
            }
            finalFile = encryptedZipFile;
            resolve();
          })
          .on('error', reject);
      });
    } else {
      core.warning('No passphrase provided, ZIP file will not be password-protected');
    }

    // Upload artifacts using GitHub Actions artifact API
    try {
      const artifactClient = new artifact.DefaultArtifactClient();
      const files = [finalFile];
      
      core.info(`Uploading artifacts: ${files.map(f => path.basename(f)).join(', ')}`);
      core.info(`Artifact root directory: ${artifactDir}`);
      core.info(`Total files to upload: ${files.length}`);
      
      // Check if files exist and are readable
      for (const file of files) {
        if (!fs.existsSync(file)) {
          throw new Error(`File does not exist: ${file}`);
        }
        const stats = fs.statSync(file);
        core.info(`File ${path.basename(file)}: ${stats.size} bytes`);
      }
      
      // Use the correct API call format for @actions/artifact v2.x
      const uploadResponse = await artifactClient.uploadArtifact(
        archiveName,      // artifact name
        files,           // files to upload
        artifactDir      // root directory
      );

      if (uploadResponse.failedItems && uploadResponse.failedItems.length > 0) {
        core.warning(`Some files failed to upload: ${uploadResponse.failedItems.join(', ')}`);
      } else {
        core.info(`Successfully uploaded artifact: ${archiveName}`);
        if (uploadResponse.id) {
          core.info(`Artifact ID: ${uploadResponse.id}`);
        }
        if (uploadResponse.size) {
          core.info(`Artifact size: ${uploadResponse.size} bytes`);
        }
      }
    } catch (error) {
      core.setFailed(`Failed to upload artifacts: ${error.message}`);
      // Log more details for debugging
      core.info(`Artifact directory contents: ${fs.existsSync(artifactDir) ? fs.readdirSync(artifactDir).join(', ') : 'directory does not exist'}`);
      return;
    }

    core.info('Cleanup and artifact upload completed successfully');
  } catch (error) {
    core.setFailed(`Post action failed: ${error.message}`);
  }
}

run();