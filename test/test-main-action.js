#!/usr/bin/env node

/**
 * Test main action execution
 * This test verifies that the main action can execute with valid inputs
 * without errors.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('Testing main action execution...\n');

const mainActionPath = path.join(__dirname, '..', 'dist', 'main', 'index.js');

// Check if bundled file exists
if (!fs.existsSync(mainActionPath)) {
  console.error('❌ FAIL: dist/main/index.js does not exist');
  console.error('   Run "npm run build" first to create bundled files');
  process.exit(1);
}

// Set up test environment variables
const testEnv = {
  ...process.env,
  INPUT_ENABLED: 'true',
  INPUT_LISTEN_HOST: '127.0.0.1',
  INPUT_LISTEN_PORT: '8080',
  INPUT_INSTALL_CACERT: 'true',
  INPUT_SET_ENVVARS: 'true',
  INPUT_PASSPHRASE: 'test-passphrase-123',
  // Mock GitHub Actions environment
  GITHUB_WORKSPACE: process.cwd(),
  RUNNER_TEMP: '/tmp'
};

console.log('Testing main action with environment variables:');
console.log('  INPUT_ENABLED=true');
console.log('  INPUT_LISTEN_HOST=127.0.0.1');
console.log('  INPUT_LISTEN_PORT=8080');
console.log('  INPUT_INSTALL_CACERT=true');
console.log('  INPUT_SET_ENVVARS=true');
console.log('  INPUT_PASSPHRASE=test-passphrase-123\n');

try {
  const result = spawnSync(
    process.execPath,
    [mainActionPath],
    {
      env: testEnv,
      encoding: 'utf8',
      timeout: 10000,
      stdio: 'pipe'
    }
  );

  const output = (result.stdout || '') + (result.stderr || '');

  if (result.status === 0) {
    console.log('✅ PASS: Main action executed successfully');
    if (output.trim()) {
      console.log('Output:');
      console.log(output.trim());
    }
    process.exit(0);
  } else {
    console.error('❌ FAIL: Main action failed to execute');
    console.error(`Exit code: ${result.status}`);
    if (output.trim()) {
      console.error('Output:');
      console.error(output.trim());
    }
    process.exit(1);
  }
} catch (error) {
  console.error('❌ FAIL: Main action execution threw an error');
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
