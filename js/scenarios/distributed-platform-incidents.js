/* Generic production support fixtures. Captured exports are synthetic evidence;
 * localhost:9976/sim/* is a fictional simulator API, never Kafka or Kubernetes.
 * No command handlers are installed here. Each receipt checks business state. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, MB = 1048576, GB = 1073741824;
  PS.scenarios = PS.scenarios || [];
  var SOURCES = {
    kafka: { title: 'Apache Kafka 4.2 KafkaConsumer: offsets, commits and flow control',
      url: 'https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html' },
    retry: { title: 'AWS Builders Library: Timeouts, retries, and backoff with jitter',
      url: 'https://d1.awsstatic.com/builderslibrary/pdfs/timeouts-retries-and-backoff-with-jitter.pdf' },
    idempotency: { title: 'AWS Builders Library: Making retries safe with idempotent APIs',
      url: 'https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/' },
    probes: { title: 'Kubernetes: Liveness, Readiness, and Startup Probes',
      url: 'https://kubernetes.io/docs/concepts/workloads/pods/probes/' }
  };
  function json(v) { return JSON.stringify(v, null, 2); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    var keys = Object.keys(a).sort(), other = Object.keys(b).sort();
    return keys.join(',') === other.join(',') && keys.every(function (key) { return equal(a[key], b[key]); });
  }
  function fail(message) { return { code: 1, err: '409 ' + message }; }
  function read(w, path) { return V.read(V.lookup(w.root, path), w); }
  function put(w, path, body) { V.write(w.root, path, body, { owner: 'gsupport', mtime: new Date(w.clock.getTime()) }); }
  function file(w, path, body) { w.platform.files[path] = body; put(w, path, body); }
  function intact(w) {
    return Object.keys(w.platform.files).every(function (path) {
      var body = w.platform.files[path];
      return !!V.lookup(w.root, path) && read(w, path) === (typeof body === 'function' ? body(w) : body);
    });
  }
  function preserved(w) {
    var saved = w.platform.saved;
    return !!saved && intact(w) && Object.keys(saved).every(function (path) {
      return !!V.lookup(w.root, path) && read(w, path) === saved[path];
    });
  }
  function audit(w, message) { w.platform.audit.push(W.isoStamp(w.clock) + ' ' + message); }
  function alive(w) {
    var p = W.findProc(w, w.platform.pid);
    return !!(w.services[w.platform.unit].active && p && p.state !== 'T');
  }
  function route(w, action, method, keys, handler) {
    w.http[w.platform.api + action] = function (world, req) {
      if (!req || req.method !== method) return { code: 1, err: '405 ' + method + ' required' };
      var argv = req.argv || [], bodies = [], body = {};
      for (var i = 1; i < argv.length; i++) {
        if (['-d', '--data', '--data-raw'].indexOf(argv[i]) >= 0) bodies.push(argv[++i]);
        else if (/^--data(?:-raw)?=/.test(argv[i])) bodies.push(argv[i].slice(argv[i].indexOf('=') + 1));
        else if (/^-d.+/.test(argv[i])) bodies.push(argv[i].slice(2));
      }
      try { if (bodies.length) body = JSON.parse(bodies[0]); }
      catch (e) { return { code: 1, err: '400 JSON object required' }; }
      if (bodies.length > 1 || !body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== keys.slice().sort().join(',')) {
        return { code: 1, err: '400 Expected fields: ' + (keys.join(',') || '(none)') };
      }
      // Mutations cannot conceal destroyed exports, evidence copies or audit.
      if (method === 'POST' && (!intact(world) || (world.platform.saved && !preserved(world)))) {
        return fail('Evidence or audit missing/changed; restore the retained originals.');
      }
      return handler(world, body);
    };
  }
  function post(kind, action, body) {
    return 'curl -X POST http://localhost:9976/sim/' + kind + '/' + action +
      (body ? " -d '" + JSON.stringify(body) + "'" : '');
  }
  function get(kind) { return 'curl http://localhost:9976/sim/' + kind + '/status'; }
  function finding(id, label, path, pattern, required) {
    return { id: id, label: label, when: function (o) {
      var hit = o.code === 0 && /\b(cat|grep|head|tail|sed|awk|curl)\b/.test(o.cmd) &&
        o.cmd.indexOf(path) >= 0 && pattern.test(o.out);
      if (hit && required) o.world.platform.observed[id] = true;
      return hit;
    } };
  }
  function base(kind, unit, pid, data, evidenceIds, runbook) {
    var services = {};
    services[unit] = { active: true, pid: pid, requiresRoot: false, exe: unit,
      desc: 'Fictional ' + unit + ' support adapter' };
    data.api = 'localhost:9976/sim/' + kind + '/'; data.pid = pid; data.unit = unit;
    data.files = {}; data.observed = {}; data.saved = null; data.receipt = null;
    data.audit = ['2026-09-13 10:00:00 INCIDENT opened; original data retained'];
    var w = W.create({ host: 'platform-' + kind + '-01', user: 'gsupport',
      clock: new Date(2026, 8, 13, 10, 0, 0), seed: pid, cores: 8,
      root: V.dir({ home: V.dir({ gsupport: V.dir({}) }), tmp: V.dir({}), proc: V.dir({}) }),
      mem: { total: 16 * GB, free: 10 * GB, buffers: 128 * MB, cached: 2 * GB },
      swap: { total: 2 * GB, used: 0 },
      procs: [W.proc({ pid: 1, short: 'systemd', cmd: '/usr/lib/systemd/systemd', rss: 12 * MB }),
        W.proc({ pid: pid, user: 'platform', short: unit, cmd: '/apps/platform/' + unit, rss: 320 * MB, cpu: 5 })],
      services: services,
      filesystems: [{ dev: '/dev/vda1', mount: '/', type: 'xfs', size: 80 * GB, used: 18 * GB,
        inodes: { total: 4000000, used: 80000 } }],
      hosts: { localhost: { ip: '127.0.0.1', ports: [9976], rtt: 0.02 } },
      sockets: [{ pid: pid, fd: 8, proto: 'tcp', local: '127.0.0.1:9976', peer: '0.0.0.0:*', state: 'LISTEN' }],
      httpExact: true, http: {}, platform: data, flags: { disrupted: false }
    });
    put(w, '/home/gsupport/runbook.txt', runbook);
    put(w, '/etc/redhat-release', 'Red Hat Enterprise Linux Server release 7.9 (Maipo)\n');
    file(w, '/var/log/platform/audit.log', function (world) { return world.platform.audit.join('\n') + '\n'; });
    route(w, 'capture', 'POST', [], function (world) {
      var d = world.platform;
      if (!evidenceIds.every(function (id) { return d.observed[id]; })) return fail('Inspect all required captured evidence before capture.');
      if (d.saved) return 'Original evidence already retained under /evidence/before';
      d.saved = {};
      Object.keys(d.files).forEach(function (path) {
        var dest = '/evidence/before' + path, body = read(world, path);
        d.saved[dest] = body; put(world, dest, body);
      });
      audit(world, 'CAPTURE original exports and live state under /evidence/before');
      return 'Evidence retained under /evidence/before';
    });
    w.onService = function (world, verb, name, svc) {
      if (name.replace(/\.service$/, '') !== unit || ['start', 'stop', 'restart'].indexOf(verb) < 0) return false;
      world.flags.disrupted = true; data.receipt = null;
      svc.active = verb !== 'stop';
      if (verb === 'stop') W.killProc(world, pid);
      else if (!W.findProc(world, pid)) {
        world.procs.push(W.proc({ pid: pid, short: unit, user: 'platform', cmd: '/apps/platform/' + unit, rss: 320 * MB, cpu: 5 }));
        world.sockets.push({ pid: pid, fd: 8, proto: 'tcp', local: '127.0.0.1:9976', peer: '0.0.0.0:*', state: 'LISTEN' });
      }
      audit(world, 'SERVICE ' + verb + ': durable incident state retained; business verification invalidated');
      return 'Service ' + verb + '; no durable data, policy or deployment repair performed.';
    };
    w.onKill = function (world, proc) {
      if (proc.pid !== pid) return;
      world.services[unit].active = false; world.flags.disrupted = true; data.receipt = null;
      audit(world, 'PROCESS terminated; durable incident state retained');
    };
    return w;
  }
  function ready(w) { return preserved(w) && alive(w); }
  function grade(check) {
    return function (w) {
      if (!check(w)) return { quality: 'blunt', bonus: -200, note: 'Recovery needs retained evidence, ordered checks and reconciled business outcomes.' };
      return w.flags.disrupted ? { quality: 'blunt', bonus: -100, note: 'Recovery verified; an extra process interruption did not repair the durable cause.' } :
        { quality: 'clean', bonus: 350, note: 'Preserved evidence, applied a scoped recovery, and proved business correctness and stable service.' };
    };
  }
  function sourceText(sources) { return '\nPRIMARY SOURCES\n' + sources.map(function (s) { return s.title + '\n' + s.url; }).join('\n'); }
  var boundary = 'FICTIONAL SIMULATOR RUNBOOK\n' +
    'Every localhost:9976/sim/ endpoint is a simulator-only admin control.\n' +
    'Use explicit -X POST and JSON -d bodies; status is GET. Errors return a\n' +
    'nonzero shell code. Captured exports are labelled synthetic snapshots,\n' +
    'not live kubectl or kafka command output. All paths below are absolute.\n' +
    'Read the evidence before capture. Retain /evidence/before and the audit.\n';

  // Kafka: independent shipment requests; quarantine does not reorder updates
  // to the same aggregate. This is application policy, not broker auto-DLQ.
  var K_SCOPE = { group: 'shipping-v1', topic: 'shipment-requests', partition: 0, offset: 201 };
  var K_REPAIR = { eventId: 'SHIP-101', correction: 'CORR-201', units: 2 };
  var kInspect = ['cat /home/gsupport/runbook.txt', get('kafka'),
    'cat /captured/kafka/consumer.log', 'cat /captured/kafka/record-201.json',
    'cat /captured/kafka/orders.csv', 'cat /captured/kafka/correction.txt'];
  var kActions = [post('kafka', 'capture'), post('kafka', 'pause-partition', K_SCOPE),
    post('kafka', 'quarantine', K_SCOPE), post('kafka', 'resume-partition', K_SCOPE),
    post('kafka', 'stage-correction', K_REPAIR), post('kafka', 'replay', { eventId: 'SHIP-101' }),
    post('kafka', 'verify-replay'), post('kafka', 'verify-business')];
  function kafkaReport(w) {
    var d = w.platform;
    return { group: 'shipping-v1', topic: 'shipment-requests', committedNext: d.committed,
      endExclusive: [203, 52], lag: [203 - d.committed[0], 52 - d.committed[1]], pausedPartition0: d.paused,
      expectedShipments: d.orders.length, actualShipments: d.shipments.length,
      expectedUnits: d.orders.reduce(function (n, x) { return n + x.units; }, 0),
      actualUnits: d.shipments.reduce(function (n, x) { return n + x.units; }, 0),
      missing: d.orders.filter(function (x) { return !d.shipments.some(function (s) { return s.id === x.id; }); }).map(function (x) { return x.id; }),
      quarantine: d.quarantine, replay: d.replayProof };
  }
  function shipmentMatch(d) {
    return d.shipments.length === d.orders.length && d.orders.every(function (o) {
      return d.shipments.filter(function (s) { return s.id === o.id && s.units === o.units; }).length === 1;
    });
  }
  function deliver(d, event) {
    var old = d.shipments.filter(function (s) { return s.id === event.id; })[0];
    if (!old) d.shipments.push({ id: event.id, units: event.units });
    return old ? 'DEDUPLICATED' : 'APPLIED';
  }
  function kafkaHealthy(w) {
    var d = w.platform;
    return ready(w) && !d.paused && equal(d.committed, [203, 52]) && shipmentMatch(d) &&
      !!d.quarantine && equal(d.quarantine.original, d.poison) && equal(d.correction, { id: 'SHIP-101', units: 2 }) &&
      !!d.replayProof && d.replayProof.result === 'DEDUPLICATED' && d.replayProof.before === 5 && d.replayProof.after === 5;
  }
  function kafkaFixed(w) { return !!(kafkaHealthy(w) && w.platform.receipt && equal(w.platform.receipt, kafkaReport(w))); }
  PS.scenarios.push({ id: 'kafka-poison-partition-replay', title: 'Shipment consumer is alive but one Kafka partition stalls',
    severity: 'P1', desk: 'Commerce / Fulfilment Platform', host: 'platform-kafka-01',
    tags: ['Kafka', 'partition lag', 'poison record', 'replay', 'reconciliation'], par: 660, impactPerMin: 12000, currency: 'USD',
    brief: 'PAGER 10:00 - two paid shipment requests never reached fulfilment.\n' +
      'The consumer is alive and partition 1 is current. Partition 0 keeps retrying.\n' +
      'Investigate /captured/kafka and /home/gsupport/runbook.txt. Preserve every\n' +
      'request, recover only the affected partition, then prove replay created\n' +
      'exactly one shipment per paid order. HTTP controls and exports are fictional.',
    sources: [SOURCES.kafka, SOURCES.idempotency], walkthrough: kInspect.concat(kActions),
    build: function () {
      var orders = [{ id: 'SHIP-100', units: 1 }, { id: 'SHIP-101', units: 2 }, { id: 'SHIP-102', units: 1 },
        { id: 'SHIP-200', units: 3 }, { id: 'SHIP-201', units: 1 }];
      var w = base('kafka', 'shipment-consumer', 9761, {
        orders: orders, shipments: copy([orders[0], orders[3], orders[4]]), committed: [201, 52], paused: false,
        poison: { topic: 'shipment-requests', partition: 0, offset: 201, id: 'SHIP-101', units: 'two', schema: 'v1' },
        quarantine: null, correction: null, replayProof: null
      }, ['k-lag', 'k-error', 'k-record', 'k-orders', 'k-correction'], boundary +
        'Scope: shipping-v1 / shipment-requests / partition 0 / offset 201.\n' +
        'Each event creates an independent shipment; no same-order updates are\n' +
        'overtaken. Offsets here are consecutive; committed means NEXT record.\n' +
        'Producer intake is held upstream for this finite five-order cohort.\n' +
        'Partition 1 must remain at committed-next 52. The application can\n' +
        'durably quarantine 201 BEFORE committing 202, then process 202 and\n' +
        'commit 203. Kafka does not automatically quarantine a poison record.\n' +
        kInspect.slice(1).join('\n') + '\n' +
        'CORR-201 is already approved by the order owner; the retained source\n' +
        'order proves units=2. Stage a corrected copy; never edit the raw event.\n' +
        kActions.join('\n') + '\n' +
        'verify-replay delivers the repaired event a second time using the same\n' +
        'durable event ID. Verify all five shipment IDs and eight units.\n' +
        'A zero lag metric without SHIP-101 is not recovery. No reset-to-latest,\n' +
        'topic deletion, purge, or blanket consumer-group reset is supported.\n' +
        'Live views: /var/lib/platform/shipments.json and /var/lib/platform/kafka.json\n' + sourceText([SOURCES.kafka, SOURCES.idempotency]));
      file(w, '/captured/kafka/consumer.log', 'CAPTURED SYNTHETIC consumer export at 10:00\n' +
        '09:58:00 partition=0 offset=201 ValidationError units expected integer got two\n' +
        '09:58:10 partition=0 offset=201 ValidationError retry=2 committed_next=201\n' +
        '09:59:00 partition=1 committed_next=52 end_exclusive=52 broker_health=OK\n');
      file(w, '/captured/kafka/record-201.json', json({ provenance: 'CAPTURED SYNTHETIC raw Kafka record', record: w.platform.poison }));
      file(w, '/captured/kafka/orders.csv', '# CAPTURED SYNTHETIC paid-order export\nid,units\n' + orders.map(function (o) { return o.id + ',' + o.units; }).join('\n') + '\n');
      file(w, '/captured/kafka/correction.txt', 'CAPTURED SYNTHETIC owner approval CORR-201\n' +
        'event=SHIP-101 source_order_units=2 schema=v1 expected_type=integer\n' +
        'Approved corrected copy only; retain original bytes and source offset.\n');
      file(w, '/var/lib/platform/shipments.json', function (world) { return json(world.platform.shipments); });
      file(w, '/var/lib/platform/kafka.json', function (world) { return json(kafkaReport(world)); });
      route(w, 'status', 'GET', [], function (world) { return json(kafkaReport(world)); });
      route(w, 'pause-partition', 'POST', Object.keys(K_SCOPE), function (world, b) {
        var d = world.platform;
        if (!equal(b, K_SCOPE)) return fail('Scope must identify shipping-v1 shipment-requests partition 0 offset 201.');
        if (!ready(world) || d.quarantine) return fail('Capture evidence before the initial partition pause.');
        if (!d.paused) { d.paused = true; audit(world, 'PAUSE partition=0; partition=1 remains assigned'); }
        return 'Partition 0 paused; committed_next=201; no offsets reset';
      });
      route(w, 'quarantine', 'POST', Object.keys(K_SCOPE), function (world, b) {
        var d = world.platform;
        if (!equal(b, K_SCOPE)) return fail('Scope mismatch; quarantine exactly offset 201.');
        if (!ready(world)) return fail('Retained evidence and running consumer required.');
        if (d.quarantine) return json(d.quarantine);
        if (!d.paused || d.committed[0] !== 201) return fail('Pause partition 0 at committed-next 201 first.');
        d.quarantine = { original: copy(d.poison), durableId: 'DLQ-201', reason: 'units-not-integer' };
        d.committed[0] = 202;
        audit(world, 'QUARANTINE DLQ-201 source_offset=201 persisted before COMMIT next=202');
        return json(d.quarantine);
      });
      route(w, 'resume-partition', 'POST', Object.keys(K_SCOPE), function (world, b) {
        var d = world.platform;
        if (!equal(b, K_SCOPE)) return fail('Scope mismatch.');
        if (!ready(world) || !d.quarantine || !equal(d.quarantine.original, d.poison)) return fail('Durable original quarantine required before resume.');
        if (d.committed[0] === 202) {
          deliver(d, d.orders[2]); d.committed[0] = 203; d.paused = false;
          audit(world, 'RESUME partition=0 APPLIED SHIP-102 COMMIT next=203; SHIP-101 still outstanding');
        }
        return json(kafkaReport(world));
      });
      route(w, 'stage-correction', 'POST', Object.keys(K_REPAIR), function (world, b) {
        var d = world.platform;
        if (!equal(b, K_REPAIR)) return fail('Approved CORR-201 scope and source units=2 required.');
        if (!ready(world) || !d.quarantine || d.paused || d.committed[0] !== 203) return fail('Quarantine and drain the affected partition first.');
        if (!d.correction) { d.correction = { id: 'SHIP-101', units: 2 }; audit(world, 'CORRECTED COPY CORR-201; raw record unchanged'); }
        return json(d.correction);
      });
      route(w, 'replay', 'POST', ['eventId'], function (world, b) {
        var d = world.platform;
        if (b.eventId !== 'SHIP-101') return fail('Replay only preserved SHIP-101.');
        if (!ready(world) || !equal(d.correction, { id: 'SHIP-101', units: 2 }) || d.paused) return fail('Approved corrected copy and resumed partition required.');
        var result = deliver(d, d.correction);
        if (result === 'APPLIED') audit(world, 'REPLAY APPLIED SHIP-101 units=2 durable_event_id=SHIP-101');
        return result + ' SHIP-101; raw quarantine retained';
      });
      route(w, 'verify-replay', 'POST', [], function (world) {
        var d = world.platform;
        if (!ready(world) || !d.correction || !shipmentMatch(d)) return fail('All shipment IDs and quantities must reconcile after replay.');
        if (!d.replayProof) {
          var before = d.shipments.length, result = deliver(d, d.correction);
          d.replayProof = { eventId: 'SHIP-101', result: result, before: before, after: d.shipments.length };
          audit(world, 'REPLAY CHECK same event ID: before=5 after=5 result=' + result);
        }
        return json(d.replayProof);
      });
      route(w, 'verify-business', 'POST', [], function (world) {
        if (!kafkaHealthy(world)) return fail('Need zero partition lag, five unique shipments/eight units, retained quarantine and replay proof.');
        world.platform.receipt = copy(kafkaReport(world));
        return 'BUSINESS VERIFIED shipments=5 units=8 missing=0 duplicates=0 lag=0,0';
      });
      return w;
    },
    discoveries: [
      finding('k-lag', 'Only partition 0 is lagging; committed offset is the next record', '/sim/kafka/status', /"lag":\s*\[\s*2,\s*0/, true),
      finding('k-error', 'The same offset repeatedly fails integer validation while brokers are healthy', '/captured/kafka/consumer.log', /offset=201 ValidationError[\s\S]*broker_health=OK/, true),
      finding('k-record', 'The preserved event contains a string where v1 requires integer units', '/captured/kafka/record-201.json', /"offset": 201[\s\S]*"units": "two"/, true),
      finding('k-orders', 'Paid orders include SHIP-101 with two units', '/captured/kafka/orders.csv', /SHIP-101,2/, true),
      finding('k-correction', 'The owner approved a corrected copy with the original ID', '/captured/kafka/correction.txt', /CORR-201[\s\S]*source_order_units=2/, true),
      finding('k-replay', 'Replaying the same event creates no additional shipment', '/sim/kafka/verify-replay', /"result": "DEDUPLICATED"[\s\S]*"after": 5/),
      finding('k-business', 'All paid orders have one shipment and the partition has caught up', '/sim/kafka/verify-business', /BUSINESS VERIFIED shipments=5 units=8 missing=0 duplicates=0/)
    ],
    rootCauses: [{ text: 'The broker cluster lost every partition and must be reset.' },
      { text: 'A malformed units field at partition 0 offset 201 repeatedly fails application validation; no poison handling advances that partition.', correct: true },
      { text: 'The producer sent no shipment requests after offset 200.' },
      { text: 'A stopped consumer explains both partitions equally.' }],
    fix: { prompt: 'Preserve 201, recover its partition, replay the approved copy and reconcile all five shipments.', check: kafkaFixed, grade: grade(kafkaFixed) },
    hints: ['Compare lag by partition and distinguish consumer liveness from progress.',
      'Read /captured/kafka/consumer.log and /captured/kafka/record-201.json.',
      'The source order and CORR-201 justify two integer units; preserve the raw record.',
      'Follow /home/gsupport/runbook.txt through verify-replay and verify-business. Zero lag alone leaves an unfulfilled order.'],
    debrief: 'WHY IT HAPPENED\nThe v1 producer encoded units as a word. Application validation kept\n' +
      'retrying offset 201; partition 1 stayed current. A process heartbeat did\n' +
      'not establish shipment progress. In this fixture offsets are consecutive.\n\n' +
      'COMMAND SEQUENCE\nRead /home/gsupport/runbook.txt and /captured/kafka/*.\n' +
      'Capture -> pause partition -> durable quarantine -> resume/drain ->\n' +
      'stage CORR-201 -> replay -> verify-replay -> verify-business.\n\n' +
      'TRAP / TRADE-OFF\nKafka commits identify the next position. Commit only after the chosen\n' +
      'durable outcome. A reset to the end can hide two missing shipments.\n' +
      'Quarantine/replay and the shipment dedupe store are fictional application\n' +
      'controls, not Kafka built-ins or a universal exactly-once guarantee.\n' +
      'Only independent shipment creates may pass the quarantined record here.\n\n' +
      'INTERVIEW ANGLE\nExplain partition scope, evidence retention, restart offsets, and why\n' +
      'five unique shipment IDs/eight units plus duplicate-safe replay are\n' +
      'stronger verification than lag=0.\n' + sourceText([SOURCES.kafka, SOURCES.idempotency])
  });

  // Retry storm: bounded attempts at one layer; a durable key and payload are
  // stored atomically with each reservation in this fictional downstream.
  var R_POLICY = { maxAttempts: 2, retryLayer: 'worker', backoff: 'exponential', jitter: 'full',
    baseMs: 100, capMs: 1000, retryBudget: 2, concurrency: 2, idempotency: 'tenant+orderId' };
  var rInspect = ['cat /home/gsupport/runbook.txt', get('retry'), 'cat /captured/retry/trace.log',
    'cat /captured/retry/policy.json', 'cat /captured/retry/reservations.csv'];
  var rActions = [post('retry', 'capture'), post('retry', 'contain', { route: 'checkout-inventory' }),
    post('retry', 'apply-policy', R_POLICY), post('retry', 'drain-inflight'), post('retry', 'reconcile'),
    post('retry', 'retry-pending', { ids: ['ORD-102', 'ORD-103'] }),
    post('retry', 'probe-retry', { orderId: 'ORD-103', quantity: 1 }),
    post('retry', 'canary'), post('retry', 'reopen', { route: 'checkout-inventory' }), post('retry', 'verify-business')];
  function reserve(d, request) {
    var old = d.reservations.filter(function (r) { return r.tenant === request.tenant && r.id === request.id; })[0];
    if (old) return old.quantity === request.quantity ? 'DEDUPLICATED' : 'INTENT_MISMATCH';
    d.reservations.push(copy(request)); return 'APPLIED';
  }
  function reservationMatch(d, includeCanary) {
    var expected = d.requests.concat(includeCanary ? [d.canaryOrder] : []);
    return d.reservations.length === expected.length && expected.every(function (r) {
      return d.reservations.filter(function (s) { return s.id === r.id && s.tenant === r.tenant && s.quantity === r.quantity; }).length === 1;
    });
  }
  function retryReport(w) {
    var d = w.platform;
    return { route: 'checkout-inventory', traffic: d.held ? 'HELD' : 'OPEN', inFlight: d.inFlight,
      downstreamCapacity: 8, policy: d.policy, pending: d.pending, reservations: d.reservations,
      retryTokensUsed: d.tokensUsed, attempts: d.attempts, probe: d.probe, canary: d.canary };
  }
  function retryHealthy(w) {
    var d = w.platform;
    return ready(w) && !d.held && d.inFlight === 0 && equal(d.policy, R_POLICY) && d.reconciled &&
      d.pending.length === 0 && d.tokensUsed === 2 && reservationMatch(d, true) &&
      d.attempts.length === 4 && d.attempts.every(function (a) { return a.attempt <= d.policy.maxAttempts && a.waitMs <= d.policy.capMs; }) &&
      !!d.probe && d.probe.result === 'DEDUPLICATED' && d.probe.before === 3 && d.probe.after === 3 &&
      !!d.canary && d.canary.completed === 1 && d.canary.peakConcurrency <= d.policy.concurrency && d.canary.errors === 0;
  }
  function retryFixed(w) { return !!(retryHealthy(w) && w.platform.receipt && equal(w.platform.receipt, retryReport(w))); }
  PS.scenarios.push({ id: 'retry-storm-downstream-overload', title: 'Checkout retries cascade into inventory overload',
    severity: 'P1', desk: 'Commerce / Checkout Platform', host: 'platform-retry-01',
    tags: ['retry storm', 'backoff', 'jitter', 'idempotency', 'downstream overload'], par: 720, impactPerMin: 15000, currency: 'USD',
    brief: 'PAGER 10:00 - checkout times out while inventory is at its concurrency limit.\n' +
      'Both the gateway and worker retry aggressively. Some requests may already\n' +
      'have reserved stock despite their timeout. Investigate /captured/retry and\n' +
      '/home/gsupport/runbook.txt. Restore checkout without duplicate reservations.\n' +
      'All organisations, workload samples and HTTP admin controls are fictional.',
    sources: [SOURCES.retry, SOURCES.idempotency], walkthrough: rInspect.concat(rActions),
    build: function () {
      var requests = [{ tenant: 'shop-A', id: 'ORD-101', quantity: 1 }, { tenant: 'shop-A', id: 'ORD-102', quantity: 2 },
        { tenant: 'shop-A', id: 'ORD-103', quantity: 1 }];
      var w = base('retry', 'checkout-worker', 9762, {
        requests: requests, canaryOrder: { tenant: 'shop-A', id: 'ORD-104', quantity: 1 },
        reservations: copy([requests[0]]), pending: requests.map(function (r) { return r.id; }),
        policy: { maxAttempts: 5, retryLayer: 'gateway+worker', backoff: 'none', jitter: 'none',
          baseMs: 0, capMs: 0, retryBudget: 'unbounded', concurrency: 24, idempotency: 'new-key-per-attempt' },
        held: false, inFlight: 24, reconciled: false, attempts: [], tokensUsed: 0, probe: null, canary: null
      }, ['r-trace', 'r-policy', 'r-ledger'], boundary +
        'Finite incident cohort: ORD-101/102/103 for shop-A; canary ORD-104.\n' +
        'Five total attempts at each of two layers can produce 25 calls per\n' +
        'original request. Inventory accepts eight concurrent calls.\n' + rInspect.slice(1).join('\n') + '\n' +
        'Contain only checkout-inventory: hold new work and pause retry dispatch.\n' +
        'Install the approved bounded policy before drain-inflight samples the\n' +
        'completion of 24 outstanding read/admission calls (no new reservations).\n' +
        'Reconcile the authoritative reservation store BEFORE retrying: ORD-101\n' +
        'committed under its original key, but its response was lost.\n' +
        rActions.join('\n') + '\n' +
        'maxAttempts includes the initial call. retryBudget counts extra calls\n' +
        'for this finite recovery cohort. Full jitter samples are deterministic\n' +
        'virtual delays (37ms and 73ms); these APIs run a simulated workload,\n' +
        'not real network calls or elapsed wall-clock benchmarks. ORD-102 gets\n' +
        'one admission failure; ORD-103 commits then loses its first response.\n' +
        'The downstream atomically stores tenant+orderId, payload and reservation.\n' +
        'Same key/different quantity must fail; never make a new key on timeout.\n' +
        'Probe duplicates, run one canary, reopen, then verify four orders/five\n' +
        'units. No global purge, bulk reissue, or blanket service restart.\n' +
        'Live view: /var/lib/platform/retry.json\n' + sourceText([SOURCES.retry, SOURCES.idempotency]));
      file(w, '/captured/retry/trace.log', 'CAPTURED SYNTHETIC correlated request trace\n' +
        '09:57 inventory transient_latency_ms=700\n' +
        '09:58 gateway_attempts=5 worker_attempts=5 amplification=25 jitter=none\n' +
        '09:59 active_calls=24 capacity=8 admission_rejects=16\n' +
        '09:59 ORD-101 key=shop-A/ORD-101 COMMITTED response=LOST\n' +
        '10:00 remaining_active_calls=24 operation=read_or_admission no_new_reservations=true\n');
      file(w, '/captured/retry/policy.json', json({ provenance: 'CAPTURED SYNTHETIC deployed policy', policy: w.platform.policy }));
      file(w, '/captured/retry/reservations.csv', '# CAPTURED SYNTHETIC authoritative downstream export\ntenant,orderId,quantity,status\nshop-A,ORD-101,1,COMMITTED\n');
      file(w, '/var/lib/platform/retry.json', function (world) { return json(retryReport(world)); });
      route(w, 'status', 'GET', [], function (world) { return json(retryReport(world)); });
      route(w, 'contain', 'POST', ['route'], function (world, b) {
        if (b.route !== 'checkout-inventory') return fail('Scope must be checkout-inventory.');
        if (!ready(world) || world.platform.canary) return fail('Capture evidence before initial containment.');
        if (!world.platform.held) { world.platform.held = true; audit(world, 'CONTAIN checkout-inventory hold intake and pause retry dispatch'); }
        return 'checkout-inventory HELD; unrelated routes remain open';
      });
      route(w, 'apply-policy', 'POST', Object.keys(R_POLICY), function (world, b) {
        var d = world.platform;
        if (!equal(b, R_POLICY)) return fail('Approved bounded policy requires two total attempts, one retry layer, full jitter, two retry tokens, concurrency=2 and durable keys.');
        if (!ready(world) || !d.held) return fail('Contain checkout-inventory before changing retry policy.');
        if (!equal(d.policy, R_POLICY)) { d.policy = copy(R_POLICY); audit(world, 'POLICY bounded attempts=2 layer=worker jitter=full durable_idempotency=tenant+orderId'); }
        return json(d.policy);
      });
      route(w, 'drain-inflight', 'POST', [], function (world) {
        var d = world.platform;
        if (!ready(world) || !d.held || !equal(d.policy, R_POLICY)) return fail('Contain and apply the bounded policy before draining outstanding calls.');
        if (d.inFlight) { audit(world, 'DRAIN 24 read/admission calls completed; no new reservation; inFlight=0'); d.inFlight = 0; }
        return 'DRAINED inFlight=0 capacity=8';
      });
      route(w, 'reconcile', 'POST', [], function (world) {
        var d = world.platform;
        if (!ready(world) || !d.held || d.inFlight || !equal(d.policy, R_POLICY)) return fail('Bound retries and drain in-flight calls before reconciling ambiguous outcomes.');
        if (!d.reconciled) {
          if (!equal(d.reservations, [d.requests[0]])) return fail('Authoritative reservation must match ORD-101 quantity=1.');
          d.pending = ['ORD-102', 'ORD-103']; d.reconciled = true;
          audit(world, 'RECONCILE ORD-101 already COMMITTED; pending=ORD-102,ORD-103');
        }
        return 'RECONCILED ORD-101 committed despite timeout; pending=' + d.pending.join(',');
      });
      route(w, 'retry-pending', 'POST', ['ids'], function (world, b) {
        var d = world.platform;
        if (!Array.isArray(b.ids) || b.ids.length !== 2 || b.ids.slice().sort().join(',') !== 'ORD-102,ORD-103') return fail('Retry only the two reconciled pending IDs once each; no ALL or committed ORD-101.');
        if (!ready(world) || !d.held || !d.reconciled || d.inFlight || !equal(d.policy, R_POLICY)) return fail('Contain, bound, drain and reconcile before retry.');
        if (!d.attempts.length) {
          d.requests.slice(1).forEach(function (r, i) {
            // One retryable failure per order: pre-effect rejection vs lost reply.
            var first = i === 0 ? 'ADMISSION_REJECTED' : reserve(d, r) + '_RESPONSE_LOST';
            d.attempts.push({ id: r.id, attempt: 1, waitMs: 0, result: first });
            d.tokensUsed++;
            d.attempts.push({ id: r.id, attempt: 2, waitMs: i === 0 ? 37 : 73, result: reserve(d, r) });
          });
          d.pending = [];
          audit(world, 'RETRY pending only; two extra attempts; ORD-103 duplicate suppressed after lost reply');
        }
        return json(d.attempts);
      });
      route(w, 'probe-retry', 'POST', ['orderId', 'quantity'], function (world, b) {
        var d = world.platform;
        if (b.orderId !== 'ORD-103' || b.quantity !== 1) return fail('INTENT_MISMATCH: probe must reuse ORD-103 and original quantity=1.');
        if (!ready(world) || !d.held || d.pending.length || !reservationMatch(d, !!d.canary)) return fail('Finish pending reservations before the duplicate probe.');
        if (!d.probe) {
          var before = d.reservations.length, result = reserve(d, d.requests[2]);
          d.probe = { id: 'ORD-103', result: result, before: before, after: d.reservations.length };
          audit(world, 'PROBE ORD-103 duplicate suppressed; reservations remain=3');
        }
        return json(d.probe);
      });
      route(w, 'canary', 'POST', [], function (world) {
        var d = world.platform;
        if (!ready(world) || !d.held || d.inFlight || !d.probe || !equal(d.policy, R_POLICY)) return fail('Need bounded policy, drained calls and duplicate probe before canary.');
        if (!d.canary) {
          if (!reservationMatch(d, false)) return fail('Reconcile all three incident orders first.');
          var result = reserve(d, d.canaryOrder);
          d.canary = { id: 'ORD-104', completed: result === 'APPLIED' ? 1 : 0,
            peakConcurrency: Math.min(d.policy.concurrency, 1), errors: result === 'APPLIED' ? 0 : 1 };
          audit(world, 'CANARY ORD-104 one reservation; peak_concurrency=1 errors=0');
        }
        return json(d.canary);
      });
      route(w, 'reopen', 'POST', ['route'], function (world, b) {
        var d = world.platform;
        if (b.route !== 'checkout-inventory') return fail('Scope must be checkout-inventory.');
        if (!ready(world) || !d.canary || !d.probe || !reservationMatch(d, true) || d.inFlight || !equal(d.policy, R_POLICY)) return fail('Canary, duplicate proof and reconciled reservations required before reopening.');
        if (d.held) { d.held = false; audit(world, 'REOPEN checkout-inventory with bounded dispatch and durable keys'); }
        return 'OPEN checkout-inventory concurrency_limit=2 downstream_capacity=8';
      });
      route(w, 'verify-business', 'POST', [], function (world) {
        if (!retryHealthy(world)) return fail('Need open bounded traffic, zero outstanding calls and exactly four orders/five reserved units.');
        world.platform.receipt = copy(retryReport(world));
        return 'BUSINESS VERIFIED orders=4 reserved_units=5 duplicates=0 inFlight=0 traffic=OPEN';
      });
      return w;
    },
    discoveries: [
      finding('r-trace', 'Two retry layers amplify load and one timed-out request already committed', '/captured/retry/trace.log', /amplification=25[\s\S]*capacity=8[\s\S]*COMMITTED response=LOST/, true),
      finding('r-policy', 'Unbounded retry budget and new attempt keys compound downstream overload', '/captured/retry/policy.json', /"retryBudget": "unbounded"[\s\S]*"idempotency": "new-key-per-attempt"/, true),
      finding('r-ledger', 'ORD-101 already owns a durable stock reservation', '/captured/retry/reservations.csv', /shop-A,ORD-101,1,COMMITTED/, true),
      finding('r-reconcile', 'Reconciliation excludes the ambiguous committed request from replay', '/sim/retry/reconcile', /RECONCILED ORD-101 committed despite timeout/),
      finding('r-probe', 'The same order key does not create another reservation', '/sim/retry/probe-retry', /"result": "DEDUPLICATED"[\s\S]*"after": 3/),
      finding('r-business', 'All orders and the canary have exactly one reservation with traffic restored', '/sim/retry/verify-business', /BUSINESS VERIFIED orders=4 reserved_units=5 duplicates=0/)
    ],
    rootCauses: [{ text: 'Inventory has no stock, so increasing retries is the only recovery.' },
      { text: 'Every timeout guarantees the reservation failed and can be retried with a fresh key.' },
      { text: 'A latency spike triggered immediate retries at two layers beyond downstream capacity; changing keys also risks duplicate side effects.', correct: true },
      { text: 'The checkout worker is stopped, so a restart alone resolves the incident.' }],
    fix: { prompt: 'Contain the route, bound retries, reconcile timeouts and prove duplicate-safe reservations before reopening.', check: retryFixed, grade: grade(retryFixed) },
    hints: ['Correlate the two retry layers with inventory concurrency, not just the first timeout.',
      'Read /captured/retry/trace.log and the authoritative reservations.csv.',
      'ORD-101 committed. Reconcile before retrying ORD-102 and ORD-103 with stable keys.',
      'Use /home/gsupport/runbook.txt: contain, policy, drain, reconcile, retry, probe, canary, reopen, verify-business.'],
    debrief: 'WHY IT HAPPENED\nAn initial inventory slowdown met five attempts at both gateway and\n' +
      'worker. The multiplied load exhausted downstream concurrency. A timeout\n' +
      'also hid a successful reservation, making blind retries unsafe.\n\n' +
      'COMMAND SEQUENCE\nRead /captured/retry and /home/gsupport/runbook.txt. Capture, contain\n' +
      'checkout-inventory, apply-policy, drain-inflight, reconcile, retry-pending,\n' +
      'probe-retry, canary, reopen and verify-business.\n\n' +
      'TRAP / TRADE-OFF\nLimit total attempts and concurrency, use one retry layer, and spread\n' +
      'retries with capped backoff and jitter. A stable caller key plus atomic\n' +
      'payload/result storage prevents duplicate effects; changing intent under\n' +
      'the same key is an error. The two-token budget, virtual delay samples\n' +
      'and localhost admin API are fixture choices, not AWS service controls.\n\n' +
      'INTERVIEW ANGLE\nDescribe containment versus capacity, ambiguous outcomes, retry budgets,\n' +
      'and customer verification: four order IDs, five reserved units, no\n' +
      'duplicates, a successful canary, and restored bounded traffic.\n' + sourceText([SOURCES.retry, SOURCES.idempotency])
  });

  // Deployment rollback preserves the two serving replicas while replacing one
  // broken replica. Deterministic observation advances the real world tick hook.
  var D_SCOPE = { namespace: 'storefront', deployment: 'catalog-api' };
  var D_ROLLBACK = { namespace: 'storefront', deployment: 'catalog-api', from: 42, to: 41, digest: 'sha256:catalog41' };
  var dInspect = ['cat /home/gsupport/runbook.txt', get('deploy'), 'cat /captured/deploy/events.log',
    'cat /captured/deploy/revision-42.yaml', 'cat /captured/deploy/revision-41.yaml',
    'cat /captured/deploy/compatibility.txt', 'cat /captured/deploy/business.csv'];
  var dActions = [post('deploy', 'capture'), post('deploy', 'pause-rollout', D_SCOPE),
    post('deploy', 'check-rollback'), post('deploy', 'rollback', D_ROLLBACK),
    post('deploy', 'observe', { seconds: 150 }), post('deploy', 'verify-probes'),
    post('deploy', 'resume-rollout', D_SCOPE), post('deploy', 'verify-business')];
  function probeState(p, dependency) {
    var started = p.age >= p.warmup;
    if (!started && p.startupBudget > 0) return { startup: 503, liveness: 'SUPPRESSED', readiness: 'SUPPRESSED' };
    return { startup: started ? 200 : 503, liveness: p.livePath === '/live' ? 200 : (started && dependency ? 200 : 503),
      readiness: started && dependency ? 200 : 503 };
  }
  function deployReport(w) {
    var d = w.platform;
    return { namespace: 'storefront', deployment: 'catalog-api', revision: d.revision,
      rolloutPaused: d.paused, desired: 3, ready: d.pods.filter(function (p) { return probeState(p, d.dependency).readiness === 200; }).length,
      pods: d.pods.map(function (p) { return { name: p.name, revision: p.revision, restarts: p.restarts,
        age: p.age, stableSeconds: p.stable, probes: probeState(p, d.dependency) }; }),
      rollbackCheck: d.rollbackCheck, probeProof: d.probeProof, responses: d.responses };
  }
  function stableDeploy(w) {
    var d = w.platform;
    return ready(w) && d.revision === 41 && d.dependency && d.pods.length === 3 && d.pods.every(function (p) {
      return p.revision === 41 && p.digest === 'sha256:catalog41' && p.livePath === '/live' && p.readyPath === '/ready' &&
        p.startupBudget === 120 && p.warmup === 75 && p.age >= 75 && p.stable >= 60 && p.restarts === 0 && probeState(p, true).readiness === 200;
    });
  }
  function deployHealthy(w) {
    var d = w.platform;
    return stableDeploy(w) && !d.paused && d.rollbackCheck && d.rollbackCheck.schemaCompatible &&
      !!d.probeProof && d.probeProof.dependencyOutageReady === 2 && d.probeProof.restartsAdded === 0 && d.probeProof.restoredReady === 3 &&
      d.responses.length === d.orders.length && d.orders.every(function (o) {
        return d.responses.filter(function (r) { return r.id === o.id && r.status === 200 && r.total === o.quantity * o.unitPrice && r.revision === 41; }).length === 1;
      });
  }
  function deployFixed(w) {
    var d = w.platform;
    // Ages keep increasing after closure; receipt binds stable identity/results,
    // while stableDeploy continuously rechecks probes, readiness and restarts.
    return !!(deployHealthy(w) && d.receipt && equal(d.receipt, { revision: d.revision,
      pods: d.pods.map(function (p) { return p.name; }), responses: d.responses, proof: d.probeProof }));
  }
  PS.scenarios.push({ id: 'bad-deploy-probe-restart-loop', title: 'Catalog deployment loops on health probes before it can warm up',
    severity: 'P1', desk: 'Commerce / Runtime Platform', host: 'platform-deploy-01',
    tags: ['deployment', 'readiness', 'liveness', 'startup probe', 'rollback'], par: 720, impactPerMin: 14000, currency: 'USD',
    brief: 'PAGER 10:00 - catalog revision 42 keeps restarting and checkout previews\n' +
      'return 503. Two old replicas still serve; the replacement never becomes\n' +
      'ready. Inspect the synthetic captured exports at /captured/deploy and\n' +
      '/home/gsupport/runbook.txt. Restore a compatible revision, establish a\n' +
      'stable observation window, and verify customer totals. HTTP APIs are fictional.',
    sources: [SOURCES.probes], walkthrough: dInspect.concat(dActions),
    build: function () {
      function goodPod(name, age) { return { name: name, revision: 41, digest: 'sha256:catalog41',
        age: age, warmup: 75, startupBudget: 120, livePath: '/live', readyPath: '/ready', restarts: 0, stable: Math.max(0, age - 75) }; }
      var w = base('deploy', 'catalog-controller', 9763, {
        revision: 42, paused: false, dependency: true, rollbackCheck: null, probeProof: null, responses: [],
        orders: [{ id: 'CART-501', quantity: 2, unitPrice: 25 }, { id: 'CART-502', quantity: 1, unitPrice: 80 }],
        pods: [goodPod('catalog-41-a', 900), goodPod('catalog-41-b', 900),
          { name: 'catalog-42-c', revision: 42, digest: 'sha256:catalog42', age: 10, warmup: 75,
            startupBudget: 0, livePath: '/ready', readyPath: '/ready', restarts: 20, stable: 0 }]
      }, ['d-events', 'd-bad', 'd-good', 'd-schema', 'd-orders'], boundary +
        'Scope: namespace storefront / deployment catalog-api only.\n' + dInspect.slice(1).join('\n') + '\n' +
        'Pause rollout before evaluating rollback. Revision 41 is retained and\n' +
        'approved; schema v8 remains backward compatible and no irreversible\n' +
        'migration occurred. check-rollback verifies this captured contract.\n' +
        'Rollback preserves the two ready replicas and replaces only catalog-42-c.\n' +
        dActions.join('\n') + '\n' +
        'observe advances virtual time by 1..300 seconds using the world tick.\n' +
        'The replacement warms for 75 seconds under its 120-second startup\n' +
        'budget, then needs 60 seconds of readiness with no new restarts.\n' +
        '150 seconds supplies both; a process existing or one passing probe\n' +
        'does not. verify-probes models a 60-second dependency outage on the\n' +
        'replacement: readiness removes its endpoint, /live keeps it running,\n' +
        'then dependency recovery restores readiness. This controlled virtual\n' +
        'probe test does not fault a real dependency. Resume only after it passes.\n' +
        'verify-business executes CART-501 and CART-502 against the recovered\n' +
        'catalog and verifies totals 50 and 80. No kubectl is implemented; read\n' +
        'the captured exports. Do not disable probes, delete all pods, or deploy\n' +
        'an unapproved revision. Live view: /var/lib/platform/deploy.json\n' + sourceText([SOURCES.probes]));
      file(w, '/captured/deploy/events.log', 'CAPTURED SYNTHETIC kubelet event/log export 10:00\n' +
        'catalog-42-c warmup_required_seconds=75 database_reachable=true\n' +
        'Warning Unhealthy Liveness probe failed: GET /ready returned 503\n' +
        'Killing container after 3 failures periodSeconds=10; age=30s\n' +
        'restartCount=20 Ready=False OOMKilled=false image_pull=OK\n');
      file(w, '/captured/deploy/revision-42.yaml', '# CAPTURED SYNTHETIC revision 42 rendered configuration\n' +
        'image: catalog@sha256:catalog42\nstartupProbe: null\nlivenessProbe:\n  path: /ready\n  periodSeconds: 10\n  failureThreshold: 3\n' +
        'readinessProbe:\n  path: /ready\n# /ready needs warm cache and database; /live checks process progress\n');
      file(w, '/captured/deploy/revision-41.yaml', '# CAPTURED SYNTHETIC approved revision 41 rendered configuration\n' +
        'image: catalog@sha256:catalog41\nstartupProbe:\n  path: /started\n  periodSeconds: 10\n  failureThreshold: 12\n' +
        'livenessProbe:\n  path: /live\nreadinessProbe:\n  path: /ready\n# cache warmup=75s; startup budget=120s\n');
      file(w, '/captured/deploy/compatibility.txt', 'CAPTURED SYNTHETIC release-owner rollback approval CHG-CATALOG-41\n' +
        'namespace=storefront deployment=catalog-api from=42 to=41\n' +
        'retained_digest=sha256:catalog41 schema=v8 backward_compatible=true irreversible_migration=false\n');
      file(w, '/captured/deploy/business.csv', '# CAPTURED SYNTHETIC customer preview expectations\nid,quantity,unitPrice,expectedTotal\nCART-501,2,25,50\nCART-502,1,80,80\n');
      file(w, '/var/lib/platform/deploy.json', function (world) { return json(deployReport(world)); });
      w.tick = function (world, seconds) {
        if (!alive(world)) return;
        world.platform.pods.forEach(function (p) {
          var elapsed = p.age + seconds;
          if (p.revision === 42) { p.restarts += Math.floor(elapsed / 30); p.age = elapsed % 30; p.stable = 0; }
          else { p.age = elapsed; p.stable = world.platform.dependency ? Math.max(0, elapsed - p.warmup) : 0; }
        });
      };
      route(w, 'status', 'GET', [], function (world) { return json(deployReport(world)); });
      route(w, 'pause-rollout', 'POST', Object.keys(D_SCOPE), function (world, b) {
        var d = world.platform;
        if (!equal(b, D_SCOPE)) return fail('Scope must be storefront/catalog-api.');
        if (!ready(world) || d.revision !== 42) return fail('Capture the broken deployment before initial rollout pause.');
        if (!d.paused) { d.paused = true; audit(world, 'PAUSE rollout; retained ready replicas=2'); }
        return 'Rollout paused; existing healthy replicas retained';
      });
      route(w, 'check-rollback', 'POST', [], function (world) {
        var d = world.platform;
        if (!ready(world) || !d.paused) return fail('Capture evidence and pause rollout before compatibility check.');
        if (!d.rollbackCheck) {
          d.rollbackCheck = { from: 42, to: 41, digest: 'sha256:catalog41', schemaCompatible: true, irreversibleMigration: false };
          audit(world, 'CHECK rollback 42->41 retained digest and schema v8 compatibility verified');
        }
        return json(d.rollbackCheck);
      });
      route(w, 'rollback', 'POST', Object.keys(D_ROLLBACK), function (world, b) {
        var d = world.platform;
        if (!equal(b, D_ROLLBACK)) return fail('Rollback scope/revision/digest must match approved 42->41.');
        if (!ready(world) || !d.paused || !d.rollbackCheck || !d.rollbackCheck.schemaCompatible) return fail('Pause and verify rollback compatibility before replacement.');
        if (d.revision === 42) {
          d.pods[2] = goodPod('catalog-41-c', 0); d.revision = 41; d.probeProof = null; d.receipt = null;
          audit(world, 'ROLLBACK replace catalog-42-c only; startup=120s live=/live ready=/ready; two serving replicas retained');
        }
        return json(deployReport(world));
      });
      route(w, 'observe', 'POST', ['seconds'], function (world, b) {
        if (typeof b.seconds !== 'number' || b.seconds % 1 || b.seconds < 1 || b.seconds > 300) return fail('Observation seconds must be an integer from 1 to 300.');
        if (!ready(world) || !world.platform.paused || world.platform.revision !== 41) return fail('Rollback while paused before observing the replacement.');
        W.advance(world, b.seconds);
        audit(world, 'OBSERVE virtual seconds=' + b.seconds + ' ready=' + deployReport(world).ready);
        return json(deployReport(world));
      });
      route(w, 'verify-probes', 'POST', [], function (world) {
        var d = world.platform;
        if (!stableDeploy(world) || !d.paused) return fail('Need three ready replicas and 60 stable seconds after warmup with no replacement restarts.');
        if (!d.probeProof) {
          var replacement = d.pods[2], fault = probeState(replacement, false), restored = probeState(replacement, true);
          // Model six ten-second probes; only liveness failure restarts a pod.
          var failedLiveness = fault.liveness === 200 ? 0 : 6;
          d.probeProof = { dependencyOutageSeconds: 60, dependencyOutageReady: fault.readiness === 503 ? 2 : 3,
            livenessDuringOutage: fault.liveness, restartsAdded: Math.floor(failedLiveness / 3),
            restoredReady: restored.readiness === 200 ? 3 : 2 };
          audit(world, 'PROBE TEST dependency unavailable: readiness endpoints=2 liveness=200 restarts_added=0; restored endpoints=3');
        }
        return json(d.probeProof);
      });
      route(w, 'resume-rollout', 'POST', Object.keys(D_SCOPE), function (world, b) {
        var d = world.platform;
        if (!equal(b, D_SCOPE)) return fail('Scope must be storefront/catalog-api.');
        if (!stableDeploy(world) || !d.probeProof || d.probeProof.restartsAdded !== 0 || d.probeProof.restoredReady !== 3) return fail('Stable observation and dependency probe verification required before resume.');
        if (d.paused) { d.paused = false; audit(world, 'RESUME desired revision=41 available=3 restart_delta=0'); }
        return 'Rollout resumed at approved revision 41; ready=3 restart_delta=0';
      });
      route(w, 'verify-business', 'POST', [], function (world) {
        var d = world.platform;
        if (!stableDeploy(world) || d.paused || !d.probeProof || d.probeProof.restartsAdded !== 0) return fail('Restore stable probes and resume rollout before customer verification.');
        // Requests are executed against the restored revision's catalog prices.
        if (!d.responses.length) {
          var catalog = { 'CART-501': 25, 'CART-502': 80 };
          d.responses = d.orders.map(function (o) { return { id: o.id, status: 200, total: catalog[o.id] * o.quantity, revision: d.revision }; });
          audit(world, 'BUSINESS requests CART-501=50 CART-502=80 HTTP=200 revision=41');
        }
        if (!deployHealthy(world)) return fail('Customer responses do not match both captured order totals.');
        d.receipt = copy({ revision: d.revision, pods: d.pods.map(function (p) { return p.name; }), responses: d.responses, proof: d.probeProof });
        return 'BUSINESS VERIFIED CART-501=50 CART-502=80 status=200 ready=3 restart_delta=0';
      });
      return w;
    },
    discoveries: [
      finding('d-events', 'Liveness kills at 30 seconds before the 75-second warmup; this is not an OOM', '/captured/deploy/events.log', /warmup_required_seconds=75[\s\S]*age=30s[\s\S]*OOMKilled=false/, true),
      finding('d-bad', 'Revision 42 removed startup protection and pointed liveness at readiness', '/captured/deploy/revision-42.yaml', /startupProbe: null[\s\S]*livenessProbe:\s*path: \/ready/, true),
      finding('d-good', 'Revision 41 has a sufficient startup budget and separate health semantics', '/captured/deploy/revision-41.yaml', /failureThreshold: 12[\s\S]*path: \/live[\s\S]*path: \/ready/, true),
      finding('d-schema', 'A retained approved revision remains compatible with the database schema', '/captured/deploy/compatibility.txt', /sha256:catalog41[\s\S]*backward_compatible=true irreversible_migration=false/, true),
      finding('d-orders', 'Customer previews must return totals 50 and 80', '/captured/deploy/business.csv', /CART-501,2,25,50[\s\S]*CART-502,1,80,80/, true),
      finding('d-probes', 'Dependency failure changes readiness without restarting the process', '/sim/deploy/verify-probes', /"dependencyOutageReady": 2[\s\S]*"restartsAdded": 0[\s\S]*"restoredReady": 3/),
      finding('d-business', 'Both customer previews succeed with three stable ready replicas', '/sim/deploy/verify-business', /BUSINESS VERIFIED CART-501=50 CART-502=80 status=200 ready=3/)
    ],
    rootCauses: [{ text: 'An OOM kill requires removing every memory limit.' },
      { text: 'Readiness failures inherently restart Kubernetes containers.' },
      { text: 'Revision 42 removed the startup probe and used dependency/warmup readiness as liveness, killing the container before initialization completes.', correct: true },
      { text: 'A missing image prevents all three replicas from starting.' }],
    fix: { prompt: 'Preserve exports, pause rollout, check compatibility, restore revision 41 and verify stable probes and customer results.', check: deployFixed, grade: grade(deployFixed) },
    hints: ['Compare restart timing with required cache warmup; check the termination reason.',
      'Read both rendered revisions under /captured/deploy. Readiness and liveness have different effects.',
      'The retained revision is approved only after schema compatibility is checked while rollout is paused.',
      'Follow the runbook through observe 150 seconds, verify-probes, resume-rollout and verify-business.'],
    debrief: 'WHY IT HAPPENED\nRevision 42 used /ready for liveness and removed startup protection.\n' +
      'Three ten-second failures killed a worker requiring 75 seconds to warm.\n' +
      'Readiness failure removes traffic eligibility; it does not itself restart\n' +
      'a container. The captured exit evidence rules out an OOM or image error.\n\n' +
      'COMMAND SEQUENCE\nRead /captured/deploy and /home/gsupport/runbook.txt. Capture -> pause\n' +
      'rollout -> check compatibility -> rollback 42 to 41 -> observe 150\n' +
      'virtual seconds -> verify-probes -> resume-rollout -> verify-business.\n\n' +
      'TRAP / TRADE-OFF\nStartup probes protect initialization by gating other probes. Liveness\n' +
      'checks process progress; readiness includes required dependencies. An\n' +
      'unready process can recover without a restart. This approved rollback\n' +
      'preserves serving replicas and is safe only with its compatible schema.\n' +
      'The captured YAML excerpts, observation API, timings and controlled\n' +
      'dependency probe experiment are synthetic fixture mechanisms.\n\n' +
      'INTERVIEW ANGLE\nState what each probe proves, establish a restart-free observation\n' +
      'window, and verify actual customer response totals after recovery.\n' + sourceText([SOURCES.probes])
  });
})(PS);
