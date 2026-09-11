/* BASICS: processes, signals, file descriptors.
 *
 * Parent/child relationships, zombies, what kill actually does, and the limit
 * that produces "Too many open files" at the worst possible moment.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  var NOTES =
    'PROCESSES AND SIGNALS\n' +
    '=====================\n' +
    'PARENTAGE\n' +
    '  Every process has a PPID. ps -ef shows it. When a parent dies before its\n' +
    '  child, the child is re-parented to a child subreaper or PID 1.\n' +
    '\n' +
    'ZOMBIES (state Z, shown as <defunct>)\n' +
    '  A zombie has already exited. It holds no memory, no CPU and no file\n' +
    '  descriptors - only a slot in the process table, kept so the parent can\n' +
    '  read its exit status.\n' +
    '  You cannot kill a zombie: it is already dead. The fix is to make the\n' +
    '  PARENT reap it, which in practice means fixing or restarting the parent.\n' +
    '  A handful is harmless. Thousands will exhaust the process table.\n' +
    '\n' +
    'SIGNALS WORTH KNOWING\n' +
    '   1 SIGHUP   terminal hung up. Daemons conventionally reload their\n' +
    '              config on HUP rather than exiting. nohup shields a process\n' +
    '              from it so it survives your logout.\n' +
    '   2 SIGINT   what Ctrl+C sends\n' +
    '   3 SIGQUIT  a JVM dumps all thread stacks and keeps running\n' +
    '   9 SIGKILL  cannot be caught, blocked or ignored. No cleanup, no flush,\n' +
    '              no orderly shutdown. Last resort.\n' +
    '  15 SIGTERM  the DEFAULT for kill. Polite: the process can catch it,\n' +
    '              finish in-flight work, flush and exit cleanly.\n' +
    '\n' +
    '  Always try 15 first and give it time. Reaching for 9 immediately is how\n' +
    '  you corrupt a file that was halfway through being written.\n' +
    '\n' +
    '  SIGKILL can be delayed during a genuine uninterruptible kernel wait.\n' +
    '  D alone is not proof: killable kernel waits can also display D. Inspect\n' +
    '  the wait channel and stack; signals do not require a user-space handler.\n' +
    '\n' +
    'FILE DESCRIPTORS\n' +
    '  On Linux everything is a file: regular files, sockets, pipes, devices.\n' +
    '  Each open one costs a descriptor, and the per-process ceiling is the\n' +
    '  "open files" limit, ulimit -n.\n' +
    '  When it is reached you get "Too many open files" - and note that it hits\n' +
    '  NEW SOCKETS too, so the usual symptom is that the application stops\n' +
    '  accepting connections rather than anything about files.\n' +
    '  Inspect /proc/PID/fd for descriptors. lsof includes a header, cwd,\n' +
    '  executable and memory mappings, so its line count is not an FD count.\n';

  PS.drills.push({
    id: 'processes-signals-basics',
    title: 'Processes and signals',
    topic: 'ps · kill · zombies · ulimit',
    host: 'ldn-app-prod18',
    tags: ['ps -ef', 'PPID', 'zombie', 'SIGTERM vs SIGKILL', 'ulimit -n'],

    brief:
      'A box running a batch wrapper with children, a process stuck on storage,\n' +
      'and a service that has been leaking file descriptors all morning.\n\n' +
      'Ten questions. Reference notes are in /home/gsupport/proc-notes.txt.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 12, 48, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      // a service that has leaked descriptors: give it a lot of open files
      var leakedFds = [];
      for (var i = 0; i < 40; i++) {
        leakedFds.push({ fd: 20 + i, path: '/var/lib/feedsvc/tmp/chunk-' + (1000 + i) + '.dat', mode: 'u', size: 4096 });
      }

      var root = V.dir({
        apps: V.dir({
          batch: V.dir({
            bin: V.dir({
              'nightly_wrapper.sh': V.file('#!/bin/bash\n/apps/batch/bin/extract_positions.sh\n',
                { mode: '-rwxr-xr-x', owner: 'batchadm', size: 62, mtime: ago(800000) })
            })
          })
        }),
        var: V.dir({
          lib: V.dir({ feedsvc: V.dir({ tmp: V.dir({}) }) }),
          log: V.dir({
            feedsvc: V.dir({
              'feedsvc.log': V.file(
                '2026-09-11 12:40:02 INFO  [main] FeedSvc - 41208 messages processed\n' +
                '2026-09-11 12:44:18 WARN  [acceptor] FeedSvc - accept() slow\n' +
                '2026-09-11 12:47:55 ERROR [acceptor] FeedSvc - java.net.SocketException: Too many open files',
                { owner: 'feedadm', mtime: ago(5), size: 140 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'proc-notes.txt': V.file(NOTES, { owner: 'gsupport', mtime: ago(400000) })
          })
        }),
        etc: V.dir({
          'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }),
          security: V.dir({
            'limits.conf': V.file(
              '# <domain> <type> <item> <value>\n' +
              'feedadm  soft  nofile  1024\n' +
              'feedadm  hard  nofile  65536\n' +
              'batchadm soft  nofile  8192\n', { owner: 'root', mtime: ago(86400 * 400) })
          })
        }),
        mnt: V.dir({ archive: V.dir({}, { owner: 'root', mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      return W.create({
        host: 'ldn-app-prod18', user: 'gsupport', clock: t0, seed: 1848,
        bootSeconds: 3600 * 24 * 35, cores: 8, users: 3,
        load: [2.18, 2.04, 1.88],
        mem: { total: 32 * GB, free: 12 * GB, buffers: 240 * MB, cached: 9 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 12.4, sy: 2.1, ni: 0, id: 83.3, wa: 2.2, st: 0 },
        root: root,
        limits: { nofile: 1024, nproc: 4096 },
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB, inodes: { total: 26214400, used: 180002 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 24 * GB, inodes: { total: 52428800, used: 41208 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 900 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 500 }),
          W.proc({ pid: 1614, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 20 }),

          // the batch wrapper and its child
          W.proc({ pid: 21400, ppid: 1, user: 'batchadm', short: 'nightly_wrap', cpu: 0.2, rss: 5 * MB,
            cmd: '/bin/bash /apps/batch/bin/nightly_wrapper.sh',
            started: new Date(2026, 8, 11, 12, 30, 0), cpuSeconds: 3 }),
          W.proc({ pid: 21455, ppid: 21400, user: 'batchadm', short: 'extract_posi', cpu: 18.4, rss: 900 * MB,
            cmd: '/bin/bash /apps/batch/bin/extract_positions.sh --date 20260911',
            started: new Date(2026, 8, 11, 12, 30, 2), cpuSeconds: 204 }),

          // two zombies: exited, parent has not reaped them
          W.proc({ pid: 21501, ppid: 21400, user: 'batchadm', short: 'sqlldr', state: 'Z', cpu: 0, rss: 0,
            cmd: '[sqlldr] <defunct>', started: new Date(2026, 8, 11, 12, 34, 0), cpuSeconds: 12 }),
          W.proc({ pid: 21502, ppid: 21400, user: 'batchadm', short: 'sqlldr', state: 'Z', cpu: 0, rss: 0,
            cmd: '[sqlldr] <defunct>', started: new Date(2026, 8, 11, 12, 38, 0), cpuSeconds: 11 }),

          // stuck on an archive mount that is not answering
          W.proc({ pid: 22800, ppid: 1, user: 'batchadm', short: 'tar', state: 'D', cpu: 0, rss: 40 * MB,
            cmd: '/bin/tar -czf /mnt/archive/positions-20260911.tar.gz /var/lib/positions',
            wchan: 'io_schedule',
            started: new Date(2026, 8, 11, 12, 12, 0), cpuSeconds: 18 }),

          // the descriptor leaker
          W.proc({ pid: 9310, ppid: 1, user: 'feedadm', short: 'java', cpu: 8.1, rss: 4 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx4g -jar /apps/feedsvc/lib/feedsvc.jar',
            started: new Date(2026, 8, 11, 6, 20, 0), cpuSeconds: 1800,
            limitNofile: 1024,
            fds: [{ fd: 1, path: '/var/log/feedsvc/feedsvc.log', mode: 'w', size: 140 * MB }].concat(leakedFds) }),

          W.proc({ pid: 18800, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 9310, fd: 11, proto: 'tcp', local: '0.0.0.0:9400', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1614, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        diskio: [{ dev: 'dm-1', rs: 12.1, ws: 140.2, readKB: 220.4, writeKB: 3120.1, await: 2.1, util: 14.2 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.78/24', rxOk: 120044120, txOk: 98412004, rxBytes: 22104881200, txBytes: 18120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 41208, txOk: 41208, mtu: 65536 }
        ],
        dmesg: [
          { time: ago(300), text: 'nfs: server nas-arch-01 not responding, still trying' }
        ],
        hosts: { localhost: { ip: '127.0.0.1', ports: [9400, 22], rtt: 0.02 } },
        services: { feedsvc: { active: true, pid: 9310, exe: 'java', desc: 'Feed Service' } },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'Parent of the extract',
        ask: 'Which PID started extract_positions.sh?',
        answer: '21400',
        hint: 'ps -ef prints a PPID column next to the PID. Find the extract process and read its parent.',
        solution: 'ps -ef | grep extract_positions',
        teaches: 'The PPID chain tells you who to talk to. A job whose PPID is 1 has been orphaned - its parent died and init adopted it, which usually means the wrapper failed and the child kept going.'
      },
      {
        short: 'Count zombies',
        ask: 'How many zombie (defunct) processes are on this box?',
        answer: '2',
        hint: 'Zombies show as <defunct> in the command column, and Z in the state column.',
        solution: 'ps -ef | grep -c defunct',
        teaches: 'ps -eo state also shows them as Z. Zombies hold no memory or CPU - only a process table slot - so a few are harmless and thousands are a real problem.'
      },
      {
        short: 'Clearing a zombie',
        ask: 'You cannot kill a zombie. Which process has to act to clear it?',
        answers: ['parent', 'the parent', 'its parent', 'parent process'],
        hint: 'A zombie has already exited. Read the ZOMBIES section of /home/gsupport/proc-notes.txt.',
        solution: 'grep -A5 "ZOMBIES" /home/gsupport/proc-notes.txt',
        teaches: 'The zombie exists only so its parent can read the exit status. Killing the zombie is meaningless - it is already dead. Fix or restart the parent, and init will reap the rest.'
      },
      {
        short: 'Default kill signal',
        ask: 'Which signal NUMBER does plain "kill PID" send?',
        answers: ['15', 'sigterm', '15 sigterm'],
        hint: 'kill -l lists every signal with its number. The default is the polite one, not the forceful one.',
        solution: 'kill -l',
        teaches: 'The default is 15 SIGTERM, which the process can catch to flush and exit cleanly. Going straight to -9 skips all of that and is how half-written files happen.'
      },
      {
        short: 'Uncatchable signal',
        ask: 'Which signal can a process NOT catch, block or ignore? Give the number.',
        answers: ['9', 'sigkill', '9 sigkill'],
        hint: 'The SIGNALS section of the notes says which one cannot be handled.',
        solution: 'grep -B1 -A2 "cannot be caught" /home/gsupport/proc-notes.txt',
        teaches: 'SIGKILL is delivered by the kernel and the process never sees it - no cleanup, no flush, no shutdown hook. That is exactly why it works, and exactly why it is a last resort.'
      },
      {
          short: 'Signal nohup ignores',
        ask: 'Which signal does nohup shield a process from, so it survives you logging out?',
        answers: ['sighup', 'hup', '1', 'signal 1'],
        hint: 'The name is a contraction of what it does. kill -l will show you the signal it refers to.',
        solution: 'kill -l | head -2 ; grep -i "nohup" /home/gsupport/proc-notes.txt',
          teaches: 'nohup starts a command with SIGHUP ignored. Logout behavior depends on the shell, session and signal handling; nohup does not protect against every termination cause or provide service supervision.'
      },
      {
        short: 'Stuck process state',
        ask: 'One process has been stuck since 12:12. What state is it in?',
        answers: ['d', 'state d', 'uninterruptible', 'uninterruptible sleep'],
        hint: 'ps -eo state,pid,wchan,cmd shows the state and what the kernel is waiting on.',
        solution: 'ps -eo state,pid,wchan,cmd | grep tar',
        teaches: 'The wchan column names a kernel wait point. io_schedule indicates an I/O wait, but does not identify the device or prove NFS. Correlate the process paths, kernel stack, mounts and logs.'
      },
      {
        short: 'kill -9 on D state',
        ask: 'Will kill -9 terminate this simulated process immediately while its genuine uninterruptible I/O wait remains stuck? Answer yes or no.',
        answers: ['no'],
        hint: 'Try it, and read what comes back. The notes explain why.',
        solution: 'kill -9 22800',
        teaches: 'SIGKILL cannot run cleanup and may remain pending during a genuine uninterruptible wait. Some waits reported as D are killable; D alone does not establish that kill -9 will fail. A forced unmount is not a guaranteed remedy.'
      },
      {
        short: 'Open file limit',
        ask: 'What is the open file limit (ulimit -n) in this shell?',
        answer: '1024',
        hint: 'ulimit -n prints it directly; ulimit -a prints every limit with its flag.',
        solution: 'ulimit -n',
        teaches: 'The shell limit is not necessarily the limit the SERVICE runs with - systemd units set their own LimitNOFILE. Check /etc/security/limits.conf and the unit file, not just your own shell.'
      },
      {
        short: 'Diagnose "Too many open files"',
        ask: 'feedsvc is logging "Too many open files". How many open files does lsof report for PID 9310?',
        note: 'Count the entries, not the header line.',
        answer: '42',
        hint: 'lsof -p PID lists them, with a COMMAND header line you do not want to count.',
        solution: 'lsof -p 9310 | grep -vc COMMAND',
        teaches: 'Sockets count as open files, so this limit stops the service ACCEPTING CONNECTIONS as well as opening files - the symptom is usually "it stopped taking sessions". Compare the count against ulimit -n, and if it is climbing steadily, it is a leak, not a limit that is too low.'
      }
    ],

    wrapUp:
      'ps -ef                     PID, PPID, who started what\n' +
      'ps -eo state,pid,wchan,cmd state plus what the kernel is waiting on\n' +
      'ps -ef | grep defunct      zombies\n' +
      'kill -l                    signal numbers and names\n' +
      'kill -15 / kill -9         polite first, forceful only if it fails\n' +
      'ulimit -n / ulimit -a      this shell\'s limits\n' +
      'lsof -p PID | wc -l        what a process actually has open\n\n' +
      'Three answers worth having ready:\n' +
      '  - A zombie cannot be killed; its parent must reap it.\n' +
      '  - SIGKILL cannot be caught; a genuine uninterruptible wait may delay it.\n' +
      '  - "Too many open files" counts sockets, so it shows up as a service\n' +
      '    that has stopped accepting connections.'
  });
})(PS);
