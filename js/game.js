/* game.js - incident runner: clock, scoring, findings detection, diagnosis,
 * and the win condition.
 *
 * The win condition is deliberately state-based rather than text-based: the
 * scenario asks "is the world actually healed?", so any legitimate route to
 * that state counts, and the grade() hook then judges how much collateral
 * damage the route caused.
 */
(function (PS) {
  'use strict';

  var W = PS.world, V = PS.vfs;

  var BASE_SCORE = 1000;
  var HINT_COSTS = [75, 125, 175, 200];

  function Game(term) {
    this.term = term;
    this.scenario = null;
    this.world = null;
    this.history = [];
    this.found = [];
    this.hintsUsed = 0;
    this.wrongDiagnoses = 0;
    this.elapsed = 0;
    this.diagnosed = false;
    this.finished = false;
    this.WRONG_DIAGNOSIS_COST = 150;
    this.timer = null;
  }

  Game.prototype.start = function (scenario) {
    this.scenario = scenario;
    this.world = scenario.build();
    this.history = [];
    this.found = [];
    this.hintsUsed = 0;
    this.wrongDiagnoses = 0;
    this.elapsed = 0;
    this.diagnosed = false;
    this.finished = false;

    this.ctx = { world: this.world, shell: PS.shell, game: this, lastCode: 0 };

    document.getElementById('game').classList.remove('hidden');
    document.getElementById('boot').classList.add('hidden');

    var sevEl = document.getElementById('sev');
    sevEl.textContent = scenario.severity;
    sevEl.className = 'sev' + (scenario.severity === 'P2' ? ' p2' : '');
    document.getElementById('inc-title').textContent = scenario.title;
    document.getElementById('inc-desk').textContent = scenario.desk + '  ·  ' + scenario.host;

    this.renderBrief();
    this.renderFindings();
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
      var text = self.takeHint();
      self.term.write('');
      self.term.write(text);
      self.term.focus();
    };
  };

  Game.prototype.banner = function () {
    var s = this.scenario, w = this.world;
    this.term.write(W.dim('Last login: ' + W.dateStr(W.offset(w.clock, -86400)) + ' from 10.14.22.71'));
    this.term.write('');
    this.term.write(W.red('*** ' + s.severity + ' INCIDENT - ' + s.title + ' ***'));
    this.term.write(W.dim('You are ') + W.white(w.user) + W.dim(' on ') + W.white(w.host) +
      W.dim('.  ' + s.desk));
    this.term.write('');
    this.term.write(W.dim('The pager text is in the panel on the right. Type ') + W.green('brief') +
      W.dim(' to reread it,'));
    this.term.write(W.dim('') + W.green('help') + W.dim(' for the commands on this host, ') +
      W.green('hint') + W.dim(' if you get stuck.'));
    this.term.write('');
  };

  Game.prototype.renderBrief = function () {
    var el = document.getElementById('brief');
    el.textContent = this.scenario.brief;
  };

  Game.prototype.renderFindings = function () {
    var ul = document.getElementById('findings');
    ul.innerHTML = '';
    var self = this;
    var required = this.scenario.discoveries.filter(function (d) { return !d.optional; });
    // Undiscovered findings stay redacted - naming them would hand over the
    // answer. The count is the only progress signal you get.
    this.scenario.discoveries.forEach(function (d, i) {
      var li = document.createElement('li');
      var got = self.found.indexOf(d.id) >= 0;
      li.className = got ? 'got' : '';
      li.textContent = got ? d.label
        : (d.optional ? 'optional — not established' : 'not established yet');
      ul.appendChild(li);
    });
    var gotRequired = required.filter(function (d) { return self.found.indexOf(d.id) >= 0; }).length;
    document.getElementById('find-count').textContent = gotRequired + '/' + required.length;
  };

  Game.prototype.updateHud = function () {
    document.getElementById('clock').textContent = W.mmss(this.elapsed);
    var impact = Math.round(this.scenario.impactPerMin * (this.elapsed / 60));
    document.getElementById('impact').textContent =
      (this.scenario.currency === 'GBP' ? '£' : '$') + W.comma(impact);
    document.getElementById('score').textContent = W.comma(Math.max(0, this.currentScore()));
    var nextCost = HINT_COSTS[Math.min(this.hintsUsed, HINT_COSTS.length - 1)];
    document.getElementById('hint-cost').textContent = '(-' + nextCost + ')';
  };

  Game.prototype.currentScore = function () {
    var s = this.scenario;
    var score = BASE_SCORE;
    score += this.found.length * 60;
    score -= this.hintsUsed ? HINT_COSTS.slice(0, this.hintsUsed).reduce(function (a, b) { return a + b; }, 0) : 0;
    score -= this.wrongDiagnoses * this.WRONG_DIAGNOSIS_COST;
    var over = Math.max(0, this.elapsed - s.par);
    score -= Math.round(over * 1.5);
    return Math.round(score);
  };

  Game.prototype.tick = function () {
    if (this.finished) return;
    this.elapsed += 1;
    W.advance(this.world, 1);
    this.updateHud();
    if (this.term.app && this.term.app.type === 'screen') this.term.paint();
  };

  /* ---------- command execution ---------- */

  Game.prototype.run = function (line) {
    if (this.finished || !line.trim()) return;
    this.history.push(line);

    // Touching a hung hard mount does not return. It is the most honest way to
    // teach what D state feels like from the keyboard.
    var hung = this.hungTarget(line);
    if (hung) {
      this.term.startApp({
        type: 'hang',
        label: line,
        note: 'The command was stuck in an uninterruptible read on ' + hung +
          '. Nothing you type will make it return while that mount is dead.'
      });
      return;
    }

    var result = PS.shell.run(line, this.ctx);

    if (result.out) this.term.write(result.out);
    if (result.err) this.term.write(result.err, 'err');
    if (/^\s*clear\s*$/.test(line)) this.term.clear();

    this.ctx.lastCode = result.code;

    var plain = W.stripColor((result.out || '') + '\n' + (result.err || ''));
    this.trackEvidence(line, plain);
    this.checkDiscoveries(line, plain, result.code);
    this.checkFix();

    if (result.app) this.term.startApp(result.app);
  };

  Game.prototype.hungTarget = function (line) {
    var hung = this.world.hungPaths;
    if (!hung || !hung.length) return null;
    var words = line.trim().split(/\s+/).slice(1);
    for (var i = 0; i < words.length; i++) {
      if (words[i].charAt(0) === '-') continue;
      var abs;
      try { abs = V.resolve(words[i], this.world.cwd, this.world.home); } catch (e) { continue; }
      for (var j = 0; j < hung.length; j++) {
        if (abs === hung[j] || abs.indexOf(hung[j] + '/') === 0) return hung[j];
      }
    }
    return null;
  };

  /* Generic evidence flags several scenarios grade on. */
  Game.prototype.trackEvidence = function (cmd, out) {
    var f = this.world.flags;
    if (/\b(jstack|jcmd)\b/.test(cmd) && /Full thread dump/.test(out)) f.dumpTaken = true;
    if (/\bkill\s+-(3|SIGQUIT)\b/.test(cmd)) f.dumpTaken = true;
    if (/\bjmap\b/.test(cmd) && /-dump/.test(cmd) && /Heap dump file created/.test(out)) f.heapDumped = true;
  };

  Game.prototype.checkDiscoveries = function (cmd, out, code) {
    var self = this;
    var info = { cmd: cmd, out: out, code: code, world: this.world };
    this.scenario.discoveries.forEach(function (d) {
      if (self.found.indexOf(d.id) >= 0) return;
      var hit = false;
      try { hit = !!d.when(info); } catch (e) { hit = false; }
      if (!hit) return;
      self.found.push(d.id);
      self.toast('FINDING  ' + d.label);
      self.renderFindings();
      self.updateHud();
    });
  };

  Game.prototype.checkFix = function () {
    if (this.finished) return;
    var fix = this.scenario.fix;
    if (!fix || !fix.check(this.world)) return;
    this.finish(true);
  };

  /* ---------- player verbs ---------- */

  Game.prototype.takeHint = function () {
    var hints = this.scenario.hints || [];
    if (this.hintsUsed >= hints.length) {
      return W.amber('The senior has nothing else for you - everything you need is on the box.');
    }
    var cost = HINT_COSTS[Math.min(this.hintsUsed, HINT_COSTS.length - 1)];
    var text = hints[this.hintsUsed];
    this.hintsUsed++;
    this.updateHud();
    this.toast('Hint taken (-' + cost + ')', 'warn');
    return W.amber('SENIOR ON THE DESK:  ') + text;
  };

  Game.prototype.submitDiagnosis = function (idx) {
    var causes = this.scenario.rootCauses;
    var chosen = causes[idx];
    if (chosen.correct) {
      this.diagnosed = true;
      this.toast('Root cause confirmed');
      var lines = [
        '',
        W.green('ROOT CAUSE ACCEPTED.'),
        W.dim('  ') + chosen.text,
        ''
      ];
      if (this.scenario.fix && !this.scenario.fix.check(this.world)) {
        lines.push(W.white('Now fix it.'));
        lines.push(W.dim(this.scenario.fix.prompt));
        lines.push('');
      }
      return lines.join('\n');
    }
    this.wrongDiagnoses++;
    this.updateHud();
    this.toast('Wrong call (-' + this.WRONG_DIAGNOSIS_COST + ')', 'bad');
    return '\n' + W.red('That does not hold up.') + '\n' +
      W.dim('L3 pushes back: "What have you got that actually supports that?"') + '\n' +
      W.dim('(-' + this.WRONG_DIAGNOSIS_COST + ' points. Keep digging - findings are worth more than guesses.)') + '\n';
  };

  /* ---------- end of incident ---------- */

  Game.prototype.finish = function (resolved) {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.term.stopApp();

    var s = this.scenario;
    var grade = (s.fix && s.fix.grade) ? s.fix.grade(this.world) : { quality: 'other', bonus: 0, note: '' };

    var breakdown = [];
    breakdown.push(['Base', BASE_SCORE]);
    breakdown.push(['Findings established (' + this.found.length + ')', this.found.length * 60]);
    if (this.diagnosed) breakdown.push(['Root cause correctly stated', 200]);
    else breakdown.push(['Fixed without stating a root cause', -100]);
    if (grade.bonus) breakdown.push([grade.quality === 'clean' ? 'Clean remediation' : 'Collateral damage', grade.bonus]);
    if (this.hintsUsed) {
      breakdown.push(['Hints taken (' + this.hintsUsed + ')',
        -HINT_COSTS.slice(0, this.hintsUsed).reduce(function (a, b) { return a + b; }, 0)]);
    }
    if (this.wrongDiagnoses) breakdown.push(['Wrong diagnoses (' + this.wrongDiagnoses + ')', -this.wrongDiagnoses * this.WRONG_DIAGNOSIS_COST]);
    var over = Math.max(0, this.elapsed - s.par);
    if (over) breakdown.push(['Over par by ' + W.mmss(over), -Math.round(over * 1.5)]);
    else breakdown.push(['Inside par (' + W.mmss(s.par) + ')', 120]);

    var total = breakdown.reduce(function (a, b) { return a + b[1]; }, 0);
    total = Math.max(0, total);

    var missed = s.discoveries.filter(function (d) {
      return !d.optional && this.found.indexOf(d.id) < 0;
    }, this);

    this.term.write('');
    this.term.write(W.green('=== INCIDENT RESOLVED ==='));
    this.term.write('');

    this.showModal({
      title: 'Incident resolved - ' + s.title,
      win: true,
      grade: grade,
      breakdown: breakdown,
      total: total,
      missed: missed,
      elapsed: this.elapsed
    });

    PS.saveResult(s.id, total, this.elapsed);
  };

  Game.prototype.abandon = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.finished = true;
    this.term.stopApp();
    document.getElementById('game').classList.add('hidden');
    document.getElementById('boot').classList.remove('hidden');
    PS.renderScenarioList();
  };

  Game.prototype.showModal = function (o) {
    var s = this.scenario;
    var body = [];
    var esc = function (t) {
      return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    body.push('<div style="color:var(--dim)">Time to resolution ' + W.mmss(o.elapsed) +
      '  ·  par ' + W.mmss(s.par) +
      '  ·  estimated impact ' + (s.currency === 'GBP' ? '£' : '$') +
      W.comma(s.impactPerMin * (o.elapsed / 60)) + '</div>');

    if (o.grade && o.grade.note) {
      body.push('<div class="debrief-h">HOW YOU FIXED IT</div>');
      body.push('<div style="color:' + (o.grade.quality === 'clean' ? 'var(--green)' : 'var(--amber)') + '">' +
        esc(o.grade.note) + '</div>');
    }

    body.push('<div class="debrief-h">SCORE</div>');
    o.breakdown.forEach(function (b) {
      body.push('<div class="scoreline"><span>' + esc(b[0]) + '</span><span class="v" style="color:' +
        (b[1] < 0 ? 'var(--red)' : 'var(--fg)') + '">' + (b[1] > 0 ? '+' : '') + b[1] + '</span></div>');
    });
    body.push('<div class="scoreline total"><span>TOTAL</span><span class="v">' + o.total + '</span></div>');

    if (o.missed && o.missed.length) {
      body.push('<div class="debrief-h">YOU NEVER ESTABLISHED</div>');
      o.missed.forEach(function (d) {
        body.push('<div style="color:var(--amber)">·  ' + esc(d.label) + '</div>');
      });
    }

    body.push('<div class="debrief-h">DEBRIEF</div>');
    body.push('<div>' + esc(s.debrief) + '</div>');
    if (s.sources && s.sources.length) {
      body.push('<div class="debrief-h">PRIMARY REFERENCES</div>');
      s.sources.forEach(function (source) {
        if (!/^https:\/\//.test(source.url)) return;
        var url = esc(source.url).replace(/"/g, '&quot;');
        body.push('<div><a href="' + url + '" target="_blank" rel="noopener noreferrer">' + esc(source.title) + '</a></div>');
      });
    }

    document.getElementById('modal-title').textContent = o.title;
    document.getElementById('modal-title').className = o.win ? 'win' : 'lose';
    document.getElementById('modal-body').innerHTML = body.join('');
    document.getElementById('modal').classList.remove('hidden');
  };

  Game.prototype.toast = function (text, kind) {
    var host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }, 3200);
  };

  PS.Game = Game;
})(PS);
