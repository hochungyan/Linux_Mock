/* Runs every suite in order.
 * Also supports machines with Node but a missing/broken npm launcher. */
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  'engine.test.js',
  'drills.test.js',
  'incidents.test.js',
  'market-risk.test.js',
  'trade-reconciliation.test.js',
  'business-operations.test.js',
  'fix-incidents.test.js',
  'distributed-platform.test.js',
  'shell-accuracy.test.js',
  'system-accuracy.test.js',
  'browser.test.js'
];

for (const file of SUITES) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll ' + SUITES.length + ' suites passed.');
