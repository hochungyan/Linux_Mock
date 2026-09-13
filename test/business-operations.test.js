/* test/business-operations.test.js
 *
 * Regulatory reporting, corporate actions, nostro cash and certificate
 * incidents. Each walkthrough must solve the case and must NOT close it early,
 * and every wrong remediation route must be graded as intended.
 */
const { PS, W, makeSession, check, section, failCount } = require('./harness.js');

const S = id => PS.scenarios.find(s => s.id === id);
const IDS = [
  'mifir-transaction-reporting',
  'corporate-action-split',
  'nostro-statement-missing',
  'tls-cert-expiry-open'
];

section('cases are registered and well formed');
IDS.forEach(id => {
  const sc = S(id);
  check(id + ' exists', !!sc);
  if (!sc) return;
  check(id + ' has primary sources', (sc.sources || []).length >= 2);
  check(id + ' has a walkthrough', (sc.walkthrough || []).length >= 8);
  check(id + ' has exactly one correct root cause',
    sc.rootCauses.filter(c => c.correct).length === 1);
  check(id + ' has four hints', (sc.hints || []).length >= 4);
  check(id + ' has a substantial debrief', (sc.debrief || '').length > 800);
});

section('walkthroughs solve the case, and only on the last step');
IDS.forEach(id => {
  const sc = S(id);
  if (!sc) return;
  const s = makeSession(sc);
  check(id + ' starts unresolved', sc.fix.check(s.world) === false);

  let brokeEarly = null;
  let errored = null;
  sc.walkthrough.forEach((cmd, i) => {
    const r = s.run(cmd);
    if (/command not found|internal error/.test(r.text)) errored = cmd + ' -> ' + r.text.slice(0, 160);
    const last = i === sc.walkthrough.length - 1;
    if (!last && sc.fix.check(s.world) && brokeEarly === null) brokeEarly = 'closed early at step ' + (i + 1) + ': ' + cmd;
  });

  check(id + ' every walkthrough command runs', errored === null, errored);
  check(id + ' does not close before the final step', brokeEarly === null, brokeEarly);
  check(id + ' is resolved after the walkthrough', sc.fix.check(s.world) === true);
  check(id + ' graded clean on the walkthrough', sc.fix.grade(s.world).quality === 'clean',
    JSON.stringify(sc.fix.grade(s.world)).slice(0, 200));
  check(id + ' collects most findings', s.found.length >= Math.min(5, sc.discoveries.length),
    s.found.join(','));
});

section('MiFIR: resubmitting everything is worse than the rejects');
{
  const sc = S('mifir-transaction-reporting');
  const s = makeSession(sc);
  const refused = s.run('curl -X POST http://localhost:9700/admin/report/resubmit-rejected');
  check('resubmit refused while reference data is unchanged', /refused/.test(refused.text), refused.text);
  check('still unresolved', sc.fix.check(s.world) === false);

  const s2 = makeSession(sc);
  s2.run('curl -X POST http://localhost:9700/admin/report/resubmit-all');
  s2.run('curl -X POST http://localhost:9700/admin/report/verify');
  check('resubmit-all does clear the rejects', sc.fix.check(s2.world) === true);
  check('but is heavily penalised', sc.fix.grade(s2.world).bonus <= -400,
    String(sc.fix.grade(s2.world).bonus));
  const v = s2.run('curl -X POST http://localhost:9700/admin/report/verify');
  check('duplicates are visible in verification', /"duplicates": 88000/.test(v.text), v.text);
}

section('Corporate action: the price is the one correct number');
{
  const sc = S('corporate-action-split');
  const s = makeSession(sc);
  const refused = s.run('curl -X POST http://localhost:9800/admin/valuation/revalue');
  check('revalue refused before the event is applied', /refused/.test(refused.text), refused.text);

  const s2 = makeSession(sc);
  s2.run('curl -X POST http://localhost:9800/admin/price/override');
  s2.run('curl -X POST http://localhost:9800/admin/ca/verify');
  check('price override "fixes" the valuation', sc.fix.check(s2.world) === true);
  check('and is heavily penalised', sc.fix.grade(s2.world).bonus <= -400,
    String(sc.fix.grade(s2.world).bonus));
  const v = s2.run('curl -X POST http://localhost:9800/admin/ca/verify');
  check('override is flagged as a manual mark', /MANUAL OVERRIDE/.test(v.text), v.text);
}

