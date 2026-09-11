/* BASICS: CPU and load average.
 *
 * The central idea, and the one most often got wrong in interviews: load
 * average is not CPU usage. It counts everything waiting to run AND everything
 * stuck in uninterruptible I/O, which is why a box can show load 8 and 90% idle
 * at the same time.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  var NOTES =
    'CPU AND LOAD AVERAGE\n' +
    '====================\n' +
    'LOAD AVERAGE is not CPU usage. It counts tasks (including threads) that are\n' +
    'either running, waiting for a CPU, or blocked in uninterruptible I/O\n' +
    '(state D), as exponentially smoothed 1, 5 and 15 minute averages.\n' +
    '\n' +
    '  uptime  ->  load average: 8.12, 6.40, 4.20\n' +
    '                            1min  5min  15min\n' +
    '\n' +
    '  If the 1-minute figure is HIGHER than the 15-minute figure the load is\n' +
    '  recently higher; this suggests rising load, not proof of the current trend.\n' +
    '\n' +
    '  Compare load against the CORE COUNT, never against a fixed number.\n' +
    '  Compare runnable demand with usable CPUs and quotas; D-state waits can\n' +
    '  raise load without saturating CPU. Sample r and per-CPU use as well.\n' +
    '\n' +
    'A process in state D counts toward load while using no CPU at all. That is\n' +
    'how you get load 8 on a box that is 90% idle - the answer is storage or\n' +
    'NFS, not CPU.\n' +
    '\n' +
    'READING THE CPU BREAKDOWN\n' +
    '  %usr sustained high        inspect per-core use, run queues and code.\n' +
    '  %iowait high               clue to I/O waits, not proof of disk saturation.\n' +
    '                             Correlate iostat latency/queues and blocked tasks.\n' +
    '  %sys high, %usr modest     kernel overhead - syscalls, context switches,\n' +
    '                             security agents, driver problems.\n' +
    '  %steal non-zero            a hypervisor is taking time from this VM.\n' +
    '\n' +
    'WHICH TOOL, WHEN\n' +
    '  uptime          load right now, and the trend\n' +
    '  top             what is happening at this moment, per process\n' +
    '  top -H -p PID   per THREAD inside one process\n' +
    '  mpstat -P ALL   is the load spread across cores, or is one core pinned\n' +
    '  vmstat 1 5      run queue (r), blocked (b), context switches (cs)\n' +
    '  pidstat -w      context switches per process\n' +
    '  sar -u          what the CPU was doing EARLIER today, after the fact\n' +
    '\n' +
    'top in its usual Irix mode reports %CPU per logical CPU (mode can change).\n' +
    'A figure above 100% means the process is using more than one core: 780%\n' +
    'is roughly 7.8 cores busy.\n' +
    '\n' +
    'NICE ranges -20 (most favoured) to 19 (least). Batch work is usually\n' +
    'started with a positive nice value so it yields to interactive work.\n';

  PS.drills.push({
    id: 'cpu-load-basics',
    title: 'CPU and load average',
    topic: 'uptime · top · mpstat · vmstat',
    host: 'ldn-calc-prod03',
    tags: ['load average', 'mpstat -P ALL', '%iowait', 'top -H', 'nice'],

    brief:
      'An eight-core calculation box under real load.\n\n' +
      'Twelve questions on telling CPU pressure apart from I/O pressure, and on\n' +
      'reading the numbers the way they are actually defined.\n\n' +
      'Background reading is in /home/gsupport/cpu-notes.txt.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 16, 18, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var root = V.dir({
        apps: V.dir({
          calc: V.dir({
            bin: V.dir({
              'run_calc.sh': V.file('#!/bin/bash\nexec java -Xmx24g -jar /apps/calc/lib/calc.jar\n',
                { mode: '-rwxr-xr-x', owner: 'calcadm', size: 74, mtime: ago(500000) })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            calc: V.dir({
              'calc.log': V.file(
                '2026-09-11 16:17:02 INFO  [pool-1] Engine - 412 of 2841 scenarios complete\n' +
                '2026-09-11 16:17:44 WARN  [pool-1] Engine - scenario write took 8.2s (disk)',
                { owner: 'calcadm', mtime: ago(16), size: 180 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'cpu-notes.txt': V.file(NOTES, { owner: 'gsupport', mtime: ago(400000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        mnt: V.dir({ scratch: V.dir({}, { owner: 'root', mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      // one core pinned, the rest moderately busy - the machine-wide average
      // hides the fact that core 3 has no headroom left at all
      var percore = [
        { us: 58.0, sy: 3.0, wa: 24.0, id: 15.0 },
        { us: 61.0, sy: 4.0, wa: 22.0, id: 13.0 },
        { us: 55.0, sy: 3.0, wa: 28.0, id: 14.0 },
        { us: 99.0, sy: 1.0, wa: 0.0, id: 0.0 },
        { us: 60.0, sy: 4.0, wa: 26.0, id: 10.0 },
        { us: 57.0, sy: 3.0, wa: 30.0, id: 10.0 },
        { us: 62.0, sy: 5.0, wa: 21.0, id: 12.0 },
        { us: 44.0, sy: 3.0, wa: 25.0, id: 28.0 }
      ];

      return W.create({
        host: 'ldn-calc-prod03', user: 'gsupport', clock: t0, seed: 812,
        bootSeconds: 3600 * 24 * 27, cores: 8, users: 3,
        // 1min well above 15min: the load is rising
        load: [8.12, 6.40, 4.20],
        mem: { total: 64 * GB, free: 22 * GB, buffers: 300 * MB, cached: 12 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 62.0, sy: 3.2, ni: 0, id: 12.8, wa: 22.0, st: 0 },
        percore: percore,
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 14 * GB, inodes: { total: 26214400, used: 190402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 44 * GB, inodes: { total: 104857600, used: 41208 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.4 * GB, inodes: { total: 10485760, used: 1024 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 400 }),
          W.proc({ pid: 1618, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 22 }),
          // 480% plus the 42% batch fits the machine's 65.25% CPU use on 8 CPUs.
          W.proc({ pid: 6402, user: 'calcadm', short: 'java', state: 'R', cpu: 480.0, rss: 26 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms24g -Xmx24g -jar /apps/calc/lib/calc.jar',
            started: new Date(2026, 8, 11, 14, 2, 0), cpuSeconds: 41200,
            threads: [
              W.thread({ tid: 6410, name: 'main', state: 'WAITING', cpu: 0, cpuSeconds: 4 }),
              W.thread({ tid: 6421, name: 'calc-pool-1', state: 'RUNNABLE', cpu: 99.2, cpuSeconds: 5120 }),
              W.thread({ tid: 6422, name: 'calc-pool-2', state: 'RUNNABLE', cpu: 98.8, cpuSeconds: 5104 }),
              W.thread({ tid: 6423, name: 'calc-pool-3', state: 'RUNNABLE', cpu: 98.1, cpuSeconds: 5088 }),
              W.thread({ tid: 6424, name: 'calc-pool-4', state: 'RUNNABLE', cpu: 97.4, cpuSeconds: 5072 })
            ] }),
          // nice 10: deliberately deprioritised batch work
          W.proc({ pid: 7710, user: 'batchadm', short: 'batch_extract', state: 'R', cpu: 42.0, rss: 2 * GB,
            nice: 10, pri: 30,
            cmd: '/apps/batch/bin/batch_extract.sh --date 20260911',
            started: new Date(2026, 8, 11, 16, 0, 0), cpuSeconds: 420 }),
          // three processes blocked on slow storage: they add 3 to load and use no CPU
          W.proc({ pid: 8102, user: 'calcadm', short: 'scenario_wri', state: 'D', cpu: 0, rss: 400 * MB,
            cmd: '/apps/calc/bin/scenario_writer --out /mnt/scratch/run812', wchan: 'io_schedule',
            started: new Date(2026, 8, 11, 16, 10, 0), cpuSeconds: 8 }),
          W.proc({ pid: 8103, user: 'calcadm', short: 'scenario_wri', state: 'D', cpu: 0, rss: 400 * MB,
            cmd: '/apps/calc/bin/scenario_writer --out /mnt/scratch/run813', wchan: 'io_schedule',
            started: new Date(2026, 8, 11, 16, 10, 2), cpuSeconds: 7 }),
          W.proc({ pid: 8104, user: 'calcadm', short: 'scenario_wri', state: 'D', cpu: 0, rss: 400 * MB,
            cmd: '/apps/calc/bin/scenario_writer --out /mnt/scratch/run814', wchan: 'io_schedule',
            started: new Date(2026, 8, 11, 16, 10, 4), cpuSeconds: 7 }),
          W.proc({ pid: 15220, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 6402, fd: 11, proto: 'tcp', local: '0.0.0.0:8900', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1618, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        diskio: [
          { dev: 'dm-2', rs: 88.2, ws: 1840.4, readKB: 2204.1, writeKB: 88120.4, await: 62.4, util: 98.2, queue: 14.2 },
          { dev: 'sda', rs: 2.0, ws: 40.1, readKB: 30.2, writeKB: 620.1, await: 0.8, util: 3.1 }
        ],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.73/24', rxOk: 88120044, txOk: 74120088, rxBytes: 12004881200, txBytes: 9120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 41208, txOk: 41208, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [8900, 22], rtt: 0.02 } },
        services: { calc: { active: true, pid: 6402, exe: 'java', desc: 'Scenario Calculation Engine' } },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'Core count',
        ask: 'How many CPU cores does this box have?',
        answer: '8',
        hint: 'There is a command that prints nothing but the processor count.',
        solution: 'nproc',
        teaches: 'Always establish the core count first - every load figure is meaningless until you know what to divide it by. lscpu and /proc/cpuinfo give you the same thing with more detail.'
      },
      {
        short: '1-minute load',
        ask: 'What is the 1-minute load average?',
        answer: '8.12',
        hint: 'uptime prints three load figures: 1, 5 and 15 minutes, in that order.',
        solution: 'uptime',
        teaches: 'The three figures are 1, 5 and 15 minutes. One reading tells you almost nothing - the shape across the three is the information.'
      },
      {
        short: 'Rising or falling',
        ask: 'Does the 1-minute average being above the 15-minute average suggest recently rising or falling load?',
        answers: ['rising', 'increasing', 'going up'],
        hint: 'Compare the 1-minute figure with the 15-minute figure. The notes in /home/gsupport/cpu-notes.txt spell out the rule.',
        solution: 'uptime ; grep -A2 "HIGHER" /home/gsupport/cpu-notes.txt',
        teaches: 'A higher short average suggests recently rising load. It does not prove the load is still climbing: a recent peak can have passed already. Take repeated samples and correlate them with demand and latency.'
      },
      {
        short: 'CPU or storage',
        ask: 'With D-state writers, slow write logs and elevated disk latency as well as 22% iowait, which dependency should you investigate first: CPU or storage?',
        answers: ['storage', 'disk', 'io', 'i/o'],
        hint: 'Read the "READING THE CPU BREAKDOWN" section of /home/gsupport/cpu-notes.txt, then look at where the time is actually going in mpstat.',
        solution: 'mpstat ; iostat -x ; tail /var/log/calc/calc.log ; grep -A5 "READING THE CPU BREAKDOWN" /home/gsupport/cpu-notes.txt',
        teaches: 'Correlated blocked writers, slow writes and elevated device latency make storage the first lead here. Load divided by CPU count and iowait alone cannot establish the bottleneck.'
      },
      {
        short: '%iowait',
        ask: 'What is the current %iowait, to two decimal places?',
        answer: '22.00',
        hint: 'mpstat prints the full CPU breakdown: %usr, %sys, %iowait, %steal, %idle.',
        solution: 'mpstat',
        teaches: '%iowait is an accounting category for idle time associated with outstanding I/O. It has multicore accounting limitations; high values suggest investigating I/O, and low values do not rule out application I/O stalls.'
      },
      {
        short: 'State that inflates load',
        ask: 'Processes in which process state count toward load average while using no CPU?',
        answers: ['d', 'state d', 'uninterruptible', 'uninterruptible sleep'],
        hint: 'Read the load average section of /home/gsupport/cpu-notes.txt, then look at the STAT column in ps.',
        solution: 'grep -B2 -A2 "uninterruptible" /home/gsupport/cpu-notes.txt',
        teaches: 'This is the answer to "load is 8 but the CPU is idle". D-state processes are blocked in the kernel on I/O - storage or NFS - and they count toward load the whole time.'
      },
      {
        short: 'Count blocked processes',
        ask: 'How many processes are currently in state D?',
        answer: '3',
        hint: 'ps can print just the state column. Filter for lines starting with D.',
        solution: 'ps -eo state,pid,comm | grep -c "^D"',
        teaches: 'vmstat shows the same figure live in its "b" (blocked) column. Three blocked writers plus the running work is most of that load average of 8.'
      },
      {
        short: 'Run queue depth',
        ask: 'What does the "r" column of vmstat show right now?',
        answer: '2',
        hint: 'vmstat 1 3 prints a few samples. The first two columns are r (runnable) and b (blocked).',
        solution: 'vmstat 1 3',
        teaches: 'r is processes running or waiting for CPU; b is processes blocked on I/O. r sustained above the core count is genuine CPU pressure - this box does not have that.'
      },
      {
        short: 'Busiest process',
        ask: 'What %CPU is the busiest process using?',
        answer: '480.0',
        hint: 'ps -eo lets you pick pid, pcpu and comm. Sort numerically, descending.',
        solution: 'ps -eo pid,pcpu,comm | sort -k2 -rn | head -3',
        teaches: 'In this per-CPU convention 480% is about 4.8 logical CPUs. ps reports CPU time divided by elapsed lifetime; top normally shows recent interval use. Compare sampling windows before treating them as identical.'
      },
      {
        short: 'Pinned core',
        ask: 'Which single CPU core is pinned at 99% user time?',
        answer: '3',
        hint: 'mpstat -P ALL breaks the figures down per core instead of averaging them.',
        solution: 'mpstat -P ALL',
        teaches: 'The machine-wide average hides a pinned core completely. One saturated core with the rest idle is the signature of a single-threaded hot path or a spinning thread.'
      },
      {
        short: 'Hottest thread',
        ask: 'Which thread ID inside PID 6402 is using the most CPU?',
        answer: '6421',
        hint: 'top -H shows threads instead of processes. -p limits it to one pid, -b makes it print once.',
        solution: 'top -H -b -p 6402',
        teaches: 'top -H plus the hex of that TID is how you find the exact line of Java burning the CPU: printf "%x\\n" TID, then match nid= in a jstack.'
      },
      {
        short: 'Nice value of the batch',
        ask: 'What nice value is the batch_extract process running with?',
        answer: '10',
        hint: 'ps -eo can print the ni column alongside the command.',
        solution: 'ps -eo pid,ni,comm | grep batch',
        teaches: 'nice runs -20 (most favoured) to 19 (least). Batch work is deliberately given a positive nice so it yields to interactive and trading traffic - seeing nice 0 on a batch job is worth a question.'
      }
    ],

    wrapUp:
      'uptime           load now, and the 1/5/15 trend\n' +
      'nproc            what to compare that load against\n' +
      'mpstat -P ALL    per core - finds the pinned core the average hides\n' +
      'vmstat 1 5       r = waiting for CPU, b = blocked on I/O, cs = switches\n' +
      'top -H -p PID    per thread inside one process\n' +
      'sar -u           what the CPU was doing earlier, after the event\n\n' +
      'The one sentence worth memorising: load average counts runnable processes\n' +
      'AND processes in uninterruptible I/O. That is why this box shows load 8\n' +
      'on 8 cores while being nowhere near CPU-bound - three writers are stuck on\n' +
      'a slow disk. High iowait is a clue: check device latency, queues and the\n' +
      'blocked tasks before concluding which dependency is the bottleneck.'
  });
})(PS);
