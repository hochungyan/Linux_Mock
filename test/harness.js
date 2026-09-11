/* test/harness.js - loads the simulator engine outside a browser so scenarios
 * can be driven programmatically. Used by engine.test.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* Engine + commands + scenarios. Deliberately excludes terminal/game/main,
 * which need a DOM - browser.test.js covers those. */
const ENGINE_FILES = [
  'js/vfs.js', 'js/world.js', 'js/shell.js',
  'js/commands/core.js', 'js/commands/sys.js', 'js/commands/net.js',
  'js/commands/java.js', 'js/commands/ops.js'
];

function scenarioFiles() {
  const dir = path.join(ROOT, 'js/scenarios');
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()
    .map(f => 'js/scenarios/' + f);
}

function drillFiles() {
  const dir = path.join(ROOT, 'js/drills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => 'js/drills/' + f);
}

function load() {
  const sandbox = {
    console, Date, Math, JSON, RegExp, parseInt, parseFloat, isNaN,
    Number, String, Array, Object, Function, setTimeout, clearTimeout
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  for (const f of ENGINE_FILES.concat(scenarioFiles()).concat(drillFiles())) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    try {
      vm.runInContext(src, sandbox, { filename: f });
    } catch (e) {
      console.error('LOAD FAILED ' + f + '\n' + e.stack);
      process.exit(1);
    }
  }
  return sandbox.PS;
}

const PS = load();
const W = PS.world;

/* A scriptable player: run() executes a command line and evaluates the
 * scenario's discovery predicates exactly as game.js does. */
function makeSession(scenario) {
  const world = scenario.build();
  const ctx = {
    world, shell: PS.shell, lastCode: 0,
    game: { history: [], found: [], scenario, world, WRONG_DIAGNOSIS_COST: 150 }
  };
  const found = [];
  return {
    world, ctx, found, scenario,
    run(line) {
      const r = PS.shell.run(line, ctx);
      const plain = W.stripColor((r.out || '') + '\n' + (r.err || ''));
      if (/\b(jstack|jcmd)\b/.test(line) && /Full thread dump/.test(plain)) world.flags.dumpTaken = true;
      if (/\bkill\s+-(3|SIGQUIT)\b/.test(line)) world.flags.dumpTaken = true;
      if (/\bjmap\b/.test(line) && /-dump/.test(line) && /Heap dump file created/.test(plain)) world.flags.heapDumped = true;
      for (const d of scenario.discoveries) {
        if (found.includes(d.id)) continue;
        let hit = false;
        try { hit = !!d.when({ cmd: line, out: plain, code: r.code, world }); }
        catch (e) { console.log('   ! discovery "' + d.id + '" threw: ' + e.message); }
        if (hit) found.push(d.id);
      }
      return { raw: r, text: plain };
    },
    advance(seconds) { for (let i = 0; i < seconds; i++) W.advance(world, 1); }
  };
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log('   PASS  ' + label);
  } else {
    failures++;
    console.log('   FAIL  ' + label +
      (detail ? '\n         ' + String(detail).split('\n').slice(0, 8).join('\n         ') : ''));
  }
}
function section(title) { console.log('\n=== ' + title + ' ==='); }
function failCount() { return failures; }

module.exports = { PS, W, makeSession, check, section, failCount, ROOT };
