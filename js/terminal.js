/* terminal.js - the screen. Handles echoing, history, tab completion, Ctrl+C,
 * and the three kinds of command that do not just print and return:
 *   screen  - repaints the whole view every second (top, watch)
 *   stream  - appends new lines as they appear (tail -f)
 *   hang    - prints nothing at all until you interrupt it, which is exactly
 *             what happens when you touch a dead hard NFS mount
 */
(function (PS) {
  'use strict';

  var W = PS.world, V = PS.vfs;

  function Terminal(opts) {
    this.el = document.getElementById('term');
    this.out = document.getElementById('out');
    this.inputLine = document.getElementById('inputline');
    this.input = document.getElementById('cmd');
    this.ps1El = document.getElementById('ps1');
    this.appEl = document.getElementById('app');
    this.onCommand = opts.onCommand;
    this.getWorld = opts.getWorld;
    this.history = [];
    this.histIdx = -1;
    this.app = null;
    this.bind();
  }

  Terminal.prototype.bind = function () {
    var self = this;

    this.el.addEventListener('mousedown', function (e) {
      if (window.getSelection && String(window.getSelection()).length) return;
      if (!self.app) setTimeout(function () { self.input.focus(); }, 0);
    });

    document.addEventListener('keydown', function (e) {
      // Ctrl+C always works, app or not.
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        if (window.getSelection && String(window.getSelection()).length) return;
        e.preventDefault();
        self.interrupt();
        return;
      }
      if (self.app) {
        if (e.key === 'q' || e.key === 'Escape') { e.preventDefault(); self.stopApp(); }
        return;
      }
    });

    this.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        self.submit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        self.recall(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        self.recall(1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        self.complete();
      } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        self.clear();
      } else if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        self.input.value = '';
      } else if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        self.input.setSelectionRange(0, 0);
      } else if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        var n = self.input.value.length;
        self.input.setSelectionRange(n, n);
      }
    });
  };

  Terminal.prototype.promptHtml = function () {
    var w = this.getWorld();
    if (!w) return '';
    var cwd = w.cwd === w.home ? '~' : (w.cwd.indexOf(w.home + '/') === 0 ? '~' + w.cwd.slice(w.home.length) : w.cwd);
    return W.colorHtml(W.c('green', '[' + w.user + '@' + w.host) + ' ' + W.c('blue', cwd) + W.c('green', ']$') + ' ');
  };

  Terminal.prototype.refreshPrompt = function () {
    this.ps1El.innerHTML = this.promptHtml();
  };

  Terminal.prototype.write = function (text, cls) {
    if (text == null || text === '') return;
    var div = document.createElement('div');
    if (cls) div.className = cls;
    div.innerHTML = W.colorHtml(text);
    this.out.appendChild(div);
    this.scroll();
  };

  Terminal.prototype.writeRaw = function (html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    this.out.appendChild(div);
    this.scroll();
  };

  Terminal.prototype.echo = function (cmdline) {
    var div = document.createElement('div');
    div.innerHTML = this.promptHtml() + '<span class="c-white">' +
      cmdline.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
    this.out.appendChild(div);
    this.scroll();
  };

  Terminal.prototype.scroll = function () {
    this.el.scrollTop = this.el.scrollHeight;
  };

  Terminal.prototype.clear = function () {
    this.out.innerHTML = '';
  };

  Terminal.prototype.focus = function () {
    if (!this.app) this.input.focus();
  };

  Terminal.prototype.submit = function () {
    var line = this.input.value;
    this.input.value = '';
    this.echo(line);
    if (line.trim()) {
      this.history.push(line);
      if (this.history.length > 500) this.history.shift();
    }
    this.histIdx = this.history.length;
    this.onCommand(line);
    this.refreshPrompt();
    this.scroll();
  };

  Terminal.prototype.recall = function (dir) {
    if (!this.history.length) return;
    this.histIdx += dir;
    if (this.histIdx < 0) this.histIdx = 0;
    if (this.histIdx >= this.history.length) {
      this.histIdx = this.history.length;
      this.input.value = '';
      return;
    }
    this.input.value = this.history[this.histIdx];
    var n = this.input.value.length;
    var self = this;
    setTimeout(function () { self.input.setSelectionRange(n, n); }, 0);
  };

  Terminal.prototype.complete = function () {
    var world = this.getWorld();
    if (!world) return;
    var value = this.input.value;
    var parts = value.split(/\s+/);
    var last = parts[parts.length - 1];
    var isFirst = parts.length === 1;
    var candidates = [];

    if (isFirst) {
      candidates = Object.keys(PS.shell.cmds).filter(function (c) { return c.indexOf(last) === 0; }).sort();
    } else {
      // path completion
      var slash = last.lastIndexOf('/');
      var dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
      var namePart = slash >= 0 ? last.slice(slash + 1) : last;
      var dirAbs = V.resolve(dirPart || '.', world.cwd, world.home);
      var node = V.lookup(world.root, dirAbs);
      if (node && node.type === 'dir') {
        candidates = Object.keys(node.children).filter(function (n) {
          return n.indexOf(namePart) === 0 && (namePart.charAt(0) === '.' || n.charAt(0) !== '.');
        }).sort().map(function (n) {
          return dirPart + n + (node.children[n].type === 'dir' ? '/' : '');
        });
      }
    }

    if (!candidates.length) return;

    if (candidates.length === 1) {
      parts[parts.length - 1] = candidates[0];
      this.input.value = parts.join(' ') + (candidates[0].slice(-1) === '/' ? '' : ' ');
      return;
    }

    // complete to the longest common prefix, then show the options
    var prefix = candidates[0];
    candidates.forEach(function (c) {
      var i = 0;
      while (i < prefix.length && i < c.length && prefix.charAt(i) === c.charAt(i)) i++;
      prefix = prefix.slice(0, i);
    });
    if (prefix.length > last.length) {
      parts[parts.length - 1] = prefix;
      this.input.value = parts.join(' ');
    } else {
      this.echo(value);
      this.write(candidates.join('   '), 'c-dim');
    }
  };

  /* ---------- interruptible / full screen commands ---------- */

  Terminal.prototype.startApp = function (app) {
    var self = this;
    this.app = app;
    this.input.blur();

    if (app.type === 'screen') {
      this.inputLine.classList.add('hidden');
      this.appEl.classList.remove('hidden');
      this.paint();
      this.timer = setInterval(function () { self.paint(); }, app.interval || 1000);
      return;
    }
    // stream and hang keep the normal scrollback
    this.inputLine.classList.add('hidden');
    if (app.type === 'stream') {
      this.timer = setInterval(function () {
        var more = app.next(self.getWorld());
        if (more) self.write(more);
      }, app.interval || 1000);
    }
  };

  Terminal.prototype.paint = function () {
    if (!this.app || this.app.type !== 'screen') return;
    var body = this.app.render(this.getWorld());
    this.appEl.innerHTML = W.colorHtml(body) +
      '\n\n' + W.colorHtml(W.dim(this.app.footer || 'press q or Ctrl+C to quit'));
  };

  Terminal.prototype.stopApp = function () {
    if (!this.app) return;
    var app = this.app;
    this.app = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.appEl.classList.add('hidden');
    this.appEl.innerHTML = '';
    this.inputLine.classList.remove('hidden');
    if (app.type === 'screen') {
      this.write(W.dim('(' + app.label + ' - exited)'));
    }
    this.refreshPrompt();
    this.focus();
  };

  Terminal.prototype.interrupt = function () {
    if (this.app) {
      this.write('^C');
      if (this.app.type === 'hang') {
        this.write(W.dim(this.app.note || ''));
      }
      this.stopApp();
      return;
    }
    if (this.input.value) {
      this.echo(this.input.value + '^C');
      this.input.value = '';
    }
    this.focus();
  };

  PS.Terminal = Terminal;
})(PS);
