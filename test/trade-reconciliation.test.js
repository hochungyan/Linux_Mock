/* Standalone entrypoint: node test/trade-reconciliation.test.js
 * Drive the real shell/curl contracts; no network or production APIs are used. */
const assert = require('assert/strict');
const { PS, makeSession } = require('./harness');

const EXEC_ID = 'duplicate-execution-position-replay';
const ALLOC_ID = 'allocation-ssi-affirmation-mismatch';
const EXEC = 'http://localhost:9972/admin/execution/';
const ALLOC = 'http://localhost:9972/admin/allocation/';
const REPAIR = { change: 'CHG-7412', broker: 'BRK-A', tradeDate: '2026-09-11', account: 'HF-ALPHA', execId: 'EX-701', duplicateBooking: 'BOOK-1003' };
const REFRESH = { change: 'CHG-8820', fromVersion: 17, toVersion: 18 };
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function session(id) {
  const scenario = PS.scenarios.find(s => s.id === id);
  assert.ok(scenario, 'scenario registered: ' + id);
  return makeSession(scenario);
}
function ok(s, command) {
  const result = s.run(command);
  assert.equal(result.raw.code, 0, command + '\n' + result.text);
  assert.doesNotMatch(result.text, /internal error/i);
  return result.text.trim();
}
function command(api, action, body, method = 'POST') {
  return 'curl -X ' + method + ' ' + api + action + (body === undefined ? '' : " -d '" + JSON.stringify(body) + "'");
}
function call(s, api, action, body) { return ok(s, command(api, action, body)); }
function report(s, api) { return JSON.parse(ok(s, 'curl ' + api + 'status')); }
function state(s) { return JSON.stringify({ flags: s.world.flags, trade: s.world.trade, services: s.world.services }); }
function rejected(s, line, pattern) {
  const before = state(s), result = s.run(line);
  assert.notEqual(result.raw.code, 0, 'must reject: ' + line + '\n' + result.text);
  assert.doesNotMatch(result.text, /internal error/i);
  if (pattern) assert.match(result.text, pattern);
  assert.equal(state(s), before, 'rejected request must not change business/control state');
  assert.equal(s.scenario.fix.check(s.world), false);
}
function repeated(s, api, action, body) {
  call(s, api, action, body);
  const after = state(s);
  call(s, api, action, body);
  assert.equal(state(s), after, 'idempotent: ' + action);
}
function prepareExec(s) {
  call(s, EXEC, 'capture'); call(s, EXEC, 'pause'); call(s, EXEC, 'compare');
  call(s, EXEC, 'approve', { change: 'CHG-7412' });
}
function prepareAlloc(s) {
  call(s, ALLOC, 'capture'); call(s, ALLOC, 'compare');
  call(s, ALLOC, 'approve', { change: 'CHG-8820' });
}
function closeExec(s) {
  call(s, EXEC, 'verify-quantities'); call(s, EXEC, 'resume'); call(s, EXEC, 'verify-live'); call(s, EXEC, 'close');
}
function closeAlloc(s) { call(s, ALLOC, 'verify-affirmations'); call(s, ALLOC, 'close'); }

