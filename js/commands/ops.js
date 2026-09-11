/* commands/ops.js - the desk's own tooling and the game verbs.
 *
 * autorep/sendevent stand in for the batch scheduler every bank runs; diagnose
 * and fix are how you close the incident.
 */
(function (PS) {
  'use strict';

  var sh = PS.shell, W = PS.world, V = PS.vfs;
  var reg = sh.register;

  /* ---------- help / man ---------- */

  var GROUPS = [
    ['Navigation', ['ls', 'cd', 'pwd', 'find', 'stat', 'file', 'du']],
    ['Reading logs', ['cat', 'less', 'head', 'tail', 'grep', 'zgrep', 'wc', 'awk', 'sed', 'sort', 'uniq', 'cut']],
    ['Evidence files', ['tee', 'cp', 'mv', 'truncate', 'stat']],
    ['CPU & memory', ['top', 'ps', 'free', 'vmstat', 'sar', 'uptime', 'pmap', 'kill']],
    ['Disk & I/O', ['df', 'du', 'iostat', 'lsof', 'mount', 'truncate']],
    ['Network', ['netstat', 'ss', 'ip', 'ifconfig', 'ping', 'telnet', 'nc', 'tcpdump', 'ntpq']],
    ['Java / app', ['jps', 'jstack', 'jmap', 'jstat', 'jcmd', 'jinfo']],
    ['System', ['systemctl', 'journalctl', 'dmesg', 'uname', 'lscpu', 'ulimit', 'sysctl']],
    ['Batch', ['autorep', 'sendevent']],
    ['Incident', ['brief', 'findings', 'diagnose', 'hint', 'escalate', 'help', 'man']],
    ['Drill', ['task', 'answer', 'tasks', 'hint', 'solution', 'skip', 'finish']]
  ];

  reg('help', function (argv, io, ctx) {
    if (argv[1]) return sh.cmds.man(['man', argv[1]], io, ctx);
    var out = [W.bold('Commands available on this host') + W.dim('  (help <cmd> for detail)'), ''];
    GROUPS.forEach(function (g) {
      out.push('  ' + W.amber(W.rpad(g[0], 15)) + g[1].join(' '));
    });
    out.push('');
    out.push(W.dim('  Supported subset: pipes, redirects, globs, $VARS, && and ||. Tab completes. Up recalls.'));
    out.push(W.dim('  This is a simulation. man <command> describes its available subset.'));
    out.push(W.dim('  Interview practice includes additional real GNU/Linux examples and support questions.'));
    out.push(W.dim('  When you know the cause: ') + W.green('diagnose') + W.dim('   Stuck? ') + W.green('hint'));
    return out.join('\n');
  }, { help: 'list commands' });

  reg('man', function (argv, io, ctx) {
    var name = argv[1];
    if (!name) return { err: 'What manual page do you want?', code: 1 };
    var meta = sh.meta[name];
    if (!meta) return { err: 'No manual entry for ' + name, code: 1 };
    return W.bold(name.toUpperCase() + '(1)') + '\n\n  ' + name + ' - ' + (meta.help || 'no description') +
      (meta.detail ? '\n\n  ' + meta.detail : '');
  }, { help: 'manual page' });

  reg('history', function (argv, io, ctx) {
    return (ctx.game ? ctx.game.history : []).map(function (h, i) {
      return W.lpad(i + 1, 5) + '  ' + h;
    }).join('\n');
  }, { help: 'command history' });

  reg('clear', function () { return { out: '', clear: true, silent: true }; }, { help: 'clear the screen' });

  reg('watch', function (argv, io, ctx) {
    var a = sh.parseArgs(argv, { value: 'n', bool: 'd' });
    var cmdline = a.rest.join(' ');
    if (!cmdline) return { err: 'watch: no command specified', code: 1 };
    return {
      out: '',
      app: {
        type: 'screen',
        label: 'watch ' + cmdline,
        render: function (world) {
          var r = sh.run(cmdline, ctx);
          return 'Every ' + (a.vals.n || 2) + '.0s: ' + W.rpad(cmdline, 50) +
            ctx.world.host + ': ' + W.dateStr(world.clock) + '\n\n' + (r.out || r.err);
        },
        footer: 'press q or Ctrl+C to quit watch'
      }
    };
  }, { help: 'run a command repeatedly: watch -n 2 "df -h"' });

  reg('pmap', function (argv, io, ctx) {
    var pid = Number(argv[argv.length - 1]);
    var p = W.findProc(ctx.world, pid);
    if (!p) return { err: 'pmap: cannot examine ' + pid + ': No such process', code: 1 };
    var out = [pid + ':   ' + p.cmd];
    out.push('0000000000400000      4K r-x-- java');
    out.push('00000000c0000000 ' + W.lpad(W.kb(p.jvm ? p.jvm.heapMax : p.rss), 9) + 'K rw---   [ anon ]   ' + W.dim('(java heap)'));
    out.push('00007f2a00000000 ' + W.lpad(W.kb(p.rss * 0.15), 9) + 'K rw---   [ anon ]   ' + W.dim('(metaspace + thread stacks)'));
    out.push(' total ' + W.lpad(W.kb(p.vsz), 12) + 'K');
    return out.join('\n');
  }, { help: 'process memory map' });

  /* ---------- Autosys ---------- */

  reg('autorep', function (argv, io, ctx) {
    var world = ctx.world;
    var a = sh.parseArgs(argv, { bool: 'q', value: 'Jjsd' });
    var name = a.vals.J || a.vals.j || a.rest[0];
    var jobs = world.jobs || [];

    if (!name) return { err: 'autorep: must specify -J <job_name>', code: 1 };

    var pat = V.globToRegex(name === 'ALL' ? '*' : name);
    var hits = jobs.filter(function (j) { return pat.test(j.name); });
    if (!hits.length) return { err: 'CAUAJM_E_50029 Invalid job name: ' + name, code: 1 };

    if (a.vals.d != null || a.has('q')) {
      // detail view: show the dependency that is actually holding things up
      return hits.map(function (j) {
        return ['', 'Job Name: ' + j.name, '  Status: ' + j.status,
          '  Command: ' + (j.command || '-'),
          '  Machine: ' + (j.machine || world.host),
          '  Conditions: ' + (j.condition || '-'),
          '  Last Start: ' + (j.lastStart ? W.isoStamp(j.lastStart) : '-----'),
          '  Last End:   ' + (j.lastEnd ? W.isoStamp(j.lastEnd) : '-----'),
          '  Run Num: ' + (j.runNum || 1) + '   Exit Code: ' + (j.exitCode == null ? '-' : j.exitCode),
          (j.note ? '  ' + W.amber(j.note) : '')].filter(Boolean).join('\n');
      }).join('\n');
    }

    var rows = [
      'Job Name                                  Last Start           Last End             ST Run/Ntry Pri/Xit',
      '_________________________________________ ____________________ ____________________ __ ________ _______'
    ];
    hits.forEach(function (j) {
      var st = j.status;
      var stColored = st === 'FA' || st === 'TE' ? W.red(st) : st === 'RU' ? W.amber(st) : st === 'SU' ? W.green(st) : st;
      rows.push(W.rpad(j.name, 41) + ' ' +
        W.rpad(j.lastStart ? W.isoStamp(j.lastStart) : '-----', 20) + ' ' +
        W.rpad(j.lastEnd ? W.isoStamp(j.lastEnd) : '-----', 20) + ' ' +
        W.vpad(stColored, 2, true) + ' ' + W.rpad((j.runNum || 1) + '/1', 8) + ' ' +
        W.lpad(j.exitCode == null ? '0' : String(j.exitCode), 7));
    });
    rows.push('');
    rows.push(W.dim('ST: SU=success  RU=running  FA=failure  TE=terminated  OI=on ice  AC=activated  ST=starting'));
    return rows.join('\n');
  }, { help: 'Autosys job report: autorep -J JOB_NAME [-d detail]' });

  reg('sendevent', function (argv, io, ctx) {
    var world = ctx.world;
    var a = sh.parseArgs(argv, { value: 'EJsq' });
    var event = a.vals.E, job = a.vals.J, status = a.vals.s;
    if (!event) return { err: 'sendevent: -E <EVENT> is required', code: 1 };

    var target = (world.jobs || []).filter(function (j) { return j.name === job; })[0];
    if (job && !target) return { err: 'CAUAJM_E_50029 Invalid job name: ' + job, code: 1 };

    if (typeof world.onSendevent === 'function') {
      var handled = world.onSendevent(world, event, target, status);
      if (handled) return handled === true ? 'CAUAJM_I_50323 Event placed in the event server.' : handled;
    }

    switch (event) {
      case 'CHANGE_STATUS':
        if (!status) return { err: 'sendevent: CHANGE_STATUS requires -s <STATUS>', code: 1 };
        target.status = { SUCCESS: 'SU', FAILURE: 'FA', TERMINATED: 'TE', INACTIVE: 'IN', RUNNING: 'RU' }[status] || status;
        target.lastEnd = new Date(world.clock.getTime());
        return 'CAUAJM_I_50323 Event placed in the event server.';
      case 'FORCE_STARTJOB':
      case 'STARTJOB':
        target.status = 'RU';
        target.lastStart = new Date(world.clock.getTime());
        return 'CAUAJM_I_50323 Event placed in the event server.';
      case 'KILLJOB':
        target.status = 'TE';
        return 'CAUAJM_I_50323 Event placed in the event server.';
      case 'JOB_ON_ICE':
        target.status = 'OI';
        return 'CAUAJM_I_50323 Event placed in the event server.';
      default:
        return { err: 'CAUAJM_E_50032 Invalid event: ' + event, code: 1 };
    }
  }, { help: 'Autosys event: sendevent -E CHANGE_STATUS -J JOB -s SUCCESS' });

  /* ---------- incident verbs ---------- */

  /* ---------- drill verbs (Basics track) ---------- */

  reg('task', function (argv, io, ctx) {
    var d = ctx.drill;
    if (!d) return { err: 'task: only available in a Basics drill', code: 1 };
    if (argv[1]) {
      var n = parseInt(argv[1], 10) - 1;
      if (isNaN(n) || !d.pack.tasks[n]) return { err: 'task: no task ' + argv[1], code: 1 };
      d.taskIdx = n;
      d.renderTasks();
      d.updateHud();
    }
    return d.showTask();
  }, { help: 'show the current drill question (task N to jump to one)' });
  sh.alias('q', 'task');

  reg('answer', function (argv, io, ctx) {
    var d = ctx.drill;
    if (!d) return { err: 'answer: only available in a Basics drill', code: 1 };
    return d.submit(argv.slice(1).join(' '));
  }, { help: 'submit an answer: answer 14' });
  sh.alias('a', 'answer');

  reg('solution', function (argv, io, ctx) {
    var d = ctx.drill;
    if (!d) return { err: 'solution: only available in a Basics drill', code: 1 };
    return d.showSolution();
  }, { help: 'be shown the command for this task (costs points)' });

  reg('skip', function (argv, io, ctx) {
    var d = ctx.drill;
    if (!d) return { err: 'skip: only available in a Basics drill', code: 1 };
    return d.skip();
  }, { help: 'move to the next drill task' });

  reg('tasks', function (argv, io, ctx) {
    var d = ctx.drill;
    if (!d) return sh.cmds.findings(['findings'], io, ctx);
    var out = [W.bold('Tasks')];
    d.pack.tasks.forEach(function (t, i) {
      var r = d.results[i];
      var mark = r.done ? W.green('[x]') : (i === d.taskIdx ? W.amber('[>]') : W.dim('[ ]'));
      out.push('  ' + mark + ' ' + (i + 1) + '. ' + (r.done ? t.short : W.dim(t.short)));
    });
    return out.join('\n');
  }, { help: 'list the drill tasks and progress' });

  reg('finish', function (argv, io, ctx) {
    var d = ctx.drill;
    if (!d) return { err: 'finish: only available in a Basics drill', code: 1 };
    d.finish();
    return '';
  }, { help: 'close the drill and see your command sheet' });

  /* ---------- incident verbs ---------- */

  reg('brief', function (argv, io, ctx) {
    var g = ctx.game;
    if (ctx.drill) {
      return W.bold('=== ' + ctx.drill.pack.title + ' ===') + '\n' +
        W.dim('Topic:   ') + ctx.drill.pack.topic + '\n' +
        W.dim('Host:    ') + ctx.drill.pack.host + '\n\n' +
        ctx.drill.pack.brief;
    }
    if (!g || !g.scenario) return '';
    var s = g.scenario;
    return [
      W.bold('=== ' + s.severity + ' ' + s.title + ' ==='),
      W.dim('Desk:    ') + s.desk,
      W.dim('Host:    ') + s.host,
      W.dim('Raised:  ') + W.isoStamp(g.world.startClock),
      '',
      s.brief,
      '',
      W.dim('Findings so far: ') + g.found.length + '/' + s.discoveries.length +
        W.dim('   Type ') + W.green('findings') + W.dim(' to review, ') +
        W.green('diagnose') + W.dim(' when ready.')
    ].join('\n');
  }, { help: 'reread the incident brief' });

  reg('findings', function (argv, io, ctx) {
    var g = ctx.game;
    if (!g || !g.scenario) return '';
    var out = [W.bold('Findings')];
    g.scenario.discoveries.forEach(function (d) {
      var got = g.found.indexOf(d.id) >= 0;
      out.push('  ' + (got ? W.green('[x] ') + d.label : W.dim('[ ] ' + (d.hidden ? '(undiscovered)' : d.label))));
    });
    return out.join('\n');
  }, { help: 'list what you have established so far' });

  reg('diagnose', function (argv, io, ctx) {
    var g = ctx.game;
    if (!g || !g.scenario) return '';
    var causes = g.scenario.rootCauses;
    var pick = argv[1];

    if (!pick) {
      var out = [W.bold('Root cause - what is actually wrong?'), ''];
      causes.forEach(function (c, i) {
        out.push('  ' + W.amber(String(i + 1) + ')') + ' ' + c.text);
      });
      out.push('');
      out.push(W.dim('Submit with: ') + W.green('diagnose <number>') +
        W.dim('   A wrong call costs you ' + g.WRONG_DIAGNOSIS_COST + ' points and time.'));
      return out.join('\n');
    }

    var idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || !causes[idx]) return { err: 'diagnose: pick a number from the list (just type: diagnose)', code: 1 };
    return g.submitDiagnosis(idx);
  }, { help: 'state the root cause: diagnose, then diagnose <n>' });

  reg('hint', function (argv, io, ctx) {
    if (ctx.drill) return ctx.drill.takeHint();
    var g = ctx.game;
    if (!g || !g.scenario) return '';
    return g.takeHint();
  }, { help: 'ask for a nudge (costs points)' });

  reg('escalate', function (argv, io, ctx) {
    var g = ctx.game;
    if (!g) return '';
    return W.amber('You dial the escalation bridge.') + '\n' +
      W.dim('L3 asks: "What have you actually established?" - ') +
      'they will not take the call until you can name the root cause.\n' +
      W.dim('(Type ') + W.green('diagnose') + W.dim(' to see the candidate causes.)');
  }, { help: 'escalate to L3' });

  reg('exit', function (argv, io, ctx) {
    return W.dim('You cannot log out mid-incident. Use STAND DOWN in the header to abandon it.');
  }, { help: 'leave the session' });
  sh.alias('logout', 'exit');

  PS.opsLoaded = true;
})(PS);
