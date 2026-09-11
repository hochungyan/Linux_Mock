/* test/browser.test.js - loads EVERY file the browser loads, against a minimal DOM stub, and plays a
 * scenario end to end. Catches wiring bugs the headless engine tests cannot. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const IDS = ['boot', 'scenario-list', 'drill-list', 'game', 'sev', 'inc-title', 'inc-desk',
  'term', 'out', 'inputline', 'ps1', 'cmd', 'app', 'brief', 'brief-title', 'list-title',
  'help-title', 'panel-note', 'findings', 'find-count', 'btn-hint', 'hint-cost',
  'clock', 'impact', 'impact-label', 'score', 'status', 'modal', 'modal-title',
  'modal-body', 'modal-close', 'btn-quit', 'toasts'].concat(
    Array.from(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/\bid="([^"]+)"/g), m => m[1])
  );

function El(tag, id) {
  return {
    tagName: tag, id: id || '', children: [], _html: '', _text: '',
    className: '', style: {}, value: '', disabled: false, onclick: null,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c, force) {
        const add = arguments.length > 1 ? force : !this._s.has(c);
        if (add) this._s.add(c); else this._s.delete(c);
        return add;
      }
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    addEventListener() {}, removeEventListener() {},
    setAttribute(name, value) { this[name] = String(value); },
    setSelectionRange() {}, focus() {}, blur() {},
    get parentNode() { return null; }
  };
}

const els = {};
IDS.forEach(id => { els[id] = El('div', id); });

const document = {
  _els: els,
  getElementById(id) { return els[id] || null; },
  createElement(tag) { return El(tag); },
  addEventListener(ev, fn) { (this._h = this._h || {})[ev] = (this._h[ev] || []).concat(fn); },
  body: El('body'),
  documentElement: El('html')
};

const sandbox = {
  console, Date, Math, JSON, RegExp, parseInt, parseFloat, isNaN, Number, String,
  Array, Object, Function, Set, document,
  setTimeout: (fn) => { /* run deferred callbacks immediately-ish, but do not recurse */ return 0; },
  clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
  confirm: () => true, alert: () => {}, getSelection: () => ''
};
sandbox.window = sandbox;
vm.createContext(sandbox);

let fails = 0;
function check(label, cond, detail) {
  if (cond) console.log('   PASS  ' + label);
  else { console.log('   FAIL  ' + label + (detail ? '\n         ' + String(detail).slice(0, 400) : '')); fails++; }
}

// ---- verify index.html references exactly the files that exist ----
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
console.log('\n=== index.html script tags ===');
referenced.forEach(r => {
  check('exists: ' + r, fs.existsSync(path.join(ROOT, r)));
});
check('no ES modules (file:// safe)', !/type="module"/.test(html));
/* Load exactly what the browser loads, in the order the browser loads it, so a
 * newly added scenario is picked up here automatically. */
const FILES = referenced;

const scenarioTags = referenced.filter(r => r.startsWith('js/scenarios/'));
const scenarioDir = fs.readdirSync(path.join(ROOT, 'js/scenarios')).filter(f => f.endsWith('.js')).sort();
check('every scenario file has a <script> tag',
  scenarioDir.every(f => scenarioTags.includes('js/scenarios/' + f)),
  'on disk but not in index.html: ' +
    scenarioDir.filter(f => !scenarioTags.includes('js/scenarios/' + f)).join(', '));
check('scenarios load after the engine',
  referenced.indexOf('js/world.js') < Math.min(...scenarioTags.map(t => referenced.indexOf(t))));
check('scenarios load before the terminal',
  Math.max(...scenarioTags.map(t => referenced.indexOf(t))) < referenced.indexOf('js/terminal.js'));
check('script order: main.js last', referenced[referenced.length - 1] === 'js/main.js');
const cssRef = /<link rel="stylesheet" href="([^"]+)"/.exec(html);
check('stylesheet exists', cssRef && fs.existsSync(path.join(ROOT, cssRef[1])));

console.log('\n=== load in DOM sandbox ===');
for (const f of FILES) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  } catch (e) {
    check('load ' + f, false, e.stack);
  }
}
check('all files loaded', fails === 0);
const PS = sandbox.PS;
// A scenario file may register a small family of related investigations.
check('PS.scenarios populated', PS.scenarios && PS.scenarios.length >= scenarioDir.length, PS.scenarios && PS.scenarios.length);
check('PS.Terminal defined', typeof PS.Terminal === 'function');
check('PS.Game defined', typeof PS.Game === 'function');

console.log('\n=== simulate DOMContentLoaded + play a round ===');
const handlers = (document._h && document._h.DOMContentLoaded) || [];
check('DOMContentLoaded handler registered', handlers.length === 1);
try { handlers.forEach(h => h()); } catch (e) { check('boot handler runs', false, e.stack); }
check('game object created', !!PS.game);
check('scenario list rendered', els['scenario-list'].children.length === PS.scenarios.length,
  els['scenario-list'].children.length);

