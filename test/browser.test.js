/* test/browser.test.js - loads EVERY file the browser loads, against a minimal DOM stub, and plays a
 * scenario end to end. Catches wiring bugs the headless engine tests cannot. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const IDS = ['boot', 'scenario-list', 'drill-list', 'game', 'sev', 'inc-title', 'inc-desk',
  'term', 'out', 'inputline', 'ps1', 'cmd', 'app', 'brief', 'brief-title', 'list-title',
  'help-title', 'panel-note', 'findings', 'find-count', 'btn-hint', 'hint-cost',
  'clock', 'impact', 'impact-label', 'score', 'status', 'modal', 'modal-title',
  'modal-body', 'modal-close', 'btn-quit', 'toasts'].concat(
    Array.from(html.matchAll(/\bid="([^"]+)"/g), m => m[1])
  );

function El(tag, id) {
  return {
    tagName: tag, id: id || '', children: [], _html: '', _text: '',
    style: {}, value: '', disabled: false, onclick: null,
    get className() { return Array.from(this.classList._s).join(' '); },
    set className(value) { this.classList._s = new Set(String(value).split(/\s+/).filter(Boolean)); },
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
    setAttribute(name, value) { this[name === 'class' ? 'className' : name] = String(value); },
    getAttribute(name) { return this[name === 'class' ? 'className' : name] ?? null; },
    setSelectionRange() {}, focus() { document.activeElement = this; }, blur() {},
    get parentNode() { return null; }
  };
}

const els = {};
IDS.forEach(id => { els[id] = El('div', id); });
// Start with the actual markup's classes and ARIA state, as a browser would.
for (const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  const el = els[match[3]];
  el.tagName = match[1];
  for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(attr[1], attr[2]);
}

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

// Scores created before FIX became a separate track must follow the same IDs.
sandbox.localStorage.setItem('sev1.results.v1', JSON.stringify({
  'fix-seqnum-gap': { score: 9876, seconds: 42 }
}));

console.log('\n=== simulate DOMContentLoaded + play a round ===');
const handlers = (document._h && document._h.DOMContentLoaded) || [];
check('DOMContentLoaded handler registered', handlers.length === 1);
try { handlers.forEach(h => h()); } catch (e) { check('boot handler runs', false, e.stack); }
check('game object created', !!PS.game);
const generalScenarios = PS.scenarios.filter(s => s.track !== 'fix');
const fixScenarios = PS.scenarios.filter(s => s.track === 'fix');
check('scenario list rendered', els['scenario-list'].children.length === generalScenarios.length,
  els['scenario-list'].children.length);

console.log('\n=== four training tracks: separation and counts ===');
const tracks = ['basics', 'incidents', 'fix', 'interview'];
const trackNav = /<nav\b[^>]*class="track-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
const navTracks = trackNav ? Array.from(trackNav[1].matchAll(/\bid="tab-([^"]+)"/g), m => m[1]) : [];
check('all four tabs share one navigation, with incidents and FIX adjacent',
  navTracks.slice().sort().join(',') === tracks.slice().sort().join(',') &&
  Math.abs(navTracks.indexOf('incidents') - navTracks.indexOf('fix')) === 1);
function selectedTrack(id) {
  return tracks.every(other => els['track-' + other] && els['tab-' + other] &&
    els['track-' + other].classList.contains('hidden') === (other !== id) &&
    els['tab-' + other].classList.contains('selected') === (other === id) &&
    els['tab-' + other].getAttribute('aria-pressed') === String(other === id) &&
    els['tab-' + other].getAttribute('aria-controls') === 'track-' + other);
}
function cardIds(hostId) {
  return (els[hostId] ? els[hostId].children : []).map(card => card.getAttribute('data-id'));
}
function checkCounts(label) {
  const general = PS.scenarios.filter(s => s.track !== 'fix').length;
  const fix = PS.scenarios.filter(s => s.track === 'fix').length;
  const practical = PS.drills.reduce((n, p) => n + p.tasks.length, 0);
  check(label + ': exact overall count and subtotals', els['coverage-count'].textContent ===
    practical + ' practical questions · ' + PS.scenarios.length + ' incidents total (' +
    general + ' general · ' + fix + ' FIX) · ' + PS.interview.questions.length + ' interview questions');
  check(label + ': section counts match each list', els['incident-count'] && els['fix-count'] &&
    els['incident-count'].textContent === general + ' incidents' &&
    els['fix-count'].textContent === fix + ' FIX incidents');
}
check('incidents selected at boot, other panels hidden', selectedTrack('incidents'));
check('general cards contain exactly non-FIX scenarios in source order',
  cardIds('scenario-list').join(',') === generalScenarios.map(s => s.id).join(','));
check('FIX cards contain exactly FIX scenarios in source order', fixScenarios.length > 0 &&
  cardIds('fix-scenario-list').join(',') === fixScenarios.map(s => s.id).join(','));
const allCardIds = cardIds('scenario-list').concat(cardIds('fix-scenario-list'));
check('every incident appears once across the two lists', allCardIds.length === PS.scenarios.length &&
  new Set(allCardIds).size === PS.scenarios.length);
checkCounts('initial rendering');
for (const id of tracks) {
  if (els['tab-' + id]) els['tab-' + id].onclick();
  check(id + ' tab selects only its own panel and button', selectedTrack(id));
}
PS.renderScenarioList();
check('rendering cards preserves interview tab selection', selectedTrack('interview'));

// Exercise both completion and early exit through the actual FIX card/button wiring.
const legacyFix = PS.scenarios.find(s => s.id === 'fix-seqnum-gap');
const legacyCard = els['fix-scenario-list'] && els['fix-scenario-list'].children.find(c =>
  c.getAttribute('data-id') === 'fix-seqnum-gap');
check('existing FIX case moves tracks without changing its score ID', legacyFix && legacyFix.track === 'fix' &&
  legacyCard && legacyCard.children[0].innerHTML.includes('best 9876'));
if (legacyCard) {
  els['tab-fix'].onclick();
  legacyCard.onclick();
  check('FIX card starts the incident runner with FIX return destination', PS.active === PS.game &&
    PS.game.scenario === legacyFix && selectedTrack('fix') &&
    els['modal-close'].textContent === 'BACK TO FIX INCIDENTS');
  PS.game.run('curl http://localhost:9980/admin/session/GSCLIENT1/status');
  check('FIX terminal diagnostics run', els.out.children.some(c => /REJECTED_SEQNUM_TOO_LOW/.test(c.innerHTML)));
  PS.game.submitDiagnosis(legacyFix.rootCauses.findIndex(c => c.correct));
  PS.game.run('curl http://localhost:9980/admin/session/GSCLIENT1/reset');
  check('FIX recovery finishes and opens debrief', PS.game.finished && !els.modal.classList.contains('hidden'));
  check('lower score keeps the legacy best and completion time', PS.loadResults()['fix-seqnum-gap'].score === 9876 &&
    PS.loadResults()['fix-seqnum-gap'].seconds === 42);
  els['modal-close'].onclick();
  check('FIX debrief returns to FIX list and restores keyboard focus', selectedTrack('fix') &&
    !els.boot.classList.contains('hidden') && els.game.classList.contains('hidden') &&
    els.modal.classList.contains('hidden') && document.activeElement === els['tab-fix']);
  els['tab-incidents'].onclick();
  PS.startScenario(legacyFix);
  check('direct FIX start selects FIX even from another tab', selectedTrack('fix'));
  sandbox.confirm = () => false;
  els['btn-quit'].onclick();
  check('cancelled stand-down preserves the running FIX incident', !PS.game.finished &&
    els.boot.classList.contains('hidden') && !els.game.classList.contains('hidden'));
  sandbox.confirm = () => true;
  els['btn-quit'].onclick();
  check('confirmed stand-down returns to FIX', PS.game.finished && selectedTrack('fix') &&
    !els.boot.classList.contains('hidden') && document.activeElement === els['tab-fix']);
  checkCounts('after FIX completion and exit');
}

const registeredScenarios = PS.scenarios;
PS.scenarios = [];
PS.renderScenarioList();
check('empty incident registry clears both card lists', cardIds('scenario-list').length === 0 &&
  cardIds('fix-scenario-list').length === 0);
checkCounts('empty incident registry');
PS.scenarios = registeredScenarios;
PS.renderScenarioList();
checkCounts('restored incident registry');
check('rerendering restores all cards without duplicates',
  cardIds('scenario-list').concat(cardIds('fix-scenario-list')).length === PS.scenarios.length);

// start the flagship scenario the way clicking a card would
const flagship = PS.scenarios.find(s => s.id === 'market-data-frozen');
try { PS.startScenario(flagship); }
catch (e) { check('startScenario', false, e.stack); }

check('game panel unhidden', !els.game.classList.contains('hidden'));
check('general incident start restores general return destination', selectedTrack('incidents') &&
  els['modal-close'].textContent === 'BACK TO INCIDENT LIST');
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
els['modal-close'].onclick();
check('general debrief returns to incidents and restores keyboard focus', selectedTrack('incidents') &&
  !els.boot.classList.contains('hidden') && els.game.classList.contains('hidden') &&
  document.activeElement === els['tab-incidents']);

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
check('drill start selects basics and names the return destination', selectedTrack('basics') &&
  els['modal-close'].textContent === 'BACK TO TERMINAL DRILLS');
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
els['modal-close'].onclick();
check('drill debrief returns to basics with keyboard focus', selectedTrack('basics') &&
  !els.boot.classList.contains('hidden') && document.activeElement === els['tab-basics']);
PS.startDrill(pack);
els['btn-quit'].onclick();
check('unfinished drill can stand down to basics', d.finished && selectedTrack('basics') &&
  !els.boot.classList.contains('hidden'));

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
check('incidents are the initial track', /id="tab-incidents"[^>]*aria-pressed="true"/.test(html) &&
  /id="track-incidents" class="track"/.test(html));
console.log('\n=== source-backed finance investigations in browser runner ===');
const financeCases = PS.scenarios.filter(s => s.sources && s.walkthrough);
check('four finance investigations include sources and playable walkthroughs', financeCases.length >= 4);
for (const scenario of financeCases) {
  PS.startScenario(scenario);
  PS.game.submitDiagnosis(scenario.rootCauses.findIndex(c => c.correct));
  scenario.walkthrough.forEach((command, index) => {
    PS.game.run(command);
    if (index < scenario.walkthrough.length - 1) check(scenario.id + ' remains open before final release ' + index, !PS.game.finished);
  });
  check(scenario.id + ' completes with business recovery', PS.game.finished && scenario.fix.check(PS.game.world));
  check(scenario.id + ' debrief has clickable primary references', /PRIMARY REFERENCES/.test(els['modal-body'].innerHTML) && /rel="noopener noreferrer"/.test(els['modal-body'].innerHTML));
}
PS.game.abandon();
const drillDir = fs.readdirSync(path.join(ROOT, 'js/drills')).filter(f => f.endsWith('.js'));
check('every drill is available in browser', drillDir.every(f => referenced.includes('js/drills/' + f)));
check('question bank has broad coverage', PS.interviewTopics.length >= 20 && PS.interview.questions.length >= 140);
check('question IDs are unique', new Set(PS.interview.questions.map(q => q.id)).size === PS.interview.questions.length);
check('every question has an answer and follow-up', PS.interview.questions.every(q => q.question && q.answer && q.trap));
check('every topic has primary reference links', PS.interviewTopics.every(t => t.sources.length && t.sources.every(s => /^https:\/\//.test(s[1]))));
check('live coverage count includes all drills', els['coverage-count'].textContent.includes(String(PS.drills.reduce((n, p) => n + p.tasks.length, 0))));
els['tab-interview'].onclick();
check('interview tab opens and marks selection', !els['track-interview'].classList.contains('hidden') && els['tab-interview']['aria-pressed'] === 'true');
check('other tracks hidden', els['track-basics'].classList.contains('hidden') &&
  els['track-incidents'].classList.contains('hidden') && els['track-fix'] && els['track-fix'].classList.contains('hidden'));
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
