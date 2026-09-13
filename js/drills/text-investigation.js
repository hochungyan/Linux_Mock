/* References: GNU grep, gawk, sed and coreutils manuals. */
(function (PS) {
  'use strict';
  var V = PS.vfs, W = PS.world;
  function task(short, ask, answer, solution, hint, teaches) {
    return { short: short, ask: ask, answer: answer, solution: solution, hint: hint, teaches: teaches };
  }
  PS.drills.push({
    id: 'text-investigation', title: 'Text investigation', topic: 'grep options · awk fields · sed edits',
    host: 'ldn-log-lab', tags: ['grep -i', 'grep -E', 'grep -F', 'grep -n', 'awk', 'sed'],
    brief: 'An order service has mixed-case messages and repeated order IDs.\nUse exact fields and careful patterns to answer the questions from /logs.\nThe CSV fixture is simple, with no quoted commas; production CSV may require a proper CSV parser.',
    build: function () {
      return W.create({ host: 'ldn-log-lab', clock: new Date(2026, 8, 11, 12),
        root: V.dir({ tmp: V.dir({}), home: V.dir({ gsupport: V.dir({}) }), logs: V.dir({
          'orders.log': V.file('09:30:00 INFO order=ORD100 client=ALPHA status=ACCEPTED\n09:30:01 Error order=ORD101 client=BETA status=REJECTED reason=LIMIT\n09:30:02 WARN order=ORD102 client=ALPHA status=SLOW\n09:30:03 error order=ORD103 client=GAMMA status=REJECTED reason=SESSION\n09:30:04 INFO order=ORD100 client=ALPHA status=FILLED\n09:30:05 ERROR order=ORD104 client=BETA status=REJECTED reason=LIMIT\n09:30:06 INFO order=ORD105 client=GAMMA status=ACCEPTED\n09:30:07 INFO order=ORD105 client=GAMMA status=CANCELED\n'),
          'latency.csv': V.file('order,venue,latency_ms\nORD100,LSE,12\nORD101,XETRA,240\nORD102,LSE,18\nORD103,XETRA,980\n'),
          'literal.log': V.file('peer=10.20.1.5 rejected\npeer=10x20x1x5 accepted\n'),
          'service.conf': V.file('# service configuration\nport=9310\nmode=production\n# end\n'),
          'other.log': V.file('INFO startup complete\nERROR dependency unavailable\n')
        }) }) });
    },
    tasks: [
      task('Ignore case', 'How many error lines are in orders.log, including Error and error?', '3',
        'grep -ic error /logs/orders.log', 'Combine -i for case-insensitive matching with -c for matching lines.',
        'Case variation in log levels is common when collecting multiple components. grep -i ignores case; it does not turn an arbitrary substring into an exact field match.'),
      task('Invert a pattern', 'How many lines remain after excluding INFO from orders.log?', '4',
        'grep -vc INFO /logs/orders.log', '-v selects lines that do not match.',
        'grep -v excludes whole matching lines. Here INFO is a level; in unstructured logs that same word could appear inside a message, so verify the format.'),
      task('Extended alternation', 'How many lines have WARN or any case of ERROR?', '4',
        'grep -icE "WARN|ERROR" /logs/orders.log', '-E enables extended regular expressions, including | for alternatives.',
        'grep -E uses extended regular expressions. Quote the pattern so the shell does not treat | as a pipeline. Prefer grep -E to the obsolete egrep command name.'),
      task('Print matching line numbers', 'On which line does order ORD103 appear?', '4',
        'grep -n "order=ORD103 " /logs/orders.log', '-n prefixes the matching line with its one-based line number.',
        'Line numbers help teammates open the same evidence. A trailing delimiter prevents ORD103 from also matching ORD1030; include the field name as well. Copy identifiers from the log rather than retyping them: in most terminal fonts a capital O and a zero are near-identical, and grep will simply report nothing rather than warn you.'),
      task('Literal IP matching', 'How many lines literally contain 10.20.1.5 in literal.log?', '1',
        'grep -Fc 10.20.1.5 /logs/literal.log', '-F treats the pattern as literal text.',
        'Dots are wildcard characters in regex syntax. grep -F avoids matching 10x20x1x5. For an exact address field, include the surrounding field delimiters too.'),
      task('Anchor the timestamp', 'Which order was logged at exactly 09:30:02?', 'order=ORD102',
        'grep "^09:30:02 " /logs/orders.log | awk \'{print $3}\'', '^ anchors a pattern to the start of a line.',
        'Anchors and delimiters reduce false positives from timestamps embedded in message text. Timestamp formats and time zones must be checked before correlating services.'),
      task('Extract the fourth field', 'Which client generated the first REJECTED record?', 'client=BETA',
        'grep "status=REJECTED" /logs/orders.log | head -1 | awk \'{print $4}\'', 'Filter, keep the first record, then extract its fourth whitespace field.',
        'awk defaults to whitespace fields. This technique depends on a stable log structure; a multiword field or stack trace requires a different parser.'),
      task('Parse a CSV field', 'What latency_ms was recorded for ORD103?', '980',
        'awk -F, \'/ORD103/{print $3}\' /logs/latency.csv', 'Use -F, to set the comma field separator.',
        'awk -F, works for this simple fixture. It does not implement CSV quoting rules; quoted commas and multiline fields require a CSV parser.'),
      task('Count fields', 'How many comma-separated fields are in the ORD101 row?', '3',
        'awk -F, \'/ORD101/{print NF}\' /logs/latency.csv', 'NF is the number of fields in the current record.',
        'Field-count checks are useful for malformed simple-delimited data. NF is the current field count; NR counts input records across files.'),
      task('Select a line range', 'Which order appears on line 3 of orders.log?', 'ORD102',
        'sed -n \'3p\' /logs/orders.log', '-n suppresses automatic printing; 3p prints line 3.',
        'sed -n \'3,6p\' prints an inclusive line range. Without -n, a p command can print selected lines twice on a real sed.'),
      task('Preview a substitution', 'Preview replacing REJECTED with REVIEW in the ORD101 line. What is the new status token?', 'status=REVIEW',
        'grep ORD101 /logs/orders.log | sed \'s/REJECTED/REVIEW/\'', 's/old/new/ substitutes the first match on each line.',
        'sed streams edited output unless an in-place option is used. This preview leaves the evidence unchanged; s/old/new/g replaces all matches on each line.'),
      task('Remove comment lines', 'After excluding lines that start with #, how many service.conf lines remain?', '2',
        'sed \'/^#/d\' /logs/service.conf | wc -l', 'Use an anchored deletion pattern.',
        'sed \'/^#/d\' excludes comment lines beginning in column one. Real config syntax may allow leading whitespace and inline comments; adapt the pattern to that format.'),
      task('Deduplicate order IDs', 'How many distinct order IDs occur in orders.log?', '6',
        'grep -o "order=ORD[0-9]*" /logs/orders.log | sort -u | wc -l', 'Extract only each order token, then sort -u and count.',
        'Count records and business entities separately. Several lifecycle events can belong to one order. uniq alone only groups adjacent equal lines.'),
      task('Find matching filenames', 'How many .log files under /logs contain an error in any letter case?', '2',
        'grep -il error /logs/*.log | wc -l', '-l prints filenames that contain at least one match.',
        'grep -l locates files; -c counts matching lines within each file. Use zgrep for genuine gzip streams instead of assuming grep will decompress them.')
    ],
    wrapUp: 'Build a small pipeline whose intermediate output you can inspect: select the time and component, extract an exact identifier, deduplicate or rank, then save the result. Know how -i, -v, -E, -F, -n, -c, -l and -o change grep. Use awk for fields and sed for ranges and stream edits; do not mistake a simple delimiter splitter for a full CSV parser.'
  });
})(PS);