section('Nostro: force-complete publishes a number nobody checked');
{
  const sc = S('nostro-statement-missing');
  const s = makeSession(sc);
  const refused = s.run('curl -X POST http://localhost:9900/admin/recon/rerun');
  check('rerun refused while statement 188 is missing', /refused/.test(refused.text), refused.text);

  const gap = s.run('grep -h ":28C:" /data/nostro/inbound/*.txt /data/nostro/archive/*.txt');
  check('sequence gap is visible in 28C', /187/.test(gap.text) && /189/.test(gap.text) && !/188/.test(gap.text), gap.text);

  const s2 = makeSession(sc);
  s2.run('curl -X POST http://localhost:9900/admin/recon/force-complete');
  s2.run('curl -X POST http://localhost:9900/admin/recon/verify');
  check('force-complete closes the recon', sc.fix.check(s2.world) === true);
  check('and is heavily penalised', sc.fix.grade(s2.world).bonus <= -400,
    String(sc.fix.grade(s2.world).bonus));
  const v = s2.run('curl -X POST http://localhost:9900/admin/recon/verify');
  check('closing balance flagged untrustworthy', /"closingBalanceTrustworthy": false/.test(v.text), v.text);
}

section('TLS: reload beats restart, and disabling TLS is not a fix');
{
  const sc = S('tls-cert-expiry-open');

  // reload before copying the cert must fail
  const s = makeSession(sc);
  const early = s.run('systemctl reload fixgw');
  check('reload refused while the live cert is still expired', /expired/i.test(early.text), early.text);
  check('still unresolved', sc.fix.check(s.world) === false);

  // expired cert is visible, staged one is not
  const live = s.run('openssl x509 -in /apps/fixgw/certs/live/fixgw.crt -noout -dates');
  check('live cert shows as expired', /EXPIRED/.test(live.text), live.text);
  const staged = s.run('openssl x509 -in /apps/fixgw/certs/staged/fixgw.crt -noout -dates');
  check('staged cert is valid', !/EXPIRED/.test(staged.text) && /2027/.test(staged.text), staged.text);
  const probe = s.run('openssl s_client -connect localhost:9443');
  check('s_client reports the expiry', /certificate has expired/.test(probe.text), probe.text);

  // modulus check proves the staged cert pairs with the live key
  const m1 = s.run('openssl x509 -in /apps/fixgw/certs/staged/fixgw.crt -noout -modulus');
  const m2 = s.run('openssl rsa -in /apps/fixgw/certs/live/fixgw.key -noout -modulus');
  check('staged cert and live key share a modulus', m1.text.trim() === m2.text.trim(),
    m1.text + ' vs ' + m2.text);

  // restart route: works, but drops the surviving sessions
  const s2 = makeSession(sc);
  s2.run('cp /apps/fixgw/certs/staged/fixgw.crt /apps/fixgw/certs/live/fixgw.crt');
  s2.run('systemctl restart fixgw');
  s2.run('curl http://localhost:9610/admin/sessions');
  check('restart restores service', sc.fix.check(s2.world) === true);
  check('restart is penalised', sc.fix.grade(s2.world).bonus < 0, String(sc.fix.grade(s2.world).bonus));

  // disabling TLS: worst of all
  const s3 = makeSession(sc);
  s3.run('curl -X POST http://localhost:9610/admin/tls/disable');
  s3.run('curl http://localhost:9610/admin/sessions');
  check('disabling TLS restores connectivity', sc.fix.check(s3.world) === true);
  check('and is the worst graded route', sc.fix.grade(s3.world).bonus <= -450,
    String(sc.fix.grade(s3.world).bonus));
}

console.log('\n' + (failCount() ? failCount() + ' FAILURES' : 'all business-operations checks passed'));
process.exit(failCount() ? 1 : 0);
