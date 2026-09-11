/* Also supports machines with Node but a missing/broken npm launcher. */
const { spawnSync } = require('child_process');
const path = require('path');
for (const file of ['engine.test.js', 'drills.test.js', 'shell-accuracy.test.js', 'system-accuracy.test.js', 'browser.test.js']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll five suites passed.');