// start the flagship scenario the way clicking a card would
const flagship = PS.scenarios.find(s => s.id === 'market-data-frozen');
try { PS.startScenario(flagship); }
catch (e) { check('startScenario', false, e.stack); }

check('game panel unhidden', !els.game.classList.contains('hidden'));
check('boot panel hidden', els.boot.classList.contains('hidden'));
check('header title set', els['inc-title'].textContent.includes('Prices frozen'));
check('pager brief rendered', els.brief.textContent.includes('vol surface'));
check('findings list rendered', els.findings.children.length === flagship.discoveries.length,
  els.findings.children.length);
check('banner written to terminal', els.out.children.length > 3, els.out.children.length);

const g = PS.game;
function play(line) { g.term.echo(line); g.run(line); }

play('ss -uanp');
check('finding awarded from ss', g.found.includes('recvq-full'), g.found.join(','));
check('find-count updated', els['find-count'].textContent !== '0/8', els['find-count'].textContent);

play('netstat -su');
play('jstack 6120');
check('thread dump finding', g.found.includes('thread-dump') && g.found.includes('blocked-dispatch'), g.found.join(','));
check('output rendered as html spans', /<span class="c-/.test(els.out.children.map(c => c.innerHTML).join('')));

play('diagnose');
check('diagnose lists causes', els.out.children.some(c => /Root cause/.test(c.innerHTML)));
const wrong = g.submitDiagnosis(0);
check('wrong diagnosis penalised', g.wrongDiagnoses === 1 && /does not hold up/.test(wrong));
const right = g.submitDiagnosis(2);
check('right diagnosis accepted', g.diagnosed === true && /ACCEPTED/.test(right));

play('curl http://localhost:9911/admin/refdata/failover');
check('incident finished on fix', g.finished === true);
check('modal shown', !els.modal.classList.contains('hidden'));
check('modal has debrief', /DEBRIEF/.test(els['modal-body'].innerHTML));
check('modal has score total', /TOTAL/.test(els['modal-body'].innerHTML));
check('best score persisted', /market-data-frozen/.test(sandbox.localStorage.getItem('sev1.results.v1') || ''));

console.log('\n=== Basics track: play a drill ===');
check('PS.Drill defined', typeof PS.Drill === 'function');
check('drills loaded', PS.drills && PS.drills.length >= 4, PS.drills && PS.drills.length);
check('drill cards rendered', els['drill-list'].children.length === PS.drills.length,
  els['drill-list'].children.length);

PS.game.finished = true;
const pack = PS.drills.find(p => p.id === 'tcp-basics');
try { PS.startDrill(pack); } catch (e) { check('startDrill', false, e.stack); }
const d = PS.drill;

check('drill runner is active', PS.active === d);
check('header switched to BASICS', els.sev.textContent === 'BASICS');
check('panel relabelled to Tasks', els['list-title'].textContent === 'Tasks');
check('impact metric relabelled', els['impact-label'].textContent === 'TASK');
check('task list rendered', els.findings.children.length === pack.tasks.length);
check('first task shown in terminal',
  els.out.children.some(c => /TASK 1 of/.test(c.innerHTML)));

// a real command still works inside a drill
d.run('ss -tlnp');
check('shell works in drill mode', els.out.children.some(c => /9310/.test(c.innerHTML)));

// wrong answer, then right answer
d.run('answer 9999');
check('wrong answer rejected', d.results[0].wrong === 1 && !d.results[0].done);
d.run('answer 4820');
check('right answer accepted', d.results[0].done === true);
check('progress counter updated', els['find-count'].textContent.indexOf('1/') === 0,
  els['find-count'].textContent);
check('advanced to task 2', d.taskIdx === 1);
check('teaching note shown after correct',
  els.out.children.some(c => /Always add -n/.test(c.innerHTML)));

// hint and solution
const hintText = d.takeHint();
check('hint returns text', /HINT/.test(hintText));
check('hint recorded against current task', d.results[1].hinted === true);
d.run('solution');
check('solution marks the task', d.results[1].solved === true);

// skip wraps to the next unanswered task
const before = d.taskIdx;
d.run('skip');
check('skip moves on', d.taskIdx !== before);

// answer the rest and confirm the drill completes
pack.tasks.forEach((t, i) => {
  if (d.results[i].done) return;
  d.taskIdx = i;
  d.submit((t.answers || [t.answer])[0]);
});
d.finish();
check('drill finished', d.finished === true);
check('completion modal shown', !els.modal.classList.contains('hidden'));
check('modal has command sheet', /COMMAND SHEET/.test(els['modal-body'].innerHTML));
check('modal lists a solution', /ss -tlnp/.test(els['modal-body'].innerHTML));
check('modal has wrap-up', /WORTH REMEMBERING/.test(els['modal-body'].innerHTML));
check('drill score saved', /tcp-basics/.test(sandbox.localStorage.getItem('sev1.results.v1') || ''));

// going back to an incident restores the incident labels
PS.startScenario(PS.scenarios.find(s => s.id === 'disk-full-deleted-fd'));
check('labels restored for incidents', els['list-title'].textContent === 'Findings' &&
  els['impact-label'].textContent === 'IMPACT');
check('incident runner active again', PS.active === PS.game);

console.log('\n=== hang path (dead NFS mount) ===');
PS.game.finished = true;
PS.startScenario(PS.scenarios.find(s => s.id === 'nfs-hang-eod'));
const g2 = PS.game;
g2.run('ls /mnt/eodshare');
check('touching dead mount starts a hang app', g2.term.app && g2.term.app.type === 'hang');
g2.term.interrupt();
check('Ctrl+C clears the hang', g2.term.app === null);
g2.run('ls /mnt/eodshare2');
check('replica does not hang', g2.term.app === null);

console.log('\n=== complete curriculum and interview practice ===');
const drillDir = fs.readdirSync(path.join(ROOT, 'js/drills')).filter(f => f.endsWith('.js'));
check('every drill is available in browser', drillDir.every(f => referenced.includes('js/drills/' + f)));
check('question bank has broad coverage', PS.interviewTopics.length >= 20 && PS.interview.questions.length >= 140);
check('question IDs are unique', new Set(PS.interview.questions.map(q => q.id)).size === PS.interview.questions.length);
check('every question has an answer and follow-up', PS.interview.questions.every(q => q.question && q.answer && q.trap));
check('every topic has primary reference links', PS.interviewTopics.every(t => t.sources.length && t.sources.every(s => /^https:\/\//.test(s[1]))));
check('live coverage count includes all drills', els['coverage-count'].textContent.includes(String(PS.drills.reduce((n, p) => n + p.tasks.length, 0))));
els['tab-interview'].onclick();
check('interview tab opens and marks selection', !els['track-interview'].classList.contains('hidden') && els['tab-interview']['aria-pressed'] === 'true');
check('other tracks hidden', els['track-basics'].classList.contains('hidden') && els['track-incidents'].classList.contains('hidden'));
const firstQuestion = els['interview-question'].textContent;
els['interview-confident'].onclick();
check('cannot rate without revealing guide', !sandbox.localStorage.getItem('sev1.interview.v1'));
els['interview-reveal'].onclick();
check('guide reveals model answer and references', !els['interview-answer'].classList.contains('hidden') && els['interview-model'].textContent.length > 30 && els['interview-sources'].children.length > 0);
els['interview-confident'].onclick();
check('confidence saved separately from incident scores', /confident/.test(sandbox.localStorage.getItem('sev1.interview.v1')));
els['interview-next'].onclick();
check('next question hides answer', els['interview-question'].textContent !== firstQuestion && els['interview-answer'].classList.contains('hidden'));
els['interview-prev'].onclick();
check('previous returns to question', els['interview-question'].textContent === firstQuestion);
els['interview-topic'].value = 'fix'; els['interview-topic'].onchange();
check('topic filter selects FIX', els['interview-topic-label'].textContent.includes('FIX'));
els['interview-search'].value = 'no-such-topic-xyz'; els['interview-search'].oninput();
check('empty search is handled', !els['interview-empty'].classList.contains('hidden') && els['interview-next'].disabled);
els['interview-topic'].value = ''; els['interview-topic'].onchange();
els['interview-search'].value = ''; els['interview-search'].oninput();
els['interview-filter'].value = 'confident'; els['interview-filter'].onchange();
check('confidence filter uses saved rating', els['interview-counter'].textContent === '1 / 1');
els['interview-filter'].value = ''; els['interview-filter'].onchange();
els['interview-mock'].onclick();
const seen = new Set();
for (let i = 0; i < 20; i++) {
  seen.add(els['interview-question'].textContent);
  if (i > 0) { els['interview-reveal'].onclick(); els['interview-review'].onclick(); }
  els['interview-next'].onclick();
}
check('mock draws 20 distinct questions', seen.size === 20);
check('mock summary distinguishes rated and skipped', /19 of 20/.test(els['interview-empty'].textContent) && /1 unrated/.test(els['interview-empty'].textContent));
els['interview-study'].onclick();
check('study can restart after mock', !els['interview-card'].classList.contains('hidden'));
els['tab-basics'].onclick();
check('terminal drill navigation remains available', !els['track-basics'].classList.contains('hidden'));

console.log('\n' + (fails ? fails + ' FAILURES' : 'all DOM checks passed'));
process.exit(fails ? 1 : 0);
