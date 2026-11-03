// Каталоги BSData (Horus Heresy 3rd): качаются с GitHub, кешируются в IndexedDB,
// отдаются подложке строками (window.LRDATA). Логика как в MVP: web/js/app.js + store.js.
(function () {
  var REPO = 'BSData/horus-heresy-3rd-edition', BRANCH = 'main', SYSTEM = 'Horus Heresy 3rd Edition.json';

  function db() {
    return new Promise(function (ok, err) {
      var rq = indexedDB.open('liber-full', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('files'); };
      rq.onsuccess = function () { ok(rq.result); };
      rq.onerror = function () { err(rq.error); };
    });
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, err) {
        var t = d.transaction('files', mode), r = fn(t.objectStore('files'));
        t.oncomplete = function () { ok(r.result); };
        t.onerror = function () { err(t.error); };
      });
    });
  }
  var get = function (k) { return idb('readonly', function (s) { return s.get(k); }); };
  var put = function (k, v) { return idb('readwrite', function (s) { return s.put(v, k); }); };
  function status(t) { var el = document.getElementById('boot'); if (el) el.textContent = t; }

  // Список файлов из репозитория; при ошибке сети — последний сохранённый список
  function listing(meta) {
    return fetch('https://api.github.com/repos/' + REPO + '/contents?ref=' + BRANCH, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('GitHub ' + r.status); return r.json(); })
      .then(function (items) {
        return items.filter(function (it) { return it.type === 'file' && it.name.endsWith('.json'); })
          .map(function (it) { return { name: it.name, sha: it.sha, url: it.download_url }; });
      })
      .catch(function (e) {
        if (meta.names) return meta.names.map(function (n) { return { name: n, sha: meta.sha[n] }; });
        throw e;
      });
  }

  window.lrLoadData = function () {
    return get('_meta').then(function (saved) {
      var meta = saved || { sha: {}, names: null };
      status('Список каталогов…');
      return listing(meta).then(function (items) {
        var done = 0;
        var todo = [];
        return Promise.all(items.map(function (it) {
          return get(it.name).then(function (txt) { if (txt === undefined || meta.sha[it.name] !== it.sha) todo.push(it); });
        })).then(function () {
          var chunks = [];
          for (var i = 0; i < todo.length; i += 6) chunks.push(todo.slice(i, i + 6));
          return chunks.reduce(function (p, chunk) {
            return p.then(function () {
              return Promise.all(chunk.map(function (it) {
                var url = it.url || 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/' + encodeURIComponent(it.name);
                return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (txt) {
                  return put(it.name, txt).then(function () { meta.sha[it.name] = it.sha; done++; status('Каталоги BSData: ' + done + ' из ' + todo.length); });
                });
              }));
            });
          }, Promise.resolve());
        }).then(function () {
          meta.names = items.map(function (it) { return it.name; });
          return put('_meta', meta);
        });
      }).then(function () {
        var names = meta.names.filter(function (n) { return n !== SYSTEM; });
        return Promise.all([get(SYSTEM)].concat(names.map(get))).then(function (texts) {
          if (!texts[0]) throw new Error('нет файла системы');
          window.LRDATA = { system: texts[0], names: names, texts: texts.slice(1) };
        });
      });
    });
  };
})();
