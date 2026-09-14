/* Preserves the original scenario ID and objective; replaces the one-call reset. */
(function (PS) {
  'use strict';
  var T = PS.fixTraining;
  T.make({
    id: 'fix-seqnum-gap', kind: 'flap', session: 'GSCLIENT1',
    title: 'Client FIX session flapping at the open', host: 'ldn-fix-prod03',
    objective: 'Get GSCLIENT1 trading before the 08:00 open, without disturbing the two client sessions that are already logged on. Prove why we are dropping them first.',
    tags: ['QuickFIX/J', 'low sequence', 'bilateral reset', 'JMX'],
    symptom: 'GSCLIENT1 repeatedly receives a low-sequence rejection. TCP connectivity is working. The other client sessions are healthy. A low number alone does not establish why their state differs.',
    log: '07:58:00 IN |35=A|34=1|49=GSCLIENT1|56=HF_PROD|141=N|\n07:58:00 EVENT MsgSeqNum too low: expecting 88413 but received 1\n07:58:00 OUT |35=5|34=91000|58=MsgSeqNum too low|\n07:58:01 EVENT session disconnected; next-in=88413 next-out=91001',
    peer: 'CONN-880: peer operations confirms its uncoordinated reset at this boundary. Both parties have now stopped attempts, retained their archives, confirmed zero working orders, no missing executions and no pending replay. Approval covers GSCLIENT1 only. The JMX procedure coordinates explicit local resets to 1 on BOTH sides before reconnecting. reset() is not itself a remote reset request. The alternative temporary ResetOnLogon=Y profile requests 141=Y and requires the peer acknowledgement. Other sessions retain their state. This evidence, not ResetOnLogon=N alone, justifies recovery.',
    cause: 'The peer reset while our session retained its previous state. The incident bridge has established and approved a reconciled bilateral reset for this session only.',
    procedure: 'After evidence preservation and counterpart coordination, select this full SessionID in JConsole: SessionAdmin.logoff(), reset(), then logon(). Inspect the new Logon exchange and both counters before business reconciliation. The alternative for this dedicated connector is the approved temporary ResetOnLogon=Y profile, restored to N after the reset.',
    interview: '“A low MsgSeqNum can mean a stale store, duplicate traffic, wrong session or an uncoordinated reset. I would establish which one it is with logs and the counterparty. Here the peer reset and both parties have reconciled the business state, so I can use the approved per-session reset, preserve the old resend archive and verify the new Logon. I would not restart all clients or assume ResetOnLogon=N is inherently wrong.”',
    explanation: 'QuickFIX/J SessionAdmin.reset() resets state and clears the resend log. The archive and bilateral agreement are essential evidence. This scenario uses the JMX route; the separate configuration reset case teaches disk configuration and process lifecycle. The former HTTP /admin/session/.../reset endpoint has been removed.',
    actions: T.resetActions,
    recovery: [{ action: 'jmx-logoff' }, { action: 'jmx-reset' }, { action: 'jmx-logon' }],
    sources: T.sources
  });
})(PS);
