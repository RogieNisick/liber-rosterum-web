// Цвета фракций — как Theme.forNameRaw в Android-версии: accent (броня), trim (кант), glow (свечение).
const THEME_DEFAULT = { accent: '#8E7A55', trim: '#C9A55A', glow: '#8E6A2A', numeral: '' };
const THEMES = [
  ['dark angels', '#1F4A30', '#C9B98F', '#1F6A3A'], ["emperor's children", '#6A2C82', '#D4A73A', '#8A3AA8'], ['emperor’s children', '#6A2C82', '#D4A73A', '#8A3AA8'],
  ['iron warriors', '#6E7378', '#D1A62A', '#8A8F94'], ['white scars', '#B0272A', '#E8E1D3', '#E8E1D3'], ['space wolves', '#5E7A8C', '#D8C9A0', '#7FA0B5'],
  ['imperial fists', '#D9A520', '#2A2522', '#E0B030'], ['night lords', '#2A3E6E', '#B8C8E8', '#3A5AA8'], ['blood angels', '#A51F1F', '#D4AA3A', '#C02828'],
  ['iron hands', '#3A3D40', '#B8C0C6', '#8A9298'], ['world eaters', '#2E5A9C', '#E6E3DC', '#3A70C0'], ['ultramarines', '#1F4E9C', '#D4AA3A', '#2A62C0'],
  ['death guard', '#8A8462', '#6E7A3A', '#9AA060'], ['thousand sons', '#9A1F2C', '#D4AA3A', '#B8283A'], ['sons of horus', '#2E6B63', '#C9A55A', '#3A8A80'],
  ['word bearers', '#7E1A22', '#C9A55A', '#9A2A30'], ['salamanders', '#1F6B3A', '#E0682D', '#2A8A4A'], ['raven guard', '#2A2A2E', '#D8D8D8', '#6A6A78'],
  ['alpha legion', '#2D6E7E', '#9FB7BD', '#3A8A9E'], ['blackshields', '#26262A', '#A8ADB2', '#55555E', true], ['shattered', '#4A4A50', '#B0272A', '#6A6A74', true],
  ['solar auxilia', '#4E5A63', '#C9A55A', '#6A7A88', true], ['custodes', '#C9A227', '#9E1B1B', '#D8B030', true],
  ['mechanicum', '#8E1B1B', '#B07A3A', '#A82A2A', true], ['skitarii', '#8E1B1B', '#B07A3A', '#A82A2A', true], ['titanicus', '#7A1A1A', '#D4AA3A', '#9A2A2A', true],
  ['questoris', '#24467A', '#D9A520', '#3060A0', true], ['militia', '#5F6B3A', '#B8A878', '#7A8A4A', true], ['daemon', '#6E1A5A', '#7AB83A', '#8A2A78', true],
  ['assassin', '#222225', '#9E1B1B', '#4A4A55', true], ['psykana', '#8E9298', '#9E1B1B', '#A0A4AA', true], ['knights-errant', '#55585E', '#C9A55A', '#70747A', true],
];

function roman(s) {
  let total = 0, prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const v = { I: 1, V: 5, X: 10, L: 50 }[s[i]];
    if (!v) return 0;
    if (v < prev) total -= v; else { total += v; prev = v; }
  }
  return total;
}

function themeFor(name) {
  if (!name) return THEME_DEFAULT;
  const n = name.toLowerCase();
  let num = '';
  const dash = name.indexOf(' - ');
  if (dash > 0 && roman(name.slice(0, dash).trim()) > 0) num = name.slice(0, dash).trim();
  for (const [k, accent, trim, glow, noNum] of THEMES) if (n.includes(k)) return { accent, trim, glow, numeral: noNum ? '' : num };
  return THEME_DEFAULT;
}

function hexToRgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); }
function onColor(c) { const [r, g, b] = hexToRgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#16120C' : '#E8DCC0'; }
function accentBright(c) {
  const [r, g, b] = hexToRgb(c).map(x => x / 255);
  const max = Math.max(r, g, b);
  if (max >= 0.62 || max === 0) return max === 0 ? '#9E9E9E' : c;
  const k = 0.62 / max;
  return rgbToHex(r * k * 255, g * k * 255, b * k * 255);
}

/** Применить тему к странице (CSS-переменные). */
function applyTheme(t) {
  const s = document.documentElement.style;
  s.setProperty('--accent', t.accent);
  s.setProperty('--trim', t.trim);
  s.setProperty('--glow', t.glow);
  s.setProperty('--accent-bright', accentBright(t.accent));
  s.setProperty('--on-accent', onColor(t.accent));
  s.setProperty('--trim-mix', mix(t.trim, '#C4A462', 0.6));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = '#0A0908';
}
