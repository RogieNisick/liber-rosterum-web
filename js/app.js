'use strict';
// Liber Rosterum — веб-версия. Экраны повторяют Android-версию; правила считает движок из engine.js (TeaVM).

const REPO = 'BSData/horus-heresy-3rd-edition', BRANCH = 'main', SYSTEM_FILE = 'Horus Heresy 3rd Edition.json';
const APP_VERSION = 'web 1.0';
const ACT = { NONE: 0, GO_FORCE: 1, OPEN_UNIT: 2, ADD_UNIT: 3, ADD_DET: 4, EDIT_LIMIT: 5 };

// ============================================================ мост к движку
function call(cmd, arg) {
  const s = window.lrCall(cmd, arg === undefined ? '' : typeof arg === 'string' ? arg : JSON.stringify(arg));
  const r = JSON.parse(s);
  if (r.err) throw new Error(r.err);
  return r.ok;
}

// ============================================================ DOM-помощники
function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const e = document.createElement(t || 'div');
  if (cls.length) e.className = cls.join(' ');
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className += (e.className ? ' ' : '') + v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  add(e, kids);
  return e;
}
function add(e, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(e, k);
    else e.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
const svg = (name, cls) => { const t = document.createElement('template'); t.innerHTML = glyph(name, cls); return t.content.firstChild; };
const fmt = v => v === Math.round(v) ? String(Math.round(v)) : v.toFixed(1);
const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };
const shortName = s => (s || '').replace(/^[IVXL]+ - /, '');

function hex(theme, content, size) {
  const t = theme || THEME_DEFAULT;
  const e = h('div.hex', { style: { width: size + 'px', height: size + 'px', '--h-accent': t.accent, '--h-trim': mix(t.trim, '#C4A462', 0.6), color: onColor(t.accent) } });
  if (content && content.numeral) e.appendChild(h('span.num', null, content.numeral));
  else e.appendChild(svg(content || 'shield'));
  return e;
}
function factionHex(name, size) {
  const t = themeFor(name);
  return hex(t, t.numeral ? { numeral: t.numeral } : 'banner', size);
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { } }

// ------------------------------------------------------------ лист снизу
const Sheet = {
  onClose: null,
  open(title, sub) {
    const w = document.getElementById('sheet-wrap'), s = document.getElementById('sheet');
    s.innerHTML = '';
    s.appendChild(h('div.grip'));
    if (title) s.appendChild(h('h2', null, title));
    s.appendChild(h('div.ssub', null, sub || ''));
    const body = h('div.col');
    s.appendChild(body);
    w.classList.add('open');
    s.scrollTop = 0;
    this.onClose = null;
    return body;
  },
  close() {
    const w = document.getElementById('sheet-wrap');
    if (!w.classList.contains('open')) return;
    w.classList.remove('open');
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
  },
  item(body, glyphName, name, sub, onclick, opts = {}) {
    const it = h('button.sitem.steel-flat.press' + (opts.red ? '.red' : ''), { onclick: () => { haptic(); onclick(); } },
      opts.icon || (glyphName ? svg(glyphName, 'g') : null),
      h('div.col.grow', null, h('div.n', null, name), sub ? h('div.s', null, sub) : null));
    body.appendChild(it);
    return it;
  },
};

function confirmBox(title, text, okLabel, onOk) {
  const body = Sheet.open(title, text);
  body.appendChild(h('div.row.gap8', { style: { marginTop: '6px' } },
    h('button.danger.grow.press', { onclick: () => { Sheet.close(); onOk(); } }, okLabel),
    h('button.sbtn.grow.press', { onclick: () => Sheet.close() }, 'Отмена')));
}

// ============================================================ навигация
const Nav = {
  stack: [],
  push(screen) {
    const cur = this.stack[this.stack.length - 1];
    if (cur && cur.el) cur.scroll = cur.el.scrollTop;
    this.stack.push(screen);
    try { history.pushState({ d: this.stack.length }, ''); } catch (e) { }
    this.show(false);
  },
  replace(screen) {
    const old = this.stack.pop();
    if (old && old.leave) old.leave();
    this.stack.push(screen);
    this.show(false);
  },
  /** Кнопка «назад» в шапке. */
  back() { if (this.stack.length > 1) history.back(); },
  onPop() {
    if (document.getElementById('sheet-wrap').classList.contains('open')) { Sheet.close(); try { history.pushState({ d: this.stack.length }, ''); } catch (e) { } return; }
    if (this.stack.length <= 1) return;
    const top = this.stack[this.stack.length - 1];
    if (top.beforeBack && top.beforeBack() === false) { try { history.pushState({ d: this.stack.length }, ''); } catch (e) { } return; }
    this.stack.pop();
    if (top.leave) top.leave();
    this.show(true);
  },
  /** Перерисовать текущий экран, сохранив прокрутку. */
  refresh() {
    const cur = this.stack[this.stack.length - 1];
    if (cur && cur.el) cur.scroll = cur.el.scrollTop;
    this.show(true, true);
  },
  show(back, keep) {
    const app = document.getElementById('app');
    const cur = this.stack[this.stack.length - 1];
    if (cur.theme) applyTheme(cur.theme);
    let el;
    try { el = cur.render(); } catch (e) { console.error(e); el = h('div', null, header('Ошибка', null, true), h('div.parch.card.ink', null, String(e.message || e))); }
    el.classList.add('screen');
    if (back) el.classList.add('back');
    if (keep) el.style.animation = 'none';
    app.innerHTML = '';
    app.appendChild(el);
    cur.el = el;
    if (back && cur.scroll) el.scrollTop = cur.scroll;
    if (cur.shown) cur.shown();
  },
};
window.addEventListener('popstate', () => Nav.onPop());

function header(title, sub, backBtn, extra) {
  return h('div.header', null,
    h('div.row', null,
      backBtn ? h('button.sbtn.back.press', { onclick: () => Nav.back(), 'aria-label': 'Назад' }, '‹') : null,
      h('div.col.grow', null, h('h1', null, title), sub ? h('div.sub', null, sub) : null),
      extra || null),
    h('div.divider', null, svg('skull', '')));
}
function ribbon(text) { return h('div.ribbon', null, h('span', null, text)); }

// ============================================================ данные BSData
const Data = {
  factions: [],
  revision: 0,
  async listing() {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents?ref=${BRANCH}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('GitHub ответил ' + r.status);
    return (await r.json()).filter(f => f.type === 'file' && f.name.endsWith('.json'));
  },
  /** Скачать изменившиеся файлы (по sha, как Store.download). */
  async download(onStep) {
    onStep('Запрос списка файлов', 0, 1);
    const items = await this.listing();
    const meta = (await DB.get('kv', 'meta')) || { sha: {} };
    const have = new Set(await DB.keys('files'));
    const want = items.filter(it => !(have.has(it.name) && it.sha && meta.sha[it.name] === it.sha));
    let done = 0;
    for (const it of want) {
      onStep(it.name.replace('.json', ''), done, want.length);
      const url = it.download_url || `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${encodeURIComponent(it.name)}`;
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(it.name + ': ' + resp.status);
      await DB.put('files', it.name, await resp.text());
      meta.sha[it.name] = it.sha;
      done++;
    }
    const present = new Set(items.map(i => i.name));
    for (const k of have) if (!present.has(k)) { await DB.del('files', k); delete meta.sha[k]; }
    meta.updated = Date.now();
    await DB.put('kv', 'meta', meta);
    return want.length;
  },
  async hasFiles() { return (await DB.keys('files')).includes(SYSTEM_FILE); },
  /** Загрузить всё в движок. */
  async load(onStep) {
    const names = (await DB.keys('files')).filter(n => n !== SYSTEM_FILE && !n.startsWith('_'));
    onStep('Игровая система', 0, names.length + 1);
    await tick();
    call('sys', await DB.get('files', SYSTEM_FILE));
    let i = 1;
    for (const n of names) {
      onStep(n.replace('.json', ''), i++, names.length + 1);
      await tick();
      call('cat:' + n, await DB.get('files', n));
    }
    onStep('Сведение каталогов', names.length + 1, names.length + 1);
    await tick();
    this.factions = call('finish');
    this.revision = call('revision');
  },
};
const tick = () => new Promise(r => setTimeout(r, 0));

