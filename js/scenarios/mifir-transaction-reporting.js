/* Scenario: the ARM has rejected part of yesterday's MiFIR transaction report.
 *
 * Reporting is a deadline, not a service: accepted by the ARM before the T+1
 * cut-off or it is a late report. The work is reading a feedback file, finding
 * what the rejections have in common, fixing the reference data, and
 * resubmitting ONLY the rejected subset - because resubmitting everything is
 * over-reporting, which is its own breach.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'mifir-transaction-reporting',
    title: 'ARM rejected part of yesterday\'s transaction report',
    severity: 'P1',
    desk: 'Compliance Technology / Transaction Reporting',
    host: 'ldn-txnrep-prod01',
    tags: ['MiFIR', 'ARM feedback', 'LEI', 'reference data', 'T+1 deadline'],
    par: 520,
    impactPerMin: 9000,
    currency: 'GBP',

    sources: [
      { title: 'FCA / ACA: MiFIR transaction reporting - key issues including invalid LEIs and national identifiers', url: 'https://www.acaglobal.com/industry-insights/mifir-transaction-reporting-key-issues-highlighted-fca/' },
      { title: 'LSEG Transaction Reporting Service Description (ARM feedback files, _UVRes response)', url: 'https://docs.londonstockexchange.com/sites/default/files/documents/LSEG%20Third%20Country%20Member%20Transaction%20Reporting%20Guide%20Version%201.9.pdf' },
      { title: 'TRAction: the four most common MiFIR transaction reporting errors', url: 'https://tractionfintech.com/mifir-mifid-ii/the-4-most-common-errors-in-mifir-transaction-reporting/' }
    ],

    brief:
      'PAGER 08:15 - from Regulatory Reporting Operations\n\n' +
      '"The ARM feedback file for yesterday\'s submission is back and it is not\n' +
      'clean. Our dashboard says 88,412 sent, 88,000 accepted. We do not know\n' +
      'what the other 412 are or why.\n\n' +
      'Everything has to be accepted by the ARM before close of business today -\n' +
      'these are T-1 trades and the deadline is T+1. Anything still rejected at\n' +
      'the cut-off is a late report and goes on the breach register."\n\n' +
      'Compliance want to know what the rejections have in common before anyone\n' +
      'resubmits anything.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 8, 15, 30);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      /* ARM feedback: 12 sampled rows. Every rejection carries the same error
       * code and the same counterparty LEI - which is the whole finding. */
      var feedback = [
        'TxnRefNo,Status,ErrorCode,ErrorText,BuyerLEI,SellerLEI,InstrumentISIN',
        'TR-20260910-000001,ACPT,,,213800XXXXXXXXXX01,549300YYYYYYYYYY02,GB00B03MLX29',
        'TR-20260910-000002,ACPT,,,213800XXXXXXXXXX01,549300YYYYYYYYYY02,US0378331005',
        'TR-20260910-000003,RJCT,CON-412,Invalid LEI: entity not in a valid registration status,213800XXXXXXXXXX01,894500ZZZZZZZZZZ77,FR0000131104',
        'TR-20260910-000004,ACPT,,,213800XXXXXXXXXX01,549300YYYYYYYYYY02,DE0007164600',
        'TR-20260910-000005,RJCT,CON-412,Invalid LEI: entity not in a valid registration status,213800XXXXXXXXXX01,894500ZZZZZZZZZZ77,NL0000235190',
        'TR-20260910-000006,ACPT,,,213800XXXXXXXXXX01,549300YYYYYYYYYY02,GB0002634946',
        'TR-20260910-000007,RJCT,CON-412,Invalid LEI: entity not in a valid registration status,213800XXXXXXXXXX01,894500ZZZZZZZZZZ77,GB00B03MLX29',
        'TR-20260910-000008,ACPT,,,213800XXXXXXXXXX01,549300YYYYYYYYYY02,IT0003128367',
        'TR-20260910-000009,RJCT,CON-412,Invalid LEI: entity not in a valid registration status,213800XXXXXXXXXX01,894500ZZZZZZZZZZ77,ES0113900J37',
        'TR-20260910-000010,ACPT,,,213800XXXXXXXXXX01,549300YYYYYYYYYY02,FI0009000681',
        'TR-20260910-000011,RJCT,CON-412,Invalid LEI: entity not in a valid registration status,213800XXXXXXXXXX01,894500ZZZZZZZZZZ77,SE0000108656',
        'TR-20260910-000012,ACPT,,,213800XXXXXXXXXX01,549300YYYYYYYYYY02,DK0010244508'
      ].join('\n');

      var summary = [
        'FILE,TXN_SENT,TXN_ACCEPTED,TXN_REJECTED,FILE_STATUS',
        'TXNREP_20260910.csv,88412,88000,412,ACCEPTED_WITH_ERRORS'
      ].join('\n');

      var leiRegistry = [
        'LEI,LegalName,RegistrationStatus,NextRenewalDate,LastRefreshed',
        '213800XXXXXXXXXX01,IB Markets Limited,ISSUED,2027-03-14,2026-09-10',
        '549300YYYYYYYYYY02,Northgate Asset Management,ISSUED,2027-01-08,2026-09-10',
        '894500ZZZZZZZZZZ77,Haldane Securities SA,ISSUED,2026-09-08,2026-06-02',
        '969500AAAAAAAAAA31,Kestrel Global Partners,ISSUED,2026-12-19,2026-09-10'
      ].join('\n');

      var appLog = [
        W.isoStamp(ago(86400 + 3600)) + ' INFO  [submit] ArmSubmitter - built TXNREP_20260910.csv, 88412 transactions',
        W.isoStamp(ago(86400 + 3500)) + ' INFO  [submit] ArmSubmitter - uploaded to ARM sftp /outbound/TXNREP_20260910.csv',
        W.isoStamp(ago(3600)) + ' INFO  [poll] ArmFeedback - collected TXNREP_20260910_UVRes.csv from /inbound',
        W.isoStamp(ago(3540)) + ' WARN  [poll] ArmFeedback - file status ACCEPTED_WITH_ERRORS: 412 transactions rejected',
        W.isoStamp(ago(3500)) + ' WARN  [poll] ArmFeedback - rejected transactions require correction and resubmission before T+1 cut-off 17:00'
      ].join('\n');

      var root = V.dir({
        data: V.dir({
          arm: V.dir({
            outbound: V.dir({
              'TXNREP_20260910.csv': V.file(
                'TxnRefNo,TradingDateTime,BuyerLEI,SellerLEI,InstrumentISIN,Quantity,Price,Venue\n' +
                'TR-20260910-000001,2026-09-10T09:14:02.118Z,213800XXXXXXXXXX01,549300YYYYYYYYYY02,GB00B03MLX29,25000,71.24,XLON\n' +
                'TR-20260910-000003,2026-09-10T09:18:44.902Z,213800XXXXXXXXXX01,894500ZZZZZZZZZZ77,FR0000131104,12000,28.90,XPAR\n',
                { owner: 'repadm', mtime: ago(86400 + 3500), size: 214 * MB })
            }),
            inbound: V.dir({
              'TXNREP_20260910_UVRes.csv': V.file(feedback, { owner: 'repadm', mtime: ago(3600), size: 18 * MB }),
              'TXNREP_20260910_Summary.csv': V.file(summary, { owner: 'repadm', mtime: ago(3600), size: 2048 })
            })
          })
        }),
        config: V.dir({
          'lei-registry.csv': V.file(leiRegistry, { owner: 'repadm', mtime: ago(86400 * 3), size: 4 * MB }),
          'reporting.properties': V.file(
            'arm.endpoint=sftp://arm.lseg.example/inbound\n' +
            'arm.feedback.suffix=_UVRes\n' +
            'report.deadline=T+1 17:00 London\n' +
            'lei.refresh.source=GLEIF\n' +
            'lei.refresh.cron=0 5 * * *      # nightly, last successful run 2026-09-10\n',
            { owner: 'repadm', mtime: ago(86400 * 30) })
        }),
        var: V.dir({
          log: V.dir({
            txnrep: V.dir({
              'txnrep.log': V.file(appLog, { owner: 'repadm', mtime: ago(3500), size: 120 * MB }),
              'lei-refresh.log': V.file(
                W.isoStamp(ago(86400 + 11700)) + ' INFO  GLEIF refresh started\n' +
                W.isoStamp(ago(86400 + 11600)) + ' ERROR GLEIF download failed: 503 Service Unavailable, retrying\n' +
                W.isoStamp(ago(86400 + 11500)) + ' ERROR GLEIF refresh abandoned after 3 attempts, registry left at 2026-06-02 snapshot\n' +
                W.isoStamp(ago(11700)) + ' ERROR GLEIF download failed: 503 Service Unavailable, retrying\n' +
                W.isoStamp(ago(11600)) + ' ERROR GLEIF refresh abandoned after 3 attempts',
                { owner: 'repadm', mtime: ago(11600), size: 8 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-txnrep.txt': V.file(
              'MiFIR TRANSACTION REPORTING RUNBOOK\n' +
              '===================================\n' +
              'FLOW\n' +
              '  Nightly we build a transaction report from executions and upload it\n' +
              '  to the ARM. The ARM validates at FILE level and then at TRANSACTION\n' +
              '  level, and drops a feedback file back into /data/arm/inbound with\n' +
              '  _UVRes appended to the original name.\n' +
              '\n' +
              '  FILE_STATUS ACCEPTED_WITH_ERRORS means the file was readable but\n' +
              '  some transactions failed validation. Those transactions are NOT\n' +
              '  reported. Only the ARM acknowledgement counts.\n' +
              '\n' +
              'DEADLINE\n' +
              '  Reports must be accepted by the ARM by T+1 17:00 London. A\n' +
              '  transaction still in RJCT at the cut-off is a LATE REPORT and goes\n' +
              '  on the breach register.\n' +
              '\n' +
              'TRIAGE\n' +
              '  1. Read the summary file for counts.\n' +
              '  2. Group the rejections by ErrorCode - they usually share one.\n' +
              '  3. Group them by counterparty LEI / instrument to find the common\n' +
              '     reference-data value behind them.\n' +
              '  4. Fix the DATA, not the report.\n' +
              '\n' +
              'COMMON CAUSES (FCA has published on all of these)\n' +
              '  Invalid or lapsed LEI on a counterparty\n' +
              '  Invalid national identifier for a natural person\n' +
              '  Wrong venue MIC or instrument identifier\n' +
              '\n' +
              'RESUBMISSION\n' +
              '  curl -X POST http://localhost:9700/admin/lei/refresh\n' +
              '      pulls the current GLEIF record for a given LEI into the registry\n' +
              '  curl -X POST http://localhost:9700/admin/report/resubmit-rejected\n' +
              '      rebuilds and submits ONLY the transactions in RJCT status\n' +
              '  curl -X POST http://localhost:9700/admin/report/verify\n' +
              '      re-reads the feedback and confirms everything is ACPT\n' +
              '\n' +
              '  NEVER resubmit the whole file to clear rejections. The accepted\n' +
              '  88,000 would be reported twice. Over-reporting is a reportable\n' +
              '  breach in its own right and is materially harder to unwind than a\n' +
              '  late report.\n',
              { owner: 'gsupport', mtime: ago(86400 * 40) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-txnrep-prod01', user: 'gsupport', clock: t0, seed: 412,
        bootSeconds: 3600 * 24 * 58, cores: 8, users: 3,
        load: [0.44, 0.41, 0.38],
        mem: { total: 32 * GB, free: 18 * GB, buffers: 200 * MB, cached: 6 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 3.1, sy: 0.8, ni: 0, id: 95.9, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 11 * GB, inodes: { total: 26214400, used: 160204 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 22 * GB, inodes: { total: 52428800, used: 18412 } },
          { dev: '/dev/mapper/vg01-data', mount: '/data', type: 'xfs', size: 500 * GB, used: 88 * GB, inodes: { total: 262144000, used: 41208 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 940 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 400 }),
          W.proc({ pid: 1612, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 20 }),
          W.proc({ pid: 8420, user: 'repadm', short: 'java', cpu: 2.4, rss: 4 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx4g -jar /apps/txnrep/lib/txnrep.jar',
            started: new Date(2026, 8, 11, 5, 0, 0), cpuSeconds: 420,
            fds: [{ fd: 1, path: '/var/log/txnrep/txnrep.log', mode: 'w', size: 120 * MB }] }),
          W.proc({ pid: 19400, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 8420, fd: 11, proto: 'tcp', local: '0.0.0.0:9700', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1612, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        diskio: [{ dev: 'dm-1', rs: 1.2, ws: 22.4, readKB: 18.1, writeKB: 320.2, await: 0.4, util: 1.2 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.98/24', rxOk: 88120044, txOk: 74120088, rxBytes: 12004881200, txBytes: 9120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 22104, txOk: 22104, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [9700, 22], rtt: 0.02 } },

        http: {
          'localhost:9700/admin/report/status': function (world) {
            var f = world.flags;
            return JSON.stringify({
              reportDate: '2026-09-10', file: 'TXNREP_20260910.csv',
              sent: 88412,
              accepted: f.resubmitted ? 88412 : 88000,
              rejected: f.resubmitted ? 0 : 412,
              fileStatus: f.resubmitted ? 'ACCEPTED' : 'ACCEPTED_WITH_ERRORS',
              deadline: '2026-09-11T17:00:00+01:00',
              distinctErrorCodes: f.resubmitted ? [] : ['CON-412']
            }, null, 2);
          },
          'localhost:9700/admin/lei/refresh': function (world) {
            world.flags.leiRefreshed = true;
            PS.vfs.write(world.root, '/config/lei-registry.csv',
              'LEI,LegalName,RegistrationStatus,NextRenewalDate,LastRefreshed\n' +
              '213800XXXXXXXXXX01,IB Markets Limited,ISSUED,2027-03-14,2026-09-11\n' +
              '549300YYYYYYYYYY02,Northgate Asset Management,ISSUED,2027-01-08,2026-09-11\n' +
              '894500ZZZZZZZZZZ77,Haldane Securities SA,ISSUED,2027-09-08,2026-09-11\n' +
              '969500AAAAAAAAAA31,Kestrel Global Partners,ISSUED,2026-12-19,2026-09-11\n',
              { owner: 'repadm', mtime: world.clock });
            return JSON.stringify({
              status: 'ok', source: 'GLEIF',
              updated: [{ lei: '894500ZZZZZZZZZZ77', was: 'LAPSED at source', now: 'ISSUED', nextRenewal: '2027-09-08' }],
              note: 'registry snapshot was 2026-06-02; nightly refresh had been failing'
            }, null, 2);
          },
          'localhost:9700/admin/report/resubmit-rejected': function (world) {
            if (!world.flags.leiRefreshed) {
              return JSON.stringify({
                status: 'refused',
                reason: 'reference data unchanged since the rejection; resubmitting would fail identically',
                rejectedCount: 412, errorCode: 'CON-412'
              }, null, 2);
            }
            world.flags.resubmitted = true;
            W.appendLog(world, '/var/log/txnrep/txnrep.log',
              W.isoStamp(world.clock) + ' INFO  [submit] ArmSubmitter - resubmitted 412 corrected transactions (rejected subset only)');
            return JSON.stringify({
              status: 'ok', resubmitted: 412, scope: 'RJCT subset only',
              duplicatesCreated: 0,
              note: 'the 88,000 already accepted were not resent'
            }, null, 2);
          },
          'localhost:9700/admin/report/resubmit-all': function (world) {
            world.flags.resubmittedAll = true;
            world.flags.resubmitted = true;
            W.appendLog(world, '/var/log/txnrep/txnrep.log',
              W.isoStamp(world.clock) + ' WARN  [submit] ArmSubmitter - resubmitted ENTIRE file, 88412 transactions');
            return JSON.stringify({
              status: 'ok', resubmitted: 88412, scope: 'ENTIRE FILE',
              duplicatesCreated: 88000,
              warning: 'the 88,000 already-accepted transactions are now reported twice'
            }, null, 2);
          },
          'localhost:9700/admin/report/verify': function (world) {
            world.flags.verified = true;
            return JSON.stringify({
              reportDate: '2026-09-10',
              accepted: world.flags.resubmitted ? 88412 : 88000,
              rejected: world.flags.resubmitted ? 0 : 412,
              duplicates: world.flags.resubmittedAll ? 88000 : 0,
              beforeDeadline: true
            }, null, 2);
          }
        },

        services: {
          txnrep: { active: true, pid: 8420, exe: 'java', desc: 'MiFIR Transaction Reporting', requiresRoot: false },
          sshd: { active: true, pid: 1612, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { leiRefreshed: false, resubmitted: false, resubmittedAll: false, verified: false }
      });

      return world;
    },

    walkthrough: [
      'cat /home/gsupport/runbook-txnrep.txt',
      'cat /data/arm/inbound/TXNREP_20260910_Summary.csv',
      'head -4 /data/arm/inbound/TXNREP_20260910_UVRes.csv',
      'awk -F, \'NR>1 {print $2}\' /data/arm/inbound/TXNREP_20260910_UVRes.csv | sort | uniq -c',
      'awk -F, \'$2=="RJCT" {print $3}\' /data/arm/inbound/TXNREP_20260910_UVRes.csv | sort | uniq -c',
      'awk -F, \'$2=="RJCT" {print $6}\' /data/arm/inbound/TXNREP_20260910_UVRes.csv | sort | uniq -c',
      'grep 894500ZZZZZZZZZZ77 /config/lei-registry.csv',
      'cat /var/log/txnrep/lei-refresh.log',
      'curl http://localhost:9700/admin/report/status',
      'curl -X POST http://localhost:9700/admin/lei/refresh',
      'curl -X POST http://localhost:9700/admin/report/resubmit-rejected',
      'curl -X POST http://localhost:9700/admin/report/verify'
    ],

    discoveries: [
      { id: 'reject-count', label: '412 of 88,412 transactions were rejected by the ARM',
        when: function (o) { return /412/.test(PS.world.stripColor(o.out)) && /(RJCT|REJECTED|rejected)/.test(o.out); } },
      { id: 'single-error-code', label: 'Every rejection carries the same error code, CON-412',
        when: function (o) { return /CON-412/.test(o.out); } },
      { id: 'lei-error', label: 'The error is an invalid LEI registration status',
        when: function (o) { return /Invalid LEI|registration status/i.test(o.out); } },
      { id: 'single-counterparty', label: 'Every rejection shares one counterparty LEI',
        when: function (o) { return /894500ZZZZZZZZZZ77/.test(o.out); } },
      { id: 'registry-stale', label: 'The local LEI registry was last refreshed on 2026-06-02',
        when: function (o) { return /2026-06-02/.test(o.out); } },
      { id: 'refresh-failing', label: 'The nightly GLEIF refresh has been failing with 503s',
        when: function (o) { return /GLEIF/.test(o.out) && /503|abandoned/i.test(o.out); } },
      { id: 'deadline-known', label: 'Established the T+1 17:00 deadline for acceptance',
        when: function (o) { return /T\+1|17:00/.test(o.out); } },
      { id: 'scope-understood', label: 'Confirmed only the rejected subset should be resubmitted',
        when: function (o) { return /RJCT subset only|NEVER resubmit the whole file|over-reporting/i.test(o.out); }, optional: true }
    ],

    rootCauses: [
      { text: 'The transaction report file was corrupted in transit to the ARM, so a block of records could not be parsed.' },
      { text: 'The counterparty\'s LEI is no longer in a valid registration status at GLEIF. Our local LEI registry has been stale since 2026-06-02 because the nightly refresh has been failing, so we kept reporting against a lapsed identifier and the ARM rejected every transaction facing that counterparty.', correct: true },
      { text: 'The ARM changed its validation schema without notice and our file layout is now wrong.' },
      { text: 'Our own firm LEI has expired, so all reports against it are invalid.' },
      { text: 'The 412 transactions were executed on a venue whose MIC code we do not populate correctly.' },
      { text: 'Clock drift on the reporting host put the trading timestamps outside the accepted window.' }
    ],

    fix: {
      prompt: 'Get all 88,412 transactions accepted by the ARM before the 17:00 T+1 cut-off, without reporting anything twice.',
      // Submitting is not reporting, and reporting is not finished until you
      // have read the acknowledgement back.
      check: function (world) { return world.flags.resubmitted === true && world.flags.verified === true; },
      grade: function (world) {
        if (world.flags.resubmittedAll) {
          return { quality: 'blunt', bonus: -420,
            note: 'Everything is accepted, and you have reported 88,000 transactions for a\n' +
              'second time. Over-reporting is a reportable breach in its own right, and\n' +
              'unwinding duplicates with the ARM and the regulator is materially harder\n' +
              'than correcting 412 rejects would have been.\n\n' +
              'The endpoint you wanted was resubmit-rejected, which touches only the RJCT\n' +
              'subset. The runbook says this explicitly.' };
        }
        return { quality: 'clean', bonus: 340,
          note: 'You read the feedback file, established that all 412 rejections shared one\n' +
            'error code and one counterparty LEI, traced it to a reference-data refresh\n' +
            'that had been failing silently since June, fixed the data and resubmitted\n' +
            'only the rejected subset. 88,412 accepted, no duplicates, inside the\n' +
            'deadline.\n\n' +
            'The finding worth escalating is not the LEI - it is that a nightly GLEIF\n' +
            'refresh failed for three months without alerting anyone.' };
      }
    },

    hints: [
      'Do not start from the 412 transactions. Start from what they have in common. The feedback file has an ErrorCode column - group by it before you look at anything else.',
      'They all share one error code. Now group the rejections by counterparty LEI and see whether that is one value too: awk -F, \'$2=="RJCT" {print $6}\' ... | sort | uniq -c',
      'One counterparty, one error: an invalid LEI registration status. Look that LEI up in /config/lei-registry.csv and check when the registry was last refreshed.',
      'The nightly GLEIF refresh has been failing since June. Refresh the LEI, then resubmit ONLY the rejected subset - read the runbook on why resubmitting the whole file is worse than the problem.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'Haldane Securities\' LEI lapsed at GLEIF. Our local registry did not notice,\n' +
      'because the nightly GLEIF refresh had been failing with 503s since June and\n' +
      'nothing alerted on it. We carried on reporting against a lapsed identifier,\n' +
      'and the ARM correctly rejected every transaction facing that counterparty.\n' +
      'The reporting system was working exactly as designed; the reference data\n' +
      'underneath it had quietly stopped being maintained.\n\n' +
      'HOW TO READ A FEEDBACK FILE\n' +
      '  1. Summary file first - how many sent, accepted, rejected.\n' +
      '  2. Group by ErrorCode. Rejections almost always cluster.\n' +
      '  3. Group by the business key in the error - LEI, ISIN, venue MIC.\n' +
      '  4. If one value explains them all, the fault is reference data.\n' +
      '     awk -F, \'$2=="RJCT" {print $3}\' file | sort | uniq -c\n' +
      'Reading 412 rejection lines individually is the slow way to reach the same\n' +
      'conclusion the count-and-group pipeline gives you in one command.\n\n' +
      'ACKNOWLEDGEMENT IS THE ONLY THING THAT COUNTS\n' +
      '"We submitted it" is not reporting. A transaction is reported when the ARM\n' +
      'accepts it. FILE_STATUS ACCEPTED_WITH_ERRORS means the file was readable\n' +
      'and some transactions were not reported at all - which is why a dashboard\n' +
      'showing "submitted: 88,412" is dangerously reassuring.\n\n' +
      'WHY YOU NEVER RESUBMIT THE WHOLE FILE\n' +
      'It clears the rejections and creates 88,000 duplicate reports. Under-\n' +
      'reporting and over-reporting are both breaches, and the FCA has published\n' +
      'on both. Duplicates are harder to unwind than corrections: you have to\n' +
      'cancel and replace, and every cancellation is itself a reportable message.\n' +
      'Always resubmit the rejected subset.\n\n' +
      'THE REAL FINDING\n' +
      'A reference-data feed failed for three months in silence. The incident was\n' +
      'the LEI; the problem is that nothing monitors the refresh. That is what\n' +
      'goes in the post-incident actions, not "renew the LEI".\n\n' +
      'INTERVIEW ANGLE\n' +
      'Regulatory reporting support is a large and under-prepared part of these\n' +
      'roles. Knowing that the ARM acknowledgement is the reporting event, that\n' +
      'rejections cluster by reference data, that the deadline is T+1, and that\n' +
      'over-reporting is as much a breach as late reporting will distinguish you\n' +
      'immediately from a candidate who only knows Linux.'
  });
})(PS);
