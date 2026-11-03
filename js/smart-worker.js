// Умный ростер в фоновом потоке: свой экземпляр движка, данные — из той же IndexedDB.
importScripts('engine.js', 'store.js');
const SYSTEM_FILE = 'Horus Heresy 3rd Edition.json';
let ready = null;

function call(cmd, arg) {
  const r = JSON.parse(self.lrCall(cmd, arg === undefined ? '' : typeof arg === 'string' ? arg : JSON.stringify(arg)));
  if (r.err) throw new Error(r.err);
  return r.ok;
}

async function load() {
  self.window = self; // WebApi кладёт мост в window.lrCall
  main([]);
  call('sys', await DB.get('files', SYSTEM_FILE));
  for (const n of await DB.keys('files')) if (n !== SYSTEM_FILE && !n.startsWith('_')) call('cat:' + n, await DB.get('files', n));
  call('finish');
}

self.onmessage = async e => {
  const { id, cmd, arg, reload } = e.data;
  try {
    if (!ready || reload) ready = load();
    await ready;
    self.postMessage({ id, ok: call(cmd, arg) });
  } catch (err) {
    self.postMessage({ id, err: String(err && err.message || err) });
  }
};
