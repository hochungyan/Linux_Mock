/* BASICS: memory - free, ps, swap, JVM heap, the OOM killer.
 *
 * The one idea worth leaving with: "free" memory is not the number that
 * matters. "available" is.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  PS.drills.push({
    id: 'memory-basics',
    title: 'Memory',
    topic: 'free · ps · swap · JVM heap',
    host: 'ldn-app-prod12',
    tags: ['free -m', 'ps -o rss', 'swap', '-Xmx', 'OOM killer'],

    brief:
      'A busy application server. Memory looks tight at a glance, and the first\n' +
      'question anyone asks is the wrong one.\n\n' +
      'Eight questions on reading memory properly.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 15, 2, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var root = V.dir({
        apps: V.dir({
          pricer: V.dir({
            conf: V.dir({
              'jvm.args': V.file('-Xms12g\n-Xmx12g\n-XX:+UseG1GC\n-XX:+HeapDumpOnOutOfMemoryError\n',
                { owner: 'priceadm', mtime: ago(600000) })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            pricer: V.dir({
              'pricer.log': V.file(
                '2026-09-11 14:58:02 INFO  [main] Pricer - 2841 curves loaded\n' +
                '2026-09-11 15:01:40 INFO  [calc-1] Pricer - revalued book EQD_LDN in 4.2s',
                { owner: 'priceadm', mtime: ago(20), size: 310 * MB })
            }),
            messages: V.file(
              'Sep 11 09:14:22 ldn-app-prod12 kernel: batchloader invoked oom-killer: gfp_mask=0x201da, order=0\n' +
              'Sep 11 09:14:22 ldn-app-prod12 kernel: Out of memory: Kill process 18402 (batchloader) score 78 or sacrifice child\n' +
              'Sep 11 09:14:22 ldn-app-prod12 kernel: Killed process 18402 (batchloader) total-vm:12408004kB, anon-rss:9120884kB',
              { owner: 'root', mtime: ago(21000), size: 52 * MB })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'memory-notes.txt': V.file(
              'READING MEMORY ON LINUX\n' +
              '=======================\n' +
              'free is NOT the number you want. Linux uses spare RAM as page cache\n' +
              'and can reclaim much of it. Low free RAM alone does not prove memory\n' +
              'pressure; consider available RAM, reclaim, swap activity and limits.\n' +
              '\n' +
              '  available  = what a new process could get without swapping.\n' +
              '               THIS is the number to alert on.\n' +
              '  buff/cache = buffers and cache; not all immediately reclaimable\n' +
              '  free       = currently unused pages; may be low on a healthy box\n' +
              '\n' +
              'PROCESS MEMORY\n' +
              '  RSS  resident set size - real pages in RAM right now\n' +
              '  VSZ  virtual size - mappings and reservations, not physical use.\n' +
              '       A JVM reserves its whole heap in VSZ at start up.\n' +
              '\n' +
              '-Xmx caps Java HEAP only. RSS also includes native allocations,\n' +
              'metaspace, code cache, thread stacks and direct buffers.\n' +
              '\n' +
              'TWO DIFFERENT "OUT OF MEMORY"\n' +
              '  Java OutOfMemoryError: read its detail: heap space, metaspace,\n' +
              '    direct buffer memory and native thread limits differ.\n' +
              '  Kernel OOM kill: allocation failed under global or cgroup limits;\n' +
              '    a container can be killed while the host still has RAM.\n' +
              'Knowing which one you had decides who fixes it.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      return W.create({
        host: 'ldn-app-prod12', user: 'gsupport', clock: t0, seed: 2048,
        bootSeconds: 3600 * 24 * 44, cores: 16, users: 3,
        load: [3.42, 3.18, 2.94],
        // 64G total: 2G free, 24G cache -> "free" looks alarming, available is fine
        mem: { total: 64 * GB, free: 2 * GB, buffers: 512 * MB, cached: 24 * GB, shared: 256 * MB },
        swap: { total: 8 * GB, used: 1.5 * GB, si: 0, so: 12 },
        cpu: { us: 18.4, sy: 2.1, ni: 0, id: 79.2, wa: 0.3, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 13 * GB, inodes: { total: 26214400, used: 210044 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 34 * GB, inodes: { total: 104857600, used: 28412 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.5 * GB, inodes: { total: 10485760, used: 1400 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 12 * MB, cpu: 0, cpuSeconds: 900 }),
          W.proc({ pid: 1288, cmd: '/usr/sbin/rsyslogd -n', short: 'rsyslogd', rss: 44 * MB, cpu: 0.2, cpuSeconds: 1400 }),
          W.proc({ pid: 1640, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 40 }),
          // the big one: 13.5G RSS on a 64G box
          W.proc({ pid: 9012, user: 'priceadm', short: 'java', cpu: 42.1, rss: 13824 * MB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms12g -Xmx12g -XX:+UseG1GC -jar /apps/pricer/lib/pricer.jar',
            started: new Date(2026, 8, 11, 6, 30, 0), cpuSeconds: 12400,
            fds: [{ fd: 1, path: '/var/log/pricer/pricer.log', mode: 'w', size: 310 * MB }],
            jvm: { name: 'pricer.jar', mainClass: 'com.ib.pricer.Main', heapMax: 12 * GB, heapUsed: 7 * GB,
              args: '-Xms12g -Xmx12g -XX:+UseG1GC',
              gcStats: { ygc: 8412, ygct: 102.4, fgc: 1, fgct: 2.1, old: 41.2, eden: 28.4 } } }),
          W.proc({ pid: 9440, user: 'priceadm', short: 'python', cpu: 4.2, rss: 3200 * MB,
            cmd: '/usr/bin/python3 /apps/pricer/bin/curve_publisher.py',
            started: new Date(2026, 8, 11, 6, 31, 0), cpuSeconds: 880 }),
          W.proc({ pid: 9880, user: 'priceadm', short: 'redis-serve', cpu: 1.8, rss: 1800 * MB,
            cmd: '/usr/bin/redis-server 127.0.0.1:6379',
            started: new Date(2026, 8, 11, 6, 30, 30), cpuSeconds: 420 }),
          W.proc({ pid: 16100, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 9012, fd: 11, proto: 'tcp', local: '0.0.0.0:8700', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1640, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        netstat: { tcpActive: 4120, tcpRetrans: 22, udpErrors: 0 },
        diskio: [{ dev: 'dm-1', rs: 8.2, ws: 120.4, readKB: 220.1, writeKB: 3120.8, await: 1.2, util: 12.4 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.72/24', rxOk: 120044120, txOk: 98412004, rxBytes: 22104881200, txBytes: 18120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 412008, txOk: 412008, mtu: 65536 }
        ],
        dmesg: [
          { time: ago(21000), text: 'batchloader invoked oom-killer: gfp_mask=0x201da, order=0, oom_score_adj=0' },
          { time: ago(21000), text: 'Out of memory: Kill process 18402 (batchloader) score 78 or sacrifice child' },
          { time: ago(21000), text: 'Killed process 18402 (batchloader) total-vm:12408004kB, anon-rss:9120884kB' }
        ],
        hosts: { localhost: { ip: '127.0.0.1', ports: [8700, 22], rtt: 0.02 } },
        services: { pricer: { active: true, pid: 9012, exe: 'java', desc: 'Curve Pricer' } },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'Total RAM',
        ask: 'How much total RAM does this box have, in GB?',
        answers: ['64', '64g', '64gb'],
        hint: 'free takes a unit flag: -m for MB, -g for GB, -h for human readable.',
        solution: 'free -g',
        teaches: 'free -h is friendliest to read; free -m is easiest to compare against a JVM -Xmx, which is also usually quoted in MB or GB.'
      },
      {
        short: 'Free vs available',
        ask: 'Which column tells you how much memory a new process could actually get: "free" or "available"?',
        answers: ['available', 'the available column', 'avail'],
        hint: 'One of those two counts the page cache as reclaimable. Read /home/gsupport/memory-notes.txt.',
        solution: 'free -m ; cat /home/gsupport/memory-notes.txt',
        teaches: 'Linux spends spare RAM on page cache and gives it back on demand. Alerting on "free" pages the desk every night for nothing; alert on "available".'
      },
      {
        short: 'Biggest process by RSS',
        ask: 'Which PID is using the most resident memory?',
        answer: '9012',
        hint: 'ps -eo lets you pick columns. Sort numerically, descending, on the RSS column.',
        solution: 'ps -eo pid,rss,comm | sort -k2 -rn | head -3',
        teaches: 'sort -k2 sorts on the second field and -rn makes it reverse numeric. Without -n you get string order, where 9 sorts above 13824.'
      },
      {
        short: 'RSS vs VSZ',
        ask: 'Which column is real memory in RAM right now: RSS or VSZ?',
        answers: ['rss'],
        hint: 'One of them is address space the process has reserved, which for a JVM includes the whole heap from startup.',
        solution: 'ps -eo pid,rss,vsz,comm | head -5',
        teaches: 'VSZ measures virtual mappings and reservations, not physical RAM consumed. RSS counts resident pages including shared pages; PSS apportions shared pages when comparing several processes.'
      },
      {
        short: 'Is it swapping',
        ask: 'How much swap is in use, in MB?',
        answer: '1536',
        hint: 'free -m shows a Swap row with total, used and free.',
        solution: 'free -m',
        teaches: 'Swap in use is not automatically bad - the kernel parks idle pages there. What hurts is active swapping: check si/so in vmstat, not the total.'
      },
      {
        short: 'JVM max heap',
        ask: 'What is the maximum heap configured for the pricer JVM?',
        answers: ['12g', '-xmx12g', '12288m', '12'],
        hint: 'The JVM flags are on its command line. grep -o can pull just the flag you want out of a long ps line.',
        solution: 'ps -ef | grep java | grep -o "\\-Xmx[0-9a-zA-Z]*"',
        teaches: '-Xmx caps the Java heap, not total JVM memory. Native allocations, metaspace, direct buffers and thread stacks can make RSS exceed it. Read the precise OutOfMemoryError detail before choosing a remedy.'
      },
      {
        short: 'Percentage of RAM used',
        ask: 'What percentage of total memory is the biggest process using? (the %MEM column, to 1 decimal place)',
        answers: ['21.1'],
        hint: 'ps aux includes a %MEM column - RSS as a share of total RAM.',
        solution: 'ps aux | sort -k6 -rn | head -3',
        teaches: '%MEM is RSS over total RAM. It double counts shared pages across processes, so a column of %MEM can add up to more than 100%.'
      },
      {
        short: 'OOM killer victim',
        ask: 'The kernel OOM killer ran on this box earlier. Which process did it kill?',
        answer: 'batchloader',
        hint: 'The kernel logs it to the ring buffer and to /var/log/messages. Search for "Killed process".',
        solution: 'dmesg -T | grep -i "killed process"',
        teaches: 'A kernel OOM kill is distinct from a Java exception. Global memory pressure or a cgroup memory limit can trigger it, and the chosen victim need not have caused the growth. Check kernel logs and cgroup memory.events.'
      },
      {
        short: 'Total RAM in kB',
        ask: 'What does /proc/meminfo report as MemTotal, in kB?',
        answer: '67108864',
        hint: 'free reads /proc/meminfo. You can read it directly - the values are all in kB.',
        solution: 'grep MemTotal /proc/meminfo',
        teaches: 'free is only a formatter over /proc/meminfo. When a monitoring agent and free disagree, read the file - it is the source both of them are supposed to be using.'
      },
      {
        short: 'The available field',
        ask: 'What is the field in /proc/meminfo called that corresponds to the "available" column of free?',
        answers: ['memavailable', 'mem available'],
        hint: 'grep the file case-insensitively for "avail".',
        solution: 'grep -i avail /proc/meminfo',
        teaches: 'MemAvailable is the kernel\'s own estimate of what a new workload could get without swapping. It accounts for which cache is genuinely reclaimable, which is why it beats free plus cached arithmetic.'
      },
      {
        short: 'Page cache size',
        ask: 'How much memory is held as buff/cache, in MB?',
        answer: '25088',
        hint: 'free -m has a buff/cache column - buffers and page cache added together.',
        solution: 'free -m',
        teaches: 'Cache does useful work and much can be reclaimed, but dirty or unreclaimable pages complicate that. MemAvailable estimates headroom more usefully than treating all cache as immediately free.'
      },
      {
        short: 'Real swapping columns',
        ask: 'Which two vmstat columns show pages being swapped IN and OUT?',
        answers: ['si so', 'si and so', 'si, so'],
        hint: 'Run vmstat for a few samples and read the headers under the "swap" group.',
        solution: 'vmstat 1 3',
        teaches: 'Swap used alone does not prove current pressure. Sample si/so after the first since-boot report and correlate with latency and major faults. Minor faults do not require disk I/O, and not every major fault is swap.'
      }
    ],

    wrapUp:
      'free -m          read the AVAILABLE column, not free\n' +
      'ps -eo pid,rss,comm | sort -k2 -rn | head     who is actually using it\n' +
      'vmstat 1 5       si/so columns show real swapping, not just swap used\n' +
      'dmesg -T | grep -i "killed process"           did the OOM killer run\n' +
      'ps -ef | grep java | grep -o "\\-Xmx[0-9a-z]*"  what is the JVM limit\n\n' +
      'The two mistakes that cost the most time:\n' +
      '  1. Alerting on low "free" alone. Use MemAvailable, pressure and swap\n' +
      '     activity; also check the application cgroup memory limit.\n' +
      '  2. Answering a Java OutOfMemoryError with "the box has RAM spare". The\n' +
      '     Java heap is capped by -Xmx; other OOME causes need different checks.'
  });
})(PS);
