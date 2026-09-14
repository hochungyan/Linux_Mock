/* test/vocab.test.js - structural and factual checks on the product/FIX vocabulary.
 *
 * The reference track is data, not behavior, so this suite guards the things a
 * reader would be misled by: malformed rows, duplicate or empty entries, ragged
 * tables, and FIX tag numbers or enumerations that do not agree with the
 * specification the rest of the simulator already models.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, JSON, Math, Object, Array, String, Number };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vocab-data.js'), 'utf8'), sandbox,
  { filename: 'js/vocab-data.js' });
const PS = sandbox.PS;

let fails = 0;
function check(label, cond, detail) {
  if (cond) console.log('   PASS  ' + label);
  else { console.log('   FAIL  ' + label + (detail ? '\n         ' + String(detail).slice(0, 400) : '')); fails++; }
}

const sections = PS.vocabSections;
const allRows = [];
sections.forEach(s => s.blocks.forEach(b => b.rows.forEach(r => allRows.push({ section: s.id, block: b, row: r }))));

console.log('\n=== structure ===');
check('sections registered', sections.length >= 15, sections.length);
check('section ids are unique', new Set(sections.map(s => s.id)).size === sections.length);
check('every section has a title and a kicker', sections.every(s => s.title && s.kicker));
check('every section has at least one block', sections.every(s => s.blocks.length > 0));
check('block kinds are known', sections.every(s => s.blocks.every(b =>
  ['terms', 'table', 'sample', 'drill'].includes(b.kind))));
check('published entry count matches the data', PS.vocabEntryCount === allRows.length,
  PS.vocabEntryCount + ' vs ' + allRows.length);

console.log('\n=== row shape ===');
const badTerms = [];
const badTables = [];
const badDrills = [];
sections.forEach(s => s.blocks.forEach(b => b.rows.forEach(row => {
  if (!Array.isArray(row) || row.some(v => typeof v !== 'string' || !v.trim())) {
    badTerms.push(s.id + '/' + (b.heading || b.kind));
    return;
  }
  if (b.kind === 'terms' && row.length !== 3) badTerms.push(s.id + ': ' + row[0]);
  if (b.kind === 'table' && row.length !== b.columns.length) badTables.push(s.id + ': ' + row[0]);
  if ((b.kind === 'drill' || b.kind === 'sample') && row.length < 2) badDrills.push(s.id + ': ' + row[0]);
})));
check('every terms row is [term, definition, support note] with no empty cell', badTerms.length === 0, badTerms.join('; '));
check('every table row matches its column count', badTables.length === 0, badTables.join('; '));
check('every drill and sample row has a question and an answer', badDrills.length === 0, badDrills.join('; '));
check('every table block declares columns', sections.every(s => s.blocks.every(b =>
  b.kind !== 'table' || (Array.isArray(b.columns) && b.columns.length >= 2))));

console.log('\n=== content quality ===');
const termRows = allRows.filter(e => e.block.kind === 'terms');
check('terms explain why support cares, not just what it is',
  termRows.every(e => e.row[2].length > 40),
  termRows.filter(e => e.row[2].length <= 40).map(e => e.row[0]).join('; '));
const dupTerms = {};
termRows.forEach(e => { const k = e.row[0].toLowerCase(); dupTerms[k] = (dupTerms[k] || 0) + 1; });
check('no term is defined twice', Object.keys(dupTerms).every(k => dupTerms[k] === 1),
  Object.keys(dupTerms).filter(k => dupTerms[k] > 1).join('; '));
const drillRows = allRows.filter(e => e.block.kind === 'drill');
check('interview drills exist in quantity', drillRows.length >= 40, drillRows.length);
check('drill questions are questions', drillRows.every(e => /[?.]$/.test(e.row[0].trim())),
  drillRows.filter(e => !/[?.]$/.test(e.row[0].trim())).map(e => e.row[0]).join('; '));
check('drill answers are full answers, not one-liners',
  drillRows.every(e => e.row[1].split(/\s+/).length >= 20),
  drillRows.filter(e => e.row[1].split(/\s+/).length < 20).map(e => e.row[0]).join('; '));
check('every source link is https', sections.every(s => s.sources.every(src =>
  Array.isArray(src) && src.length === 2 && src[0] && /^https:\/\//.test(src[1]))));
check('every section carries reference material', sections.every(s => s.sources.length > 0),
  sections.filter(s => !s.sources.length).map(s => s.id).join(', '));

console.log('\n=== FIX coverage ===');
const fixSections = sections.filter(s => s.id.startsWith('fix'));
check('FIX gets its own dedicated sections', fixSections.length >= 3, fixSections.map(s => s.id).join(', '));
const fixText = fixSections.map(s => JSON.stringify(s)).join(' ');

/* A tag counts as documented if a reader could find it: as an entry in a Tag
 * column, as "108 HeartBtInt", as "(11)" after a field name, or as "43=Y". */
