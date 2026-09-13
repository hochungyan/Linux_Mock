/* Scenario: today's trades are not reaching settlement.
 *
 * The consumer is running and attached. The queue is backing up anyway, because
 * ONE message at the head of the queue fails, rolls back, and is redelivered -
 * forever in this single-consumer fixture. Head-of-line blocking.
 * BOTHRESH/BOQNAME are policy attributes: the application/JMS layer moves
 * poison messages, not the queue manager. The fictional adapter refreshes
 * that policy live; ordinary IBM MQ classes for JMS cache these attributes.
 * Sources: https://www.ibm.com/docs/en/ibm-mq/9.3.x?topic=reference-define-queues
 * https://www.ibm.com/docs/SSFKSJ_9.2.0/com.ibm.mq.dev.doc/q032280_.html
 * AMQ7234 is recovery progress, not a poison-message alert:
 * https://www.ibm.com/docs/en/ibm-mq/9.2.x?topic=lost-using-checkpointing-ensure-complete-recovery
 *
 * The trap is that restarting the consumer looks like the obvious move and
 * changes nothing at all: the same message is still first in the queue.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'mq-poison-settlement',
    title: 'Trades not reaching settlement, queue backing up',
    severity: 'P1',
    desk: 'Operations / Post-Trade Settlement',
    host: 'ldn-mq-prod04',
    tags: ['IBM MQ', 'poison message', 'STP break', 'settlement', 'backout queue'],
    par: 480,
    impactPerMin: 33000,
    currency: 'GBP',

    brief:
      'PAGER 15:10 - from Settlements Ops\n\n' +
      '"Nothing has settled since about 13:20. Front office says the trades are\n' +
      'booked and we can see them in the blotter, but nothing is reaching the\n' +
      'settlement system. Our queue monitor is red - TRADE.TO.SETTLE is at four\n' +
      'thousand and climbing.\n\n' +
      'Middleware team say the queue manager is healthy and the consumer is\n' +
      'connected, so they have handed it back to us."\n\n' +
      'For this fictional desk, the instruction deadline is 16:00. Missing it\n' +
      'risks settlement fails and claims; this is not a universal CREST cutoff.\n\n' +
      'These are real client trades. Do not lose any of them.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 15, 10, 20);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var stuckAt = new Date(2026, 8, 11, 13, 19, 44);

      // The adapter log: the same trade, over and over, with a rollback each
      // time. Nothing else gets a look in.
      var appLog = [
        W.isoStamp(ago(9000)) + ' INFO  [settle-1] SettlementAdapter - instructed TRD-8841204 ISIN GB00B03MLX29 CCY GBP',
        W.isoStamp(ago(8400)) + ' INFO  [settle-1] SettlementAdapter - instructed TRD-8841205 ISIN US0378331005 CCY USD',
        W.isoStamp(ago(7200)) + ' INFO  [settle-1] SettlementAdapter - instructed TRD-8841206 ISIN FR0000131104 CCY EUR'
      ];
      for (var i = 0; i < 9; i++) {
        var t = new Date(stuckAt.getTime() + i * 780000 / 9);
        appLog.push(W.isoStamp(t) + ' ERROR [settle-1] SettlementAdapter - failed to build instruction for TRD-8841207');
        appLog.push('java.lang.NullPointerException: no standing settlement instruction for ISIN XS2434891827 / place XPAR');
        appLog.push('\tat com.ib.settle.SsiResolver.resolve(SsiResolver.java:118)');
        appLog.push('\tat com.ib.settle.SettlementAdapter.onMessage(SettlementAdapter.java:242)');
        appLog.push(W.isoStamp(new Date(t.getTime() + 400)) + ' WARN  [settle-1] SettlementAdapter - transaction rolled back, message returned to queue');
      }

      var poisonBody =
        '<TradeInstruction>\n' +
        '  <TradeId>TRD-8841207</TradeId>\n' +
        '  <TradeDate>2026-09-11</TradeDate>\n' +
        '  <SettlementDate>2026-09-15</SettlementDate>\n' +
        '  <ISIN>XS2434891827</ISIN>\n' +
        '  <PlaceOfSettlement>XPAR</PlaceOfSettlement>\n' +
        '  <Quantity>250000</Quantity>\n' +
        '  <Currency>EUR</Currency>\n' +
        '  <Counterparty>CPTY-00418</Counterparty>\n' +
        '</TradeInstruction>';

      var root = V.dir({
        apps: V.dir({
          settle: V.dir({
            lib: V.dir({ 'settle-adapter.jar': V.file('', { size: 42 * MB, owner: 'mqadm', mtime: ago(900000) }) }),
            conf: V.dir({
              'adapter.properties': V.file(
                'qmgr=QM.TRADE.LDN\n' +
                'input.queue=TRADE.TO.SETTLE\n' +
                'output.queue=SETTLE.INSTRUCTIONS\n' +
                'transaction.mode=syncpoint      # message is rolled back on failure\n' +
                '# Fictional adapter capability: refresh BOTHRESH/BOQNAME on each retry;\n' +
                '# move eligible messages transactionally to the pre-authorised BOQ.\n' +
                'ssi.source=REFDATA.SSI\n',
                { owner: 'mqadm', mtime: ago(900000) })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            settle: V.dir({
              'settle-adapter.log': V.file(appLog.join('\n'),
                { owner: 'mqadm', mtime: ago(15), size: 1840 * MB })
            }),
            messages: V.file('Sep 11 13:00:01 ldn-mq-prod04 systemd: Started Session 8412.',
              { owner: 'root', mtime: ago(7800), size: 60 * MB })
          }),
          mqm: V.dir({
            qmgrs: V.dir({ 'QM!TRADE!LDN': V.dir({ errors: V.dir({
              'AMQERR01.LOG': V.file(
                W.syslogStamp(ago(600)) + ' - Process(9120.4) User(mqm) Program(amqzlaa0)\n' +
                'SIMULATED HEALTH SUMMARY: queue manager running; inspect adapter logs for repeated rollbacks.',
                { owner: 'mqm', mtime: ago(600), size: 12 * MB })
            }) }) })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-settlement-mq.txt': V.file(
              'SETTLEMENT ADAPTER / MQ RUNBOOK\n' +
              '===============================\n' +
              'FLOW\n' +
              '  Booking -> TRADE.TO.SETTLE -> settle-adapter -> SETTLE.INSTRUCTIONS\n' +
              '  The adapter reads under syncpoint: if it throws, the transaction is\n' +
              '  rolled back and the message becomes available again. This fixture\n' +
              '  has one consumer repeatedly receiving the same head message.\n' +
              '\n' +
              'DIAGNOSING A QUEUE THAT IS BACKING UP\n' +
              '  echo "DIS QL(TRADE.TO.SETTLE)" | runmqsc QM.TRADE.LDN\n' +
              '      CURDEPTH  how many are waiting\n' +
              '      IPPROCS   input-open handle count; 1 does not prove progress.\n' +
              '                Correlate with BackoutCount and application logs.\n' +
              '      BOTHRESH  backout policy threshold used by the consumer/JMS.\n' +
              '                0 disables threshold-based poison handling in JMS\n' +
              '                and in this adapter, which consequently retries.\n' +
              '      BOQNAME   destination used by that handler when BackoutCount\n' +
              '                reaches or exceeds a positive BOTHRESH.\n' +
              '\n' +
              '  amqsbcg QUEUE QMGR   browses messages WITHOUT consuming them.\n' +
              '      Read BackoutCount on the first message. A high count means that\n' +
              '      message has been backed out repeatedly. Confirm the repeated\n' +
              '      application error before diagnosing a poison message.\n' +
              '\n' +
              'FIXING A POISON MESSAGE LOOP\n' +
              '  BOTHRESH/BOQNAME alone do not move messages. The queue manager\n' +
              '  maintains BackoutCount; an application or JMS handler does the move.\n' +
              '  IBM MQ classes for JMS cache these attributes after first querying\n' +
              '  them: do not assume ALTER refreshes an existing JMS consumer.\n' +
              '  FICTIONAL ADAPTER CAPABILITY: this adapter re-queries the policy on\n' +
              '  each retry and transactionally quarantines an eligible message.\n' +
              '  TRADE.TO.SETTLE.BOQ exists and its required authorities are already\n' +
              '  granted in this fixture. Enable that adapter policy with:\n' +
              '\n' +
              '     echo "ALTER QL(TRADE.TO.SETTLE) BOTHRESH(5) BOQNAME(TRADE.TO.SETTLE.BOQ)" | runmqsc QM.TRADE.LDN\n' +
              '\n' +
              '  The backlog then drains, and the single bad trade is preserved on the\n' +
              '  backout queue for Ops to repair and replay.\n' +
              '\n' +
              'NEVER use CLEAR QLOCAL on a trade queue. It discards every message.\n' +
              '  Those are client trades; this fixture provides no replay source.\n' +
              '\n' +
              'Restarting without changing policy or fixing the SSI does NOT help.\n' +
              '  The same message remains available for this consumer to retry.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-mq-prod04', user: 'gsupport', clock: t0, seed: 4182,
        bootSeconds: 3600 * 24 * 73, cores: 8, users: 4,
        load: [0.92, 0.88, 0.81],
        mem: { total: 32 * GB, free: 18 * GB, buffers: 220 * MB, cached: 6 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 8.4, sy: 1.8, ni: 0, id: 89.6, wa: 0.2, st: 0 },
        root: root,

        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB, inodes: { total: 26214400, used: 190402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 38 * GB, inodes: { total: 104857600, used: 44120 } },
          { dev: '/dev/mapper/vg01-mqm', mount: '/var/mqm', type: 'xfs', size: 100 * GB, used: 22 * GB, inodes: { total: 52428800, used: 12004 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 980 } }
        ],

        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 620 }),
          W.proc({ pid: 1612, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 22 }),
          W.proc({ pid: 9120, user: 'mqm', short: 'amqzxma0', cpu: 2.1, rss: 220 * MB,
            cmd: '/opt/mqm/bin/amqzxma0 -m QM.TRADE.LDN', started: new Date(2026, 8, 1, 5, 0, 0), cpuSeconds: 8412 }),
          // The adapter is alive and busy - burning CPU retrying the same message.
          W.proc({ pid: 11204, user: 'mqadm', short: 'java', cpu: 38.4, rss: 3 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx3g -jar /apps/settle/lib/settle-adapter.jar',
            started: new Date(2026, 8, 11, 6, 5, 0), cpuSeconds: 4120,
            fds: [{ fd: 1, path: '/var/log/settle/settle-adapter.log', mode: 'w', size: 1840 * MB }],
            jvm: { name: 'settle-adapter.jar', mainClass: 'com.ib.settle.Adapter',
              heapMax: 3 * GB, heapUsed: 900 * MB,
              stdoutLog: '/var/log/settle/settle-adapter.log',
              gcStats: { ygc: 4120, ygct: 22.4, fgc: 0, fgct: 0, old: 14.2, eden: 28.1 } },
            threads: [
              W.thread({ tid: 11210, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 2,
                stack: ['java.lang.Object.wait(Native Method)'] }),
              W.thread({ tid: 11244, name: 'settle-1', state: 'RUNNABLE', cpu: 37.8, cpuSeconds: 4020,
                stack: [
                  'com.ib.settle.SsiResolver.resolve(SsiResolver.java:118)',
                  'com.ib.settle.SettlementAdapter.onMessage(SettlementAdapter.java:242)',
                  'com.ibm.mq.jms.MQSession.run(MQSession.java:1204)'
                ] })
            ] }),
          W.proc({ pid: 20140, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],

        sockets: [
          { pid: 9120, fd: 11, proto: 'tcp', local: '0.0.0.0:1414', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 11204, fd: 24, proto: 'tcp', local: '10.14.22.84:52104', peer: '10.14.22.84:1414', state: 'ESTABLISHED' },
          { pid: 1612, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],

        diskio: [{ dev: 'dm-2', rs: 4.2, ws: 92.1, readKB: 88.4, writeKB: 2204.2, await: 1.1, util: 9.4 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.84/24', rxOk: 412008841, txOk: 388120044, rxBytes: 44120088412, txBytes: 38120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 88120, txOk: 88120, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [1414, 22], rtt: 0.02 } },

        mq: {
          qmgr: 'QM.TRADE.LDN', status: 'Running',
          deadq: 'SYSTEM.DEAD.LETTER.QUEUE',
          queues: [
            {
              name: 'TRADE.TO.SETTLE', curdepth: 4182, maxdepth: 50000,
              bothresh: 0, boqname: '', ipprocs: 1, opprocs: 1,
              lastGet: stuckAt, uncommitted: true,
              msgs: [
                { backoutCount: 8412, putTime: stuckAt, body: poisonBody, persistent: true,
                  msgId: '414d5120514d2e54524144452e4c444e207b0a' },
                { backoutCount: 0, putTime: new Date(stuckAt.getTime() + 60000), persistent: true,
                  body: '<TradeInstruction>\n  <TradeId>TRD-8841208</TradeId>\n  <ISIN>GB00B03MLX29</ISIN>\n  <Currency>GBP</Currency>\n</TradeInstruction>' },
                { backoutCount: 0, putTime: new Date(stuckAt.getTime() + 90000), persistent: true,
                  body: '<TradeInstruction>\n  <TradeId>TRD-8841209</TradeId>\n  <ISIN>US0378331005</ISIN>\n  <Currency>USD</Currency>\n</TradeInstruction>' }
              ]
            },
            { name: 'TRADE.TO.SETTLE.BOQ', curdepth: 0, maxdepth: 5000, bothresh: 0, boqname: '', ipprocs: 0, opprocs: 0, msgs: [] },
            { name: 'SETTLE.INSTRUCTIONS', curdepth: 0, maxdepth: 50000, bothresh: 5, boqname: 'SETTLE.INSTRUCTIONS.BOQ', ipprocs: 1, opprocs: 1, msgs: [] },
            { name: 'SYSTEM.DEAD.LETTER.QUEUE', curdepth: 0, maxdepth: 999999, bothresh: 0, boqname: '', ipprocs: 0, opprocs: 0, msgs: [] }
          ],
          channels: [
            { name: 'TRADE.TO.CREST', type: 'SDR', status: 'RUNNING', xmitq: 'CREST.XMITQ' }
          ]
        },

        services: {
          'settle-adapter': {
            active: true, pid: 11204, exe: 'java', desc: 'Settlement Adapter',
            since: new Date(2026, 8, 11, 6, 5, 0), tasks: 24, requiresRoot: false,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx3g -jar /apps/settle/lib/settle-adapter.jar',
            log: ['SettlementAdapter - transaction rolled back, message returned to queue']
          },
          sshd: { active: true, pid: 1612, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { drained: false, restarted: false, cleared: false, thresholdSet: false },

        /* Fast-forward the fictional adapter's next policy refresh, transactional
         * quarantine and backlog drain after ALTER. This callback represents
         * application work, not an automatic queue-manager action. */
        onMqAlter: function (world, q) {
          if (q.name !== 'TRADE.TO.SETTLE') return;
          if (!q.bothresh || !q.boqname) return;
          world.flags.thresholdSet = true;
          var boq = world.mq.queues.filter(function (x) { return x.name === q.boqname; })[0];
          var poison = (q.msgs || [])[0];
          if (boq && poison) { boq.curdepth = 1; boq.msgs = [poison]; }
          q.msgs = (q.msgs || []).slice(1);
          q.curdepth = 0;
          q.uncommitted = false;
          q.lastGet = new Date(world.clock.getTime());
          world.flags.drained = true;
          var p = W.findProc(world, 11204);
          if (p) { p.cpu = 6.2; if (p.threads) p.threads[1].stack = ['com.ibm.mq.jms.MQSession.run(MQSession.java:1204)']; }
          var out = world.mq.queues.filter(function (x) { return x.name === 'SETTLE.INSTRUCTIONS'; })[0];
          if (out) out.curdepth = 0;
          W.appendLog(world, '/var/log/settle/settle-adapter.log',
            W.isoStamp(world.clock) + ' WARN  [settle-1] SettlementAdapter - TRD-8841207 exceeded backout threshold, moved to TRADE.TO.SETTLE.BOQ');
          W.appendLog(world, '/var/log/settle/settle-adapter.log',
            W.isoStamp(world.clock) + ' INFO  [settle-1] SettlementAdapter - backlog draining, 4181 instructions sent');
        },

        onMqClear: function (world, q, lost) {
          if (q.name !== 'TRADE.TO.SETTLE') return;
          world.flags.cleared = true;
          world.flags.tradesLost = lost;
          world.flags.drained = true;
          W.appendLog(world, '/var/log/settle/settle-adapter.log',
            W.isoStamp(world.clock) + ' WARN  [settle-1] SettlementAdapter - queue empty');
        },

        onService: function (world, verb, unit) {
          if (unit !== 'settle-adapter' && unit !== 'settle-adapter.service') return false;
          if (verb === 'restart' || verb === 'stop') {
            world.flags.restarted = true;
            // The message is still at the head of the queue. Nothing changes.
            W.appendLog(world, '/var/log/settle/settle-adapter.log',
              W.isoStamp(world.clock) + ' INFO  [main] SettlementAdapter - started, consuming TRADE.TO.SETTLE');
            W.appendLog(world, '/var/log/settle/settle-adapter.log',
              W.isoStamp(world.clock) + ' ERROR [settle-1] SettlementAdapter - failed to build instruction for TRD-8841207');
            W.appendLog(world, '/var/log/settle/settle-adapter.log',
              W.isoStamp(world.clock) + ' WARN  [settle-1] SettlementAdapter - transaction rolled back, message returned to queue');
            return true;
          }
          return false;
        },

        tick: function (world, seconds) {
          if (world.flags.drained) return;
          var q = world.mq.queues[0];
          world.notes.t = (world.notes.t || 0) + seconds;
          // booking keeps flowing in; the backlog keeps growing
          if (world.notes.t % 6 < 1) {
            q.curdepth += 1;
            if (q.msgs && q.msgs.length) q.msgs[0].backoutCount += 3;
          }
        }
      });

      return world;
    },

    discoveries: [
      { id: 'depth-climbing', label: 'TRADE.TO.SETTLE is backed up and still growing',
        when: function (o) { return /runmqsc|CURDEPTH/i.test(o.cmd + o.out) && /CURDEPTH\(4\d{3}\)/.test(o.out); } },
      { id: 'consumer-attached', label: 'IPPROCS is 1 - an input handle is open; check whether processing advances',
        when: function (o) { return /IPPROCS\(1\)/.test(o.out); } },
      { id: 'no-threshold', label: 'BOTHRESH is 0, disabling this adapter\'s threshold-based quarantine',
        when: function (o) { return /BOTHRESH\(0\)/.test(o.out); } },
      { id: 'backout-count', label: 'The head message has been backed out thousands of times',
        when: function (o) { return /BackoutCount\s*:\s*\d{3,}/.test(o.out); } },
      { id: 'poison-trade', label: 'The poison message is TRD-8841207, ISIN XS2434891827',
        when: function (o) { return /TRD-8841207/.test(o.out); } },
      { id: 'root-error', label: 'The adapter throws because there is no SSI for that ISIN',
        when: function (o) { return /standing settlement instruction|SsiResolver/.test(o.out); } },
      { id: 'others-waiting', label: 'Good trades are queued behind it, unprocessed',
        when: function (o) { return /TRD-884120[89]/.test(o.out); } },
      { id: 'cpu-retrying', label: 'The adapter is burning CPU retrying, not idle',
        when: function (o) { return /\b(top|ps|jstack)\b/.test(o.cmd) && /11204|settle-1/.test(o.out); }, optional: true }
    ],

    rootCauses: [
      { text: 'The settlement adapter has crashed or lost its connection to the queue manager, so nothing is consuming the queue.' },
      { text: 'This single consumer repeatedly fails and rolls back the same head message. BOTHRESH 0 disables its poison-message handler, so the adapter retries indefinitely and blocks the trades behind it.', correct: true },
      { text: 'The queue manager has run out of log space and is refusing to commit.' },
      { text: 'The downstream CREST channel is down, so instructions cannot be transmitted.' },
      { text: 'The adapter has a memory leak and is spending all its time in garbage collection.' },
      { text: 'Booking is producing messages faster than the adapter can consume them.' }
    ],

    fix: {
      prompt: 'Drain the backlog before this desk\'s 16:00 instruction deadline. Every message on that queue is a client trade.',
      check: function (world) { return world.flags.drained === true; },
      grade: function (world) {
        if (world.flags.cleared) {
          return { quality: 'blunt', bonus: -500,
            note: 'CLEAR QLOCAL emptied the queue, so the monitor is green - and you have\n' +
              'just destroyed ' + (world.flags.tradesLost || 4182) + ' client trade instructions. There is no copy: the\n' +
              'fixture provides no replay source. Settlement is now at risk and Ops\n' +
              'must assess recovery, client impact and reporting obligations.\n\n' +
              'The MQSC command should have enabled the adapter to quarantine one\n' +
              'bad message and process the other 4,181 intact.' };
        }
        return { quality: 'clean', bonus: 320,
          note: 'You gave the queue a backout threshold and a backout queue. On the next\n' +
            'retry the fictional adapter refreshed its policy and transactionally\n' +
            'moved TRD-8841207 to TRADE.TO.SETTLE.BOQ. The simulator fast-forwards:\n' +
            'other 4,181 instructions drained in seconds, and the one bad trade is\n' +
            'preserved for Ops to repair once Reference Data load the missing SSI.' +
            (world.flags.restarted
              ? '\n\nYou also restarted the adapter along the way. Worth noticing that it\nchanged nothing - the message was still at the front of the queue.'
              : '') };
      }
    },

    hints: [
      'IPPROCS is 1, so an input handle is open. That does not prove successful processing. Compare the adapter log with the head message to see whether the consumer is making progress.',
      'Browse the queue without consuming it: amqsbcg TRADE.TO.SETTLE QM.TRADE.LDN. Look at BackoutCount on the first message.',
      'That message has been rolled back thousands of times. BOTHRESH 0 disables threshold-based quarantine in this adapter; its retry loop is holding up the other trades.',
      'Read /home/gsupport/runbook-settlement-mq.txt. The fictional adapter refreshes policy live and moves the offender to the existing BOQ on its next eligible retry. The MQ queue attributes do not move messages themselves.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'The adapter consumes under syncpoint: if it throws, the transaction rolls\n' +
      'back and the same head message is redelivered in this fixture. A trade arrived for\n' +
      'an instrument with no standing settlement instruction, the SSI lookup threw\n' +
      'a NullPointerException, and the message has been redelivered ever since.\n' +
      'BOTHRESH 0 disabled this adapter\'s quarantine handler, so one bad trade stopped\n' +
      'four thousand good ones. That is head-of-line blocking.\n\n' +
      'THE TELL THAT SAVES YOU TEN MINUTES\n' +
      '  IPPROCS 0  no input handles are open; investigate the consumer.\n' +
      '  IPPROCS 1  an input handle is open; it does not prove progress.\n' +
      'Use the repeated SSI error and BackoutCount to establish the retry loop.\n\n' +
      'WHO MOVES THE MESSAGE\n' +
      'BOTHRESH and BOQNAME are policy attributes, not a queue-manager mover.\n' +
      'Application code or IBM MQ classes for JMS must handle poison messages.\n' +
      'JMS uses BackoutCount >= positive BOTHRESH and caches the queue policy.\n' +
      'This fictional adapter refreshes that policy on each retry and commits\n' +
      'the quarantine to its pre-authorised BOQ; ALTER alone is not a generic\n' +
      'live fix for every MQ/JMS application. Verify the actual consumer.\n\n' +
      'THE COMMANDS\n' +
      '  dspmq                                     is the queue manager up\n' +
      '  echo "DIS QL(Q)" | runmqsc QMGR           CURDEPTH, IPPROCS, BOTHRESH\n' +
      '  amqsbcg Q QMGR                            browse WITHOUT consuming\n' +
      '  ALTER QL(Q) BOTHRESH(5) BOQNAME(Q.BOQ)   give poison an exit\n\n' +
      'WHY A RESTART DOES NOTHING\n' +
      'The message is persistent and still first in the queue. Restarting the\n' +
      'consumer just starts the loop again from the same place. If a restart is\n' +
      'your reflex, this is the incident that teaches you to check what the\n' +
      'process is actually doing first.\n\n' +
      'THE ONE THING YOU MUST NEVER DO\n' +
      'CLEAR QLOCAL on a trade queue. The monitor goes green and the trades are\n' +
      'gone. This fixture has no replay source; syncpoint does not imply that\n' +
      'every real booking system lacks another record. Never infer settlement\n' +
      'success from queue depth alone; reconcile downstream instructions.\n\n' +
      'INTERVIEW ANGLE\n' +
      'Expect "a queue is backing up, what do you check?". The answer that marks\n' +
      'you out is IPPROCS first, then BackoutCount, then BOTHRESH - and naming the\n' +
      'consumer\'s poison handling and BOQ permissions before changing policy.'
  });
})(PS);
