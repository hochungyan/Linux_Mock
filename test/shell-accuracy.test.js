/* Regressions for interview-critical GNU/Bash semantics in the simulator. */
const assert = require('node:assert/strict');
const { PS, W, makeSession } = require('./harness.js');
const session = makeSession(PS.scenarios[0]);
const { world } = session;
const V = PS.vfs;
let checks = 0;
function run(command) { return session.run(command).raw; }
function out(command) { return W.stripColor(run(command).out); }
function put(path, text, ageDays = 0) {
  V.write(world.root, path, text, { mtime: new Date(world.clock.getTime() - ageDays * 86400000), owner: world.user, group: world.user });
}
function read(path) { return V.read(V.lookup(world.root, path), world); }
function test(label, fn) { fn(); checks++; console.log('PASS ' + label); }

test('quoting expands double quotes but preserves single quotes and escaped dollars', () => {
  assert.equal(out('echo "$HOME"'), world.home);
  assert.equal(out("echo '$HOME'"), '$HOME');
  assert.equal(out('echo "\\$HOME"'), '$HOME');
  assert.equal(out('export DESK=Equities; echo "$DESK"'), 'Equities');
  assert.equal(out('false; echo $?'), '1');
  run('false'); assert.equal(out('echo $?'), '1');
  assert.equal(run('echo "unterminated').code, 2);
  assert.equal(run('echo x >').code, 2);
  assert.notEqual(run('echo x &').code, 0);
});

test('redirection preserves bytes, creates empty files, and truncates before reading', () => {
  run('printf abc > /tmp/bytes'); run('printf def >> /tmp/bytes');
  assert.equal(read('/tmp/bytes'), 'abcdef');
  run('echo end >> /tmp/bytes'); assert.equal(read('/tmp/bytes'), 'abcdefend\n');
  run('cat /tmp/bytes > /tmp/bytes'); assert.equal(read('/tmp/bytes'), '');
  run('echo kept > /tmp/first > /tmp/second');
  assert.equal(read('/tmp/first'), ''); assert.equal(read('/tmp/second'), 'kept\n');
  assert.notEqual(run('echo x > /missing-parent/file').code, 0);
  assert.equal(V.lookup(world.root, '/missing-parent'), null);
  assert.notEqual(run('> /tmp').code, 0);
  assert.notEqual(run('cat < /tmp').code, 0);
  assert.equal(out('echo 2>/tmp/errors'), '');
  assert.equal(out('echo number2>/tmp/number'), ''); assert.equal(read('/tmp/number'), 'number2\n');
});

test('stdout/stderr duplication respects left-to-right descriptor order', () => {
  PS.shell.register('both-streams', () => ({ out: 'ok', err: 'failure', code: 3 }));
  assert.equal(run('both-streams > /tmp/both 2>&1').code, 3);
  assert.equal(read('/tmp/both'), 'ok\nfailure\n');
  assert.equal(out('both-streams 2>&1 > /tmp/stdout'), 'failure');
  assert.equal(read('/tmp/stdout'), 'ok\n');
  assert.equal(out('both-streams 2>/tmp/stderr | cat'), 'ok');
  assert.equal(read('/tmp/stderr'), 'failure\n');
  assert.equal(out('both-streams 2>&1 | grep failure'), 'failure');
  assert.equal(out('both-streams &> /tmp/all'), '');
  assert.equal(read('/tmp/all'), 'ok\nfailure\n');
});

test('tee append, echo -n and wc newline counting match stream bytes', () => {
  run('printf first | tee /tmp/tee'); run('printf second | tee -a /tmp/tee');
  assert.equal(read('/tmp/tee'), 'firstsecond');
  assert.equal(out('printf x | wc -l').trim(), '0');
  assert.equal(out('echo -n x | wc -c').trim(), '1');
  assert.equal(out('echo -e "one\\ntwo" | wc -l').trim(), '2');
  run('grep root /etc/passwd > /tmp/colour');
  assert.equal(read('/tmp/colour'), W.stripColor(read('/tmp/colour')));
});

