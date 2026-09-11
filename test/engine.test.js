/* test/engine.test.js - drives every scenario through the real engine. */
const { PS, W, makeSession, check, section, failCount } = require('./harness.js');

const byId = {};
PS.scenarios.forEach(s => { byId[s.id] = s; });

/* ---------------- shell fundamentals ---------------- */
section('shell fundamentals');
{
  const s = makeSession(byId['disk-full-deleted-fd']);
  check('echo', s.run('echo hello world').text.trim() === 'hello world');
  check('pipe into grep -c', s.run('echo -e "a\nb" | grep -c a').text.trim() === '1',
    s.run('echo a | grep -c a').text);
  check('$HOME expansion', s.run('echo $HOME').text.trim() === '/home/gsupport');
  check('cd + pwd', (s.run('cd /var/log/tcap'), s.run('pwd').text.trim()) === '/var/log/tcap');
  check('glob expands', s.run('ls *.gz').text.includes('tcap-app.log.20260910.gz'), s.run('ls *.gz').text);
  check('redirect to file then cat', (s.run('echo notes > /tmp/x'), s.run('cat /tmp/x').text.trim()) === 'notes');
  check('&& short circuit', s.run('false && echo nope').text.trim() === '');
  check('|| runs on failure', s.run('false || echo yes').text.trim() === 'yes');
  check('command not found -> 127', s.run('wibble').raw.code === 127);
  check('pipe strips colour', !/[]/.test(s.run('ls -l | cat').text));
  check('printf hex (TID->nid)', s.run('printf "%x\\n" 4913').text.trim() === '1331', s.run('printf "%x\\n" 4913').text);
  check('wc -l over pipe', s.run('cat /home/gsupport/runbook-tcap.txt | wc -l').text.trim().length > 0);
  check('tail -n', s.run('tail -n 2 /home/gsupport/runbook-tcap.txt').text.trim().split('\n').length === 2);
  check('tail -N shorthand', s.run('tail -3 /home/gsupport/runbook-tcap.txt').text.trim().split('\n').length === 3);
  check('find -name', s.run('find /var/log -name "*.gz"').text.includes('20260910.gz'));
  check('grep -i case insensitive', s.run('grep -ic ERROR /var/log/tcap/tcap-app.log').text.trim() !== '0');
}

/* ---------------- scenario 1: disk full ---------------- */
section('S1 disk full / deleted fd');
{
  const sc = byId['disk-full-deleted-fd'];
  const s = makeSession(sc);

  const df = s.run('df -h');
  check('df shows /var at 100%', /\/var/.test(df.text) && /100%/.test(df.text), df.text);

  const dfi = s.run('df -i');
  check('df -i shows healthy inodes', /IUse%/.test(dfi.text) && !/9[5-9]%/.test(dfi.text), dfi.text);

  const du = s.run('du -sh /var');
  const duNum = parseFloat(du.text);
  check('du /var reports far less than df', duNum > 0 && duNum < 30, du.text);

  const lsof = s.run('lsof +L1');
  check('lsof +L1 finds deleted file', /deleted/.test(lsof.text) && /8841/.test(lsof.text), lsof.text);
  check('deleted file shows the big size', /1911[0-9]{8}|191126548480/.test(lsof.text.replace(/\s/g, '')) || /tcap-app\.log\.20260910/.test(lsof.text), lsof.text);

  check('app log shows ENOSPC', /No space left on device/.test(s.run('grep -i "no space" /var/log/tcap/tcap-app.log').text));

  check('findings before fix', s.found.length >= 5, 'found: ' + s.found.join(','));
  check('not yet fixed', sc.fix.check(s.world) === false);

  s.run('> /proc/8841/fd/7');
  check('truncate via /proc/pid/fd reclaims space', sc.fix.check(s.world) === true,
    'used%=' + W.pct(W.fsByMount(s.world, '/var').used, W.fsByMount(s.world, '/var').size));
  check('graded as clean', sc.fix.grade(s.world).quality === 'clean');

  const after = s.run('df -h /var');
  check('df now healthy', !/100%/.test(after.text), after.text);

  // alternative route
  const s2 = makeSession(sc);
  s2.run('systemctl restart tcap');
  check('restart also frees space', sc.fix.check(s2.world) === true);
  check('restart graded blunt', sc.fix.grade(s2.world).quality === 'blunt');

  const s3 = makeSession(sc);
  s3.run('kill -9 8841');
  check('kill -9 frees space', sc.fix.check(s3.world) === true);
  check('kill graded worst', sc.fix.grade(s3.world).bonus < 0);

  // truncate command form
  const s4 = makeSession(sc);
  s4.run('truncate -s 0 /proc/8841/fd/7');
  check('truncate -s 0 form works', sc.fix.check(s4.world) === true);
}

