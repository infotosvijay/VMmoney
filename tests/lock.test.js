import test from 'node:test';
import assert from 'node:assert/strict';

// lock.js only touches the browser inside functions, so the pure helper can be imported here
const { lockoutSeconds } = await import('../js/lock.js');

test('PIN lockout starts after five wrong tries and grows', () => {
  assert.deepEqual([0, 1, 4].map(lockoutSeconds), [0, 0, 0]);
  assert.deepEqual([5, 6, 7, 8, 20].map(lockoutSeconds), [30, 60, 300, 900, 900]);
});
