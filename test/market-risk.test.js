/* Actual player commands, state and business invariants, not substring-only answer checks. */
const assert = require('assert');
const { PS, makeSession } = require('./harness.js');
function session(id) { const sc = PS.scenarios.find(s => s.id === id); assert(sc, id); return makeSession(sc); }
function ok(s, cmd) { const r = s.run(cmd); assert.strictEqual(r.raw.code, 0, cmd + '\n' + r.text); return r.text; }
function blocked(s, cmd) { const before = JSON.stringify(s.world.flags); assert.notStrictEqual(s.run(cmd).raw.code, 0, cmd); assert.strictEqual(JSON.stringify(s.world.flags), before); }
const bp = 'curl -X POST http://localhost:9982/books/';
const rp = 'curl -X POST http://localhost:9982/risk/';
for (const id of ['market-book-sequence-gap', 'stale-fx-risk-valuation']) {
  const s = session(id);
  assert.strictEqual(s.scenario.fix.check(s.world), false);
  assert.strictEqual(s.scenario.rootCauses.filter(c => c.correct).length, 1);
  s.scenario.walkthrough.forEach((cmd, index) => {
    ok(s, cmd);
    assert.strictEqual(s.scenario.fix.check(s.world), index === s.scenario.walkthrough.length - 1, id + ' closes only after release');
  });
  assert.strictEqual(s.found.length, s.scenario.discoveries.length, 'all evidence reachable');
  assert.strictEqual(s.scenario.fix.grade(s.world).quality, 'clean');
  assert(s.scenario.sources.every(src => /^https:\/\//.test(src.url)));
  s.advance(60);
  assert(s.scenario.fix.check(s.world), 'recovery persists');
}
{
  const s = session('market-book-sequence-gap');
  blocked(s, 'curl http://localhost:9982/books/hold');
  assert.strictEqual(s.world.book.held, false, 'GET must not mutate');
  blocked(s, bp + 'resume'); blocked(s, bp + 'capture'); blocked(s, bp + 'recover/SNAP-GOOD');
  blocked(s, 'curl http://localhost:9982/books/verify');
  ok(s, bp + 'hold'); ok(s, bp + 'capture');
  blocked(s, bp + 'recover/SNAP-GOOD-extra');
  blocked(s, 'curl -X POST http://evil.test/localhost:9982/books/recover/SNAP-GOOD');
  blocked(s, bp + 'recover/SNAP-OLD');
  assert.strictEqual(s.world.book.valid, false);
  ok(s, bp + 'recover/SNAP-GOOD');
  blocked(s, bp + 'resume');
  const sizes = [s.world.book.bidSize, s.world.book.askSize];
  ok(s, bp + 'recover/SNAP-GOOD');
  assert.deepStrictEqual([s.world.book.bidSize, s.world.book.askSize], sizes, 'no double application');
  ok(s, 'curl http://localhost:9982/books/verify'); ok(s, bp + 'resume');
  assert(s.scenario.fix.check(s.world));
  assert.match(ok(s, 'cat /data/books/local.csv'), /104,125,137,true/);
  assert.match(ok(s, 'cat /evidence/book-before.json'), /"valid": false/);
  assert.match(ok(s, 'cat /var/log/bookbuilder/audit.log'), /HOLD[\s\S]*RECOVER[\s\S]*RESUME/);
}
{
  const s = session('stale-fx-risk-valuation');
  blocked(s, rp + 'release'); blocked(s, rp + 'capture'); blocked(s, rp + 'revalue');
  blocked(s, 'curl http://localhost:9982/risk/verify');
  ok(s, rp + 'hold'); ok(s, rp + 'capture');
  blocked(s, rp + 'select/FX-20260910-OLD'); blocked(s, rp + 'select/FX-20260911-UNAPPROVED');
  assert.strictEqual(s.world.risk.usd, 1080000);
  ok(s, rp + 'select/FX-20260911-APPROVED');
  blocked(s, 'curl http://localhost:9982/risk/verify');
  ok(s, rp + 'revalue'); blocked(s, rp + 'release');
  ok(s, rp + 'revalue'); assert.strictEqual(s.world.risk.runs, 1);
  assert.strictEqual(s.world.risk.usd, 1100000);
  ok(s, 'curl http://localhost:9982/risk/verify'); ok(s, rp + 'release');
  assert(s.scenario.fix.check(s.world));
  assert.match(ok(s, 'cat /evidence/risk-before.json'), /1080000/);
  assert.match(ok(s, 'cat /data/risk/result.csv'), /2026-09-11,1000000,1100000/);
  assert.match(ok(s, "awk -F, 'NR>1 {sum += $4} END {print sum}' /data/risk/positions.csv"), /1000000/);
  assert.match(ok(s, 'cat /var/log/risk-publisher/audit.log'), /HOLD[\s\S]*REVALUE[\s\S]*RELEASE/);
}
for (const pair of [['market-book-sequence-gap', 'bookbuilder'], ['stale-fx-risk-valuation', 'risk-publisher']]) {
  const s = session(pair[0]);
  ok(s, 'kill -9 7300');
  blocked(s, pair[0] === 'market-book-sequence-gap' ? bp + 'hold' : rp + 'hold');
  ok(s, 'systemctl restart ' + pair[1]);
  assert.strictEqual(s.scenario.fix.check(s.world), false, 'restart cannot cure a data error');
  s.scenario.walkthrough.forEach(cmd => ok(s, cmd));
  assert.strictEqual(s.scenario.fix.grade(s.world).quality, 'blunt');
}
console.log('Market-data and valuation investigations passed: recovery, business evidence, guards, retries and restart consequences.');
