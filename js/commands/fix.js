/* Fictional, in-memory teaching console. This does not connect to any venue. */
(function (PS) {
  'use strict';
  PS.shell.register('fixctl', function (argv, io, ctx) {
    if (!ctx.world.fixLab) return { err: 'fixctl: no FIX lab on this host', code: 1 };
    return ctx.world.fixLab.execute(argv.slice(1));
  }, { help: 'FIX lab support console (simulated, not a vendor command)',
    detail: 'fixctl help\nRead /home/gsupport/runbook-fix.txt for this incident.\nAll changes are virtual and session-scoped. Real FIX engines and venues have different recovery procedures.' });
})(PS);
