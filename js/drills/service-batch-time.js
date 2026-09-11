/* Sources: upstream systemd documentation, NTP ntpq documentation and the
 * local simulator command contract. Scheduler terminology is product-specific. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  function task(short, ask, answer, solution, hint, teaches) {
    return { short: short, ask: ask, answer: answer, solution: solution, hint: hint, teaches: teaches };
  }
  PS.drills.push({
    id: 'service-batch-time', title: 'Services, batch, DNS and time',
    topic: 'systemctl · journalctl · autorep · nslookup · ntpq', host: 'ldn-batch-lab',
    tags: ['systemctl', 'journalctl', 'DNS', 'ntpq', 'batch dependency', 'reconciliation'],
    brief: 'The morning support checks show a running gateway but a failed pricing service and a blocked valuation batch.\nUse service, resolver, time and scheduler evidence together.\nAutosys-style commands are included for practice; real scheduler statuses and rerun procedures depend on your platform.',
    build: function () {
      var now = new Date(2026, 8, 11, 8, 10);
      return W.create({ host: 'ldn-batch-lab', clock: now,
        root: V.dir({ tmp: V.dir({}), home: V.dir({ gsupport: V.dir({}) }),
          etc: V.dir({
            'resolv.conf': V.file('search prod.example\nnameserver 10.20.0.53\n'),
            hosts: V.file('127.0.0.1 localhost\n10.20.10.20 pricing-db\n'),
            'batch.cron': V.file('CRON_TZ=UTC\n15 6 * * 1-5 /opt/batch/run-prices.sh\n')
          }),
          batch: V.dir({
            'prices.log': V.file('06:15:01 INFO business_date=20260911 input=/data/prices_20260911.csv\n06:15:02 ERROR control_total expected=1200 received=1198\n06:15:02 ERROR validation failed exit=12; downstream not released\n'),
            'runbook.txt': V.file('batch-rerun=check partial outputs, transaction boundaries and idempotency before approved rerun\nreconcile-key=business date\nservice-enabled=boot activation policy\nservice-active=current runtime state\nDNS-NXDOMAIN=name does not exist in the queried DNS view\nDNS-scope=nslookup queries DNS; application resolution may also use NSS hosts and cache\nntpq-offset-unit=milliseconds\nntpq-reach-base=octal\ncron-fields=minute hour day-of-month month day-of-week\ncron-environment=explicit PATH, working directory, credentials and time zone\nrecovery-success=business reconciliation\n')
          }) }),
        procs: [W.proc({ pid: 2200, user: 'appsvc', cmd: '/opt/gateway/bin/gateway', short: 'gateway' })],
        sockets: [{ pid: 2200, proto: 'tcp', local: '0.0.0.0:9310', peer: '0.0.0.0:*', state: 'LISTEN', fd: 8 }],
        services: {
          gateway: { active: true, pid: 2200, exe: 'gateway', desc: 'Order Gateway', log: ['session logon successful', 'readiness passed'] },
          pricing: { active: false, pid: 0, desc: 'Pricing Service', log: ['ERROR cannot read /etc/pricing/curve.conf: Permission denied', 'Main process exited, code=exited, status=1/FAILURE'] }
        },
        hosts: { 'pricing-db': { ip: '10.20.10.20', ports: [5432], rtt: 0.4 } },
        ntp: { peers: [{ remote: '10.20.0.10', refid: '.GPS.', stratum: 1, selected: true, when: 12, poll: 64, reach: 377, delay: 0.7, offset: -2.5, jitter: 0.2 }] },
        jobs: [
          { name: 'LOAD_PRICES', status: 'FA', exitCode: 12, condition: 's(RECEIVE_PRICES)', command: '/opt/batch/load-prices.sh', note: 'validation failed: expected 1200 records, received 1198' },
          { name: 'VALUATION', status: 'AC', exitCode: null, condition: 's(LOAD_PRICES)', command: '/opt/batch/valuation.sh' },
          { name: 'RECEIVE_PRICES', status: 'SU', exitCode: 0, command: '/opt/batch/receive-prices.sh' }
        ]
      });
    },
    tasks: [
      task('Check gateway runtime state', 'What runtime state does systemctl report for gateway?', 'active',
        'systemctl is-active gateway', 'is-active is the direct runtime-state query.',
        'An active service has satisfied its unit activation semantics; it does not prove end-to-end business readiness. Check dependencies, application readiness and actual workflow outcomes.'),
      task('Find the failed service', 'Which service is failed: gateway or pricing?', 'pricing',
        'systemctl list-units', 'Compare the ACTIVE state in the service list.',
        'Active and enabled are different: runtime state versus boot activation policy. A service can be enabled and currently failed, or active without being enabled.'),
      task('Read the startup failure', 'What error prevented pricing from reading its configuration?', 'Permission denied',
        'journalctl -u pricing -n 10', 'Filter the journal to the failing service.',
        'Start with the earliest meaningful error and correlate deployment time, effective account, path permissions, ACLs and policy. Repeated restarts do not repair a permission fault.'),
      task('Identify the gateway PID', 'Which PID owns the TCP listener on 9310?', '2200',
        'ss -nptl | grep 9310', '-nptl means numeric, process, TCP, listening; short-option order is flexible.',
        'ss -nptl and ss -tlnp select the same flags. The listener proves a socket is bound, not that FIX Logon or business processing succeeds. Process information can require elevated permissions.'),
      task('Read the configured resolver', 'What nameserver is configured in the supplied resolv.conf?', '10.20.0.53',
        'grep nameserver /etc/resolv.conf', 'Inspect the local resolver configuration.',
        'Modern hosts may point resolv.conf at a local stub or use split DNS. Establish the actual resolver path before deciding which server or network path failed.'),
      task('Resolve the database name', 'What address does the DNS fixture return for pricing-db?', '10.20.10.20',
        'nslookup pricing-db', 'Query the name rather than guessing from a port failure.',
        'nslookup queries DNS. Applications can resolve through NSS, /etc/hosts, caches or service discovery; on a real host compare getent hosts and resolver-specific tools when results disagree.'),
      task('Classify a missing DNS name', 'What DNS result is reported for unknown-pricing?', 'NXDOMAIN',
        'nslookup unknown-pricing', 'Read the returned DNS failure type.',
        'NXDOMAIN indicates the queried name does not exist in that DNS view. It differs from timeout or SERVFAIL. Check spelling, search domains, split DNS and caching before changing records.'),
      task('Check a database TCP port', 'Which configured database TCP port accepts a connection?', '5432',
        'nc -zv pricing-db 5432', 'Use the port probe and read its result.',
        'A successful TCP probe establishes transport reachability. It does not validate database authentication, query execution, connection-pool health or transaction completion.'),
      task('Read the selected time peer', 'Which NTP peer is marked as selected?', '10.20.0.10',
        'ntpq -pn', 'The selected peer has a leading asterisk.',
        'NTP tooling depends on the installed daemon; ntpq and chronyc are not interchangeable output formats. Inspect selection, reachability, offset and trend rather than trusting wall-clock display alone.'),
      task('Interpret NTP offset units', 'What units does classic ntpq use for the displayed offset?', 'milliseconds',
        'grep ntpq-offset-unit /batch/runbook.txt', 'This is a units question; use the provided ntpq note.',
        'The example offset is -2.500 milliseconds. Interpret precision and limits under your venue and monitoring requirements; do not step a production trading clock as an ad hoc repair.'),
      task('Interpret NTP reach notation', 'In which number base is the classic ntpq reach register displayed?', 'octal',
        'grep ntpq-reach-base /batch/runbook.txt', '377 is a bit-history display, not a percentage.',
        'Reach is an eight-bit history displayed in octal. 377 means the last eight polls were successful; it alone does not prove acceptable synchronization accuracy.'),
      task('Read the failed batch exit', 'What exit code does LOAD_PRICES report?', '12',
        'autorep -J LOAD_PRICES -q', 'Use the detailed scheduler report.',
        'A nonzero exit code is application-specific. Read the job log and its documented meaning; scheduler failure is a symptom, not a reason to force downstream jobs to success.'),
      task('Find the blocked dependency', 'Which job must succeed before VALUATION can start?', 'LOAD_PRICES',
        'autorep -J VALUATION -q', 'Read the Conditions expression.',
        'A waiting job may be healthy while an upstream condition is unsatisfied. Follow the dependency chain and the business schedule; bypassing dependencies can publish incomplete positions or valuations.'),
      task('Check a control-total break', 'How many records did LOAD_PRICES actually receive?', '1198',
        'grep control_total /batch/prices.log', 'Compare expected and received counts.',
        'The two-record shortfall requires completeness investigation. Also compare business date, checksums, amount totals, duplicates and rejected rows; a count match alone does not establish correctness.'),
      task('Read the schedule time zone', 'What time zone does the supplied cron example specify?', 'UTC',
        'cat /etc/batch.cron', 'Check CRON_TZ before reading the five schedule fields.',
        'This example runs at 06:15 Monday-Friday in a cron implementation supporting CRON_TZ. Weekdays are not a trading-holiday calendar. Cron support and DST behavior vary, so verify the installed scheduler and environment.'),
      task('Define recovery completion', 'What validation does the runbook require before declaring batch recovery successful?', 'business reconciliation',
        'grep recovery-success /batch/runbook.txt', 'Read the recovery-success line.',
        'Before a rerun, inspect partial writes, locks, checkpoints, idempotency and dependencies. Afterward, reconcile business date and outputs, confirm downstream completion and monitoring, and record the recovery evidence.')
    ],
    wrapUp: 'Cross-check runtime state, listeners, DNS, time and dependency evidence. A green process or successful TCP handshake is only one layer. For batch recovery, establish the business date, missing inputs, partial effects and safe rerun plan; then verify business reconciliation and downstream completion.'
  });
})(PS);
