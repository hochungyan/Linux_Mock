/* Reference: GNU Coreutils Mode Structure. The simulator shows permission
 * evidence; it is not a complete ACL/SELinux enforcement environment. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  function task(short, ask, answer, solution, hint, teaches) {
    return { short: short, ask: ask, answer: answer, solution: solution, hint: hint, teaches: teaches };
  }
  PS.drills.push({
    id: 'permissions-support', title: 'Permissions and secure support',
    topic: 'modes · identity · directory access · evidence', host: 'ldn-access-lab',
    tags: ['ls -l', 'stat', 'id', 'chmod', 'umask', 'ACL', 'SELinux'],
    brief: 'Read permission evidence and explain access decisions.\nThe lab shows Unix mode bits and supplied diagnostic notes; it does not enforce a complete Linux identity, ACL or SELinux model.\nNo permission changes are needed to solve these tasks.',
    build: function () {
      return W.create({ host: 'ldn-access-lab', clock: new Date(2026, 8, 11, 12),
        root: V.dir({ tmp: V.dir({}), home: V.dir({ gsupport: V.dir({}) }),
          app: V.dir({
            'gateway.conf': V.file('port=9310\n', { owner: 'appsvc', group: 'support', mode: '-rw-r-----' }),
            'run.sh': V.file('#!/bin/bash\nexec /opt/gateway/bin/server\n', { owner: 'appsvc', group: 'support', mode: '-rwxr-x---' }),
            'private.key': V.file('TRAINING PLACEHOLDER ONLY\n', { owner: 'appsvc', group: 'appsvc', mode: '-rw-------' }),
            drop: V.dir({}, { owner: 'appsvc', group: 'support', mode: 'drwxrws---' }),
            share: V.dir({}, { owner: 'root', group: 'root', mode: 'drwxrwxrwt' })
          }),
          evidence: V.dir({
            'auth.log': V.file('09:00:01 Failed password for support from 10.1.2.3 port 55100 ssh2\n09:00:02 Failed password for support from 10.1.2.3 port 55101 ssh2\n09:00:03 Accepted publickey for support from 10.1.2.8 port 55102 ssh2\n'),
            'access-notes.txt': V.file('directory-read=list names\ndirectory-execute=search or traverse\ndelete-requirement=parent directory write and execute, subject to sticky bit and other controls\nmode-640=owner read/write, group read, others none\numask-027-file=640\numask-027-directory=750\nsetgid-directory=group inheritance\nsticky-directory=restrict removal and renaming by unprivileged users\nleast-privilege=minimum access needed for the task\nacl-inspection=getfacl\nselinux-denial=AVC\nselinux-evidence=inspect labels and audit denial records before changing policy\nsecret-handling=redact\n')
          }) }) });
    },
    tasks: [
      task('Identify the file owner', 'Which user owns gateway.conf?', 'appsvc',
        'ls -l /app/gateway.conf', 'The owner follows the link count in a long listing.',
        'An access investigation starts with the actual process identity and the file owner and group. The support login may differ from the service account.'),
      task('Identify the file group', 'Which group owns gateway.conf?', 'support',
        'ls -l /app/gateway.conf', 'Read the group column after the owner.',
        'Group ownership and a user membership are separate facts. Check the running process supplementary groups, especially after membership changes.'),
      task('Read a numeric mode', 'What are the three ordinary octal permission digits on gateway.conf?', '640',
        'stat /app/gateway.conf', 'Read the octal Access value; omit the leading special-mode zero.',
        'r=4, w=2, x=1. 640 gives the owner read/write, the group read, and others no access, before considering ACLs and other controls.'),
      task('Read an executable mode', 'What are the three ordinary permission digits on run.sh?', '750',
        'stat /app/run.sh', 'Translate rwx, r-x and --- into octal.',
        'Direct execution needs execute permission. A script also needs an accessible interpreter and readable script content. noexec mounts and policy controls can add further restrictions.'),
      task('Read a private-file mode', 'What ordinary mode is set on the training private.key placeholder?', '600',
        'stat /app/private.key', 'The owner has read/write and everyone else has no ordinary mode permissions.',
        'Avoid dumping actual private keys into a terminal or incident ticket. Inspect metadata when diagnosing access and use approved secret-management procedures.'),
      task('Identify the current account', 'What is the current interactive username?', 'gsupport',
        'whoami', 'whoami reports the effective user name.',
        'whoami shows effective identity; id also shows UID, primary group and supplementary groups. Service processes can run under another identity.'),
      task('List versus traverse', 'Which directory permission allows search or traversal: read, write or execute?', 'execute',
        'grep directory-execute /evidence/access-notes.txt', 'Read the directory-execute definition.',
        'Directory read lists names. Execute permits searching or traversing the directory. Accessing a file by pathname requires search permission on its parent path components.'),
      task('Deleting a read-only file', 'For ordinary unlink, which directory must have the relevant write and execute permission: parent or child?', 'parent',
        'grep delete-requirement /evidence/access-notes.txt', 'Deletion changes the containing directory entry.',
        'The parent directory permissions control removing a name, subject to sticky bits, ACLs, immutable attributes, read-only mounts and policy. A file being read-only does not by itself prevent deletion.'),
      task('Recognize setgid inheritance', 'What does setgid on a directory primarily provide for newly created children?', 'group inheritance',
        'grep setgid-directory /evidence/access-notes.txt', 'Use the supplied rule; /app/drop demonstrates the s bit.',
        'Directory setgid commonly makes new children inherit the directory group. Default ACLs and umask still affect access permissions; group inheritance alone does not grant write access.'),
      task('Recognize the sticky bit', 'Which operation does the sticky directory bit restrict for unprivileged users: reading or removal?', 'removal',
        'grep sticky-directory /evidence/access-notes.txt', 'Think about shared writable directories such as /tmp.',
        'The sticky bit restricts deleting or renaming entries to permitted owners or privileged users. It does not make file contents private.'),
      task('Calculate file umask result', 'Without default ACLs, what mode results from creating a file with requested mode 666 and umask 027?', '640',
        'grep umask-027-file /evidence/access-notes.txt', 'Mask off permissions rather than subtracting ordinary decimal numbers.',
        'The operation is requested mode AND NOT umask. Regular files normally request 666, directories 777. umask does not add execute permission and does not change existing files.'),
      task('Calculate directory umask', 'Without default ACLs, what mode results from requested directory mode 777 and umask 027?', '750',
        'grep umask-027-directory /evidence/access-notes.txt', 'The same mask applies to a different requested mode.',
        'A default ACL can change the creation rules. Verify the resulting mode and ACL instead of assuming every application requests the standard permissions.'),
      task('Inspect access beyond modes', 'Which real Linux command inspects a file access control list?', 'getfacl',
        'grep acl-inspection /evidence/access-notes.txt', 'This is a concept task using the supplied notes, not an ACL simulator.',
        'getfacl displays named-user and group ACL entries and their effective mask. SELinux is another layer: inspect labels and AVC denials rather than disabling enforcement to make an error disappear.'),
      task('Count authentication failures', 'How many failed-password events appear in the supplied auth.log?', '2',
        'grep -ic "Failed password" /evidence/auth.log', 'Count the relevant authentication event, not all SSH traffic.',
        'Correlate account, source address and time with expected activity. Distribution log locations vary. Preserve evidence and follow the security escalation process; redact secrets when sharing excerpts.')
    ],
    wrapUp: 'Read identity, file ownership, mode bits and every parent directory before changing access. Then inspect ACLs, mount options and mandatory access controls as applicable. chmod 777 is not a diagnosis. Grant the minimum justified access through the change process, and keep secrets out of evidence bundles.'
  });
})(PS);
