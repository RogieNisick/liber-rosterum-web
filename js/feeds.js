// Разбор RSS/Atom для News (как News.fetch в Android, но DOM браузера) и загрузка картинок новостей в LRIMG.
(function () {
  function txt(el, tag) { var n = el.getElementsByTagName(tag); return n.length ? n[0].textContent : null; }
  function first(a, b) { return a && a.trim() ? a : b; }
  function img(el) {
    var tags = ['media:content', 'media:thumbnail', 'enclosure'];
    for (var t = 0; t < tags.length; t++) {
      var n = el.getElementsByTagName(tags[t]);
      for (var i = 0; i < n.length; i++) {
        var u = n[i].getAttribute('url'), ty = n[i].getAttribute('type') || '';
        if (u && (!ty || ty.indexOf('image') === 0)) return u;
      }
    }
    var bodies = ['content:encoded', 'description', 'content', 'summary'];
    for (var b = 0; b < bodies.length; b++) {
      var h = txt(el, bodies[b]);
      var m = h && /<img[^>]+src=["']([^"']+)/.exec(h);
      if (m) return m[1].replace(/&amp;/g, '&');
    }
    return null;
  }
  window.lrFeeds = {
    /** XML ленты → JSON-массив {title, link, text, date, img} (до 40 записей; text — как в ленте, чистит Java). */
    parse: function (xml) {
      var doc = new DOMParser().parseFromString(xml, 'application/xml');
      var items = doc.getElementsByTagName('item'), atom = items.length === 0;
      if (atom) items = doc.getElementsByTagName('entry');
      var out = [];
      for (var i = 0; i < items.length && i < 40; i++) {
        var el = items[i], link = null, text, date;
        if (atom) {
          var ls = el.getElementsByTagName('link');
          for (var k = 0; k < ls.length; k++) {
            var rel = ls[k].getAttribute('rel');
            if (!rel || rel === 'alternate') { link = ls[k].getAttribute('href'); break; }
          }
          text = first(txt(el, 'summary'), txt(el, 'content'));
          date = first(txt(el, 'published'), txt(el, 'updated'));
        } else {
          link = txt(el, 'link');
          text = txt(el, 'description');
          date = first(txt(el, 'pubDate'), txt(el, 'dc:date'));
        }
        var d = Date.parse(date || ''), title = txt(el, 'title');
        if (!title || !link) continue;
        out.push({ title: title, link: link, text: text, date: isNaN(d) ? 0 : d, img: img(el) });
      }
      return JSON.stringify(out);
    },
    /** Картинка по адресу → LRIMG[path] (рисовать можно, читать пиксели — нет, это и не нужно). */
    loadImage: function (url, path, cb) {
      if (window.LRIMG[path]) { cb('ok'); return; }
      var im = new Image();
      im.referrerPolicy = 'no-referrer';
      im.onload = function () { window.LRIMG[path] = im; cb('ok'); };
      im.onerror = function () { cb('ERR'); };
      im.src = url;
    }
  };
})();
