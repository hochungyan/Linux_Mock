/* BASICS: TCP connections - ss, netstat, connection states, nc.
 *
 * "Who is listening, who is connected, and what does CLOSE_WAIT mean" is asked
 * in almost every support interview, and answered badly in most of them.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  PS.drills.push({
    id: 'tcp-basics',
    title: 'TCP connections',
    topic: 'ss · netstat · connection states',
    host: 'ldn-fix-prod08',
    tags: ['ss -tlnp', 'netstat -an', 'CLOSE_WAIT', 'nc -zv'],

    brief:
      'A healthy order gateway with live client sessions.\n\n' +
      'Eight questions about who is listening, who is connected, and what the\n' +
      'connection states are telling you.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 11, 24, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var sockets = [
        { pid: 4820, fd: 11, proto: 'tcp', local: '0.0.0.0:9310', peer: '0.0.0.0:*', state: 'LISTEN' },
        { pid: 4820, fd: 12, proto: 'tcp', local: '0.0.0.0:9975', peer: '0.0.0.0:*', state: 'LISTEN' },
        { pid: 1622, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
      ];

      // 9 inbound client sessions on 9310: .71 x4, .72 x3, .80 x2
      var clients = [
        ['10.14.30.71', 4], ['10.14.30.72', 3], ['10.14.30.80', 2]
      ];
      var fd = 20, port = 44100;
      clients.forEach(function (c) {
        for (var i = 0; i < c[1]; i++) {
          sockets.push({
            pid: 4820, fd: fd++, proto: 'tcp',
            local: '10.14.22.68:9310', peer: c[0] + ':' + (port++),
            state: 'ESTABLISHED', recvq: 0, sendq: 0
          });
        }
      });

      // 2 healthy outbound sessions to the database
      sockets.push({ pid: 4820, fd: fd++, proto: 'tcp', local: '10.14.22.68:52104', peer: '10.14.40.21:1521', state: 'ESTABLISHED', recvq: 0, sendq: 0 });
      sockets.push({ pid: 4820, fd: fd++, proto: 'tcp', local: '10.14.22.68:52106', peer: '10.14.40.21:1521', state: 'ESTABLISHED', recvq: 0, sendq: 0 });

      // 5 sockets the application never closed after the peer went away
      for (var k = 0; k < 5; k++) {
        sockets.push({
          pid: 4820, fd: fd++, proto: 'tcp',
          local: '10.14.22.68:' + (52200 + k), peer: '10.14.40.21:1521',
          state: 'CLOSE_WAIT', recvq: 1, sendq: 0
        });
      }

      // 3 in TIME_WAIT, which are harmless and there to be distinguished
      for (var m = 0; m < 3; m++) {
        sockets.push({
          pid: 4820, fd: 0, proto: 'tcp',
          local: '10.14.22.68:9310', peer: '10.14.30.71:' + (43000 + m),
          state: 'TIME_WAIT', recvq: 0, sendq: 0
        });
      }

      var root = V.dir({
        apps: V.dir({
          fixgw: V.dir({
            conf: V.dir({
              'fixgw.properties': V.file('fix.port=9310\nadmin.port=9975\ndb.host=refdata-db\ndb.port=1521\n',
                { owner: 'fixadm', mtime: ago(500000) })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            fixgw: V.dir({
              'fixgw-app.log': V.file(
                '2026-09-11 11:20:04 INFO  [main] Gateway - listening on 9310\n' +
                '2026-09-11 11:22:41 INFO  [session-1] Session - 9 client sessions logged on',
                { owner: 'fixadm', mtime: ago(120), size: 180 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'tcp-states.txt': V.file(
              'TCP STATES YOU WILL ACTUALLY SEE\n' +
              '================================\n' +
              '  LISTEN       waiting for connections\n' +
              '  ESTABLISHED  open and usable\n' +
              '  SYN_SENT     we tried to connect and got no answer yet\n' +
              '               (investigate loss, routing, filtering and the peer)\n' +
              '  CLOSE_WAIT   the REMOTE end sent FIN; our application has not\n' +
              '               closed its side yet. Brief half-close is valid;\n' +
              '               persistent growth suggests a cleanup/FD leak.\n' +
              '  TIME_WAIT    usually the LOCAL active closer (also simultaneous\n' +
              '               close). Normal protection against old segments;\n' +
              '               extreme churn can pressure ephemeral ports.\n' +
              '  FIN_WAIT_2   we closed, waiting for their FIN\n' +
              '\n' +
              'COMMANDS\n' +
              '  ss -tlnp             TCP, listening, numeric, with process\n' +
              '  ss -tnp              TCP, connected, numeric, with process\n' +
              '  netstat -anp         the older equivalent, all sockets\n' +
              '  netstat -s           protocol counters (retransmits, resets)\n' +
              '  nc -zv HOST PORT     is that port reachable from here\n',
              { owner: 'gsupport', mtime: ago(300000) })
          })
        }),
        etc: V.dir({
          'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }),
          hosts: V.file('127.0.0.1   localhost\n10.14.22.68 ldn-fix-prod08\n10.14.40.21 refdata-db\n',
            { owner: 'root', mtime: ago(800000) })
        }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      return W.create({
        host: 'ldn-fix-prod08', user: 'gsupport', clock: t0, seed: 9310,
        bootSeconds: 3600 * 24 * 18, cores: 16, users: 3,
        load: [0.88, 0.91, 0.84],
        mem: { total: 64 * GB, free: 44 * GB, buffers: 180 * MB, cached: 5 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 4.2, sy: 1.1, ni: 0, id: 94.5, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 10 * GB, inodes: { total: 26214400, used: 180402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 22 * GB, inodes: { total: 104857600, used: 30112 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 902 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 220 }),
          W.proc({ pid: 1622, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 18 }),
          W.proc({ pid: 4820, user: 'fixadm', short: 'java', cpu: 5.4, rss: 9 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -Dapp=fixgw -jar /apps/fixgw/lib/fixgw.jar',
            started: new Date(2026, 8, 11, 6, 4, 2), cpuSeconds: 1840,
            fds: [{ fd: 1, path: '/var/log/fixgw/fixgw-app.log', mode: 'w', size: 180 * MB }] }),
          W.proc({ pid: 13990, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: sockets,
        netstat: {
          tcpActive: 88213, tcpPassive: 4412, tcpFailed: 12, tcpReset: 331,
          tcpRetrans: 1842, ipReceived: 918273645, udpReceived: 4120, udpErrors: 0
        },
        diskio: [{ dev: 'dm-1', rs: 1.8, ws: 38.4, readKB: 24.2, writeKB: 480.1, await: 0.4, util: 1.8 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.68/24', rxOk: 412008841, txOk: 388120044, rxBytes: 88120044120, txBytes: 74120088412 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 12004, txOk: 12004, mtu: 65536 }
        ],
        dmesg: [],
        hosts: {
          localhost: { ip: '127.0.0.1', ports: [9310, 9975, 22], rtt: 0.02 },
          'refdata-db': { ip: '10.14.40.21', ports: [1521], rtt: 0.31, ttl: 63 },
          'ldn-fix-prod08': { ip: '10.14.22.68', ports: [9310, 9975, 22], rtt: 0.02 }
        },
        services: { fixgw: { active: true, pid: 4820, exe: 'java', desc: 'FIX Order Gateway' } },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'PID listening on 9310',
        ask: 'Which PID is listening on TCP port 9310?',
        answer: '4820',
        hint: 'ss -tlnp: t=tcp, l=listening, n=numeric ports, p=show the process.',
        solution: 'ss -tlnp | grep 9310',
        teaches: 'Always add -n. Without it the tool resolves ports to names and DNS for every peer, which is slow and hides the number you wanted.'
      },
      {
        short: 'Ports the gateway listens on',
        ask: 'How many TCP ports is PID 4820 listening on?',
        answer: '2',
        hint: 'List the listening sockets with the process, then count the ones belonging to that pid.',
        solution: 'ss -tlnp | grep -c 4820',
        teaches: 'Most server processes listen on more than one port - the service port and an admin/metrics port. Knowing both saves you a round trip.'
      },
      {
        short: 'ESTABLISHED count',
        ask: 'How many TCP connections are in state ESTABLISHED?',
        answer: '11',
        hint: 'ss abbreviates the state to ESTAB. Count the lines that show it.',
        solution: 'ss -tn | grep -c ESTAB',
        teaches: 'ss prints ESTAB, netstat prints ESTABLISHED. Grepping for "ESTAB" matches both; grepping for "ESTABLISHED" silently misses every ss result.'
      },
      {
        short: 'CLOSE_WAIT count',
        ask: 'How many sockets are sitting in CLOSE_WAIT?',
        answer: '5',
        hint: 'netstat -an lists every socket with its state. Count the CLOSE_WAIT lines.',
        solution: 'netstat -an | grep -c CLOSE_WAIT',
        teaches: 'CLOSE_WAIT means the peer sent FIN and the local application has not finished closing. Brief half-close is valid; persistent accumulation points to cleanup problems and can exhaust descriptors.'
      },
      {
        short: 'Who sent FIN first',
        ask: 'In CLOSE_WAIT, which end has already sent its FIN - local or remote?',
        note: 'Answer "local" or "remote".',
        answers: ['remote', 'the remote', 'remote end', 'peer', 'far end', 'the peer'],
        hint: 'There is a note in /home/gsupport/tcp-states.txt. Think about which side is being waited on.',
        solution: 'cat /home/gsupport/tcp-states.txt',
        teaches: 'The remote end sent FIN; local close is pending. A brief half-close is normal. TIME_WAIT usually follows an active local close, or simultaneous close, and protects against delayed segments.'
      },
      {
        short: 'Busiest client IP',
        ask: 'Which client IP has the most connections to port 9310?',
        answer: '10.14.30.71',
        hint: 'Filter to 9310, take the foreign address field, strip the port, then count and rank.',
        solution: 'netstat -an | grep 9310 | awk \'{print $5}\' | cut -d: -f1 | sort | uniq -c | sort -rn | head -3',
        teaches: 'cut -d: -f1 strips the ephemeral port so connections from one host group together. Same count-and-rank idiom as the log drill.'
      },
      {
        short: 'TCP retransmits',
        ask: 'How many TCP segments have been retransmitted since boot?',
        answer: '1842',
        hint: 'netstat -s prints per-protocol counters. Search its output for "retrans".',
        solution: 'netstat -s | grep -i retrans',
        teaches: 'These are counters since boot, not a rate. One reading means nothing - take two a minute apart and compare, or it is just a big number.'
      },
      {
        short: 'Which DB port is open',
        ask: 'Which of these two ports is actually open on refdata-db: 1521 or 1522?',
        answer: '1521',
        hint: 'nc -zv HOST PORT tests a port without sending data. -z = scan only, -v = tell me what happened.',
        solution: 'nc -zv refdata-db 1521',
        teaches: 'A successful TCP connect proves transport reachability, not database or FIX health. Refused means active rejection (no listener or reject rule); timeout can involve loss, routing, silent filtering or the peer.'
      },
      {
        short: 'TIME_WAIT count',
        ask: 'How many sockets are in TIME_WAIT?',
        answer: '3',
        hint: 'Same shape as the CLOSE_WAIT count, different state.',
        solution: 'netstat -an | grep -c TIME_WAIT',
        teaches: 'TIME_WAIT is normal, generally around 60 seconds on Linux. High churn can still contribute to ephemeral-port pressure; correlate counts, connection rate and errors instead of treating all counts as harmless.'
      },
      {
        short: 'Who closed in TIME_WAIT',
        ask: 'For the ordinary active-close case shown here, which end initiated close on a socket now in TIME_WAIT - local or remote?',
        answers: ['local', 'us', 'we did', 'we closed', 'our side', 'local end'],
        hint: 'TIME_WAIT is the mirror image of CLOSE_WAIT. The notes in /home/gsupport/tcp-states.txt say which side each one implicates.',
        solution: 'grep -A2 TIME_WAIT /home/gsupport/tcp-states.txt',
        teaches: 'CLOSE_WAIT awaits local application close after a peer FIN. TIME_WAIT usually belongs to the active closer; simultaneous close is an exception to a simple local-versus-remote rule.'
      },
      {
        short: 'Listening socket count',
        ask: 'How many TCP sockets are in LISTEN on this host?',
        answer: '3',
        hint: 'ss -tln lists listening TCP sockets. Count them.',
        solution: 'ss -tln | grep -c LISTEN',
        teaches: 'Knowing what a box listens on is the start of any security or connectivity review. 0.0.0.0 means every interface; a specific IP means only that one, which is a common reason a client cannot connect.'
      },
      {
        short: 'Refused, exactly',
        ask: 'Test port 1522 on refdata-db. What exactly does the connection attempt report?',
        answers: ['connection refused', 'refused'],
        hint: 'nc -zv prints the precise failure. The wording is the diagnosis.',
        solution: 'nc -zv refdata-db 1522',
        teaches: 'Refused indicates an active rejection. A missing listener is common, but a firewall or intermediary can reject too. Check listener, bind address and filtering; neither refusal nor timeout identifies the responsible team by itself.'
      },
      {
        short: 'Admin port from config',
        ask: 'Which TCP port is the gateway admin interface configured on?',
        answer: '9975',
        hint: 'The application config is under /apps/fixgw/conf. grep it for the admin setting.',
        solution: 'grep admin /apps/fixgw/conf/fixgw.properties',
        teaches: 'Cross-checking the config against what is actually listening catches the case where a service came up with a stale config - the listener and the file disagree.'
      }
    ],

    wrapUp:
      'ss -tlnp   who is LISTENING here\n' +
      'ss -tnp    who is CONNECTED to us, and from where\n' +
      'netstat -s protocol counters - retransmits, resets, buffer errors\n' +
      'nc -zv     can I reach that port from this box\n\n' +
      'The three replies to a connection attempt are the whole diagnosis:\n' +
      '  connected           the port is open\n' +
      '  connection refused  host is up, nothing is listening - app problem\n' +
      '  timed out           firewall dropping, or host is down - network problem\n\n' +
      '"Refused" and "timed out" send you to two different teams. Never report\n' +
      '"I cannot connect" without saying which one you got.'
  });
})(PS);
