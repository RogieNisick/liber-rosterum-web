// Имя игрока и статистика имён (как NameStats/Guide.askName в Android). Имя уходит автору в Telegram с пометкой (web)
// через посредника на Google Apps Script — токен бота в коде сайта не хранится.
// адрес веб-приложения Apps Script (…/exec); пусто — отправка выключена. Prefs relay_url — подмена для проверки.
const RELAY_URL = Prefs.get('relay_url', '') || 'https://script.google.com/macros/s/AKfycbwJUkaj3XXxptKgHadQuzlXQUsZSlhPLnzkTtcYTYFjZbwRWLgHpuKIj34UFW9-ZQ1m/exec';

const Names = {
  get name() { return (Prefs.get('user_name', '') || '').trim(); },
  get on() { return Prefs.get('share_name', true); },
  installId() {
    let id = Prefs.get('install_id', null);
    if (!id) {
      const b = new Uint8Array(6);
      crypto.getRandomValues(b);
      id = Array.from(b, x => x.toString(16).padStart(2, '0')).join('').replace(/^0+/, '') || '1';
      Prefs.set('install_id', id);
    }
    return id;
  },
  code() { let id = this.installId().toUpperCase(); while (id.length < 6) id = '0' + id; return 'LR-' + id.slice(-6); },
  /** «МР.67» в любых написаниях занято. */
  reserved(n) {
    n = (n || '').toLowerCase().replace(/[\s._\-]/g, '').replace(/м/g, 'm').replace(/р/g, 'r');
    return n === 'mr67' || n === 'mp67';
  },
  sending: false,
  /** Отправить имя, если оно новое для этой установки (ошибки сети молча — повторим при следующем запуске). */
  async report() {
    const name = this.name;
    if (!this.on || !RELAY_URL || !name || name === Prefs.get('name_sent', null) || this.sending) return;
    this.sending = true;
    try {
      const r = await fetch(RELAY_URL, {
        method: 'POST',
        body: JSON.stringify({ name, install: this.installId(), code: this.code(), version: APP_VERSION }),
      });
      const j = await r.json();
      if (j.ok) { Prefs.set('name_sent', name); Prefs.set('tg_err', ''); } else Prefs.set('tg_err', j.error || 'ошибка');
    } catch (e) {
      Prefs.set('tg_err', 'нет связи');
    }
    this.sending = false;
  },
  status() {
    if (!RELAY_URL) return 'Отправка не настроена';
    if (!this.on) return 'Выключено';
    const n = this.name;
    if (!n) return 'Имя ещё не введено';
    if (n === Prefs.get('name_sent', null)) return 'Имя «' + n + '» отправлено ✓';
    const err = Prefs.get('tg_err', '');
    return 'Ещё не отправлено' + (err ? ' (' + err + ')' : '') + '. Повторю при следующем запуске';
  },
  /** Окно «Как к тебе обращаться?». */
  ask(then) {
    const body = Sheet.open('Как к тебе обращаться?', 'Сервочереп запомнит имя');
    body.appendChild(h('div.row.gap8', null,
      h('img', { src: 'art/servoskull.png', alt: '', style: { width: '64px', height: 'auto', flex: 'none' } }),
      h('div.dim', { style: { fontSize: '14px' } }, 'Приветствую! Прежде чем начнём — назови себя, и я буду обращаться к тебе по имени.')));
    const inp = h('input.input', { value: this.name, placeholder: 'Твоё имя', maxlength: '24', style: { marginTop: '8px' } });
    body.appendChild(inp);
    body.appendChild(h('div.dim.tiny', { style: { padding: '3px 4px 8px' } }, 'Имя анонимно уходит автору для статистики. Отключается в меню.'));
    const save = () => {
      let n = inp.value.trim();
      if (!n) return toast('Назови себя — хотя бы позывной');
      if (n.length > 24) n = n.slice(0, 24);
      if (this.reserved(n) && !this.reserved(this.name)) return toast('Это имя уже занято. Выбери другое');
      Prefs.set('user_name', n);
      inp.blur();
      Sheet.close();
      this.report();
      if (then) setTimeout(then, 250);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    body.appendChild(h('button.brass.press', { style: { minHeight: '50px', fontSize: '17px' }, onclick: save }, 'Так меня и зовут'));
  },
  /** Настройки имени и статистики. */
  settings() {
    const body = Sheet.open('Имя и статистика', 'Имя: ' + (this.name || '—'));
    Sheet.item(body, 'edit', 'Изменить имя', this.name || 'Не задано', () => this.ask(() => this.settings()));
    Sheet.item(body, 'share', 'Отправлять имя автору: ' + (this.on ? 'да' : 'нет'), this.status(), () => {
      Prefs.set('share_name', !this.on);
      if (this.on) this.report().then(() => this.settings()); else this.settings();
    });
  },
};
