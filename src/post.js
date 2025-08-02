const core = require('@actions/core');
const exec = require('@actions/exec');
const artifact = require('@actions/artifact');
const path = require('path');
const fs = require('fs');

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
      const artifactClient = artifact.create();
      const files = fs.readdirSync(artifactDir).map(file => path.join(artifactDir, file));
      
      core.info(`Uploading artifacts: ${files.map(f => path.basename(f)).join(', ')}`);
      
      const uploadResponse = await artifactClient.uploadArtifact(
        archiveName,
        files,
        {
          rootDirectory: artifactDir,
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