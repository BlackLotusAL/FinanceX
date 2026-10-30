// 通用工具：请求、格式化、公共版块
export const state = { meta: null };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  let data = null;
  try { data = await r.json(); } catch { /* 空响应 */ }
  if (!r.ok) throw new Error((data && data.error) || `请求失败（${r.status}）`);
  return data;
}

export const get = p => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const put = (p, b) => api('PUT', p, b ?? {});
export const del = p => api('DELETE', p);

export async function loadMeta() {
  state.meta = await get('/api/meta');
  return state.meta;
}

// ---------- 数字 ----------
const MINUS = '−';
export function fmt(n, dp = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Math.abs(n) < 0.5 * 10 ** -dp ? 0 : n;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? MINUS + s : s;
}
export function sgn(n, dp = 2) {
  if (n === null || n === undefined) return '—';
  const s = fmt(Math.abs(n), dp);
  if (Math.abs(n) < 0.5 * 10 ** -dp) return s;
  return (n > 0 ? '+' : MINUS) + s;
}
export const wan = (n, dp = 2) => fmt(n / 10000, dp);
export const cls = n => (n > 1e-9 ? 'up' : n < -1e-9 ? 'dn' : 'mut');
export function qty(n) {
  if (n === null || n === undefined) return '—';
  const dp = Math.abs(n - Math.round(n)) < 1e-9 ? 0 : (String(+n.toFixed(8)).split('.')[1] || '').length;
  return fmt(n, Math.min(Math.max(dp, 0), 8));
}
export function priceFmt(n) {
  if (n === null || n === undefined) return '—';
  return fmt(n, Math.abs(n) >= 10 ? 2 : 4);
}
export function parseNum(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/,/g, '').replace(/[−–]/g, '-').replace(/[¥￥$\s]/g, '').replace(/^\+/, '');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

