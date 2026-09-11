/* Shell practice uses disposable files under /tmp. Sources: GNU Bash
 * Redirections and GNU Coreutils tee/truncate manuals. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  PS.drills = PS.drills || [];
  function task(short, ask, answer, solution, hint, teaches) {
    return { short: short, ask: ask, answer: answer, solution: solution, hint: hint, teaches: teaches };
  }
  PS.drills.push({
    id: 'shell-evidence', title: 'Shell and evidence files',
    topic: 'redirects · tee · truncate · quoting', host: 'ldn-support-lab',
    tags: ['>', '>>', '2>&1', 'tee', 'truncate', 'quoting'],
    brief: 'Practise saving evidence, separating errors, and handling disposable files.\nAll writing exercises target /tmp in this simulated host. Each task can be run independently.\nIn production, preserve original logs and use the approved retention and change process.',
    build: function () {
      return W.create({ host: 'ldn-support-lab', clock: new Date(2026, 8, 11, 12),
        root: V.dir({ tmp: V.dir({}), home: V.dir({ gsupport: V.dir({}) }),
          evidence: V.dir({
            'orders.log': V.file('INFO order=A100 accepted\nERROR order=A101 rejected\nWARN order=A102 slow\nERROR order=A103 timeout\n'),
            'note.txt': V.file('case=INC2048\nowner=gsupport\n'),
            'shell-notes.txt': V.file('stdout=1\nstderr=2\nstdin=0\nredirect-order=left-to-right\npipe-default=stdout\nappend=>>\ntruncate-command=truncate\nmove-command=mv\ncopy-command=cp\npipefail=rightmost nonzero status\nquote=single quotes preserve literal dollar signs\n')
          }) }) });
    },
    tasks: [
      task('Save filtered errors', 'Save ERROR lines to /tmp/errors.txt, then report how many lines were saved.', '2',
        'grep ERROR /evidence/orders.log > /tmp/errors.txt; wc -l /tmp/errors.txt',
        'Redirect the filtered output, then inspect the destination with wc -l.',
        '> creates or truncates the destination before the command runs. It copies command output into a file; mv renames or moves an existing file. Never redirect a reader into the file it is reading.'),
      task('Append a second observation', 'Create a file containing START, append END, and report the line count.', '2',
        'echo START > /tmp/append.txt; echo END >> /tmp/append.txt; wc -l /tmp/append.txt',
        'Use > once, then >> to preserve the existing content.',
        '>> appends. Repeating > would replace the earlier observation. A filename containing spaces must be quoted.'),
      task('Capture error output', 'Read a missing file and save its error to /tmp/stderr.txt. What failure is recorded?', 'No such file or directory',
        'cat /evidence/missing.txt 2> /tmp/stderr.txt; cat /tmp/stderr.txt',
        '2> selects file descriptor 2, stderr.',
        'A stdout redirect alone does not capture stderr. Preserve the error text and exit status when collecting diagnostic evidence.'),
      task('Capture both streams', 'Save both the valid note and the missing-file error to /tmp/combined.txt. Which case number survives?', 'INC2048',
        'cat /evidence/note.txt /evidence/missing.txt > /tmp/combined.txt 2>&1; cat /tmp/combined.txt',
        'Place > file before 2>&1, then read the captured file.',
        '2>&1 duplicates the current stdout destination for stderr. Redirections are evaluated left to right: reversing these two redirects changes where stderr goes.'),
      task('Display and save', 'Display ERROR lines and also save them to /tmp/tee-errors.txt. Which order timed out?', 'A103',
        'grep ERROR /evidence/orders.log | tee /tmp/tee-errors.txt',
        'tee copies its input to its output and to a file.',
        'A normal pipeline passes stdout to the next command. tee lets you inspect the same evidence that you save; it overwrites by default.'),
      task('Append through tee', 'Create FIRST, append SECOND through tee -a, and report the saved line count.', '2',
        'echo FIRST > /tmp/tee-append.txt; echo SECOND | tee -a /tmp/tee-append.txt; wc -l /tmp/tee-append.txt',
        '-a makes tee append instead of overwriting.',
        'tee -a and >> both append; tee additionally writes to stdout. Avoid concurrent writers if record order matters.'),
      task('Truncate disposable content', 'Empty /tmp/disposable.txt using truncate. How many bytes remain?', '0',
        'echo disposable > /tmp/disposable.txt; truncate -s 0 /tmp/disposable.txt; wc -c /tmp/disposable.txt',
        'Use truncate -s 0 on the disposable target only.',
        'truncate changes file length without unlinking its name. It destroys content; it is not log rotation. Retained trading evidence and FIX sequence stores require their own controlled procedures.'),
      task('Bare redirect', 'Create a disposable scratch file, then empty it using a redirect without a command. How many lines remain?', '0',
        'echo temporary > /tmp/scratch.txt; > /tmp/scratch.txt; wc -l /tmp/scratch.txt',
        '> /tmp/scratch.txt is itself a shell redirection.',
        'A bare > creates or empties a file. The shell performs the opening, so sudo command > protected-file does not give the redirection elevated permissions.'),
      task('Input redirection', 'Count the lines in orders.log using stdin redirection, without passing a filename to wc.', '4',
        'wc -l < /evidence/orders.log',
        '< connects a file to stdin.',
        'stdin is descriptor 0, stdout is 1, stderr is 2. Input redirection changes where a command reads; it does not modify the input file.'),
      task('Copy an evidence note', 'Copy the note into /tmp/note-copy.txt and read the incident identifier from the copy.', 'INC2048',
        'cp /evidence/note.txt /tmp/note-copy.txt; cat /tmp/note-copy.txt',
        'cp copies an existing file; then verify the copy.',
        'cp makes a separate file. Production evidence may also need timestamps, permissions, hashes, access controls and retention metadata; this exercise verifies content only.'),
      task('Move a scratch file', 'Create /tmp/before.txt, move it to /tmp/after.txt, and read its contents.', 'moved',
        'echo moved > /tmp/before.txt; mv /tmp/before.txt /tmp/after.txt; cat /tmp/after.txt',
        'mv source destination moves or renames a file.',
        'Within a filesystem a rename normally keeps the inode. Across filesystems mv needs copying and removal. Renaming an open log does not make the writer reopen a new pathname.'),
      task('Quote a filename with spaces', 'Save the word captured in /tmp/bridge notes.txt and read it back.', 'captured',
        'echo captured > "/tmp/bridge notes.txt"; cat "/tmp/bridge notes.txt"',
        'Quote the entire path in both commands.',
        'Unquoted spaces split shell arguments. Quote variable expansions such as "$file" when they represent one path; quote glob patterns passed to find so find performs the matching.'),
      task('Success-only follow-up', 'Check for an ERROR line with grep -q. Print FOUND only if the search succeeds.', 'FOUND',
        'grep -q ERROR /evidence/orders.log && echo FOUND',
        '&& runs the next command only after exit status 0.',
        'grep -q checks quietly. grep returns 0 for a match, 1 for no match, and normally 2 for an error; a missing file must not be mistaken for clean data.'),
      task('Failure-only follow-up', 'Search for FATAL in orders.log; print NO_MATCH when this search finds none.', 'NO_MATCH',
        'grep -q FATAL /evidence/orders.log || echo NO_MATCH',
        '|| runs the next command after a nonzero exit status.',
        'This known readable fixture has no FATAL match. In a real script, || alone cannot distinguish no match from read failure; inspect the status. A pipeline normally returns its last command status unless pipefail is enabled.')
    ],
    wrapUp: 'Explain stdout, stderr and stdin before writing a pipeline. Use > to replace, >> to append, 2> for errors, and > file 2>&1 for both streams. Verify captured evidence. Practise truncate only on disposable files; production logs, replay stores and audit records have retention and recovery obligations.'
  });
})(PS);
