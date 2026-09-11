/* BASICS: IP addressing, routing, DNS, ARP, MTU.
 *
 * The layer below "is the port open". Most connectivity escalations are settled
 * by four commands: ip addr, ip route, ping, nc -zv - and by knowing which of
 * the three possible answers to a connection attempt you actually got.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];

  var GB = 1073741824, MB = 1048576;

  var NOTES =
    'IP, SUBNETS AND ROUTING\n' +
    '=======================\n' +
    'CIDR AND USABLE HOSTS\n' +
    '  /24  255.255.255.0    256 addresses,  254 usable\n' +
    '  /25  255.255.255.128  128 addresses,  126 usable\n' +
    '  /26  255.255.255.192   64 addresses,   62 usable\n' +
    '  /27  255.255.255.224   32 addresses,   30 usable\n' +
    '  /28  255.255.255.240   16 addresses,   14 usable\n' +
    '  /30  255.255.255.252    4 addresses,    2 usable (point to point)\n' +
    '  Two are always lost: the network address and the broadcast address.\n' +
    '\n' +
    'HOW THE KERNEL PICKS AN INTERFACE\n' +
    '  It walks the routing table and takes the MOST SPECIFIC match - the\n' +
    '  longest prefix. Anything not matched by a specific route falls through\n' +
    '  to the default route, which is why a wrongly sized subnet silently sends\n' +
    '  traffic out of the wrong NIC instead of failing.\n' +
    '\n' +
    'NAME RESOLUTION ORDER\n' +
    '  /etc/nsswitch.conf decides the order; on nearly every box it is\n' +
    '  "files dns", meaning /etc/hosts is consulted BEFORE DNS. A stale line in\n' +
    '  /etc/hosts beats a correct DNS record every time, and is a very common\n' +
    '  cause of "it works on the other server".\n' +
    '  DNS servers themselves are listed in /etc/resolv.conf.\n' +
    '\n' +
    'ARP maps an IP to a MAC on the local segment. It only applies to hosts on\n' +
    'the same subnet - anything else is reached via the gateway, so the gateway\n' +
    'MAC is the one you will see for every remote address.\n' +
    '\n' +
    'MTU is the largest frame the interface will send. Standard Ethernet is\n' +
    '1500. Market data and storage networks often run jumbo frames at 9000. A\n' +
    'mismatch along the path gives you the worst failure mode there is: small\n' +
    'packets work, large ones vanish, so ping succeeds and real traffic hangs.\n' +
    '\n' +
    'THE THREE ANSWERS TO A CONNECTION ATTEMPT\n' +
    '  Connected             the port is open\n' +
    '  Connection refused    host is UP, nothing is listening on that port.\n' +
    '                        Application problem - our team.\n' +
    '  Connection timed out   firewall dropping, or the host is down.\n' +
    '                        Network problem - their team.\n' +
    '  Never report "I cannot connect" without saying which of the three.\n';

  PS.drills.push({
    id: 'networking-ip-basics',
    title: 'IP addressing and routing',
    topic: 'ip addr · ip route · DNS · ARP',
    host: 'ldn-app-prod15',
    tags: ['ip addr', 'ip route', 'CIDR', '/etc/hosts', 'arp', 'MTU'],

    brief:
      'A dual-homed application server: one NIC on the corporate network, one on\n' +
      'a market data segment with jumbo frames.\n\n' +
      'Twelve questions on addressing, routing, name resolution and reachability.\n' +
      'Reference material is in /home/gsupport/ip-notes.txt.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 17, 5, 0);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };

      var root = V.dir({
        etc: V.dir({
          'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }),
          hosts: V.file(
            '127.0.0.1       localhost localhost.localdomain\n' +
            '::1             localhost localhost.localdomain\n' +
            '10.14.22.75     ldn-app-prod15 ldn-app-prod15.ib.internal\n' +
            '10.14.40.31     app-db app-db.ib.internal\n' +
            '10.14.44.18     mq-broker\n', { owner: 'root', mtime: ago(86400 * 30) }),
          'resolv.conf': V.file(
            'search ib.internal ldn.ib.internal\n' +
            'nameserver 10.14.0.53\n' +
            'nameserver 10.14.0.54\n' +
            'options timeout:2 attempts:2\n', { owner: 'root', mtime: ago(86400 * 90) }),
          'nsswitch.conf': V.file(
            '# /etc/nsswitch.conf\n' +
            'passwd:     files sss\n' +
            'group:      files sss\n' +
            'hosts:      files dns myhostname\n', { owner: 'root', mtime: ago(86400 * 200) }),
          sysconfig: V.dir({
            'network-scripts': V.dir({
              'ifcfg-eth1': V.file(
                'DEVICE=eth1\nBOOTPROTO=none\nIPADDR=10.90.8.75\nPREFIX=26\nMTU=9000\nONBOOT=yes\n',
                { owner: 'root', mtime: ago(86400 * 120) })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'ip-notes.txt': V.file(NOTES, { owner: 'gsupport', mtime: ago(400000) })
          })
        }),
        var: V.dir({
          log: V.dir({
            app: V.dir({
              'app.log': V.file(
                '2026-09-11 17:02:11 INFO  [main] Boot - bound admin port 8600\n' +
                '2026-09-11 17:04:40 ERROR [mq-1] MqClient - connect to mq-broker:5672 failed: Connection refused',
                { owner: 'appadm', mtime: ago(20), size: 90 * MB })
            })
          })
        }),
        apps: V.dir({ svc: V.dir({ conf: V.dir({}) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      return W.create({
        host: 'ldn-app-prod15', user: 'gsupport', clock: t0, seed: 1522,
        bootSeconds: 3600 * 24 * 61, cores: 8, users: 2,
        load: [0.42, 0.38, 0.41],
        mem: { total: 32 * GB, free: 14 * GB, buffers: 200 * MB, cached: 8 * GB },
        swap: { total: 4 * GB, used: 0 },
        cpu: { us: 4.1, sy: 1.0, ni: 0, id: 94.7, wa: 0.2, st: 0 },
        root: root,
        gateway: '10.14.22.1',
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 11 * GB, inodes: { total: 26214400, used: 170402 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 100 * GB, used: 18 * GB, inodes: { total: 52428800, used: 20114 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 820 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 300 }),
          W.proc({ pid: 1611, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 18 }),
          W.proc({ pid: 5240, user: 'appadm', short: 'java', cpu: 3.8, rss: 6 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xmx6g -jar /apps/svc/lib/svc.jar',
            started: new Date(2026, 8, 11, 7, 0, 0), cpuSeconds: 1400 }),
          W.proc({ pid: 17400, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 5240, fd: 11, proto: 'tcp', local: '0.0.0.0:8600', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 5240, fd: 21, proto: 'tcp', local: '10.14.22.75:44120', peer: '10.14.40.31:1521', state: 'ESTABLISHED' },
          { pid: 1611, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        netstat: { tcpActive: 8412, tcpRetrans: 14, udpErrors: 0 },
        diskio: [{ dev: 'dm-1', rs: 1.4, ws: 28.2, readKB: 18.4, writeKB: 380.1, await: 0.5, util: 1.4 }],

        interfaces: [
          { name: 'eth0', addr: '10.14.22.75/24', bcast: '10.14.22.255',
            mac: '00:50:56:9a:41:75', mtu: 1500, speed: '1000Mb/s', duplex: 'Full',
            rxOk: 412008841, txOk: 388120044, rxBytes: 88120044120, txBytes: 74120088412,
            groups: [{ addr: '224.0.0.1', refcnt: 1 }] },
          // market data segment: a /26, jumbo frames, 10 gig
          { name: 'eth1', addr: '10.90.8.75/26', bcast: '10.90.8.127',
            mac: '00:50:56:9a:41:76', mtu: 9000, speed: '10000Mb/s', duplex: 'Full',
            rxOk: 8841200412, txOk: 41204, rxBytes: 1204881200440, txBytes: 4120884,
            mcast: 8841200412, rxDrop: 0,
            groups: [{ addr: '233.71.14.20', refcnt: 1 }, { addr: '224.0.0.1', refcnt: 1 }] },
          { name: 'lo', addr: '127.0.0.1/8', mac: '00:00:00:00:00:00', mtu: 65536, rxOk: 44120, txOk: 44120 }
        ],

        arp: [
          { ip: '10.14.22.1', mac: '00:00:5e:00:01:01', iface: 'eth0' },
          { ip: '10.14.22.19', mac: '00:50:56:9a:11:03', iface: 'eth0' },
          { ip: '10.14.22.71', mac: '00:50:56:9a:22:14', iface: 'eth0' },
          { ip: '10.90.8.65', mac: '00:1b:21:8c:44:02', iface: 'eth1' },
          { ip: '10.90.8.66', mac: '(incomplete)', iface: 'eth1', flags: '' }
        ],

        dmesg: [],
        hosts: {
          localhost: { ip: '127.0.0.1', ports: [8600, 22], rtt: 0.02 },
          'ldn-app-prod15': { ip: '10.14.22.75', ports: [8600, 22], rtt: 0.02 },
          // up, answers ping, but nothing listening on 5672
          'mq-broker': { ip: '10.14.44.18', ports: [22], rtt: 0.44, ttl: 62 },
          'app-db': { ip: '10.14.40.31', ports: [1521, 22], rtt: 0.31, ttl: 63 },
          // completely unreachable: firewall drop
          'risk-gw': { ip: '10.61.2.40', unreachable: true, ports: [] }
        },
        services: { svc: { active: true, pid: 5240, exe: 'java', desc: 'Application Service' } },
        flags: {}
      });
    },

    tasks: [
      {
        short: 'IP of eth0',
        ask: 'What is the IPv4 address of eth0?',
        answer: '10.14.22.75',
        hint: 'ip addr show eth0, or the older ifconfig eth0.',
        solution: 'ip addr show eth0',
        teaches: 'ip has replaced ifconfig on modern distributions. ifconfig still works on RHEL7 boxes but does not show secondary addresses, so trust ip.'
      },
      {
        short: 'Prefix length of eth1',
        ask: 'What is the prefix length (CIDR) on eth1?',
        answers: ['/26', '26', '255.255.255.192'],
        hint: 'The prefix is printed after the slash in ip addr output.',
        solution: 'ip addr show eth1',
        teaches: 'eth0 is a /24 and eth1 is a /26 - different sized subnets on one host is normal, and mixing them up is how traffic ends up leaving the wrong NIC.'
      },
      {
        short: 'Usable hosts in a /26',
        ask: 'How many usable host addresses are there in a /26?',
        answer: '62',
        hint: 'A /26 has 64 addresses. Two of them can never be assigned to a host. The table is in /home/gsupport/ip-notes.txt.',
        solution: 'grep "/26" /home/gsupport/ip-notes.txt',
        teaches: 'Total minus two: the network address and the broadcast address are always reserved. /24=254, /25=126, /26=62, /27=30, /28=14 is worth memorising.'
      },
      {
        short: 'Default gateway',
        ask: 'What is the default gateway for this host?',
        answer: '10.14.22.1',
        hint: 'ip route prints the routing table; the default route is the one that matches everything else.',
        solution: 'ip route',
        teaches: 'route -n and netstat -rn show the same table in the older format, where the default route appears as destination 0.0.0.0.'
      },
      {
        short: 'Route for 10.90.8.200',
        ask: 'Traffic to 10.90.8.200 would leave by which interface?',
        note: 'Work out whether that address is inside the eth1 subnet before you answer.',
        answer: 'eth0',
        hint: 'eth1 is 10.90.8.75/26. A /26 covers 64 addresses. Work out the range, then check whether .200 is inside it - if not, it takes the default route.',
        solution: 'ip route ; grep -A3 "MOST SPECIFIC" /home/gsupport/ip-notes.txt',
        teaches: '10.90.8.75/26 covers .64 to .127 only, so .200 is NOT local and falls through to the default gateway on eth0. A subnet assumed to be a /24 when it is a /26 is a classic silent misroute.'
      },
      {
        short: 'MTU of eth1',
        ask: 'What MTU is configured on eth1?',
        answer: '9000',
        hint: 'ip link show eth1 prints the MTU. It is also in the interface config file under /etc/sysconfig/network-scripts.',
        solution: 'ip link show eth1',
        teaches: 'MTU 9000 is jumbo frames, normal on market data and storage segments. If one device in the path is still at 1500, small packets pass and large ones vanish - ping works, the application hangs.'
      },
      {
        short: 'MAC of eth1',
        ask: 'What is the MAC address of eth1?',
        answer: '00:50:56:9a:41:76',
        hint: 'ip link show eth1 prints link/ether followed by the hardware address.',
        solution: 'ip link show eth1',
        teaches: 'Exchanges and venues often authorise a specific MAC. When a NIC is replaced, the MAC changes and the session stops being accepted - worth knowing where to read it.'
      },
      {
        short: 'DNS servers',
        ask: 'Which is the FIRST DNS server this host will query?',
        answer: '10.14.0.53',
        hint: 'DNS servers are listed in /etc/resolv.conf, in the order they are tried.',
        solution: 'cat /etc/resolv.conf',
        teaches: 'They are tried in order, with the timeout and attempts from the options line. A dead first nameserver adds that timeout to every lookup - a classic "everything is slow" cause.'
      },
      {
        short: 'hosts file vs DNS',
        ask: 'Which is consulted first for name resolution on this box: /etc/hosts or DNS?',
        answers: ['/etc/hosts', 'hosts', 'files', 'etc/hosts', 'the hosts file'],
        hint: 'The order is set by the hosts: line in /etc/nsswitch.conf.',
        solution: 'grep hosts /etc/nsswitch.conf',
        teaches: '"files dns" means /etc/hosts wins. A stale entry there beats a correct DNS record silently, and is the usual explanation for "it resolves differently on that server".'
      },
      {
        short: 'Gateway MAC from ARP',
        ask: 'What MAC address has this host learned for the default gateway?',
        answer: '00:00:5e:00:01:01',
        hint: 'arp -n prints the ARP cache: IP to MAC, per interface. You already know the gateway IP.',
        solution: 'arp -n',
        teaches: 'ARP only resolves hosts on the same subnet. Every remote destination is sent to the gateway MAC, so that one entry carries most of your traffic. An (incomplete) entry means no reply - that host is not answering on this segment.'
      },
      {
        short: 'Link speed of eth1',
        ask: 'What link speed is eth1 negotiated at?',
        answers: ['10000mb/s', '10000', '10gb', '10g', '10 gigabit'],
        hint: 'ethtool prints speed, duplex and whether link is detected.',
        solution: 'ethtool eth1',
        teaches: 'A NIC that has quietly fallen back to a lower speed or to half duplex explains "intermittently slow" better than any application change. Check link detected too.'
      },
      {
        short: 'Diagnose the mq failure',
        ask: 'The app log says the connection to mq-broker:5672 failed. Test it: do you get "refused" or "timed out"?',
        answers: ['refused', 'connection refused'],
        hint: 'nc -zv HOST PORT tells you which of the three outcomes you got. Compare with a ping to the same host.',
        solution: 'ping -c 2 mq-broker ; nc -zv mq-broker 5672',
        teaches: 'Refused means the host is UP and actively rejecting - nothing is listening, so it is an application or service problem. Timed out would mean a firewall drop or a dead host, which is a network problem. Two different teams, one word apart.'
      }
    ],

    wrapUp:
      'ip addr show          addresses and prefixes\n' +
      'ip link show          MAC, MTU, link state\n' +
      'ip route / route -n   which interface a destination leaves by\n' +
      'arp -n                IP to MAC on the local segment\n' +
      'cat /etc/resolv.conf  which DNS servers, in which order\n' +
      'grep hosts /etc/nsswitch.conf   whether /etc/hosts beats DNS (it does)\n' +
      'ethtool ethN          negotiated speed and duplex\n' +
      'ping / nc -zv         reachable, and which failure mode\n\n' +
      'Two things to carry into every connectivity call:\n' +
      '  1. "Refused" and "timed out" are different faults belonging to\n' +
      '     different teams. Say which one you got.\n' +
      '  2. Ping succeeding proves almost nothing. Small packets and large\n' +
      '     packets take different paths through an MTU mismatch, and ICMP\n' +
      '     tells you nothing about whether a TCP port is open.'
  });
})(PS);
