/* Scenario: EOD position load has been "running" for four hours.
 *
 * Two lessons in one. First: a process in D state is in uninterruptible sleep -
 * kill -9 will not touch it, which surprises people who have only ever been
 * taught "kill -9 always works". Second: sendevent CHANGE_STATUS SUCCESS is a
 * loaded gun. It is right when the work was genuinely done by hand, and it is
 * a data-integrity incident when it was not.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'nfs-hang-eod',
    title: 'EOD position load hung, batch not progressing',
    severity: 'P1',
    desk: 'Operations / End of Day Batch',
    host: 'ldn-batch-prod01',
    tags: ['NFS', 'D state', 'Autosys', 'batch', 'storage'],
    par: 460,
    impactPerMin: 12000,
    currency: 'GBP',

    brief:
      'PAGER 03:24 - from Overnight Ops\n\n' +
      '"EOD_POSITION_LOAD has been RUNNING since 23:12 and has not moved. Every\n' +
      'downstream job is queued behind it - P&L, regulatory extracts, the lot.\n' +
      'We tried to kill the job from Autosys and it will not die.\n\n' +
      'Storage had an incident around 23:10 but they say it is resolved."\n\n' +
      'Regulatory extracts must be submitted by 07:00. Escalation is already on\n' +
      'the bridge asking for an ETA.',

    build: function () {
      var t0 = new Date(2026, 8, 12, 3, 24, 12);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var hang = new Date(2026, 8, 11, 23, 12, 40);

      var jobLog = [
        W.isoStamp(hang) + ' INFO  eod_position_load.sh starting, run date 20260911',
        W.isoStamp(new Date(hang.getTime() + 2000)) + ' INFO  source  = /mnt/eodshare/positions/20260911',
        W.isoStamp(new Date(hang.getTime() + 3000)) + ' INFO  target  = POSDB.POSITIONS_EOD',
        W.isoStamp(new Date(hang.getTime() + 4000)) + ' INFO  opening /mnt/eodshare/positions/20260911/positions_ldn.csv'
        // and then nothing. The read never returned.
      ].join('\n');

      var root = V.dir({
        apps: V.dir({
          eod: V.dir({
            bin: V.dir({
              'eod_position_load.sh': V.file(
                '#!/bin/bash\n' +
                '# EOD position load\n' +
                'SRC=${EOD_SHARE:-/mnt/eodshare}/positions/$(date +%Y%m%d -d yesterday)\n' +
                'echo "source = $SRC"\n' +
                'sqlldr posdb/**** control=/apps/eod/conf/positions.ctl data=$SRC/positions_ldn.csv\n',
                { mode: '-rwxr-xr-x', owner: 'eodadm', size: 214 }),
              'eod_position_load_dr.sh': V.file(
                '#!/bin/bash\n' +
                '# EOD position load - DR profile, reads from the replicated share\n' +
                'EOD_SHARE=/mnt/eodshare2 exec /apps/eod/bin/eod_position_load.sh "$@"\n',
                { mode: '-rwxr-xr-x', owner: 'eodadm', size: 152 })
            }),
            conf: V.dir({ 'positions.ctl': V.file('LOAD DATA\nINFILE *\nINTO TABLE POSITIONS_EOD\n', { owner: 'eodadm' }) })
          })
        }),
        mnt: V.dir({
          eodshare: V.dir({}, { owner: 'root', group: 'root' }),
          eodshare2: V.dir({
            positions: V.dir({
              '20260911': V.dir({
                'positions_ldn.csv': V.file('', { size: 1840 * MB, owner: 'eodadm', mtime: new Date(2026, 8, 11, 22, 58, 4) }),
                'positions_nyc.csv': V.file('', { size: 2104 * MB, owner: 'eodadm', mtime: new Date(2026, 8, 11, 22, 58, 40) }),
                'MANIFEST.ok': V.file('files=2\nrows=8412004\nchecksum=a14b8f22e1\ngenerated=2026-09-11 22:59:01\n',
                  { owner: 'eodadm', mtime: new Date(2026, 8, 11, 22, 59, 1) })
              })
            })
          }, { owner: 'root', group: 'root' })
        }),
        var: V.dir({
          log: V.dir({
            eod: V.dir({
              'eod_position_load.20260911.log': V.file(jobLog, { owner: 'eodadm', mtime: new Date(hang.getTime() + 4000), size: 12 * 1024 })
            }),
            messages: V.file(
              W.syslogStamp(new Date(2026, 8, 11, 23, 10, 2)) + ' ldn-batch-prod01 kernel: nfs: server nas-ldn-01 not responding, still trying\n' +
              W.syslogStamp(new Date(2026, 8, 11, 23, 12, 44)) + ' ldn-batch-prod01 kernel: nfs: server nas-ldn-01 not responding, still trying\n' +
              W.syslogStamp(new Date(2026, 8, 12, 0, 2, 11)) + ' ldn-batch-prod01 kernel: nfs: server nas-ldn-01 not responding, still trying\n' +
              W.syslogStamp(new Date(2026, 8, 12, 2, 40, 8)) + ' ldn-batch-prod01 kernel: nfs: server nas-ldn-01 not responding, still trying',
              { owner: 'root', size: 34 * MB })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-eod.txt': V.file(
              'EOD BATCH RUNBOOK\n' +
              '=================\n' +
              'SHARES\n' +
              '  /mnt/eodshare   nas-ldn-01:/vol/eod   (primary, hard mount)\n' +
              '  /mnt/eodshare2  nas-ldn-02:/vol/eod   (replica, read-only, 5 min lag)\n' +
              '  The replica carries the same files. Check MANIFEST.ok before using it.\n' +
              '\n' +
              'IF THE PRIMARY NAS IS UNAVAILABLE\n' +
              '  These tasks are in genuine uninterruptible waits. SIGKILL remains\n' +
              '  pending; other D-state waits may be killable. A forced or lazy\n' +
              '  unmount does not guarantee termination. Escalate to storage.\n' +
              '\n' +
              '  Recovery WITHOUT waiting for storage:\n' +
              '    1. autorep -J EOD_POSITION_LOAD -d          confirm state\n' +
              '    2. sendevent -E KILLJOB -J EOD_POSITION_LOAD\n' +
              '    3. curl -X POST http://localhost:9980/admin/eod/fence-primary\n' +
              '       Scenario-specific approved DBA workflow: revoke the original\n' +
              '       loader write lease and confirm no commit can resume. Scheduler\n' +
              '       termination alone does not prove the OS process has exited.\n' +
              '    4. sendevent -E FORCE_STARTJOB -J EOD_POSITION_LOAD_DR\n' +
              '       (the DR job is identical but reads /mnt/eodshare2)\n' +
              '    The DR job satisfies the same downstream condition.\n' +
              '\n' +
              'NEVER mark a load job SUCCESS unless the data really was loaded.\n' +
              '  sendevent -E CHANGE_STATUS -s SUCCESS releases every downstream job.\n' +
              '  If the load did not actually run, P&L and the regulatory extracts are\n' +
              '  produced from stale positions and we have a reportable incident. That\n' +
              '  action is ONLY for when a DBA or ops engineer has completed the work\n' +
              '  by hand and confirmed it.\n',
              { owner: 'gsupport' })
          })
        }),
        etc: V.dir({
          'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52 }),
          fstab: V.file(
            '/dev/mapper/vg00-root  /       xfs     defaults        0 0\n' +
            '/dev/mapper/vg00-var   /var    xfs     defaults        0 0\n' +
            'nas-ldn-01:/vol/eod    /mnt/eodshare   nfs  hard,vers=3,timeo=600,retrans=2  0 0\n' +
            'nas-ldn-02:/vol/eod    /mnt/eodshare2  nfs  ro,soft,vers=3,timeo=100,retrans=2  0 0\n',
            { owner: 'root' })
        }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-batch-prod01', user: 'gsupport', clock: t0, seed: 23124,
        bootSeconds: 3600 * 24 * 120, cores: 8, users: 4,
        // Load average is high but the CPU is idle: everything is blocked on I/O.
        load: [8.42, 8.40, 8.38],
        mem: { total: 32 * GB, free: 24 * GB, buffers: 90 * MB, cached: 3 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 0.4, sy: 0.2, ni: 0, id: 98.9, wa: 0.5, st: 0 },
        root: root,
        limits: { nofile: 32768, nproc: 4096 },

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 9 * GB, inodes: { total: 26214400, used: 142008 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 18 * GB, inodes: { total: 52428800, used: 22104 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 50 * GB, used: 6 * GB, inodes: { total: 26214400, used: 8412 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.4 * GB, inodes: { total: 10485760, used: 980 } },
          { dev: 'nas-ldn-02:/vol/eod', mount: '/mnt/eodshare2', type: 'nfs', size: 8192 * GB, used: 4120 * GB, opts: 'ro,relatime,vers=3,rsize=65536,wsize=65536,hard,proto=tcp,timeo=100', inodes: { total: 419430400, used: 1204008 } }
        ],

        // The primary share is deliberately NOT in filesystems: df on it hangs,
        // which is itself a diagnostic signal reported by the df wrapper below.
        mounts: ['nas-ldn-01:/vol/eod on /mnt/eodshare type nfs (rw,relatime,vers=3,rsize=65536,wsize=65536,hard,proto=tcp,timeo=600,retrans=2,mountaddr=10.14.50.11)'],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 10 * MB, cpu: 0, cpuSeconds: 1840 }),
          W.proc({ pid: 1284, cmd: '/usr/sbin/rsyslogd -n', short: 'rsyslogd', rss: 36 * MB, cpu: 0.1, cpuSeconds: 4120 }),
          W.proc({ pid: 1609, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 120 }),
          W.proc({ pid: 2204, user: 'root', cmd: '/opt/CA/WorkloadAgent/bin/cybAgent -f /opt/CA/WorkloadAgent/cfg/agentparm.txt', short: 'cybAgent', rss: 180 * MB, cpu: 0.4, cpuSeconds: 8412 }),
          // The job, and its children, all stuck in the kernel waiting on NFS.
          W.proc({ pid: 28104, ppid: 2204, user: 'eodadm', cmd: '/bin/bash /apps/eod/bin/eod_position_load.sh', short: 'eod_position', state: 'D', cpu: 0, rss: 4 * MB, started: hang, cpuSeconds: 0.4, wchan: 'io_schedule' }),
          W.proc({ pid: 28119, ppid: 28104, user: 'eodadm', cmd: 'sqlldr posdb/**** control=/apps/eod/conf/positions.ctl data=/mnt/eodshare/positions/20260911/positions_ldn.csv', short: 'sqlldr', state: 'D', cpu: 0, rss: 28 * MB, started: new Date(hang.getTime() + 4000), cpuSeconds: 0.1, wchan: 'io_schedule' }),
          W.proc({ pid: 30880, user: 'eodadm', cmd: '/usr/bin/find /mnt/eodshare -name *.csv -mtime -1', short: 'find', state: 'D', cpu: 0, rss: 2 * MB, started: new Date(2026, 8, 12, 1, 14, 0), cpuSeconds: 0, wchan: 'io_schedule' }),
          W.proc({ pid: 31204, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 1609, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 2204, fd: 9, proto: 'tcp', local: '10.14.22.80:41208', peer: '10.14.44.10:7520', state: 'ESTABLISHED' },
          // The NFS connection to the dead filer: still open, nothing moving.
          { pid: 0, fd: 0, proto: 'tcp', local: '10.14.22.80:747', peer: '10.14.50.11:2049', state: 'ESTABLISHED', sendq: 131072, recvq: 0 },
          { pid: 0, fd: 0, proto: 'tcp', local: '10.14.22.80:892', peer: '10.14.50.12:2049', state: 'ESTABLISHED', sendq: 0, recvq: 0 }
        ],

        netstat: { tcpRetrans: 88412, tcpReset: 4, tcpActive: 1204, udpErrors: 0 },
        diskio: [{ dev: 'dm-0', rs: 0.2, ws: 1.1, readKB: 4.2, writeKB: 18.4, await: 0.4, util: 0.3 }],

        interfaces: [
          { name: 'eth0', addr: '10.14.22.80/24', mac: '00:50:56:9a:41:80', rxOk: 88120044, txOk: 74120088, rxBytes: 41200884120, txBytes: 22104881200 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 4120, txOk: 4120, mtu: 65536 }
        ],

        dmesg: [
          { time: new Date(2026, 8, 11, 23, 10, 2), text: 'nfs: server nas-ldn-01 not responding, still trying' },
          { time: new Date(2026, 8, 11, 23, 12, 44), text: 'nfs: server nas-ldn-01 not responding, still trying' },
          { time: new Date(2026, 8, 12, 0, 2, 11), text: 'nfs: server nas-ldn-01 not responding, still trying' },
          { time: new Date(2026, 8, 12, 2, 40, 8), text: 'nfs: server nas-ldn-01 not responding, still trying' },
          { time: new Date(2026, 8, 12, 3, 8, 40), text: 'INFO: task sqlldr:28119 blocked for more than 120 seconds.' }
        ],

        hosts: {
          'nas-ldn-01': { ip: '10.14.50.11', unreachable: true, ports: [] },
          'nas-ldn-02': { ip: '10.14.50.12', ports: [2049, 111], rtt: 0.22, ttl: 63 },
          localhost: { ip: '127.0.0.1', ports: [22], rtt: 0.02 }
        },

        jobs: [
          { name: 'EOD_BOX_LDN', status: 'RU', lastStart: new Date(2026, 8, 11, 23, 0, 0), runNum: 1, condition: '-', note: 'box job - holds until all members complete' },
          { name: 'EOD_EXTRACT_TXN', status: 'SU', lastStart: new Date(2026, 8, 11, 23, 2, 0), lastEnd: new Date(2026, 8, 11, 23, 11, 40), exitCode: 0, runNum: 1, command: '/apps/eod/bin/eod_extract_txn.sh' },
          { name: 'EOD_POSITION_LOAD', status: 'RU', lastStart: hang, runNum: 1, condition: 's(EOD_EXTRACT_TXN)', machine: 'ldn-batch-prod01', command: '/apps/eod/bin/eod_position_load.sh', note: 'running 4h12m - normal runtime is 11 minutes' },
          { name: 'EOD_POSITION_LOAD_DR', status: 'IN', runNum: 0, condition: '-', machine: 'ldn-batch-prod01', command: '/apps/eod/bin/eod_position_load_dr.sh', note: 'DR variant - reads /mnt/eodshare2' },
          { name: 'EOD_PNL_CALC', status: 'AC', runNum: 0, condition: 's(EOD_POSITION_LOAD) | s(EOD_POSITION_LOAD_DR)', machine: 'ldn-batch-prod01', command: '/apps/eod/bin/eod_pnl.sh' },
          { name: 'EOD_REG_EXTRACT', status: 'AC', runNum: 0, condition: 's(EOD_PNL_CALC)', machine: 'ldn-batch-prod01', command: '/apps/eod/bin/eod_reg_extract.sh' }
        ],

        // Any command that touches the dead hard mount blocks until Ctrl+C,
        // exactly as it would on the real box.
        hungPaths: ['/mnt/eodshare'],

        flags: { fixed: false, falseSuccess: false, triedKill: false },

        onKill: function (world, proc) {
          world.flags.triedKill = true;
        },

        onSendevent: function (world, event, job, status) {
          if (!job) return false;

          if (event === 'CHANGE_STATUS' && status === 'SUCCESS' && job.name === 'EOD_POSITION_LOAD') {
            // Allowed - and wrong. The downstream runs on stale positions.
            job.status = 'SU';
            job.lastEnd = new Date(world.clock.getTime());
            world.flags.falseSuccess = true;
            world.flags.fixed = true;
            releaseDownstream(world, 'stale');
            return 'CAUAJM_I_50323 Event placed in the event server.';
          }

          if (event === 'KILLJOB' && job.name === 'EOD_POSITION_LOAD') {
            job.status = 'TE';
            job.lastEnd = new Date(world.clock.getTime());
            job.exitCode = 130;
            job.note = 'terminated by operator; agent could not reap the D-state process until the mount is cleared';
            return 'CAUAJM_I_50323 Event placed in the event server.';
          }

          if ((event === 'FORCE_STARTJOB' || event === 'STARTJOB') && job.name === 'EOD_POSITION_LOAD_DR') {
            if (W.findProc(world, 28119) && !world.flags.primaryFenced) {
              // Both jobs writing the same table at once is a real hazard.
              return {
                err: 'Original loader can still resume and targets the same table.\n' +
                  'Follow the runbook: terminate scheduling, then fence its database write lease before DR.',
                code: 1
              };
            }
            job.status = 'RU';
            job.lastStart = new Date(world.clock.getTime());
            world.procs.push(W.proc({
              pid: 32118, ppid: 2204, user: 'eodadm', short: 'sqlldr',
              cmd: 'sqlldr posdb/**** control=/apps/eod/conf/positions.ctl data=/mnt/eodshare2/positions/20260911/positions_ldn.csv',
              state: 'R', cpu: 41.2, rss: 42 * MB, started: new Date(world.clock.getTime())
            }));
            W.appendLog(world, '/var/log/eod/eod_position_load.20260911.log',
              W.isoStamp(world.clock) + ' INFO  DR profile: source = /mnt/eodshare2/positions/20260911');
            world.notes.drStarted = 0;
            return 'CAUAJM_I_50323 Event placed in the event server.';
          }
          return false;
        },

        tick: function (world, seconds) {
          if (world.notes.drStarted != null && !world.flags.fixed) {
            world.notes.drStarted += seconds;
            if (world.notes.drStarted > 12) {
              var dr = world.jobs.filter(function (j) { return j.name === 'EOD_POSITION_LOAD_DR'; })[0];
              dr.status = 'SU';
              dr.lastEnd = new Date(world.clock.getTime());
              dr.exitCode = 0;
              W.killProc(world, 32118);
              W.appendLog(world, '/var/log/eod/eod_position_load.20260911.log',
                W.isoStamp(world.clock) + ' INFO  loaded 8,412,004 rows into POSDB.POSITIONS_EOD');
              world.flags.fixed = true;
              releaseDownstream(world, 'loaded');
            }
          }
        }
      });

      world.http['localhost:9980/admin/eod/fence-primary'] = function (w) {
        var original = w.jobs.filter(function (j) { return j.name === 'EOD_POSITION_LOAD'; })[0];
        if (original.status !== 'TE') return { err: 'Fence refused: stop the original scheduled job first.', code: 1 };
        w.flags.primaryFenced = true;
        W.appendLog(w, '/var/log/eod/eod_position_load.20260911.log',
          W.isoStamp(w.clock) + ' WARN  DBA fence confirmed: original loader write lease revoked; any late commit is rejected');
        return 'Original loader fenced by approved DBA workflow. No further original commits permitted; D-state tasks may remain. DR may start.';
      };

      function releaseDownstream(world, how) {
        var pnl = world.jobs.filter(function (j) { return j.name === 'EOD_PNL_CALC'; })[0];
        pnl.status = 'RU';
        pnl.lastStart = new Date(world.clock.getTime());
        pnl.note = how === 'stale'
          ? 'started - WARNING: POSITIONS_EOD still holds 2026-09-10 data'
          : 'started against freshly loaded positions';
      }

      return world;
    },

    discoveries: [
      { id: 'job-stuck', label: 'EOD_POSITION_LOAD has been RU for 4h against an 11 minute norm', when: function (o) { return /\bautorep\b/.test(o.cmd) && /EOD_POSITION_LOAD/.test(PS.world.stripColor(o.out)); } },
      { id: 'd-state', label: 'The job processes are in D state (uninterruptible sleep)', when: function (o) { return /\b(ps|top)\b/.test(o.cmd) && /\bD\b/.test(PS.world.stripColor(o.out)) && /sqlldr|eod_position/.test(PS.world.stripColor(o.out)); } },
      { id: 'load-vs-cpu', label: 'Load average ~8 with an idle CPU - everything is blocked on I/O', when: function (o) { return /\b(uptime|top|w|vmstat)\b/.test(o.cmd) && /8\.4|8\.3/.test(PS.world.stripColor(o.out)); }, optional: true },
      { id: 'nfs-dmesg', label: 'Kernel: "nfs: server nas-ldn-01 not responding, still trying"', when: function (o) { return /not responding, still trying/.test(o.out); } },
      { id: 'nas-down', label: 'nas-ldn-01 is unreachable; nas-ldn-02 answers normally', when: function (o) { return /nas-ldn-01/.test(o.cmd) && /100% packet loss|timed out|unreachable/i.test(o.out); } },
      { id: 'hard-mount', label: 'The primary share is a hard mount, which is why nothing times out', when: function (o) { return /hard,vers=3|hard,proto=tcp/.test(o.out); } },
      { id: 'kill-useless', label: 'SIGKILL remains pending in this uninterruptible wait', when: function (o) { return /uninterruptible sleep/.test(o.out); } },
      { id: 'replica-good', label: 'The replica share holds the same files and a valid MANIFEST.ok', when: function (o) { return /eodshare2/.test(o.cmd + o.out) && /MANIFEST|positions_ldn\.csv|checksum/.test(PS.world.stripColor(o.out)); } }
    ],

    rootCauses: [
      { text: 'The Autosys agent has lost contact with the scheduler, so the job only appears to be running.' },
      { text: 'The load job is deadlocked inside the database and is waiting on a lock.' },
      { text: 'The primary NFS share is a hard mount to nas-ldn-01, which stopped responding. The job is blocked in an uninterruptible kernel wait, so it cannot progress and cannot be killed.', correct: true },
      { text: 'The batch box is out of memory and the load process has been swapped out.' },
      { text: 'The source file for 2026-09-11 was never produced, so the job is waiting for it to arrive.' },
      { text: 'CPU starvation on the batch box - load average is 8 on an 8 core machine.' }
    ],

    fix: {
      prompt: 'Get the downstream batch moving with correct data. Regulatory extracts are due at 07:00.',
      check: function (world) { return world.flags.fixed === true; },
      grade: function (world) {
        if (world.flags.falseSuccess) {
          return { quality: 'blunt', bonus: -400,
            note: 'You marked EOD_POSITION_LOAD as SUCCESS. The batch is moving - but the\n' +
              'load never ran, so POSITIONS_EOD still holds 2026-09-10 data. P&L and the\n' +
              'regulatory extracts are now being produced from stale positions. That is a\n' +
              'reportable data-integrity incident, and it is worse than the outage was.\n\n' +
              'CHANGE_STATUS SUCCESS is only ever correct when the work really was\n' +
              'completed by hand and verified. Here the DR job existed and would have\n' +
              'loaded the real data from the replica.' };
        }
        return { quality: 'clean', bonus: 320,
          note: 'You terminated the wedged job and started the DR variant against the\n' +
            'replica share. 8,412,004 rows loaded, EOD_PNL_CALC released against real\n' +
            'positions, and the extracts will make the 07:00 cutoff. Storage still have\n' +
            'to clear the hung mount, but that is no longer on the critical path.' };
      }
    },

    hints: [
      'Start with the job, not the box: autorep -J EOD_POSITION_LOAD -d tells you when it started and what it is waiting on. Then find the process it spawned.',
      'Look at the process STATE column. D is uninterruptible sleep - the process is inside a kernel call that has not returned. Check ps -eo state,pid,wchan,cmd and then dmesg.',
      'A hard NFS mount never gives up; that is what "hard" means. ping nas-ldn-01 and read /etc/fstab. Then ask what else is mounted that might carry the same data.',
      '/mnt/eodshare2 is the replica and it is healthy - check MANIFEST.ok. The runbook path is: sendevent -E KILLJOB -J EOD_POSITION_LOAD then sendevent -E FORCE_STARTJOB -J EOD_POSITION_LOAD_DR.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'nas-ldn-01 stopped answering at 23:10. /mnt/eodshare is mounted hard, so the\n' +
      'kernel retries forever rather than returning an error to the application. Any\n' +
      'uncached operation may wait on the server; these simulated tasks are stuck\n' +
      'in genuine uninterruptible waits. The job therefore sat\n' +
      'in RUNNING forever and every downstream job stayed queued behind it.\n\n' +
      'D STATE AND kill -9\n' +
      'SIGKILL is handled by the kernel and needs no user-space handler. A genuine\n' +
      'uninterruptible wait can delay it. Some waits displayed as D are killable;\n' +
      'inspect the wait channel and stack instead of inferring from D alone.\n' +
      'umount -l detaches a mount from the namespace; outstanding references\n' +
      'remain. Neither lazy nor forced unmount guarantees a task will exit.\n\n' +
      'hard vs soft NFS\n' +
      '  hard : retry indefinitely; avoids returning retry exhaustion as an I/O\n' +
      '         failure. This is not an absolute guarantee against data loss.\n' +
      '  soft : return EIO after timeo/retrans. Application sees an error and can\n' +
      '         fail cleanly - but a partial write can corrupt data.\n' +
      'The replica here answers normally, so commands return. Its soft mount\n' +
      'would eventually return an error if retries were exhausted.\n\n' +
      'THE sendevent TRAP\n' +
      'CHANGE_STATUS -s SUCCESS is the fastest way to unblock a batch and the fastest\n' +
      'way to cause a reportable incident. It tells the scheduler a job succeeded; it\n' +
      'does not do the work. Use it when a human has genuinely completed the task out\n' +
      'of band (a DBA loading the data manually, for example) and has confirmed it.\n' +
      'Never use it to make a red box go green.'
  });
})(PS);
