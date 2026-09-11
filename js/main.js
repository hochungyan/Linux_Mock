/* main.js - boot screen, scenario picker, wiring. */
(function (PS) {
  'use strict';

  var STORE_KEY = 'sev1.results.v1';

  PS.loadResults = function () {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  };

  PS.saveResult = function (id, score, seconds) {
    try {
      var all = PS.loadResults();
      var prev = all[id];
      if (!prev || score > prev.score) all[id] = { score: score, seconds: seconds };
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) { /* private window, or storage disabled - not worth failing over */ }
    PS.renderScenarioList();
  };

  /* One card renderer for both tracks - they differ only in the chip and the
   * subtitle. */
  function renderCards(hostId, items, opts) {
    var host = document.getElementById(hostId);
    if (!host) return;
    var results = PS.loadResults();
    host.innerHTML = '';

    items.forEach(function (s) {
      var chip = opts.chip(s);
      var card = document.createElement('button');
      card.className = 'sc-card ' + chip.cls;
      var r = results[s.id];

      var head = document.createElement('div');
      head.className = 'sc-head';
      head.innerHTML =
        '<span class="sc-sev ' + chip.cls + '">' + esc(chip.label) + '</span>' +
        '<span class="sc-name">' + esc(s.title) + '</span>' +
        (r ? '<span class="sc-done">best ' + r.score + '</span>' : '');
      card.appendChild(head);

      var sub = document.createElement('div');
      sub.className = 'sc-desk';
      sub.textContent = opts.sub(s);
      card.appendChild(sub);

      var tags = document.createElement('div');
      tags.className = 'sc-tags';
      (s.tags || []).forEach(function (t) {
        var el = document.createElement('span');
        el.className = 'sc-tag';
        el.textContent = t;
        tags.appendChild(el);
      });
      card.appendChild(tags);

      card.onclick = function () { opts.start(s); };
      host.appendChild(card);
    });
  }

  PS.renderScenarioList = function () {
    renderCards('drill-list', PS.drills || [], {
      chip: function () { return { cls: 'basics', label: 'BASICS' }; },
      sub: function (d) { return d.topic + '  ·  ' + d.tasks.length + ' questions'; },
      start: function (d) { PS.startDrill(d); }
    });

    renderCards('scenario-list', PS.scenarios || [], {
      chip: function (s) { return { cls: s.severity === 'P1' ? 'p1' : 'p2', label: s.severity }; },
      sub: function (s) { return s.desk + '  ·  ' + s.host; },
      start: function (s) { PS.startScenario(s); }
    });
  };

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* PS.active is whichever runner owns the terminal right now. */
  PS.startScenario = function (scenario) {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('impact-label').textContent = 'IMPACT';
    document.getElementById('impact').classList.add('bad');
    document.getElementById('brief-title').textContent = 'Pager';
    document.getElementById('list-title').textContent = 'Findings';
    document.getElementById('help-title').textContent = 'Escalation';
    document.getElementById('panel-note').innerHTML =
      'Type <code>diagnose</code> when you know the root cause. Then fix it for real.';
    PS.active = PS.game;
    PS.game.start(scenario);
  };

  PS.startDrill = function (pack) {
    document.getElementById('modal').classList.add('hidden');
    PS.active = PS.drill;
    PS.drill.start(pack);
  };

  document.addEventListener('DOMContentLoaded', function () {
    var term = new PS.Terminal({
      getWorld: function () { return PS.active ? PS.active.world : null; },
      onCommand: function (line) { if (PS.active) PS.active.run(line); }
    });
    PS.game = new PS.Game(term);
    PS.drill = new PS.Drill(term);
    PS.active = PS.game;

    var toasts = document.createElement('div');
    toasts.id = 'toasts';
    document.body.appendChild(toasts);

    document.getElementById('btn-quit').onclick = function () {
      var a = PS.active;
      if (a.finished || window.confirm('Leave this and go back to the list?')) a.abandon();
    };

    document.getElementById('modal-close').onclick = function () {
      document.getElementById('modal').classList.add('hidden');
      PS.active.abandon();
    };

    PS.renderScenarioList();
    if (PS.interview) PS.interview.init();
    var tracks = ['basics', 'incidents', 'interview'];
    tracks.forEach(function (id) {
      document.getElementById('tab-' + id).onclick = function () {
        tracks.forEach(function (other) {
          var selected = id === other;
          document.getElementById('track-' + other).classList.toggle('hidden', !selected);
          document.getElementById('tab-' + other).classList.toggle('selected', selected);
          document.getElementById('tab-' + other).setAttribute('aria-pressed', String(selected));
        });
      };
    });
    document.getElementById('coverage-count').textContent =
      PS.drills.reduce(function (n, p) { return n + p.tasks.length; }, 0) + ' practical questions · ' +
      PS.scenarios.length + ' incidents · ' + PS.interview.questions.length + ' interview questions';
  });
})(PS);
