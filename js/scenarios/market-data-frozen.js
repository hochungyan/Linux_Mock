/* Scenario: the process is alive, CPU is normal, the log is clean - and every
 * price on the desk is frozen.
 *
 * This is the incident that separates people who read dashboards from people
 * who read systems. Nothing is "down". The multicast feed is arriving fine; the
 * application simply stopped draining its socket, because the thread that
 * dispatches ticks is BLOCKED on a monitor held by a reference-data thread that
 * is parked forever in a socket read with no timeout.
 *
 * The teaching point is the order of work: prove data is arriving, prove the
 * app is not consuming it, then take a thread dump BEFORE you bounce anything.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576, KB = 1024;

  PS.scenarios.push({
    id: 'market-data-frozen',
    title: 'Prices frozen on the EQD blotter',
    severity: 'P1',
    desk: 'Equity Derivatives / Market Data',
    host: 'ldn-mdata-prod02',
    tags: ['market data', 'multicast', 'thread dump', 'app hung', 'sockets'],
    par: 480,
    impactPerMin: 96000,
    currency: 'GBP',

    brief:
      'PAGER 09:02 - from EQD trading desk (verbal, then raised as P1)\n\n' +
      '"Every price on the vol surface is stuck. Timestamps say 08:47 and nothing\n' +
      'has moved since. We are quoting into the market off this. Turn it off or\n' +
      'fix it in the next few minutes."\n\n' +
      'Monitoring says the mdgw process is UP, CPU normal, no alerts, nothing in\n' +
      'the error log. The exchange confirms their feed is publishing normally and\n' +
      'the other two consumers of the same feed are fine.\n\n' +
      'Do NOT bounce anything before you can say what is wrong - the desk head has\n' +
      'already asked for a written root cause.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 9, 2, 15);
      var froze = new Date(2026, 8, 11, 8, 47, 3);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      // The app log simply STOPS. No error, no exception - that absence is the
      // most important thing in the file.
      var mdLog = [];
      for (var i = 14; i >= 1; i--) {
        var d = new Date(froze.getTime() - i * 20000);
        mdLog.push(W.isoStamp(d, true) + ' INFO  [md-dispatch-1] TickPublisher - published seq=' +
          (99812400 + (14 - i) * 4120) + ' symbols=2841 lag=2ms');
      }
      mdLog.push(W.isoStamp(new Date(froze.getTime() - 4200), true) +
        ' INFO  [refdata-refresh-1] RefDataClient - starting scheduled refresh of instrument cache');
      mdLog.push(W.isoStamp(froze, true) +
        ' INFO  [md-dispatch-1] TickPublisher - published seq=99870080 symbols=2841 lag=3ms');
      var mdLogText = mdLog.join('\n');

      var root = V.dir({
        apps: V.dir({
          mdgw: V.dir({
            bin: V.dir({
              'mdgw-start.sh': V.file('#!/bin/bash\nexec java -Xmx16g -jar /apps/mdgw/lib/mdgw.jar\n',
                { mode: '-rwxr-xr-x', owner: 'mdadm', group: 'mdadm', size: 88 })
            }),
            lib: V.dir({ 'mdgw.jar': V.file('', { size: 62 * MB, owner: 'mdadm', group: 'mdadm' }) }),
            conf: V.dir({
              'mdgw.properties': V.file(
                '# Market data gateway - EQD\n' +
                'feed.primary.group=233.71.14.20:14310\n' +
                'feed.secondary.group=233.71.14.21:14310\n' +
                'feed.interface=eth1\n' +
                'publish.port=9911\n' +
                'admin.port=9911\n' +
                '\n' +
                '# reference data\n' +
                'refdata.primary=refdata-db-ldn:1521\n' +
                'refdata.secondary=refdata-db-fra:1521\n' +
                'refdata.socket.timeout=0        # 0 = no timeout\n' +
                'refdata.refresh.cron=0 47 * * *\n',
                { owner: 'mdadm', group: 'mdadm' })
            })
          })
        }),

        var: V.dir({
          log: V.dir({
            mdgw: V.dir({
              'mdgw-app.log': V.file(mdLogText, { owner: 'mdadm', group: 'mdadm', mtime: froze, size: 1420 * MB }),
              'mdgw-feed.log': V.file(
                [0, 1, 2, 3, 4].map(function (k) {
                  return W.isoStamp(new Date(froze.getTime() - (5 - k) * 60000)) +
                    ' INFO  [feed-rx-eth1] FeedSession - primary group 233.71.14.20:14310 seq ok, gaps=0';
                }).join('\n'),
                { owner: 'mdadm', group: 'mdadm', mtime: froze, size: 420 * MB }),
              'mdgw-gc.log': V.file(
                [0, 1, 2, 3].map(function (k) {
                  return '[' + W.isoStamp(new Date(t0.getTime() - (4 - k) * 120000), true) +
                    '] [GC pause (G1 Evacuation Pause) (young) 4102M->812M(16384M), 0.0184 secs]';
                }).join('\n'),
                { owner: 'mdadm', group: 'mdadm', mtime: ago(60), size: 88 * MB })
            }),
            messages: V.file(
              W.syslogStamp(ago(3600)) + ' ldn-mdata-prod02 systemd: Started Session 9912 of user gsupport.',
              { owner: 'root', size: 44 * MB })
          })
        }),

        home: V.dir({
          gsupport: V.dir({
            'runbook-mdgw.txt': V.file(
              'MARKET DATA GATEWAY (mdgw) RUNBOOK - EQD\n' +
              '========================================\n' +
              '\n' +
              'HEALTH\n' +
              '  curl http://localhost:9911/admin/health\n' +
              '  curl http://localhost:9911/admin/feed/status\n' +
              '\n' +
              'REFERENCE DATA\n' +
              '  mdgw refreshes the instrument cache from refdata-db-ldn every hour at\n' +
              '  HH:47. The refdata client is configured with NO socket timeout\n' +
              '  (refdata.socket.timeout=0) - RISK-2291 is open against this.\n' +
              '\n' +
              '  If a refresh hangs, you can drop the stuck connection and fail over to\n' +
              '  the Frankfurt replica WITHOUT restarting the gateway:\n' +
              '\n' +
              '      curl http://localhost:9911/admin/refdata/failover\n' +
              '\n' +
              '  This closes the in-flight socket, releases the instrument cache lock\n' +
              '  and re-points the client at refdata-db-fra. Takes about 2 seconds.\n' +
              '\n' +
              'RESTART (last resort)\n' +
              '  systemctl restart mdgw\n' +
              '  ~40s of no prices, and the gateway rejoins the multicast group from\n' +
              '  the current sequence - anything in the gap is not recovered. Always\n' +
              '  capture a thread dump first: jstack <pid> > /tmp/mdgw.tdump\n' +
              '\n' +
              'FEED\n' +
              '  Primary group 233.71.14.20:14310 on eth1. If you suspect the feed\n' +
              '  itself, check ip -s link (rx counters must be climbing) and\n' +
              '  netstat -g (we must still be joined to the group).\n',
              { owner: 'gsupport', group: 'gsupport' }),
            'RISK-2291.txt': V.file(
              'RISK-2291  mdgw refdata client has no socket timeout\n' +
              'Raised: 2026-04-02   Severity: Medium   Status: OPEN (deferred twice)\n' +
              '\n' +
              'refdata.socket.timeout=0 means a read on the refdata connection blocks\n' +
              'forever if the server stops responding without closing the socket (eg a\n' +
              'firewall drop, or a DB node fenced by clusterware).\n' +
              '\n' +
              'Because RefDataClient.refresh() holds the instrument cache monitor for the\n' +
              'whole refresh, a hang there also stops tick dispatch. The gateway stays UP\n' +
              'and silent: no error, no exception, no alert. Prices simply stop.\n',
              { owner: 'gsupport', group: 'gsupport' })
          })
        }),

        etc: V.dir({
          'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52 }),
          hosts: V.file(
            '127.0.0.1   localhost\n' +
            '10.14.22.62 ldn-mdata-prod02\n' +
            '10.14.40.11 refdata-db-ldn\n' +
            '10.61.40.11 refdata-db-fra\n', { owner: 'root' })
        }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) }), opt: V.dir({})
      });

      var mdgw = W.proc({
        pid: 6120, ppid: 1, user: 'mdadm',
        cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms16g -Xmx16g -XX:+UseG1GC -Dapp=mdgw -jar /apps/mdgw/lib/mdgw.jar',
        short: 'java', state: 'S', cpu: 3.1, rss: 17 * GB,
        started: new Date(2026, 8, 11, 6, 10, 4), cpuSeconds: 6240, tty: '?',
        fds: [
          { fd: 1, path: '/var/log/mdgw/mdgw-app.log', mode: 'w', size: 1420 * MB },
          { fd: 2, path: '/var/log/mdgw/mdgw-feed.log', mode: 'w', size: 420 * MB }
        ],
        jvm: {
          name: 'mdgw.jar', mainClass: 'com.ib.mdgw.Gateway',
          heapMax: 16 * GB, heapUsed: 3.4 * GB,
          args: '-Xms16g -Xmx16g -XX:+UseG1GC -Drefdata.socket.timeout=0',
          stdoutLog: '/var/log/mdgw/mdgw-app.log',
          gcStats: { ygc: 12904, ygct: 241.118, fgc: 0, fgct: 0, old: 21.4, eden: 32.8, s1: 8.2 }
        },
        threads: [
          W.thread({
            tid: 6131, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 8,
            stack: ['java.lang.Object.wait(Native Method)', 'com.ib.mdgw.Gateway.awaitShutdown(Gateway.java:92)']
          }),
          // Data IS arriving. This thread reads it off the wire and hands it on...
          W.thread({
            tid: 6144, name: 'feed-rx-eth1', state: 'BLOCKED', cpu: 0.2, cpuSeconds: 1840,
            stack: [
              'com.ib.mdgw.feed.FeedSession.onDatagram(FeedSession.java:311)',
              '- waiting to lock <0x00000006c1044f28> (a com.ib.mdgw.ref.InstrumentCache)',
              'com.ib.mdgw.feed.FeedSession.run(FeedSession.java:204)',
              'java.lang.Thread.run(Thread.java:750)'
            ]
          }),
          // ...to this one, which cannot get the lock either.
          W.thread({
            tid: 6145, name: 'md-dispatch-1', state: 'BLOCKED', cpu: 0, cpuSeconds: 4102,
            stack: [
              'com.ib.mdgw.publish.TickPublisher.publish(TickPublisher.java:148)',
              '- waiting to lock <0x00000006c1044f28> (a com.ib.mdgw.ref.InstrumentCache)',
              'com.ib.mdgw.publish.TickPublisher.run(TickPublisher.java:96)',
              'java.lang.Thread.run(Thread.java:750)'
            ]
          }),
          W.thread({
            tid: 6146, name: 'md-dispatch-2', state: 'BLOCKED', cpu: 0, cpuSeconds: 3980,
            stack: [
              'com.ib.mdgw.publish.TickPublisher.publish(TickPublisher.java:148)',
              '- waiting to lock <0x00000006c1044f28> (a com.ib.mdgw.ref.InstrumentCache)',
              'java.lang.Thread.run(Thread.java:750)'
            ]
          }),
          // The culprit: holds the lock, parked in a socket read that will never
          // return because the client was configured with no timeout.
          W.thread({
            tid: 6188, name: 'refdata-refresh-1', state: 'RUNNABLE', cpu: 0, cpuSeconds: 61,
            stack: [
              'java.net.SocketInputStream.socketRead0(Native Method)',
              'java.net.SocketInputStream.read(SocketInputStream.java:171)',
              'oracle.net.ns.Packet.receive(Packet.java:311)',
              'oracle.jdbc.driver.T4CSocketInputStreamWrapper.read(T4CSocketInputStreamWrapper.java:98)',
              'oracle.jdbc.driver.T4CStatement.doOall8(T4CStatement.java:206)',
              'com.ib.mdgw.ref.RefDataClient.loadInstruments(RefDataClient.java:214)',
              '- locked <0x00000006c1044f28> (a com.ib.mdgw.ref.InstrumentCache)',
              'com.ib.mdgw.ref.RefDataClient.refresh(RefDataClient.java:88)',
              'java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:624)'
            ]
          }),
          W.thread({
            tid: 6190, name: 'admin-http-1', state: 'RUNNABLE', cpu: 0.1, cpuSeconds: 14,
            stack: ['sun.nio.ch.EPollArrayWrapper.epollWait(Native Method)']
          })
        ]
      });

      var world = W.create({
        host: 'ldn-mdata-prod02', user: 'gsupport', clock: t0, seed: 90210,
        bootSeconds: 3600 * 24 * 31 + 11000,
        cores: 16, users: 3,
        load: [0.68, 0.71, 0.74],
        mem: { total: 64 * GB, free: 38 * GB, buffers: 210 * MB, cached: 6 * GB, shared: 180 * MB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 3.4, sy: 1.1, ni: 0, id: 95.4, wa: 0.1, st: 0 },
        root: root,
        limits: { nofile: 65536, nproc: 8192 },

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 14 * GB, inodes: { total: 26214400, used: 388102 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 300 * GB, used: 88 * GB, inodes: { total: 157286400, used: 120044 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 100 * GB, used: 22 * GB, inodes: { total: 52428800, used: 60112 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 1.4 * GB, inodes: { total: 10485760, used: 4120 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 380 }),
          W.proc({ pid: 1290, cmd: '/usr/sbin/rsyslogd -n', short: 'rsyslogd', rss: 42 * MB, cpu: 0.2, cpuSeconds: 1120 }),
          W.proc({ pid: 1611, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 64 }),
          mdgw,
          W.proc({ pid: 7742, user: 'mdadm', cmd: '/apps/mdgw/bin/mdgw-monitor.sh', short: 'mdgw-monito', rss: 5 * MB, cpu: 0.1, cpuSeconds: 41 }),
          W.proc({ pid: 15880, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        // The UDP receive queue is the smoking gun: the kernel has the data,
        // the application is not reading it.
        sockets: [
          { pid: 6120, fd: 14, proto: 'udp', local: '233.71.14.20:14310', peer: '*:*', state: 'UNCONN', recvq: 212992, sendq: 0, node: 44120 },
          { pid: 6120, fd: 15, proto: 'udp', local: '233.71.14.21:14310', peer: '*:*', state: 'UNCONN', recvq: 208104, sendq: 0, node: 44121 },
          { pid: 6120, fd: 21, proto: 'tcp', local: '0.0.0.0:9911', peer: '0.0.0.0:*', state: 'LISTEN', node: 44130 },
          // Established to a server that is no longer answering. No timeout set,
          // so it will sit here forever.
          { pid: 6120, fd: 28, proto: 'tcp', local: '10.14.22.62:44118', peer: '10.14.40.11:1521', state: 'ESTABLISHED', recvq: 0, sendq: 0, node: 44140 },
          { pid: 6120, fd: 33, proto: 'tcp', local: '10.14.22.62:9911', peer: '10.14.30.44:58120', state: 'ESTABLISHED', recvq: 0, sendq: 0, node: 44150 },
          { pid: 1611, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN', node: 44160 }
        ],

        netstat: {
          udpReceived: 8841200412, udpSent: 91204, udpErrors: 1840221, udpRcvbufErrors: 1840221,
          tcpActive: 41208, tcpPassive: 2204, tcpRetrans: 41, tcpReset: 12,
          pruneCalled: 90412
        },

        interfaces: [
          { name: 'eth0', addr: '10.14.22.62/24', mac: '00:50:56:9a:41:62', rxOk: 412009341, txOk: 388120044, rxBytes: 412004881200, txBytes: 388004881200 },
          // Feed NIC: counters climbing, no drops at the NIC. Data is arriving.
          { name: 'eth1', addr: '10.14.90.62/24', mac: '00:50:56:9a:41:63', rxOk: 8841200412, txOk: 9120, rxBytes: 1204881200440, txBytes: 891200, mcast: 8841200412, rxDrop: 0, bcast: '10.14.90.255',
            groups: [{ addr: '233.71.14.20', refcnt: 1 }, { addr: '233.71.14.21', refcnt: 1 }, { addr: '224.0.0.1', refcnt: 1 }] },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 88120, txOk: 88120, mtu: 65536 }
        ],

        hosts: {
          'refdata-db-ldn': { ip: '10.14.40.11', unreachable: true, ports: [] },
          'refdata-db-fra': { ip: '10.61.40.11', ports: [1521], rtt: 12.4, ttl: 61 },
          'localhost': { ip: '127.0.0.1', ports: [9911, 22], rtt: 0.02 },
          'ldn-mdata-prod02': { ip: '10.14.22.62', ports: [9911, 22], rtt: 0.02 }
        },

        http: {
          'localhost:9911/admin/health': function (world) {
            return JSON.stringify({
              status: world.flags.fixed ? 'UP' : 'UP',
              uptimeSeconds: Math.round((world.clock - new Date(2026, 8, 11, 6, 10, 4)) / 1000),
              feed: { joined: true, group: '233.71.14.20:14310', gaps: 0 },
              publisher: {
                lastPublishedSeq: world.flags.fixed ? 99870080 + Math.round((world.clock - froze) / 40) : 99870080,
                lastPublishedAt: world.flags.fixed ? W.isoStamp(world.clock) : W.isoStamp(froze),
                staleSeconds: world.flags.fixed ? 0 : Math.round((world.clock - froze) / 1000)
              },
              refdata: { endpoint: world.flags.fixed ? 'refdata-db-fra:1521' : 'refdata-db-ldn:1521', state: world.flags.fixed ? 'CONNECTED' : 'REFRESHING' }
            }, null, 2);
          },
          'localhost:9911/admin/feed/status': function (world) {
            return JSON.stringify({
              primary: { group: '233.71.14.20:14310', joined: true, packetsReceived: 8841200412, gapsDetected: 0, lastPacketAt: W.isoStamp(world.clock) },
              secondary: { group: '233.71.14.21:14310', joined: true, packetsReceived: 8840991204, gapsDetected: 0, lastPacketAt: W.isoStamp(world.clock) },
              consumerQueueDepth: world.flags.fixed ? 12 : 212992,
              note: world.flags.fixed ? 'ok' : 'consumer not draining'
            }, null, 2);
          },
          'localhost:9911/admin/refdata/failover': function (world) {
            if (world.flags.fixed) return '{"status":"ok","endpoint":"refdata-db-fra:1521"}';
            applyFailover(world);
            return JSON.stringify({
              status: 'ok',
              action: 'closed in-flight socket to refdata-db-ldn:1521, released InstrumentCache monitor',
              endpoint: 'refdata-db-fra:1521',
              instrumentsLoaded: 41208
            }, null, 2);
          }
        },

        services: {
          mdgw: {
            active: true, pid: 6120, exe: 'java', desc: 'EQD Market Data Gateway',
            since: new Date(2026, 8, 11, 6, 10, 4), tasks: 168, requiresRoot: false,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms16g -Xmx16g -jar /apps/mdgw/lib/mdgw.jar',
            log: ['TickPublisher - published seq=99870080 symbols=2841 lag=3ms']
          },
          sshd: { active: true, pid: 1611, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        ntp: {
          peers: [
            { remote: 'ntp1.ldn.internal', refid: '10.14.0.1', stratum: 2, when: 41, poll: 64, reach: 377, delay: 0.284, offset: 0.012, jitter: 0.041, selected: true },
            { remote: 'ntp2.ldn.internal', refid: '10.14.0.2', stratum: 2, when: 52, poll: 64, reach: 377, delay: 0.301, offset: -0.008, jitter: 0.038 }
          ]
        },

        tcpdump: function (world, argv) {
          // Proof the packets really are on the wire.
          var base = world.clock.getTime();
          var out = [];
          for (var i = 0; i < 8; i++) {
            var d = new Date(base - (8 - i) * 3);
            out.push(W.clockStr(d) + '.' + ('00000' + (i * 11412 % 999999)).slice(-6) +
              ' IP 196.4.12.' + (10 + i % 3) + '.14310 > 233.71.14.20.14310: UDP, length ' + (184 + i * 7));
          }
          out.push('8 packets captured');
          return out.join('\n');
        },

        flags: { fixed: false, dumpTaken: false, restarted: false },

        onService: function (world, verb, unit) {
          if (unit !== 'mdgw' && unit !== 'mdgw.service') return false;
          if (verb === 'restart') {
            world.flags.restarted = true;
            applyFailover(world, true);
            return true;
          }
          if (verb === 'stop') {
            world.flags.restarted = true;
            W.killProc(world, 6120);
            return true;
          }
          return false;
        },

        onKill: function (world, proc) {
          if (proc.pid === 6120) { world.flags.restarted = true; world.flags.killed = true; }
        },

        tick: function (world, seconds) {
          if (world.flags.fixed) return;
          // Queue keeps filling and the kernel keeps dropping: the staleness and
          // the loss counter both grow while you investigate.
          world.sockets.forEach(function (s) {
            if (s.proto === 'udp' && s.recvq != null) {
              s.recvq = Math.min(212992, s.recvq + 0);   // already at rmem_max, so...
            }
          });
          world.netstat.udpErrors += Math.round(1120 * seconds);
          world.netstat.udpRcvbufErrors += Math.round(1120 * seconds);
          world.interfaces[1].rxOk += Math.round(41200 * seconds);
          world.interfaces[1].mcast += Math.round(41200 * seconds);
        }
      });

      function applyFailover(world, viaRestart) {
        world.flags.fixed = true;
        var p = W.findProc(world, 6120);
        if (p) {
          p.threads.forEach(function (t) {
            if (t.state === 'BLOCKED') t.state = 'RUNNABLE';
            if (t.name === 'refdata-refresh-1') {
              t.state = 'TIMED_WAITING';
              t.stack = ['sun.misc.Unsafe.park(Native Method)',
                'java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1073)'];
            }
          });
          p.cpu = 11.4;
        }
        world.sockets = world.sockets.filter(function (s) { return !(s.pid === 6120 && s.peer === '10.14.40.11:1521'); });
        world.sockets.forEach(function (s) { if (s.proto === 'udp') s.recvq = 0; });
        if (!viaRestart) {
          world.sockets.push({ pid: 6120, fd: 28, proto: 'tcp', local: '10.14.22.62:44902', peer: '10.61.40.11:1521', state: 'ESTABLISHED', recvq: 0, sendq: 0 });
        }
        W.appendLog(world, '/var/log/mdgw/mdgw-app.log',
          W.isoStamp(world.clock, true) + ' INFO  [refdata-refresh-1] RefDataClient - failed over to refdata-db-fra:1521, 41208 instruments loaded');
        W.appendLog(world, '/var/log/mdgw/mdgw-app.log',
          W.isoStamp(world.clock, true) + ' INFO  [md-dispatch-1] TickPublisher - resumed, draining backlog');
      }

      return world;
    },

    discoveries: [
      {
        id: 'stale-confirmed',
        label: 'Confirmed the last publish was 08:47 and nothing since',
        when: function (o) {
          return (/08:47/.test(o.out) && /(tail|cat|grep|head|less)/.test(o.cmd)) ||
                 /staleSeconds/.test(o.out);
        }
      },
      {
        id: 'proc-alive',
        label: 'Process is alive and not CPU-bound or GC-thrashing',
        when: function (o) {
          return (/\b(top|ps|jstat)\b/.test(o.cmd) && /6120|java/.test(o.out));
        }
      },
      {
        id: 'feed-arriving',
        label: 'Proved market data IS still arriving on eth1',
        when: function (o) {
          return (/ip\s+-s|netstat\s+-\w*i|tcpdump|netstat\s+-g|ip\s+maddr/.test(o.cmd) && !/error/i.test(o.out)) ||
                 /packetsReceived/.test(o.out);
        }
      },
      {
        id: 'recvq-full',
        label: 'UDP receive queue is full - the app is not draining the socket',
        when: function (o) {
          return /\b(ss|netstat)\b/.test(o.cmd) && /\b21[0-9]{4}\b/.test(PS.world.stripColor(o.out));
        }
      },
      {
        id: 'udp-drops',
        label: 'Kernel is dropping packets: UDP receive buffer errors climbing',
        when: function (o) {
          return /receive buffer errors|packet receive errors/i.test(o.out);
        }
      },
      {
        id: 'thread-dump',
        label: 'Took a thread dump before touching anything',
        when: function (o) {
          return /\b(jstack|jcmd|kill\s+-3)\b/.test(o.cmd) && /Full thread dump|Thread.print|SIGQUIT/.test(o.out + o.cmd);
        }
      },
      {
        id: 'blocked-dispatch',
        label: 'Dispatch threads are BLOCKED on the InstrumentCache monitor',
        when: function (o) {
          return /BLOCKED/.test(o.out) && /InstrumentCache/.test(o.out);
        }
      },
      {
        id: 'lock-holder',
        label: 'The monitor is held by refdata-refresh-1, stuck in socketRead0',
        when: function (o) {
          return /socketRead0/.test(o.out) && /refdata/i.test(o.out);
        }
      },
      {
        id: 'downstream-dead',
        label: 'refdata-db-ldn is unreachable, and the client has no socket timeout',
        when: function (o) {
          return (/refdata-db-ldn|10\.14\.40\.11/.test(o.cmd + o.out) &&
                  /100% packet loss|timed out|timeout=0|socket.timeout/i.test(o.out)) ||
                 /refdata\.socket\.timeout=0/.test(o.out);
        }
      }
    ],

    rootCauses: [
      { text: 'The exchange stopped publishing, or we dropped out of the multicast group, so no ticks are arriving.' },
      { text: 'The gateway is in a long garbage-collection pause / has run out of heap.' },
      { text: 'A reference-data refresh is hung in a socket read with no timeout while holding the instrument cache lock, so the feed and dispatch threads are BLOCKED and the UDP socket is never drained.', correct: true },
      { text: 'The NIC on eth1 is dropping multicast packets because the receive ring buffer is too small.' },
      { text: 'The publisher TCP socket to the downstream blotter is blocked, applying back pressure to the dispatcher.' },
      { text: 'A Java-level deadlock between the two md-dispatch threads.' }
    ],

    fix: {
      prompt: 'Get prices flowing again. The desk head wants a root cause in writing, so preserve the evidence.',
      check: function (world) { return world.flags.fixed === true; },
      grade: function (world) {
        if (world.flags.killed) {
          return {
            quality: 'blunt', bonus: -150,
            note: 'kill -9 on the gateway did clear the hang, but you destroyed the evidence\n' +
              'the desk head asked for and took prices down hard. The runbook failover\n' +
              'would have fixed it in two seconds with no outage.'
          };
        }
        if (world.flags.restarted) {
          return {
            quality: 'blunt', bonus: world.flags.dumpTaken ? 60 : -40,
            note: 'Restarting mdgw cleared the hang - the stuck socket died with the process.\n' +
              'It cost ~40 seconds of no prices, and it will happen again at the next\n' +
              'HH:47 refresh because refdata-db-ldn is still down. The runbook failover\n' +
              '(curl http://localhost:9911/admin/refdata/failover) fixes it with no outage\n' +
              'and moves you onto the healthy Frankfurt replica.' +
              (world.flags.dumpTaken ? '\n\nYou did take a thread dump first, which is what saved the post-mortem.' : '')
          };
        }
        return {
          quality: 'clean', bonus: 300,
          note: 'You failed the refdata client over to Frankfurt without restarting the\n' +
            'gateway. The stuck socket was closed, the InstrumentCache monitor was\n' +
            'released, the blocked threads resumed and the backlog drained. No outage,\n' +
            'and the thread dump is on disk for the write-up.'
        };
      }
    },

    hints: [
      'Nothing is "down", so stop looking for something that is down. Split the question in two: is data arriving at this box, and is the application consuming it? Those are different commands.',
      'A UDP socket with a large, static Recv-Q means the kernel has data the application never read. Try: ss -uanp | grep 14310   and   netstat -su',
      'The application is not reading its socket because its threads cannot run. Take a thread dump (jstack 6120) and look for BLOCKED - then find which thread holds the monitor they are all waiting for.',
      'refdata-refresh-1 holds the lock and is parked in socketRead0 against refdata-db-ldn, which is not answering. Read /home/gsupport/runbook-mdgw.txt - there is a failover you can call without a restart.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'An hourly reference-data refresh took the InstrumentCache monitor, then issued\n' +
      'a query to refdata-db-ldn. That host stopped answering without closing the\n' +
      'connection (a firewall drop, or a fenced cluster node). Because the client was\n' +
      'configured with refdata.socket.timeout=0, the read blocked forever - holding\n' +
      'the lock forever. Every feed and dispatch thread then blocked behind it, the\n' +
      'UDP socket stopped being drained, the kernel buffer filled, and the desk saw\n' +
      'frozen prices. The process never crashed and never logged an error, which is\n' +
      'precisely why the monitoring said everything was fine.\n\n' +
      'THE TRIAGE THAT WORKS\n' +
      '  1. Is data arriving?      ip -s link / netstat -g / tcpdump on the feed NIC\n' +
      '  2. Is the app consuming?  ss -uanp  (Recv-Q pinned high = not draining)\n' +
      '  3. Is the loss real?      netstat -su  (receive buffer errors climbing)\n' +
      '  4. Why is it not consuming?  jstack <pid>, look for BLOCKED\n' +
      '  5. Who holds the lock?    find the "- locked <0x...>" that matches the\n' +
      '                            "- waiting to lock <0x...>" of the blocked threads\n' +
      '  6. What is that thread doing?  socketRead0 = waiting on the network\n\n' +
      'TAKE THE DUMP BEFORE YOU BOUNCE\n' +
      'A restart clears the symptom and destroys the evidence. On a P1 with a written\n' +
      'root cause required, jstack <pid> > /tmp/mdgw.tdump costs you two seconds and\n' +
      'is the difference between a post-mortem and a guess. Take two dumps ten\n' +
      'seconds apart if you want to prove a thread is stuck rather than just slow.\n\n' +
      'INTERVIEW ANGLE\n' +
      '"The application is up but the data is frozen" is a favourite question because\n' +
      'the naive answer (restart it) gets you nothing. What they want to hear: prove\n' +
      'whether the data is arriving, prove whether the app is reading it, take a\n' +
      'thread dump, identify the lock holder, and only then decide on an action -\n' +
      'preferring one that does not lose state. Bonus points for naming the missing\n' +
      'socket timeout as the real defect, not the hung database.'
  });
})(PS);
