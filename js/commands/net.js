/* commands/net.js - netstat, ss, ip, ifconfig, ping, telnet, curl, tcpdump,
 * ntpq. The socket queue depths and interface drop counters here are what turn
 * "the screen is frozen" into a diagnosable fact.
 */
(function (PS) {
  'use strict';

  var sh = PS.shell, W = PS.world;
  var reg = sh.register;

  function socketsOf(world, filter) {
    return world.sockets.filter(filter || function () { return true; });
  }

  function procName(world, pid) {
    var p = W.findProc(world, pid);
    if (!p) return '-';
    return pid + '/' + p.cmd.split(' ')[0].split('/').pop().slice(0, 12);
  }

  /* ---------- netstat ---------- */

  reg('netstat', function (argv, io, ctx) {
    var world = ctx.world;
    var a = sh.parseArgs(argv, { bool: 'antuplesgirc' });

    // netstat -s : protocol statistics. UDP receive errors live here, and they
    // are the single clearest sign of a dropped multicast feed.
    if (a.has('s')) {
      var st = world.netstat || {};
      var out = [];
      if (!a.has('u') || a.has('t')) {
        out.push('Ip:');
        out.push('    ' + W.comma(st.ipReceived || 918273645) + ' total packets received');
        out.push('    ' + W.comma(st.ipForwarded || 0) + ' forwarded');
        out.push('    ' + W.comma(st.ipDelivered || 918273600) + ' incoming packets delivered');
        out.push('Tcp:');
        out.push('    ' + W.comma(st.tcpActive || 88213) + ' active connections openings');
        out.push('    ' + W.comma(st.tcpPassive || 4412) + ' passive connection openings');
        out.push('    ' + W.comma(st.tcpFailed || 12) + ' failed connection attempts');
        out.push('    ' + W.comma(st.tcpReset || 331) + ' connection resets received');
        out.push('    ' + W.comma(st.tcpRetrans || 88) + ' segments retransmitted');
      }
      out.push('Udp:');
      out.push('    ' + W.comma(st.udpReceived || 0) + ' packets received');
      out.push('    ' + W.comma(st.udpNoPort || 0) + ' packets to unknown port received');
      var errLine = '    ' + W.comma(st.udpErrors || 0) + ' packet receive errors';
      out.push(st.udpErrors > 0 ? W.red(errLine) : errLine);
      out.push('    ' + W.comma(st.udpSent || 0) + ' packets sent');
      var bufLine = '    ' + W.comma(st.udpRcvbufErrors || 0) + ' receive buffer errors';
      out.push(st.udpRcvbufErrors > 0 ? W.red(bufLine) : bufLine);
      out.push('    ' + W.comma(st.udpSndbufErrors || 0) + ' send buffer errors');
      out.push('UdpLite:');
      out.push('TcpExt:');
      out.push('    ' + W.comma(st.pruneCalled || 0) + ' packets pruned from receive queue because of socket buffer overrun');
      out.push('    ' + W.comma(st.listenDrops || 0) + ' SYNs to LISTEN sockets dropped');
      return out.join('\n');
    }

    // netstat -g : multicast group memberships
    if (a.has('g')) {
      var rows = ['IPv6/IPv4 Group Memberships',
        'Interface       RefCnt Group',
        '--------------- ------ ---------------------'];
      (world.interfaces || []).forEach(function (i) {
        (i.groups || []).forEach(function (g) {
          rows.push(W.rpad(i.name, 16) + W.rpad(g.refcnt || 1, 7) + g.addr);
        });
      });
      return rows.join('\n');
    }

    // netstat -i : interface counters
    if (a.has('i')) {
      var ir = ['Kernel Interface table',
        'Iface      MTU    RX-OK RX-ERR RX-DRP RX-OVR    TX-OK TX-ERR TX-DRP TX-OVR Flg'];
      (world.interfaces || []).forEach(function (i) {
        var drp = i.rxDrop || 0;
        ir.push(W.rpad(i.name, 10) + W.lpad(i.mtu || 1500, 5) +
          W.lpad(W.comma(i.rxOk || 0), 9) + W.lpad(i.rxErr || 0, 7) +
          W.lpad(drp > 0 ? W.red(String(drp)) : String(drp), 7) + W.lpad(i.rxOvr || 0, 7) +
          W.lpad(W.comma(i.txOk || 0), 9) + W.lpad(i.txErr || 0, 7) +
          W.lpad(i.txDrop || 0, 7) + W.lpad(0, 7) + ' ' + (i.flags || 'BMRU'));
      });
      return ir.join('\n');
    }

    if (a.has('r')) {
      return ['Kernel IP routing table',
        'Destination     Gateway         Genmask         Flags   MSS Window  irtt Iface',
        '0.0.0.0         10.14.22.1      0.0.0.0         UG        0 0          0 eth0',
        '10.14.22.0      0.0.0.0         255.255.255.0   U         0 0          0 eth0',
        '224.0.0.0       0.0.0.0         240.0.0.0       U         0 0          0 eth1'].join('\n');
    }

    var wantListen = a.has('l');
    var wantTcp = a.has('t') || (!a.has('t') && !a.has('u'));
    var wantUdp = a.has('u') || (!a.has('t') && !a.has('u'));
    var showPid = a.has('p');

    var head = 'Active Internet connections (' + (wantListen ? 'only servers' : a.has('a') ? 'servers and established' : 'w/o servers') + ')';
    var cols = 'Proto Recv-Q Send-Q Local Address           Foreign Address         State      ' +
      (showPid ? '  PID/Program name' : '');
    var lines = [head, cols];

    socketsOf(world).forEach(function (s) {
      var isUdp = s.proto.toLowerCase().indexOf('udp') === 0;
      if (isUdp && !wantUdp) return;
      if (!isUdp && !wantTcp) return;
      var passive = isUdp ? !s.state || s.state === 'UNCONN' : s.state === 'LISTEN';
      if (wantListen && !passive) return;
      if (!wantListen && !a.has('a') && passive) return;

      var rq = String(s.recvq || 0);
      if ((s.recvq || 0) > 0) rq = W.red(rq);
      var state = s.state || (isUdp ? '' : 'ESTABLISHED');
      if (state === 'CLOSE_WAIT') state = W.red(state);
      lines.push(W.rpad(s.proto, 6) + W.vpad(rq, 6) + ' ' + W.lpad(s.sendq || 0, 6) + ' ' +
        W.rpad(s.local, 23) + ' ' + W.rpad(s.peer || '0.0.0.0:*', 23) + ' ' +
        W.vpad(state, 11, true) + (showPid ? ' ' + procName(world, s.pid) : ''));
    });
    return lines.join('\n');
  }, { help: 'sockets and protocol stats (-tulpn, -s, -i, -g)' });

  /* ---------- ss ---------- */

  reg('ss', function (argv, io, ctx) {
    var world = ctx.world;
    var a = sh.parseArgs(argv, { bool: 'antuplemiosH46' });
    var wantListen = a.has('l');
    var wantTcp = a.has('t') || (!a.has('t') && !a.has('u'));
    var wantUdp = a.has('u') || (!a.has('t') && !a.has('u'));

    if (a.has('s')) {
      var tcpCount = world.sockets.filter(function (s) { return s.proto.indexOf('tcp') === 0; }).length;
      var udpCount = world.sockets.filter(function (s) { return s.proto.indexOf('udp') === 0; }).length;
      return ['Total: ' + (tcpCount + udpCount + 412),
        'TCP:   ' + tcpCount + ' (estab ' +
          world.sockets.filter(function (s) { return s.state === 'ESTABLISHED'; }).length +
          ', closed 0, orphaned 0, timewait 0)',
        '',
        'Transport Total     IP        IPv6',
        'RAW\t  0         0         0',
        'UDP\t  ' + udpCount + '         ' + udpCount + '         0',
        'TCP\t  ' + tcpCount + '         ' + tcpCount + '         0'].join('\n');
    }

    var lines = a.has('H') ? [] : [W.rpad('State', 12) + W.lpad('Recv-Q', 7) + W.lpad('Send-Q', 8) + '  ' +
      W.rpad('Local Address:Port', 26) + W.rpad('Peer Address:Port', 24) +
      (a.has('p') ? ' Process' : '')];

    socketsOf(world).forEach(function (s) {
      var isUdp = s.proto.toLowerCase().indexOf('udp') === 0;
      if (isUdp && !wantUdp) return;
      if (!isUdp && !wantTcp) return;
      var state = s.state || (isUdp ? 'UNCONN' : 'ESTAB');
      if (state === 'ESTABLISHED') state = 'ESTAB';
      var passive = isUdp ? state === 'UNCONN' : state === 'LISTEN';
      if (wantListen && !passive) return;
      if (!wantListen && !a.has('a') && a.rest.indexOf('state') < 0 && passive) return;
      var ipv6 = /6$/.test(s.proto) || /^\[/.test(s.local);
      if (a.has('4') && ipv6 || a.has('6') && !ipv6) return;
      var stateIndex = a.rest.indexOf('state');
      if (stateIndex >= 0 && a.rest[stateIndex + 1]) {
        var requested = a.rest[stateIndex + 1].toUpperCase().replace(/-/g, '_');
        if (requested === 'ESTABLISHED') requested = 'ESTAB';
        if (requested === 'LISTENING') requested = 'LISTEN';
        if (state !== requested) return;
      }

      var rq = String(s.recvq || 0);
      if ((s.recvq || 0) > 0) rq = W.red(rq);
      var proc = '';
      if (a.has('p') && state !== 'TIME_WAIT') {
        var p = W.findProc(world, s.pid);
        proc = p ? ' users:(("' + p.cmd.split(' ')[0].split('/').pop().slice(0, 15) +
          '",pid=' + p.pid + ',fd=' + (s.fd || 0) + '))' : '';
      }
      lines.push(W.rpad(state === 'CLOSE_WAIT' ? W.red(state) : state, 12) +
        W.vpad(rq, 7) + W.lpad(s.sendq || 0, 8) + '  ' +
        W.rpad(s.local, 26) + W.rpad(s.peer || '*:*', 24) + proc);
    });
    return lines.join('\n');
  }, { help: 'socket statistics (-tulpn, -s summary)' });

  /* ---------- ip / ifconfig ---------- */

  reg('ip', function (argv, io, ctx) {
    var world = ctx.world;
    var sub = argv.slice(1).filter(function (x) { return x.charAt(0) !== '-'; });
    var stats = argv.indexOf('-s') >= 0;

    if (sub[0] === 'maddr' || (sub[0] === 'maddr' && sub[1] === 'show')) {
      var mo = [];
      (world.interfaces || []).forEach(function (i, idx) {
        mo.push((idx + 1) + ':\t' + i.name);
        (i.groups || []).forEach(function (g) { mo.push('\tinet  ' + g.addr + ' users ' + (g.refcnt || 1)); });
      });
      return mo.join('\n');
    }

    if (sub[0] === 'a' || sub[0] === 'addr' || sub[0] === 'link') {
      var out = [];
      // "ip addr show eth1" / "ip link show eth1" - honour the interface operand
      var only = sub.filter(function (s, n) {
        return n > 0 && s !== 'show' && s !== 'list' && s !== 'dev';
      })[0];
      var list = (world.interfaces || []).filter(function (i) { return !only || i.name === only; });
      if (only && !list.length) {
        return { err: 'Device "' + only + '" does not exist.', code: 1 };
      }
      list.forEach(function (i, idx) {
        var loop = i.name === 'lo';
        var flags = i.flagsLong || (loop ? 'LOOPBACK,UP,LOWER_UP' : 'BROADCAST,MULTICAST,UP,LOWER_UP');
        var num = (world.interfaces || []).indexOf(i) + 1;
        out.push(num + ': ' + i.name + ': <' + flags +
          '> mtu ' + (i.mtu || 1500) + ' qdisc ' + (loop ? 'noqueue' : 'mq') +
          ' state ' + (i.state || (loop ? 'UNKNOWN' : 'UP')) + ' group default qlen ' + (loop ? '1000' : '1000'));
        out.push('    link/' + (loop ? 'loopback ' : 'ether ') + (i.mac || '00:50:56:9a:1b:2c') +
          ' brd ' + (loop ? '00:00:00:00:00:00' : 'ff:ff:ff:ff:ff:ff'));
        if (sub[0] !== 'link' && i.addr) {
          out.push('    inet ' + i.addr + (loop ? ' scope host ' : ' brd ' + (i.bcast || bcastFor(i.addr)) + ' scope global ') + i.name);
        }
        if (stats) {
          out.push('    RX: bytes  packets  errors  dropped overrun mcast');
          out.push('    ' + W.lpad(W.comma(i.rxBytes || 0), 14) + W.lpad(W.comma(i.rxOk || 0), 9) +
            W.lpad(i.rxErr || 0, 8) + W.lpad((i.rxDrop || 0) > 0 ? W.red(String(i.rxDrop)) : '0', 8) +
            W.lpad(i.rxOvr || 0, 8) + W.lpad(W.comma(i.mcast || 0), 8));
          out.push('    TX: bytes  packets  errors  dropped carrier collsns');
          out.push('    ' + W.lpad(W.comma(i.txBytes || 0), 14) + W.lpad(W.comma(i.txOk || 0), 9) +
            W.lpad(i.txErr || 0, 8) + W.lpad(i.txDrop || 0, 8) + W.lpad(0, 8) + W.lpad(0, 8));
        }
      });
      return out.join('\n');
    }
    if (sub[0] === 'r' || sub[0] === 'route') {
      return routes(world).map(function (r) {
        if (r.dest === '0.0.0.0' || r.dest === 'default') {
          return 'default via ' + r.gateway + ' dev ' + r.iface + ' proto static metric ' + (r.metric || 100);
        }
        return r.cidr + ' dev ' + r.iface + ' proto kernel scope link' +
          (r.src ? ' src ' + r.src : '');
      }).join('\n');
    }
    return { err: 'Object "' + (sub[0] || '') + '" is unknown, try "ip help".', code: 1 };
  }, { help: 'ip addr / ip -s link / ip maddr / ip route' });

  /* Routing table, derived from the interfaces unless the scenario states it. */
  function routes(world) {
    if (world.routes && world.routes.length) return world.routes;
    var out = [];
    (world.interfaces || []).forEach(function (i) {
      if (!i.addr || i.name === 'lo') return;
      var bits = i.addr.split('/')[1] || '24';
      var mask = cidrToMask(Number(bits)).split('.').map(Number);
      var net = i.addr.split('/')[0].split('.').map(function (v, n) { return Number(v) & mask[n]; }).join('.');
      out.push({
        dest: net, cidr: net + '/' + bits, gateway: '0.0.0.0',
        genmask: cidrToMask(Number(bits)), flags: 'U', iface: i.name,
        src: i.addr.split('/')[0], metric: 100
      });
    });
    if (world.gateway) {
      out.unshift({
        dest: '0.0.0.0', cidr: 'default', gateway: world.gateway,
        genmask: '0.0.0.0', flags: 'UG', iface: (world.interfaces[0] || {}).name || 'eth0', metric: 100
      });
    }
    return out;
  }

  /* Broadcast address for an a.b.c.d/bits, for interfaces that did not state one. */
  function bcastFor(cidr) {
    var parts = cidr.split('/');
    var octets = parts[0].split('.').map(Number);
    var bits = Number(parts[1] || 24);
    var mask = cidrToMask(bits).split('.').map(Number);
    return octets.map(function (o, i) { return (o & mask[i]) | (255 - mask[i]); }).join('.');
  }

  function cidrToMask(bits) {
    var mask = [];
    for (var i = 0; i < 4; i++) {
      var n = Math.min(8, Math.max(0, bits - i * 8));
      mask.push(256 - Math.pow(2, 8 - n));
    }
    return mask.join('.');
  }

  reg('route', function (argv, io, ctx) {
    var world = ctx.world;
    var out = ['Kernel IP routing table',
      'Destination     Gateway         Genmask         Flags Metric Ref    Use Iface'];
    routes(world).forEach(function (r) {
      out.push(W.rpad(r.dest === 'default' ? '0.0.0.0' : r.dest, 16) +
        W.rpad(r.gateway, 16) + W.rpad(r.genmask, 16) +
        W.rpad(r.flags, 6) + W.rpad(r.metric || 0, 7) + W.rpad(0, 7) + W.rpad(0, 4) + r.iface);
    });
    return out.join('\n');
  }, { help: 'kernel routing table (route -n)' });

  reg('arp', function (argv, io, ctx) {
    var world = ctx.world;
    var table = world.arp || [];
    if (!table.length) return { err: 'arp: no entries', code: 1 };
    var out = ['Address                  HWtype  HWaddress           Flags Mask            Iface'];
    table.forEach(function (a) {
      out.push(W.rpad(a.ip, 25) + W.rpad(a.hwtype || 'ether', 8) +
        W.rpad(a.mac || '(incomplete)', 20) + W.rpad(a.flags || 'C', 21) + a.iface);
    });
    return out.join('\n');
  }, { help: 'ARP cache (arp -n)' });

  reg('ethtool', function (argv, io, ctx) {
    var world = ctx.world;
    var name = argv[argv.length - 1];
    var i = (world.interfaces || []).filter(function (x) { return x.name === name; })[0];
    if (!i) return { err: 'ethtool: bad command line argument(s)', code: 1 };
    return ['Settings for ' + i.name + ':',
      '\tSupported ports: [ FIBRE ]',
      '\tSpeed: ' + (i.speed || '10000Mb/s'),
      '\tDuplex: ' + (i.duplex || 'Full'),
      '\tPort: FIBRE',
      '\tAuto-negotiation: off',
      '\tLink detected: ' + (i.state === 'DOWN' ? 'no' : 'yes')].join('\n');
  }, { help: 'NIC link settings: ethtool eth1' });

  reg('ifconfig', function (argv, io, ctx) {
    var world = ctx.world;
    var out = [];
    (world.interfaces || []).forEach(function (i) {
      out.push(i.name + ': flags=4163<' + (i.flagsLong || 'UP,BROADCAST,RUNNING,MULTICAST') +
        '>  mtu ' + (i.mtu || 1500));
      if (i.addr) out.push('        inet ' + i.addr.split('/')[0] + '  netmask 255.255.255.0  broadcast ' + (i.bcast || '10.14.22.255'));
      out.push('        ether ' + (i.mac || '00:50:56:9a:1b:2c') + '  txqueuelen 1000  (Ethernet)');
      out.push('        RX packets ' + W.comma(i.rxOk || 0) + '  bytes ' + W.comma(i.rxBytes || 0));
      out.push('        RX errors ' + (i.rxErr || 0) + '  dropped ' + (i.rxDrop || 0) + '  overruns ' + (i.rxOvr || 0) + '  frame 0');
      out.push('        TX packets ' + W.comma(i.txOk || 0) + '  bytes ' + W.comma(i.txBytes || 0));
      out.push('        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0');
      out.push('');
    });
    return out.join('\n');
  }, { help: 'interface configuration' });

  /* ---------- reachability ---------- */

  reg('ping', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { value: 'cWi' });
    var host = a.rest[0];
    if (!host) return { err: 'usage: ping [-c count] destination', code: 2 };
    var world = ctx.world;
    var hosts = world.hosts || {};
    var entry = hosts[host];
    var count = parseInt(a.vals.c, 10) || 4;
    var ipAddr = (entry && entry.ip) || host;

    if (entry && entry.unreachable) {
      var lost = ['PING ' + host + ' (' + ipAddr + ') 56(84) bytes of data.'];
      lost.push('');
      lost.push('--- ' + host + ' ping statistics ---');
      lost.push(count + ' packets transmitted, 0 received, ' + W.red('100% packet loss') + ', time ' + (count * 1000) + 'ms');
      return { out: lost.join('\n'), code: 1 };
    }

    var out = ['PING ' + host + ' (' + ipAddr + ') 56(84) bytes of data.'];
    var rtts = [];
    for (var i = 1; i <= count; i++) {
      var rtt = (entry && entry.rtt ? entry.rtt : 0.18) * (0.85 + world.rand() * 0.3);
      rtts.push(rtt);
      out.push('64 bytes from ' + ipAddr + ': icmp_seq=' + i + ' ttl=' + ((entry && entry.ttl) || 63) +
        ' time=' + rtt.toFixed(2) + ' ms');
    }
    out.push('');
    out.push('--- ' + host + ' ping statistics ---');
    out.push(count + ' packets transmitted, ' + count + ' received, 0% packet loss, time ' + (count * 1000) + 'ms');
    var min = Math.min.apply(null, rtts), max = Math.max.apply(null, rtts);
    var avg = rtts.reduce(function (x, y) { return x + y; }, 0) / rtts.length;
    out.push('rtt min/avg/max/mdev = ' + min.toFixed(3) + '/' + avg.toFixed(3) + '/' + max.toFixed(3) + '/0.021 ms');
    return out.join('\n');
  }, { help: 'test reachability (-c count)' });

  reg('telnet', function (argv, io, ctx) {
    var host = argv[1], port = argv[2];
    if (!host || !port) return { err: 'usage: telnet host port', code: 1 };
    var world = ctx.world;
    var entry = (world.hosts || {})[host];
    var ipAddr = (entry && entry.ip) || host;
    var open = entry && entry.ports && entry.ports.indexOf(Number(port)) >= 0;
    if (entry && entry.unreachable) {
      return { out: 'Trying ' + ipAddr + '...', err: 'telnet: connect to address ' + ipAddr + ': Connection timed out', code: 1 };
    }
    if (!open) {
      return { out: 'Trying ' + ipAddr + '...', err: 'telnet: connect to address ' + ipAddr + ': Connection refused', code: 1 };
    }
    return ['Trying ' + ipAddr + '...', 'Connected to ' + host + '.', 'Escape character is \'^]\'.',
      W.dim('(connection established - port ' + port + ' is open; Ctrl+] to quit)')].join('\n');
  }, { help: 'test a tcp port: telnet host port' });

  reg('nc', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'zvul', value: 'w' });
    var host = a.rest[0], port = a.rest[1];
    if (!host || !port) return { err: 'usage: nc -zv host port', code: 1 };
    var entry = (ctx.world.hosts || {})[host] || {};
    var open = entry.ports && entry.ports.indexOf(Number(port)) >= 0;
    if (a.has('u')) {
      if (entry.udpRefused && entry.udpRefused.indexOf(Number(port)) >= 0) {
        return { err: 'nc: UDP probe received ICMP port unreachable', code: 1 };
      }
      return 'UDP probe sent; no response in this simulation. UDP has no handshake: silence does not prove an open port or healthy application.';
    }
    if (entry.unreachable) return { err: 'nc: connect to ' + host + ' port ' + port + ' (tcp) failed: Connection timed out', code: 1 };
    if (!open) return { err: 'nc: connect to ' + host + ' port ' + port + ' (tcp) failed: Connection refused', code: 1 };
    return 'Ncat: Connected to ' + (entry.ip || host) + ':' + port + '.';
  }, { help: 'port check: nc -zv host port' });

  reg('curl', function (argv, io, ctx) {
    var url = argv.filter(function (x) { return /^https?:\/\//.test(x); })[0];
    if (!url) return { err: 'curl: try \'curl --help\' for more information', code: 2 };
    var endpoints = ctx.world.http || {};
    var key = Object.keys(endpoints).filter(function (k) { return url.indexOf(k) >= 0; })[0];
    if (!key) return { err: 'curl: (7) Failed to connect: Connection refused', code: 7 };
    var v = endpoints[key];
    return typeof v === 'function' ? v(ctx.world) : v;
  }, { help: 'fetch an http endpoint' });
  sh.alias('wget', 'curl');

  reg('traceroute', function (argv, io, ctx) {
    var host = argv[1] || 'gateway';
    var entry = (ctx.world.hosts || {})[host] || {};
    var out = ['traceroute to ' + host + ' (' + (entry.ip || host) + '), 30 hops max, 60 byte packets'];
    out.push(' 1  10.14.22.1 (10.14.22.1)  0.312 ms  0.298 ms  0.284 ms');
    out.push(' 2  core-sw-ldn-01 (10.14.0.1)  0.441 ms  0.430 ms  0.419 ms');
    if (entry.unreachable) { out.push(' 3  * * *'); out.push(' 4  * * *'); }
    else out.push(' 3  ' + (entry.ip || host) + ' (' + (entry.ip || host) + ')  0.512 ms  0.498 ms  0.487 ms');
    return out.join('\n');
  }, { help: 'trace network path' });

  reg('tcpdump', function (argv, io, ctx) {
    var world = ctx.world;
    var cap = world.tcpdump;
    if (!cap) {
      return { err: 'tcpdump: you need to be root to run a capture on this host', code: 1 };
    }
    var text = typeof cap === 'function' ? cap(world, argv) : cap;
    return 'tcpdump: verbose output suppressed, use -v or -vv for full protocol decode\n' +
      'listening on ' + (argv.indexOf('-i') >= 0 ? argv[argv.indexOf('-i') + 1] : 'eth1') + ', link-type EN10MB (Ethernet), capture size 262144 bytes\n' +
      text;
  }, { help: 'packet capture' });

  reg('ntpq', function (argv, io, ctx) {
    var world = ctx.world;
    if (!world.ntp) return { err: 'ntpq: read: Connection refused', code: 1 };
    var n = world.ntp;
    var out = ['     remote           refid      st t when poll reach   delay   offset  jitter',
      '=============================================================================='];
    n.peers.forEach(function (p) {
      var off = p.offset.toFixed(3);
      out.push(W.rpad((p.selected ? '*' : p.reach === 0 ? ' ' : '+') + p.remote, 17) +
        W.rpad(p.refid, 16) + W.lpad(p.stratum, 2) + ' u' + W.lpad(p.when, 5) +
        W.lpad(p.poll, 5) + W.lpad(p.reach, 6) + W.lpad(p.delay.toFixed(3), 8) +
        W.vpad(Math.abs(p.offset) > 500 ? W.red(off) : off, 9) + W.lpad(p.jitter.toFixed(3), 8));
    });
    return out.join('\n');
  }, { help: 'ntp peer status: ntpq -p' });

  reg('chronyc', function (argv, io, ctx) {
    return { err: 'chronyc: chrony output is not simulated. Use ntpq -pn for this host fixture; see Interview practice for real chronyc examples.', code: 2 };
  }, { help: 'chrony reference only; use ntpq -pn on the simulated host' });

  reg('nslookup', function (argv, io, ctx) {
    var host = argv[1];
    var entry = (ctx.world.hosts || {})[host];
    if (!entry) return { err: '** server can\'t find ' + host + ': NXDOMAIN', code: 1 };
    return ['Server:\t\t10.14.0.53', 'Address:\t10.14.0.53#53', '', 'Name:\t' + host, 'Address: ' + entry.ip].join('\n');
  }, { help: 'dns lookup' });
  ['dig', 'host'].forEach(function (name) {
    reg(name, function () {
      return { err: name + ': this tool is not simulated. Use nslookup NAME for this host fixture; Interview practice covers real resolver diagnostics.', code: 2 };
    }, { help: 'DNS reference only; use nslookup NAME on the simulated host' });
  });

  PS.netLoaded = true;
})(PS);
