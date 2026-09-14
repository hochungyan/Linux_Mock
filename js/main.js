/* main.js - boot screen, scenario picker, wiring. */
(function (PS) {
  'use strict';

  var STORE_KEY = 'sev1.results.v1';
  var tracks = ['basics', 'incidents', 'fix', 'interview'];
  var selectedTrack = 'incidents';
  var returnLabels = {
    basics: 'BACK TO TERMINAL DRILLS',
    incidents: 'BACK TO INCIDENT LIST',
    fix: 'BACK TO FIX INCIDENTS',
    interview: 'BACK TO INTERVIEW PRACTICE'
  };

  function selectTrack(id) {
    selectedTrack = id;
    tracks.forEach(function (other) {
      var selected = id === other;
      var panel = document.getElementById('track-' + other);
      var tab = document.getElementById('tab-' + other);
      if (panel) panel.classList.toggle('hidden', !selected);
      if (tab) {
        tab.classList.toggle('selected', selected);
        tab.setAttribute('aria-pressed', String(selected));
        tab.setAttribute('aria-controls', 'track-' + other);
      }
    });
    document.getElementById('modal-close').textContent = returnLabels[id];
    document.getElementById('btn-quit').title = returnLabels[id].toLowerCase();
  }

  function returnToList() {
    document.getElementById('modal').classList.add('hidden');
    PS.active.abandon();
    var tab = document.getElementById('tab-' + selectedTrack);
    if (tab) tab.focus();
  }

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

  /* One card renderer for all playable tracks - they differ only in the chip and the
   * subtitle. */
  function renderCards(hostId, items, opts) {
    var host = document.getElementById(hostId);
    if (!host) return;
    var results = PS.loadResults();
    host.innerHTML = '';

    items.forEach(function (s) {
      var chip = opts.chip(s);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'sc-card ' + chip.cls;
      card.setAttribute('data-id', s.id);
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
    var scenarios = PS.scenarios || [];
    var general = scenarios.filter(function (s) { return s.track !== 'fix'; });
    var fix = scenarios.filter(function (s) { return s.track === 'fix'; });
    renderCards('drill-list', PS.drills || [], {
      chip: function () { return { cls: 'basics', label: 'BASICS' }; },
      sub: function (d) { return d.topic + '  ·  ' + d.tasks.length + ' questions'; },
      start: function (d) { PS.startDrill(d); }
    });

    var scenarioOptions = {
      chip: function (s) { return { cls: s.severity === 'P1' ? 'p1' : 'p2', label: s.severity }; },
      sub: function (s) { return s.desk + '  ·  ' + s.host; },
      start: function (s) { PS.startScenario(s); }
    };
    renderCards('scenario-list', general, scenarioOptions);
    renderCards('fix-scenario-list', fix, scenarioOptions);

    var incidentCount = document.getElementById('incident-count');
    var fixCount = document.getElementById('fix-count');
    if (incidentCount) incidentCount.textContent = general.length + ' incidents';
    if (fixCount) fixCount.textContent = fix.length + ' FIX incidents';
    document.getElementById('coverage-count').textContent =
      (PS.drills || []).reduce(function (n, p) { return n + p.tasks.length; }, 0) + ' practical questions · ' +
      scenarios.length + ' incidents total (' + general.length + ' general · ' + fix.length + ' FIX) · ' +
      (PS.interview ? PS.interview.questions.length : 0) + ' interview questions';
  };

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* PS.active is whichever runner owns the terminal right now. */
  PS.startScenario = function (scenario) {
    selectTrack(scenario.track === 'fix' ? 'fix' : 'incidents');
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('impact-label').textContent = 'IMPACT';
    document.getElementById('impact').classList.add('bad');
    document.getElementById('brief-title').textContent = 'Pager';
    document.getElementById('list-title').textContent = 'Findings';
    document.getElementById('help-title').textContent = 'Escalation';
    document.getElementById('panel-note').innerHTML =
      scenario.supportActions ? 'Type <code>diagnose</code>, then use Linux commands and Operational decisions to recover and verify the flow.' : 'Type <code>diagnose</code> when you know the root cause. Then fix it for real.';
    PS.active = PS.game;
    PS.game.start(scenario);
  };

  PS.startDrill = function (pack) {
    document.getElementById('support-panel').classList.add('hidden');
    selectTrack('basics');
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
      if (a.finished || window.confirm('Leave this and go back to the list?')) returnToList();
    };

    document.getElementById('modal-close').onclick = returnToList;

    PS.renderScenarioList();
    if (PS.interview) PS.interview.init();
    tracks.forEach(function (id) {
      var tab = document.getElementById('tab-' + id);
      if (tab) tab.onclick = function () { selectTrack(id); };
    });
    selectTrack(selectedTrack);
  });
})(PS);
