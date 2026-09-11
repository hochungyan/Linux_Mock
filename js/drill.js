/* drill.js - the Basics track.
 *
 * An incident asks "what is wrong and how do you fix it". A drill asks a much
 * smaller question: "how many ESTABLISHED connections are there?" You answer it
 * by running a command on the same simulated box and typing what you found.
 *
 * The payoff is the bit after you answer: the canonical command, and one line
 * explaining the thing people usually get wrong about it.
 */
(function (PS) {
  'use strict';

  var W = PS.world;

  var BASE = 100;            // per task
  var WRONG_COST = 15;
  var HINT_COST = 30;
  var SOLUTION_COST = 60;

  function norm(s) {
    return String(s == null ? '' : s)
      .trim().toLowerCase()
      .replace(/,/g, '')
      .replace(/^["']|["']$/g, '')
      .replace(/[.\s]+$/, '');
  }

  function Drill(term) {
    this.term = term;
    this.pack = null;
    this.world = null;
    this.history = [];
    this.results = [];
    this.taskIdx = 0;
    this.elapsed = 0;
    this.finished = false;
    this.timer = null;
  }

  Drill.prototype.start = function (pack) {
    this.pack = pack;
    this.world = pack.build();
    this.history = [];
    this.results = pack.tasks.map(function () {
      return { done: false, wrong: 0, hinted: false, solved: false };
    });
    this.taskIdx = 0;
    this.elapsed = 0;
    this.finished = false;

    this.ctx = { world: this.world, shell: PS.shell, game: this, drill: this, lastCode: 0 };

    document.getElementById('game').classList.remove('hidden');
    document.getElementById('boot').classList.add('hidden');

    var sevEl = document.getElementById('sev');
    sevEl.textContent = 'BASICS';
    sevEl.className = 'sev basics';
    document.getElementById('inc-title').textContent = pack.title;
    document.getElementById('inc-desk').textContent = pack.topic + '  ·  ' + pack.host;

    document.getElementById('brief-title').textContent = 'Drill';
    document.getElementById('list-title').textContent = 'Tasks';
    document.getElementById('help-title').textContent = 'Stuck?';
    document.getElementById('panel-note').innerHTML =
      'Type <code>task</code> to see the question, <code>answer &lt;value&gt;</code> to submit, ' +
      '<code>solution</code> to be shown the command (costs more than a hint).';
    document.getElementById('impact-label').textContent = 'TASK';
    document.getElementById('impact').classList.remove('bad');

    document.getElementById('brief').textContent = pack.brief;

    this.renderTasks();
    this.updateHud();

    this.term.clear();
    this.term.history = [];
    this.banner();
    this.term.refreshPrompt();
    this.term.focus();

    var self = this;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(function () { self.tick(); }, 1000);

    var hintBtn = document.getElementById('btn-hint');
    hintBtn.disabled = false;
    hintBtn.onclick = function () {
      self.term.write('');
      self.term.write(self.takeHint());
      self.term.focus();
    };
  };

  Drill.prototype.banner = function () {
    var p = this.pack, w = this.world;
    this.term.write(W.dim('Last login: ' + W.dateStr(W.offset(w.clock, -86400)) + ' from 10.14.22.71'));
    this.term.write('');
    this.term.write(W.green('=== BASICS: ' + p.title + ' ==='));
    this.term.write(W.dim('You are ') + W.white(w.user) + W.dim(' on ') + W.white(w.host) + W.dim('.'));
    this.term.write('');
    this.term.write(W.dim(p.brief));
    this.term.write('');
    this.term.write(W.dim('There is nothing broken here. Work through ') +
      W.white(p.tasks.length + ' questions') + W.dim(', one at a time.'));
    this.term.write(W.dim('  ') + W.green('task') + W.dim('            show the current question'));
    this.term.write(W.dim('  ') + W.green('answer <value>') + W.dim('  submit your answer'));
    this.term.write(W.dim('  ') + W.green('hint') + W.dim('            a nudge (-' + HINT_COST + ')   ') +
      W.green('solution') + W.dim('  give up and be shown (-' + SOLUTION_COST + ')'));
    this.term.write(W.dim('  ') + W.green('skip') + W.dim('            move on, come back later'));
    this.term.write('');
    this.showTask();
  };

  Drill.prototype.currentTask = function () {
    return this.pack.tasks[this.taskIdx] || null;
  };

  Drill.prototype.showTask = function () {
    var t = this.currentTask();
    if (!t) return '';
    var lines = [
      W.amber('TASK ' + (this.taskIdx + 1) + ' of ' + this.pack.tasks.length),
      W.white('  ' + t.ask)
    ];
    if (t.note) lines.push(W.dim('  ' + t.note));
    lines.push('');
    lines.push(W.dim('  Answer with: ') + W.green('answer <your value>'));
    var text = lines.join('\n');
    this.term.write(text);
    return '';
  };

  /* ---------- answering ---------- */

  Drill.prototype.submit = function (raw) {
    var t = this.currentTask();
    if (!t) return W.dim('All tasks done - type ') + W.green('finish') + W.dim(' to close the drill.');
    if (raw == null || !String(raw).trim()) {
      return { err: 'answer: give a value, e.g. answer 14', code: 1 };
    }

    var r = this.results[this.taskIdx];
    var ok;
    if (typeof t.accept === 'function') {
      ok = !!t.accept(String(raw).trim(), this.world, norm);
    } else {
      var want = t.answers || [t.answer];
      var got = norm(raw);
      ok = want.some(function (a) { return norm(a) === got; });
    }

    if (!ok) {
      r.wrong++;
      this.updateHud();
      var msg = [W.red('  Not that.')];
      if (r.wrong === 2 && t.hint) msg.push(W.dim('  Try ') + W.green('hint') + W.dim(' - it is only -' + HINT_COST + '.'));
      msg.push(W.dim('  (-' + WRONG_COST + ')'));
      return '\n' + msg.join('\n') + '\n';
    }

    r.done = true;
    this.renderTasks();
    this.updateHud();
    this.toast('Correct  ' + (this.doneCount()) + '/' + this.pack.tasks.length);

    var out = ['', W.green('  Correct.')];
    if (t.solution) out.push(W.dim('  The command: ') + W.cyan(t.solution));
    if (t.teaches) out.push(W.dim('  ') + t.teaches);
    out.push('');

    var next = this.advance();
    if (next) out.push(next);
    else out.push(this.completeMessage());
    return out.join('\n');
  };

  /* Move to the next unanswered task, wrapping round. */
  Drill.prototype.advance = function () {
    var n = this.pack.tasks.length;
    for (var step = 1; step <= n; step++) {
      var i = (this.taskIdx + step) % n;
      if (!this.results[i].done) {
        this.taskIdx = i;
        this.updateHud();
        var t = this.pack.tasks[i];
        var lines = [
          W.amber('TASK ' + (i + 1) + ' of ' + n),
          W.white('  ' + t.ask)
        ];
        if (t.note) lines.push(W.dim('  ' + t.note));
        return lines.join('\n');
      }
    }
    return null;
  };

  Drill.prototype.skip = function () {
    var n = this.pack.tasks.length;
    if (this.doneCount() === n) return W.dim('Nothing left to skip.');
    var moved = this.advance();
    return moved ? '\n' + W.dim('Skipped.') + '\n' + moved : '';
  };

  Drill.prototype.takeHint = function () {
    var t = this.currentTask();
    if (!t) return W.dim('No task selected.');
    var r = this.results[this.taskIdx];
    if (!t.hint) return W.dim('No hint for this one.');
    if (!r.hinted) { r.hinted = true; this.updateHud(); this.toast('Hint (-' + HINT_COST + ')', 'warn'); }
    return W.amber('HINT:  ') + t.hint;
  };

  Drill.prototype.showSolution = function () {
    var t = this.currentTask();
    if (!t) return W.dim('No task selected.');
    var r = this.results[this.taskIdx];
    if (!r.done && !r.solved) {
      r.solved = true;
      this.toast('Solution shown (-' + SOLUTION_COST + ')', 'warn');
    }
    var out = ['', W.cyan('  ' + (t.solution || '(no command given)'))];
    if (t.teaches) out.push(W.dim('  ' + t.teaches));
    out.push(W.dim('  Run it, then type ') + W.green('answer <value>') + W.dim(' with what you see.'));
    out.push('');
    this.updateHud();
    return out.join('\n');
  };

  /* ---------- state ---------- */

  Drill.prototype.doneCount = function () {
    return this.results.filter(function (r) { return r.done; }).length;
  };

  Drill.prototype.currentScore = function () {
    var self = this;
    var score = 0;
    this.results.forEach(function (r) {
      if (!r.done) return;
      var v = BASE;
      v -= r.wrong * WRONG_COST;
      if (r.hinted) v -= HINT_COST;
      if (r.solved) v -= SOLUTION_COST;
      score += Math.max(10, v);
    });
    // penalties for unfinished tasks you burned help on
    this.results.forEach(function (r) {
      if (r.done) return;
      if (r.hinted) score -= HINT_COST;
      if (r.solved) score -= SOLUTION_COST;
      score -= r.wrong * WRONG_COST;
    });
    return Math.max(0, Math.round(score));
  };

  Drill.prototype.updateHud = function () {
    document.getElementById('clock').textContent = W.mmss(this.elapsed);
    document.getElementById('impact').textContent = this.doneCount() + '/' + this.pack.tasks.length;
    document.getElementById('score').textContent = W.comma(this.currentScore());
    document.getElementById('hint-cost').textContent = '(-' + HINT_COST + ')';
  };

  Drill.prototype.renderTasks = function () {
    var ul = document.getElementById('findings');
    ul.innerHTML = '';
    var self = this;
    this.pack.tasks.forEach(function (t, i) {
      var li = document.createElement('li');
      var r = self.results[i];
      li.className = r.done ? 'got' : (i === self.taskIdx ? 'current' : '');
      li.textContent = (i + 1) + '. ' + t.short;
      ul.appendChild(li);
    });
    document.getElementById('find-count').textContent =
      this.doneCount() + '/' + this.pack.tasks.length;
  };

  Drill.prototype.tick = function () {
    if (this.finished) return;
    this.elapsed += 1;
    W.advance(this.world, 1);
    this.updateHud();
    if (this.term.app && this.term.app.type === 'screen') this.term.paint();
  };

  Drill.prototype.run = function (line) {
    if (this.finished || !line.trim()) return;
    this.history.push(line);
    var result = PS.shell.run(line, this.ctx);
    if (result.out) this.term.write(result.out);
    if (result.err) this.term.write(result.err, 'err');
    if (/^\s*clear\s*$/.test(line)) this.term.clear();
    this.ctx.lastCode = result.code;
    this.renderTasks();
    if (result.app) this.term.startApp(result.app);
  };

  /* ---------- completion ---------- */

  Drill.prototype.completeMessage = function () {
    var self = this;
    setTimeout(function () { self.finish(); }, 60);
    return W.green('  All ' + this.pack.tasks.length + ' tasks done.');
  };

  Drill.prototype.finish = function () {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.term.stopApp();

    var p = this.pack, self = this;
    var esc = function (t) {
      return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    var clean = this.results.filter(function (r) { return r.done && !r.wrong && !r.hinted && !r.solved; }).length;
    var body = [];
    body.push('<div style="color:var(--dim)">' + this.doneCount() + ' of ' + p.tasks.length +
      ' answered  ·  ' + clean + ' first time, unaided  ·  ' + W.mmss(this.elapsed) + '</div>');

    body.push('<div class="debrief-h">WHAT YOU ANSWERED</div>');
    p.tasks.forEach(function (t, i) {
      var r = self.results[i];
      var mark = r.done ? (r.wrong || r.hinted || r.solved ? '<span style="color:var(--amber)">~</span>'
        : '<span style="color:var(--green)">✓</span>') : '<span style="color:var(--red)">×</span>';
      var tail = [];
      if (r.wrong) tail.push(r.wrong + ' wrong');
      if (r.hinted) tail.push('hint');
      if (r.solved) tail.push('shown');
      body.push('<div class="scoreline"><span>' + mark + ' ' + esc(t.short) + '</span>' +
        '<span class="v" style="color:var(--dim)">' + (tail.join(', ') || '') + '</span></div>');
    });

    body.push('<div class="debrief-h">COMMAND SHEET</div>');
    body.push('<div style="color:var(--dim)">Everything this drill covered, in one place.</div>');
    p.tasks.forEach(function (t) {
      if (!t.solution) return;
      body.push('<div style="margin-top:7px"><span style="color:var(--cyan)">' + esc(t.solution) + '</span>' +
        '<br><span style="color:var(--dim)">' + esc(t.teaches || '') + '</span></div>');
    });

    if (p.wrapUp) {
      body.push('<div class="debrief-h">WORTH REMEMBERING</div>');
      body.push('<div>' + esc(p.wrapUp) + '</div>');
    }

    body.push('<div class="scoreline total"><span>SCORE</span><span class="v">' +
      this.currentScore() + '</span></div>');

    document.getElementById('modal-title').textContent = 'Drill complete - ' + p.title;
    document.getElementById('modal-title').className = 'win';
    document.getElementById('modal-body').innerHTML = body.join('');
    document.getElementById('modal').classList.remove('hidden');

    this.term.write('');
    this.term.write(W.green('=== DRILL COMPLETE ==='));

    PS.saveResult(p.id, this.currentScore(), this.elapsed);
  };

  Drill.prototype.abandon = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.finished = true;
    this.term.stopApp();
    document.getElementById('game').classList.add('hidden');
    document.getElementById('boot').classList.remove('hidden');
    document.getElementById('impact-label').textContent = 'IMPACT';
    document.getElementById('impact').classList.add('bad');
    PS.renderScenarioList();
  };

  Drill.prototype.toast = PS.Game.prototype.toast;

  PS.Drill = Drill;
})(PS);
