# SEV1 — Linux Production Support Simulator

Linux interview preparation for investment bank and hedge fund production support / application support.

**186 practical questions in 14 packs, 160 interview questions across 22 topics, and 32 incident investigations (25 general + 7 FIX).** A black-and-green Matrix operations-console theme spans all four tracks.

## Run

Double-click `start.bat`, or run `node serve.js` and open [the local game](http://localhost:8099/). No dependencies or build step are required. Opening `index.html` directly also works; browser policy determines whether progress can be saved on a file URL.

## Render / Docker

Render can deploy this repository as a Docker Web Service using the root `Dockerfile`. The server honors Render's injected `PORT`; no build command or application dependencies are required.

## Four tracks

- **Terminal drills:** inspect a simulated host and submit `answer <value>`. Use `task`, `task N`, `hint`, `solution`, `skip` and `finish`. Correct answers show a command and its interpretation. Some conceptual tasks use supplied reference notes.
- **Incident investigations:** `objective` states the goal and the loop at any time; gather findings, use `diagnose`, then restore the machine through commands. Recovery quality affects the score.
- **FIX incidents:** a dedicated tab beside Incident investigations. Investigate session gaps, bilateral sequence resets, heartbeat/TestRequest failures, drop-copy source mapping, consumer lag and Logon identity. Each new case has absolute evidence paths, a scoped approval, a runbook and separate session/business recovery checks.
- **Interview practice:** search/filter by topic or confidence, explain your answer, reveal the guide and rate your confidence. Mock interviews select up to 20 distinct matching questions. These are self-assessments, not automatically graded exam scores. Ratings stay in this browser; scratch notes clear on changing questions.

The game opens on Incident investigations. Use drills to practise commands, then investigate a desk's business failure. The [finance research notes](docs/FINANCE-RESEARCH.md) connect the new cases to public primary sources and distinguish industry behavior from fictional controls.

The [FIX and platform research notes](docs/FIX-RESEARCH.md) link the workflows to FIX Trading Community, QuickFIX/J, CME and platform documentation. All seven FIX incidents combine Linux investigation with an **Operational decisions** panel for engine-console and counterparty actions. The simulator models documented QuickFIX/J configuration and JMX operations; it does not run a real FIX engine or contact a venue.

## Practical packs

| Pack | Questions | Coverage |
|---|---:|---|
| Reading logs | 15 | grep, awk, sed, zgrep, find, sort/uniq |
| TCP connections | 13 | Listeners, socket states, connection probes |
| UDP and multicast | 12 | ss -uanp, queues, UDP errors, membership, NIC drops |
| Memory | 12 | Available/free, RSS/VSZ, swap, JVM heap, OOM |
| CPU and load average | 12 | Per-core CPU, load, iowait, native thread IDs |
| IP addressing and routing | 12 | CIDR, routes, MTU, DNS/NSS, ARP |
| Processes and signals | 10 | Parents, zombies, signals, D state, limits |
| Disk, inodes and permissions | 10 | df/du, inode exhaustion, mounts, deleted open files |
| Shell and evidence files | 14 | >, >>, 2>, 2>&1, tee, quoting, truncate |
| Text investigation | 14 | grep flags, awk fields, sed, counts |
| Find files and filesystem clues | 14 | -mtime -30, -mmin -30, -iname, size, owner, depth |
| Permissions and secure support | 14 | Modes, directories, identity, umask/ACL/SELinux concepts |
| FIX sessions and order evidence | 18 | Tags, gaps, duplicate fills, quantities, recovery |
| Services, batch, DNS and time | 16 | systemctl, journalctl, DNS, NTP, dependencies, reconciliation |

The [coverage guide](docs/COVERAGE.md) lists all 22 interview topics, requested command examples and simulator boundaries.

## Incidents

1. Trade capture stopped persisting — deleted open log, df/du disagreement and approved space recovery.
2. Prices frozen — packet arrival versus socket delivery and consumer progress.
3. Risk engine stalled — memory pressure, retained heap, JVM errors versus kernel OOM.
4. Order acks slow — native thread ID to Java stack and CPU spin.
5. FIX session flapping — agreed, reconciled per-session recovery.
6. EOD load hung — genuinely uninterruptible wait and fence-before-DR recovery.
7. Risk checks timeout — every connection held by an idle transaction during an unbounded remote wait.
8. Order acknowledgements stop — a descriptor leak leaves the adapter at its file limit.
9. Settlement files fail — empty retry markers exhaust inodes while bytes remain free.
10. Risk container restarts — native memory pushes a worker cgroup over its hard limit.
11. Trades not reaching settlement — one poison message rolled back to the head of the queue blocks every trade behind it; backout threshold versus clearing the queue.
12. EOD position update blocked — an abandoned interactive session holds a row lock; distinguishing it from a legitimate loader before killing either.
13. Venue rejecting orders on SendingTime — PTP grandmaster lost, NTP fallback outside the RTS 25 tolerance, and why stepping a trading clock is worse than the drift.
14. Venue throttling us — one strategy consuming the firm's shared message rate budget; blast radius of a per-strategy pause versus the global kill switch.
15. Tick RDB will not survive to the close — a failed overnight writedown leaves the real-time database carrying two days; archive manifest checked before freeing space.
16. Futures prices move but the book is incomplete — shared A/B loss, invalid depth, snapshot-to-increment continuity and independent book reconciliation.
17. FX risk batch is green but P&L is wrong — prior-date FX fallback, approved marks, scoped revaluation and same-date reconciliation before publication.
18. Duplicate execution replay inflates positions — scoped execution identities, evidence-preserving repair, and broker-to-internal position reconciliation.
19. Allocations fail affirmation — stale settlement-instruction mapping, approved reference-data refresh, targeted retry and affirmation-state verification.
20. ARM rejected part of the transaction report — rejections clustering on one lapsed LEI behind a silently failing reference-data refresh; resubmitting the rejected subset rather than the whole file.
21. Book value halved with no trades — a mandatory split unapplied on ex-date; the vendor price is correct and the quantity is wrong, so the mark is never the thing to override.
22. Cash breaks on the USD nostro — one-sided exceptions proved to be a missing MT950 from the 28C sequence and balance continuity, not a thousand discrepancies.
23. Clients cannot connect before the open — expired gateway certificate with an approved renewal staged and never deployed; reload rather than restart, and never by weakening the link.
24. Kafka partition stops progressing — preserve the poison record, repair the consumer and replay from the approved offset without skipping trades.
25. Retry storm overloads a dependency — bound retries, recover with the same idempotency keys and verify uncertain request outcomes.
26. Deployment enters a restart loop — distinguish readiness, startup and liveness; apply an approved rollback and verify business recovery.

The original FIX flapping case is now in **FIX incidents**, with its saved progress ID preserved, alongside these six new investigations:

1. Inbound sequence gap — ResendRequest, application replay, administrative GapFill and buffered-message release.
2. Coordinated sequence reset — preserve evidence and reconcile orders, confirm bilateral approval, stop the dedicated connector, edit `ResetOnLogon` in `/etc/quickfixj/session.cfg`, verify Logon, then restore and load the normal profile. A documented JMX alternative is also modelled.
3. Heartbeats without a matching TestRequest response — correlate `112`, coordinate peer recovery and retain sequence history.
4. Healthy drop copy with missing source mapping — verify entitlements, recover the missing execution copies and reconcile quantities.
5. FIX receive checkpoint ahead of the business checkpoint — edit the application decoder configuration, restart only its consumer, and replay its durable inbox idempotently.
6. Rejected production Logon — edit the approved CompID/environment profile and load the correct SessionID's existing store, without resetting counters or reusing another identity's state.

Scenario HTTP admin endpoints, write leases and scheduler behavior are fictional training mechanisms, not generic Linux/FIX/AutoSys APIs. MQSC, `sqlplus`, `chronyc`, `pmc` and the kdb+ processes are likewise scoped simulations driven by scenario fixtures, sufficient for the diagnostic path and not a substitute for the real products.

## Accuracy and limits

Corrected behaviors include ordered stdout/stderr redirection, truncation before execution, append, quoted variables, grep flags/regex errors, awk fields/aggregates, sed printing/substitution, file copy/move, GNU find time buckets/name/size tests, truncate, ss selection and process signal handling. Regression checks also cover Java BLOCKED versus Linux D, GC versus RSS and NFS recovery using actual player commands.

This is a selected command simulator, not Linux or complete Bash. It does not implement arbitrary scripts, real background processes, network traffic, credentials, ACL/SELinux enforcement or full filesystem semantics. Resource metrics, sampling and memory availability are simplified; scenario GC reclamation percentages are fixture choices, not diagnostic thresholds. Some virtual files expose large metadata sizes with small teaching excerpts. Fixtures primarily use ASCII text.

Use `help` and `man <command>` in the game for the supported subset. Interactive editors, dig and host explicitly explain their availability; chronyc output is available on supported finance fixtures. Other command options are scoped simulations. Interview examples are labelled **reference only** and may use features outside the terminal simulator.

No finite bank covers every interview. Verify real-host syntax, distribution/JDK behavior and counterparty specifications. Production changes follow the firm's runbooks, access controls, evidence retention and business reconciliation requirements.

## Verification

`node test/run.js` runs eleven suites. `npm test` calls the same runner when npm is available. `npm run test:fix` runs the FIX-specific recovery and negative-path checks.

The suites cover scenario recovery, drill solution evidence, shell accuracy, system/network accuracy and browser wiring/interview interaction. The drill checks confirm answers appear in solution output; they cannot independently prove every explanation or possible command combination. Real-browser smoke checks cover rendering, search, command execution and answer progression.

## Extending

See [Adding scenarios](docs/ADDING-SCENARIOS.md). Add drill files under `js/drills/` and their script tags in `index.html`. Interview questions are in `js/interview-data.js`; screen counts are calculated from the data. Update the coverage guide and rerun checks after changes.

This remains a dependency-free game. The included Dockerfile runs the same server used locally and is suitable for a Render Web Service.
