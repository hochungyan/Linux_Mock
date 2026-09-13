/* Scenario: one strategy is flooding the venue and the whole firm is about to
 * be throttled off it.
 *
 * Everything here is about blast radius. There is a big red button that stops
 * all algo flow for every client, and there is a smaller one that stops the
 * single strategy actually causing it. Finding which strategy is the work.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'algo-runaway-orders',
    title: 'Venue throttling us, order rate through the roof',
    severity: 'P1',
    desk: 'Electronic Trading / Algo Execution',
    host: 'ldn-algo-prod07',
    tags: ['algo', 'order rate', 'kill switch', 'blast radius', 'log analysis'],
    par: 440,
    impactPerMin: 88000,
    currency: 'GBP',

    brief:
      'PAGER 10:26 - from the Algo desk, with Market Access Risk on the line\n\n' +
      'DESK: "XLON have called. They say we are breaching our message rate limit\n' +
      'and they will disconnect the session if it continues. We are also getting\n' +
      'throttle rejects back."\n\n' +
      'RISK: "Our order-to-trade ratio has gone from 8 to over 300 this morning.\n' +
      'If that stands at the close it is a regulatory conversation."\n\n' +
      'There are fourteen strategies live on this gateway across nine clients.\n' +
      'There is a global kill switch. Using it stops every client we have.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 10, 26, 40);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var changedAt = new Date(2026, 8, 11, 9, 14, 22);

      /* The order log. One strategy dominates by two orders of magnitude, but
       * you have to count to see it - reading the tail just shows noise. */
      var counts = [
        ['VWAP_EU_07', 240, 'CLIENT-0418', 'VOD.L'],
        ['TWAP_UK_01', 14, 'CLIENT-0102', 'BP.L'],
        ['POV_EU_03', 9, 'CLIENT-0290', 'SAN.MC'],
        ['ICEBERG_UK_02', 6, 'CLIENT-0511', 'HSBA.L']
      ];
      var rows = [];
      var seq = 8841000;
      counts.forEach(function (c) {
        for (var i = 0; i < c[1]; i++) {
          var d = new Date(t0.getTime() - (c[1] - i) * 9000 / c[1]);
          rows.push(W.isoStamp(d, true) + ' NEW ' + c[0] + ' ORD-' + (seq++) + ' ' +
            c[3] + ' ' + c[2] + ' 1 2500 71.24');
        }
      });
      // interleave so the tail is not one strategy only
      rows.sort(function (a, b) { return a.slice(0, 23) < b.slice(0, 23) ? -1 : 1; });
      var orderLog = rows.join('\n');

      var appLog = [
        W.isoStamp(ago(7200)) + ' INFO  [main] AlgoGateway - started, 14 strategies across 9 clients',
        W.isoStamp(changedAt) + ' INFO  [admin] ConfigService - strategy VWAP_EU_07 parameters updated by k.mercer: participation=100 (was 10), maxChildQty=2500',
        W.isoStamp(new Date(changedAt.getTime() + 600000)) + ' WARN  [rate-mon] RateMonitor - VWAP_EU_07 child order rate 41/s, strategy limit 4/s',
        W.isoStamp(ago(1800)) + ' WARN  [session-XLON] Session - venue throttle: 34=Reject 58=Order rate exceeded for firm',
        W.isoStamp(ago(600)) + ' ERROR [rate-mon] RateMonitor - firm order-to-trade ratio 312 (limit 100)',
        W.isoStamp(ago(60)) + ' WARN  [session-XLON] Session - venue throttle: 34=Reject 58=Order rate exceeded for firm'
      ].join('\n');

      var root = V.dir({
        apps: V.dir({
          algo: V.dir({
            conf: V.dir({
              'strategies.conf': V.file(
                '# strategy            client         participation  maxChildQty  rateLimit\n' +
                'VWAP_EU_07            CLIENT-0418    100            2500         4\n' +
                'TWAP_UK_01            CLIENT-0102    10             1000         4\n' +
                'POV_EU_03             CLIENT-0290    15             1500         4\n' +
                'ICEBERG_UK_02         CLIENT-0511    5              500          4\n',
                { owner: 'algoadm', mtime: changedAt }),
              'gateway.properties': V.file(
                'admin.port=9600\nvenue=XLON\nfirm.rate.limit=200\nfirm.otr.limit=100\n',
                { owner: 'algoadm', mtime: ago(900000) })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            algo: V.dir({
              'orders.log': V.file(orderLog, { owner: 'algoadm', mtime: ago(5), size: 2400 * MB }),
              'algo-gateway.log': V.file(appLog, { owner: 'algoadm', mtime: ago(60), size: 640 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-algo-gateway.txt': V.file(
              'ALGO GATEWAY RUNBOOK\n' +
              '====================\n' +
              'WHEN A VENUE THROTTLES US\n' +
              '  The firm shares one message rate budget across every strategy and\n' +
              '  every client on the session. One misbehaving strategy consumes it\n' +
              '  and everyone else gets throttled. Find WHICH one before you act.\n' +
              '\n' +
              '    awk \'{print $4}\' /var/log/algo/orders.log | sort | uniq -c | sort -rn | head\n' +
              '      ($1 date, $2 time, $3 action, $4 strategy)\n' +
              '    curl http://localhost:9600/admin/rates\n' +
              '\n' +
              'CONTAINMENT, IN ORDER OF PREFERENCE\n' +
              '  1. Pause the offending strategy only:\n' +
              '        curl http://localhost:9600/admin/strategy/<NAME>/pause\n' +
              '     Stops new child orders from that strategy. Its parent order is\n' +
              '     kept and can be resumed or worked manually. Every other client\n' +
              '     carries on trading normally.\n' +
              '\n' +
              '  2. Global kill switch:\n' +
              '        curl http://localhost:9600/admin/killswitch\n' +
              '     Stops ALL algo flow for ALL nine clients, cancels their working\n' +
              '     orders, and requires desk head sign-off to re-enable. This is for\n' +
              '     "we do not know what is wrong and it is getting worse". It is not\n' +
              '     for "one strategy is misbehaving and we know which".\n' +
              '\n' +
              '  3. Restarting the gateway is the worst of both: every client loses\n' +
              '     their working orders AND nobody knows what state the venue\n' +
              '     thinks we are in. Do not.\n' +
              '\n' +
              'AFTER CONTAINING\n' +
              '  Check /apps/algo/conf/strategies.conf against what was approved.\n' +
              '  Parameter changes are logged in algo-gateway.log by ConfigService\n' +
              '  with the user who made them.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-algo-prod07', user: 'gsupport', clock: t0, seed: 312,
        bootSeconds: 3600 * 24 * 23, cores: 16, users: 5,
        load: [6.42, 5.18, 3.94],
        mem: { total: 64 * GB, free: 30 * GB, buffers: 220 * MB, cached: 8 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 44.2, sy: 6.1, ni: 0, id: 49.4, wa: 0.3, st: 0 },
        root: root,

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 13 * GB, inodes: { total: 26214400, used: 190402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 300 * GB, used: 62 * GB, inodes: { total: 157286400, used: 34120 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 1020 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 420 }),
          W.proc({ pid: 1614, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 24 }),
          W.proc({ pid: 7420, user: 'algoadm', short: 'java', state: 'R', cpu: 412.0, rss: 22 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms20g -Xmx20g -jar /apps/algo/lib/algo-gateway.jar',
            started: new Date(2026, 8, 11, 6, 30, 0), cpuSeconds: 18400,
            fds: [{ fd: 1, path: '/var/log/algo/algo-gateway.log', mode: 'w', size: 640 * MB }],
            jvm: { name: 'algo-gateway.jar', mainClass: 'com.ib.algo.Gateway', heapMax: 20 * GB, heapUsed: 7 * GB,
              gcStats: { ygc: 41208, ygct: 188.4, fgc: 0, fgct: 0, old: 28.4, eden: 62.1 } },
            threads: [
              W.thread({ tid: 7430, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 4 }),
              W.thread({ tid: 7461, name: 'strategy-VWAP_EU_07', state: 'RUNNABLE', cpu: 96.4, cpuSeconds: 8412,
                stack: ['com.ib.algo.vwap.VwapEngine.sliceChild(VwapEngine.java:412)',
                  'com.ib.algo.core.StrategyRunner.run(StrategyRunner.java:188)'] }),
              W.thread({ tid: 7462, name: 'strategy-TWAP_UK_01', state: 'RUNNABLE', cpu: 3.2, cpuSeconds: 204 }),
              W.thread({ tid: 7463, name: 'strategy-POV_EU_03', state: 'RUNNABLE', cpu: 2.8, cpuSeconds: 188 }),
              W.thread({ tid: 7470, name: 'session-XLON-out', state: 'RUNNABLE', cpu: 88.2, cpuSeconds: 6120 })
            ] }),
          W.proc({ pid: 22800, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 7420, fd: 11, proto: 'tcp', local: '0.0.0.0:9600', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 7420, fd: 28, proto: 'tcp', local: '10.14.22.94:44120', peer: '196.4.12.20:9401', state: 'ESTABLISHED', sendq: 184320, recvq: 0 },
          { pid: 1614, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        netstat: { tcpActive: 88213, tcpRetrans: 4120, tcpReset: 88, udpErrors: 0 },
        diskio: [{ dev: 'dm-1', rs: 4.1, ws: 880.2, readKB: 62.4, writeKB: 44120.1, await: 4.2, util: 42.1 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.94/24', rxOk: 1204881200, txOk: 4412008841, rxBytes: 220048812004, txBytes: 881200441200 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 88120, txOk: 88120, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [9600, 22], rtt: 0.02 } },

        http: {
          'localhost:9600/admin/rates': function (world) {
            var f = world.flags;
            return JSON.stringify({
              firmOrderRatePerSec: f.contained ? 12 : 268,
              firmRateLimit: 200,
              orderToTradeRatio: f.contained ? 9 : 312,
              otrLimit: 100,
              strategies: [
                { name: 'VWAP_EU_07', client: 'CLIENT-0418', state: f.pausedStrategy ? 'PAUSED' : 'RUNNING', ordersPerSec: f.pausedStrategy ? 0 : 241, limit: 4 },
                { name: 'TWAP_UK_01', client: 'CLIENT-0102', state: f.killSwitch ? 'HALTED' : 'RUNNING', ordersPerSec: f.killSwitch ? 0 : 4, limit: 4 },
                { name: 'POV_EU_03', client: 'CLIENT-0290', state: f.killSwitch ? 'HALTED' : 'RUNNING', ordersPerSec: f.killSwitch ? 0 : 3, limit: 4 },
                { name: 'ICEBERG_UK_02', client: 'CLIENT-0511', state: f.killSwitch ? 'HALTED' : 'RUNNING', ordersPerSec: f.killSwitch ? 0 : 2, limit: 4 }
              ]
            }, null, 2);
          },
          'localhost:9600/admin/strategy/VWAP_EU_07/pause': function (world) {
            world.flags.pausedStrategy = 'VWAP_EU_07';
            world.flags.contained = true;
            applyContain(world);
            return JSON.stringify({
              status: 'ok', strategy: 'VWAP_EU_07', state: 'PAUSED',
              childOrdersCancelled: 412, parentOrderRetained: true,
              otherStrategiesAffected: 0,
              note: 'parent order preserved; desk can resume or work it manually'
            }, null, 2);
          },
          'localhost:9600/admin/killswitch': function (world) {
            world.flags.killSwitch = true;
            world.flags.contained = true;
            applyContain(world);
            return JSON.stringify({
              status: 'ok', action: 'GLOBAL KILL SWITCH ENGAGED',
              strategiesHalted: 14, clientsAffected: 9,
              workingOrdersCancelled: 1842,
              note: 'desk head sign-off required to re-enable'
            }, null, 2);
          }
        },

        services: {
          'algo-gateway': {
            active: true, pid: 7420, exe: 'java', desc: 'Algo Execution Gateway',
            since: new Date(2026, 8, 11, 6, 30, 0), requiresRoot: false,
            log: ['RateMonitor - firm order-to-trade ratio 312 (limit 100)']
          },
          sshd: { active: true, pid: 1614, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { contained: false, pausedStrategy: null, killSwitch: false, bounced: false },

        onService: function (world, verb, unit) {
          if (String(unit).replace(/\.service$/, '') !== 'algo-gateway') return false;
          if (verb === 'restart' || verb === 'stop') {
            world.flags.bounced = true;
            world.flags.contained = true;
            applyContain(world);
            W.killProc(world, 7420);
            return true;
          }
          return false;
        },

        onKill: function (world, proc) {
          if (proc.pid === 7420) { world.flags.bounced = true; world.flags.killedRaw = true; world.flags.contained = true; applyContain(world); }
        },

        tick: function (world, seconds) {
          if (world.flags.contained) return;
          world.notes.t = (world.notes.t || 0) + seconds;
          if (world.notes.t % 20 < 1) {
            W.appendLog(world, '/var/log/algo/algo-gateway.log',
              W.isoStamp(world.clock) + ' WARN  [session-XLON] Session - venue throttle: 34=Reject 58=Order rate exceeded for firm');
          }
        }
      });

      function applyContain(world) {
        var p = W.findProc(world, 7420);
        if (p) {
          p.cpu = 38.0;
          if (p.threads && p.threads[1]) { p.threads[1].cpu = 0.4; p.threads[1].state = 'TIMED_WAITING'; }
          if (p.threads && p.threads[4]) p.threads[4].cpu = 6.2;
        }
        world.cpu = { us: 6.1, sy: 1.4, ni: 0, id: 92.3, wa: 0.2, st: 0 };
        world.sockets.forEach(function (s) { if (s.sendq) s.sendq = 0; });
      }

      return world;
    },

    discoveries: [
      { id: 'throttle-seen', label: 'The venue is rejecting us with "Order rate exceeded"',
        when: function (o) { return /Order rate exceeded/i.test(o.out); } },
      { id: 'otr-breach', label: 'Firm order-to-trade ratio is over the limit',
        when: function (o) { return /order-to-trade|orderToTradeRatio/i.test(o.out); } },
      { id: 'strategy-found', label: 'VWAP_EU_07 is producing almost all of the order flow',
        when: function (o) { return /VWAP_EU_07/.test(o.out) && /\b2[0-9]{2}\b/.test(PS.world.stripColor(o.out)); } },
      { id: 'counted-not-guessed', label: 'Counted orders per strategy rather than guessing',
        when: function (o) { return /uniq\s+-c|\/admin\/rates/.test(o.cmd) && /VWAP_EU_07/.test(o.out); } },
      { id: 'others-normal', label: 'The other strategies are within their limits',
        when: function (o) { return /TWAP_UK_01/.test(o.out) && /POV_EU_03/.test(o.out); } },
      { id: 'param-change', label: 'Participation was changed to 100 at 09:14 by k.mercer',
        when: function (o) { return /participation=100|k\.mercer/.test(o.out); } },
      { id: 'config-confirms', label: 'strategies.conf confirms VWAP_EU_07 at participation 100',
        when: function (o) { return /VWAP_EU_07\s+CLIENT-0418\s+100/.test(PS.world.stripColor(o.out)); } },
      { id: 'hot-thread', label: 'The strategy thread is the one burning CPU',
        when: function (o) { return /strategy-VWAP_EU_07/.test(o.out); }, optional: true },
      { id: 'blast-radius', label: 'Established that the kill switch would stop all nine clients',
        when: function (o) { return /clientsAffected|stops every client|ALL nine clients|ALL algo flow/i.test(o.out); }, optional: true }
    ],

    rootCauses: [
      { text: 'The venue has reduced our message rate allowance without notice.' },
      { text: 'A parameter change at 09:14 set VWAP_EU_07 participation to 100 instead of 10, so it slices far more aggressively and is consuming the firm-wide message rate budget on its own.', correct: true },
      { text: 'The gateway is in a retry loop because the venue session keeps dropping.' },
      { text: 'Market volatility has increased order flow across all strategies.' },
      { text: 'The gateway has run out of heap and is resending orders it thinks failed.' },
      { text: 'A client is submitting far more parent orders than usual.' }
    ],

    fix: {
      prompt: 'Get the firm back inside the venue rate limit. There are nine clients on this gateway and eight of them are behaving.',
      check: function (world) { return world.flags.contained === true; },
      grade: function (world) {
        if (world.flags.killedRaw || world.flags.bounced) {
          return { quality: 'blunt', bonus: -400,
            note: 'Bouncing the gateway stopped the flood - and cancelled 1,842 working\n' +
              'orders across all nine clients, with the venue left uncertain what we\n' +
              'still have live. Reconciling that by hand will take the desk the rest of\n' +
              'the morning, and none of those eight other clients had done anything\n' +
              'wrong.\n\n' +
              'One HTTP call to pause VWAP_EU_07 would have fixed it with nobody else\n' +
              'noticing.' };
        }
        if (world.flags.killSwitch) {
          return { quality: 'blunt', bonus: -120,
            note: 'The global kill switch worked, and it was a defensible call under time\n' +
              'pressure - but it halted 14 strategies for 9 clients and cancelled 1,842\n' +
              'working orders, and it now needs desk head sign-off to re-enable.\n\n' +
              'You had already narrowed it to one strategy. The kill switch is for "we\n' +
              'do not know what is wrong and it is getting worse" - not for "we know\n' +
              'exactly which strategy it is". Pausing VWAP_EU_07 alone would have left\n' +
              'the other eight clients trading.' };
        }
        return { quality: 'clean', bonus: 360,
          note: 'You identified the single offending strategy and paused only that one.\n' +
            'Firm order rate dropped from 268/s to 12/s, the order-to-trade ratio is\n' +
            'back to 9, the venue stopped throttling, and the other eight clients never\n' +
            'knew anything had happened. The parent order was preserved so the desk can\n' +
            'work it manually.\n\n' +
            'You also have the cause for the write-up: a participation parameter changed\n' +
            'to 100 at 09:14.' };
      }
    },

    hints: [
      'Before you reach for any switch, find out how wide the problem is. Is this every strategy, or one? The order log has a strategy field on every line.',
      'Count, do not read. Each line is "date time action strategy ordid ...", so the strategy is the 4th field: awk \'{print $4}\' /var/log/algo/orders.log | sort | uniq -c | sort -rn. Or ask the gateway directly: curl http://localhost:9600/admin/rates',
      'VWAP_EU_07 is producing roughly 240 of the last 269 orders. Now find out why - grep the gateway log for ConfigService, and compare /apps/algo/conf/strategies.conf against the other strategies.',
      'The runbook has two buttons and they are very different sizes. Read /home/gsupport/runbook-algo-gateway.txt and use the smaller one: curl http://localhost:9600/admin/strategy/VWAP_EU_07/pause'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'A parameter change at 09:14 set VWAP_EU_07 participation to 100 instead of\n' +
      '10 - a single digit. The strategy started trying to take 100% of market\n' +
      'volume, slicing child orders roughly sixty times faster than its own rate\n' +
      'limit. The firm shares one message rate budget with the venue, so one\n' +
      'strategy consumed it and the other eight clients got throttled with it.\n\n' +
      'BLAST RADIUS IS THE WHOLE SKILL HERE\n' +
      '  pause one strategy   1 client affected, parent order retained\n' +
      '  global kill switch   14 strategies, 9 clients, 1,842 orders cancelled,\n' +
      '                       desk head sign-off to re-enable\n' +
      '  restart the gateway  all of the above, plus the venue and our book\n' +
      '                       disagree about what is live\n' +
      'All three stop the flood. They are not equivalent, and the difference is\n' +
      'the entire job. The kill switch exists for when you do NOT know the cause -\n' +
      'using it when you do is an admission you did not look.\n\n' +
      'COUNT, DO NOT READ\n' +
      'Tailing the order log shows a blur of orders from several strategies. One\n' +
      'awk-and-count pipeline shows 240 from one strategy and 29 from everything\n' +
      'else combined. Under pressure, the instinct to read logs rather than\n' +
      'aggregate them is what costs the time.\n\n' +
      '    awk \'{print $4}\' orders.log | sort | uniq -c | sort -rn | head\n\n' +
      'THEN FIND THE CHANGE\n' +
      'Containment is not root cause. ConfigService logs every parameter change\n' +
      'with the user who made it, and strategies.conf shows VWAP_EU_07 sitting at\n' +
      'participation 100 while every comparable strategy is at 5 to 15. That is\n' +
      'what goes in the incident report - and it is also why this ends as a change\n' +
      'control conversation, not a technology one.\n\n' +
      'INTERVIEW ANGLE\n' +
      'Expect "an algo is misbehaving, what do you do?". The weak answer is "pull\n' +
      'the kill switch". The strong answer is: quantify it, identify the single\n' +
      'strategy, contain with the smallest action that works, preserve the parent\n' +
      'order, then find the change that caused it. Mentioning order-to-trade ratio\n' +
      'and market access risk shows you know why the venue cares.'
  });
})(PS);
