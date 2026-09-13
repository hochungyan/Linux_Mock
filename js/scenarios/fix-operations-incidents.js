/* Original fictional FIX investigations. Pipe-delimited logs are abbreviated
 * decoded extracts, not wire messages; fixctl is NOT a real engine/venue API. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, GB = 1073741824;
  var STANDARD = { title: 'FIX Trading Community: FIX Session Layer', url: 'https://www.fixtrading.org/standards/fix-session-layer-online/' };
  var TESTS = { title: 'FIX Trading Community: Session Layer Test Cases', url: 'https://www.fixtrading.org/standards/fix-session-testcases-online/' };
  var DROP = { title: 'CME Group: Drop Copy FAQ (venue-specific example)', url: 'https://www.cmegroup.com/solutions/market-access/globex/trade-on-globex/faq-drop-copy.html' };
  var ENGINE = { title: 'QuickFIX/C++ configuration (engine-specific)', url: 'https://quickfixengine.org/c/documentation/getting-started/configuration.html' };
  var LOG = '/var/log/fix/session.log', CONFIG = '/etc/fix/session.cfg';
  var BUSINESS = '/var/lib/fix/business.json', APPROVAL = '/home/gsupport/peer-agreement.txt';
  var RUNBOOK = '/home/gsupport/runbook-fix.txt', STORE = '/var/lib/fix/sequence-store.json';
  function json(o) { return JSON.stringify(o, null, 2); }
  function fail(s) { return { err: 'fixctl guard: ' + s, code: 1 }; }
  function write(w, p, s) { V.write(w.root, p, s, { owner: 'gsupport', mtime: new Date(w.clock.getTime()) }); }
  function read(w, p) { var n = V.lookup(w.root, p); return n ? V.read(n, w) : null; }
  function key(e) { return [e.broker, e.tradeDate, e.account, e.execId].join('|'); }
  function event(id, qty) { return { broker: 'BROKER-A', tradeDate: '2026-09-11', account: 'HF-ALPHA', execId: id, symbol: 'XYZ', side: 'BUY', qty: qty }; }
  var cases = [
    {
      id: 'fix-resend-gap-recovery', title: 'Sequence gap: recover executions without resetting', kind: 'gap', session: 'DC-GAP',
      tags: ['ResendRequest', 'PossDupFlag', 'GapFill', 'reconciliation'], change: 'CHG-F101',
      symptom: 'The receiver expects 501 but gets 504. Risk is missing two fills. The next message is buffered, not applied.',
      cause: 'A disconnect lost inbound messages 501–503. Recover the missing executions and administrative gap before releasing buffered 504; a reset would hide the loss.',
      config: 'Session=DC-GAP\nHeartBtInt=30\nPersistMessages=Y\nResetOnDisconnect=N\n',
      log: '08:59:58 IN 35=0|34=500\n09:00:02 IN 35=8|34=504|17=EX-504|32=40 BUFFERED expected=501\nWARN missing=501-503 peer archive: 501=execution 502=heartbeat 503=execution',
      permission: 'Recover inbound 501..503 from the retained peer archive. 502 is administrative only. No reset approval. Never gap-fill missing executions.',
      repair: ['resend 501 503'],
      lesson: 'The engine requests 501–503 using 35=2,7=501,16=503. Replayed application messages retain original 34, with 43=Y and 122. The eligible administrative slot is covered by 35=4,123=Y,36=503; that is not a reset to 1. Buffered 504 is then delivered once. Reconcile scoped execution identities, not just sequence counters.'
    },
    {
      id: 'fix-coordinated-sequence-reset', title: 'Reset to 1: prove both sides are ready first', kind: 'reset', session: 'ORDER-A',
      tags: ['sequence reset', '141=Y', 'bilateral approval', 'order safety'], change: 'CHG-F102',
      symptom: 'At the agreed session boundary, a peer has staged a new session at 1. Our durable next-out/next-in counters are 901/701. Trading remains held.',
      cause: 'The scheduled bilateral session transition was not applied locally. A scoped reset is permitted only after preservation, order reconciliation, approval and disconnect.',
      config: 'Session=ORDER-A\nHeartBtInt=30\nResetOnLogon=N\nResetOnDisconnect=N\n',
      log: '07:54:59 OUT 35=5|34=900; IN 35=5|34=700 session boundary\n07:55:00 ADMIN peer staged nextIn=1 nextOut=1 at agreed new-session boundary\n07:55:01 LOCAL nextOut=901 nextIn=701 held=true\nNOTICE healthy ORDER-B must remain untouched',
      permission: 'Both operations teams approved CHG-F102 for ORDER-A only at this boundary, after order reconciliation. No live orders, unresolved executions or pending replay. Peer will acknowledge Logon 34=1,141=Y. This is a fictional bilateral rule, not a universal venue policy.',
      repair: ['disconnect', 'reset 1 1', 'connect'],
      lesson: 'There are independent incoming and outgoing sequence counters. This exercise resets both to 1 under an explicit new-session agreement, then consumes Logon 34=1 in each direction. ResetSeqNumFlag(141) belongs to Logon; it is not GapFillFlag(123). Persist the new state and verify application outcomes. Never delete a store, enable automatic resets globally, or resend live orders just to obtain a green session.'
    },
    {
      id: 'fix-heartbeat-testrequest', title: 'Heartbeats arrive, but the TestRequest is unanswered', kind: 'heartbeat', session: 'DC-HB',
      tags: ['heartbeat', 'TestReqID', 'TCP vs FIX', 'session recovery'], change: 'CHG-F103',
      symptom: 'TCP is ESTABLISHED and periodic heartbeats appear, but a fresh TestRequest does not receive its matching response. The drop-copy session processor may be stuck.',
      cause: 'The peer session dispatcher is stalled while a separate heartbeat sender still runs. Ordinary heartbeats do not answer TestRequest HB-OLD; coordinate a peer repair and session reconnect.',
      config: 'Session=DC-HB\nHeartBtInt=30\nTestRequestThreshold=1.5\nPolicy=fictional negotiated peer policy; not a universal timeout\n',
      log: '09:00:00 OUT 35=1|34=811|112=HB-OLD\n09:00:15 IN 35=0|34=611 (no 112)\n09:00:30 IN 35=0|34=612|112=UNRELATED\n09:00:45 ERROR TestRequest HB-OLD unanswered at agreed deadline\nPEER diagnostic: dispatcher=STALLED heartbeat-writer=RUNNING',
      permission: 'CHG-F103 approves Logout/disconnect for DC-HB, peer dispatcher recovery, then reconnect preserving durable counters. Peer archive has no missing application messages. No sequence reset.',
      repair: ['disconnect', 'peer-repair CHG-F103', 'connect'],
      lesson: 'Look for 35=1 and the same 112 on a subsequent 35=0. A heartbeat without that ID, or with an unrelated ID, does not satisfy this test. HeartBtInt(108) and the agreed timeout policy matter; active application traffic also provides session activity. A timed-out session requires the approved disconnect/recovery path. A successful TCP connect alone proves neither FIX responsiveness nor complete drop copy.'
    },
    {
      id: 'fix-dropcopy-source-mapping', title: 'Drop copy is green, but one source session is absent', kind: 'mapping', session: 'DC-MAP',
      tags: ['drop copy', 'source mapping', 'entitlements', 'missing fills'], change: 'CHG-F104',
      symptom: 'DC-MAP is logged on, with continuous sequence numbers and fresh heartbeats. ORDER-B trades do not reach risk; ORDER-A trades do.',
      cause: 'The approved source ORDER-B is absent from the drop-copy group mapping. Session health is normal; add the approved mapping and recover its missing business events.',
      config: 'Session=DC-MAP\nSources=ORDER-A\nApprovedSources=ORDER-A,ORDER-B\nHeartBtInt=30\n',
      log: '09:00:00 IN 35=0|34=610\n09:00:01 IN 35=8|34=611|17=EX-501 source=ORDER-A\n09:00:02 IN 35=0|34=612\nWARN source=ORDER-B venue executions=2 copied=0 sequence gaps=0',
      permission: 'CHG-F104: clearing/venue operations have approved ORDER-B on DC-MAP. This lab adapter models that external mapping change and a scoped business recovery export. No order entry/cancellation through drop copy and no sequence reset.',
      repair: ['map-source ORDER-B CHG-F104', 'recover-source ORDER-B'],
      lesson: 'Check the source-to-target mapping and approved scope, then compare venue activity with received copies. A contiguous target FIX sequence cannot reveal events never routed onto it. Mapping changes and historical business recovery follow the venue procedure; they are not necessarily FIX ResendRequests. This lab backfill models an approved export import. Drop copy is read-only for trading; recovering copies must not submit orders.'
    },
    {
      id: 'fix-dropcopy-consumer-lag', title: 'FIX received the fills; risk never applied them', kind: 'consumer', session: 'DC-LAG',
      tags: ['drop copy', 'checkpoint', 'consumer lag', 'idempotent replay'], change: 'CHG-F105',
      symptom: 'The FIX engine received all three executions. Its session is healthy, yet the downstream position has stopped at the first event after a consumer deployment.',
      cause: 'Consumer release schema-v1 cannot parse the approved schema-v2 export. The FIX receive checkpoint advances while the application checkpoint stalls; repair the consumer and replay its durable inbox.',
      config: 'Session=DC-LAG\nConsumerSchema=schema-v1\nApprovedSchema=schema-v2\nDedupScope=broker,tradeDate,account,ExecID\n',
      log: '09:00:00 IN 35=8|34=610|17=EX-501\n09:00:01 IN 35=8|34=611|17=EX-503\n09:00:02 IN 35=8|34=612|17=EX-504\n09:00:03 CONSUMER schema mismatch expected=schema-v1 got=schema-v2\nMETRIC receivedExecutions=3 appliedExecutions=1 inboxCheckpoint=3 applicationCheckpoint=1',
      permission: 'CHG-F105 approves deploying the tested schema-v2 consumer for DC-LAG and reprocessing its retained inbox. Preserve FIX stores; deduplicate on the documented broker/date/account/ExecID scope, validate economics. No sequence reset.',
      repair: ['consumer-schema schema-v2 CHG-F105', 'replay-inbox'],
      lesson: 'The FIX session receive sequence and downstream application checkpoint are different. Fix the consumer contract, replay its durable inbox idempotently, and reconcile quantities. This is application recovery, not a FIX counter reset or new order submission. PossDupFlag alone is not a business deduplication key; identity scope and trade corrections are counterparty-specific.'
    },
    {
      id: 'fix-logon-compid-mismatch', title: 'Logon rejected after a configuration promotion', kind: 'identity', session: 'ORDER-ID',
      tags: ['Logon', 'CompID', 'environment', 'Logout reason'], change: 'CHG-F106',
      symptom: 'Transport and TLS checks pass, but the production peer immediately sends a Logout after Logon. Other sessions are trading normally.',
      cause: 'A test SenderCompID was promoted into the production profile. The Logout identifies the unauthorized identity; correct the approved production CompID without changing sequence state.',
      config: 'Session=ORDER-ID\nEnvironment=PROD\nSenderCompID=HF_UAT\nTargetCompID=BROKER_PROD\nApprovedSenderCompID=HF_PROD\n',
      log: '09:00:00 TRANSPORT TLS verified peer certificate; TCP connected\n09:00:01 OUT 35=A|34=810|49=HF_UAT|56=BROKER_PROD|108=30\n09:00:01 IN 35=5|34=610|58=SenderCompID not entitled on PROD\n09:00:02 ADMIN persisted nextOut=811 nextIn=611; connection closed',
      permission: 'CHG-F106 approves SenderCompID=HF_PROD and TargetCompID=BROKER_PROD for ORDER-ID. The peer confirms expected next incoming=811 and next outgoing=611. No reset and no credential rotation are approved.',
      repair: ['disconnect', 'identity HF_PROD BROKER_PROD CHG-F106', 'connect'],
      lesson: 'Read the Logout Text(58), compare 49/56, environment and approved session profile. Valid transport or TLS does not prove FIX identity is accepted. Correct only the authorized profile and reconnect with reconciled persisted counters; a sequence reset will not fix an entitlement mismatch. Never expose real credentials in logs or support tickets.'
    }
  ];

  function build(c) {
    var w = W.create({ host: 'ldn-fix-lab01', user: 'gsupport', clock: new Date(2026, 8, 11, 9, 1), cores: 8,
      root: V.dir({ home: V.dir({ gsupport: V.dir({}) }), tmp: V.dir({}), proc: V.dir({}) }),
      load: [0.3, 0.4, 0.4], mem: { total: 16 * GB, free: 12 * GB, buffers: GB / 8, cached: GB },
      procs: [W.proc({ pid: 6200, user: 'fixadm', short: 'fix-engine', cmd: '/opt/fix/bin/fix-engine', cpu: 2, rss: GB })],
      services: { fixengine: { active: true, pid: 6200, exe: 'fix-engine', desc: 'FIX Lab Engine', requiresRoot: false } },
      sockets: [{ pid: 6200, fd: 9, proto: 'tcp', local: '10.14.22.91:45110', peer: '198.51.100.51:9100', state: 'ESTABLISHED' }],
      filesystems: [{ dev: '/dev/root', mount: '/', type: 'xfs', size: 80 * GB, used: 12 * GB, inodes: { total: 1000000, used: 40000 } }]
    });
    var all = [event('EX-501', 10), event('EX-503', 20), event('EX-504', 40)];
    var partial = ['gap', 'mapping', 'consumer'].indexOf(c.kind) >= 0;
    var d = w.fixLab = { session: c.session, kind: c.kind, connected: ['identity', 'reset'].indexOf(c.kind) < 0,
      healthy: ['heartbeat', 'identity', 'reset'].indexOf(c.kind) < 0,
      nextIn: c.kind === 'gap' ? 501 : c.kind === 'reset' ? 701 : c.kind === 'identity' ? 611 : 613,
      nextOut: c.kind === 'reset' ? 901 : c.kind === 'heartbeat' ? 812 : 811,
      expected: all, inbox: c.kind === 'gap' ? [] : c.kind === 'mapping' ? all.slice(0, 1) : all.slice(),
      applied: partial ? (c.kind === 'gap' ? [] : all.slice(0, 1)) : all.slice(),
      sources: ['ORDER-A'], schema: 'schema-v1', sender: 'HF_UAT', target: 'BROKER_PROD',
      captured: null, compared: false, paused: false, approved: false, repaired: false,
      peerReady: false, resetDone: false, revision: 0, reconciled: -1, probe: null, verified: -1, closed: false,
      audit: [], healthyOther: { session: 'ORDER-B-HEALTHY', connected: true, nextIn: 9001, nextOut: 8001 } };
    var originalOther = json(d.healthyOther);
    var originals = {};
    originals[LOG] = '# Abbreviated decoded extracts; | represents SOH; header/trailer omitted.\n' + c.log + '\n';
    originals[CONFIG] = c.config;
    originals[APPROVAL] = 'Approved change: ' + c.change + '\n' + c.permission + '\n';
    originals[BUSINESS] = json({ scope: 'broker|tradeDate|account|ExecID', expected: d.expected, received: d.inbox, applied: d.applied, liveOrders: 0, unresolvedOrderOutcomes: 0 });
    originals[STORE] = json({ nextIn: d.nextIn, nextOut: d.nextOut });
    Object.keys(originals).forEach(function (p) { write(w, p, originals[p]); });
    function intact() { return Object.keys(originals).every(function (p) { return read(w, p) === originals[p]; }); }
    function preserved() { return intact() && d.captured && Object.keys(originals).every(function (p) { return read(w, '/evidence/before' + p) === originals[p]; }); }
    function log(s) { d.audit.push(W.isoStamp(w.clock) + ' ' + s); write(w, '/var/log/fix/recovery.log', d.audit.join('\n') + '\n'); }
    function changed(s) { d.revision++; d.reconciled = -1; d.verified = -1; d.probe = null; d.closed = false; log(s); }
    function synced() {
      write(w, '/var/lib/fix/current-sequences.json', json({ nextIn: d.nextIn, nextOut: d.nextOut }));
      w.sockets = w.sockets.filter(function (s) { return s.fd !== 9; });
      if (d.connected) w.sockets.push({ pid: 6200, fd: 9, proto: 'tcp', local: '10.14.22.91:45110', peer: '198.51.100.51:9100', state: 'ESTABLISHED' });
    }
    function compare() {
      var missing = d.expected.filter(function (e) { return !d.applied.some(function (a) { return key(a) === key(e) && a.qty === e.qty && a.symbol === e.symbol && a.side === e.side; }); });
      var unique = {};
      d.applied.forEach(function (e) { unique[key(e)] = (unique[key(e)] || 0) + 1; });
      return { missingExecIDs: missing.map(function (e) { return e.execId; }), duplicates: Object.keys(unique).filter(function (k) { return unique[k] > 1; }),
        expectedQty: d.expected.reduce(function (n, e) { return n + e.qty; }, 0), bookedQty: d.applied.reduce(function (n, e) { return n + e.qty; }, 0),
        liveOrders: 0, unresolvedOrderOutcomes: 0, receivedExecutions: d.inbox.length, appliedExecutions: d.applied.length };
    }
    function balanced() { var r = compare(); return !r.missingExecIDs.length && !r.duplicates.length && r.expectedQty === r.bookedQty && d.applied.length === d.expected.length; }
    function applyInbox() {
      d.inbox.forEach(function (e) { if (!d.applied.some(function (a) { return key(a) === key(e); })) d.applied.push(e); });
    }
    function guarded() { return preserved() && d.paused && d.compared && d.approved; }
    var workflow = ['capture', 'pause', 'compare', 'approve ' + c.change].concat(c.repair).concat(['test HB-CHECK', 'check-heartbeat HB-CHECK', 'reconcile', 'resume', 'verify', 'close']);
    write(w, RUNBOOK, 'FIX INCIDENT RUNBOOK — FICTIONAL LAB ONLY\n' + c.session + '\n\n' +
      'EVIDENCE (absolute paths):\n' + Object.keys(originals).join('\n') + '\n\n' +
      'QUESTIONS TO ESTABLISH\n1. What do 34 and the separate next-in/next-out counters prove?\n' +
      '2. Is the failure transport, session, or business processing?\n3. Which exact approval and session scope permit the repair?\n' +
      '4. Do received and applied executions reconcile by identity AND quantity?\n\n' +
      'LAB CONSOLE: fixctl <session> <action> [arguments]\nfixctl help lists actions for THIS case only.\n' +
      'These commands model coordinated support actions, NOT FIX wire commands or production APIs.\n' +
      'Log extracts omit BodyLength, SendingTime and CheckSum; do not transmit them.\n' +
      'capture preserves original evidence; pause holds affected business flow only, never cancels orders.\n' +
      'compare reviews order outcomes and executions. approve records the existing peer agreement.\n' +
      'Observe live state with fixctl ' + c.session + ' status and /var/log/fix/recovery.log.\n' +
      'Safe recovery workflow after diagnosis:\n' + workflow.map(function (s) { return 'fixctl ' + c.session + ' ' + s; }).join('\n') + '\n\n' +
      'Expected outcome: session responsive, missing=0, duplicates=0, booked=expected=70, unaffected session preserved.\n' +
      'Original evidence remains immutable; recovered state is shown by status/compare and /var/lib/fix/current-sequences.json.\n' +
      'Do not delete/edit stores, restart every session, invent approval, or replay orders.\n');
    w.sockets.push({ pid: 6200, fd: 10, proto: 'tcp', local: '10.14.22.91:45111', peer: '198.51.100.52:9100', state: 'ESTABLISHED' });
    log('INCIDENT opened. Original evidence retained.'); synced();
    d.execute = function (args) {
      if (args.length === 1 && args[0] === 'help') return 'FICTIONAL LAB CONSOLE; not a standard FIX command.\ncat ' + RUNBOOK + '\n' +
        ['status', 'capture', 'pause', 'compare', 'approve ' + c.change].concat(c.repair).concat(['test <unique-id>', 'check-heartbeat <same-id>', 'reconcile', 'resume', 'verify', 'close']).map(function (a) { return 'fixctl ' + c.session + ' ' + a; }).join('\n');
      if (args[0] !== c.session) return fail('Unknown/out-of-scope session. Use fixctl help. Healthy sessions are not writable.');
      var action = args[1], rest = args.slice(2), signature = args.slice(1).join(' ');
      var allowed = ['status', 'capture', 'pause', 'compare', 'reconcile', 'resume', 'verify', 'close'];
      if (allowed.indexOf(action) >= 0 && rest.length) return fail('Unexpected arguments for ' + action);
      if (action === 'status') return json({ session: d.session, connected: d.connected, sessionResponsive: d.healthy, nextIn: d.nextIn, nextOut: d.nextOut,
        paused: d.paused, heartbeatInterval: 30, outstandingTest: d.probe, sources: d.sources, consumerSchema: d.schema,
        business: compare(), healthyOther: d.healthyOther, recoveryVerified: d.verified === d.revision });
      if (action === 'capture') {
        if (!intact()) return fail('Original evidence changed/missing. Start a fresh investigation; do not overwrite the audit.');
        if (d.captured) return preserved() ? 'Original snapshot retained.' : fail('Preserved snapshot changed/missing.');
        Object.keys(originals).forEach(function (p) { write(w, '/evidence/before' + p, originals[p]); });
        d.captured = true; log('CAPTURE complete'); return 'Evidence preserved under /evidence/before';
      }
      if (action === 'compare') { d.compared = true; return json(compare()); }
      if (action === 'pause') {
        if (!preserved()) return fail('Capture intact evidence first.');
        d.paused = true; changed('HOLD affected business flow; no order cancellation'); return 'Affected flow held; healthy session unchanged.';
      }
      if (action === 'approve') {
        if (rest.length !== 1 || rest[0] !== c.change || !preserved() || !d.paused || !d.compared) return fail('Read ' + APPROVAL + '; capture, hold and compare first. Exact pre-existing change ID required.');
        d.approved = true; log('APPROVAL ' + c.change + ' recorded for ' + c.session); return 'Scoped existing approval recorded; not permission to reset any other session.';
      }
      if (action === 'test') {
        if (rest.length !== 1 || !/^[A-Za-z0-9-]{1,32}$/.test(rest[0])) return fail('Provide one TestReqID (letters/digits/hyphens, max 32).');
        if (!d.connected) return fail('No logged-on session to test.');
        if (c.kind === 'gap' && !d.repaired) return fail('Resolve the outstanding receive gap first; subsequent messages remain buffered.');
        if (d.audit.some(function (s) { return s.indexOf('112=' + rest[0] + ' ') >= 0; })) return fail('Use a fresh TestReqID.');
        d.verified = -1; d.closed = false;
        d.probe = { id: rest[0], matched: false, receivedId: d.healthy ? rest[0] : 'UNRELATED', revision: d.revision };
        log('OUT 35=1|34=' + d.nextOut++ + '|112=' + rest[0] + ' (probe)');
        log('IN 35=0|34=' + d.nextIn++ + '|112=' + d.probe.receivedId + ' (response)'); synced();
        return 'Inspect /var/log/fix/recovery.log then check-heartbeat with your TestReqID.';
      }
      if (action === 'check-heartbeat') {
        if (rest.length !== 1 || !d.probe || rest[0] !== d.probe.id || rest[0] !== d.probe.receivedId || d.probe.revision !== d.revision) return fail('No matching current Heartbeat 35=0 with the requested 112. An ordinary or unrelated heartbeat does not count.');
        d.probe.matched = true; return 'Matched TestRequest/Heartbeat 112=' + rest[0] + '. Session responsive; business completeness still needs reconciliation.';
      }
      if (action === 'reconcile') {
        if (!guarded() || !d.repaired || !d.connected || !d.healthy || !balanced()) return fail('Recovery or business reconciliation incomplete. Run compare and repair the actual cause.');
        d.reconciled = d.revision; log('RECONCILE missing=0 duplicates=0 expectedQty=70 bookedQty=70'); return json(compare());
      }
      if (action === 'resume') {
        if (!guarded() || d.reconciled !== d.revision || !d.probe || !d.probe.matched) return fail('Need repaired state, reconciliation and a matching fresh TestRequest response before resume.');
        d.paused = false; d.verified = -1; d.closed = false; log('RESUME affected flow'); return 'Flow resumed; verify before closing.';
      }
      if (action === 'verify') {
        if (!preserved() || d.paused || !d.repaired || !d.connected || !d.healthy || !balanced() || d.reconciled !== d.revision || !d.probe || !d.probe.matched || json(d.healthyOther) !== originalOther || !W.findProc(w, 6200) || !w.services.fixengine.active) return fail('Session, business, evidence or unaffected-session check failed.');
        d.verified = d.revision; log('VERIFY PASS session responsive; downstream checkpoint current; missing=0 duplicates=0 qty=70; healthy peer untouched'); return 'VERIFIED: session + business recovery; missing=0 duplicates=0 bookedQty=70.';
      }
      if (action === 'close') {
        if (!preserved() || d.verified !== d.revision || d.paused || !balanced() || !d.connected || !d.healthy || !W.findProc(w, 6200) || !w.services.fixengine.active) return fail('Fresh post-resume verification required.');
        d.closed = true; log('CLOSE evidence and recovery verified'); return 'Incident closed with verified business recovery.';
      }
      if (c.repair.indexOf(signature) < 0) return fail('Unsupported action/arguments or unapproved repair for this case. See fixctl help. A blind reset is not a recovery procedure.');
      if (!guarded()) return fail('Capture, pause, compare and record the scoped approval before changing anything.');
      if (action === 'disconnect') { d.connected = false; changed('35=5 Logout / disconnect affected session only; counters retained'); }
      if (action === 'reset') {
        if (d.connected || !balanced() || d.resetDone) return fail('Reset requires disconnected session, reconciled orders and an unused bilateral transition.');
        d.nextIn = 1; d.nextOut = 1; d.resetDone = true; d.peerReady = true; changed('RESET both counters to 1 under ' + c.change);
      }
      if (action === 'peer-repair') {
        if (d.connected) return fail('Disconnect the timed-out session before the approved peer dispatcher repair.');
        d.peerReady = true; changed('PEER dispatcher restored under ' + c.change);
      }
      if (action === 'identity') {
        if (d.connected) return fail('Disconnect before changing the session profile.');
        d.sender = rest[0]; d.target = rest[1]; d.peerReady = true; changed('PROFILE SenderCompID=' + d.sender + ' TargetCompID=' + d.target);
      }
      if (action === 'connect') {
        if (d.connected || !d.peerReady) return fail('Already connected or peer/profile recovery not ready.');
        var resetFlag = c.kind === 'reset' ? '|141=Y' : '|141=N';
        changed('LOGON OUT 35=A|34=' + d.nextOut++ + resetFlag + '; IN 35=A|34=' + d.nextIn++ + resetFlag);
        d.connected = true; d.healthy = true; d.repaired = true;
      }
      if (action === 'resend') {
        if (d.nextIn !== 501 || d.repaired) return fail('The 501..503 gap is no longer outstanding; do not replay a stale range.');
        changed('OUT 35=2|34=' + d.nextOut++ + '|7=501|16=503');
        log('IN 35=8|34=501|43=Y|122=20260911-08:59:59.000|17=EX-501|32=10');
        log('IN 35=4|34=502|43=Y|123=Y|36=503 administrative gap-fill only');
        log('IN 35=8|34=503|43=Y|122=20260911-09:00:01.000|17=EX-503|32=20');
        log('DELIVER buffered 35=8|34=504|17=EX-504|32=40 once');
        d.nextIn = 505; d.inbox = all.slice(); applyInbox(); d.repaired = true;
      }
      if (action === 'map-source') {
        if (d.sources.indexOf('ORDER-B') < 0) d.sources.push('ORDER-B'); changed('APPROVED source ORDER-B mapped to DC-MAP; historical copies still missing');
      }
      if (action === 'recover-source') {
        if (d.sources.indexOf('ORDER-B') < 0) return fail('Approved source mapping must be installed first.');
        changed('IMPORT approved ORDER-B historical execution export; not order submission or FIX session replay');
        d.inbox = all.slice(); applyInbox(); d.repaired = true;
      }
      if (action === 'consumer-schema') { d.schema = rest[0]; changed('CONSUMER approved schema-v2 deployed; durable inbox retained'); }
      if (action === 'replay-inbox') {
        if (d.schema !== 'schema-v2') return fail('Repair the consumer schema before replaying the durable inbox.');
        changed('REPLAY durable inbox with scoped execution deduplication'); applyInbox(); d.repaired = true;
      }
      synced(); return 'Applied scoped recovery step. Check status and /var/log/fix/recovery.log; verify business outcomes before close.';
    };
    w.onKill = function (world, p) { if (p.pid === 6200) { d.connected = false; changed('PROCESS killed: recovery invalidated'); } };
    w.onService = function (world, verb, name) {
      if (name.replace(/\.service$/, '') !== 'fixengine') return false;
      if (['stop', 'restart'].indexOf(verb) >= 0) { d.connected = false; changed('SERVICE interrupted: durable counters and business state retained'); }
      return false;
    };
    return w;
  }
  PS.scenarios = PS.scenarios || [];
  cases.forEach(function (c) {
    var prefix = 'fixctl ' + c.session + ' ';
    PS.scenarios.push({ id: c.id, track: 'fix', title: c.title, severity: 'P1', desk: 'Electronic Trading / FIX & Drop Copy', host: 'ldn-fix-lab01',
      tags: c.tags, par: 600, impactPerMin: 16000, currency: 'GBP',
      brief: 'PAGER — ' + c.symptom + '\n\nEvidence: ' + LOG + ', ' + CONFIG + ', ' + STORE + ', ' + BUSINESS + '.\nPeer approval: ' + APPROVAL + '.\nRecovery runbook: ' + RUNBOOK + '.\n\nIdentify the root cause, recover only ' + c.session + ', and verify session responsiveness AND business completeness. fixctl is a fictional lab console; no commands affect real systems.',
      build: function () { return build(c); },
      discoveries: [
        { id: 'protocol', label: 'Read the protocol evidence in ' + LOG, when: function (o) { return o.code === 0 && o.cmd.indexOf(LOG) >= 0 && o.out.indexOf('35=') >= 0; } },
        { id: 'profile', label: 'Inspect the session profile in ' + CONFIG, when: function (o) { return o.code === 0 && o.cmd.indexOf(CONFIG) >= 0 && o.out.indexOf('Session=') >= 0; } },
        { id: 'counters', label: 'Read both persisted counters in ' + STORE, when: function (o) { return o.code === 0 && o.cmd.indexOf(STORE) >= 0 && /nextIn/.test(o.out) && /nextOut/.test(o.out); } },
        { id: 'approval', label: 'Establish the exact peer-approved recovery scope', when: function (o) { return o.code === 0 && o.cmd.indexOf(APPROVAL) >= 0 && o.out.indexOf(c.change) >= 0; } },
        { id: 'business', label: 'Compare received/applied executions and order outcomes', when: function (o) { return o.code === 0 && o.cmd === prefix + 'compare' && /missingExecIDs/.test(o.out); } }
      ],
      rootCauses: [{ text: 'TCP ESTABLISHED proves the session and all downstream positions are healthy.' }, { text: c.cause, correct: true },
        { text: 'Reset every session to 1 and resend all orders to recover any missing data.' }, { text: 'Delete the persisted sequence files and restart the whole gateway.' }],
      fix: { prompt: 'Follow ' + RUNBOOK + '; close only after scope, session and business verification.',
        check: function (w) { return w.fixLab.closed === true; },
        grade: function () { return { quality: 'clean', bonus: 340, note: 'Preserved evidence, applied the approved session-scoped recovery, matched a fresh TestRequest response, and reconciled executions before closure.' }; } },
      hints: ['Start with cat ' + LOG + ' and cat ' + CONFIG + '. Do not infer application health from a socket.',
        'Compare ' + STORE + ' with ' + BUSINESS + '; use ' + prefix + 'compare. Read ' + APPROVAL + ' before changes.',
        'Use cat ' + RUNBOOK + '. The final checks are a matching 112, no missing/duplicate executions, correct quantities and an unaffected healthy session.'],
      walkthrough: ['cat ' + LOG, 'cat ' + CONFIG, 'cat ' + STORE, 'cat ' + APPROVAL, 'cat ' + BUSINESS, 'cat ' + RUNBOOK].concat(
        ['capture', 'pause', 'compare', 'approve ' + c.change].concat(c.repair).concat(['test HB-CHECK', 'check-heartbeat HB-CHECK', 'reconcile', 'resume', 'verify', 'close']).map(function (a) { return prefix + a; })),
      debrief: c.lesson + '\n\nRecovery evidence: /var/log/fix/recovery.log and /var/lib/fix/current-sequences.json. This is an original fictional lab with frozen market inputs. A successful exercise does not validate a real venue connection. Actual reset schedules, replay retention, CompID rules and heartbeat thresholds are engine/venue-specific; follow the certified rules of engagement. The exercise models snapshot reconciliation, not a continuous live-market load test.',
      sources: [STANDARD, TESTS].concat(c.kind === 'mapping' || c.kind === 'consumer' ? [DROP] : c.kind === 'reset' || c.kind === 'identity' ? [ENGINE] : [])
    });
  });
})(PS);
