/* test/incidents.test.js - walks each finance incident end to end, including
 * every alternative remediation route and the grade it should receive. */
/* Walk each new finance incident the way a player would, and check both the
 * clean route and every wrong route. */
const { PS, W, makeSession } = require('./harness.js');

const S = id => PS.scenarios.find(s => s.id === id);
let fails = 0;
function ck(l, c, d) {
  if (c) console.log('   PASS  ' + l);
  else { console.log('   FAIL  ' + l + (d ? '\n         ' + String(d).split('\n').slice(0, 12).join('\n         ') : '')); fails++; }
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------- MQ poison ---------- */
sec('mq-poison-settlement');
{
  const sc = S('mq-poison-settlement');
  const s = makeSession(sc);
  ck('scenario loaded', !!sc);
  const d = s.run('dspmq');
  ck('dspmq works', /QM.TRADE.LDN/.test(d.text), d.text);
  const q = s.run('echo "DIS QL(TRADE.TO.SETTLE)" | runmqsc QM.TRADE.LDN');
  ck('queue depth shown', /CURDEPTH\(4182\)/.test(q.text), q.text);
  ck('IPPROCS shown', /IPPROCS\(1\)/.test(q.text), q.text);
  ck('BOTHRESH 0 shown', /BOTHRESH\(0\)/.test(q.text), q.text);
  const b = s.run('amqsbcg TRADE.TO.SETTLE QM.TRADE.LDN');
  ck('browse shows backout count', /BackoutCount : 8\d{3}/.test(b.text), b.text.slice(0, 600));
  ck('browse shows poison trade', /TRD-8841207/.test(b.text));
  ck('findings gathered', s.found.length >= 5, s.found.join(','));
  ck('not fixed yet', sc.fix.check(s.world) === false);
  const mqRunbook = s.run('cat /home/gsupport/runbook-settlement-mq.txt').text.replace(/\s+/g, ' ');
  ck('runbook distinguishes JMS caching from fictional live policy refresh',
    /JMS cache these attributes/.test(mqRunbook) && /FICTIONAL ADAPTER CAPABILITY/.test(mqRunbook));
  const poison = s.world.mq.queues[0].msgs[0];

  // restart does nothing
  s.run('systemctl restart settle-adapter');
  ck('restart does NOT fix it', sc.fix.check(s.world) === false);

  const alt = s.run('echo "ALTER QL(TRADE.TO.SETTLE) BOTHRESH(5) BOQNAME(TRADE.TO.SETTLE.BOQ)" | runmqsc QM.TRADE.LDN');
  ck('ALTER accepted', /queue changed/i.test(alt.text), alt.text);
  ck('fictional adapter handles poison after ALTER', sc.fix.check(s.world) === true);
  ck('graded clean', sc.fix.grade(s.world).quality === 'clean');
  const after = s.run('echo "DIS QL(TRADE.TO.SETTLE.BOQ)" | runmqsc QM.TRADE.LDN');
  ck('poison moved to BOQ', /CURDEPTH\(1\)/.test(after.text), after.text);
  ck('quarantine preserves the original message and payload',
    s.world.mq.queues[1].msgs[0] === poison && /TRD-8841207/.test(poison.body));

  const withoutHandler = makeSession(sc);
  withoutHandler.world.onMqAlter = null;
  withoutHandler.run('echo "ALTER QL(TRADE.TO.SETTLE) BOTHRESH(5) BOQNAME(TRADE.TO.SETTLE.BOQ)" | runmqsc QM.TRADE.LDN');
  ck('queue attributes alone do not move messages without the adapter callback',
    withoutHandler.world.mq.queues[0].bothresh === 5 &&
    withoutHandler.world.mq.queues[0].curdepth === 4182 &&
    withoutHandler.world.mq.queues[1].curdepth === 0 && !sc.fix.check(withoutHandler.world));

  const s2 = makeSession(sc);
  s2.run('echo "CLEAR QL(TRADE.TO.SETTLE)" | runmqsc QM.TRADE.LDN');
  ck('CLEAR drains but is catastrophic', sc.fix.check(s2.world) === true && sc.fix.grade(s2.world).bonus <= -400);
}

/* ---------- DB blocking ---------- */
sec('db-blocking-eod');
{
  const sc = S('db-blocking-eod');
  const s = makeSession(sc);
  const bl = s.run('sqlplus -s posbatch/x@POSDB @/home/gsupport/sql/blockers.sql');
  ck('blockers.sql returns the blocker', /412/.test(bl.text) && /OPS_ANALYST/.test(bl.text), bl.text);
  const se = s.run('sqlplus -s posbatch/x@POSDB @/home/gsupport/sql/sessions.sql');
  ck('sessions.sql shows INACTIVE + idle', /INACTIVE/.test(se.text) && /Toad\.exe/.test(se.text), se.text);
  const tx = s.run('sqlplus -s posbatch/x@POSDB @/home/gsupport/sql/transactions.sql');
  ck('transactions.sql shows undo', /USED_UBLK/.test(tx.text) && /184220/.test(tx.text), tx.text);
  ck('decoy TICKLOAD visible', /TICKLOAD/.test(tx.text));
  ck('findings gathered', s.found.length >= 5, s.found.join(','));
  ck('not fixed yet', sc.fix.check(s.world) === false);

  const k = s.run('echo "ALTER SYSTEM KILL SESSION \'412,4471\';" | sqlplus -s posbatch/x@POSDB');
  ck('kill session accepted', /System altered/.test(k.text), k.text);
  ck('fixed', sc.fix.check(s.world) === true);
  ck('graded clean', sc.fix.grade(s.world).quality === 'clean');
  const ar = s.run('autorep -J EOD_POSITION_UPDATE');
  ck('job now SU', /SU/.test(PS.world.stripColor(ar.text)), ar.text);

  const s2 = makeSession(sc);
  s2.run('echo "ALTER SYSTEM KILL SESSION \'901,8820\';" | sqlplus -s posbatch/x@POSDB');
  ck('killing the loader does NOT fix it', sc.fix.check(s2.world) === false);
  s2.run('echo "ALTER SYSTEM KILL SESSION \'412,4471\';" | sqlplus -s posbatch/x@POSDB');
  ck('wrong-kill penalised', sc.fix.grade(s2.world).bonus < 0, JSON.stringify(sc.fix.grade(s2.world).bonus));
}

/* ---------- clock drift ---------- */
sec('clock-drift-rts25');
{
  const sc = S('clock-drift-rts25');
  const s = makeSession(sc);
  const t = s.run('chronyc tracking');
  ck('chronyc tracking shows ms offset', /ms\)/.test(t.text), t.text);
  const src = s.run('chronyc sources');
  ck('sources shows PTP unreachable', /PTP0/.test(src.text), src.text);
  const p = s.run('pmc -u -b 0 "GET TIME_STATUS_NP"');
  ck('pmc shows no grandmaster', /gmPresent\s+false/.test(PS.world.stripColor(p.text)), p.text);
  const st = s.run('systemctl status ptp4l');
  ck('ptp4l failed', /failed|inactive/i.test(PS.world.stripColor(st.text)), st.text.slice(0, 400));
  ck('fix log shows SendingTime reject',
    /SendingTime accuracy problem/.test(s.run('grep SendingTime /var/log/algo/FIX.4.4-IBANK-XLON.messages.log').text));
  ck('gm1 unreachable', /100% packet loss/.test(s.run('ping -c 2 gm1-ldn.ib.internal').text));
  ck('gm2 reachable', /0% packet loss/.test(s.run('ping -c 2 gm2-ldn.ib.internal').text));
  ck('findings gathered', s.found.length >= 5, s.found.join(','));
  ck('not fixed yet', sc.fix.check(s.world) === false);

  const bad = s.run('systemctl restart ptp4l');
  ck('restarting ptp4l fails (gm1 still dead)', /no grandmaster/i.test(bad.text), bad.text);
  ck('still not fixed', sc.fix.check(s.world) === false);
  const clockConfig = s.run('cat /apps/algo/conf/gateway.properties').text;
  const utcToleranceUs = Number((/clock\.tolerance\.us=(\d+)/.exec(clockConfig) || [])[1]);
  const sendingToleranceMs = Number((/counterparty\.sendingTimeTolerance\.ms=(\d+)/.exec(clockConfig) || [])[1]);
  ck('fictional FIX tolerance is configured separately from the UTC limit',
    utcToleranceUs === 100 && sendingToleranceMs === 2 && /Fictional counterparty/.test(clockConfig));
  const clockRunbook = s.run('cat /home/gsupport/runbook-clocksync.txt').text.replace(/\s+/g, ' ');
  ck('runbook distinguishes UTC breach from FIX rejection and documents Logout',
    /UTC tolerance breach alone does not establish a FIX reject/.test(clockRunbook) &&
    /Logout \(35=5\)/.test(clockRunbook));
  const withinFixOnly = makeSession(sc);
  withinFixOnly.world.chrony.offsetSeconds = 0.001;
  ck('being inside the fictional FIX tolerance does not satisfy the UTC objective',
    withinFixOnly.world.chrony.offsetSeconds < sendingToleranceMs / 1000 && !sc.fix.check(withinFixOnly.world));

  s.run('systemctl start ptp4l-gm2');
  ck('fixed after gm2 failover', sc.fix.check(s.world) === true);
  ck('graded clean', sc.fix.grade(s.world).quality === 'clean');
  const t2 = s.run('chronyc tracking');
  ck('offset now microseconds', /us\)/.test(t2.text), t2.text);
  ck('recovery is within both distinct fixture tolerances',
    Math.abs(s.world.chrony.offsetSeconds) < utcToleranceUs / 1e6 &&
    Math.abs(s.world.chrony.offsetSeconds) < sendingToleranceMs / 1000);

  const s2 = makeSession(sc);
  s2.run('date -s "2026-09-11 08:06:26"');
  ck('date -s "fixes" the offset', sc.fix.check(s2.world) === true);
  ck('date -s heavily penalised', sc.fix.grade(s2.world).bonus <= -400, String(sc.fix.grade(s2.world).bonus));
}

