/* Scenario: 1,204 cash breaks on the USD nostro, and none of them are real.
 *
 * The correspondent's MT950 statements carry a sequence number in field 28C.
 * One number is missing, so a whole block of movements was never delivered.
 * Every "break" is an entry we hold and the statement does not mention - which
 * is missing data, not a discrepancy.
 *
 * The pressure is to force the reconciliation complete so the liquidity report
 * can go out on time. That publishes a cash position nobody has checked.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'nostro-statement-missing',
    title: '1,204 cash breaks on the USD nostro',
    severity: 'P1',
    desk: 'Treasury Operations / Cash Reconciliation',
    host: 'ldn-recon-prod03',
    tags: ['nostro', 'SWIFT MT950', 'cash reconciliation', 'statement sequence', 'missing data'],
    par: 500,
    impactPerMin: 21000,
    currency: 'USD',

    sources: [
      { title: 'Paiementor: SWIFT MT950 statement message, including field 28C statement/sequence number', url: 'https://www.paiementor.com/swift-mt950-statement-message-detailed-analysis/' },
      { title: 'Swift: settlement and reconciliation', url: 'https://www.swift.com/securities/settlement-and-reconciliation' },
      { title: 'Skydo: nostro reconciliation - matching internal records against correspondent statements', url: 'https://www.skydo.com/blog/nostro-reconciliation' }
    ],

    brief:
      'PAGER 07:20 - from Treasury Operations\n\n' +
      '"The USD nostro recon at BNY has come out with 1,204 unmatched items. It\n' +
      'is normally under ten. The recon engine ran fine and finished on time.\n\n' +
      'We need the intraday liquidity report out by 08:00 and it takes the closing\n' +
      'nostro balance from this reconciliation. Treasury are asking us to just\n' +
      'force-complete it and investigate the breaks afterwards."\n\n' +
      'That report feeds today\'s funding decisions.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 7, 20, 40);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      /* MT950 statements. 28C carries statement number / sequence number.
       * 187 and 189 arrived; 188 never did. */
      function mt950(seq, opening, closing, lines) {
        return [
          '{1:F01BNYMUS33AXXX0000000000}{2:O9500830260911IBGBGB2LAXXXN}{4:',
          ':20:STMT' + seq,
          ':25:BNY/IB-USD-NOSTRO-0041',
          ':28C:' + seq + '/1',
          ':60F:C260911USD' + opening
        ].concat(lines).concat([
          ':62F:C260911USD' + closing,
          '-}'
        ]).join('\n');
      }

      var stmt187 = mt950('187', '412884120,00', '414102884,00', [
        ':61:2609110911CD84120,00NTRFREF884120//BNY884120',
        ':86:INCOMING MT202 COVER PAYMENT CPTY HALDANE',
        ':61:2609110911DD1338356,00NTRFREF884121//BNY884121',
        ':86:OUTGOING SETTLEMENT DVP CREST'
      ]);

      var stmt189 = mt950('189', '418240112,00', '419884204,00', [
        ':61:2609110914CD1644092,00NTRFREF884980//BNY884980',
        ':86:INCOMING COUPON PAYMENT'
      ]);

      var reconLog = [
        W.isoStamp(ago(4200)) + ' INFO  ReconEngine - USD nostro BNY-0041 reconciliation starting for 2026-09-11',
        W.isoStamp(ago(4190)) + ' INFO  ReconEngine - loaded 2 statement files from /data/nostro/inbound',
        W.isoStamp(ago(4180)) + ' INFO  ReconEngine - internal ledger entries: 3,412',
        W.isoStamp(ago(4100)) + ' INFO  ReconEngine - matched 2,208, unmatched 1,204',
        W.isoStamp(ago(4090)) + ' WARN  ReconEngine - unmatched items are ALL ledger-side (we hold an entry, statement has none)',
        W.isoStamp(ago(4080)) + ' WARN  ReconEngine - statement opening balance 418,240,112.00 does not follow previous closing balance 414,102,884.00',
        W.isoStamp(ago(4070)) + ' INFO  ReconEngine - reconciliation complete with exceptions'
      ].join('\n');

      var root = V.dir({
        data: V.dir({
          nostro: V.dir({
            inbound: V.dir({
              'MT950_BNY_0041_187.txt': V.file(stmt187, { owner: 'reconadm', mtime: ago(9000), size: 18 * 1024 }),
              'MT950_BNY_0041_189.txt': V.file(stmt189, { owner: 'reconadm', mtime: ago(5400), size: 12 * 1024 })
            }),
            archive: V.dir({
              'MT950_BNY_0041_186.txt': V.file(mt950('186', '410004120,00', '412884120,00', [
                ':61:2609100841CD2880000,00NTRFREF883900//BNY883900',
                ':86:INCOMING FUNDING TRANSFER'
              ]), { owner: 'reconadm', mtime: ago(86400), size: 14 * 1024 })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            recon: V.dir({
              'recon-engine.log': V.file(reconLog, { owner: 'reconadm', mtime: ago(4070), size: 88 * MB }),
              'sftp-collector.log': V.file(
                W.isoStamp(ago(9060)) + ' INFO  collected MT950_BNY_0041_187.txt (18,204 bytes)\n' +
                W.isoStamp(ago(7200)) + ' INFO  poll: no new files on bny-sftp.example:/outbound\n' +
                W.isoStamp(ago(5460)) + ' INFO  collected MT950_BNY_0041_189.txt (12,118 bytes)\n' +
                W.isoStamp(ago(3600)) + ' INFO  poll: no new files on bny-sftp.example:/outbound',
                { owner: 'reconadm', mtime: ago(3600), size: 12 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-nostro.txt': V.file(
              'NOSTRO CASH RECONCILIATION RUNBOOK\n' +
              '==================================\n' +
              'WHAT WE RECONCILE\n' +
              '  Our internal ledger of expected cash movements against the\n' +
              '  correspondent bank\'s own statement of the account. MT950 is the\n' +
              '  bank-to-bank statement used for nostro/vostro; MT940 is the\n' +
              '  customer statement. They arrive by SFTP through the day.\n' +
              '\n' +
              'THE FIELD THAT MATTERS WHEN SOMETHING LOOKS WRONG\n' +
              '  :28C:  statement number / sequence number.\n' +
              '  Statements are numbered consecutively. If you hold 187 and 189 and\n' +
              '  no 188, a statement was never delivered - and every movement it\n' +
              '  carried is absent from the reconciliation.\n' +
              '\n' +
              '  :60F:  opening balance    :62F:  closing balance\n' +
              '  The opening balance of each statement must equal the closing balance\n' +
              '  of the previous one. A discontinuity is the same evidence expressed\n' +
              '  in money rather than in sequence numbers.\n' +
              '\n' +
              'READING THE EXCEPTIONS\n' +
              '  Breaks on BOTH sides        genuine discrepancies - investigate each.\n' +
              '  Breaks ALL on the ledger side  we hold entries the statement does not\n' +
              '                              mention. Usually MISSING STATEMENT DATA,\n' +
              '                              not 1,204 individual errors.\n' +
              '  A sudden jump from single digits to four figures is an input\n' +
              '  problem, not a business problem.\n' +
              '\n' +
              'RECOVERY\n' +
              '  curl http://localhost:9900/admin/recon/status\n' +
              '  curl -X POST http://localhost:9900/admin/statement/request-retransmission -d \'{"account":"BNY-0041","sequence":188}\'\n' +
              '      raises the retransmission request with the correspondent\n' +
              '  curl -X POST http://localhost:9900/admin/recon/rerun\n' +
              '  curl -X POST http://localhost:9900/admin/recon/verify\n' +
              '\n' +
              'NEVER force-complete a reconciliation to meet a reporting deadline.\n' +
              '  Force-complete marks the unmatched items as accepted and publishes a\n' +
              '  closing balance derived from data we know is incomplete. The\n' +
              '  intraday liquidity report drives funding decisions; a wrong cash\n' +
              '  position can mean funding a currency we already hold, or failing to\n' +
              '  fund one we do not. Report the delay instead - a late report with a\n' +
              '  correct number is a conversation, a punctual report with a wrong\n' +
              '  number is an incident.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-recon-prod03', user: 'gsupport', clock: t0, seed: 188,
        bootSeconds: 3600 * 24 * 64, cores: 8, users: 3,
        load: [0.52, 0.48, 0.45],
        mem: { total: 32 * GB, free: 17 * GB, buffers: 200 * MB, cached: 7 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 3.4, sy: 0.9, ni: 0, id: 95.5, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 11 * GB, inodes: { total: 26214400, used: 158204 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 26 * GB, inodes: { total: 52428800, used: 22412 } },
          { dev: '/dev/mapper/vg01-data', mount: '/data', type: 'xfs', size: 200 * GB, used: 34 * GB, inodes: { total: 104857600, used: 12204 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 900 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 420 }),
          W.proc({ pid: 1616, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 22 }),
          W.proc({ pid: 6620, user: 'reconadm', short: 'java', cpu: 2.8, rss: 6 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx6g -jar /apps/recon/lib/recon-engine.jar',
            started: new Date(2026, 8, 11, 5, 30, 0), cpuSeconds: 520,
            fds: [{ fd: 1, path: '/var/log/recon/recon-engine.log', mode: 'w', size: 88 * MB }] }),
          W.proc({ pid: 6640, user: 'reconadm', short: 'sftp-collect', cpu: 0.2, rss: 90 * MB,
            cmd: '/apps/recon/bin/sftp-collector.sh --host bny-sftp.example --poll 900',
            started: new Date(2026, 8, 11, 5, 0, 0), cpuSeconds: 41 }),
          W.proc({ pid: 21200, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 6620, fd: 11, proto: 'tcp', local: '0.0.0.0:9900', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1616, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        diskio: [{ dev: 'dm-1', rs: 1.8, ws: 30.2, readKB: 24.1, writeKB: 420.2, await: 0.4, util: 1.8 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.101/24', rxOk: 66120044, txOk: 52120044, rxBytes: 9412004120, txBytes: 7820044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 20104, txOk: 20104, mtu: 65536 }
        ],
        dmesg: [],
        hosts: {
          localhost: { ip: '127.0.0.1', ports: [9900, 22], rtt: 0.02 },
          'bny-sftp.example': { ip: '198.51.100.80', ports: [22], rtt: 84.2, ttl: 48 }
        },

        http: {
          'localhost:9900/admin/recon/status': function (world) {
            var f = world.flags;
            return JSON.stringify({
              account: 'BNY-0041', currency: 'USD', businessDate: '2026-09-11',
              ledgerEntries: 3412,
              matched: f.rerun ? 3406 : 2208,
              unmatched: f.rerun ? 6 : 1204,
              unmatchedSides: f.rerun ? { ledgerOnly: 4, statementOnly: 2 } : { ledgerOnly: 1204, statementOnly: 0 },
              statementsReceived: f.retransmitted ? [186, 187, 188, 189] : [186, 187, 189],
              balanceContinuity: f.retransmitted ? 'OK' : 'BROKEN between 187 and 189',
              status: f.forced ? 'FORCE COMPLETED' : (f.rerun ? 'COMPLETE' : 'COMPLETE_WITH_EXCEPTIONS')
            }, null, 2);
          },
          'localhost:9900/admin/statement/request-retransmission': function (world) {
            world.flags.retransmitted = true;
            PS.vfs.write(world.root, '/data/nostro/inbound/MT950_BNY_0041_188.txt',
              ['{1:F01BNYMUS33AXXX0000000000}{2:O9500900260911IBGBGB2LAXXXN}{4:',
                ':20:STMT188',
                ':25:BNY/IB-USD-NOSTRO-0041',
                ':28C:188/1',
                ':60F:C260911USD414102884,00',
                ':61:2609110912CD4137228,00NTRFREF884200//BNY884200',
                ':86:BULK SETTLEMENT CREDITS 1204 ITEMS',
                ':62F:C260911USD418240112,00',
                '-}'].join('\n'),
              { owner: 'reconadm', mtime: world.clock });
            W.appendLog(world, '/var/log/recon/sftp-collector.log',
              W.isoStamp(world.clock) + ' INFO  retransmission received: MT950_BNY_0041_188.txt (16,882 bytes)');
            return JSON.stringify({
              status: 'ok', account: 'BNY-0041', sequence: 188,
              correspondent: 'BNYMUS33',
              received: 'MT950_BNY_0041_188.txt',
              note: 'statement 188 covers 09:12, opening 414,102,884.00 closing 418,240,112.00'
            }, null, 2);
          },
          'localhost:9900/admin/recon/rerun': function (world) {
            if (!world.flags.retransmitted) {
              return JSON.stringify({
                status: 'refused',
                reason: 'statement sequence 188 is still missing; rerunning would produce the same 1,204 exceptions'
              }, null, 2);
            }
            world.flags.rerun = true;
            W.appendLog(world, '/var/log/recon/recon-engine.log',
              W.isoStamp(world.clock) + ' INFO  ReconEngine - rerun with statement 188: matched 3,406, unmatched 6');
            return JSON.stringify({ status: 'ok', matched: 3406, unmatched: 6, balanceContinuity: 'OK' }, null, 2);
          },
          'localhost:9900/admin/recon/force-complete': function (world) {
            world.flags.forced = true;
            world.flags.rerun = true;
            return JSON.stringify({
              status: 'ok', action: 'FORCE COMPLETED',
              unmatchedAccepted: 1204,
              publishedClosingBalance: 419884204.00,
              warning: 'closing balance published from incomplete statement data and used by the intraday liquidity report'
            }, null, 2);
          },
          'localhost:9900/admin/recon/verify': function (world) {
            world.flags.verified = true;
            return JSON.stringify({
              account: 'BNY-0041',
              statementsReceived: world.flags.retransmitted ? [186, 187, 188, 189] : [186, 187, 189],
              balanceContinuity: world.flags.retransmitted ? 'OK' : 'BROKEN',
              unmatched: world.flags.retransmitted ? 6 : 1204,
              closingBalanceTrustworthy: !!world.flags.retransmitted && !world.flags.forced
            }, null, 2);
          }
        },

        services: {
          'recon-engine': { active: true, pid: 6620, exe: 'java', desc: 'Cash Reconciliation Engine', requiresRoot: false },
          sshd: { active: true, pid: 1616, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { retransmitted: false, rerun: false, forced: false, verified: false }
      });

      return world;
    },

    walkthrough: [
      'cat /home/gsupport/runbook-nostro.txt',
      'cat /var/log/recon/recon-engine.log',
      'ls -l /data/nostro/inbound',
      'grep -h ":28C:" /data/nostro/inbound/*.txt /data/nostro/archive/*.txt',
      'grep -h -E ":6[02]F:" /data/nostro/inbound/*.txt',
      'cat /var/log/recon/sftp-collector.log',
      'curl http://localhost:9900/admin/recon/status',
      'curl -X POST http://localhost:9900/admin/statement/request-retransmission -d \'{"account":"BNY-0041","sequence":188}\'',
      'curl -X POST http://localhost:9900/admin/recon/rerun',
      'curl -X POST http://localhost:9900/admin/recon/verify'
    ],

    discoveries: [
      { id: 'one-sided', label: 'Every unmatched item is on the ledger side only',
        when: function (o) { return /ledger-side|ledgerOnly/i.test(o.out); } },
      { id: 'seq-gap', label: 'Statement sequence 188 is missing between 187 and 189',
        when: function (o) { return /28C/.test(o.out) && /187/.test(o.out) && /189/.test(o.out); } },
      { id: 'balance-break', label: 'Opening balance of 189 does not follow the closing balance of 187',
        when: function (o) { return /(60F|62F)/.test(o.out) || /does not follow previous closing/i.test(o.out); } },
      { id: 'never-collected', label: 'The collector never received a file for sequence 188',
        when: function (o) { return /sftp-collector|no new files/i.test(o.out); } },
      { id: 'not-real-breaks', label: 'Established the breaks are missing data, not discrepancies',
        when: function (o) { return /MISSING STATEMENT DATA|balanceContinuity/i.test(o.out); } },
      { id: 'liquidity-impact', label: 'Understood the closing balance feeds the intraday liquidity report',
        when: function (o) { return /liquidity/i.test(o.out); } },
      { id: 'retransmitted', label: 'Obtained the missing statement from the correspondent',
        when: function (o) { return /retransmission received|sequence.*188/i.test(o.out); }, optional: true }
    ],

    rootCauses: [
      { text: 'The reconciliation engine has a matching-rule defect and is failing to pair valid entries.' },
      { text: 'One MT950 statement (sequence 188) was never delivered by the correspondent, so a whole block of movements is absent from the reconciliation. The 1,204 exceptions are entries we hold that the statements simply do not mention - missing data, not discrepancies.', correct: true },
      { text: 'Our internal ledger double-booked a batch of settlements overnight.' },
      { text: 'The SFTP collector is down, so no statements arrived at all today.' },
      { text: 'The correspondent has changed the MT950 format and the parser is dropping transaction lines.' },
      { text: 'A currency conversion error is causing amounts to mismatch on every item.' }
    ],

    fix: {
      prompt: 'Produce a cash position Treasury can fund from. The liquidity report is due at 08:00.',
      check: function (world) { return world.flags.rerun === true && world.flags.verified === true; },
      grade: function (world) {
        if (world.flags.forced) {
          return { quality: 'blunt', bonus: -460,
            note: 'The reconciliation shows complete and the liquidity report will go out on\n' +
              'time carrying a closing balance built from statements you knew were\n' +
              'incomplete. 1,204 unmatched items were accepted rather than explained,\n' +
              'and the missing statement 188 moved 4,137,228.00 - so the published\n' +
              'position is wrong by that amount and Treasury will fund against it.\n\n' +
              'A late report with a correct number is a conversation. A punctual report\n' +
              'with a wrong cash position is a funding error.' };
        }
        return { quality: 'clean', bonus: 350,
          note: 'You noticed the exceptions were all one-sided, proved the gap from the 28C\n' +
            'sequence and the broken balance continuity, requested the retransmission\n' +
            'and reran. 3,406 matched, 6 genuine exceptions left for Ops to work, and\n' +
            'the closing balance is now something Treasury can actually fund from.\n\n' +
            'Worth raising: the collector polled twice and reported "no new files"\n' +
            'without anyone noticing a statement was overdue.' };
      }
    },

    hints: [
      'Look at the shape of the exceptions before looking at any of them individually. Are they on both sides, or only one? The recon log says.',
      'Every unmatched item is one we hold and the statement does not mention. That is the signature of missing statement data rather than 1,204 separate errors. MT950 statements are numbered - find the field that numbers them.',
      'Field :28C: is the statement/sequence number. Grep it across every statement file you have, including the archive, and look for a gap. Then check the :60F: and :62F: balances line up across statements.',
      'Sequence 188 never arrived, and the opening balance of 189 does not follow the closing balance of 187. Request a retransmission and rerun - do not force-complete, the runbook explains what that publishes.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'The correspondent never delivered MT950 statement 188. The SFTP collector\n' +
      'polled, found nothing, logged "no new files" and carried on. The recon\n' +
      'engine ran against the statements it had, so every ledger entry covered by\n' +
      'the missing statement came out unmatched. Nothing failed loudly: the job\n' +
      'succeeded, on time, with 1,204 exceptions.\n\n' +
      'THE SHAPE OF THE EXCEPTIONS IS THE DIAGNOSIS\n' +
      '  Both sides unmatched   genuine discrepancies. Work them individually.\n' +
      '  One side only          we hold entries the counterparty never mentions.\n' +
      '                         That is almost always missing input.\n' +
      'A jump from single-digit breaks to four figures overnight is an input\n' +
      'problem. Investigating 1,204 items one at a time is the expensive way to\n' +
      'discover the same thing.\n\n' +
      'TWO INDEPENDENT PROOFS, BOTH IN THE MESSAGE\n' +
      '  :28C:  statement/sequence number. 187 and 189 present, 188 absent.\n' +
      '  :60F:/:62F:  opening and closing balances. Each statement must open where\n' +
      '         the previous one closed. 189 opens at 418,240,112.00 while 187\n' +
      '         closed at 414,102,884.00 - a 4,137,228.00 discontinuity, which is\n' +
      '         exactly the movement the missing statement carried.\n' +
      'Being able to prove a gap from the message itself, rather than asserting\n' +
      '"the file did not arrive", is what makes the retransmission request stick.\n\n' +
      'WHY FORCE-COMPLETE IS THE WRONG ANSWER\n' +
      'It accepts the unmatched items and publishes a closing balance from data\n' +
      'known to be incomplete. That balance drives the intraday liquidity report\n' +
      'and therefore today\'s funding: you can end up funding a currency you\n' +
      'already hold, or failing to fund one you do not, and overdrawing a nostro\n' +
      'has a real cost. Deadline pressure is exactly when this control matters.\n' +
      'Escalate the delay; do not manufacture a number.\n\n' +
      'THE REAL FINDING\n' +
      'Nothing alerted on an overdue statement. The collector only knows what it\n' +
      'received, not what it expected. Monitoring a sequence for gaps - the same\n' +
      'idea as a FIX sequence number or a market data sequence - is the control\n' +
      'that was missing.\n\n' +
      'INTERVIEW ANGLE\n' +
      'Cash and nostro reconciliation is core middle- and back-office support.\n' +
      '"How would you approach a reconciliation with a thousand breaks?" expects:\n' +
      'look at the shape first, suspect missing data when the breaks are one-\n' +
      'sided, prove it from sequence numbers and balance continuity, and never\n' +
      'force a reconciliation to meet a reporting deadline.'
  });
})(PS);
