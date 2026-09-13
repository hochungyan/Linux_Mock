const { PS, makeSession, check, section, failCount } = require('./harness');
const cases = PS.scenarios.filter(s => s.track === 'fix' && s.walkthrough);
check('six new FIX investigations', cases.length === 6);
check('existing FIX case moved without changing saved ID', PS.scenarios.some(s => s.id === 'fix-seqnum-gap' && s.track === 'fix'));
for (const sc of cases) {
  section(sc.id);
  const s = makeSession(sc), d = s.world.fixLab, prefix = 'fixctl ' + d.session + ' ';
  check('help documents fictional controls', /FICTIONAL LAB/.test(s.run('fixctl help').text));
  check('not solved by close alone', s.run(prefix + 'close').raw.code !== 0 && !sc.fix.check(s.world));
  check('not solved by verify alone', s.run(prefix + 'verify').raw.code !== 0);
  check('premature reset rejected', s.run(prefix + 'reset 1 1').raw.code !== 0);
  check('unaffected session rejects mutation', s.run('fixctl ORDER-B-HEALTHY reset 1 1').raw.code !== 0);
  check('unknown verbs reject', s.run(prefix + 'cancel-all').raw.code !== 0);
  check('extra arguments rejected', s.run(prefix + 'status --force').raw.code !== 0);
  for (let i = 0; i < sc.walkthrough.length; i++) {
    const command = sc.walkthrough[i], r = s.run(command);
    check('walkthrough: ' + command, r.raw.code === 0, r.text);
    if (i < sc.walkthrough.length - 1) check('still open until explicit close ' + i, !sc.fix.check(s.world));
  }
  check('all evidence discoveries found', s.found.length === sc.discoveries.length, s.found);
  check('recovery closes', sc.fix.check(s.world));
  check('business quantities match', /"bookedQty": 70/.test(s.run(prefix + 'compare').text));
  check('healthy session untouched', d.healthyOther.nextIn === 9001 && d.healthyOther.nextOut === 8001 && d.healthyOther.connected);
  check('clean grade', sc.fix.grade(s.world).quality === 'clean');
  const damaged = makeSession(sc);
  damaged.run('rm /var/lib/fix/sequence-store.json');
  check('deleting store prevents capture', damaged.run(prefix + 'capture').raw.code !== 0);
  const snapshot = makeSession(sc);
  snapshot.run(prefix + 'capture');
  snapshot.run('echo damaged > /evidence/before/etc/fix/session.cfg');
  check('tampered captured evidence blocks recovery', snapshot.run(prefix + 'pause').raw.code !== 0);
  s.run(prefix + 'pause');
  check('subsequent change invalidates closure', !sc.fix.check(s.world));
}
function prepared(id) {
  const sc = cases.find(s => s.id === id), s = makeSession(sc);
  for (const cmd of sc.walkthrough) {
    s.run(cmd);
    if (cmd.includes(' approve ')) break;
  }
  s.prefix = 'fixctl ' + s.world.fixLab.session + ' ';
  return s;
}
section('protocol-specific guards');
const reset = prepared('fix-coordinated-sequence-reset');
check('unapproved numeric override fails', reset.run(reset.prefix + 'reset 900 700').raw.code !== 0);
reset.run(reset.prefix + 'disconnect');
reset.run(reset.prefix + 'reset 1 1');
check('both independent counters reset to 1', reset.world.fixLab.nextIn === 1 && reset.world.fixLab.nextOut === 1);
reset.run(reset.prefix + 'connect');
check('bilateral logon consumes 34=1 each way', reset.world.fixLab.nextIn === 2 && reset.world.fixLab.nextOut === 2);
check('cannot reset connected session', reset.run(reset.prefix + 'reset 1 1').raw.code !== 0);
const gap = prepared('fix-resend-gap-recovery');
check('gap cannot be hidden by reset', gap.run(gap.prefix + 'reset 1 1').raw.code !== 0);
check('overbroad replay range rejected', gap.run(gap.prefix + 'resend 1 0').raw.code !== 0);
check('premature probe does not advance the unresolved gap', gap.run(gap.prefix + 'test EARLY').raw.code !== 0 && gap.world.fixLab.nextIn === 501);
gap.run(gap.prefix + 'resend 501 503');
const replayLog = gap.run('cat /var/log/fix/recovery.log').text;
check('replay preserves application sequence and duplicate metadata', /34=501\|43=Y\|122=/.test(replayLog) && /34=503\|43=Y\|122=/.test(replayLog));
check('gap-fill only covers admin slot 502', /34=502\|43=Y\|123=Y\|36=503/.test(replayLog));
check('buffered message released after gap', gap.world.fixLab.nextIn === 505 && gap.world.fixLab.applied.length === 3);
check('same gap not replayed twice', gap.run(gap.prefix + 'resend 501 503').raw.code !== 0);
const hb = prepared('fix-heartbeat-testrequest');
hb.run(hb.prefix + 'test CHECK-FAIL');
check('unrelated heartbeat does not satisfy probe', hb.run(hb.prefix + 'check-heartbeat CHECK-FAIL').raw.code !== 0);
check('cannot acknowledge a different TestReqID', hb.run(hb.prefix + 'check-heartbeat UNRELATED').raw.code !== 0);
check('peer recovery requires disconnect', hb.run(hb.prefix + 'peer-repair CHG-F103').raw.code !== 0);
hb.run(hb.prefix + 'disconnect'); hb.run(hb.prefix + 'peer-repair CHG-F103'); hb.run(hb.prefix + 'connect');
hb.run(hb.prefix + 'test CHECK-OK');
check('matching fresh heartbeat succeeds', hb.run(hb.prefix + 'check-heartbeat CHECK-OK').raw.code === 0);
check('probe ID cannot be reused', hb.run(hb.prefix + 'test CHECK-OK').raw.code !== 0);
for (const id of ['fix-dropcopy-source-mapping', 'fix-dropcopy-consumer-lag']) {
  const s = prepared(id), d = s.world.fixLab;
  const replay = d.kind === 'mapping' ? 'recover-source ORDER-B' : 'replay-inbox';
  check(id + ' rejects recovery before underlying repair', s.run(s.prefix + replay).raw.code !== 0);
  const repair = d.kind === 'mapping' ? 'map-source ORDER-B CHG-F104' : 'consumer-schema schema-v2 CHG-F105';
  s.run(s.prefix + repair); s.run(s.prefix + replay); s.run(s.prefix + replay);
  check(id + ' replay is idempotent', d.applied.length === 3 && d.applied.reduce((n, e) => n + e.qty, 0) === 70);
  check(id + ' does not reset FIX counters', d.nextIn === 613 && d.nextOut === 811);
}
const identity = prepared('fix-logon-compid-mismatch');
check('wrong CompID rejected', identity.run(identity.prefix + 'identity HF_UAT BROKER_PROD CHG-F106').raw.code !== 0);
check('wrong approval rejected', identity.run(identity.prefix + 'identity HF_PROD BROKER_PROD CHG-OTHER').raw.code !== 0);
identity.run(identity.prefix + 'disconnect'); identity.run(identity.prefix + 'identity HF_PROD BROKER_PROD CHG-F106'); identity.run(identity.prefix + 'connect');
check('identity correction preserves prior sequence history', identity.world.fixLab.nextIn === 612 && identity.world.fixLab.nextOut === 812);
console.log('\nFIX incident checks: ' + failCount() + ' failures');
process.exitCode = failCount() ? 1 : 0;