// Фоновый поток для долгих расчётов (Умный ростер); без Worker — считаем здесь же.
const Bg = {
  w: null, seq: 0, wait: {}, stale: false,
  call(cmd, arg) {
    if (!this.w) {
      try {
        this.w = new Worker('js/smart-worker.js');
        this.w.onmessage = e => { const p = this.wait[e.data.id]; delete this.wait[e.data.id]; if (p) e.data.err ? p.rej(new Error(e.data.err)) : p.res(e.data.ok); };
        this.w.onerror = () => { for (const k in this.wait) this.wait[k].rej(new Error('Сбой фонового расчёта')); this.wait = {}; this.w = null; };
      } catch (e) { return Promise.resolve().then(() => call(cmd, arg)); }
    }
    const id = ++this.seq, reload = this.stale;
    this.stale = false;
    return new Promise((res, rej) => { this.wait[id] = { res, rej }; this.w.postMessage({ id, cmd, arg, reload }); });
  },
};

// ============================================================ ростеры
const Rosters = {
  async all() { return (await DB.all('rosters')).map(s => JSON.parse(s)); },
  async get(id) { const s = await DB.get('rosters', id); return s ? JSON.parse(s) : null; },
  async put(json) { const r = JSON.parse(json); await DB.put('rosters', r.id, json); return r; },
  async del(id) { await DB.del('rosters', id); },
  /** Сохранить текущий открытый в движке ростер. */
  save() { const json = call('save'); return this.put(json); },
};

async function openRoster(id) {
  const r = await Rosters.get(id);
  if (!r) return toast('Ростер не найден');
  call('open', { roster: r });
  Nav.push(new RosterScreen());
}

// ============================================================ экраны
class LoadingScreen {
  constructor() { this.msg = 'Пробуждаем когитатор…'; this.p = 0; }
  render() {
    return h('div', null, h('div.loading', null,
      h('img', { src: 'icons/icon-180.png', alt: '' }),
      h('div.names.big', null, 'Liber Rosterum'),
      h('div.gold.small', { id: 'ld-msg', style: { marginTop: '8px' } }, this.msg),
      h('div.gauge.bar', null, h('i', { id: 'ld-bar', style: { width: (this.p * 100) + '%' } })),
      h('div.dim.tiny', { id: 'ld-sub' }, this.sub || ''),
      this.error ? h('div.col', { style: { width: '100%', maxWidth: '340px', marginTop: '14px' } },
        h('div.banner', null, h('div.col', null, h('div.t', null, this.error), h('div.f', null, 'Нужен интернет для первой загрузки данных BSData (~20 МБ). Потом всё работает офлайн.'))),
        h('button.brass.press', { style: { marginTop: '10px' }, onclick: () => boot() }, 'Повторить')) : null));
  }
  step(msg, i, n, sub) {
    this.msg = msg; this.p = n ? i / n : 0; this.sub = sub;
    const m = document.getElementById('ld-msg'), b = document.getElementById('ld-bar'), s = document.getElementById('ld-sub');
    if (m) m.textContent = msg;
    if (b) b.style.width = (this.p * 100) + '%';
    if (s) s.textContent = sub || '';
  }
}

class MenuScreen {
  constructor() { this.theme = THEME_DEFAULT; }
  render() {
    const c = h('div');
    c.appendChild(h('div.menu-hero', null,
      h('img', { src: 'icons/icon-180.png', alt: '' }),
      h('h1', null, 'LIBER ROSTERUM'),
      h('div.sub', null, 'ЕРЕСЬ ХОРУСА · III РЕДАКЦИЯ')));
    c.appendChild(h('div.divider', null, svg('skull')));
    const mb = (g, n, s, f) => h('button.mbtn.steel.press', { onclick: () => { haptic(); f(); } }, svg(g), h('div.col.grow', null, h('div.n', null, n), h('div.s', null, s)));
    c.appendChild(mb('scroll', 'Мои ростеры', 'Архив армий', () => Nav.push(new RosterListScreen())));
    c.appendChild(mb('plus', 'Новый ростер', 'Призвать армию', () => Nav.push(new NewRosterScreen())));
    c.appendChild(mb('brain', 'Умный ростер', 'Когитатор соберёт армию под противника', () => Nav.push(new SmartScreen())));
    c.appendChild(mb('import', 'Импорт .rosz', 'Из BattleScribe или New Recruit', () => importFile()));
    c.appendChild(mb('refresh', 'Данные BSData', 'Ревизия ' + Data.revision + ' · проверить обновления', () => updateData()));
    c.appendChild(mb('skull', 'Имя и статистика', Names.name ? 'Командир ' + Names.name : 'Имя не задано', () => Names.settings()));
    c.appendChild(h('div.dim.tiny', { style: { textAlign: 'center', marginTop: '18px' } },
      APP_VERSION + ' · данные BSData/horus-heresy-3rd-edition · работает офлайн'));
    if (!navigator.standalone && /iPhone|iPad/.test(navigator.userAgent)) {
      c.appendChild(h('div.parch.card.ink.small', { style: { marginTop: '14px' } },
        h('b', null, 'Совет: '), 'нажмите «Поделиться» в Safari → «На экран „Домой“», чтобы открыть Liber Rosterum как приложение.'));
    }
    return c;
  }
}

async function updateData() {
  const body = Sheet.open('Данные BSData', 'Проверяем репозиторий…');
  const st = h('div.gold', null, 'Запрос списка файлов…');
  body.appendChild(st);
  body.appendChild(h('div.spin'));
  try {
    const n = await Data.download((m, i, k) => { st.textContent = m + (k > 1 ? `  (${i}/${k})` : ''); });
    if (n === 0) { Sheet.close(); toast('Данные актуальны'); return; }
    st.textContent = 'Перечитываем каталоги…';
    await Data.load(m => { st.textContent = 'Загрузка: ' + m; });
    Bg.stale = true;
    Sheet.close();
    toast('Обновлено файлов: ' + n);
    Nav.refresh();
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(h('div.banner', null, h('div.t', null, 'Не удалось обновить: ' + e.message)));
  }
}

// ------------------------------------------------------------ архив
class RosterListScreen {
  render() {
    const c = h('div');
    c.appendChild(header('Мои ростеры', 'Архив армий', true));
    const list = h('div.col');
    c.appendChild(list);
    Rosters.all().then(all => {
      if (!all.length) {
        list.appendChild(h('div.parch.card.ink', null, 'Ростеров пока нет. Создайте новый или импортируйте .rosz.'));
        list.appendChild(h('button.brass.press', { style: { marginTop: '10px' }, onclick: () => Nav.replace(new NewRosterScreen()) }, '＋  Новый ростер'));
        return;
      }
      const sums = call('summaries', { rosters: all }).sort((a, b) => (b.updated || 0) - (a.updated || 0));
      for (const s of sums) {
        const over = s.pts > s.limit;
        list.appendChild(h('div.urow.parch.tap.press', { onclick: () => openRoster(s.id) },
          factionHex(s.catName, 46),
          h('div.col.grow', null,
            h('div.names.ink.ellipsis', { style: { fontSize: '16px' } }, s.name),
            h('div.small.ink-dim.ellipsis', null, shortName(s.catName)),
            s.errors ? h('div.small.ink-red.b', null, '⚠ ' + s.errors + ' ' + plural(s.errors, 'ошибка', 'ошибки', 'ошибок')) : null),
          h('div.col', { style: { alignItems: 'flex-end' } },
            h('div.pts', { style: { color: over ? '#B02020' : 'var(--ink-red)' } }, s.pts == null ? '?' : fmt(s.pts)),
            h('div.tiny.ink-dim', null, '/ ' + fmt(s.limit))),
          h('button.sbtn.icon-btn.press', { onclick: ev => { ev.stopPropagation(); rosterMenu(s); } }, svg('more'))));
      }
    });
    return c;
  }
}

function rosterMenu(s) {
  const body = Sheet.open(s.name, shortName(s.catName));
  Sheet.item(body, 'copy', 'Дублировать', null, async () => {
    const r = await Rosters.get(s.id);
    r.id = Date.now().toString(36);
    r.name = r.name + ' (копия)';
    r.updated = Date.now();
    await DB.put('rosters', r.id, JSON.stringify(r));
    Sheet.close();
    Nav.refresh();
  });
  Sheet.item(body, 'trash', 'Удалить', null, () => confirmBox('Удалить «' + s.name + '»?', 'Это действие нельзя отменить.', 'Удалить', async () => {
    await Rosters.del(s.id);
    Nav.refresh();
  }), { red: true });
}

