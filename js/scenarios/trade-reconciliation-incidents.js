/* Fictional IB/HF investigations. All controls run in the virtual localhost
 * HTTP simulator; none are FIX, broker, custodian or DTCC production APIs. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, GB = 1073741824, MB = 1048576;
  PS.scenarios = PS.scenarios || [];
  var FIX_SOURCE = { title: 'FIX PossDupFlag code set', url: 'https://fiximate.fixtrading.org/en/FIX.Latest/cds43.html' };
  var DTCC_SOURCE = { title: 'DTCC: Trade Affirmations — Key Questions Answered', url: 'https://www.dtcc.com/insights/2024/trade-affirmations-key-questions-answered-as-t1-approaches' };

  function csv(columns, rows) {
    return [columns.join(',')].concat(rows.map(function (row) {
      return columns.map(function (key) { return row[key] == null ? '' : row[key]; }).join(',');
    })).join('\n') + '\n';
  }
  function json(value) { return JSON.stringify(value, null, 2); }
  function fail(message) { return { err: message, code: 1 }; }
  function put(w, path, body) {
    V.write(w.root, path, body, { owner: 'gsupport', mtime: new Date(w.clock.getTime()) });
  }
  function read(w, path) { return V.read(V.lookup(w.root, path), w); }
  function audit(w, message) { w.trade.audit.push(W.isoStamp(w.clock) + ' ' + message); }
  function changed(w) {
    w.flags.revision++;
    w.flags.verified = -1;
    w.flags.liveVerified = -1;
    w.flags.closed = false;
  }
  function alive(w) {
    var p = W.findProc(w, w.trade.pid);
    return !!(w.services[w.trade.unit].active && p && p.state !== 'T');
  }
  function inputsIntact(w) {
    return Object.keys(w.trade.files).every(function (path) {
      var expected = w.trade.files[path];
      return !!V.lookup(w.root, path) && read(w, path) === (typeof expected === 'function' ? expected(w) : expected);
    });
  }
  function preserved(w) {
    var copies = w.flags.captured;
    return !!copies && inputsIntact(w) && Object.keys(copies).every(function (path) {
      return !!V.lookup(w.root, path) && read(w, path) === copies[path];
    });
  }
  function capture(w) {
    if (!inputsIntact(w)) return fail('409 Evidence changed or missing; preserve the original exports and audit.');
    if (w.flags.captured) return preserved(w) ? 'Evidence already captured; original snapshot retained.' : fail('409 Preserved evidence is missing or changed.');
    w.flags.captured = {};
    Object.keys(w.trade.files).forEach(function (path) {
      var target = '/evidence/before' + path, body = read(w, path);
      put(w, target, body);
      w.flags.captured[target] = body;
    });
    audit(w, 'CAPTURE original exports and audit retained under /evidence/before');
    return 'Evidence captured under /evidence/before; retain originals and append repairs.';
  }
  // The shared curl contract supplies method and argv. Bodies are deliberately
  // small JSON objects; rejecting extra keys avoids an apparently accepted override.
  function route(w, name, method, keys, handler) {
    w.http[w.trade.api + name] = function (world, request) {
      if (!request || request.method !== method) return fail('405 ' + method + ' required for ' + name);
      var args = request.argv || [], bodies = [], body = {};
      for (var i = 1; i < args.length; i++) {
        if (args[i] === '-d' || args[i] === '--data' || args[i] === '--data-raw') bodies.push(args[++i]);
        else if (/^--data(?:-raw)?=/.test(args[i])) bodies.push(args[i].slice(args[i].indexOf('=') + 1));
        else if (/^-d.+/.test(args[i])) bodies.push(args[i].slice(2));
      }
      try { if (bodies.length) body = JSON.parse(bodies[0]); }
      catch (e) { return fail('400 Body must be a JSON object.'); }
      if (bodies.length > 1 || !body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== keys.slice().sort().join(',')) {
        return fail('400 Expected JSON fields: ' + (keys.join(', ') || '(none)'));
      }
      return handler(world, body);
    };
  }
  function base(host, unit, pid, api, runbook, data) {
    var svc = {}, t0 = new Date(2026, 8, 11, 15, 35, 0);
    svc[unit] = { active: true, pid: pid, exe: unit, desc: 'Fictional trade operations adapter', since: t0, requiresRoot: false };
    var w = W.create({
      host: host, user: 'gsupport', clock: t0, seed: pid, cores: 8,
      load: [0.8, 0.7, 0.6], cpu: { us: 5, sy: 1, ni: 0, id: 94, wa: 0, st: 0 },
      mem: { total: 32 * GB, free: 24 * GB, buffers: 128 * MB, cached: 4 * GB },
      swap: { total: 4 * GB, used: 0 },
      root: V.dir({ home: V.dir({ gsupport: V.dir({}) }), tmp: V.dir({}), proc: V.dir({}) }),
      procs: [W.proc({ pid: 1, short: 'systemd', cmd: '/usr/lib/systemd/systemd', rss: 12 * MB }),
        W.proc({ pid: pid, user: 'tradeadm', short: unit, cmd: '/apps/trade/bin/' + unit, cpu: 2, rss: 320 * MB })],
      filesystems: [{ dev: '/dev/mapper/os-root', mount: '/', type: 'xfs', size: 80 * GB, used: 18 * GB, inodes: { total: 4000000, used: 120000 } }],
      services: svc, hosts: { localhost: { ip: '127.0.0.1', ports: [9972], rtt: 0.02 } },
      sockets: [{ pid: pid, fd: 11, proto: 'tcp', local: '127.0.0.1:9972', peer: '0.0.0.0:*', state: 'LISTEN' }],
      httpExact: true, http: {}, flags: { revision: 0, verified: -1, liveVerified: -1, closed: false, disrupted: false },
      trade: data
    });
    data.unit = unit; data.pid = pid; data.api = api; data.files = {}; data.audit = ['2026-09-11 15:34:59 INCIDENT opened; business records retained'];
    put(w, '/home/gsupport/runbook.txt', runbook);
    put(w, '/etc/redhat-release', 'Red Hat Enterprise Linux Server release 7.9 (Maipo)\n');
    evidenceFile(w, '/var/log/trade/audit.log', function (world) { return world.trade.audit.join('\n') + '\n'; });
    route(w, 'capture', 'POST', [], capture);
    w.onService = function (world, verb, name, service) {
      if (String(name).replace(/\.service$/, '') !== unit) return false;
      if (['restart', 'stop', 'start'].indexOf(verb) < 0) return false;
      world.flags.disrupted = true; changed(world);
      service.active = verb !== 'stop';
      if (verb === 'stop') W.killProc(world, pid);
      else if (!W.findProc(world, pid)) {
        world.procs.push(W.proc({ pid: pid, user: 'tradeadm', short: unit, cmd: '/apps/trade/bin/' + unit, cpu: 2, rss: 320 * MB }));
        world.sockets.push({ pid: pid, fd: 11, proto: 'tcp', local: '127.0.0.1:9972', peer: '0.0.0.0:*', state: 'LISTEN' });
      }
      audit(world, 'SERVICE ' + verb + '; ledger, mapping and retry state persisted; fresh business verification required');
      return 'Service ' + verb + ': durable business state unchanged. A restart does not reconcile trades.';
    };
    w.onKill = function (world, proc) {
      if (proc.pid !== pid) return;
      world.services[unit].active = false; world.flags.disrupted = true; changed(world);
      audit(world, 'PROCESS terminated; business state persisted; no reconciliation performed');
    };
    return w;
  }
  function evidenceFile(w, path, body) { w.trade.files[path] = body; put(w, path, body); }
  function finding(id, label, pattern) {
    return { id: id, label: label, when: function (o) { return o.code === 0 && pattern.test(W.stripColor(o.out)); } };
  }
  function grade(w) {
    if (!w.flags.closed) return { quality: 'blunt', bonus: -200, note: 'Recovery is incomplete: approved repair and fresh business verification must precede close.' };
    return w.flags.disrupted ? { quality: 'blunt', bonus: -100, note: 'Business recovery was verified, but the uncoordinated service interruption added risk and did not repair durable records.' } :
      { quality: 'clean', bonus: 340, note: 'Preserved the audit, proved the business discrepancy, applied the approved scoped repair, and verified downstream business state before closing.' };
  }
  function post(api, name, body) { return 'curl -X POST http://' + api + name + (body ? " -d '" + JSON.stringify(body) + "'" : ''); }

  var EXEC_API = 'localhost:9972/admin/execution/';
  var REPAIR = { change: 'CHG-7412', broker: 'BRK-A', tradeDate: '2026-09-11', account: 'HF-ALPHA', execId: 'EX-701', duplicateBooking: 'BOOK-1003' };
  var execSteps = [post(EXEC_API, 'capture'), post(EXEC_API, 'pause'), post(EXEC_API, 'compare'),
    post(EXEC_API, 'approve', { change: 'CHG-7412' }), post(EXEC_API, 'repair', REPAIR),
    post(EXEC_API, 'verify-quantities'), post(EXEC_API, 'resume'), post(EXEC_API, 'verify-live'), post(EXEC_API, 'close')];
  var EXEC_COLUMNS = ['bookingId', 'broker', 'tradeDate', 'account', 'execId', 'symbol', 'side', 'qty', 'price', 'possDup', 'kind', 'reverses'];
  var BROKER_COLUMNS = ['broker', 'tradeDate', 'account', 'execId', 'symbol', 'side', 'qty', 'price'];
  function scope(e) { return [e.broker, e.tradeDate, e.account, e.execId].join('|'); }
  function economics(a, b) { return a.symbol === b.symbol && a.side === b.side && a.qty === b.qty && a.price === b.price; }
  function executionComparison(w) {
    var d = w.trade, seen = {}, duplicates = [];
    d.ledger.filter(function (e) { return e.kind === 'EXECUTION'; }).forEach(function (e) {
      var first = seen[scope(e)], broker = d.broker.filter(function (b) { return scope(b) === scope(e); });
      if (first && economics(first, e) && broker.length === 1 && economics(broker[0], e)) duplicates.push(e.bookingId);
      else if (!first) seen[scope(e)] = e;
    });
    return { scopeContract: 'broker|tradeDate|account|ExecID (fictional broker agreement)',
      confirmedDuplicateBookings: duplicates, possDupWarning: 'PossDupFlag Y alone never proves a duplicate',
      positions: positions(w), mismatchCount: positions(w).filter(function (p) { return p.delta !== 0; }).length };
  }
  function positions(w) {
    var groups = {};
    function add(e, column) {
      var key = [e.tradeDate, e.account, e.symbol].join('|');
      if (!groups[key]) groups[key] = { tradeDate: e.tradeDate, account: e.account, symbol: e.symbol, omsQty: 0, brokerQty: 0, delta: 0 };
      groups[key][column] += e.qty * (e.side === 'BUY' ? 1 : -1);
    }
    w.trade.ledger.forEach(function (e) { add(e, 'omsQty'); });
    w.trade.broker.forEach(function (e) { add(e, 'brokerQty'); });
    return Object.keys(groups).sort().map(function (key) { var p = groups[key]; p.delta = p.omsQty - p.brokerQty; return p; });
  }
  function executionReady(w) {
    return !!(w.flags.repaired && w.trade.dedupeVersion === 2 && preserved(w) && positions(w).every(function (p) { return p.delta === 0; }));
  }

  PS.scenarios.push({
    id: 'duplicate-execution-position-replay', title: 'Hedge fund positions inflate after execution replay',
    severity: 'P1', desk: 'Hedge Fund / OMS and Prime Brokerage Reconciliation', host: 'nyc-oms-prod12',
    tags: ['ExecID', 'PossDupFlag', 'OMS ledger', 'position reconciliation', 'audit'], par: 660, impactPerMin: 48000, currency: 'USD',
    brief: 'PAGER 15:35 — HF-ALPHA shows 750 NOVA bought today; the broker evidence supports 500.\n' +
      'The booking consumer reconnected at 15:31. A colleague proposes dropping every PossDupFlag=Y report\n' +
      'and restarting. Risk is using the inflated position. Investigate the OMS ledger and broker evidence,\n' +
      'preserve the audit, contain booking, and follow the approved correction before resuming.\n' +
      'Read /home/gsupport/runbook.txt. All firms, trades and localhost admin APIs are fictional.',
    sources: [FIX_SOURCE],
    build: function () {
      var broker = [
        { broker: 'BRK-A', tradeDate: '2026-09-11', account: 'HF-ALPHA', execId: 'EX-701', symbol: 'NOVA', side: 'BUY', qty: 250, price: 100 },
        { broker: 'BRK-A', tradeDate: '2026-09-11', account: 'HF-ALPHA', execId: 'EX-702', symbol: 'NOVA', side: 'BUY', qty: 150, price: 100 },
        { broker: 'BRK-B', tradeDate: '2026-09-11', account: 'HF-ALPHA', execId: 'EX-701', symbol: 'NOVA', side: 'BUY', qty: 100, price: 100 },
        { broker: 'BRK-A', tradeDate: '2026-09-11', account: 'HF-BETA', execId: 'EX-701', symbol: 'NOVA', side: 'BUY', qty: 80, price: 100 },
        { broker: 'BRK-A', tradeDate: '2026-09-10', account: 'HF-ALPHA', execId: 'EX-701', symbol: 'NOVA', side: 'BUY', qty: 60, price: 99 }
      ];
      var ledger = broker.map(function (b, i) {
        var e = JSON.parse(JSON.stringify(b)); e.bookingId = 'BOOK-' + (i < 2 ? 1001 + i : 1002 + i);
        e.possDup = i === 1 ? 'Y' : 'N'; e.kind = 'EXECUTION'; e.reverses = ''; return e;
      });
      var replay = JSON.parse(JSON.stringify(ledger[0])); replay.bookingId = 'BOOK-1003'; replay.possDup = 'Y'; ledger.splice(2, 0, replay);
      var runbook = 'FICTIONAL OMS ADMIN RUNBOOK — INC-7412 / approved CHG-7412\n' +
        'All HTTP endpoints below are simulator-only admin APIs, not FIX or broker APIs.\n' +
        'Use explicit -X POST and JSON -d bodies as shown; status is GET.\n' +
        'Inspect /var/log/trade/booking.log and /data/oms-ledger.csv against\n' +
        '/data/broker-executions.csv and /data/broker-wire.log. Opening positions\n' +
        'are zero in this fixture; quantities are signed BUY/SELL intraday movements.\n' +
        'ExecID scope here is broker + tradeDate + account, under this broker agreement.\n' +
        'Compare economics and booked history: PossDupFlag Y only signals possible\n' +
        'retransmission. EX-702 is a valid first booking despite Y. Other brokers,\n' +
        'accounts and trade dates legitimately reuse EX-701. Never delete them.\n' +
        "  awk -F, 'NR>1 {print $2,$3,$4,$5}' /data/oms-ledger.csv | sort | uniq -c\n" +
        'Retain evidence, pause only the booking consumer, then compare. The compare\n' +
        'endpoint creates a report; inspect it before acknowledging the existing\n' +
        'approval in /control/CHG-7412.txt. It does not grant a new approval.\n' +
        execSteps.join('\n') + '\n' +
        'Repair appends a -250 reversal referencing BOOK-1003 and enables durable\n' +
        'scoped dedupe v2. It never removes the original execution or wire audit.\n' +
        'verify-quantities must reconcile every account/date/symbol before resume.\n' +
        'verify-live submits the preserved replay to the virtual consumer as a\n' +
        'canary and checks no new booking or quantity delta. Close requires it.\n' +
        'Pause persists across restart; restart never repairs the ledger.\n' +
        'curl http://' + EXEC_API + 'status\nSource: ' + FIX_SOURCE.url + '\n';
      var w = base('nyc-oms-prod12', 'booking-consumer', 7412, EXEC_API, runbook, { broker: broker, ledger: ledger, dedupeVersion: 1, replaySeen: {}, replayChecks: 0 });
      w.flags.paused = false; w.flags.resumed = false;
      evidenceFile(w, '/data/oms-ledger.csv', function (world) { return csv(EXEC_COLUMNS, world.trade.ledger); });
      evidenceFile(w, '/data/broker-executions.csv', csv(BROKER_COLUMNS, broker));
      evidenceFile(w, '/data/broker-wire.log', '15:30:00 BRK-A 35=8|34=501|43=N|17=EX-701|1=HF-ALPHA|32=250|31=100|55=NOVA|54=1|75=20260911\n' +
        '15:31:00 BRK-A 35=8|34=501|43=Y|17=EX-701|1=HF-ALPHA|32=250|31=100|55=NOVA|54=1|75=20260911\n' +
        '15:31:01 BRK-A 35=8|34=502|43=Y|17=EX-702|1=HF-ALPHA|32=150|31=100|55=NOVA|54=1|75=20260911\n');
      evidenceFile(w, '/var/log/trade/booking.log', '15:30:00 BOOKED BOOK-1001 BRK-A HF-ALPHA EX-701 qty=250\n' +
        '15:31:00 WARN reconnect dedupe_version=1 durable_scope_cache=disabled\n' +
        '15:31:00 BOOKED BOOK-1003 BRK-A HF-ALPHA EX-701 qty=250 replay_seq=501\n' +
        '15:31:01 BOOKED BOOK-1002 BRK-A HF-ALPHA EX-702 qty=150 first_booking=true PossDupFlag=Y\n' +
        '15:34:00 ERROR POSITION_BREAK HF-ALPHA NOVA oms=750 broker=500 delta=250\n');
      evidenceFile(w, '/control/CHG-7412.txt', 'APPROVED by fictional Trade Control + HF Operations\n' +
        'INC-7412 CHG-7412 scope=BRK-A|2026-09-11|HF-ALPHA|EX-701 duplicate=BOOK-1003\n' +
        'Append one reversal of BOOK-1003; retain all originals; activate scoped dedupe v2.\n');
      put(w, '/data/positions.csv', function (world) { return csv(['tradeDate', 'account', 'symbol', 'omsQty', 'brokerQty', 'delta'], positions(world)); });
      route(w, 'status', 'GET', [], function (world) { return json({ consumer: alive(world) ? (world.flags.paused ? 'PAUSED' : 'RUNNING') : 'DOWN', dedupeVersion: world.trade.dedupeVersion, positions: positions(world), closed: world.flags.closed }); });
      route(w, 'pause', 'POST', [], function (world) {
        if (!preserved(world)) return fail('409 Capture and retain evidence before pausing booking.');
        if (!alive(world)) return fail('409 Booking service is down.');
        if (world.flags.paused || world.flags.resumed) return 'Pause already recorded; no state change.';
        world.flags.paused = true; changed(world); audit(world, 'PAUSE booking only; wire ingestion and audit retained'); return 'Booking consumer PAUSED.';
      });
      route(w, 'compare', 'POST', [], function (world) {
        if (!world.flags.paused || !preserved(world)) return fail('409 Compare requires preserved evidence and paused booking.');
        var report = executionComparison(world);
        if (report.confirmedDuplicateBookings.join(',') !== 'BOOK-1003') return fail('409 Evidence does not support the approved duplicate scope.');
        world.flags.compared = true; put(world, '/evidence/execution-comparison.json', json(report)); return json(report);
      });
      route(w, 'approve', 'POST', ['change'], function (world, body) {
        if (body.change !== 'CHG-7412') return fail('403 No approval for that change.');
        if (!world.flags.compared || !world.flags.paused || !preserved(world)) return fail('409 Compare preserved broker and OMS evidence while paused first.');
        if (!world.flags.approved) { world.flags.approved = true; audit(world, 'APPROVAL CHG-7412 acknowledged for BOOK-1003 only'); }
        return 'Existing approval CHG-7412 acknowledged.';
      });
      route(w, 'repair', 'POST', Object.keys(REPAIR), function (world, body) {
        if (!Object.keys(REPAIR).every(function (key) { return body[key] === REPAIR[key]; })) return fail('403 Repair scope differs from CHG-7412; PossDupFlag alone is insufficient.');
        if (!world.flags.approved || !preserved(world) || !alive(world)) return fail('409 Approved comparison, intact evidence and live service required.');
        if (world.flags.repaired) return 'Repair already applied; reversal count remains one.';
        if (!world.flags.paused) return fail('409 Pause booking before repair.');
        if (executionComparison(world).confirmedDuplicateBookings.join(',') !== body.duplicateBooking) return fail('409 Duplicate evidence changed.');
        var correction = JSON.parse(JSON.stringify(world.trade.ledger.filter(function (e) { return e.bookingId === body.duplicateBooking; })[0]));
        correction.bookingId = 'REV-7412'; correction.qty = -correction.qty; correction.kind = 'REVERSAL'; correction.reverses = body.duplicateBooking;
        world.trade.ledger.push(correction); world.trade.dedupeVersion = 2;
        world.trade.ledger.filter(function (e) { return e.kind === 'EXECUTION'; }).forEach(function (e) { world.trade.replaySeen[scope(e)] = true; });
        world.flags.repaired = true; changed(world); audit(world, 'REPAIR CHG-7412 REV-7412 reverses BOOK-1003 qty=-250; dedupe_version=2');
        return 'Repair applied: one retained-audit reversal. Run verify-quantities before resume.';
      });
      route(w, 'verify-quantities', 'POST', [], function (world) {
        if (!world.flags.paused || !alive(world) || !executionReady(world)) return fail('409 Need repaired, paused booking with intact evidence and zero quantity breaks.');
        world.flags.verified = world.flags.revision;
        var result = { quantityVerification: 'PASS', mismatchCount: 0, positions: positions(world), revision: world.flags.revision };
        put(world, '/evidence/quantity-verification.json', json(result)); return json(result);
      });
      route(w, 'resume', 'POST', [], function (world) {
        if (!alive(world) || !executionReady(world)) return fail('409 Healthy reconciled business state required.');
        if (world.flags.resumed) return 'Booking already resumed; no state change.';
        if (world.flags.verified !== world.flags.revision) return fail('409 Fresh post-repair quantity verification required before resume.');
        world.flags.paused = false; world.flags.resumed = true; changed(world); audit(world, 'RESUME booking after zero-break quantity verification');
        return 'Booking resumed. Run verify-live before close.';
      });
      route(w, 'verify-live', 'POST', [], function (world) {
        if (!world.flags.resumed || world.flags.paused || !alive(world) || !executionReady(world)) return fail('409 Resume reconciled booking before live verification.');
        var d = world.trade, before = d.ledger.length, canary = d.ledger[0];
        if (!d.replaySeen[scope(canary)]) return fail('409 Durable dedupe index is missing the replay key.');
        if (world.flags.liveVerified !== world.flags.revision) { d.replayChecks++; audit(world, 'CANARY same scoped EX-701 replay suppressed; new_bookings=0'); }
        world.flags.liveVerified = world.flags.revision;
        return json({ liveVerification: 'PASS', newBookings: d.ledger.length - before, mismatchCount: executionComparison(world).mismatchCount, replayChecks: d.replayChecks });
      });
      route(w, 'close', 'POST', [], function (world) {
        if (!world.flags.resumed || world.flags.paused || !alive(world) || !executionReady(world) || world.flags.liveVerified !== world.flags.revision) return fail('409 Fresh live replay and business verification required before close.');
        if (!world.flags.closed) { world.flags.closed = true; audit(world, 'CLOSE INC-7412 verified HF quantities and replay suppression'); }
        return 'INC-7412 CLOSED: positions reconciled, replay suppressed, audit retained.';
      });
      return w;
    },
    discoveries: [finding('position-break', 'OMS 750 differs from broker 500 by 250', /POSITION_BREAK.*oms=750 broker=500 delta=250/),
      finding('wire-replay', 'Broker wire shows the original and replay with the same scoped ExecID', /43=N\|17=EX-701[\s\S]*43=Y\|17=EX-701/),
      finding('valid-possdup', 'EX-702 is a first booking despite PossDupFlag Y', /EX-702.*first_booking=true PossDupFlag=Y/),
      finding('scoped-proof', 'Compared broker evidence and confirmed only BOOK-1003 is duplicated', /"confirmedDuplicateBookings":\s*\[\s*"BOOK-1003"\s*\]/),
      finding('quantity-check', 'Verified all post-repair quantities', /"quantityVerification": "PASS"/),
      finding('replay-check', 'Verified replay suppression after resuming', /"liveVerification": "PASS"/)],
    rootCauses: [{ text: 'The booking consumer lost its durable scoped dedupe state on reconnect and booked the same BRK-A execution again; the OMS ledger contains two economic postings for one broker execution.', correct: true },
      { text: 'Every PossDupFlag Y report is a duplicate trade and must be removed.' },
      { text: 'ExecID is globally unique, so all EX-701 rows across brokers, dates and accounts must collapse to one.' },
      { text: 'The broker filled another 250 shares; the OMS service restart will align the records.' }],
    fix: { prompt: 'Preserve evidence, pause booking, prove scoped replay, acknowledge approval, append the repair, reconcile quantities, resume and verify before close.',
      check: function (w) { return !!(w.flags.closed && w.flags.resumed && !w.flags.paused && alive(w) && executionReady(w) && w.flags.liveVerified === w.flags.revision); }, grade: grade },
    hints: ['A process can be healthy while the hedge fund position is wrong. Compare the ledger with independent broker evidence.',
      'Use cat, grep and awk on /data/oms-ledger.csv, /data/broker-executions.csv and /data/broker-wire.log. Check broker/date/account as well as ExecID.',
      'EX-701 has a repeated booking in one scope. EX-702 has Y but no earlier booking. Keep the originals and reverse only BOOK-1003.',
      'Read /home/gsupport/runbook.txt: capture, pause, compare, approve, repair, verify-quantities, resume, verify-live, close.'],
    walkthrough: ['cat /home/gsupport/runbook.txt', 'cat /var/log/trade/booking.log', 'cat /data/oms-ledger.csv',
      'cat /data/broker-executions.csv', 'cat /data/broker-wire.log', "awk -F, 'NR>1 {print $2,$3,$4,$5}' /data/oms-ledger.csv | sort | uniq -c", 'cat /control/CHG-7412.txt'].concat(execSteps),
    debrief: 'WHY IT HAPPENED\nThe OMS reconnect discarded dedupe state and replayed one already booked\nexecution. The broker has 500 NOVA shares for HF-ALPHA today; OMS showed\n750. Broker/date/account/ExecID and matching economics identify BOOK-1003.\nThat scope is this fictional broker agreement, not a universal FIX rule.\n\nTRIAGE AND RECOVERY\nCompare CSV economics and the raw original/replay messages. Preserve the\naudit and pause booking. Apply CHG-7412 as a linked reversal plus durable\ndedupe v2. Check every account/date/symbol quantity, then resume and verify\nthat a replay adds no booking. A service restart changes none of the ledger.\n\nTHE TRAP\nPossDupFlag Y indicates possible retransmission, not proof that this consumer\nalready booked the economic execution. EX-702 must stay. Identical ExecIDs\nin other broker, date or account scopes must stay too. Deleting source logs\nor rewriting the original booking destroys the audit needed to explain P&L.\n\nINTERVIEW ANGLE\nSeparate transport retransmission from economic duplication. Explain how you\nwould contain position risk, obtain scoped approval, preserve correction\nlineage and reconcile with the broker before telling the HF desk to resume.\nSource: ' + FIX_SOURCE.url
  });

  var ALLOC_API = 'localhost:9972/admin/allocation/';
  var allocSteps = [post(ALLOC_API, 'capture'), post(ALLOC_API, 'compare'), post(ALLOC_API, 'approve', { change: 'CHG-8820' }),
    post(ALLOC_API, 'refresh-mapping', { change: 'CHG-8820', fromVersion: 17, toVersion: 18 }),
    post(ALLOC_API, 'retry', { ids: ['ALLOC-02', 'ALLOC-03'] }), post(ALLOC_API, 'verify-affirmations'), post(ALLOC_API, 'close')];
  var ALLOC_COLUMNS = ['id', 'blockId', 'account', 'symbol', 'side', 'qty', 'price', 'currency', 'ssi', 'mappingVersion', 'status', 'attempts'];
  function allocationComparison(w) {
    var d = w.trade, total = d.allocations.reduce(function (n, a) { return n + a.qty; }, 0);
    var economicsMatch = d.allocations.every(function (a) {
      var confirms = d.confirms.filter(function (c) { return c.id === a.id; });
      return a.blockId === d.block.id && a.symbol === d.block.symbol && a.side === d.block.side && a.price === d.block.price &&
        a.currency === d.block.currency && confirms.length === 1 && confirms[0].account === a.account &&
        confirms[0].blockId === a.blockId && economics(a, confirms[0]) && a.currency === confirms[0].currency;
    });
    return { blockId: d.block.id, blockQty: d.block.qty, allocatedQty: total, economicsMatch: economicsMatch,
      mappingVersion: d.mapping.version, approvedVersion: d.approvedMapping.version,
      staleAccounts: Object.keys(d.mapping.accounts).filter(function (account) { return d.mapping.accounts[account] !== d.approvedMapping.accounts[account]; }),
      rejectedIds: d.allocations.filter(function (a) { return a.status === 'REJECTED_SSI'; }).map(function (a) { return a.id; }),
      matchedCount: d.allocations.filter(function (a) { return a.status === 'MATCHED_AFFIRMED'; }).length,
      affirmedCount: d.allocations.filter(function (a) { return a.status === 'MATCHED_AFFIRMED'; }).length,
      expectedCount: d.allocations.length, settlementStatus: 'NOT_VERIFIED' };
  }
  function allocationReady(w) {
    var d = w.trade, r = allocationComparison(w);
    return !!(w.flags.refreshed && w.flags.approved && preserved(w) && d.mapping.version === 18 && r.economicsMatch &&
      r.blockQty === r.allocatedQty && r.matchedCount === 3 && r.affirmedCount === 3 && r.rejectedIds.length === 0 &&
      d.allocations.every(function (a) { return d.mapping.accounts[a.account] === a.ssi && d.confirms.some(function (c) { return c.id === a.id && c.ssi === a.ssi; }); }));
  }
  PS.scenarios.push({
    id: 'allocation-ssi-affirmation-mismatch', title: 'Buy-side allocations rejected by stale SSI enrichment',
    severity: 'P1', desk: 'Buy Side / Middle Office and Institutional Affirmation', host: 'nyc-alloc-prod20',
    tags: ['block allocation', 'SSI enrichment', 'versioned mapping', 'affirmation', 'targeted retry'], par: 600, impactPerMin: 32000, currency: 'USD',
    brief: 'PAGER 15:35 — Block BLK-8820 executed 1000 NOVA shares, but only one of three\n' +
      'buy-side allocations is matched and affirmed. Two carry SSI rejects after an account migration.\n' +
      'The adapter is running. Operations suggests replaying the whole block. Compare the block,\n' +
      'allocations and broker confirmations; repair approved enrichment and verify business counts.\n' +
      'Do not report settlement complete from affirmation. Read /home/gsupport/runbook.txt.\n' +
      'The firms, trades, approval records and localhost admin APIs are fictional.',
    sources: [DTCC_SOURCE],
    build: function () {
      var block = { id: 'BLK-8820', symbol: 'NOVA', side: 'BUY', qty: 1000, price: 125, currency: 'USD' };
      var allocations = ['HF-CORE', 'HF-ALT', 'HF-GROWTH'].map(function (account, i) {
        return { id: 'ALLOC-0' + (i + 1), blockId: block.id, account: account, symbol: block.symbol, side: block.side,
          qty: [400, 350, 250][i], price: block.price, currency: block.currency,
          ssi: ['SSI-CORE-1', 'SSI-ALT-OLD', 'SSI-GROWTH-OLD'][i], mappingVersion: 17,
          status: i === 0 ? 'MATCHED_AFFIRMED' : 'REJECTED_SSI', attempts: 1 };
      });
      var mapping = { version: 17, accounts: { 'HF-CORE': 'SSI-CORE-1', 'HF-ALT': 'SSI-ALT-OLD', 'HF-GROWTH': 'SSI-GROWTH-OLD' } };
      var approvedMapping = { version: 18, accounts: { 'HF-CORE': 'SSI-CORE-1', 'HF-ALT': 'SSI-ALT-2', 'HF-GROWTH': 'SSI-GROWTH-2' } };
      var confirms = allocations.map(function (a) { var c = JSON.parse(JSON.stringify(a)); c.ssi = approvedMapping.accounts[a.account]; return c; });
      var runbook = 'FICTIONAL ALLOCATION ADMIN RUNBOOK — INC-8820 / approved CHG-8820\n' +
        'These simulator-only HTTP admin APIs are not DTCC, ALERT or custodian APIs.\n' +
        'Use explicit -X POST and the JSON bodies below. status is GET.\n' +
        'Compare /data/block.csv, /data/allocations.csv, /data/broker-confirms.csv\n' +
        'and /var/log/trade/affirmation.log. Check allocated quantity, account,\n' +
        'symbol, side, price and currency before blaming SSI.\n' +
        "  awk -F, 'NR>1 {sum += $6} END {print sum}' /data/allocations.csv\n" +
        'Compare /config/account-ssi.csv with /control/account-ssi-v18.csv and\n' +
        '/control/CHG-8820.txt. Version 18 is a pre-approved static-data release.\n' +
        'Capture evidence and compare before acknowledging that approval; support\n' +
        'cannot invent or directly edit payment instructions. Refresh atomically\n' +
        'from v17 to v18. A refresh alone does not reprocess rejected allocations.\n' +
        allocSteps.join('\n') + '\n' +
        'Retry supports nonempty subsets of ALLOC-02 and ALLOC-03 only. Already\n' +
        'successful retries are no-ops. ALLOC-01 was affirmed and must not be sent.\n' +
        'This fixture uses auto-affirmation on a successful central match. Check\n' +
        'matched=3, affirmed=3, rejected=0 and allocatedQty=blockQty=1000 after\n' +
        'the repair. Affirmation is a pre-settlement acknowledgement; cash and\n' +
        'securities movement are NOT verified here. Never claim settlement.\n' +
        'Restart retains the stale mapping and rejection states.\n' +
        'curl http://' + ALLOC_API + 'status\nSource: ' + DTCC_SOURCE.url + '\n';
      var w = base('nyc-alloc-prod20', 'allocation-adapter', 8820, ALLOC_API, runbook,
        { block: block, allocations: allocations, confirms: confirms, mapping: mapping, approvedMapping: approvedMapping, eligibleRetryIds: ['ALLOC-02', 'ALLOC-03'] });
      function mappingCsv(m) { return csv(['account', 'ssi', 'version'], Object.keys(m.accounts).map(function (account) { return { account: account, ssi: m.accounts[account], version: m.version }; })); }
      evidenceFile(w, '/data/block.csv', csv(['id', 'symbol', 'side', 'qty', 'price', 'currency'], [block]));
      evidenceFile(w, '/data/allocations.csv', function (world) { return csv(ALLOC_COLUMNS, world.trade.allocations); });
      evidenceFile(w, '/data/broker-confirms.csv', csv(['id', 'blockId', 'account', 'symbol', 'side', 'qty', 'price', 'currency', 'ssi'], confirms));
      evidenceFile(w, '/config/account-ssi.csv', function (world) { return mappingCsv(world.trade.mapping); });
      evidenceFile(w, '/control/account-ssi-v18.csv', mappingCsv(approvedMapping));
      evidenceFile(w, '/control/CHG-8820.txt', 'APPROVED by fictional Static Data Control + Middle Office\n' +
        'CHG-8820 account-ssi fromVersion=17 toVersion=18; broker/custodian records validated.\n' +
        'Retry scope ALLOC-02,ALLOC-03 only; preserve ALLOC-01 affirmation.\n');
      evidenceFile(w, '/var/log/trade/affirmation.log', '15:20:00 INFO static-data published version=18 account migration complete\n' +
        '15:20:01 ERROR mapping-refresh subscription missed version=18; persisted_version=17\n' +
        '15:32:00 ALLOC-01 MATCHED_AFFIRMED SSI-CORE-1 qty=400\n' +
        '15:32:01 ALLOC-02 REJECTED_SSI sent=SSI-ALT-OLD expected=SSI-ALT-2 qty=350\n' +
        '15:32:02 ALLOC-03 REJECTED_SSI sent=SSI-GROWTH-OLD expected=SSI-GROWTH-2 qty=250\n' +
        '15:34:00 BLOCK BLK-8820 matched=1 affirmed=1 rejected=2 settlement=NOT_VERIFIED\n');
      route(w, 'status', 'GET', [], function (world) { return json(allocationComparison(world)); });
      route(w, 'compare', 'POST', [], function (world) {
        if (!preserved(world)) return fail('409 Capture and retain original allocation evidence first.');
        var report = allocationComparison(world);
        if (!report.economicsMatch || report.blockQty !== report.allocatedQty) return fail('409 Block/allocation/broker economics do not reconcile; SSI refresh is not an economic repair.');
        world.flags.compared = true; put(world, '/evidence/allocation-comparison.json', json(report)); return json(report);
      });
      route(w, 'approve', 'POST', ['change'], function (world, body) {
        if (body.change !== 'CHG-8820') return fail('403 No approved static-data change for that reference.');
        if (!world.flags.compared || !preserved(world)) return fail('409 Compare preserved block, allocations and broker evidence first.');
        if (!world.flags.approved) { world.flags.approved = true; audit(world, 'APPROVAL CHG-8820 acknowledged; mapping v17 to v18'); }
        return 'Existing Static Data Control approval CHG-8820 acknowledged.';
      });
      route(w, 'refresh-mapping', 'POST', ['change', 'fromVersion', 'toVersion'], function (world, body) {
        if (body.change !== 'CHG-8820' || body.fromVersion !== 17 || body.toVersion !== 18) return fail('403 Version transition must match approved CHG-8820: 17 -> 18.');
        if (!world.flags.approved || !preserved(world) || !alive(world)) return fail('409 Approved comparison, preserved evidence and live adapter required.');
        if (world.flags.refreshed && world.trade.mapping.version === 18) return 'Mapping refresh already committed at v18; no retries performed.';
        if (world.trade.mapping.version !== body.fromVersion) return fail('409 Current mapping version differs from the expected version.');
        world.trade.mapping = JSON.parse(JSON.stringify(world.trade.approvedMapping)); world.flags.refreshed = true;
        changed(world); audit(world, 'REFRESH CHG-8820 mapping v17 -> v18 atomically; rejection states unchanged');
        return 'Mapping version 18 committed. Rejected allocations still require targeted retry.';
      });
      route(w, 'retry', 'POST', ['ids'], function (world, body) {
        var d = world.trade, ids = body.ids;
        if (!Array.isArray(ids) || !ids.length || ids.some(function (id, i) { return typeof id !== 'string' || ids.indexOf(id) !== i || d.eligibleRetryIds.indexOf(id) < 0; })) return fail('400 Retry only unique originally rejected IDs ALLOC-02 and ALLOC-03; never the whole block.');
        if (!world.flags.refreshed || !world.flags.approved || d.mapping.version !== 18 || !preserved(world) || !alive(world)) return fail('409 Approved mapping refresh and intact evidence required before retry.');
        var report = allocationComparison(world);
        if (!report.economicsMatch || report.blockQty !== report.allocatedQty) return fail('409 Economic discrepancy prevents retry.');
        var pending = d.allocations.filter(function (a) { return ids.indexOf(a.id) >= 0 && a.status === 'REJECTED_SSI'; });
        if (pending.some(function (a) { return !d.confirms.some(function (c) { return c.id === a.id && c.ssi === d.mapping.accounts[a.account]; }); })) return fail('409 Refreshed SSI still differs from broker evidence.');
        if (pending.length) {
          pending.forEach(function (a) { a.ssi = d.mapping.accounts[a.account]; a.mappingVersion = d.mapping.version; a.status = 'MATCHED_AFFIRMED'; a.attempts++; audit(world, 'RETRY ' + a.id + ' v18 matched and affirmed; settlement NOT_VERIFIED'); });
          changed(world);
        }
        return json({ retriedIds: pending.map(function (a) { return a.id; }), alreadyProcessedIds: ids.filter(function (id) { return !pending.some(function (a) { return a.id === id; }); }), settlementStatus: 'NOT_VERIFIED' });
      });
      route(w, 'verify-affirmations', 'POST', [], function (world) {
        if (!alive(world) || !allocationReady(world)) return fail('409 Need all 3 matched and affirmed, zero rejects, matching quantities/SSI and intact audit.');
        world.flags.verified = world.flags.revision;
        var report = allocationComparison(world); report.affirmationVerification = 'PASS'; report.revision = world.flags.revision;
        put(world, '/evidence/affirmation-verification.json', json(report)); return json(report);
      });
      route(w, 'close', 'POST', [], function (world) {
        if (!alive(world) || !allocationReady(world) || world.flags.verified !== world.flags.revision) return fail('409 Fresh post-retry business verification required before close.');
        if (!world.flags.closed) { world.flags.closed = true; audit(world, 'CLOSE INC-8820 matched=3 affirmed=3 rejected=0; settlement NOT_VERIFIED'); }
        return 'INC-8820 CLOSED: matched=3 affirmed=3 rejected=0. Settlement NOT_VERIFIED.';
      });
      return w;
    },
    discoveries: [finding('ssi-rejects', 'Only ALLOC-02 and ALLOC-03 carry stale SSI rejects', /ALLOC-02 REJECTED_SSI[\s\S]*ALLOC-03 REJECTED_SSI/),
      finding('stale-version', 'Adapter missed static-data version 18 and persisted version 17', /mapping-refresh.*missed version=18; persisted_version=17/),
      finding('economic-match', 'Block, allocation and broker economics reconcile at 1000 shares', /"blockQty": 1000,[\s\S]*"allocatedQty": 1000,[\s\S]*"economicsMatch": true/),
      finding('mapping-scope', 'Compared the two stale account mappings', /"staleAccounts":\s*\[\s*"HF-ALT",\s*"HF-GROWTH"/),
      finding('affirmed', 'Verified all three affirmations after targeted retries', /"affirmationVerification": "PASS"/),
      finding('settlement-distinct', 'Recognized that settlement remains unverified', /settlement=NOT_VERIFIED|"settlementStatus": "NOT_VERIFIED"/)],
    rootCauses: [{ text: 'The block is underallocated; the missing quantity must be assigned to a new account.' },
      { text: 'The adapter missed the approved v18 account-to-SSI refresh and persisted v17, enriching two valid allocations with stale instructions that the broker rejects.', correct: true },
      { text: 'The broker has already affirmed all allocations, which proves the cash and securities settled.' },
      { text: 'All allocations need resending because a service restart erased their broker acknowledgements.' }],
    fix: { prompt: 'Preserve and compare business evidence, acknowledge approved versioned SSI refresh, retry only rejected IDs, verify quantities and all three affirmations, then close.',
      check: function (w) { return !!(w.flags.closed && alive(w) && allocationReady(w) && w.flags.verified === w.flags.revision); }, grade: grade },
    hints: ['Check the economic records first. A running adapter and an executed block do not imply every allocation was affirmed.',
      'Sum allocation quantities and compare accounts, price, side and currency with /data/block.csv and /data/broker-confirms.csv. Read the SSI reject lines.',
      'The adapter kept mapping v17 after the approved v18 migration. Compare /config/account-ssi.csv with /control/account-ssi-v18.csv.',
      'The runbook sequences capture, compare, approve, refresh-mapping, retry ALLOC-02/03, verify-affirmations and close. ALLOC-01 must remain untouched.'],
    walkthrough: ['cat /home/gsupport/runbook.txt', 'cat /var/log/trade/affirmation.log', 'cat /data/block.csv', 'cat /data/allocations.csv',
      "awk -F, 'NR>1 {sum += $6} END {print sum}' /data/allocations.csv", 'cat /data/broker-confirms.csv', 'cat /config/account-ssi.csv',
      'cat /control/account-ssi-v18.csv', 'cat /control/CHG-8820.txt'].concat(allocSteps),
    debrief: 'WHY IT HAPPENED\nThe block and its allocations agree on 1000 NOVA shares and the economic\nterms. Two migrated accounts still use old SSIs because the adapter missed\nthe approved mapping refresh and persisted v17. One allocation already\nmatched and affirmed; the other two were rejected during enrichment.\n\nTRIAGE AND RECOVERY\nCompare block, allocations, broker confirmations and mapping versions.\nCapture the audit; acknowledge the existing static-data approval and refresh\natomically from v17 to v18. Retry only rejected IDs. Retain ALLOC-01 and\nmake retries idempotent. Then verify allocated quantity, correct SSI,\nmatched=3, affirmed=3 and rejected=0 before closing the affirmation incident.\n\nTHE TRAP\nAn adapter restart neither refreshes durable mapping nor reconciles trades.\nA mapping refresh alone does not retry rejects. Replaying the entire block\nrisks duplicate processing of an already affirmed allocation. This fictional\nworkflow auto-affirms a successful match; other workflows can differ.\nAffirmation acknowledges agreement on trade details before settlement; it\ndoes not prove cash or securities moved. Settlement remains NOT_VERIFIED.\n\nINTERVIEW ANGLE\nExplain economic matching versus reference-data enrichment, versioned change\ncontrol, partial batch failure and idempotent retry. Tell middle office\nexactly what was affirmed and what still needs settlement monitoring.\nSource: ' + DTCC_SOURCE.url
  });
})(PS);