/* ---------------- scenario 2: market data frozen ---------------- */
section('S2 market data frozen');
{
  const sc = byId['market-data-frozen'];
  const s = makeSession(sc);

  check('tail shows last publish 08:47', /08:47/.test(s.run('tail -5 /var/log/mdgw/mdgw-app.log').text));
  check('process alive in ps', /6120/.test(s.run('ps -ef | grep mdgw').text));

  const ss = s.run('ss -uanp');
  check('ss -uanp shows large Recv-Q', /212992/.test(ss.text), ss.text);

  const su = s.run('netstat -su');
  check('netstat -su shows receive buffer errors', /receive buffer errors/.test(su.text) && /1,8/.test(su.text), su.text);

  const iplink = s.run('ip -s link');
  check('ip -s link shows feed NIC counters', /eth1/.test(iplink.text) && /RX: bytes/.test(iplink.text));

  const js = s.run('jstack 6120');
  check('jstack dumps threads', /Full thread dump/.test(js.text));
  check('dispatch threads BLOCKED on InstrumentCache', /BLOCKED/.test(js.text) && /InstrumentCache/.test(js.text));
  check('lock holder in socketRead0', /socketRead0/.test(js.text) && /refdata/i.test(js.text));
  check('dumpTaken flag set', s.world.flags.dumpTaken === true);

  check('ping refdata-db-ldn fails', /100% packet loss/.test(s.run('ping -c 2 refdata-db-ldn').text));
  check('conf shows timeout=0', /socket\.timeout=0/.test(s.run('grep timeout /apps/mdgw/conf/mdgw.properties').text));

  check('findings gathered', s.found.length >= 7, 'found: ' + s.found.join(','));
  check('not fixed yet', sc.fix.check(s.world) === false);

  const fo = s.run('curl http://localhost:9911/admin/refdata/failover');
  check('failover endpoint responds', /ok/.test(fo.text), fo.text);
  check('fixed after failover', sc.fix.check(s.world) === true);
  check('graded clean', sc.fix.grade(s.world).quality === 'clean');

  const js2 = s.run('jstack 6120');
  check('threads unblocked after fix', !/BLOCKED/.test(js2.text), js2.text.slice(0, 400));

  const s2 = makeSession(sc);
  s2.run('systemctl restart mdgw');
  check('restart also clears it', sc.fix.check(s2.world) === true);
  check('restart graded blunt', sc.fix.grade(s2.world).quality === 'blunt');
}

/* ---------------- scenario 3: jvm memory leak ---------------- */
section('S3 JVM memory leak');
{
  const sc = byId['jvm-memory-leak'];
  const s = makeSession(sc);

  const gc = s.run('grep "Full GC" /var/log/riskcalc/riskcalc-gc.log | tail -3');
  check('gc log shows futile Full GCs', /Full GC/.test(gc.text) && /98[0-9]{3}M->98[0-9]{3}M/.test(gc.text), gc.text);

  const jstat = s.run('jstat -gcutil 11204 1000 3');
  check('jstat shows old gen ~99', /99\.7/.test(jstat.text), jstat.text);

  const heap = s.run('jmap -heap 11204');
  check('jmap -heap shows near-full heap', /9[5-9]\.\d+% used/.test(heap.text), heap.text.slice(0, 600));

  const histo = s.run('jmap -histo 11204');
  check('histogram names the leak class', /ScenarioKey/.test(histo.text), histo.text.slice(0, 300));

  check('dmesg shows the oom kill', /Killed process 22104/.test(s.run('dmesg -T').text));
  check('free shows swapping', /Swap/.test(s.run('free -g').text));
  check('top -H exposes GC threads', /GC Thread/.test(s.run('top -H -b -p 11204').text));
  check('conf shows unbounded cache', /max\.entries/.test(s.run('cat /apps/riskcalc/conf/riskcalc.properties').text));

  check('findings gathered', s.found.length >= 5, 'found: ' + s.found.join(','));

  const dump = s.run('jmap -dump:live,format=b,file=/var/tmp/riskcalc.hprof 11204');
  check('heap dump succeeds', /Heap dump file created/.test(dump.text), dump.text);
  check('heapDumped flag set', s.world.flags.heapDumped === true);

  s.run('systemctl restart riskcalc');
  check('restart fixes', sc.fix.check(s.world) === true);
  check('dump-then-restart graded clean', sc.fix.grade(s.world).quality === 'clean');

  const s2 = makeSession(sc);
  s2.run('systemctl restart riskcalc');
  check('restart without dump graded blunt', sc.fix.grade(s2.world).quality === 'blunt');

  const s3 = makeSession(sc);
  const gcrun = s3.run('jcmd 11204 GC.run');
  check('forced GC does not save a leak', /executed/.test(gcrun.text) &&
    W.pct(W.findProc(s3.world, 11204).jvm.heapUsed, W.findProc(s3.world, 11204).jvm.heapMax) > 90);
}