// ------------------------------------------------------------ новый ростер
class NewRosterScreen {
  constructor() { this.theme = THEME_DEFAULT; this.name = ''; this.limit = '3000'; }
  render() {
    const c = h('div');
    c.appendChild(header('Новый ростер', 'Призвать армию', true));
    c.appendChild(h('div.label', null, 'НАЗВАНИЕ'));
    c.appendChild(h('input.input', { value: this.name, placeholder: 'Например: Крестовый поход на Улланор', oninput: e => this.name = e.target.value }));
    c.appendChild(h('div.label', null, 'ЛИМИТ ОЧКОВ'));
    const lim = h('input.input', { value: this.limit, inputmode: 'numeric', placeholder: 'Очки', oninput: e => this.limit = e.target.value });
    c.appendChild(h('div.row.gap6', { style: { marginBottom: '6px' } },
      [1000, 2000, 3000, 4000].map(v => h('button.sbtn.grow.press', { onclick: () => { this.limit = String(v); lim.value = v; } }, String(v)))));
    c.appendChild(lim);
    c.appendChild(ribbon('ВЫБЕРИТЕ ЗНАМЯ'));
    let legH = false, othH = false;
    for (const f of Data.factions) {
      if (f.legion && !legH) { legH = true; c.appendChild(h('div.label.dim', null, 'ЛЕГИОНЫ АСТАРТЕС')); }
      if (!f.legion && !othH) { othH = true; c.appendChild(h('div.label.dim', null, 'ПРОЧИЕ СИЛЫ')); }
      const t = themeFor(f.name);
      c.appendChild(h('button.sitem.steel-flat.press', { style: { width: '100%', '--trim-mix': mix(t.trim, '#C4A462', 0.6) }, onclick: () => this.create(f) },
        factionHex(f.name, 46),
        h('div.col.grow', { style: { textAlign: 'left' } }, h('div.n', { style: { fontSize: '18px' } }, f.legion ? f.short : f.name),
          h('div.b', { style: { color: accentBright(t.accent), fontSize: '12px' } }, '━━━━'))));
    }
    return c;
  }
  async create(f) {
    haptic();
    const json = call('newRoster', { name: this.name, limit: parseFloat(this.limit) || 3000, cat: f.id });
    await Rosters.put(json);
    Nav.replace(new RosterScreen());
  }
}

// ------------------------------------------------------------ ростер
class RosterScreen {
  constructor() { this.chart = Prefs.get('roster_chart', false); }
  render() {
    const v = this.v = call('roster');
    this.theme = themeFor(v.catName);
    applyTheme(this.theme);
    const c = h('div');
    c.appendChild(header(v.name, v.catName, true, h('div.row.gap6', null,
      h('button.sbtn.icon-btn.press', { onclick: () => confirmBox('Удалить «' + v.name + '»?', 'Это действие нельзя отменить.', 'Удалить', async () => {
        const r = JSON.parse(call('save'));
        await Rosters.del(r.id);
        Nav.back();
      }) }, svg('trash')),
      h('button.sbtn.icon-btn.press', { onclick: () => this.actions() }, svg('more')))));

    const over = v.pts > v.limit;
    const errs = v.errors;
    c.appendChild(h('div.summary.steel', { onclick: () => errs && this.showIssues() },
      h('div.col.grow', null,
        h('div.row', null, h('span.p', { class: over ? 'bad' : 'bone' }, fmt(v.pts)), h('span.gold.b', { style: { fontSize: '16px', marginLeft: '6px' } }, ' / ' + fmt(v.limit) + ' очков')),
        h('div.gauge' + (over ? '.over' : ''), null, h('i', { style: { width: Math.min(100, v.limit ? v.pts / v.limit * 100 : 0) + '%' } })),
        h('div.small', { class: errs ? 'bad' : 'ok' }, errs === 0 ? 'Ростер верен — печать чиста' : errs + ' ' + plural(errs, 'ошибка', 'ошибки', 'ошибок') + ' — коснитесь печати')),
      h('div.seal.press' + (errs ? '' : '.clean'), { onclick: e => { e.stopPropagation(); this.showIssues(); } }, errs ? String(errs) : '✓')));
    for (const p of v.problems) if (p.force == null && p.unit == null) c.appendChild(this.banner(p));

    c.appendChild(h('div.seg', null,
      h('button.' + (this.chart ? 'sbtn' : 'heraldic') + '.press', { onclick: () => { this.chart = false; Prefs.set('roster_chart', false); Nav.refresh(); } }, '☰  Список'),
      h('button.' + (this.chart ? 'heraldic' : 'sbtn') + '.press', { onclick: () => { this.chart = true; Prefs.set('roster_chart', true); Nav.refresh(); } }, '⚜  Схема как в книге')));

    if (this.chart) this.renderChart(c, v);
    else for (const f of v.forces) this.renderForce(c, f);
    c.appendChild(h('button.sbtn.press', { style: { marginTop: '14px', minHeight: '50px', fontSize: '16px' }, onclick: () => this.addRootForce() }, '＋  Союзники и прочие силы'));
    return c;
  }

  banner(p) {
    return h('div.banner.press' + (p.error ? '' : '.warn'), { onclick: () => this.showProblem(p) },
      h('div.b', { style: { color: p.error ? 'var(--red-bad)' : 'var(--gold)', fontSize: '16px' } }, p.error ? '✖' : '!'),
      h('div.col.grow', null, h('div.t', null, p.title), p.fix ? h('div.f.clamp2', null, p.fix) : null),
      h('div.gold.b', { style: { fontSize: '20px' } }, '›'));
  }

  renderForce(c, f) {
    const card = h('div.card' + (f.container ? '.steel-flat' : '.steel'), { style: { marginLeft: (f.depth * 6) + 'px' }, id: 'force-' + f.id });
    card.appendChild(h('div.row.gap8', null,
      hex(this.theme, f.glyph, 48),
      h('div.col.grow', null, h('div.names.bone.shadow', { style: { fontSize: '19px' } }, f.title), h('div.small.gold', null, f.sub)),
      f.canDelete ? h('button.sbtn.icon-btn.press', { style: { alignSelf: 'flex-start', width: '34px', height: '34px', minHeight: '34px' },
        onclick: () => confirmBox('Распустить «' + f.name + '»?', 'Все юниты в нём будут удалены.', 'Распустить', () => this.mutate('delForce', { force: f.id })) }, svg('trash')) : null));
    for (const p of f.problems) card.appendChild(this.banner(p));
    if (!f.container) {
      const hs = h('div.hscroll', { style: { marginTop: '10px' } });
      for (const s of f.slots) hs.appendChild(h('div.chip' + (s.bad ? '.bad' : ''), null, h('span', { style: { color: s.bad ? 'var(--red-bad)' : 'var(--gold)', display: 'flex' } }, svg(s.glyph)),
        h('span', { style: { color: s.bad ? 'var(--red-bad)' : s.count > 0 ? 'var(--bone)' : 'var(--bone-dim)' } }, s.name + '  ' + fmt(s.count) + (s.max < 0 ? '' : '/' + fmt(s.max)))));
      card.appendChild(hs);
    }
    for (const g of f.groups) {
      if (!f.container) card.appendChild(h('div.slot-title', null, g.slot));
      for (const u of g.units) card.appendChild(this.unitRow(u));
    }
    if (!f.container) card.appendChild(h('button.heraldic.press', { style: { marginTop: '8px', fontSize: '17px' }, onclick: () => Nav.push(new PickerScreen(f.id)) }, '＋  Юнит'));
    else for (const a of f.adds) card.appendChild(h('button.sbtn.dim.press', { style: { marginTop: '4px' }, onclick: () => {
      const id = call('containerAdd', { force: f.id, key: a.key });
      Rosters.save();
      Nav.push(new UnitScreen(id));
    } }, '＋  ' + a.name));
    c.appendChild(card);
    // кнопка «＋ Детачмент» идёт после последнего потомка контейнера
    const last = this.v.forces.filter(x => isDescendant(this.v.forces, x, f));
    if (f.container && f.canAddDet && !last.length) c.appendChild(this.addDetBtn(f));
    for (const cont of this.v.forces) if (cont.container && cont.canAddDet && cont !== f) {
      const desc = this.v.forces.filter(x => isDescendant(this.v.forces, x, cont));
      if (desc.length && desc[desc.length - 1] === f) c.appendChild(this.addDetBtn(cont));
    }
  }
  addDetBtn(f) {
    return h('button.brass.press', { style: { margin: '6px 0 6px 6px', fontSize: '17px', minHeight: '50px' }, onclick: () => this.addDetachment(f.id, null) }, '＋  Детачмент');
  }

