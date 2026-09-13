/* Scenario: a fictional counterparty rejects SendingTime outside its configured
 * 2ms tolerance; the host separately breaches a 100us HFT UTC clock policy.
 * XLON is a fixture label, not a claim about an actual venue's FIX rules.
 * Sources: https://www.fixtrading.org/standards/fix-session-layer-online/
 * https://eur-lex.europa.eu/eli/reg_del/2017/574/oj
 * https://eur-lex.europa.eu/eli/reg_del/2025/1155/oj/eng
 * https://chrony-project.org/faq.html
 * https://chrony-project.org/doc/4.2/chrony.conf.html#makestep
 * https://chrony-project.org/doc/4.4/chronyc.html#tracking
 *
 * The trap is that "fix the clock" has an obvious wrong answer - date -s - which
 * steps wall time during trading and risks audit ordering. Reporting duties
 * require assessment; a clock step is not automatically a reportable breach.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'clock-drift-rts25',
    title: 'Venue rejecting orders on SendingTime',
    severity: 'P1',
    desk: 'Electronic Trading / Regulatory',
    host: 'ldn-algo-prod02',
    tags: ['MiFID II', 'RTS 25', 'PTP', 'clock sync', 'FIX reject', 'compliance'],
    par: 480,
    impactPerMin: 72000,
    currency: 'GBP',

    brief:
      'PAGER 08:06 - from the Low Touch desk, and separately from Compliance\n\n' +
      'DESK: "Half our orders to XLON are coming back rejected. The message says\n' +
      'something about SendingTime. We are flying blind at the open."\n\n' +
      'COMPLIANCE: "PTP lock was lost at 07:12; the first retained offset sample\n' +
      'at 07:13 breaches our 100us HFT UTC limit. Preserve the clock evidence\n' +
      'and establish which reportable events may be affected."\n\n' +
      'This fictional exercise uses a UTC limit of 100 microseconds, labelled\n' +
      'RTS 25 in the runbook. Separately, the fictional counterparty labelled\n' +
      'XLON is configured with a strict 2ms SendingTime tolerance. These are\n' +
      'different checks; 4.2ms drift does not imply rejection at real venues.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 8, 6, 30);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var lostLock = new Date(2026, 8, 11, 7, 12, 4);

      var fixLog = [
        '# Fictional counterparty: SendingTimeThreshold=0.002 seconds; not an actual XLON rule.',
        '# Abridged FIX examples: BodyLength/CheckSum are placeholders; Logout and re-Logon omitted.',
        '# SendingTime values use the exercise UTC clock; these samples are not a latency measurement.'
      ];
      [300, 240, 180, 120, 60, 20].forEach(function (sec, i) {
        var d = ago(sec);
        fixLog.push(W.isoStamp(d, true) + ' : OUT 8=FIX.4.4|9=0184|35=D|34=' + (41208 + i * 2) +
          '|49=IBANK|56=XLON|52=' + W.isoStamp(d).replace(/-/g, '').replace(' ', '-') +
          '.004|11=ORD-' + (884120 + i) + '|55=VOD.L|54=1|38=25000|40=2|44=71.24|10=118|');
        fixLog.push(W.isoStamp(new Date(d.getTime() + 300), true) + ' : IN  8=FIX.4.4|9=0142|35=3|34=' +
          (9120 + i) + '|49=XLON|56=IBANK|45=' + (41208 + i * 2) +
          '|58=SendingTime accuracy problem|371=52|372=D|373=10|10=204|');
      });

      var appLog = [
        W.isoStamp(ago(4200)) + ' INFO  [main] AlgoGateway - started, 14 strategies loaded',
        W.isoStamp(lostLock) + ' WARN  [clock-mon] ClockMonitor - PTP grandmaster gm1-ldn.ib.internal unreachable, falling back to NTP',
        W.isoStamp(new Date(lostLock.getTime() + 60000)) + ' WARN  [clock-mon] ClockMonitor - offset to UTC 812us, RTS 25 tolerance is 100us',
        W.isoStamp(new Date(lostLock.getTime() + 900000)) + ' ERROR [clock-mon] ClockMonitor - offset to UTC 2.104ms, timestamps are NOT compliant',
        W.isoStamp(ago(600)) + ' ERROR [clock-mon] ClockMonitor - offset to UTC 4.218ms',
        W.isoStamp(ago(120)) + ' ERROR [session-XLON] Session - 214 order submissions hit session rejects: SendingTime accuracy problem; fictional peer observed delta 4.218ms, configured tolerance 2ms'
      ].join('\n');

      var root = V.dir({
        apps: V.dir({
          algo: V.dir({
            conf: V.dir({
              'gateway.properties': V.file(
                'venue.primary=XLON\nfix.version=FIX.4.4\nsender.comp=IBANK\n' +
                'clock.source=ptp\nclock.tolerance.us=100      # exercise HFT UTC policy (legacy RTS 25 label)\n' +
                '# Fictional counterparty rules of engagement, not a real XLON setting:\n' +
                'counterparty.sendingTimeTolerance.ms=2\n',
                { owner: 'algoadm', mtime: ago(900000) })
            })
          }),
          ptp: V.dir({
            conf: V.dir({
              'ptp4l.conf': V.file(
                '[global]\n' +
                'domainNumber   24\n' +
                'slaveOnly      1\n' +
                'logSyncInterval -3\n' +
                'tx_timestamp_timeout 10\n' +
                '[eth1]\n',
                { owner: 'root', mtime: ago(86400 * 200) })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            algo: V.dir({
              'algo-gateway.log': V.file(appLog, { owner: 'algoadm', mtime: ago(120), size: 420 * MB }),
              'FIX.4.4-IBANK-XLON.messages.log': V.file(fixLog.join('\n'),
                { owner: 'algoadm', mtime: ago(20), size: 180 * MB })
            }),
            messages: V.file(
              W.syslogStamp(lostLock) + ' ldn-algo-prod02 ptp4l: [1284.402] port 1: SLAVE to UNCALIBRATED on SYNCHRONIZATION_FAULT\n' +
              W.syslogStamp(new Date(lostLock.getTime() + 2000)) + ' ldn-algo-prod02 ptp4l: [1286.418] port 1: UNCALIBRATED to LISTENING\n' +
              W.syslogStamp(new Date(lostLock.getTime() + 4000)) + ' ldn-algo-prod02 ptp4l: [1288.001] selected best master clock 000000.0000.000000\n' +
              W.syslogStamp(new Date(lostLock.getTime() + 6000)) + ' ldn-algo-prod02 phc2sys: [1290.112] failed to read clock, no grandmaster\n' +
              W.syslogStamp(new Date(lostLock.getTime() + 8000)) + ' ldn-algo-prod02 chronyd: Source 10.14.0.53 replaced 10.14.9.10 (PTP)',
              { owner: 'root', mtime: ago(3000), size: 44 * MB })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-clocksync.txt': V.file(
              'CLOCK SYNCHRONISATION RUNBOOK - TRADING HOSTS\n' +
              '=============================================\n' +
              'WHY THIS MATTERS\n' +
              '  Business-clock accuracy and UTC traceability are separate from FIX\n' +
              '  session acceptance. The legacy RTS 25 activity limits include:\n' +
              '      HFT algorithmic trading        100 microseconds\n' +
              '      other activity (residual category) 1 millisecond\n' +
              '  Voice and certain human-intervention activities have other limits.\n' +
              '  EU 2025/1155 replaced EU 2017/574 from 2 March 2026. This exercise\n' +
              '  retains the RTS 25 label and 100us HFT UTC policy; determine the\n' +
              '  applicable jurisdiction, activity and timestamp rules in production.\n' +
              '  Preserve evidence of UTC traceability at the timestamping point.\n' +
              '\n' +
              'FIX SENDINGTIME IS A DIFFERENT CHECK\n' +
              '  SendingTime (52) is UTC at transmission. The receiving FIX session\n' +
              '  checks it against its own clock using an agreed SendingTimeThreshold.\n' +
              '  FIX guidance describes seconds to minutes depending on application.\n' +
              '  This fictional counterparty has a deliberately strict 2ms tolerance,\n' +
              '  documented in gateway.properties; it is not an actual XLON rule.\n' +
              '  4.218ms exceeds that fixture setting and the separate 100us UTC limit.\n' +
              '  A UTC tolerance breach alone does not establish a FIX reject. FIX\n' +
              '  specifies Reject (35=3, 373=10) followed by Logout (35=5) on a\n' +
              '  failed SendingTime check; the sample log omits Logout/re-Logon.\n' +
              '\n' +
              '  NTP/PTP accuracy depends on deployment and measurement uncertainty.\n' +
              '  This floor uses PTP hardware timestamping and GPS grandmasters.\n' +
              '  Its measured NTP fallback is outside budget; NTP is not universally\n' +
              '  incapable of sub-100us accuracy, nor does regulation mandate PTP.\n' +
              '\n' +
              'ARCHITECTURE ON THIS FLOOR\n' +
              '  gm1-ldn.ib.internal   primary grandmaster, GPS disciplined\n' +
              '  gm2-ldn.ib.internal   secondary grandmaster, separate GPS + antenna\n' +
              '  ptp4l  disciplines the NIC hardware clock from the grandmaster\n' +
              '  phc2sys synchronises the system clock from the NIC hardware clock\n' +
              '  FICTIONAL FLOOR INTEGRATION: failover coordinates these services\n' +
              '  so only one daemon controls system time and chronyc reports the\n' +
              '  selected reference. This is not automatic stock daemon behaviour.\n' +
              '  Here NTP selection signals degraded service; measure UTC error and\n' +
              '  uncertainty before concluding that a tolerance has been breached.\n' +
              '\n' +
              'CHECKING\n' +
              '  chronyc tracking            system clock offset and source\n' +
              '  chronyc sources             which servers, and whether reachable\n' +
              '  pmc -u -b 0 "GET TIME_STATUS_NP"   PTP master offset, gmPresent\n' +
              '  systemctl status ptp4l phc2sys\n' +
              '  journalctl -u ptp4l -n 40\n' +
              '\n' +
              'IF THE PRIMARY GRANDMASTER IS LOST\n' +
              '  There is a second unit already configured against gm2:\n' +
              '\n' +
              '      systemctl start ptp4l-gm2\n' +
              '\n' +
              '  The simulator fast-forwards controlled failover and slewing. Verify\n' +
              '  PTP lock and chronyc tracking offset, root delay and dispersion;\n' +
              '  confirm UTC traceability and a stable error budget inside 100us.\n' +
              '  Check session recovery separately before resuming affected flow.\n' +
              '\n' +
              'NEVER RUN date -s ON A TRADING HOST\n' +
              '  Stepping the clock rewrites "now". Timestamps already written to the\n' +
              '  order audit trail stay unchanged. Backward steps can make later\n' +
              '  events appear earlier; forward steps create gaps in wall time.\n' +
              '  This floor requires slewing during trading. Preserve any step\n' +
              '  evidence for Compliance to assess impact and reporting duties.\n' +
              '  A step is not automatically a reportable regulatory breach.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({
          'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }),
          'chrony.conf': V.file(
            '# fallback only - PTP is the primary source on this host\n' +
            'server 10.14.0.53 iburst\n' +
            'server 10.14.0.54 iburst\n' +
            'makestep 0 0        # disable automatic chronyd steps in this fixture\n' +
            'rtcsync\n', { owner: 'root', mtime: ago(86400 * 300) })
        }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-algo-prod02', user: 'gsupport', clock: t0, seed: 1588,
        bootSeconds: 3600 * 24 * 19, cores: 16, users: 4,
        load: [2.14, 2.08, 1.94],
        mem: { total: 64 * GB, free: 40 * GB, buffers: 200 * MB, cached: 6 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 12.4, sy: 2.1, ni: 0, id: 85.3, wa: 0.2, st: 0 },
        root: root,

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB, inodes: { total: 26214400, used: 180402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 30 * GB, inodes: { total: 104857600, used: 28412 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 940 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 340 }),
          W.proc({ pid: 1610, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 20 }),
          W.proc({ pid: 1802, user: 'chrony', short: 'chronyd', cpu: 0.1, rss: 6 * MB,
            cmd: '/usr/sbin/chronyd -F 2', started: new Date(2026, 8, 1, 4, 0, 0), cpuSeconds: 210 }),
          W.proc({ pid: 6120, user: 'algoadm', short: 'java', cpu: 41.2, rss: 18 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms16g -Xmx16g -jar /apps/algo/lib/algo-gateway.jar',
            started: new Date(2026, 8, 11, 6, 45, 0), cpuSeconds: 3400,
            fds: [{ fd: 1, path: '/var/log/algo/algo-gateway.log', mode: 'w', size: 420 * MB }],
            jvm: { name: 'algo-gateway.jar', mainClass: 'com.ib.algo.Gateway', heapMax: 16 * GB, heapUsed: 4 * GB,
              gcStats: { ygc: 1204, ygct: 12.4, fgc: 0, fgct: 0, old: 18.2, eden: 24.1 } } }),
          W.proc({ pid: 21400, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 6120, fd: 11, proto: 'tcp', local: '0.0.0.0:9500', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 6120, fd: 28, proto: 'tcp', local: '10.14.22.90:44120', peer: '196.4.12.20:9401', state: 'ESTABLISHED' },
          { pid: 1802, fd: 3, proto: 'udp', local: '0.0.0.0:123', peer: '*:*', state: 'UNCONN' },
          { pid: 1610, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [{ dev: 'dm-1', rs: 2.1, ws: 44.2, readKB: 41.2, writeKB: 620.4, await: 0.5, util: 2.4 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.90/24', mtu: 1500, speed: '1000Mb/s',
            rxOk: 120044120, txOk: 98412004, rxBytes: 22104881200, txBytes: 18120044120 },
          { name: 'eth1', addr: '10.14.9.90/24', mtu: 1500, speed: '10000Mb/s',
            mac: '00:1b:21:8c:44:02',
            rxOk: 4412008, txOk: 4412008, rxBytes: 881200440, txBytes: 881200440 },
          { name: 'lo', addr: '127.0.0.1/8', mtu: 65536, rxOk: 41208, txOk: 41208 }
        ],

        dmesg: [
          { time: lostLock, text: 'ptp4l: port 1: SLAVE to UNCALIBRATED on SYNCHRONIZATION_FAULT' },
          { time: new Date(lostLock.getTime() + 4000), text: 'ptp4l: selected best master clock 000000.0000.000000' },
          { time: new Date(lostLock.getTime() + 6000), text: 'phc2sys: failed to read clock, no grandmaster' }
        ],

        hosts: {
          localhost: { ip: '127.0.0.1', ports: [9500, 22], rtt: 0.02 },
          'gm1-ldn.ib.internal': { ip: '10.14.9.10', unreachable: true, ports: [] },
          'gm2-ldn.ib.internal': { ip: '10.14.9.11', ports: [319, 320], rtt: 0.08, ttl: 64 }
        },

        /* system clock is 4.218 ms out - forty times the RTS 25 HFT tolerance */
        chrony: {
          refid: '0A0E0035', source: '10.14.0.53', stratum: 3,
          offsetSeconds: 0.004218, lastOffset: 0.004102, rmsOffset: 0.003884,
          frequency: 18.402, residual: 0.412, skew: 2.884,
          rootDelay: 0.002104, rootDispersion: 0.004412,
          updateInterval: 64.2, leap: 'Normal',
          sources: [
            { name: '10.14.0.53', stratum: 2, poll: 6, reach: 377, lastRx: 21, offset: 4218, err: 402, selected: true },
            { name: '10.14.0.54', stratum: 2, poll: 6, reach: 377, lastRx: 44, offset: 4104, err: 388 },
            { name: 'PTP0', stratum: 0, poll: 3, reach: 0, lastRx: 3242, offset: 0, err: 0 }
          ]
        },

        ptp: {
          clockId: '001b21.fffe.8c4402',
          portState: 'LISTENING',
          gmPresent: false,
          gmIdentity: '(none)',
          masterOffsetNs: 0
        },

        services: {
          ptp4l: {
            active: false, pid: null, exe: 'ptp4l', desc: 'Precision Time Protocol service (gm1)',
            since: lostLock, requiresRoot: false,
            log: ['port 1: SLAVE to UNCALIBRATED on SYNCHRONIZATION_FAULT',
              'port 1: UNCALIBRATED to LISTENING',
              'selected best master clock 000000.0000.000000',
              'no grandmaster on domain 24, clock is free running']
          },
          'ptp4l-gm2': {
            active: false, pid: null, exe: 'ptp4l', desc: 'Precision Time Protocol service (gm2, secondary)',
            requiresRoot: false, log: ['inactive']
          },
          phc2sys: {
            active: true, pid: 1840, exe: 'phc2sys', desc: 'PTP hardware clock to system clock',
            since: new Date(2026, 8, 1, 4, 0, 0), requiresRoot: false,
            log: ['failed to read clock, no grandmaster']
          },
          chronyd: { active: true, pid: 1802, exe: 'chronyd', desc: 'NTP client/server (fallback)' },
          'algo-gateway': { active: true, pid: 6120, exe: 'java', desc: 'Algo Order Gateway' }
        },

        flags: { synced: false, steppedClock: false, bouncedGateway: false },

        onService: function (world, verb, unit) {
          var name = String(unit).replace(/\.service$/, '');

          if (name === 'ptp4l-gm2' && (verb === 'start' || verb === 'restart')) {
            world.services['ptp4l-gm2'].active = true;
            world.services['ptp4l-gm2'].pid = 24118;
            world.services['ptp4l-gm2'].since = new Date(world.clock.getTime());
            world.services['ptp4l-gm2'].log = [
              'port 1: LISTENING to UNCALIBRATED on RS_SLAVE',
              'master offset       -4218204 s0 freq  +18402 path delay      412',
              'port 1: UNCALIBRATED to SLAVE on MASTER_CLOCK_SELECTED',
              'master offset            -84 s2 freq  +18388 path delay      408'
            ];
            world.ptp.portState = 'SLAVE';
            world.ptp.gmPresent = true;
            world.ptp.gmIdentity = '001b21.fffe.9a1102';
            world.ptp.masterOffsetNs = -84;
            world.chrony.source = 'PTP0';
            world.chrony.refid = '50545030';
            world.chrony.stratum = 1;
            world.chrony.offsetSeconds = 0.000002;
            world.chrony.lastOffset = 0.0000018;
            world.chrony.rmsOffset = 0.0000021;
            world.chrony.rootDelay = 0.000000412;
            world.chrony.rootDispersion = 0.000001204;
            world.chrony.sources[2] = { name: 'PTP0', stratum: 0, poll: 3, reach: 377, lastRx: 2, offset: -2, err: 4, selected: true };
            world.chrony.sources[0].selected = false;
            world.flags.synced = true;
            W.appendLog(world, '/var/log/algo/algo-gateway.log',
              W.isoStamp(world.clock) + ' INFO  [clock-mon] ClockMonitor - PTP locked to gm2-ldn.ib.internal, offset 2us, back inside RTS 25 tolerance');
            return true;
          }

          if (name === 'ptp4l' && (verb === 'start' || verb === 'restart')) {
            // gm1 is still unreachable - this does nothing
            world.services.ptp4l.active = false;
            world.services.ptp4l.log = ['port 1: LISTENING',
              'no grandmaster on domain 24, clock is free running',
              'gm1-ldn.ib.internal is not answering PTP announce messages'];
            return { err: 'Job for ptp4l.service failed: no grandmaster reachable on domain 24.\n' +
              'See \'systemctl status ptp4l.service\' and \'journalctl -xe\' for details.', code: 1 };
          }

          if (name === 'algo-gateway' && (verb === 'restart' || verb === 'stop')) {
            world.flags.bouncedGateway = true;
            return true;
          }
          return false;
        },

        /* Simplified gameplay: date -s clears the displayed offset but is graded
         * as an uncontrolled wall-clock step, not proof of UTC synchronisation. */
        onClockStep: function (world, deltaMs) {
          world.flags.steppedClock = true;
          world.chrony.offsetSeconds = 0.000001;
          world.chrony.lastOffset = 0.000001;
          world.flags.synced = true;
          W.appendLog(world, '/var/log/algo/algo-gateway.log',
            W.isoStamp(world.clock) + ' ERROR [clock-mon] ClockMonitor - system clock STEPPED by ' +
            deltaMs.toFixed(3) + 'ms - preserve evidence; audit ordering and timestamp gaps require assessment');
        },

        tick: function (world, seconds) {
          if (world.flags.synced) return;
          // degraded fallback: the fixture's measured error keeps getting worse
          world.chrony.offsetSeconds += 0.0000042 * seconds;
          world.chrony.sources[0].offset = Math.round(world.chrony.offsetSeconds * 1e6);
        }
      });

      return world;
    },

    discoveries: [
      { id: 'venue-reject', label: 'The fictional counterparty reports "SendingTime accuracy problem" under its own tolerance',
        when: function (o) { return /SendingTime accuracy problem/i.test(o.out); } },
      { id: 'offset-out', label: 'System clock is milliseconds out, against a 100us tolerance',
        when: function (o) { return /chronyc/.test(o.cmd) && /ms\)|System time/.test(o.out); } },
      { id: 'ptp-down', label: 'ptp4l is not running and there is no grandmaster',
        when: function (o) { return /(gmPresent\s+false|LISTENING|no grandmaster|SYNCHRONIZATION_FAULT)/.test(o.out); } },
      { id: 'fell-back-ntp', label: 'This host selected NTP fallback; its measured error exceeds the UTC budget',
        when: function (o) { return /chronyd: Source|falling back to NTP|10\.14\.0\.53/.test(o.out); } },
      { id: 'gm1-dead', label: 'The primary grandmaster gm1 is unreachable',
        when: function (o) { return /gm1/.test(o.cmd + o.out) && /100% packet loss|unreachable|not answering/i.test(o.out); } },
      { id: 'gm2-alive', label: 'The secondary grandmaster gm2 is reachable',
        when: function (o) { return /gm2/.test(o.cmd) && /0% packet loss|Connected/i.test(o.out); } },
      { id: 'tolerance-known', label: 'Established the exercise HFT UTC tolerance is 100 microseconds',
        when: function (o) { return /100\s*(us|microsecond)/i.test(o.out); } },
      { id: 'window-known', label: 'Identified loss of PTP lock at 07:12, the start of the investigation window',
        when: function (o) { return /07:12/.test(o.out); } }
    ],

    rootCauses: [
      { text: 'The venue has changed its FIX specification and is rejecting a tag we send.' },
      { text: 'The PTP grandmaster became unreachable and the host selected degraded NTP fallback. Its measured clock error exceeds the 100us UTC policy and, separately, the fictional counterparty\'s configured 2ms SendingTime tolerance.', correct: true },
      { text: 'The algo gateway is under GC pressure and is taking milliseconds to build each message.' },
      { text: 'Network latency to the venue has increased, so messages arrive stale.' },
      { text: 'The system timezone is configured incorrectly on this host.' },
      { text: 'chronyd has crashed, leaving the clock completely unsynchronised.' }
    ],

    fix: {
      prompt: 'Get the clock back inside 100 microseconds of UTC, without making the audit trail worse.',
      check: function (world) { return Math.abs(world.chrony.offsetSeconds) < 0.0001; },
      grade: function (world) {
        if (world.flags.steppedClock) {
          return { quality: 'blunt', bonus: -450,
            note: 'You ran date -s during trading. The fixture clears the displayed\n' +
              'offset, but a manual step does not establish UTC traceability.\n' +
              'A backward jump can reverse wall-time ordering; a forward jump creates\n' +
              'a gap. Existing timestamps remain unchanged. Preserve the step and\n' +
              'event evidence for Compliance to assess impact and reporting duties.\n\n' +
              'This floor requires slewing during trading. makestep 0 0 disables\n' +
              'automatic chronyd steps; it cannot prevent date -s. The fix was\n' +
              'systemctl start ptp4l-gm2.' };
        }
        return { quality: 'clean', bonus: 340,
          note: 'You failed the host over to the secondary grandmaster. The simulator\n' +
            'fast-forwards re-lock and slewing to about 2 microseconds. This clears\n' +
            'the 100us UTC check and the separate fictional 2ms FIX tolerance.\n\n' +
            'Investigate from loss of lock at 07:12; the first retained out-of-limit\n' +
            'sample is at 07:13. Bound the breach with clock-monitoring evidence and\n' +
            'confirmed stable UTC recovery, then identify affected events. PTP lock\n' +
            'loss alone does not prove every later timestamp was outside tolerance.' +
            (world.flags.bouncedGateway
              ? '\n\nBouncing the gateway on the way through was not needed - the drift was\nin the host clock, not the application.'
              : '') };
      }
    },

    hints: [
      '373=10 and tag 58 identify a session SendingTime accuracy problem. Read the fictional counterparty\'s 2ms tolerance in gateway.properties; the 100us regulatory UTC budget is a separate check. Compare clocks and transport timing.',
      'Measure it before you touch it: chronyc tracking gives the system clock offset from its source. Then ask what the source actually is - chronyc sources.',
      'This floor has selected its degraded NTP fallback. That alone does not prove non-compliance; correlate measured error with systemctl status ptp4l, journalctl -u ptp4l, and pmc -u -b 0 "GET TIME_STATUS_NP".',
      'The primary grandmaster is unreachable but there is a second unit already configured. Read /home/gsupport/runbook-clocksync.txt - and note very carefully what it says about date -s.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'ptp4l lost contact with the GPS grandmaster at 07:12 and dropped from SLAVE\n' +
      'to LISTENING. With no PTP source the host fell back to chronyd over the\n' +
      'ordinary network. This fixture has a measured 4.218ms clock error.\n' +
      'That breaches the 100us HFT UTC policy. Separately, its fictional\n' +
      'counterparty rejects under a configured 2ms SendingTime tolerance.\n' +
      '4.2ms drift does not automatically cause a real venue to reject FIX.\n' +
      'SendingTime (52) is UTC at transmission; its acceptance threshold belongs\n' +
      'in counterparty rules of engagement. FIX guidance describes seconds to\n' +
      'minutes, and specifies Reject (373=10) then Logout when the check fails.\n' +
      'The sample FIX log abbreviates that session lifecycle.\n\n' +
      'WHY THIS FLOOR USES PTP\n' +
      'Hardware timestamping and traceable grandmasters support its 100us budget.\n' +
      'NTP accuracy depends on the deployment; the measured fallback failure\n' +
      'here is not a universal NTP limit or a regulatory mandate to use PTP.\n' +
      'Source offset alone is insufficient: include uncertainty and the whole\n' +
      'UTC traceability chain. The RTS 25 label is retained for training; EU\n' +
      '2025/1155 replaced EU 2017/574 from 2 March 2026. Establish the current\n' +
      'rules for the jurisdiction and activity before a production assessment.\n\n' +
      'WHY date -s IS THE WRONG ANSWER\n' +
      'The game clears the offset after a step, but that proves no UTC accuracy.\n' +
      'Backward steps can disrupt wall-time ordering; forward steps create gaps.\n' +
      'Neither rewrites old timestamps. This floor requires slewing during\n' +
      'trading; makestep 0 0 disables automatic chronyd steps, not manual date -s.\n' +
      'Compliance must assess any step and its consequences; it is not\n' +
      'automatically a separately reportable regulatory breach.\n\n' +
      'THE COMMANDS\n' +
      '  chronyc tracking                    offset, source, stratum, leap\n' +
      '  chronyc sources                     which servers, reach, last sample\n' +
      '  pmc -u -b 0 "GET TIME_STATUS_NP"    master offset, gmPresent\n' +
      '  systemctl status ptp4l phc2sys      is PTP even running\n' +
      '  journalctl -u ptp4l                 when it lost lock, and why\n\n' +
      'WHAT COMPLIANCE ACTUALLY NEEDS\n' +
      'Not "it is fixed". They need the window: when the clock left tolerance,\n' +
      'when it came back, and which systems timestamped reportable events in\n' +
      'between. 07:12 is loss of lock, not a proven tolerance crossing. The first\n' +
      'retained bad sample is at 07:13. Use offset history, uncertainty and the\n' +
      'last good sample to bound the breach; confirm stable UTC recovery and\n' +
      'preserve original event records. Report assumptions and gaps in evidence.\n\n' +
      'INTERVIEW ANGLE\n' +
      'Distinguish regulatory UTC accuracy, timestamp granularity and FIX\n' +
      'SendingTime acceptance. Explain how measured evidence establishes the\n' +
      'incident window and how the approved clock-recovery procedure protects\n' +
      'the event record.'
  });
})(PS);
