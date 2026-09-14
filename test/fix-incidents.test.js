/* Player commands and UI operations exercise real state, not a canned command string. */
const assert = require('node:assert/strict');
const { PS, makeSession } = require('./harness');
const P = PS.fixTraining.paths;
const cases = PS.scenarios.filter(s => s.track === 'fix');
assert.equal(cases.length, 7);
function run(s, cmd) { const r = s.run(cmd); assert.equal(r.raw.code, 0, cmd + '\n' + r.text); return r.text; }
function act(s, id, succeeds = true) { const r = s.scenario.supportAction(s.world, id); assert.equal(!!(r && r.code), !succeeds, id + '\n' + JSON.stringify(r)); return r; }
function step(s, x) { if (typeof x === 'string') run(s, x); else act(s, x.action); }
function session(kind) { return makeSession(cases.find(s => s.build().fixOps.kind === kind)); }
function prepare(s) { for (const x of s.scenario.walkthrough) { step(s, x); if (x.action === 'hold') break; } }
function recover(s) { s.scenario.walkthrough.forEach(x => step(s, x)); }
for (const sc of cases) {
  const s = makeSession(sc);
  assert(sc.objective && sc.brief.includes(P.config) && sc.brief.includes(P.runbook));
  assert.equal(sc.rootCauses.filter(c => c.correct).length, 1);
  assert.equal(s.run('fixctl DC-GAP resend 501 503').raw.code, 127, 'no fake FIX terminal command');
  assert.notEqual(s.run('curl http://localhost:9980/admin/session/GSCLIENT1/reset').raw.code, 0, 'old reset endpoint removed');
  act(s, 'close', false); act(s, 'contact-peer', false); act(s, 'review-session', false);
  sc.walkthrough.forEach((x, i) => {
    step(s, x);
    assert.equal(sc.fix.check(s.world), i === sc.walkthrough.length - 1, sc.id + ' must close only after final verification');
  });
  assert.equal(s.found.length, sc.discoveries.length);
  assert.equal(sc.fix.grade(s.world).quality, 'clean');
  const state = JSON.parse(run(s, 'cat ' + P.state));
  assert.equal(state.otherSessions.NextTargetMsgSeqNum, 9001);
  assert.equal(state.otherSessions.NextSenderMsgSeqNum, 8001);
  assert.equal(state.otherSessions.loggedOn, true);
  assert.equal(s.world.fixOps.comparison().appliedQty, 75);
  assert.equal(s.world.fixOps.comparison().appliedCount, 4);
  assert.equal(s.world.fixOps.loaded.ResetOnLogon, 'N');
  const damaged = makeSession(sc);
  damaged.run('echo altered > /evidence/incident/engine-state.json');
  damaged.scenario.walkthrough.filter(x => typeof x === 'string').slice(0, 7).forEach(x => damaged.run(x));
  act(damaged, 'contact-peer', false);
  // Fault injection: same totals with wrong economics must not be healthy.
  s.world.fixOps.applied[0].price = 999;
  assert.equal(sc.fix.check(s.world), false, 'business economics checked independently of counts');
  console.log('PASS ' + sc.id + ': full recovery, retained evidence, fresh business activity');
}
{
  const s = session('reset'); prepare(s); const d = s.world.fixOps;
  const originalCounters = [d.nextIn, d.nextOut];
  run(s, "sed 's/ResetOnLogon=N/ResetOnLogon=Y/' " + P.config + ' > /tmp/session.cfg');
  run(s, 'mv /tmp/session.cfg ' + P.config);
  assert.equal(d.loaded.ResetOnLogon, 'N', 'disk edit does not mutate loaded config');
  run(s, 'systemctl start fix-connector');
  assert.equal(d.loaded.ResetOnLogon, 'N', 'start of active service is a no-op');
  assert.deepEqual([d.nextIn, d.nextOut], originalCounters);
  assert.notEqual(s.run('systemctl reload fix-connector').raw.code, 0, 'no invented generic reload');
  run(s, 'systemctl stop fix-connector');
  assert.equal(PS.world.findProc(s.world, 6200), null);
  run(s, 'systemctl start fix-connector');
  assert.equal(d.loaded.ResetOnLogon, 'Y'); assert.equal(d.resetCount, 1);
  assert.deepEqual([d.nextIn, d.nextOut], [2, 2]);
  assert.match(run(s, 'cat ' + P.log), /35=A\|34=1[\s\S]*141=Y/);
  run(s, 'cat ' + P.state); act(s, 'review-session'); run(s, 'cat ' + P.business); act(s, 'reconcile');
  act(s, 'resume', false, 'temporary reset must not remain loaded');
  run(s, 'cp /etc/quickfixj/normal-session.cfg ' + P.config);
  act(s, 'resume', false, 'disk rollback alone does not unload reset policy');
  run(s, 'systemctl stop fix-connector'); run(s, 'systemctl start fix-connector');
  assert.equal(d.resetCount, 1); assert.equal(d.loaded.ResetOnLogon, 'N');
  assert(d.nextIn > 2 && d.nextOut > 2, 'normal restart keeps sequence history including Logout/Logon');
  run(s, 'cat ' + P.log); run(s, 'cat ' + P.state); act(s, 'review-session');
  run(s, 'cat ' + P.business); act(s, 'reconcile'); act(s, 'resume'); act(s, 'observe-live'); run(s, 'cat ' + P.business); act(s, 'close');
  assert(s.scenario.fix.check(s.world));
}
{
  const s = session('reset'); prepare(s);
  act(s, 'jmx-logoff'); act(s, 'jmx-reset');
  assert.deepEqual([s.world.fixOps.nextIn, s.world.fixOps.nextOut], [1, 1], 'JMX alternative resets both local counters');
  act(s, 'jmx-logon');
  assert.deepEqual([s.world.fixOps.nextIn, s.world.fixOps.nextOut], [2, 2]);
  act(s, 'jmx-reset', false);
}
{
  const s = session('gap'); prepare(s); const d = s.world.fixOps;
  const original = [d.nextIn, d.nextOut];
  run(s, 'cp ' + P.config + ' /tmp/original.cfg');
  run(s, "sed 's/ResetOnLogon=N/ResetOnLogon=Y/' " + P.config + ' > /tmp/reset.cfg');
  run(s, 'cp /tmp/reset.cfg ' + P.config);
  assert.notEqual(s.run('systemctl restart fix-connector').raw.code, 0);
  assert.deepEqual([d.nextIn, d.nextOut], original, 'unapproved reset cannot skip executions');
  run(s, 'cp /tmp/original.cfg ' + P.config);
  act(s, 'skip-gap', false); act(s, 'peer-replay');
  const log = run(s, 'cat ' + P.log);
  assert.match(log, /35=2\|34=811\|7=501\|16=0/);
  assert.match(log, /34=501\|43=Y\|122=/);
  assert.match(log, /34=502\|43=Y\|122=[^|]+\|123=Y\|36=503/);
  assert.equal(d.nextIn, 505); assert.equal(d.comparison().appliedQty, 70);
  act(s, 'peer-replay'); assert.equal(d.applied.length, 3, 'no duplicate booking');
}
{
  const s = session('identity'); prepare(s); const d = s.world.fixOps;
  assert.equal(d.loaded.SenderCompID, 'HF_UAT');
  run(s, 'systemctl stop fix-connector');
  run(s, 'cp ' + P.staged + ' ' + P.config);
  run(s, 'systemctl start fix-connector');
  assert.equal(d.loaded.SenderCompID, 'HF_PROD');
  assert.deepEqual([d.nextIn, d.nextOut], [712, 912], 'correct identity loads its own retained store');
  assert.equal(d.resetCount, 0);
}
{
  const s = session('consumer'); prepare(s);
  const d = s.world.fixOps, counters = [d.nextIn, d.nextOut];
  run(s, 'cp /etc/dropcopy/approved-consumer.properties ' + P.consumer);
  assert.equal(d.applied.length, 1, 'config edit does not trigger consumer processing');
  run(s, 'systemctl start dropcopy-consumer');
  assert.equal(d.applied.length, 1, 'start of running consumer does not restart it');
  run(s, 'systemctl stop dropcopy-consumer'); run(s, 'systemctl start dropcopy-consumer');
  assert.equal(d.applied.length, 3);
  assert.deepEqual([d.nextIn, d.nextOut], counters, 'consumer recovery never resets FIX');
  run(s, 'systemctl restart dropcopy-consumer'); assert.equal(d.applied.length, 3);
}
{
  const s = session('mapping'); prepare(s); const d = s.world.fixOps, counters = [d.nextIn, d.nextOut];
  act(s, 'import-export', false); act(s, 'venue-map');
  assert.equal(d.applied.length, 1, 'mapping alone does not recover history');
  act(s, 'import-export'); act(s, 'import-export');
  assert.equal(d.applied.length, 3); assert.deepEqual([d.nextIn, d.nextOut], counters);
}
{
  const s = session('heartbeat'); prepare(s);
  act(s, 'jmx-logon'); assert.equal(s.world.fixOps.connected, false, 'reconnect alone does not repair peer dispatcher');
  act(s, 'peer-dispatcher'); act(s, 'jmx-logon'); act(s, 'jmx-test');
  run(s, 'cat ' + P.state); act(s, 'review-session', false);
  const log = run(s, 'cat ' + P.log);
  assert.match(log, /35=1[^\n]+112=TEST-1/); assert.match(log, /35=0[^\n]+112=TEST-1/);
  act(s, 'review-session'); act(s, 'jmx-test');
  act(s, 'review-session', false, 'new probe requires fresh evidence');
}
{
  const s = session('reset'); prepare(s);
  run(s, "echo 'NextSeqNo=504' >> " + P.config);
  assert.notEqual(s.run('systemctl restart fix-connector').raw.code, 0);
  const parsed = PS.fixTraining.settings('[DEFAULT]\nResetOnLogon=N\n[SESSION]\nResetOnLogon=Y\n');
  assert.equal(parsed.ResetOnLogon, 'Y', 'session setting overrides default');
  assert.equal(PS.fixTraining.settings('[DEFAULT]\nResetOnLogon=N\n[SESSION]\nResetOnLogon=N\nResetOnLogon=Y\n'), null, 'ambiguous duplicate rejected');
}
console.log('All seven FIX investigations passed: config lifecycle, JMX alternatives, recovery, reconciliation and negative paths.');
