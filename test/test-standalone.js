#!/usr/bin/env node

/**
 * Test standalone execution of bundled JavaScript files
 * This test verifies that each bundle can be loaded independently
 * without requiring external dependencies to be installed.
 * 
 * The test uses a special bundle test mode that exits after all
 * require() statements complete successfully, avoiding execution
 * of the main action logic.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const distDir = path.join(__dirname, '..', 'dist');
const bundles = [
  'index.js',
  'main/index.js',
  'pre/index.js',
  'post/index.js'
];

console.log('Testing standalone module loading of bundled files...\n');

// Create a temporary directory for testing without node_modules
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-test-'));
console.log(`Testing in clean environment: ${tempDir}\n`);

let allPassed = true;

for (const bundle of bundles) {
  const bundlePath = path.join(distDir, bundle);
  
  console.log(`Testing ${bundle}...`);
  
  // Check if file exists
  if (!fs.existsSync(bundlePath)) {
    console.error(`❌ FAIL: ${bundle} does not exist`);
    allPassed = false;
    continue;
  }
  
  try {
    // Copy bundle to temp directory and test from there
    const tempBundlePath = path.join(tempDir, path.basename(bundle));
    fs.copyFileSync(bundlePath, tempBundlePath);
    
    // Run the bundle in bundle test mode
    const spawnResult = spawnSync(
      process.execPath,
      [path.basename(bundle), '--bundle-test'],
      {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      }
    );
    
    const output = (spawnResult.stdout || '') + (spawnResult.stderr || '');
    if (output.includes('Bundle test mode: all requires completed successfully')) {
      console.log(`✅ PASS: ${bundle} loads without module dependency errors`);
    } else {
      console.error(`❌ FAIL: ${bundle} did not complete bundle test properly`);
      console.error(`   Output: ${output.trim()}`);
      allPassed = false;
    }
    
  } catch (error) {
    // Check if the error indicates missing modules
    const errorOutput = (error.stdout || '') + (error.stderr || '');
    if (errorOutput.includes('Cannot find module') ||
        errorOutput.includes('MODULE_NOT_FOUND')) {
      console.error(`❌ FAIL: ${bundle} has missing dependencies`);
      console.error(`   Error: ${errorOutput.split('\n')[0]}`);
      allPassed = false;
    } else {
      console.error(`❌ FAIL: ${bundle} failed to execute in bundle test mode`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Output: ${errorOutput.trim()}`);
      allPassed = false;
    }
  }
}

// Cleanup temp directory
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch (e) {
  // Ignore cleanup errors
}

console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('✅ All bundles passed standalone module loading test');
  process.exit(0);
} else {
  console.log('❌ Some bundles failed standalone module loading test');
  process.exit(1);
}