  unitRow(u) {
    let timer, long = false;
    const row = h('div.urow.parch.tap.press' + (u.bad ? '.badline' : ''), {
      onclick: () => { if (long) return; haptic(); Nav.push(new UnitScreen(u.id)); },
      ontouchstart: () => { long = false; timer = setTimeout(() => { long = true; haptic(); this.unitMenu(u); }, 550); },
      ontouchend: () => clearTimeout(timer), ontouchmove: () => clearTimeout(timer),
      oncontextmenu: e => { e.preventDefault(); this.unitMenu(u); },
    },
      hex(this.theme, u.kind, 44),
      h('div.col.grow', null, h('div.names.ink.ellipsis', { style: { fontSize: '16px' } }, u.name), u.summary ? h('div.small.ink-dim.clamp2', null, u.summary) : null),
      u.bad ? h('div.ink-red.b', null, '⚠') : null,
      h('div.pts', null, fmt(u.pts)));
    return row;
  }

  unitMenu(u) {
    const body = Sheet.open(u.name);
    Sheet.item(body, 'banner', 'Дублировать', null, () => { Sheet.close(); this.mutate('dupSel', { sel: u.id }); });
    Sheet.item(body, 'trash', 'Удалить', null, () => { Sheet.close(); this.mutate('delSel', { sel: u.id }); }, { red: true });
  }

  mutate(cmd, arg) {
    try { call(cmd, arg); } catch (e) { toast(e.message); }
    Rosters.save();
    Nav.refresh();
  }

  // ---------------- схема как в книге
  renderChart(c, v) {
    const loose = [];
    const roots = v.forces.filter(f => f.parent == null);
    for (const f of roots) {
      if (!f.container) { loose.push(f); continue; }
      c.appendChild(h('div.oc-head.black.bone', { style: { fontSize: '18px' } }, f.title === 'Армия' ? f.name : f.title));
      c.appendChild(h('div.gold.b.small', { style: { textAlign: 'center', marginBottom: '6px' } }, (f.allied ? f.name + ' · ' : '') + fmt(f.pts) + ' оч.'));
      for (const p of f.problems) c.appendChild(this.banner(p));
      for (const g of f.groups) for (const u of g.units) c.appendChild(this.unitRow(u));
      for (const a of f.adds) c.appendChild(h('button.sbtn.dim.press', { style: { marginTop: '4px' }, onclick: () => {
        const id = call('containerAdd', { force: f.id, key: a.key });
        Rosters.save();
        Nav.push(new UnitScreen(id));
      } }, '＋  ' + a.name));
      const kids = v.forces.filter(x => x.parent === f.id);
      const primary = [], extra = [], aux = [], apex = [];
      for (const ch of kids) {
        const nm = ch.name;
        if (nm.includes('Primary')) primary.push(ch);
        else if (nm.startsWith('Auxiliary') || nm.startsWith('Mech -')) aux.push(ch);
        else if (nm.startsWith('Apex')) apex.push(ch);
        else extra.push(ch);
      }
      for (const p of primary) c.appendChild(this.ocBox(p, true));
      this.ocGroup(c, 'Дополнительные детачменты', extra);
      this.ocGroup(c, 'Вспомогательные детачменты', aux);
      this.ocGroup(c, 'Апекс-детачменты', apex);
      if (f.canAddDet) c.appendChild(h('button.brass.press', { style: { margin: '10px 0 8px' }, onclick: () => this.addDetachment(f.id, null) }, '＋  Детачмент'));
    }
    if (loose.length) {
      c.appendChild(h('div.oc-section', null, 'ПРОЧИЕ СИЛЫ'));
      c.appendChild(h('div.oc-flow', null, loose.map(f => this.ocBox(f, false))));
    }
  }
  ocGroup(c, title, fs) {
    if (!fs.length) return;
    c.appendChild(h('div.oc-section', null, title.toUpperCase()));
    c.appendChild(h('div.oc-flow', null, fs.map(f => this.ocBox(f, false))));
    for (const f of fs) for (const ch of this.v.forces.filter(x => x.parent === f.id))
      c.appendChild(h('div.oc-flow', { style: { marginLeft: '14px' } }, this.ocBox(ch, false)));
  }
  ocBox(f, wide) {
    const b = h('div.ocbox' + (wide ? '.wide' : ''));
    const probs = f.problems || [];
    b.appendChild(h('div.hd', null,
      f.canDelete ? h('button.sbtn.icon-btn.press', { style: { width: '28px', height: '28px', minHeight: '28px' },
        onclick: () => confirmBox('Распустить «' + f.name + '»?', 'Все юниты в нём будут удалены.', 'Распустить', () => this.mutate('delForce', { force: f.id })) }, svg('trash')) : null,
      probs.length ? h('div.bad.b.small', { style: { paddingRight: '8px' }, onclick: () => this.showProblem(probs[0]) }, '⚠ ' + probs.length) : null,
      h('div.col.grow', null, h('div.nm', null, f.name.replace(/^(Auxiliary|Apex) - /, '')),
        h('div.pt', null, (f.parent != null && f.catName && f.allied ? shortName(f.catName) + ' · ' : '') + fmt(f.pts) + ' оч.'))));
    let row = null;
    if (!f.chart || !f.chart.length) b.appendChild(h('div.dim.small', null, 'Нет слотов'));
    for (const cell of f.chart || []) {
      if (cell.groupStart || cell.newRow || !row) { row = h('div.ocrow'); b.appendChild(row); }
      row.appendChild(this.ocCell(f, cell));
    }
    return b;
  }
  ocCell(f, cell) {
    const filled = cell.sel != null;
    const circ = h('div.circ', null,
      cell.mark === 1 ? h('div', { html: compassSvg(), style: { position: 'absolute', inset: 0, color: cell.bad ? 'var(--red-bad)' : '#6FAE5C' } }) : null,
      cell.mark === 2 ? h('div.ring2') : null,
      h('div.ring'),
      cell.icon ? h('div.ico', { style: { webkitMaskImage: 'url(art/slot_' + cell.icon + '.png)', maskImage: 'url(art/slot_' + cell.icon + '.png)' } }) : svg(cell.glyph));
    const e = h('div.occell.press' + (filled ? '.filled' : '') + (cell.bad ? '.bad' : ''), {
      onclick: () => { haptic(); if (filled) Nav.push(new UnitScreen(cell.sel)); else Nav.push(new PickerScreen(f.id, cell.slot)); },
    }, circ,
      filled ? h('div.n', null, cell.name) : null,
      filled ? h('div.p', null, fmt(cell.pts)) : cell.label ? h('div.lb', null, cell.label) : null);
    return e;
  }

  // ---------------- проблемы
  showIssues() {
    const body = Sheet.open('Проверка ростера', this.v.errors ? 'Нажмите на проблему — подскажу, что сделать' : 'Ошибок нет');
    if (!this.v.problems.length) body.appendChild(h('div.parch.card.ink', null, 'Ростер верен. Печать чиста.'));
    let grp = null;
    for (const p of this.v.problems) {
      if (p.group && p.group !== grp) { grp = p.group; body.appendChild(h('div.label', null, grp.toUpperCase())); }
      body.appendChild(this.problemCard(p));
    }
  }
  showProblem(p) {
    const body = Sheet.open(p.error ? 'Ошибка ростера' : 'Предупреждение', p.group || '');
    body.appendChild(this.problemCard(p));
  }
  problemCard(p) {
    const s = h('div.parch.card.ink', { style: { padding: '12px 14px' } },
      h('div.row', null, h('span.b', { style: { color: p.error ? 'var(--ink-red)' : '#8A6A10', fontSize: '18px' } }, p.error ? '✖ ' : '! '), h('span.names.grow', { style: { fontSize: '17px' } }, p.title)),
      p.detail ? h('div', { style: { marginTop: '6px', fontSize: '14px' } }, p.detail) : null,
      p.fix ? h('div.flabel', { style: { marginTop: '10px' } }, 'КАК ИСПРАВИТЬ') : null,
      p.fix ? h('div', { style: { fontSize: '14px' } }, p.fix) : null);
    const btns = h('div.row.gap6', { style: { marginTop: '12px' } });
    if (p.button && p.act !== ACT.NONE) btns.appendChild(h('button.brass.grow.press', { onclick: () => this.act(p, p.act) }, p.button));
    if (p.button2) btns.appendChild(h('button.sbtn.grow.press', { onclick: () => this.act(p, p.act2) }, p.button2));
    if (btns.childNodes.length) s.appendChild(btns);
    return s;
  }
  act(p, a) {
    Sheet.close();
    if (a === ACT.GO_FORCE && p.force != null) this.goTo(p.force);
    else if (a === ACT.OPEN_UNIT && p.unit != null) Nav.push(new UnitScreen(p.unit));
    else if (a === ACT.ADD_UNIT && p.force != null) { if (!p.forceContainer) Nav.push(new PickerScreen(p.force)); else this.goTo(p.force); }
    else if (a === ACT.ADD_DET && p.force != null) this.addDetachment(p.force, null);
    else if (a === ACT.EDIT_LIMIT) this.rename();
  }
  goTo(fid) {
    if (this.chart) { this.chart = false; Prefs.set('roster_chart', false); Nav.refresh(); }
    const el = document.getElementById('force-' + fid);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.animate([{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }, { opacity: .5 }, { opacity: 1 }], { duration: 900 });
  }

