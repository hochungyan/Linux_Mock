/* Fictional finance-support incidents. Linux evidence follows primary references;
 * localhost admin operations are explicitly scenario-specific approved runbooks. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, GB = 1073741824, MB = 1048576;
  PS.scenarios = PS.scenarios || [];

  function put(root, path, body, options) {
    var parts = path.split('/').filter(Boolean), node = root;
    parts.slice(0, -1).forEach(function (part) {
      if (!node.children[part]) node.children[part] = V.dir({});
      node = node.children[part];
    });
    node.children[parts[parts.length - 1]] = V.file(body, options || { owner: 'support' });
  }
  function base(host, root, extra) {
    var setup = {
      host: host, user: 'support', home: '/home/support', cwd: '/home/support',
      clock: new Date(2026, 8, 12, 8, 55, 0), seed: 4182,
      bootSeconds: 25 * 86400, kernel: '5.14.0-503.el9.x86_64', cores: 16, users: 2,
      load: [1.8, 1.5, 1.2], cpu: { us: 8, sy: 2, ni: 0, id: 89, wa: 1, st: 0 },
      mem: { total: 64 * GB, free: 32 * GB, buffers: 256 * MB, cached: 12 * GB },
      swap: { total: 8 * GB, used: 0, si: 0, so: 0 }, root: root,
      filesystems: [{ dev: '/dev/mapper/os-root', mount: '/', type: 'xfs', size: 80 * GB, used: 18 * GB, inodes: { total: 4000000, used: 210000 } }],
      procs: [W.proc({ pid: 1, short: 'systemd', cmd: '/usr/lib/systemd/systemd', rss: 12 * MB })],
      interfaces: [{ name: 'eth0', addr: '10.24.8.41/24', rxOk: 184100, txOk: 120044, rxDrop: 0, txDrop: 0 }],
      hosts: { localhost: { ip: '127.0.0.1', ports: [9980], rtt: 0.03 } },
      sockets: [], diskio: [{ dev: 'dm-0', rs: 4, ws: 12, readKB: 80, writeKB: 140, await: 1.1, util: 3 }],
      services: {}, flags: {}, http: {}, dmesg: []
    };
    Object.keys(extra || {}).forEach(function (key) { setup[key] = extra[key]; });
    return W.create(setup);
  }
  function rootWithRunbook(body) {
    var root = V.dir({ home: V.dir({ support: V.dir({}) }), tmp: V.dir({}), proc: V.dir({}) });
    put(root, '/home/support/runbook.txt', body);
    put(root, '/etc/redhat-release', 'Red Hat Enterprise Linux release 9.5 (Plow)\n');
    return root;
  }
  function evidence(id, label, pattern, command) {
    return { id: id, label: label, when: function (o) { return (!command || command.test(o.cmd)) && pattern.test(W.stripColor(o.out)); } };
  }
  function fail(message) { return { err: message, code: 1 }; }
  function grade(world) {
    return world.flags.blunt ? { quality: 'blunt', bonus: -140, note: 'An uncoordinated restart expanded the interruption. Complete the scoped recovery and verify business state.' } :
      { quality: 'clean', bonus: 280, note: 'Evidence preserved, prerequisites satisfied, scoped recovery completed, and business verification passed.' };
  }

  PS.scenarios.push({
    id: 'fd-exhaustion-order-adapter', title: 'Order acknowledgements stop: adapter out of file descriptors',
    severity: 'P1', desk: 'Electronic Trading / Order Routing', host: 'ldn-orders-prod16',
    tags: ['EMFILE', 'CLOSE_WAIT', 'file descriptors', 'deployment rollback', 'order reconciliation'],
    par: 540, impactPerMin: 68000, currency: 'GBP',
    brief: 'PAGER 08:55 — Orders accepted by the web tier stop receiving acknowledgements on adapter A.\n' +
      'Its process is alive, CPU is modest, and adapter B is healthy. The desk asks whether to resend every order.\n' +
      'A small adapter release went live at 08:40. Diagnose the resource failure, preserve evidence, and recover\n' +
      'only the affected adapter without duplicating orders. Read /home/support/runbook.txt.\n' +
      'This is a fictional incident; the localhost control endpoints implement its approved runbook.',
    build: function () {
      var runbook = 'ORDER ADAPTER A — approved incident runbook CHG-4182\n' +
        'Diagnose with ps, ss -tanp, /proc/7410/limits, /proc/7410/fd and adapter logs.\n' +
        'The shell ulimit is not proof of another running process limit.\n' +
        '1. curl -X POST http://localhost:9980/admin/adapter-a/capture\n' +
        '   Preserve descriptor/socket snapshots and deployment metadata in /evidence.\n' +
        '2. curl -X POST http://localhost:9980/admin/adapter-a/drain\n' +
        '   Stop new routing to A; checked capacity on B allows failover.\n' +
        '3. curl -X POST http://localhost:9980/admin/adapter-a/reconcile\n' +
        '   Query venue/drop-copy by ClOrdID and ExecID; all 18 uncertain orders already exist.\n' +
        '   Do not resubmit them. The command records the reconciled checkpoint.\n' +
        '4. curl -X POST http://localhost:9980/admin/adapter-a/rollback\n' +
        '   Roll back only A from 3.8.2 to the approved 3.8.1 build, then restart A.\n' +
        '5. curl http://localhost:9980/admin/adapter-a/verify\n' +
        '   Run the simulated 60-second canary: stable FD count, acknowledgements and no duplicates.\n' +
        'Raising a limit alone buys time but does not repair a socket leak. No host reboot or global gateway restart.\n';
      var root = rootWithRunbook(runbook);
      put(root, '/var/log/order-adapter/a.log', '08:40:01 INFO deployed adapter=3.8.2 change=CHG-4182\n08:49:02 WARN close callback skipped after peer EOF pool=venue-session\n08:54:51 ERROR accept failed errno=24 EMFILE Too many open files\n08:54:52 ERROR acknowledgement writer cannot open spool file\n');
      put(root, '/evidence/fd-trend.tsv', 'time open_fd close_wait ack_backlog\n08:42 128 64 0\n08:48 622 560 2\n08:54 1024 960 18\n');
      put(root, '/apps/order-adapter/conf/deploy.txt', 'adapter_a=3.8.2\nadapter_b=3.8.1\napproved_rollback=3.8.1\nchange=CHG-4182\n');
      var fds = [], sockets = [];
      for (var n = 0; n < 1024; n++) fds.push({ fd: n, type: n < 64 ? 'REG' : 'IPv4', path: n < 64 ? '/var/log/order-adapter/a.log' : 'socket:[' + (700000 + n) + ']', mode: 'u', size: 0 });
      for (var i = 0; i < 960; i++) sockets.push({ pid: 7410, fd: i + 64, proto: 'tcp', local: '10.24.8.41:' + (35000 + i), peer: '10.24.9.11:9320', state: 'CLOSE_WAIT', recvq: 1 });
      sockets.push({ pid: 7410, fd: 12, proto: 'tcp', local: '0.0.0.0:9310', peer: '0.0.0.0:*', state: 'LISTEN' });
      var p = W.proc({ pid: 7410, user: 'tradeadm', short: 'adapter-a', cmd: '/apps/order-adapter/bin/adapter-a --version 3.8.2', rss: 720 * MB, cpu: 4.2, fds: fds, limitNofile: 1024 });
      var world = base('ldn-orders-prod16', root, { procs: [p], sockets: sockets, limits: { nofile: 65536 },
        services: { 'adapter-a': { active: true, pid: 7410, requiresRoot: false, desc: 'Order Adapter A', log: ['accept failed: EMFILE'] } },
        flags: { fixed: false, captured: false, drained: false, reconciled: false, repaired: false } });
      var api = 'localhost:9980/admin/adapter-a/';
      world.http[api + 'capture'] = function (w) {
        w.flags.captured = true;
        put(w.root, '/evidence/fd-incident.txt', 'CHG-4182 evidence: pid=7410 open_fd=1024 soft_limit=1024 CLOSE_WAIT=960 uncertain_orders=18\n');
        return 'Evidence saved to /evidence/fd-incident.txt; original version and counterparty identities retained.';
      };
      world.http[api + 'drain'] = function (w) {
        if (!w.flags.captured) return fail('Capture the incident evidence before draining.');
        w.flags.drained = true; return 'A drained; B capacity and healthy routing checked; 18 uncertain orders require reconciliation.';
      };
      world.http[api + 'reconcile'] = function (w) {
        if (!w.flags.drained) return fail('Drain new submissions first; do not reconcile a moving order set.');
        w.flags.reconciled = true;
        put(w.root, '/evidence/order-reconciliation.txt', '18 of 18 orders matched venue/drop-copy by ClOrdID and ExecID; resend_required=0; duplicate_orders=0\n');
        return '18 of 18 matched; resend_required=0; replay checkpoint committed. No new order submissions sent.';
      };
      world.http[api + 'rollback'] = function (w) {
        if (!w.flags.captured || !w.flags.drained || !w.flags.reconciled) return fail('Rollback requires evidence, drain and completed order reconciliation.');
        w.flags.repaired = true;
        p.fds = p.fds.slice(0, 64); p.cmd = '/apps/order-adapter/bin/adapter-a --version 3.8.1';
        w.sockets = w.sockets.filter(function (s) { return s.state !== 'CLOSE_WAIT'; });
        return 'Scoped rollback complete: A=3.8.1; open_fd=64; run verify before resuming normal routing.';
      };
      world.http[api + 'verify'] = function (w) {
        if (!w.flags.repaired) return fail('Canary not ready: faulty version remains active.');
        w.flags.fixed = true;
        return 'CANARY PASS: 60 simulated seconds, fd=64->64 CLOSE_WAIT=0 ack_backlog=0 duplicate_orders=0; normal routing restored.';
      };
      world.onService = function (w, verb) { if (verb === 'restart') { w.flags.blunt = true; return 'Unscoped restart interrupted A; the faulty release remains. Follow the approved rollback workflow.'; } return false; };
      return world;
    },
    discoveries: [
      evidence('emfile', 'Adapter reports EMFILE on accept and spool open', /EMFILE.*Too many open files/),
      evidence('limit', 'Running adapter soft limit is 1024', /Max open files\s+1024/, /7410\/limits/),
      evidence('fd-full', 'All 1024 descriptor slots are occupied', /1024/, /7410\/fd.*wc/),
      evidence('socket-growth', 'CLOSE_WAIT growth accompanies FD growth', /08:54 1024 960 18/),
      evidence('release', 'Only adapter A runs the recent 3.8.2 deployment', /adapter_a=3\.8\.2[\s\S]*adapter_b=3\.8\.1/),
      evidence('order-state', '18 uncertain orders already exist; no resend required', /18 of 18.*resend_required=0/)
    ],
    rootCauses: [
      { text: 'The adapter 3.8.2 close-callback regression leaks sockets in CLOSE_WAIT, exhausting its per-process descriptor limit.', correct: true },
      { text: 'The shell ulimit is too small, so increasing it will repair the already running adapter.' },
      { text: 'TIME_WAIT has filled the Java heap and must be cleared with a host reboot.' },
      { text: 'The venue did not receive the 18 orders, so submitting them again is safe.' }
    ],
    fix: { prompt: 'Preserve evidence, drain A, reconcile uncertain orders, roll back only A, then verify stable acknowledgements.', check: function (w) { return w.flags.fixed; }, grade: grade },
    hints: ['Read the precise error: EMFILE is a per-process descriptor limit. Compare /proc/7410/limits with its fd directory.', 'Use ss -tanp and /evidence/fd-trend.tsv. Persistent CLOSE_WAIT growth points to local close handling, then correlate the deployment.', 'The runbook endpoints enforce capture → drain → reconciliation → rollback → verify. Do not blindly replay orders.'],
    solution: ['cat /home/support/runbook.txt', 'tail /var/log/order-adapter/a.log', 'cat /proc/7410/limits', 'ls /proc/7410/fd | wc -l', 'ss -tanp | grep -c CLOSE_WAIT', 'cat /evidence/fd-trend.tsv', 'cat /apps/order-adapter/conf/deploy.txt', 'curl -X POST http://localhost:9980/admin/adapter-a/capture', 'curl -X POST http://localhost:9980/admin/adapter-a/drain', 'curl -X POST http://localhost:9980/admin/adapter-a/reconcile', 'curl -X POST http://localhost:9980/admin/adapter-a/rollback', 'curl http://localhost:9980/admin/adapter-a/verify'],
    debrief: 'EMFILE is scoped to a process; ENFILE is system-wide. Check the target process limit, not only the interactive shell. A brief TCP half-close is valid; persistent CLOSE_WAIT growth plus the release timeline identifies the cleanup regression here. Capture evidence before recycling, drain to known spare capacity, reconcile uncertain order outcomes, and use a scoped rollback. Validate stable descriptors, acknowledgements and duplicate counts under traffic.\n\nInterview follow-ups: Why does changing ulimit in your shell not change an existing service? Why is counting every lsof row not an FD count? When can raising LimitNOFILE be a temporary mitigation? How do ClOrdID and ExecID prevent unsafe resubmission? What would you communicate to the desk?\n\nSources: https://man7.org/linux/man-pages/man2/getrlimit.2.html ; https://man7.org/linux/man-pages/man2/open.2.html ; https://www.rfc-editor.org/rfc/rfc9293.html'
  });

  PS.scenarios.push({
    id: 'inode-exhaustion-settlement-spool', title: 'Settlement files fail despite 78% disk space free',
    severity: 'P1', desk: 'Post Trade / Settlement Operations', host: 'ldn-settle-prod09',
    tags: ['inodes', 'ENOSPC', 'spool files', 'retention', 'batch reconciliation'],
    par: 480, impactPerMin: 34000, currency: 'GBP',
    brief: 'PAGER 08:55 — Settlement export cannot create its next file before the 09:15 custodian cut-off.\n' +
      'df -h shows plenty of free space. A retry-helper rollout ran overnight and support suggests deleting\n' +
      'the whole spool. Find the actual resource shortage, stop its source, preserve pending settlements and\n' +
      'recover the approved batch. Read /home/support/runbook.txt. This incident and its admin endpoints are fictional.',
    build: function () {
      var root = rootWithRunbook('SETTLEMENT SPOOL — approved runbook INC-6104\n' +
        'Check df -h /spool AND df -i /spool; inspect /evidence/spool-inventory.tsv.\n' +
        'The inventory is a filesystem scan snapshot of 985000 zero-byte ACK markers and 5000 pending instructions.\n' +
        'Large populations are summarized; the simulator retains representative files and filesystem counters.\n' +
        '1. curl -X POST http://localhost:9980/admin/settlement/pause-writer\n' +
        '2. curl -X POST http://localhost:9980/admin/settlement/archive-manifest\n' +
        '   Preserve the inventory, writer config and settlement reconciliation before pruning.\n' +
        '3. curl -X POST http://localhost:9980/admin/settlement/prune-acked\n' +
        '   Remove ONLY acknowledged zero-byte retry markers listed in the approved manifest.\n' +
        '   Pending instructions, audit logs and real confirmations remain untouched.\n' +
        '4. curl -X POST http://localhost:9980/admin/settlement/rollback-writer\n' +
        '   Restore retry-helper 2.4 with bounded retries and retention.\n' +
        '5. curl -X POST http://localhost:9980/admin/settlement/retry-export\n' +
        '6. curl http://localhost:9980/admin/settlement/verify\n' +
        '   Reconcile 5000 unique instructions and batch checksum; verify inode growth is stable.\n');
      put(root, '/var/log/settlement/export.log', '08:43:01 WARN retry-helper=2.5 created empty retry marker per poll\n08:53:04 ERROR open /spool/outgoing/SETTLE-20260912-01.csv failed: ENOSPC No space left on device\n08:53:05 INFO pending_instructions=5000 committed_exports=0\n');
      put(root, '/evidence/spool-inventory.tsv', 'path file_count bytes status\n/spool/retry/acked 985000 0 ACKNOWLEDGED\n/spool/pending 5000 20480000 PENDING\n/spool/audit 10000 40960000 RETAIN\n');
      put(root, '/apps/settlement/conf/retry.conf', 'version=2.5\nmarker_per_poll=true\nretention_enabled=false\nprevious_version=2.4\n');
      put(root, '/spool/retry/acked/ACK-001.marker', '');
      put(root, '/spool/pending/SETTLE-001.instruction', 'instruction=SETTLE-001 status=PENDING\n');
      put(root, '/spool/outgoing/.placeholder', '');
      var fs = { dev: '/dev/mapper/data-spool', mount: '/spool', type: 'ext4', size: 200 * GB, used: 44 * GB, inodes: { total: 1000000, used: 1000000 } };
      var world = base('ldn-settle-prod09', root, { filesystems: [ { dev: '/dev/mapper/os-root', mount: '/', type: 'xfs', size: 80 * GB, used: 18 * GB }, fs ],
        procs: [W.proc({ pid: 8620, user: 'settleadm', short: 'retry-helper', cmd: '/apps/settlement/bin/retry-helper --version 2.5', rss: 60 * MB, cpu: 15 })], flags: { fixed: false } });
      var api = 'localhost:9980/admin/settlement/';
      world.http[api + 'pause-writer'] = function (w) { w.flags.paused = true; return 'retry-helper paused; no new marker files can be created.'; };
      world.http[api + 'archive-manifest'] = function (w) {
        if (!w.flags.paused) return fail('Pause the writer to obtain a stable retention manifest.');
        w.flags.manifest = true;
        put(w.root, '/evidence/approved-prune-manifest.txt', 'INC-6104 approved scope=/spool/retry/acked count=985000 bytes=0 state=ACKNOWLEDGED pending_instructions=5000 retained\n');
        return 'Inventory and reconciliation archived on the root filesystem; approved manifest excludes all pending instructions.';
      };
      world.http[api + 'prune-acked'] = function (w) {
        if (!w.flags.paused || !w.flags.manifest) return fail('Prune requires a stopped writer and approved acknowledged-only manifest.');
        fs.inodes.used = 15000; w.flags.pruned = true;
        var ack = V.lookup(w.root, '/spool/retry/acked'); ack.children = {};
        return 'Removed 985000 acknowledged empty markers; 985000 inodes available; pending=5000 and audit files retained.';
      };
      world.http[api + 'rollback-writer'] = function (w) {
        if (!w.flags.pruned) return fail('Restore inode headroom using the approved manifest first.');
        w.flags.rolledBack = true;
        put(w.root, '/apps/settlement/conf/retry.conf', 'version=2.4\nmarker_per_poll=false\nretention_enabled=true\n');
        return 'retry-helper 2.4 restored with bounded retries and retention; export retry is now permitted.';
      };
      world.http[api + 'retry-export'] = function (w) {
        if (!w.flags.rolledBack) return fail('Do not retry until the writer regression is repaired.');
        w.flags.exported = true;
        put(w.root, '/spool/outgoing/SETTLE-20260912-01.csv', 'batch=SETTLE-20260912-01 unique_instructions=5000 checksum=fixture-6104 accepted=true\n');
        fs.inodes.used = 15001; return 'Export committed once: batch=SETTLE-20260912-01 unique_instructions=5000; verify acknowledgement and totals.';
      };
      world.http[api + 'verify'] = function (w) {
        if (!w.flags.exported) return fail('No completed batch to reconcile.');
        w.flags.fixed = true;
        return 'VERIFIED: custodian accepted batch; expected=5000 unique=5000 duplicates=0 checksum=fixture-6104 inode_used=15001 stable across two simulated scans.';
      };
      return world;
    },
    discoveries: [
      evidence('enospc', 'Export creation fails with ENOSPC', /ENOSPC No space left/),
      evidence('bytes-free', 'The spool filesystem is only 22% full in bytes', /22%/, /df.*-h/),
      evidence('inodes-full', 'The spool has no free inodes', /100%/, /df.*-i/),
      evidence('tiny-population', '985000 acknowledged zero-byte markers dominate file count', /985000\s+0\s+ACKNOWLEDGED/),
      evidence('writer-regression', 'Retry-helper 2.5 disables retention and writes a marker per poll', /version=2\.5[\s\S]*retention_enabled=false/),
      evidence('pending', '5000 pending instructions must be preserved', /5000[\s\S]*PENDING|pending_instructions=5000/)
    ],
    rootCauses: [
      { text: 'The retry-helper regression creates unbounded empty marker files, exhausting inodes while data blocks remain free.', correct: true },
      { text: 'The disk has filled with one large application log and needs truncating.' },
      { text: 'ENOSPC always means the path permissions are wrong.' },
      { text: 'The custodian rejected all pending instructions, so the entire spool is safe to delete.' }
    ],
    fix: { prompt: 'Stop the faulty writer, preserve a manifest, prune acknowledged markers only, repair retention, export and reconcile.', check: function (w) { return w.flags.fixed; }, grade: grade },
    hints: ['df -h and df -i answer different questions. A new file needs an inode even when its size is zero.', 'Read /evidence/spool-inventory.tsv and retry.conf. Stop the writer before cleanup, and distinguish acknowledged markers from pending instructions.', 'The runbook walks through pause, approved manifest, scoped prune, rollback, retry-export and verify. Do not delete the entire spool.'],
    solution: ['cat /home/support/runbook.txt', 'tail /var/log/settlement/export.log', 'df -h /spool', 'df -i /spool', 'cat /evidence/spool-inventory.tsv', 'cat /apps/settlement/conf/retry.conf', 'curl -X POST http://localhost:9980/admin/settlement/pause-writer', 'curl -X POST http://localhost:9980/admin/settlement/archive-manifest', 'curl -X POST http://localhost:9980/admin/settlement/prune-acked', 'curl -X POST http://localhost:9980/admin/settlement/rollback-writer', 'curl -X POST http://localhost:9980/admin/settlement/retry-export', 'curl http://localhost:9980/admin/settlement/verify'],
    debrief: 'File creation can fail when inode capacity is exhausted even with abundant free data blocks. Empty marker files consume inodes. Here the inventory and rollout configuration identify a retry/retention defect. Pause creation before cleanup, preserve the audit manifest, remove only acknowledged disposable markers, and repair retention before rerunning the export. Recovery is complete only after custodian acknowledgement, uniqueness checks and stable inode growth.\n\nInterview follow-ups: How do df -h, df -i and du differ? Does moving files within the same filesystem free inodes? What if a deleted file is still open? How would you scan millions of files without overloading shared storage? Why is an export process exit code insufficient for settlement completion?\n\nSources: https://www.gnu.org/software/coreutils/manual/html_node/df-invocation.html ; https://man7.org/linux/man-pages/man7/inode.7.html ; https://man7.org/linux/man-pages/man2/open.2.html'
  });

  PS.scenarios.push({
    id: 'cgroup-native-memory-kill', title: 'Risk container restarts while its host has 44 GB available',
    severity: 'P1', desk: 'Market Risk / Intraday Limits', host: 'ldn-risk-node11',
    tags: ['cgroup v2', 'OOM kill', 'native memory', 'JVM heap', 'risk freshness'],
    par: 600, impactPerMin: 47000, currency: 'GBP',
    brief: 'PAGER 08:55 — Intraday risk worker A has restarted three times and its last risk snapshot is stale.\n' +
      'Host memory looks healthy and the Java heap was below -Xmx before each exit. The application team\n' +
      'proposes increasing heap again. Investigate the correct memory scope, protect downstream limits\n' +
      'from stale risk, and roll out the approved capacity profile. Read /home/support/runbook.txt.\n' +
      'This is a fictional cgroup v2 deployment with scenario-specific admin endpoints.',
    build: function () {
      var root = rootWithRunbook('RISK WORKER A — approved rollback CAP-771\n' +
        'A shell exit status 137 alone does not prove OOM. Correlate kernel logs, memory.events, limits and history.\n' +
        'Read /sys/fs/cgroup/risk-worker-a/memory.{max,current,events} and /evidence/memory-before-kill.txt.\n' +
        'Saved native diagnostics were captured before the killed PID disappeared. Native Memory Tracking must\n' +
        'be enabled at JVM start and may not account for allocations by third-party native libraries.\n' +
        '1. curl -X POST http://localhost:9980/admin/risk-a/capture\n' +
        '2. curl -X POST http://localhost:9980/admin/risk-a/hold-publish\n' +
        '   Gate A from publishing stale/partial limits; route to the checked healthy risk replica.\n' +
        '3. curl -X POST http://localhost:9980/admin/risk-a/apply-profile\n' +
        '   Approved prior profile: cgroup 8GiB, heap 4GiB, direct buffers 1GiB, bounded JNI pool 512MiB.\n' +
        '   Remaining budget covers thread stacks, metaspace, code, other native and charged cache.\n' +
        '4. curl -X POST http://localhost:9980/admin/risk-a/restart-worker\n' +
        '5. curl http://localhost:9980/admin/risk-a/verify\n' +
        '   Simulated representative-load canary checks no new OOM kills, risk timestamp and totals.\n' +
        'Do not raise Xmx alone; a cgroup can OOM while the host has available RAM.\n');
      put(root, '/var/log/risk/worker.log', '08:39:01 INFO profile=throughput-v7 heap_max=6GiB native_pool=unbounded\n08:49:30 INFO heap_used=4.1GiB last_snapshot=08:49:00\n08:49:31 WARN process vanished exit_status=137 no Java OutOfMemoryError emitted\n08:51:10 WARN restart_count=3 snapshot_stale=true\n');
      put(root, '/evidence/memory-before-kill.txt', '08:49:30 cgroup_current=8589934592 cgroup_max=8589934592\nJava_heap_used=4.1GiB heap_max=6GiB\nRSS=7.7GiB; cgroup also accounts for non-RSS memory\nDirectBufferPool=1.6GiB JNI_pool=1.4GiB thread_stacks=0.25GiB\nNMT enabled=summary; third-party JNI allocation coverage incomplete\nmemory.events before: max=12 oom=2 oom_kill=2\nmemory.events after: max=18 oom=3 oom_kill=3\n');
      put(root, '/apps/risk/conf/profile.conf', 'profile=throughput-v7\ncgroup_memory_max=8GiB\nXmx=6GiB\nMaxDirectMemorySize=2GiB\njni_pool_limit=unbounded\napproved_previous=balanced-v6\n');
      put(root, '/sys/fs/cgroup/risk-worker-a/memory.max', '8589934592\n');
      put(root, '/sys/fs/cgroup/risk-worker-a/memory.current', function (w) { return w.flags.restarted ? '5637144576\n' : '5905580032\n'; });
      put(root, '/sys/fs/cgroup/risk-worker-a/memory.events', 'low 0\nhigh 0\nmax 18\noom 3\noom_kill 3\noom_group_kill 0\n');
      put(root, '/sys/fs/cgroup/risk-worker-a/memory.high', 'max\n');
      var worker = W.proc({ pid: 9114, user: 'riskadm', short: 'java', cmd: '/usr/lib/jvm/java-17/bin/java -Xmx6g -XX:MaxDirectMemorySize=2g -XX:NativeMemoryTracking=summary -jar risk.jar', cpu: 14, rss: 5.2 * GB,
        jvm: { name: 'risk.jar', javaVersion: '17.0.12', vmVersion: '17.0.12+7', heapMax: 6 * GB, heapUsed: 3.1 * GB, args: '-Xmx6g -XX:MaxDirectMemorySize=2g -XX:NativeMemoryTracking=summary' } });
      var world = base('ldn-risk-node11', root, { procs: [worker],
        mem: { total: 64 * GB, free: 34 * GB, buffers: 256 * MB, cached: 12 * GB },
        dmesg: [{ time: new Date(2026, 8, 12, 8, 49, 31), text: 'oom-kill:constraint=CONSTRAINT_MEMCG,task_memcg=/risk-worker-a,task=java,pid=9070' },
          { time: new Date(2026, 8, 12, 8, 49, 31), text: 'Memory cgroup out of memory: Killed process 9070 (java) anon-rss:8074035kB' }], flags: { fixed: false } });
      put(world.root, '/proc/9114/cgroup', '0::/risk-worker-a\n');
      var api = 'localhost:9980/admin/risk-a/';
      world.http[api + 'capture'] = function (w) {
        w.flags.captured = true;
        put(w.root, '/evidence/incident-cgroup-checkpoint.txt', 'CAP-771 preserved: memory.max=8589934592 oom_kill=3 profile=throughput-v7; killed PID=9070 current PID=9114\n');
        return 'Saved kernel, cgroup and native-allocation evidence; oom_kill baseline=3.';
      };
      world.http[api + 'hold-publish'] = function (w) {
        if (!w.flags.captured) return fail('Capture kernel/cgroup/profile evidence before changing the workload.');
        w.flags.held = true; return 'A publishing held; replica freshness and capacity verified; downstream limits use the healthy replica.';
      };
      world.http[api + 'apply-profile'] = function (w) {
        if (!w.flags.held) return fail('Hold publishing and confirm the healthy replica first.');
        w.flags.profile = true;
        put(w.root, '/apps/risk/conf/profile.conf', 'profile=balanced-v6\ncgroup_memory_max=8GiB\nXmx=4GiB\nMaxDirectMemorySize=1GiB\njni_pool_limit=512MiB\n');
        return 'Approved balanced-v6 profile staged; restart only risk worker A to apply startup settings.';
      };
      world.http[api + 'restart-worker'] = function (w) {
        if (!w.flags.profile) return fail('A restart with the same oversized/unbounded profile will recur. Stage the approved profile first.');
        w.flags.restarted = true;
        worker.jvm.heapMax = 4 * GB; worker.jvm.heapUsed = 2.8 * GB; worker.rss = 4.6 * GB;
        worker.cmd = '/usr/lib/jvm/java-17/bin/java -Xmx4g -XX:MaxDirectMemorySize=1g -XX:NativeMemoryTracking=summary -jar risk.jar';
        worker.jvm.args = '-Xmx4g -XX:MaxDirectMemorySize=1g -XX:NativeMemoryTracking=summary';
        return 'Worker A restarted in isolation; cgroup max remains 8GiB; require representative-load verification before release.';
      };
      world.http[api + 'verify'] = function (w) {
        if (!w.flags.restarted) return fail('New profile has not run; no valid canary result.');
        w.flags.fixed = true;
        return 'CANARY PASS: 120 simulated seconds of replay, memory.current=5.25GiB<8GiB, oom_kill=3->3, snapshot_age=1s, position_count=28411 matched; A publishing released.';
      };
      return world;
    },
    discoveries: [
      evidence('host-headroom', 'Host available memory exceeds 40 GiB', /44G|44\.2G|45260|45261/, /free/),
      evidence('memcg-victim', 'Kernel identifies a memory-cgroup OOM victim', /CONSTRAINT_MEMCG[\s\S]*9070/, /dmesg/),
      evidence('hard-limit', 'Worker cgroup memory.max is 8 GiB', /8589934592/, /memory\.max/),
      evidence('counter', 'Cgroup oom_kill counter increased to three', /oom_kill 3|oom_kill=3/, /memory\.events|memory-before-kill/),
      evidence('native-budget', 'Heap was below Xmx but direct/JNI usage filled the budget', /Java_heap_used=4\.1GiB[\s\S]*JNI_pool=1\.4GiB/),
      evidence('profile', 'The recent profile allows an unbounded JNI pool', /jni_pool_limit=unbounded/, /profile\.conf/),
      evidence('restart-scope', 'Current worker belongs to the affected cgroup', /0::\/risk-worker-a/, /9114\/cgroup/)
    ],
    rootCauses: [
      { text: 'The combined heap, direct-buffer and unbounded native-pool budget exceeds the worker cgroup limit; the kernel kills it despite host headroom.', correct: true },
      { text: 'Any exit status 137 proves the physical host ran out of RAM.' },
      { text: 'The JVM can only use Xmx bytes in total, so native memory cannot be relevant.' },
      { text: 'The Java heap must be full, and increasing Xmx alone will resolve the cgroup failure.' }
    ],
    fix: { prompt: 'Preserve scoped OOM evidence, hold stale publishing, stage bounded memory budgets, restart only A and verify under load.', check: function (w) { return w.flags.fixed; }, grade: grade },
    hints: ['137 means a SIGKILL-style exit convention, not its cause. Kernel CONSTRAINT_MEMCG and the cgroup event history provide the missing evidence.', 'Host free output and a healthy Java heap are compatible with a cgroup OOM. Read saved direct-buffer/JNI usage and memory.max.', 'Use capture → hold-publish → apply-profile → restart-worker → verify. Check counter deltas and risk freshness, not just whether the PID is alive.'],
    solution: ['cat /home/support/runbook.txt', 'free -h', 'dmesg -T | grep -iE "oom|killed"', 'cat /proc/9114/cgroup', 'cat /sys/fs/cgroup/risk-worker-a/memory.max', 'cat /sys/fs/cgroup/risk-worker-a/memory.events', 'cat /evidence/memory-before-kill.txt', 'cat /apps/risk/conf/profile.conf', 'curl -X POST http://localhost:9980/admin/risk-a/capture', 'curl -X POST http://localhost:9980/admin/risk-a/hold-publish', 'curl -X POST http://localhost:9980/admin/risk-a/apply-profile', 'curl -X POST http://localhost:9980/admin/risk-a/restart-worker', 'curl http://localhost:9980/admin/risk-a/verify'],
    debrief: 'The memory boundary belongs to the worker cgroup, not the whole host. memory.current can be lower after a kill; capture historical peaks and counter changes. memory.max is a hard boundary that may lead to cgroup OOM when reclaim cannot satisfy allocation; memory.high is principally a reclaim/throttling control. Xmx limits the Java heap, while direct buffers, JNI allocations and other memory need separate headroom. Exit status 137 alone cannot distinguish OOM from another SIGKILL.\n\nInterview follow-ups: How do cgroup v1 and v2 paths differ? What can memory.events.local clarify? Why is a nonzero old oom_kill counter insufficient evidence for the current incident? Does NMT measure every third-party allocation? What is the difference between Java heap OOME, native allocation failure and kernel OOM kill? Why must a live risk worker also prove fresh complete output?\n\nSources: https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html ; https://docs.oracle.com/en/java/javase/17/troubleshoot/native-memory-tracking.html ; https://docs.oracle.com/en/java/javase/17/troubleshoot/troubleshooting-memory-leaks.html'
  });
})(PS);