/* ---------------- scenario 4: cpu spin ---------------- */
section('S4 CPU spin thread');
{
  const sc = byId['cpu-spin-thread'];
  const s = makeSession(sc);

  const top = s.run('top -b');
  check('top shows java ~100%', /10[0-9]\.\d|99\.\d/.test(top.text), top.text.slice(0, 800));

  const topH = s.run('top -H -b -p 4820');
  check('top -H isolates hot thread 4913', /4913/.test(topH.text) && /99\.6/.test(topH.text), topH.text.slice(0, 900));

  const hex = s.run('printf "%x\\n" 4913');
  check('hex conversion', hex.text.trim() === '1331');

  const st = s.run('jstack 4820 | grep -A 6 0x1331');
  check('jstack nid match finds spinner', /HashMap\.getEntry/.test(st.text), st.text);

  check('config shows unsynchronised map', /not synchronized/.test(s.run('cat /apps/fixgw/conf/fixgw.properties').text));
  check('gc is innocent', /\s0\s/.test(s.run('jstat -gcutil 4820').text));
  check('findings gathered', s.found.length >= 4, 'found: ' + s.found.join(','));

  const drain = s.run('curl http://localhost:9975/admin/drain');
  check('drain works', /safeToRestart/.test(drain.text), drain.text);
  s.run('systemctl restart fixgw');
  check('fixed', sc.fix.check(s.world) === true);
  check('drain+restart graded clean', sc.fix.grade(s.world).quality === 'clean');

  const s2 = makeSession(sc);
  s2.run('systemctl restart fixgw');
  check('cold restart graded blunt', sc.fix.grade(s2.world).quality === 'blunt');
}

/* ---------------- scenario 5: FIX seqnum ---------------- */
section('S5 FIX sequence gap');
{
  const sc = byId['fix-seqnum-gap'];
  const s = makeSession(sc);

  const g = s.run('grep "MsgSeqNum too low" /var/log/fixgw/fixgw-app.log | tail -2');
  check('app log shows the reject reason', /expecting 88413 but received 1/.test(g.text), g.text);

  const fixlog = s.run('tail -4 /var/log/fixgw/FIX.4.2-IBANK-GSCLIENT1.messages.log');
  check('FIX message log has 35=5 logout', /35=5/.test(fixlog.text), fixlog.text);

  const nst = s.run('netstat -anp');
  check('client reconnect churn visible', /198\.51\.100\.44/.test(nst.text), nst.text.slice(0, 600));

  check('store file has 88413', /senderseqnum=88413/.test(s.run('cat /var/lib/fixgw/sessions/FIX.4.2-IBANK-GSCLIENT1.seqnums').text));
  check('cfg shows ResetOnLogon=N', /ResetOnLogon=N/.test(s.run('grep -B3 -A3 GSCLIENT1 /apps/fixgw/conf/sessions.cfg').text));
  check('other sessions healthy', /GSCLIENT2/.test(s.run('curl http://localhost:9980/admin/sessions').text));
  check('findings gathered', s.found.length >= 4, 'found: ' + s.found.join(','));

  s.run('curl http://localhost:9980/admin/session/GSCLIENT1/reset');
  check('reset fixes session', sc.fix.check(s.world) === true);
  check('graded clean', sc.fix.grade(s.world).quality === 'clean');
  check('store file updated', /senderseqnum=2/.test(s.run('cat /var/lib/fixgw/sessions/FIX.4.2-IBANK-GSCLIENT1.seqnums').text));

  const s2 = makeSession(sc);
  s2.run('systemctl restart fixgw');
  check('restart alone does NOT fix it', sc.fix.check(s2.world) === false);
}

