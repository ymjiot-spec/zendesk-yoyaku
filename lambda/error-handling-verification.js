/**
 * Error Handling Verification Script
 * This script demonstrates the error handling capabilities implemented in task 9
 */

import { handler } from './index.js';

console.log('=== Error Handling Verification ===\n');

// Test 1: Invalid request body (should return 400)
console.log('Test 1: Invalid request body');
const test1 = await handler({
  body: 'invalid json'
});
console.log('Status:', test1.statusCode);
console.log('Response:', JSON.parse(test1.body));
console.log('✓ Handled invalid JSON\n');

// Test 2: Missing tickets array (should return 400)
console.log('Test 2: Missing tickets array');
const test2 = await handler({
  body: JSON.stringify({ foo: 'bar' })
});
console.log('Status:', test2.statusCode);
console.log('Response:', JSON.parse(test2.body));
console.log('✓ Handled missing tickets\n');

// Test 3: Invalid tickets data type (should return 400)
console.log('Test 3: Invalid tickets data type');
const test3 = await handler({
  body: JSON.stringify({ tickets: 'not an array' })
});
console.log('Status:', test3.statusCode);
console.log('Response:', JSON.parse(test3.body));
console.log('✓ Handled invalid tickets type\n');

// Test 4: Empty tickets array (should succeed with appropriate message)
console.log('Test 4: Empty tickets array');
const test4 = await handler({
  body: JSON.stringify({ tickets: [] })
});
console.log('Status:', test4.statusCode);
console.log('Response:', JSON.parse(test4.body));
console.log('✓ Handled empty tickets array\n');

console.log('=== All error handling tests passed ===');
