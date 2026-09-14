/* TEMPLATE - copy to js/scenarios/<your-incident>.js and add a <script> tag to
 * index.html (after js/world.js, before js/terminal.js).
 *
 * Read docs/ADDING-SCENARIOS.md alongside this. The short version: describe a
 * broken machine, not broken command output. Every command renders a view over
 * the object you return from build().
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'my-incident',                       // unique; used for saved scores
    title: 'Short headline the desk would use',
    severity: 'P1',                          // P1 or P2
    desk: 'Which desk / function',
    host: 'ldn-app-prod99',
    tags: ['disk', 'jvm'],                   // shown on the incident card
    par: 400,                                // target seconds; over par costs points
    impactPerMin: 25000,
    currency: 'GBP',                         // GBP or USD

    // Optional. One or two sentences naming the GOAL, shown in the login banner
    // and by the `objective` verb. It must not give the cause away - fix.prompt
    // is deliberately not reused here, because recovery instructions usually do.
    // Omit it and players get a generic 'prove it, then recover' line.
    objective: 'What good looks like, plus the constraint that rules out the blunt fix.',

    brief:
      'PAGER 09:14 - from whoever raised it\n\n' +
      '"What they said, in their words. Include the detail that is wrong or\n' +
      'misleading - real pages usually contain one."\n\n' +
      'Any constraint that decides which fix is correct: a cutoff time, a\n' +
      'warm standby, a requirement to preserve evidence.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 9, 14, 0);          // month is 0-based
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var appLog = [
        W.isoStamp(ago(600)) + ' INFO  [worker-1] Thing - normal line',
        W.isoStamp(ago(300)) + ' WARN  [worker-1] Thing - the first sign',
        W.isoStamp(ago(60)) + ' ERROR [worker-1] Thing - the symptom'
      ].join('\n');

      var root = V.dir({
        apps: V.dir({
          myapp: V.dir({
            conf: V.dir({
              'myapp.properties': V.file('some.setting=0   # the latent defect\n',
                { owner: 'appadm' })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            myapp: V.dir({
              'myapp-app.log': V.file(appLog, { owner: 'appadm', mtime: ago(60), size: 800 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-myapp.txt': V.file(
              'MYAPP RUNBOOK\n' +
              '=============\n' +
              'Put the clean remediation here. Rewarding players for reading the\n' +
              'runbook is the single best thing a scenario can teach.\n',
              { owner: 'gsupport' })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52 }) }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var app = W.proc({
        pid: 7000, ppid: 1, user: 'appadm',
        cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx8g -jar /apps/myapp/lib/myapp.jar',
        short: 'java', state: 'S', cpu: 4.0, rss: 9 * GB,
        started: ago(7200), cpuSeconds: 900,
        fds: [{ fd: 1, path: '/var/log/myapp/myapp-app.log', mode: 'w', size: 800 * MB }],
        jvm: {
          name: 'myapp.jar', mainClass: 'com.ib.myapp.Main',
          heapMax: 8 * GB, heapUsed: 2 * GB,
          stdoutLog: '/var/log/myapp/myapp-app.log',
          gcStats: { ygc: 400, ygct: 4.1, fgc: 0, fgct: 0, old: 18.0, eden: 22.0 }
        },
        threads: [
          W.thread({ tid: 7010, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 2,
            stack: ['java.lang.Object.wait(Native Method)'] }),
          W.thread({ tid: 7011, name: 'worker-1', state: 'RUNNABLE', cpu: 3.4, cpuSeconds: 800,
            stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)'] })
        ]
      });

      var world = W.create({
        host: 'ldn-app-prod99', user: 'gsupport', clock: t0, seed: 1234,
        bootSeconds: 3600 * 24 * 30, cores: 16, users: 3,
        load: [1.2, 1.1, 1.0],
        mem: { total: 64 * GB, free: 40 * GB, buffers: 200 * MB, cached: 5 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 5.0, sy: 1.0, ni: 0, id: 93.8, wa: 0.2, st: 0 },
        root: root,
        limits: { nofile: 65536, nproc: 8192 },

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB,
            inodes: { total: 26214400, used: 200000 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 40 * GB,
            inodes: { total: 104857600, used: 50000 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 1 * GB,
            inodes: { total: 10485760, used: 2000 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 300 }),
          W.proc({ pid: 1600, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 20 }),
          app,
          W.proc({ pid: 9000, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 7000, fd: 11, proto: 'tcp', local: '0.0.0.0:9000', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1600, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [{ dev: 'dm-2', rs: 4.0, ws: 80.0, readKB: 60.0, writeKB: 1200.0, await: 0.8, util: 4.0 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.99/24', rxOk: 100000000, txOk: 90000000, rxBytes: 1e11, txBytes: 9e10 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 10000, txOk: 10000, mtu: 65536 }
        ],
        dmesg: [],

        hosts: { localhost: { ip: '127.0.0.1', ports: [9000, 22], rtt: 0.02 } },

        http: {
          'localhost:9000/admin/health': function (world) {
            return JSON.stringify({ status: world.flags.fixed ? 'UP' : 'DEGRADED' }, null, 2);
          },
          // An admin endpoint that IS the clean remediation.
          'localhost:9000/admin/recover': function (world) {
            world.flags.fixed = true;
            return JSON.stringify({ status: 'ok' }, null, 2);
          }
        },

        services: {
          myapp: { active: true, pid: 7000, exe: 'java', desc: 'My Application',
            since: ago(7200), requiresRoot: false,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx8g -jar /apps/myapp/lib/myapp.jar' },
          sshd: { active: true, pid: 1600, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { fixed: false, restarted: false },

        onService: function (world, verb, unit) {
          if (unit !== 'myapp' && unit !== 'myapp.service') return false;
          if (verb === 'restart') {
            world.flags.restarted = true;
            world.flags.fixed = true;       // the crude fix works, and is graded lower
            return true;
          }
          return false;
        },

        onKill: function (world, proc) {
          if (proc.pid === 7000) { world.flags.fixed = true; world.flags.killed = true; }
        },

        tick: function (world, seconds) {
          if (world.flags.fixed) return;
          // Let it get worse while they investigate.
        }
      });

      return world;
    },

    /* Match on the evidence, and accept every reasonable route to it. */
    discoveries: [
      { id: 'symptom', label: 'Confirmed the symptom in the application log',
        when: function (o) { return /the symptom/.test(o.out); } },
      { id: 'defect', label: 'Found the latent configuration defect',
        when: function (o) { return /some\.setting=0/.test(o.out); } },
      { id: 'ruled-out', label: 'Ruled out the obvious wrong answer',
        optional: true,
        when: function (o) { return /\bdf\b/.test(o.cmd); } }
    ],

    /* Exactly one correct. Make the wrong ones genuinely tempting. */
    rootCauses: [
      { text: 'A plausible wrong answer someone would reach one step early.' },
      { text: 'The actual mechanism, stated the way you would write it in an RCA.', correct: true },
      { text: 'Another plausible wrong answer.' },
      { text: 'A wrong answer that blames the wrong team.' }
    ],

    fix: {
      prompt: 'What good looks like, including the constraint they must respect.',
      check: function (world) { return world.flags.fixed === true; },
      grade: function (world) {
        if (world.flags.killed) {
          return { quality: 'blunt', bonus: -120, note: 'What kill -9 cost, and what to do instead.' };
        }
        if (world.flags.restarted) {
          return { quality: 'blunt', bonus: 0, note: 'Why the restart worked but was not the right call.' };
        }
        return { quality: 'clean', bonus: 280, note: 'Why this was the right call.' };
      }
    },

    /* 3-4, revealed in order. First reframes the problem; last may name the command. */
    hints: [
      'Reframe the problem without giving anything away.',
      'Point at the category of evidence, and name one command that shows it.',
      'Name the specific finding and where it lives.',
      'Name the remediation, or point at the runbook that holds it.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'The mechanism, in plain English. What was true, what the system did about\n' +
      'it, and why the monitoring did not catch it.\n\n' +
      'THE TRIAGE THAT WORKS\n' +
      '  command one        what it tells you\n' +
      '  command two        what it tells you\n\n' +
      'THE TRAP\n' +
      'The plausible wrong turn, and how to tell it apart from the real cause.\n\n' +
      'INTERVIEW ANGLE\n' +
      'How this gets asked, what a weak answer sounds like, and the detail that\n' +
      'marks someone who has actually done it.'
  });
})(PS);
