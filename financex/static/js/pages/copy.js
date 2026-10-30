import { get, post, strip, stripDate, ghost, esc, fmt, sgn, dShort, today, mShort, parseNum, toast, fail, go, once, busyAttr } from '../util.js';

const DEFAULT_L1 = ['工资收入', '工资减扣', '住房物业', '数字订阅'];
let S = null;

export async function render(root, { rest }) {
  const month = /^\d{4}-\d{2}$/.test(rest[0] || '') ? rest[0] : today().slice(0, 7);
  const [list, bills] = await Promise.all([get(`/api/copy?month=${month}`), get(`/api/bills?month=${month}`)]);
  const items = list.items.filter(f => !f.trade_id);
  const l1s = [...new Set(items.map(f => f.l1).filter(Boolean))];
  const chips = new Set(DEFAULT_L1.filter(k => l1s.includes(k)));
  S = {
    root, month, src: list.source, items, l1s, chips, all: chips.size === 0, q: '',
    ghost: ghost(bills.summary, month),
    sel: new Set(items.filter(f => chips.has(f.l1) && !f.exists).map(f => f.id)),
    amt: {},
  };
  draw();
}

function shown() {
  const q = S.q.trim().toLowerCase();
  return S.items.filter(f => (S.all || S.chips.has(f.l1))
    && (!q || (f.merchant + ' ' + f.description).toLowerCase().includes(q)));
}

function display(f) {
  // 显示值：收入 +，支出 −（退款 +），转账无符号
  if (f.type === 'income') return sgn(f.amount);
  if (f.type === 'transfer') return fmt(f.amount);
  return sgn(-f.amount);
}
function toStored(f, text) {
  const v = parseNum(text);
  if (v === null || Number.isNaN(v)) return NaN;
  if (f.type === 'expense') return text.trim().startsWith('+') ? -Math.abs(v) : Math.abs(v);
  if (f.type === 'transfer') return Math.abs(v);
  return v;
}
const amountOf = f => (S.amt[f.id] !== undefined ? S.amt[f.id] : f.amount);

