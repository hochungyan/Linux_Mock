/* commands/java.js - jps, jstack, jmap, jstat, jcmd, jinfo.
 *
 * The thread dump is generated from the same thread objects `top -H` reports,
 * so the classic workflow works for real: take the hot or stuck TID from
 * top -H, convert it to hex, and find that nid= in the dump.
 */
(function (PS) {
  'use strict';

  var sh = PS.shell, W = PS.world;
  var reg = sh.register;

  function jvmProcs(world) {
    return world.procs.filter(function (p) { return p.jvm; });
  }

  function requireJvm(world, pid, cmdName) {
    if (!pid) {
      var js = jvmProcs(world);
      if (js.length === 1) return js[0];
      return { error: 'usage: ' + cmdName + ' <pid>' };
    }
    var p = W.findProc(world, Number(pid));
    if (!p) return { error: cmdName + ': No such process: ' + pid };
    if (!p.jvm) return { error: pid + ': Unable to open socket file: target process not responding or HotSpot VM not loaded' };
    return p;
  }

  function hex(n) { return '0x' + Number(n).toString(16); }

  /* ---------- jps ---------- */

  reg('jps', function (argv, io, ctx) {
    var world = ctx.world;
    var verbose = argv.indexOf('-v') >= 0 || argv.indexOf('-lv') >= 0;
    var long = argv.indexOf('-l') >= 0 || argv.indexOf('-lv') >= 0;
    var list = jvmProcs(world);
    if (!list.length) return '';
    return list.map(function (p) {
      var j = p.jvm;
      var name = long ? (j.mainClass || j.name) : (j.name || (j.mainClass || '').split('.').pop());
      return p.pid + ' ' + name + (verbose && j.args ? ' ' + j.args : '');
    }).join('\n');
  }, { help: 'list running JVMs (-l -v)' });

  /* ---------- jstack ---------- */

  function threadDump(world, p) {
    var j = p.jvm;
    var out = [];
    out.push(W.isoStamp(world.clock));
    out.push('Full thread dump Java HotSpot(TM) 64-Bit Server VM (' +
      (j.vmVersion || '25.392-b08') + ' mixed mode):');
    out.push('');

    (p.threads || []).forEach(function (t, idx) {
      var addr = '0x00007f' + (0x2a8c0b1000 + idx * 0x1800).toString(16).slice(-10);
      var stateLine = t.state;
      var suffix = '';
      if (t.state === 'BLOCKED') suffix = ' waiting for monitor entry [' + hex(0x7f2a6c1f4000 + idx * 0x2000) + ']';
      else if (t.state === 'WAITING' || t.state === 'TIMED_WAITING') suffix = ' in Object.wait() [' + hex(0x7f2a6c1f4000 + idx * 0x2000) + ']';
      else if (t.state === 'RUNNABLE') suffix = ' runnable [' + hex(0x7f2a6c1f4000 + idx * 0x2000) + ']';

      var header = '"' + t.name + '" #' + (idx + 12) + (t.daemon ? ' daemon' : '') +
        ' prio=' + t.prio + ' os_prio=' + t.os_prio + ' tid=' + addr +
        ' nid=' + hex(t.tid) + suffix;
      out.push(t.state === 'BLOCKED' ? W.red(header) : header);

      var detail = '   java.lang.Thread.State: ' + stateLine;
      if (t.state === 'BLOCKED') detail += ' (on object monitor)';
      else if (t.state === 'WAITING') detail += ' (on object monitor)';
      else if (t.state === 'TIMED_WAITING') detail += ' (parking)';
      out.push(t.state === 'BLOCKED' ? W.red(detail) : detail);

      (t.stack || []).forEach(function (line) {
        if (/^-/.test(line.trim())) out.push('\t' + W.amber(line));
        else out.push('\tat ' + line);
      });
      out.push('');
    });

    if (j.deadlock) {
      out.push('');
      out.push(W.red('Found one Java-level deadlock:'));
      out.push(W.red('============================='));
      j.deadlock.forEach(function (d) {
        out.push('"' + d.thread + '":');
        out.push('  waiting to lock monitor ' + d.monitor + ' (object ' + d.object + '),');
        out.push('  which is held by "' + d.heldBy + '"');
      });
      out.push('');
      out.push(W.red('Found 1 deadlock.'));
    }
    return out.join('\n');
  }

  PS.jstackText = threadDump;

  reg('jstack', function (argv, io, ctx) {
    var world = ctx.world;
    var args = argv.slice(1).filter(function (x) { return x !== '-l' && x !== '-F' && x !== '-m'; });
    var p = requireJvm(world, args[0], 'jstack');
    if (p.error) return { err: p.error, code: 1 };
    if (p.state === 'D') {
      return { err: 'jstack: target process ' + p.pid + ' is not responding (it is blocked in uninterruptible I/O)\n' +
        'Use OS wait-channel and kernel diagnostics; forced attach options depend on the JDK and can be disruptive.', code: 1 };
    }
    return threadDump(world, p);
  }, { help: 'java thread dump: jstack PID' });

  /* ---------- jmap ---------- */

  reg('jmap', function (argv, io, ctx) {
    var world = ctx.world;
    var args = argv.slice(1);
    var wantHeap = args.indexOf('-heap') >= 0;
    var histoIdx = args.findIndex(function (x) { return x === '-histo' || x.indexOf('-histo:') === 0; });
    var dumpIdx = args.findIndex(function (x) { return x.indexOf('-dump') === 0; });
    var pid = args.filter(function (x) { return /^\d+$/.test(x); })[0];
    var p = requireJvm(world, pid, 'jmap');
    if (p.error) return { err: p.error, code: 1 };
    var j = p.jvm;

    if (wantHeap) {
      var young = j.young || { max: j.heapMax * 0.33, used: j.heapUsed * 0.2 };
      var old = j.old || { max: j.heapMax * 0.67, used: j.heapUsed * 0.8 };
      var usedPct = (old.used / old.max) * 100;
      var heapPct = (j.heapUsed / j.heapMax) * 100;
      return [
        'Attaching to process ID ' + p.pid + ', please wait...',
        'Debugger attached successfully.',
        'Server compiler detected.',
        'JVM version is ' + (j.vmVersion || '25.392-b08'),
        '',
        'using thread-local object allocation.',
        'Garbage-First (G1) GC with ' + world.cores + ' thread(s)',
        '',
        'Heap Configuration:',
        '   MaxHeapSize              = ' + j.heapMax + ' (' + W.mb(j.heapMax) + '.0MB)',
        '   NewRatio                 = 2',
        '   G1HeapRegionSize         = 4194304 (4.0MB)',
        '',
        'Heap Usage:',
        'G1 Heap:',
        '   regions  = ' + Math.round(j.heapMax / 4194304),
        '   capacity = ' + j.heapMax + ' (' + W.mb(j.heapMax) + '.0MB)',
        '   used     = ' + j.heapUsed + ' (' + W.mb(j.heapUsed) + '.0MB)',
        '   free     = ' + (j.heapMax - j.heapUsed) + ' (' + W.mb(j.heapMax - j.heapUsed) + '.0MB)',
        '   ' + (heapPct > 90 ? W.red(heapPct.toFixed(2) + '% used') : heapPct.toFixed(2) + '% used'),
        'G1 Young Generation:',
        'Eden Space:',
        '   capacity = ' + Math.round(young.max) + ' (' + W.mb(young.max) + '.0MB)',
        '   used     = ' + Math.round(young.used) + ' (' + W.mb(young.used) + '.0MB)',
        'G1 Old Generation:',
        '   capacity = ' + Math.round(old.max) + ' (' + W.mb(old.max) + '.0MB)',
        '   used     = ' + Math.round(old.used) + ' (' + W.mb(old.used) + '.0MB)',
        '   ' + (usedPct > 90 ? W.red(usedPct.toFixed(2) + '% used') : usedPct.toFixed(2) + '% used')
      ].join('\n');
    }

    if (histoIdx >= 0) {
      var histo = j.histo || [];
      var rows = [' num     #instances         #bytes  class name',
        '----------------------------------------------'];
      histo.slice(0, 20).forEach(function (h, i) {
        rows.push(W.lpad(i + 1, 4) + ':' + W.lpad(W.comma(h.instances), 14) + W.lpad(W.comma(h.bytes), 15) + '  ' + h.cls);
      });
      rows.push('Total ' + W.lpad(W.comma(histo.reduce(function (a, h) { return a + h.instances; }, 0)), 14) +
        W.lpad(W.comma(histo.reduce(function (a, h) { return a + h.bytes; }, 0)), 15));
      return rows.join('\n');
    }

    if (dumpIdx >= 0) {
      var spec = args[dumpIdx];
      var fileM = /file=([^\s,]+)/.exec(spec);
      var path = fileM ? fileM[1] : '/tmp/heap.hprof';
      var abspath = PS.vfs.resolve(path, world.cwd, world.home);
      var fs = W.fsFor(world, abspath);
      if (fs && (fs.size - fs.used) < j.heapUsed) {
        return { err: 'Dumping heap to ' + abspath + ' ...\njmap: Error: no space left on device', code: 1 };
      }
      PS.vfs.write(world.root, abspath, '', { size: j.heapUsed, owner: world.user, mtime: world.clock });
      if (fs) fs.used += j.heapUsed;
      return 'Dumping heap to ' + abspath + ' ...\nHeap dump file created [' + j.heapUsed + ' bytes in ' +
        (j.heapUsed / 380000000).toFixed(3) + ' secs]';
    }

    return { err: 'Usage: jmap -heap <pid> | -histo <pid> | -dump:live,format=b,file=<f> <pid>', code: 1 };
  }, { help: 'heap info: jmap -heap PID, -histo, -dump' });

  /* ---------- jstat ---------- */

  reg('jstat', function (argv, io, ctx) {
    var world = ctx.world;
    var args = argv.slice(1);
    var mode = args[0] || '-gcutil';
    var pid = args.filter(function (x) { return /^\d+$/.test(x); })[0];
    var interval = args.filter(function (x) { return /^\d+$/.test(x); })[1];
    var count = Math.min(parseInt(args.filter(function (x) { return /^\d+$/.test(x); })[2], 10) || (interval ? 5 : 1), 10);

    var p = requireJvm(world, pid, 'jstat');
    if (p.error) return { err: p.error, code: 1 };
    var j = p.jvm;
    var gc = j.gcStats || {};

    if (mode.indexOf('-gcutil') === 0) {
      var rows = ['  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT'];
      for (var i = 0; i < count; i++) {
        var ygc = (gc.ygc || 0) + i * (gc.ygcRate || 0);
        var fgc = (gc.fgc || 0) + i * (gc.fgcRate || 0);
        var oldPct = Math.min(99.99, (gc.old == null ? W.pct(j.heapUsed, j.heapMax) : gc.old) + i * (gc.oldRate || 0));
        rows.push(
          W.lpad((gc.s0 || 0).toFixed(2), 6) + W.lpad((gc.s1 || 0).toFixed(2), 7) +
          W.lpad((gc.eden == null ? 42 : gc.eden).toFixed(2), 7) +
          W.vpad(oldPct > 95 ? W.red(oldPct.toFixed(2)) : oldPct.toFixed(2), 7) +
          W.lpad((gc.meta || 96.4).toFixed(2), 7) + W.lpad((gc.ccs || 93.1).toFixed(2), 7) +
          W.lpad(Math.round(ygc), 7) + W.lpad((gc.ygct || 0).toFixed(3), 9) +
          W.lpad(Math.round(fgc), 7) + W.lpad((gc.fgct || 0).toFixed(3), 9) +
          W.lpad(((gc.ygct || 0) + (gc.fgct || 0)).toFixed(3), 9));
      }
      return rows.join('\n');
    }

    if (mode.indexOf('-gc') === 0) {
      return [' S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU    CCSC   CCSU   YGC     YGCT    FGC    FGCT     GCT',
        W.lpad(W.kb((j.heapMax * 0.02)), 6) + W.lpad(W.kb((j.heapMax * 0.02)), 7) +
        W.lpad('0.0', 7) + W.lpad((gc.s1 || 0).toFixed(1), 7) +
        W.lpad(W.kb(j.heapMax * 0.30), 9) + W.lpad(W.kb(j.heapUsed * 0.2), 9) +
        W.lpad(W.kb(j.heapMax * 0.66), 11) + W.lpad(W.kb(j.heapUsed * 0.8), 11) +
        W.lpad(W.kb(268435456), 8) + W.lpad(W.kb(258000000), 8) +
        W.lpad(W.kb(33554432), 7) + W.lpad(W.kb(31000000), 7) +
        W.lpad(gc.ygc || 0, 6) + W.lpad((gc.ygct || 0).toFixed(3), 9) +
        W.lpad(gc.fgc || 0, 7) + W.lpad((gc.fgct || 0).toFixed(3), 9) +
        W.lpad(((gc.ygct || 0) + (gc.fgct || 0)).toFixed(3), 9)].join('\n');
    }

    if (mode.indexOf('-class') === 0) {
      return ['Loaded  Bytes  Unloaded  Bytes     Time',
        W.lpad(gc.classes || 28114, 6) + W.lpad('54412.1', 9) + W.lpad(112, 9) + W.lpad('184.4', 8) + W.lpad('31.42', 9)].join('\n');
    }
    return { err: 'Unknown option: ' + mode, code: 1 };
  }, { help: 'JVM statistics: jstat -gcutil PID 1000 5' });

  /* ---------- jcmd / jinfo ---------- */

  reg('jcmd', function (argv, io, ctx) {
    var world = ctx.world;
    var args = argv.slice(1);
    if (!args.length) {
      return jvmProcs(world).map(function (p) { return p.pid + ' ' + (p.jvm.mainClass || p.jvm.name); }).join('\n');
    }
    var p = requireJvm(world, args[0], 'jcmd');
    if (p.error) return { err: p.error, code: 1 };
    var op = args[1];
    if (op === 'Thread.print') return threadDump(world, p);
    if (op === 'GC.heap_info') return sh.cmds.jmap(['jmap', '-heap', String(p.pid)], io, ctx);
    if (op === 'VM.uptime') return String(((world.clock - (p.started || world.startClock)) / 1000).toFixed(3)) + ' s';
    if (op === 'VM.flags') return p.jvm.args || '';
    if (op === 'GC.run') {
      var before = p.jvm.heapUsed;
      // This fixture models retained objects; a high live set after one GC
      // alone does not prove a leak. Compare post-GC occupancy over time.
      p.jvm.heapUsed = p.jvm.leak
        ? Math.round(p.jvm.heapUsed * 0.97)
        : Math.round(p.jvm.heapUsed * 0.35);
      // Reclaimed heap space may stay committed/resident. GC does not imply
      // that the collector immediately returns these pages to the OS.
      return 'Command executed successfully';
    }
    return { err: 'Unknown diagnostic command', code: 1 };
  }, { help: 'jcmd PID Thread.print | GC.run | GC.heap_info | VM.flags' });

  reg('jinfo', function (argv, io, ctx) {
    var p = requireJvm(ctx.world, argv.filter(function (x) { return /^\d+$/.test(x); })[0], 'jinfo');
    if (p.error) return { err: p.error, code: 1 };
    return ['Attaching to process ID ' + p.pid + ', please wait...',
      'Debugger attached successfully.',
      'Java System Properties:', '',
      'java.version = ' + (p.jvm.javaVersion || '1.8.0_392'),
      'user.timezone = Europe/London',
      '', 'VM Flags:', p.jvm.args || ''].join('\n');
  }, { help: 'JVM flags and properties' });

  PS.javaLoaded = true;
})(PS);
