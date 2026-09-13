/* Primary references: FIX Trading Community Session Layer and FIXimate 4.4.
 * These are decoded log excerpts, not complete wire-encoded FIX messages. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  function task(short, ask, answer, solution, hint, teaches) {
    return { short: short, ask: ask, answer: answer, solution: solution, hint: hint, teaches: teaches };
  }
  var MESSAGES = [
    '09:00:00 RECV |8=FIX.4.4|35=A|49=VENUE|56=FUND|34=100|52=20260911-09:00:00|108=30|',
    '09:00:01 SEND |8=FIX.4.4|35=D|49=FUND|56=VENUE|34=500|52=20260911-09:00:01|11=ORD100|55=ABC|54=1|38=100|40=2|44=25.50|',
    '09:00:02 RECV |8=FIX.4.4|35=8|49=VENUE|56=FUND|34=101|52=20260911-09:00:02|11=ORD100|37=V100|17=ACK100|150=0|39=0|38=100|14=0|151=100|',
    '09:00:03 RECV |8=FIX.4.4|35=8|49=VENUE|56=FUND|34=102|52=20260911-09:00:03|11=ORD100|37=V100|17=E100A|150=F|39=1|38=100|32=40|31=25.50|14=40|151=60|',
    '09:00:04 RECV |8=FIX.4.4|35=8|49=VENUE|56=FUND|34=103|52=20260911-09:00:04|11=ORD100|37=V100|17=E100B|150=F|39=2|38=100|32=60|31=25.50|14=100|151=0|',
    '09:00:05 RECV |8=FIX.4.4|35=8|49=VENUE|56=FUND|34=103|52=20260911-09:00:05|43=Y|122=20260911-09:00:04|11=ORD100|37=V100|17=E100B|150=F|39=2|38=100|32=60|31=25.50|14=100|151=0|',
    '09:00:06 SEND |8=FIX.4.4|35=D|49=FUND|56=VENUE|34=501|52=20260911-09:00:06|11=ORD101|55=BADSYMBOL|54=2|38=20|40=1|',
    '09:00:07 RECV |8=FIX.4.4|35=8|49=VENUE|56=FUND|34=104|52=20260911-09:00:07|11=ORD101|37=V101|17=R101|150=8|39=8|38=20|14=0|151=0|58=UnknownSymbol|',
    '09:00:08 RECV |8=FIX.4.4|35=0|49=VENUE|56=FUND|34=107|52=20260911-09:00:08|',
    '09:00:09 SEND |8=FIX.4.4|35=2|49=FUND|56=VENUE|34=502|52=20260911-09:00:09|7=105|16=106|',
    '09:00:10 RECV |8=FIX.4.4|35=4|49=VENUE|56=FUND|34=105|52=20260911-09:00:10|43=Y|123=Y|36=107|',
    '09:00:41 SEND |8=FIX.4.4|35=1|49=FUND|56=VENUE|34=503|52=20260911-09:00:41|112=PROBE1|',
    '09:00:42 RECV |8=FIX.4.4|35=0|49=VENUE|56=FUND|34=108|52=20260911-09:00:42|112=PROBE1|',
    '09:01:00 RECV |8=FIX.4.4|35=5|49=VENUE|56=FUND|34=109|52=20260911-09:01:00|58=Scheduled_logout|'
  ].join('\n') + '\n';
  PS.drills.push({
    id: 'fix-support', title: 'FIX sessions and order evidence',
    topic: 'tags · sequence gaps · duplicate fills · reconciliation', host: 'ldn-fix-lab',
    tags: ['FIX 4.4', 'MsgSeqNum', 'PossDupFlag', 'ExecID', 'CumQty', 'ResendRequest'],
    brief: 'Investigate /fix/messages.log and /fix/session.log.\nThese are decoded FIX 4.4 excerpts: | represents the SOH separator; BodyLength, CheckSum and some required fields are intentionally omitted.\nThey are evidence for analysis, not messages to send. A log record count is not automatically a trade count.',
    build: function () {
      return W.create({ host: 'ldn-fix-lab', clock: new Date(2026, 8, 11, 12),
        root: V.dir({ tmp: V.dir({}), home: V.dir({ gsupport: V.dir({}) }), fix: V.dir({
          'messages.log': V.file(MESSAGES),
          'session.log': V.file('09:00:00 INFO session=FUND-VENUE inbound=100 outbound=500\n09:00:05 INFO duplicate sequence=103 ExecID=E100B suppressed\n09:00:08 WARN incoming sequence too high expected=105 received=107\n09:00:10 INFO gapfill NewSeqNo=107; buffered sequence=107 processed; nextExpected=108\n09:00:42 INFO TestReqID=PROBE1 answered\n'),
          'runbook.txt': V.file('transport=TCP connected does not prove FIX logged on\nsequence=independent inbound and outbound numbers\nreset-policy=coordinate with counterparty; reconcile persisted state; approved session-reset procedure only\nunknown-order-state=reconcile\ndedup=use counterparty/session/business-date identity scope and venue rules; handle corrections and cancels\nfix44-trade=ExecType F; OrdStatus describes current order state\nraw-framing=SOH is byte 0x01; BodyLength and CheckSum require exact bytes\n')
        }) }) });
    },
    tasks: [
      task('Read the counterparty', 'Which SenderCompID appears on the received Logon?', 'VENUE',
        'grep -F "|35=A|" /fix/messages.log', '35=A is Logon; tag 49 is SenderCompID.',
        'Tag 49 identifies the sender and 56 the target. Scope evidence to direction and session; the sender and target swap when traffic reverses.'),
      task('Read heartbeat interval', 'What HeartBtInt value in seconds is carried by the received Logon?', '30',
        'grep -F "|35=A|" /fix/messages.log | grep -o "108=[0-9]*"', 'Tag 108 is HeartBtInt.',
        'Heartbeat timing follows the session agreement. Successful TCP establishment alone does not show a valid Logon exchange, sequence alignment or application readiness.'),
      task('Count new order requests', 'How many NewOrderSingle messages are in the decoded log?', '2',
        'grep -Fc "|35=D|" /fix/messages.log', '35=D is NewOrderSingle; match tag boundaries.',
        '35=8 is ExecutionReport, not necessarily a fill. 35=F is OrderCancelRequest; FIX message type and ExecType are different fields.'),
      task('Count execution reports', 'How many ExecutionReport log records appear, including replayed records?', '5',
        'grep -Fc "|35=8|" /fix/messages.log', 'Count every 35=8 record, including acknowledgments and rejects.',
        'ExecutionReport communicates several lifecycle events. Count acknowledgments, trades, rejects and replays separately before inferring order or trade totals.'),
      task('Count raw trade records', 'How many FIX 4.4 trade ExecutionReport records appear before deduplicating?', '3',
        'grep -F "|35=8|" /fix/messages.log | grep -Fc "|150=F|"', 'For this FIX 4.4 fixture, ExecType F denotes Trade.',
        'FIX version and venue profile matter. In FIX 4.4, use ExecType F for a trade and OrdStatus to distinguish partial versus filled state; older versions encode fills differently.'),
      task('Count distinct fill IDs', 'For this one session and business day, how many distinct trade ExecIDs are present?', '2',
        'grep -F "|150=F|" /fix/messages.log | grep -o "|17=[^|]*" | sort -u | wc -l', 'Filter trade records, extract tag 17, then deduplicate.',
        'The example repeats E100B. Production deduplication needs the identity scope in the venue agreement and handling for trade corrections and cancels; a global ExecID-only key may be insufficient.'),
      task('Identify the replayed fill', 'Which ExecID is on the replayed trade record?', 'E100B',
        'grep -F "|150=F|" /fix/messages.log | grep -F "|43=Y|" | grep -o "|17=[^|]*"', 'PossDupFlag is tag 43.',
        '43=Y marks a possible duplicate; it is a request to apply duplicate handling, not proof the original was processed. Never simply discard every possible duplicate without checking state.'),
      task('Original versus sending time', 'What tag number carries OrigSendingTime on the replayed trade?', '122',
        'grep -F "|150=F|" /fix/messages.log | grep -F "|43=Y|"', 'Compare 52 and 122 on the replay.',
        'SendingTime(52) reflects this transmission; OrigSendingTime(122) preserves the original transmission time on a possible duplicate. Clock accuracy matters for session checks and evidence correlation.'),
      task('Read the partial cumulative qty', 'What CumQty is reported on the ORD100 partial fill?', '40',
        'grep -F "|39=1|" /fix/messages.log | grep -o "|14=[0-9]*"', 'Tag 39=1 means PartiallyFilled; CumQty is tag 14.',
        'CumQty is cumulative, while LastQty(32) is the quantity of the latest fill. Summing cumulative quantities across reports overcounts executions.'),
      task('Read the partial leaves', 'How much LeavesQty remains after the partial fill?', '60',
        'grep -F "|39=1|" /fix/messages.log | grep -o "|151=[0-9]*"', 'LeavesQty is tag 151.',
        'For a simple active order, OrderQty equals CumQty plus LeavesQty. Terminal states such as cancel, expiry or rejection can legitimately have LeavesQty zero with unfilled quantity.'),
      task('Read the latest fill quantity', 'What LastQty is associated with ExecID E100B?', '60',
        'grep -F "|17=E100B|" /fix/messages.log | head -1 | grep -o "|32=[0-9]*"', 'LastQty is tag 32; the same fill appears twice.',
        'E100B adds 60 to the previous cumulative 40, giving CumQty 100. A replay does not add another 60 to the business position.'),
      task('Read the reject reason', 'What Text value explains the rejected ORD101 order?', 'UnknownSymbol',
        'grep -F "|11=ORD101|" /fix/messages.log | grep -F "|39=8|" | grep -o "|58=[^|]*"', 'OrdStatus 8 is Rejected; free text is tag 58.',
        'An order reject differs from a session Reject(35=3), BusinessMessageReject(35=j), or OrderCancelReject(35=9). Check reject codes and the counterparty profile as well as free text.'),
      task('Find the expected sequence', 'When sequence 107 arrives, what inbound sequence did the receiver expect?', '105',
        'grep "sequence too high" /fix/session.log', 'Read expected and received; do not compare to outbound sequence 502.',
        'FIX has independent sequence numbers in each direction. A high inbound sequence indicates a gap relative to receiver state; investigate persistence, session identity and recovery before resetting anything.'),
      task('Read the resend beginning', 'What BeginSeqNo is requested by ResendRequest?', '105',
        'grep -F "|35=2|" /fix/messages.log | grep -o "|7=[0-9]*"', 'ResendRequest is 35=2; BeginSeqNo is tag 7.',
        'ResendRequest identifies a recovery range. EndSeqNo(16)=0 has the defined infinity meaning; this fixture uses the explicit end 106.'),
      task('Read the gap-fill target', 'What NewSeqNo does the SequenceReset GapFill carry?', '107',
        'grep -F "|35=4|" /fix/messages.log | grep -o "|36=[0-9]*"', 'Look for 35=4, GapFillFlag(123)=Y and NewSeqNo(36).',
        'GapFill advances expected sequencing over a specified range under recovery rules. It is distinct from an exceptional reset and must not conceal missing business messages. This log then processes the buffered 107.'),
      task('Match a TestRequest response', 'What TestReqID is echoed by the response Heartbeat?', 'PROBE1',
        'grep -F "|35=0|" /fix/messages.log | grep -o "|112=[^|]*"', 'TestRequest is 35=1; its response is a Heartbeat with matching tag 112.',
        'A TCP socket can stay established while an application is unresponsive. A missing TestRequest response is session-liveness evidence, which should be correlated with CPU, pauses, networking and peer logs.'),
      task('Read the logout explanation', 'What Text accompanies the counterparty Logout?', 'Scheduled_logout',
        'grep -F "|35=5|" /fix/messages.log | grep -o "|58=[^|]*"', 'Logout is 35=5.',
        'Check negotiated session schedules, time zones and venue notices. A scheduled logout differs from an unexpected network disconnect, but open orders still require the agreed operational treatment.'),
      task('Resolve an unknown order state', 'After losing an acknowledgment, should support resend the order blindly or reconcile its state first? Answer with the runbook action.', 'reconcile',
        'grep unknown-order-state /fix/runbook.txt', 'Use the runbook instruction before any business-message action.',
        'A missing acknowledgment does not prove the order failed to reach the venue. Reconcile OMS, gateway, counterparty and drop-copy evidence with stable identifiers and escalate under the incident procedure before any replay or failover.')
    ],
    wrapUp: 'Separate transport reachability, FIX session state and business order state. Match delimited tags, scope direction/session/date, and distinguish LastQty from CumQty. Count unique business events with the venue identity rules. Sequence resets, resends, order replay and failover require coordinated recovery and reconciliation, not guesswork from a single log line.'
  });
})(PS);