/* ---------------- scenario 6: NFS hang / EOD ---------------- */
section('S6 NFS hang / EOD batch');
{
  const sc = byId['nfs-hang-eod'];
  const s = makeSession(sc);

  const ar = s.run('autorep -J EOD_POSITION_LOAD -d');
  check('autorep shows RU job', /EOD_POSITION_LOAD/.test(ar.text) && /RU/.test(ar.text), ar.text);

  const ps = s.run('ps -ef');
  check('ps shows sqlldr', /sqlldr/.test(ps.text), ps.text.slice(0, 600));

  const pso = s.run('ps -eo state,pid,wchan,cmd');
  check('D state and wchan visible', /io_schedule/.test(pso.text), pso.text.slice(0, 500));

  check('dmesg shows nfs stall', /not responding, still trying/.test(s.run('dmesg -T').text));
  check('nas-ldn-01 unreachable', /100% packet loss/.test(s.run('ping -c 2 nas-ldn-01').text));
  check('nas-ldn-02 reachable', /0% packet loss/.test(s.run('ping -c 2 nas-ldn-02').text));
  check('fstab shows hard mount', /hard,vers=3/.test(s.run('cat /etc/fstab').text));

  const k = s.run('kill -9 28119');
  check('kill -9 refused on D state', /uninterruptible/.test(k.text), k.text);
  check('process survives kill -9', W.findProc(s.world, 28119) !== null);

  check('replica readable', /MANIFEST/.test(s.run('ls /mnt/eodshare2/positions/20260911').text));
  check('hungPaths set', s.world.hungPaths.includes('/mnt/eodshare'));

  check('findings gathered', s.found.length >= 5, 'found: ' + s.found.join(','));

  const early = s.run('sendevent -E FORCE_STARTJOB -J EOD_POSITION_LOAD_DR');
  check('DR start blocked while original runs', early.raw.code === 1 && /can still resume/.test(early.text), early.text);

  s.run('sendevent -E KILLJOB -J EOD_POSITION_LOAD');
  // Scheduler termination alone cannot prevent a late commit from a D-state loader.
  const fence = s.run('curl -X POST http://localhost:9980/admin/eod/fence-primary');
  check('approved DBA fence prevents late writes', /fenced/.test(fence.text), fence.text);
  const ok = s.run('sendevent -E FORCE_STARTJOB -J EOD_POSITION_LOAD_DR');
  check('DR job starts', /Event placed/.test(ok.text), ok.text);
  s.advance(15);
  check('DR job completes and releases batch', sc.fix.check(s.world) === true);
  check('graded clean', sc.fix.grade(s.world).quality === 'clean');
  check('downstream released', /RU/.test(s.run('autorep -J EOD_PNL_CALC').text));

  const s2 = makeSession(sc);
  s2.run('sendevent -E CHANGE_STATUS -J EOD_POSITION_LOAD -s SUCCESS');
  check('false success "works"', sc.fix.check(s2.world) === true);
  check('but is penalised hard', sc.fix.grade(s2.world).bonus <= -300);
}

/* ---------------- cross-scenario sanity ---------------- */
section('cross-scenario sanity');
{
  PS.scenarios.forEach(sc => {
    const s = makeSession(sc);
    const correct = sc.rootCauses.filter(c => c.correct);
    check(sc.id + ': exactly one correct root cause', correct.length === 1);
    check(sc.id + ': has hints', (sc.hints || []).length >= 3);
    check(sc.id + ': has debrief', (sc.debrief || '').length > 400);
    check(sc.id + ': starts unfixed', sc.fix.check(s.world) === false);
    // every command in the help groups should at least run without throwing
    const probe = ['df -h', 'free -m', 'ps aux', 'uptime', 'vmstat 1 2', 'iostat -x',
      'netstat -tulpn', 'ss -s', 'dmesg', 'lsof', 'mount', 'uname -a', 'lscpu',
      'ulimit -a', 'w', 'ls -la /', 'sar -r', 'systemctl', 'ip addr', 'top -b'];
    let threw = null;
    probe.forEach(c => {
      const r = s.run(c);
      if (/internal error/.test(r.text)) threw = c + ' -> ' + r.text.slice(0, 200);
    });
    check(sc.id + ': core diagnostics all run', threw === null, threw);
  });
}


console.log('\n' + (failCount() ? failCount() + ' FAILURES' : 'all engine checks passed'));
process.exit(failCount() ? 1 : 0);