test('both scenario contracts expose provenance, walkthroughs and fresh isolated worlds', () => {
  for (const id of [EXEC_ID, ALLOC_ID]) {
    const s = session(id), sc = s.scenario;
    assert.equal(PS.scenarios.filter(item => item.id === id).length, 1);
    assert.equal(sc.rootCauses.filter(cause => cause.correct).length, 1);
    assert.equal(sc.hints.length, 4);
    assert.ok(sc.debrief.length > 400);
    assert.ok(sc.walkthrough.length > 10);
    assert.ok(sc.sources.every(source => source.title && /^https:\/\//.test(source.url)));
    assert.equal(s.world.httpExact, true);
    assert.equal(sc.fix.check(s.world), false);
    assert.ok(sc.fix.grade(s.world).bonus < 0, 'incomplete work cannot earn a clean grade');
    assert.match(ok(s, 'cat /home/gsupport/runbook.txt'), /FICTIONAL[\s\S]*simulator-only/i);
    s.world.trade.audit.push('session-local marker');
    assert.doesNotMatch(ok(session(id), 'cat /var/log/trade/audit.log'), /session-local marker/);
    for (const diagnostic of ['ps aux', 'systemctl', 'ss -ltnp', 'df -h', 'free -m', 'ls -l /data', 'find /control -type f']) ok(s, diagnostic);
  }
});

test('documented terminal walkthroughs solve both incidents and discover all evidence', () => {
  for (const id of [EXEC_ID, ALLOC_ID]) {
    const s = session(id);
    s.scenario.walkthrough.forEach((line, index) => {
      ok(s, line);
      assert.equal(s.scenario.fix.check(s.world), index === s.scenario.walkthrough.length - 1,
        'only final close wins: ' + line);
    });
    assert.equal(s.scenario.fix.grade(s.world).quality, 'clean');
    assert.ok(s.scenario.discoveries.every(d => s.found.includes(d.id)), 'findings: ' + s.found.join(','));
  }
});

test('execution CSV investigation distinguishes scoped replay from legitimate PossDup Y', () => {
  const s = session(EXEC_ID);
  const counts = ok(s, "awk -F, 'NR>1 {print $2,$3,$4,$5}' /data/oms-ledger.csv | sort | uniq -c");
  assert.match(counts, /2\s+BRK-A 2026-09-11 HF-ALPHA EX-701/);
  assert.match(counts, /1\s+BRK-B 2026-09-11 HF-ALPHA EX-701/);
  assert.match(counts, /1\s+BRK-A 2026-09-11 HF-BETA EX-701/);
  assert.match(counts, /1\s+BRK-A 2026-09-10 HF-ALPHA EX-701/);
  assert.match(ok(s, 'grep EX-702 /var/log/trade/booking.log'), /first_booking=true PossDupFlag=Y/);
  assert.equal(s.world.trade.ledger.length, 6);
  const position = report(s, EXEC).positions.find(p => p.tradeDate === '2026-09-11' && p.account === 'HF-ALPHA');
  assert.equal(position.omsQty, 750); assert.equal(position.brokerQty, 500); assert.equal(position.delta, 250);
  call(s, EXEC, 'capture'); call(s, EXEC, 'pause');
  const comparison = JSON.parse(call(s, EXEC, 'compare'));
  assert.deepEqual(comparison.confirmedDuplicateBookings, ['BOOK-1003']);
  assert.match(comparison.possDupWarning, /alone never proves/);
  assert.equal(comparison.mismatchCount, 1);
});

test('execution correction appends exactly one reversal and requires verification before resume/close', () => {
  const s = session(EXEC_ID), originals = JSON.stringify(s.world.trade.ledger);
  prepareExec(s);
  const captured = ok(s, 'cat /evidence/before/data/oms-ledger.csv');
  repeated(s, EXEC, 'repair', REPAIR);
  assert.equal(JSON.stringify(s.world.trade.ledger.slice(0, 6)), originals, 'original ledger rows remain byte-for-byte equivalent');
  const reversal = s.world.trade.ledger[6];
  assert.equal(reversal.kind, 'REVERSAL'); assert.equal(reversal.qty, -250); assert.equal(reversal.reverses, 'BOOK-1003');
  assert.equal(s.world.trade.dedupeVersion, 2);
  assert.equal(s.world.trade.ledger.filter(e => e.execId === 'EX-702').length, 1, 'valid PossDup Y retained');
  assert.equal(ok(s, 'cat /evidence/before/data/oms-ledger.csv'), captured);
  assert.equal(report(s, EXEC).positions.every(p => p.delta === 0), true);
  rejected(s, command(EXEC, 'resume'), /verification/);
  rejected(s, command(EXEC, 'close'), /verification/);
  repeated(s, EXEC, 'verify-quantities');
  assert.equal(s.scenario.fix.check(s.world), false);
  repeated(s, EXEC, 'resume');
  rejected(s, command(EXEC, 'close'), /verification/);
  repeated(s, EXEC, 'verify-live');
  assert.equal(s.world.trade.replayChecks, 1);
  assert.equal(s.world.trade.ledger.length, 7);
  repeated(s, EXEC, 'close'); repeated(s, EXEC, 'repair', REPAIR);
  assert.equal(s.scenario.fix.check(s.world), true);
  assert.equal(s.scenario.fix.grade(s.world).quality, 'clean');
  assert.match(ok(s, 'cat /var/log/trade/audit.log'), /CAPTURE[\s\S]*PAUSE[\s\S]*APPROVAL[\s\S]*REPAIR[\s\S]*RESUME[\s\S]*CANARY[\s\S]*CLOSE/);
});

test('execution workflow rejects every premature transition without mutation', () => {
  const s = session(EXEC_ID);
  for (const [action, body] of [['pause'], ['compare'], ['approve', { change: 'CHG-7412' }], ['repair', REPAIR],
    ['verify-quantities'], ['resume'], ['verify-live'], ['close']]) rejected(s, command(EXEC, action, body));
  repeated(s, EXEC, 'capture');
  rejected(s, command(EXEC, 'compare'), /paused/);
  repeated(s, EXEC, 'pause');
  rejected(s, command(EXEC, 'approve', { change: 'CHG-7412' }), /Compare/);
  repeated(s, EXEC, 'compare');
  rejected(s, command(EXEC, 'repair', REPAIR), /Approved/);
  repeated(s, EXEC, 'approve', { change: 'CHG-7412' });
  rejected(s, command(EXEC, 'verify-quantities'), /repaired/);
  repeated(s, EXEC, 'repair', REPAIR);
  rejected(s, command(EXEC, 'verify-live'), /Resume/);
});

test('execution repair rejects wrong broker/date/account/ExecID/booking/approval and blanket Y filtering', () => {
  const s = session(EXEC_ID); prepareExec(s);
  for (const [key, value] of Object.entries({ broker: 'BRK-B', tradeDate: '2026-09-10', account: 'HF-BETA', execId: 'EX-702', duplicateBooking: 'BOOK-1002', change: 'CHG-OTHER' })) {
    rejected(s, command(EXEC, 'repair', { ...REPAIR, [key]: value }), /scope/);
  }
  rejected(s, command(EXEC, 'approve', { change: 'CHG-OTHER' }), /approval/);
  rejected(s, command(EXEC, 'repair', { possDup: 'Y' }), /fields/);
  rejected(s, command(EXEC, 'repair', { ...REPAIR, deleteOriginal: true }), /fields/);
  assert.equal(s.world.trade.ledger.length, 6);
});

test('strict HTTP methods, exact URLs and malformed bodies cannot mutate either workflow', () => {
  for (const [id, api, action, body] of [[EXEC_ID, EXEC, 'repair', REPAIR], [ALLOC_ID, ALLOC, 'refresh-mapping', REFRESH]]) {
    const s = session(id);
    if (id === EXEC_ID) prepareExec(s); else prepareAlloc(s);
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) rejected(s, command(api, action, body, method), /POST required/);
    for (const path of [action + '-all', action + '/extra', action + '?force=true']) rejected(s, command(api, path, body), /Connection refused/);
    rejected(s, command('http://remote.invalid/' + api, action, body), /Connection refused/);
    for (const malformed of ['{bad', 'null', '[]', '42', '"CHG-7412"']) {
      rejected(s, 'curl -X POST ' + api + action + " -d '" + malformed + "'", /400/);
    }
    rejected(s, command(api, action), /fields/);
    rejected(s, command(api, action, body) + " -d '{}'", /fields/);
    rejected(s, command(api, 'status'), /GET required/);
    rejected(s, command(api, 'capture', { unexpected: true }), /fields/);
    assert.equal(s.scenario.fix.check(s.world), false);
  }
});

test('execution restart, stop/start, kill and elapsed time never heal durable positions', () => {
  for (const disrupt of ['systemctl restart booking-consumer', 'service booking-consumer restart',
    'systemctl stop booking-consumer', 'kill -9 7412']) {
    const s = session(EXEC_ID), before = JSON.stringify(s.world.trade.ledger);
    ok(s, disrupt); s.advance(180);
    assert.equal(JSON.stringify(s.world.trade.ledger), before);
    assert.equal(s.world.trade.dedupeVersion, 1);
    assert.equal(s.scenario.fix.check(s.world), false);
    ok(s, 'systemctl start booking-consumer'); prepareExec(s);
    ok(s, 'systemctl restart booking-consumer.service');
    assert.equal(s.world.flags.paused, true, 'pause survives restart');
    call(s, EXEC, 'repair', REPAIR); closeExec(s);
    assert.equal(s.scenario.fix.check(s.world), true);
    assert.equal(s.scenario.fix.grade(s.world).quality, 'blunt');
  }
});

test('execution restart invalidates pre-resume and post-resume verification', () => {
  const s = session(EXEC_ID); prepareExec(s); call(s, EXEC, 'repair', REPAIR); call(s, EXEC, 'verify-quantities');
  ok(s, 'systemctl restart booking-consumer');
  rejected(s, command(EXEC, 'resume'), /Fresh/);
  call(s, EXEC, 'verify-quantities'); call(s, EXEC, 'resume'); call(s, EXEC, 'verify-live');
  ok(s, 'systemctl restart booking-consumer');
  rejected(s, command(EXEC, 'close'), /Fresh/);
  call(s, EXEC, 'verify-live'); call(s, EXEC, 'close');
  assert.equal(s.scenario.fix.check(s.world), true);
});

test('business quantity verification inspects actual ledger, not a repaired flag', () => {
  const s = session(EXEC_ID); prepareExec(s); call(s, EXEC, 'repair', REPAIR);
  s.world.trade.ledger[6].qty = -249; // fault injection: a partially applied corrective posting
  rejected(s, command(EXEC, 'verify-quantities'), /zero quantity breaks/);
  assert.equal(report(s, EXEC).positions.find(p => p.tradeDate === '2026-09-11' && p.account === 'HF-ALPHA').delta, 1);
});

test('allocation CSV investigation proves economic totals and identifies stale account mappings', () => {
  const s = session(ALLOC_ID);
  assert.equal(ok(s, "awk -F, 'NR>1 {sum += $6} END {print sum}' /data/allocations.csv"), '1000');
  assert.match(ok(s, 'grep REJECTED_SSI /var/log/trade/affirmation.log'), /ALLOC-02[\s\S]*ALLOC-03/);
  call(s, ALLOC, 'capture');
  const comparison = JSON.parse(call(s, ALLOC, 'compare'));
  assert.equal(comparison.blockQty, 1000); assert.equal(comparison.allocatedQty, 1000); assert.equal(comparison.economicsMatch, true);
  assert.equal(comparison.mappingVersion, 17); assert.equal(comparison.approvedVersion, 18);
  assert.deepEqual(comparison.staleAccounts, ['HF-ALT', 'HF-GROWTH']);
  assert.deepEqual(comparison.rejectedIds, ['ALLOC-02', 'ALLOC-03']);
  assert.equal(comparison.matchedCount, 1); assert.equal(comparison.affirmedCount, 1);
  assert.equal(comparison.settlementStatus, 'NOT_VERIFIED');
});

test('approved mapping refresh alone never heals; targeted subset retries preserve the affirmed allocation', () => {
  const s = session(ALLOC_ID), affirmed = JSON.stringify(s.world.trade.allocations[0]);
  prepareAlloc(s); repeated(s, ALLOC, 'refresh-mapping', REFRESH);
  assert.match(ok(s, 'cat /config/account-ssi.csv'), /HF-ALT,SSI-ALT-2,18/);
  assert.match(ok(s, 'cat /evidence/before/config/account-ssi.csv'), /HF-ALT,SSI-ALT-OLD,17/);
  assert.equal(report(s, ALLOC).affirmedCount, 1, 'refresh does not retry');
  rejected(s, command(ALLOC, 'verify-affirmations'), /all 3/);
  repeated(s, ALLOC, 'retry', { ids: ['ALLOC-02'] });
  assert.equal(report(s, ALLOC).affirmedCount, 2);
  rejected(s, command(ALLOC, 'close'), /verification/);
  rejected(s, command(ALLOC, 'verify-affirmations'), /all 3/);
  repeated(s, ALLOC, 'retry', { ids: ['ALLOC-03', 'ALLOC-02'] });
  assert.equal(JSON.stringify(s.world.trade.allocations[0]), affirmed, 'already affirmed allocation is untouched');
  assert.deepEqual(Array.from(s.world.trade.allocations, a => a.attempts), [1, 2, 2]);
  assert.equal(report(s, ALLOC).affirmedCount, 3);
  rejected(s, command(ALLOC, 'close'), /Fresh/);
  repeated(s, ALLOC, 'verify-affirmations'); repeated(s, ALLOC, 'close');
  repeated(s, ALLOC, 'retry', { ids: ['ALLOC-03', 'ALLOC-02'] }); repeated(s, ALLOC, 'refresh-mapping', REFRESH);
  assert.equal(s.scenario.fix.check(s.world), true);
  const business = report(s, ALLOC);
  assert.equal(business.matchedCount, 3); assert.equal(business.affirmedCount, 3); assert.deepEqual(business.rejectedIds, []);
  assert.equal(business.settlementStatus, 'NOT_VERIFIED');
  assert.match(ok(s, 'cat /evidence/affirmation-verification.json'), /"settlementStatus": "NOT_VERIFIED"/);
});

test('allocation out-of-order and approval/version violations do not mutate state', () => {
  const s = session(ALLOC_ID);
  for (const [action, body] of [['compare'], ['approve', { change: 'CHG-8820' }], ['refresh-mapping', REFRESH],
    ['retry', { ids: ['ALLOC-02'] }], ['verify-affirmations'], ['close']]) rejected(s, command(ALLOC, action, body));
  repeated(s, ALLOC, 'capture');
  rejected(s, command(ALLOC, 'approve', { change: 'CHG-8820' }), /Compare/);
  repeated(s, ALLOC, 'compare');
  rejected(s, command(ALLOC, 'refresh-mapping', REFRESH), /Approved/);
  rejected(s, command(ALLOC, 'approve', { change: 'CHG-OTHER' }), /approved/);
  repeated(s, ALLOC, 'approve', { change: 'CHG-8820' });
  for (const wrong of [{ ...REFRESH, fromVersion: 16 }, { ...REFRESH, toVersion: 19 }, { ...REFRESH, toVersion: 17 },
    { ...REFRESH, fromVersion: '17' }, { ...REFRESH, change: 'CHG-OTHER' }]) rejected(s, command(ALLOC, 'refresh-mapping', wrong), /Version/);
  rejected(s, command(ALLOC, 'retry', { ids: ['ALLOC-02'] }), /refresh/);
  assert.equal(s.world.trade.mapping.version, 17);
});

test('allocation retries reject whole block, affirmed IDs, duplicate IDs and mixed valid/invalid batches atomically', () => {
  const s = session(ALLOC_ID); prepareAlloc(s); call(s, ALLOC, 'refresh-mapping', REFRESH);
  for (const ids of [[], ['ALL'], ['BLK-8820'], ['ALLOC-01'], ['ALLOC-02', 'ALLOC-01'], ['ALLOC-02', 'UNKNOWN'],
    ['ALLOC-02', 'ALLOC-02'], 'ALLOC-02', [2], [null]]) rejected(s, command(ALLOC, 'retry', { ids }), /Retry only/);
  assert.deepEqual(Array.from(s.world.trade.allocations, a => a.attempts), [1, 1, 1]);
  assert.equal(report(s, ALLOC).affirmedCount, 1);
});

test('allocation restart/stop/kill/time retain stale SSI state and allow only approved recovery', () => {
  for (const disrupt of ['systemctl restart allocation-adapter', 'systemctl stop allocation-adapter', 'kill -9 8820']) {
    const s = session(ALLOC_ID), before = JSON.stringify(s.world.trade.allocations);
    ok(s, disrupt); s.advance(180);
    assert.equal(s.world.trade.mapping.version, 17);
    assert.equal(JSON.stringify(s.world.trade.allocations), before);
    assert.equal(s.scenario.fix.check(s.world), false);
    ok(s, 'systemctl start allocation-adapter'); prepareAlloc(s); call(s, ALLOC, 'refresh-mapping', REFRESH);
    call(s, ALLOC, 'retry', { ids: ['ALLOC-02'] });
    ok(s, 'systemctl restart allocation-adapter');
    assert.equal(s.world.trade.mapping.version, 18, 'approved refresh is durable');
    repeated(s, ALLOC, 'retry', { ids: ['ALLOC-02'] });
    assert.equal(s.world.trade.allocations[1].attempts, 2, 'retry identity survives restart');
    assert.equal(report(s, ALLOC).affirmedCount, 2, 'restart does not retry remaining reject');
    call(s, ALLOC, 'retry', { ids: ['ALLOC-03'] }); closeAlloc(s);
    assert.equal(s.scenario.fix.check(s.world), true);
    assert.equal(s.scenario.fix.grade(s.world).quality, 'blunt');
  }
});

test('allocation restart invalidates verification; fresh post-retry counts are mandatory', () => {
  const s = session(ALLOC_ID); prepareAlloc(s); call(s, ALLOC, 'refresh-mapping', REFRESH);
  call(s, ALLOC, 'retry', { ids: ['ALLOC-02', 'ALLOC-03'] }); call(s, ALLOC, 'verify-affirmations');
  ok(s, 'systemctl restart allocation-adapter.service');
  rejected(s, command(ALLOC, 'close'), /Fresh/);
  closeAlloc(s); assert.equal(s.scenario.fix.check(s.world), true);
});

test('verification rejects actual allocation quantity, economics, SSI or affirmation defects', () => {
  for (const corrupt of [d => { d.allocations[2].qty--; }, d => { d.allocations[2].price++; },
    d => { d.allocations[2].ssi = 'SSI-GROWTH-OLD'; }, d => { d.allocations[2].status = 'MATCHED'; }]) {
    const s = session(ALLOC_ID); prepareAlloc(s); call(s, ALLOC, 'refresh-mapping', REFRESH);
    call(s, ALLOC, 'retry', { ids: ['ALLOC-02', 'ALLOC-03'] });
    corrupt(s.world.trade); // inject a faulty downstream outcome, not a different command renderer
    rejected(s, command(ALLOC, 'verify-affirmations'), /Need all 3/);
  }
  const s = session(ALLOC_ID);
  s.world.trade.allocations[2].qty--;
  call(s, ALLOC, 'capture');
  rejected(s, command(ALLOC, 'compare'), /economics/);
});

test('missing/tampered audit, original evidence and captured CSV prevent repair or close', () => {
  for (const [id, api, path] of [[EXEC_ID, EXEC, '/evidence/before/data/oms-ledger.csv'],
    [ALLOC_ID, ALLOC, '/evidence/before/data/allocations.csv']]) {
    const s = session(id);
    if (id === EXEC_ID) prepareExec(s); else prepareAlloc(s);
    ok(s, 'rm ' + path);
    rejected(s, command(api, id === EXEC_ID ? 'repair' : 'refresh-mapping', id === EXEC_ID ? REPAIR : REFRESH), /evidence/i);
    rejected(s, command(api, 'capture'), /evidence/i);
  }
  for (const id of [EXEC_ID, ALLOC_ID]) {
    const s = session(id), api = id === EXEC_ID ? EXEC : ALLOC;
    s.scenario.walkthrough.forEach(line => ok(s, line));
    ok(s, "echo tampered > /var/log/trade/audit.log");
    assert.equal(s.scenario.fix.check(s.world), false, 'closing flag cannot hide destroyed audit');
    rejected(s, command(api, 'close'), /verification/i);
  }
  const s = session(EXEC_ID);
  ok(s, 'rm /data/broker-wire.log'); rejected(s, command(EXEC, 'capture'), /Evidence/);
});

test('stopped processes and raw CSV editing never masquerade as business recovery', () => {
  for (const [id, api, unit, dataFile] of [[EXEC_ID, EXEC, 'booking-consumer', '/data/oms-ledger.csv'],
    [ALLOC_ID, ALLOC, 'allocation-adapter', '/config/account-ssi.csv']]) {
    const s = session(id);
    s.scenario.walkthrough.slice(0, -1).forEach(line => ok(s, line));
    ok(s, 'systemctl stop ' + unit);
    rejected(s, command(api, 'close'), /verification/i);
    const edited = session(id);
    ok(edited, "echo fixed > " + dataFile);
    assert.equal(edited.scenario.fix.check(edited.world), false);
    rejected(edited, command(api, 'capture'), /Evidence/);
  }
});

console.log('\nTrade reconciliation: ' + passed + ' passed, ' + failed + ' failed.');
process.exitCode = failed ? 1 : 0;