// ---------- 日期 ----------
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function today() { return state.meta?.today || new Date().toISOString().slice(0, 10); }
export function stripDate() {
  const d = new Date(today() + 'T00:00:00');
  return `${today().replace(/-/g, '.')} ${WEEK[d.getDay()]}`;
}
export const monthLabel = m => m ? `${+m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月` : '';
export const mShort = m => `${+m.slice(5, 7)} 月`;
export const dShort = d => d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : '';
export const dDot = d => d ? d.replace(/-/g, '.') : '';
export function monthAdd(m, n) {
  let y = +m.slice(0, 4), mo = +m.slice(5, 7) + n;
  y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
export const cnMonth = m => CN_NUM[+m.slice(5, 7)] + '月';

// ---------- 币种 ----------
export const CUR_NAME = { CNY: '人民币 CNY', HKD: '港币 HKD', USD: '美元 USD', CRYPTO: '加密货币 · USDT 计价' };
export const CUR_SHORT = { CNY: '人民币', HKD: '港币', USD: '美元', CRYPTO: '加密货币' };
export const CUR_CODE = { CNY: 'CNY', HKD: 'HKD', USD: 'USD', CRYPTO: 'USDT', USDT: 'USDT' };
export const CUR_SYM = { CNY: '¥', HKD: 'HK$', USD: 'US$', USDT: 'USDT ', CRYPTO: 'USDT ' };
export const GROUP_COLOR = { CNY: '#141414', HKD: '#6E6A62', USD: '#A8A39A', CRYPTO: '#C9C5BB' };
export const CAT_NAME = { stock: '股票', etf: '场内 ETF', fund: '场外基金', crypto: '加密货币' };
export const SRC_NAME = { alipay: '支付宝', wechat: '微信', abc: '农行信用卡', manual: '手动', copy: '手动', sell: '卖出', fx: '结汇' };
export const TYPE_NAME = { income: '收入', expense: '支出', transfer: '转账' };
export const money = (n, cur, dp = 2) => `${CUR_SYM[cur] ?? ''}${fmt(n, dp)}`;

// ---------- 分类 ----------
export function catLabel(c) { return c ? `${c.l1} · ${c.name}` : ''; }
export function catById(id) { return state.meta.categories.find(c => c.id === id); }
export function catOptions(kind, selected, { placeholder = false, allowAuto = false } = {}) {
  const cats = state.meta.categories.filter(c => c.kind === kind && (allowAuto || !c.auto || c.id === selected));
  let html = placeholder || !selected ? `<option value="">请选择…</option>` : '';
  let l1 = null;
  for (const c of cats) {
    if (c.l1 !== l1) { if (l1) html += '</optgroup>'; html += `<optgroup label="${esc(c.l1)}">`; l1 = c.l1; }
    html += `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.l1)} · ${esc(c.name)}</option>`;
  }
  return html + (l1 ? '</optgroup>' : '');
}
export function typeOptions(t) {
  return ['income', 'expense', 'transfer'].map(k => `<option value="${k}"${k === t ? ' selected' : ''}>${TYPE_NAME[k]}</option>`).join('');
}
// 流水金额的显示：支出为负、退款显示为 +、转账不带符号
export function flowAmount(f) {
  if (f.type === 'transfer') return { text: fmt(f.amount), cls: 'mut' };
  const v = f.type === 'income' ? f.amount : -f.amount;
  return { text: sgn(v), cls: cls(v) };
}

// ---------- 公共版块 ----------
const DROP_ICON = '<svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 2v13M5 10l6 6 6-6M3 20h16" fill="none" stroke="#24399A" stroke-width="2.4"></path></svg>';

export function strip(left, right) {
  return `<div class="strip"><div><span style="display:flex;align-items:center;gap:14px">${left}</span><span style="display:flex;gap:18px;align-items:center">${right}</span></div></div>`;
}
export function mainStrip() {
  return strip(`<span>${stripDate()}</span>`, `<span>数据仅存本机</span><a href="#/settings">分类与备份</a>`);
}
export function backStrip(href, label, title, right) {
  return strip(`<a href="${href}" class="back">← ${label}</a><span>${title}</span>`, right ?? `<span>${stripDate()}</span>`);
}
export function header(active) {
  const a = k => (k === active ? ' class="on"' : '');
  return `<header>
<div class="mast"><a class="logo" href="#/overview">FinanceX<i> Daily</i></a><a class="drop" href="#/import">${DROP_ICON}<span>导入账单</span></a></div>
<nav class="nav"><a${a('overview')} href="#/overview">总览</a><a${a('bills')} href="#/bills">账单</a><a${a('holdings')} href="#/holdings">持仓</a><a class="sp" href="#/bs">财务报表 →</a></nav>
</header>`;
}
export function reportHeader(active, selector) {
  const a = k => (k === active ? ' class="on"' : '');
  return `<header><div class="rmast"><span class="rlogo">Financial<i> Supplement</i></span>${selector}</div>
<nav class="rnav"><a${a('bs')} href="#/bs">资产负债表</a><a${a('is')} href="#/is">利润表</a><a${a('cf')} href="#/cf">现金流量表</a></nav></header>`;
}

// ---------- 提示 ----------
let toastTimer;
// 防止重复提交：同一 key 的请求未完成前，再次触发直接忽略。
// 页面重绘按钮时用 busyAttr(key) 保持禁用状态。
const pending = new Set();
export const busyAttr = key => (pending.has(key) ? ' disabled aria-busy="true"' : '');
export function once(key, fn) {
  return async (...args) => {
    if (pending.has(key)) return;
    pending.add(key);
    document.querySelectorAll(`[data-once="${key}"]`).forEach(b => { b.disabled = true; });
    try { return await fn(...args); } finally {
      pending.delete(key);
      document.querySelectorAll(`[data-once="${key}"]`).forEach(b => { b.disabled = false; });
    }
  };
}

export function toast(msg, err = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), err ? 5000 : 2600);
}
export function confirmBox(title, text, ok = '确定', danger = false) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p>${text}</p>
<div class="acts"><button type="button" class="btn" data-r="0">取消</button><button type="button" class="btn pri" data-r="1"${danger ? ' style="background:#B3261E;border-color:#B3261E"' : ''}>${esc(ok)}</button></div></div>`;
    const done = v => { bg.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') done(false); };
    bg.addEventListener('click', e => { if (e.target === bg) done(false); const r = e.target.closest('[data-r]'); if (r) done(r.dataset.r === '1'); });
    document.addEventListener('keydown', key);
    document.body.appendChild(bg);
    bg.querySelector('[data-r="1"]').focus();
  });
}
export function fail(e) { toast(e.message || String(e), true); }

export function qs() {
  const h = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(h));
}
export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }

// 左侧淡化的账单摘要（导入、复制上月抽屉背后）
export function ghost(summary, month) {
  const s = summary || { income: 0, expense: 0, balance: 0 };
  const rate = s.rate !== null && s.rate !== undefined ? `，储蓄率 ${(s.rate * 100).toFixed(1)}%` : '';
  return `<div class="ghost" aria-hidden="true">
<div style="font-family:var(--f-display);font-size:46px;border-bottom:5px solid #141414;padding-bottom:8px">FinanceX <i style="color:#24399A">Daily</i></div>
<div class="h1" style="font-size:38px;margin-top:30px;line-height:1.15">${month ? cnMonth(month) : ''}结余 ${fmt(s.balance, 0)}${rate}</div>
<div style="margin-top:26px;border-top:5px solid #141414">${[['收入', s.income], ['支出', s.expense], ['结余', s.balance]].map(([k, v]) =>
    `<div style="display:flex;flex-direction:column;padding:10px 0;border-bottom:1px solid #141414"><span style="font-size:12px">${k}</span><span class="num" style="font-size:30px;line-height:1.1">${fmt(v, 0)}</span></div>`).join('')}</div>
</div>`;
}
