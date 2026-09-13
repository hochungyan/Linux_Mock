/* Scenario: the kdb+ real-time database will not survive to the close.
 *
 * Classic tick-capture architecture: a tickerplant writes every message to a
 * log and publishes to subscribers; the RDB holds the whole day in memory and
 * writes down to the HDB at end of day. Last night that writedown failed, so
 * the RDB replayed the old log at startup and is carrying two days.
 *
 * The lesson is that the visible problem (memory) and the actual cause (a full
 * HDB filesystem) are on different machines' worth of concern, and restarting
 * the thing that looks wrong makes no difference at all.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'kdb-rdb-memory',
    title: 'Tick RDB will run out of memory before the close',
    severity: 'P1',
    desk: 'Quant Research / Tick Data',
    host: 'ldn-kdb-prod01',
    tags: ['kdb+', 'tickerplant', 'RDB', 'HDB writedown', 'capacity'],
    par: 520,
    impactPerMin: 26000,
    currency: 'USD',

    brief:
      'PAGER 14:12 - from Quant Research\n\n' +
      '"The RDB is at 54 gigabytes on a 64 gigabyte box and climbing. Every\n' +
      'research query against today\'s data goes through it, and if it dies we\n' +
      'lose the intraday tick capture for the US open.\n\n' +
      'It was fine yesterday. Nothing has been released."\n\n' +
      'US cash opens at 14:30 London, which roughly triples the message rate.\n' +
      'The RDB holds the whole trading day in memory by design - it is supposed\n' +
      'to be emptied by the end-of-day writedown.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 14, 12, 30);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var lastNight = new Date(2026, 8, 11, 0, 5, 2);

      /* An HDB partition: a handful of large column files. Deleting one that is
       * genuinely archived is the safe way to make room. */
      function partition(sizeGb, owner, mt) {
        var per = Math.round(sizeGb * GB / 4);
        return V.dir({
          trade: V.dir({
            'sym': V.file('', { size: per, owner: owner, mtime: mt }),
            'price': V.file('', { size: per, owner: owner, mtime: mt })
          }, { owner: owner, mtime: mt }),
          quote: V.dir({
            'bid': V.file('', { size: per, owner: owner, mtime: mt }),
            'ask': V.file('', { size: per, owner: owner, mtime: mt })
          }, { owner: owner, mtime: mt })
        }, { owner: owner, mtime: mt });
      }

      var eodLog = [
        W.isoStamp(lastNight) + ' INFO  eod_writedown.q starting for date 2026.09.10',
        W.isoStamp(new Date(lastNight.getTime() + 4000)) + ' INFO  target /kdb/hdb/2026.09.10',
        W.isoStamp(new Date(lastNight.getTime() + 62000)) + ' INFO  writing trade: 412,008,841 rows',
        W.isoStamp(new Date(lastNight.getTime() + 184000)) + ' ERROR os error: No space left on device',
        W.isoStamp(new Date(lastNight.getTime() + 184100)) + ' ERROR writedown FAILED for 2026.09.10, RDB not flushed',
        W.isoStamp(new Date(lastNight.getTime() + 184200)) + ' WARN  tickerplant log NOT rolled; RDB will replay it on next start'
      ].join('\n');

      var tpLog = [
        W.isoStamp(ago(28800)) + ' INFO  tickerplant started, log /kdb/tplog/sym2026.09.11',
        W.isoStamp(ago(28700)) + ' INFO  subscriber attached: rdb (handle 7)',
        W.isoStamp(ago(28690)) + ' INFO  subscriber attached: chainedtp (handle 8)',
        W.isoStamp(ago(120)) + ' INFO  published 1,204,881,200 messages today'
      ].join('\n');

      var rdbLog = [
        W.isoStamp(ago(28600)) + ' INFO  rdb starting, replaying tickerplant log /kdb/tplog/sym2026.09.10',
        W.isoStamp(ago(28100)) + ' WARN  replayed 412,008,841 rows from PREVIOUS day (writedown did not run)',
        W.isoStamp(ago(28000)) + ' INFO  subscribing to tickerplant for 2026.09.11',
        W.isoStamp(ago(600)) + ' WARN  .Q.w[] used 54.2GB of 64GB, growing 4.1GB/hour',
        W.isoStamp(ago(60)) + ' WARN  projected exhaustion 16:40 at current rate'
      ].join('\n');

      var root = V.dir({
        kdb: V.dir({
          bin: V.dir({
            'eod_writedown.q': V.file('/ end of day writedown to HDB\n.Q.dpft[hdb;d;`sym;`trade]\n',
              { mode: '-rwxr-xr-x', owner: 'kdbadm', size: 120, mtime: ago(900000) })
          }),
          tplog: V.dir({
            // yesterday's log was never rolled - which is why the RDB replayed it
            'sym2026.09.10': V.file('', { size: 380 * GB, owner: 'kdbadm', mtime: lastNight }),
            'sym2026.09.11': V.file('', { size: 410 * GB, owner: 'kdbadm', mtime: ago(5) })
          }, { owner: 'kdbadm', mtime: ago(5) }),
          hdb: V.dir({
            '2026.06.12': partition(380, 'kdbadm', new Date(2026, 5, 12, 23, 0, 0)),
            '2026.06.13': partition(380, 'kdbadm', new Date(2026, 5, 13, 23, 0, 0)),
            '2026.09.08': partition(390, 'kdbadm', new Date(2026, 8, 8, 23, 0, 0)),
            '2026.09.09': partition(395, 'kdbadm', new Date(2026, 8, 9, 23, 0, 0)),
            'sym': V.file('', { size: 240 * MB, owner: 'kdbadm', mtime: ago(86400) })
          }, { owner: 'kdbadm', mtime: ago(86400) }),
          archive: V.dir({
            // proof that these two partitions are already safely copied off
            '2026.06.12.tar.gz': V.file('', { size: 96 * GB, owner: 'kdbadm', mtime: new Date(2026, 8, 9, 2, 0, 0) }),
            '2026.06.13.tar.gz': V.file('', { size: 97 * GB, owner: 'kdbadm', mtime: new Date(2026, 8, 9, 2, 30, 0) }),
            'MANIFEST.txt': V.file(
              '# partitions archived to tape and verified\n' +
              '2026.06.12  checksum ok  tape LTO-4412  verified 2026-09-09 02:41\n' +
              '2026.06.13  checksum ok  tape LTO-4412  verified 2026-09-09 03:02\n',
              { owner: 'kdbadm', mtime: new Date(2026, 8, 9, 3, 5, 0) })
          }, { owner: 'kdbadm', mtime: new Date(2026, 8, 9, 3, 5, 0) })
        }),
        var: V.dir({
          log: V.dir({
            kdb: V.dir({
              'eod_writedown.log': V.file(eodLog, { owner: 'kdbadm', mtime: new Date(lastNight.getTime() + 184200), size: 8 * MB }),
              'tickerplant.log': V.file(tpLog, { owner: 'kdbadm', mtime: ago(120), size: 42 * MB }),
              'rdb.log': V.file(rdbLog, { owner: 'kdbadm', mtime: ago(60), size: 18 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-kdb.txt': V.file(
              'KDB+ TICK CAPTURE RUNBOOK\n' +
              '=========================\n' +
              'ARCHITECTURE\n' +
              '  tickerplant  receives every message, appends it to a log on disk,\n' +
              '               and publishes to subscribers. Losing the tickerplant\n' +
              '               loses the capture - it is the one process that must\n' +
              '               never be killed during the trading day.\n' +
              '  rdb          real-time database. Holds the WHOLE trading day in\n' +
              '               memory. Research queries for today hit this.\n' +
              '  hdb          historical database on disk, one directory per date.\n' +
              '\n' +
              'END OF DAY\n' +
              '  eod_writedown.q writes the RDB to a new HDB partition, then the\n' +
              '  tickerplant log is rolled and the RDB restarts empty.\n' +
              '  If the writedown FAILS, the log is not rolled - so when the RDB next\n' +
              '  starts it replays the previous day as well, and begins the new day\n' +
              '  already carrying a full day of data. Memory then runs out mid-session.\n' +
              '\n' +
              'INTRADAY WRITEDOWN (to recover memory without losing anything)\n' +
              '    curl http://localhost:5011/admin/writedown\n' +
              '  Flushes what the RDB holds to the HDB and frees the memory. It needs\n' +
              '  free space on /kdb/hdb and will refuse if there is none.\n' +
              '\n' +
              'MAKING ROOM ON /kdb/hdb\n' +
              '  Retention is 90 days. Older partitions are archived nightly to\n' +
              '  /kdb/archive and may be removed ONCE VERIFIED in\n' +
              '  /kdb/archive/MANIFEST.txt. Check the manifest first, every time.\n' +
              '  Removing a partition that is not in the manifest is unrecoverable\n' +
              '  data loss - research reproducibility depends on that history.\n' +
              '\n' +
              'RESTARTING THE RDB DOES NOT FREE MEMORY\n' +
              '  It replays the tickerplant log on startup and comes back holding\n' +
              '  exactly the same data. The memory is not a leak; it is the day.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-kdb-prod01', user: 'gsupport', clock: t0, seed: 5010,
        bootSeconds: 3600 * 24 * 41, cores: 16, users: 3,
        load: [3.18, 3.04, 2.88],
        // 54G resident in the RDB; very little headroom left
        mem: { total: 64 * GB, free: 2.4 * GB, buffers: 180 * MB, cached: 3 * GB, shared: 120 * MB },
        swap: { total: 8 * GB, used: 0.2 * GB, si: 0, so: 4 },
        cpu: { us: 18.2, sy: 4.1, ni: 0, id: 74.4, wa: 3.3, st: 0 },
        root: root,

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB, inodes: { total: 26214400, used: 180402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 18 * GB, inodes: { total: 52428800, used: 20114 } },
          // the tickerplant log volume: fine
          { dev: '/dev/mapper/vg02-tplog', mount: '/kdb/tplog', type: 'xfs', size: 2000 * GB, used: 790 * GB, inodes: { total: 104857600, used: 42 } },
          // the actual cause: the HDB volume is full
          { dev: '/dev/mapper/vg01-hdb', mount: '/kdb/hdb', type: 'xfs', size: 1600 * GB, used: 1598 * GB, inodes: { total: 209715200, used: 88412 } },
          { dev: '/dev/mapper/vg03-arch', mount: '/kdb/archive', type: 'xfs', size: 800 * GB, used: 194 * GB, inodes: { total: 52428800, used: 120 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 880 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 620 }),
          W.proc({ pid: 1618, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 22 }),
          // the tickerplant: small, and must not be touched
          W.proc({ pid: 4102, user: 'kdbadm', short: 'q', cpu: 12.4, rss: 900 * MB,
            cmd: '/usr/local/q/l64/q /kdb/bin/tick.q sym /kdb/tplog -p 5010',
            started: new Date(2026, 8, 11, 6, 15, 0), cpuSeconds: 4120,
            fds: [{ fd: 3, path: '/kdb/tplog/sym2026.09.11', mode: 'w', size: 410 * GB }] }),
          // the RDB: the thing that is about to die
          W.proc({ pid: 4118, user: 'kdbadm', short: 'q', cpu: 22.1, rss: 54 * GB,
            cmd: '/usr/local/q/l64/q /kdb/bin/r.q :5010 -p 5011',
            started: new Date(2026, 8, 11, 6, 16, 0), cpuSeconds: 8412,
            fds: [{ fd: 1, path: '/var/log/kdb/rdb.log', mode: 'w', size: 18 * MB }] }),
          W.proc({ pid: 4140, user: 'kdbadm', short: 'q', cpu: 3.2, rss: 1200 * MB,
            cmd: '/usr/local/q/l64/q /kdb/bin/chainedtp.q :5010 -p 5012',
            started: new Date(2026, 8, 11, 6, 16, 30), cpuSeconds: 880 }),
          W.proc({ pid: 24100, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 4102, fd: 11, proto: 'tcp', local: '0.0.0.0:5010', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 4118, fd: 12, proto: 'tcp', local: '0.0.0.0:5011', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 4140, fd: 13, proto: 'tcp', local: '0.0.0.0:5012', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 4118, fd: 7, proto: 'tcp', local: '10.14.22.96:41208', peer: '10.14.22.96:5010', state: 'ESTABLISHED' },
          { pid: 1618, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [{ dev: 'dm-3', rs: 41.2, ws: 880.4, readKB: 2204.1, writeKB: 88120.2, await: 8.4, util: 62.1 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.96/24', rxOk: 4412008841, txOk: 1204881200, rxBytes: 881200441200, txBytes: 220048812004 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 1204881, txOk: 1204881, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [5010, 5011, 5012, 22], rtt: 0.02 } },

        http: {
          'localhost:5011/admin/status': function (world) {
            var rdb = W.findProc(world, 4118);
            var used = rdb ? rdb.rss : 0;
            return JSON.stringify({
              process: 'rdb', port: 5011,
              memoryUsedGB: +(used / GB).toFixed(1),
              memoryLimitGB: 64,
              growthGBPerHour: 4.1,
              projectedExhaustion: world.flags.flushed ? null : '16:40',
              rowsHeld: world.flags.flushed ? 412008841 : 824017682,
              datesHeld: world.flags.flushed ? ['2026.09.11'] : ['2026.09.10', '2026.09.11'],
              lastWritedown: world.flags.flushed ? W.isoStamp(world.clock) : 'FAILED 2026-09-11 00:08'
            }, null, 2);
          },
          'localhost:5011/admin/writedown': function (world) {
            var fs = W.fsByMount(world, '/kdb/hdb');
            var freeGb = (fs.size - fs.used) / GB;
            if (freeGb < 100) {
              return JSON.stringify({
                status: 'refused',
                reason: 'insufficient space on /kdb/hdb',
                freeGB: +freeGb.toFixed(1),
                requiredGB: 100,
                note: 'free space on the HDB volume before retrying'
              }, null, 2);
            }
            world.flags.flushed = true;
            var rdb = W.findProc(world, 4118);
            if (rdb) rdb.rss = 4 * GB;
            world.mem.free = 52 * GB;
            fs.used += 96 * GB;
            W.appendLog(world, '/var/log/kdb/rdb.log',
              W.isoStamp(world.clock) + ' INFO  intraday writedown complete, 412,008,841 rows flushed to /kdb/hdb/2026.09.10');
            W.appendLog(world, '/var/log/kdb/rdb.log',
              W.isoStamp(world.clock) + ' INFO  .Q.w[] used 4.0GB of 64GB');
            return JSON.stringify({
              status: 'ok', rowsWritten: 412008841, partition: '2026.09.10',
              memoryFreedGB: 50, memoryUsedGB: 4.0
            }, null, 2);
          }
        },

        services: {
          'kdb-tickerplant': { active: true, pid: 4102, exe: 'q', desc: 'kdb+ tickerplant', requiresRoot: false },
          'kdb-rdb': { active: true, pid: 4118, exe: 'q', desc: 'kdb+ real-time database', requiresRoot: false },
          sshd: { active: true, pid: 1618, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { flushed: false, restartedRdb: false, lostHistory: false, killedTp: false },

        onService: function (world, verb, unit) {
          var name = String(unit).replace(/\.service$/, '');
          if (name === 'kdb-rdb' && (verb === 'restart' || verb === 'stop')) {
            world.flags.restartedRdb = true;
            // it replays the tickerplant log and comes back holding the same data
            W.appendLog(world, '/var/log/kdb/rdb.log',
              W.isoStamp(world.clock) + ' INFO  rdb starting, replaying /kdb/tplog/sym2026.09.10 and sym2026.09.11');
            W.appendLog(world, '/var/log/kdb/rdb.log',
              W.isoStamp(world.clock) + ' WARN  .Q.w[] used 54.2GB of 64GB after replay - no memory recovered');
            return true;
          }
          if (name === 'kdb-tickerplant' && (verb === 'restart' || verb === 'stop')) {
            world.flags.killedTp = true;
            return true;
          }
          return false;
        },

        onKill: function (world, proc) {
          if (proc.pid === 4102) world.flags.killedTp = true;
          if (proc.pid === 4118) world.flags.restartedRdb = true;
        },

        tick: function (world, seconds) {
          if (world.flags.flushed) return;
          var rdb = W.findProc(world, 4118);
          if (rdb) {
            rdb.rss += Math.round((4.1 * GB / 3600) * seconds);
            world.mem.free = Math.max(200 * MB, world.mem.free - Math.round((4.1 * GB / 3600) * seconds));
          }
        }
      });

      /* Removing an HDB partition is only safe if it is in the archive
       * manifest. The scenario watches which one you removed. */
      world.onRemove = function (w, path) {
        var m = /^\/kdb\/hdb\/(\d{4}\.\d{2}\.\d{2})$/.exec(path);
        if (!m) return;
        var archived = ['2026.06.12', '2026.06.13'];
        if (archived.indexOf(m[1]) < 0) {
          w.flags.lostHistory = m[1];
        }
      };

      return world;
    },

    discoveries: [
      { id: 'rdb-memory', label: 'The RDB is holding ~54GB of a 64GB box',
        when: function (o) { return /\b(ps|top|free|curl)\b/.test(o.cmd) && /(5[0-9]\.\d|5[0-9]G|memoryUsedGB)/.test(PS.world.stripColor(o.out)); } },
      { id: 'two-days', label: 'The RDB is holding TWO dates, not one',
        when: function (o) { return /2026\.09\.10/.test(o.out) && /2026\.09\.11/.test(o.out); } },
      { id: 'writedown-failed', label: 'Last night\'s EOD writedown failed',
        when: function (o) { return /writedown FAILED|writedown failed/i.test(o.out); } },
      { id: 'enospc', label: 'It failed with "No space left on device"',
        when: function (o) { return /No space left on device/i.test(o.out); } },
      { id: 'hdb-full', label: '/kdb/hdb is full - that is the actual cause',
        when: function (o) { return /\bdf\b/.test(o.cmd) && /\/kdb\/hdb/.test(o.out) && /100%|99%/.test(o.out); } },
      { id: 'replayed', label: 'The RDB replayed the unrolled tickerplant log at startup',
        when: function (o) { return /replay/i.test(o.out) && /2026\.09\.10/.test(o.out); } },
      { id: 'retention', label: 'Found partitions beyond the 90 day retention window',
        when: function (o) { return /2026\.06\.1[23]/.test(o.out); } },
      { id: 'manifest-checked', label: 'Verified against the archive manifest before deleting anything',
        when: function (o) { return /MANIFEST/i.test(o.cmd + o.out) && /checksum ok|verified/i.test(o.out); } },
      { id: 'tp-healthy', label: 'Confirmed the tickerplant itself is healthy and still capturing',
        when: function (o) { return /tickerplant/i.test(o.out) && !/error/i.test(o.out); }, optional: true }
    ],

    rootCauses: [
      { text: 'The RDB has a memory leak introduced in the last release.' },
      { text: 'Last night\'s end-of-day writedown failed because /kdb/hdb was full. The tickerplant log was therefore never rolled, so the RDB replayed the previous day on startup and is carrying two days of ticks in memory.', correct: true },
      { text: 'Message volumes are unusually high today and the box is simply undersized.' },
      { text: 'The tickerplant is publishing duplicate messages to its subscribers.' },
      { text: 'A research user has run a query that has materialised a huge result set in the RDB.' },
      { text: 'The chained tickerplant has stopped consuming, so messages are backing up in the RDB.' }
    ],

    fix: {
      prompt: 'Get the RDB back to a safe memory level before the US open at 14:30. Do not interrupt the tick capture, and do not lose any history.',
      check: function (world) {
        var rdb = W.findProc(world, 4118);
        return !!rdb && rdb.rss < 20 * GB;
      },
      grade: function (world) {
        if (world.flags.lostHistory) {
          return { quality: 'blunt', bonus: -420,
            note: 'Memory is recovered, but you removed /kdb/hdb/' + world.flags.lostHistory + ' and that\n' +
              'partition is NOT in /kdb/archive/MANIFEST.txt. It has not been archived\n' +
              'anywhere. A day of tick history is permanently gone, every backtest that\n' +
              'spans that date is now irreproducible, and that is a far bigger problem\n' +
              'than the one you were paged for.\n\n' +
              'Two partitions from June were verified in the manifest and would have\n' +
              'freed more than enough space.' };
        }
        if (world.flags.killedTp) {
          return { quality: 'blunt', bonus: -350,
            note: 'You stopped the tickerplant. That is the one process that must never be\n' +
              'touched during the session: it is the only thing writing the capture log,\n' +
              'so every message published while it was down is gone and cannot be\n' +
              'recovered from anywhere. The RDB memory was never the tickerplant\'s\n' +
              'problem.' };
        }
        return { quality: 'clean', bonus: 340,
          note: 'You traced the memory back to a failed writedown and a full HDB volume,\n' +
            'checked the archive manifest before removing anything, freed the space and\n' +
            'ran the intraday writedown. The RDB dropped from 54GB to 4GB, the capture\n' +
            'never stopped, and no history was lost.\n\n' +
            'Worth raising: last night\'s writedown failure did not page anyone. That\n' +
            'is the real finding.' +
            (world.flags.restartedRdb
              ? '\n\nYou restarted the RDB along the way and will have noticed it came back at\nthe same size - it replays the log, so the memory is the data, not a leak.'
              : '') };
      }
    },

    hints: [
      'The RDB holding the day in memory is by design - it is supposed to be emptied overnight. So the question is not "why is it using memory", it is "why was it not emptied". Look at what the end-of-day writedown did last night.',
      'The writedown log is in /var/log/kdb. Read why it failed, then check the filesystem it was writing to.',
      '/kdb/hdb is full, so the writedown could not run, so the tickerplant log was never rolled, so the RDB replayed yesterday at startup. Fix the space problem first - retention is 90 days and there are June partitions still there.',
      'Check /kdb/archive/MANIFEST.txt before you delete anything - only remove a partition that is verified in it. Then run the intraday writedown: curl http://localhost:5011/admin/writedown'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'A chain of three, and only the last one paged anyone:\n' +
      '  1. /kdb/hdb filled up.\n' +
      '  2. The end-of-day writedown failed with ENOSPC, so the RDB was never\n' +
      '     flushed and the tickerplant log was never rolled.\n' +
      '  3. The RDB restarted, replayed the unrolled log, and began the trading\n' +
      '     day already holding a full day of ticks.\n' +
      'The symptom was memory. The cause was disk, eight hours earlier, on a step\n' +
      'that failed silently.\n\n' +
      'WHY A RESTART CANNOT HELP\n' +
      'The RDB\'s memory is not a leak - it is the data. On startup it replays the\n' +
      'tickerplant log to rebuild exactly what it had. Restarting returns it to\n' +
      'the same size a few minutes later. Recognising "this memory is load-bearing"\n' +
      'is what stops you wasting the twenty minutes you did not have.\n\n' +
      'THE ONE PROCESS YOU NEVER TOUCH\n' +
      'The tickerplant is the only thing writing the capture log. Everything else -\n' +
      'RDB, chained tickerplant, research processes - can be rebuilt from that log.\n' +
      'The log cannot be rebuilt from anything. During the session the tickerplant\n' +
      'is sacrosanct.\n\n' +
      'CHECK THE MANIFEST BEFORE YOU DELETE\n' +
      'Freeing disk by deleting the oldest thing you can see is how a capacity\n' +
      'incident becomes a data loss incident. Archived and deleted are different\n' +
      'states, and only the manifest tells you which one a partition is in. In a\n' +
      'research shop that history is the firm\'s asset - a backtest that cannot be\n' +
      'reproduced is worth nothing.\n\n' +
      'THE REAL FINDING\n' +
      'A failed overnight writedown produced no alert. The incident you were paged\n' +
      'for was eight hours downstream of it. Post-incident, the action is not "add\n' +
      'more memory" - it is "alert on the writedown, and alert on HDB capacity\n' +
      'before it reaches 100%".\n\n' +
      'INTERVIEW ANGLE\n' +
      'kdb+ turns up constantly in hedge fund infrastructure. Knowing the\n' +
      'tickerplant / RDB / HDB split, that the RDB holds the day in memory by\n' +
      'design, that the tickerplant log is the only irreplaceable artefact, and\n' +
      'what a failed writedown does to the next day is exactly the depth expected.'
  });
})(PS);
