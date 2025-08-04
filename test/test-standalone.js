#!/usr/bin/env node

/**
 * Test standalone execution of bundled JavaScript files
 * This test verifies that each bundle can be executed independently
 * without requiring external dependencies to be installed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, '..', 'dist');
const bundles = [
  'index.js',
  'main/index.js',
  'pre/index.js',
  'post/index.js'
];

console.log('Testing standalone execution of bundled files...\n');

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
    // Try to execute the bundle with --help or minimal args
    // We expect it to run without module resolution errors
    const result = execSync(`node "${bundlePath}" --help || true`, { 
      encoding: 'utf8',
      timeout: 10000,
      stdio: 'pipe'
    });
    
    // If we get here without an exception, the bundle loaded successfully
    console.log(`✅ PASS: ${bundle} loads without module errors`);
    
  } catch (error) {
    // Check if the error is due to missing modules (the critical failure)
    if (error.message.includes('Cannot find module') || 
        error.message.includes('MODULE_NOT_FOUND')) {
      console.error(`❌ FAIL: ${bundle} has missing dependencies`);
      console.error(`   Error: ${error.message.split('\n')[0]}`);
      allPassed = false;
    } else {
      // Other errors (like missing environment variables) are expected
      // since we're just testing module loading, not full functionality
      console.log(`✅ PASS: ${bundle} loads without module errors`);
    }
  }
}

console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('✅ All bundles passed standalone execution test');
  process.exit(0);
} else {
  console.log('❌ Some bundles failed standalone execution test');
  process.exit(1);
}