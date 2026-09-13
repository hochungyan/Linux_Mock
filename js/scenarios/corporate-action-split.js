/* Scenario: a book appears to have lost half its value overnight.
 *
 * Nothing traded. A mandatory 2-for-1 split went ex today, the price feed is
 * post-split, and our positions are still pre-split - so quantity x price is
 * exactly half of reality. The wrong instinct is to "fix" the price, because
 * the price is the only thing in the picture that is correct.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'corporate-action-split',
    title: 'Book value halved overnight with no trades',
    severity: 'P1',
    desk: 'Securities Operations / Corporate Actions',
    host: 'ldn-ca-prod02',
    tags: ['corporate actions', 'stock split', 'ex-date', 'valuation', 'positions'],
    par: 500,
    impactPerMin: 47000,
    currency: 'GBP',

    sources: [
      { title: 'FINRA: stock splits and how holdings are adjusted', url: 'https://www.finra.org/investors/investing/investment-products/stocks/stock-splits' },
      { title: 'Stockopedia: handling splits and other corporate actions - unadjusted holdings misvalue a portfolio', url: 'https://www.stockopedia.com/learn/folios/handling-splits-other-corporate-actions-463178/' },
      { title: 'SWIFT: corporate actions messaging in settlement and custody flows', url: 'https://www.swift.com/resource/corporate-actions-0' }
    ],

    brief:
      'PAGER 07:48 - from the Equity Cash desk, copied to Product Control\n\n' +
      '"ALPHA-CASH is showing down 49% on the overnight P&L and the position\n' +
      'valuation on BIOGEN-equivalent is half what we went home with. We did not\n' +
      'trade it yesterday afternoon and nothing settled.\n\n' +
      'Risk has already flagged a limit breach on the book that is almost\n' +
      'certainly false, and Product Control will not sign off the P&L like this."\n\n' +
      'The desk opens at 08:00. Somebody has suggested overriding the price back\n' +
      'to yesterday\'s close to make the numbers look right.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 7, 48, 20);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var lastNight = new Date(2026, 8, 11, 1, 12, 0);

      var caFeed = [
        'CorpActionId,ISIN,EventType,Ratio,ExDate,RecordDate,PayDate,Mandatory,Status',
        'CA-884120,US09062X1037,SPLIT,2:1,2026-09-11,2026-09-10,2026-09-11,Y,ANNOUNCED',
        'CA-884121,GB00B03MLX29,DIV,0.27,2026-09-18,2026-09-17,2026-10-02,Y,ANNOUNCED',
        'CA-884122,FR0000131104,DIV,0.44,2026-09-25,2026-09-24,2026-10-09,Y,ANNOUNCED'
      ].join('\n');

      var caLoaderLog = [
        W.isoStamp(new Date(lastNight.getTime() - 600000)) + ' INFO  CaLoader - starting nightly corporate action load for 2026-09-11',
        W.isoStamp(lastNight) + ' INFO  CaLoader - read 3 events from /data/ca/inbound/CA_20260911.csv',
        W.isoStamp(new Date(lastNight.getTime() + 2000)) + ' INFO  CaLoader - CA-884121 DIV GB00B03MLX29 ex 2026-09-18: not yet ex, no adjustment required',
        W.isoStamp(new Date(lastNight.getTime() + 2100)) + ' INFO  CaLoader - CA-884122 DIV FR0000131104 ex 2026-09-25: not yet ex, no adjustment required',
        W.isoStamp(new Date(lastNight.getTime() + 2200)) + ' ERROR CaLoader - CA-884120 SPLIT US09062X1037 ex 2026-09-11: position adjustment FAILED',
        W.isoStamp(new Date(lastNight.getTime() + 2210)) + ' ERROR java.sql.SQLException: ORA-00060: deadlock detected while waiting for resource',
        W.isoStamp(new Date(lastNight.getTime() + 2220)) + ' ERROR CaLoader - event CA-884120 left in ANNOUNCED, positions NOT adjusted',
        W.isoStamp(new Date(lastNight.getTime() + 2230)) + ' INFO  CaLoader - run complete: 2 events assessed, 1 failed'
      ].join('\n');

      var priceLog = [
        W.isoStamp(ago(2400)) + ' INFO  PriceLoader - US09062X1037 close 2026-09-10 = 284.60',
        W.isoStamp(ago(1800)) + ' INFO  PriceLoader - US09062X1037 open 2026-09-11 = 142.35 (source adjusted for 2:1 split)',
        W.isoStamp(ago(1700)) + ' INFO  PriceLoader - 2,841 instruments priced, 0 stale'
      ].join('\n');

      var root = V.dir({
        data: V.dir({
          ca: V.dir({
            inbound: V.dir({
              'CA_20260911.csv': V.file(caFeed, { owner: 'caadm', mtime: new Date(lastNight.getTime() - 900000), size: 1200 })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            ca: V.dir({
              'ca-loader.log': V.file(caLoaderLog, { owner: 'caadm', mtime: new Date(lastNight.getTime() + 2230), size: 24 * MB }),
              'price-loader.log': V.file(priceLog, { owner: 'caadm', mtime: ago(1700), size: 62 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            sql: V.dir({
              'position.sql': V.file(
                '-- current position and valuation for the affected ISIN\n' +
                'SELECT book, isin, quantity, price, quantity*price AS market_value\n' +
                '  FROM v$session_positions WHERE isin = \'US09062X1037\';\n',
                { owner: 'gsupport', mtime: ago(400000) })
            }),
            'runbook-corpactions.txt': V.file(
              'CORPORATE ACTIONS RUNBOOK\n' +
              '=========================\n' +
              'WHAT A MANDATORY EVENT DOES\n' +
              '  On the EX-DATE the market begins trading the adjusted security. For a\n' +
              '  2:1 split the price halves and the quantity doubles. Economic value\n' +
              '  is unchanged - that is the whole point.\n' +
              '\n' +
              '  Prices come from the vendor already adjusted on ex-date. QUANTITIES\n' +
              '  are ours to adjust. If the overnight corporate action load does not\n' +
              '  apply the event, we hold pre-split quantity against a post-split\n' +
              '  price and every valuation on that line is wrong by the ratio.\n' +
              '\n' +
              'HOW IT PRESENTS\n' +
              '  A book down by exactly 1/ratio overnight with no trades and no\n' +
              '  settlement. A 2:1 split shows as a 50% drop. That precision is the\n' +
              '  clue: real market moves are not exactly half.\n' +
              '\n' +
              'TRIAGE\n' +
              '  1. Confirm nothing traded or settled - a real move has trades behind it.\n' +
              '  2. Check the corporate action calendar for events going ex TODAY.\n' +
              '  3. Read the overnight CA loader log for failures.\n' +
              '  4. Compare our held quantity against the expected post-event quantity.\n' +
              '\n' +
              'RECOVERY\n' +
              '  curl -X POST http://localhost:9800/admin/ca/status\n' +
              '  curl -X POST http://localhost:9800/admin/ca/apply -d \'{"id":"CA-XXXXXX"}\'\n' +
              '      applies the event to positions and records the adjustment\n' +
              '  curl -X POST http://localhost:9800/admin/valuation/revalue\n' +
              '  curl -X POST http://localhost:9800/admin/ca/verify\n' +
              '      checks quantity x price against the pre-event market value\n' +
              '\n' +
              'NEVER override the price to make P&L look right. On ex-date the\n' +
              '  post-split price is CORRECT and is what the market is trading. An\n' +
              '  override falsifies the official mark, flows into risk, collateral and\n' +
              '  client valuations, and has to be disclosed. The quantity is the side\n' +
              '  that is wrong.\n' +
              '\n' +
              'NEVER suppress the risk limit breach before the valuation is right. The\n' +
              '  breach is a correct response to the numbers as they stand.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-ca-prod02', user: 'gsupport', clock: t0, seed: 884120,
        bootSeconds: 3600 * 24 * 37, cores: 8, users: 4,
        load: [0.62, 0.58, 0.55],
        mem: { total: 32 * GB, free: 16 * GB, buffers: 200 * MB, cached: 7 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 4.2, sy: 1.0, ni: 0, id: 94.6, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB, inodes: { total: 26214400, used: 170204 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 24 * GB, inodes: { total: 52428800, used: 20412 } },
          { dev: '/dev/mapper/vg01-data', mount: '/data', type: 'xfs', size: 200 * GB, used: 40 * GB, inodes: { total: 104857600, used: 18204 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 920 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 380 }),
          W.proc({ pid: 1614, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 18 }),
          W.proc({ pid: 7120, user: 'caadm', short: 'java', cpu: 3.1, rss: 5 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx5g -jar /apps/ca/lib/ca-service.jar',
            started: new Date(2026, 8, 11, 1, 0, 0), cpuSeconds: 640,
            fds: [{ fd: 1, path: '/var/log/ca/ca-loader.log', mode: 'w', size: 24 * MB }] }),
          W.proc({ pid: 20400, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 7120, fd: 11, proto: 'tcp', local: '0.0.0.0:9800', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1614, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        diskio: [{ dev: 'dm-1', rs: 1.4, ws: 24.2, readKB: 20.1, writeKB: 340.2, await: 0.4, util: 1.4 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.99/24', rxOk: 44120088, txOk: 38120044, rxBytes: 8412004120, txBytes: 7120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 18204, txOk: 18204, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [9800, 22], rtt: 0.02 } },

        db: {
          connect: 'posrO/****@POSDB',
          sessions: [],
          transactions: [],
          tablespaces: [{ name: 'POSITIONS_DAT', sizeMb: 256000, usedMb: 104200 }]
        },

        http: {
          'localhost:9800/admin/positions': function (world) {
            var f = world.flags;
            var qty = f.caApplied ? 1200000 : 600000;
            var price = 142.35;
            return JSON.stringify({
              isin: 'US09062X1037', book: 'ALPHA-CASH',
              quantity: qty,
              priceSource: 'vendor', price: price, priceDate: '2026-09-11',
              marketValue: +(qty * price).toFixed(2),
              previousCloseMarketValue: 170760000,
              tradesSinceClose: 0, settlementsSinceClose: 0
            }, null, 2);
          },
          'localhost:9800/admin/ca/status': function (world) {
            return JSON.stringify({
              businessDate: '2026-09-11',
              eventsGoingExToday: [{
                id: 'CA-884120', isin: 'US09062X1037', type: 'SPLIT', ratio: '2:1',
                exDate: '2026-09-11', mandatory: true,
                status: world.flags.caApplied ? 'APPLIED' : 'ANNOUNCED',
                positionsAdjusted: !!world.flags.caApplied
              }],
              lastLoaderRun: '2026-09-11T01:12:02', lastLoaderResult: '2 assessed, 1 failed'
            }, null, 2);
          },
          'localhost:9800/admin/ca/apply': function (world) {
            world.flags.caApplied = true;
            W.appendLog(world, '/var/log/ca/ca-loader.log',
              W.isoStamp(world.clock) + ' INFO  CaLoader - CA-884120 SPLIT 2:1 applied, ALPHA-CASH quantity 600,000 -> 1,200,000');
            return JSON.stringify({
              status: 'ok', event: 'CA-884120', ratio: '2:1',
              positionsAdjusted: 1, quantityBefore: 600000, quantityAfter: 1200000,
              adjustmentRecorded: true
            }, null, 2);
          },
          'localhost:9800/admin/valuation/revalue': function (world) {
            if (!world.flags.caApplied) {
              return JSON.stringify({
                status: 'refused',
                reason: 'corporate action CA-884120 goes ex today and has not been applied; revaluing now would restate the same wrong number'
              }, null, 2);
            }
            world.flags.revalued = true;
            return JSON.stringify({
              status: 'ok', booksRevalued: 1,
              marketValue: 170820000, previousClose: 170760000,
              overnightMovePct: 0.04
            }, null, 2);
          },
          'localhost:9800/admin/price/override': function (world) {
            world.flags.priceOverridden = true;
            world.flags.revalued = true;
            world.flags.caApplied = true;
            return JSON.stringify({
              status: 'ok', isin: 'US09062X1037',
              priceWas: 142.35, priceNow: 284.60, source: 'MANUAL OVERRIDE',
              warning: 'official mark overridden; this feeds risk, collateral and client valuations and is a disclosable manual adjustment'
            }, null, 2);
          },
          'localhost:9800/admin/ca/verify': function (world) {
            world.flags.verified = true;
            return JSON.stringify({
              isin: 'US09062X1037',
              quantity: world.flags.caApplied && !world.flags.priceOverridden ? 1200000 : 600000,
              price: world.flags.priceOverridden ? 284.60 : 142.35,
              marketValue: world.flags.priceOverridden ? 170760000 : (world.flags.caApplied ? 170820000 : 85410000),
              previousCloseMarketValue: 170760000,
              economicallyNeutral: !!world.flags.caApplied,
              priceSource: world.flags.priceOverridden ? 'MANUAL OVERRIDE' : 'vendor',
              riskLimitBreach: !world.flags.caApplied
            }, null, 2);
          }
        },

        services: {
          'ca-service': { active: true, pid: 7120, exe: 'java', desc: 'Corporate Actions Service', requiresRoot: false },
          sshd: { active: true, pid: 1614, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { caApplied: false, revalued: false, priceOverridden: false, verified: false }
      });

      return world;
    },

    walkthrough: [
      'cat /home/gsupport/runbook-corpactions.txt',
      'curl http://localhost:9800/admin/positions',
      'cat /data/ca/inbound/CA_20260911.csv',
      'grep 2026-09-11 /data/ca/inbound/CA_20260911.csv',
      'cat /var/log/ca/ca-loader.log',
      'grep -i error /var/log/ca/ca-loader.log',
      'tail -3 /var/log/ca/price-loader.log',
      'curl http://localhost:9800/admin/ca/status',
      'curl -X POST http://localhost:9800/admin/ca/apply -d \'{"id":"CA-884120"}\'',
      'curl -X POST http://localhost:9800/admin/valuation/revalue',
      'curl -X POST http://localhost:9800/admin/ca/verify'
    ],

    discoveries: [
      { id: 'no-trades', label: 'Nothing traded or settled overnight - this is not a market move',
        when: function (o) { return /tradesSinceClose/.test(o.out); } },
      { id: 'exactly-half', label: 'The drop is exactly half, which points at a ratio, not the market',
        when: function (o) { return /85410000|49%|exactly half|1\/ratio/.test(PS.world.stripColor(o.out)); } },
      { id: 'split-today', label: 'A mandatory 2:1 split on US09062X1037 goes ex today',
        when: function (o) { return /SPLIT/.test(o.out) && /2:1/.test(o.out); } },
      { id: 'loader-failed', label: 'The overnight CA loader failed to apply that event',
        when: function (o) { return /position adjustment FAILED|positions NOT adjusted/i.test(o.out); } },
      { id: 'deadlock', label: 'It failed on an Oracle deadlock and was left in ANNOUNCED',
        when: function (o) { return /ORA-00060|deadlock/i.test(o.out); } },
      { id: 'price-correct', label: 'The vendor price is already split-adjusted and is correct',
        when: function (o) { return /142\.35/.test(PS.world.stripColor(o.out)) && /(adjusted|priceSource|vendor)/i.test(o.out); } },
      { id: 'qty-unadjusted', label: 'Our quantity is still the pre-split 600,000',
        when: function (o) { return /600000|600,000/.test(PS.world.stripColor(o.out)); } },
      { id: 'breach-false', label: 'Confirmed the risk limit breach is a consequence, not a cause',
        when: function (o) { return /riskLimitBreach/.test(o.out); }, optional: true }
    ],

    rootCauses: [
      { text: 'The market data vendor has published a bad price for the instrument and it needs overriding.' },
      { text: 'A mandatory 2:1 split went ex today. The vendor price is correctly halved but the overnight corporate action load failed on a database deadlock, so our quantity is still pre-split - and quantity times price is therefore exactly half the true value.', correct: true },
      { text: 'A large sell trade was booked late yesterday and has not been included in the P&L.' },
      { text: 'The position feed from the custodian did not arrive, so the book is showing a partial position.' },
      { text: 'The risk limit on ALPHA-CASH was reduced overnight, triggering a spurious breach.' },
      { text: 'The valuation engine is using the wrong business date and picking up a stale price.' }
    ],

    fix: {
      prompt: 'Get the book valued correctly before the desk opens at 08:00 - and leave the official mark intact.',
      check: function (world) { return world.flags.revalued === true && world.flags.verified === true; },
      grade: function (world) {
        if (world.flags.priceOverridden) {
          return { quality: 'blunt', bonus: -450,
            note: 'The P&L now looks right and every number behind it is wrong. You put the\n' +
              'pre-split price back on an instrument the market is trading at the post-\n' +
              'split price, so our official mark no longer matches the market. That mark\n' +
              'flows into risk, into collateral calls and into client valuations, and a\n' +
              'manual override of an official price is disclosable.\n\n' +
              'The price was the one thing in the picture that was correct. The quantity\n' +
              'was wrong, and applying the corporate action would have fixed it.' };
        }
        return { quality: 'clean', bonus: 350,
          note: 'You established that nothing had traded, spotted that a 49% move on a 2:1\n' +
            'split day is arithmetic rather than a market event, found the failed\n' +
            'overnight load, applied the corporate action and revalued. Quantity\n' +
            '600,000 -> 1,200,000 against the correct post-split price, book back to a\n' +
            '0.04% overnight move, risk breach cleared, official mark untouched.\n\n' +
            'Raise the loader failure: it hit an Oracle deadlock, logged it, and the\n' +
            'run still reported "complete".' };
      }
    },

    hints: [
      'A book does not lose half its value without trading. Before looking at systems, establish whether anything actually happened: were there trades or settlements overnight?',
      'Nothing traded, and the drop is almost exactly 50%. A round fraction points at a ratio. What corporate actions go ex today?',
      'A mandatory 2:1 split went ex this morning. The vendor price is already halved - that is correct and expected. Check whether our QUANTITY was doubled to match: read the overnight CA loader log.',
      'The loader failed on an ORA-00060 deadlock and left the event in ANNOUNCED. Apply it and revalue. Do not touch the price - the runbook explains why.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'A mandatory 2-for-1 split went ex today. On ex-date the market trades the\n' +
      'adjusted security and the vendor sends the adjusted price, so 284.60 became\n' +
      '142.35 - correctly. Doubling the quantity is OUR job, and the overnight\n' +
      'corporate action load failed on a database deadlock, logged the error, and\n' +
      'still reported the run complete. We were left holding pre-split quantity\n' +
      'against a post-split price, so every valuation on the line was exactly half.\n\n' +
      'THE ARITHMETIC IS THE CLUE\n' +
      'Markets do not move exactly 50%. When a book moves by precisely 1/2, 1/3 or\n' +
      '2/3 overnight with no trades, suspect a ratio before you suspect the market.\n' +
      'A 3:1 split unadjusted shows as -67%; a 1:10 consolidation shows as +900%.\n' +
      'Recognising the number is faster than any log.\n\n' +
      'WHICH SIDE IS WRONG\n' +
      '  Price     comes from the vendor, already adjusted on ex-date. Correct.\n' +
      '  Quantity  comes from us, adjusted by the CA process. This is what broke.\n' +
      'The instinct to "fix the price so P&L looks right" inverts the diagnosis and\n' +
      'replaces a data problem with a control problem: an overridden official mark\n' +
      'propagates into risk, collateral and client valuations, and is disclosable.\n' +
      'Equally, suppressing the risk limit breach hides a correct alarm.\n\n' +
      'TRIAGE ORDER\n' +
      '  1. Did anything trade or settle? If not, it is not a market move.\n' +
      '  2. What goes ex today? Check the corporate action calendar first.\n' +
      '  3. Did the overnight load apply it? Read the loader log, not the summary.\n' +
      '  4. Compare held quantity against expected post-event quantity.\n' +
      '  5. Apply, revalue, and verify against the previous close - the economics\n' +
      '     of a split are neutral, so the market value should barely move.\n\n' +
      'THE REAL FINDING\n' +
      'The loader caught a deadlock, wrote ERROR to a log nobody watches, and\n' +
      'exited reporting "run complete: 2 events assessed, 1 failed". A partial\n' +
      'failure that does not page anyone is how a data problem reaches the desk\n' +
      'before support hears about it. Retry-on-deadlock and alert-on-unapplied-\n' +
      'event-past-ex-date are the actions, not "apply CA-884120".\n\n' +
      'INTERVIEW ANGLE\n' +
      'Corporate actions come up constantly in securities operations and product\n' +
      'control support. Being able to say "a clean fraction overnight with no\n' +
      'trades is a corporate action, the price is right and the quantity is wrong,\n' +
      'and I would never override the mark" answers the question and the follow-up\n' +
      'at the same time.'
  });
})(PS);
