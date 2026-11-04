// Фото миниатюр в браузере: кадр и исходник лежат в IndexedDB (lr-photos), а не в localStorage (его лимит ~5 МБ).
// Картинки доступны подложке через window.LRIMG: «photo:<ключ>» — кадр, «photosrc:<ключ>» — исходник (грузится по требованию).
// Старые фото из localStorage (lr-photo/<ключ>) при запуске переезжают в IndexedDB. Вызывается из lrshim/Photos.java.
(function () {
  var dbp = null, SRC_MAX = 1600;

  function db() {
    if (!dbp) dbp = new Promise(function (ok, err) {
      var r = indexedDB.open('lr-photos', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('img'); r.result.createObjectStore('src'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { err(r.error); };
    });
    return dbp;
  }
  function wrap(r) { return new Promise(function (ok, err) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { err(r.error); }; }); }
  function st(name, mode) { return db().then(function (d) { return d.transaction(name, mode).objectStore(name); }); }
  function get(name, k) { return st(name, 'readonly').then(function (s) { return wrap(s.get(k)); }); }
  function put(name, k, v) { return st(name, 'readwrite').then(function (s) { return wrap(s.put(v, k)); }); }
  function del(name, k) { return st(name, 'readwrite').then(function (s) { return wrap(s.delete(k)); }); }
  function errText(e) { return 'ERR:' + (e && e.message ? e.message : e); }

  function imgFromBlob(blob) {
    return new Promise(function (ok, err) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { ok(im); };
      im.onerror = function () { err(new Error('Не удалось открыть снимок')); };
      im.src = url;
    });
  }
  function toBlob(canvas, q) {
    return new Promise(function (ok, err) { canvas.toBlob(function (b) { b ? ok(b) : err(new Error('Не удалось сжать снимок')); }, 'image/jpeg', q); });
  }
  function blobToDataUrl(b) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.readAsDataURL(b); }); }

  window.lrPhotos = {
    /** Перенос из localStorage и загрузка всех кадров в LRIMG (ждёт index.html до запуска). */
    loadAll: function () {
      window.LRIMG = window.LRIMG || {};
      var old = [];
      try {
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf('lr-photo/') === 0) old.push(k); });
      } catch (e) { }
      var mig = old.reduce(function (chain, k) {
        return chain.then(function () {
          var data = localStorage.getItem(k);
          return fetch(data).then(function (r) { return r.blob(); }).then(function (b) { return put('img', k.substring('lr-photo/'.length), b); })
            .then(function () { localStorage.removeItem(k); });
        }).catch(function () { });
      }, Promise.resolve());
      return mig.then(function () {
        return st('img', 'readonly').then(function (s) {
          return new Promise(function (ok, err) {
            var out = [], c = s.openCursor();
            c.onsuccess = function () { var cur = c.result; if (!cur) { ok(out); return; } out.push([cur.key, cur.value]); cur.continue(); };
            c.onerror = function () { err(c.error); };
          });
        });
      }).then(function (all) {
        return Promise.all(all.map(function (kv) {
          return imgFromBlob(kv[1]).then(function (im) { window.LRIMG['photo:' + kv[0]] = im; }).catch(function () { });
        }));
      }).catch(function () { });
    },

    /** Выбор снимка (галерея или камера): исходник ужимается до 1600 px, EXIF-поворот учитывается; кадр = весь снимок. */
    pick: function (key, cb) {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = function () {
        var f = inp.files[0];
        if (!f) return;
        (window.createImageBitmap ? createImageBitmap(f, { imageOrientation: 'from-image' }) : imgFromBlob(f)).then(function (src) {
          var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
          var k = Math.min(1, SRC_MAX / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * k));
          cv.height = Math.max(1, Math.round(h * k));
          cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
          return toBlob(cv, 0.9).then(function (blob) {
            return put('src', key, blob).then(function () { return put('img', key, blob); }).then(function () { return imgFromBlob(blob); });
          });
        }).then(function (im) {
          window.LRIMG['photo:' + key] = im;
          window.LRIMG['photosrc:' + key] = im;
          cb('ok');
        }, function (e) {
          cb(e && e.name === 'QuotaExceededError' ? 'ERR:Места в хранилище не хватило — удалите часть фото' : errText(e));
        });
      };
      inp.click();
    },

    /** Подгрузить исходник в LRIMG (у старых фото исходника нет — берётся кадр). */
    loadSrc: function (key, cb) {
      if (window.LRIMG['photosrc:' + key]) { cb('ok'); return; }
      get('src', key).then(function (b) { return b || get('img', key); }).then(function (b) {
        if (!b) throw new Error('Фото не найдено');
        return imgFromBlob(b);
      }).then(function (im) { window.LRIMG['photosrc:' + key] = im; cb('ok'); }, function (e) { cb(errText(e)); });
    },

    /** Сохранить кадр: LRIMG обновляется сразу (холст), в IndexedDB — следом; о неудаче сообщает cb. */
    saveCrop: function (key, canvas, cb) {
      window.LRIMG['photo:' + key] = canvas;
      toBlob(canvas, 0.88).then(function (b) { return put('img', key, b); })
        .then(function () { cb('ok'); }, function (e) {
          cb(e && e.name === 'QuotaExceededError' ? 'ERR:Места в хранилище не хватило — удалите часть фото' : errText(e));
        });
    },

    remove: function (key) {
      if (window.LRIMG) { delete window.LRIMG['photo:' + key]; delete window.LRIMG['photosrc:' + key]; }
      del('img', key).catch(function () { });
      del('src', key).catch(function () { });
    }
  };
})();