/* ---------- runaway algo ---------- */
sec('algo-runaway-orders');
{
  const sc = S('algo-runaway-orders');
  const s = makeSession(sc);
  const cnt = s.run("awk '{print $4}' /var/log/algo/orders.log | sort | uniq -c | sort -rn | head -5");
  ck('count-and-rank finds VWAP_EU_07', /VWAP_EU_07/.test(cnt.text) && /24\d/.test(cnt.text), cnt.text);
  const r = s.run('curl http://localhost:9600/admin/rates');
  ck('rates endpoint works', /orderToTradeRatio/.test(r.text), r.text.slice(0, 300));
  ck('param change visible',
    /participation=100/.test(s.run('grep ConfigService /var/log/algo/algo-gateway.log').text));
  ck('config confirms',
    /VWAP_EU_07/.test(s.run('cat /apps/algo/conf/strategies.conf').text));
  ck('findings gathered', s.found.length >= 5, s.found.join(','));
  ck('not contained yet', sc.fix.check(s.world) === false);

  s.run('curl http://localhost:9600/admin/strategy/VWAP_EU_07/pause');
  ck('contained by pausing one strategy', sc.fix.check(s.world) === true);
  ck('graded clean', sc.fix.grade(s.world).quality === 'clean');
  const r2 = s.run('curl http://localhost:9600/admin/rates');
  ck('rate back under limit', /"firmOrderRatePerSec": 12/.test(r2.text), r2.text.slice(0, 200));

  const s2 = makeSession(sc);
  s2.run('curl http://localhost:9600/admin/killswitch');
  ck('kill switch also contains', sc.fix.check(s2.world) === true);
  ck('kill switch penalised', sc.fix.grade(s2.world).bonus < 0);

  const s3 = makeSession(sc);
  s3.run('systemctl restart algo-gateway');
  ck('restart penalised hardest', sc.fix.grade(s3.world).bonus <= -400);
}

