# Linux support interview coverage

**186 terminal/evidence questions, 160 interview questions, 32 incidents (25 general and 7 FIX), and 520 vocabulary entries in 19 sections.** The Matrix-themed game opens on trading and post-trade investigations, with FIX incidents in the adjacent tab. The interview track offers topic/search/confidence filters and mock interviews of up to 20 distinct matching questions. The vocabulary track is a searchable product, market and FIX reference rather than an exercise.

## Finance investigations

The added cases cover execution replay and position reconciliation, allocation/standing-settlement-instruction exceptions, futures book recovery after A/B loss, and stale FX valuation inputs. Each requires evidence gathering, scoped recovery and business verification; a running process or successful job is insufficient. Primary sources and simulation boundaries are recorded in [Finance research](FINANCE-RESEARCH.md) and linked in new case debriefs.

## FIX and platform investigations

The dedicated FIX tab covers inbound ResendRequest recovery, administrative gap fills versus full resets, explicitly agreed resets to 1, TestRequest/Heartbeat ID correlation, source-session mapping and drop-copy completeness, downstream inbox/application checkpoint lag, and CompID/environment Logon rejection. All seven cases require preservation, scoped approval, repair and post-resume verification; the original flapping case retains its saved ID. Configuration exercises distinguish disk edits from loaded settings and session counters. See [FIX research and simulation boundaries](FIX-RESEARCH.md).

General coverage also includes Kafka poison records and offset recovery, retry storms with idempotency, and deployment startup/readiness/liveness failures. The finance cases include MQ, DB locks, clock synchronization, throttling, kdb+, reporting, corporate actions, cash statements and TLS alongside trading and valuation recovery.

## Requested command examples

| Request | Example | Meaning |
|---|---|---|
| TCP listeners | `ss -nptl` | Numeric, process, TCP, listening; same selection as -tlnp |
| All UDP sockets | `ss -uanp` | Includes unconnected bound receivers |
| Ignore case | `grep -in -- error app.log` | Case-insensitive search with line numbers |
| Extract fields | `awk '{print $1, $3}' app.log` | Whitespace-delimited fields |
| Transform a copy | `sed 's/old/new/g' config > config.new` | Review output before applying |
| Save output | `grep -i error app.log > errors.txt` | Overwrites destination; keep source and destination different |
| Append output | `grep -i warn app.log >> errors.txt` | Appends stdout |
| Both streams | `command > output.log 2>&1` | Left-to-right descriptor order matters |
| Move a file | `mv errors.txt archive/` | Move a pathname, not capture command output |
| “transcat” | `truncate -s 0 scratch.log` | Interpreted as truncate; cat displays content |
| Last 30 days | `find /var/log/app -type f -mtime -30` | Modification age below thirty 24-hour periods |
| Last 30 minutes | `find /var/log/app -type f -mmin -30` | Minute units |
| Older day buckets | `find /var/log/app -type f -mtime +30` | Rounded age greater than 30: starts at 31 days |

