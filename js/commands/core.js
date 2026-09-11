/* commands/core.js - file and text handling: the commands you actually live in
 * during an incident. ls, cat, grep, tail -f, find, awk, sed, wc, sort...
 */
(function (PS) {
  'use strict';

  var sh = PS.shell, V = PS.vfs, W = PS.world;
  var reg = sh.register;

  function abs(ctx, p) { return V.resolve(p, ctx.world.cwd, ctx.world.home); }
  function look(ctx, p) { return V.lookup(ctx.world.root, abs(ctx, p)); }

  /* Read a list of file operands (or stdin when there are none). Returns
   * [{name, text, err}] so each command can report per-file errors like real
   * coreutils do. */
  function inputs(cmd, rest, io, ctx) {
    if (!rest.length) return [{ name: '-', text: io.stdin || '' }];
    return rest.map(function (p) {
      if (p === '-') return { name: '-', text: io.stdin || '' };
      var node = look(ctx, p);
      if (!node) return { name: p, err: cmd + ': ' + p + ': No such file or directory' };
      if (node.type === 'dir') return { name: p, err: cmd + ': ' + p + ': Is a directory' };
      return { name: p, text: V.read(node, ctx.world) };
    });
  }

  function lines(text) {
    if (text === '' || text == null) return [];
    return String(text).replace(/\n$/, '').split('\n');
  }

  /* ---------- navigation ---------- */

  reg('pwd', function (argv, io, ctx) { return ctx.world.cwd; },
    { help: 'print working directory' });

  reg('cd', function (argv, io, ctx) {
    var target = argv[1] || ctx.world.home;
    if (target === '-') target = ctx.world.oldcwd || ctx.world.home;
    var p = abs(ctx, target);
    var node = V.lookup(ctx.world.root, p);
    if (!node) return { err: 'bash: cd: ' + target + ': No such file or directory', code: 1 };
    if (node.type !== 'dir') return { err: 'bash: cd: ' + target + ': Not a directory', code: 1 };
    ctx.world.oldcwd = ctx.world.cwd;
    ctx.world.cwd = p;
    return '';
  }, { help: 'change directory' });

  /* ---------- ls ---------- */

  function colorName(node, name) {
    if (node.type === 'dir') return W.blue(name);
    if (node.type === 'link') return W.cyan(name);
    if (node.mode && node.mode.indexOf('x') > 0) return W.green(name);
    if (/\.(gz|zip|tar|bz2|xz|rpm)$/.test(name)) return W.red(name);
    return name;
  }

  reg('ls', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'lahrtSdiR1F' });
    var world = ctx.world;
    var targets = a.rest.length ? a.rest : ['.'];
    var out = [], errs = [];

    function entryLine(node, name, path) {
      var size = V.sizeOf(node, world);
      var mtime = node.mtime || world.startClock;
      var nameCell = a.has('F') && node.type === 'dir' ? name + '/' : name;
      if (node.type === 'link') nameCell += ' -> ' + node.target;
      return W.rpad(node.mode, 11) + ' ' +
        W.lpad(node.nlink, 3) + ' ' +
        W.rpad(node.owner, 9) + ' ' +
        W.rpad(node.group, 9) + ' ' +
        W.lpad(a.has('h') ? W.human(size) : W.comma(size), a.has('h') ? 6 : 12) + ' ' +
        V.lsTime(mtime, world.clock) + ' ' +
        colorName(node, nameCell);
    }

    targets.forEach(function (t, ti) {
      var p = abs(ctx, t);
      var node = V.lookup(world.root, p);
      if (!node) { errs.push('ls: cannot access ' + t + ': No such file or directory'); return; }

      if (node.type !== 'dir' || a.has('d')) {
        out.push(a.has('l') ? entryLine(node, t, p) : colorName(node, t));
        return;
      }

      var names = Object.keys(node.children);
      if (!a.has('a')) names = names.filter(function (n) { return n.charAt(0) !== '.'; });

      names.sort(function (x, y) {
        var nx = node.children[x], ny = node.children[y];
        if (a.has('S')) return V.sizeOf(ny, world) - V.sizeOf(nx, world);
        if (a.has('t')) {
          var tx = (nx.mtime || world.startClock).getTime(), ty = (ny.mtime || world.startClock).getTime();
          return ty - tx;
        }
        return x < y ? -1 : x > y ? 1 : 0;
      });
      if (a.has('r')) names.reverse();
      if (a.has('a')) names = ['.', '..'].concat(names);

      if (targets.length > 1) out.push((ti ? '\n' : '') + t + ':');

      if (a.has('l')) {
        var total = 0;
        names.forEach(function (n) {
          var c = n === '.' ? node : n === '..' ? node : node.children[n];
          total += Math.ceil(V.sizeOf(c, world) / 1024);
        });
        out.push('total ' + total);
        names.forEach(function (n) {
          var c = (n === '.' || n === '..') ? V.dir({}) : node.children[n];
          out.push(entryLine(c, n, p + '/' + n));
        });
      } else if (a.has('1')) {
        names.forEach(function (n) {
          var c = (n === '.' || n === '..') ? V.dir({}) : node.children[n];
          out.push(colorName(c, n));
        });
      } else {
        // column layout, like ls on a tty
        var cells = names.map(function (n) {
          var c = (n === '.' || n === '..') ? V.dir({}) : node.children[n];
          return { raw: n, col: colorName(c, n) };
        });
        var widest = cells.reduce(function (m, c) { return Math.max(m, c.raw.length); }, 0) + 2;
        var cols = Math.max(1, Math.floor(100 / widest));
        for (var i = 0; i < cells.length; i += cols) {
          out.push(cells.slice(i, i + cols).map(function (c) {
            return W.vpad(c.col, widest, true);
          }).join('').replace(/\s+$/, ''));
        }
      }
    });

    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 2 : 0 };
  }, { help: 'list directory contents (-l -a -h -t -S -r -d)' });

  sh.alias('ll', 'ls');
  sh.alias('dir', 'ls');

  /* ---------- cat / head / tail ---------- */

  reg('cat', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'nvAE' });
    var files = inputs('cat', a.rest, io, ctx);
    var out = [], errs = [], n = 1;
    files.forEach(function (f) {
      if (f.err) { errs.push(f.err); return; }
      if (a.has('n')) {
        lines(f.text).forEach(function (l) { out.push(W.lpad(n++, 6) + '  ' + l); });
      } else out.push(f.text);
    });
    return { out: out.join(a.has('n') ? '\n' : ''), exact: !a.has('n'), err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'concatenate and print files' });

  /* head -20 / tail -50 are the forms people actually type; normalise them to
   * -n 20 before flag parsing. */
  function normalizeCount(argv) {
    var args = argv.slice();
    for (var i = 1; i < args.length; i++) {
      var m = /^-(\d+)$/.exec(args[i]);
      if (m) { args.splice(i, 1, '-n', m[1]); i++; }
    }
    return args;
  }

  reg('head', function (argv, io, ctx) {
    argv = normalizeCount(argv);
    var a = sh.parseArgs(argv, { value: 'nc' });
    var n = a.vals.n == null ? 10 : parseInt(a.vals.n, 10);
    if (!Number.isFinite(n)) return { err: 'head: invalid number of lines', code: 1 };
    var files = inputs('head', a.rest, io, ctx);
    var out = [], errs = [];
    files.forEach(function (f, i) {
      if (f.err) { errs.push(f.err); return; }
      if (files.length > 1) out.push((i ? '\n' : '') + '==> ' + f.name + ' <==');
      out.push(a.vals.c != null ? f.text.slice(0, Number(a.vals.c)) : lines(f.text).slice(0, n).join('\n'));
    });
    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'first lines of a file (-n)' });

  reg('tail', function (argv, io, ctx) {
    argv = normalizeCount(argv);
    var a = sh.parseArgs(argv, { bool: 'f', value: 'nc' });
    var n = a.vals.n == null ? 10 : parseInt(a.vals.n, 10);
    if (!Number.isFinite(n)) return { err: 'tail: invalid number of lines', code: 1 };
    function take(text) {
      if (a.vals.c != null) return Number(a.vals.c) === 0 ? '' : ftextBytes(text, a.vals.c);
      if (a.vals.n && a.vals.n.charAt(0) === '+') return lines(text).slice(Math.max(0, n - 1)).join('\n');
      return n === 0 ? '' : lines(text).slice(-Math.abs(n)).join('\n');
    }
    function ftextBytes(text, count) { return count.charAt(0) === '+' ? text.slice(Math.max(0, Number(count) - 1)) : text.slice(-Math.abs(Number(count))); }
    var files = inputs('tail', a.rest, io, ctx);

    if (a.has('f')) {
      var path = a.rest[0];
      if (!path) return { err: 'tail: -f requires a file', code: 1 };
      var node = look(ctx, path);
      if (!node) return { err: 'tail: cannot open ' + path + ' for reading: No such file or directory', code: 1 };
      var seen = lines(V.read(node, ctx.world)).length;
      var header = take(V.read(node, ctx.world));
      var target = abs(ctx, path);
      return {
        out: header,
        app: {
          type: 'stream',
          label: 'tail -f ' + path,
          next: function (world) {
            var nd = V.lookup(world.root, target);
            if (!nd) return null;
            var all = lines(V.read(nd, world));
            if (all.length <= seen) return null;
            var fresh = all.slice(seen);
            seen = all.length;
            return fresh.join('\n');
          }
        }
      };
    }

    var out = [], errs = [];
    files.forEach(function (f, i) {
      if (f.err) { errs.push(f.err); return; }
      if (files.length > 1) out.push((i ? '\n' : '') + '==> ' + f.name + ' <==');
      out.push(take(f.text));
    });
    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'last lines of a file (-n, -f to follow)' });

  reg('less', function (argv, io, ctx) {
    return sh.cmds.cat(['cat'].concat(argv.slice(1)), io, ctx);
  }, { help: 'page through a file (behaves like cat here)' });
  sh.alias('more', 'less');
  sh.alias('view', 'less');

  /* ---------- grep ---------- */

  // GNU basic regex treats unescaped + ? ( ) { } | as ordinary characters.
  function basicRegex(pattern) {
    var out = '', bracket = false;
    for (var i = 0; i < pattern.length; i++) {
      var c = pattern.charAt(i);
      if (c === '\\' && i + 1 < pattern.length) {
        var next = pattern.charAt(++i);
        out += !bracket && /[+?(){}|]/.test(next) ? next : '\\' + next;
      } else {
        if (c === '[') bracket = true;
        if (c === ']') bracket = false;
        out += !bracket && /[+?(){}|]/.test(c) ? '\\' + c : c;
      }
    }
    return out;
  }

  function buildRegex(pattern, a) {
    var flags = 'g' + (a.has('i') ? 'i' : '');
    var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var src = a.has('F') ? esc(pattern) : (a.has('E') ? pattern : basicRegex(pattern));
    if (a.has('w')) src = '(?<![A-Za-z0-9_])(?:' + src + ')(?![A-Za-z0-9_])';
    if (a.has('x')) src = '^(?:' + src + ')$';
    return new RegExp(src, flags);
  }

  function grepImpl(argv, io, ctx, cmdName) {
    var a = sh.parseArgs(argv, { bool: 'icvnrRlLwqxEFHhos', value: 'ABCem', long: { 'ignore-case': 'i', 'fixed-strings': 'F', 'extended-regexp': 'E', 'line-number': 'n', 'invert-match': 'v', 'count': 'c', 'word-regexp': 'w', 'line-regexp': 'x', 'quiet': 'q', 'recursive': 'r', 'no-messages': 's' } });
    var allowed = 'icvnrRlLwqxEFHhos'.split('').concat(['ignore-case', 'fixed-strings', 'extended-regexp', 'line-number', 'invert-match', 'count', 'word-regexp', 'line-regexp', 'quiet', 'recursive', 'no-messages', 'color', 'colour']);
    var unknown = Object.keys(a.flags).filter(function (k) { return allowed.indexOf(k) < 0; });
    if (unknown.length) return { err: cmdName + ': unsupported option ' + unknown[0], code: 2 };
    var pattern = a.vals.e;
    var rest = a.rest.slice();
    if (pattern == null) pattern = rest.shift();
    if (pattern == null) return { err: 'usage: grep [OPTION]... PATTERN [FILE]...', code: 2 };

    var rx;
    try {
      var patterns = a.allVals.e || [pattern];
      rx = new RegExp(patterns.reduce(function (out, pat) { return out.concat(String(pat).split('\n')); }, []).map(function (pat) { return '(?:' + buildRegex(pat, a).source + ')'; }).join('|'), 'g' + (a.has('i') ? 'i' : ''));
    }
    catch (e) { return { err: cmdName + ': invalid regular expression', code: 2 }; }

    var after = parseInt(a.vals.A || a.vals.C, 10) || 0;
    var before = parseInt(a.vals.B || a.vals.C, 10) || 0;
    var maxCount = a.vals.m == null ? Infinity : Number(a.vals.m);
    if (maxCount < 0 || !/^(?:\d+|Infinity)$/.test(String(maxCount))) return { err: cmdName + ': invalid max count', code: 2 };

    // Recursive: expand directories into their files.
    var targets = [];
    if (a.has('r') || a.has('R')) {
      (rest.length ? rest : ['.']).forEach(function (t) {
        V.walk(ctx.world.root, abs(ctx, t), function (p, node) {
          if (node.type === 'file') targets.push(p);
        });
      });
    } else {
      targets = rest;
    }

    var files = inputs(cmdName, targets, io, ctx);
    var showName = a.has('H') || targets.length > 1 || a.has('r') || a.has('R');
    if (a.has('h')) showName = false;

    var out = [], errs = [], matchTotal = 0;

    files.forEach(function (f) {
      if (f.err) { errs.push(f.err); return; }
      var ls = lines(f.text);
      var hits = [];
      for (var i = 0; i < ls.length; i++) {
        if (hits.length >= maxCount) break;
        rx.lastIndex = 0;
        var m = rx.test(ls[i]);
        if (a.has('v') ? !m : m) hits.push(i);
      }
      matchTotal += hits.length;

      if (a.has('q')) return;
      if (a.has('l')) { if (hits.length) out.push(f.name); return; }
      if (a.has('L')) { if (!hits.length) out.push(f.name); return; }
      if (a.has('c')) { out.push((showName ? f.name + ':' : '') + hits.length); return; }
      var emitted = {}, hitMap = {}, lastEmitted = -1;
      hits.forEach(function (n) { hitMap[n] = true; });
      hits.forEach(function (i) {
        for (var j = Math.max(0, i - before); j <= Math.min(ls.length - 1, i + after); j++) {
          if (emitted[j]) continue;
          emitted[j] = true;
          if ((before || after) && lastEmitted >= 0 && j > lastEmitted + 1) out.push('--');
          lastEmitted = j;
          var selected = !!hitMap[j];
          var sep = selected ? ':' : '-';
          var text = ls[j];
          if (selected && !a.has('v') && !a.has('o')) {
            rx.lastIndex = 0;
            text = text.replace(rx, function (mm) { return W.red(mm); });
          }
          if (a.has('o')) {
            if (!selected || a.has('v')) continue;
            rx.lastIndex = 0;
            var found = ls[j].match(rx);
            if (found) { found.forEach(function (ff) { if (ff) out.push((showName ? f.name + sep : '') + (a.has('n') ? (j + 1) + sep : '') + W.red(ff)); }); }
            continue;
          }
          out.push((showName ? f.name + sep : '') + (a.has('n') ? (j + 1) + sep : '') + text);
        }
      });
    });

    return {
      out: out.join('\n'),
      err: a.has('s') ? '' : errs.join('\n'),
      code: a.has('q') && matchTotal ? 0 : (errs.length ? 2 : matchTotal ? 0 : 1)
    };
  }

  reg('grep', function (argv, io, ctx) { return grepImpl(argv, io, ctx, 'grep'); },
    { help: 'search text (-i -c -n -v -r -A -B -l -E)' });
  reg('egrep', function (argv, io, ctx) { return grepImpl(['grep', '-E'].concat(argv.slice(1)), io, ctx, 'egrep'); },
    { help: 'grep -E' });
  reg('fgrep', function (argv, io, ctx) {
    return grepImpl(['grep', '-F'].concat(argv.slice(1)), io, ctx, 'fgrep');
  }, { help: 'grep -F' });
  reg('zgrep', function (argv, io, ctx) { return grepImpl(argv, io, ctx, 'zgrep'); },
    { help: 'grep inside compressed logs' });

  /* ---------- text utilities ---------- */

  reg('wc', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'lwcm' });
    var files = inputs('wc', a.rest, io, ctx);
    var out = [], errs = [];
    var showL = a.has('l'), showW = a.has('w'), showC = a.has('c') || a.has('m');
    if (!showL && !showW && !showC) { showL = showW = showC = true; }
    var totals = [0, 0, 0];
    files.forEach(function (f) {
      if (f.err) { errs.push(f.err); return; }
      var ls = lines(f.text);
      var nl = (f.text.match(/\n/g) || []).length;
      var nw = f.text.split(/\s+/).filter(Boolean).length;
      var nc = f.text.length;
      totals[0] += nl; totals[1] += nw; totals[2] += nc;
      var row = [];
      if (showL) row.push(W.lpad(nl, 7));
      if (showW) row.push(W.lpad(nw, 7));
      if (showC) row.push(W.lpad(nc, 7));
      out.push(row.join(' ') + (f.name !== '-' ? ' ' + f.name : ''));
    });
    if (files.length > 1) {
      var row = [];
      if (showL) row.push(W.lpad(totals[0], 7));
      if (showW) row.push(W.lpad(totals[1], 7));
      if (showC) row.push(W.lpad(totals[2], 7));
      out.push(row.join(' ') + ' total');
    }
    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'count lines/words/chars (-l -w -c)' });

  reg('sort', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'nru', value: 'k t' });
    var files = inputs('sort', a.rest, io, ctx);
    var all = [];
    files.forEach(function (f) { if (!f.err) all = all.concat(lines(f.text)); });
    var keyIdx = a.vals.k ? parseInt(a.vals.k, 10) - 1 : null;
    function keyOf(s) {
      if (keyIdx == null) return s;
      var parts = s.trim().split(/\s+/);
      return parts[keyIdx] == null ? '' : parts[keyIdx];
    }
    all.sort(function (x, y) {
      var kx = keyOf(x), ky = keyOf(y);
      if (a.has('n')) {
        var nx = parseFloat(kx) || 0, ny = parseFloat(ky) || 0;
        return nx - ny;
      }
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
    if (a.has('r')) all.reverse();
    if (a.has('u')) {
      var seen = {}, uniq = [];
      all.forEach(function (l) { if (!seen[l]) { seen[l] = 1; uniq.push(l); } });
      all = uniq;
    }
    return all.join('\n');
  }, { help: 'sort lines (-n -r -u -k)' });

  reg('uniq', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'cdu' });
    var files = inputs('uniq', a.rest, io, ctx);
    var all = [];
    files.forEach(function (f) { if (!f.err) all = all.concat(lines(f.text)); });
    var out = [], i = 0;
    while (i < all.length) {
      var j = i;
      while (j < all.length && all[j] === all[i]) j++;
      var count = j - i;
      if (a.has('d') && count < 2) { i = j; continue; }
      if (a.has('u') && count > 1) { i = j; continue; }
      out.push(a.has('c') ? W.lpad(count, 7) + ' ' + all[i] : all[i]);
      i = j;
    }
    return out.join('\n');
  }, { help: 'collapse repeated lines (-c -d -u)' });

  reg('cut', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { value: 'df', bool: 's' });
    var delim = a.vals.d == null ? '\t' : a.vals.d;
    var spec = a.vals.f || '1';
    var fields = spec.split(',').map(function (s) {
      if (s.indexOf('-') > 0) {
        var p = s.split('-');
        return { from: parseInt(p[0], 10), to: parseInt(p[1], 10) || 9999 };
      }
      var n = parseInt(s, 10);
      return { from: n, to: n };
    });
    var files = inputs('cut', a.rest, io, ctx);
    var out = [];
    files.forEach(function (f) {
      if (f.err) return;
      lines(f.text).forEach(function (l) {
        var parts = l.split(delim);
        var picked = [];
        fields.forEach(function (r) {
          for (var i = r.from; i <= Math.min(r.to, parts.length); i++) {
            if (parts[i - 1] != null) picked.push(parts[i - 1]);
          }
        });
        out.push(picked.join(delim));
      });
    });
    return out.join('\n');
  }, { help: 'select fields (-d -f)' });

  /* awk: enough of it to survive a bridge call - {print $1, $3}, /re/{...},
   * NR, NF, $0, and -F. */
  reg('awk', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { value: 'F' });
    var prog = a.rest.shift() || '';
    if (Object.keys(a.flags).length) return { err: 'awk: unsupported option in this simulator; supported option: -F', code: 2 };
    var whitespace = a.vals.F == null || a.vals.F === ' ';
    var fs;
    try { fs = whitespace ? /\s+/ : a.vals.F.length === 1 ? a.vals.F : new RegExp(a.vals.F); }
    catch (e) { return { err: 'awk: invalid field separator', code: 2 }; }
    var files = inputs('awk', a.rest, io, ctx);
    var endMatch = /\s*END\s*\{([^{}]*)\}\s*$/.exec(prog);
    var ending = endMatch ? endMatch[1].trim() : '';
    if (endMatch) prog = prog.slice(0, endMatch.index).trim();
    var m = /^\s*([^{}]*?)\s*(?:\{([^{}]*)\})?\s*$/.exec(prog);
    if (!m) return { err: 'awk: this simulator supports field printing, simple comparisons and sums/counts', code: 2 };
    var condition = m[1].trim(), body = m[2] == null ? 'print $0' : m[2].trim();
    if (!prog && ending) body = '';
    var out = [], errs = [], nr = 0, fnr = 0, parts = [], record = '', vars = {}, unsupported = false;
    function value(expr) {
      expr = expr.trim();
      if (expr === 'NR') return nr;
      if (expr === 'FNR') return fnr;
      if (expr === 'NF') return parts.length;
      if (expr === '$0') return record;
      if (expr === '$NF') return parts[parts.length - 1] || '';
      var field = /^\$(\d+)$/.exec(expr);
      if (field) return parts[Number(field[1]) - 1] || '';
      if (/^"(?:[^"\\]|\\.)*"$/.test(expr)) return expr.slice(1, -1).replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\"/g, '"');
      if (/^-?\d+(?:\.\d+)?$/.test(expr)) return Number(expr);
      if (/^[A-Za-z_]\w*$/.test(expr)) return vars[expr] == null ? 0 : vars[expr];
      throw new Error('unsupported expression: ' + expr);
    }
    function matches(expr) {
      if (!expr) return true;
      if (expr.indexOf('&&') >= 0) return expr.split('&&').every(function (part) { return matches(part.trim()); });
      var pattern = /^\/(.*)\/$/.exec(expr);
      if (pattern) return new RegExp(pattern[1]).test(record);
      var compare = /^(.*?)\s*(==|!=|>=|<=|>|<|!~|~)\s*(.*?)$/.exec(expr);
      if (!compare) return !!value(expr);
      var left = value(compare[1]);
      if (compare[2] === '~' || compare[2] === '!~') {
        var literal = /^\/(.*)\/$/.exec(compare[3]);
        if (!literal) throw new Error('regex comparison requires /pattern/');
        var hit = new RegExp(literal[1]).test(String(left));
        return compare[2] === '~' ? hit : !hit;
      }
      var right = value(compare[3]);
      if (typeof right === 'number') left = Number(left) || 0;
      switch (compare[2]) { case '==': return left === right; case '!=': return left !== right; case '>': return left > right; case '<': return left < right; case '>=': return left >= right; case '<=': return left <= right; }
    }
    function action(code) {
      code.split(';').forEach(function (statement) {
        statement = statement.trim();
        if (!statement) return;
        var pr = /^print(?:\s+(.*))?$/.exec(statement);
        if (pr) { out.push(pr[1] ? pr[1].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(value).join(' ') : record); return; }
        var sum = /^([A-Za-z_]\w*)\s*\+=\s*(.*)$/.exec(statement);
        if (sum) { vars[sum[1]] = (vars[sum[1]] || 0) + (Number(value(sum[2])) || 0); return; }
        var inc = /^([A-Za-z_]\w*)\s*\+\+$/.exec(statement);
        if (inc) { vars[inc[1]] = (vars[inc[1]] || 0) + 1; return; }
        throw new Error('unsupported action: ' + statement);
      });
    }
    files.forEach(function (f) {
      if (f.err) { errs.push(f.err); return; }
      fnr = 0;
      lines(f.text).forEach(function (l) {
        nr++; fnr++; record = l;
        parts = whitespace ? (l.trim() === '' ? [] : l.trim().split(fs)) : l.split(fs);
        try { if (matches(condition)) action(body); }
        catch (e) { if (!unsupported) errs.push('awk: ' + e.message + ' (simulator subset)'); unsupported = true; }
      });
    });
    try { if (ending && !unsupported) action(ending); }
    catch (e) { errs.push('awk: ' + e.message + ' (simulator subset)'); }
    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 2 : 0 };
  }, { help: 'field extraction: awk \'{print $1,$3}\' (-F)' });

  /* sed: s/// and -n '/re/p' and Np - the subset support engineers type. */
  reg('sed', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'nriE', value: 'e' });
    var script = a.vals.e || a.rest.shift() || '';
    if (Object.keys(a.flags).some(function (f) { return 'nriE'.indexOf(f) < 0; }) || (a.allVals.e && a.allVals.e.length > 1)) return { err: 'sed: unsupported option; this simulator accepts one expression with -n, -i and -E/-r', code: 1 };
    var files = inputs('sed', a.rest, io, ctx);
    if (a.has('i') && (!a.rest.length || a.rest.indexOf('-') >= 0)) return { err: 'sed: -i requires a file operand', code: 1 };
    var sub = /^s(.)([\s\S]*?)\1([\s\S]*?)\1([gipI]*)$/.exec(script);
    var address = /^(?:\/(.*)\/|(\d+|\$)(?:,(\d+|\$))?)?([pd])$/.exec(script);
    if (!sub && !address) return { err: 'sed: unsupported expression in this simulator', code: 1 };
    var rx;
    try {
      var pattern = sub ? sub[2] : address[1];
      if (pattern != null) rx = new RegExp(a.has('E') || a.has('r') ? pattern : basicRegex(pattern), sub ? (sub[4].indexOf('g') >= 0 ? 'g' : '') + (/[iI]/.test(sub[4]) ? 'i' : '') : '');
    } catch (e) { return { err: 'sed: invalid regular expression', code: 1 }; }
    var out = [], errs = [], lineNo = 0;
    files.forEach(function (f) {
      if (f.err) { errs.push(f.err); return; }
      var current = [], input = lines(f.text);
      if (a.has('i')) lineNo = 0;
      input.forEach(function (line, index) {
        lineNo++;
        if (sub) {
          rx.lastIndex = 0;
          var changed = rx.test(line);
          rx.lastIndex = 0;
          var edited = line.replace(rx, function () {
            var args = arguments;
            return sub[3].replace(/\\([1-9&\\])|&/g, function (token, escaped) {
              if (escaped === '&' || escaped === '\\') return escaped;
              if (escaped) return args[Number(escaped)] == null ? '' : args[Number(escaped)];
              return args[0];
            });
          });
          if (changed && sub[4].indexOf('p') >= 0) current.push(edited);
          if (!a.has('n')) current.push(edited);
          return;
        }
        var selected = true;
        if (address[1] != null) { rx.lastIndex = 0; selected = rx.test(line); }
        else if (address[2]) {
          var from = address[2] === '$' ? input.length : Number(address[2]);
          var to = address[3] === '$' ? input.length : Number(address[3] || from);
          selected = lineNo >= from && lineNo <= to;
        }
        if (address[4] === 'd' && selected) return;
        if (address[4] === 'p' && selected) current.push(line);
        if (!a.has('n')) current.push(line);
      });
      if (a.has('i')) {
        var node = look(ctx, f.name);
        V.write(ctx.world.root, abs(ctx, f.name), current.join('\n') + (current.length && /\n$/.test(f.text) ? '\n' : ''), { owner: node.owner, group: node.group, mode: node.mode, mtime: ctx.world.clock });
      } else out = out.concat(current);
    });
    return { out: out.join('\n'), err: errs.join('\n'), code: errs.length ? 2 : 0 };
  }, { help: 'stream edit: sed s/a/b/g, sed -n /re/p' });

  reg('tr', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'ds' });
    var from = a.rest[0] || '', to = a.rest[1] || '';
    var text = io.stdin || '';
    if (a.has('s')) {
      return text.replace(new RegExp('[' + from.replace(/[\]\\^-]/g, '\\$&') + ']+', 'g'), to || from.charAt(0));
    }
    if (a.has('d')) {
      return text.replace(new RegExp('[' + from.replace(/[\]\\^-]/g, '\\$&') + ']', 'g'), '');
    }
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var idx = from.indexOf(text.charAt(i));
      out += idx >= 0 && to.charAt(idx) ? to.charAt(idx) : text.charAt(i);
    }
    return out;
  }, { help: 'translate characters' });

  reg('tee', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'a' });
    var errs = [];
    a.rest.forEach(function (p) {
      var target = abs(ctx, p), node = look(ctx, p), parent = V.lookup(ctx.world.root, V.dirname(target));
      if (target === '/dev/null') return;
      if (!parent || parent.type !== 'dir' || (node && node.type === 'dir')) { errs.push('tee: ' + p + ': cannot open output file'); return; }
      V.write(ctx.world.root, target, (a.has('a') && node ? V.read(node, ctx.world) : '') + (io.stdin || ''), { owner: node ? node.owner : ctx.world.user, mtime: ctx.world.clock });
    });
    return { out: io.stdin || '', exact: true, err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'write stdin to a file and stdout' });

  reg('xargs', function (argv, io, ctx) {
    var words = (io.stdin || '').split(/\s+/).filter(Boolean);
    if (!argv[1]) return words.join(' ');
    return sh.run(argv.slice(1).join(' ') + ' ' + words.join(' '), ctx).out;
  }, { help: 'build a command line from stdin' });

  reg('echo', function (argv, io, ctx) {
    var args = argv.slice(1);
    var newline = true, escapes = false;
    while (args.length && /^-[neE]+$/.test(args[0])) {
      args.shift().slice(1).split('').forEach(function (flag) {
        if (flag === 'n') newline = false;
        if (flag === 'e') escapes = true;
        if (flag === 'E') escapes = false;
      });
    }
    var text = args.join(' ');
    if (escapes) text = text.replace(/\\([ntr\\])/g, function (m, c) { return { n: '\n', t: '\t', r: '\r', '\\': '\\' }[c]; });
    return { out: text + (newline ? '\n' : ''), exact: true };
  }, { help: 'print arguments' });

  /* printf carries its weight for exactly one reason: converting a thread id
   * from top -H into the hex nid that jstack prints. */
  reg('printf', function (argv, io, ctx) {
    var fmt = argv[1] || '';
    var args = argv.slice(2);
    var i = 0;
    var out = fmt.replace(/%[-0-9.]*[dioxXsfu%]/g, function (spec) {
      if (spec === '%%') return '%';
      var v = args[i++];
      var conv = spec.charAt(spec.length - 1);
      if (conv === 'x') return (parseInt(v, 10) || 0).toString(16);
      if (conv === 'X') return (parseInt(v, 10) || 0).toString(16).toUpperCase();
      if (conv === 'o') return (parseInt(v, 10) || 0).toString(8);
      if (conv === 'd' || conv === 'i' || conv === 'u') return String(parseInt(v, 10) || 0);
      if (conv === 'f') return (parseFloat(v) || 0).toFixed(6);
      return v == null ? '' : String(v);
    });
    return { out: out.replace(/\\n/g, '\n').replace(/\\t/g, '\t'), exact: true };
  }, { help: 'format output: printf "%x\\n" 4913  (decimal TID to hex nid)' });

  reg('bc', function (argv, io, ctx) {
    var expr = (io.stdin || '').trim();
    var hexMode = /obase\s*=\s*16/.test(expr);
    var last = expr.split('\n').filter(function (l) { return !/base/.test(l); }).pop() || '';
    var val;
    try { val = Function('"use strict";return (' + last.replace(/[^0-9+\-*/%(). ]/g, '') + ')')(); }
    catch (e) { return { err: '(standard_in) 1: syntax error', code: 1 }; }
    if (val == null || isNaN(val)) return { err: '(standard_in) 1: syntax error', code: 1 };
    return hexMode ? Math.round(val).toString(16).toUpperCase() : String(val);
  }, { help: 'calculator: echo "obase=16; 4913" | bc' });

  /* ---------- find ---------- */

  reg('find', function (argv, io, ctx) {
    var world = ctx.world;
    var args = argv.slice(1);
    var roots = [];
    var i = 0;
    while (i < args.length && args[i].charAt(0) !== '-' && args[i].charAt(0) !== '!') { roots.push(args[i]); i++; }
    if (!roots.length) roots = ['.'];

    var namePats = [], typeFilter = null, maxdepth = Infinity, mindepth = 0, sizeTest = null,
      mminTest = null, mtimeTest = null, userFilter = null, printSize = false, printFormat = null, printZero = false, del = false, newer = null;

    for (; i < args.length; i++) {
      var t = args[i];
      var needsValue = ['-name', '-iname', '-type', '-maxdepth', '-mindepth', '-size', '-mmin', '-mtime', '-user', '-printf', '-newer', '-newermt'];
      if (needsValue.indexOf(t) >= 0 && i + 1 >= args.length) return { err: 'find: missing argument to ' + t, code: 1 };
      if (t === '-name' || t === '-iname') { var nameRx = V.globToRegex(args[++i]); namePats.push(t === '-iname' ? new RegExp(nameRx.source, 'i') : nameRx); }
      else if (t === '-type') typeFilter = args[++i];
      else if (t === '-maxdepth') maxdepth = parseInt(args[++i], 10);
      else if (t === '-mindepth') mindepth = parseInt(args[++i], 10);
      else if (t === '-size') sizeTest = args[++i];
      else if (t === '-mmin') mminTest = args[++i];
      else if (t === '-mtime') mtimeTest = args[++i];
      else if (t === '-user') userFilter = args[++i];
      else if (t === '-delete') del = true;
      else if (t === '-ls') printSize = true;
      else if (t === '-printf') printFormat = args[++i];
      else if (t === '-print0') printZero = true;
      else if (t === '-print' || t === '-a' || t === '-and') { /* implicit AND */ }
      else if (t === '-newermt') {
        newer = new Date(args[++i]);
        if (isNaN(newer.getTime())) return { err: 'find: invalid date', code: 1 };
      } else if (t === '-newer') {
        var reference = look(ctx, args[++i]);
        if (!reference) return { err: 'find: reference file does not exist', code: 1 };
        newer = reference.mtime || world.startClock;
      } else return { err: 'find: expression ' + t + ' is not supported in this simulator', code: 1 };
    }
    if (!Number.isFinite(mindepth) || mindepth < 0 || maxdepth < 0 || isNaN(maxdepth)) return { err: 'find: invalid depth', code: 1 };
    if (typeFilter && !/^[fdl]$/.test(typeFilter)) return { err: 'find: unsupported file type ' + typeFilter, code: 1 };
    if (sizeTest && !/^[+-]?\d+[bcwkMG]?$/.test(sizeTest)) return { err: 'find: invalid -size argument', code: 1 };
    if ([mminTest, mtimeTest].some(function (n) { return n != null && !/^[+-]?\d+$/.test(n); })) return { err: 'find: this simulator supports integer -mtime/-mmin values', code: 1 };
    if (printFormat && /%(?![%pfs]|T@)/.test(printFormat)) return { err: 'find: supported -printf directives are %p %f %s %T@ and %%', code: 1 };

    function cmpNum(spec, value, unit) {
      if (spec == null) return true;
      var sign = spec.charAt(0);
      var n = parseFloat(sign === '+' || sign === '-' ? spec.slice(1) : spec);
      var v = unit === 0 ? value : Math.floor(value / unit);
      if (sign === '+') return v > n;
      if (sign === '-') return v < n;
      return Math.floor(v) === Math.floor(n);
    }

    var out = [], errs = [], toDelete = [];
    roots.forEach(function (r) {
      var rp = abs(ctx, r);
      if (!V.lookup(world.root, rp)) { errs.push("find: '" + r + "': No such file or directory"); return; }
      V.walk(world.root, rp, function (p, node, depth) {
        if (depth > maxdepth) return false;
        var name = V.basename(p);
        if (depth < mindepth) return;
        if (namePats.some(function (rx) { return !rx.test(name); })) return;
        if (typeFilter === 'f' && node.type !== 'file') return;
        if (typeFilter === 'd' && node.type !== 'dir') return;
        if (typeFilter === 'l' && node.type !== 'link') return;
        if (userFilter && node.owner !== userFilter) return;
        var size = V.sizeOf(node, world);
        if (sizeTest) {
          var unit = /M$/.test(sizeTest) ? 1048576 : /G$/.test(sizeTest) ? 1073741824 : /k$/.test(sizeTest) ? 1024 : /c$/.test(sizeTest) ? 1 : /w$/.test(sizeTest) ? 2 : 512;
          if (!cmpNum(sizeTest.replace(/[MGkcwb]$/, ''), Math.ceil(size / unit), 0)) return;
        }
        var age = (world.clock - (node.mtime || world.startClock)) / 1000;
        if (mminTest && !cmpNum(mminTest, age, 60)) return;
        if (mtimeTest && !cmpNum(mtimeTest, age, 86400)) return;
        if (newer && (node.mtime || world.startClock) <= newer) return;
        if (del) { toDelete.push(p); return; }
        var display = r.charAt(0) === '/' ? p : r.replace(/\/$/, '') + p.slice(rp.length);
        if (printFormat != null) out.push(printFormat.replace(/%T@|%[%pfs]|\\[ntr0]/g, function (fmt) {
          return { '%p': display, '%f': name, '%s': String(size), '%T@': String((node.mtime || world.startClock).getTime() / 1000), '%%': '%', '\\n': '\n', '\\t': '\t', '\\r': '\r', '\\0': '\0' }[fmt];
        }));
        else out.push(printSize ? W.lpad(Math.ceil(size / 1024), 6) + ' ' + node.mode + ' ' + node.nlink + ' ' + node.owner + ' ' + node.group + ' ' + size + ' ' + V.lsTime(node.mtime || world.startClock, world.clock) + ' ' + display : display);
      });
    });

    toDelete.sort(function (a, b) { return b.length - a.length; }).forEach(function (p) {
      var node = V.lookup(world.root, p, false);
      if (p === '/' || (node && node.type === 'dir' && Object.keys(node.children).length)) { errs.push('find: cannot delete ' + p + ': Directory not empty'); return; }
      V.unlink(world.root, p);
    });
    if (del) return { out: '', err: errs.join('\n'), code: errs.length ? 1 : 0 };
    return { out: printFormat != null ? out.join('') : printZero ? out.join('\0') + (out.length ? '\0' : '') : out.join('\n'), exact: printZero || printFormat != null, err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'find files (-name -type -size -mmin -mtime -maxdepth)' });

  /* ---------- file metadata ---------- */

  reg('stat', function (argv, io, ctx) {
    var p = argv[1];
    if (!p) return { err: 'stat: missing operand', code: 1 };
    var node = look(ctx, p);
    if (!node) return { err: 'stat: cannot stat ' + p + ': No such file or directory', code: 1 };
    var world = ctx.world;
    var size = V.sizeOf(node, world);
    var mt = node.mtime || world.startClock;
    var fs = W.fsFor(world, abs(ctx, p));
    return [
      '  File: ' + p,
      '  Size: ' + W.rpad(size, 12) + 'Blocks: ' + W.rpad(Math.ceil(size / 512), 10) + 'IO Block: 4096   ' +
        (node.type === 'dir' ? 'directory' : node.type === 'link' ? 'symbolic link' : 'regular file'),
      'Device: fd00h/64768d    Inode: ' + (1000000 + (size % 900000)) + '    Links: ' + node.nlink,
      'Access: (0' + modeOctal(node.mode) + '/' + node.mode + ')  Uid: ( 1042/' + W.rpad(node.owner, 8) + ')   Gid: ( 1042/' + W.rpad(node.group, 8) + ')',
      'Access: ' + W.isoStamp(mt, true) + ' +0000',
      'Modify: ' + W.isoStamp(mt, true) + ' +0000',
      'Change: ' + W.isoStamp(mt, true) + ' +0000',
      ' Birth: -',
      '  Mount: ' + (fs ? fs.mount : '/')
    ].join('\n');
  }, { help: 'file status' });

  function modeOctal(mode) {
    var m = mode.slice(1);
    var v = '';
    for (var i = 0; i < 9; i += 3) {
      var n = 0;
      if (m.charAt(i) === 'r') n += 4;
      if (m.charAt(i + 1) === 'w') n += 2;
      if (m.charAt(i + 2) === 'x' || m.charAt(i + 2) === 's') n += 1;
      v += n;
    }
    return v;
  }

  reg('file', function (argv, io, ctx) {
    var p = argv[1];
    var node = look(ctx, p);
    if (!node) return { err: p + ': cannot open (No such file or directory)', code: 1 };
    if (node.type === 'dir') return p + ': directory';
    if (node.type === 'link') return p + ': symbolic link to ' + node.target;
    if (/\.(gz)$/.test(p)) return p + ': gzip compressed data';
    if (/\.(jar|zip)$/.test(p)) return p + ': Java archive data (JAR)';
    if (/\.(hprof)$/.test(p)) return p + ': Java HPROF dump, version 1.0.2';
    if (/^#!/.test(V.read(node, ctx.world))) return p + ': a shell script, ASCII text executable';
    return p + ': ASCII text';
  }, { help: 'identify file type' });

  reg('which', function (argv, io, ctx) {
    var name = argv[1];
    if (!name) return { err: 'usage: which command', code: 1 };
    if (sh.cmds[name]) return '/usr/bin/' + name;
    return { err: '/usr/bin/which: no ' + name + ' in (/usr/local/bin:/usr/bin:/bin)', code: 1 };
  }, { help: 'locate a command' });

  reg('basename', function (argv) { return V.basename(argv[1] || ''); }, { help: 'strip directory' });
  reg('dirname', function (argv) { return V.dirname(argv[1] || ''); }, { help: 'strip last component' });

  /* ---------- mutation ---------- */

  reg('touch', function (argv, io, ctx) {
    sh.parseArgs(argv, {}).rest.forEach(function (p) {
      var a = abs(ctx, p);
      var node = V.lookup(ctx.world.root, a);
      if (node) node.mtime = new Date(ctx.world.clock.getTime());
      else V.write(ctx.world.root, a, '', { owner: ctx.world.user, group: ctx.world.user, mtime: ctx.world.clock });
    });
    return '';
  }, { help: 'create or timestamp a file' });

  reg('mkdir', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'p' });
    var errs = [];
    a.rest.forEach(function (p) {
      var target = abs(ctx, p);
      var parent = V.lookup(ctx.world.root, V.dirname(target));
      if (!parent && !a.has('p')) { errs.push('mkdir: cannot create directory ' + p + ': No such file or directory'); return; }
      if (V.lookup(ctx.world.root, target)) {
        if (!a.has('p')) errs.push('mkdir: cannot create directory ' + p + ': File exists');
        return;
      }
      var parts = target.split('/').filter(Boolean);
      var node = ctx.world.root;
      parts.forEach(function (seg) {
        if (!node.children[seg]) node.children[seg] = V.dir({}, { owner: ctx.world.user, group: ctx.world.user, mtime: ctx.world.clock });
        node = node.children[seg];
      });
    });
    return { out: '', err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'create directories (-p)' });

  reg('rm', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'rfRi' });
    var errs = [], world = ctx.world;
    a.rest.forEach(function (p) {
      var target = abs(ctx, p);
      var node = V.lookup(world.root, target);
      if (!node) { if (!a.has('f')) errs.push('rm: cannot remove ' + p + ': No such file or directory'); return; }
      if (node.type === 'dir' && !(a.has('r') || a.has('R'))) {
        errs.push('rm: cannot remove ' + p + ': Is a directory'); return;
      }
      var size = V.diskUsage(world.root, target, world);
      var fs = W.fsFor(world, target);

      // Unlinking a file a live process still holds open does NOT return the
      // blocks - that gap is the whole point of the disk-full scenario.
      var holder = null;
      for (var i = 0; i < world.procs.length && !holder; i++) {
        var pr = world.procs[i];
        for (var j = 0; j < (pr.fds || []).length; j++) {
          if (pr.fds[j].path === target) { holder = { proc: pr, fd: pr.fds[j] }; break; }
        }
      }
      V.unlink(world.root, target);
      if (holder) {
        world.deleted.push({
          pid: holder.proc.pid, cmd: holder.proc.cmd, user: holder.proc.user,
          fd: holder.fd.fd, path: target, size: size, mount: fs ? fs.mount : '/'
        });
        holder.proc.fds = holder.proc.fds.filter(function (x) { return x.path !== target; });
      } else if (fs) {
        fs.used = Math.max(0, fs.used - size);
        if (fs.inodes) fs.inodes.used = Math.max(0, fs.inodes.used - 1);
      }
    });
    return { out: '', err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'remove files (-r -f)' });

  reg('cp', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'rRfp' });
    if (a.rest.length < 2) return { err: 'cp: missing destination file operand', code: 1 };
    var dst = a.rest.pop();
    var errs = [];
    if (a.rest.length > 1 && (!look(ctx, dst) || look(ctx, dst).type !== 'dir')) return { err: 'cp: target is not a directory', code: 1 };
    function copy(node) {
      var cloned = {};
      Object.keys(node).forEach(function (key) { cloned[key] = node[key]; });
      if (!a.has('p')) { cloned.owner = ctx.world.user; cloned.group = ctx.world.user; cloned.mtime = new Date(ctx.world.clock.getTime()); }
      if (node.children) { cloned.children = {}; Object.keys(node.children).forEach(function (name) { cloned.children[name] = copy(node.children[name]); }); }
      return cloned;
    }
    a.rest.forEach(function (src) {
      var node = look(ctx, src);
      if (!node) { errs.push('cp: cannot stat ' + src + ': No such file or directory'); return; }
      if (node.type === 'dir' && !a.has('r') && !a.has('R')) { errs.push('cp: -r not specified; omitting directory ' + src); return; }
      var target = abs(ctx, dst);
      var dstNode = V.lookup(ctx.world.root, target);
      if (dstNode && dstNode.type === 'dir') target = target + '/' + V.basename(src);
      var source = abs(ctx, src), parent = V.lookup(ctx.world.root, V.dirname(target)), existing = V.lookup(ctx.world.root, target);
      if (target === source || (node.type === 'dir' && target.indexOf(source + '/') === 0)) { errs.push('cp: source and destination overlap'); return; }
      if (!parent || parent.type !== 'dir') { errs.push('cp: destination parent does not exist'); return; }
      if (existing && (node.type === 'dir' || existing.type === 'dir')) { errs.push('cp: merging existing directories is not supported in this simulator'); return; }
      parent.children[V.basename(target)] = copy(node);
    });
    return { out: '', err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'copy files' });

  reg('mv', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { bool: 'f' });
    if (a.rest.length < 2) return { err: 'mv: missing destination file operand', code: 1 };
    var dst = a.rest.pop();
    var errs = [];
    if (a.rest.length > 1 && (!look(ctx, dst) || look(ctx, dst).type !== 'dir')) return { err: 'mv: target is not a directory', code: 1 };
    a.rest.forEach(function (src) {
      var source = abs(ctx, src), node = V.lookup(ctx.world.root, source, false);
      if (!node) { errs.push('mv: cannot stat ' + src + ': No such file or directory'); return; }
      var target = abs(ctx, dst);
      var dstNode = V.lookup(ctx.world.root, target);
      if (dstNode && dstNode.type === 'dir') target = target + '/' + V.basename(src);
      var parent = V.lookup(ctx.world.root, V.dirname(target)), existing = V.lookup(ctx.world.root, target, false);
      if (target === source || (node.type === 'dir' && target.indexOf(source + '/') === 0)) { errs.push('mv: source and destination overlap'); return; }
      if (!parent || parent.type !== 'dir') { errs.push('mv: destination parent does not exist'); return; }
      if (existing && ((existing.type === 'dir') !== (node.type === 'dir') || (existing.type === 'dir' && Object.keys(existing.children).length))) { errs.push('mv: cannot replace destination'); return; }
      parent.children[V.basename(target)] = node;
      V.unlink(ctx.world.root, source);
    });
    return { out: '', err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'move/rename files' });

  reg('truncate', function (argv, io, ctx) {
    argv = argv.reduce(function (out, arg) {
      if (arg === '--size') out.push('-s');
      else if (arg.indexOf('--size=') === 0) out.push('-s', arg.slice(7));
      else if (arg === '--no-create') out.push('-c');
      else out.push(arg);
      return out;
    }, []);
    var a = sh.parseArgs(argv, { bool: 'c', value: 's' });
    var size = a.vals.s;
    if (size == null) return { err: 'truncate: you must specify either --size or --reference', code: 1 };
    var spec = /^([+-]?)(\d+)([KMG]?)(B?)$/i.exec(size);
    if (!spec) return { err: 'truncate: unsupported or invalid size ' + size, code: 1 };
    if (Object.keys(a.flags).some(function (f) { return f !== 'c'; })) return { err: 'truncate: supported options are -s/--size and -c/--no-create', code: 1 };
    if (!a.rest.length) return { err: 'truncate: missing file operand', code: 1 };
    var amount = Number(spec[2]) * Math.pow(spec[4] ? 1000 : 1024, ['', 'K', 'M', 'G'].indexOf(spec[3].toUpperCase()));
    var errs = [];
    a.rest.forEach(function (p) {
      var target = abs(ctx, p);
      var m = /^\/proc\/(\d+)\/fd\/(\d+)$/.exec(target);
      if (m) {
        if (amount !== 0 || spec[1]) { errs.push('truncate: only -s 0 is supported for simulated /proc file descriptors'); return; }
        if (!W.truncateFd(ctx.world, Number(m[1]), Number(m[2]), '')) {
          errs.push('truncate: cannot open ' + p + ' for writing: No such file or directory');
        }
        return;
      }
      var node = V.lookup(ctx.world.root, target);
      if (!node && a.has('c')) return;
      var parent = V.lookup(ctx.world.root, V.dirname(target));
      if (!parent || parent.type !== 'dir') { errs.push('truncate: cannot open ' + p + ': No such directory'); return; }
      if (node && node.type !== 'file') { errs.push('truncate: ' + p + ': not a regular file'); return; }
      var before = node ? V.sizeOf(node, ctx.world) : 0;
      var nextSize = spec[1] === '+' ? before + amount : spec[1] === '-' ? Math.max(0, before - amount) : amount;
      if (nextSize > 1048576) { errs.push('truncate: nonzero content above 1 MiB is not supported in this simulator'); return; }
      var text = node ? V.read(node, ctx.world).slice(0, nextSize) : '';
      if (text.length < nextSize) text += '\0'.repeat(nextSize - text.length);
      if (!node) { V.write(ctx.world.root, target, '', { owner: ctx.world.user, group: ctx.world.user }); node = V.lookup(ctx.world.root, target); }
      node.content = text;
      node.size = nextSize;
      node.mtime = new Date(ctx.world.clock.getTime());
      var fs = W.fsFor(ctx.world, target);
      if (fs) fs.used = Math.max(0, fs.used - (before - node.size));
    });
    return { out: '', err: errs.join('\n'), code: errs.length ? 1 : 0 };
  }, { help: 'shrink a file: truncate -s 0 FILE' });

  /* ---------- identity / misc ---------- */

  reg('whoami', function (argv, io, ctx) { return ctx.world.user; }, { help: 'current user' });
  reg('hostname', function (argv, io, ctx) { return ctx.world.host; }, { help: 'host name' });

  reg('id', function (argv, io, ctx) {
    var u = ctx.world.user;
    return 'uid=1042(' + u + ') gid=1042(' + u + ') groups=1042(' + u + '),2001(prodsupport),2007(appadm)';
  }, { help: 'user identity' });

  reg('date', function (argv, io, ctx) {
    var world = ctx.world;
    if (argv[1] === '-u' || argv[1] === '--utc') return W.dateStr(world.clock);
    return W.dateStr(world.clock);
  }, { help: 'current date/time' });

  reg('env', function (argv, io, ctx) {
    var w = ctx.world;
    var base = {
      USER: w.user, LOGNAME: w.user, HOME: w.home, PWD: w.cwd, HOSTNAME: w.host,
      SHELL: '/bin/bash', TERM: 'xterm-256color',
      PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin',
      LANG: 'en_GB.UTF-8'
    };
    for (var k in w.env) base[k] = w.env[k];
    return Object.keys(base).map(function (k) { return k + '=' + base[k]; }).join('\n');
  }, { help: 'environment variables' });

  reg('export', function (argv, io, ctx) {
    argv.slice(1).forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) ctx.world.env[kv.slice(0, i)] = kv.slice(i + 1);
    });
    return '';
  }, { help: 'set an environment variable' });

  reg('sleep', function (argv) { return ''; }, { help: 'no-op here' });
  reg('true', function () { return { out: '', code: 0 }; }, {});
  reg('false', function () { return { out: '', code: 1 }; }, {});

  reg('vi', function (argv) {
    return { err: 'vi: interactive editors are not available in this simulator - use cat, grep, sed or tail', code: 1 };
  }, { help: 'not available' });
  sh.alias('vim', 'vi');
  sh.alias('nano', 'vi');

  PS.coreLoaded = true;
})(PS);