  // ---------------- меню ⋮
  actions() {
    const body = Sheet.open(this.v.name, shortName(this.v.catName));
    Sheet.item(body, 'edit', 'Название и лимит очков', fmt(this.v.limit) + ' очков', () => this.rename());
    Sheet.item(body, 'export', 'Экспорт .rosz', 'Для BattleScribe и New Recruit', () => { Sheet.close(); exportRosz(this.v.name); });
    Sheet.item(body, 'scroll', 'Скопировать текстом', 'Список юнитов для чата', () => { Sheet.close(); copyText(this.v); });
    Sheet.item(body, 'brain', 'Умный ростер для этой фракции', null, () => { Sheet.close(); Nav.push(new SmartScreen(this.v.cat, this.v.limit)); });
  }
  rename() {
    const body = Sheet.open('Ростер', 'Название и лимит очков');
    const nm = h('input.input', { value: this.v.name });
    const lim = h('input.input', { value: fmt(this.v.limit), inputmode: 'numeric' });
    body.appendChild(h('div.label', null, 'НАЗВАНИЕ'));
    body.appendChild(nm);
    body.appendChild(h('div.label', null, 'ЛИМИТ ОЧКОВ'));
    body.appendChild(lim);
    body.appendChild(h('button.brass.press', { style: { marginTop: '12px' }, onclick: () => {
      Sheet.close();
      this.mutate('rename', { name: nm.value, limit: parseFloat(lim.value) || this.v.limit });
    } }, 'Сохранить'));
  }

  // ---------------- детачменты
  addDetachment(parentId, catId) {
    const s = call('detSheet', { force: parentId, cat: catId });
    const ct = themeFor(s.catName);
    const body = Sheet.open('Добавить детачмент', 'Значок и слоты показывают, что он даёт');
    Sheet.item(body, null, s.short, s.main ? 'Основная армия · сменить ›' : 'Союзник · сменить ›', () => this.pickFaction(parentId, s.cat), { icon: factionHex(s.catName, 46) });
    if (s.empty) { body.appendChild(h('div.dim', { style: { padding: '14px 6px' } }, s.empty)); return; }
    for (const it of s.items) Sheet.item(body, it.glyph, it.name, it.sub, () => {
      Sheet.close();
      try {
        const r = call('detAdd', { force: parentId, cat: s.cat, i: it.i });
        if (r.toast) toast(r.toast);
      } catch (e) { toast(e.message); }
      Rosters.save();
      Nav.refresh();
    }, { icon: hex(ct, it.glyph, 40) });
  }
  pickFaction(parentId, current) {
    const body = Sheet.open('Фракция детачмента', 'Другая фракция будет добавлена как союзник');
    for (const f of call('detFactions', { current })) {
      if (f.section) body.appendChild(h('div.label', null, f.section));
      Sheet.item(body, null, f.short, f.current ? 'выбрана' : null, () => this.addDetachment(parentId, f.id), { icon: factionHex(f.name, 44) });
    }
  }
  addRootForce() {
    const body = Sheet.open('Прочие силы', 'Союзники, Лорд войны и т. п.');
    for (const o of call('rootForces')) Sheet.item(body, null, o.name, o.sub, () => {
      if (o.allied) return this.pickFaction(null, this.v.cat);
      Sheet.close();
      this.mutate('rootForceAdd', { i: o.i });
    }, { icon: hex(this.theme, o.glyph, 40) });
  }
}

function isDescendant(forces, x, root) {
  let p = x.parent;
  while (p != null) {
    if (p === root.id) return true;
    const f = forces.find(y => y.id === p);
    p = f ? f.parent : null;
  }
  return false;
}

