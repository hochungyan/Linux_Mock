# Linux support interview coverage

**186 terminal/evidence questions, 160 interview questions, six incidents.** The interview track offers topic/search/confidence filters and mock interviews of up to 20 distinct matching questions.

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

## Practice boundaries

**Executable:** the 14 packs and six scenarios use the simulator's command subset against shared synthetic state. Some conceptual tasks ask learners to read supplied notes; they do not emulate ACL enforcement, TLS or a live FIX peer.

**Reference:** interview examples may use real Linux features outside the simulator, including full scripts, null-delimited find/xargs, advanced journal filters, TLS, cgroups, SSH/rsync and profiling. Examples are displayed, not run.

**Limits:** no bank covers every firm's interview. Product-specific SQL/middleware administration, exchange rules and counterparty dictionaries need separate documentation and practical experience. Low-latency tuning is a diagnosis topic, not a universal prescription.

## Verification

Run `node test/run.js` for five suites: scenario recovery, drill evidence, shell behavior, system/network behavior and browser/interview transitions. Assertions test implementation, not every explanatory fact.

The NFS recovery uses documented player commands: scheduler termination does not remove the D-state process. A fictional approved DBA fence prevents late original commits before DR starts. Tests no longer remove the process behind the player's back.

