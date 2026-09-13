/* Original fictional IB/HF investigations, grounded in the primary references
 * attached to each case. These localhost APIs are training runbooks, not vendor APIs. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, GB = 1073741824;
  function put(root, path, content) {
    var parts = path.split('/').filter(Boolean), node = root;
    parts.slice(0, -1).forEach(function (p) { node = node.children[p] || (node.children[p] = V.dir({})); });
    node.children[parts[parts.length - 1]] = V.file(content, { owner: 'support' });
  }
  function host(name, service, runbook) {
    var root = V.dir({});
    put(root, '/home/support/runbook.txt', runbook);
    put(root, '/var/log/' + service + '/audit.log', 'INCIDENT OPEN: preserve business evidence\n');
    put(root, '/tmp/.keep', '');
    return W.create({ host: name, user: 'support', home: '/home/support', root: root, caseService: service,
      clock: new Date(2026, 8, 11, 14, 0, 0), cores: 8, bootSeconds: 864000,
      kernel: '5.14.0-503.el9.x86_64', load: [0.8, 0.7, 0.7],
      cpu: { us: 8, sy: 2, ni: 0, id: 89, wa: 1, st: 0 },
      mem: { total: 32 * GB, free: 20 * GB, cached: 4 * GB, buffers: 0.25 * GB },
      swap: { total: 4 * GB, used: 0 },
      filesystems: [{ dev: '/dev/mapper/os-root', mount: '/', type: 'xfs', size: 100 * GB, used: 24 * GB,
        inodes: { total: 10000000, used: 250000 } }],
      procs: [W.proc({ pid: 7300, user: 'tradeadm', cmd: '/apps/' + service + '/bin/server', short: service, cpu: 3, rss: 2 * GB })],
      services: (function () { var s = {}; s[service] = { active: true, pid: 7300, requiresRoot: false, desc: service }; return s; })(),
      interfaces: [{ name: 'eth1', addr: '10.24.8.45/24', rxOk: 128440, rxDrop: 0, txOk: 482 }],
      hosts: { localhost: { ip: '127.0.0.1', ports: [9982], rtt: 0.02 } },
      httpExact: true, http: {}, flags: {}, sockets: [], diskio: [], dmesg: [] });
  }
  function fail(s) { return { err: s, code: 1 }; }
  function running(w) {
    var p = W.findProc(w, 7300);
    return !!(p && p.state !== 'T' && w.services[w.caseService].active);
  }
  function restart(w) {
    if (!W.findProc(w, 7300)) w.procs.push(W.proc({ pid: 7300, user: 'tradeadm', short: w.caseService,
      cmd: '/apps/' + w.caseService + '/bin/server', cpu: 3, rss: 2 * GB }));
    w.services[w.caseService].active = true;
    w.flags.blunt = true; w.flags.fixed = false;
  }
  function post(w, path, fn) {
    w.http['localhost:9982/' + path] = function (world, req) {
      if (!req || req.method !== 'POST') return fail('Method not allowed: use POST for this fictional runbook operation.');
      if (!running(world)) return fail('Service unavailable: restore the application before using its runbook controls.');
      return fn(world);
    };
  }
  function audit(w, service, text) {
    var p = '/var/log/' + service + '/audit.log', n = V.lookup(w.root, p);
    n.content += text + '\n';
  }
  function evidence(id, label, path, pattern) {
    return { id: id, label: label, when: function (o) {
      return o.code === 0 && o.cmd.indexOf(path) >= 0 && /\b(cat|grep|awk|tail|head|curl)\b/.test(o.cmd) && pattern.test(o.out);
    } };
  }
  function grade(w) {
    return w.flags.blunt ? { quality: 'blunt', bonus: -180, note: 'Restart expanded the interruption without repairing the business data. Scoped recovery and verification were still required.' } :
      { quality: 'clean', bonus: 280, note: 'Affected flow contained, evidence retained, approved recovery validated, and business state reconciled before release.' };
  }
  var bookBase = 'http://localhost:9982/books/';
  PS.scenarios.push({
    id: 'market-book-sequence-gap', title: 'Futures prices move, but the order book is incomplete', severity: 'P1',
    desk: 'Futures Execution / Market Data', host: 'ldn-futures-md07',
    tags: ['A/B multicast', 'sequence gaps', 'snapshot recovery', 'book integrity'], par: 660, currency: 'GBP', impactPerMin: 50000,
    brief: 'PAGER 14:00 UTC — The futures desk sees moving prices, yet depth disagrees with its independent view.\n' +
      'The gateway is UP, both feed NICs receive packets, and only channel FUT-17 is affected.\n' +
      'Establish whether the book can be trusted, contain its use by strategies, and recover consistent depth.\n' +
      'Read /home/support/runbook.txt. All instruments, approvals and APIs are fictional; limits are exercise settings.',
    build: function () {
      var w = host('ldn-futures-md07', 'bookbuilder',
        'FUT-17 recovery runbook INC-MD-17 — desk has authorized a channel-scoped hold.\n' +
        'Investigate /var/log/bookbuilder/feed.log and /data/books/*.csv.\n' +
        'A/B feeds reduce loss; a gap on BOTH requires recovery. Moving prices do not establish complete depth.\n' +
        'All commands below target this simulator only.\n' +
        '1. curl -X POST ' + bookBase + 'hold\n' +
        '2. curl -X POST ' + bookBase + 'capture\n' +
        '3. Inspect candidates.csv and buffered.csv. Select a snapshot with a continuous bridge to buffered increments.\n' +
        '   curl -X POST ' + bookBase + 'recover/SNAP-GOOD\n' +
        '   SNAP-OLD is also available; validate its sequence coverage before selecting it.\n' +
        '4. curl ' + bookBase + 'verify\n' +
        '5. curl -X POST ' + bookBase + 'resume\n' +
        'Recovery discards increments covered by the snapshot, then applies later updates once, in sequence.\n' +
        'The data files are small decoded fixtures, not raw exchange wire messages. A real recovery follows the feed specification.\n');
      w.book = { held: false, recovered: false, verified: false, valid: false, sequence: 104, bidSize: 80, askSize: 95 };
      w.sockets = [{ pid: 7300, fd: 14, proto: 'udp', local: '233.17.1.1:15017', peer: '*:*', state: 'UNCONN', recvq: 0 },
        { pid: 7300, fd: 15, proto: 'udp', local: '233.17.1.2:15017', peer: '*:*', state: 'UNCONN', recvq: 0 }];
      put(w.root, '/var/log/bookbuilder/feed.log', '13:58:59 channel=FUT-17 line=A expected=101 received=103 gap=101-102\n' +
        '13:58:59 channel=FUT-17 line=B expected=101 received=103 gap=101-102\n' +
        '13:59:00 ERROR book_valid=false publish_gate=disabled_after_release_4.6\n' +
        '13:59:02 INFO packets_current=true last_sequence=104 application=UP\n');
      put(w.root, '/data/books/candidates.csv', 'snapshot,last_sequence,bid_size,ask_size\nSNAP-OLD,100,80,95\nSNAP-GOOD,102,120,130\n');
      put(w.root, '/data/books/buffered.csv', 'sequence,side,operation,quantity\n103,BID,ADD,5\n104,ASK,ADD,7\n');
      put(w.root, '/data/books/independent.csv', 'channel,sequence,bid_size,ask_size\nFUT-17,104,125,137\n');
      put(w.root, '/data/books/local.csv', function (x) { return 'channel,sequence,bid_size,ask_size,valid\nFUT-17,' +
        x.book.sequence + ',' + x.book.bidSize + ',' + x.book.askSize + ',' + x.book.valid + '\n'; });
      w.http['localhost:9982/books/status'] = function (x) { return JSON.stringify(x.book, null, 2); };
      post(w, 'books/hold', function (x) { x.book.held = true; x.book.verified = false; audit(x, 'bookbuilder', 'HOLD FUT-17; other channels remain active'); return 'FUT-17 strategies held; risk gate fails closed on invalid books.'; });
      post(w, 'books/capture', function (x) {
        if (!x.book.held) return fail('Hold the affected channel before taking the recovery checkpoint.');
        if (!x.flags.captured) put(x.root, '/evidence/book-before.json', JSON.stringify(x.book, null, 2));
        x.flags.captured = true; return 'Original book and gap checkpoint preserved at /evidence/book-before.json.';
      });
      ['SNAP-OLD', 'SNAP-GOOD'].forEach(function (id) {
        post(w, 'books/recover/' + id, function (x) {
          if (!x.book.held || !x.flags.captured) return fail('Recovery requires a channel hold and captured checkpoint.');
          var last = id === 'SNAP-GOOD' ? 102 : 100;
          if (last + 1 !== 103) return fail('Snapshot rejected: missing sequence 101-102 between snapshot and buffered increments.');
          if (x.book.recovered) return 'Already recovered to 104; duplicate recovery applies no increments.';
          x.book.bidSize = 120 + 5; x.book.askSize = 130 + 7; x.book.sequence = 104;
          x.book.valid = true; x.book.recovered = true; x.book.verified = false;
          audit(x, 'bookbuilder', 'RECOVER SNAP-GOOD through 104; publish validity gate restored');
          return 'Rebuilt bid_size=125 ask_size=137 sequence=104; run independent verification before resuming.';
        });
      });
      w.http['localhost:9982/books/verify'] = function (x) {
        var b = x.book;
        if (!running(x) || !b.held || !b.recovered || b.sequence !== 104 || b.bidSize !== 125 || b.askSize !== 137 || !b.valid)
          return fail('VERIFY FAIL: book has not been reconciled at the same sequence as the independent reference.');
        b.verified = true; put(x.root, '/evidence/book-verification.txt', 'PASS channel=FUT-17 sequence=104 bid_size=125 ask_size=137 gaps=0 duplicate_updates=0\n');
        return 'PASS: independent depth matches at sequence 104; gaps=0 duplicate_updates=0. Ready to resume FUT-17.';
      };
      post(w, 'books/resume', function (x) {
        if (!x.book.valid || !x.book.verified) return fail('Cannot resume an invalid or unverified book.');
        x.book.held = false; x.flags.fixed = true; audit(x, 'bookbuilder', 'RESUME FUT-17 with validity enforcement'); return 'FUT-17 resumed; other channels were unaffected.';
      });
      w.onService = function (x, verb) {
        if (verb === 'restart') { restart(x); x.book.verified = false; audit(x, 'bookbuilder', 'RESTART interrupts all books; recovery still required'); return 'Restart cannot reconstruct missing increments. Recover and verify the affected book.'; }
        return false;
      };
      return w;
    },
    discoveries: [
      evidence('both-lines', 'Both feed lines missed the same sequence range', '/var/log/bookbuilder/feed.log', /line=A expected=101[\s\S]*line=B expected=101/),
      evidence('gate', 'Invalid books continued publishing after a release', '/var/log/bookbuilder/feed.log', /publish_gate=disabled/),
      evidence('candidates', 'Snapshot 102 bridges to buffered updates 103 and 104', '/data/books/candidates.csv', /SNAP-GOOD,102/),
      evidence('increments', 'Buffered increments contain only 103 and 104', '/data/books/buffered.csv', /103,BID,ADD,5[\s\S]*104,ASK,ADD,7/),
      evidence('reference', 'Independent depth is 125 bid and 137 ask at sequence 104', '/data/books/independent.csv', /104,125,137/)
    ],
    rootCauses: [{ text: 'An A/B sequence gap plus a disabled validity gate let incomplete books reach strategies.', correct: true },
      { text: 'CPU saturation makes both network cards stop receiving packets.' }, { text: 'A current packet timestamp proves the full book is correct.' },
      { text: 'Every book discrepancy is a normal difference between venues.' }],
    hints: ['Compare sequence continuity on BOTH feeds, not only packet counts.', 'Read candidates.csv and buffered.csv; a snapshot must bridge the missing history.', 'Hold, capture, select the bridging snapshot, compare depth at the same sequence, then resume.'],
    fix: { prompt: 'Recover FUT-17 with a valid snapshot/increment bridge and reconcile depth before releasing its hold.',
      check: function (w) { return !!(running(w) && w.flags.fixed && w.book.valid && w.book.verified && !w.book.held); }, grade: grade },
    walkthrough: ['cat /var/log/bookbuilder/feed.log', 'cat /data/books/candidates.csv', 'cat /data/books/buffered.csv', 'cat /data/books/independent.csv',
      'curl -X POST ' + bookBase + 'hold', 'curl -X POST ' + bookBase + 'capture', 'curl -X POST ' + bookBase + 'recover/SNAP-GOOD', 'curl ' + bookBase + 'verify', 'curl -X POST ' + bookBase + 'resume'],
    sources: [{ title: 'CME MDP 3.0 market recovery', url: 'https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457672425' }],
    debrief: 'The support decision was whether strategies could trust the book. Packet arrival and a live PID were insufficient. Both lines lost the same updates; recovery used a snapshot through 102 plus increments 103 and 104. A reference comparison at the same sequence proved the final depth. The fictional publish-gate regression was also repaired. Repeating recovery did not add quantities twice.\n\nInterview follow-ups: How do packet and instrument sequences differ? Why might switching A to B not heal a book? What do you report to the execution desk before reopening a channel?\n\nCME documents snapshot/increment synchronization and A/B loss recovery; this simplified additive fixture is original training content, not a wire-protocol implementation.'
  });

  var riskBase = 'http://localhost:9982/risk/';
  PS.scenarios.push({
    id: 'stale-fx-risk-valuation', title: 'FX risk batch is green, but the desk P&L is wrong', severity: 'P1',
    desk: 'Hedge Fund / Portfolio Risk and Valuation', host: 'ldn-fund-risk08',
    tags: ['P&L reconciliation', 'FX marks', 'business date', 'data lineage'], par: 600, currency: 'GBP', impactPerMin: 40000,
    brief: 'PAGER 14:00 UTC — The portfolio manager reports a USD 20,000 valuation break on ALPHA-EU.\n' +
      'The risk job exited 0 and the dashboard is green. Other books match. Operations has not released the report.\n' +
      'Trace the positions, FX inputs and business date. Recover an approved valuation without changing trades or widening risk limits.\n' +
      'Start at /home/support/runbook.txt. This simplified valuation and its control workflow are fictional.',
    build: function () {
      var w = host('ldn-fund-risk08', 'risk-publisher',
        'VALUATION BREAK INC-RISK-08 — Risk Control approved scoped recovery for ALPHA-EU.\n' +
        'Evidence: /data/risk/positions.csv, fx-marks.csv, lineage.csv and /var/log/risk-publisher/batch.log.\n' +
        'Net EUR exposure x USD-per-EUR is the simplified USD mark; the trade set is unchanged.\n' +
        'Review /data/risk/approval.txt before choosing a replacement. Freshness alone does not approve a source.\n' +
        '1. curl -X POST ' + riskBase + 'hold\n2. curl -X POST ' + riskBase + 'capture\n' +
        '3. curl -X POST ' + riskBase + 'select/FX-20260911-APPROVED\n' +
        '   Other candidates: FX-20260910-OLD and FX-20260911-UNAPPROVED.\n' +
        '4. curl -X POST ' + riskBase + 'revalue\n5. curl ' + riskBase + 'verify\n' +
        '6. curl -X POST ' + riskBase + 'release\n' +
        'The scoped revalue also restores the input freshness gate; retries replace this run, never append positions.\n' +
        'These APIs are simulated operational tooling. Risk owns mark approval and report sign-off.\n');
      w.risk = { held: false, selected: 'FX-20260910-OLD', rate: 1.08, date: '2026-09-10', usd: 1080000,
        revalued: false, verified: false, freshnessGate: false, runs: 0 };
      put(w.root, '/data/risk/positions.csv', 'book,position_id,currency,net_amount\nALPHA-EU,P1,EUR,700000\nALPHA-EU,P2,EUR,300000\n');
      put(w.root, '/data/risk/fx-marks.csv', 'input_id,business_date,pair,usd_per_eur,approval\nFX-20260910-OLD,2026-09-10,EURUSD,1.0800,PRIOR_DATE\n' +
        'FX-20260911-APPROVED,2026-09-11,EURUSD,1.1000,RISK-482\nFX-20260911-UNAPPROVED,2026-09-11,EURUSD,1.1300,NONE\n');
      put(w.root, '/data/risk/lineage.csv', 'job,requested_date,selected_date,input_id,exit_code\nVAL-ALPHA,2026-09-11,2026-09-10,FX-20260910-OLD,0\n');
      put(w.root, '/data/risk/approval.txt', 'RISK-482: Risk Control approval for ALPHA-EU; business_date=2026-09-11; input=FX-20260911-APPROVED\n' +
        'Independent reference: net EUR=1000000; EURUSD=1.1000; USD mark=1100000; tolerance=0.01 USD.\n' +
        'Position IDs P1 and P2 must remain unchanged; release only after same-date reconciliation.\n');
      put(w.root, '/var/log/risk-publisher/batch.log', '13:45:00 WARN primary input late; fallback=previous_business_date freshness_check=false\n' +
        '13:45:01 INFO valuation book=ALPHA-EU fx_input=FX-20260910-OLD net_eur=1000000 usd=1080000\n13:45:02 INFO job_status=SUCCESS exit_code=0\n');
      put(w.root, '/data/risk/result.csv', function (x) { return 'book,business_date,net_eur,usd_mark,input_id\nALPHA-EU,' +
        x.risk.date + ',1000000,' + x.risk.usd + ',' + x.risk.selected + '\n'; });
      w.http['localhost:9982/risk/status'] = function (x) { return JSON.stringify(x.risk, null, 2); };
      post(w, 'risk/hold', function (x) { x.risk.held = true; x.flags.fixed = false; audit(x, 'risk-publisher', 'HOLD ALPHA-EU report; other books unchanged'); return 'Report held; affected portfolio identified for Risk Control.'; });
      post(w, 'risk/capture', function (x) {
        if (!x.risk.held) return fail('Hold publication before checkpointing valuation evidence.');
        if (!x.flags.captured) put(x.root, '/evidence/risk-before.json', JSON.stringify(x.risk, null, 2));
        x.flags.captured = true; return 'Original valuation and selected mark preserved at /evidence/risk-before.json.';
      });
      ['FX-20260910-OLD', 'FX-20260911-APPROVED', 'FX-20260911-UNAPPROVED'].forEach(function (input) {
        post(w, 'risk/select/' + input, function (x) {
          if (!x.risk.held || !x.flags.captured) return fail('Hold and capture evidence before selecting a replacement input.');
          if (input === 'FX-20260910-OLD') return fail('Input rejected: wrong business date.');
          if (input !== 'FX-20260911-APPROVED') return fail('Input rejected: no Risk Control approval for this mark.');
          if (x.risk.selected === input) return 'Approved input already selected; no new run created.';
          x.risk.selected = input; x.risk.date = '2026-09-11'; x.risk.rate = 1.10; x.risk.verified = false;
          return 'Same-date input selected under RISK-482. Revalue ALPHA-EU before publishing.';
        });
      });
      post(w, 'risk/revalue', function (x) {
        if (!x.risk.held || !x.flags.captured || x.risk.selected !== 'FX-20260911-APPROVED') return fail('Revalue requires hold, checkpoint and approved same-date marks.');
        if (x.risk.revalued) return 'Run VAL-ALPHA-RECOVERY already committed; no duplicate valuation or position rows.';
        x.risk.usd = Math.round(1000000 * x.risk.rate * 100) / 100; x.risk.revalued = true;
        x.risk.runs++; x.risk.freshnessGate = true; x.risk.verified = false;
        audit(x, 'risk-publisher', 'REVALUE ALPHA-EU RISK-482 usd=1100000 freshness_gate=enabled');
        return 'Valuation recomputed; reconcile to independent reference before release.';
      });
      w.http['localhost:9982/risk/verify'] = function (x) {
        var r = x.risk;
        if (!running(x) || !r.held || !r.revalued || r.date !== '2026-09-11' || Math.abs(r.usd - 1100000) > 0.01 || !r.freshnessGate)
          return fail('VERIFY FAIL: same-date approved valuation and freshness checks are required.');
        r.verified = true; put(x.root, '/evidence/risk-reconciliation.txt', 'PASS RISK-482 position_count=2 net_eur=1000000 usd=1100000 break_usd=0 input_date=2026-09-11\n');
        return 'PASS: P1/P2 unchanged; net EUR=1000000; USD=1100000; break_usd=0. Ready for approved release.';
      };
      post(w, 'risk/release', function (x) {
        if (!x.risk.verified) return fail('Report release blocked pending Risk Control reconciliation.');
        x.risk.held = false; x.flags.fixed = true; audit(x, 'risk-publisher', 'RELEASE reconciled ALPHA-EU report under RISK-482'); return 'Approved ALPHA-EU report released; unrelated books unchanged.';
      });
      w.onService = function (x, verb) {
        if (verb === 'restart') { restart(x); x.risk.verified = false; return 'Restart finished. Persisted input selection is unchanged; reconcile the data before report release.'; }
        return false;
      };
      return w;
    },
    discoveries: [
      evidence('stale', 'Fallback bypassed freshness while returning a successful exit', '/var/log/risk-publisher/batch.log', /freshness_check=false[\s\S]*exit_code=0/),
      evidence('lineage', 'Requested and selected business dates differ', '/data/risk/lineage.csv', /2026-09-11,2026-09-10/),
      evidence('positions', 'Two unchanged positions total EUR 1 million', '/data/risk/positions.csv', /P1,EUR,700000[\s\S]*P2,EUR,300000/),
      evidence('marks', 'Only one same-date mark has Risk approval', '/data/risk/fx-marks.csv', /1.1000,RISK-482/),
      evidence('control', 'Independent approved reference values the book at USD 1.1 million', '/data/risk/approval.txt', /USD mark=1100000/)
    ],
    rootCauses: [{ text: 'A silent prior-date FX fallback bypassed freshness validation, producing a successful but stale valuation.', correct: true },
      { text: 'A successful exit code proves that the P&L data is correct.' }, { text: 'Duplicate position quantities caused the USD difference.' },
      { text: 'The desk should raise its risk limit to remove the valuation break.' }],
    hints: ['Trace requested business date to selected input date; SUCCESS only describes job execution.', 'Sum the EUR positions and compare both FX rates and input approvals.', 'Hold publication, capture evidence, select the approved same-date mark, revalue once, verify and release.'],
    fix: { prompt: 'Restore the approved same-date valuation and freshness gate; reconcile the book before report release.',
      check: function (w) { return !!(running(w) && w.flags.fixed && w.risk.verified && w.risk.freshnessGate && !w.risk.held); }, grade: grade },
    walkthrough: ['cat /var/log/risk-publisher/batch.log', 'cat /data/risk/lineage.csv', 'cat /data/risk/positions.csv', 'cat /data/risk/fx-marks.csv', 'cat /data/risk/approval.txt',
      'curl -X POST ' + riskBase + 'hold', 'curl -X POST ' + riskBase + 'capture', 'curl -X POST ' + riskBase + 'select/FX-20260911-APPROVED',
      'curl -X POST ' + riskBase + 'revalue', 'curl ' + riskBase + 'verify', 'curl -X POST ' + riskBase + 'release'],
    sources: [{ title: 'Citi FX application support responsibilities', url: 'https://jobs.citi.com/job/new-york/application-support-senior-analyst-assistant-vice-president/287/98098154192' },
      { title: 'LSEG evaluated pricing and valuation inputs', url: 'https://www.lseg.com/en/data-analytics/market-data/data-analytics-pricing/evaluated-pricing-data' }],
    debrief: 'The positions were correct; the mark was from the wrong business date. EUR 1,000,000 x (1.10 - 1.08) explains the USD 20,000 break. Job exit 0 and process UP do not certify a valuation. Risk Control owns mark approval; support traced lineage, recovered only ALPHA-EU and reinstated the freshness gate. The final report kept P1/P2 and reconciled to the approved reference. This exercise models a simple FX valuation, not a full P&L or VaR model.\n\nInterview follow-ups: How would you separate trade, price, FX and corporate-action breaks? Which business date and timezone belong in the handover? What evidence proves the repaired batch is fit for use?'
  });
})(PS);
