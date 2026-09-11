/* world.js - the machine state every command renders a view of.
 *
 * A scenario returns one of these objects. Commands never invent numbers; they
 * read them from here. That is the whole trick behind "it responds like a real
 * system" - the inconsistencies a player hunts for are real inconsistencies in
 * this data structure.
 */
(function (PS) {
  'use strict';

  var W = {};

  /* ---------- formatting ---------- */

  W.pad = function (s, n, right) {
    s = String(s);
    if (s.length >= n) return s;
    var sp = new Array(n - s.length + 1).join(' ');
    return right ? s + sp : sp + s;
  };
  W.lpad = function (s, n) { return W.pad(s, n, false); };
  W.rpad = function (s, n) { return W.pad(s, n, true); };

  /* 1024-based, the way df -h / free -h print it */
  W.human = function (bytes) {
    var units = ['', 'K', 'M', 'G', 'T', 'P'];
    var i = 0, n = Math.abs(bytes);
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    var s;
    if (i === 0) s = String(Math.round(n));
    else if (n >= 100) s = String(Math.round(n));
    else if (n >= 10) s = n.toFixed(0);
    else s = n.toFixed(1);
    return (bytes < 0 ? '-' : '') + s + units[i];
  };

  W.kb = function (bytes) { return Math.round(bytes / 1024); };
  W.mb = function (bytes) { return Math.round(bytes / 1048576); };

  W.comma = function (n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  W.pct = function (used, total) {
    if (!total) return 0;
    return Math.round((used / total) * 100);
  };

  W.hhmmss = function (sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(h) + ':' + p(m) + ':' + p(s);
  };

  W.mmss = function (sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  /* "MMM:SS.hs" used by top's TIME+ column */
  W.cputime = function (sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return W.lpad(m, 3) + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };

  W.clockStr = function (d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  W.syslogStamp = function (d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return MONTHS[d.getMonth()] + ' ' + W.lpad(d.getDate(), 2) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };

  W.isoStamp = function (d, withMillis) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    if (withMillis) s += '.' + ('00' + d.getMilliseconds()).slice(-3);
    return s;
  };

  W.dateStr = function (d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + W.lpad(d.getDate(), 2) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' GMT ' + d.getFullYear();
  };

  W.offset = function (base, seconds) {
    return new Date(base.getTime() + seconds * 1000);
  };

  /* ---------- deterministic jitter ---------- */
  /* Numbers must wobble like a real box but stay reproducible per world. */

  W.rng = function (seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  /* ---------- colour markup ----------
   * Commands emit colour with sentinel characters rather than ANSI. The
   * terminal turns them into spans; pipes and file redirects strip them, the
   * same reason real `ls` drops colour when stdout is not a tty.
   */
  var C_START = String.fromCharCode(17);   // 0x11
  var C_SEP = String.fromCharCode(18);     // 0x12
  var C_END = String.fromCharCode(19);     // 0x13
  var RE_OPEN = new RegExp(C_START + '([a-z]+)' + C_SEP, 'g');
  var RE_STRIP = new RegExp(C_START + '[a-z]+' + C_SEP + '|' + C_END, 'g');
  var RE_END = new RegExp(C_END, 'g');

  W.c = function (cls, text) { return C_START + cls + C_SEP + text + C_END; };
  W.green = function (t) { return W.c('green', t); };
  W.red = function (t) { return W.c('red', t); };
  W.amber = function (t) { return W.c('amber', t); };
  W.blue = function (t) { return W.c('blue', t); };
  W.cyan = function (t) { return W.c('cyan', t); };
  W.mag = function (t) { return W.c('mag', t); };
  W.dim = function (t) { return W.c('dim', t); };
  W.white = function (t) { return W.c('white', t); };
  W.bold = function (t) { return W.c('bold', t); };
  W.rev = function (t) { return W.c('rev', t); };

  W.stripColor = function (s) { return String(s).replace(RE_STRIP, ''); };

  /* Visible width, ignoring markup - needed when padding coloured columns. */
  W.vlen = function (s) { return W.stripColor(s).length; };

  W.vpad = function (s, n, right) {
    var diff = n - W.vlen(s);
    if (diff <= 0) return s;
    var sp = new Array(diff + 1).join(' ');
    return right ? s + sp : sp + s;
  };

  W.colorHtml = function (s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(RE_OPEN, function (m, cls) { return '<span class="c-' + cls + '">'; })
      .replace(RE_END, '</span>');
  };

  /* ---------- process helpers ---------- */

  W.proc = function (o) {
    return {
      pid: o.pid,
      ppid: o.ppid == null ? 1 : o.ppid,
      user: o.user || 'root',
      cmd: o.cmd || '',
      short: o.short || null,     // COMMAND column in top/ps when cmd is long
      state: o.state || 'S',      // R S D Z T
      cpu: o.cpu || 0,            // percent of one core, as top reports
      rss: o.rss || 0,            // bytes
      vsz: o.vsz || (o.rss ? Math.round(o.rss * 2.6) : 0),
      started: o.started || null, // Date
      cpuSeconds: o.cpuSeconds || 0,
      nice: o.nice == null ? 0 : o.nice,
      pri: o.pri == null ? 20 : o.pri,
      threads: o.threads || null,
      fds: o.fds || [],           // [{fd, type, path, size, deleted, sock}]
      tty: o.tty || '?',
      jvm: o.jvm || null,         // {heapMax, heapUsed, gc:[], args, pid}
      wchan: o.wchan || '-',
      cwd: o.cwd || '/',
      openFiles: o.openFiles || 0,
      limitNofile: o.limitNofile || 65536,
      dead: false
    };
  };

  W.thread = function (o) {
    return {
      tid: o.tid, name: o.name, state: o.state || 'RUNNABLE',
      cpu: o.cpu || 0, cpuSeconds: o.cpuSeconds || 0,
      stack: o.stack || [], lock: o.lock || null, blockedOn: o.blockedOn || null,
      daemon: o.daemon !== false, prio: o.prio || 5, os_prio: o.os_prio || 0
    };
  };

  W.findProc = function (world, pid) {
    pid = Number(pid);
    for (var i = 0; i < world.procs.length; i++) {
      if (world.procs[i].pid === pid) return world.procs[i];
    }
    return null;
  };

  W.procsMatching = function (world, needle) {
    var n = String(needle).toLowerCase();
    return world.procs.filter(function (p) { return p.cmd.toLowerCase().indexOf(n) >= 0; });
  };

  W.killProc = function (world, pid) {
    var i = world.procs.findIndex(function (p) { return p.pid === Number(pid); });
    if (i < 0) return false;
    var p = world.procs[i];
    world.procs.splice(i, 1);
    // Killing a process releases every file description it held, including
    // deleted ones - which is what gives the disk space back.
    world.deleted = world.deleted.filter(function (d) {
      if (d.pid !== p.pid) return true;
      W.releaseBytes(world, d.mount, d.size);
      return false;
    });
    world.sockets = world.sockets.filter(function (s) { return s.pid !== p.pid; });
    return true;
  };

  W.totalRss = function (world) {
    return world.procs.reduce(function (a, p) { return a + (p.rss || 0); }, 0);
  };

  /* ---------- filesystem (superblock) helpers ---------- */

  W.fsFor = function (world, abspath) {
    var best = null;
    for (var i = 0; i < world.filesystems.length; i++) {
      var fs = world.filesystems[i];
      var pre = fs.mount === '/' ? '/' : fs.mount + '/';
      if (abspath === fs.mount || abspath.indexOf(pre) === 0) {
        if (!best || fs.mount.length > best.mount.length) best = fs;
      }
    }
    return best || world.filesystems[0];
  };

  W.fsByMount = function (world, mount) {
    for (var i = 0; i < world.filesystems.length; i++) {
      if (world.filesystems[i].mount === mount) return world.filesystems[i];
    }
    return null;
  };

  /* Hand blocks back to a filesystem's superblock counters. */
  W.releaseBytes = function (world, mount, bytes) {
    var fs = W.fsByMount(world, mount);
    if (!fs) return;
    fs.used = Math.max(0, fs.used - bytes);
  };

  /* Writing to /proc/<pid>/fd/<n> acts on the open file description, so a
   * deleted-but-open log can be truncated without restarting the process.
   * This is what makes `> /proc/8841/fd/3` a legitimate fix. */
  W.truncateFd = function (world, pid, fd, text) {
    var entry = null;
    for (var i = 0; i < world.deleted.length; i++) {
      if (world.deleted[i].pid === pid && world.deleted[i].fd === fd) { entry = world.deleted[i]; break; }
    }
    if (!entry) {
      var proc = W.findProc(world, pid);
      if (!proc) return false;
      var f = (proc.fds || []).filter(function (x) { return x.fd === fd; })[0];
      if (f) { f.size = (text || '').length; return true; }
      return false;
    }
    var freed = entry.size - (text || '').length;
    if (freed > 0) W.releaseBytes(world, entry.mount, freed);
    entry.size = (text || '').length;
    if (typeof world.onTruncate === 'function') world.onTruncate(world, entry);
    return true;
  };

  /* ---------- /proc ----------
   * Every box gets a procfs generated from its own state, so `cat
   * /proc/meminfo` and `free` can never disagree - they read the same numbers.
   */
  function installProcfs(world) {
    if (!world.root) return;
    var V = PS.vfs;
    if (!world.root.children.proc) world.root.children.proc = V.dir({});
    var proc = world.root.children.proc;

    function dyn(fn) { return V.file(fn, { owner: 'root', group: 'root', size: 0 }); }

    proc.children.meminfo = dyn(function (w) {
      var m = w.mem;
      var avail = m.free + m.cached * 0.85;
      var kv = function (k, bytes) { return W.rpad(k + ':', 16) + W.lpad(W.kb(bytes), 9) + ' kB'; };
      return [
        kv('MemTotal', m.total), kv('MemFree', m.free), kv('MemAvailable', avail),
        kv('Buffers', m.buffers), kv('Cached', m.cached),
        kv('SwapCached', 0), kv('Active', m.total - m.free - m.cached * 0.4),
        kv('Inactive', m.cached * 0.4),
        kv('SwapTotal', w.swap.total), kv('SwapFree', w.swap.total - w.swap.used),
        kv('Dirty', 4 * 1048576), kv('Writeback', 0),
        kv('Shmem', m.shared || 0), kv('Slab', 1200 * 1048576),
        kv('CommitLimit', m.total * 0.9), kv('Committed_AS', (m.total - m.free) * 1.1)
      ].join('\n');
    });

    proc.children.loadavg = dyn(function (w) {
      var running = w.procs.filter(function (p) { return p.state === 'R'; }).length;
      return w.load.map(function (x) { return x.toFixed(2); }).join(' ') +
        ' ' + running + '/' + (w.procs.length + 380) + ' ' +
        (20000 + Math.round(w.bootSeconds / 10));
    });

    proc.children.uptime = dyn(function (w) {
      return w.bootSeconds.toFixed(2) + ' ' + (w.bootSeconds * w.cores * 0.94).toFixed(2);
    });

    proc.children.version = dyn(function (w) {
      return 'Linux version ' + w.kernel + ' (mockbuild@x86-builder) ' +
        '(gcc version 4.8.5 20150623 (Red Hat 4.8.5-44)) #1 SMP Thu Jan 11 09:22:15 UTC 2024';
    });

    proc.children.cpuinfo = dyn(function (w) {
      var blocks = [];
      for (var i = 0; i < Math.min(w.cores, 4); i++) {
        blocks.push([
          'processor\t: ' + i,
          'vendor_id\t: GenuineIntel',
          'model name\t: ' + w.model,
          'cpu MHz\t\t: 3600.000',
          'cache size\t: 25344 KB',
          'physical id\t: ' + (i < w.cores / 2 ? 0 : 1),
          'siblings\t: ' + (w.cores / 2),
          'core id\t\t: ' + i,
          'cpu cores\t: ' + (w.cores / 2),
          'flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov',
          ''
        ].join('\n'));
      }
      if (w.cores > 4) blocks.push('... (' + (w.cores - 4) + ' more processors)');
      return blocks.join('\n');
    });

    if (!proc.children.sys) {
      proc.children.sys = V.dir({
        net: V.dir({
          core: V.dir({
            rmem_max: dyn(function (w) { return String((w.sysctl && w.sysctl['net.core.rmem_max']) || 212992); }),
            wmem_max: dyn(function (w) { return String((w.sysctl && w.sysctl['net.core.wmem_max']) || 212992); })
          })
        })
      });
    }
  }

  /* ---------- world construction ---------- */

  W.create = function (spec) {
    // Copy everything the scenario declared first, so scenario-specific fields
    // (hosts, http, hungPaths, limits, onKill, onService, ...) survive, then
    // layer the defaults underneath for anything it left out.
    var world = {};
    for (var key in spec) {
      if (Object.prototype.hasOwnProperty.call(spec, key)) world[key] = spec[key];
    }

    var defaults = {
      host: spec.host || 'prod01',
      user: spec.user || 'gsupport',
      home: spec.home || ('/home/' + (spec.user || 'gsupport')),
      cwd: null,
      kernel: spec.kernel || '3.10.0-1160.108.1.el7.x86_64',
      os: spec.os || 'Red Hat Enterprise Linux Server release 7.9 (Maipo)',
      cores: spec.cores || 16,
      model: spec.model || 'Intel(R) Xeon(R) Gold 6244 CPU @ 3.60GHz',
      clock: spec.clock || new Date(),
      startClock: spec.clock || new Date(),
      bootSeconds: spec.bootSeconds || 3600 * 24 * 41,
      users: spec.users || 3,
      load: spec.load || [0.4, 0.5, 0.5],
      mem: spec.mem || { total: 64 * 1024 * 1024 * 1024, free: null, buffers: 512 * 1048576, cached: 4 * 1073741824 },
      swap: spec.swap || { total: 8 * 1073741824, used: 0 },
      cpu: spec.cpu || { us: 4, sy: 1, ni: 0, id: 94, wa: 1, st: 0 },
      filesystems: spec.filesystems || [],
      procs: spec.procs || [],
      sockets: spec.sockets || [],
      deleted: spec.deleted || [],   // deleted-but-open files, see lsof +L1
      dmesg: spec.dmesg || [],
      services: spec.services || {},
      interfaces: spec.interfaces || [],
      netstat: spec.netstat || {},
      diskio: spec.diskio || [],
      jobs: spec.jobs || [],         // scheduler (autosys) jobs
      fix: spec.fix || null,         // FIX session state
      ntp: spec.ntp || null,
      env: spec.env || {},
      root: spec.root,
      flags: spec.flags || {},
      notes: spec.notes || {},
      tick: spec.tick || null,       // function(world, seconds)
      onTruncate: spec.onTruncate || null,
      rand: W.rng(spec.seed || 0xC0FFEE)
    };
    for (var dk in defaults) {
      if (world[dk] === undefined) world[dk] = defaults[dk];
    }

    world.startClock = new Date(defaults.clock.getTime());
    world.clock = new Date(defaults.clock.getTime());
    world.rand = defaults.rand;
    world.home = spec.home || ('/home/' + world.user);
    world.cwd = spec.cwd || world.home;
    world.hungPaths = spec.hungPaths || [];
    world.limits = spec.limits || { nofile: 65536, nproc: 4096 };
    world.hosts = spec.hosts || {};
    world.http = spec.http || {};

    installProcfs(world);

    if (world.mem.buffers == null) world.mem.buffers = 512 * 1048576;
    if (world.mem.cached == null) world.mem.cached = 4 * 1073741824;
    if (world.mem.free == null) {
      var used = W.totalRss(world) + world.mem.buffers + world.mem.cached;
      world.mem.free = Math.max(64 * 1048576, world.mem.total - used);
    }
    return world;
  };

  /* Advance simulated time. Called once a second by the game loop. */
  W.advance = function (world, seconds) {
    world.clock = new Date(world.clock.getTime() + seconds * 1000);
    world.bootSeconds += seconds;
    for (var i = 0; i < world.procs.length; i++) {
      var p = world.procs[i];
      p.cpuSeconds += (p.cpu / 100) * seconds;
      if (p.threads) {
        for (var j = 0; j < p.threads.length; j++) {
          p.threads[j].cpuSeconds += (p.threads[j].cpu / 100) * seconds;
        }
      }
    }
    if (typeof world.tick === 'function') world.tick(world, seconds);
  };

  /* Append a line to a log file that exists in the tree. */
  W.appendLog = function (world, path, line) {
    var node = PS.vfs.lookup(world.root, path);
    if (!node || node.type !== 'file') return;
    if (typeof node.content === 'function') return;
    node.content = (node.content ? node.content + '\n' : '') + line;
    node.mtime = new Date(world.clock.getTime());
    node.size = null;
  };

  PS.world = W;
})(PS);