/* ---------- kdb RDB ---------- */
sec('kdb-rdb-memory');
{
  const sc = S('kdb-rdb-memory');
  const s = makeSession(sc);
  const ps = s.run('ps -eo pid,rss,comm | sort -k2 -rn | head -3');
  ck('RDB is the biggest process', /4118/.test(ps.text), ps.text);
  const df = s.run('df -h');
  ck('/kdb/hdb is full', /\/kdb\/hdb/.test(df.text) && /(100%|99%)/.test(df.text), df.text);
  ck('writedown failure visible',
    /No space left on device/.test(s.run('cat /var/log/kdb/eod_writedown.log').text));
  ck('replay visible', /replay/i.test(s.run('head -3 /var/log/kdb/rdb.log').text));
  const st = s.run('curl http://localhost:5011/admin/status');
  ck('status shows two dates', /2026.09.10/.test(st.text) && /2026.09.11/.test(st.text), st.text.slice(0, 400));
  ck('manifest readable', /checksum ok/.test(s.run('cat /kdb/archive/MANIFEST.txt').text));
  ck('findings gathered', s.found.length >= 5, s.found.join(','));

  const refused = s.run('curl http://localhost:5011/admin/writedown');
  ck('writedown refused while hdb full', /refused/.test(refused.text), refused.text);
  ck('not fixed yet', sc.fix.check(s.world) === false);

  s.run('rm -rf /kdb/hdb/2026.06.12');
  const okNow = s.run('curl http://localhost:5011/admin/writedown');
  ck('writedown succeeds after freeing space', /"status": "ok"/.test(okNow.text), okNow.text);
  ck('fixed', sc.fix.check(s.world) === true);
  ck('graded clean', sc.fix.grade(s.world).quality === 'clean');

  const s2 = makeSession(sc);
  s2.run('rm -rf /kdb/hdb/2026.09.08');
  s2.run('curl http://localhost:5011/admin/writedown');
  ck('deleting unarchived history is penalised',
    sc.fix.check(s2.world) === true && sc.fix.grade(s2.world).bonus <= -400,
    JSON.stringify(s2.world.flags));

  const s3 = makeSession(sc);
  s3.run('systemctl restart kdb-rdb');
  ck('restarting RDB does NOT free memory', sc.fix.check(s3.world) === false);
}

console.log('\n' + (fails ? fails + ' FAILURES' : 'all finance-incident checks passed'));
process.exit(fails ? 1 : 0);
