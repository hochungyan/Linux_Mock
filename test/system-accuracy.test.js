/* Regression checks for Linux/protocol distinctions that change a diagnosis. */
const assert = require('assert');
const { PS, W, makeSession } = require('./harness.js');

function session(id) {
  const pack = PS.scenarios.concat(PS.drills).find(p => p.id === id);
  assert(pack, id);
  return makeSession({ ...pack, discoveries: pack.discoveries || [] });
}

{
  const s = session('tcp-basics');
  assert.match(s.run('ss -nptl').text, /9310/);
  assert.doesNotMatch(s.run('ss -nptl').text, /ESTAB/);
  assert.match(s.run('ss -ant').text, /LISTEN/);
  assert.match(s.run('ss -ant').text, /ESTAB/);
  assert.doesNotMatch(s.run('ss -Hnt state established').text, /State|LISTEN|CLOSE_WAIT/);
  assert.match(s.run('ss -nt state listening').text, /LISTEN/);
  assert.match(s.run('netstat -ant').text, /LISTEN/);
  assert.doesNotMatch(s.run('netstat -nt').text, /LISTEN/);
  assert.match(s.run('nc -zuv refdata-db 1521').text, /does not prove an open port/);
}

{
  const s = session('udp-multicast-basics');
  assert.match(s.run('ss -uanp').text, /14310/);
  assert.match(s.run('ss -ulnp').text, /14310/);
  assert.doesNotMatch(s.run('ss -unp').text, /14310/);
  s.world.sockets.push({ proto: 'udp', pid: 7204, fd: 77, local: '10.14.22.1:8888', peer: '10.14.22.2:8889', state: 'ESTABLISHED' });
  assert.match(s.run('ss -unp').text, /8888/);
  assert.doesNotMatch(s.run('ss -ulnp').text, /8888/);
}

{
  const s = session('processes-signals-basics');
  const zombie = s.world.procs.find(p => p.state === 'Z');
  s.run('kill -9 ' + zombie.pid);
  assert(W.findProc(s.world, zombie.pid), 'a zombie must be reaped, not killed');
  s.run('kill -9 22800');
  assert(W.findProc(s.world, 22800), 'genuine uninterruptible wait delays fatal signal');
  assert.strictEqual(W.findProc(s.world, 22800).pendingSignal, 'KILL');
  W.findProc(s.world, 22800).killableWait = true;
  s.run('kill -9 22800');
  assert(!W.findProc(s.world, 22800), 'a killable wait can still be shown as D');
  const pid = s.world.procs.find(p => p.state !== 'Z' && p.pid !== 1).pid;
  s.run('kill -0 ' + pid);
  assert(W.findProc(s.world, pid), 'signal 0 checks existence without terminating');
  s.run('kill -STOP ' + pid);
  assert.strictEqual(W.findProc(s.world, pid).state, 'T');
  s.run('kill -CONT ' + pid);
  assert.strictEqual(W.findProc(s.world, pid).state, 'S');
  assert.strictEqual(s.run('kill -INVALID ' + pid).raw.code, 1);
}

{
  const s = session('market-data-frozen');
  const p = s.world.procs.find(p => p.jvm && p.threads.some(t => t.state === 'BLOCKED'));
  const blocked = p.threads.find(t => t.state === 'BLOCKED');
  const row = s.run('top -H -b -p ' + p.pid).text.split('\n').find(line => new RegExp('^\\s*' + blocked.tid + '\\s').test(line));
  assert(row, 'blocked Java thread appears in top');
  assert(!/\sD\s/.test(row), 'Java BLOCKED is not Linux uninterruptible D');
}

{
  const s = session('memory-basics');
  const p = W.findProc(s.world, 9012);
  const resident = p.rss, used = p.jvm.heapUsed;
  s.run('jcmd 9012 GC.run');
  assert(p.jvm.heapUsed < used, 'collection reclaims unreachable objects in fixture');
  assert.strictEqual(p.rss, resident, 'collection need not return heap pages to OS');
}

{
  const s = session('networking-ip-basics');
  s.world.routes = [];
  s.world.interfaces = [{ name: 'eth7', addr: '10.24.9.20/16' }];
  assert.match(s.run('ip route').text, /10\.24\.0\.0\/16 dev eth7/);
}

{
  const s = session('nfs-hang-eod');
  assert.strictEqual(s.run('curl -X POST http://localhost:9980/admin/eod/fence-primary').raw.code, 1);
  s.run('sendevent -E KILLJOB -J EOD_POSITION_LOAD');
  assert(W.findProc(s.world, 28119), 'scheduler status must not pretend blocked process has exited');
  assert.strictEqual(s.run('sendevent -E FORCE_STARTJOB -J EOD_POSITION_LOAD_DR').raw.code, 1);
  assert.strictEqual(s.run('curl -X POST http://localhost:9980/admin/eod/fence-primary').raw.code, 0);
  assert.strictEqual(s.run('sendevent -E FORCE_STARTJOB -J EOD_POSITION_LOAD_DR').raw.code, 0);
  s.advance(15);
  assert(s.scenario.fix.check(s.world), 'documented, executable fenced recovery completes the incident');
}

console.log('system accuracy regressions passed');
