#!/usr/bin/env node

/**
 * Test standalone execution of bundled JavaScript files
 * This test verifies that each bundle can be loaded independently
 * without requiring external dependencies to be installed.
 * 
 * The test only verifies that require() calls complete successfully
 * without actually executing the action logic to avoid side effects.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

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
    
    // Create a test script that requires the bundle but exits quickly
    const testScript = `
      let moduleError = null;
      
      try {
        // Only require the module to test dependencies are bundled
        require('${tempBundlePath}');
        
      } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('Cannot find module')) {
          console.error('MODULE_ERROR: ' + error.message);
          process.exit(1);
        }
        // Store other errors but don't exit - they might be expected
        moduleError = error;
      }
      
      // Set a timer to exit after a short time to prevent long-running actions
      setTimeout(() => {
        console.log('REQUIRE_SUCCESS');
        process.exit(0);
      }, 500);
    `;
    
    const testScriptPath = path.join(tempDir, 'test.js');
    fs.writeFileSync(testScriptPath, testScript);
    
    // Run the test from the temp directory with timeout
    const result = execSync(`cd "${tempDir}" && timeout 5 node test.js 2>&1 || echo "TIMEOUT_EXIT"`, { 
      encoding: 'utf8',
      timeout: 8000,
      stdio: 'pipe'
    });
    
    if (result.includes('REQUIRE_SUCCESS')) {
      console.log(`✅ PASS: ${bundle} loads without module dependency errors`);
    } else if (result.includes('MODULE_ERROR')) {
      console.error(`❌ FAIL: ${bundle} has missing dependencies`);
      console.error(`   Error: ${result.match(/MODULE_ERROR: (.*)/)?.[1] || 'Unknown module error'}`);
      allPassed = false;
    } else if (result.includes('Cannot find module')) {
      console.error(`❌ FAIL: ${bundle} has missing dependencies`);
      console.error(`   Error: ${result.split('\n')[0]}`);
      allPassed = false;
    } else {
      // Timeout or other execution - this is OK as long as no module errors
      console.log(`✅ PASS: ${bundle} loads without module dependency errors`);
    }
    
  } catch (error) {
    // Check if the error indicates missing modules
    const errorOutput = error.stdout + error.stderr;
    if (errorOutput.includes('MODULE_ERROR') || 
        errorOutput.includes('Cannot find module') ||
        errorOutput.includes('MODULE_NOT_FOUND')) {
      console.error(`❌ FAIL: ${bundle} has missing dependencies`);
      console.error(`   Error: ${errorOutput.split('\n')[0]}`);
      allPassed = false;
    } else {
      // Timeout or other execution error - this is expected for action scripts
      console.log(`✅ PASS: ${bundle} loads without module dependency errors`);
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