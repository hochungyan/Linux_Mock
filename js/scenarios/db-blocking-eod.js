/* Scenario: the EOD position update is blocked on a row lock.
 *
 * Two long-running sessions are visible. One is an abandoned Toad window an
 * analyst left with an uncommitted UPDATE; the other is a legitimate sqlldr
 * batch forty minutes into real work. Killing the wrong one costs more than the
 * outage does, so the whole incident is about telling them apart before acting.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'db-blocking-eod',
    title: 'EOD position update blocked, batch not progressing',
    severity: 'P1',
    desk: 'Operations / End of Day Batch',
    host: 'ldn-batch-prod05',
    tags: ['Oracle', 'row lock', 'v$session', 'EOD batch', 'kill session'],
    par: 480,
    impactPerMin: 15000,
    currency: 'GBP',

    brief:
      'PAGER 19:42 - from Overnight Ops\n\n' +
      '"EOD_POSITION_UPDATE has been running for two hours. Normal runtime is\n' +
      'four minutes. The job log just says it is waiting. Everything behind it is\n' +
      'queued - P&L, the risk feed and the regulatory extract.\n\n' +
      'DBAs are on a major incident elsewhere and have asked us to triage it and\n' +
      'come back with something specific."\n\n' +
      'Regulatory extract must be submitted by 06:00. You have DBA rights on\n' +
      'POSDB for exactly this situation - but whatever you kill, you own.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 19, 42, 10);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var jobLog = [
        W.isoStamp(ago(7500)) + ' INFO  eod_position_update.sh starting, run date 20260911',
        W.isoStamp(ago(7480)) + ' INFO  connecting to POSDB as POSBATCH',
        W.isoStamp(ago(7460)) + ' INFO  UPDATE POSITIONS SET EOD_QTY = ... (2,841,204 rows expected)',
        W.isoStamp(ago(7200)) + ' WARN  statement has been running for 300s, still waiting',
        W.isoStamp(ago(3600)) + ' WARN  statement has been running for 3900s, still waiting',
        W.isoStamp(ago(600)) + ' WARN  statement has been running for 6900s, still waiting'
      ].join('\n');

      var root = V.dir({
        apps: V.dir({
          eod: V.dir({
            bin: V.dir({
              'eod_position_update.sh': V.file(
                '#!/bin/bash\n' +
                'sqlplus -s posbatch/****@POSDB @/apps/eod/sql/position_update.sql\n',
                { mode: '-rwxr-xr-x', owner: 'eodadm', size: 96, mtime: ago(900000) })
            }),
            sql: V.dir({
              'position_update.sql': V.file('UPDATE POSITIONS SET EOD_QTY = INTRADAY_QTY WHERE BOOK_DATE = TRUNC(SYSDATE);\nCOMMIT;\n',
                { owner: 'eodadm', mtime: ago(900000) })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            sql: V.dir({
              'blockers.sql': V.file(
                '-- who is blocking whom, and for how long\n' +
                'SELECT b.sid blocker_sid, b.username blocker_user, b.program blocker_prog,\n' +
                '       w.sid waiter_sid, w.username waiter_user, w.event wait_event,\n' +
                '       w.seconds_in_wait secs\n' +
                '  FROM v$session w, v$session b\n' +
                ' WHERE w.blocking_session = b.sid;\n',
                { owner: 'gsupport', mtime: ago(600000) }),
              'sessions.sql': V.file(
                '-- every session, with how long since its last call\n' +
                'SELECT sid, serial#, username, status, program, machine, last_call_et, sql_id\n' +
                '  FROM v$session WHERE username IS NOT NULL ORDER BY last_call_et DESC;\n',
                { owner: 'gsupport', mtime: ago(600000) }),
              'transactions.sql': V.file(
                '-- open transactions and how much undo each is holding\n' +
                'SELECT s.sid, s.username, t.start_time, t.used_ublk, t.used_urec, t.status\n' +
                '  FROM v$transaction t, v$session s WHERE t.ses_addr = s.saddr;\n',
                { owner: 'gsupport', mtime: ago(600000) }),
              'tablespace.sql': V.file(
                '-- tablespace headroom\n' +
                'SELECT tablespace_name, size_mb, used_mb, free_mb, pct_used FROM dba_data_files_summary;\n',
                { owner: 'gsupport', mtime: ago(600000) })
            }),
            'runbook-eod-db.txt': V.file(
              'EOD BATCH / POSDB RUNBOOK\n' +
              '=========================\n' +
              'WHEN A BATCH JOB IS "STILL RUNNING"\n' +
              '  A job that is waiting is not a job that is working. Find out which.\n' +
              '\n' +
              '    sqlplus -s posbatch/****@POSDB @/home/gsupport/sql/blockers.sql\n' +
              '    sqlplus -s posbatch/****@POSDB @/home/gsupport/sql/sessions.sql\n' +
              '    sqlplus -s posbatch/****@POSDB @/home/gsupport/sql/transactions.sql\n' +
              '\n' +
              'BEFORE YOU KILL ANYTHING\n' +
              '  You must be able to say which of these the blocker is:\n' +
              '\n' +
              '  ABANDONED  STATUS=INACTIVE, LAST_CALL_ET large and growing, an\n' +
              '             interactive client (Toad, SQL Developer, sqlplus from a\n' +
              '             desktop), holding very little undo. Somebody ran an\n' +
              '             UPDATE and went home without committing. Safe to kill.\n' +
              '\n' +
              '  WORKING    STATUS=ACTIVE, LAST_CALL_ET small, a batch client\n' +
              '             (sqlldr, a scheduler job), holding a LOT of undo because\n' +
              '             it has genuinely done a lot of work. Killing this rolls\n' +
              '             all of that back and you will wait longer for the\n' +
              '             rollback than you would have waited for the commit.\n' +
              '\n' +
              '  LAST_CALL_ET is seconds since the session last asked the database to\n' +
              '  do anything. A large value on an INACTIVE session means a human\n' +
              '  walked away mid-transaction.\n' +
              '\n' +
              'KILLING A SESSION\n' +
              '    ALTER SYSTEM KILL SESSION \'<sid>,<serial#>\' IMMEDIATE;\n' +
              '  This rolls the transaction back and releases its locks.\n' +
              '\n' +
              'DO NOT bounce POSDB. It serves intraday risk and the client portal as\n' +
              '  well as the batch, and a restart is a full outage for all of them.\n' +
              'DO NOT kill the EOD job. It is the victim here, not the cause; killing\n' +
              '  it just means it blocks again on the next run.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        var: V.dir({
          log: V.dir({
            eod: V.dir({
              'eod_position_update.20260911.log': V.file(jobLog,
                { owner: 'eodadm', mtime: ago(600), size: 18 * 1024 })
            })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-batch-prod05', user: 'gsupport', clock: t0, seed: 4127,
        bootSeconds: 3600 * 24 * 96, cores: 8, users: 3,
        load: [0.38, 0.41, 0.44],
        mem: { total: 32 * GB, free: 20 * GB, buffers: 200 * MB, cached: 6 * GB },
        swap: { total: 4 * GB, used: 0 },
        // barely any CPU: the job is waiting, not working
        cpu: { us: 2.1, sy: 0.6, ni: 0, id: 97.1, wa: 0.2, st: 0 },
        root: root,

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 11 * GB, inodes: { total: 26214400, used: 160204 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 20 * GB, inodes: { total: 52428800, used: 18412 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.4 * GB, inodes: { total: 10485760, used: 1120 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 800 }),
          W.proc({ pid: 1616, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 26 }),
          W.proc({ pid: 2204, user: 'root', short: 'cybAgent', cpu: 0.3, rss: 180 * MB,
            cmd: '/opt/CA/WorkloadAgent/bin/cybAgent -f /opt/CA/WorkloadAgent/cfg/agentparm.txt',
            started: new Date(2026, 8, 1, 3, 0, 0), cpuSeconds: 9120 }),
          // the job process: alive, idle, waiting on the database
          W.proc({ pid: 26100, ppid: 2204, user: 'eodadm', short: 'eod_position', state: 'S', cpu: 0.0, rss: 6 * MB,
            cmd: '/bin/bash /apps/eod/bin/eod_position_update.sh',
            started: ago(7500), cpuSeconds: 2 }),
          W.proc({ pid: 26118, ppid: 26100, user: 'eodadm', short: 'sqlplus', state: 'S', cpu: 0.0, rss: 42 * MB,
            cmd: 'sqlplus -s posbatch/****@POSDB @/apps/eod/sql/position_update.sql',
            started: ago(7480), cpuSeconds: 1 }),
          W.proc({ pid: 27400, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 26118, fd: 9, proto: 'tcp', local: '10.14.22.86:41208', peer: '10.14.40.50:1521', state: 'ESTABLISHED', recvq: 0, sendq: 0 },
          { pid: 1616, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [{ dev: 'dm-1', rs: 0.4, ws: 6.2, readKB: 8.1, writeKB: 92.4, await: 0.4, util: 0.6 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.86/24', rxOk: 88120044, txOk: 74120088, rxBytes: 12004881200, txBytes: 9120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 22104, txOk: 22104, mtu: 65536 }
        ],
        dmesg: [],
        hosts: {
          localhost: { ip: '127.0.0.1', ports: [22], rtt: 0.02 },
          posdb: { ip: '10.14.40.50', ports: [1521], rtt: 0.28, ttl: 63 }
        },

        db: {
          connect: 'posbatch/****@POSDB',
          sessions: [
            // the abandoned analyst session: INACTIVE, idle 7,900s, interactive client
            { sid: 412, serial: 4471, username: 'OPS_ANALYST', status: 'INACTIVE',
              program: 'Toad.exe', machine: 'LDN\\WS-4471', lastCallEt: 7912, sqlId: '8fk2m1qz0p4xa' },
            // the victim: our EOD update
            { sid: 889, serial: 1204, username: 'POSBATCH', status: 'ACTIVE',
              program: 'sqlplus@ldn-batch-prod05', machine: 'ldn-batch-prod05', lastCallEt: 7460,
              blockingSid: 412, event: 'enq: TX - row lock contention', secondsInWait: 7460,
              sqlId: '2x4gvbn8q1ltr' },
            // the decoy: a legitimate batch doing real work
            { sid: 901, serial: 8820, username: 'TICKLOAD', status: 'ACTIVE',
              program: 'sqlldr@ldn-tick-prod02', machine: 'ldn-tick-prod02', lastCallEt: 2,
              sqlId: 'p90fk2mzq18ax' },
            { sid: 233, serial: 1102, username: 'RISKAPP', status: 'INACTIVE',
              program: 'JDBC Thin Client', machine: 'ldn-risk-prod04', lastCallEt: 4 },
            { sid: 615, serial: 3390, username: 'PORTAL', status: 'INACTIVE',
              program: 'JDBC Thin Client', machine: 'ldn-web-prod05', lastCallEt: 11 }
          ],
          transactions: [
            // tiny: one statement, then the analyst walked away
            { sid: 412, username: 'OPS_ANALYST', startTime: '09/11/26 17:30:12', usedUblk: 3, usedUrec: 41, status: 'ACTIVE' },
            // huge: forty minutes of genuine loading, rolling this back would hurt
            { sid: 901, username: 'TICKLOAD', startTime: '09/11/26 19:02:44', usedUblk: 184220, usedUrec: 8412004, status: 'ACTIVE' },
            { sid: 889, username: 'POSBATCH', startTime: '09/11/26 17:37:30', usedUblk: 0, usedUrec: 0, status: 'ACTIVE' }
          ],
          tablespaces: [
            { name: 'POSITIONS_DAT', sizeMb: 512000, usedMb: 388100 },
            { name: 'POSITIONS_IDX', sizeMb: 128000, usedMb: 71200 },
            { name: 'UNDOTBS1', sizeMb: 64000, usedMb: 41800 },
            { name: 'TEMP', sizeMb: 32000, usedMb: 2100 },
            { name: 'SYSTEM', sizeMb: 8000, usedMb: 3400 }
          ]
        },

        jobs: [
          { name: 'EOD_BOX_LDN', status: 'RU', lastStart: new Date(2026, 8, 11, 17, 30, 0), runNum: 1, condition: '-' },
          { name: 'EOD_POSITION_UPDATE', status: 'RU', lastStart: ago(7500), runNum: 1,
            condition: 's(EOD_EXTRACT_TXN)', machine: 'ldn-batch-prod05',
            command: '/apps/eod/bin/eod_position_update.sh',
            note: 'running 2h05m - normal runtime is 4 minutes' },
          { name: 'EOD_PNL_CALC', status: 'AC', runNum: 0, condition: 's(EOD_POSITION_UPDATE)', machine: 'ldn-batch-prod05' },
          { name: 'EOD_REG_EXTRACT', status: 'AC', runNum: 0, condition: 's(EOD_PNL_CALC)', machine: 'ldn-batch-prod05' }
        ],

        services: {
          sshd: { active: true, pid: 1616, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { unblocked: false, killedWrongSession: false, killedJob: false },

        /* Killing the abandoned session releases the lock and the EOD update
         * completes. Killing the loader instead destroys 40 minutes of work and
         * does nothing for the block. */
        onKillSession: function (world, sess) {
          if (sess.sid === 412) {
            world.flags.unblocked = true;
            var job = world.jobs.filter(function (j) { return j.name === 'EOD_POSITION_UPDATE'; })[0];
            job.status = 'SU';
            job.lastEnd = new Date(world.clock.getTime());
            job.exitCode = 0;
            job.note = 'completed after the blocking session was released';
            var pnl = world.jobs.filter(function (j) { return j.name === 'EOD_PNL_CALC'; })[0];
            pnl.status = 'RU';
            pnl.lastStart = new Date(world.clock.getTime());
            W.killProc(world, 26118);
            W.killProc(world, 26100);
            W.appendLog(world, '/var/log/eod/eod_position_update.20260911.log',
              W.isoStamp(world.clock) + ' INFO  2,841,204 rows updated');
            W.appendLog(world, '/var/log/eod/eod_position_update.20260911.log',
              W.isoStamp(world.clock) + ' INFO  COMMIT complete, elapsed 7502s');
          } else if (sess.sid === 901) {
            world.flags.killedWrongSession = true;
            W.appendLog(world, '/var/log/eod/eod_position_update.20260911.log',
              W.isoStamp(world.clock) + ' WARN  still waiting on lock');
          }
        },

        onSendevent: function (world, event, job) {
          if (job && job.name === 'EOD_POSITION_UPDATE' && (event === 'KILLJOB' || event === 'CHANGE_STATUS')) {
            world.flags.killedJob = true;
          }
          return false;
        },

        tick: function (world, seconds) {
          if (world.flags.unblocked) return;
          var w = world.db.sessions.filter(function (s) { return s.sid === 889; })[0];
          if (w) w.secondsInWait += seconds;
          var a = world.db.sessions.filter(function (s) { return s.sid === 412; })[0];
          if (a) a.lastCallEt += seconds;
        }
      });

      return world;
    },

    discoveries: [
      { id: 'job-waiting', label: 'The job process is idle - it is waiting, not working',
        when: function (o) { return /\b(ps|top)\b/.test(o.cmd) && /sqlplus|eod_position/.test(o.out); } },
      { id: 'lock-contention', label: 'The EOD session is on "enq: TX - row lock contention"',
        when: function (o) { return /row lock contention/i.test(o.out); } },
      { id: 'blocker-found', label: 'The blocker is SID 412, user OPS_ANALYST',
        when: function (o) { return /412/.test(PS.world.stripColor(o.out)) && /OPS_ANALYST/.test(o.out); } },
      { id: 'blocker-idle', label: 'That session is INACTIVE and has been idle for over two hours',
        when: function (o) { return /INACTIVE/.test(o.out) && /79\d\d|8\d\d\d/.test(PS.world.stripColor(o.out)); } },
      { id: 'blocker-client', label: 'It is an interactive Toad session from a desktop, not a batch',
        when: function (o) { return /Toad\.exe/i.test(o.out); } },
      { id: 'undo-small', label: 'It holds almost no undo - one statement, then abandoned',
        when: function (o) { return /USED_UBLK/i.test(o.out) && /\b3\b/.test(PS.world.stripColor(o.out)); } },
      { id: 'decoy-checked', label: 'Checked the other long session: TICKLOAD is genuinely working',
        when: function (o) { return /TICKLOAD/.test(o.out); } },
      { id: 'downstream-queued', label: 'Confirmed the downstream batch is queued behind it',
        when: function (o) { return /\bautorep\b/.test(o.cmd) && /EOD_PNL_CALC/.test(PS.world.stripColor(o.out)); }, optional: true }
    ],

    rootCauses: [
      { text: 'The EOD update statement is badly written and is doing a full table scan on 2.8 million rows.' },
      { text: 'An abandoned interactive session (SID 412, Toad) is holding a row lock from an uncommitted UPDATE, and the EOD update is queued behind it on TX enqueue.', correct: true },
      { text: 'The undo tablespace is full, so the update cannot allocate undo and is stalled.' },
      { text: 'The TICKLOAD session is consuming all database resources and starving the batch.' },
      { text: 'The network connection between the batch host and POSDB has dropped.' },
      { text: 'The Autosys agent lost contact with the scheduler, so the job only appears to be running.' }
    ],

    fix: {
      prompt: 'Get the EOD update through so the downstream batch can run. Whatever you kill, you own.',
      check: function (world) { return world.flags.unblocked === true; },
      grade: function (world) {
        var note = 'You identified the blocker as an abandoned interactive session, checked it\n' +
          'was INACTIVE with a trivial transaction, and killed only that one. The\n' +
          'update committed 2.8 million rows and EOD_PNL_CALC has started.';
        var bonus = 320;
        if (world.flags.killedWrongSession) {
          bonus = -260;
          note = 'You did eventually release the right session - but you also killed SID 901,\n' +
            'the TICKLOAD batch, which was ACTIVE and forty minutes into real work with\n' +
            '184,000 undo blocks. That rolled back, the tick load has to start again,\n' +
            'and it never had anything to do with the block. The checks that would have\n' +
            'told you: STATUS ACTIVE, LAST_CALL_ET of 2 seconds, a batch client, and a\n' +
            'large USED_UBLK.';
        } else if (world.flags.killedJob) {
          bonus = 120;
          note = note + '\n\nYou also touched the EOD job in the scheduler along the way. It was the\n' +
            'victim rather than the cause - killing or force-succeeding it would have\n' +
            'left the same lock in place for the next run.';
        }
        return { quality: bonus > 0 ? 'clean' : 'blunt', bonus: bonus, note: note };
      }
    },

    hints: [
      'A job that is "still running" is either working or waiting, and those need opposite responses. Look at the process first: is it using any CPU at all?',
      'It is waiting on the database. There is a SQL toolkit in /home/gsupport/sql - start with blockers.sql.',
      'You have a blocker and a waiter. Before you kill anything, prove which kind of session the blocker is: sessions.sql for STATUS and LAST_CALL_ET, transactions.sql for how much undo it holds.',
      'SID 412 is INACTIVE, idle over two hours, from Toad, holding 3 undo blocks - abandoned. SID 901 is ACTIVE, last call 2 seconds ago, sqlldr, 184,000 undo blocks - working. Kill 412 with ALTER SYSTEM KILL SESSION \'412,4471\';'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'An analyst ran an UPDATE against POSITIONS at 17:30 and left without\n' +
      'committing. Oracle held the row locks open, as it must. When the EOD update\n' +
      'reached the same rows it queued on the TX enqueue and waited - correctly,\n' +
      'and forever. Nothing was broken; one uncommitted transaction stopped the\n' +
      'entire overnight batch.\n\n' +
      'WAITING IS NOT WORKING\n' +
      'The first useful observation was free: the job process was using 0% CPU. A\n' +
      'job doing a two-hour update burns CPU and I/O. A job waiting on a lock does\n' +
      'nothing at all. That one look tells you to go to the database, not the SQL.\n\n' +
      'THE THREE QUERIES\n' +
      '  blockers.sql       v$session.blocking_session - who blocks whom\n' +
      '  sessions.sql       STATUS, PROGRAM, LAST_CALL_ET - is it abandoned\n' +
      '  transactions.sql   USED_UBLK - how much work would a rollback destroy\n' +
      'You need all three before you kill anything. The first identifies the\n' +
      'blocker; the other two decide whether killing it is safe.\n\n' +
      'ABANDONED vs WORKING\n' +
      '  ABANDONED  INACTIVE, LAST_CALL_ET large and growing, interactive client\n' +
      '             (Toad, SQL Developer), tiny undo. Kill it.\n' +
      '  WORKING    ACTIVE, LAST_CALL_ET tiny, batch client, large undo. Killing\n' +
      '             it rolls everything back - and the rollback can take longer\n' +
      '             than letting it finish.\n' +
      'This scenario put one of each in front of you deliberately.\n\n' +
      'WHAT NOT TO DO\n' +
      '  Kill the EOD job - it is the victim; the lock is still there next run.\n' +
      '  Bounce the database - POSDB also serves intraday risk and the client\n' +
      '    portal. You would turn a batch delay into a firm-wide outage.\n\n' +
      'INTERVIEW ANGLE\n' +
      '"A batch job has been running for hours, what do you do?" The expected\n' +
      'answer is: check whether it is consuming CPU, then look for lock waits,\n' +
      'find the blocking session, and establish whether the blocker is abandoned\n' +
      'before killing it. Saying "kill the blocker" without that last step is the\n' +
      'answer that fails the interview.'
  });
})(PS);
