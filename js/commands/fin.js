/* commands/fin.js - the tooling that only exists on a bank or fund's boxes.
 *
 * IBM MQ (dspmq, runmqsc, amqsbcg), Oracle via sqlplus, and chrony/PTP for
 * clock traceability. These are driven by world.mq, world.db and world.chrony
 * the same way df is driven by world.filesystems.
 */
(function (PS) {
  'use strict';

  var sh = PS.shell, V = PS.vfs, W = PS.world;
  var reg = sh.register;

  /* ---------- IBM MQ ---------- */

  function qmgr(world) { return world.mq || null; }

  function findQueue(world, name) {
    var mq = qmgr(world);
    if (!mq) return null;
    for (var i = 0; i < mq.queues.length; i++) {
      if (mq.queues[i].name === name) return mq.queues[i];
    }
    return null;
  }

  reg('dspmq', function (argv, io, ctx) {
    var mq = qmgr(ctx.world);
    if (!mq) return { err: 'dspmq: command not found on this host', code: 127 };
    return 'QMNAME(' + mq.qmgr + ')' + W.pad('', 24 - mq.qmgr.length, true) +
      'STATUS(' + (mq.status || 'Running') + ')';
  }, { help: 'list queue managers and their status' });

  /* runmqsc reads MQSC commands from stdin, which is how every support team
   * actually drives it:  echo "DIS QL(X) CURDEPTH" | runmqsc QM.TRADE.LDN */
  reg('runmqsc', function (argv, io, ctx) {
    var world = ctx.world;
    var mq = qmgr(world);
    if (!mq) return { err: 'runmqsc: command not found on this host', code: 127 };
    var target = argv[1];
    if (target && target !== mq.qmgr) {
      return { err: 'AMQ8118: IBM MQ queue manager does not exist.', code: 1 };
    }

    var script = (io.stdin || '').trim();
    if (!script) {
      return { err: 'runmqsc: no MQSC commands on stdin. Try: echo "DIS QL(*) CURDEPTH" | runmqsc ' + mq.qmgr, code: 1 };
    }

    var out = ['Starting MQSC for queue manager ' + mq.qmgr + '.', ''];
    var count = 0;

    script.split('\n').forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      count++;

      var m = /^DIS(?:PLAY)?\s+QL(?:OCAL)?\s*\(\s*([^)]*)\s*\)(.*)$/i.exec(line);
      if (m) {
        var pat = V.globToRegex(m[1] || '*');
        var hits = mq.queues.filter(function (q) { return pat.test(q.name); });
        if (!hits.length) {
          out.push('AMQ8147: IBM MQ object ' + m[1] + ' not found.');
          return;
        }
        hits.forEach(function (q) {
          var depth = q.curdepth;
          var depthStr = 'CURDEPTH(' + depth + ')';
          if (q.maxdepth && depth >= q.maxdepth) depthStr = W.red(depthStr + ' *** FULL ***');
          else if (q.maxdepth && depth > q.maxdepth * 0.8) depthStr = W.amber(depthStr);
          out.push('AMQ8409: Display Queue details.');
          out.push('   QUEUE(' + q.name + ')' + '                TYPE(QLOCAL)');
          out.push('   ' + depthStr + '        MAXDEPTH(' + (q.maxdepth || 5000) + ')');
          out.push('   IPPROCS(' + (q.ipprocs || 0) + ')                     OPPROCS(' + (q.opprocs || 0) + ')');
          out.push('   BOTHRESH(' + (q.bothresh == null ? 0 : q.bothresh) + ')' +
            (q.bothresh === 0 ? W.amber('   <- no backout threshold set') : '') +
            '                   BOQNAME(' + (q.boqname || '') + ')');
          out.push('');
        });
        return;
      }

      var s = /^DIS(?:PLAY)?\s+QSTATUS\s*\(\s*([^)]*)\s*\)/i.exec(line);
      if (s) {
        var q2 = findQueue(world, s[1]);
        if (!q2) { out.push('AMQ8147: IBM MQ object ' + s[1] + ' not found.'); return; }
        out.push('AMQ8450: Display queue status details.');
        out.push('   QUEUE(' + q2.name + ')                TYPE(QUEUE)');
        out.push('   CURDEPTH(' + q2.curdepth + ')        IPPROCS(' + (q2.ipprocs || 0) + ')');
        out.push('   OPPROCS(' + (q2.opprocs || 0) + ')             LGETDATE(' + (q2.lastGet ? W.isoStamp(q2.lastGet).slice(0, 10) : '') + ')');
        out.push('   LGETTIME(' + (q2.lastGet ? W.clockStr(q2.lastGet) : '') + ')');
        out.push('   UNCOM(' + (q2.uncommitted ? 'YES' : 'NO') + ')');
        out.push('');
        return;
      }

      if (/^DIS(?:PLAY)?\s+QMGR/i.test(line)) {
        out.push('AMQ8408: Display Queue Manager details.');
        out.push('   QMNAME(' + mq.qmgr + ')            DEADQ(' + (mq.deadq || 'SYSTEM.DEAD.LETTER.QUEUE') + ')');
        out.push('');
        return;
      }

      if (/^DIS(?:PLAY)?\s+CHS|^DIS(?:PLAY)?\s+CHANNEL/i.test(line)) {
        (mq.channels || []).forEach(function (c) {
          out.push('AMQ8417: Display Channel Status details.');
          out.push('   CHANNEL(' + c.name + ')          CHLTYPE(' + (c.type || 'SDR') + ')');
          out.push('   STATUS(' + (c.status === 'RUNNING' ? W.green(c.status) : W.red(c.status)) + ')' +
            '             XMITQ(' + (c.xmitq || '') + ')');
          out.push('');
        });
        if (!(mq.channels || []).length) out.push('AMQ8420: Channel Status not found.');
        return;
      }

      // ALTER QL(...) - the documented fix for a poison-message loop is to give
      // the queue a backout threshold and somewhere to put the offender.
      var alt = /^ALT(?:ER)?\s+QL(?:OCAL)?\s*\(\s*([^)]*)\s*\)\s*(.*)$/i.exec(line);
      if (alt) {
        var q3 = findQueue(world, alt[1]);
        if (!q3) { out.push('AMQ8147: IBM MQ object ' + alt[1] + ' not found.'); return; }
        var attrs = alt[2] || '';
        var bo = /BOTHRESH\s*\(\s*(\d+)\s*\)/i.exec(attrs);
        var bq = /BOQNAME\s*\(\s*([^)]*)\s*\)/i.exec(attrs);
        var md = /MAXDEPTH\s*\(\s*(\d+)\s*\)/i.exec(attrs);
        if (!bo && !bq && !md) {
          out.push('AMQ8405: Syntax error detected at or near end of command segment.');
          return;
        }
        if (bo) q3.bothresh = Number(bo[1]);
        if (bq) q3.boqname = bq[1];
        if (md) q3.maxdepth = Number(md[1]);
        out.push('AMQ8008: IBM MQ queue changed.');
        out.push('');
        if (typeof world.onMqAlter === 'function') world.onMqAlter(world, q3);
        return;
      }

      // CLEAR QLOCAL discards every message on the queue. On a trade queue that
      // is data loss, not a fix - but it is allowed, and graded accordingly.
      var clr = /^CLEAR\s+QL(?:OCAL)?\s*\(\s*([^)]*)\s*\)/i.exec(line);
      if (clr) {
        var q4 = findQueue(world, clr[1]);
        if (!q4) { out.push('AMQ8147: IBM MQ object ' + clr[1] + ' not found.'); return; }
        var lost = q4.curdepth;
        q4.curdepth = 0;
        q4.msgs = [];
        out.push('AMQ8022: IBM MQ queue cleared.');
        out.push('');
        if (typeof world.onMqClear === 'function') world.onMqClear(world, q4, lost);
        return;
      }

      if (/^END$/i.test(line)) return;

      out.push('AMQ8426: Valid MQSC commands are supported in this simulator:');
      out.push('   DIS QL(name|*)   DIS QSTATUS(name)   DIS QMGR   DIS CHS(*)');
    });

    out.push(count + ' MQSC commands read.');
    out.push('No commands have a syntax error.');
    return out.join('\n');
  }, { help: 'MQSC console: echo "DIS QL(*)" | runmqsc QMGR' });

  /* amqsbcg browses messages without consuming them - the safe way to look at
   * what is actually stuck on a queue. */
  reg('amqsbcg', function (argv, io, ctx) {
    var world = ctx.world;
    var mq = qmgr(world);
    if (!mq) return { err: 'amqsbcg: command not found on this host', code: 127 };
    var q = findQueue(world, argv[1]);
    if (!q) return { err: 'amqsbcg: MQOPEN failed, reason 2085 (MQRC_UNKNOWN_OBJECT_NAME)', code: 1 };

    var msgs = q.msgs || [];
    if (!msgs.length) {
      return 'AMQSBCG0 - starts here\n**********************\n\n' +
        'MQOPEN - \'' + q.name + '\'\n\nno more messages\n';
    }

    var out = ['AMQSBCG0 - starts here', '**********************', '', 'MQOPEN - \'' + q.name + '\'', ''];
    msgs.slice(0, 5).forEach(function (m, i) {
      out.push('MQGET of message number ' + (i + 1) + ', CompCode:0 Reason:0');
      out.push('****Message descriptor****');
      out.push('  StrucId  : \'MD  \'  Version : 2');
      out.push('  Format : \'MQSTR   \'  Priority : ' + (m.priority || 0) +
        '  Persistence : ' + (m.persistent === false ? 0 : 1));
      out.push('  BackoutCount : ' + (m.backoutCount == null ? 0 : m.backoutCount) +
        (m.backoutCount > 10 ? W.red('   <- redelivered ' + m.backoutCount + ' times') : ''));
      out.push('  PutDate  : \'' + W.isoStamp(m.putTime || world.clock).slice(0, 10).replace(/-/g, '') +
        '\'    PutTime  : \'' + W.clockStr(m.putTime || world.clock).replace(/:/g, '') + '\'');
      out.push('  MsgId : X\'' + (m.msgId || '414d5120514d2e54524144452e4c444e') + '\'');
      out.push('****   Message      ****');
      out.push('');
      out.push(' length - ' + (m.body || '').length + ' of ' + (m.body || '').length + ' bytes');
      out.push('');
      (m.body || '').split('\n').forEach(function (l) { out.push('  ' + l); });
      out.push('');
    });
    if (msgs.length > 5) out.push('... (' + (msgs.length - 5) + ' further messages not shown)');
    out.push('no more messages');
    return out.join('\n');
  }, { help: 'browse messages on a queue without consuming: amqsbcg QUEUE QMGR' });

  /* ---------- Oracle ----------
   * sqlplus answers either a named script from the support toolkit or SQL on
   * stdin, matched on the view being queried. */
  reg('sqlplus', function (argv, io, ctx) {
    var world = ctx.world;
    var db = world.db;
    if (!db) return { err: 'sqlplus: command not found on this host', code: 127 };

    var scriptArg = argv.filter(function (a) { return a.charAt(0) === '@'; })[0];
    var sqlText = io.stdin || '';

    if (scriptArg) {
      var path = V.resolve(scriptArg.slice(1), world.cwd, world.home);
      var node = V.lookup(world.root, path);
      if (!node) return { err: 'SP2-0310: unable to open file "' + scriptArg.slice(1) + '"', code: 1 };
      sqlText = V.read(node, world);
    }

    if (!sqlText.trim()) {
      return { err: 'sqlplus: no SQL given. Run a toolkit script, e.g.\n' +
        '        sqlplus -s ' + (db.connect || 'posdb/****@POSDB') + ' @/home/gsupport/sql/blockers.sql', code: 1 };
    }

    var header = 'SQL*Plus: Release 12.2.0.1.0 Production on ' + W.dateStr(world.clock) + '\n' +
      'Connected to:\nOracle Database 19c Enterprise Edition Release 19.0.0.0.0\n';
    var quiet = argv.indexOf('-s') >= 0 || argv.indexOf('-S') >= 0;
    var body = runSql(world, sqlText);
    return (quiet ? '' : header) + body;
  }, { help: 'Oracle client: sqlplus -s user/pass@db @script.sql' });

  function table(cols, rows) {
    var widths = cols.map(function (c, i) {
      return Math.max(c.length, rows.reduce(function (m, r) {
        return Math.max(m, String(r[i] == null ? '' : r[i]).length);
      }, 0));
    });
    var out = [];
    out.push(cols.map(function (c, i) { return W.rpad(c, widths[i]); }).join(' '));
    out.push(widths.map(function (w) { return new Array(w + 1).join('-'); }).join(' '));
    rows.forEach(function (r) {
      out.push(r.map(function (v, i) { return W.rpad(v == null ? '' : v, widths[i]); }).join(' '));
    });
    out.push('');
    out.push(rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' selected.');
    return out.join('\n');
  }

  function runSql(world, sql) {
    var db = world.db;
    var s = sql.toLowerCase();

    // blocking sessions
    if (/blocking_session|v\$lock|dba_blockers|blockers/.test(s)) {
      var blocked = (db.sessions || []).filter(function (x) { return x.blockingSid; });
      if (!blocked.length) return table(['SID', 'SERIAL#', 'USERNAME', 'BLOCKING_SID', 'EVENT'], []);
      return table(
        ['BLOCKER_SID', 'BLOCKER_USER', 'BLOCKER_PROG', 'WAITER_SID', 'WAITER_USER', 'WAIT_EVENT', 'SECS'],
        blocked.map(function (b) {
          var blk = (db.sessions || []).filter(function (x) { return x.sid === b.blockingSid; })[0] || {};
          return [blk.sid, blk.username, blk.program, b.sid, b.username, b.event, b.secondsInWait];
        }));
    }

    // open transactions and undo. Checked BEFORE v$session, because the usual
    // query joins v$transaction to v$session and would otherwise match that.
    if (/v\$transaction|used_ublk|undo/.test(s)) {
      return table(['SID', 'USERNAME', 'START_TIME', 'USED_UBLK', 'USED_UREC', 'STATUS'],
        (db.transactions || []).map(function (t) {
          return [t.sid, t.username, t.startTime, t.usedUblk, t.usedUrec, t.status];
        }));
    }

    // session list
    if (/v\$session/.test(s)) {
      return table(['SID', 'SERIAL#', 'USERNAME', 'STATUS', 'PROGRAM', 'MACHINE', 'LAST_CALL_ET', 'SQL_ID'],
        (db.sessions || []).map(function (x) {
          return [x.sid, x.serial, x.username, x.status, x.program, x.machine, x.lastCallEt, x.sqlId || ''];
        }));
    }

    // tablespace
    if (/dba_data_files|tablespace|dba_free_space/.test(s)) {
      return table(['TABLESPACE_NAME', 'SIZE_MB', 'USED_MB', 'FREE_MB', 'PCT_USED'],
        (db.tablespaces || []).map(function (t) {
          var pct = W.pct(t.usedMb, t.sizeMb);
          return [t.name, t.sizeMb, t.usedMb, t.sizeMb - t.usedMb, pct >= 95 ? W.red(pct + '%') : pct + '%'];
        }));
    }

    // kill session
    var kill = /alter\s+system\s+kill\s+session\s+'(\d+)\s*,\s*(\d+)'/i.exec(sql);
    if (kill) {
      var sid = Number(kill[1]);
      var sess = (db.sessions || []).filter(function (x) { return x.sid === sid; })[0];
      if (!sess) return 'ERROR at line 1:\nORA-00030: User session ID does not exist.';
      db.sessions = (db.sessions || []).filter(function (x) { return x.sid !== sid; });
      (db.sessions || []).forEach(function (x) {
        if (x.blockingSid === sid) { x.blockingSid = null; x.event = 'SQL*Net message from client'; x.status = 'ACTIVE'; }
      });
      if (typeof world.onKillSession === 'function') world.onKillSession(world, sess);
      return 'System altered.';
    }

    if (/select\s+1\s+from\s+dual|^\s*select\s+sysdate/i.test(sql)) {
      return table(['SYSDATE'], [[W.isoStamp(world.clock)]]);
    }

    return 'ERROR at line 1:\nORA-00942: table or view does not exist\n' +
      '(this simulator answers queries against v$session, v$lock, v$transaction,\n' +
      ' dba_data_files, and ALTER SYSTEM KILL SESSION)';
  }

  /* ---------- TLS certificates ----------
   * Scoped to the two things support actually runs at 07:50: read the validity
   * dates off a certificate file, and probe what a server is presenting.
   */
  reg('openssl', function (argv, io, ctx) {
    var world = ctx.world;
    var certs = world.certs || {};
    var sub = argv[1];

    if (sub === 'version') return 'OpenSSL 1.0.2k-fips  26 Jan 2017';

    if (sub === 'x509') {
      var inIdx = argv.indexOf('-in');
      var path = inIdx > 0 ? argv[inIdx + 1] : null;
      if (!path) return { err: 'usage: openssl x509 -in FILE -noout -dates -subject', code: 1 };
      var abs = V.resolve(path, world.cwd, world.home);
      var cert = certs[abs];
      if (!cert) {
        if (!V.lookup(world.root, abs)) {
          return { err: 'unable to load certificate\nError opening Certificate ' + path, code: 1 };
        }
        return { err: 'unable to load certificate\n140234:error:0906D06C:PEM routines:PEM_read_bio:no start line', code: 1 };
      }
      var out = [];
      var wantAll = argv.indexOf('-text') >= 0;
      var expired = cert.notAfter.getTime() < world.clock.getTime();
      if (argv.indexOf('-subject') >= 0 || wantAll) out.push('subject= ' + cert.subject);
      if (argv.indexOf('-issuer') >= 0 || wantAll) out.push('issuer= ' + cert.issuer);
      if (argv.indexOf('-dates') >= 0 || argv.indexOf('-enddate') >= 0 || argv.indexOf('-startdate') >= 0 || wantAll) {
        if (argv.indexOf('-enddate') < 0) out.push('notBefore=' + W.dateStr(cert.notBefore).replace(' GMT ', ' GMT '));
        var endLine = 'notAfter=' + W.dateStr(cert.notAfter).replace(' GMT ', ' GMT ');
        out.push(expired ? W.red(endLine + '   [EXPIRED]') : endLine);
      }
      if (argv.indexOf('-ext') >= 0 || wantAll) {
        out.push('X509v3 Subject Alternative Name:');
        out.push('    ' + (cert.san || []).map(function (s) { return 'DNS:' + s; }).join(', '));
      }
      if (argv.indexOf('-modulus') >= 0) out.push('Modulus=' + (cert.modulus || 'C4A1F0'));
      if (!out.length) {
        out.push('subject= ' + cert.subject);
        out.push('notAfter=' + W.dateStr(cert.notAfter));
      }
      if (argv.indexOf('-checkend') >= 0) {
        var secs = Number(argv[argv.indexOf('-checkend') + 1] || 0);
        out.push(cert.notAfter.getTime() < world.clock.getTime() + secs * 1000
          ? 'Certificate will expire' : 'Certificate will not expire');
      }
      return out.join('\n');
    }

    if (sub === 'rsa' || sub === 'pkey') {
      var kIdx = argv.indexOf('-in');
      var kpath = kIdx > 0 ? V.resolve(argv[kIdx + 1], world.cwd, world.home) : null;
      var key = certs[kpath];
      if (!key) return { err: 'unable to load Private Key', code: 1 };
      return 'Modulus=' + (key.modulus || 'C4A1F0');
    }

    if (sub === 's_client') {
      var cIdx = argv.indexOf('-connect');
      var target = cIdx > 0 ? argv[cIdx + 1] : '';
      var served = (world.tlsEndpoints || {})[target];
      if (!served) {
        return { err: 'connect: Connection refused\nconnect:errno=111', code: 1 };
      }
      var sc = certs[served.certPath];
      if (!sc) return { err: 'unable to load certificate', code: 1 };
      var scExpired = sc.notAfter.getTime() < world.clock.getTime();
      var lines = ['CONNECTED(00000003)'];
      if (scExpired) {
        lines.push(W.red('verify error:num=10:certificate has expired'));
        lines.push(W.red('verify return:1'));
      } else {
        lines.push('verify return:1');
      }
      lines.push('---');
      lines.push('Certificate chain');
      lines.push(' 0 s:' + sc.subject);
      lines.push('   i:' + sc.issuer);
      lines.push('---');
      lines.push('SSL handshake has read 3412 bytes and written 421 bytes');
      lines.push('---');
      lines.push('    Protocol  : TLSv1.2');
      lines.push('    Cipher    : ECDHE-RSA-AES256-GCM-SHA384');
      lines.push('    Start Time: ' + Math.floor(world.clock.getTime() / 1000));
      lines.push('    Verify return code: ' + (scExpired ? '10 (certificate has expired)' : '0 (ok)'));
      return lines.join('\n');
    }

    return { err: 'openssl: this simulator supports x509, rsa, s_client and version', code: 1 };
  }, { help: 'certificate checks: openssl x509 -in FILE -noout -dates' });

  /* ---------- clock traceability ---------- */

  reg('chronyc', function (argv, io, ctx) {
    var world = ctx.world;
    var c = world.chrony;
    if (!c) return { err: '506 Cannot talk to daemon', code: 1 };
    var sub = argv[1] || 'tracking';

    if (/^track/i.test(sub)) {
      var off = c.offsetSeconds;
      var offStr = (off >= 0 ? '+' : '-') + Math.abs(off).toExponential(3).replace('e', 'e') + ' seconds';
      var human = Math.abs(off) >= 0.001
        ? W.red(offStr + '  (' + (Math.abs(off) * 1000).toFixed(3) + ' ms)')
        : W.green(offStr + '  (' + (Math.abs(off) * 1e6).toFixed(1) + ' us)');
      return [
        'Reference ID    : ' + (c.refid || '00000000') + ' (' + (c.source || 'unsynchronised') + ')',
        'Stratum         : ' + c.stratum,
        'Ref time (UTC)  : ' + W.dateStr(c.refTime || world.clock).replace(' GMT', ''),
        'System time     : ' + human,
        'Last offset     : ' + (c.lastOffset == null ? off : c.lastOffset).toExponential(3) + ' seconds',
        'RMS offset      : ' + (c.rmsOffset == null ? Math.abs(off) : c.rmsOffset).toExponential(3) + ' seconds',
        'Frequency       : ' + (c.frequency || 12.418).toFixed(3) + ' ppm slow',
        'Residual freq   : ' + (c.residual || 0.001).toFixed(3) + ' ppm',
        'Skew            : ' + (c.skew || 0.412).toFixed(3) + ' ppm',
        'Root delay      : ' + (c.rootDelay || 0.000102).toFixed(9) + ' seconds',
        'Root dispersion : ' + (c.rootDispersion || 0.000241).toFixed(9) + ' seconds',
        'Update interval : ' + (c.updateInterval || 16.2).toFixed(1) + ' seconds',
        'Leap status     : ' + (c.leap || 'Normal')
      ].join('\n');
    }

    if (/^sources/i.test(sub)) {
      var out = ['MS Name/IP address         Stratum Poll Reach LastRx Last sample',
        '==============================================================================='];
      (c.sources || []).forEach(function (srv) {
        var mark = srv.selected ? '^*' : (srv.reach === 0 ? '^?' : '^-');
        out.push(W.rpad(mark + ' ' + srv.name, 28) + W.lpad(srv.stratum, 6) +
          W.lpad(srv.poll || 6, 5) + W.lpad(srv.reach, 6) + W.lpad(srv.lastRx, 7) + '  ' +
          (srv.reach === 0 ? W.red('+0ns[   +0ns] +/-    0ns') :
            (srv.offset > 0 ? '+' : '') + srv.offset + 'us[' + (srv.offset > 0 ? '+' : '') +
            srv.offset + 'us] +/- ' + (srv.err || 40) + 'us'));
      });
      return out.join('\n');
    }

    return { err: 'chronyc: unknown command ' + sub + ' (try tracking or sources)', code: 1 };
  }, { help: 'clock sync status: chronyc tracking / chronyc sources' });

  /* PTP management client - what you use when NTP is not accurate enough. */
  reg('pmc', function (argv, io, ctx) {
    var world = ctx.world;
    var p = world.ptp;
    if (!p) return { err: 'pmc: ptp4l is not running on this host', code: 1 };
    var raw = argv.join(' ');

    if (/PORT_DATA_SET/i.test(raw)) {
      return ['sending: GET PORT_DATA_SET',
        '\t' + (p.clockId || '001b21.fffe.8c4402') + '-1 seq 0 RESPONSE MANAGEMENT PORT_DATA_SET',
        '\t\tportIdentity            ' + (p.clockId || '001b21.fffe.8c4402') + '-1',
        '\t\tportState               ' + (p.portState === 'SLAVE' ? W.green(p.portState) : W.red(p.portState)),
        '\t\tlogSyncInterval         -3',
        '\t\tpeerMeanPathDelay       0'].join('\n');
    }

    return ['sending: GET TIME_STATUS_NP',
      '\t' + (p.clockId || '001b21.fffe.8c4402') + '-0 seq 0 RESPONSE MANAGEMENT TIME_STATUS_NP',
      '\t\tmaster_offset              ' + (Math.abs(p.masterOffsetNs) > 100000
        ? W.red(String(p.masterOffsetNs)) : String(p.masterOffsetNs)),
      '\t\tingress_time               ' + (world.clock.getTime() * 1e6),
      '\t\tcumulativeScaledRateOffset +0.000000000',
      '\t\tgmPresent                  ' + (p.gmPresent ? 'true' : W.red('false')),
      '\t\tgmIdentity                 ' + (p.gmIdentity || '(none)')].join('\n');
  }, { help: 'PTP status: pmc -u -b 0 "GET TIME_STATUS_NP"' });

  PS.finLoaded = true;
})(PS);
