/* Scenario: overnight risk engine is wedged in back-to-back Full GCs.
 *
 * The lesson is telling a leak apart from an undersized heap. Both look like
 * "high memory". Only one of them still has 98% of old gen occupied straight
 * after a Full GC.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'jvm-memory-leak',
    title: 'Risk engine not responding, VaR batch stalled',
    severity: 'P1',
    desk: 'Market Risk / Overnight VaR',
    host: 'ldn-risk-prod04',
    tags: ['memory', 'JVM', 'GC', 'OOM killer', 'heap dump'],
    par: 420,
    impactPerMin: 18000,
    currency: 'GBP',

    brief:
      'PAGER 04:12 - from Overnight Ops\n\n' +
      '"RISKCALC has not produced a VaR file since 02:58. The process is still\n' +
      'there but it is not responding on the admin port and the batch is stuck\n' +
      'waiting for it. Regional risk reports go out at 06:30."\n\n' +
      'Ops have already tried the health check twice - it times out. They want to\n' +
      'know whether to restart it or whether that will just lose four hours of\n' +
      'calculation. The box has 128G of RAM and "plenty free", so they do not\n' +
      'think it is a memory problem.',

    build: function () {
      var t0 = new Date(2026, 8, 12, 4, 12, 40);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var gcLines = [];
      // healthy early evening
      for (var i = 0; i < 4; i++) {
        gcLines.push('[' + W.isoStamp(ago(18000 - i * 900), true) +
          '] [GC pause (G1 Evacuation Pause) (young) ' + (12000 + i * 400) + 'M->' + (3100 + i * 900) +
          'M(' + (96 * 1024) + 'M), 0.0621 secs]');
      }
      // old gen climbing, Full GCs start, and reclaim almost nothing
      for (var k = 0; k < 10; k++) {
        var before = 97800 + k * 40;
        var after = 96100 + k * 60;
        gcLines.push('[' + W.isoStamp(ago(4200 - k * 400), true) +
          '] [Full GC (Allocation Failure) ' + before + 'M->' + after + 'M(98304M), ' +
          (12.4 + k * 0.9).toFixed(4) + ' secs]');
      }
      for (var m = 0; m < 6; m++) {
        gcLines.push('[' + W.isoStamp(ago(300 - m * 48), true) +
          '] [Full GC (Allocation Failure) 98180M->98102M(98304M), ' + (21.8 + m * 0.4).toFixed(4) + ' secs]');
      }

      var appLog = [
        W.isoStamp(ago(21600)) + ' INFO  [main] RiskEngine - started, 41 books loaded',
        W.isoStamp(ago(18000)) + ' INFO  [calc-pool-3] VarCalculator - completed book EQD_LDN in 184s',
        W.isoStamp(ago(14400)) + ' INFO  [calc-pool-1] VarCalculator - completed book RATES_LDN in 211s',
        W.isoStamp(ago(9000)) + ' INFO  [calc-pool-2] ScenarioCache - cache size 8,412,004 entries',
        W.isoStamp(ago(6000)) + ' WARN  [calc-pool-2] ScenarioCache - cache size 19,884,120 entries',
        W.isoStamp(ago(4700)) + ' INFO  [calc-pool-4] VarCalculator - completed book CREDIT_LDN in 1841s',
        W.isoStamp(ago(4400)) + ' WARN  [calc-pool-2] ScenarioCache - cache size 34,120,884 entries',
        W.isoStamp(ago(4100)) + ' WARN  [gc-monitor] GcMonitor - Full GC took 12408ms, reclaimed 1.6% of old gen',
        W.isoStamp(ago(3200)) + ' WARN  [gc-monitor] GcMonitor - Full GC took 17204ms, reclaimed 0.9% of old gen',
        W.isoStamp(ago(1800)) + ' WARN  [gc-monitor] GcMonitor - Full GC took 21102ms, reclaimed 0.1% of old gen',
        W.isoStamp(ago(900)) + ' ERROR [admin-http-1] HealthServlet - request timed out after 30000ms'
      ].join('\n');

      var root = V.dir({
        apps: V.dir({
          riskcalc: V.dir({
            lib: V.dir({ 'riskcalc.jar': V.file('', { size: 118 * MB, owner: 'riskadm' }) }),
            conf: V.dir({
              'riskcalc.properties': V.file(
                'heap.max=96g\n' +
                'calc.threads=8\n' +
                'scenario.cache.enabled=true\n' +
                'scenario.cache.max.entries=            # unset - unbounded\n' +
                'scenario.cache.ttl.seconds=            # unset - never evicts\n' +
                'var.output.dir=/var/lib/riskcalc/out\n', { owner: 'riskadm' })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            riskcalc: V.dir({
              'riskcalc-app.log': V.file(appLog, { owner: 'riskadm', mtime: ago(900), size: 880 * MB }),
              'riskcalc-gc.log': V.file(gcLines.join('\n'), { owner: 'riskadm', mtime: ago(48), size: 142 * MB })
            }),
            messages: V.file(
              W.syslogStamp(ago(2400)) + ' ldn-risk-prod04 kernel: mdreplay invoked oom-killer: gfp_mask=0x201da, order=0, oom_score_adj=0\n' +
              W.syslogStamp(ago(2400)) + ' ldn-risk-prod04 kernel: Out of memory: Kill process 22104 (mdreplay) score 41 or sacrifice child\n' +
              W.syslogStamp(ago(2400)) + ' ldn-risk-prod04 kernel: Killed process 22104 (mdreplay) total-vm:8412004kB, anon-rss:4120884kB',
              { owner: 'root', size: 62 * MB })
          }),
          lib: V.dir({ riskcalc: V.dir({ out: V.dir({
            'var_20260911.csv': V.file('', { size: 412 * MB, owner: 'riskadm', mtime: ago(90000) })
          }) }) })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-riskcalc.txt': V.file(
              'RISKCALC RUNBOOK\n' +
              '================\n' +
              '* Heap is 96g. Box has 128g.\n' +
              '* A restart loses all in-flight book calculations; completed books are\n' +
              '  already written to /var/lib/riskcalc/out and are NOT recalculated.\n' +
              '* BEFORE any restart of a wedged JVM, capture a heap dump:\n' +
              '      jmap -dump:live,format=b,file=/var/tmp/riskcalc.hprof <pid>\n' +
              '  Dev cannot diagnose a leak without it, and the JVM is thrown away on\n' +
              '  restart. The dump takes ~60s and needs ~96g of free space.\n' +
              '* Then: systemctl restart riskcalc\n' +
              '* Known issue RISK-1188: ScenarioCache has no max size and no TTL.\n',
              { owner: 'gsupport' })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52 }) }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var risk = W.proc({
        pid: 11204, ppid: 1, user: 'riskadm',
        cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms96g -Xmx96g -XX:+UseG1GC -XX:+HeapDumpOnOutOfMemoryError -jar /apps/riskcalc/lib/riskcalc.jar',
        short: 'java', state: 'R', cpu: 788.0, rss: 104 * GB,
        started: new Date(2026, 8, 11, 22, 12, 4), cpuSeconds: 48120, tty: '?',
        fds: [{ fd: 1, path: '/var/log/riskcalc/riskcalc-app.log', mode: 'w', size: 880 * MB }],
        jvm: {
          name: 'riskcalc.jar', mainClass: 'com.ib.risk.Engine',
          heapMax: 96 * GB, heapUsed: 95.6 * GB, leak: true,
          args: '-Xms96g -Xmx96g -XX:+UseG1GC -XX:+HeapDumpOnOutOfMemoryError',
          stdoutLog: '/var/log/riskcalc/riskcalc-app.log',
          young: { max: 8 * GB, used: 7.9 * GB },
          old: { max: 88 * GB, used: 87.7 * GB },
          gcStats: { ygc: 41208, ygct: 2814.402, fgc: 412, fgct: 6120.881, fgcRate: 2, old: 99.71, oldRate: 0.01, eden: 98.4, s0: 0, s1: 0, meta: 97.2 },
          histo: [
            { instances: 412008841, bytes: 42120088412, cls: 'com.ib.risk.scenario.ScenarioKey' },
            { instances: 412008841, bytes: 39408812004, cls: '[D' },
            { instances: 98412004, bytes: 4720576192, cls: 'java.util.concurrent.ConcurrentHashMap$Node' },
            { instances: 41200884, bytes: 1977642432, cls: 'java.lang.String' },
            { instances: 8412004, bytes: 403776192, cls: 'com.ib.risk.book.Position' },
            { instances: 412004, bytes: 19776192, cls: '[C' }
          ]
        },
        threads: [
          W.thread({ tid: 11210, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 4, stack: ['java.lang.Object.wait(Native Method)'] }),
          W.thread({ tid: 11244, name: 'G1 Young RemSet Sampling', state: 'RUNNABLE', cpu: 99.2, cpuSeconds: 8412, stack: ['java.lang.Thread.run(Thread.java:750)'] }),
          W.thread({ tid: 11245, name: 'GC Thread#0', state: 'RUNNABLE', cpu: 98.8, cpuSeconds: 8120, stack: ['(native GC thread)'] }),
          W.thread({ tid: 11246, name: 'GC Thread#1', state: 'RUNNABLE', cpu: 98.4, cpuSeconds: 8104, stack: ['(native GC thread)'] }),
          W.thread({ tid: 11247, name: 'GC Thread#2', state: 'RUNNABLE', cpu: 98.1, cpuSeconds: 8088, stack: ['(native GC thread)'] }),
          W.thread({ tid: 11302, name: 'calc-pool-2', state: 'RUNNABLE', cpu: 12.4, cpuSeconds: 14204,
            stack: ['com.ib.risk.scenario.ScenarioCache.put(ScenarioCache.java:142)',
              'com.ib.risk.calc.VarCalculator.runScenario(VarCalculator.java:388)'] }),
          W.thread({ tid: 11380, name: 'admin-http-1', state: 'RUNNABLE', cpu: 0, cpuSeconds: 2,
            stack: ['com.ib.risk.admin.HealthServlet.doGet(HealthServlet.java:44)'] })
        ]
      });

      return W.create({
        host: 'ldn-risk-prod04', user: 'gsupport', clock: t0, seed: 41208,
        bootSeconds: 3600 * 24 * 88, cores: 32, users: 2,
        load: [28.4, 26.1, 19.8],
        mem: { total: 128 * GB, free: 9 * GB, buffers: 120 * MB, cached: 2 * GB, shared: 90 * MB },
        swap: { total: 16 * GB, used: 14.2 * GB, si: 4120, so: 8840 },
        cpu: { us: 88.2, sy: 6.4, ni: 0, id: 2.1, wa: 3.3, st: 0 },
        root: root,
        limits: { nofile: 65536, nproc: 16384 },
        notes: { memTrend: 40 * GB },

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB, inodes: { total: 26214400, used: 288104 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 400 * GB, used: 92 * GB, inodes: { total: 209715200, used: 88120 } },
          { dev: '/dev/mapper/vg00-vartmp', mount: '/var/tmp', type: 'xfs', size: 200 * GB, used: 4 * GB, inodes: { total: 104857600, used: 112 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 100 * GB, used: 18 * GB, inodes: { total: 52428800, used: 41204 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.8 * GB, inodes: { total: 10485760, used: 2104 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 12 * MB, cpu: 0, cpuSeconds: 620 }),
          W.proc({ pid: 1301, cmd: '/usr/sbin/rsyslogd -n', short: 'rsyslogd', rss: 38 * MB, cpu: 0.1, cpuSeconds: 980 }),
          W.proc({ pid: 1640, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 40 }),
          risk,
          W.proc({ pid: 18820, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 11204, fd: 18, proto: 'tcp', local: '0.0.0.0:8780', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 11204, fd: 24, proto: 'tcp', local: '10.14.22.64:44120', peer: '10.14.40.21:1521', state: 'ESTABLISHED', recvq: 0, sendq: 0 },
          { pid: 1640, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [
          { dev: 'dm-1', rs: 1840.2, ws: 2104.8, readKB: 88120.4, writeKB: 104882.1, await: 41.2, util: 94.8, queue: 18.4 },
          { dev: 'sda', rs: 12.1, ws: 88.4, readKB: 402.1, writeKB: 1204.8, await: 1.2, util: 8.4, queue: 0.12 }
        ],

        interfaces: [
          { name: 'eth0', addr: '10.14.22.64/24', mac: '00:50:56:9a:41:64', rxOk: 88120044, txOk: 41200884, rxBytes: 88120044120, txBytes: 41200884120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 12004, txOk: 12004, mtu: 65536 }
        ],

        dmesg: [
          { time: ago(2400), text: 'mdreplay invoked oom-killer: gfp_mask=0x201da, order=0, oom_score_adj=0' },
          { time: ago(2400), text: 'Out of memory: Kill process 22104 (mdreplay) score 41 or sacrifice child' },
          { time: ago(2400), text: 'Killed process 22104 (mdreplay) total-vm:8412004kB, anon-rss:4120884kB' },
          { time: ago(600), text: 'java: page allocation stalls for 10412ms, order:0' }
        ],

        hosts: { localhost: { ip: '127.0.0.1', ports: [22], rtt: 0.02 } },
        http: {
          'localhost:8780/admin/health': function () {
            return 'curl: (28) Operation timed out after 30001 milliseconds with 0 bytes received';
          }
        },

        services: {
          riskcalc: {
            active: true, pid: 11204, exe: 'java', desc: 'Overnight Risk Engine (VaR)',
            since: new Date(2026, 8, 11, 22, 12, 4), tasks: 96, requiresRoot: false,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms96g -Xmx96g -jar /apps/riskcalc/lib/riskcalc.jar',
            log: ['GcMonitor - Full GC took 21102ms, reclaimed 0.1% of old gen']
          },
          sshd: { active: true, pid: 1640, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { heapDumped: false, fixed: false },

        onService: function (world, verb, unit) {
          if (unit !== 'riskcalc' && unit !== 'riskcalc.service') return false;
          if (verb === 'restart' || verb === 'stop') {
            W.killProc(world, 11204);
            world.flags.fixed = true;
            world.mem.free = 112 * GB;
            world.swap.used = 0.2 * GB;
            world.cpu = { us: 4.1, sy: 1.0, ni: 0, id: 94.8, wa: 0.1, st: 0 };
            world.load = [1.2, 8.4, 14.2];
            if (verb === 'restart') {
              world.procs.push(W.proc({
                pid: 24118, user: 'riskadm', short: 'java',
                cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms96g -Xmx96g -XX:+UseG1GC -jar /apps/riskcalc/lib/riskcalc.jar',
                cpu: 42.1, rss: 12 * GB, started: new Date(world.clock.getTime()),
                jvm: { name: 'riskcalc.jar', mainClass: 'com.ib.risk.Engine', heapMax: 96 * GB, heapUsed: 4 * GB,
                  gcStats: { ygc: 12, ygct: 0.884, fgc: 0, fgct: 0, old: 3.1, eden: 22.4 } }
              }));
              world.services.riskcalc.pid = 24118;
              world.services.riskcalc.since = new Date(world.clock.getTime());
              W.appendLog(world, '/var/log/riskcalc/riskcalc-app.log',
                W.isoStamp(world.clock) + ' INFO  [main] RiskEngine - started, resuming from 12 completed books');
            }
            return true;
          }
          return false;
        },

        onKill: function (world, proc) {
          if (proc.pid === 11204) {
            world.flags.fixed = true;
            world.flags.killedRaw = true;
            world.mem.free = 112 * GB;
            world.swap.used = 0.2 * GB;
            world.cpu = { us: 2.1, sy: 0.8, ni: 0, id: 96.9, wa: 0.2, st: 0 };
          }
        },

        tick: function (world, seconds) {
          if (world.flags.fixed) return;
          var p = W.findProc(world, 11204);
          if (!p) return;
          p.jvm.gcStats.fgc += Math.round(seconds / 22 * 1);
          p.jvm.gcStats.fgct += seconds * 0.92;
        }
      });
    },

    discoveries: [
      { id: 'gc-thrash', label: 'Back-to-back Full GCs reclaiming almost nothing', when: function (o) { return /Full GC/.test(o.out) && /9[0-9]{4}M->9[0-9]{4}M|reclaimed 0\.|reclaimed 1\./.test(o.out); } },
      { id: 'old-gen-full', label: 'Old generation is ~99% occupied after collection', when: function (o) { return /\bjstat\b|\bjmap\b/.test(o.cmd) && /99\.|9[5-9]% used/.test(PS.world.stripColor(o.out)); } },
      { id: 'cpu-gc', label: 'CPU is burning in GC threads, not application threads', when: function (o) { return /-H/.test(o.cmd) && /GC Thread/.test(o.out); } },
      { id: 'swapping', label: 'Box is swapping - RSS exceeds what the machine can hold', when: function (o) { return /\b(free|vmstat|top)\b/.test(o.cmd) && /1[34]\.?\d*G|14\d{6}/.test(PS.world.stripColor(o.out)); }, optional: true },
      { id: 'oom-victim', label: 'The OOM killer already sacrificed mdreplay on this box', when: function (o) { return /oom-killer|Killed process/i.test(o.out); } },
      { id: 'leak-class', label: 'Heap histogram points at ScenarioCache holding 412M ScenarioKey objects', when: function (o) { return /ScenarioKey/.test(o.out); } },
      { id: 'unbounded-cache', label: 'ScenarioCache is configured with no max size and no TTL', when: function (o) { return /scenario\.cache\.max\.entries|RISK-1188/.test(o.out); } },
      { id: 'heap-dump', label: 'Captured a heap dump before restarting', when: function (o) { return /jmap\b.*-dump/.test(o.cmd) && /Heap dump file created/.test(o.out); } }
    ],

    rootCauses: [
      { text: 'The heap is simply too small for tonight\'s book volume; it needs more than 96g.' },
      { text: 'Another process on the box consumed the memory and starved the JVM.' },
      { text: 'An unbounded in-memory cache (ScenarioCache, no max size and no TTL) is retaining objects for the whole run, so old gen fills and Full GCs cannot reclaim it.', correct: true },
      { text: 'G1GC is misconfigured; switching to CMS or ParallelGC would resolve it.' },
      { text: 'A native (off-heap) memory leak in the JDBC driver.' },
      { text: 'The OOM killer terminated a thread inside the JVM, leaving it wedged.' }
    ],

    fix: {
      prompt: 'Get the VaR batch moving again - but do not throw away what dev needs to fix the leak.',
      check: function (world) { return world.flags.fixed === true; },
      grade: function (world) {
        if (world.flags.killedRaw && !world.flags.heapDumped) {
          return { quality: 'blunt', bonus: -120,
            note: 'kill -9 ended the GC death spiral, but with no heap dump the leak is\n' +
              'unreproducible and dev will hand it straight back. The runbook asks for\n' +
              'jmap -dump:live,format=b,file=/var/tmp/riskcalc.hprof 11204 first.' };
        }
        if (!world.flags.heapDumped) {
          return { quality: 'blunt', bonus: 0,
            note: 'The restart cleared it and the batch will finish. But you threw away the\n' +
              'only copy of the evidence: once that JVM died, so did the leak. Tomorrow\n' +
              'night it happens again and you still cannot say why. Take the heap dump\n' +
              'first - it costs 60 seconds.' };
        }
        return { quality: 'clean', bonus: 280,
          note: 'Heap dump captured to /var/tmp/riskcalc.hprof, then a clean restart. The\n' +
            'batch resumes from the 12 books already written, dev gets the evidence,\n' +
            'and the histogram already tells them where to look: ScenarioKey retained\n' +
            'by an unbounded ScenarioCache.' };
      }
    },

    hints: [
      '"Plenty of free RAM" and "out of heap" are different problems. The JVM cannot use free system memory beyond -Xmx. Look at the heap, not at free.',
      'A leak and a too-small heap look identical until you check what a Full GC actually reclaims. jstat -gcutil 11204 1000 5, and read the O column. Then read /var/log/riskcalc/riskcalc-gc.log.',
      'jmap -histo 11204 ranks the heap by class. One class with hundreds of millions of instances is your leak - then find what retains it.',
      'Before you restart, the runbook is explicit: jmap -dump:live,format=b,file=/var/tmp/riskcalc.hprof 11204. Then systemctl restart riskcalc.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'ScenarioCache has no maximum size and no TTL, so every scenario computed\n' +
      'during the run stayed reachable. Old gen filled, G1 fell back to Full GCs,\n' +
      'and each one reclaimed under 2% because the objects were still referenced.\n' +
      'The JVM then spent ~95% of its CPU collecting garbage that was not garbage.\n' +
      'The process never died, so nothing alerted on "process down" - it just\n' +
      'stopped making progress.\n\n' +
      'LEAK OR JUST TOO SMALL? THE TEST\n' +
      '  Too small : Full GC drops old gen a long way, then it refills. Raising -Xmx\n' +
      '              buys real headroom.\n' +
      '  Leak      : Full GC barely moves old gen. Raising -Xmx only delays the wall.\n' +
      '  Commands  : jstat -gcutil <pid> 1000 5     (watch O and FGC)\n' +
      '              grep "Full GC" gc.log          (before->after tells you everything)\n' +
      '              jmap -histo <pid> | head -20   (which class, and how many)\n\n' +
      'THE OOM KILLER IS A SEPARATE SIGNAL\n' +
      'dmesg showed the kernel killing mdreplay. That is the kernel protecting the\n' +
      'box because the JVM RSS plus swap exhausted the machine - it is a consequence\n' +
      'here, not the cause. Knowing the difference between a Java OutOfMemoryError\n' +
      'and a kernel OOM kill is a standard interview probe.\n\n' +
      'ALWAYS DUMP BEFORE YOU BOUNCE\n' +
      'Restarting a leaking JVM destroys the only evidence of the leak. Two minutes\n' +
      'of heap dump saves a week of "we could not reproduce it".'
  });
})(PS);