const documentedTags = new Set();
fixSections.forEach(s => s.blocks.forEach(b => {
  if (b.kind === 'table' && /tag/i.test(b.columns[0])) {
    b.rows.forEach(row => String(row[0]).split(/[^0-9]+/)
      .filter(Boolean).forEach(t => documentedTags.add(t)));
  }
  b.rows.forEach(row => row.forEach(cellText => {
    const text = String(cellText);
    [/(?:^|[^0-9])(\d{1,4})\s*=/g, /(?:^|[^0-9])(\d{1,4})\s+[A-Z][A-Za-z]/g, /\((\d{1,4})\)/g]
      .forEach(re => { let m; while ((m = re.exec(text))) documentedTags.add(m[1]); });
  }));
}));
const mustDocument = ['8', '9', '10', '11', '14', '17', '31', '32', '34', '35', '37', '38',
  '39', '41', '43', '44', '49', '52', '54', '56', '58', '59', '60', '97', '102', '103', '108',
  '112', '122', '141', '150', '151', '373', '528'];
const missingTags = mustDocument.filter(tag => !documentedTags.has(tag));
check('every must-know tag appears in the FIX sections', missingTags.length === 0,
  'missing: ' + missingTags.join(', '));
const mustExplain = ['ClOrdID', 'OrigClOrdID', 'OrderID', 'ExecID', 'OrdStatus', 'ExecType',
  'LeavesQty', 'CumQty', 'AvgPx', 'MsgSeqNum', 'SendingTime', 'PossDupFlag', 'PossResend',
  'CheckSum', 'BodyLength', 'HeartBtInt', 'TestReqID', 'ResetSeqNumFlag', 'GapFillFlag',
  'SessionRejectReason', 'OrderCapacity', 'TimeInForce', 'HandlInst', 'LastMkt', 'TransactTime'];
const missingFields = mustExplain.filter(name => fixText.indexOf(name) === -1);
check('every must-know field name is explained', missingFields.length === 0,
  'missing: ' + missingFields.join(', '));
const sessionTypes = ['Logon', 'Logout', 'Heartbeat', 'TestRequest', 'ResendRequest',
  'SequenceReset', 'Reject'];
check('all seven administrative messages are covered',
  sessionTypes.every(t => fixText.indexOf(t) !== -1),
  sessionTypes.filter(t => fixText.indexOf(t) === -1).join(', '));
const appTypes = ['NewOrderSingle', 'ExecutionReport', 'OrderCancelRequest',
  'OrderCancelReplaceRequest', 'OrderCancelReject', 'BusinessMessageReject'];
check('the core application messages are covered',
  appTypes.every(t => fixText.indexOf(t) !== -1),
  appTypes.filter(t => fixText.indexOf(t) === -1).join(', '));
check('ExecType and OrdStatus are taught as separate concepts',
  /why this report was sent/i.test(fixText) && /where the order (now )?stands/i.test(fixText));
check('deduplication is anchored on ExecID', /deduplicate on (this|ExecID)/i.test(fixText));
check('SOH delimiter is explained', /0x01/.test(fixText) && /SOH/.test(fixText));

console.log('\n=== raw FIX examples parse as tag=value ===');
const samples = [];
sections.forEach(s => s.blocks.filter(b => b.kind === 'sample')
  .forEach(b => b.rows.forEach(r => samples.push({ section: s.id, label: r[0], body: r[1] }))));
check('worked FIX examples exist', samples.length >= 4, samples.length);
const fixLines = samples.filter(s => s.section.startsWith('fix') && /\|/.test(s.body))
  .flatMap(s => s.body.split('\n').map(line => ({ label: s.label, line })))
  .filter(e => /^8=FIX|^35=/.test(e.line));
check('example FIX lines found', fixLines.length >= 8, fixLines.length);
const malformed = fixLines.filter(e => e.line.split('|').filter(Boolean)
  .some(field => !/^\d+=/.test(field) && field !== '...'));
check('every field in an example is tag=value', malformed.length === 0,
  malformed.map(e => e.label).join('; '));
const withMsgType = fixLines.filter(e => /(^|\|)35=/.test(e.line));
check('every example line declares a MsgType', withMsgType.length === fixLines.length,
  (fixLines.length - withMsgType.length) + ' without 35=');

console.log('\n=== product coverage a support interview expects ===');
const allText = JSON.stringify(sections);
const mustCover = ['forward', 'future', 'option', 'swap', 'delta', 'gamma', 'vega', 'theta',
  'repo', 'CDS', 'NDF', 'contango', 'backwardation', 'initial margin', 'variation margin',
  'novation', 'corporate action', 'settlement', 'accrued interest', 'DV01', 'implied volatility',
  'total return swap', 'CCP', 'collateral', 'ISIN', 'LEI', 'MiFID', 'EMIR', 'T+1'];
const missingConcepts = mustCover.filter(term => !new RegExp(term.replace(/\+/g, '\\+'), 'i').test(allText));
check('every headline product concept is covered', missingConcepts.length === 0,
  'missing: ' + missingConcepts.join(', '));

console.log('\n' + (fails ? fails + ' FAILURES' : 'all vocabulary checks passed'));
process.exit(fails ? 1 : 0);
