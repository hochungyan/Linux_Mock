/* BASICS: disk, inodes, filesystems and permissions.
 *
 * "The disk is full" has at least four distinct causes, and df alone
 * distinguishes none of them.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  var NOTES =
    'DISK, INODES AND PERMISSIONS\n' +
    '============================\n' +
    'FOUR DIFFERENT "DISK FULL" FAULTS\n' +
    '  1. Genuinely out of blocks       df -h  shows 100%\n' +
    '  2. Out of INODES, blocks free    df -i  shows 100% IUse, df -h looks fine.\n' +
    '                                   Caused by millions of tiny files.\n' +
    '  3. Deleted but still open        df is full, du cannot find it. The file\n' +
    '                                   was unlinked while a process held it\n' +
    '                                   open, so the blocks were never freed.\n' +
    '                                   Find it with:  lsof +L1\n' +
    '  4. Wrong filesystem entirely     the path you are looking at is not on\n' +
    '                                   the filesystem that is full. Check with\n' +
    '                                   df -h <path>.\n' +
    '\n' +
    'df reads the superblock counters. du walks the directory tree and adds up\n' +
    'what it can see. When they disagree, the bytes are somewhere du cannot\n' +
    'reach - which is case 3 above.\n' +
    '\n' +
    'PERMISSIONS\n' +
    '  -rw-r-----   owner read+write, group read, others nothing  = 640\n' +
    '  -rwxr-xr-x   owner all, group and others read+execute      = 755\n' +
    '  drwxr-x---   a directory, owner all, group read+enter      = 750\n' +
    '  r=4 w=2 x=1, added per triple: owner, group, other.\n' +
    '  On a DIRECTORY, x means "may enter", not "may execute".\n' +
    '\n' +
    'A read-only mount (ro in the mount options) produces "Read-only file\n' +
    'system" errors that look like a permissions problem but are not - no\n' +
    'chmod or chown will fix them.\n';

  PS.drills.push({
    id: 'disk-filesystem-basics',
    title: 'Disk, inodes and permissions',
    topic: 'df · du · find · mount',
    host: 'ldn-app-prod22',
    tags: ['df -h', 'df -i', 'du -s', 'find -size', 'mount ro', 'chmod'],

    brief:
      'A box with several filesystems, one of them in trouble - though not in\n' +
      'the way df -h would suggest.\n\n' +
      'Ten questions. Notes are in /home/gsupport/disk-notes.txt.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 18, 30, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var root = V.dir({
        var: V.dir({
          log: V.dir({
            pricer: V.dir({
              'pricer.log': V.file('2026-09-11 18:29:40 INFO  [main] Pricer - ok',
                { owner: 'priceadm', group: 'priceadm', mode: '-rw-r-----', mtime: ago(20), size: 2400 * MB }),
              'pricer-gc.log': V.file('[GC pause 1204M->312M(8192M), 0.0142 secs]',
                { owner: 'priceadm', group: 'priceadm', mtime: ago(60), size: 780 * MB }),
              'pricer-audit.log': V.file('audit trail',
                { owner: 'root', group: 'root', mode: '-rw-------', mtime: ago(3600), size: 1400 * MB })
            }),
            messages: V.file('Sep 11 18:00:01 ldn-app-prod22 systemd: Started Session 9120.',
              { owner: 'root', mode: '-rw-------', mtime: ago(1800), size: 620 * MB }),
            audit: V.dir({
              'audit.log': V.file('type=SYSCALL msg=audit(1757612345.123:4120)',
                { owner: 'root', mode: '-rw-------', mtime: ago(300), size: 3200 * MB })
            })
          }),
          lib: V.dir({
            pricer: V.dir({
              curves: V.dir({}, { owner: 'priceadm', mtime: ago(7200) })
            })
          }),
          tmp: V.dir({}), cache: V.dir({})
        }),
        data: V.dir({
          ticks: V.dir({}, { owner: 'tickadm', group: 'tickadm', mtime: ago(600) })
        }),
        mnt: V.dir({
          ref: V.dir({
            'instruments.csv': V.file('ISIN,SEDOL,NAME\n',
              { owner: 'root', group: 'root', mode: '-r--r--r--', mtime: ago(86400) })
          }, { owner: 'root', mtime: ago(86400) })
        }),
        apps: V.dir({
          pricer: V.dir({
            lib: V.dir({ 'pricer.jar': V.file('', { owner: 'priceadm', size: 96 * MB, mtime: ago(500000) }) }),
            bin: V.dir({
              'start.sh': V.file('#!/bin/bash\nexec java -jar /apps/pricer/lib/pricer.jar\n',
                { mode: '-rwxr-xr-x', owner: 'priceadm', group: 'priceadm', size: 60, mtime: ago(500000) })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'disk-notes.txt': V.file(NOTES, { owner: 'gsupport', group: 'gsupport', mtime: ago(400000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      return W.create({
        host: 'ldn-app-prod22', user: 'gsupport', clock: t0, seed: 2222,
        bootSeconds: 3600 * 24 * 52, cores: 8, users: 2,
        load: [0.64, 0.61, 0.58],
        mem: { total: 32 * GB, free: 16 * GB, buffers: 260 * MB, cached: 7 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 5.2, sy: 1.1, ni: 0, id: 93.5, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 16 * GB,
            inodes: { total: 26214400, used: 220118 } },
          // fullest by percentage
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 184 * GB,
            inodes: { total: 104857600, used: 412008 } },
          // plenty of space, no inodes left: millions of tiny tick files
          { dev: '/dev/mapper/vg01-data', mount: '/data', type: 'ext4', size: 2048 * GB, used: 410 * GB,
            inodes: { total: 134217728, used: 133955000 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 100 * GB, used: 24 * GB,
            inodes: { total: 52428800, used: 61204 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.4 * GB,
            inodes: { total: 10485760, used: 1204 } },
          // read-only reference data mount
          { dev: 'nas-ref-01:/vol/ref', mount: '/mnt/ref', type: 'nfs', size: 500 * GB, used: 120 * GB,
            opts: 'ro,relatime,vers=3,rsize=65536,hard,proto=tcp',
            inodes: { total: 26214400, used: 88412 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 700 }),
          W.proc({ pid: 1620, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 24 }),
          W.proc({ pid: 4180, user: 'priceadm', short: 'java', cpu: 6.4, rss: 8 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx8g -jar /apps/pricer/lib/pricer.jar',
            started: new Date(2026, 8, 11, 6, 40, 0), cpuSeconds: 2400,
            fds: [{ fd: 1, path: '/var/log/pricer/pricer.log', mode: 'w', size: 2400 * MB }] }),
          W.proc({ pid: 19100, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 4180, fd: 11, proto: 'tcp', local: '0.0.0.0:8700', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1620, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        diskio: [{ dev: 'dm-1', rs: 6.2, ws: 88.1, readKB: 120.4, writeKB: 2200.1, await: 1.1, util: 8.2 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.82/24', rxOk: 88120044, txOk: 74120088, rxBytes: 12004881200, txBytes: 9120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 22104, txOk: 22104, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [8700, 22], rtt: 0.02 } },
        services: { pricer: { active: true, pid: 4180, exe: 'java', desc: 'Curve Pricer' } },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'Fullest filesystem',
        ask: 'Which mount point is the fullest by percentage of space used?',
        answer: '/var',
        hint: 'df -h prints a Use% column next to each mount point.',
        solution: 'df -h',
        teaches: 'Always use -h unless you are doing arithmetic. And read the Mounted on column, not the device name - which device backs /var is rarely the thing you need.'
      },
      {
        short: 'Space left on /var',
        ask: 'How much space is available on /var? (as df -h prints it)',
        answers: ['16g'],
        hint: 'The Avail column of df -h, on the /var row.',
        solution: 'df -h /var',
        teaches: 'Passing a path to df tells you which filesystem that path is on, which saves guessing when a directory tree spans several mounts.'
      },
      {
        short: 'Out of inodes',
        ask: 'One filesystem has plenty of free space but has almost run out of inodes. Which mount point?',
        answer: '/data',
        hint: 'df -h will not show this. There is a different flag for the inode table.',
        solution: 'df -i',
        teaches: 'Inode exhaustion gives you ENOSPC - "No space left on device" - while df -h shows terabytes free. Millions of small files, typically tick data or per-message spool files, is the usual cause.'
      },
      {
        short: 'Filesystem type of /data',
        ask: 'What filesystem type is /data?',
        answer: 'ext4',
        hint: 'df takes a flag to add a Type column; mount shows it too.',
        solution: 'df -T',
        teaches: 'It matters: ext4 fixes its inode count when the filesystem is created, so running out means a rebuild. XFS allocates inodes dynamically and effectively does not hit this.'
      },
      {
        short: 'Biggest directory in /var',
        ask: 'Which directory directly under /var uses the most space?',
        answer: '/var/log',
        hint: 'du -s gives one total per argument. Expand /var/* and sort numerically, largest first.',
        solution: 'du -s /var/* | sort -rn | head -3',
        teaches: 'du -sh is friendlier to read but does not sort correctly, because 900M sorts above 8G as text. Sort on plain du -s (kilobytes), then re-run with -h on the winner.'
      },
      {
        short: 'Files over 1GB',
        ask: 'How many files under /var/log are larger than 1GB?',
        answer: '3',
        hint: 'find takes -size with a unit suffix, and a leading plus means "greater than".',
        solution: 'find /var/log -type f -size +1G | wc -l',
        teaches: 'Suffixes are c bytes, k kilobytes, M megabytes, G gigabytes. Without a suffix find counts 512-byte blocks, which surprises people every time.'
      },
      {
        short: 'Read-only mount',
        ask: 'Which mount point is mounted read-only?',
        answer: '/mnt/ref',
        hint: 'mount lists every filesystem with its options in brackets. Look for ro.',
        solution: 'mount | grep "(ro"',
        teaches: '"Read-only file system" looks like a permissions error but no chmod or chown will fix it. Check the mount options before you start changing ownership.'
      },
      {
        short: 'Permissions in octal',
        ask: 'What are the permissions on /var/log/pricer/pricer.log in octal?',
        answer: '640',
        hint: 'stat prints both the symbolic and the octal form. r=4, w=2, x=1 per triple.',
        solution: 'stat /var/log/pricer/pricer.log',
        teaches: '-rw-r----- is 640: owner read+write, group read, others nothing. Getting from the symbolic form to the number in your head is a standard interview warm-up.'
      },
      {
        short: 'Which fs holds a path',
        ask: 'Which filesystem is /apps/pricer/lib/pricer.jar stored on?',
        answer: '/apps',
        hint: 'Give df the path itself and it reports only the filesystem containing it.',
        solution: 'df -h /apps/pricer/lib/pricer.jar',
        teaches: 'This is how you avoid the fourth kind of "disk full": the directory you are staring at is often not on the filesystem that filled up.'
      },
      {
        short: 'df full but du cannot find it',
        ask: 'df says a filesystem is full but du accounts for far less. Which command finds the missing space?',
        answers: ['lsof +l1', 'lsof', 'lsof +l1 ', '+l1'],
        hint: 'The bytes belong to a file that has been unlinked but is still held open. Read the four-faults section of /home/gsupport/disk-notes.txt.',
        solution: 'grep -A4 "Deleted but still open" /home/gsupport/disk-notes.txt',
        teaches: 'lsof +L1 lists open files whose link count has dropped to zero. The space comes back when the holder closes the descriptor - or immediately, if you truncate it via /proc/PID/fd/N.'
      }
    ],

    wrapUp:
      'df -h              blocks used per filesystem\n' +
      'df -i              INODES used - the fault df -h cannot see\n' +
      'df -T              filesystem types\n' +
      'df -h <path>       which filesystem a given path is actually on\n' +
      'du -s /var/* | sort -rn     where the space went\n' +
      'find DIR -type f -size +1G  the big files\n' +
      'mount | grep "(ro"          read-only mounts\n' +
      'stat FILE                   owner, group, octal permissions\n' +
      'lsof +L1                    deleted-but-open files\n\n' +
      'When someone says "the disk is full", four things could be true: no\n' +
      'blocks, no inodes, deleted-but-open files, or you are looking at the\n' +
      'wrong filesystem. df -h, df -i, du and lsof +L1 separate them in under a\n' +
      'minute - and only one of the four is fixed by deleting files.'
  });
})(PS);
