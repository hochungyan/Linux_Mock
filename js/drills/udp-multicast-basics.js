/* BASICS: UDP and multicast - the shape of market data plumbing.
 *
 * UDP has no connection to look at, so the questions are different: which
 * groups are we joined to, is the socket being drained, and is the kernel
 * dropping anything.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  PS.drills.push({
    id: 'udp-multicast-basics',
    title: 'UDP and multicast',
    topic: 'ss -u · netstat -g · market data',
    host: 'ldn-mdata-prod09',
    tags: ['ss -uanp', 'netstat -g', 'netstat -su', 'Recv-Q', 'tcpdump'],

    brief:
      'A market data receiver, working normally.\n\n' +
      'UDP has no connection state to inspect, so you ask different questions:\n' +
      'which groups are we joined to, is the application draining its socket,\n' +
      'and is the kernel dropping anything.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 13, 40, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var root = V.dir({
        apps: V.dir({
          mdrecv: V.dir({
            conf: V.dir({
              'feeds.conf': V.file(
                '# line A is primary, line B is the arbitrated backup\n' +
                'feed.a.group=233.71.14.20\n' +
                'feed.a.port=14310\n' +
                'feed.b.group=233.71.14.21\n' +
                'feed.b.port=14311\n' +
                'feed.interface=eth1\n' +
                'socket.rcvbuf=8388608\n', { owner: 'mdadm', mtime: ago(400000) })
            })
          })
        }),
        var: V.dir({
          log: V.dir({
            mdrecv: V.dir({
              'mdrecv.log': V.file(
                '2026-09-11 13:39:12 INFO  [feed-a] FeedSession - seq 44120884 ok, gaps=0\n' +
                '2026-09-11 13:39:42 INFO  [feed-b] FeedSession - seq 44120884 ok, gaps=0\n' +
                '2026-09-11 13:40:00 INFO  [arb] Arbitrator - line A leading by 0 messages',
                { owner: 'mdadm', mtime: ago(30), size: 220 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'udp-notes.txt': V.file(
              'UDP AND MULTICAST NOTES\n' +
              '=======================\n' +
              'UDP has no handshake, but connect() can set a default peer and ss\n' +
              'may label that ESTAB. ss -uanp includes unconnected sockets: UNCONN\n' +
              'for a UDP socket that is bound but not connect()ed - which is normal\n' +
              'for a receiver, not a fault.\n' +
              '\n' +
              'WHAT TO CHECK, IN ORDER\n' +
              '  1. Are we joined to the group?   netstat -g   /   ip maddr show\n' +
              '  2. Is traffic arriving on the NIC? ip -s link  /  netstat -i\n' +
              '  3. Is the app draining the socket? ss -uanp  (watch Recv-Q)\n' +
              '  4. Is the kernel dropping?         netstat -su  (receive errors)\n' +
              '  5. Is it really on the wire?       tcpdump -i eth1 -n\n' +
              '\n' +
              'UDP Recv-Q reflects receive queue memory, including packet overhead;\n' +
              'it is not simply application payload bytes. Briefly non-zero is\n' +
              'normal. Persistent growth with rising receive-buffer errors means\n' +
              'the receiver is not keeping up. UDP does not retransmit; market-data\n' +
              'applications may use a separate gap recovery/replay service.\n',
              { owner: 'gsupport', mtime: ago(300000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), proc: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      return W.create({
        host: 'ldn-mdata-prod09', user: 'gsupport', clock: t0, seed: 14310,
        bootSeconds: 3600 * 24 * 9, cores: 16, users: 2,
        load: [1.04, 1.01, 0.98],
        mem: { total: 64 * GB, free: 40 * GB, buffers: 200 * MB, cached: 6 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 8.1, sy: 2.2, ni: 0, id: 89.5, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 11 * GB, inodes: { total: 26214400, used: 160002 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 30 * GB, inodes: { total: 104857600, used: 22104 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 880 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 160 }),
          W.proc({ pid: 1615, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 14 }),
          W.proc({ pid: 7204, user: 'mdadm', short: 'mdrecv', cpu: 12.4, rss: 4 * GB,
            cmd: '/apps/mdrecv/bin/mdrecv --config /apps/mdrecv/conf/feeds.conf',
            started: new Date(2026, 8, 11, 6, 15, 0), cpuSeconds: 3200,
            fds: [{ fd: 1, path: '/var/log/mdrecv/mdrecv.log', mode: 'w', size: 220 * MB }] }),
          W.proc({ pid: 14880, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 7204, fd: 14, proto: 'udp', local: '233.71.14.20:14310', peer: '*:*', state: 'UNCONN', recvq: 4352, sendq: 0 },
          { pid: 7204, fd: 15, proto: 'udp', local: '233.71.14.21:14311', peer: '*:*', state: 'UNCONN', recvq: 2176, sendq: 0 },
          { pid: 7204, fd: 16, proto: 'udp', local: '0.0.0.0:9999', peer: '*:*', state: 'UNCONN', recvq: 0, sendq: 0 },
          { pid: 7204, fd: 20, proto: 'tcp', local: '0.0.0.0:8500', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 1615, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        netstat: {
          udpReceived: 4412008841, udpSent: 88120, udpErrors: 2104, udpRcvbufErrors: 2104,
          udpNoPort: 0, udpSndbufErrors: 0, tcpActive: 412, tcpRetrans: 8
        },
        diskio: [{ dev: 'dm-1', rs: 1.2, ws: 22.4, readKB: 18.1, writeKB: 340.2, await: 0.4, util: 1.2 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.69/24', rxOk: 41200884, txOk: 38812004,
            rxBytes: 8412004120, txBytes: 7120044120, mcast: 0,
            groups: [{ addr: '224.0.0.1', refcnt: 1 }] },
          // the feed NIC: four groups, huge RX, no drops
          { name: 'eth1', addr: '10.14.90.69/24', rxOk: 4412008841, txOk: 41204,
            rxBytes: 881200441200, txBytes: 4120884, mcast: 4412008841, rxDrop: 0, rxErr: 0,
            groups: [
              { addr: '233.71.14.20', refcnt: 1 },
              { addr: '233.71.14.21', refcnt: 1 },
              { addr: '233.71.14.30', refcnt: 1 },
              { addr: '224.0.0.1', refcnt: 1 }
            ] },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 9120, txOk: 9120, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [8500, 22], rtt: 0.02 } },
        services: { mdrecv: { active: true, pid: 7204, exe: 'mdrecv', desc: 'Market Data Receiver' } },
        tcpdump: function (world) {
          var base = world.clock.getTime();
          var out = [];
          for (var i = 0; i < 8; i++) {
            var d = new Date(base - (8 - i) * 3);
            out.push(W.clockStr(d) + '.' + ('00000' + (i * 20411 % 999999)).slice(-6) +
              ' IP 196.4.12.' + (10 + i % 3) + '.14310 > 233.71.14.20.14310: UDP, length ' + (176 + i * 9));
          }
          out.push('');
          out.push('8 packets captured');
          out.push('8 packets received by filter');
          out.push('0 packets dropped by kernel');
          return out.join('\n');
        },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'Multicast groups on eth1',
        ask: 'How many multicast groups is eth1 joined to?',
        answer: '4',
        hint: 'netstat -g lists group memberships per interface. Count the eth1 rows.',
        solution: 'netstat -g | grep -c eth1',
        teaches: 'If we are not in the group the switch never sends us the traffic, and everything downstream looks "frozen" with no error anywhere. Check membership first.'
      },
      {
        short: 'Group for port 14310',
        ask: 'Which multicast group is bound to port 14310?',
        answer: '233.71.14.20',
        hint: 'ss -uanp shows UDP sockets with their local address. u=udp, n=numeric, p=process.',
        solution: 'ss -uanp | grep 14310',
        teaches: 'This receiver binds to the multicast group. Other receivers bind 0.0.0.0 and join the group on an interface; the bind address alone does not prove membership. Use ip maddr and application configuration too.'
      },
      {
        short: 'UDP socket state',
        ask: 'What state does ss report for a bound UDP socket, where TCP would say ESTABLISHED?',
        answers: ['unconn', 'unconnected'],
        hint: 'Run ss on the UDP sockets and read the State column. UDP has no handshake, so there is no connection to establish.',
        solution: 'ss -uan | head -4',
        teaches: 'UNCONN is normal for a receiver, not a fault. People page the network team over it every week.'
      },
      {
        short: 'Recv-Q on the primary feed',
        ask: 'What is the Recv-Q on the primary feed socket (port 14310)?',
        answer: '4352',
        hint: 'Recv-Q is the second column of ss output - bytes the kernel is holding that the app has not read yet.',
        solution: 'ss -uanp | grep 14310',
        teaches: 'Recv-Q is your "is the application keeping up" gauge. A small changing number is healthy. Pinned at the socket buffer size means it has stopped reading.'
      },
      {
        short: 'UDP receive errors',
        ask: 'How many UDP packet receive errors has this host recorded?',
        answer: '2104',
        hint: 'netstat -su prints the UDP counters, including receive errors and receive buffer errors.',
        solution: 'netstat -su | grep -i "receive errors"',
        teaches: 'For UDP these are dropped packets, and UDP never retransmits - that data is gone. On a market data feed, every one of these is a missed tick.'
      },
      {
        short: 'Which NIC carries the feed',
        ask: 'Which interface is actually receiving the multicast traffic?',
        answer: 'eth1',
        hint: 'Compare the RX counters across interfaces - the feed NIC will be orders of magnitude busier.',
        solution: 'netstat -i',
        teaches: 'Market data usually arrives on a dedicated NIC. Checking counters on the wrong interface is the most common wasted five minutes in a feed incident.'
      },
      {
        short: 'NIC-level drops',
        ask: 'How many packets has eth1 dropped at the interface (RX-DRP)?',
        answer: '0',
        hint: 'netstat -i has RX-OK, RX-ERR and RX-DRP columns. ip -s link shows the same figures.',
        solution: 'netstat -i',
        teaches: 'Drops at the NIC and drops at the socket are different faults. NIC drops point at the ring buffer or the network; socket drops point at your application not reading fast enough.'
      },
      {
        short: 'Prove packets are arriving',
        ask: 'Capture from the feed: how many packets does tcpdump report as captured?',
        answer: '8',
        hint: 'tcpdump -i eth1 -n, and use -c to stop after a fixed number of packets.',
        solution: 'tcpdump -i eth1 -n -c 8 host 233.71.14.20',
        teaches: 'This is the end of the argument. If tcpdump sees the packets, the network delivered them and the problem is above the kernel - yours.'
      },
      {
        short: 'Configured receive buffer',
        ask: 'What socket receive buffer size is configured for the feed, in bytes?',
        answer: '8388608',
        hint: 'The receiver config is in /apps/mdrecv/conf/feeds.conf. Look for rcvbuf.',
        solution: 'grep rcvbuf /apps/mdrecv/conf/feeds.conf',
        teaches: 'This is the ceiling Recv-Q can reach before the kernel starts discarding. It is also capped by net.core.rmem_max - asking for 8MB when the kernel allows 208KB silently gives you 208KB.'
      },
      {
        short: 'Does UDP retransmit',
        ask: 'If a UDP packet is dropped, does the protocol retransmit it? Answer yes or no.',
        answers: ['no', 'it does not', 'no it does not'],
        hint: 'Read the Recv-Q paragraph at the end of /home/gsupport/udp-notes.txt.',
        solution: 'grep -A3 "does not retransmit" /home/gsupport/udp-notes.txt',
        teaches: 'No retransmission, no acknowledgement, no ordering. That is why exchanges publish the same feed twice on two lines - arbitration between A and B is the recovery mechanism, because the protocol has none.'
      },
      {
        short: 'UDP sockets held',
        ask: 'How many UDP sockets does the receiver process (PID 7204) have open?',
        answer: '3',
        hint: 'ss -uanp shows UDP sockets with the owning process. Count the ones belonging to that pid.',
        solution: 'ss -uanp | grep -c 7204',
        teaches: 'Two feed lines plus a stats socket. Knowing the expected count means you notice immediately when the process failed to join one of the groups at startup.'
      },
      {
        short: 'Backup line port',
        ask: 'Which UDP port does the backup feed (line B) use?',
        answer: '14311',
        hint: 'Either read the config in /apps/mdrecv/conf/feeds.conf, or look at the second UDP socket in ss.',
        solution: 'grep feed.b /apps/mdrecv/conf/feeds.conf',
        teaches: 'A and B carry identical data by different paths. When one line gaps, the arbitrator fills from the other - so "line A has gaps" is only an incident if B has them too.'
      }
    ],

    wrapUp:
      'UDP triage, top to bottom:\n\n' +
      '  netstat -g        are we joined to the group?\n' +
      '  netstat -i        is the NIC receiving, and is it dropping?\n' +
      '  ss -uanp           is the application draining the socket? (Recv-Q)\n' +
      '  netstat -su       is the kernel dropping? (receive errors)\n' +
      '  tcpdump -i ethN   is it genuinely on the wire?\n\n' +
      'The single most useful distinction: drops at the NIC are a network or\n' +
      'ring-buffer problem; a pinned Recv-Q with a climbing "receive buffer\n' +
      'errors" count is YOUR application failing to read. They look identical on\n' +
      'a dashboard and they go to different teams.'
  });
})(PS);
