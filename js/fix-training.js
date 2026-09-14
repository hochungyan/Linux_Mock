/* Linux commands operate on files; the support panel models real human/JMX
 * actions. No fictional terminal utility is registered by this module. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, GB = 1073741824;
  var P = { config: '/etc/quickfixj/session.cfg', staged: '/etc/quickfixj/approved-session.cfg',
    log: '/var/log/quickfixj/messages.log', events: '/var/log/quickfixj/events.log', state: '/var/log/quickfixj/session-state.json',
    business: '/var/log/dropcopy/reconciliation.json', runbook: '/home/gsupport/runbook-fix.txt',
    peer: '/evidence/incident/peer-handover.txt', backup: '/var/tmp/fix-incident', consumer: '/etc/dropcopy/consumer.properties' };
  function json(v) { return JSON.stringify(v, null, 2); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function put(w, p, s) { V.write(w.root, p, s, { owner: 'gsupport', mtime: new Date(w.clock) }); }
  function read(w, p) { var n = V.lookup(w.root, p); return n ? V.read(n, w) : null; }
  function fail(s) { return { err: s, code: 1 }; }
  function key(e) { return [e.broker, e.date, e.account, e.execId].join('|'); }
  function trade(id, qty) { return { broker: 'BRK-A', date: '2026-09-14', account: 'HF-ALPHA', execId: id, symbol: 'XYZ', side: 'BUY', qty: qty, price: 25 }; }
  function settings(body) {
    var defaults = {}, session = {}, current = null, count = 0, bad = false;
    String(body || '').split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line || line[0] === '#') return;
      if (line === '[DEFAULT]') { current = defaults; return; }
      if (line === '[SESSION]') { current = session; count++; return; }
      var m = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(line);
      if (!m || !current || Object.prototype.hasOwnProperty.call(current, m[1])) { bad = true; return; }
      current[m[1]] = m[2].trim();
    });
    return bad || count !== 1 ? null : Object.assign({}, defaults, session);
  }
  function config(c, reset, sender) {
    return '# QuickFIX/J 2.3.x; this service owns ONE session.\n[DEFAULT]\nConnectionType=initiator\nHeartBtInt=30\nReconnectInterval=5\nStartTime=00:00:00\nEndTime=00:00:00\nUseDataDictionary=Y\nDataDictionary=/opt/quickfixj/FIX44.xml\nValidateSequenceNumbers=Y\nCheckCompID=Y\nFileStorePath=/var/lib/quickfixj/store\nFileLogPath=/var/log/quickfixj\nFileLogHeartbeats=Y\nPersistMessages=Y\nResetOnDisconnect=N\nResetOnLogout=N\nResetOnError=N\nRefreshOnLogon=N\n[SESSION]\nBeginString=FIX.4.4\nSenderCompID=' + (sender || 'HF_PROD') + '\nTargetCompID=' + c.session + '\nSocketConnectHost=198.51.100.51\nSocketConnectPort=9100\nResetOnLogon=' + (reset ? 'Y' : 'N') + '\n';
  }
  function build(c) {
    var resetCase = c.kind === 'reset' || c.kind === 'flap', partial = ['gap', 'mapping', 'consumer'].indexOf(c.kind) >= 0;
    var normal = config(c, false), initial = config(c, false, c.kind === 'identity' ? 'HF_UAT' : 'HF_PROD');
    var w = W.create({ host: c.host || 'ldn-fix-prod03', user: 'gsupport', clock: c.kind === 'flap' ? new Date(2026, 8, 14, 7, 58) : new Date(2026, 8, 14, 9, 1), cores: 8,
      root: V.dir({ home: V.dir({ gsupport: V.dir({}) }), tmp: V.dir({}), var: V.dir({ tmp: V.dir({}) }), proc: V.dir({}) }),
      procs: [W.proc({ pid: 6200, user: 'fixadm', short: 'java', cmd: 'java -jar /opt/quickfixj/connector.jar ' + P.config, rss: GB }),
        W.proc({ pid: 6201, short: 'java', cmd: 'java -jar /opt/quickfixj/other-sessions.jar', rss: GB }), W.proc({ pid: 6300, short: 'java', cmd: 'java -jar /opt/dropcopy/consumer.jar', rss: GB / 2 })],
      mem: { total: 16 * GB, free: 11 * GB, buffers: GB / 8, cached: GB },
      services: { 'fix-connector': { active: true, pid: 6200, requiresRoot: false, exe: 'java', desc: 'One-session QuickFIX/J connector', log: [] },
        'fix-other-sessions': { active: true, pid: 6201, requiresRoot: false, exe: 'java', desc: 'Unaffected sessions', log: [] },
        'dropcopy-consumer': { active: true, pid: 6300, requiresRoot: false, exe: 'java', desc: 'Firm durable-inbox consumer', log: [] } },
      filesystems: [{ dev: '/dev/root', mount: '/', type: 'xfs', size: 80 * GB, used: 12 * GB, inodes: { total: 1000000, used: 40000 } }], sockets: [], httpExact: true, http: {} });
    var all = [trade('EX-501', 10), trade('EX-503', 20), trade('EX-504', 40)];
    var d = w.fixOps = { kind: c.kind, session: c.session, connected: !(resetCase || c.kind === 'identity' || c.kind === 'heartbeat'),
      nextIn: c.kind === 'gap' ? 501 : resetCase ? 88413 : 613, nextOut: resetCase ? 91001 : 812,
      loaded: settings(initial), originalConfig: initial, approvedConfig: normal, resetCount: 0, resetArmed: false,
      peerAgreed: false, held: false, restored: false, sources: ['ORDER-A'], consumerSchema: c.kind === 'consumer' ? 'v1' : 'v2',
      expected: copy(all), inbox: c.kind === 'gap' ? [] : c.kind === 'mapping' ? copy(all.slice(0, 1)) : copy(all),
      applied: partial ? (c.kind === 'gap' ? [] : copy(all.slice(0, 1))) : copy(all), seen: {}, revision: 0,
      sessionChecked: -1, reconciled: -1, liveObserved: false, liveReviewed: false, closed: false,
      messages: c.log.split('\n'), audit: ['INCIDENT opened; ' + c.session], lastProbe: null, probeId: 0, unhealthyActions: 0 };
    var originals = { 'messages.log': '# Decoded excerpts; framing omitted.\n' + c.log + '\n', 'session.cfg': initial,
      'engine-state.json': json({ SessionID: 'FIX.4.4:' + d.loaded.SenderCompID + '->' + c.session, NextTargetMsgSeqNum: d.nextIn, NextSenderMsgSeqNum: d.nextOut, MessageStoreClassName: 'quickfix.FileStore' }),
      'peer-handover.txt': c.peer, 'broker-executions.json': json(all),
      'store-backup-manifest.txt': 'ENGINE TEAM: consistent message-store backup retained in the incident archive before this exercise. This manifest is an export, not a writable sequence store. reset() clears the engine resend store; preserve the archive.\n' };
    Object.keys(originals).forEach(function (name) { put(w, '/evidence/incident/' + name, originals[name]); });
    put(w, P.config, initial); put(w, P.staged, resetCase ? config(c, true) : normal); put(w, '/etc/quickfixj/normal-session.cfg', normal);
    put(w, P.consumer, '# Firm application configuration, not QuickFIX/J.\ndecoder.schema=' + d.consumerSchema + '\n');
    put(w, '/etc/dropcopy/approved-consumer.properties', '# Firm application configuration, not QuickFIX/J.\ndecoder.schema=v2\n');
    put(w, '/evidence/incident/consumer.log', 'received_execution_count=' + d.inbox.length + '\napplied_execution_count=' + d.applied.length + (c.kind === 'consumer' ? '\nERROR unsupported schema v2; checkpoint stays at 1\n' : '\n'));
    function preserved() { return Object.keys(originals).every(function (n) { return read(w, '/evidence/incident/' + n) === originals[n] && read(w, P.backup + '/' + n) === originals[n]; }); }
    function comparison() {
      var mismatch = [], duplicates = [], seen = {};
      d.applied.forEach(function (a) { if (seen[key(a)]) duplicates.push(key(a)); seen[key(a)] = true; });
      d.expected.forEach(function (e) { var a = d.applied.filter(function (x) { return key(x) === key(e); });
        if (a.length !== 1 || ['qty', 'price', 'symbol', 'side'].some(function (f) { return a[0][f] !== e[f]; })) mismatch.push(e.execId); });
      return { scope: 'broker,date,account,ExecID', expectedCount: d.expected.length, receivedCount: d.inbox.length, appliedCount: d.applied.length,
        missingOrMismatched: mismatch, duplicates: duplicates, unexpected: d.applied.filter(function (a) { return !d.expected.some(function (e) { return key(e) === key(a); }); }).map(key),
        expectedQty: d.expected.reduce(function (n, e) { return n + e.qty; }, 0), appliedQty: d.applied.reduce(function (n, e) { return n + e.qty; }, 0), unresolvedOrders: 0, expected: d.expected, booked: d.applied };
    }
    function balanced() { var r = comparison(); return !r.missingOrMismatched.length && !r.duplicates.length && !r.unexpected.length && r.appliedQty === r.expectedQty; }
    function alive(pid, unit) { var p = W.findProc(w, pid); return !!(p && p.state !== 'T' && w.services[unit].active); }
    function engineAlive() { return alive(6200, 'fix-connector'); }
    function consumerAlive() { return alive(6300, 'dropcopy-consumer'); }
    function otherAlive() { return alive(6201, 'fix-other-sessions'); }
    function audit(s) { d.audit.push(W.isoStamp(w.clock) + ' ' + s); w.services['fix-connector'].log.push(s); }
    function changed(s) { d.revision++; d.sessionChecked = -1; d.reconciled = -1; d.liveObserved = false; d.liveReviewed = false; d.closed = false; audit(s); }
    function snapshot() { return { SessionID: 'FIX.4.4:' + d.loaded.SenderCompID + '->' + c.session, LoggedOn: d.connected, NextTargetMsgSeqNum: d.nextIn, NextSenderMsgSeqNum: d.nextOut,
      ResetOnLogon: d.loaded.ResetOnLogon, MessageStoreClassName: 'quickfix.FileStore', LoadedSettings: d.loaded,
      otherSessions: { loggedOn: otherAlive(), NextTargetMsgSeqNum: 9001, NextSenderMsgSeqNum: 8001 }, sourceSessions: d.sources,
      held: d.held, applicationCheckpoint: d.applied.length, receivedExecutions: d.inbox.length,
      note: 'Support export of engine attributes plus firm monitoring; not a writable engine store.' }; }
    function sync() {
      put(w, P.log, '# Decoded excerpts; pipe represents SOH.\n' + d.messages.join('\n') + '\n');
      put(w, P.events, d.audit.join('\n') + '\n'); put(w, P.state, json(snapshot())); put(w, P.business, json(comparison()));
      w.sockets = [];
      if (d.connected && engineAlive()) w.sockets.push({ pid: 6200, fd: 9, proto: 'tcp', local: '10.14.22.91:45110', peer: '198.51.100.51:9100', state: 'ESTABLISHED' });
      if (otherAlive()) w.sockets.push({ pid: 6201, fd: 10, proto: 'tcp', local: '10.14.22.91:45111', peer: '198.51.100.52:9100', state: 'ESTABLISHED' });
    }
    function viewsIntact() { return read(w, P.state) === json(snapshot()) && read(w, P.business) === json(comparison()) && read(w, P.events) === d.audit.join('\n') + '\n'; }
    function ready() { return preserved() && d.peerAgreed && d.held && otherAlive(); }
    function apply() { d.inbox.forEach(function (e) { if (!d.applied.some(function (a) { return key(a) === key(e); })) d.applied.push(copy(e)); }); }
    function logon() {
      if (d.loaded.SenderCompID !== 'HF_PROD') { d.connected = false; audit('Logon rejected: SenderCompID not entitled on PROD'); return; }
      if (c.kind === 'heartbeat' && !d.restored) { d.connected = false; audit('Peer dispatcher remains stalled; reconnect alone does not repair it'); return; }
      if (resetCase && !d.resetCount) { d.connected = false; audit('MsgSeqNum too low: expected ' + d.nextIn + ' received 1; investigate bilateral state'); return; }
      var flag = d.resetArmed ? '|141=Y|' : '|141=N|';
      d.messages.push('OUT |35=A|34=' + d.nextOut++ + '|49=HF_PROD|56=' + c.session + '|108=30' + flag,
        'IN |35=A|34=' + d.nextIn++ + '|49=' + c.session + '|56=HF_PROD|108=30' + flag);
      d.resetArmed = false; d.connected = true; if (resetCase || c.kind === 'identity') d.restored = true;
      audit('Logon accepted; sequence state loaded for the exact SessionID');
    }
    function reset(onLogon) { d.nextIn = 1; d.nextOut = 1; d.resetCount++; d.resetArmed = !!onLogon; changed('Both counters reset to 1; engine resend store cleared; archived evidence retained' + (onLogon ? '; profile requests 141=Y on Logon' : '; peer confirms its separate reset to 1 under the bilateral procedure')); }
    d.perform = function (id) {
      if (id === 'blind-reset' || id === 'skip-gap' || id === 'cancel-via-dropcopy') { d.unhealthyActions++; return fail(id === 'skip-gap' ? 'Advancing next-in skips EX-501 and EX-503. Recover the outstanding ResendRequest.' : id === 'cancel-via-dropcopy' ? 'This drop-copy interface is read-only; cancellations use the order-entry/risk workflow.' : 'A reset clears recovery history. Establish counterpart agreement and business outcomes first.'); }
      if (id === 'contact-peer') {
        if (!preserved() || !d.seen.protocol || !d.seen.profile || !d.seen.business) return fail('Inspect messages, profile and business evidence, then preserve /evidence/incident with cp -r.');
        d.peerAgreed = true; audit('COUNTERPARTY / INCIDENT BRIDGE: ' + c.peer); sync(); return 'Counterparty response recorded in ' + P.events;
      }
      if (id === 'hold') { if (!d.peerAgreed || !preserved()) return fail('Establish impact and the peer response first.'); d.held = true; changed('DESK holds affected flow / marks risk stale'); sync(); return 'Affected flow held under the desk runbook.'; }
      if (id === 'review-session') {
        if (!ready() || !d.connected || !engineAlive() || !d.restored || !viewsIntact() || d.seen.recoveredLog !== d.revision || d.seen.currentState !== d.revision) return fail('Read current ' + P.log + ' and ' + P.state + ' after recovery; prove Logon and directional counters.');
        if (c.kind === 'heartbeat' && (!d.lastProbe || !d.lastProbe.matched || d.seen.probe !== d.revision)) return fail('Read a new TestRequest and same-ID Heartbeat response.');
        d.sessionChecked = d.revision; return 'Session evidence accepted; reconcile business outcomes next.';
      }
      if (id === 'reconcile') { if (!ready() || !viewsIntact() || d.sessionChecked !== d.revision || d.seen.currentBusiness !== d.revision || !balanced()) return fail('Read ' + P.business + '; resolve missing, duplicate or mismatched executions.'); d.reconciled = d.revision; return 'Execution identities, economics and quantities agree; unresolved orders=0.'; }
      if (id === 'resume') {
        var disk = settings(read(w, P.config));
        if (!ready() || d.reconciled !== d.revision || !balanced() || !viewsIntact() || d.loaded.ResetOnLogon !== 'N' || !disk || disk.ResetOnLogon !== 'N') return fail('Reconcile first; remove temporary ResetOnLogon=Y from disk AND the running engine before resuming.');
        d.held = false; audit('DESK resumes affected flow'); sync(); return 'Flow resumed; observe new activity before closing.';
      }
      if (id === 'observe-live') {
        if (d.held || !d.restored || !d.connected || !engineAlive() || !consumerAlive() || !balanced() || d.reconciled !== d.revision || !viewsIntact()) return fail('Restore and reconcile before observing fresh activity.');
        if (d.liveObserved) return 'The observed window is already retained.';
        var e = trade('EX-LIVE', 5); d.expected.push(copy(e)); d.inbox.push(copy(e)); apply();
        d.messages.push('IN |35=8|34=' + d.nextIn++ + '|150=F|39=2|17=EX-LIVE|32=5|31=25|');
        W.advance(w, 60); d.messages.push('IN |35=0|34=' + d.nextIn++ + '| (heartbeat, no business event)');
        d.liveObserved = true; audit('OBSERVED simulated 60-second window: new execution booked once, heartbeat received, no sequence gap'); sync(); return 'Inspect fresh activity in ' + P.log + ' and ' + P.business;
      }
      if (id === 'close') { if (!d.liveObserved || !d.liveReviewed || d.held || !balanced() || !viewsIntact() || !preserved() || !engineAlive() || !consumerAlive() || !otherAlive()) return fail('Inspect post-resume business reconciliation and verify new activity before closing.'); d.closed = true; return 'Incident resolved: session and business recovery verified.'; }
      if (!ready()) return fail('Preserve evidence, establish the peer agreement and hold affected flow before this operational action.');
      if (id === 'peer-replay' && c.kind === 'gap') {
        if (d.restored) return 'The missing range was already recovered; no duplicate application.';
        changed('PEER releases retained responses to our existing ResendRequest; local engine processes recovery automatically');
        d.messages.push('IN |35=8|34=501|43=Y|122=20260914-08:59:59.000|150=F|39=2|17=EX-501|32=10|31=25|',
          'IN |35=4|34=502|43=Y|122=20260914-09:00:00.000|123=Y|36=503|',
          'IN |35=8|34=503|43=Y|122=20260914-09:00:01.000|150=F|39=2|17=EX-503|32=20|31=25|',
          'DELIVER buffered |35=8|34=504|150=F|17=EX-504|32=40|31=25| once');
        d.nextIn = 505; d.inbox = copy(all); apply(); d.restored = true;
      } else if (id === 'jmx-logoff') {
        if (d.connected) d.messages.push('OUT |35=5|34=' + d.nextOut++ + '|', 'IN |35=5|34=' + d.nextIn++ + '|');
        d.connected = false; changed('SessionAdmin.logoff(): selected session disabled; store retained');
      } else if (id === 'jmx-reset' && resetCase) {
        if (d.connected || !balanced() || d.resetCount) return fail('Reset requires logoff, reconciled orders and an unused agreed reset window.'); reset();
      } else if (id === 'jmx-logon') {
        if (d.connected || !engineAlive()) return fail('Connector must be running with this session logged off.'); changed('SessionAdmin.logon(): enable this session'); logon();
      } else if (id === 'peer-dispatcher' && c.kind === 'heartbeat') {
        if (d.connected) return fail('Disable the timed-out session first.'); changed('PEER confirms dispatcher repaired on the incident bridge'); d.restored = true;
      } else if (id === 'jmx-test') {
        if (!d.connected || !engineAlive() || (c.kind === 'gap' && !d.restored)) return fail('Resolve the receive gap and establish Logon before probing.');
        changed('SessionAdmin.sendTestRequest(): inspect the generated ID'); var probe = 'TEST-' + (++d.probeId); d.lastProbe = { id: probe, matched: d.restored };
        d.messages.push('OUT |35=1|34=' + d.nextOut++ + '|112=' + probe + '|', 'IN |35=0|34=' + d.nextIn++ + '|112=' + (d.restored ? probe : 'UNRELATED') + '|');
      } else if (id === 'venue-map' && c.kind === 'mapping') {
        if (d.sources.indexOf('ORDER-B') < 0) { changed('VENUE confirms approved ORDER-B mapping; historical copies still missing'); d.sources.push('ORDER-B'); }
      } else if (id === 'import-export' && c.kind === 'mapping') {
        if (d.sources.indexOf('ORDER-B') < 0) return fail('Obtain confirmation of the approved source mapping first.');
        if (!d.restored) { changed('MIDDLE OFFICE imports scoped historical export with business deduplication; FIX counters unchanged'); d.inbox = copy(all); apply(); d.restored = true; }
      } else return fail('That action does not apply to this incident.');
      sync(); return 'Action recorded. Inspect ' + P.events + ', ' + P.log + ' and ' + P.state;
    };
    w.onService = function (world, verb, unit, svc) {
      unit = unit.replace(/\.service$/, '');
      if (unit === 'fix-other-sessions') { svc.active = verb !== 'stop'; d.unhealthyActions++; changed('Unnecessary interruption of other sessions'); sync(); return true; }
      if (unit !== 'fix-connector' && unit !== 'dropcopy-consumer') return false;
      if (verb === 'reload') return fail('This systemd unit has no ExecReload. Editing disk files does not reconfigure the running engine.');
      if (['start', 'stop', 'restart'].indexOf(verb) < 0) return fail('Unsupported operation for this deployment.');
      if (!ready()) return fail('The desk procedure requires preserved evidence, peer coordination and affected-flow hold.');
      if (verb === 'start' && svc.active) return true;
      if (verb === 'stop') {
        if (unit === 'fix-connector' && d.connected) d.messages.push('OUT |35=5|34=' + d.nextOut++ + '|', 'IN |35=5|34=' + d.nextIn++ + '|');
        svc.active = false; if (unit === 'fix-connector') d.connected = false;
        W.killProc(w, svc.pid); changed(unit + ' stopped; persistent state retained'); sync(); return true;
      }
      if (unit === 'dropcopy-consumer') {
        if (c.kind !== 'consumer' || !/^decoder\.schema=v2$/m.test(read(w, P.consumer) || '')) return fail('Consumer cannot decode the retained v2 inbox; inspect its application configuration.');
        svc.active = true; if (!W.findProc(w, svc.pid)) w.procs.push(W.proc({ pid: svc.pid, short: 'java', cmd: 'java -jar /opt/dropcopy/consumer.jar', rss: GB / 2 }));
        d.consumerSchema = 'v2'; changed('Consumer starts with schema v2, resumes durable checkpoint and deduplicates inbox'); apply(); d.restored = true; sync(); return true;
      }
      var cfg = settings(read(w, P.config)), approved = settings(normal);
      if (!cfg) return fail('ConfigError: valid [DEFAULT] and one [SESSION] required for this connector.');
      var invalid = Object.keys(cfg).some(function (k) { return k !== 'ResetOnLogon' && cfg[k] !== approved[k]; }) || Object.keys(approved).some(function (k) { return cfg[k] == null; });
      if (invalid || ['N', 'Y'].indexOf(cfg.ResetOnLogon) < 0) return fail('Profile differs from peer-approved settings. NextSeqNo is not a QuickFIX/J setting; inspect engine state.');
      if (cfg.ResetOnLogon === 'Y' && (!resetCase || d.resetCount || !balanced())) return fail('ResetOnLogon=Y would erase recovery history. No reset approval remains for this connection.');
      if (c.kind === 'identity' && d.loaded.SenderCompID !== cfg.SenderCompID) { d.nextIn = 711; d.nextOut = 911; audit('Loaded approved PROD SessionID store: incoming=711 outgoing=911; UAT store retained separately'); }
      if (d.connected) d.messages.push('OUT |35=5|34=' + d.nextOut++ + '|', 'IN |35=5|34=' + d.nextIn++ + '|');
      svc.active = true; if (!W.findProc(w, svc.pid)) w.procs.push(W.proc({ pid: svc.pid, short: 'java', cmd: 'java -jar /opt/quickfixj/connector.jar ' + P.config, rss: GB }));
      d.loaded = cfg; d.connected = false; changed('Dedicated connector rebuilt from disk; other connector untouched');
      if (cfg.ResetOnLogon === 'Y') reset(true); logon(); sync(); return true;
    };
    w.onKill = function (world, proc) { if ([6200, 6201, 6300].indexOf(proc.pid) >= 0) { d.unhealthyActions++; if (proc.pid === 6200) d.connected = false; changed('Process terminated; business recovery not performed'); sync(); } };
    d.check = function () { return d.closed && balanced() && preserved() && viewsIntact() && engineAlive() && consumerAlive() && otherAlive(); };
    d.sync = sync; d.comparison = comparison;
    put(w, P.runbook, 'SUPPORT RUNBOOK — ' + c.session + '\nEngine: QuickFIX/J 2.3.x, FileStore and authorized JMX.\nTopology: fix-connector.service owns ONE session; fix-other-sessions.service owns the healthy sessions. Shared gateways require different change planning.\n\nINVESTIGATE\ncat ' + P.log + '\ncat ' + P.config + '\ncat ' + P.state + '\ncat ' + P.business + '\ncat ' + P.peer + '\nss -tnp\njournalctl -u fix-connector -n 20\ncp -r /evidence/incident ' + P.backup + '\n\nThe incident archive already has a consistent store backup from the engine team. cp preserves these exports; it is not a live database/store snapshot procedure.\n\nCONFIGURATION\n[SESSION] overrides [DEFAULT]. Edit a copy with sed, inspect it, then mv it into place; or cp the approved profile.\nThis unit has no ExecReload. start on an active unit does not reread settings. stop/start rebuilds this one connector; normal counters persist.\nResetOnLogon=Y resets to 1 on Logon and clears resend history. It is not a NextSeqNo setting. ResetOnDisconnect and ResetOnLogout remain N.\nReturn a temporary reset setting to N and rebuild again before restoring order flow. Do not leave each reconnect resetting history.\n\n' + c.procedure + '\n\nOperational decisions model incident-bridge responses and engine-console actions, not terminal commands.\nJConsole: connect to the authorized QFJ application, select SessionAdmin by full SessionID. Operations: logoff(), logon(), reset(), sendTestRequest(). JMX must be enabled by the application.\nreset() clears resend history; resetSequence(int) is a different operation and must not be assumed to set both local counters.\n\nAFTER RECOVERY\nRead current messages and session-state export; review session in the panel. Read current reconciliation; reconcile in the panel. Resume, observe fresh activity, read the updated reconciliation, then close.\n\nINTERVIEW ANSWER\n' + c.interview + '\n');
    sync(); return w;
  }
  function action(id, label, detail) { return { id: id, label: label, detail: detail }; }
  PS.fixTraining = { paths: P, settings: settings, config: config, action: action, make: function (c) {
    var actions = [action('contact-peer', 'Coordinate with counterparty / incident bridge', 'Compare the exact session, both counters, pending replay and order outcomes. The response goes into the event log.'),
      action('hold', 'Desk: hold affected flow', 'Hold affected order flow or mark risk stale while recovery is performed.')].concat(c.actions || []).concat([
      action('review-session', 'Review recovered session evidence', 'Read current messages and session-state export after the latest change.'),
      action('reconcile', 'Reconcile broker and internal executions', 'Inspect execution identities, quantities, prices and unresolved order outcomes.'),
      action('resume', 'Desk: resume affected flow', 'Restore the flow after session and business checks; temporary reset settings must be removed.'),
      action('observe-live', 'Observe next activity window', 'Advance a simulated 60-second window with a new execution, booking and heartbeat.'),
      action('close', 'Close after verifying new activity', 'Inspect the post-resume reconciliation before closure.'),
      action('blind-reset', 'Reset immediately without reconciliation', 'Evaluate whether the evidence justifies resetting a live session.')]);
    function finding(id, label, path) { return { id: id, label: label, when: function (o) { var good = o.code === 0 && /\b(cat|grep|head|tail|sed|awk)\b/.test(o.cmd) && o.cmd.indexOf(path) >= 0 && o.out.trim().length > 0; if (good) o.world.fixOps.seen[id] = true; return good; } }; }
    var s = { id: c.id, title: c.title, track: 'fix', severity: 'P1', desk: 'Electronic Trading / FIX Production Support', host: c.host || 'ldn-fix-prod03', tags: c.tags, par: 900, impactPerMin: 16000, currency: 'GBP',
      objective: c.objective || 'Recover ' + c.session + ' while keeping healthy sessions available. Prove the cause, apply the scoped recovery, and reconcile the business result.',
      brief: c.symptom + '\n\nEvidence: ' + P.log + ', ' + P.config + ', ' + P.state + ', ' + P.business + '.\nCounterparty handover: ' + P.peer + '.\nRunbook: ' + P.runbook + '.\n\nEngine: QuickFIX/J 2.3.x. Use Linux tools for investigation/configuration. After diagnose, use Operational decisions for engine-console and incident-bridge actions.',
      build: function () { return build(c); }, supportActions: actions,
      supportAction: function (w, id) { if (!actions.some(function (a) { return a.id === id; })) return fail('Unknown operational action.'); return w.fixOps.perform(id); },
      onEvidence: function (o) { var d = o.world.fixOps; if (o.code !== 0 || !/\b(cat|grep|head|tail|sed|awk)\b/.test(o.cmd)) return;
        if (o.cmd.indexOf(P.log) >= 0 && /35=/.test(o.out)) { d.seen.recoveredLog = d.revision; if (d.lastProbe && o.out.indexOf('112=' + d.lastProbe.id) >= 0) d.seen.probe = d.revision; }
        if (o.cmd.indexOf(P.state) >= 0 && /NextTargetMsgSeqNum/.test(o.out)) d.seen.currentState = d.revision;
        if (o.cmd.indexOf(P.business) >= 0 && /missingOrMismatched/.test(o.out)) { d.seen.currentBusiness = d.revision; if (d.liveObserved && o.out.indexOf('EX-LIVE') >= 0) d.liveReviewed = true; } },
      discoveries: [finding('protocol', 'Inspect session message evidence', P.log), finding('profile', 'Inspect the session profile', P.config), finding('business', 'Establish execution and order outcomes', P.business), finding('peer', 'Read the counterparty handover', P.peer)],
      rootCauses: [{ text: 'The TCP connection alone proves FIX and business health.' }, { text: c.cause, correct: true }, { text: 'Every sequence incident requires deleting the message store and replaying orders.' }],
      fix: { prompt: c.procedure + '\nUse Operational decisions for engine/peer actions. Full runbook: ' + P.runbook,
        check: function (w) { return w.fixOps.check(); }, grade: function (w) { return { quality: w.fixOps.unhealthyActions ? 'blunt' : 'clean', bonus: w.fixOps.unhealthyActions ? -100 : 340, note: w.fixOps.unhealthyActions ? 'Recovered, but unnecessary or unsupported actions increased risk.' : 'Evidence, scoped recovery and fresh business activity verified.' }; } },
      hints: ['Inspect ' + P.log + ', ' + P.config + ' and ' + P.state + '.', 'Compare ' + P.business + ' and ' + P.peer + '. Preserve /evidence/incident with cp -r to ' + P.backup + '.', 'Configuration edits do not automatically change the engine. Read ' + P.runbook + ' and use Operational decisions for the coordinated steps.'],
      debrief: c.interview + '\n\n' + c.explanation + '\n\nThe named Linux tools and QuickFIX/J settings/JMX operations are real; service topology, paths and peer agreement belong to this example deployment. Logs are abbreviated, decoded extracts. Counterparty responses and engine actions are simulated.', sources: c.sources,
      walkthrough: ['cat ' + P.log, 'cat ' + P.config, 'cat ' + P.state, 'cat ' + P.business, 'cat ' + P.peer, 'cat ' + P.runbook, 'cp -r /evidence/incident ' + P.backup, { action: 'contact-peer' }, { action: 'hold' }].concat(c.recovery).concat(['cat ' + P.log, 'cat ' + P.state, { action: 'review-session' }, 'cat ' + P.business, { action: 'reconcile' }, { action: 'resume' }, { action: 'observe-live' }, 'cat ' + P.business, { action: 'close' }]) };
    PS.scenarios = PS.scenarios || []; PS.scenarios.push(s); return s;
  } };
})(PS);