put('/tmp/search.log', 'error alpha\nERROR beta\nwarn\nerror gamma\nliteral (ro a+b\n');
test('grep case, line numbers, inversion, limits, regex dialects and status codes', () => {
  assert.equal(out('grep -in error /tmp/search.log'), '1:error alpha\n2:ERROR beta\n4:error gamma');
  assert.equal(out('grep -ivc error /tmp/search.log'), '2');
  assert.equal(out('grep -im1 error /tmp/search.log'), 'error alpha');
  assert.equal(run('grep -m0 error /tmp/search.log').code, 1);
  assert.equal(out("grep 'a+b' /tmp/search.log"), 'literal (ro a+b');
  assert.equal(out("grep -E 'ERROR|warn' /tmp/search.log"), 'ERROR beta\nwarn');
  assert.equal(out("grep '(ro' /tmp/search.log"), 'literal (ro a+b');
  assert.equal(run("grep '[' /tmp/search.log").code, 2);
  assert.equal(run('grep error /tmp/search.log /missing').code, 2);
  assert.equal(run('grep -q error /tmp/search.log /missing').code, 0);
  assert.equal(run('grep -q error /missing').code, 2);
  assert.equal(out("grep -e ERROR -e warn /tmp/search.log"), 'ERROR beta\nwarn');
  assert.equal(out("grep -e '' /tmp/search.log | wc -l").trim(), '5');
  assert.equal(out('grep -nA1 error /tmp/search.log'), '1:error alpha\n2-ERROR beta\n--\n4:error gamma\n5-literal (ro a+b');
});

test('find day buckets, minute buckets, case-insensitive names and size units', () => {
  put('/tmp/ages/today.LOG', 'a', 0.4);
  put('/tmp/ages/day29.log', 'abc', 29.9);
  put('/tmp/ages/day30.log', 'abcde', 30);
  put('/tmp/ages/day30half.log', 'abcdef', 30.5);
  put('/tmp/ages/day31.log', 'abcdefg', 31);
  assert.equal(out('find /tmp/ages -type f -mtime -30'), '/tmp/ages/day29.log\n/tmp/ages/today.LOG');
  assert.equal(out('find /tmp/ages -type f -mtime +30'), '/tmp/ages/day31.log');
  assert.equal(out('find /tmp/ages -type f -mtime 30'), '/tmp/ages/day30.log\n/tmp/ages/day30half.log');
  assert.equal(out('find /tmp/ages -type f -size 3c'), '/tmp/ages/day29.log');
  assert.equal(out('find /tmp/ages -type f -size -1k'), '');
  assert.equal(out("find /tmp/ages -iname '*.log' | wc -l").trim(), '5');
  assert.equal(out('find /tmp/ages -maxdepth 0'), '/tmp/ages');
  assert.equal(run('find /tmp/ages -unsupported -delete').code, 1);
  assert.ok(V.lookup(world.root, '/tmp/ages/day31.log'));
  assert.equal(out("find /tmp/ages -name day29.log -printf '%f %s\\n'"), 'day29.log 3');
});

test('truncate preserves prefixes, pads zero bytes, creates files and respects -c', () => {
  put('/tmp/truncated', 'abcdef');
  assert.equal(run('truncate -s 3 /tmp/truncated').code, 0);
  assert.equal(read('/tmp/truncated'), 'abc');
  run('truncate --size=5 /tmp/truncated'); assert.equal(read('/tmp/truncated'), 'abc\0\0');
  run('truncate -s -2 /tmp/truncated'); assert.equal(read('/tmp/truncated'), 'abc');
  run('truncate -s 0 /tmp/new-empty'); assert.ok(V.lookup(world.root, '/tmp/new-empty'));
  run('truncate -c -s 0 /tmp/no-create'); assert.equal(V.lookup(world.root, '/tmp/no-create'), null);
  assert.notEqual(run('truncate -s rubbish /tmp/truncated').code, 0);
  assert.equal(read('/tmp/truncated'), 'abc');
});

