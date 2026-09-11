/* vfs.js - virtual filesystem for the simulated hosts.
 *
 * Everything the shell shows is derived from this tree plus the world state in
 * world.js. Nothing is hard-coded per command, which is why `du` and `df` can
 * legitimately disagree: df reads superblock counters, du walks this tree.
 */
var PS = window.PS || (window.PS = {});

(function (PS) {
  'use strict';

  function base(type, opts) {
    var n = {
      type: type,
      mode: type === 'dir' ? 'drwxr-xr-x' : (type === 'link' ? 'lrwxrwxrwx' : '-rw-r--r--'),
      owner: 'root',
      group: 'root',
      mtime: null,          // Date; null => scenario start time
      nlink: type === 'dir' ? 2 : 1,
      size: null,           // bytes; null => derived from content
      content: '',          // string, or function(world) -> string
      children: null,
      target: null,         // for symlinks
      inodes: null          // for dirs: pretend this dir holds N inodes (see df -i)
    };
    for (var k in (opts || {})) n[k] = opts[k];
    return n;
  }

  var vfs = {};

  vfs.dir = function (children, opts) {
    var n = base('dir', opts);
    n.children = children || {};
    return n;
  };

  vfs.file = function (content, opts) {
    var n = base('file', opts);
    n.content = content == null ? '' : content;
    return n;
  };

  vfs.link = function (target, opts) {
    var n = base('link', opts);
    n.target = target;
    return n;
  };

  /* ---------- path handling ---------- */

  vfs.normalize = function (p) {
    var abs = p.charAt(0) === '/';
    var parts = p.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (out.length) out.pop(); continue; }
      out.push(seg);
    }
    return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
  };

  vfs.resolve = function (p, cwd, home) {
    if (!p) return cwd;
    if (p === '~') p = home;
    else if (p.indexOf('~/') === 0) p = home + '/' + p.slice(2);
    if (p.charAt(0) !== '/') p = cwd + '/' + p;
    return vfs.normalize(p);
  };

  vfs.dirname = function (p) {
    p = vfs.normalize(p);
    if (p === '/') return '/';
    var i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  };

  vfs.basename = function (p) {
    p = vfs.normalize(p);
    if (p === '/') return '/';
    return p.slice(p.lastIndexOf('/') + 1);
  };

  /* Walk to a node. Returns null when any component is missing.
   * followLink: resolve a terminal symlink to its target. */
  vfs.lookup = function (root, abspath, followLink, linkDepth) {
    linkDepth = linkDepth || 0;
    if (linkDepth > 40) return null;
    var parts = vfs.normalize(abspath).split('/').filter(Boolean);
    var node = root, i;
    for (i = 0; i < parts.length; i++) {
      if (!node || node.type !== 'dir' || !node.children) return null;
      node = node.children[parts[i]];
      if (!node) return null;
      if (node.type === 'link' && (followLink !== false || i < parts.length - 1)) {
        var parentPath = '/' + parts.slice(0, i).join('/');
        var targetPath = node.target.charAt(0) === '/' ? node.target : vfs.normalize(parentPath + '/' + node.target);
        var t = vfs.lookup(root, targetPath, true, linkDepth + 1);
        if (!t) return i === parts.length - 1 ? node : null;
        node = t;
      }
    }
    return node;
  };

  vfs.exists = function (root, abspath) {
    return !!vfs.lookup(root, abspath);
  };

  /* Create/replace a file, making parent dirs as needed. */
  vfs.write = function (root, abspath, content, opts) {
    var parts = vfs.normalize(abspath).split('/').filter(Boolean);
    var name = parts.pop();
    var node = root;
    for (var i = 0; i < parts.length; i++) {
      if (!node.children[parts[i]]) node.children[parts[i]] = vfs.dir({});
      node = node.children[parts[i]];
      if (node.type !== 'dir') return false;
    }
    var existing = node.children[name];
    if (existing && existing.type === 'dir') return false;
    var metadata = existing ? { mode: existing.mode, owner: existing.owner, group: existing.group } : {};
    for (var key in (opts || {})) metadata[key] = opts[key];
    node.children[name] = vfs.file(content, metadata);
    return true;
  };

  vfs.unlink = function (root, abspath) {
    var parent = vfs.lookup(root, vfs.dirname(abspath));
    var name = vfs.basename(abspath);
    if (!parent || parent.type !== 'dir' || !parent.children[name]) return false;
    delete parent.children[name];
    return true;
  };

  /* ---------- content ---------- */

  vfs.read = function (node, world) {
    if (!node) return '';
    var c = node.content;
    if (typeof c === 'function') c = c(world);
    return c == null ? '' : String(c);
  };

  vfs.sizeOf = function (node, world) {
    if (!node) return 0;
    if (node.size != null) return node.size;
    if (node.type === 'dir') return 4096;
    return vfs.read(node, world).length;
  };

  /* ---------- traversal ---------- */

  /* fn(path, node, depth); return false from fn to prune a directory. */
  vfs.walk = function (root, abspath, fn, depth) {
    depth = depth || 0;
    var node = vfs.lookup(root, abspath, false);
    if (!node) return;
    if (fn(abspath, node, depth) === false) return;
    if (node.type === 'dir' && node.children) {
      var names = Object.keys(node.children).sort();
      for (var i = 0; i < names.length; i++) {
        var child = abspath === '/' ? '/' + names[i] : abspath + '/' + names[i];
        vfs.walk(root, child, fn, depth + 1);
      }
    }
  };

  /* Recursive apparent size in bytes, including a nominal 4K per directory. */
  vfs.diskUsage = function (root, abspath, world) {
    var total = 0;
    vfs.walk(root, abspath, function (p, node) {
      total += vfs.sizeOf(node, world);
    });
    return total;
  };

  /* ---------- globbing ---------- */

  vfs.globToRegex = function (pat) {
    var re = '';
    for (var i = 0; i < pat.length; i++) {
      var ch = pat.charAt(i);
      if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else if (ch === '[') {
        var j = pat.indexOf(']', i);
        if (j < 0) { re += '\\['; }
        else { re += pat.slice(i, j + 1); i = j; }
      } else re += ch.replace(/[.+^${}()|\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$');
  };

  vfs.hasGlob = function (s) { return /[*?[]/.test(s); };

  /* Expand one glob pattern against the tree. Returns [] when nothing matches
   * (callers then fall back to the literal word, like bash without nullglob). */
  vfs.glob = function (root, pattern, cwd, home) {
    if (!vfs.hasGlob(pattern)) return [pattern];
    var abs = vfs.resolve(pattern, cwd, home);
    var parts = abs.split('/').filter(Boolean);
    var results = [''];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      var next = [];
      for (var j = 0; j < results.length; j++) {
        var dirPath = results[j] || '/';
        if (!vfs.hasGlob(seg)) {
          var probe = (results[j] === '' ? '' : results[j]) + '/' + seg;
          if (vfs.lookup(root, probe)) next.push(probe);
          continue;
        }
        var d = vfs.lookup(root, dirPath);
        if (!d || d.type !== 'dir') continue;
        var rx = vfs.globToRegex(seg);
        var names = Object.keys(d.children).sort();
        for (var k = 0; k < names.length; k++) {
          if (names[k].charAt(0) === '.' && seg.charAt(0) !== '.') continue;
          if (rx.test(names[k])) next.push((results[j] === '' ? '' : results[j]) + '/' + names[k]);
        }
      }
      results = next;
      if (!results.length) return [];
    }
    // Return paths relative to cwd when the pattern was relative, like a shell.
    if (pattern.charAt(0) !== '/' && pattern.charAt(0) !== '~') {
      var prefix = cwd === '/' ? '/' : cwd + '/';
      results = results.map(function (p) {
        return p.indexOf(prefix) === 0 ? p.slice(prefix.length) : p;
      });
    }
    return results;
  };

  /* ---------- listing helpers ---------- */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  vfs.lsTime = function (d, nowDate) {
    if (!d) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = MONTHS[d.getMonth()] + ' ' + (d.getDate() < 10 ? ' ' : '') + d.getDate();
    var ageDays = nowDate ? (nowDate - d) / 86400000 : 0;
    if (ageDays > 180) return stamp + '  ' + d.getFullYear();
    return stamp + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  PS.vfs = vfs;
})(PS);
