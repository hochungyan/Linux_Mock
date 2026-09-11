/* shell.js - a small but honest bash: quoting, $vars, globs, pipes, redirects,
 * ;  &&  ||  and exit codes. Commands register themselves into PS.shell.cmds.
 */
(function (PS) {
  'use strict';

  var shell = {
    cmds: {},
    meta: {}
  };

  /* register(name, fn, meta)
   * fn(argv, io, ctx) -> string | {out, err, code, app}
   *   argv : ['df','-h','/var']
   *   io   : {stdin: string}
   *   ctx  : {world, shell, game, raw}
   */
  shell.register = function (name, fn, meta) {
    shell.cmds[name] = fn;
    shell.meta[name] = meta || {};
  };

  shell.alias = function (name, target) {
    shell.cmds[name] = function (argv, io, ctx) {
      var a = argv.slice();
      a[0] = target;
      return shell.cmds[target](a, io, ctx);
    };
    shell.meta[name] = shell.meta[target] || {};
  };

  /* ---------- tokenizer ---------- */

  var OPS = ['2>&1', '1>&2', '&>>', '&&', '||', '2>>', '1>>', '2>', '1>', '&>', '>>', '>', '<', '|', ';'];

  function tokenize(line) {
    var toks = [], i = 0, cur = '', parts = [], has = false;

    function part(text, quote) {
      parts.push({ text: text, quote: quote }); has = true;
    }
    function flush() { if (cur) { part(cur, ''); cur = ''; } }

    function push() {
      flush();
      if (has) { toks.push({ parts: parts }); parts = []; has = false; }
    }

    while (i < line.length) {
      var ch = line.charAt(i);

      if (ch === '#' && !has) break;                    // comment to end of line

      if (ch === ' ' || ch === '\t') { push(); i++; continue; }
      if (ch === '\n') { push(); toks.push({ op: ';' }); i++; continue; }

      if (ch === '\\') { flush(); part(line.charAt(i + 1) || '', 'single'); i += 2; continue; }

      if (ch === "'") {
        var end = line.indexOf("'", i + 1);
        if (end < 0) throw new Error('unterminated single quote');
        flush(); part(line.slice(i + 1, end), 'single');
        i = end + 1; continue;
      }

      if (ch === '"') {
        flush(); var j = i + 1, buf = '';
        while (j < line.length && line.charAt(j) !== '"') {
          if (line.charAt(j) === '\\') {
            // Inside double quotes a backslash only escapes " \ $ and `.
            // Everything else keeps the backslash, which is why printf "%x\n"
            // receives a real \n to interpret.
            var nxt = line.charAt(j + 1);
            if (nxt === '"' || nxt === '\\' || nxt === '$' || nxt === '`') {
              part(buf, 'double'); buf = ''; part(nxt, 'single'); j += 2;
            }
            else { buf += '\\'; j += 1; }
          } else { buf += line.charAt(j); j++; }
        }
        if (j >= line.length) throw new Error('unterminated double quote');
        part(buf, 'double');
        i = j + 1; continue;
      }

      // operators
      var matched = null;
      for (var k = 0; k < OPS.length; k++) {
        if (has && /^[12]/.test(OPS[k])) continue;
        if (line.substr(i, OPS[k].length) === OPS[k]) { matched = OPS[k]; break; }
      }
      if (matched) {
        push();
        toks.push({ op: matched });
        i += matched.length;
        continue;
      }

      if (ch === '&') throw new Error('background jobs (&) are not supported in this simulator');

      cur += ch; has = true; i++;
    }
    push();
    return toks;
  }

  /* ---------- expansion ---------- */

  function expandVars(text, ctx) {
    return text.replace(/\$\{(\w+)\}|\$(\w+)|\$\?/g, function (m, a, b) {
      if (m === '$?') return String(ctx.lastCode || 0);
      var name = a || b;
      var w = ctx.world;
      var env = {
        HOME: w.home, USER: w.user, LOGNAME: w.user, HOSTNAME: w.host,
        PWD: w.cwd, SHELL: '/bin/bash', TERM: 'xterm-256color',
        PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin'
      };
      for (var kk in w.env) env[kk] = w.env[kk];
      return env[name] != null ? String(env[name]) : '';
    });
  }

  function expandWord(tok, ctx) {
    var protectedGlob = false, quoted = false;
    var text = tok.parts.map(function (p) {
      if (p.quote) { quoted = true; if (PS.vfs.hasGlob(p.text)) protectedGlob = true; }
      if (p.quote !== 'single' && /`|\$\(/.test(p.text)) throw new Error('command substitution is not supported in this simulator');
      return p.quote === 'single' ? p.text : expandVars(p.text, ctx);
    }).join('');
    var words = quoted ? [text] : text.split(/[ \t\n]+/).filter(Boolean);
    var out = [];
    words.forEach(function (word) {
      if (protectedGlob || !PS.vfs.hasGlob(word)) { out.push(word); return; }
      var hits = PS.vfs.glob(ctx.world.root, word, ctx.world.cwd, ctx.world.home);
      out = out.concat(hits.length ? hits : [word]);
    });
    return out;
  }

  /* ---------- parse into statements/pipelines ---------- */

  function parse(line, ctx) {
    var toks = tokenize(line);
    var statements = [];
    var stmt = { join: null, pipeline: [] };
    var seg = { words: [], redirects: [] };
    var pendingRedirect = null;

    function endSeg() {
      if (seg.words.length || seg.redirects.length) stmt.pipeline.push(seg);
      seg = { words: [], redirects: [] };
    }
    function endStmt(join) {
      endSeg();
      if (stmt.pipeline.length) statements.push(stmt);
      stmt = { join: join, pipeline: [] };
    }

    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.op) {
        if (pendingRedirect) throw new Error('syntax error: missing redirection target');
        if ((t.op === '|' || t.op === '&&' || t.op === '||') && !seg.words.length && !seg.redirects.length) throw new Error('syntax error near ' + t.op);
        if (t.op === '|') { endSeg(); continue; }
        if (t.op === ';') { endStmt(null); continue; }
        if (t.op === '&&') { endStmt('&&'); continue; }
        if (t.op === '||') { endStmt('||'); continue; }
        if (t.op === '2>&1' || t.op === '1>&2') { seg.redirects.push({ kind: t.op }); continue; }
        pendingRedirect = t.op;
        continue;
      }
      if (pendingRedirect) {
        seg.redirects.push({ kind: pendingRedirect, token: t });
        pendingRedirect = null;
      } else {
        seg.words.push(t);
      }
    }
    if (pendingRedirect) throw new Error('syntax error: missing redirection target');
    if (toks.length && /^(\||&&|\|\|)$/.test(toks[toks.length - 1].op || '')) throw new Error('syntax error: incomplete pipeline');
    endStmt(null);
    return statements;
  }

  /* ---------- execution ---------- */

  function normalizeResult(r) {
    if (r == null) return { out: '', err: '', code: 0 };
    if (typeof r === 'string') r = { out: r };
    function terminated(s) { return s && !/\n$/.test(s) ? s + '\n' : (s || ''); }
    return { out: r.exact ? (r.out || '') : terminated(r.out), err: terminated(r.err), code: r.code || 0, app: r.app, silent: r.silent };
  }

  shell.run = function (line, ctx) {
    var result = { out: '', err: '', code: 0, app: null };
    if (!line.trim()) return result;

    var statements;
    try {
      statements = parse(line, ctx);
    } catch (e) {
      ctx.lastCode = 2;
      return { out: '', err: 'bash: ' + e.message, code: 2 };
    }

    var lastCode = ctx.lastCode || 0;
    for (var s = 0; s < statements.length; s++) {
      var st = statements[s];
      if (st.join === '&&' && lastCode !== 0) continue;
      if (st.join === '||' && lastCode === 0) continue;

      var stdin = '';
      var pipeOut = '';
      var stderrAll = '';
      var appResult = null;

      for (var p = 0; p < st.pipeline.length; p++) {
        var seg = st.pipeline[p];
        ctx.lastCode = lastCode;
        var argv = [], sinks = [], stdout = { type: 'stdout', text: '' }, stderr = { type: 'stderr', text: '' };
        var fd1 = stdout, fd2 = stderr, redirectError = null;
        try {
          seg.words.forEach(function (word) { argv = argv.concat(expandWord(word, ctx)); });
          seg.redirects.forEach(function (redir) {
            if (redir.kind === '2>&1') { fd2 = fd1; return; }
            if (redir.kind === '1>&2') { fd1 = fd2; return; }
            var paths = expandWord(redir.token, ctx);
            if (paths.length !== 1) throw new Error('ambiguous redirect');
            var path = paths[0], kind = redir.kind;
            if (kind === '<') {
              var node = PS.vfs.lookup(ctx.world.root, PS.vfs.resolve(path, ctx.world.cwd, ctx.world.home));
              if (!node) throw new Error(path + ': No such file or directory');
              if (node.type === 'dir') throw new Error(path + ': Is a directory');
              stdin = PS.vfs.read(node, ctx.world);
              return;
            }
            // Open/truncate immediately, in source order, before running the command.
            var sink = { type: 'file', path: path, text: '', kind: />>$/.test(kind) ? '>>' : '>' };
            writeTo(ctx, sink, '');
            sinks.push(sink);
            if (kind.charAt(0) === '2') fd2 = sink;
            else { fd1 = sink; if (kind.charAt(0) === '&') fd2 = sink; }
          });
        } catch (e) { redirectError = e.message; }

        if (redirectError) {
          stderrAll += 'bash: ' + redirectError + '\n'; lastCode = 1; stdin = ''; pipeOut = ''; continue;
        }

        var name = argv[0];

        var fn = shell.cmds[name];
        var r;
        if (!name) {
          r = { out: '', err: '', code: 0 };
        } else if (!fn) {
          r = normalizeResult({ out: '', err: 'bash: ' + name + ': command not found', code: 127 });
        } else {
          ctx.lastCode = lastCode;
          try {
            r = normalizeResult(fn(argv, { stdin: stdin }, ctx));
          } catch (e) {
            r = normalizeResult({ out: '', err: name + ': internal error: ' + (e && e.message), code: 1 });
            if (window.console) console.error(e);
          }
        }

        if (r.app) appResult = r.app;

        fd1.text += r.out || '';
        fd2.text += r.err || '';
        sinks.forEach(function (sink) {
          // The descriptor is already open: subsequent bytes append to it.
          if (sink.text) writeTo(ctx, { path: sink.path, kind: '>>' }, PS.world.stripColor(sink.text));
        });
        stderrAll += stderr.text;
        lastCode = r.code || 0;
        stdin = PS.world.stripColor(stdout.text);
        pipeOut = stdout.text;
        if (r.silent) pipeOut = '';
      }

      result.out += pipeOut;
      result.err += stderrAll;
      if (appResult) result.app = appResult;
    }

    result.code = lastCode;
    ctx.lastCode = lastCode;
    // Terminal rendering already advances a line; keep bytes intact until here.
    result.out = result.out.replace(/\n$/, '');
    result.err = result.err.replace(/\n$/, '');
    return result;
  };

  function writeTo(ctx, redir, text) {
    var abs = PS.vfs.resolve(redir.path, ctx.world.cwd, ctx.world.home);
    if (abs === '/dev/null') return;

    // Writing through /proc/<pid>/fd/<n> truncates or appends to the *open file
    // description* - the mechanism behind reclaiming a deleted-but-open log.
    var m = /^\/proc\/(\d+)\/fd\/(\d+)$/.exec(abs);
    if (m) {
      if (!PS.world.truncateFd || !PS.world.truncateFd(ctx.world, Number(m[1]), Number(m[2]), text)) {
        throw new Error(redir.path + ': No such file or directory');
      }
      return;
    }

    var append = redir.kind === '>>' || redir.kind === '2>>';
    var node = PS.vfs.lookup(ctx.world.root, abs);
    var parent = PS.vfs.lookup(ctx.world.root, PS.vfs.dirname(abs));
    if (!parent) throw new Error(redir.path + ': No such file or directory');
    if (parent.type !== 'dir') throw new Error(redir.path + ': Not a directory');
    if (node && node.type === 'dir') throw new Error(redir.path + ': Is a directory');
    var prev = append && node ? PS.vfs.read(node, ctx.world) : '';
    var body = prev + text;
    if (!PS.vfs.write(ctx.world.root, abs, body, { owner: node ? node.owner : ctx.world.user, group: node ? node.group : ctx.world.user, mode: node ? node.mode : '-rw-r--r--', mtime: ctx.world.clock })) {
      throw new Error(redir.path + ': cannot write file');
    }
  }

  /* ---------- argv helpers for command authors ---------- */

  /* parseArgs(argv, {bool:'ahlR', value:'np'}) ->
   * {flags:{a:true}, vals:{n:'20'}, rest:[...], has(f)} */
  shell.parseArgs = function (argv, spec) {
    spec = spec || {};
    var boolChars = spec.bool || '';
    var valChars = spec.value || '';
    var longs = spec.long || {};
    var res = { flags: {}, vals: {}, allVals: {}, rest: [], raw: argv.slice(1) };

    for (var i = 1; i < argv.length; i++) {
      var a = argv[i];
      if (a === '--') { res.rest = res.rest.concat(argv.slice(i + 1)); break; }
      if (a.length > 2 && a.slice(0, 2) === '--') {
        var eq = a.indexOf('=');
        var lname = eq > 0 ? a.slice(2, eq) : a.slice(2);
        var lval = eq > 0 ? a.slice(eq + 1) : true;
        res.flags[lname] = lval;
        if (longs[lname]) res.flags[longs[lname]] = lval;
        continue;
      }
      if (a.charAt(0) === '-' && a.length > 1 && !/^-\d/.test(a)) {
        for (var c = 1; c < a.length; c++) {
          var ch = a.charAt(c);
          if (valChars.indexOf(ch) >= 0) {
            var inline = a.slice(c + 1);
            if (inline) { res.vals[ch] = inline; }
            else { res.vals[ch] = argv[++i]; }
            (res.allVals[ch] || (res.allVals[ch] = [])).push(res.vals[ch]);
            c = a.length;
          } else if (boolChars.indexOf(ch) >= 0) {
            res.flags[ch] = true;
          } else {
            res.flags[ch] = true;   // tolerate unknown flags rather than erroring
          }
        }
        continue;
      }
      res.rest.push(a);
    }
    res.has = function (f) { return !!res.flags[f]; };
    return res;
  };

  shell.err = function (cmd, path, msg) {
    return { out: '', err: cmd + ': ' + (path ? path + ': ' : '') + msg, code: 1 };
  };

  PS.shell = shell;
})(PS);