// ------------------------------------------------------------ экспорт / импорт
async function exportRosz(name) {
  try {
    const xml = call('exportRos');
    const safe = (name || 'roster').replace(/[\\/:*?"<>|]+/g, '_');
    const blob = Zip.write(safe + '.ros', new TextEncoder().encode(xml));
    const file = new File([blob], safe + '.rosz', { type: 'application/zip' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: safe + '.rosz' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch (e) { toast('Не удалось: ' + e.message); }
}

function copyText(v) {
  const lines = [v.name + ' — ' + shortName(v.catName) + ' (' + fmt(v.pts) + '/' + fmt(v.limit) + ')'];
  for (const f of v.forces) {
    lines.push('', '== ' + f.name + ' ==');
    for (const g of f.groups) for (const u of g.units) lines.push('• ' + u.name + ' [' + fmt(u.pts) + ']' + (u.summary ? ' — ' + u.summary : ''));
  }
  const text = lines.join('\n');
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Скопировано'));
}

function importFile() {
  const inp = h('input', { type: 'file', style: { display: 'none' } });
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (!f) return;
    try {
      const bytes = await Zip.readRos(await f.arrayBuffer());
      const xml = new TextDecoder().decode(bytes);
      const res = call('importRos', { xml });
      if (res.error) { toast(res.error); return; }
      await Rosters.put(res.roster);
      Nav.push(new RosterScreen());
      const miss = res.missing || [];
      toast('Импорт: ' + res.units + ' ' + plural(res.units, 'юнит', 'юнита', 'юнитов') + (miss.length ? ', не найдено ' + miss.length : ''));
      if (miss.length) {
        const body = Sheet.open('Импорт', 'Не найдено в данных BSData');
        body.appendChild(h('div.parch.card.ink.small', null, miss.join('\n')));
      }
    } catch (e) { toast('Не удалось прочитать файл: ' + e.message); }
  };
  document.body.appendChild(inp);
  inp.click();
}

// ------------------------------------------------------------ выбор юнита
class PickerScreen {
  constructor(forceId, onlySlot) { this.force = forceId; this.slot = onlySlot || null; this.q = ''; }
  render() {
    this.theme = themeFor(call('info').catName);
    const c = h('div');
    const v = call('picker', { force: this.force, slot: this.slot, q: '' });
    c.appendChild(header('Призвать юнит', v.title, true));
    const search = h('input.input', { placeholder: 'Поиск по названию…', value: this.q, oninput: e => { this.q = e.target.value; this.fill(); } });
    c.appendChild(search);
    this.list = h('div.col');
    c.appendChild(this.list);
    this.fill();
    return c;
  }
  fill() {
    const v = call('picker', { force: this.force, slot: this.slot, q: this.q });
    const list = this.list;
    list.innerHTML = '';
    const pending = [];
    this.prices = {};
    for (const g of v.groups) {
      list.appendChild(h('div.ptitle', null, svg(g.glyph), g.slot.toUpperCase() + (g.max < 0 ? '' : '   ' + fmt(g.count) + '/' + fmt(g.max))));
      for (const u of g.units) {
        const price = h('div.pts', null, u.cost != null ? (u.cost > 0 ? fmt(u.cost) : '0') : '…');
        if (u.cost == null) { pending.push(u.key); this.prices[u.key] = price; }
        list.appendChild(h('div.urow.parch.tap.press', { onclick: () => this.pick(u) },
          hex(this.theme, u.kind, 42),
          h('div.names.ink.grow', { style: { fontSize: '16px' } }, u.name), price));
      }
    }
    if (!v.groups.length) list.appendChild(h('div.parch.card.ink', null, 'Ничего не найдено.'));
    this.costs(pending);
  }
  /** Настоящие цены считаются порциями, чтобы экран не замирал. */
  costs(keys) {
    const gen = this.gen = (this.gen || 0) + 1;
    const step = () => {
      if (gen !== this.gen || !keys.length || Nav.stack[Nav.stack.length - 1] !== this) return;
      const part = keys.splice(0, 4);
      try {
        const res = call('pickerCosts', { force: this.force, keys: part });
        for (const k in res) if (this.prices[k]) this.prices[k].textContent = res[k] > 0 ? fmt(res[k]) : '0';
      } catch (e) { console.warn(e); return; }
      setTimeout(step, 0);
    };
    setTimeout(step, 30);
  }
  pick(u) {
    haptic();
    const id = call('addUnit', { force: this.force, key: u.key });
    Nav.push(new UnitScreen(id, this));
  }
}

// ------------------------------------------------------------ карточка юнита
class UnitScreen {
  constructor(selId, from) { this.sel = selId; this.draft = !!from; this.from = from; }
  beforeBack() {
    if (this.draft) { try { call('delSel', { sel: this.sel }); } catch (e) { } this.draft = false; }
    else Rosters.save();
    return true;
  }
  save() { if (!this.draft) Rosters.save(); }
  render() {
    const v = this.v = call('unit', { sel: this.sel });
    this.theme = themeFor(call('info').catName);
    applyTheme(this.theme);
    const c = h('div');
    c.appendChild(header(v.name, v.slot, true));
    c.appendChild(h('div.row.steel', { style: { padding: '14px', gap: '14px', margin: '4px 0 6px' } },
      hex(this.theme, v.kind, 96),
      h('div.col.grow', null,
        h('div.names.bone.shadow', { style: { fontSize: '20px' } }, v.name),
        v.models > 0 ? h('div.gold', null, v.models + ' ' + plural(v.models, 'модель', 'модели', 'моделей')) : null,
        h('div.black.shadow', { style: { fontSize: '26px', color: 'var(--accent-bright)' } }, fmt(v.pts) + ' оч.'))));
    c.appendChild(h('div.row.gap8', { style: { marginBottom: '8px' } },
      this.draft
        ? h('button.brass.press', { style: { flex: 1.4, fontSize: '17px', minHeight: '50px' }, onclick: () => {
          this.draft = false;
          Rosters.save();
          toast('«' + v.name + '» в ростере');
          // «назад» ведёт сразу в ростер — убираем экран выбора из стека
          const i = Nav.stack.indexOf(this.from);
          if (i >= 0) Nav.stack.splice(i, 1);
          Nav.refresh();
        } }, '＋  Добавить в ростер')
        : h('button.danger.press', { style: { flex: 1.4, minHeight: '50px' }, onclick: () => { call('delSel', { sel: this.sel }); Rosters.save(); this.draft = false; this.deleted = true; Nav.back(); } }, 'Удалить из ростера'),
      h('button.sbtn.press', { style: { flex: 1, minHeight: '50px', opacity: this.draft ? .55 : 1 }, onclick: () => {
        if (this.draft) return toast('Сначала добавь юнит в ростер');
        call('dupSel', { sel: this.sel });
        Rosters.save();
        toast('Юнит продублирован');
      } }, 'Дублировать')));
    if (v.errors.length) {
      c.appendChild(h('div.parch.badline', { style: { padding: '10px 14px 12px', marginBottom: '6px' } }, v.errors.map(p => [
        h('div.ink-red.b', { style: { fontSize: '15px' } }, '✖ ' + p.title),
        p.detail ? h('div.small.ink', null, p.detail) : null,
        p.fix ? h('div.small.ink-dim', null, '→ ' + p.fix) : null])));
    }
    if (v.comp.length) {
      c.appendChild(ribbon('СОСТАВ'));
      for (const m of v.comp) this.renderModel(c, m);
    }
    if (v.gear) {
      c.appendChild(ribbon(v.gearTitle));
      const box = h('div.parch.gearbox');
      this.renderGear(box, v.gear);
      c.appendChild(box);
    }
    this.renderProfiles(c, v.profiles);
    if (v.rules.length) {
      c.appendChild(ribbon('ОСОБЫЕ ПРАВИЛА'));
      c.appendChild(h('div.parch.gearbox', null,
        h('div', null, v.rules.map(n => h('button.rchip.press', { onclick: () => this.showRule(n) }, n))),
        h('div.small.ink-dim', { style: { marginTop: '6px' } }, 'Коснитесь правила, чтобы прочитать.')));
    }
    return c;
  }

  act(a) {
    let r;
    try { r = call('act', Object.assign({ unit: this.sel }, a)); } catch (e) { toast(e.message); return null; }
    if (r.toast) toast(r.toast);
    if (r.denied) return r;
    this.save();
    Nav.refresh();
    return r;
  }

  renderModel(c, m) {
    c.appendChild(h('div.row', { style: { padding: '6px 2px 4px', gap: '8px' } },
      h('span.gold', { style: { display: 'flex', width: '26px', height: '26px' } }, svg(m.kind)),
      h('div.names.bone.grow', { style: { fontSize: '18px' } }, m.name),
      h('div.small.b', { class: m.bad ? 'bad' : 'gold' }, m.info)));
    for (const cl of m.clumps) {
      const card = h('div.parch', { style: { padding: '8px 12px 10px', margin: '3px 0 4px' } },
        h('div.row', null, h('div.b.ink-dim.grow', null, cl.title),
          this.stepper(cl.number, cl.lo, cl.hi, n => this.act({ type: 'number', sel: cl.id, n }))));
      if (cl.gear) { card.appendChild(h('div.divline')); this.renderGear(card, cl.gear); }
      c.appendChild(card);
    }
    if (m.addLabel) c.appendChild(h('button.sbtn.dim.press', { style: { margin: '2px 0 6px', minHeight: '40px', fontSize: '14px' },
      onclick: () => this.act({ type: 'addModel', parent: m.parent, key: m.key }) }, m.addLabel));
  }

  renderGear(into, g) {
    if (g.chips.length) {
      const flow = h('div', { style: { margin: '2px 0 4px' } });
      for (const ch of g.chips) {
        const label = (ch.fixed ? '● ' : ch.on ? '✓ ' : '+ ') + ch.label + (ch.cost > 0 && !ch.fixed ? '  ' + fmt(ch.cost) : '');
        flow.appendChild(h('button.gchip' + (ch.fixed ? '.fixed' : ch.on ? '.on' : '') + (ch.fixed ? '' : '.press'), {
          onclick: ch.fixed ? null : () => { haptic(); this.act({ type: 'toggle', parent: ch.parent, key: ch.key }); } }, label));
      }
      into.appendChild(flow);
    }
    for (const r of g.rows) {
      if (r.type === 'container') { this.renderGear(into, r.gear); continue; }
      if (r.type === 'group') {
        into.appendChild(h('div.grow-row.press', { onclick: () => { haptic(); this.openGroup(r.parent, r.gid); } },
          h('div.col.grow', null, h('div.gt', null, r.name), h('div.gv.clamp2', { style: { color: r.current ? 'var(--ink)' : 'var(--ink-dim)' } }, r.current || '— не выбрано')),
          r.req ? h('div.b.small', { style: { padding: '0 6px', color: r.bad ? 'var(--ink-red)' : 'var(--ink-dim)' } }, r.req) : null,
          h('div.chev', null, '›')));
        continue;
      }
      if (r.type === 'step') {
        into.appendChild(h('div.row', { style: { margin: '3px 0' } },
          h('div.col.grow', null, h('div.b', { style: { fontSize: '15px', color: r.count > 0 ? 'var(--ink)' : 'var(--ink-dim)' } }, r.name),
            r.cost ? h('div.tiny.ink-red', null, fmt(r.cost) + ' оч./шт.') : null),
          this.stepper(r.count, 0, r.max < 0 ? 999 : r.max, n => this.act({ type: 'count', parent: r.parent, key: r.key, n }))));
      }
    }
    for (const n of g.nested) {
      const sub = h('div.nested', null, h('div.b.ink-red', { style: { fontSize: '14px' } }, '↳ ' + n.name));
      this.renderGear(sub, n.gear);
      into.appendChild(sub);
    }
  }

  stepper(value, lo, hi, set) {
    return h('div.stepper', null,
      h('button.sbtn.press' + (value > lo ? '' : '.off'), { onclick: () => { if (value > lo) { haptic(); set(value - 1); } } }, '−'),
      h('div.v', null, String(value)),
      h('button.sbtn.press' + (value < hi ? '' : '.off'), { onclick: () => { if (value < hi) { haptic(); set(value + 1); } else toast('Достигнут максимум'); } }, '+'));
  }

  openGroup(parent, gid) {
    const g = call('group', { parent, gid });
    if (!g) return;
    const body = Sheet.open(g.title, g.req);
    this.fillGroup(body, g);
  }
  fillGroup(body, g) {
    body.innerHTML = '';
    const sheet = h('div.parch', { style: { padding: '8px 10px 10px' } });
    for (const it of g.items) {
      if (it.head) { sheet.appendChild(h('div.b.ink-red', { style: { padding: `8px 0 2px ${4 + it.depth * 8}px`, fontSize: '13px' } }, it.head)); continue; }
      const on = it.count > 0;
      const desc = it.info ? h('div.small.ink-dim.pre', { style: { display: 'none', marginTop: '4px' } }, it.info) : null;
      const row = h('div.leaf', { style: { paddingLeft: (4 + it.depth * 8) + 'px' } },
        h('div.col.grow', null, h('div', { style: { fontSize: '16px', fontWeight: on ? 700 : 400 }, class: 'ink' }, it.name),
          it.cost ? h('div.tiny.b.ink-red', null, it.cost) : null, desc),
        it.info ? h('button.sbtn.qbtn.press', { onclick: e => { e.stopPropagation(); desc.style.display = desc.style.display === 'none' ? 'block' : 'none'; } }, '?') : null);
      const reopen = () => { const ng = call('group', { parent: g.parent, gid: g.gid }); if (ng) this.fillGroup(body, ng); };
      if (it.mode === 'radio' || it.mode === 'toggle') {
        row.appendChild(h('div.toggle' + (it.mode === 'toggle' ? '.sq' : '') + (on ? '.on' : '')));
        row.classList.add('press');
        row.onclick = () => {
          haptic();
          const r = this.act(it.mode === 'radio' ? { type: 'radio', parent: g.parent, gid: g.gid, key: it.key } : { type: 'toggle', parent: g.parent, key: it.key });
          if (!r || r.denied) return;
          if (r.close) Sheet.close(); else reopen();
        };
      } else {
        row.appendChild(this.stepper(it.count, 0, it.max < 0 ? 999 : it.max, n => { const r = this.act({ type: 'count', parent: g.parent, key: it.key, n }); if (r && !r.denied) reopen(); }));
      }
      sheet.appendChild(row);
    }
    body.appendChild(sheet);
    body.appendChild(h('button.brass.press', { style: { marginTop: '10px' }, onclick: () => Sheet.close() }, 'Готово'));
  }

  renderProfiles(c, profiles) {
    if (!profiles.length) return;
    c.appendChild(ribbon('ХАРАКТЕРИСТИКИ'));
    for (const t of profiles) {
      c.appendChild(h('div.ptitle', null, svg(t.glyph), t.type));
      if (t.kind === 'traits') {
        c.appendChild(h('div.parch.gearbox', null,
          h('div', null, t.items.map(it => h('button.rchip' + (it.desc ? '.press' : ''), { style: { color: it.desc ? 'var(--ink)' : 'var(--ink-dim)' },
            onclick: it.desc ? () => this.textSheet(it.name, 'Трейт', it.desc) : null }, it.desc ? it.name + '  ⓘ' : it.name))),
          h('div.small.ink-dim', { style: { marginTop: '4px' } }, 'Трейты определяют, на что влияют правила (Allegiance, Legiones Astartes и т. п.).')));
        continue;
      }
      for (const it of t.items) c.appendChild(this.profileCard(it));
    }
  }
  profileCard(it) {
    const card = h('div.parch', { style: { padding: '10px 12px 12px', margin: '3px 0' } }, h('div.names.ink', { style: { fontSize: '17px' } }, it.name));
    if (it.kind === 'text') {
      for (const f of it.fields) { card.appendChild(h('div.flabel', null, f.label)); card.appendChild(h('div.pre', { style: { fontSize: '15px' } }, f.text)); }
      return card;
    }
    if (it.kind === 'weapon') {
      card.appendChild(h('div.statflow', null, it.stats.map(s => this.cell(s))));
      if (it.traits.length) card.appendChild(h('div', { style: { marginTop: '7px' } }, it.traits.map(tr => h('button.rchip.red.press', { onclick: () => this.showRule(tr) }, tr))));
      return card;
    }
    if (it.typeLine) card.appendChild(h('div.small.b', { style: { color: it.typeMod ? 'var(--mod-ink)' : 'var(--ink-dim)' } }, it.typeLine + (it.typeMod ? '  ✦' : '')));
    card.appendChild(h('div.statflow', null, it.stats.map(s => this.cell(s))));
    if (it.note) card.appendChild(h('div.small.b', { style: { color: 'var(--mod-ink)', marginTop: '6px' } }, it.note));
    for (const x of it.extras) { card.appendChild(h('div.flabel', null, x.label)); card.appendChild(h('div.pre', { style: { fontSize: '14px' } }, x.text)); }
    return card;
  }
  cell(s) {
    if (s.was != null) return h('div.cell.mod', null, h('div.l', null, s.label), h('div.v', null, s.value + (s.dir > 0 ? '▲' : s.dir < 0 ? '▼' : '')), h('div.w', null, 'было ' + s.was));
    return h('div.cell', null, h('div.l', null, s.label), h('div.v', null, s.value));
  }
  showRule(name) {
    const r = call('rule', { sel: this.sel, name });
    this.textSheet(name, null, r.text);
  }
  textSheet(title, sub, text) {
    const body = Sheet.open(title, sub);
    body.appendChild(h('div.parch.pre', { style: { padding: '12px 14px 14px', fontSize: '15px', lineHeight: 1.35 } }, text));
  }
}

// ------------------------------------------------------------ умный ростер
class SmartScreen {
  constructor(cat, limit) {
    const saved = Prefs.get('smart', {});
    this.p = Object.assign({ my: null, enemy: null, limit: 3000, mission: null, styles: [], myAlly: null, mode: 2 }, saved);
    if (cat) { this.p.my = cat; this.p.limit = limit || this.p.limit; }
    this.theme = themeFor(this.catName(this.p.my));
    this.meta = call('smartMeta');
  }
  catName(id) { const f = Data.factions.find(x => x.id === id); return f ? f.name : ''; }
  persist() { Prefs.set('smart', this.p); }
  render() {
    this.theme = themeFor(this.catName(this.p.my));
    applyTheme(this.theme);
    const p = this.p, c = h('div');
    c.appendChild(header('Умный ростер', 'Когитатор соберёт армию', true));
    const pickRow = (label, id, onTap, empty) => h('button.sitem.steel-flat.press', { style: { width: '100%' }, onclick: onTap },
      id ? factionHex(this.catName(id), 44) : hex(THEME_DEFAULT, 'diamond', 44),
      h('div.col.grow', { style: { textAlign: 'left' } }, h('div.tiny.b.gold', null, label), h('div.n', null, id ? shortName(this.catName(id)) : empty)),
      h('div.gold.b', null, '›'));
    c.appendChild(h('div.label', null, 'МОЯ АРМИЯ'));
    c.appendChild(pickRow('ФРАКЦИЯ', p.my, () => this.pickCat('Моя армия', id => { p.my = id; }), 'Выберите фракцию'));
    c.appendChild(h('div.label', null, 'ПРОТИВНИК'));
    c.appendChild(pickRow('ФРАКЦИЯ ПРОТИВНИКА', p.enemy, () => this.pickCat('Противник', id => { p.enemy = id; }, true), 'Неизвестен — универсальная армия'));
    c.appendChild(h('div.label', null, 'ЛИМИТ ОЧКОВ'));
    c.appendChild(h('div.row.gap6', null, [1000, 2000, 3000, 4000].map(v => h('button.press.' + (p.limit === v ? 'heraldic' : 'sbtn') + '.grow', { onclick: () => { p.limit = v; this.persist(); Nav.refresh(); } }, String(v)))));
    c.appendChild(h('div.label', null, 'МИССИЯ'));
    c.appendChild(h('div', null, [{ id: null, name: 'Любая' }].concat(this.meta.missions).map(m =>
      h('button.optchip.press' + (p.mission === m.id ? '.on' : ''), { onclick: () => { p.mission = m.id; this.persist(); Nav.refresh(); } }, m.name))));
    c.appendChild(h('div.label', null, 'ХАРАКТЕР АРМИИ'));
    c.appendChild(h('div', null, this.meta.styles.map(s =>
      h('button.optchip.press' + (p.styles.includes(s.id) ? '.on' : ''), { onclick: () => {
        p.styles = p.styles.includes(s.id) ? p.styles.filter(x => x !== s.id) : p.styles.concat(s.id);
        this.persist(); Nav.refresh();
      } }, s.name))));
    c.appendChild(h('div.label', null, 'ИЗ ЧЕГО СОБИРАТЬ'));
    c.appendChild(h('div', null, [[2, 'Свободно'], [1, 'Мои ростеры + прокси'], [0, 'Только из моих ростеров']].map(([m, n]) =>
      h('button.optchip.press' + (p.mode === m ? '.on' : ''), { onclick: () => { p.mode = m; this.persist(); Nav.refresh(); } }, n))));
    c.appendChild(h('div.label', null, 'МОЙ СОЮЗНИК'));
    c.appendChild(pickRow('СОЮЗНЫЙ ДЕТАЧМЕНТ', p.myAlly, () => this.pickCat('Мой союзник', id => { p.myAlly = id; }, true), 'Без союзника'));
    c.appendChild(h('button.brass.press', { style: { marginTop: '16px', minHeight: '54px', fontSize: '18px' }, onclick: () => this.compute(false) }, '⚙  Собрать ростер'));
    this.out = h('div.col');
    c.appendChild(this.out);
    if (this.result) this.showResult();
    return c;
  }
  pickCat(title, set, allowNone) {
    const body = Sheet.open(title);
    if (allowNone) Sheet.item(body, 'diamond', 'Не выбрано', null, () => { set(null); this.persist(); Sheet.close(); Nav.refresh(); });
    for (const f of Data.factions) Sheet.item(body, null, f.legion ? f.short : f.name, null, () => { set(f.id); this.persist(); Sheet.close(); Nav.refresh(); }, { icon: factionHex(f.name, 40) });
  }
  async compute(reroll) {
    if (!this.p.my) { toast('Выберите фракцию армии'); return this.pickCat('Моя армия', id => { this.p.my = id; }); }
    if (reroll) this.p.seed = Date.now() % 100000000;
    this.out.innerHTML = '';
    this.out.appendChild(h('div.col', { style: { alignItems: 'center', margin: '18px 0' } }, h('div.spin'), h('div.gold', null, 'Когитатор перебирает варианты…')));
    this.out.scrollIntoView({ behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 60));
    const rosters = this.p.mode === 2 ? [] : await Rosters.all();
    try {
      this.result = await Bg.call('smart', Object.assign({}, this.p, { rosters, seed: this.p.seed || 1 }));
      if (this.result.error) toast(this.result.error);
    } catch (e) { this.result = { error: e.message }; }
    this.showResult();
  }
  showResult() {
    const r = this.result, out = this.out;
    out.innerHTML = '';
    if (r.error) { out.appendChild(h('div.banner', { style: { marginTop: '12px' } }, h('div.t', null, r.error))); return; }
    out.appendChild(ribbon('РЕЗУЛЬТАТ'));
    out.appendChild(h('div.summary.steel', null, h('div.col.grow', null,
      h('div.row', null, h('span.p.bone', null, fmt(r.pts || 0)), h('span.gold.b', { style: { marginLeft: '6px' } }, ' / ' + fmt(this.p.limit) + ' очков')),
      r.archetype ? h('div.gold.b', null, r.archetype) : null,
      h('div.small', { class: r.errors ? 'bad' : 'ok' }, r.errors ? r.errors + ' ' + plural(r.errors, 'ошибка', 'ошибки', 'ошибок') + ' в ростере' : 'Ростер верен'))));
    if (r.strategy && r.strategy.length) out.appendChild(h('div.parch.card.ink', null, h('div.flabel', null, 'СТРАТЕГИЯ'), r.strategy.map(s => h('div.pre', { style: { margin: '4px 0', fontSize: '15px' } }, s))));
    if (r.need) {
      const box = h('div.parch.card.ink', null, h('div.flabel', null, 'ЧТО НУЖНО ПРОТИВ ВРАГА / ЧТО ЕСТЬ'));
      const grid = h('div.capbar');
      const mx = Math.max(0.0001, ...r.need, ...r.have);
      r.need.forEach((n, i) => {
        grid.appendChild(h('div', null, this.meta.caps[i]));
        grid.appendChild(h('div.bars', null, h('div.need', { style: { width: (n / mx * 100) + '%' } }), h('div.have', { style: { width: (r.have[i] / mx * 100) + '%' } })));
      });
      box.appendChild(grid);
      out.appendChild(box);
    }
    out.appendChild(h('div.label', null, 'СОСТАВ'));
    for (const k of r.picks) {
      const tag = k.status === 0 ? ['own', 'из коллекции'] : k.status === 1 ? ['proxy', 'прокси' + (k.proxyOf ? ' на ' + k.proxyOf : '')] : ['new', 'новый'];
      const row = h('div.pickrow.parch.tap.press', { onclick: () => this.explain(k) },
        hex(this.theme, k.hero ? 'command' : k.hammer ? 'sword' : k.line ? 'infantry' : 'shield', 40),
        h('div.col.grow', null, h('div.names.ink', { style: { fontSize: '16px' } }, k.name),
          h('div.tag.' + tag[0], null, tag[1] + (k.slot ? ' · ' + k.slot : '')),
          k.gear.length ? h('div.tiny.ink-dim', null, k.gear.join(' · ')) : null),
        h('div.pts', null, fmt(k.pts)));
      out.appendChild(row);
    }
    if (r.reasons && r.reasons.length) out.appendChild(h('div.parch.card.ink', { style: { marginTop: '8px' } }, h('div.flabel', null, 'ПОЧЕМУ ТАК'), r.reasons.map(s => h('div.small.pre', { style: { margin: '3px 0' } }, '• ' + s))));
    out.appendChild(h('div.row.gap8', { style: { marginTop: '12px' } },
      h('button.brass.grow.press', { onclick: () => this.saveRoster() }, '✓  Сохранить ростер'),
      h('button.sbtn.grow.press', { onclick: () => this.compute(true) }, '🎲  Другой вариант')));
  }
  explain(k) {
    const body = Sheet.open(k.name, (k.slot || '') + ' · ' + fmt(k.pts) + ' оч.');
    if (k.why) body.appendChild(h('div.parch.card.ink.pre', null, k.why));
    for (const x of k.explain) body.appendChild(h('div.parch.card.ink', null, h('div.b', null, (x.icon ? x.icon + ' ' : '') + (x.title || '')), x.text ? h('div.small.pre', null, x.text) : null));
  }
  async saveRoster() {
    if (!this.result || !this.result.roster) return;
    const r = await Rosters.put(this.result.roster);
    call('open', { roster: r });
    toast('Ростер сохранён');
    Nav.replace(new RosterScreen());
  }
}

// ============================================================ запуск
async function boot() {
  const ld = new LoadingScreen();
  Nav.stack = [ld];
  Nav.show(false);
  try {
    if (typeof main === 'function' && !window.lrCall) main([]);
    if (!(await Data.hasFiles())) {
      if (!navigator.onLine) throw new Error('Нет сети');
      await Data.download((m, i, n) => ld.step('Загрузка данных BSData', i, n, m));
    }
    await Data.load((m, i, n) => ld.step('Чтение каталогов', i, n, m));
  } catch (e) {
    console.error(e);
    ld.error = 'Не удалось загрузить данные: ' + e.message;
    Nav.show(false);
    return;
  }
  Nav.stack = [new MenuScreen()];
  try { history.replaceState({ d: 1 }, ''); } catch (e) { }
  Nav.show(false);
  if (!Names.name) setTimeout(() => Names.ask(() => Nav.refresh()), 400);
  else Names.report(); // имя не дошло (нет связи) — повторить
}

document.getElementById('sheet-wrap').querySelector('.shade').addEventListener('click', () => Sheet.close());
if ('serviceWorker' in navigator && location.protocol !== 'file:' && (!/^(localhost|127.)/.test(location.hostname) || location.search.includes('sw'))) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
