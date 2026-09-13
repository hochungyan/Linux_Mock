# FIX and platform expansion

Research checked 2026-09-13. These are original fictional investigations, not recreated customer incidents. Production changes require the firm's authorization and the certified engine/venue rules of engagement.

## Why a separate FIX track

The new tab separates three diagnostic layers: transport reachability, FIX session state, and business completeness. A connected socket or recent heartbeat is insufficient evidence that risk has every execution. The six new cases add explicit evidence paths and guarded recovery to the existing flapping-session investigation; they do not claim exhaustive coverage of FIX implementations.

| Investigation | Evidence to establish | Recovery outcome |
|---|---|---|
| Incoming sequence gap | Local next-in 501, buffered 504, missing application/admin slots | Replay two fills, gap-fill only the admin slot, release 504 once, reconcile 70 units |
| Agreed reset to 1 | Separate directional counters, preserved stores, no unresolved orders, bilateral boundary approval | Both counters reset, bilateral Logon verified, fresh probe and business reconciliation |
| Unanswered TestRequest | `35=1`, `112`, unrelated heartbeats and peer dispatcher evidence | Scoped peer repair/reconnect, same-ID heartbeat response, retained sequence history |
| Missing drop-copy source | Source mapping and approved scope versus venue execution export | Approved mapping and historical-copy recovery; all scoped executions accounted for |
| Application checkpoint lag | FIX received all fills while consumer/schema evidence explains stalled booking | Compatible consumer, idempotent inbox replay, matched identities and quantities |
| Wrong Logon identity | Logout reason, `49/56`, environment and approved profile | Correct identity accepted without counter reset or healthy-session disruption |

## Primary documentation

- [FIX Session Layer](https://www.fixtrading.org/standards/fix-session-layer-online/) defines session sequencing, Logon/reset behavior and TestRequest processing. The simulator distinguishes ResendRequest, eligible GapFill and a bilateral new-session reset; these are not interchangeable repairs.
- [FIX Session Layer Test Cases](https://www.fixtrading.org/standards/fix-session-testcases-online/) supplies protocol checks for heartbeat correlation and recovery. The heartbeat exercise requires a response with the same TestReqID. Its 30-second interval and 1.5 threshold are a fictional agreement, not universal constants.
- [QuickFIX/C++ configuration](https://quickfixengine.org/c/documentation/getting-started/configuration.html) illustrates engine-specific persistence/reset settings. A configuration name in an exercise is not blanket advice to enable automated resets on a live engine.
- [CME Drop Copy FAQ](https://www.cmegroup.com/solutions/market-access/globex/trade-on-globex/faq-drop-copy.html) describes source/target grouping, copied execution activity, approvals and recovery restrictions. CME's drop copy does not submit or cancel orders. The examples motivate mapping/completeness checks; our synthetic mapping and import controls do not implement CME interfaces, retention limits or market segmentation.
- [Apache Kafka consumer documentation](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html) distinguishes consumer progress and committed offsets. The platform case teaches evidence-preserving consumer repair and targeted reprocessing, not an unconditional offset jump.
- [AWS: retries, backoff and jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) and [idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) motivate bounded retry budgets and stable request identity when outcomes are uncertain.
- [Kubernetes probe documentation](https://kubernetes.io/docs/concepts/workloads/pods/probes/) distinguishes readiness routing from liveness restart behavior and startup protection. The deployment case uses captured exports and a fictional rollback controller, not a real cluster.

## Deliberate simulation boundaries

`fixctl` exists only inside this game. It cannot communicate with a venue, change a real engine, or send orders. The reset workflow records an already-supplied approval; typing a change ID does not obtain real-world authorization. Logs replace SOH with `|` and omit framing/checksum fields. Keep the original evidence under `/evidence/before`; inspect recovery actions in `/var/log/fix/recovery.log` and current counters in `/var/lib/fix/current-sequences.json`.

FIX case inputs are frozen snapshots, with synthetic executions and counterparty policies. Replay deduplication uses the documented broker/date/account/ExecID scope for these fixtures only. Trade busts/corrections, multi-day identity reuse, real message-store corruption, TLS/key rotation, venue certification, session calendars, disaster recovery and full performance testing need further dedicated cases and the relevant product documentation. This is broader support practice, not coverage of every IB/hedge-fund production situation.

The Matrix theme is local CSS: dark surfaces, green accents, restrained console decoration, readable severity colors and reduced-motion support. No external fonts, telemetry or visual libraries were added.
