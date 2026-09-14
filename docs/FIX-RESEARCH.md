# FIX and platform research

Research revised 2026-09-14. These are original fictional investigations, not customer incidents. Production changes require the firm's authorization and the certified engine/venue rules of engagement.

## Seven realistic support workflows

The FIX tab separates transport reachability, session state and business completeness. A connected socket or recent heartbeat does not prove that risk has every execution.

| Investigation | Evidence and support workflow | Verified outcome |
|---|---|---|
| Incoming sequence gap | Engine already sent ResendRequest; coordinate retained application replay and administrative GapFill | Missing fills recovered, buffered message released once, business reconciled |
| Agreed reset to 1 | Preserve exports and confirm consistent store backup, bilateral approval and no unresolved business; edit the temporary QuickFIX/J reset profile while the dedicated service is stopped | Reset Logon verified, normal non-reset profile loaded before resuming |
| Unanswered TestRequest | Correlate TestReqID, inspect peer dispatcher evidence, coordinate repair and use documented JMX Logon/TestRequest actions | Matching heartbeat response, retained history and new business activity |
| Missing drop-copy source | Compare approved venue mapping with independent execution records; request venue change and controlled historical import | All scoped executions present without inventing a local mapping setting |
| Application checkpoint lag | Compare received versus applied executions; edit the application's decoder setting and restart only its consumer | Durable inbox reprocessed idempotently without changing FIX counters |
| Wrong Logon identity | Compare CompIDs with approved profile; edit SenderCompID and load the correct SessionID's existing store | Correct identity accepted, no counter reset or reuse of the wrong session's store |
| Flapping session after restore | Prove inconsistent restored state; coordinate a bilateral boundary and use SessionAdmin logoff/reset/logon operations | Store-reset consequences understood, matching session and business checks |

Every case requires a fresh, controlled post-resume observation window and independent execution reconciliation before closure. Historical fixtures contain 70 units; the observation introduces a new five-unit execution, so old status output cannot close the incident.

## Configuration is not the current sequence number

The selected engine is QuickFIX/J 2.3.x. The fixture's single-session wrapper reads `/etc/quickfixj/session.cfg` on service start. Learners use Linux `cat`, `sed`, redirection and `mv` to inspect, stage, review and apply changes. Editing a live file does not change the already-loaded profile; this wrapper has no reload operation.

`ResetOnLogon=Y` is a documented QuickFIX/J initiator option, not an arbitrary incoming-counter value. It is temporary in the approved reset exercise and must be removed from both the on-disk and loaded profile before normal operation resumes. `[SESSION]` overrides `[DEFAULT]`. ResetOnLogout, ResetOnDisconnect, PersistMessages, FileStorePath and the session identity are visible so the learner can explain the risks.

There is no invented `NextSeqNo=504` configuration setting or editable pretend store format. Current incoming and outgoing counters belong to session/store state. Arbitrary counter alignment is engine-specific and is not the normal repair for a recoverable gap.

## Primary FIX documentation

- [FIX Session Layer](https://www.fixtrading.org/standards/fix-session-layer-online/): sequencing, ResendRequest, eligible GapFill, coordinated resets and TestRequest processing. The gap case uses EndSeqNo=0 (onward), preserves missing executions and correlates the same TestReqID on a response.
- [QuickFIX/J configuration](https://quickfixj.org/docs/configuration/): configuration inheritance, session identity, persistence and reset settings. These exercises select one engine; similarly named options in other implementations may behave differently.
- [QuickFIX/J JMX administration](https://quickfixj.org/usermanual/2.3.0/usage/jmx.html) and [SessionAdminMBean API](https://javadoc.io/static/org.quickfixj/quickfixj-core/2.3.1/org/quickfixj/jmx/mbean/session/SessionAdminMBean.html): the optional JMX exporter exposes operations including logoff, logon, reset and sendTestRequest. The reset operation clears the resend store. The exercise explicitly coordinates both peers' local reset to 1; it does not assert that a JMX reset necessarily puts tag 141=Y on the wire. The configuration-driven reset is taught separately.
- [CME Drop Copy FAQ](https://www.cmegroup.com/solutions/market-access/globex/trade-on-globex/faq-drop-copy.html): source grouping, permissions and recovery constraints motivate completeness checks. The synthetic venue requests/imports are not CME APIs and do not reproduce its retention rules or market segmentation.

## Simulation boundaries and evidence

Linux commands operate on simulated files. The Operational decisions panel clearly separates engine-console actions from counterparty, venue and middle-office coordination. It does not execute Java/JMX, send real FIX messages or obtain real-world authorization.

Read the case-specific `/home/gsupport/runbook-fix.txt` and peer handover. Preserve immutable support exports from `/evidence/incident` under `/var/tmp/fix-incident`. These copies are not a safe snapshot of a live message store: the supplied manifest records a consistent backup already retained by the engine team. Current decoded logs and state exports are under `/var/log/quickfixj`; business reconciliation is `/var/log/dropcopy/reconciliation.json`.

Logs use pipes in place of SOH and omit framing and other fields; they are not sendable wire messages. Service names, file locations, network addresses, the one-session-per-service topology, the consumer's decoder property and the external approval workflow are fixture choices, not QuickFIX/J defaults. The heartbeat timeout policy is an explicitly supplied bilateral agreement, not a universal FIX constant.

Reconciliation checks broker/date/account/ExecID scope plus symbol, side, price and quantity for these fixtures. Trade busts/corrections, multi-day identity reuse, store corruption, TLS rotation, venue certification, session calendars, DR and performance need dedicated exercises. This is not exhaustive IB/hedge-fund coverage.

## Related platform sources

- [Apache Kafka consumer documentation](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html): consumer progress and committed offsets; the platform case repairs a poison record without skipping trades.
- [AWS retries, backoff and jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) and [idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/): bounded retry budgets and stable request identities for uncertain outcomes.
- [Kubernetes probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/): readiness, liveness and startup protection; the deployment case uses captured exports and a fictional rollback controller.

The Matrix theme remains local CSS with readable severity colors and reduced-motion support. No external visual libraries or telemetry were added.
