/* Scenario: a FIX session logs on, gets logged straight back out, and loops.
 *
 * Pure connectivity triage where the network is perfectly healthy. Everything
 * you need is in the FIX message log, if you can read one.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'fix-seqnum-gap',
    track: 'fix',
    title: 'Client FIX session flapping at the open',
    severity: 'P1',
    desk: 'Electronic Trading / Client Connectivity',
    host: 'ldn-fix-prod03',
    tags: ['FIX', 'connectivity', 'sequence numbers', 'log reading'],
    par: 360,
    impactPerMin: 54000,
    currency: 'GBP',

    brief:
      'PAGER 07:58 - from Client Services\n\n' +
      '"GSCLIENT1 cannot get their session up. They have been trying since 07:52.\n' +
      'They say they can reach us and the socket connects, but we drop them\n' +
      'immediately. They are a top-five client and the open is at 08:00."\n\n' +
      'Network team have checked: no firewall changes, no packet loss, the port is\n' +
      'open. Their other two sessions (GSCLIENT2, GSCLIENT3) are up and trading.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 7, 58, 20);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var SOH = '|';

      // A FIX message log, pipe-delimited the way every support team views it.
      var fixLog = [];
      fixLog.push(W.isoStamp(ago(3600), true) + ' : 8=FIX.4.2' + SOH + '9=0089' + SOH + '35=A' + SOH +
        '34=88411' + SOH + '49=GSCLIENT1' + SOH + '56=IBANK' + SOH + '52=20260910-22:00:04.112' + SOH +
        '98=0' + SOH + '108=30' + SOH + '10=041' + SOH);
      fixLog.push(W.isoStamp(ago(3590), true) + ' : 8=FIX.4.2' + SOH + '9=0071' + SOH + '35=5' + SOH +
        '34=88412' + SOH + '49=IBANK' + SOH + '56=GSCLIENT1' + SOH + '52=20260910-22:00:14.880' + SOH +
        '58=End of day logout' + SOH + '10=118' + SOH);

      [400, 370, 340, 310, 280, 250].forEach(function (sec, i) {
        fixLog.push(W.isoStamp(ago(sec), true) + ' : IN  8=FIX.4.2' + SOH + '9=0089' + SOH + '35=A' + SOH +
          '34=1' + SOH + '49=GSCLIENT1' + SOH + '56=IBANK' + SOH + '52=' +
          W.isoStamp(ago(sec)).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2') +
          SOH + '98=0' + SOH + '108=30' + SOH + '141=N' + SOH + '10=0' + (41 + i) + SOH);
        fixLog.push(W.isoStamp(ago(sec - 1), true) + ' : OUT 8=FIX.4.2' + SOH + '9=0134' + SOH + '35=5' + SOH +
          '34=88413' + SOH + '49=IBANK' + SOH + '56=GSCLIENT1' + SOH + '52=' +
          W.isoStamp(ago(sec - 1)).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2') + SOH +
          '58=MsgSeqNum too low, expecting 88413 but received 1' + SOH + '10=2' + (10 + i) + SOH);
      });

      var appLog = [];
      [400, 370, 340, 310, 280, 250, 220, 190, 160, 130, 100, 70, 40, 10].forEach(function (sec) {
        appLog.push(W.isoStamp(ago(sec), true) +
          ' WARN  [session-GSCLIENT1] Session - Logon rejected: MsgSeqNum too low, expecting 88413 but received 1 - sending Logout');
        appLog.push(W.isoStamp(ago(sec - 2), true) +
          ' INFO  [session-GSCLIENT1] Session - disconnected, will accept reconnect');
      });
      appLog.push(W.isoStamp(ago(2400), true) + ' INFO  [session-GSCLIENT2] Session - Logon accepted, seqnum in=41208 out=41208');
      appLog.push(W.isoStamp(ago(2380), true) + ' INFO  [session-GSCLIENT3] Session - Logon accepted, seqnum in=18840 out=18840');

      var root = V.dir({
        apps: V.dir({
          fixgw: V.dir({
            lib: V.dir({ 'fixgw.jar': V.file('', { size: 48 * MB, owner: 'fixadm' }) }),
            conf: V.dir({
              'sessions.cfg': V.file(
                '[SESSION]\n' +
                'BeginString=FIX.4.2\n' +
                'SenderCompID=IBANK\n' +
                'TargetCompID=GSCLIENT1\n' +
                'SocketAcceptPort=9310\n' +
                'ResetOnLogon=N          # client resets nightly, we do not\n' +
                'ResetOnLogout=N\n' +
                'ResetOnDisconnect=N\n' +
                'StartTime=06:30:00\n' +
                'EndTime=22:00:00\n' +
                '\n' +
                '[SESSION]\n' +
                'BeginString=FIX.4.2\n' +
                'SenderCompID=IBANK\n' +
                'TargetCompID=GSCLIENT2\n' +
                'ResetOnLogon=Y\n' +
                '\n' +
                '[SESSION]\n' +
                'BeginString=FIX.4.2\n' +
                'SenderCompID=IBANK\n' +
                'TargetCompID=GSCLIENT3\n' +
                'ResetOnLogon=Y\n', { owner: 'fixadm' })
            })
          })
        }),
        var: V.dir({
          lib: V.dir({
            fixgw: V.dir({
              sessions: V.dir({
                'FIX.4.2-IBANK-GSCLIENT1.seqnums': V.file('senderseqnum=88413\ntargetseqnum=88413\ncreated=20250114-06:30:00\n',
                  { owner: 'fixadm', mtime: ago(3590) }),
                'FIX.4.2-IBANK-GSCLIENT2.seqnums': V.file('senderseqnum=41209\ntargetseqnum=41209\n', { owner: 'fixadm', mtime: ago(2400) }),
                'FIX.4.2-IBANK-GSCLIENT3.seqnums': V.file('senderseqnum=18841\ntargetseqnum=18841\n', { owner: 'fixadm', mtime: ago(2380) })
              })
            })
          }),
          log: V.dir({
            fixgw: V.dir({
              'fixgw-app.log': V.file(appLog.join('\n'), { owner: 'fixadm', mtime: ago(10), size: 412 * MB }),
              'FIX.4.2-IBANK-GSCLIENT1.messages.log': V.file(fixLog.join('\n'), { owner: 'fixadm', mtime: ago(10), size: 88 * MB }),
              'FIX.4.2-IBANK-GSCLIENT2.messages.log': V.file(
                W.isoStamp(ago(2400), true) + ' : IN  8=FIX.4.2|35=A|34=1|49=GSCLIENT2|56=IBANK|141=Y|10=012|\n' +
                W.isoStamp(ago(2399), true) + ' : OUT 8=FIX.4.2|35=A|34=1|49=IBANK|56=GSCLIENT2|141=Y|10=088|',
                { owner: 'fixadm', mtime: ago(2399), size: 42 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-fix-sessions.txt': V.file(
              'FIX SESSION RUNBOOK\n' +
              '===================\n' +
              'SEQUENCE NUMBERS\n' +
              '  Every FIX session keeps two independent counters: next outbound and\n' +
              '  what we expect next from them (target). If a Logon arrives with 34=\n' +
              '  lower than expected without valid duplicate/reset handling, reject\n' +
              '  it. A low number alone does not prove a nightly reset occurred.\n' +
              '\n' +
              '  Two legitimate situations:\n' +
              '   a) Incoming 34 is HIGHER than expected -> request the missing range\n' +
              '      with ResendRequest (35=2), preserving the session store.\n' +
              '   b) Incoming 34 is LOWER -> investigate stale store, duplicate/replay\n' +
              '      or an uncoordinated reset; reconcile with the counterparty.\n' +
              '      GSCLIENT1 resets nightly by agreement; ResetOnLogon=N on our side\n' +
              '      is a long standing config defect (JIRA CONN-880).\n' +
              '\n' +
              'SCENARIO APPROVAL: CONN-880 confirms this session resets before the\n' +
              '  open. Both parties confirmed no live orders, missing executions or\n' +
              '  unresolved replay. Operations has preserved the message store and\n' +
              '  authorized this one session reset. Never assume this elsewhere.\n' +
              '\n' +
              'RESETTING THIS AUTHORIZED SESSION (no gateway restart):\n' +
              '  curl http://localhost:9980/admin/session/GSCLIENT1/reset\n' +
              '    - sets both counters back to 1 for that session only\n' +
              '    - other sessions are untouched\n' +
              '\n' +
              'DO NOT restart the whole gateway to fix one session: it drops the other\n' +
              '  clients who are trading normally. Never delete/edit sequence files\n' +
              '  or blindly resend orders to make a session green. Use ClOrdID,\n' +
              '  OrderID and ExecID to reconcile application state; PossDupFlag=Y\n' +
              '  marks a possible duplicate and requires duplicate handling.\n' +
              '\n' +
              'DIAGNOSTICS\n' +
              '  curl http://localhost:9980/admin/session/GSCLIENT1/status\n' +
              '  tail -f /var/log/fixgw/FIX.4.2-IBANK-GSCLIENT1.messages.log\n' +
              '  Field reference: 35=msg type (A=Logon, 5=Logout, 2=Resend, 4=SeqReset)\n' +
              '                   34=MsgSeqNum  49=SenderCompID  56=TargetCompID\n' +
              '                   58=free text reason  141=ResetSeqNumFlag\n',
              { owner: 'gsupport' })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52 }) }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var gw = W.proc({
        pid: 5510, ppid: 1, user: 'fixadm',
        cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -Dapp=fixgw -jar /apps/fixgw/lib/fixgw.jar',
        short: 'java', state: 'S', cpu: 5.4, rss: 9 * GB,
        started: new Date(2026, 8, 11, 6, 30, 1), cpuSeconds: 412, tty: '?',
        fds: [{ fd: 1, path: '/var/log/fixgw/fixgw-app.log', mode: 'w', size: 412 * MB }],
        jvm: {
          name: 'fixgw.jar', mainClass: 'com.ib.fixgw.Gateway', heapMax: 8 * GB, heapUsed: 1.8 * GB,
          stdoutLog: '/var/log/fixgw/fixgw-app.log',
          gcStats: { ygc: 412, ygct: 4.118, fgc: 0, fgct: 0, old: 12.1, eden: 18.4 }
        },
        threads: [
          W.thread({ tid: 5520, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 2, stack: ['java.lang.Object.wait(Native Method)'] }),
          W.thread({ tid: 5531, name: 'session-GSCLIENT1', state: 'RUNNABLE', cpu: 0.4, cpuSeconds: 18,
            stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)', 'com.ib.fixgw.session.Session.run(Session.java:212)'] }),
          W.thread({ tid: 5532, name: 'session-GSCLIENT2', state: 'RUNNABLE', cpu: 2.1, cpuSeconds: 188, stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)'] }),
          W.thread({ tid: 5533, name: 'session-GSCLIENT3', state: 'RUNNABLE', cpu: 1.8, cpuSeconds: 164, stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)'] })
        ]
      });

      var world = W.create({
        host: 'ldn-fix-prod03', user: 'gsupport', clock: t0, seed: 88413,
        bootSeconds: 3600 * 24 * 14, cores: 16, users: 3,
        load: [0.42, 0.38, 0.41],
        mem: { total: 64 * GB, free: 48 * GB, buffers: 160 * MB, cached: 4 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 2.8, sy: 0.7, ni: 0, id: 96.4, wa: 0.1, st: 0 },
        root: root,
        limits: { nofile: 65536, nproc: 8192 },

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 10 * GB, inodes: { total: 26214400, used: 188402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 28 * GB, inodes: { total: 104857600, used: 41208 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 100 * GB, used: 12 * GB, inodes: { total: 52428800, used: 18840 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.5 * GB, inodes: { total: 10485760, used: 1204 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 180 }),
          W.proc({ pid: 1291, cmd: '/usr/sbin/rsyslogd -n', short: 'rsyslogd', rss: 38 * MB, cpu: 0.1, cpuSeconds: 240 }),
          W.proc({ pid: 1618, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 18 }),
          gw,
          W.proc({ pid: 17220, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        // The client really is connecting: look at the churn of short-lived
        // connections from their IP.
        sockets: [
          { pid: 5510, fd: 11, proto: 'tcp', local: '0.0.0.0:9310', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 5510, fd: 12, proto: 'tcp', local: '0.0.0.0:9980', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 5510, fd: 28, proto: 'tcp', local: '10.14.22.63:9310', peer: '198.51.100.44:52104', state: 'ESTABLISHED', recvq: 0, sendq: 0 },
          { pid: 5510, fd: 29, proto: 'tcp', local: '10.14.22.63:9310', peer: '198.51.100.44:52098', state: 'TIME_WAIT', recvq: 0, sendq: 0 },
          { pid: 5510, fd: 30, proto: 'tcp', local: '10.14.22.63:9310', peer: '198.51.100.44:52091', state: 'TIME_WAIT', recvq: 0, sendq: 0 },
          { pid: 5510, fd: 31, proto: 'tcp', local: '10.14.22.63:9310', peer: '198.51.100.44:52085', state: 'TIME_WAIT', recvq: 0, sendq: 0 },
          { pid: 5510, fd: 40, proto: 'tcp', local: '10.14.22.63:9310', peer: '198.51.100.71:41204', state: 'ESTABLISHED', recvq: 0, sendq: 0 },
          { pid: 5510, fd: 41, proto: 'tcp', local: '10.14.22.63:9310', peer: '198.51.100.72:41880', state: 'ESTABLISHED', recvq: 0, sendq: 0 },
          { pid: 1618, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        netstat: { tcpActive: 412, tcpPassive: 8841, tcpFailed: 0, tcpReset: 214, tcpRetrans: 2, udpReceived: 1204, udpErrors: 0 },
        diskio: [{ dev: 'dm-2', rs: 2.1, ws: 44.2, readKB: 41.8, writeKB: 620.4, await: 0.6, util: 2.8 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.63/24', mac: '00:50:56:9a:41:63', rxOk: 412008841, txOk: 388120044, rxBytes: 88120044120, txBytes: 74120088412 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 8412, txOk: 8412, mtu: 65536 }
        ],
        dmesg: [],

        hosts: {
          localhost: { ip: '127.0.0.1', ports: [9310, 9980, 22], rtt: 0.02 },
          'gsclient1-gw.example.net': { ip: '198.51.100.44', ports: [], rtt: 8.4, ttl: 54 }
        },

        http: {
          'localhost:9980/admin/session/GSCLIENT1/status': function (world) {
            var reset = world.flags.reset;
            return JSON.stringify({
              session: 'FIX.4.2:IBANK->GSCLIENT1',
              state: reset ? 'LOGGED_ON' : 'DISCONNECTED',
              expectedTargetSeqNum: reset ? 2 : 88413,
              nextSenderSeqNum: reset ? 2 : 88413,
              lastLogonAttempt: { seqNumReceived: reset ? 1 : 1, result: reset ? 'ACCEPTED' : 'REJECTED_SEQNUM_TOO_LOW' },
              resetOnLogon: 'N',
              logonAttemptsLast10Min: reset ? 1 : 14
            }, null, 2);
          },
          'localhost:9980/admin/sessions': function (world) {
            return JSON.stringify([
              { target: 'GSCLIENT1', state: world.flags.reset ? 'LOGGED_ON' : 'DISCONNECTED', expectedSeqNum: world.flags.reset ? 2 : 88413 },
              { target: 'GSCLIENT2', state: 'LOGGED_ON', expectedSeqNum: 41209 },
              { target: 'GSCLIENT3', state: 'LOGGED_ON', expectedSeqNum: 18841 }
            ], null, 2);
          },
          'localhost:9980/admin/session/GSCLIENT1/reset': function (world) {
            applyReset(world);
            return JSON.stringify({ status: 'ok', session: 'FIX.4.2:IBANK->GSCLIENT1', senderSeqNum: 1, targetSeqNum: 1,
              note: 'counters reset; awaiting client Logon' }, null, 2);
          }
        },

        services: {
          fixgw: { active: true, pid: 5510, exe: 'java', desc: 'FIX Client Gateway',
            since: new Date(2026, 8, 11, 6, 30, 1), tasks: 62, requiresRoot: false,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -jar /apps/fixgw/lib/fixgw.jar',
            log: ['Session - Logon rejected: MsgSeqNum too low, expecting 88413 but received 1'] },
          sshd: { active: true, pid: 1618, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { reset: false, gatewayBounced: false },

        onService: function (world, verb, unit) {
          if (unit !== 'fixgw' && unit !== 'fixgw.service') return false;
          if (verb === 'restart') {
            // A restart does NOT clear the stored sequence numbers - they are
            // persisted. It only drops the two healthy clients.
            world.flags.gatewayBounced = true;
            world.sockets = world.sockets.filter(function (s) { return s.pid !== 5510 || s.state === 'LISTEN'; });
            W.appendLog(world, '/var/log/fixgw/fixgw-app.log',
              W.isoStamp(world.clock, true) + ' INFO  [main] Gateway - restarted, sequence numbers restored from /var/lib/fixgw/sessions');
            W.appendLog(world, '/var/log/fixgw/fixgw-app.log',
              W.isoStamp(world.clock, true) + ' WARN  [session-GSCLIENT1] Session - Logon rejected: MsgSeqNum too low, expecting 88413 but received 1 - sending Logout');
            return true;
          }
          return false;
        },

        tick: function (world, seconds) {
          if (world.flags.reset) return;
          world.notes.t = (world.notes.t || 0) + seconds;
          if (world.notes.t % 30 < 1) {
            W.appendLog(world, '/var/log/fixgw/fixgw-app.log',
              W.isoStamp(world.clock, true) +
              ' WARN  [session-GSCLIENT1] Session - Logon rejected: MsgSeqNum too low, expecting 88413 but received 1 - sending Logout');
          }
        }
      });

      function applyReset(world) {
        world.flags.reset = true;
        PS.vfs.write(world.root, '/var/lib/fixgw/sessions/FIX.4.2-IBANK-GSCLIENT1.seqnums',
          'senderseqnum=2\ntargetseqnum=2\ncreated=' + W.isoStamp(world.clock) + '\n',
          { owner: 'fixadm', mtime: world.clock });
        W.appendLog(world, '/var/log/fixgw/fixgw-app.log',
          W.isoStamp(world.clock, true) + ' INFO  [session-GSCLIENT1] Session - sequence numbers reset to 1 by admin request');
        W.appendLog(world, '/var/log/fixgw/fixgw-app.log',
          W.isoStamp(world.clock, true) + ' INFO  [session-GSCLIENT1] Session - Logon accepted, seqnum in=1 out=1');
      }

      return world;
    },

    discoveries: [
      { id: 'reject-reason', label: 'The gateway is rejecting the Logon: "MsgSeqNum too low"', when: function (o) { return /MsgSeqNum too low/i.test(o.out); } },
      { id: 'seq-values', label: 'We expect 88413, the client is sending 1', when: function (o) { return /88413/.test(PS.world.stripColor(o.out)); } },
      { id: 'client-connecting', label: 'The client IS reaching us - repeated connections from 198.51.100.44', when: function (o) { return /\b(ss|netstat)\b/.test(o.cmd) && /198\.51\.100\.44/.test(PS.world.stripColor(o.out)); } },
      { id: 'others-fine', label: 'The other two client sessions are logged on normally', when: function (o) { return /GSCLIENT2/.test(o.out) && /GSCLIENT3/.test(o.out); } },
      { id: 'reset-config', label: 'ResetOnLogon=N for GSCLIENT1 but Y for the others', when: function (o) { return /ResetOnLogon=N/.test(o.out); } },
      { id: 'store-file', label: 'Found the persisted sequence store on disk', when: function (o) { return /senderseqnum=88413|seqnums/.test(PS.world.stripColor(o.out + o.cmd)); } }
    ],

    rootCauses: [
      { text: 'A firewall or network change is blocking the client, so the session cannot establish.' },
      { text: 'The client reset their sequence numbers overnight but our session is configured ResetOnLogon=N, so we still expect 88413 and reject their Logon at 1.', correct: true },
      { text: 'The client is using the wrong SenderCompID/TargetCompID.' },
      { text: 'The gateway has run out of file descriptors and cannot accept the connection.' },
      { text: 'Our sequence number store is corrupt and needs the gateway restarted.' },
      { text: 'The client certificate has expired, so the TLS handshake fails.' }
    ],

    fix: {
      prompt: 'Get GSCLIENT1 logged on before the open - without disturbing the clients who are already trading.',
      check: function (world) { return world.flags.reset === true; },
      grade: function (world) {
        if (world.flags.gatewayBounced) {
          return { quality: 'blunt', bonus: -80,
            note: 'Note that the gateway restart did not fix anything: sequence numbers are\n' +
              'persisted to /var/lib/fixgw/sessions, so they survived the bounce. All it\n' +
              'did was disconnect GSCLIENT2 and GSCLIENT3, who were trading fine. The\n' +
              'per-session reset was the surgical action.' };
        }
        return { quality: 'clean', bonus: 260,
          note: 'Per-session reset: GSCLIENT1 logged on at seqnum 1 and the other two clients\n' +
            'never noticed. Raise CONN-880 to get ResetOnLogon=Y set to match the client\n' +
            'so it does not recur at tomorrow\'s open.' };
      }
    },

    hints: [
      'The network team are right and it does not matter. The socket connects - so the problem is above TCP. Read what the application actually said to the client.',
      'FIX tells you exactly why it hung up. Look for tag 58 (free text) on the outbound Logout (35=5) in /var/log/fixgw/FIX.4.2-IBANK-GSCLIENT1.messages.log.',
      'We expect MsgSeqNum 88413; they are sending 1. They reset overnight and we did not. Compare ResetOnLogon in sessions.cfg between GSCLIENT1 and the sessions that are working.',
      'The runbook has the surgical action: curl http://localhost:9980/admin/session/GSCLIENT1/reset - do not bounce the gateway, it would drop the other two clients and would not help anyway.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'FIX sessions are sequenced so neither side can silently lose a message. Both\n' +
      'ends keep a counter. GSCLIENT1 resets theirs to 1 every night by agreement;\n' +
      'our session had ResetOnLogon=N, so we still expected 88413. A Logon at 1 is,\n' +
      'rejected because no valid duplicate/reset handling applies. The agreed\n' +
      'schedule and reconciled order state justify this reset, not the error alone.\n\n' +
      'HOW TO READ A FIX LOG\n' +
      '  35=  message type    A=Logon  0=Heartbeat  1=TestRequest  2=ResendRequest\n' +
      '                       4=SequenceReset  5=Logout  D=NewOrderSingle  8=ExecReport\n' +
      '  34=  MsgSeqNum       49=SenderCompID   56=TargetCompID\n' +
      '  58=  text - THIS is where the reason lives\n' +
      '  141= ResetSeqNumFlag (Y requests coordinated reset on Logon)\n' +
      '  43=  PossDupFlag     122=OrigSendingTime for replay handling\n' +
      '  123= GapFillFlag     36=NewSeqNo in SequenceReset\n' +
      'Note their Logon carried 141=N: they did not flag the reset, so we had no way\n' +
      'to accept it automatically.\n\n' +
      'THE TWO LEGITIMATE RESPONSES\n' +
      '  Too LOW  : investigate duplicates, stale store or reset mismatch. Do not\n' +
      '             automatically lower counters; agree recovery and reconcile.\n' +
      '  Too HIGH : request missing messages (35=2). Replay uses original sequence\n' +
      '             numbers and duplicate flags; gap fills skip eligible messages.\n' +
      '  GapFill (35=4,123=Y) advances to NewSeqNo; it is not a routine full reset.\n' +
      '  A blind reset can skip executions or duplicate business processing.\n\n' +
      'INTERVIEW ANGLE\n' +
      'Being able to open a FIX log and say "tag 58 says MsgSeqNum too low, expecting\n' +
      'X received Y, so the counterparty reset and we did not" is one of the most\n' +
      'commonly tested skills for a trading-floor support role. The follow-up is\n' +
      'always: what would you do differently for too-high vs too-low?'
  });
})(PS);
