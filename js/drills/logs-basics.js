/* BASICS: reading logs - grep, awk, sed, find, sort/uniq, zgrep.
 *
 * Nothing is broken on this box. These are the questions a team lead asks when
 * they want to know whether you can actually get an answer out of a log file.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  /* 20 lines: 8 INFO, 4 WARN, 8 ERROR.
   * Exception classes: SocketTimeout x3, NullPointer x3, SQLRecoverable x2. */
  var APP_LOG = [
    '2026-09-11 09:58:12 INFO  [http-nio-8080-exec-3] OrderService - order accepted id=88412',
    '2026-09-11 09:58:19 INFO  [http-nio-8080-exec-5] OrderService - order accepted id=88413',
    '2026-09-11 09:58:44 INFO  [scheduler-1] CacheRefresher - refreshed 2841 instruments',
    '2026-09-11 09:59:02 WARN  [http-nio-8080-exec-3] RefDataClient - slow lookup 812ms',
    '2026-09-11 09:59:41 ERROR [http-nio-8080-exec-7] RefDataClient - lookup failed: java.net.SocketTimeoutException: Read timed out',
    '2026-09-11 10:00:03 INFO  [http-nio-8080-exec-2] OrderService - order accepted id=88414',
    '2026-09-11 10:00:31 WARN  [http-nio-8080-exec-7] RefDataClient - slow lookup 1204ms',
    '2026-09-11 10:01:12 ERROR [http-nio-8080-exec-7] RefDataClient - lookup failed: java.net.SocketTimeoutException: Read timed out',
    '2026-09-11 10:01:48 INFO  [scheduler-1] CacheRefresher - refreshed 2841 instruments',
    '2026-09-11 10:02:20 ERROR [http-nio-8080-exec-4] OrderService - null instrument: java.lang.NullPointerException',
    '2026-09-11 10:02:55 INFO  [http-nio-8080-exec-1] OrderService - order accepted id=88415',
    '2026-09-11 10:03:31 ERROR [db-pool-2] PositionDao - java.sql.SQLRecoverableException: No more data to read from socket',
    '2026-09-11 10:04:02 WARN  [db-pool-2] PositionDao - retrying in 5s',
    '2026-09-11 10:04:40 ERROR [db-pool-2] PositionDao - java.sql.SQLRecoverableException: No more data to read from socket',
    '2026-09-11 10:05:14 INFO  [http-nio-8080-exec-6] OrderService - order accepted id=88416',
    '2026-09-11 10:05:51 ERROR [http-nio-8080-exec-4] OrderService - null instrument: java.lang.NullPointerException',
    '2026-09-11 10:06:22 WARN  [db-pool-2] PositionDao - connection pool exhausted, 0 idle',
    '2026-09-11 10:06:58 ERROR [http-nio-8080-exec-9] RefDataClient - lookup failed: java.net.SocketTimeoutException: Read timed out',
    '2026-09-11 10:07:30 INFO  [http-nio-8080-exec-8] OrderService - order accepted id=88417',
    '2026-09-11 10:08:05 ERROR [http-nio-8080-exec-4] OrderService - null instrument: java.lang.NullPointerException'
  ].join('\n');

  /* yesterday's rotated log: 5 ERROR lines among 9 */
  var OLD_LOG = [
    '2026-09-10 16:02:11 INFO  [http-nio-8080-exec-1] OrderService - order accepted id=71204',
    '2026-09-10 16:14:40 ERROR [db-pool-1] PositionDao - java.sql.SQLRecoverableException: closed connection',
    '2026-09-10 16:31:02 INFO  [scheduler-1] CacheRefresher - refreshed 2840 instruments',
    '2026-09-10 16:48:19 ERROR [http-nio-8080-exec-2] RefDataClient - lookup failed: java.net.SocketTimeoutException: Read timed out',
    '2026-09-10 17:02:55 WARN  [http-nio-8080-exec-2] RefDataClient - slow lookup 980ms',
    '2026-09-10 17:19:31 ERROR [http-nio-8080-exec-5] OrderService - null instrument: java.lang.NullPointerException',
    '2026-09-10 17:40:08 ERROR [db-pool-1] PositionDao - java.sql.SQLRecoverableException: closed connection',
    '2026-09-10 17:58:44 INFO  [http-nio-8080-exec-3] OrderService - order accepted id=71880',
    '2026-09-10 18:11:20 ERROR [http-nio-8080-exec-7] RefDataClient - lookup failed: java.net.SocketTimeoutException: Read timed out'
  ].join('\n');

  /* 13 requests: .71 x7, .72 x4, .80 x2; three of them 500s */
  var ACCESS_LOG = [
    '10.14.30.71 - - [11/Sep/2026:10:00:04 +0000] "POST /api/order HTTP/1.1" 200 412',
    '10.14.30.72 - - [11/Sep/2026:10:00:31 +0000] "GET /api/positions HTTP/1.1" 200 8841',
    '10.14.30.71 - - [11/Sep/2026:10:01:12 +0000] "POST /api/order HTTP/1.1" 500 188',
    '10.14.30.80 - - [11/Sep/2026:10:01:40 +0000] "GET /api/health HTTP/1.1" 200 24',
    '10.14.30.71 - - [11/Sep/2026:10:02:20 +0000] "POST /api/order HTTP/1.1" 500 188',
    '10.14.30.72 - - [11/Sep/2026:10:02:58 +0000] "GET /api/positions HTTP/1.1" 200 9104',
    '10.14.30.71 - - [11/Sep/2026:10:03:31 +0000] "POST /api/order HTTP/1.1" 200 412',
    '10.14.30.72 - - [11/Sep/2026:10:04:02 +0000] "GET /api/positions HTTP/1.1" 200 8992',
    '10.14.30.71 - - [11/Sep/2026:10:04:40 +0000] "POST /api/order HTTP/1.1" 500 188',
    '10.14.30.80 - - [11/Sep/2026:10:05:14 +0000] "GET /api/health HTTP/1.1" 200 24',
    '10.14.30.71 - - [11/Sep/2026:10:05:51 +0000] "POST /api/order HTTP/1.1" 200 412',
    '10.14.30.72 - - [11/Sep/2026:10:06:22 +0000] "GET /api/positions HTTP/1.1" 200 8841',
    '10.14.30.71 - - [11/Sep/2026:10:07:30 +0000] "POST /api/order HTTP/1.1" 200 412'
  ].join('\n');

  PS.drills.push({
    id: 'logs-basics',
    title: 'Reading logs',
    topic: 'grep · awk · sed · find',
    host: 'ldn-web-prod05',
    tags: ['grep', 'awk', 'sed', 'find -mmin', 'sort | uniq -c'],

    brief:
      'Nothing is broken. A team lead wants to know whether you can get a\n' +
      'straight answer out of a log directory.\n\n' +
      'Everything lives in /var/log/tradeweb. Ten questions.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 10, 11, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var root = V.dir({
        var: V.dir({
          log: V.dir({
            tradeweb: V.dir({
              // modified 3 minutes ago
              'app.log': V.file(APP_LOG, { owner: 'webadm', group: 'webadm', mtime: ago(180), size: 840 * MB }),
              // modified 18 minutes ago
              'access.log': V.file(ACCESS_LOG, { owner: 'webadm', group: 'webadm', mtime: ago(1080), size: 2411 * MB }),
              // 95 minutes ago
              'gc.log': V.file('[GC pause (G1 Evacuation Pause) (young) 1204M->312M(8192M), 0.0142 secs]',
                { owner: 'webadm', group: 'webadm', mtime: ago(5700), size: 64 * MB }),
              // 3 hours ago
              'app.log.1': V.file(OLD_LOG, { owner: 'webadm', group: 'webadm', mtime: ago(10800), size: 1180 * MB }),
              // 26 hours ago
              'app.log.2.gz': V.file(OLD_LOG, { owner: 'webadm', group: 'webadm', mtime: ago(93600), size: 210 * MB })
            }),
            messages: V.file('Sep 11 08:00:01 ldn-web-prod05 systemd: Started Session 4120.',
              { owner: 'root', mtime: ago(7800), size: 40 * MB })
          })
        }),
        apps: V.dir({
          tradeweb: V.dir({
            conf: V.dir({
              'tradeweb.properties': V.file('server.port=8080\nlog.dir=/var/log/tradeweb\nlog.rotate=daily\n',
                { owner: 'webadm', mtime: ago(400000) })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'cheatsheet.txt': V.file(
              'LOG READING CHEAT SHEET\n' +
              '=======================\n' +
              '  grep -c PATTERN file        count matching LINES\n' +
              '  grep -o PATTERN file        print each MATCH on its own line\n' +
              '  grep -i / -v / -n           ignore case / invert / line numbers\n' +
              '  zgrep ... file.gz           same, without gunzipping first\n' +
              '  awk \'{print $4}\' file       print the 4th whitespace field\n' +
              '  sed \'/INFO/d\' file          delete matching lines\n' +
              '  sed -n \'10,20p\' file        print a line range\n' +
              '  sort | uniq -c | sort -rn   the "count and rank" idiom\n' +
              '  find DIR -type f -mmin -30  files modified in the last 30 minutes\n' +
              '  find DIR -type f -mtime -1  ... in the last day\n' +
              '  ls -lSh DIR                 list by size, largest first\n',
              { owner: 'gsupport', mtime: ago(200000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      return W.create({
        host: 'ldn-web-prod05', user: 'gsupport', clock: t0, seed: 5150,
        bootSeconds: 3600 * 24 * 12, cores: 8, users: 2,
        load: [0.31, 0.28, 0.30],
        mem: { total: 32 * GB, free: 18 * GB, buffers: 220 * MB, cached: 6 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 3.1, sy: 0.8, ni: 0, id: 95.9, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 9 * GB, inodes: { total: 26214400, used: 142008 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 48 * GB, inodes: { total: 104857600, used: 38412 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.4 * GB, inodes: { total: 10485760, used: 1102 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 140 }),
          W.proc({ pid: 1601, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 12 }),
          W.proc({ pid: 3140, user: 'webadm', short: 'java', cpu: 6.2, rss: 7 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -jar /apps/tradeweb/lib/tradeweb.jar',
            started: new Date(2026, 8, 11, 6, 0, 4), cpuSeconds: 940,
            fds: [{ fd: 1, path: '/var/log/tradeweb/app.log', mode: 'w', size: 840 * MB }] }),
          W.proc({ pid: 12040, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 3140, fd: 11, proto: 'tcp', local: '0.0.0.0:8080', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1601, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        diskio: [{ dev: 'dm-1', rs: 2.1, ws: 40.2, readKB: 30.1, writeKB: 620.4, await: 0.5, util: 2.1 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.65/24', rxOk: 41200884, txOk: 38812004, rxBytes: 8412004120, txBytes: 7120044120 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 8412, txOk: 8412, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [8080, 22], rtt: 0.02 } },
        services: { tradeweb: { active: true, pid: 3140, exe: 'java', desc: 'Trade Web front end' } },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'Count ERROR lines',
        ask: 'How many ERROR lines are there in /var/log/tradeweb/app.log?',
        answer: '8',
        hint: 'grep -c prints the number of matching lines instead of the lines themselves.',
        solution: 'grep -c ERROR /var/log/tradeweb/app.log',
        teaches: 'grep -c counts matching LINES, not matches. A line with two hits still counts once - that catches people out.'
      },
      {
        short: 'Distinct exception classes',
        ask: 'How many DISTINCT Java exception classes appear in app.log?',
        note: 'Count class names like SocketTimeoutException, not the number of occurrences.',
        answer: '3',
        hint: 'grep -o prints each match on its own line. Then the classic pipeline: sort -u to dedupe, wc -l to count.',
        solution: 'grep -o "[A-Za-z]*Exception" /var/log/tradeweb/app.log | sort -u | wc -l',
        teaches: 'grep -o turns "find lines" into "extract values". It is the start of almost every log-mining one-liner.'
      },
      {
        short: 'Time of first ERROR',
        ask: 'What time did the FIRST error occur? (HH:MM:SS)',
        answers: ['09:59:41'],
        hint: 'Filter to errors, take the first one, then pull out the field you want.',
        solution: 'grep ERROR /var/log/tradeweb/app.log | head -1 | awk \'{print $2}\'',
        teaches: 'grep to filter, head to take one, awk to extract a field. Three small tools beat one clever regex.'
      },
      {
        short: 'Thread of last ERROR',
        ask: 'Which thread logged the LAST error in app.log?',
        answers: ['[http-nio-8080-exec-4]', 'http-nio-8080-exec-4'],
        hint: 'Same shape as the last one, but tail instead of head. The thread is the 4th whitespace field.',
        solution: 'grep ERROR /var/log/tradeweb/app.log | tail -1 | awk \'{print $4}\'',
        teaches: 'awk splits on runs of whitespace by default, so $1=date $2=time $3=level $4=thread. Count the fields once and the rest is free.'
      },
      {
        short: 'Busiest thread',
        ask: 'Which thread appears most often across the whole of app.log?',
        answers: ['[db-pool-2]', 'db-pool-2'],
        hint: 'Extract the thread from every line, then use the count-and-rank idiom: sort | uniq -c | sort -rn.',
        solution: 'awk \'{print $4}\' /var/log/tradeweb/app.log | sort | uniq -c | sort -rn | head -3',
        teaches: 'sort | uniq -c | sort -rn is the single most useful pipeline in support work. uniq only collapses ADJACENT duplicates, which is why it must be sorted first.'
      },
      {
        short: 'Files changed in 30 min',
        ask: 'How many files under /var/log/tradeweb were modified in the last 30 minutes?',
        answer: '2',
        hint: 'find has -mmin for minutes and -mtime for days. A leading minus means "less than".',
        solution: 'find /var/log/tradeweb -type f -mmin -30 | wc -l',
        teaches: '-mmin -30 is "modified less than 30 minutes ago"; -mmin +30 is more than. Plain -mmin 30 means exactly the 30th minute, which is almost never what you want.'
      },
      {
        short: 'Lines without INFO',
        ask: 'If you strip out every INFO line from app.log, how many lines remain?',
        answer: '12',
        hint: 'sed can delete lines matching a pattern: sed \'/PATTERN/d\'. Then count what is left.',
        solution: 'sed \'/INFO/d\' /var/log/tradeweb/app.log | wc -l',
        teaches: 'sed \'/x/d\' deletes, grep -v excludes - same result here. sed earns its keep when you need to edit the line as well as select it.'
      },
      {
        short: 'ERRORs in the rotated .gz',
        ask: 'How many ERROR lines are in the rotated log app.log.2.gz?',
        answer: '5',
        hint: 'You do not need to gunzip it. There is a z-prefixed version of grep.',
        solution: 'zgrep -c ERROR /var/log/tradeweb/app.log.2.gz',
        teaches: 'zgrep, zcat and zless read gzipped files directly. On a full filesystem this matters - gunzip would need the space twice.'
      },
      {
        short: 'Busiest client IP',
        ask: 'Which client IP made the most requests in access.log?',
        answer: '10.14.30.71',
        hint: 'The IP is the first field. Then count and rank.',
        solution: 'awk \'{print $1}\' /var/log/tradeweb/access.log | sort | uniq -c | sort -rn | head -1',
        teaches: 'Same pipeline as the busiest thread. Once you have the idiom, "who is hammering us" is a ten second question.'
      },
      {
        short: 'Count HTTP 500s',
        ask: 'How many requests in access.log returned HTTP 500?',
        answer: '3',
        hint: 'The status code is the 9th field in the combined log format. Extract it, then count the 500s.',
        solution: 'awk \'{print $9}\' /var/log/tradeweb/access.log | grep -c 500',
        teaches: 'Pulling the field out first avoids false positives - a plain grep 500 would also match a response size of 500 bytes or an id containing 500.'
      },
      {
        short: 'Lines in one minute',
        ask: 'How many lines were logged during the 10:02 minute?',
        answer: '2',
        hint: 'The timestamp is plain text in every line. Match the minute, not the second.',
        solution: 'grep -c "10:02" /var/log/tradeweb/app.log',
        teaches: 'Matching a timestamp prefix is the cheapest way to window a log. For a range across minutes, an extended pattern like grep -cE "10:0[1-4]" is usually quicker than reaching for awk.'
      },
      {
        short: 'Line after an exception',
        ask: 'What did the application log on the line immediately AFTER the first SQLRecoverableException?',
        note: 'Give the message text, e.g. "doing something 5s".',
        answers: ['retrying in 5s', 'PositionDao - retrying in 5s'],
        hint: 'grep -A N prints N lines of context after each match (-B for before, -C for both).',
        solution: 'grep -A1 SQLRecoverableException /var/log/tradeweb/app.log | head -2',
        teaches: 'An exception on its own rarely tells you what happened next. -A and -B turn grep from a search into a narrative, and are the fastest way to see whether the app recovered or gave up.'
      },
      {
        short: 'Lines from one class',
        ask: 'How many lines were logged by OrderService?',
        answer: '9',
        hint: 'The logger name is just text on the line - count matching lines.',
        solution: 'grep -c OrderService /var/log/tradeweb/app.log',
        teaches: 'Counting per component is how you answer "is this one subsystem or the whole app". Compare counts across loggers before you go deeper.'
      },
      {
        short: 'Which files contain a pattern',
        ask: 'How many files in /var/log/tradeweb contain NullPointerException?',
        answer: '3',
        hint: 'grep -l prints the NAMES of matching files rather than the matching lines. A glob will expand to every file in the directory.',
        solution: 'grep -l NullPointerException /var/log/tradeweb/* | wc -l',
        teaches: 'grep -l stops reading each file at the first hit, so it is fast over a big directory. It answers "how far back does this go" in one command.'
      },
      {
        short: 'Files over 1GB',
        ask: 'How many files in /var/log/tradeweb are larger than 1GB?',
        answer: '2',
        hint: 'find -size takes a unit suffix; a leading plus means "greater than".',
        solution: 'find /var/log/tradeweb -type f -size +1G | wc -l',
        teaches: 'Suffixes are c, k, M, G. With no suffix find counts 512-byte blocks, so -size +1 means "bigger than 512 bytes" and matches nearly everything.'
      }
    ],

    wrapUp:
      'Four shapes cover most log work:\n\n' +
      '  COUNT      grep -c PATTERN file\n' +
      '  EXTRACT    grep -o PATTERN file      or   awk \'{print $N}\' file\n' +
      '  RANK       ... | sort | uniq -c | sort -rn | head\n' +
      '  NARROW     find DIR -type f -mmin -30\n\n' +
      'Under pressure, resist writing one clever command. Filter, extract, count -\n' +
      'three simple stages you can check as you build them.'
  });
})(PS);