function draw() {
  const rows = shown();
  const picked = S.items.filter(f => S.sel.has(f.id));
  const inc = picked.filter(f => f.type === 'income').reduce((a, f) => a + amountOf(f), 0);
  const exp = picked.filter(f => f.type === 'expense').reduce((a, f) => a + amountOf(f), 0);
  const chip = (k, on) => `<button type="button" class="chip${on ? ' on' : ''}" data-chip="${esc(k)}">${esc(k)}</button>`;
  S.root.innerHTML = `<div class="pg">${strip(`<span>${stripDate()}</span>`, '<span>数据仅存本机</span>')}
<div class="drawer">${S.ghost}<aside aria-label="复制上月流水">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
<div style="display:flex;flex-direction:column;gap:8px"><span class="kick">复制上月流水</span><h1 class="h1" style="font-size:40px">从 ${mShort(S.src)}复制到 ${mShort(S.month)}</h1></div>
<a href="#/bills/${S.month}" aria-label="关闭" class="x-close">×</a></div>
<p style="margin:0;padding:14px 0;border-top:5px solid #141414;border-bottom:1px solid #141414;font-size:16px;line-height:1.6">选中的流水复制到 ${mShort(S.month)}<b>同一天</b>；${mShort(S.month)}没有那一天时取月末。复制后金额可直接改，工资、房租这类固定收支用它录入。</p>
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
<span class="mut" style="font-size:12px;margin-right:6px">${mShort(S.src)} · ${S.items.length} 笔　只看</span>
${S.l1s.map(k => chip(k, !S.all && S.chips.has(k))).join('')}${chip('全部分类', S.all)}
<span style="flex:1"></span><label style="display:flex;align-items:center;gap:8px;font-size:13px"><span class="mut">搜索</span><input class="f" type="text" id="q" value="${esc(S.q)}" placeholder="商户或说明" style="width:180px"></label></div>
${S.items.length ? `<div class="scroll"><div style="min-width:780px;border-top:3px solid #141414">
<div class="cp mono" style="font-size:12px;color:#4A4740;border-bottom:2px solid #141414"><input type="checkbox" data-act="all" aria-label="全选"${rows.length && rows.every(f => S.sel.has(f.id)) ? ' checked' : ''}><span>${mShort(S.src)}</span><span>复制到</span><span>商户 / 说明</span><span>分类</span><span style="text-align:right">${mShort(S.month)}金额</span></div>
${rows.map(f => {
    const on = S.sel.has(f.id);
    const changed = S.amt[f.id] !== undefined && Math.abs(S.amt[f.id] - f.amount) > 0.004;
    return `<div class="cp"${on ? '' : ' style="color:#4A4740"'} data-id="${f.id}"><input type="checkbox" data-f="sel" aria-label="复制 ${dShort(f.date)} ${esc(f.merchant)}"${on ? ' checked' : ''}>
<span class="mono">${dShort(f.date)}</span><span class="mono">→ ${dShort(f.target_date)}${f.clamped ? `<br><span style="font-size:12px;font-weight:700">${mShort(S.month)}没有 ${+f.date.slice(8)} 日，取月末</span>` : ''}${f.exists ? `<br><span style="font-size:12px;font-weight:700">${mShort(S.month)}已有同商户同分类的一笔</span>` : ''}</span>
<span>${esc(f.merchant || '—')}<br><span class="mut" style="font-size:12px">${esc(f.description || '')}</span></span>
<span>${f.type === 'transfer' ? '转账' : f.category_id ? `${esc(f.l1)} · ${esc(f.cat_name)}` : '未分类'}</span>
<span><input class="f r${changed ? ' chg' : ''}" type="text" data-f="amt" value="${display({ ...f, amount: amountOf(f) })}" aria-label="${mShort(S.month)}金额">${changed ? `<br><span class="mut" style="font-size:12px">${mShort(S.src)} ${display(f)}</span>` : ''}</span></div>`;
  }).join('') || '<div class="empty">没有符合条件的流水。</div>'}
</div></div>
<span class="mut" style="font-size:12px"><span style="display:inline-block;width:18px;border-bottom:2px solid #24399A;vertical-align:middle"></span> 蓝色下划线 = 已改过金额</span>`
    : `<div class="empty">${mShort(S.src)}没有可复制的流水。</div>`}
<div class="foot"><span style="font-size:13px">已选 <b>${picked.length}</b> 笔：收入 <b class="up">${sgn(inc)}</b>，支出 <b class="dn">${sgn(-exp)}</b></span>
<div style="display:flex;gap:10px"><a href="#/bills/${S.month}" class="btn">取消</a><button type="button" class="btn pri" data-act="go" data-once="copy-go"${picked.length ? busyAttr('copy-go') : ' disabled'}>复制 ${picked.length} 笔到 ${mShort(S.month)}</button></div></div>
</aside></div></div>`;
  bind();
}

function bind() {
  const r = S.root;
  r.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.chip;
    if (k === '全部分类') { S.all = !S.all; if (!S.all && !S.chips.size) S.all = true; }
    else { S.all = false; S.chips.has(k) ? S.chips.delete(k) : S.chips.add(k); if (!S.chips.size) S.all = true; }
    draw();
  }));
  const q = r.querySelector('#q');
  q?.addEventListener('input', () => { S.q = q.value; draw(); const n = S.root.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  r.querySelector('[data-act="all"]')?.addEventListener('change', e => { shown().forEach(f => (e.target.checked ? S.sel.add(f.id) : S.sel.delete(f.id))); draw(); });
  r.querySelectorAll('.cp[data-id]').forEach(el => {
    const f = S.items.find(x => x.id === +el.dataset.id);
    el.querySelector('[data-f="sel"]').addEventListener('change', e => { e.target.checked ? S.sel.add(f.id) : S.sel.delete(f.id); draw(); });
    el.querySelector('[data-f="amt"]').addEventListener('change', e => {
      const v = toStored(f, e.target.value);
      if (Number.isNaN(v)) { toast('金额格式不对', true); draw(); return; }
      S.amt[f.id] = v; S.sel.add(f.id); draw();
    });
  });
  r.querySelector('[data-act="go"]')?.addEventListener('click', once('copy-go', async () => {
    const items = S.items.filter(f => S.sel.has(f.id)).map(f => ({ id: f.id, amount: amountOf(f) }));
    try {
      const res = await post('/api/copy', { month: S.month, items });
      toast(`已复制 ${res.copied} 笔`);
      go(`#/bills/${S.month}`);
    } catch (e) { fail(e); }
  }));
}
