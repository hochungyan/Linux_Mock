/* Scenario: one core pinned at 100%, order acknowledgements sliding.
 *
 * Teaches the single most reusable JVM triage sequence there is:
 *   top -H -p <pid>  ->  hottest TID  ->  printf '%x\n' <tid>  ->  jstack | grep nid
 * and the reading of "100%" on a 16 core box as one core, not the machine.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'cpu-spin-thread',
    title: 'Order acks slowing, one core pinned',
    severity: 'P2',
    desk: 'Electronic Trading / Order Gateway',
    host: 'ldn-fix-prod01',
    tags: ['CPU', 'threads', 'jstack', 'latency', 'classic interview'],
    par: 400,
    impactPerMin: 22000,
    currency: 'GBP',

    brief:
      'PAGER 10:41 - from Low Touch desk\n\n' +
      '"Acks are coming back slow. Normally sub-millisecond, we are seeing 40-80ms\n' +
      'and it is getting worse through the morning. Nothing has been released."\n\n' +
      'Monitoring shows the fixgw box at 6% CPU overall, so capacity management say\n' +
      'there is no CPU problem and have bounced it back to you.\n\n' +
      'The standby gateway on ldn-fix-prod02 is warm and healthy.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 10, 41, 18);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var appLog = [];
      for (var i = 12; i >= 0; i--) {
        var lat = i > 8 ? 0.8 : (12 - i) * 7.4;
        appLog.push(W.isoStamp(ago(i * 300), true) +
          ' INFO  [metrics] Latency - ack p50=' + lat.toFixed(1) + 'ms p99=' + (lat * 2.6).toFixed(1) +
          'ms orders=' + (41208 + (12 - i) * 1840));
      }
      appLog.push(W.isoStamp(ago(1800), true) +
        ' INFO  [session-reaper] SessionRegistry - reaping 14 expired sessions from registry');
      appLog.push(W.isoStamp(ago(1790), true) +
        ' INFO  [order-router-3] OrderRouter - routing resumed');

      var root = V.dir({
        apps: V.dir({
          fixgw: V.dir({
            lib: V.dir({ 'fixgw.jar': V.file('', { size: 48 * MB, owner: 'fixadm' }) }),
            conf: V.dir({
              'fixgw.properties': V.file(
                'admin.port=9975\n' +
                'fix.port=9310\n' +
                'session.registry.impl=java.util.HashMap   # not synchronized\n' +
                'session.reaper.interval=1800\n' +
                'standby.host=ldn-fix-prod02\n', { owner: 'fixadm' })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            fixgw: V.dir({
              'fixgw-app.log': V.file(appLog.join('\n'), { owner: 'fixadm', mtime: ago(60), size: 620 * MB }),
              'fixgw-gc.log': V.file(
                [0, 1, 2, 3].map(function (k) {
                  return '[' + W.isoStamp(ago((4 - k) * 180), true) +
                    '] [GC pause (G1 Evacuation Pause) (young) 2104M->412M(8192M), 0.0088 secs]';
                }).join('\n'), { owner: 'fixadm', mtime: ago(60), size: 44 * MB })
            }),
            messages: V.file(W.syslogStamp(ago(7200)) + ' ldn-fix-prod01 systemd: Started Session 8812.', { owner: 'root', size: 28 * MB })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-fixgw.txt': V.file(
              'FIX ORDER GATEWAY RUNBOOK\n' +
              '=========================\n' +
              'HOT/WARM PAIR: ldn-fix-prod01 (primary) / ldn-fix-prod02 (standby)\n' +
              '\n' +
              'NEVER restart the primary during market hours without draining first.\n' +
              'A cold restart rejects every in-flight order and forces clients to\n' +
              'resend - the desk has to reconcile by hand.\n' +
              '\n' +
              'CONTROLLED FAILOVER (about 3 seconds, no order loss):\n' +
              '    curl http://localhost:9975/admin/drain\n' +
              '      - stops accepting new orders, lets in-flight ones complete,\n' +
              '        and hands the sessions to the standby\n' +
              '    systemctl restart fixgw\n' +
              '\n' +
              'DIAGNOSTICS\n' +
              '    curl http://localhost:9975/admin/latency\n' +
              '    jstack <pid>            (thread dump)\n' +
              '    top -H -p <pid>         (per-thread CPU)\n' +
              '\n' +
              'NOTE: %CPU in top is per core. On this 16 core box a single thread\n' +
              'spinning shows as 100%, and the machine-wide figure barely moves - which\n' +
              'is why the capacity dashboard will tell you nothing is wrong.\n',
              { owner: 'gsupport' })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52 }) }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var spinStack = [
        'java.util.HashMap.getEntry(HashMap.java:471)',
        'java.util.HashMap.get(HashMap.java:421)',
        'com.ib.fixgw.session.SessionRegistry.lookup(SessionRegistry.java:88)',
        'com.ib.fixgw.route.OrderRouter.route(OrderRouter.java:214)',
        'com.ib.fixgw.route.OrderRouter.run(OrderRouter.java:142)',
        'java.lang.Thread.run(Thread.java:750)'
      ];

      var fixgw = W.proc({
        pid: 4820, ppid: 1, user: 'fixadm',
        cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -XX:+UseG1GC -Dapp=fixgw -jar /apps/fixgw/lib/fixgw.jar',
        short: 'java', state: 'R', cpu: 101.4, rss: 9 * GB,
        started: new Date(2026, 8, 11, 6, 4, 2), cpuSeconds: 5840, tty: '?',
        fds: [{ fd: 1, path: '/var/log/fixgw/fixgw-app.log', mode: 'w', size: 620 * MB }],
        jvm: {
          name: 'fixgw.jar', mainClass: 'com.ib.fixgw.Gateway',
          heapMax: 8 * GB, heapUsed: 2.1 * GB,
          args: '-Xms8g -Xmx8g -XX:+UseG1GC',
          stdoutLog: '/var/log/fixgw/fixgw-app.log',
          gcStats: { ygc: 4120, ygct: 38.442, fgc: 0, fgct: 0, old: 18.2, eden: 24.1, s1: 6.4 }
        },
        threads: [
          W.thread({ tid: 4830, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 3, stack: ['java.lang.Object.wait(Native Method)'] }),
          W.thread({ tid: 4901, name: 'order-router-1', state: 'RUNNABLE', cpu: 6.2, cpuSeconds: 412,
            stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)', 'com.ib.fixgw.route.OrderRouter.run(OrderRouter.java:142)'] }),
          W.thread({ tid: 4902, name: 'order-router-2', state: 'RUNNABLE', cpu: 5.8, cpuSeconds: 401,
            stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)', 'com.ib.fixgw.route.OrderRouter.run(OrderRouter.java:142)'] }),
          // The spinner. 0x1331 == 4913.
          W.thread({ tid: 4913, name: 'order-router-3', state: 'RUNNABLE', cpu: 99.6, cpuSeconds: 4920, stack: spinStack }),
          W.thread({ tid: 4914, name: 'order-router-4', state: 'RUNNABLE', cpu: 6.1, cpuSeconds: 408,
            stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)'] }),
          W.thread({ tid: 4960, name: 'session-reaper', state: 'TIMED_WAITING', cpu: 0, cpuSeconds: 18,
            stack: ['java.lang.Thread.sleep(Native Method)', 'com.ib.fixgw.session.SessionRegistry.reap(SessionRegistry.java:142)'] }),
          W.thread({ tid: 4971, name: 'admin-http-1', state: 'RUNNABLE', cpu: 0.2, cpuSeconds: 8, stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)'] })
        ]
      });

      return W.create({
        host: 'ldn-fix-prod01', user: 'gsupport', clock: t0, seed: 4913,
        bootSeconds: 3600 * 24 * 22, cores: 16, users: 3,
        load: [1.94, 1.88, 1.72],
        mem: { total: 64 * GB, free: 46 * GB, buffers: 180 * MB, cached: 5 * GB },
        swap: { total: 8 * GB, used: 0 },
        // One core of sixteen == ~6% of the machine. The dashboard sees nothing.
        cpu: { us: 6.4, sy: 0.9, ni: 0, id: 92.6, wa: 0.1, st: 0 },
        root: root,
        limits: { nofile: 65536, nproc: 8192 },

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 11 * GB, inodes: { total: 26214400, used: 204118 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 41 * GB, inodes: { total: 104857600, used: 60412 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 100 * GB, used: 14 * GB, inodes: { total: 52428800, used: 22104 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.6 * GB, inodes: { total: 10485760, used: 1840 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 280 }),
          W.proc({ pid: 1288, cmd: '/usr/sbin/rsyslogd -n', short: 'rsyslogd', rss: 40 * MB, cpu: 0.2, cpuSeconds: 640 }),
          W.proc({ pid: 1622, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 30 }),
          fixgw,
          W.proc({ pid: 16044, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 4820, fd: 11, proto: 'tcp', local: '0.0.0.0:9310', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 4820, fd: 12, proto: 'tcp', local: '0.0.0.0:9975', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 4820, fd: 31, proto: 'tcp', local: '10.14.22.60:9310', peer: '10.14.30.71:44120', state: 'ESTABLISHED', recvq: 41208, sendq: 0 },
          { pid: 4820, fd: 32, proto: 'tcp', local: '10.14.22.60:9310', peer: '10.14.30.72:44121', state: 'ESTABLISHED', recvq: 38840, sendq: 0 },
          { pid: 1622, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [{ dev: 'dm-2', rs: 4.2, ws: 88.1, readKB: 62.4, writeKB: 1204.2, await: 0.8, util: 4.1, queue: 0.04 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.60/24', mac: '00:50:56:9a:41:60', rxOk: 1204881200, txOk: 1188120044, rxBytes: 412004881200, txBytes: 388120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 41208, txOk: 41208, mtu: 65536 }
        ],
        dmesg: [],

        hosts: {
          localhost: { ip: '127.0.0.1', ports: [9310, 9975, 22], rtt: 0.02 },
          'ldn-fix-prod02': { ip: '10.14.22.59', ports: [9310, 9975], rtt: 0.18 }
        },

        http: {
          'localhost:9975/admin/latency': function (world) {
            return JSON.stringify({
              ackLatencyMs: { p50: world.flags.fixed ? 0.7 : 48.2, p99: world.flags.fixed ? 1.9 : 128.4 },
              routerThreads: [
                { name: 'order-router-1', queueDepth: 2, state: 'RUNNABLE' },
                { name: 'order-router-2', queueDepth: 3, state: 'RUNNABLE' },
                { name: 'order-router-3', queueDepth: world.flags.fixed ? 1 : 18402, state: 'RUNNABLE' },
                { name: 'order-router-4', queueDepth: 2, state: 'RUNNABLE' }
              ]
            }, null, 2);
          },
          'localhost:9975/admin/drain': function (world) {
            world.flags.drained = true;
            return JSON.stringify({
              status: 'ok',
              action: 'stopped accepting new orders; 214 in-flight orders completed; 38 sessions handed to ldn-fix-prod02',
              safeToRestart: true
            }, null, 2);
          }
        },

        services: {
          fixgw: {
            active: true, pid: 4820, exe: 'java', desc: 'FIX Order Gateway (primary)',
            since: new Date(2026, 8, 11, 6, 4, 2), tasks: 88, requiresRoot: false,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -jar /apps/fixgw/lib/fixgw.jar',
            log: ['Latency - ack p50=48.2ms p99=128.4ms']
          },
          sshd: { active: true, pid: 1622, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { fixed: false, drained: false, killedRaw: false },

        onService: function (world, verb, unit) {
          if (unit !== 'fixgw' && unit !== 'fixgw.service') return false;
          if (verb === 'restart' || verb === 'stop') {
            W.killProc(world, 4820);
            world.flags.fixed = true;
            world.cpu = { us: 1.1, sy: 0.4, ni: 0, id: 98.4, wa: 0.1, st: 0 };
            world.load = [0.4, 1.2, 1.5];
            if (verb === 'restart') {
              world.procs.push(W.proc({
                pid: 19902, user: 'fixadm', short: 'java',
                cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -XX:+UseG1GC -Dapp=fixgw -jar /apps/fixgw/lib/fixgw.jar',
                cpu: 8.2, rss: 3 * GB, started: new Date(world.clock.getTime()),
                jvm: { name: 'fixgw.jar', mainClass: 'com.ib.fixgw.Gateway', heapMax: 8 * GB, heapUsed: 900 * MB,
                  gcStats: { ygc: 4, ygct: 0.062, fgc: 0, fgct: 0, old: 2.1, eden: 8.4 } }
              }));
              world.services.fixgw.pid = 19902;
              world.services.fixgw.since = new Date(world.clock.getTime());
              world.cpu = { us: 3.4, sy: 0.8, ni: 0, id: 95.7, wa: 0.1, st: 0 };
            }
            return true;
          }
          return false;
        },

        onKill: function (world, proc) {
          if (proc.pid === 4820) {
            world.flags.fixed = true;
            world.flags.killedRaw = true;
            world.cpu = { us: 1.1, sy: 0.4, ni: 0, id: 98.4, wa: 0.1, st: 0 };
          }
        },

        tick: function (world, seconds) {
          if (world.flags.fixed) return;
          world.sockets.forEach(function (s) {
            if (s.recvq) s.recvq += Math.round(180 * seconds);
          });
        }
      });
    },

    discoveries: [
      { id: 'one-core', label: 'One thread is at ~100% - which is one core of sixteen', when: function (o) { return /\btop\b|\bps\b/.test(o.cmd) && /(99|10[0-9])\.\d/.test(PS.world.stripColor(o.out)); } },
      { id: 'thread-level', label: 'Isolated the hot thread with top -H', when: function (o) { return /top\b.*-H|ps\b.*-L|-eLf/.test(o.cmd) && /4913/.test(PS.world.stripColor(o.out)); } },
      { id: 'not-gc', label: 'Ruled out GC: heap is healthy and there are no Full GCs', when: function (o) { return /\bjstat\b/.test(o.cmd) && /\b0\b/.test(PS.world.stripColor(o.out)); }, optional: true },
      { id: 'hex-tid', label: 'Converted TID 4913 to hex (0x1331) to match nid in the dump', when: function (o) { return /1331/i.test(PS.world.stripColor(o.out) + o.cmd); } },
      { id: 'spin-stack', label: 'order-router-3 is spinning in HashMap.getEntry', when: function (o) { return /HashMap\.getEntry/.test(o.out); } },
      { id: 'unsafe-map', label: 'The session registry is a plain HashMap mutated by the reaper thread', when: function (o) { return /session\.registry\.impl|not synchronized/.test(o.out); } },
      { id: 'backpressure', label: 'Order sockets are backing up behind the stuck router', when: function (o) { return /\b(ss|netstat)\b/.test(o.cmd) && /4120[0-9]|3884[0-9]/.test(PS.world.stripColor(o.out)); }, optional: true }
    ],

    rootCauses: [
      { text: 'The box is out of CPU capacity and needs more cores.' },
      { text: 'Garbage collection pauses are causing the latency.' },
      { text: 'A non-thread-safe HashMap used as the session registry was structurally modified by the reaper thread while a router thread was reading it, leaving that thread spinning forever inside HashMap.getEntry and taking one router out of service.', correct: true },
      { text: 'Network congestion between the gateway and the clients.' },
      { text: 'A deadlock between the router threads and the session reaper.' },
      { text: 'The disk is too slow, so order journalling is blocking the routers.' }
    ],

    fix: {
      prompt: 'Restore normal ack latency. This is a hot/warm pair in market hours - do it without dumping in-flight orders.',
      check: function (world) { return world.flags.fixed === true; },
      grade: function (world) {
        if (world.flags.killedRaw) {
          return { quality: 'blunt', bonus: -140,
            note: 'kill -9 stopped the spin, but every in-flight order died with it and the\n' +
              'desk is now reconciling by hand. The runbook drain would have moved the\n' +
              'sessions to ldn-fix-prod02 cleanly first.' };
        }
        if (!world.flags.drained) {
          return { quality: 'blunt', bonus: 0,
            note: 'The restart cleared the spinning thread and latency is back to normal, but\n' +
              'you restarted the primary cold in market hours: in-flight orders were\n' +
              'rejected and clients had to resend. curl http://localhost:9975/admin/drain\n' +
              'first would have cost you three seconds and no orders.' };
        }
        return { quality: 'clean', bonus: 300,
          note: 'You drained to the standby, then restarted. No orders lost, latency back to\n' +
            'p50 0.7ms, and you have a thread dump showing exactly which line to fix.' };
      }
    },

    hints: [
      'The machine-wide figure is a trap. On a 16 core box, one thread spinning flat out is 100% of a core but only ~6% of the machine. Look at the process, then at its threads.',
      'top -H -p 4820 shows CPU per thread. The hot one is a TID. jstack reports threads by nid in hexadecimal.',
      'Convert it: printf "%x\\n" 4913 gives 1331. Then: jstack 4820 | grep -A 20 0x1331',
      'You cannot kill a single Java thread - the process has to be recycled. Read /home/gsupport/runbook-fixgw.txt: drain to the standby first, then restart.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'SessionRegistry is a plain java.util.HashMap. The session-reaper thread\n' +
      'removed expired entries while order-router-3 was doing a lookup. HashMap is\n' +
      'not thread safe: a concurrent structural modification during a resize can\n' +
      'leave the bucket chain pointing at itself, and a subsequent get() walks that\n' +
      'loop forever. The thread never returns, never throws, and never logs - it\n' +
      'just burns a core. One of four routers was gone, so throughput dropped and\n' +
      'latency climbed as work queued behind it.\n\n' +
      'THE SEQUENCE TO MEMORISE\n' +
      '  top                         find the process\n' +
      '  top -H -p <pid>             find the thread (TID) burning CPU\n' +
      '  printf "%x\\n" <tid>         convert TID to hex\n' +
      '  jstack <pid> | grep -A 20 0x<hex>    find that exact thread in the dump\n' +
      'This works for any JVM, any application, any vendor. It is asked in almost\n' +
      'every Java production support interview.\n\n' +
      'READING %CPU CORRECTLY\n' +
      'top reports percentage of ONE core per process/thread by default. 100% is one\n' +
      'core saturated; 1600% would be the whole 16 core box. A dashboard averaging\n' +
      'across cores will show 6% and tell you everything is fine. It is not.\n\n' +
      'THE REAL FIX\n' +
      'Operationally: drain and recycle. Permanently: ConcurrentHashMap, or a\n' +
      'properly synchronised registry. Note that this is a data structure defect,\n' +
      'not a capacity problem - adding cores would have changed nothing.'
  });
})(PS);
