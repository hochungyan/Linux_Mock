/* Original cases grounded in FIX and QuickFIX/J documentation. */
(function (PS) {
  'use strict';
  var T = PS.fixTraining, A = T.action;
  var SOURCES = [
    { title: 'FIX Trading Community: session protocol', url: 'https://www.fixtrading.org/standards/fix-session-layer-online/' },
    { title: 'QuickFIX/J configuration reference', url: 'https://quickfixj.org/docs/configuration/' },
    { title: 'QuickFIX/J: managing applications with JMX', url: 'https://quickfixj.org/usermanual/2.3.0/usage/jmx.html' },
    { title: 'QuickFIX/J 2.3.1 SessionAdminMBean operations', url: 'https://javadoc.io/static/org.quickfixj/quickfixj-core/2.3.1/org/quickfixj/jmx/mbean/session/SessionAdminMBean.html' }
  ];
  T.sources = SOURCES;
  T.resetActions = [
    A('jmx-logoff', 'JConsole: SessionAdmin.logoff()', 'Select the exact SessionID and disable only this session. Confirm logout/disconnection.'),
    A('jmx-reset', 'JConsole: SessionAdmin.reset()', 'Documented QFJ operation: resets session state and clears the resend log. Requires the agreed reset window and preserved archive.'),
    A('jmx-logon', 'JConsole: SessionAdmin.logon()', 'Enable the selected session; inspect the actual Logon exchange and counterpart response.')
  ];
  T.make({
    id: 'fix-resend-gap-recovery', kind: 'gap', session: 'DC-GAP',
    title: 'Sequence gap: the engine requested replay, but fills are missing',
    tags: ['automatic ResendRequest', 'GapFill', 'PossDupFlag', 'reconciliation'],
    symptom: '09:00:02: the receiver expected 501 and buffered 504. A ResendRequest is already on the wire, but the risk book is still missing executions. Other sessions are healthy.',
    log: '08:59:58 IN |35=0|34=500|\n09:00:02 IN |35=8|34=504|150=F|17=EX-504|32=40|31=25| BUFFERED expected=501\n09:00:02 OUT |35=2|34=811|7=501|16=0|\n09:00:03 EVENT ResendRequest outstanding; no replay response yet',
    peer: 'Session DC-GAP, HF_PROD -> DC-GAP. Peer confirms 501=EX-501 qty10, 502=Heartbeat, 503=EX-503 qty20, 504=EX-504 qty40. Its replay dispatcher is paused. CHG-F101 authorizes resuming the retained replay. No reset; no new orders. EndSeqNo=0 requests all messages after 501; bounded ranges depend on engine/venue policy.',
    cause: 'The local engine detected the gap and already requested replay. The peer replay dispatcher is paused; resetting local counters would skip recoverable executions.',
    procedure: 'Keep ResetOnLogon=N. Establish that 35=2 has already been sent, coordinate the outstanding replay with the peer, then inspect original sequences, duplicate flags, administrative GapFill and release of buffered 504.',
    interview: '“I would compare the received 34 with next-in and check whether my engine sent 35=2. Here it did, so I would take the outstanding range and timestamps to the counterparty. I would verify that the two missing executions were replayed and booked once, and that the GapFill only covered the heartbeat. I would not advance next-in to make the gap disappear.”',
    explanation: 'FIX recovery is normally automatic. 7=501,16=0 requests the missing range onward; the engine/venue can instead use a finite range. Replay preserves 34 and uses 43=Y/122. The 502 administrative slot advances via 35=4,123=Y,36=503. A successful recovery is not a new order submission.',
    actions: [A('peer-replay', 'Counterparty: recover the outstanding ResendRequest', 'Provide session, direction and missing range; the peer releases replay and the local engine processes it automatically.'), A('skip-gap', 'Advance next-in directly to 504', 'Consider the business events that would be skipped.')],
    recovery: [{ action: 'peer-replay' }], sources: SOURCES
  });
  T.make({
    id: 'fix-coordinated-sequence-reset', kind: 'reset', session: 'ORDER-A',
    title: 'Coordinated reset: change the profile and verify both counters',
    tags: ['QuickFIX/J configuration', 'ResetOnLogon', '141=Y', 'message store'],
    symptom: 'The desk has held ORDER-A at an agreed session boundary. The peer is ready for a bilateral reset to 1, but our engine still holds incoming 88413 and outgoing 91001.',
    log: '08:59:00 EVENT previous connection closed; local nextIn=88413 nextOut=91001\n08:59:30 IN |35=A|34=1|141=N|\n08:59:30 EVENT Logon rejected: MsgSeqNum too low; no coordinated reset applied\n08:59:31 EVENT session disconnected',
    peer: 'CHG-F102 covers ORDER-A only. Both parties have archived their stores, reconciled all executions, and confirmed zero working orders / pending replay. At this boundary the peer accepts a Logon at 1 with 141=Y and returns the same reset agreement. The approved JMX alternative instead coordinates explicit local resets to 1 at BOTH ends; reset() alone is not a request to the remote engine. Later connections must retain sequence history.',
    cause: 'The agreed session transition has not been applied locally. The supplied reset profile can initiate the bilateral reset, but must be returned to normal persistence settings afterwards.',
    procedure: 'After coordination and hold: systemctl stop fix-connector; edit /etc/quickfixj/session.cfg so its SESSION ResetOnLogon=Y, or copy the approved profile; systemctl start fix-connector. Inspect the 34=1,141=Y Logons and next-in/next-out=2. Then stop, restore ResetOnLogon=N and start again. Inspect the continued counters before resuming. Alternatively use the documented JMX reset() route after logoff and archival.',
    interview: '“I would first establish that a bilateral reset is intended and that orders and executions are reconciled. With QuickFIX/J, I can use the approved session reset operation or, for this dedicated connector, load a temporary ResetOnLogon=Y profile. That resets to 1 and clears resend history; it does not set an arbitrary number. I verify both Logons and restore N before trading resumes.”',
    explanation: 'The walkthrough deliberately edits a configuration copy with sed and then mv. The process rereads configuration on restart in this deployment. A running engine does not consume arbitrary configuration edits. ResetOnLogon is different from ResetOnDisconnect, session schedules, and manual sequence alignment. A real shared process requires a scoped engine procedure.',
    actions: T.resetActions,
    recovery: ['systemctl stop fix-connector', "sed 's/ResetOnLogon=N/ResetOnLogon=Y/' /etc/quickfixj/session.cfg > /etc/quickfixj/session.cfg.new", 'cat /etc/quickfixj/session.cfg.new', 'mv /etc/quickfixj/session.cfg.new /etc/quickfixj/session.cfg', 'systemctl start fix-connector', 'cat /var/log/quickfixj/messages.log', 'cat /var/log/quickfixj/session-state.json', 'systemctl stop fix-connector', "sed 's/ResetOnLogon=Y/ResetOnLogon=N/' /etc/quickfixj/session.cfg > /etc/quickfixj/session.cfg.new", 'mv /etc/quickfixj/session.cfg.new /etc/quickfixj/session.cfg', 'systemctl start fix-connector'], sources: SOURCES
  });
  T.make({
    id: 'fix-heartbeat-testrequest', kind: 'heartbeat', session: 'DC-HB',
    title: 'Heartbeat sender alive, session dispatcher unresponsive',
    tags: ['TestRequest', 'TestReqID', 'JMX', 'peer escalation'],
    symptom: 'Periodic heartbeats arrived but did not answer the outstanding TestRequest. The timeout has now disconnected DC-HB. Establish why the session processor failed to respond before reconnecting.',
    log: '09:00:00 OUT |35=1|34=810|112=HB-OLD|\n09:00:15 IN |35=0|34=610|\n09:00:30 IN |35=0|34=611|112=UNRELATED|\n09:00:45 OUT |35=5|34=811|58=TestRequest timeout|\n09:00:45 IN |35=5|34=612|\n09:00:46 EVENT transport disconnected; no matching 112=HB-OLD received',
    peer: 'CHG-F103: peer confirms dispatcher STALLED while independent heartbeat writer was running. Its dispatcher will be repaired under its own runbook. HeartBtInt=30; this bilateral response policy uses 45 seconds. That threshold is not a universal FIX default or a QuickFIX/J config setting in this file. Keep counters; peer confirms next expected incoming=812 and next outgoing=613.',
    cause: 'The peer session dispatcher stalled. Heartbeats without the requested 112 did not prove responsiveness; the configured timeout disconnected the session.',
    procedure: 'Confirm the timeout and missing matching TestReqID. Record peer dispatcher recovery on the incident bridge, use SessionAdmin.logon(), then sendTestRequest(). Read the generated 112 and its matching 35=0 response. Retain sequence history.',
    interview: '“I would look for the TestRequest ID and a matching heartbeat response, not just any heartbeat. Here the peer writer was alive but its session dispatcher was stuck. I would coordinate peer recovery, reconnect with persisted counters and verify a fresh correlated response, followed by complete drop-copy booking.”',
    explanation: 'Heartbeat timing is negotiated and implementation-specific. Ordinary application traffic also counts as session activity. Check FileLogHeartbeats/other logging filters before concluding that an absent heartbeat log means no network activity. No local configuration change repairs a peer dispatcher.',
    actions: [A('peer-dispatcher', 'Counterparty: confirm dispatcher recovery', 'Record the peer repair and sequence agreement in the incident bridge.'), A('jmx-logon', 'JConsole: SessionAdmin.logon()', 'Re-enable this session using persisted sequence state.'), A('jmx-test', 'JConsole: SessionAdmin.sendTestRequest()', 'Generate a fresh probe; read the emitted TestReqID and matching response in the log.')],
    recovery: [{ action: 'peer-dispatcher' }, { action: 'jmx-logon' }, { action: 'jmx-test' }], sources: SOURCES
  });
  var dropSource = { title: 'CME Drop Copy FAQ: grouping, approvals and recovery (venue example)', url: 'https://www.cmegroup.com/solutions/market-access/globex/trade-on-globex/faq-drop-copy.html' };
  T.make({
    id: 'fix-dropcopy-source-mapping', kind: 'mapping', session: 'DC-MAP',
    title: 'Drop copy logged on, source session missing from the group',
    tags: ['drop copy', 'venue mapping', 'business backfill', 'reconciliation'],
    symptom: 'DC-MAP has contiguous sequence numbers and recent heartbeats. ORDER-A fills reach risk but two ORDER-B executions are absent.',
    log: '09:00:00 IN |35=0|34=610|\n09:00:01 IN |35=8|34=611|150=F|17=EX-501|32=10|31=25| source=ORDER-A\n09:00:02 IN |35=0|34=612|\n09:00:03 MONITOR group sources=ORDER-A; ORDER-B venue executions=2 copied=0; sequence gaps=0',
    peer: 'CHG-F104: clearing/venue operations approve ORDER-B on DC-MAP. The remote drop-copy group currently only maps ORDER-A. The approved historical export contains EX-503 qty20 and EX-504 qty40 for BRK-A/HF-ALPHA/2026-09-14. Import copies with the firm middle-office recovery process; do not submit new orders. Source mapping is venue-side, not a QFJ session setting.',
    cause: 'The venue drop-copy group omits ORDER-B. There is no target-session sequence gap because the missing executions were never routed onto this target stream.',
    procedure: 'Confirm the approved source mapping with the venue, then have middle office recover the scoped historical execution export through its normal import process. Inspect received versus applied identities and quantities. Changing a local heartbeat or reset setting cannot add a venue source entitlement.',
    interview: '“I would compare the venue source-to-target group and entitlement with actual order activity. A contiguous drop-copy sequence cannot expose events never routed to it. I would obtain the approved mapping change, reconcile the historical gap via the venue/firm recovery process, and verify both fresh fills and internal positions.”',
    explanation: 'Mapping and application recovery differ by venue. A local Sources= field is not a standard FIX engine setting. This example models remote venue confirmation and a middle-office export import; it does not claim they are generic FIX wire operations. FIX counters do not advance for importing an off-line business export.',
    actions: [A('venue-map', 'Venue operations: confirm approved source mapping', 'Confirm ORDER-B is included on the correct drop-copy target.'), A('import-export', 'Middle office: import approved historical executions', 'Recover only the agreed account/date/ExecID scope; deduplicate by identity and economics.'), A('cancel-via-dropcopy', 'Cancel orders through this drop-copy feed', 'Evaluate the capabilities of a read-only drop-copy interface.')],
    recovery: [{ action: 'venue-map' }, { action: 'import-export' }], sources: SOURCES.concat([dropSource])
  });
  T.make({
    id: 'fix-dropcopy-consumer-lag', kind: 'consumer', session: 'DC-LAG',
    title: 'FIX received all fills, but the consumer checkpoint stalled',
    tags: ['configuration', 'application checkpoint', 'consumer restart', 'deduplication'],
    symptom: 'The FIX engine received three fills and is logged on. The consumer has booked only the first fill after a deployment. The engine and consumer run in separate services.',
    log: '09:00:00 IN |35=8|34=610|150=F|17=EX-501|32=10|31=25|\n09:00:01 IN |35=8|34=611|150=F|17=EX-503|32=20|31=25|\n09:00:02 IN |35=8|34=612|150=F|17=EX-504|32=40|31=25|\n09:00:03 CONSUMER ERROR unsupported schema v2; received=3 applied=1',
    peer: 'CHG-F105: the broker confirms all three executions. App team approves decoder.schema=v2 for the retained inbox and restarting dropcopy-consumer only. The consumer transactionally stores execution identity and application checkpoint. Its staged configuration is /etc/dropcopy/approved-consumer.properties. This is a firm application setting, not a QuickFIX/J option.',
    cause: 'The consumer is configured for schema v1 while the retained inbox uses v2. The FIX receive sequence advances independently of the downstream application checkpoint.',
    procedure: 'Inspect /etc/dropcopy/consumer.properties and /evidence/incident/consumer.log. Stop dropcopy-consumer, install the approved v2 decoder configuration, then start it. Its durable inbox resumes from the application checkpoint with business deduplication. Do not reset the FIX session.',
    interview: '“I would compare the FIX receive sequence with the application checkpoint. The messages are already present, so I would repair the consumer configuration and let it resume the durable inbox. I would then reconcile scoped execution IDs and economics and verify that replay did not double-book positions.”',
    explanation: 'The engine, its store and the consumer have different responsibilities. A service restart can be appropriate after repairing the application defect, provided the checkpoint and idempotency model are understood. PossDupFlag does not by itself implement business deduplication.',
    actions: [], recovery: ['cat /etc/dropcopy/consumer.properties', 'cat /evidence/incident/consumer.log', 'systemctl stop dropcopy-consumer', "sed 's/decoder.schema=v1/decoder.schema=v2/' /etc/dropcopy/consumer.properties > /etc/dropcopy/consumer.properties.new", 'cat /etc/dropcopy/consumer.properties.new', 'mv /etc/dropcopy/consumer.properties.new /etc/dropcopy/consumer.properties', 'systemctl start dropcopy-consumer'], sources: SOURCES.concat([dropSource])
  });
  T.make({
    id: 'fix-logon-compid-mismatch', kind: 'identity', session: 'BROKER_PROD',
    title: 'UAT CompID promoted into the production connector profile',
    tags: ['configuration', 'CompID', 'SessionID store', 'logon rejection'],
    symptom: 'Transport and TLS succeeded, but production rejected the Logon after a configuration promotion. Inspect identity and persistence before changing sequence state.',
    log: '09:00:00 TRANSPORT TLS verified; socket connected\n09:00:01 OUT |35=A|34=811|49=HF_UAT|56=BROKER_PROD|108=30|\n09:00:01 IN |35=5|34=612|58=SenderCompID not entitled on PROD|\n09:00:02 EVENT connection closed; wrong profile nextOut=812 nextIn=613',
    peer: 'CHG-F106 approves HF_PROD -> BROKER_PROD. The production session already has a retained FileStore keyed to that full SessionID: next-out=911 and next-in=711. Broker confirms those counterpart numbers. The HF_UAT store belongs to a different identity and must remain separate. No reset and no CheckCompID=N bypass. Approved profile: /etc/quickfixj/approved-session.cfg.',
    cause: 'The promoted profile uses the UAT SenderCompID. Restore the correct production identity and its own persisted session store; do not copy the UAT sequence numbers.',
    procedure: 'Inspect /etc/quickfixj/session.cfg and the peer-approved production profile. Stop this dedicated fix-connector, correct SenderCompID to HF_PROD, and start it. Verify the restored PROD SessionID loads its own counters 911/711 before Logon and advances to 912/712 afterwards.',
    interview: '“I would read the Logout reason and compare 49/56, environment and the approved profile. Correcting CompID changes session identity, so I must select the corresponding persisted store and reconcile its counters with the peer. I would reload this deployment through its scoped stop/start procedure, verify Logon and confirm new executions without disabling identity validation.”',
    explanation: 'An engine session is identified by its FIX version and sender/target identifiers (and configured qualifiers/sub-IDs). Renaming the CompID while reusing arbitrary old counters teaches an unsafe recovery. QuickFIX/J supports multiple sessions, but this example deliberately isolates the connector service for a scoped configuration change.',
    actions: [], recovery: ['cat /etc/quickfixj/approved-session.cfg', 'systemctl stop fix-connector', "sed 's/SenderCompID=HF_UAT/SenderCompID=HF_PROD/' /etc/quickfixj/session.cfg > /etc/quickfixj/session.cfg.new", 'cat /etc/quickfixj/session.cfg.new', 'mv /etc/quickfixj/session.cfg.new /etc/quickfixj/session.cfg', 'systemctl start fix-connector'], sources: SOURCES
  });
})(PS);
