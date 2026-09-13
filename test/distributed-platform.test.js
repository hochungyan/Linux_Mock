/* Walkthroughs and adverse controls use the real player shell. Direct mutations
 * below are explicitly labelled downstream fault injection, never recovery. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PS, makeSession, ROOT } = require('./harness');

// Load the actual diagnosis implementation without constructing a DOM. Only
// its toast/HUD presentation is stubbed; shell dispatch and cause logic are real.
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8'), { PS });
const CASES = [
  { id: 'kafka-poison-partition-replay', kind: 'kafka', unit: 'shipment-consumer', pid: 9761,
    evidence: '/captured/kafka/record-201.json', live: '/var/lib/platform/shipments.json',
    evidenceCommands: ['/sim/kafka/status', '/captured/kafka/consumer.log', '/captured/kafka/record-201.json',
      '/captured/kafka/orders.csv', '/captured/kafka/correction.txt'] },
  { id: 'retry-storm-downstream-overload', kind: 'retry', unit: 'checkout-worker', pid: 9762,
    evidence: '/captured/retry/reservations.csv', live: '/var/lib/platform/retry.json',
    evidenceCommands: ['/captured/retry/trace.log', '/captured/retry/policy.json', '/captured/retry/reservations.csv'] },
  { id: 'bad-deploy-probe-restart-loop', kind: 'deploy', unit: 'catalog-controller', pid: 9763,
    evidence: '/captured/deploy/revision-42.yaml', live: '/var/lib/platform/deploy.json',
    evidenceCommands: ['/captured/deploy/events.log', '/captured/deploy/revision-42.yaml', '/captured/deploy/revision-41.yaml',
      '/captured/deploy/compatibility.txt', '/captured/deploy/business.csv'] }
];
const K_SCOPE = { group: 'shipping-v1', topic: 'shipment-requests', partition: 0, offset: 201 };
const K_REPAIR = { eventId: 'SHIP-101', correction: 'CORR-201', units: 2 };
const R_POLICY = { maxAttempts: 2, retryLayer: 'worker', backoff: 'exponential', jitter: 'full',
  baseMs: 100, capMs: 1000, retryBudget: 2, concurrency: 2, idempotency: 'tenant+orderId' };
const D_SCOPE = { namespace: 'storefront', deployment: 'catalog-api' };
const D_ROLLBACK = { ...D_SCOPE, from: 42, to: 41, digest: 'sha256:catalog41' };
function session(c) {
  const scenario = PS.scenarios.find(s => s.id === c.id);
  assert.ok(scenario, c.id);
  const s = makeSession(scenario);
  Object.assign(s.ctx.game, { submitDiagnosis: PS.Game.prototype.submitDiagnosis,
    toast() {}, updateHud() {}, wrongDiagnoses: 0, diagnosed: false });
  return s;
}
function ok(s, cmd) {
  const r = s.run(cmd);
  assert.equal(r.raw.code, 0, cmd + '\n' + r.text);
  assert.doesNotMatch(r.text, /internal error/i);
  return r.text;
}
function post(c, action, body, method = 'POST') {
  return 'curl -X ' + method + ' http://localhost:9976/sim/' + c.kind + '/' + action +
    (body === undefined ? '' : " -d '" + JSON.stringify(body) + "'");
}
function state(s) { return JSON.stringify({ data: s.world.platform, flags: s.world.flags, clock: s.world.clock }); }
function rejected(s, cmd, pattern) {
  const before = state(s), result = s.run(cmd);
  assert.notEqual(result.raw.code, 0, 'must reject: ' + cmd + '\n' + result.text);
  assert.doesNotMatch(result.text, /internal error/i);
  if (pattern) assert.match(result.text, pattern);
  assert.equal(state(s), before, 'rejected operation mutated state: ' + cmd);
  return result.text;
}
function report(s, c) { return JSON.parse(ok(s, 'curl http://localhost:9976/sim/' + c.kind + '/status')); }
function inspect(s) {
  for (const cmd of s.scenario.walkthrough) {
    if (cmd.includes('curl -X POST')) break;
    ok(s, cmd);
  }
}
function through(s, action) {
  for (const cmd of s.scenario.walkthrough) {
    ok(s, cmd);
    if (cmd.includes('/' + action) && cmd.includes('curl -X POST')) return;
  }
  assert.fail('No documented action ' + action);
}
function finish(s) { s.scenario.walkthrough.forEach(cmd => ok(s, cmd)); }
function repeated(s, cmd) {
  ok(s, cmd);
  const after = state(s);
  ok(s, cmd);
  assert.equal(state(s), after, 'safe repeat should be idempotent: ' + cmd);
}

for (const c of CASES) {
  test(c.kind + ': contract, provenance, actual diagnosis command and isolated worlds', () => {
    const s = session(c), sc = s.scenario;
    assert.equal(PS.scenarios.filter(x => x.id === c.id).length, 1);
    assert.equal(sc.rootCauses.filter(x => x.correct).length, 1);
    assert.equal(sc.hints.length, 4);
    assert.ok(sc.debrief.length > 600);
    assert.ok(sc.walkthrough.length >= 13);
    assert.equal(s.world.httpExact, true);
    for (const source of sc.sources) {
      assert.match(source.url, /^https:\/\/(kafka\.apache\.org|kubernetes\.io|aws\.amazon\.com|d1\.awsstatic\.com)\//);
      assert.ok(sc.debrief.includes(source.url), 'source cited in debrief');
      assert.ok(ok(s, 'cat /home/gsupport/runbook.txt').includes(source.url));
    }
    assert.match(ok(s, 'cat ' + c.evidence), /CAPTURED SYNTHETIC/);
    assert.match(ok(s, 'cat /home/gsupport/runbook.txt'), /FICTIONAL SIMULATOR[\s\S]*simulator-only/);
    assert.equal(sc.fix.check(s.world), false);
    assert.ok(sc.fix.grade(s.world).bonus < 0);
    assert.match(ok(s, 'diagnose'), /Root cause - what is actually wrong/);
    const correct = sc.rootCauses.findIndex(x => x.correct), wrong = sc.rootCauses.findIndex(x => !x.correct);
    assert.match(ok(s, 'diagnose ' + (wrong + 1)), /does not hold up/);
    assert.equal(s.ctx.game.wrongDiagnoses, 1);
    assert.match(ok(s, 'diagnose ' + (correct + 1)), /ROOT CAUSE ACCEPTED/);
    assert.equal(s.ctx.game.diagnosed, true);
    assert.equal(sc.fix.check(s.world), false, 'diagnosis alone never repairs');
    ok(s, 'echo local-marker > /tmp/session.txt');
    assert.notEqual(session(c).run('cat /tmp/session.txt').raw.code, 0);
    for (const cmd of ['ps aux', 'systemctl', 'ss -ltnp', 'df -h', 'free -m', 'find /captured -type f']) ok(s, cmd);
  });

  test(c.kind + ': every documented command succeeds, all discoveries fire, and final state remains stable', () => {
    const s = session(c);
    s.scenario.walkthrough.forEach((cmd, i) => {
      ok(s, cmd);
      assert.equal(s.scenario.fix.check(s.world), i === s.scenario.walkthrough.length - 1, 'final verification must be last: ' + cmd);
    });
    // `found` is populated inside the VM-backed simulator; compare contents
    // so a cross-realm Array is not mistaken for a behavioral mismatch.
    assert.equal([...s.found].sort().join('\u0000'), s.scenario.discoveries.map(d => d.id).sort().join('\u0000'));
    assert.equal(s.scenario.fix.grade(s.world).quality, 'clean');
    const saved = ok(s, 'cat /evidence/before' + c.evidence), audit = ok(s, 'cat /var/log/platform/audit.log');
    assert.match(audit, /CAPTURE/);
    s.advance(900);
    ok(s, 'ps aux'); report(s, c); ok(s, 'cat ' + c.live);
    assert.equal(s.scenario.fix.check(s.world), true, '15 virtual minutes cannot undo the recovered state');
    assert.equal(ok(s, 'cat /evidence/before' + c.evidence), saved, 'captured evidence immutable across observation');
    repeated(s, post(c, 'verify-business'));
    assert.equal(s.scenario.fix.check(s.world), true);
  });

  test(c.kind + ': reading the runbook or omitting any required evidence cannot unlock capture', () => {
    const fresh = session(c);
    ok(fresh, 'cat /home/gsupport/runbook.txt');
    rejected(fresh, post(c, 'capture'), /Inspect all required/);
    for (const omitted of c.evidenceCommands) {
      const s = session(c);
      for (const cmd of s.scenario.walkthrough) {
        if (cmd.includes('curl -X POST')) break;
        if (!cmd.includes(omitted)) ok(s, cmd);
      }
      rejected(s, post(c, 'capture'), /Inspect all required/);
      assert.equal(s.scenario.fix.check(s.world), false, omitted);
    }
  });

  test(c.kind + ': omitting each essential recovery step prevents final completion', () => {
    const sc = session(c).scenario;
    for (let omit = 0; omit < sc.walkthrough.length; omit++) {
      if (!sc.walkthrough[omit].includes('curl -X POST')) continue;
      const s = session(c);
      for (let i = 0; i < sc.walkthrough.length; i++) {
        if (i === omit) continue;
        const r = s.run(sc.walkthrough[i]);
        assert.doesNotMatch(r.text, /internal error/i, sc.walkthrough[i]);
      }
      assert.equal(sc.fix.check(s.world), false, 'omitted essential step: ' + sc.walkthrough[omit]);
      assert.ok(sc.fix.grade(s.world).bonus < 0);
    }
  });

  test(c.kind + ': premature actions, wrong methods, malformed data and URL overmatching cannot mutate', () => {
    const fresh = session(c);
    const actions = fresh.scenario.walkthrough.filter(cmd => cmd.includes('curl -X POST'));
    for (const cmd of actions) rejected(fresh, cmd);
    const s = session(c); inspect(s);
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
      for (const cmd of actions) rejected(s, cmd.replace('-X POST', '-X ' + method), /405 POST required/);
    }
    for (const malformed of ['{bad', 'null', '[]', '42', '"true"']) {
      rejected(s, post(c, 'capture') + " -d '" + malformed + "'", /400/);
    }
    rejected(s, post(c, 'capture', { force: true }), /400 Expected fields/);
    rejected(s, post(c, 'capture') + " -d '{}' -d '{}'", /400/);
    rejected(s, post(c, 'status'), /405 GET required/);
    for (const suffix of ['-all', '/extra', '?force=true', '#all']) rejected(s, post(c, 'capture' + suffix), /Connection refused/);
    rejected(s, post(c, 'capture').replace('http://localhost', 'http://remote.invalid/localhost'), /Connection refused/);
    for (const action of ['purge', 'reset', 'delete-all', 'force-success']) rejected(s, post(c, action), /Connection refused/);
    repeated(s, post(c, 'capture'));
  });

  test(c.kind + ': service restarts, stop/start, fatal signals and time do not repair durable causes', () => {
    for (const disrupt of ['systemctl restart ' + c.unit, 'systemctl stop ' + c.unit, 'kill -9 ' + c.pid]) {
      const s = session(c);
      ok(s, disrupt); s.advance(180);
      assert.equal(s.scenario.fix.check(s.world), false, disrupt);
      ok(s, 'systemctl start ' + c.unit);
      finish(s);
      assert.equal(s.scenario.fix.check(s.world), true);
      assert.equal(s.scenario.fix.grade(s.world).quality, 'blunt');
      ok(s, 'systemctl restart ' + c.unit + '.service');
      assert.equal(s.scenario.fix.check(s.world), false, 'restart invalidates final business receipt');
      ok(s, post(c, 'verify-business'));
      assert.equal(s.scenario.fix.check(s.world), true);
      ok(s, 'systemctl stop ' + c.unit);
      rejected(s, post(c, 'verify-business'));
      assert.equal(s.scenario.fix.check(s.world), false, 'stopped controller/consumer is not healed');
    }
  });

  test(c.kind + ': edits to source, evidence copies, live views or audit invalidate even a completed recovery', () => {
    for (const file of [c.evidence, '/evidence/before' + c.evidence, c.live, '/var/log/platform/audit.log']) {
      const s = session(c); finish(s);
      ok(s, 'echo tampered > ' + file);
      assert.equal(s.scenario.fix.check(s.world), false, file);
      rejected(s, post(c, 'verify-business'), /Evidence or audit/);
    }
    const s = session(c); inspect(s);
    ok(s, 'rm ' + c.evidence);
    rejected(s, post(c, 'capture'), /Evidence or audit/);
  });
}

test('Kafka: exact offset quarantine precedes commit, zero lag still leaves a missing shipment', () => {
  const c = CASES[0], s = session(c); through(s, 'capture');
  const original = ok(s, 'cat ' + c.evidence);
  rejected(s, post(c, 'quarantine', K_SCOPE), /Pause partition/);
  repeated(s, post(c, 'pause-partition', K_SCOPE));
  for (const [field, value] of Object.entries({ group: 'another-group', topic: 'ALL', partition: 1, offset: 202 })) {
    rejected(s, post(c, 'quarantine', { ...K_SCOPE, [field]: value }), /Scope/);
  }
  repeated(s, post(c, 'quarantine', K_SCOPE));
  let status = report(s, c);
  assert.deepEqual(status.committedNext, [202, 52]);
  assert.deepEqual(status.lag, [1, 0]);
  assert.equal(status.quarantine.original.offset, 201);
  assert.equal(status.quarantine.original.units, 'two');
  // JSON property order is irrelevant to the API contract.
  repeated(s, post(c, 'resume-partition', { offset: 201, partition: 0, topic: 'shipment-requests', group: 'shipping-v1' }));
  status = report(s, c);
  assert.deepEqual(status.lag, [0, 0]);
  assert.deepEqual(status.missing, ['SHIP-101']);
  assert.equal(status.actualShipments, 4);
  rejected(s, post(c, 'verify-business'), /five unique shipments/);
  assert.equal(s.scenario.fix.check(s.world), false, 'zero lag alone is not fulfilment');
  for (const body of [{ ...K_REPAIR, units: 3 }, { ...K_REPAIR, units: '2' },
    { ...K_REPAIR, correction: 'UNAPPROVED' }, { ...K_REPAIR, eventId: 'SHIP-102' }]) {
    rejected(s, post(c, 'stage-correction', body), /Approved CORR-201/);
  }
  repeated(s, post(c, 'stage-correction', K_REPAIR));
  rejected(s, post(c, 'replay', { eventId: 'ALL' }), /Replay only/);
  repeated(s, post(c, 'replay', { eventId: 'SHIP-101' }));
  rejected(s, post(c, 'verify-business'), /replay proof/);
  repeated(s, post(c, 'verify-replay')); repeated(s, post(c, 'verify-business'));
  status = report(s, c);
  assert.equal(status.actualUnits, 8); assert.equal(status.actualShipments, 5);
  assert.equal(ok(s, 'cat ' + c.evidence), original);
  assert.equal(ok(s, 'cat /evidence/before' + c.evidence), original);
  assert.match(ok(s, 'cat /var/log/platform/audit.log'), /QUARANTINE[\s\S]*COMMIT next=202[\s\S]*RESUME[\s\S]*REPLAY APPLIED/);
});

test('retry: enforce bounds and resolve ambiguous outcomes before retrying only pending orders', () => {
  const c = CASES[1], s = session(c); through(s, 'capture');
  rejected(s, post(c, 'contain', { route: 'ALL' }), /Scope/);
  repeated(s, post(c, 'contain', { route: 'checkout-inventory' }));
  rejected(s, post(c, 'drain-inflight'), /bounded policy/);
  for (const [field, value] of Object.entries({ maxAttempts: 99, retryLayer: 'gateway+worker', backoff: 'none', jitter: 'none',
    baseMs: 0, capMs: 999999, retryBudget: 'unbounded', concurrency: 24, idempotency: 'new-key-per-attempt' })) {
    rejected(s, post(c, 'apply-policy', { ...R_POLICY, [field]: value }), /bounded policy/);
  }
  repeated(s, post(c, 'apply-policy', R_POLICY));
  rejected(s, post(c, 'reconcile'), /drain/);
  repeated(s, post(c, 'drain-inflight'));
  rejected(s, post(c, 'retry-pending', { ids: ['ORD-102', 'ORD-103'] }), /reconcile/);
  repeated(s, post(c, 'reconcile'));
  assert.deepEqual(report(s, c).pending, ['ORD-102', 'ORD-103']);
  for (const ids of [[], ['ALL'], ['ORD-101', 'ORD-102'], ['ORD-102', 'ORD-102'], ['ORD-102', 'UNKNOWN'], 'ORD-102']) {
    rejected(s, post(c, 'retry-pending', { ids }), /two reconciled pending/);
  }
  repeated(s, post(c, 'retry-pending', { ids: ['ORD-103', 'ORD-102'] }));
  const status = report(s, c);
  assert.equal(status.retryTokensUsed, 2);
  assert.equal(status.reservations.length, 3);
  assert.deepEqual(status.attempts.map(a => [a.id, a.attempt, a.waitMs, a.result]), [
    ['ORD-102', 1, 0, 'ADMISSION_REJECTED'], ['ORD-102', 2, 37, 'APPLIED'],
    ['ORD-103', 1, 0, 'APPLIED_RESPONSE_LOST'], ['ORD-103', 2, 73, 'DEDUPLICATED']
  ]);
  assert.equal(status.reservations.filter(r => r.id === 'ORD-101').length, 1, 'ambiguous committed reservation untouched');
  for (const quantity of [0, 2, '1']) rejected(s, post(c, 'probe-retry', { orderId: 'ORD-103', quantity }), /INTENT_MISMATCH/);
  rejected(s, post(c, 'canary'), /duplicate probe/);
  repeated(s, post(c, 'probe-retry', { orderId: 'ORD-103', quantity: 1 }));
  rejected(s, post(c, 'reopen', { route: 'checkout-inventory' }), /Canary/);
  repeated(s, post(c, 'canary'));
  rejected(s, post(c, 'reopen', { route: 'ALL' }), /Scope/);
  repeated(s, post(c, 'reopen', { route: 'checkout-inventory' }));
  repeated(s, post(c, 'verify-business'));
  assert.equal(report(s, c).reservations.reduce((n, r) => n + r.quantity, 0), 5);
});

test('deploy: wrong revision/scope rejected, serving replicas retained, startup gating and stable window enforced', () => {
  const c = CASES[2], s = session(c); through(s, 'capture');
  rejected(s, post(c, 'pause-rollout', { ...D_SCOPE, namespace: 'ALL' }), /Scope/);
  repeated(s, post(c, 'pause-rollout', D_SCOPE));
  rejected(s, post(c, 'rollback', D_ROLLBACK), /compatibility/);
  repeated(s, post(c, 'check-rollback'));
  for (const [field, value] of Object.entries({ namespace: 'production', deployment: 'ALL', from: 41, to: 40, digest: 'latest' })) {
    rejected(s, post(c, 'rollback', { ...D_ROLLBACK, [field]: value }), /scope\/revision\/digest/);
  }
  const old = report(s, c).pods.slice(0, 2);
  repeated(s, post(c, 'rollback', D_ROLLBACK));
  let status = report(s, c);
  assert.deepEqual(status.pods.slice(0, 2), old);
  assert.equal(status.ready, 2);
  assert.equal(status.pods[2].age, 0);
  assert.equal(status.pods[2].probes.startup, 503);
  assert.equal(status.pods[2].probes.liveness, 'SUPPRESSED');
  assert.equal(status.pods[2].probes.readiness, 'SUPPRESSED');
  rejected(s, post(c, 'verify-probes'), /60 stable seconds/);
  for (const seconds of [0, -1, 1.5, 301, '150']) rejected(s, post(c, 'observe', { seconds }), /integer from 1 to 300/);
  ok(s, post(c, 'observe', { seconds: 75 }));
  status = report(s, c);
  assert.equal(status.ready, 3);
  assert.equal(status.pods[2].stableSeconds, 0);
  rejected(s, post(c, 'verify-probes'), /60 stable seconds/);
  ok(s, post(c, 'observe', { seconds: 59 }));
  rejected(s, post(c, 'verify-probes'), /60 stable seconds/);
  ok(s, post(c, 'observe', { seconds: 1 }));
  rejected(s, post(c, 'resume-rollout', D_SCOPE), /probe verification/);
  repeated(s, post(c, 'verify-probes'));
  status = report(s, c);
  assert.deepEqual(status.probeProof, { dependencyOutageSeconds: 60, dependencyOutageReady: 2,
    livenessDuringOutage: 200, restartsAdded: 0, restoredReady: 3 });
  repeated(s, post(c, 'resume-rollout', D_SCOPE));
  repeated(s, post(c, 'verify-business'));
  assert.deepEqual(report(s, c).responses.map(r => [r.id, r.total]), [['CART-501', 50], ['CART-502', 80]]);
  s.advance(600);
  assert.ok(report(s, c).pods.every(p => p.restarts === 0 && p.revision === 41));
  assert.equal(s.scenario.fix.check(s.world), true);
});

test('downstream fault injection: actual business corruption defeats receipts, flags and successful transport', () => {
  const faults = [
    [CASES[0], d => { d.shipments[0].units++; }],
    [CASES[0], d => { d.shipments[1].id = d.shipments[0].id; }],
    [CASES[0], d => { d.committed[1] = 53; }],
    [CASES[0], d => { d.quarantine.original.units = 2; }],
    [CASES[1], d => { d.reservations[0].quantity++; }],
    [CASES[1], d => { d.reservations[1].id = d.reservations[0].id; }],
    [CASES[1], d => { d.policy.maxAttempts = 5; }],
    [CASES[1], d => { d.inFlight = 24; }],
    [CASES[2], d => { d.pods[2].restarts++; }],
    [CASES[2], d => { d.pods[2].livePath = '/ready'; }],
    [CASES[2], d => { d.dependency = false; }],
    [CASES[2], d => { d.responses[0].total = 49; }]
  ];
  for (const [c, corrupt] of faults) {
    const s = session(c); finish(s);
    corrupt(s.world.platform); // Fault injection only: never a recovery mechanism.
    s.world.flags.fixed = true;
    assert.equal(s.scenario.fix.check(s.world), false, c.kind + ': receipt/flag cannot mask corrupt state');
    rejected(s, post(c, 'verify-business'));
    assert.ok(s.scenario.fix.grade(s.world).bonus < 0);
  }
});

test('captured evidence can be discovered through ordinary alternate file-reading tools', () => {
  for (const c of CASES) {
    const s = session(c);
    for (const cmd of s.scenario.walkthrough) {
      if (cmd.includes('curl -X POST')) break;
      ok(s, cmd.startsWith('cat /captured/') ? cmd.replace('cat ', "sed -n '1,200p' ") : cmd);
    }
    ok(s, post(c, 'capture'));
    assert.ok(s.world.platform.saved);
  }
});
