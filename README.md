# SEV1 — Linux Production Support Simulator

Linux interview preparation for investment bank and hedge fund production support / application support.

**186 practical questions in 14 packs, 160 interview questions across 22 topics, and six incident investigations.**

## Run

Double-click `start.bat`, or run `node serve.js` and open [the local game](http://localhost:8099/). No dependencies or build step are required. Opening `index.html` directly also works; browser policy determines whether progress can be saved on a file URL.

## Three tracks

- **Terminal drills:** inspect a simulated host and submit `answer <value>`. Use `task`, `task N`, `hint`, `solution`, `skip` and `finish`. Correct answers show a command and its interpretation. Some conceptual tasks use supplied reference notes.
- **Incident investigations:** gather findings, use `diagnose`, then restore the machine through commands. Recovery quality affects the score.
- **Interview practice:** search/filter by topic or confidence, explain your answer, reveal the guide and rate your confidence. Mock interviews select up to 20 distinct matching questions. These are self-assessments, not automatically graded exam scores. Ratings stay in this browser; scratch notes clear on changing questions.

Start with a drill, explain the topic aloud, then investigate a P1.

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

Scenario HTTP admin endpoints, write leases and scheduler behavior are fictional training mechanisms, not generic Linux/FIX/AutoSys APIs.

## Accuracy and limits

Corrected behaviors include ordered stdout/stderr redirection, truncation before execution, append, quoted variables, grep flags/regex errors, awk fields/aggregates, sed printing/substitution, file copy/move, GNU find time buckets/name/size tests, truncate, ss selection and process signal handling. Regression checks also cover Java BLOCKED versus Linux D, GC versus RSS and NFS recovery using actual player commands.

This is a selected command simulator, not Linux or complete Bash. It does not implement arbitrary scripts, real background processes, network traffic, credentials, ACL/SELinux enforcement or full filesystem semantics. Resource metrics, sampling and memory availability are simplified; scenario GC reclamation percentages are fixture choices, not diagnostic thresholds. Some virtual files expose large metadata sizes with small teaching excerpts. Fixtures primarily use ASCII text.

Use `help` and `man <command>` in the game for the supported subset. Interactive editors, dig, host and chronyc explicitly explain their availability. Other command options are scoped simulations. Interview examples are labelled **reference only** and may use features outside the terminal simulator.

No finite bank covers every interview. Verify real-host syntax, distribution/JDK behavior and counterparty specifications. Production changes follow the firm's runbooks, access controls, evidence retention and business reconciliation requirements.

## Verification

`node test/run.js` runs five suites. `npm test` calls the same runner when npm is available.

The suites cover scenario recovery, drill solution evidence, shell accuracy, system/network accuracy and browser wiring/interview interaction. The drill checks confirm answers appear in solution output; they cannot independently prove every explanation or possible command combination. Real-browser smoke checks cover rendering, search, command execution and answer progression.

## Extending

See [Adding scenarios](docs/ADDING-SCENARIOS.md). Add drill files under `js/drills/` and their script tags in `index.html`. Interview questions are in `js/interview-data.js`; screen counts are calculated from the data. Update the coverage guide and rerun checks after changes.

This remains a local, dependency-free game; no hosting deployment was performed.

