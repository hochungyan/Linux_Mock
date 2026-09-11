/* Self-assessed interview practice, separate from executable terminal drills. */
(function (PS) {
  'use strict';
  var KEY = 'sev1.interview.v1';
  var topics = PS.interviewTopics;
  var questions = [];
  topics.forEach(function (t) { questions = questions.concat(t.questions); });
  var ratings = {}, pool = [], position = 0, revealed = false, mock = false, reviewed = {};
  var el = function (id) { return document.getElementById(id); };
  var state = { topic: '', search: '', status: '' };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(ratings)); }
    catch (e) { el('interview-storage').textContent = 'Progress is available for this visit only; browser storage is unavailable.'; }
  }
  function load() {
    try {
      var parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      questions.forEach(function (q) {
        if (parsed[q.id] === 'confident' || parsed[q.id] === 'review') ratings[q.id] = parsed[q.id];
      });
    } catch (e) { ratings = {}; }
  }
  function topicFor(id) { return topics.filter(function (t) { return t.id === id; })[0]; }
  function filtered() {
    var query = state.search.trim().toLowerCase();
    return questions.filter(function (q) {
      if (state.topic && q.topic !== state.topic) return false;
      if (state.status === 'new' && ratings[q.id]) return false;
      if (state.status === 'review' && ratings[q.id] !== 'review') return false;
      if (state.status === 'confident' && ratings[q.id] !== 'confident') return false;
      return !query || (q.question + ' ' + q.answer + ' ' + q.command + ' ' + q.trap + ' ' + topicFor(q.topic).title).toLowerCase().includes(query);
    });
  }
  function updateProgress() {
    var confident = questions.filter(function (q) { return ratings[q.id] === 'confident'; }).length;
    var review = questions.filter(function (q) { return ratings[q.id] === 'review'; }).length;
    el('interview-progress').textContent = confident + ' confident · ' + review + ' to review · ' + (questions.length - confident - review) + ' unrated';
  }
  function render() {
    updateProgress();
    var q = pool[position];
    el('interview-answer').classList.add('hidden');
    el('interview-rating').classList.add('hidden');
    el('interview-empty').classList.add('hidden');
    el('interview-card').classList.toggle('hidden', !q);
    el('interview-prev').disabled = position === 0 || !q;
    el('interview-next').disabled = !q || (!mock && position === pool.length - 1);
    el('interview-reveal').disabled = !q;
    el('interview-mode').textContent = mock ? 'MOCK INTERVIEW · SELF-ASSESSMENT' : 'INTERVIEW PRACTICE';
    el('interview-next').textContent = mock && position === pool.length - 1 ? 'Finish interview' : 'Next question';
    revealed = false;
    el('interview-notes').value = '';
    if (!q) {
      el('interview-empty').classList.remove('hidden');
      el('interview-empty').textContent = 'No questions match. Change the topic, search or review filter.';
      el('interview-counter').textContent = '0 questions';
      return;
    }
    el('interview-counter').textContent = (position + 1) + ' / ' + pool.length;
    el('interview-topic-label').textContent = topicFor(q.topic).title;
    el('interview-question').textContent = q.question;
    el('interview-model').textContent = q.answer;
    el('interview-example').textContent = q.command;
    el('interview-example-wrap').classList.toggle('hidden', !q.command);
    el('interview-trap').textContent = q.trap;
    el('interview-self-rating').textContent = ratings[q.id] === 'confident' ? 'Your rating: confident' : ratings[q.id] === 'review' ? 'Your rating: needs practice' : 'Not rated yet';
    var sources = el('interview-sources');
    sources.innerHTML = '';
    topicFor(q.topic).sources.forEach(function (s) {
      var a = document.createElement('a');
      a.textContent = s[0]; a.href = s[1]; a.target = '_blank'; a.rel = 'noopener noreferrer';
      sources.appendChild(a);
    });
  }
  function filter() {
    mock = false; reviewed = {}; position = 0; pool = filtered(); render();
  }
  function reveal() {
    if (!pool[position]) return;
    revealed = true;
    el('interview-answer').classList.remove('hidden');
    el('interview-rating').classList.remove('hidden');
    el('interview-reveal').disabled = true;
  }
  function rate(value) {
    var q = pool[position];
    if (!q || !revealed) return;
    ratings[q.id] = value; reviewed[q.id] = value; save(); updateProgress();
    el('interview-self-rating').textContent = value === 'confident' ? 'Your rating: confident' : 'Your rating: needs practice';
  }
  function next() {
    if (!pool[position]) return;
    if (position < pool.length - 1) { position++; render(); return; }
    if (!mock) return;
    var count = pool.filter(function (q) { return reviewed[q.id]; }).length;
    var confident = pool.filter(function (q) { return reviewed[q.id] === 'confident'; }).length;
    el('interview-card').classList.add('hidden');
    el('interview-empty').classList.remove('hidden');
    el('interview-empty').textContent = 'Interview complete. You rated ' + count + ' of ' + pool.length + ' questions: ' + confident + ' confident and ' + (count - confident) + ' needing practice. ' + (pool.length - count) + ' unrated. These are your own ratings, not an exam score. Use “Study matching questions” to return, or start another mock.';
    el('interview-prev').disabled = true; el('interview-next').disabled = true;
  }
  function startMock() {
    pool = filtered().slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = pool[i]; pool[i] = pool[j]; pool[j] = temp;
    }
    pool = pool.slice(0, 20); position = 0; mock = true; reviewed = {}; render();
  }
  PS.interview = {
    questions: questions,
    init: function () {
      load();
      var select = el('interview-topic');
      topics.forEach(function (t) {
        var option = document.createElement('option'); option.value = t.id;
        option.textContent = t.title + ' (' + t.questions.length + ')'; select.appendChild(option);
      });
      select.onchange = function () { state.topic = select.value; filter(); };
      el('interview-search').oninput = function () { state.search = this.value; filter(); };
      el('interview-filter').onchange = function () { state.status = this.value; filter(); };
      el('interview-reveal').onclick = reveal;
      el('interview-confident').onclick = function () { rate('confident'); };
      el('interview-review').onclick = function () { rate('review'); };
      el('interview-next').onclick = next;
      el('interview-prev').onclick = function () { if (position > 0) { position--; render(); } };
      el('interview-mock').onclick = startMock;
      el('interview-study').onclick = filter;
      filter();
    }
  };
})(PS);
