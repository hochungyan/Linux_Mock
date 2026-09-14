/* vocab.js - renders the products, markets and FIX vocabulary reference.
 *
 * Everything is built once at init and then shown or hidden by search, so the
 * page keeps its scroll position and never rebuilds the DOM while typing. The
 * element model below is kept in JS rather than re-queried, which also keeps
 * this working under the minimal DOM stub used by test/browser.test.js.
 */
(function (PS) {
  'use strict';

  var sections = PS.vocabSections || [];
  var model = [];          /* [{section, el, blocks:[{el, rows:[{el, text}]}]}] */
  var state = { search: '', section: '' };
  var el = function (id) { return document.getElementById(id); };

  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function buildTermsRow(row) {
    var tr = make('tr', 'vocab-row');
    tr.appendChild(make('th', 'vocab-term', row[0]));
    tr.appendChild(make('td', 'vocab-def', row[1]));
    tr.appendChild(make('td', 'vocab-desk-note', row[2]));
    return tr;
  }

  function buildTableRow(row) {
    var tr = make('tr', 'vocab-row');
    row.forEach(function (value, i) {
      tr.appendChild(make(i === 0 ? 'th' : 'td', i === 0 ? 'vocab-key' : '', value));
    });
    return tr;
  }

  function buildSample(row) {
    var wrap = make('div', 'vocab-sample');
    wrap.appendChild(make('div', 'vocab-sample-label', row[0]));
    wrap.appendChild(make('pre', 'vocab-pre', row[1]));
    if (row[2]) wrap.appendChild(make('p', 'vocab-sample-note', row[2]));
    return wrap;
  }

  function buildDrill(row) {
    var item = make('details', 'vocab-qa');
    item.appendChild(make('summary', 'vocab-q', row[0]));
    item.appendChild(make('p', 'vocab-a', row[1]));
    return item;
  }

  /* One block becomes one table, sample list or Q&A list, plus a row model the
   * search filter can toggle without touching the rest of the page. */
  function buildBlock(block) {
    var host = make('div', 'vocab-block');
    if (block.heading) host.appendChild(make('h4', 'vocab-block-h', block.heading));
    if (block.note) host.appendChild(make('p', 'vocab-block-note', block.note));

    var rows = [];
    if (block.kind === 'terms' || block.kind === 'table') {
      var scroll = make('div', 'vocab-scroll');
      var tbl = make('table', 'vocab-table');
      var head = make('thead');
      var headRow = make('tr');
      var columns = block.kind === 'terms'
        ? ['Term', 'What it is', 'Why production support cares']
        : block.columns;
      columns.forEach(function (c) { headRow.appendChild(make('th', '', c)); });
      head.appendChild(headRow);
      tbl.appendChild(head);
      var body = make('tbody');
      block.rows.forEach(function (row) {
        var tr = block.kind === 'terms' ? buildTermsRow(row) : buildTableRow(row);
        body.appendChild(tr);
        rows.push({ el: tr, text: row.join(' ').toLowerCase() });
      });
      tbl.appendChild(body);
      scroll.appendChild(tbl);
      host.appendChild(scroll);
    } else {
      var list = make('div', block.kind === 'sample' ? 'vocab-samples' : 'vocab-qas');
      block.rows.forEach(function (row) {
        var node = block.kind === 'sample' ? buildSample(row) : buildDrill(row);
        list.appendChild(node);
        rows.push({ el: node, text: row.join(' ').toLowerCase() });
      });
      host.appendChild(list);
    }
    return { el: host, rows: rows };
  }

  function buildSection(s) {
    var host = make('article', 'vocab-section');
    host.setAttribute('data-id', s.id);
    host.appendChild(make('h3', 'vocab-section-h', s.title));
    if (s.kicker) host.appendChild(make('p', 'vocab-kicker', s.kicker));

    var blocks = s.blocks.map(function (block) {
      var built = buildBlock(block);
      host.appendChild(built.el);
      return built;
    });

    if (s.sources.length) {
      var refs = make('details', 'vocab-refs');
      refs.appendChild(make('summary', '', 'Reference material'));
      var links = make('div', 'interview-sources');
      s.sources.forEach(function (src) {
        var a = make('a', '', src[0]);
        a.href = src[1];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        links.appendChild(a);
      });
      refs.appendChild(links);
      host.appendChild(refs);
    }
    return { section: s, el: host, blocks: blocks };
  }

  function matches(row) {
    return !state.search || row.text.indexOf(state.search) !== -1;
  }

  /* Hide rows that do not match, then hide blocks and sections left empty, so a
   * search never leaves a heading with nothing under it. */
  function applyFilter() {
    var shown = 0, shownSections = 0;
    model.forEach(function (entry) {
      var inSection = !state.section || entry.section.id === state.section;
      var sectionRows = 0;
      entry.blocks.forEach(function (block) {
        var blockRows = 0;
        block.rows.forEach(function (row) {
          var visible = inSection && matches(row);
          row.el.classList.toggle('hidden', !visible);
          if (visible) blockRows++;
        });
        block.el.classList.toggle('hidden', blockRows === 0);
        sectionRows += blockRows;
      });
      entry.el.classList.toggle('hidden', sectionRows === 0);
      shown += sectionRows;
      if (sectionRows) shownSections++;
    });

    var status = el('vocab-status');
    if (status) {
      status.textContent = shown === 0
        ? 'No entries match. Clear the search or choose another section.'
        : shown + (shown === 1 ? ' entry' : ' entries') + ' shown across ' +
          shownSections + (shownSections === 1 ? ' section' : ' sections') +
          ' of ' + PS.vocabEntryCount + ' total.';
    }
  }

  function jumpTo(id) {
    var entry = model.filter(function (m) { return m.section.id === id; })[0];
    if (!entry) return;
    state.section = '';
    var picker = el('vocab-section-filter');
    if (picker) picker.value = '';
    applyFilter();
    if (typeof entry.el.scrollIntoView === 'function') {
      entry.el.scrollIntoView({ block: 'start' });
    }
  }

  PS.vocab = {
    sections: sections,
    entryCount: PS.vocabEntryCount,
    /* exposed for the browser test and for deep links from other tracks */
    filter: function (text) {
      state.search = String(text || '').trim().toLowerCase();
      var box = el('vocab-search');
      if (box) box.value = text || '';
      applyFilter();
    },
    jumpTo: jumpTo,
    shownCount: function () {
      return model.reduce(function (n, entry) {
        return n + entry.blocks.reduce(function (m, block) {
          return m + block.rows.filter(function (r) { return !r.el.classList.contains('hidden'); }).length;
        }, 0);
      }, 0);
    },

    init: function () {
      var body = el('vocab-body');
      if (!body || model.length) return;

      var jump = el('vocab-jump');
      var picker = el('vocab-section-filter');

      sections.forEach(function (s) {
        var entry = buildSection(s);
        model.push(entry);
        body.appendChild(entry.el);

        if (jump) {
          var link = make('button', 'vocab-jump-link', s.title);
          link.type = 'button';
          link.setAttribute('data-id', s.id);
          link.onclick = function () { jumpTo(s.id); };
          jump.appendChild(link);
        }
        if (picker) {
          var option = make('option', '', s.title);
          option.value = s.id;
          picker.appendChild(option);
        }
      });

      var count = el('vocab-count');
      if (count) {
        count.textContent = PS.vocabEntryCount + ' vocabulary entries across ' +
          sections.length + ' sections';
      }

      var search = el('vocab-search');
      if (search) {
        search.oninput = function () {
          state.search = String(search.value || '').trim().toLowerCase();
          applyFilter();
        };
      }
      if (picker) {
        picker.onchange = function () {
          state.section = picker.value || '';
          applyFilter();
        };
      }
      var clear = el('vocab-clear');
      if (clear) {
        clear.onclick = function () {
          state.search = '';
          state.section = '';
          if (search) search.value = '';
          if (picker) picker.value = '';
          applyFilter();
        };
      }
      applyFilter();
    }
  };
})(PS);
