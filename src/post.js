const core = require('@actions/core');
const exec = require('@actions/exec');
const artifact = require('@actions/artifact');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');
const archiverZipEncrypted = require('archiver-zip-encrypted');

// Bundle test mode detection - exit after requires if in test mode
if (process.argv.includes('--bundle-test') || process.env.BUNDLE_TEST === '1') {
  console.log('Bundle test mode: all requires completed successfully');
  process.exit(0);
}

// Register the zip-encrypted format with archiver (one-time registration)
archiver.registerFormat('zip-encrypted', archiverZipEncrypted);

async function run() {
  try {
    // Unset proxy environment variables first to avoid affecting artifact upload
    const setEnvvars = core.getInput('set-envvars') || 'false';
    if (setEnvvars === 'true') {
      core.info('Unsetting proxy environment variables to avoid affecting artifact upload...');
      core.exportVariable('http_proxy', '');
      core.exportVariable('https_proxy', '');
      core.exportVariable('CURL_HOME', '');
      core.info('Unset environment variables: http_proxy, https_proxy, CURL_HOME');
    }
    
    // This is the post action - stop mitmproxy and upload artifacts
    const enabled = core.getInput('enabled') || 'true';
    const passphrase = core.getInput('passphrase');

    if (enabled !== 'true') {
      core.info('mitmproxy was disabled, nothing to clean up...');
      return;
    }

    core.info('Starting mitmproxy cleanup and artifact upload...');

    // Get stream file and PID from state
    const streamFile = core.getState('mitmproxy-stream-file');
    const savedPid = core.getState('mitmproxy-pid');
    let mitmproxyDir = core.getState('mitmproxy-dir');
    
    // If not available in state, construct the expected path in RUNNER_TEMP
    if (!mitmproxyDir) {
      const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
      mitmproxyDir = path.join(runnerTemp, 'mitmproxy-logger-action');
      core.info(`Constructed mitmproxy directory: ${mitmproxyDir}`);
    } else {
      core.info(`Using mitmproxy directory from state: ${mitmproxyDir}`);
    }

    // Stop mitmproxy first - try to use PID from state, fallback to file
    const pidFile = path.join(mitmproxyDir, 'mitmdump.pid');
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
      core.info(`No PID available. Checking if mitmproxy directory exists...`);
      if (fs.existsSync(mitmproxyDir)) {
        core.info(`Mitmproxy directory exists: ${mitmproxyDir}`);
        const files = fs.readdirSync(mitmproxyDir);
        core.info(`Files in mitmproxy directory: ${files.join(', ')}`);
      } else {
        core.info(`Mitmproxy directory does not exist: ${mitmproxyDir}`);
      }
    }

    // Now prepare and upload artifacts
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const runNumber = process.env.GITHUB_RUN_NUMBER || 'unknown';
    const archiveName = `mitmproxy_stream_${timestamp}`;
    const artifactName = `mitmproxy_stream_artifact_${runNumber}`;
    
    // Find the stream file - use state only (no file system search)
    let actualStreamFile = streamFile;
    
    if (!actualStreamFile) {
      // Check for any .mitm files in the mitmproxy directory
      core.info('Checking for any stream files in directory...');
      if (fs.existsSync(mitmproxyDir)) {
        const mitmFiles = fs.readdirSync(mitmproxyDir).filter(f => f.endsWith('.mitm'));
        if (mitmFiles.length > 0) {
          actualStreamFile = path.join(mitmproxyDir, mitmFiles[0]);
          core.info(`Found stream file: ${actualStreamFile}`);
        }
      }
    }

    if (!actualStreamFile || !fs.existsSync(actualStreamFile)) {
      core.info('No stream file found. Creating an empty one for completeness...');
      fs.mkdirSync(mitmproxyDir, { recursive: true });
      actualStreamFile = path.join(mitmproxyDir, 'stream_empty.mitm');
      fs.writeFileSync(actualStreamFile, '');
    }

    const fileSize = fs.statSync(actualStreamFile).size;
    core.info(`Stream file: ${actualStreamFile}`);
    core.info(`Stream file size: ${fileSize} bytes`);

    // Convert .mitm to .har using mitmdump hardump
    let harFile = null;
    if (actualStreamFile && fs.existsSync(actualStreamFile)) {
      const baseName = path.basename(actualStreamFile, '.mitm');
      harFile = path.join(path.dirname(actualStreamFile), `${baseName}.har`);
      
      core.info('Converting .mitm to .har using mitmdump hardump...');
      try {
        let mitmdumpStdout = '';
        let mitmdumpStderr = '';
        await exec.exec('mitmdump', [
          '--no-server', 
          '--rfile', actualStreamFile, 
          '--set', `hardump=${harFile}`
        ], {
          listeners: {
            stdout: (data) => {
              mitmdumpStdout += data.toString();
            },
            stderr: (data) => {
              mitmdumpStderr += data.toString();
            }
          }
        });
        core.info(`Successfully converted to HAR: ${harFile}`);
      } catch (error) {
        core.warning(`HAR conversion failed (mitmdump version may not support hardump): ${error.message}`);
        if (typeof mitmdumpStderr !== 'undefined' && mitmdumpStderr.length > 0) {
          core.warning(`mitmdump stderr: ${mitmdumpStderr}`);
        }
        if (typeof mitmdumpStdout !== 'undefined' && mitmdumpStdout.length > 0) {
          core.info(`mitmdump stdout: ${mitmdumpStdout}`);
        }
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
    const artifactDir = path.join(mitmproxyDir, 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });

    // Create encrypted ZIP archive with both .mitm and .har files
    core.info('Creating password-protected ZIP archive...');
    const zipFile = path.join(artifactDir, `${archiveName}.zip`);
    
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipFile);
      const archive = archiver('zip-encrypted', {
        encryptionMethod: 'aes256',
        password: passphrase
      });
      
      output.on('close', () => {
        core.info(`Password-protected ZIP archive created: ${zipFile}`);
        // Use fs.statSync to get the actual file size on disk, as archive.pointer() may not account for encryption overhead or final ZIP structure.
        const stats = fs.statSync(zipFile);
        core.info(`Archive size: ${stats.size} bytes`);
        resolve();
      });
      
      output.on('error', reject);
      archive.on('error', reject);
      
      archive.pipe(output);
      
      // Add .mitm file with encryption
      if (actualStreamFile && fs.existsSync(actualStreamFile)) {
        archive.file(actualStreamFile, { name: path.basename(actualStreamFile) });
        core.info(`Added encrypted to ZIP: ${path.basename(actualStreamFile)}`);
      }
      
      // Add .har file with encryption
      if (harFile && fs.existsSync(harFile)) {
        archive.file(harFile, { name: path.basename(harFile) });
        core.info(`Added encrypted to ZIP: ${path.basename(harFile)}`);
      }
      
      // Add logs if available with encryption
      const logFile = path.join(mitmproxyDir, 'mitmdump.log');
      if (fs.existsSync(logFile)) {
        archive.file(logFile, { name: 'mitmdump.log' });
        core.info('Added encrypted mitmdump log file to ZIP');
      }
      
      archive.finalize();
    });

    const finalFile = zipFile;

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
        artifactName,     // artifact name
        files,           // files to upload
        artifactDir      // root directory
      );

      if (uploadResponse.failedItems && uploadResponse.failedItems.length > 0) {
        core.warning(`Some files failed to upload: ${uploadResponse.failedItems.join(', ')}`);
      } else {
        core.info(`Successfully uploaded artifact: ${artifactName}`);
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