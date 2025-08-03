const core = require('@actions/core');
const exec = require('@actions/exec');
const artifact = require('@actions/artifact');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
          // Windows process termination
          await exec.exec('taskkill', ['/PID', pid, '/F'], { ignoreReturnCode: true });
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
    
    // Find the traffic file - use state first, then fallback to file system search
    let actualTrafficFile = trafficFile;
    
    if (!actualTrafficFile && fs.existsSync(path.join(trafficDir, 'traffic_file_path.txt'))) {
      actualTrafficFile = fs.readFileSync(path.join(trafficDir, 'traffic_file_path.txt'), 'utf8').trim();
      core.info(`Found traffic file path in file: ${actualTrafficFile}`);
    }

    // Also check for any .mitm files in the traffic directory
    if (!actualTrafficFile || !fs.existsSync(actualTrafficFile)) {
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

    // Create artifacts directory
    const artifactDir = path.join(trafficDir, 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });

    // Compress the traffic file - use cross-platform approach
    core.info('Compressing traffic file...');
    const compressedFile = path.join(artifactDir, `${archiveName}.tar.gz`);
    
    if (os.platform() === 'win32') {
      // On Windows, use PowerShell to create compressed archive
      // First try tar if available (Windows 10 1803+ has tar.exe)
      try {
        await exec.exec('tar', ['-czf', compressedFile, '-C', path.dirname(actualTrafficFile), path.basename(actualTrafficFile)]);
      } catch (error) {
        core.warning('tar command not available on Windows, using PowerShell compression');
        // Fallback to PowerShell compression
        const zipFile = path.join(artifactDir, `${archiveName}.zip`);
        await exec.exec('powershell', [
          '-Command',
          `Compress-Archive -Path "${actualTrafficFile}" -DestinationPath "${zipFile}"`
        ]);
        // Rename for consistency
        fs.renameSync(zipFile, compressedFile);
      }
    } else {
      // Unix systems
      await exec.exec('tar', ['-czf', compressedFile, '-C', path.dirname(actualTrafficFile), path.basename(actualTrafficFile)]);
    }

    let finalFile = compressedFile;

    // Encrypt if passphrase is provided
    if (passphrase) {
      core.info('Encrypting traffic file...');
      const encryptedFile = path.join(artifactDir, `${archiveName}.tar.gz.enc`);
      
      // Check if openssl is available
      try {
        await exec.exec('openssl', [
          'enc', '-aes-256-cbc', '-salt', '-pbkdf2',
          '-in', compressedFile,
          '-out', encryptedFile,
          '-pass', `pass:${passphrase}`
        ]);
        fs.unlinkSync(compressedFile);
        finalFile = encryptedFile;
        core.info('Traffic file encrypted successfully');
      } catch (error) {
        if (os.platform() === 'win32') {
          core.warning('OpenSSL not available on Windows, skipping encryption. Install OpenSSL for encryption support.');
          core.warning('File will be uploaded without encryption.');
        } else {
          throw error;
        }
      }
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