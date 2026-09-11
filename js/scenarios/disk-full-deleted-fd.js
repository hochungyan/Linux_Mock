/* Scenario: /var is full, but du cannot find the bytes.
 *
 * The textbook version of the question every Linux support interview asks.
 * Ops "freed space" by deleting yesterday's log, but the JVM still holds the
 * file descriptor, so the blocks were never returned to the filesystem.
 *
 * There are three working fixes with very different blast radius, and the
 * scoring reflects that: truncate through /proc/<pid>/fd is clean, restarting
 * the service costs an outage, kill -9 costs an outage and risks the data.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'disk-full-deleted-fd',
    title: 'Trade capture stopped persisting',
    severity: 'P1',
    desk: 'Cash Equities / Trade Capture',
    host: 'ldn-app-prod07',
    tags: ['disk', 'lsof', 'file descriptors', 'classic interview'],
    par: 360,
    impactPerMin: 41000,
    currency: 'GBP',

    brief:
      'PAGER 14:22 - from Ops Bridge\n\n' +
      '"TCAP has stopped writing trades to the store. Blotter is showing a gap\n' +
      'from 14:05. The app is still up and the FIX sessions are connected.\n\n' +
      'Unix team already looked - they say /var filled up, so around 13:40 they\n' +
      'deleted the big log file from yesterday. It is STILL showing full and\n' +
      'they cannot see what is using the space. Handing to you."\n\n' +
      'Settlement cutoff is 17:00. Every trade not persisted has to be rekeyed.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 14, 22, 30);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var appLog =
        [ago(1500), ago(1200), ago(900)].map(function (d) {
          return W.isoStamp(d) + ' INFO  [tcap-persist-1] TradeWriter - flushed 214 trades seq=' + (884120 + Math.round((t0 - d) / 1000)) ;
        }).join('\n') + '\n' +
        W.isoStamp(ago(1080)) + ' WARN  [tcap-persist-1] TradeWriter - write latency 840ms (threshold 250ms)\n' +
        W.isoStamp(ago(1035)) + ' ERROR [tcap-persist-1] TradeWriter - failed to append to /var/lib/tcap/store/blotter.dat\n' +
        'java.io.IOException: No space left on device\n' +
        '\tat java.io.RandomAccessFile.writeBytes(Native Method)\n' +
        '\tat com.ib.tcap.store.TradeWriter.append(TradeWriter.java:188)\n' +
        '\tat com.ib.tcap.store.TradeWriter.flush(TradeWriter.java:142)\n' +
        W.isoStamp(ago(1020)) + ' ERROR [tcap-persist-1] TradeWriter - entering degraded mode, buffering in heap\n' +
        W.isoStamp(ago(600)) + ' WARN  [tcap-persist-1] TradeWriter - buffer depth 18422 trades\n' +
        W.isoStamp(ago(120)) + ' WARN  [tcap-persist-1] TradeWriter - buffer depth 41907 trades\n' +
        W.isoStamp(ago(30)) + ' ERROR [tcap-persist-1] TradeWriter - retry failed: No space left on device';

      var root = V.dir({
        apps: V.dir({
          tcap: V.dir({
            bin: V.dir({
              'tcap-start.sh': V.file('#!/bin/bash\nexec java -Xmx24g -jar /apps/tcap/lib/tcap-server.jar\n',
                { mode: '-rwxr-xr-x', owner: 'tcapadm', group: 'tcapadm', size: 96 })
            }),
            lib: V.dir({
              'tcap-server.jar': V.file('', { size: 84 * MB, owner: 'tcapadm', group: 'tcapadm' })
            }),
            conf: V.dir({
              'tcap.properties': V.file(
                'store.path=/var/lib/tcap/store\n' +
                'log.dir=/var/log/tcap\n' +
                'log.rotate=daily\n' +
                'log.retain.days=14\n' +
                'persist.buffer.max=65536\n', { owner: 'tcapadm', group: 'tcapadm' })
            })
          })
        }),

        var: V.dir({
          log: V.dir({
            tcap: V.dir({
              'tcap-app.log': V.file(appLog, { owner: 'tcapadm', group: 'tcapadm', mtime: ago(30), size: 6 * GB }),
              'tcap-gc.log': V.file('[GC pause (G1 Evacuation Pause) 18G->4G(24G), 0.0412 secs]',
                { owner: 'tcapadm', group: 'tcapadm', mtime: ago(60), size: 240 * MB }),
              'tcap-app.log.20260910.gz': V.file('', { owner: 'tcapadm', group: 'tcapadm', mtime: ago(86400), size: 310 * MB }),
              'tcap-app.log.20260909.gz': V.file('', { owner: 'tcapadm', group: 'tcapadm', mtime: ago(172800), size: 298 * MB })
            }),
            messages: V.file(
              W.syslogStamp(ago(1035)) + ' ldn-app-prod07 kernel: XFS (dm-3): Filesystem has no free space\n' +
              W.syslogStamp(ago(900)) + ' ldn-app-prod07 systemd: Started Session 4412 of user gsupport.',
              { owner: 'root', mtime: ago(900), size: 84 * MB }),
            'secure': V.file('', { owner: 'root', size: 12 * MB }),
            audit: V.dir({ 'audit.log': V.file('', { owner: 'root', size: 1200 * MB }) })
          }),
          lib: V.dir({
            tcap: V.dir({
              store: V.dir({
                'blotter.dat': V.file('', { owner: 'tcapadm', group: 'tcapadm', mtime: ago(1035), size: 1800 * MB }),
                'blotter.idx': V.file('', { owner: 'tcapadm', group: 'tcapadm', mtime: ago(1035), size: 140 * MB })
              })
            })
          }),
          tmp: V.dir({}),
          spool: V.dir({ mail: V.dir({}) }),
          cache: V.dir({ yum: V.dir({}) })
        }),

        home: V.dir({
          gsupport: V.dir({
            'runbook-tcap.txt': V.file(
              'TCAP RUNBOOK (extract)\n' +
              '----------------------\n' +
              '* Service unit ......... tcap\n' +
              '* Log directory ........ /var/log/tcap\n' +
              '* Trade store .......... /var/lib/tcap/store\n' +
              '* Restarting TCAP disconnects all FIX sessions and takes ~90s.\n' +
              '  Buffered trades in heap ARE LOST on restart. Avoid in market hours\n' +
              '  unless there is no alternative.\n' +
              '* Disk alerts: /var over 85% pages the desk.\n',
              { owner: 'gsupport', group: 'gsupport' })
          })
        }),

        tmp: V.dir({}),
        etc: V.dir({
          'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52 }),
          logrotate: V.dir({
            'tcap': V.file('/var/log/tcap/*.log {\n    daily\n    rotate 14\n    compress\n    missingok\n    notifempty\n}\n',
              { owner: 'root' })
          })
        }),
        usr: V.dir({ bin: V.dir({}), lib: V.dir({}) }),
        proc: V.dir({}),
        opt: V.dir({})
      });

      var deletedSize = 178 * GB;

      var tcap = W.proc({
        pid: 8841, ppid: 1, user: 'tcapadm',
        cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms24g -Xmx24g -XX:+UseG1GC -Dapp=tcap -jar /apps/tcap/lib/tcap-server.jar',
        short: 'java',
        state: 'S', cpu: 4.2, rss: 26 * GB, started: new Date(2026, 8, 11, 6, 2, 11),
        cpuSeconds: 4821, tty: '?',
        cwd: '/apps/tcap',
        fds: [
          { fd: 1, path: '/var/log/tcap/tcap-app.log', mode: 'w', size: 6 * GB },
          { fd: 4, path: '/var/lib/tcap/store/blotter.dat', mode: 'u', size: 1800 * MB },
          { fd: 5, path: '/var/lib/tcap/store/blotter.idx', mode: 'u', size: 140 * MB },
          { fd: 9, path: '/apps/tcap/lib/tcap-server.jar', mode: 'r', size: 84 * MB }
        ],
        jvm: {
          name: 'tcap-server.jar', mainClass: 'com.ib.tcap.Server',
          heapMax: 24 * GB, heapUsed: 19 * GB,
          args: '-Xms24g -Xmx24g -XX:+UseG1GC',
          stdoutLog: '/var/log/tcap/tcap-app.log',
          gcStats: { ygc: 8841, ygct: 214.882, fgc: 2, fgct: 1.221, old: 62.4, eden: 38.2, s1: 12.5 }
        },
        threads: [
          W.thread({ tid: 8851, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 12, stack: ['java.lang.Object.wait(Native Method)'] }),
          W.thread({ tid: 8869, name: 'tcap-persist-1', state: 'RUNNABLE', cpu: 1.1, cpuSeconds: 802,
            stack: ['java.io.RandomAccessFile.writeBytes(Native Method)',
              'com.ib.tcap.store.TradeWriter.append(TradeWriter.java:188)'] }),
          W.thread({ tid: 8870, name: 'fix-session-EQ1', state: 'RUNNABLE', cpu: 2.4, cpuSeconds: 2211,
            stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)'] })
        ]
      });

      var world = W.create({
        host: 'ldn-app-prod07', user: 'gsupport', clock: t0, seed: 77001,
        bootSeconds: 3600 * 24 * 63 + 4120,
        cores: 16, users: 4,
        load: [1.82, 1.64, 1.51],
        mem: { total: 64 * GB, free: 20 * GB, buffers: 380 * MB, cached: 9 * GB, shared: 240 * MB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 6.2, sy: 1.4, ni: 0, id: 91.9, wa: 0.5, st: 0 },
        root: root,
        limits: { nofile: 65536, nproc: 8192 },

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 18 * GB,
            inodes: { total: 26214400, used: 412880 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 199.4 * GB,
            inodes: { total: 104857600, used: 288401 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 100 * GB, used: 31 * GB,
            inodes: { total: 52428800, used: 91204 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 2.1 * GB,
            inodes: { total: 10485760, used: 8841 } },
          { dev: 'tmpfs', mount: '/dev/shm', type: 'tmpfs', size: 32 * GB, used: 0,
            inodes: { total: 8388608, used: 1 } }
        ],

        // The bytes ops "freed": unlinked, but still held open on fd 7.
        deleted: [{
          pid: 8841, fd: 7, cmd: 'java', user: 'tcapadm',
          path: '/var/log/tcap/tcap-app.log.20260910',
          size: deletedSize, mount: '/var', inode: 4718603
        }],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 12 * MB, cpu: 0, started: new Date(2026, 6, 10, 3, 12, 0), cpuSeconds: 412 }),
          W.proc({ pid: 1284, cmd: '/usr/sbin/rsyslogd -n', short: 'rsyslogd', rss: 48 * MB, cpu: 0.3, started: new Date(2026, 6, 10, 3, 12, 8), cpuSeconds: 1840 }),
          W.proc({ pid: 1602, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, started: new Date(2026, 6, 10, 3, 12, 9), cpuSeconds: 88 }),
          tcap,
          W.proc({ pid: 9104, ppid: 8841, user: 'tcapadm', cmd: '/apps/tcap/bin/tcap-watchdog.sh', short: 'tcap-watchd', rss: 6 * MB, cpu: 0.1, started: new Date(2026, 8, 11, 6, 2, 14), cpuSeconds: 22 }),
          W.proc({ pid: 14402, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', started: new Date(2026, 8, 11, 14, 15, 2), cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 8841, fd: 22, proto: 'tcp', local: '10.14.22.61:9310', peer: '10.14.30.12:51204', state: 'ESTABLISHED', recvq: 0, sendq: 0 },
          { pid: 8841, fd: 23, proto: 'tcp', local: '10.14.22.61:9310', peer: '10.14.30.13:51880', state: 'ESTABLISHED', recvq: 0, sendq: 0 },
          { pid: 8841, fd: 11, proto: 'tcp', local: '0.0.0.0:9310', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1602, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [
          { dev: 'dm-3', rs: 12.4, ws: 388.2, readKB: 198.4, writeKB: 4812.6, await: 2.1, util: 18.4, queue: 0.41 },
          { dev: 'sda', rs: 2.1, ws: 44.0, readKB: 32.0, writeKB: 610.2, await: 0.8, util: 4.2, queue: 0.04 }
        ],

        interfaces: [
          { name: 'eth0', addr: '10.14.22.61/24', mac: '00:50:56:9a:41:07', rxOk: 918273645, txOk: 812394012, rxBytes: 884120044412, txBytes: 712004881200, mtu: 1500 },
          { name: 'lo', addr: '127.0.0.1/8', mac: '00:00:00:00:00:00', rxOk: 44120, txOk: 44120, mtu: 65536 }
        ],

        dmesg: [
          { time: new Date(2026, 8, 11, 13, 40, 12), text: 'XFS (dm-3): Filesystem has no free space' },
          { time: new Date(2026, 8, 11, 14, 4, 55), text: 'XFS (dm-3): Filesystem has no free space' }
        ],

        services: {
          tcap: {
            active: true, pid: 8841, exe: 'java', desc: 'Trade Capture Server',
            since: new Date(2026, 8, 11, 6, 2, 11), tasks: 214,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms24g -Xmx24g -jar /apps/tcap/lib/tcap-server.jar',
            requiresRoot: false,
            log: ['TradeWriter - retry failed: No space left on device']
          },
          rsyslog: { active: true, pid: 1284, exe: 'rsyslogd', desc: 'System Logging Service', since: new Date(2026, 6, 10, 3, 12, 8) },
          sshd: { active: true, pid: 1602, exe: 'sshd', desc: 'OpenSSH server daemon', since: new Date(2026, 6, 10, 3, 12, 9) }
        },

        flags: { fixMethod: null },

        // Truncating through /proc/<pid>/fd/7 is the clean fix: no outage.
        onTruncate: function (world, entry) {
          if (entry.pid === 8841 && entry.fd === 7) {
            world.flags.fixMethod = 'truncate';
            recover(world);
          }
        },

        onKill: function (world, proc) {
          if (proc.pid === 8841) {
            world.flags.fixMethod = 'kill';
            world.flags.tradesLost = true;
            recover(world);
          }
        },

        onService: function (world, verb, unit) {
          if (unit !== 'tcap' && unit !== 'tcap.service') return false;
          if (verb === 'restart' || verb === 'stop') {
            world.flags.fixMethod = verb === 'restart' ? 'restart' : 'stop';
            world.flags.tradesLost = true;
            W.killProc(world, 8841);
            recover(world);
            if (verb === 'restart') {
              // comes back with a fresh pid and an empty log
              var fresh = W.proc({
                pid: 21470, user: 'tcapadm',
                cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms24g -Xmx24g -XX:+UseG1GC -Dapp=tcap -jar /apps/tcap/lib/tcap-server.jar',
                short: 'java', cpu: 12.4, rss: 8 * GB, started: new Date(world.clock.getTime()),
                jvm: { name: 'tcap-server.jar', mainClass: 'com.ib.tcap.Server', heapMax: 24 * GB, heapUsed: 3 * GB },
                fds: [{ fd: 1, path: '/var/log/tcap/tcap-app.log', mode: 'w', size: 4096 }]
              });
              world.procs.push(fresh);
              world.services.tcap.pid = 21470;
              world.services.tcap.since = new Date(world.clock.getTime());
              W.appendLog(world, '/var/log/tcap/tcap-app.log',
                W.isoStamp(world.clock) + ' INFO  [main] Server - TCAP started, replaying from blotter.idx');
            }
            return true;
          }
          return false;
        },

        tick: function (world, seconds) {
          world.notes.since = (world.notes.since || 0) + seconds;
          if (world.flags.fixMethod) return;
          // buffered trades keep piling up in heap while the disk stays full
          if (world.notes.since % 45 < 1) {
            W.appendLog(world, '/var/log/tcap/tcap-app.log',
              W.isoStamp(world.clock) + ' WARN  [tcap-persist-1] TradeWriter - buffer depth ' +
              (41907 + Math.round(world.notes.since * 6)) + ' trades');
          }
        }
      });

      function recover(world) {
        var fs = W.fsByMount(world, '/var');
        if (fs) fs.used = Math.min(fs.used, 21.4 * GB);
        world.deleted = world.deleted.filter(function (d) { return d.pid !== 8841; });
        world.dmesg.push({ time: new Date(world.clock.getTime()), text: 'XFS (dm-3): space reclaimed' });
      }

      return world;
    },

    discoveries: [
      {
        id: 'var-full',
        label: '/var is at 100% - no free blocks',
        when: function (o) {
          return /\bdf\b/.test(o.cmd) && /\/var/.test(o.out) && /100%|99%/.test(o.out);
        }
      },
      {
        id: 'du-mismatch',
        label: 'du only accounts for ~10G of the 200G /var claims is used',
        when: function (o) {
          return /\bdu\b/.test(o.cmd) && /\/var/.test(o.cmd + o.out);
        }
      },
      {
        id: 'inodes-ok',
        label: 'Ruled out inode exhaustion (df -i is healthy)',
        when: function (o) { return /\bdf\b.*-\w*i/.test(o.cmd); },
        optional: true
      },
      {
        id: 'deleted-held',
        label: 'A deleted 178G file is still held open (NLINK 0)',
        when: function (o) {
          return /\blsof\b/.test(o.cmd) && /\(deleted\)|\+L1/.test(o.out + o.cmd) && /deleted/i.test(o.out);
        }
      },
      {
        id: 'holder-pid',
        label: 'The holder is the TCAP JVM, pid 8841, on fd 7',
        when: function (o) {
          return /8841/.test(o.out) && /\blsof\b/.test(o.cmd) && /deleted/i.test(o.out);
        }
      },
      {
        id: 'app-error',
        label: 'TCAP is buffering trades in heap: "No space left on device"',
        when: function (o) {
          return /No space left on device/i.test(o.out);
        }
      }
    ],

    rootCauses: [
      { text: 'Log rotation is misconfigured, so /var/log/tcap grew without bound.' },
      { text: 'A log file was unlinked while the TCAP JVM still held it open, so the kernel never released its blocks - df counts them, du cannot see them.', correct: true },
      { text: '/var has run out of inodes; there are free blocks but no free inodes.' },
      { text: 'A filesystem is mounted over /var, hiding the files underneath it from du.' },
      { text: 'The trade store file blotter.dat has grown to fill the filesystem.' }
    ],

    fix: {
      prompt: 'Get /var below 85% without losing the buffered trades if you can.',
      check: function (world) {
        var fs = W.fsByMount(world, '/var');
        return fs && W.pct(fs.used, fs.size) < 85;
      },
      grade: function (world) {
        switch (world.flags.fixMethod) {
          case 'truncate':
            return {
              quality: 'clean', bonus: 250,
              note: 'You truncated the file through /proc/8841/fd/7. The blocks came back\n' +
                'immediately, the JVM kept running, and the buffered trades flushed to the\n' +
                'store. No outage, no rekeying. This is the right answer.'
            };
          case 'restart':
            return {
              quality: 'blunt', bonus: 0,
              note: 'Restarting TCAP did free the space - closing the process closed the fd.\n' +
                'But it cost a 90 second outage in market hours and the trades buffered in\n' +
                'heap were lost, so the desk has to rekey them. Truncating through\n' +
                '/proc/8841/fd/7 would have fixed it with no outage at all.'
            };
          case 'kill':
            return {
              quality: 'blunt', bonus: -100,
              note: 'kill -9 on the trade capture JVM freed the space, but you took the app\n' +
                'down hard in market hours and discarded every buffered trade. The clean\n' +
                'fix was "> /proc/8841/fd/7" - same result, no outage.'
            };
          default:
            return { quality: 'other', bonus: 0, note: 'Space was reclaimed.' };
        }
      }
    },

    hints: [
      'df measures the filesystem superblock. du walks the directory tree. When they disagree, the bytes are somewhere du cannot reach - not in any directory.',
      'A file that has been unlinked but is still open has a link count of zero. lsof can list exactly those: lsof +L1',
      'You found the holder: pid 8841, fd 7. You do not have to restart it - you can write through the descriptor itself: > /proc/8841/fd/7'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'When a process has a file open, unlinking the path only removes the directory\n' +
      'entry. The inode - and every block it owns - survives until the last file\n' +
      'descriptor referring to it is closed. df reads the superblock free-block\n' +
      'counter, so it sees those blocks as used. du walks directory entries, and the\n' +
      'entry is gone, so it sees nothing. That gap IS the diagnosis.\n\n' +
      'HOW TO SPOT IT IN SECONDS\n' +
      '  df -h /var                 confirm the filesystem is genuinely full\n' +
      '  df -i /var                 rule out inode exhaustion (a different fault)\n' +
      '  du -sh /var/*              see that the tree does not add up\n' +
      '  lsof +L1                   list open files with link count 0\n\n' +
      'THE FIXES, IN ORDER OF PREFERENCE\n' +
      '  > /proc/<pid>/fd/<n>       reclaims the blocks instantly, no restart\n' +
      '  truncate -s 0 /proc/<pid>/fd/<n>   same thing\n' +
      '  restart the service        works, but costs an outage\n' +
      '  kill -9                    works, but also discards in-flight state\n\n' +
      'INTERVIEW ANGLE\n' +
      'If you are asked "df says full but du says empty, what is going on?", the\n' +
      'expected answer is deleted-but-open files, and the expected follow-up is\n' +
      'lsof +L1. Mentioning that you can truncate via /proc/<pid>/fd rather than\n' +
      'bouncing a production app is what separates an L2 answer from an L1 one.'
  });
})(PS);
