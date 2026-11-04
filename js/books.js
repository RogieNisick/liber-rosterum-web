// Библиотека правил в браузере: PDF книг лежат в IndexedDB (lr-books), страницы рисует pdf.js (cdnjs, грузится при первом открытии),
// поисковые индексы library/*.idx.gz распаковываются через DecompressionStream. Книги пользователь загружает сам.
// Вызывается из lrshim/Books.java.
(function () {
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var dbp = null, docs = {}, libP = null, tmpN = 0;

  function db() {
    if (!dbp) dbp = new Promise(function (ok, err) {
      var r = indexedDB.open('lr-books', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('pdf'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { err(r.error); };
    });
    return dbp;
  }
  function wrap(r) { return new Promise(function (ok, err) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { err(r.error); }; }); }
  function store(mode) { return db().then(function (d) { return d.transaction('pdf', mode).objectStore('pdf'); }); }
  function get(k) { return store('readonly').then(function (s) { return wrap(s.get(k)); }); }
  function put(k, v) { return store('readwrite').then(function (s) { return wrap(s.put(v, k)); }); }
  function del(k) { return store('readwrite').then(function (s) { return wrap(s.delete(k)); }); }
  function errText(e) { return 'ERR:' + (e && e.message ? e.message : e); }

  function pdfjs() {
    if (!libP) {
      libP = new Promise(function (ok, err) {
        var s = document.createElement('script');
        s.src = PDFJS + 'pdf.min.js';
        s.onload = ok;
        s.onerror = function () { libP = null; err(new Error('Не загрузилась pdf.js (нужен интернет)')); };
        document.head.appendChild(s);
      }).then(function () { return fetch(PDFJS + 'pdf.worker.min.js'); })
        .then(function (r) { return r.blob(); })
        .then(function (b) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b); return window.pdfjsLib; });
    }
    return libP;
  }

  function pageCount(blob) {
    return Promise.all([pdfjs(), blob.arrayBuffer()]).then(function (a) {
      return a[0].getDocument({ data: new Uint8Array(a[1]) }).promise;
    }).then(function (doc) { var n = doc.numPages; doc.destroy(); return n; });
  }

  // все .pdf из ZIP (способы 0 и 8)
  function unzipPdfs(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), eocd = -1, out = [];
    for (var i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 65557; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Файл не похож на архив'));
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), jobs = [];
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
          elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (!/\.pdf$/i.test(name)) continue;
      var start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      var data = u8.subarray(start, start + size);
      (function (nm, mth, dt) {
        jobs.push(mth === 0 ? Promise.resolve({ name: nm.split('/').pop(), blob: new Blob([dt], { type: 'application/pdf' }) })
          : mth === 8 ? new Response(new Blob([dt]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
              .then(function (b) { return { name: nm.split('/').pop(), blob: b }; })
          : Promise.reject(new Error('Неизвестный способ сжатия в архиве')));
      })(name, method, data);
    }
    return Promise.all(jobs);
  }

  window.lrBooks = {
    /** Имена индексов (LR_LIB из assets.js), по одному на строку. */
    idxNames: function () { return (window.LR_LIB || []).join('\n'); },

    idx: function (name, cb) {
      fetch('library/' + name).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
      }).then(function (t) { cb(t); }, function (e) { cb(errText(e)); });
    },

    /** Загруженные книги: «ключ \t размер \t страниц» по строке. */
    sizes: function (cb) {
      store('readonly').then(function (s) {
        return new Promise(function (ok, err) {
          var out = [], c = s.openCursor();
          c.onsuccess = function () {
            var cur = c.result;
            if (!cur) { ok(out.join('\n')); return; }
            var v = cur.value;
            if (String(cur.key).indexOf('tmp:') !== 0 && v && v.blob) out.push(cur.key + '\t' + v.blob.size + '\t' + v.pages);
            cur.continue();
          };
          c.onerror = function () { err(c.error); };
        });
      }).then(function (t) { cb(t); }, function (e) { cb(errText(e)); });
    },

    /** Выбор PDF/ZIP (несколько): файлы кладутся в IndexedDB под временными ключами; в done — «ключ \t имя \t страниц» по строке. */
    pick: function (step, done) {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.accept = '.pdf,.zip,application/pdf,application/zip';
      inp.onchange = function () {
        var files = Array.prototype.slice.call(inp.files);
        if (!files.length) return;
        var out = [];
        files.reduce(function (chain, f) {
          return chain.then(function () {
            step('Читаю: ' + f.name);
            return /\.zip$/i.test(f.name) ? f.arrayBuffer().then(unzipPdfs) : [{ name: f.name, blob: f }];
          }).then(function (entries) {
            return entries.reduce(function (c2, en) {
              return c2.then(function () {
                step('Проверяю: ' + en.name);
                return pageCount(en.blob).catch(function () { return -1; }).then(function (pages) {
                  var key = 'tmp:' + (++tmpN);
                  return put(key, { blob: en.blob, pages: pages }).then(function () { out.push(key + '\t' + en.name + '\t' + pages); });
                });
              });
            }, Promise.resolve());
          }).catch(function (e) { out.push('bad\t' + f.name + '\t-1'); });
        }, Promise.resolve()).then(function () { done(out.join('\n')); });
      };
      inp.click();
    },

    /** Временный ключ → постоянный. */
    commit: function (tmp, id, cb) {
      get(tmp).then(function (v) { return put(id, v); }).then(function () { return del(tmp); })
        .then(function () { cb('ok'); }, function (e) { cb(errText(e)); });
    },
    drop: function (key, cb) { del(key).then(function () { cb('ok'); }, function (e) { cb(errText(e)); }); },

    open: function (id, cb) {
      if (docs[id]) { cb(String(docs[id].numPages)); return; }
      Promise.all([pdfjs(), get(id)]).then(function (a) {
        if (!a[1] || !a[1].blob) throw new Error('Книга не найдена');
        return a[1].blob.arrayBuffer().then(function (buf) { return a[0].getDocument({ data: new Uint8Array(buf) }).promise; });
      }).then(function (doc) { docs[id] = doc; cb(String(doc.numPages)); }, function (e) { cb(errText(e)); });
    },
    close: function (id) { var d = docs[id]; if (d) { delete docs[id]; try { d.destroy(); } catch (e) { } } },

    /** mode 0 — вся страница шириной bw пикселей; mode 1 — видимая область w×h с масштабом s и сдвигом ox, oy. cb(ширина стр., высота стр., холст). */
    render: function (id, idx, mode, bw, s, ox, oy, w, h, cb) {
      var doc = docs[id];
      if (!doc) { cb(0, 0, null); return; }
      doc.getPage(idx + 1).then(function (page) {
        var v0 = page.getViewport({ scale: 1 });
        var cv = document.createElement('canvas'), ctx = cv.getContext('2d'), task;
        if (mode === 0) {
          var sc = bw / v0.width;
          cv.width = Math.max(1, Math.round(bw));
          cv.height = Math.max(1, Math.round(v0.height * sc));
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, cv.width, cv.height);
          task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: sc }) });
        } else {
          cv.width = w;
          cv.height = h;
          task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: s, offsetX: ox, offsetY: oy }) });
        }
        return task.promise.then(function () { cb(v0.width, v0.height, cv); });
      }).catch(function () { cb(0, 0, null); });
    }
  };
})();