test('awk extracts regex-separated fields, filters records and sums numeric columns', () => {
  put('/tmp/prices', 'name qty\nABC 12\nXYZ 8\n');
  assert.equal(out("awk 'NR>1 {print $1,$2}' /tmp/prices"), 'ABC 12\nXYZ 8');
  assert.equal(out("awk 'NR>1 {sum+=$2} END {print sum}' /tmp/prices"), '20');
  assert.equal(out("awk '$2>=10 {print $1}' /tmp/prices"), 'ABC');
  assert.equal(out("awk '{print $NF}' /tmp/prices"), 'qty\n12\n8');
  assert.equal(out("echo '35=8|39=2' | awk -F '[=|]' '{print $2,$4}'"), '8 2');
  assert.notEqual(run("awk '{system($0)}' /tmp/prices").code, 0);
  assert.notEqual(run("awk '{print $1}' /missing").code, 0);
});

test('sed honors default print, -n, substitution p, in-place edits and backreferences', () => {
  put('/tmp/sed-data', 'alpha\nbeta\n');
  assert.equal(out("sed -n '1p' /tmp/sed-data"), 'alpha');
  assert.equal(out("sed '1p' /tmp/sed-data"), 'alpha\nalpha\nbeta');
  assert.equal(out("sed -n 's/alpha/A/' /tmp/sed-data"), '');
  assert.equal(out("sed -n 's/alpha/[&]/p' /tmp/sed-data"), '[alpha]');
  assert.equal(out("sed -E 's/(alpha)/\\1-yes/' /tmp/sed-data"), 'alpha-yes\nbeta');
  run("sed -i 's/alpha/new/' /tmp/sed-data"); assert.equal(read('/tmp/sed-data'), 'new\nbeta\n');
  assert.equal(out("sed '1d' /tmp/sed-data"), 'beta');
  assert.notEqual(run("sed 's/x/y/' /missing").code, 0);
});

test('directory copies and moves preserve content and failed moves preserve the source', () => {
  put('/tmp/source/nested/data', 'valuable');
  assert.notEqual(run('cp /tmp/source /tmp/copy').code, 0);
  assert.equal(run('cp -r /tmp/source /tmp/copy').code, 0);
  assert.equal(read('/tmp/copy/nested/data'), 'valuable');
  assert.equal(run('mv /tmp/copy /tmp/renamed').code, 0);
  assert.equal(read('/tmp/renamed/nested/data'), 'valuable');
  assert.equal(V.lookup(world.root, '/tmp/copy'), null);
  assert.notEqual(run('mv /tmp/renamed /no-parent/destination').code, 0);
  assert.equal(read('/tmp/renamed/nested/data'), 'valuable');
});

test('permission repairs modify the intended metadata and reject invalid modes', () => {
  put('/tmp/permission-file', 'config');
  assert.equal(run('chmod 640 /tmp/permission-file').code, 0);
  const node = V.lookup(world.root, '/tmp/permission-file');
  assert.equal(node.mode, '-rw-r-----');
  assert.equal(run('chown pricing:pricing /tmp/permission-file').code, 0);
  assert.equal(node.owner, 'pricing'); assert.equal(node.group, 'pricing');
  assert.notEqual(run('chmod 999 /tmp/permission-file').code, 0);
  assert.equal(node.mode, '-rw-r-----');
  assert.notEqual(run('chmod 640 /missing').code, 0);
  assert.equal(run('chmod 4750 /tmp/permission-file').code, 0);
  assert.equal(node.mode, '-rwsr-x---');
});
console.log(`\n${checks} shell accuracy groups passed.`);
