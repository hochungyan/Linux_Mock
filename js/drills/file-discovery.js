/* Sources: GNU findutils Age Ranges; GNU coreutils ls/stat/df documentation. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world, GB = 1073741824;
  function task(short, ask, answer, solution, hint, teaches) {
    return { short: short, ask: ask, answer: answer, solution: solution, hint: hint, teaches: teaches };
  }
  PS.drills.push({
    id: 'file-discovery', title: 'Find files and filesystem clues',
    topic: 'find -mtime -30 · names · size · ownership', host: 'ldn-archive-lab',
    tags: ['find -mtime -30', 'find -iname', 'find -size', 'stat', 'df -i'],
    brief: 'Locate evidence without changing the archive. Files have deliberately different names, ages, owners and sizes.\nTimes are measured from this simulated host clock, not your workstation.\nA file being old or large is a search result, not authorization to delete it.',
    build: function () {
      var now = new Date(2026, 8, 11, 12);
      function file(text, days, opts) {
        opts = opts || {}; opts.mtime = new Date(now.getTime() - days * 86400000);
        return V.file(text, opts);
      }
      return W.create({ host: 'ldn-archive-lab', clock: now,
        filesystems: [{ dev: '/dev/mapper/data', mount: '/', type: 'xfs', size: 100 * GB, used: 40 * GB, inodes: { total: 100000, used: 99000 } }],
        root: V.dir({ tmp: V.dir({}), home: V.dir({ gsupport: V.dir({}) }),
          archive: V.dir({
            'today.log': file('INFO current\n', 0.01, { owner: 'appsvc', size: 128 }),
            'week.log': file('INFO recent\n', 7.5, { owner: 'appsvc', size: 2 * GB }),
            'month.log': file('INFO review\n', 29.5, { owner: 'appsvc', size: 1536 }),
            'old.log': file('INFO retained\n', 31.5, { owner: 'root', size: 3 * GB }),
            'REPORT.CSV': file('date,total\n20260910,120\n', 35, { owner: 'batchsvc' }),
            '.rotation-state': file('next=20260912\n', 2, { owner: 'root' }),
            nested: V.dir({ 'orders.csv': file('id,qty\nO1,100\n', 40, { owner: 'batchsvc' }) }),
            current: V.link('/archive/today.log')
          }),
          notes: V.dir({ 'timestamps.txt': V.file('mtime=content modification\nctime=inode metadata change\natime=access time\nbirth=creation time if supported\nGNU find -mtime counts completed 24-hour periods.\nmtime -30 selects ages below 30 completed days.\nmtime +30 selects 31 or more completed days.\nEvidence retained here is never a deletion candidate solely due to age.\n') })
        }) });
    },
    tasks: [
      task('Modified in the last 30 days', 'How many regular files under /archive were modified less than 30 days ago?', '4',
        'find /archive -type f -mtime -30 | wc -l', 'Use -mtime for days, -mmin for minutes, and -type f to exclude directories and symlinks.',
        'GNU find -mtime -30 tests modification age in 24-hour units with fractional days discarded. It includes hidden files and recursively descends directories; it is not a calendar-month test.'),
      task('Older than 30 completed days', 'How many regular files satisfy GNU find -mtime +30?', '3',
        'find /archive -type f -mtime +30 | wc -l', '+30 means the truncated day count must exceed 30.',
        'With integer -mtime tests, +30 begins at 31 completed days. Use a precise timestamp comparison such as -newermt when a strict time boundary matters; that advanced form is outside this drill subset.'),
      task('Less than one day old', 'Which regular file was modified in the current 24-hour age bucket?', '/archive/today.log',
        'find /archive -type f -mtime 0', 'Plain 0 matches the first day bucket.',
        '-mtime 0 means less than 24 hours old, not since midnight. GNU -daystart changes the reference to the beginning of the day for following time tests.'),
      task('Modified in 30 minutes', 'Which file was modified in the last 30 minutes?', '/archive/today.log',
        'find /archive -type f -mmin -30', 'Minutes use -mmin, not -mtime.',
        'Check the host clock and time synchronization before trusting file ages. The 30-minute and 30-day searches have completely different scopes.'),
      task('Quote a name pattern', 'How many regular files have names ending in .log?', '4',
        'find /archive -type f -name "*.log" | wc -l', 'Quote *.log so the shell leaves it for find.',
        '-name compares the basename. An unquoted wildcard can expand in the current shell directory before find sees it.'),
      task('Case-insensitive names', 'How many regular files have a .csv extension, ignoring case?', '2',
        'find /archive -type f -iname "*.csv" | wc -l', '-iname is the case-insensitive form of -name.',
        'Linux filenames are commonly case-sensitive. -iname is useful for files from external systems whose naming conventions vary; content searching still needs grep or another reader.'),
      task('Limit traversal depth', 'How many regular files are directly inside /archive, excluding nested directories?', '6',
        'find /archive -maxdepth 1 -type f | wc -l', '-maxdepth 1 includes the starting directory and its immediate children.',
        'Limiting depth reduces accidental traversal. On real hosts, -xdev can keep a search on one filesystem; search the smallest useful path before considering /.'),
      task('Find by owner', 'How many regular files under /archive are owned by batchsvc?', '2',
        'find /archive -type f -user batchsvc | wc -l', 'find can filter ownership directly.',
        'Ownership helps distinguish application, batch and root-managed artifacts. It does not establish whether content is safe to read, copy or remove.'),
      task('Find large logs', 'How many regular .log files are larger than 1 GiB?', '2',
        'find /archive -type f -name "*.log" -size +1G | wc -l', 'Combine the name and size tests; these tests are ANDed.',
        'GNU find G uses 1024-based GiB units and rounds sizes up to the chosen unit. Use c for exact bytes when boundaries matter. Size is a clue, not a deletion policy.'),
      task('Locate symlinks', 'What is the pathname of the symlink in /archive?', '/archive/current',
        'find /archive -type l', '-type l selects symbolic links.',
        'Default find does not follow symlinks while traversing. A symlink stores a pathname and can dangle; a hard link is another directory entry for the same inode.'),
      task('Show hidden files', 'What is the hidden rotation-state filename?', '.rotation-state',
        'ls -a /archive', '-a includes names that begin with a dot.',
        'ls hides dot-prefixed names by default. find still visits them. Configuration and state files can be hidden without being encrypted or access-controlled.'),
      task('Inspect file metadata', 'Which user owns /archive/week.log?', 'appsvc',
        'stat /archive/week.log', 'stat shows ownership, mode, size and timestamps.',
        'stat is useful when a deployment or transfer left the right content with the wrong metadata. This simulator simplifies metadata timestamps; a real stat distinguishes access, modification and change times.'),
      task('Content time versus ctime', 'Which timestamp name means inode metadata change rather than content modification?', 'ctime',
        'cat /notes/timestamps.txt', 'Read the definitions before choosing a find time test.',
        'ctime is not creation time. Changing permissions or ownership updates ctime; content writes usually update both mtime and ctime. Birth time is a separate filesystem-dependent value.'),
      task('Check inode capacity', 'What is the inode usage percentage on the archive filesystem?', '99%',
        'df -i /archive', 'df -i reports inode capacity instead of data blocks.',
        'A filesystem can reject new files while still having free bytes because its inodes are exhausted. Compare df -h and df -i; many tiny files and a few huge files create different failures.')
    ],
    wrapUp: 'Start with a scoped read-only find: directory, type, quoted name, then age, owner or size. Understand completed-day rounding and the difference between mtime and ctime. Compare bytes and inodes. Review retention and active file ownership before planning any cleanup; avoid broad find -delete or unsafe whitespace-based xargs.'
  });
})(PS);
