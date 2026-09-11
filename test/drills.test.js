/* test/drills.test.js
 *
 * The contract that matters for a drill: running the task's own `solution`
 * command on the task's own world must actually produce the expected answer.
 * If that ever stops being true the drill is teaching a lie, so this is the
 * one check worth having.
 */
const { PS, W, makeSession, check, section, failCount } = require('./harness.js');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/,/g, '').replace(/^["']|["']$/g, '').replace(/[.\s]+$/, '');
}

section('drill packs loaded');
check('drills present', (PS.drills || []).length >= 4, (PS.drills || []).length);

(PS.drills || []).forEach(pack => {
  section(pack.id + '  (' + pack.tasks.length + ' tasks)');

  check('has brief', (pack.brief || '').length > 40);
  check('has wrapUp', (pack.wrapUp || '').length > 80);
  check('world builds', (() => { try { pack.build(); return true; } catch (e) { return e.stack; } })() === true);

  const s = makeSession({ ...pack, discoveries: [] });

  pack.tasks.forEach((t, i) => {
    const label = (i + 1) + '. ' + t.short;

    if (!t.solution) { check(label + ' — has a solution command', false); return; }
    if (!t.hint) check(label + ' — has a hint', false);
    if (!t.teaches) check(label + ' — has a teaching note', false);

    const r = s.run(t.solution);
    const out = norm(r.text).replace(/\s+/g, ' ');

    if (r.text.includes('command not found') || r.text.includes('internal error')) {
      check(label + ' — solution runs', false, t.solution + '\n' + r.text.slice(0, 300));
      return;
    }

    // The expected answer must be visible in the solution's own output, so a
    // player who runs the command can read the answer straight off the screen.
    const expected = t.answers || [t.answer];
    const found = expected.some(a => out.includes(norm(a).replace(/\s+/g, ' ')));
    check(label + ' — answer "' + expected[0] + '" appears in output of: ' + t.solution,
      found, r.text.slice(0, 420));
  });
});

section('drill answer checking');
{
  const pack = PS.drills.find(p => p.id === 'logs-basics');
  const t = pack.tasks[0];
  const expected = t.answers || [t.answer];
  check('exact match accepted', expected.some(a => norm(a) === norm(' 8 ')));
  check('comma-insensitive', norm('1,842') === norm('1842'));
  check('case-insensitive', norm('ETH1') === norm('eth1'));
  check('quotes stripped', norm('"eth1"') === 'eth1');
}

section('every task has a distinct short label');
(PS.drills || []).forEach(pack => {
  const shorts = pack.tasks.map(t => t.short);
  check(pack.id + ': labels unique', new Set(shorts).size === shorts.length);
  check(pack.id + ': labels short enough for the panel',
    shorts.every(s => s.length <= 32), shorts.filter(s => s.length > 32).join(' | '));
});

console.log('\n' + (failCount() ? failCount() + ' FAILURES' : 'all drill checks passed'));
process.exit(failCount() ? 1 : 0);
