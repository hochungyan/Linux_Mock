/* Fictional composite incident; primary references are in the debrief.
 * /admin/risk/* is a documented lab workflow, not a PostgreSQL API. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, GB = 1073741824, MB = 1048576;
  PS.scenarios = PS.scenarios || [];
  function reject(message) { return { err: 'Runbook guard: ' + message, code: 1 }; }
  var base = 'curl http://localhost:9980/admin/risk/';
  PS.scenarios.push({
    id: 'db-pool-transactions', title: 'Risk checks timeout while the database looks idle',
    severity: 'P1', desk: 'Equities / Pre-trade Risk', host: 'ldn-risk-prod03',
    tags: ['database', 'connection pool', 'idle in transaction', 'Java', 'reconciliation'],
    par: 520, impactPerMin: 18000, currency: 'GBP',
    brief: 'PAGER 08:57 — orders are failing pre-trade risk checks ahead of the open.\n\nRisk API processes are alive and the database team reports low CPU. The application release at 08:45 added an external limits lookup. Sixty requests are waiting for a database connection; 120 timed-out request IDs need an outcome check. Other database clients remain healthy.\n\nFind the cause and restore the guarded risk path. The incident commander has authorized the scoped workflow in /home/gsupport/runbook-risk.txt. These are fictional local admin endpoints that model coordinated application/DBA actions; they are not PostgreSQL commands.',
    build: function () {
      var now = new Date(2026, 8, 11, 8, 57);
      var threads = [];
      for (var i = 0; i < 8; i++) threads.push(W.thread({ tid: 4301 + i, name: 'risk-owner-' + i, state: 'WAITING', stack: [
        'at java.util.concurrent.CompletableFuture.get(CompletableFuture.java:1908)',
        'at com.bank.risk.RemoteLimits.await(RemoteLimits.java:91)',
        'at com.bank.risk.RiskTransaction.checkWithBorrowedConnection(RiskTransaction.java:64)'
      ] }));
      threads.push(W.thread({ tid: 4350, name: 'risk-request-queued', state: 'TIMED_WAITING', stack: [
        'at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:188)',
        'at com.bank.risk.RiskService.check(RiskService.java:54)'
      ] }));
      var world = W.create({ host: 'ldn-risk-prod03', clock: now, cores: 8, load: [0.42, 0.50, 0.49],
        cpu: { us: 5, sy: 2, ni: 0, id: 92.8, wa: 0.2, st: 0 },
        mem: { total: 32 * GB, free: 20 * GB, buffers: 256 * MB, cached: 4 * GB },
        filesystems: [{ dev: '/dev/mapper/root', mount: '/', type: 'xfs', size: 100 * GB, used: 21 * GB, inodes: { total: 1000000, used: 90000 } }],
        procs: [W.proc({ pid: 4300, user: 'riskadm', short: 'java', cmd: 'java -Xmx4g -jar /opt/risk/risk-api.jar', cpu: 5, rss: 3 * GB, threads: threads,
          jvm: { name: 'RiskApi', heapMax: 4 * GB, heapUsed: 2 * GB, args: '-Xmx4g' } })],
        sockets: [{ pid: 4300, fd: 9, proto: 'tcp', local: '0.0.0.0:8080', peer: '0.0.0.0:*', state: 'LISTEN' }],
        services: { risk: { active: true, pid: 4300, exe: 'java', desc: 'Pre-trade Risk API', log: ['Started release 6.18', 'Connection is not available, request timed out after 3000ms'] } },
        hosts: { 'risk-db': { ip: '10.24.40.11', ports: [5432], rtt: 0.35 } },
        root: V.dir({ tmp: V.dir({}), home: V.dir({ gsupport: V.dir({
          'runbook-risk.txt': V.file('INC-RISK-914 APPROVED SCOPE: only Risk API requests and DBA backend IDs 7101..7108. Never bypass pre-trade controls.\nFictional lab endpoints under http://localhost:9980/admin/risk/ :\n  pool        read current application pool state\n  db-activity read DBA-supplied pg_stat_activity and capacity snapshot\n  snapshot    preserve owner/transaction/request evidence before intervention\n  pause       stop new admission while keeping requests fail-closed\n  mitigate    apply approved release toggle: external lookup outside transaction, deadline and finally-close\n  rollback    DBA cancels these 8 application operations, rolls back their held transactions and closes scoped sessions\n  resume      reopen guarded traffic only after mitigation and rollback\n  verify      observe three healthy pool samples and reconcile all 120 timed-out request IDs\nUse curl for each endpoint. Ordered workflow: snapshot, pause, mitigate, rollback, resume, verify.\nActual production operations need the owning teams, scoped approvals, transaction-impact analysis and credentials.\n')
        }) }), var: V.dir({ log: V.dir({ risk: V.dir({
          'app.log': V.file('08:45:00 INFO release=6.18 feature=externalLimitsInsideTransaction enabled\n08:49:00 WARN owner=risk-owner-0 connection=1 held=480s remoteFuture=no_deadline\n08:56:50 ERROR HikariPool risk-pool Connection is not available, request timed out after 3000ms\n08:56:51 WARN pool total=8 active=8 idle=0 waiting=60\n08:56:52 INFO timed_out_request_ids=120 outcome=unverified risk_bypass=false\n'),
          'release-note.txt': V.file('Release 6.18 starts a DB transaction, reads risk limits, then awaits a remote future with no deadline. All eight owner stacks remain in that future while retaining their connection. Scope was introduced at 08:45; release 6.17 closed the transaction before this call.\n')
        }) }) }), etc: V.dir({ 'risk.properties': V.file('pool.maximumPoolSize=8\nconnectionTimeoutMs=3000\nremoteLookupDeadlineMs=0\n') }) }),
        flags: {}, notes: { poolHeld: 8, poolWaiters: 60, unresolved: 120 }
      });
      for (var n = 0; n < 8; n++) world.sockets.push({ pid: 4300, fd: 20 + n, proto: 'tcp', local: '10.24.22.13:' + (45000 + n), peer: '10.24.40.11:5432', state: 'ESTABLISHED' });
      function route(name, fn) { world.http['localhost:9980/admin/risk/' + name] = fn; }
      route('pool', function (w) { return 'risk-pool max=8 active=' + w.notes.poolHeld + ' idle=' + (8 - w.notes.poolHeld) + ' waiting=' + w.notes.poolWaiters + '\nborrow_timeout_ms=3000 admission=' + (w.flags.paused ? 'paused' : 'open'); });
      route('db-activity', function (w) {
        var rows = ['DBA snapshot max_connections=120 total_connections=35 blocked_by_locks=0', 'pid application_name state wait_event_type wait_event transaction_age_s'];
        for (var k = 0; k < w.notes.poolHeld; k++) rows.push((7101 + k) + ' RiskApi idle in transaction Client ClientRead 480');
        return rows.join('\n');
      });
      route('snapshot', function (w) { w.flags.snapshot = true; return 'Evidence preserved: owners 4301..4308, backends 7101..7108, transactions and 120 request IDs; no business state changed.'; });
      route('pause', function (w) { if (!w.flags.snapshot) return reject('capture snapshot before draining admission'); w.flags.paused = true; return 'Risk admission paused; existing outcomes retained; no risk bypass enabled.'; });
      route('mitigate', function (w) { if (!w.flags.paused) return reject('pause admission first'); w.flags.mitigated = true; return 'Approved scoped mitigation active: remote lookup before transaction, bounded deadline, finally-close; admission remains paused.'; });
      route('rollback', function (w) {
        if (!w.flags.snapshot || !w.flags.paused || !w.flags.mitigated) return reject('snapshot, pause and scoped mitigation must precede DBA rollback');
        w.flags.rolledBack = true; w.notes.poolHeld = 0; w.notes.poolWaiters = 0;
        W.findProc(w, 4300).threads = [];
        W.appendLog(w, '/var/log/risk/app.log', '08:57:30 INFO coordinated rollback complete for backends=7101..7108; requests retained for reconciliation');
        return 'Eight scoped transactions rolled back, owners canceled, replacement idle connections established. Other database clients untouched.';
      });
      route('resume', function (w) { if (!w.flags.rolledBack || !w.flags.mitigated) return reject('repair transaction lifecycle before resuming'); w.flags.paused = false; w.flags.resumed = true; return 'Guarded risk traffic resumed; outcome verification is still required.'; });
      route('verify', function (w) {
        if (!w.flags.resumed || w.flags.paused || !W.findProc(w, 4300)) return reject('risk traffic must be live before verification');
        if (w.notes.poolHeld || w.notes.poolWaiters) return reject('pool pressure has not cleared');
        w.notes.unresolved = 0; w.flags.verified = true;
        return 'Three health samples over the runbook observation window: waiting=0 acquisition_p95_ms=8 old_transactions=0. Reconciled 120/120 request IDs: 120 failed closed, zero venue submissions, zero duplicate orders. Verification PASS.';
      });
      world.onService = function () { return reject('a blanket service restart does not establish transaction outcomes; use the scoped runbook'); };
      return world;
    },
    discoveries: [
      { id: 'pool', label: 'All 8 connections borrowed, none idle, 60 acquisition waiters', when: function (o) { return /active=8 idle=0 waiting=60/.test(o.out); } },
      { id: 'transport', label: 'Database TCP endpoint reachable; connect failure is not the symptom', when: function (o) { return /nc .*risk-db.*5432/.test(o.cmd) && /succeeded|open/.test(o.out); } },
      { id: 'db-owners', label: 'Eight old idle-in-transaction sessions wait for their client; database has spare capacity', when: function (o) { return /ClientRead 480/.test(o.out) && /max_connections=120/.test(o.out); } },
      { id: 'stack', label: 'Owners retain connections while waiting on a remote future', when: function (o) { return /RemoteLimits.await/.test(o.out) && /checkWithBorrowedConnection/.test(o.out); } },
      { id: 'change', label: 'Release 6.18 moved an unbounded external wait into the transaction scope', when: function (o) { return /introduced at 08:45/.test(o.out); } },
      { id: 'outcomes', label: '120 timed-out request IDs require business-outcome reconciliation', when: function (o) { return /timed_out_request_ids=120/.test(o.out); } }
    ],
    rootCauses: [
      { text: 'A firewall blocks new PostgreSQL connections.' },
      { text: 'A release holds every pool connection inside a transaction while waiting indefinitely for an external future; borrowers then time out.', correct: true },
      { text: 'PostgreSQL max_connections is exhausted across the whole database.' },
      { text: 'The Linux host is CPU-saturated and needs more application threads.' }
    ],
    fix: { prompt: 'Restore guarded risk checks, release only the scoped transactions, and verify every timed-out request outcome.',
      check: function (w) { return !!(w.flags.snapshot && w.flags.mitigated && w.flags.rolledBack && w.flags.resumed && w.flags.verified && !w.flags.paused && w.notes.unresolved === 0 && W.findProc(w, 4300)); },
      grade: function () { return { quality: 'clean', bonus: 320, note: 'Scoped transaction recovery restored pool headroom. The application fault is mitigated and all 120 uncertain request outcomes are reconciled without bypassing risk controls.' }; } },
    hints: [
      'An alive JVM and open port do not prove an available connection pool. Read /var/log/risk/app.log, then curl http://localhost:9980/admin/risk/pool.',
      'Compare the pool owners with curl http://localhost:9980/admin/risk/db-activity and jstack 4300. ClientRead while idle in transaction means the backend is waiting for its client, not executing a slow query.',
      'Read the release note and /home/gsupport/runbook-risk.txt. Preserve evidence, pause admission, apply scoped mitigation, rollback the owned transactions, resume, then verify outcomes. Increasing pool size only delays this recurrence.'
    ],
    solution: ['cat /var/log/risk/app.log', 'nc -zv risk-db 5432', base + 'db-activity', 'jstack 4300', 'cat /var/log/risk/release-note.txt', 'cat /home/gsupport/runbook-risk.txt', base + 'snapshot', base + 'pause', base + 'mitigate', base + 'rollback', base + 'resume', base + 'verify'],
    debrief: 'CAUSE AND EVIDENCE\nThe pool measures borrowed connections, not database CPU. Eight application owners retained transactions across an unbounded remote wait. PostgreSQL showed idle in transaction and ClientRead, while other clients and TCP connectivity remained healthy. The release note and thread ownership explain why these connections did not return.\n\nRECOVERY\nThe fictional workflow preserves a snapshot, contains new work, fixes the transaction scope and closes only the identified owners. DBA rollback is distinct from query cancellation; canceling a currently idle backend is not a rollback procedure. Verify pool recovery and every ambiguous business request before closing the incident.\n\nINTERVIEW FOLLOW-UPS\nHow do you distinguish pool saturation, lock waits, slow SQL and max_connections? Why can an idle transaction retain locks or prevent cleanup? Which request deadline includes time waiting for a connection? How would bounded retries and idempotency prevent amplification? What would you measure after recovery?\n\nPREVENTION\nKeep external waits outside DB transactions, guarantee close/rollback on every path, monitor acquisition latency and oldest transaction age, and consider per-application timeout policy with the DBA.\n\nPRIMARY SOURCES\nhttps://www.postgresql.org/docs/current/monitoring-stats.html\nhttps://www.postgresql.org/docs/current/runtime-config-client.html\nhttps://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/'
  });
})(PS);
