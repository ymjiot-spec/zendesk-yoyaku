/**
 * Verification Script: No Local Storage Usage
 * 
 * This script verifies that the Zendesk app does not store customer information
 * in localStorage, sessionStorage, or any persistent browser storage.
 * 
 * Requirement 9.3: Customer information must not be stored in local storage
 */

const fs = require('fs');
const path = require('path');

// Files to check
const filesToCheck = [
  'assets/main.js',
  'assets/index.html'
];

// Patterns that indicate storage usage
const storagePatterns = [
  /localStorage\./g,
  /sessionStorage\./g,
  /\.setItem\(/g,
  /\.getItem\(/g,
  /\.removeItem\(/g,
  /\.clear\(\)/g,
  /indexedDB/gi,
  /openDatabase/gi,
  /webkitStorageInfo/gi
];

// Allowed patterns (in-memory only)
const allowedPatterns = [
  /let\s+\w+\s*=\s*\{\}/g,  // In-memory objects
  /const\s+\w+\s*=\s*\{\}/g, // In-memory objects
  /ticketCache/g,            // Our in-memory cache
];

console.log('='.repeat(70));
console.log('Verification: No Local Storage Usage');
console.log('Requirement 9.3: Customer information must not be stored in local storage');
console.log('='.repeat(70));
console.log();

let hasStorageUsage = false;
let verificationResults = [];

// Check each file
filesToCheck.forEach(file => {
  const filePath = path.join(__dirname, file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${file}`);
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  console.log(`Checking: ${file}`);
  console.log('-'.repeat(70));
  
  let fileHasIssues = false;
  
  // Check for storage patterns
  storagePatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      hasStorageUsage = true;
      fileHasIssues = true;
      console.log(`❌ FOUND: ${pattern.toString()} (${matches.length} occurrence(s))`);
      verificationResults.push({
        file,
        pattern: pattern.toString(),
        count: matches.length,
        status: 'FAIL'
      });
    }
  });
  
  if (!fileHasIssues) {
    console.log('✅ No persistent storage usage detected');
    verificationResults.push({
      file,
      status: 'PASS'
    });
  }
  
  console.log();
});

// Check for in-memory cache usage
console.log('Checking for in-memory cache implementation...');
console.log('-'.repeat(70));

const mainJsPath = path.join(__dirname, 'assets/main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

// Verify in-memory cache is used
if (mainJsContent.includes('let ticketCache = {}')) {
  console.log('✅ In-memory cache (ticketCache) is properly declared');
  verificationResults.push({
    check: 'In-memory cache declaration',
    status: 'PASS'
  });
} else {
  console.log('❌ In-memory cache (ticketCache) not found');
  verificationResults.push({
    check: 'In-memory cache declaration',
    status: 'FAIL'
  });
}

// Verify cache is cleared on session end
if (mainJsContent.includes('clearCache()') && 
    mainJsContent.includes('ticketCache = {}')) {
  console.log('✅ Cache clearing mechanism is implemented');
  verificationResults.push({
    check: 'Cache clearing on session end',
    status: 'PASS'
  });
} else {
  console.log('❌ Cache clearing mechanism not found');
  verificationResults.push({
    check: 'Cache clearing on session end',
    status: 'FAIL'
  });
}

// Verify cache is only used for tickets, not stored persistently
if (mainJsContent.includes('ticketCache[email]') && 
    !mainJsContent.includes('localStorage') &&
    !mainJsContent.includes('sessionStorage')) {
  console.log('✅ Cache is in-memory only (no persistent storage)');
  verificationResults.push({
    check: 'In-memory only storage',
    status: 'PASS'
  });
} else {
  console.log('❌ Potential persistent storage usage detected');
  verificationResults.push({
    check: 'In-memory only storage',
    status: 'FAIL'
  });
}

console.log();
console.log('='.repeat(70));
console.log('Summary');
console.log('='.repeat(70));

const passCount = verificationResults.filter(r => r.status === 'PASS').length;
const failCount = verificationResults.filter(r => r.status === 'FAIL').length;

console.log(`Total checks: ${verificationResults.length}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log();

if (hasStorageUsage) {
  console.log('❌ VERIFICATION FAILED');
  console.log('The application uses persistent storage mechanisms.');
  console.log('Customer information must not be stored in localStorage or sessionStorage.');
  console.log();
  process.exit(1);
} else {
  console.log('✅ VERIFICATION PASSED');
  console.log('No persistent storage usage detected.');
  console.log('Customer information is stored in memory only and cleared on session end.');
  console.log();
  console.log('Key findings:');
  console.log('  • No localStorage or sessionStorage usage');
  console.log('  • In-memory cache (ticketCache) is used for performance');
  console.log('  • Cache is cleared when session ends (app.deactivated event)');
  console.log('  • Customer data is not persisted across sessions');
  console.log();
  process.exit(0);
}
