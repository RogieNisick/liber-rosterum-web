// Глашатай: заранее записанные фразы (voice_gen/gen.py) через Web Audio. Один голос на всех устройствах, в том числе на iPhone.
(function () {
  var buffers = {}, current = null, token = 0;
  function context() {
    var s = window.LRSND || (window.LRSND = { ctx: null, buf: {}, streams: {}, next: 1 });
    if (!s.ctx) s.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return s.ctx;
  }
  // iOS разрешает звук только после касания: на первом же касании будим контекст тихим буфером.
  function unlock() {
    try {
      var c = context();
      if (c.state === 'suspended') c.resume();
      var src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch (e) { }
  }
  ['pointerdown', 'touchend', 'mousedown', 'keydown'].forEach(function (n) { window.addEventListener(n, unlock, { capture: true, passive: true }); });
  function load(file) {
    if (buffers[file]) return buffers[file];
    return buffers[file] = fetch('voice/' + file + '.mp3').then(function (r) {
      if (!r.ok) throw new Error('voice ' + r.status);
      return r.arrayBuffer();
    }).then(function (data) {
      return new Promise(function (ok, fail) { context().decodeAudioData(data, ok, fail); });
    }).catch(function (e) { delete buffers[file]; throw e; });
  }
  function stop() {
    token++;
    if (current) { try { current.stop(); } catch (e) { } current = null; }
  }
  window.lrHerald = {
    has: function (text) { return !!(window.LR_HERALD && window.LR_HERALD[text]); },
    stop: stop,
    say: function (text) {
      var file = window.LR_HERALD[text];
      stop();
      var mine = token, c = context();
      if (c.state === 'suspended') c.resume();
      load(file).then(function (buffer) {
        if (mine !== token) return;
        var src = c.createBufferSource();
        src.buffer = buffer;
        src.connect(c.destination);
        src.start(0);
        current = src;
        window.lrHeraldLast = { text: text, duration: buffer.duration, state: c.state };
      }).catch(function (e) { window.lrHeraldLast = { text: text, error: String(e) }; });
    }
  };
})();
