/* Scenario: clients cannot establish FIX sessions eight minutes before the open.
 *
 * TCP connects and then dies. That single observation rules out the network and
 * points above it. The certificate expired at midnight; a renewed one was
 * approved and staged a week ago and never deployed.
 *
 * Two traps: restarting rather than reloading drops the sessions that are still
 * up, and "just disable certificate verification to get them trading" turns an
 * availability incident into a security one.
 */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.scenarios = PS.scenarios || [];

  var GB = 1073741824, MB = 1048576;

  PS.scenarios.push({
    id: 'tls-cert-expiry-open',
    title: 'Clients cannot connect, eight minutes to the open',
    severity: 'P1',
    desk: 'Electronic Trading / Client Connectivity',
    host: 'ldn-fixgw-prod09',
    tags: ['TLS', 'certificate expiry', 'openssl', 'reload vs restart', 'change management'],
    par: 420,
    impactPerMin: 64000,
    currency: 'GBP',

    sources: [
      { title: 'OpenSSL x509 command - reading certificate validity dates', url: 'https://docs.openssl.org/1.1.1/man1/x509/' },
      { title: 'OpenSSL s_client - probing what a server presents', url: 'https://docs.openssl.org/1.1.1/man1/s_client/' }
    ],

    brief:
      'PAGER 07:52 - from Client Services, with three clients already on the phone\n\n' +
      '"None of our external FIX clients can get a session up this morning. They\n' +
      'say the connection opens and then closes immediately. Two sessions that\n' +
      'were up overnight are still working.\n\n' +
      'Network say the port is open and they can see the TCP connections\n' +
      'establishing, so it is not them."\n\n' +
      'The open is at 08:00. One of the clients has asked whether we can "turn\n' +
      'the encryption off for now" so they can start trading.',

    build: function () {
      var t0 = new Date(2026, 8, 11, 7, 52, 10);
      var ago = function (s) { return new Date(t0.getTime() - s * 1000); };
      var midnight = new Date(2026, 8, 11, 0, 0, 0);

      var gwLog = [];
      [600, 480, 360, 240, 120, 40].forEach(function (sec, i) {
        var d = ago(sec);
        gwLog.push(W.isoStamp(d, true) + ' INFO  [acceptor] Gateway - accepted connection from 198.51.100.4' + (4 + i % 3) + ':5' + (2104 + i));
        gwLog.push(W.isoStamp(new Date(d.getTime() + 12), true) + ' ERROR [acceptor] Gateway - TLS handshake failed for 198.51.100.4' + (4 + i % 3));
        gwLog.push('javax.net.ssl.SSLHandshakeException: java.security.cert.CertificateExpiredException: NotAfter: ' + W.dateStr(midnight));
        gwLog.push('\tat sun.security.ssl.Alert.createSSLException(Alert.java:131)');
        gwLog.push(W.isoStamp(new Date(d.getTime() + 14), true) + ' INFO  [acceptor] Gateway - connection closed, no FIX session established');
      });
      gwLog.unshift(W.isoStamp(ago(7200), true) + ' INFO  [main] Gateway - 2 sessions carried over from previous trading day');

      var root = V.dir({
        apps: V.dir({
          fixgw: V.dir({
            conf: V.dir({
              'gateway.properties': V.file(
                'fix.port=9443\nadmin.port=9610\n' +
                'tls.enabled=true\n' +
                'tls.cert=/apps/fixgw/certs/live/fixgw.crt\n' +
                'tls.key=/apps/fixgw/certs/live/fixgw.key\n' +
                'tls.client.auth=required\n',
                { owner: 'fixadm', mtime: ago(86400 * 200) })
            }),
            certs: V.dir({
              live: V.dir({
                'fixgw.crt': V.file('-----BEGIN CERTIFICATE-----\nMIIFazCCA1OgAwIBAgIUY0Zk...\n-----END CERTIFICATE-----\n',
                  { owner: 'fixadm', group: 'fixadm', mode: '-rw-r--r--', mtime: new Date(2025, 8, 10, 9, 0, 0), size: 2114 }),
                'fixgw.key': V.file('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq...\n-----END PRIVATE KEY-----\n',
                  { owner: 'fixadm', group: 'fixadm', mode: '-r--------', mtime: new Date(2025, 8, 10, 9, 0, 0), size: 1704 })
              }),
              staged: V.dir({
                'fixgw.crt': V.file('-----BEGIN CERTIFICATE-----\nMIIFazCCA1OgAwIBAgIUA1b9...\n-----END CERTIFICATE-----\n',
                  { owner: 'fixadm', group: 'fixadm', mode: '-rw-r--r--', mtime: new Date(2026, 8, 4, 11, 20, 0), size: 2140 }),
                'README.txt': V.file(
                  'Renewed gateway certificate for CHG-9041.\n' +
                  'Issued 2026-09-04, valid to 2027-09-04. Same key pair - the CSR was\n' +
                  'generated from /apps/fixgw/certs/live/fixgw.key, so no key change is\n' +
                  'required and the private key must NOT be replaced.\n' +
                  'Verify the modulus matches the live key before installing.\n',
                  { owner: 'fixadm', mtime: new Date(2026, 8, 4, 11, 22, 0) })
              })
            })
          })
        }),
        control: V.dir({
          'CHG-9041.txt': V.file(
            'CHANGE RECORD CHG-9041\n' +
            'Title:     Renew TLS certificate on ldn-fixgw-prod09\n' +
            'Raised:    2026-09-02   Approved: 2026-09-03 (CAB)\n' +
            'Window:    2026-09-06 06:00-08:00 London\n' +
            'Status:    APPROVED - NOT IMPLEMENTED\n' +
            'Note:      Implementation deferred on 2026-09-06 (engineer unavailable).\n' +
            '           Certificate expires 2026-09-11 00:00. Not rescheduled.\n' +
            'Steps:     1. verify staged cert modulus matches live key\n' +
            '           2. install /apps/fixgw/certs/staged/fixgw.crt over live\n' +
            '           3. systemctl reload fixgw   (reload, NOT restart)\n' +
            '           4. verify with openssl s_client and confirm sessions\n',
            { owner: 'root', mtime: new Date(2026, 8, 6, 8, 0, 0) })
        }),
        var: V.dir({
          log: V.dir({
            fixgw: V.dir({
              'gateway.log': V.file(gwLog.join('\n'), { owner: 'fixadm', mtime: ago(40), size: 340 * MB })
            })
          })
        }),
        home: V.dir({
          gsupport: V.dir({
            'runbook-fixgw-tls.txt': V.file(
              'CLIENT FIX GATEWAY - TLS RUNBOOK\n' +
              '================================\n' +
              'SYMPTOM TRIAGE\n' +
              '  "Connection opens then closes immediately" means TCP succeeded and\n' +
              '  something above it refused. That rules the network OUT, not in.\n' +
              '  A firewall block gives a timeout; nothing listening gives a refusal.\n' +
              '  A connect-then-close is the application or the TLS layer.\n' +
              '\n' +
              '  Existing sessions surviving while new ones fail is the second clue:\n' +
              '  the handshake only happens at connection time. Anything that breaks\n' +
              '  the handshake leaves established sessions untouched.\n' +
              '\n' +
              'CHECKING THE CERTIFICATE\n' +
              '  openssl x509 -in /apps/fixgw/certs/live/fixgw.crt -noout -dates -subject\n' +
              '  openssl s_client -connect localhost:9443        what we actually serve\n' +
              '  openssl x509 -in CERT -noout -modulus           must match the key:\n' +
              '  openssl rsa  -in KEY  -noout -modulus\n' +
              '  A certificate and key that do not pair will fail to load and the\n' +
              '  gateway will keep serving the old one - or fail to start.\n' +
              '\n' +
              'INSTALLING A RENEWED CERTIFICATE\n' +
              '  1. Verify the staged certificate: dates, subject, and modulus match.\n' +
              '  2. cp /apps/fixgw/certs/staged/fixgw.crt /apps/fixgw/certs/live/fixgw.crt\n' +
              '  3. systemctl reload fixgw\n' +
              '\n' +
              '  RELOAD re-reads the certificate and configuration WITHOUT dropping\n' +
              '  established sessions. RESTART drops every session including the ones\n' +
              '  still working, and forces clients into sequence-number recovery at\n' +
              '  the open. Use reload.\n' +
              '\n' +
              'NEVER disable TLS or client authentication to restore service.\n' +
              '  Client order flow would cross the public internet unencrypted and\n' +
              '  unauthenticated. It is a reportable security incident, it breaches\n' +
              '  the client connectivity agreement, and it is not faster than\n' +
              '  installing a certificate that is already staged on the box.\n',
              { owner: 'gsupport', mtime: ago(500000) })
          })
        }),
        etc: V.dir({ 'redhat-release': V.file('Red Hat Enterprise Linux Server release 7.9 (Maipo)\n', { size: 52, mtime: ago(900000) }) }),
        tmp: V.dir({}), usr: V.dir({ bin: V.dir({}) })
      });

      var world = W.create({
        host: 'ldn-fixgw-prod09', user: 'gsupport', clock: t0, seed: 9443,
        bootSeconds: 3600 * 24 * 88, cores: 16, users: 5,
        load: [0.88, 0.92, 0.86],
        mem: { total: 64 * GB, free: 42 * GB, buffers: 200 * MB, cached: 6 * GB },
        swap: { total: 8 * GB, used: 0 },
        cpu: { us: 5.2, sy: 1.1, ni: 0, id: 93.5, wa: 0.2, st: 0 },
        root: root,
        filesystems: [
          { dev: '/dev/mapper/vg00-root', mount: '/', type: 'xfs', size: 50 * GB, used: 12 * GB, inodes: { total: 26214400, used: 182204 } },
          { dev: '/dev/mapper/vg00-var', mount: '/var', type: 'xfs', size: 200 * GB, used: 34 * GB, inodes: { total: 104857600, used: 28412 } },
          { dev: '/dev/mapper/vg01-apps', mount: '/apps', type: 'xfs', size: 100 * GB, used: 16 * GB, inodes: { total: 52428800, used: 20114 } },
          { dev: '/dev/mapper/vg00-home', mount: '/home', type: 'xfs', size: 20 * GB, used: 0.3 * GB, inodes: { total: 10485760, used: 910 } }
        ],
        procs: [
          W.proc({ pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 22', short: 'systemd', rss: 11 * MB, cpu: 0, cpuSeconds: 460 }),
          W.proc({ pid: 1620, cmd: '/usr/sbin/sshd -D', short: 'sshd', rss: 8 * MB, cpu: 0, cpuSeconds: 24 }),
          W.proc({ pid: 5510, user: 'fixadm', short: 'java', cpu: 4.8, rss: 9 * GB,
            cmd: '/usr/java/jdk1.8.0_392/bin/java -Xms8g -Xmx8g -Dapp=fixgw -jar /apps/fixgw/lib/fixgw.jar',
            started: new Date(2026, 8, 10, 6, 2, 0), cpuSeconds: 4120,
            fds: [{ fd: 1, path: '/var/log/fixgw/gateway.log', mode: 'w', size: 340 * MB }] }),
          W.proc({ pid: 22400, user: 'gsupport', cmd: '-bash', short: 'bash', rss: 3 * MB, cpu: 0, tty: 'pts/0', cpuSeconds: 0 })
        ],
        sockets: [
          { pid: 5510, fd: 11, proto: 'tcp', local: '0.0.0.0:9443', peer: '0.0.0.0:*', state: 'LISTEN' },
          { pid: 5510, fd: 12, proto: 'tcp', local: '0.0.0.0:9610', peer: '0.0.0.0:*', state: 'LISTEN' },
          // two sessions that connected yesterday and are still up
          { pid: 5510, fd: 30, proto: 'tcp', local: '10.14.22.104:9443', peer: '198.51.100.71:41208', state: 'ESTABLISHED' },
          { pid: 5510, fd: 31, proto: 'tcp', local: '10.14.22.104:9443', peer: '198.51.100.72:41244', state: 'ESTABLISHED' },
          // this morning's attempts, opened and torn down
          { pid: 5510, fd: 0, proto: 'tcp', local: '10.14.22.104:9443', peer: '198.51.100.44:52104', state: 'TIME_WAIT' },
          { pid: 5510, fd: 0, proto: 'tcp', local: '10.14.22.104:9443', peer: '198.51.100.45:52106', state: 'TIME_WAIT' },
          { pid: 5510, fd: 0, proto: 'tcp', local: '10.14.22.104:9443', peer: '198.51.100.46:52108', state: 'TIME_WAIT' },
          { pid: 1620, fd: 3, proto: 'tcp', local: '0.0.0.0:22', peer: '0.0.0.0:*', state: 'LISTEN' }
        ],
        netstat: { tcpActive: 412, tcpPassive: 8841, tcpFailed: 0, tcpReset: 214, tcpRetrans: 4 },
        diskio: [{ dev: 'dm-1', rs: 2.1, ws: 38.2, readKB: 32.4, writeKB: 520.1, await: 0.5, util: 2.1 }],
        interfaces: [
          { name: 'eth0', addr: '10.14.22.104/24', rxOk: 412008841, txOk: 388120044, rxBytes: 88120044120, txBytes: 74120088412 },
          { name: 'lo', addr: '127.0.0.1/8', rxOk: 41208, txOk: 41208, mtu: 65536 }
        ],
        dmesg: [],
        hosts: { localhost: { ip: '127.0.0.1', ports: [9443, 9610, 22], rtt: 0.02 } },

        certs: {
          '/apps/fixgw/certs/live/fixgw.crt': {
            subject: 'C=GB, O=IB Markets Limited, CN=fixgw.ib.example',
            issuer: 'C=GB, O=IB Internal CA, CN=IB Issuing CA 2',
            notBefore: new Date(2025, 8, 11, 0, 0, 0),
            notAfter: midnight,
            san: ['fixgw.ib.example', 'ldn-fixgw-prod09.ib.internal'],
            modulus: 'C4A1F09B77E2'
          },
          '/apps/fixgw/certs/live/fixgw.key': { modulus: 'C4A1F09B77E2' },
          '/apps/fixgw/certs/staged/fixgw.crt': {
            subject: 'C=GB, O=IB Markets Limited, CN=fixgw.ib.example',
            issuer: 'C=GB, O=IB Internal CA, CN=IB Issuing CA 2',
            notBefore: new Date(2026, 8, 4, 0, 0, 0),
            notAfter: new Date(2027, 8, 4, 0, 0, 0),
            san: ['fixgw.ib.example', 'ldn-fixgw-prod09.ib.internal'],
            modulus: 'C4A1F09B77E2'
          }
        },
        tlsEndpoints: { 'localhost:9443': { certPath: '/apps/fixgw/certs/live/fixgw.crt' } },

        http: {
          'localhost:9610/admin/sessions': function (world) {
            if (world.flags.restored) world.flags.verified = true;
            var f = world.flags;
            return JSON.stringify({
              tlsEnabled: f.tlsDisabled ? false : true,
              clientAuth: f.tlsDisabled ? 'none' : 'required',
              sessionsEstablished: f.certInstalled || f.tlsDisabled ? 9 : 2,
              handshakeFailuresLast10Min: f.certInstalled || f.tlsDisabled ? 0 : 214,
              certificateNotAfter: f.certInstalled ? '2027-09-04T00:00:00Z' : '2026-09-11T00:00:00Z',
              certificateExpired: !f.certInstalled && !f.tlsDisabled
            }, null, 2);
          },
          'localhost:9610/admin/tls/disable': function (world) {
            world.flags.tlsDisabled = true;
            world.flags.restored = true;
            return JSON.stringify({
              status: 'ok', tlsEnabled: false, clientAuth: 'none',
              warning: 'client order flow is now unencrypted and unauthenticated over external links'
            }, null, 2);
          }
        },

        services: {
          fixgw: {
            active: true, pid: 5510, exe: 'java', desc: 'Client FIX Gateway (TLS)',
            since: new Date(2026, 8, 10, 6, 2, 0), requiresRoot: false,
            log: ['TLS handshake failed: CertificateExpiredException']
          },
          sshd: { active: true, pid: 1620, exe: 'sshd', desc: 'OpenSSH server daemon' }
        },

        flags: { certInstalled: false, restored: false, restarted: false, tlsDisabled: false, verified: false },

        /* Copying the staged certificate over the live one is only half the job:
         * the running process is still holding the expired one until it is told
         * to re-read it. */
        onCopy: function (world, src, dst) {
          if (dst === '/apps/fixgw/certs/live/fixgw.crt' &&
              src === '/apps/fixgw/certs/staged/fixgw.crt') {
            world.certs['/apps/fixgw/certs/live/fixgw.crt'] =
              world.certs['/apps/fixgw/certs/staged/fixgw.crt'];
            world.flags.certCopied = true;
          }
        },

        onService: function (world, verb, unit) {
          if (String(unit).replace(/\.service$/, '') !== 'fixgw') return false;
          if (verb === 'reload' || verb === 'reload-or-restart') {
            if (!world.flags.certCopied) {
              return { err: 'Job for fixgw.service failed: certificate at /apps/fixgw/certs/live/fixgw.crt ' +
                'is expired (notAfter 2026-09-11 00:00:00).\nSee \'systemctl status fixgw.service\'.', code: 1 };
            }
            world.flags.certInstalled = true;
            world.flags.restored = true;
            W.appendLog(world, '/var/log/fixgw/gateway.log',
              W.isoStamp(world.clock, true) + ' INFO  [main] Gateway - configuration reloaded, certificate valid to 2027-09-04');
            W.appendLog(world, '/var/log/fixgw/gateway.log',
              W.isoStamp(world.clock, true) + ' INFO  [acceptor] Gateway - 7 client sessions established, 2 carried-over sessions retained');
            return true;
          }
          if (verb === 'restart' || verb === 'stop') {
            world.flags.restarted = true;
            if (world.flags.certCopied) {
              world.flags.certInstalled = true;
              world.flags.restored = true;
            }
            world.sockets = world.sockets.filter(function (s) { return s.state !== 'ESTABLISHED'; });
            W.appendLog(world, '/var/log/fixgw/gateway.log',
              W.isoStamp(world.clock, true) + ' WARN  [main] Gateway - restarted; 2 carried-over sessions dropped, clients must re-establish and recover sequence numbers');
            return true;
          }
          return false;
        }
      });

      return world;
    },

    walkthrough: [
      'cat /home/gsupport/runbook-fixgw-tls.txt',
      'tail -6 /var/log/fixgw/gateway.log',
      'grep -c "TLS handshake failed" /var/log/fixgw/gateway.log',
      'ss -tn',
      'openssl x509 -in /apps/fixgw/certs/live/fixgw.crt -noout -dates -subject',
      'openssl s_client -connect localhost:9443',
      'ls -l /apps/fixgw/certs/staged',
      'cat /apps/fixgw/certs/staged/README.txt',
      'cat /control/CHG-9041.txt',
      'openssl x509 -in /apps/fixgw/certs/staged/fixgw.crt -noout -dates -modulus',
      'openssl rsa -in /apps/fixgw/certs/live/fixgw.key -noout -modulus',
      'cp /apps/fixgw/certs/staged/fixgw.crt /apps/fixgw/certs/live/fixgw.crt',
      'systemctl reload fixgw',
      'curl http://localhost:9610/admin/sessions'
    ],

    discoveries: [
      { id: 'handshake-fail', label: 'The gateway is failing the TLS handshake, not the TCP connection',
        when: function (o) { return /SSLHandshakeException|TLS handshake failed/i.test(o.out); } },
      { id: 'cert-expired-log', label: 'The exception names CertificateExpiredException',
        when: function (o) { return /CertificateExpiredException/i.test(o.out); } },
      { id: 'cert-dates', label: 'The live certificate expired at midnight',
        when: function (o) { return /notAfter/i.test(o.out) && /(EXPIRED|Sep 11)/.test(PS.world.stripColor(o.out)); } },
      { id: 'old-sessions-up', label: 'Sessions established before midnight are still working',
        when: function (o) { return /\b(ss|netstat)\b/.test(o.cmd) && /198\.51\.100\.7[12]/.test(PS.world.stripColor(o.out)); } },
      { id: 'staged-cert', label: 'A renewed certificate is already staged on the box',
        when: function (o) { return /staged/.test(o.cmd + o.out) && /(2027|fixgw\.crt|Renewed)/.test(o.out); } },
      { id: 'change-record', label: 'CHG-9041 was approved and never implemented',
        when: function (o) { return /CHG-9041/.test(o.out) && /NOT IMPLEMENTED|deferred/i.test(o.out); } },
      { id: 'modulus-match', label: 'Verified the staged certificate matches the live private key',
        when: function (o) { return /Modulus=/.test(o.out); } },
      { id: 'reload-not-restart', label: 'Established that reload preserves the live sessions',
        when: function (o) { return /RELOAD re-reads|reload, NOT restart|reload fixgw/i.test(o.out); }, optional: true }
    ],

    rootCauses: [
      { text: 'A firewall change overnight is blocking the client source addresses.' },
      { text: 'The gateway\'s TLS server certificate expired at midnight. New connections fail the handshake while sessions established before expiry continue to work. A renewed certificate was approved under CHG-9041 and staged on the host, but never installed.', correct: true },
      { text: 'The gateway has run out of file descriptors and cannot accept new connections.' },
      { text: 'The clients\' own certificates have expired and they need to renew them.' },
      { text: 'The FIX sequence numbers are out of step, so logon is being rejected.' },
      { text: 'The gateway lost its connection to the internal CA and cannot validate anything.' }
    ],

    fix: {
      prompt: 'Get client sessions establishing before 08:00 - without dropping the two that are still up, and without weakening the link.',
      check: function (world) { return world.flags.restored === true && world.flags.verified === true; },
      grade: function (world) {
        if (world.flags.tlsDisabled) {
          return { quality: 'blunt', bonus: -500,
            note: 'Clients are trading, and client order flow is now crossing external links\n' +
              'unencrypted and unauthenticated. That is a reportable security incident and\n' +
              'a breach of the client connectivity agreement - orders and client\n' +
              'identities are in clear text, and anyone can present as a client.\n\n' +
              'The renewed certificate was already on the box. Installing it and\n' +
              'reloading would have taken less time than disabling TLS did.' };
        }
        if (world.flags.restarted) {
          return { quality: 'blunt', bonus: -60,
            note: 'The certificate is installed and clients are connecting - but you restarted\n' +
              'rather than reloaded, so the two sessions that had survived the whole\n' +
              'incident were dropped as well. Those clients now have to re-establish and\n' +
              'go through sequence-number recovery in the last minutes before the open.\n\n' +
              'systemctl reload fixgw re-reads the certificate without touching\n' +
              'established connections. The change record said so.' };
        }
        return { quality: 'clean', bonus: 360,
          note: 'You read the failure as a TLS handshake rather than a network problem,\n' +
            'confirmed the expiry from the certificate itself, found the staged renewal,\n' +
            'checked the modulus matched the live key before installing it, and reloaded\n' +
            'rather than restarted. Nine sessions up, the two carried-over sessions\n' +
            'never noticed, and the link is still authenticated and encrypted.\n\n' +
            'Raise CHG-9041: an approved certificate renewal was deferred and never\n' +
            'rescheduled, and nothing alerted as the expiry date approached.' };
      }
    },

    hints: [
      'Network are right that TCP is connecting - and that is the most useful thing anyone has told you. A firewall block times out, nothing listening is refused. Connect-then-close means something above TCP rejected it. Read the gateway log.',
      'The handshake is failing. Ask the certificate directly: openssl x509 -in /apps/fixgw/certs/live/fixgw.crt -noout -dates. Then ask why the two overnight sessions still work.',
      'The certificate expired at midnight, and a handshake only happens at connection time - which is why existing sessions are unaffected. Look in /apps/fixgw/certs for anything already prepared, and check /control for a change record.',
      'CHG-9041 staged a renewed certificate on 2026-09-04 and was never implemented. Verify the modulus matches the live key, copy it over, then systemctl reload fixgw - reload, not restart.'
    ],

    debrief:
      'WHY IT HAPPENED\n' +
      'The gateway certificate expired at 2026-09-11 00:00. A renewal was raised,\n' +
      'approved by CAB and staged on the host on 2026-09-04, then deferred out of\n' +
      'its window because the engineer was unavailable - and never rescheduled.\n' +
      'Nothing alerted as the date approached, so the first notification was\n' +
      'clients failing to connect eight minutes before the open.\n\n' +
      'THE TWO OBSERVATIONS THAT SOLVE IT\n' +
      '  1. TCP connects, then the connection closes. A firewall block TIMES OUT;\n' +
      '     nothing listening is REFUSED. Connect-then-close means the transport\n' +
      '     was fine and something above it said no. That rules the network out.\n' +
      '  2. Sessions established yesterday still work. A handshake happens once,\n' +
      '     at connection time - so anything breaking the handshake affects only\n' +
      '     NEW connections. "Old sessions fine, new sessions fail" is close to a\n' +
      '     signature for certificate and TLS configuration problems.\n\n' +
      'THE COMMANDS\n' +
      '  openssl x509 -in CERT -noout -dates -subject     what we hold\n' +
      '  openssl s_client -connect host:port              what we actually serve\n' +
      '  openssl x509 -in CERT -noout -modulus            cert and key must pair\n' +
      '  openssl rsa  -in KEY  -noout -modulus\n' +
      '  openssl x509 -in CERT -noout -checkend 604800    expires within 7 days?\n' +
      'The last one belongs in a cron job. Expiry is the most predictable outage\n' +
      'in production and still one of the most common.\n\n' +
      'RELOAD, NOT RESTART\n' +
      'Reload re-reads configuration and certificates in place. Restart drops\n' +
      'every session, including the ones that were still working, and forces FIX\n' +
      'clients into sequence-number recovery - at the open, with the desk\n' +
      'watching. When a fix has a lighter-touch form, use it.\n\n' +
      'THE ANSWER TO "CAN WE JUST TURN ENCRYPTION OFF"\n' +
      'No. External client order flow in clear text with no client authentication\n' +
      'is a reportable security incident and a breach of the connectivity\n' +
      'agreement, and here it was slower than the correct fix. Under pressure,\n' +
      'someone will always suggest removing the control that is blocking them;\n' +
      'the job includes saying no and offering the thing that works.\n\n' +
      'INTERVIEW ANGLE\n' +
      'Certificate expiry is a favourite because the reasoning is transferable.\n' +
      'Expect "clients cannot connect this morning, what do you check?". Saying\n' +
      '"connect-then-close rules out the network, and old sessions surviving\n' +
      'points at the handshake, so I would check the certificate dates first"\n' +
      'gets you to the answer in one sentence.'
  });
})(PS);