Definitions: [Bash redirections](https://www.gnu.org/software/bash/manual/html_node/Redirections.html), [GNU find age ranges](https://www.gnu.org/software/findutils/manual/html_node/find_html/Age-Ranges.html), [GNU grep](https://www.gnu.org/software/grep/manual/html_node/Matching-Control.html), [ss manual](https://man7.org/linux/man-pages/man8/ss.8.html).

## Interview syllabus

| Topic | Questions | Coverage |
|---|---:|---|
| Linux foundations | 6 | Paths, hierarchy, links, vi, boot, binaries, transfer |
| Shell scripting | 6 | Shebang, parameters, conditions, loops, traps, portability |
| Shell, pipes and redirection | 9 | Descriptors, tee, pipefail, quoting, variables, xargs |
| Log searching and grep | 9 | Flags, literal/regex, counts, context, rotation, correlation |
| awk, sed and text | 8 | Fields, sums, ranges, substitutions, sorting, diff/comm/jq |
| Files, timestamps and archives | 8 | mtime/mmin, ctime, size, truncate, archives/checksums |
| Permissions and secure access | 7 | Modes, directories, deletion rights, umask, ACLs, SSH |
| Processes, signals and jobs | 7 | PID/PPID, states, signals, zombies, nohup, limits |
| CPU, load and latency | 8 | Load/CPU, iowait, steal, vmstat, threads, affinity |
| Memory, swap and OOM | 7 | Available, RSS/VSZ/PSS, faults, leaks, overcommit, NUMA |
| Disk, I/O and NFS | 7 | df/du, inodes, deleted files, await, sparse files, mounts |
| TCP sockets | 8 | ss flags, handshake, states, queues, retransmission, ports |
| UDP and multicast | 7 | Datagrams, drops, buffers, joins, captures, stale data |
| IP, DNS and firewalls | 8 | CIDR, routes, /31, NSS, ICMP, MTU, bind addresses |
| HTTP and TLS | 5 | SNI, chain/hostname checks, expiry, HTTP/curl status |
| systemd and deployments | 6 | Startup, active/enabled, reload, journals, rollback |
| Batch and file delivery | 7 | Cron, environment, overlap, reruns, dependencies, completeness |
| Time and market cutoffs | 5 | NTP/PTP, synchronization, monotonic time, DST/business date |
| JVM diagnostics | 6 | Heap/native memory, OOME, GC, dumps, overhead |
| FIX sessions and recovery | 10 | Tags, heartbeat, gaps, resets, duplicates, order lifecycle |
| Containers and advanced diagnosis | 6 | Cgroup limits, namespaces, strace/perf, stalled work |
| Trading support scenarios | 10 | P1, market data, latency, capture, DB/queues, DR, RCA |

Topic sources appear under answer guides: GNU, Linux command/kernel documentation, systemd, Oracle Java, chrony, OpenSSL, curl and FIX Trading Community specifications.

## Product and FIX vocabulary syllabus

The vocabulary track answers the other half of an application-support interview: the business the systems exist for. Every definition is paired with what it means when the thing fails, and each section closes with rapid-fire answers.

| Section | Entries | Coverage |
|---|---:|---|
| The desk map | 20 | Sell/buy side, FICC, equities, Delta One, flow vs exotics, capacity, prime brokerage, asset-class-to-system map |
| Trade lifecycle end to end | 22 | Order, execution, allocation, affirmation, clearing, settlement, custody, nostro, recon, T+1/T+2, SSI, SOD/EOD, cutoffs |
| Cash equities and corporate actions | 20 | ADR/ETF, venues and auctions, short selling and borrow, dividends, splits, rights, mergers, ex/record/pay dates, claims |
| Equity derivatives | 23 | Listed and OTC options, index and single-stock futures, TRS, CFD, swap resets, variance and dividend swaps, convertibles, autocallables, barriers, the five valuation inputs |
| Forwards, futures and margin | 38 | Full forward/future comparison, notional, tick value, IM/VM, CCP novation, open interest, roll, FND, basis, cost of carry, contango, forward pricing relationships |
| Options and Greeks | 23 | Call/put, exercise style, exercise vs assignment, physical vs cash settlement, moneyness, implied vol, skew, put-call parity, delta/gamma/vega/theta/rho and the input behind each |
| Rates | 28 | Bond static, clean/dirty, accrued, duration, DV01, convexity, CTD; IRS, OIS, fixings, RFR transition, FRA, basis swaps, swaptions, curves, day counts, calendars |
| Credit derivatives | 11 | CDS mechanics, running coupon and upfront, recovery, credit events, CDX/iTraxx, index rolls, succession |
| FX and money markets | 22 | Spot and value dates, forward points, FX swaps, NDFs and fixings, cross-currency, FX options and cuts, CLS/PvP; repo, haircuts, GC vs special, securities lending |
| Commodities | 9 | Physical vs financial settlement, benchmark grades, first notice day, warehouse receipts, loco and allocation, EFP, roll yield |
| Collateral, margin and financing | 11 | CSA and ISDA master, thresholds, tri-party, margin disputes, SIMM, eligibility and haircuts, margin call files |
| Valuation, PnL and risk | 26 | Marks and snap times, mark-to-model, IPV, XVA, realised vs unrealised, PnL explain, VaR, stress, limits, position keeping, plus a symptom-to-first-check table |
| Regulation and reporting | 21 | MiFID II/MiFIR, RTS 25 and RTS 6, EMIR, SFTR, Dodd-Frank, CAT, APA/ARM, CSDR, surveillance; ISIN, CUSIP/SEDOL, LEI, UTI/UPI, MIC, CFI |
| Systems, data and support surface | 24 | OMS/EMS/SOR, algo containers, FIX gateways, feed handlers, kdb+, trade capture, position keeper, risk engine, reference data, recon, SWIFT, message bus, schedulers |
| FIX: framing and session layer | 37 | tag=value and SOH, session vs application layer, dictionaries, repeating groups, versions and FIXT, the seven administrative messages, gap handling, stores, worked logon/heartbeat/resend traces |
| FIX: tags you must know cold | 65 | Header and trailer, order and execution identity, state and quantities, order instructions, instrument identity, venue/timing/post-trade |
| FIX: message types and enumerations | 72 | Application MsgTypes, OrdStatus, ExecType, session/business/order/cancel reject codes, worked new-order, replace-chain and cancel-reject sequences |
| FIX in production | 33 | Symptom-cause-evidence table, evidence discipline, QuickFIX/J configuration vocabulary, Linux commands for reading FIX logs with the SOH delimiter |
| Rapid-fire interview answers | 15 | Product one-liners, support judgement, escalation and handover, and the crossover questions where Linux incidents meet product knowledge |

Vocabulary sources link to FIX Trading Community, ISDA, CME/Eurex/LME, ESMA/FCA, DTCC, SWIFT, CLS, BIS and vendor documentation. Definitions are training summaries of general market practice; contract terms, venue rules and FIX dictionaries vary by counterparty and firm.

## Practice boundaries

**Executable:** the 14 packs and 32 scenarios use the simulator's command subset against shared synthetic state. Some conceptual tasks ask learners to read supplied notes; they do not emulate full ACL enforcement, a TLS stack or a live FIX peer. FIX logs are abbreviated decoded extracts, not valid wire messages. Linux commands inspect and edit files; the Operational decisions panel separately models documented QuickFIX/J JMX operations and external coordination. Configuration changes take effect on the relevant service start, not simply when a file is edited.

**Reference:** the vocabulary track is documentation, not an exercise: nothing in it is executed or graded, and it states general market practice rather than any one venue or firm. Interview examples may use real Linux features outside the simulator, including full scripts, null-delimited find/xargs, advanced journal filters, TLS, cgroups, SSH/rsync and profiling. Examples are displayed, not run.

**Limits:** no bank covers every firm's interview. Product-specific SQL/middleware administration, exchange rules and counterparty dictionaries need separate documentation and practical experience. Low-latency tuning is a diagnosis topic, not a universal prescription.

## Verification

Run `node test/run.js` for twelve suites covering scenario recovery, drill evidence, shell behavior, system/network behavior, vocabulary structure and FIX-tag coverage, and browser/interview/vocabulary transitions. Dedicated FIX and distributed-platform suites include negative-path and business-outcome tests. Assertions test implementation, not every explanatory fact.

The NFS recovery uses documented player commands: scheduler termination does not remove the D-state process. A fictional approved DBA fence prevents late original commits before DR starts. Tests no longer remove the process behind the player's back.
