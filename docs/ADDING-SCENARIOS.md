# Adding content

There are two kinds. **Incidents** live in `js/scenarios/` and are covered by
most of this document. **Drills** live in `js/drills/` and are much cheaper to
write — jump to [Adding a drill](#adding-a-drill) at the end.

Both use the same world model, so read the world section either way.

---

# Adding an incident

One incident = one file in `js/scenarios/` + one `<script>` tag in `index.html`.

The core idea: **you describe a broken machine, not broken command output.**
Every command reads from the world object, so if you put 178 GB into a
deleted-but-open file, `df` reports it as used and `du` cannot find it — with
no special-casing anywhere. Build the state correctly and the diagnosis works
by itself.

---

## 1. Start from the template

Copy `docs/scenario-template.js` into `js/scenarios/your-incident.js` and fill
it in. Then add, before `js/terminal.js` in `index.html`:

```html
<script src="js/scenarios/your-incident.js"></script>
```

Order matters: scenarios must load after `js/world.js` and before
`js/terminal.js`.

---

## 2. The world object

`PS.world.create({...})` takes these. Anything you leave out gets a sane
default; anything extra you add is preserved, so scenario-specific fields are
fine.

### Machine

| field | meaning |
|---|---|
| `host`, `user`, `home`, `cwd` | identity and starting directory |
| `clock` | a `Date` — the incident's wall clock, and what `date` reports |
| `cores`, `model`, `kernel`, `os` | what `lscpu` / `uname -a` report |
| `bootSeconds`, `users`, `load` | `uptime` and the `top` header |
| `mem` | `{total, free, buffers, cached, shared}` in bytes |
| `swap` | `{total, used, si, so}` |
| `cpu` | `{us, sy, ni, id, wa, st}` percentages |
| `seed` | makes the jitter in `vmstat` / `ping` reproducible |

### Storage

```js
filesystems: [
  { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs',
    size: 200 * GB, used: 199.4 * GB,
    inodes: { total: 104857600, used: 288401 } }
]
```

`df` reads this array — these are superblock counters. `du` walks `root`
instead. **That gap is a diagnostic tool, not a bug.** Make them agree unless
you want them not to.

```js
deleted: [{ pid: 8841, fd: 7, cmd: 'java', user: 'tcapadm',
            path: '/var/log/app.log.old', size: 178 * GB, mount: '/var' }]
```

Unlinked but still open. `lsof +L1` lists these; `> /proc/8841/fd/7` and
`truncate -s 0 /proc/8841/fd/7` release the blocks and call your `onTruncate`.

### The filesystem tree

```js
const { dir, file } = PS.vfs;

root: dir({
  var: dir({
    log: dir({
      'app.log': file('...contents...', {
        owner: 'appadm', group: 'appadm',
        mtime: someDate,
        size: 6 * GB        // apparent size; omit to use content length
      })
    })
  })
})
```

`size` lets a file be huge for `ls -l` / `du` while holding only the few lines
you want a player to read. `content` may also be a `function(world)` for output
that changes as the incident runs.

### Processes and threads

```js
W.proc({
  pid: 6120, ppid: 1, user: 'mdadm',
  cmd: '/usr/java/.../java -Xmx16g -jar /apps/mdgw/lib/mdgw.jar',
  short: 'java',                  // the COMMAND column in top
  state: 'S',                     // R S D Z T   (D defeats kill -9)
  cpu: 3.1,                       // percent of ONE core, like top
  rss: 17 * GB, started: aDate, cpuSeconds: 6240,
  wchan: 'rpc_wait_bit_killable', // shown by ps -o wchan
  fds: [{ fd: 1, path: '/var/log/mdgw/app.log', mode: 'w', size: 1420 * MB }],
  jvm: { /* see below */ },
  threads: [ W.thread({...}) ]
})
```

```js
W.thread({
  tid: 6145,                       // decimal; jstack prints hex as nid=0x...
  name: 'md-dispatch-1',
  state: 'BLOCKED',                // RUNNABLE BLOCKED WAITING TIMED_WAITING
  cpu: 0, cpuSeconds: 4102,
  stack: [
    'com.ib.mdgw.publish.TickPublisher.publish(TickPublisher.java:148)',
    '- waiting to lock <0x00000006c1044f28> (a com.ib.mdgw.ref.InstrumentCache)',
    'java.lang.Thread.run(Thread.java:750)'
  ]
})
```

Stack entries starting with `-` are rendered as monitor lines, not `at` frames.
To build a lock-contention puzzle, give the blocked threads
`- waiting to lock <0xADDR>` and the holder `- locked <0xADDR>` with the same
address. `top -H -p <pid>` and `jstack <pid>` are generated from the same array,
so the TID→hex→`nid` workflow works automatically.

JVM block:

```js
jvm: {
  name: 'mdgw.jar', mainClass: 'com.ib.mdgw.Gateway',
  heapMax: 16 * GB, heapUsed: 3.4 * GB,
  leak: true,                    // GC.run then reclaims ~3% instead of ~65%
  old: { max: 88 * GB, used: 87.7 * GB },
  stdoutLog: '/var/log/mdgw/app.log',   // where kill -3 writes the dump
  gcStats: { ygc: 12904, ygct: 241.1, fgc: 0, fgct: 0, old: 21.4, eden: 32.8 },
  histo: [{ instances: 412008841, bytes: 42120088412, cls: 'com.ib.Key' }]
}
```

### Network

```js
sockets: [
  { pid: 6120, fd: 14, proto: 'udp', local: '233.71.14.20:14310',
    state: 'UNCONN', recvq: 212992, sendq: 0 },
  { pid: 6120, fd: 28, proto: 'tcp', local: '10.14.22.62:44118',
    peer: '10.14.40.11:1521', state: 'ESTABLISHED' }
]
```

A large static `recvq` is how you say "the kernel has the data, the application
is not reading it". `CLOSE_WAIT` and `TIME_WAIT` render in red.

```js
netstat: { udpReceived: 8841200412, udpErrors: 1840221, udpRcvbufErrors: 1840221 }
interfaces: [{ name: 'eth1', addr: '10.14.90.62/24', rxOk: ..., rxDrop: 0,
               mcast: ..., groups: [{ addr: '233.71.14.20', refcnt: 1 }] }]
hosts: { 'refdata-db-ldn': { ip: '10.14.40.11', unreachable: true, ports: [] },
         'refdata-db-fra': { ip: '10.61.40.11', ports: [1521], rtt: 12.4 } }
http: { 'localhost:9911/admin/health': world => JSON.stringify({...}) }
```

`hosts` drives `ping` / `telnet` / `nc` / `traceroute`. `http` drives `curl` —
the key is matched as a substring of the URL, and the handler may mutate the
world, which is how an admin endpoint becomes a remediation action.

### Other

- `services: { mdgw: { active: true, pid: 6120, desc: '...', requiresRoot: false } }` — `systemctl`
- `jobs: [{ name, status: 'RU', lastStart, condition, command, note }]` — `autorep` / `sendevent`
- `dmesg: [{ time: aDate, text: 'nfs: server nas-ldn-01 not responding' }]`
- `diskio: [{ dev: 'dm-3', rs, ws, readKB, writeKB, await, util, queue }]` — `iostat -x`
- `ntp: { peers: [...] }` — `ntpq -p`
- `hungPaths: ['/mnt/eodshare']` — **any command touching these hangs until Ctrl+C**
- `limits: { nofile: 65536, nproc: 8192 }` — `ulimit -a`

### Hooks

```js
tick: function (world, seconds) { /* called every second - let it get worse */ },
onKill:      function (world, proc, signal) {},
onService:   function (world, verb, unit, svc) { return true; },  // true = handled
onTruncate:  function (world, deletedEntry) {},
onSendevent: function (world, event, job, status) { return 'message'; }
```

Return a truthy value from `onService` / `onSendevent` to take over the default
behaviour.

---

## 3. Findings

```js
discoveries: [
  { id: 'recvq-full',
    label: 'UDP receive queue is full - the app is not draining the socket',
    when: o => /\b(ss|netstat)\b/.test(o.cmd) && /212992/.test(o.out) },

  { id: 'inodes-ok', label: 'Ruled out inode exhaustion',
    optional: true,            // does not count toward the required total
    when: o => /\bdf\b.*-\w*i/.test(o.cmd) }
]
```

`when` receives `{cmd, out, code, world}` after every command. `out` is already
colour-stripped and includes stdout and stderr. Worth +60 each.

Two rules that keep these honest:

- **Match on evidence, not on the command.** `/BLOCKED/.test(o.out) && /InstrumentCache/.test(o.out)` is good; `/jstack/.test(o.cmd)` is not — it rewards typing, not noticing.
- **Accept every reasonable route.** If `ss`, `netstat` and a `curl` to the admin port all reveal the same fact, match all three. Players should not have to guess your preferred tool.

Labels are **redacted in the panel until discovered**, so they can be explicit.

---

## 4. Root causes

```js
rootCauses: [
  { text: 'The exchange stopped publishing...' },
  { text: 'A reference-data refresh is hung...', correct: true },
  { text: 'The NIC ring buffer is too small...' }
]
```

Exactly one `correct: true` (the test suite enforces this). Write the wrong
options as things an experienced person would genuinely consider — ideally each
one is what you would conclude if you stopped investigating one step early.

---

## 5. The fix

```js
fix: {
  prompt: 'Get prices flowing again, and preserve the evidence.',

  // Is the machine actually healed? Any route that achieves this wins.
  check: world => world.flags.fixed === true,

  // How much damage did that route cause?
  grade: function (world) {
    if (world.flags.killed)    return { quality: 'blunt', bonus: -150, note: '...' };
    if (world.flags.restarted) return { quality: 'blunt', bonus: 0,    note: '...' };
    return { quality: 'clean', bonus: 300, note: '...' };
  }
}
```

This split is what makes the game teach rather than test. Let the crude fix
work — then explain in `note` what it cost and what the clean one would have
been. `note` is shown in the debrief, so write it as feedback from a senior.

Set your flags from the hooks (`onService`, `onKill`, `onTruncate`) or from a
`curl` handler.

---

## 6. Hints and debrief

`hints` is an array of 3–4 strings, revealed in order, costing 75/125/175/200.
Escalate deliberately: the first should reframe the problem, the last can name
the command.

`debrief` is the payoff — shown in full when the incident closes. The house
style is four blocks: **WHY IT HAPPENED**, the **command sequence** to
memorise, the **trap or trade-off**, and the **INTERVIEW ANGLE**. Keep lines
under ~78 characters; it renders pre-wrapped.

---

## 7. Test it

```
npm test
```

The cross-scenario section picks up new files automatically and checks the
contract (one correct cause, hints present, debrief present, world does not
start fixed, standard diagnostics run without throwing).

Then add a walkthrough of your own next to the others in
`test/engine.test.js` — drive it exactly as a player would, assert the findings
fire, and assert that each alternative fix route gets the grade you intended.
That is the cheapest way to catch a scenario that cannot actually be solved.

---

---

# Adding a drill

A drill is one file in `js/drills/` plus a `<script>` tag. It reuses the same
`build()` world, but instead of findings/causes/fix it just has `tasks`.

```js
PS.drills.push({
  id: 'inode-basics',
  title: 'Inodes and disk space',
  topic: 'df · du · find',
  host: 'ldn-app-prod20',
  tags: ['df -i', 'du -sh', 'find -size'],
  brief: 'Two or three lines setting the scene. Nothing is broken.',

  build: function () { /* exactly as for an incident */ },

  tasks: [
    {
      short: 'Fullest filesystem',        // <=32 chars, shown in the side panel
      ask: 'Which mount point is the fullest, by percentage used?',
      note: 'Optional second line of clarification.',
      answer: '/var',                     // or answers: ['/var', 'var']
      hint: 'df -h prints a Use% column.',
      solution: 'df -h',
      teaches: 'One line on the thing people get wrong about this command.'
    }
  ],

  wrapUp: 'The command sheet shown at the end, as free text.'
});
```

**The one hard rule**, enforced by `test/drills.test.js`: running the task's own
`solution` against the task's own world must produce output containing the
expected answer. If it does not, the drill is teaching a wrong answer and the
test fails. Run `npm run test:drills` after every edit.

Answer matching is forgiving — trimmed, lowercased, commas and surrounding
quotes stripped. Use `answers: [...]` for aliases (`'eth1'`, `'ETH1'`) and
`accept: function (input, world, norm) { ... }` for anything cleverer.

Writing good tasks:

- **The answer must be readable off the screen.** "How many ERROR lines" is a
  good task; "why is it slow" is an incident, not a drill.
- **Avoid ambiguity.** If two sockets are both on port 14310, "which group is on
  14310" has two answers. Change the world, not the wording.
- **`teaches` is the whole point.** Not what the command does — what people get
  wrong. `grep -c` counts lines not matches; `ss` prints `ESTAB` not
  `ESTABLISHED`; `available` is not `free`.
- **Keep `short` under ~32 characters** so the side panel does not wrap.

---

## Ideas worth building

Drawn from the same interview and incident material as the existing six:

- **Inode exhaustion** — `df` shows space free, writes still fail with ENOSPC; `df -i` is at 100% from millions of tiny tick files.
- **Too many open files** — `java.net.SocketException: Too many open files`; `lsof -p | wc -l` against `ulimit -n`, leaked descriptors from an un-closed pool.
- **Connection pool exhausted** — threads `BLOCKED` in `getConnection`, a pile of `CLOSE_WAIT` sockets to a database that recycled.
- **Clock drift** — exchange rejects orders with "SendingTime accuracy problem"; `ntpq -p` shows the peer unreachable and a 4-second offset.
- **Certificate expired at the open** — TLS handshake failures at 08:00, `openssl s_client` / cert dates.
- **Runaway `find` from cron** — `iostat -x` at 100% util, `await` in the hundreds, everything slow but nothing broken.
- **Full `/tmp` breaking a different app** — the cause and the symptom are on different filesystems and different teams.
- **Multicast gap on line A only** — arbitrating A/B feeds; the fix is to fail the consumer to line B, not to restart it.

And for the Basics track:

- **Processes and signals** — `ps -ef` vs `ps aux`, parent/child trees, `kill -15` vs `-9`, zombies, `nohup`.
- **Disk and inodes** — `df -h` vs `df -i` vs `du -sh`, `find -size +100M`, what `ls -lSh` is for.
- **Permissions** — reading `-rw-r-----`, octal modes, why the app cannot write its own log.
- **CPU and load** — what load average actually measures, `%CPU` per core, `top -H`, `vmstat` columns.
- **DNS and routing** — `/etc/hosts` vs resolver order, `ip route`, why `ping` works and `telnet` does not.
