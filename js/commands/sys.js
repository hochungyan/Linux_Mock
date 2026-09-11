/* commands/sys.js - the resource and process view: top, df, du, free, ps,
 * vmstat, iostat, sar, lsof, dmesg, systemctl, kill.
 *
 * Every figure here is read out of the world object. df reports superblock
 * counters; du walks the tree. When a scenario hides bytes in a deleted-but-
 * open file the two disagree on their own - nothing special-cases it.
 */
(function (PS) {
  'use strict';

  var sh = PS.shell, V = PS.vfs, W = PS.world;
  var reg = sh.register;

  function abs(ctx, p) { return V.resolve(p, ctx.world.cwd, ctx.world.home); }

  /* ---------- df ---------- */

  reg('df', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'hiTPk' });
    var world = ctx.world;
    var list = world.filesystems.slice();

    if (a.rest.length) {
      list = a.rest.map(function (p) { return W.fsFor(world, abs(ctx, p)); })
        .filter(function (f, i, arr) { return f && arr.indexOf(f) === i; });
    }

    var rows = [], head;

    if (a.has('i')) {
      head = [W.rpad('Filesystem', 26), W.lpad('Inodes', 8), W.lpad('IUsed', 8), W.lpad('IFree', 8), W.lpad('IUse%', 6), ' Mounted on'];
      rows.push(head.join(' '));
      list.forEach(function (fs) {
        var inodes = fs.inodes || { total: 10485760, used: 90000 };
        var free = inodes.total - inodes.used;
        var p = W.pct(inodes.used, inodes.total);
        var pStr = p >= 95 ? W.red(p + '%') : p >= 85 ? W.amber(p + '%') : p + '%';
        rows.push([
          W.rpad(fs.dev, 26),
          W.lpad(a.has('h') ? W.human(inodes.total).replace(/([KMGT])$/, '$1') : inodes.total, 8),
          W.lpad(inodes.used, 8),
          W.lpad(free, 8),
          W.vpad(pStr, 6),
          ' ' + fs.mount
        ].join(' '));
      });
      return rows.join('\n');
    }

    var fmt = a.has('h') ? function (b) { return W.human(b); } : function (b) { return String(Math.round(b / 1024)); };
    head = [W.rpad('Filesystem', 26)];
    if (a.has('T')) head.push(W.rpad('Type', 6));
    head.push(W.lpad(a.has('h') ? 'Size' : '1K-blocks', a.has('h') ? 6 : 11));
    head.push(W.lpad('Used', a.has('h') ? 6 : 11));
    head.push(W.lpad(a.has('h') ? 'Avail' : 'Available', a.has('h') ? 6 : 11));
    head.push(W.lpad('Use%', 5));
    head.push(' Mounted on');
    rows.push(head.join(' '));

    list.forEach(function (fs) {
      var avail = Math.max(0, fs.size - fs.used - (fs.reserved || 0));
      var p = W.pct(fs.used, fs.size);
      var pStr = p >= 95 ? W.red(p + '%') : p >= 85 ? W.amber(p + '%') : (p + '%');
      var row = [W.rpad(fs.dev, 26)];
      if (a.has('T')) row.push(W.rpad(fs.type || 'xfs', 6));
      row.push(W.lpad(fmt(fs.size), a.has('h') ? 6 : 11));
      row.push(W.lpad(fmt(fs.used), a.has('h') ? 6 : 11));
      row.push(W.lpad(fmt(avail), a.has('h') ? 6 : 11));
      row.push(W.vpad(pStr, 5));
      row.push(' ' + fs.mount);
      rows.push(row.join(' '));
    });
    return rows.join('\n');
  }, { help: 'filesystem usage (-h human, -i inodes, -T type)' });

  /* ---------- du ---------- */

  reg('du', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'shaxcH', value: 'd' });
    var world = ctx.world;
    var maxDepth = a.vals.d != null ? parseInt(a.vals.d, 10) :
      (a.flags['max-depth'] ? parseInt(a.flags['max-depth'], 10) : (a.has('s') ? 0 : Infinity));
    var targets = a.rest.length ? a.rest : ['.'];
    var fmt = a.has('h') ? W.human : function (b) { return String(Math.ceil(b / 1024)); };
    var out = [], errs = [], grand = 0;

    targets.forEach(function (t) {
      var root = abs(ctx, t);
      var node = V.lookup(world.root, root);
      if (!node) { errs.push('du: cannot access ' + t + ': No such file or directory'); return; }

      var sizes = {};
      V.walk(world.root, root, function (p, n) {
        var sz = V.sizeOf(n, world);
        var cur = p;
        // charge every byte to this path and all its ancestors up to root
        while (true) {
          sizes[cur] = (sizes[cur] || 0) + sz;
          if (cur === root) break;
          var parent = V.dirname(cur);
          if (parent === cur) break;
          cur = parent;
        }
      });

      var rootDepth = root.split('/').filter(Boolean).length;
      Object.keys(sizes).sort().forEach(function (p) {
        var n = V.lookup(world.root, p);
        if (!n) return;
        if (!a.has('a') && n.type !== 'dir' && p !== root) return;
        var depth = p.split('/').filter(Boolean).length - rootDepth;
        if (depth > maxDepth) return;
        out.push(W.rpad(fmt(sizes[p]), 8) + p);
      });
      grand += sizes[root] || 0;
    });

    if (a.has('c')) out.push(W.rpad(fmt(grand), 8) + 'total');
    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'disk usage by path (-s -h -a --max-depth=N)' });

  /* ---------- free / memory ---------- */

  reg('free', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'mghktw' });
    var world = ctx.world;
    var div = a.has('g') ? 1073741824 : a.has('m') ? 1048576 : 1024;
    var fmt = a.has('h') ? W.human : function (b) { return String(Math.round(b / div)); };
    var m = world.mem;
    var used = m.total - m.free - m.buffers - m.cached;
    var available = m.free + m.cached * 0.85;
    var unit = a.has('h') ? '' : '';

    var rows = [];
    rows.push(W.rpad('', 14) + [W.lpad('total', 11), W.lpad('used', 11), W.lpad('free', 11),
      W.lpad('shared', 11), W.lpad('buff/cache', 11), W.lpad('available', 11)].join(' '));
    rows.push(W.rpad('Mem:', 14) + [
      W.lpad(fmt(m.total), 11), W.lpad(fmt(used), 11), W.lpad(fmt(m.free), 11),
      W.lpad(fmt(m.shared || 268435456), 11), W.lpad(fmt(m.buffers + m.cached), 11),
      W.lpad(fmt(available), 11)
    ].join(' '));
    rows.push(W.rpad('Swap:', 14) + [
      W.lpad(fmt(world.swap.total), 11), W.lpad(fmt(world.swap.used), 11),
      W.lpad(fmt(world.swap.total - world.swap.used), 11)
    ].join(' '));
    return rows.join('\n') + unit;
  }, { help: 'memory usage (-m -g -h)' });

  /* ---------- uptime / load ---------- */

  reg('uptime', function (argv, io, ctx) {
    var world = ctx.world;
    var days = Math.floor(world.bootSeconds / 86400);
    var hrs = Math.floor((world.bootSeconds % 86400) / 3600);
    var mins = Math.floor((world.bootSeconds % 3600) / 60);
    var up = days + ' days, ' + (hrs < 10 ? ' ' : '') + hrs + ':' + (mins < 10 ? '0' : '') + mins;
    var l = world.load;
    var loadStr = l.map(function (x) { return x.toFixed(2); }).join(', ');
    if (l[0] > world.cores) loadStr = W.red(loadStr);
    else if (l[0] > world.cores * 0.7) loadStr = W.amber(loadStr);
    return ' ' + W.clockStr(world.clock) + ' up ' + up + ',  ' + world.users +
      ' users,  load average: ' + loadStr;
  }, { help: 'uptime and load average' });

  reg('w', function (argv, io, ctx) {
    var world = ctx.world;
    var out = [sh.cmds.uptime(['uptime'], io, ctx)];
    out.push('USER     TTY      FROM              LOGIN@   IDLE   JCPU   PCPU WHAT');
    out.push(W.rpad(world.user, 9) + 'pts/0    10.14.22.71      ' +
      W.clockStr(W.offset(world.clock, -420)) + '   0.00s  0.12s  0.02s w');
    out.push(W.rpad('root', 9) + 'pts/2    10.14.22.19      ' +
      W.clockStr(W.offset(world.clock, -9800)) + '   2:43m  0.04s  0.04s -bash');
    return out.join('\n');
  }, { help: 'who is logged in and what they are doing' });

  /* ---------- ps ---------- */

  function psRowAux(p, world) {
    var memPct = ((p.rss / world.mem.total) * 100).toFixed(1);
    var start = p.started ? W.clockStr(p.started).slice(0, 5) : '?';
    return [
      W.rpad(p.user, 9),
      W.lpad(p.pid, 6),
      W.lpad(p.cpu.toFixed(1), 5),
      W.lpad(memPct, 4),
      W.lpad(W.kb(p.vsz), 9),
      W.lpad(W.kb(p.rss), 8),
      W.rpad(p.tty, 6),
      W.rpad(p.state + (p.nice < 0 ? '<' : p.nice > 0 ? 'N' : '') + (p.threads ? 'l' : ''), 5),
      W.rpad(start, 6),
      W.lpad(W.mmss(p.cpuSeconds), 6),
      ' ' + p.cmd
    ].join(' ');
  }

  function psRowEf(p, world) {
    var start = p.started ? W.clockStr(p.started).slice(0, 5) : '?';
    return [
      W.rpad(p.user, 9),
      W.lpad(p.pid, 6),
      W.lpad(p.ppid, 6),
      W.lpad(Math.round(p.cpu), 3),
      W.rpad(start, 6),
      W.rpad(p.tty, 9),
      W.lpad(W.hhmmss(p.cpuSeconds), 9),
      ' ' + p.cmd
    ].join(' ');
  }

  reg('ps', function (argv, io, ctx) {
    var world = ctx.world;
    var raw = argv.slice(1).join(' ');

    // BSD syntax has no leading dash: "ps aux" and "ps auxww" are the forms
    // people actually type. Normalise them to flags before parsing.
    argv = argv.map(function (arg, i) {
      if (i === 0) return arg;
      if (arg.charAt(0) !== '-' && /^[aeflmnuwxLH]+$/.test(arg)) return '-' + arg;
      return arg;
    });

    var a = sh.parseArgs(argv, { bool: 'aeuxfLlmHw', value: 'po' });

    var procs = world.procs.slice();
    if (a.vals.p) {
      var wanted = String(a.vals.p).split(',').map(Number);
      procs = procs.filter(function (p) { return wanted.indexOf(p.pid) >= 0; });
    }

    // thread listing: ps -eLf / ps -L -p PID
    if (a.has('L') || a.has('m')) {
      var rows = ['UID          PID    PPID     LWP  C NLWP STIME TTY          TIME CMD'];
      procs.forEach(function (p) {
        var ths = p.threads || [{ tid: p.pid, cpu: p.cpu, cpuSeconds: p.cpuSeconds }];
        ths.forEach(function (t) {
          rows.push([
            W.rpad(p.user, 9),
            W.lpad(p.pid, 7),
            W.lpad(p.ppid, 7),
            W.lpad(t.tid, 7),
            W.lpad(Math.round(t.cpu), 2),
            W.lpad(ths.length, 4),
            W.rpad(p.started ? W.clockStr(p.started).slice(0, 5) : '?', 5),
            W.rpad(p.tty, 9),
            W.lpad(W.hhmmss(t.cpuSeconds), 9),
            ' ' + p.cmd
          ].join(' '));
        });
      });
      return rows.join('\n');
    }

    // custom -o format
    if (a.vals.o) {
      var fields = String(a.vals.o).split(',');
      var head = fields.map(function (f) { return W.rpad(f.toUpperCase().split('=')[0], 12); }).join(' ');
      var body = procs.map(function (p) {
        return fields.map(function (f) {
          var name = f.split('=')[0];
          var v;
          switch (name) {
            case 'pid': v = p.pid; break;
            case 'ppid': v = p.ppid; break;
            case 'user': v = p.user; break;
            case 'pcpu': case '%cpu': v = p.cpu.toFixed(1); break;
            case 'pmem': case '%mem': v = ((p.rss / world.mem.total) * 100).toFixed(1); break;
            case 'rss': v = W.kb(p.rss); break;
            case 'vsz': v = W.kb(p.vsz); break;
            case 'stat': case 's': case 'state': v = p.state; break;
            case 'etime': v = W.hhmmss((world.clock - (p.started || world.startClock)) / 1000); break;
            case 'time': case 'cputime': v = W.hhmmss(p.cpuSeconds); break;
            case 'wchan': v = p.wchan; break;
            case 'nlwp': v = p.threads ? p.threads.length : 1; break;
            case 'comm': v = p.short || p.cmd.split(' ')[0]; break;
            case 'args': case 'cmd': case 'command': v = p.cmd; break;
            default: v = '-';
          }
          return W.rpad(v, 12);
        }).join(' ');
      });
      return [head].concat(body).join('\n');
    }

    if (/\bu\b/.test(raw) || a.has('u')) {
      var head2 = [W.rpad('USER', 9), W.lpad('PID', 6), W.lpad('%CPU', 5), W.lpad('%MEM', 4),
        W.lpad('VSZ', 9), W.lpad('RSS', 8), W.rpad('TTY', 6), W.rpad('STAT', 5),
        W.rpad('START', 6), W.lpad('TIME', 6), ' COMMAND'].join(' ');
      return [head2].concat(procs.map(function (p) { return psRowAux(p, world); })).join('\n');
    }

    if (a.has('e') || a.has('f') || a.has('a')) {
      var head3 = [W.rpad('UID', 9), W.lpad('PID', 6), W.lpad('PPID', 6), W.lpad('C', 3),
        W.rpad('STIME', 6), W.rpad('TTY', 9), W.lpad('TIME', 9), ' CMD'].join(' ');
      return [head3].concat(procs.map(function (p) { return psRowEf(p, world); })).join('\n');
    }

    // bare ps: this shell's own processes
    return ['   PID TTY          TIME CMD',
      W.lpad(4471, 6) + ' pts/0    00:00:00 bash',
      W.lpad(4988, 6) + ' pts/0    00:00:00 ps'].join('\n');
  }, { help: 'process list (aux, -ef, -eLf, -p PID, -o fmt)' });

  reg('pgrep', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'lfa' });
    var needle = a.rest[0] || '';
    var hits = W.procsMatching(ctx.world, needle);
    if (!hits.length) return { out: '', code: 1 };
    return hits.map(function (p) {
      return a.has('l') || a.has('a') ? p.pid + ' ' + p.cmd : String(p.pid);
    }).join('\n');
  }, { help: 'find pids by name' });

  reg('pidof', function (argv, io, ctx) {
    var hits = W.procsMatching(ctx.world, argv[1] || '');
    if (!hits.length) return { out: '', code: 1 };
    return hits.map(function (p) { return p.pid; }).join(' ');
  }, { help: 'pid of a named program' });

  /* ---------- kill ---------- */

  var SIGNALS = ['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1',
    'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'STKFLT', 'CHLD', 'CONT', 'STOP', 'TSTP',
    'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'IO', 'PWR', 'SYS'];

  reg('kill', function (argv, io, ctx) {
    var world = ctx.world;
    var args = argv.slice(1);

    if (args[0] === '-l') {
      var rows = [], line = [];
      SIGNALS.forEach(function (s, i) {
        line.push(W.lpad(i + 1, 2) + ') SIG' + W.rpad(s, 8));
        if (line.length === 5) { rows.push(line.join(' ')); line = []; }
      });
      if (line.length) rows.push(line.join(' '));
      return rows.join('\n');
    }

    var sig = 'TERM';
    if (args[0] === '-s' || args[0] === '--signal') { args.shift(); sig = args.shift() || ''; }
    else if (args[0] && args[0].charAt(0) === '-') sig = args.shift().slice(1);
    sig = sig.toUpperCase().replace(/^SIG/, '');
    if (/^\d+$/.test(sig) && sig !== '0') sig = SIGNALS[Number(sig) - 1] || '';
    if (sig !== '0' && SIGNALS.indexOf(sig) < 0) return { err: 'kill: invalid signal', code: 1 };
    if (!args.length) return { err: 'usage: kill [-s signal | -signal] pid', code: 2 };
    var errs = [], out = [];
    args.forEach(function (pidStr) {
      var pid = Number(pidStr);
      var p = W.findProc(world, pid);
      if (!p) { errs.push('bash: kill: (' + pidStr + ') - No such process'); return; }
      if (sig === '0' || p.state === 'Z') return;

      // A genuine uninterruptible wait delays fatal signals. TASK_KILLABLE
      // waits may also display D but can wake for SIGKILL; D alone is no proof.
      if (p.state === 'D' && !(sig === 'KILL' && p.killableWait)) {
        p.pendingSignal = sig;
        out.push('(no immediate termination: signal queued; PID ' + pid + ' remains in uninterruptible sleep in this scenario until its kernel wait completes.)');
        return;
      }
      if (sig === 'STOP' || sig === 'TSTP') { p.state = 'T'; return; }
      if (sig === 'CONT') { if (p.state === 'T') p.state = 'S'; return; }

      if (sig === 'QUIT') {
        // SIGQUIT to a JVM dumps threads to stdout, i.e. into the app log
        if (p.jvm) {
          out.push('(SIGQUIT delivered - thread dump written to the process stdout log)');
          if (p.jvm.stdoutLog) {
            W.appendLog(world, p.jvm.stdoutLog, PS.jstackText(world, p));
          }
        }
        if (p.jvm) return;
      }
      if (['KILL', 'TERM', 'INT', 'HUP', 'QUIT', 'ABRT'].indexOf(sig) >= 0) {
        W.killProc(world, pid);
        if (typeof world.onKill === 'function') world.onKill(world, p, sig);
      }
    });
    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'send a signal: kill -9 PID, kill -3 PID (JVM thread dump)' });

  reg('pkill', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'f9', value: 's' });
    var needle = a.rest[0] || '';
    if (!needle) return { err: 'pkill: no matching criteria specified', code: 2 };
    var hits = W.procsMatching(ctx.world, needle);
    if (!hits.length) return { out: '', code: 1 };
    return sh.cmds.kill(['kill', a.has('9') ? '-9' : '-TERM'].concat(hits.map(function (p) { return String(p.pid); })), io, ctx);
  }, { help: 'kill by name' });
  sh.alias('killall', 'pkill');

  /* ---------- top ---------- */

  function topScreen(world, opts) {
    var lines = [];
    var procs = world.procs.slice();
    var threadMode = opts.threads;

    var rows = [];
    if (threadMode) {
      procs.forEach(function (p) {
        (p.threads || [{ tid: p.pid, name: p.short || p.cmd, cpu: p.cpu, cpuSeconds: p.cpuSeconds, state: 'R' }])
          .forEach(function (t) {
            rows.push({
              pid: t.tid, user: p.user, pri: p.pri, ni: p.nice, virt: p.vsz, res: p.rss,
              shr: Math.round(p.rss * 0.08), s: t.osState || (/^[RSDTZ]$/.test(t.state) ? t.state : t.state === 'RUNNABLE' && t.cpu > 0 ? 'R' : 'S'),
              cpu: t.cpu, mem: (p.rss / world.mem.total) * 100, time: t.cpuSeconds,
              cmd: p.short || p.cmd.split(' ')[0]
            });
          });
      });
    } else {
      procs.forEach(function (p) {
        rows.push({
          pid: p.pid, user: p.user, pri: p.pri, ni: p.nice, virt: p.vsz, res: p.rss,
          shr: Math.round(p.rss * 0.08), s: p.state, cpu: p.cpu,
          mem: (p.rss / world.mem.total) * 100, time: p.cpuSeconds,
          cmd: p.short || p.cmd.split(' ')[0].split('/').pop()
        });
      });
    }
    if (opts.pid) rows = rows.filter(function (r) { return opts.pid.indexOf(r.pid) >= 0 || (!threadMode && opts.pid.indexOf(r.pid) >= 0); });
    if (threadMode && opts.pid) {
      rows = [];
      procs.filter(function (p) { return opts.pid.indexOf(p.pid) >= 0; }).forEach(function (p) {
        (p.threads || []).forEach(function (t) {
          rows.push({
            pid: t.tid, user: p.user, pri: p.pri, ni: p.nice, virt: p.vsz, res: p.rss,
            shr: Math.round(p.rss * 0.08),
            s: t.osState || (/^[RSDTZ]$/.test(t.state) ? t.state : t.state === 'RUNNABLE' && t.cpu > 0 ? 'R' : 'S'),
            cpu: t.cpu, mem: (p.rss / world.mem.total) * 100, time: t.cpuSeconds,
            cmd: t.name || (p.short || p.cmd.split(' ')[0])
          });
        });
      });
    }

    rows.sort(function (x, y) { return opts.sortMem ? y.res - x.res : y.cpu - x.cpu; });

    var days = Math.floor(world.bootSeconds / 86400);
    var hrs = Math.floor((world.bootSeconds % 86400) / 3600);
    var mins = Math.floor((world.bootSeconds % 3600) / 60);
    var tasks = world.procs.length + 138;

    lines.push('top - ' + W.clockStr(world.clock) + ' up ' + days + ' days, ' + hrs + ':' +
      (mins < 10 ? '0' : '') + mins + ',  ' + world.users + ' users,  load average: ' +
      world.load.map(function (x) { return x.toFixed(2); }).join(', '));
    lines.push('Tasks: ' + W.lpad(tasks, 4) + ' total,   ' +
      world.procs.filter(function (p) { return p.state === 'R'; }).length + ' running, ' +
      W.lpad(tasks - 1, 4) + ' sleeping,   0 stopped,   ' +
      world.procs.filter(function (p) { return p.state === 'Z'; }).length + ' zombie');

    var c = world.cpu;
    var cpuLine = '%Cpu(s): ' + W.lpad(c.us.toFixed(1), 5) + ' us, ' + W.lpad(c.sy.toFixed(1), 4) + ' sy, ' +
      W.lpad(c.ni.toFixed(1), 4) + ' ni, ' + W.lpad(c.id.toFixed(1), 5) + ' id, ' +
      W.lpad(c.wa.toFixed(1), 5) + ' wa,  0.0 hi,  0.1 si, ' + W.lpad(c.st.toFixed(1), 4) + ' st';
    if (c.wa > 15) cpuLine = cpuLine.replace(W.lpad(c.wa.toFixed(1), 5) + ' wa', W.red(W.lpad(c.wa.toFixed(1), 5) + ' wa'));
    lines.push(cpuLine);

    var m = world.mem;
    var usedMem = m.total - m.free - m.buffers - m.cached;
    lines.push('KiB Mem : ' + W.lpad(W.kb(m.total), 11) + ' total, ' + W.lpad(W.kb(m.free), 11) +
      ' free, ' + W.lpad(W.kb(usedMem), 11) + ' used, ' + W.lpad(W.kb(m.buffers + m.cached), 11) + ' buff/cache');
    lines.push('KiB Swap: ' + W.lpad(W.kb(world.swap.total), 11) + ' total, ' +
      W.lpad(W.kb(world.swap.total - world.swap.used), 11) + ' free, ' +
      W.lpad(W.kb(world.swap.used), 11) + ' used. ' +
      W.lpad(W.kb(m.free + m.cached * 0.85), 11) + ' avail Mem');
    lines.push('');
    lines.push(W.rev(W.rpad('  ' + W.lpad('PID', 5) + ' ' + W.rpad('USER', 9) + ' ' + W.lpad('PR', 3) + ' ' +
      W.lpad('NI', 3) + ' ' + W.lpad('VIRT', 8) + ' ' + W.lpad('RES', 7) + ' ' + W.lpad('SHR', 7) + ' S ' +
      W.lpad('%CPU', 5) + ' ' + W.lpad('%MEM', 5) + ' ' + W.lpad('TIME+', 9) + ' COMMAND', 96)));

    rows.slice(0, opts.rows || 18).forEach(function (r) {
      var cpuStr = r.cpu.toFixed(1);
      if (r.cpu >= 90) cpuStr = W.red(cpuStr);
      else if (r.cpu >= 50) cpuStr = W.amber(cpuStr);
      lines.push('  ' + W.lpad(r.pid, 5) + ' ' + W.rpad(r.user, 9) + ' ' + W.lpad(r.pri, 3) + ' ' +
        W.lpad(r.ni, 3) + ' ' + W.lpad(W.kb(r.virt), 8) + ' ' + W.lpad(W.kb(r.res), 7) + ' ' +
        W.lpad(W.kb(r.shr), 7) + ' ' + (r.s === 'D' ? W.red('D') : r.s) + ' ' +
        W.vpad(cpuStr, 5) + ' ' + W.lpad(r.mem.toFixed(1), 5) + ' ' +
        W.lpad(W.cputime(r.time), 9) + ' ' + r.cmd);
    });
    return lines.join('\n');
  }

  reg('top', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'HbciM', value: 'pnd' });
    var opts = {
      threads: a.has('H'),
      sortMem: a.has('M'),
      pid: a.vals.p ? String(a.vals.p).split(',').map(Number) : null,
      rows: 18
    };
    if (a.has('b')) {
      opts.rows = parseInt(a.vals.n, 10) ? 25 : 25;
      return topScreen(ctx.world, opts);
    }
    return {
      out: '',
      app: {
        type: 'screen',
        label: argv.join(' '),
        render: function (world) { return topScreen(world, opts); },
        footer: 'press q or Ctrl+C to quit top'
      }
    };
  }, { help: 'live process view (-H threads, -p PID, -b batch)' });
  sh.alias('htop', 'top');

  /* ---------- vmstat / iostat / sar ---------- */

  reg('vmstat', function (argv, io, ctx) {
    var world = ctx.world;
    var a = sh.parseArgs(argv, { bool: 'sa' });
    var count = parseInt(a.rest[1], 10) || (a.rest[0] ? 5 : 1);
    var rows = [
      'procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----',
      ' r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st'
    ];
    var m = world.mem, c = world.cpu;
    var io_ = world.diskio[0] || { readKB: 40, writeKB: 300 };
    for (var i = 0; i < count; i++) {
      var jitter = world.rand();
      rows.push([
        W.lpad(world.procs.filter(function (p) { return p.state === 'R'; }).length, 2),
        W.lpad(world.procs.filter(function (p) { return p.state === 'D'; }).length, 2),
        W.lpad(W.kb(world.swap.used), 6),
        W.lpad(W.kb(m.free), 6),
        W.lpad(W.kb(m.buffers), 6),
        W.lpad(W.kb(m.cached), 6),
        W.lpad(world.swap.si || 0, 4),
        W.lpad(world.swap.so || 0, 4),
        W.lpad(Math.round(io_.readKB * (0.9 + jitter * 0.2)), 5),
        W.lpad(Math.round(io_.writeKB * (0.9 + jitter * 0.2)), 5),
        W.lpad(Math.round(9000 + jitter * 3000), 4),
        W.lpad(Math.round(14000 + jitter * 6000), 5),
        W.lpad(Math.round(c.us), 2), W.lpad(Math.round(c.sy), 2),
        W.lpad(Math.round(c.id), 2), W.lpad(Math.round(c.wa), 2), W.lpad(Math.round(c.st), 2)
      ].join(' '));
    }
    return rows.join('\n');
  }, { help: 'virtual memory / io / cpu summary' });

  reg('iostat', function (argv, io, ctx) {
    var world = ctx.world;
    var a = sh.parseArgs(argv, { bool: 'xdmzck' });
    var out = [];
    out.push('Linux ' + world.kernel + ' (' + world.host + ') \t' +
      W.isoStamp(world.clock).slice(0, 10) + '\t_x86_64_\t(' + world.cores + ' CPU)');
    out.push('');
    if (!a.has('d')) {
      var c = world.cpu;
      out.push('avg-cpu:  %user   %nice %system %iowait  %steal   %idle');
      out.push('        ' + W.lpad(c.us.toFixed(2), 7) + W.lpad(c.ni.toFixed(2), 8) +
        W.lpad(c.sy.toFixed(2), 8) + W.lpad(c.wa.toFixed(2), 8) +
        W.lpad(c.st.toFixed(2), 8) + W.lpad(c.id.toFixed(2), 8));
      out.push('');
    }
    if (a.has('x')) {
      out.push('Device:         rrqm/s   wrqm/s     r/s     w/s    rkB/s    wkB/s avgrq-sz avgqu-sz   await r_await w_await  svctm  %util');
      world.diskio.forEach(function (d) {
        var util = d.util || 3;
        var awaitStr = (d.await || 0.6).toFixed(2);
        if (d.await > 50) awaitStr = W.red(awaitStr);
        else if (d.await > 15) awaitStr = W.amber(awaitStr);
        var utilStr = util.toFixed(2);
        if (util > 90) utilStr = W.red(utilStr);
        else if (util > 60) utilStr = W.amber(utilStr);
        out.push(W.rpad(d.dev, 14) +
          W.lpad((d.rrqm || 0).toFixed(2), 8) + W.lpad((d.wrqm || 0).toFixed(2), 9) +
          W.lpad((d.rs || 0).toFixed(2), 8) + W.lpad((d.ws || 0).toFixed(2), 8) +
          W.lpad((d.readKB || 0).toFixed(2), 9) + W.lpad((d.writeKB || 0).toFixed(2), 9) +
          W.lpad((d.avgrq || 32).toFixed(2), 9) + W.lpad((d.queue || 0.02).toFixed(2), 9) +
          W.vpad(awaitStr, 8) + W.lpad((d.rawait || d.await || 0.6).toFixed(2), 8) +
          W.lpad((d.wawait || d.await || 0.6).toFixed(2), 8) +
          W.lpad((d.svctm || 0.3).toFixed(2), 7) + W.vpad(utilStr, 7));
      });
    } else {
      out.push('Device:            tps    kB_read/s    kB_wrtn/s    kB_read    kB_wrtn');
      world.diskio.forEach(function (d) {
        out.push(W.rpad(d.dev, 14) + W.lpad(((d.rs || 0) + (d.ws || 0)).toFixed(2), 10) +
          W.lpad((d.readKB || 0).toFixed(2), 13) + W.lpad((d.writeKB || 0).toFixed(2), 13) +
          W.lpad(W.comma((d.totalRead || 0)), 11) + W.lpad(W.comma((d.totalWrite || 0)), 11));
      });
    }
    return out.join('\n');
  }, { help: 'per-device I/O statistics (-x extended)' });

  /* mpstat - the tool that answers "is the load spread across cores, or is one
   * core pinned while the machine-wide average looks fine". */
  reg('mpstat', function (argv, io, ctx) {
    var world = ctx.world;
    var all = argv.indexOf('ALL') >= 0 || argv.indexOf('-P') >= 0;
    var c = world.cpu;
    var out = ['Linux ' + world.kernel + ' (' + world.host + ') \t' +
      W.isoStamp(world.clock).slice(0, 10) + '\t_x86_64_\t(' + world.cores + ' CPU)', ''];
    out.push(W.rpad(W.clockStr(world.clock), 12) + W.lpad('CPU', 5) + W.lpad('%usr', 8) +
      W.lpad('%nice', 8) + W.lpad('%sys', 8) + W.lpad('%iowait', 9) + W.lpad('%irq', 7) +
      W.lpad('%soft', 8) + W.lpad('%steal', 8) + W.lpad('%idle', 8));

    function row(label, v) {
      var idle = v.id.toFixed(2);
      var usr = v.us.toFixed(2);
      if (v.us > 90) usr = W.red(usr);
      var wa = v.wa.toFixed(2);
      if (v.wa > 15) wa = W.red(wa);
      return W.rpad(W.clockStr(world.clock), 12) + W.lpad(label, 5) + W.vpad(usr, 8) +
        W.lpad((v.ni || 0).toFixed(2), 8) + W.lpad(v.sy.toFixed(2), 8) + W.vpad(wa, 9) +
        W.lpad('0.00', 7) + W.lpad((v.si || 0.05).toFixed(2), 8) +
        W.lpad((v.st || 0).toFixed(2), 8) + W.lpad(idle, 8);
    }

    out.push(row('all', c));
    if (all) {
      var per = world.percore;
      for (var i = 0; i < world.cores; i++) {
        out.push(row(String(i), (per && per[i]) ? per[i] : c));
      }
    }
    return out.join('\n');
  }, { help: 'per-core CPU statistics (mpstat -P ALL)' });

  reg('pidstat', function (argv, io, ctx) {
    var world = ctx.world;
    var wantCtx = argv.indexOf('-w') >= 0;
    var out = ['Linux ' + world.kernel + ' (' + world.host + ') \t' +
      W.isoStamp(world.clock).slice(0, 10) + '\t_x86_64_\t(' + world.cores + ' CPU)', ''];
    if (wantCtx) {
      out.push(W.rpad(W.clockStr(world.clock), 12) + W.lpad('UID', 6) + W.lpad('PID', 8) +
        W.lpad('cswch/s', 11) + W.lpad('nvcswch/s', 11) + '  Command');
      world.procs.forEach(function (p) {
        out.push(W.rpad(W.clockStr(world.clock), 12) + W.lpad(p.user === 'root' ? 0 : 1042, 6) +
          W.lpad(p.pid, 8) + W.lpad((p.cswch || p.cpu * 8).toFixed(2), 11) +
          W.lpad((p.nvcswch || p.cpu * 1.2).toFixed(2), 11) + '  ' + (p.short || p.cmd.split(' ')[0]));
      });
      return out.join('\n');
    }
    out.push(W.rpad(W.clockStr(world.clock), 12) + W.lpad('UID', 6) + W.lpad('PID', 8) +
      W.lpad('%usr', 8) + W.lpad('%system', 9) + W.lpad('%CPU', 8) + W.lpad('CPU', 5) + '  Command');
    world.procs.slice().sort(function (a, b) { return b.cpu - a.cpu; }).forEach(function (p) {
      out.push(W.rpad(W.clockStr(world.clock), 12) + W.lpad(p.user === 'root' ? 0 : 1042, 6) +
        W.lpad(p.pid, 8) + W.lpad((p.cpu * 0.9).toFixed(2), 8) + W.lpad((p.cpu * 0.1).toFixed(2), 9) +
        W.lpad(p.cpu.toFixed(2), 8) + W.lpad(p.pid % world.cores, 5) + '  ' + (p.short || p.cmd.split(' ')[0]));
    });
    return out.join('\n');
  }, { help: 'per-process CPU (pidstat) or context switches (pidstat -w)' });

  reg('sar', function (argv, io, ctx) {
    var world = ctx.world;
    var a = sh.parseArgs(argv, { bool: 'rubqdnw' });
    var out = ['Linux ' + world.kernel + ' (' + world.host + ') \t' +
      W.isoStamp(world.clock).slice(0, 10) + '\t_x86_64_\t(' + world.cores + ' CPU)', ''];
    var samples = 6;
    var t0 = W.offset(world.clock, -samples * 600);

    if (a.has('r')) {
      out.push('             kbmemfree kbmemused  %memused kbbuffers  kbcached  kbcommit   %commit');
      for (var i = 0; i <= samples; i++) {
        var frac = i / samples;
        var free = world.mem.free + (world.notes.memTrend ? world.notes.memTrend * (1 - frac) : 0);
        var used = world.mem.total - free;
        out.push(W.clockStr(W.offset(t0, i * 600)).slice(0, 8) + '  ' +
          W.lpad(W.kb(free), 10) + W.lpad(W.kb(used), 10) +
          W.lpad(W.pct(used, world.mem.total).toFixed(2), 10) +
          W.lpad(W.kb(world.mem.buffers), 10) + W.lpad(W.kb(world.mem.cached), 10) +
          W.lpad(W.kb(used * 1.1), 10) + W.lpad((W.pct(used, world.mem.total) * 1.1).toFixed(2), 10));
      }
      return out.join('\n');
    }
    if (a.has('b') || a.has('d')) {
      out.push('                  tps      rtps      wtps   bread/s   bwrtn/s');
      var d0 = world.diskio[0] || {};
      for (var k = 0; k <= samples; k++) {
        out.push(W.clockStr(W.offset(t0, k * 600)).slice(0, 8) + '  ' +
          W.lpad(((d0.rs || 0) + (d0.ws || 0)).toFixed(2), 9) +
          W.lpad((d0.rs || 0).toFixed(2), 10) + W.lpad((d0.ws || 0).toFixed(2), 10) +
          W.lpad(((d0.readKB || 0) * 2).toFixed(2), 10) + W.lpad(((d0.writeKB || 0) * 2).toFixed(2), 10));
      }
      return out.join('\n');
    }
    out.push('                CPU     %user     %nice   %system   %iowait    %steal     %idle');
    var c = world.cpu;
    for (var j = 0; j <= samples; j++) {
      out.push(W.clockStr(W.offset(t0, j * 600)).slice(0, 8) + '       all' +
        W.lpad(c.us.toFixed(2), 10) + W.lpad(c.ni.toFixed(2), 10) + W.lpad(c.sy.toFixed(2), 10) +
        W.lpad(c.wa.toFixed(2), 10) + W.lpad(c.st.toFixed(2), 10) + W.lpad(c.id.toFixed(2), 10));
    }
    return out.join('\n');
  }, { help: 'historical activity (-u cpu, -r memory, -b io)' });

  /* ---------- lsof ---------- */

  reg('lsof', function (argv, io, ctx) {
    var world = ctx.world;
    var args = argv.slice(1);
    var wantDeleted = args.indexOf('+L1') >= 0;
    var pidFilter = null, netFilter = null, pathFilter = null, userFilter = null;

    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-p') pidFilter = Number(args[++i]);
      else if (args[i].indexOf('-p') === 0 && args[i].length > 2) pidFilter = Number(args[i].slice(2));
      else if (args[i] === '-i') netFilter = args[i + 1] && args[i + 1].charAt(0) !== '-' ? args[++i] : 'all';
      else if (args[i].indexOf('-i') === 0 && args[i].length > 2) netFilter = args[i].slice(2);
      else if (args[i] === '-u') userFilter = args[++i];
      else if (args[i].charAt(0) !== '-' && args[i] !== '+L1') pathFilter = args[i];
    }

    var rows = [];
    var header = W.rpad('COMMAND', 12) + W.lpad('PID', 7) + ' ' + W.rpad('USER', 10) +
      W.lpad('FD', 6) + '   ' + W.rpad('TYPE', 8) + W.rpad('DEVICE', 11) +
      W.lpad('SIZE/OFF', 15) + W.lpad('NLINK', 7) + W.lpad('NODE', 11) + ' NAME';

    if (wantDeleted) {
      world.deleted.forEach(function (d) {
        if (pidFilter && d.pid !== pidFilter) return;
        // NLINK 0 is the whole point of +L1: the path is gone, the inode is not.
        rows.push(W.rpad(shortCmd(d.cmd), 12) + W.lpad(d.pid, 7) + ' ' + W.rpad(d.user, 10) +
          W.lpad(d.fd + 'w', 6) + '   ' + W.rpad('REG', 8) + W.rpad('253,3', 11) +
          W.lpad(d.size, 15) + W.vpad(W.red('0'), 7) + W.lpad(d.inode || 4718603, 11) +
          ' ' + d.path + ' ' + W.red('(deleted)'));
      });
      if (!rows.length) return { out: '', code: 1 };
      return [header].concat(rows).join('\n');
    }

    world.procs.forEach(function (p) {
      if (pidFilter && p.pid !== pidFilter) return;
      if (userFilter && p.user !== userFilter) return;

      if (!netFilter) {
        (p.fds || []).forEach(function (f) {
          if (pathFilter && f.path.indexOf(pathFilter) < 0) return;
          rows.push(W.rpad(shortCmd(p.cmd), 12) + W.lpad(p.pid, 7) + ' ' + W.rpad(p.user, 10) +
            W.lpad(f.fd + (f.mode || 'r'), 6) + '   ' + W.rpad(f.type || 'REG', 8) +
            W.rpad('253,3', 11) + W.lpad(f.size == null ? 0 : f.size, 15) +
            W.lpad(1, 7) + W.lpad(f.inode || (4718000 + p.pid % 997 + f.fd * 13), 11) +
            ' ' + f.path);
        });
      }

      world.sockets.filter(function (s) { return s.pid === p.pid; }).forEach(function (s) {
        if (netFilter && netFilter !== 'all') {
          var nf = netFilter.replace(/^[46]/, '');
          if (nf.charAt(0) === ':' && String(s.local).indexOf(nf.slice(1)) < 0) return;
          if (/^(TCP|UDP)$/i.test(nf) && s.proto.toUpperCase().indexOf(nf.toUpperCase()) !== 0) return;
        }
        var name = s.proto.toLowerCase() === 'udp'
          ? s.local + (s.peer ? '->' + s.peer : '')
          : s.local + '->' + s.peer + ' (' + s.state + ')';
        rows.push(W.rpad(shortCmd(p.cmd), 12) + W.lpad(p.pid, 7) + ' ' + W.rpad(p.user, 10) +
          W.lpad((s.fd || 0) + 'u', 6) + '   ' + W.rpad('IPv4', 8) + W.rpad(String(s.node || 90210), 11) +
          W.lpad('0t0', 15) + W.lpad('', 7) + W.rpad(s.proto.toUpperCase(), 11) + ' ' + name);
      });
    });

    if (!rows.length) return { out: '', code: 1 };
    return [header].concat(rows).join('\n');
  }, { help: 'open files and sockets (-p PID, -i, +L1 for deleted)' });

  function shortCmd(cmd) {
    var first = cmd.split(' ')[0].split('/').pop();
    return first.slice(0, 12);
  }

  /* ---------- dmesg / kernel ---------- */

  reg('dmesg', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'THwx' });
    var world = ctx.world;
    return world.dmesg.map(function (d) {
      var stamp = a.has('T')
        ? '[' + W.dateStr(d.time).replace(' GMT', '') + '] '
        : '[' + W.lpad(((d.time - world.startClock) / 1000 + world.bootSeconds).toFixed(6), 13) + '] ';
      var text = d.text;
      if (/Out of memory|oom-kill|Killed process|error|I\/O error|nfs: server/i.test(text)) text = W.red(text);
      return stamp + text;
    }).join('\n');
  }, { help: 'kernel ring buffer (-T for human timestamps)' });

  reg('uname', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'asrnmvpio' });
    var w = ctx.world;
    if (a.has('a') || !argv[1]) {
      if (!argv[1]) return 'Linux';
      return 'Linux ' + w.host + ' ' + w.kernel + ' #1 SMP Thu Jan 11 09:22:15 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux';
    }
    if (a.has('r')) return w.kernel;
    if (a.has('n')) return w.host;
    if (a.has('m')) return 'x86_64';
    return 'Linux';
  }, { help: 'kernel/system name (-a)' });

  reg('nproc', function (argv, io, ctx) { return String(ctx.world.cores); }, { help: 'cpu count' });

  reg('lscpu', function (argv, io, ctx) {
    var w = ctx.world;
    return [
      'Architecture:          x86_64',
      'CPU op-mode(s):        32-bit, 64-bit',
      'Byte Order:            Little Endian',
      'CPU(s):                ' + w.cores,
      'On-line CPU(s) list:   0-' + (w.cores - 1),
      'Thread(s) per core:    1',
      'Core(s) per socket:    ' + (w.cores / 2),
      'Socket(s):             2',
      'NUMA node(s):          2',
      'Vendor ID:             GenuineIntel',
      'Model name:            ' + w.model,
      'CPU MHz:               3600.000',
      'L3 cache:              25344K',
      'NUMA node0 CPU(s):     0-' + (w.cores / 2 - 1),
      'NUMA node1 CPU(s):     ' + (w.cores / 2) + '-' + (w.cores - 1)
    ].join('\n');
  }, { help: 'cpu details' });

  reg('mount', function (argv, io, ctx) {
    var world = ctx.world;
    if (argv.length > 1) return { err: 'mount: only permitted to root in this simulator', code: 1 };
    var out = world.filesystems.map(function (fs) {
      return fs.dev + ' on ' + fs.mount + ' type ' + (fs.type || 'xfs') +
        ' (' + (fs.opts || 'rw,relatime,attr2,inode64,noquota') + ')';
    });
    (world.mounts || []).forEach(function (m) { out.push(m); });
    return out.join('\n');
  }, { help: 'mounted filesystems' });

  reg('ulimit', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'anuscfHS' });
    var lim = ctx.world.limits || {};
    if (a.has('n')) return String(lim.nofile || 65536);
    if (a.has('u')) return String(lim.nproc || 4096);
    if (a.has('a')) {
      return [
        'core file size          (blocks, -c) 0',
        'data seg size           (kbytes, -d) unlimited',
        'file size               (blocks, -f) unlimited',
        'pending signals                 (-i) 256634',
        'max locked memory       (kbytes, -l) 64',
        'open files                      (-n) ' + (lim.nofile || 65536),
        'pipe size            (512 bytes, -p) 8',
        'stack size              (kbytes, -s) 8192',
        'max user processes              (-u) ' + (lim.nproc || 4096),
        'virtual memory          (kbytes, -v) unlimited'
      ].join('\n');
    }
    return 'unlimited';
  }, { help: 'shell resource limits (-a, -n)' });

  reg('sysctl', function (argv, io, ctx) {
    var key = argv[argv.length - 1];
    var vals = ctx.world.sysctl || {};
    if (argv[1] === '-a') {
      return Object.keys(vals).map(function (k) { return k + ' = ' + vals[k]; }).join('\n');
    }
    if (vals[key] != null) return key + ' = ' + vals[key];
    return { err: 'sysctl: cannot stat /proc/sys/' + String(key).replace(/\./g, '/') + ': No such file or directory', code: 1 };
  }, { help: 'kernel parameters' });

  /* ---------- systemd ---------- */

  reg('systemctl', function (argv, io, ctx) {
    var world = ctx.world;
    var verb = argv[1], unit = argv[2];
    var svc = world.services[unit] || world.services[String(unit).replace(/\.service$/, '')];

    if (!verb || verb === 'list-units' || verb === 'list-unit-files') {
      var rows = ['UNIT                          LOAD   ACTIVE SUB     DESCRIPTION'];
      Object.keys(world.services).forEach(function (k) {
        var s = world.services[k];
        rows.push(W.rpad(k + '.service', 30) + W.rpad('loaded', 7) +
          W.rpad(s.active ? W.green('active') : W.red('failed'), s.active ? 16 : 14) +
          W.rpad(s.sub || (s.active ? 'running' : 'dead'), 8) + (s.desc || k));
      });
      return rows.join('\n');
    }

    if (!svc) return { err: 'Unit ' + unit + '.service could not be found.', code: 4 };

    switch (verb) {
      case 'status':
        var head = (svc.active ? W.green('●') : W.red('●')) + ' ' + unit + '.service - ' + (svc.desc || unit);
        return [
          head,
          '   Loaded: loaded (/usr/lib/systemd/system/' + unit + '.service; enabled; vendor preset: disabled)',
          '   Active: ' + (svc.active ? W.green('active (running)') : W.red('failed (Result: exit-code)')) +
            ' since ' + W.dateStr(svc.since || world.startClock) + '; ' +
            W.hhmmss((world.clock - (svc.since || world.startClock)) / 1000) + ' ago',
          ' Main PID: ' + (svc.pid || '-') + ' (' + (svc.exe || unit) + ')',
          '    Tasks: ' + (svc.tasks || 1),
          '   CGroup: /system.slice/' + unit + '.service',
          '           └─' + (svc.pid || '-') + ' ' + (svc.cmd || unit),
          ''
        ].concat((svc.log || []).map(function (l) {
          return W.syslogStamp(world.clock) + ' ' + world.host + ' ' + unit + '[' + (svc.pid || 0) + ']: ' + l;
        })).join('\n');

      case 'restart':
      case 'start':
      case 'stop':
        if (svc.requiresRoot !== false && world.user !== 'root') {
          return {
            err: 'Failed to ' + verb + ' ' + unit + '.service: Access denied\n' +
              'See system logs and \'systemctl status ' + unit + '.service\' for details.',
            code: 4
          };
        }
        if (typeof world.onService === 'function') {
          var handled = world.onService(world, verb, unit, svc);
          if (handled) return handled === true ? '' : handled;
        }
        svc.active = verb !== 'stop';
        return '';

      case 'is-active':
        return svc.active ? 'active' : 'failed';
      default:
        return { err: 'Unknown operation ' + verb + '.', code: 1 };
    }
  }, { help: 'service control (status/restart/start/stop)' });

  reg('service', function (argv, io, ctx) {
    return sh.cmds.systemctl(['systemctl', argv[2], argv[1]], io, ctx);
  }, { help: 'sysv service wrapper' });

  reg('journalctl', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'ferx', value: 'un' });
    var world = ctx.world;
    var unit = a.vals.u;
    var n = parseInt(a.vals.n, 10) || 40;
    var svc = unit && (world.services[unit] || world.services[String(unit).replace(/\.service$/, '')]);
    var body = svc && svc.log ? svc.log : (world.journal || []);
    return body.slice(-n).map(function (l) {
      var text = typeof l === 'string' ? l : l.text;
      var stamp = typeof l === 'string' ? W.syslogStamp(world.clock) : W.syslogStamp(l.time);
      var line = stamp + ' ' + world.host + ' ' + (unit || 'systemd') + ': ' + text;
      return /error|fail|fatal|OOM|killed/i.test(text) ? W.red(line) : line;
    }).join('\n');
  }, { help: 'systemd journal (-u unit, -n lines)' });

  PS.sysLoaded = true;
})(PS);
