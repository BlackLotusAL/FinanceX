import {
  get, qs, backStrip, reportHeader, esc, fmt, sgn, wan, qty, priceFmt, dDot, dShort, monthLabel, mShort, cnMonth, go,
  CUR_NAME, CUR_SHORT, CUR_SYM, flowAmount, TYPE_NAME, SRC_NAME,
} from '../util.js';

const strip = () => backStrip('#/overview', '总览', '');

export async function render(root, { name }) {
  if (name === 'is') return renderIS(root);
  if (name === 'cf') return renderCF(root);
  return renderBS(root);
}

// ---------- 资产负债表 ----------
async function renderBS(root) {
  const q = qs();
  const d = await get(`/api/bs${/^\d{4}-\d{2}$/.test(q.month || '') ? `?month=${q.month}` : ''}`);
  const sel = `<label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;padding-bottom:8px">月份<select name="month" aria-label="选择月份">${[...d.months].reverse().map(m => `<option value="${m}"${m === d.month ? ' selected' : ''}>${monthLabel(m)}</option>`).join('') || '<option>还没有快照</option>'}</select></label>`;
  const det = d.detail;
  let body;
  if (!det) {
    body = `<div class="empty">资产负债表就是盘点快照。还没有盘点过，<a href="#/stocktake">去盘点</a>。</div>`;
  } else {
    const rows = det.groups.filter(g => g.items.length).map(g => `<div class="bh"><b>${CUR_NAME[g.currency]}</b><span class="mono">¥ ${fmt(g.total)}</span></div>` + g.items.map(it => {
      if (it.kind === 'account') {
        return `<div class="br"><span>${esc(it.name)}${it.note ? ` <span class="mut" style="font-size:12px">${esc(it.note)}</span>` : ''}</span><span class="mut">手填</span><span></span><span${it.value < 0 ? ' class="dn"' : ''}>${it.value === null ? '<span class="mut">未填</span>' : (CUR_SYM[it.currency] || '') + fmt(it.value)}</span><span>${it.cny === null ? '—' : fmt(it.cny)}</span><span></span></div>`;
      }
      const sym = CUR_SYM[it.currency];
      let pnl = '';
      if (it.pnl !== null) {
        const c = it.pnl >= 0 ? 'up' : 'dn';
        pnl = it.pnl_currency === 'CNY' ? `<span class="${c}">${it.connect ? '¥' : ''}${sgn(it.pnl)}</span>` : `<span class="${c}">${sym.trim()} ${sgn(it.pnl)}</span>`;
      }
      return `<div class="br"><span>${esc(it.name)} <span class="mono mut" style="font-size:12px">${esc(it.code)}</span></span><span>${qty(it.qty)}</span><span>${it.price === null ? '<span class="mut">未填</span>' : priceFmt(it.price)}</span><span>${it.value === null ? '—' : sym + fmt(it.value)}</span><span>${it.cny === null ? '—' : fmt(it.cny)}</span><span>${pnl}</span></div>`;
    }).join('')).join('');
    const share = det.groups.map(g => {
      const p = det.net ? g.total / det.net * 100 : 0;
      return `<div style="display:grid;grid-template-columns:110px minmax(0,1fr) 56px;gap:10px;align-items:center;padding:7px 0;font-size:13px"><span>${CUR_SHORT[g.currency]}</span><div class="bar"><i style="width:${Math.max(0, Math.min(100, p)).toFixed(1)}%"></i></div><span class="mono" style="text-align:right">${p.toFixed(1)}%</span></div>`;
    }).join('');
    body = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:14px;padding:20px 0 14px">
<div style="display:flex;flex-direction:column;gap:8px"><span class="kick">资产负债表 · ${mShort(d.month)}快照</span><h1 class="h1" style="font-size:40px;line-height:1.1">${cnMonth(d.month)}末净资产 ${wan(det.net)} 万元</h1>
<p class="dek">按 ${dShort(det.date)} 盘点时的余额、价格与汇率存档，不自动重算；可在盘点里改任一格。</p></div></div>
<div class="cols" style="border-top:5px solid #141414;padding-top:4px">
<section class="main"><div class="scroll"><div style="min-width:720px">
<div class="br mono" style="font-size:12px;color:#4A4740;border-bottom:0;padding-top:14px"><span>账户 / 标的</span><span>数量</span><span>价格</span><span>余额 / 市值（原币）</span><span>折合 ¥</span><span>浮动盈亏</span></div>
${rows}
<div class="br" style="border-top:3px solid #141414;border-bottom:6px double #141414;padding:12px 0;margin-top:12px"><span style="font-family:var(--f-serif);font-weight:900;font-size:16px">净资产</span><span></span><span></span><span></span><span style="font-weight:600;font-size:14px">${fmt(det.net)}</span><span></span></div>
</div></div>
<span class="mut" style="font-size:12px;margin-top:10px">浮动盈亏 = 市值 − 成本（数量 × 移动加权成本）；外币标的按原币，港股通按人民币。${det.missing ? ` 有 ${det.missing} 格未填，未计入。` : ''}</span></section>
<aside class="side" style="gap:24px;padding-top:16px">
<div class="panel"><div class="sec s3"><b>快照信息</b></div>
<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding-top:10px;font-size:13px"><span class="mut">盘点日期</span><span class="mono">${dDot(det.date)}</span><span class="mut">USD</span><span class="mono">${det.rates.USD ?? '—'}</span><span class="mut">HKD</span><span class="mono">${det.rates.HKD ?? '—'}</span><span class="mut">USDT</span><span class="mono">按 1:1 美元</span></div></div>
<div class="panel"><div class="sec s3"><b>按币种</b><span class="mono mut" style="font-size:12px">占净资产</span></div>${share}</div>
<a class="lk" href="#/stocktake?month=${d.month}" style="align-self:flex-start">重新盘点 ${mShort(d.month)} →</a>
<div style="border-top:2px solid #141414"></div></aside></div>`;
  }
  root.innerHTML = `<div class="pg">${strip()}<div class="wrap">${reportHeader('bs', sel)}${body}</div></div>`;
  root.querySelector('[name="month"]')?.addEventListener('change', e => go(`#/bs?month=${e.target.value}`));
}

// ---------- 利润表 ----------
let IS = { open: new Set(), drill: null };

async function renderIS(root) {
  const q = qs();
  const d = await get(`/api/is${/^\d{4}$/.test(q.year || '') ? `?year=${q.year}` : ''}`);
  IS.root = root; IS.d = d;
  if (IS.year !== d.year) { IS.year = d.year; IS.drill = null; }
  drawIS();
}

function yearSel(years, y) {
  return `<label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;padding-bottom:8px">年份<select name="year" aria-label="选择年份">${years.map(v => `<option${v === y ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
}

function drawIS() {
  const d = IS.d, ms = d.months;
  const t = d.total;
  const period = ms.length ? `${esc(d.year)} 年 ${ms.length === 1 ? '1' : `1–${ms[ms.length - 1]}`} 月` : `${esc(d.year)} 年`;
  const grid = `grid-template-columns:minmax(150px,1.6fr) repeat(${ms.length},minmax(64px,1fr)) minmax(80px,1.1fr)`;
  const cell = (v, key, extra = '') => {
    const blank = Math.abs(v) < 0.5;
    return `<button type="button" class="cv${blank ? ' blank' : ''}${IS.drill && IS.drill.key === key ? ' on' : ''}" data-drill="${esc(key)}"${blank ? ' tabindex="-1"' : ''} ${extra}>${blank ? '' : fmt(v, 0)}</button>`;
  };
  const sumBy = ids => ms.map(m => ids.reduce((a, id) => a + ((d.cells[id] || [])[m - 1] || 0), 0));
  const row = (label, vals, key, style = '', lstyle = '') => `<div class="er" style="${grid};${style}"><span style="${lstyle}">${label}</span>${vals.map((v, i) => cell(v, `${key}|${ms[i]}`)).join('')}${cell(vals.reduce((a, b) => a + b, 0), `${key}|all`)}</div>`;
  const cats = d.categories;
  const used = c => (d.cells[c.id] || []).some(v => Math.abs(v) > 0.004);
  let h = `<div class="er mono" style="${grid};font-size:12px;color:#4A4740;border-bottom:2px solid #141414"><span>科目</span>${ms.map(m => `<span>${m} 月</span>`).join('')}<span>${ms.length ? `1–${ms[ms.length - 1]} 月` : '合计'}</span></div>`;
  const head = (label, vals, key) => row(label, vals, key, 'border-bottom:2px solid #141414;padding-top:16px', "font-family:var(--f-serif);font-weight:900;font-size:15px");
  const l1Block = (l1, collapsible) => {
    const subs = cats.filter(c => c.l1 === l1);
    const vals = sumBy(subs.map(c => c.id));
    const open = !collapsible || IS.open.has(l1);
    const shown = subs.filter(used);
    const label = collapsible ? `<button type="button" class="lk plain" data-l1="${esc(l1)}" style="font-weight:400;font-size:13px;min-height:0">${open ? '▾' : '▸'} ${esc(l1)}</button>` : esc(l1);
    let s = row(label, vals, `l1:${l1}`, '', collapsible ? 'padding-left:30px' : 'padding-left:14px;font-weight:700');
    if (open) s += shown.map(c => row(esc(c.name), sumBy([c.id]), `c:${c.id}`, '', `padding-left:${collapsible ? 50 : 30}px;color:#4A4740`)).join('');
    return s;
  };
  h += head('收入', ms.map(m => d.summary[m].income), 't:income');
  for (const l1 of [...new Set(cats.filter(c => c.kind === 'income').map(c => c.l1))]) h += l1Block(l1, false);
  h += head('支出', ms.map(m => d.summary[m].expense), 't:expense');
  h += l1Block('工资减扣', false);
  h += row('消费支出', ms.map(m => d.summary[m].consume), 'consume', 'border-top:1px solid #141414', 'padding-left:14px;font-weight:700');
  for (const l1 of [...new Set(cats.filter(c => c.kind === 'expense' && c.l1 !== '工资减扣').map(c => c.l1))]) h += l1Block(l1, true);
  h += `<div class="er" style="${grid};border-top:3px solid #141414;border-bottom:1px solid #141414;padding:10px 0"><span style="font-family:var(--f-serif);font-weight:900;font-size:16px">结余</span>${ms.map(m => `<span class="${d.summary[m].balance >= 0 ? 'up' : 'dn'}">${fmt(d.summary[m].balance, 0)}</span>`).join('')}<span class="${t.balance >= 0 ? 'up' : 'dn'}">${fmt(t.balance, 0)}</span></div>`;
  h += `<div class="er" style="${grid};border-bottom:6px double #141414;padding:9px 0"><span style="font-weight:700">储蓄率</span>${ms.map(m => `<span>${d.summary[m].rate === null ? '—' : (d.summary[m].rate * 100).toFixed(1) + '%'}</span>`).join('')}<span>${t.rate === null ? '—' : (t.rate * 100).toFixed(1) + '%'}</span></div>`;

  IS.root.innerHTML = `<div class="pg">${strip()}<div class="wrap">${reportHeader('is', yearSel(d.years, d.year))}
<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:14px;padding:20px 0 14px">
<div style="display:flex;flex-direction:column;gap:8px"><span class="kick">利润表 · ${period}</span><h1 class="h1" style="font-size:40px;line-height:1.1">${d.year === new Date().getFullYear().toString() ? '今年' : esc(d.year) + ' 年'}结余 ${fmt(t.balance, 0)}${t.rate !== null ? `，储蓄率 ${(t.rate * 100).toFixed(1)}%` : ''}</h1>
<p class="dek">只计人民币已实现收支；外币收益与浮动盈亏只在净资产里体现。</p></div>
<span class="mut" style="font-size:12px">点 ▸ 展开二级分类</span></div>
<div style="border-top:5px solid #141414"></div>
${ms.length ? `<div class="scroll"><div style="min-width:${300 + ms.length * 80}px">${h}</div></div>` : '<div class="empty">这一年还没有流水。</div>'}
<p class="mut" style="font-size:12px;margin:12px 0 0">点任一数字可查看构成它的流水。</p>
<div id="drill"></div></div></div>`;
  bindIS();
  if (IS.drill) showISDrill();
}

function bindIS() {
  const r = IS.root;
  r.querySelector('[name="year"]').addEventListener('change', e => go(`#/is?year=${e.target.value}`));
  r.querySelectorAll('[data-l1]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.l1; IS.open.has(k) ? IS.open.delete(k) : IS.open.add(k); drawIS(); }));
  r.querySelectorAll('[data-drill]').forEach(b => b.addEventListener('click', () => {
    if (b.classList.contains('blank')) return;
    IS.drill = IS.drill?.key === b.dataset.drill ? null : { key: b.dataset.drill };
    drawIS();
    if (IS.drill) IS.root.querySelector('#drill').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

async function showISDrill() {
  const [what, m] = IS.drill.key.split('|');
  const period = m === 'all' ? IS.d.year : `${IS.d.year}-${String(m).padStart(2, '0')}`; // 年份已由服务端校验为 4 位数字
  const p = new URLSearchParams({ period });
  let label = '';
  if (what.startsWith('c:')) { p.set('category_id', what.slice(2)); const c = IS.d.categories.find(x => x.id === +what.slice(2)); label = `${c.l1} · ${c.name}`; }
  else if (what.startsWith('l1:')) { p.set('l1', what.slice(3)); label = what.slice(3); }
  else if (what.startsWith('t:')) { p.set('type', what.slice(2)); label = TYPE_NAME[what.slice(2)]; }
  else if (what === 'consume') { p.set('consume', '1'); label = '消费支出'; }
  // 等待期间用户换了单元格或年份，就丢弃这次结果，不覆盖当前的下钻
  const key = IS.drill.key, d0 = IS.d, root0 = IS.root;
  const res = await get(`/api/flows?${p}`);
  if (IS.drill?.key !== key || IS.d !== d0 || IS.root !== root0) return;
  const items = res.items.filter(f => f.type !== 'transfer');
  const total = items.reduce((a, f) => a + (f.type === 'income' ? f.amount : f.amount), 0);
  const el = IS.root.querySelector('#drill');
  if (!el) return;
  el.innerHTML = `<div style="padding-top:26px"><div class="sec"><b>下钻 · ${m === 'all' ? esc(IS.d.year) + ' 年' : `${+m} 月`} ${esc(label)} ${fmt(total)}</b><button type="button" class="lk" data-close>收起 ×</button></div>
<div class="dr mono mut" style="font-size:12px;border-bottom:2px solid #141414;grid-template-columns:80px 120px minmax(0,1fr) 110px"><span>日期</span><span>来源</span><span>商户 / 分类</span><span>金额</span></div>
${items.map(f => { const a = flowAmount(f); return `<div class="dr" style="grid-template-columns:80px 120px minmax(0,1fr) 110px"><span class="mono">${dDot(f.date).slice(5)}</span><span class="mut">${esc(f.source === 'sell' || f.source === 'fx' ? '交易自动生成' : SRC_NAME[f.source] || f.source)}</span><span>${esc(f.merchant)} <span class="mut" style="font-size:12px">${esc(f.l1 || '')} · ${esc(f.cat_name || '')}</span></span><span class="${a.cls}">${a.text}</span></div>`; }).join('') || '<div class="empty">没有流水</div>'}
<div style="padding-top:8px"><a class="lk" href="#/bills/${m === 'all' ? esc(IS.d.year) + '-01' : period}">到账单页查看 →</a></div></div>`;
  el.querySelector('[data-close]').addEventListener('click', () => { IS.drill = null; drawIS(); });
}

// ---------- 现金流量表 ----------
let CF = { drill: null };

async function renderCF(root) {
  const q = qs();
  const d = await get(`/api/cf${/^\d{4}$/.test(q.year || '') ? `?year=${q.year}` : ''}`);
  CF.root = root; CF.d = d;
  if (CF.year !== d.year) { CF.year = d.year; CF.drill = null; }
  drawCF();
}

function cfChart(rows) {
  const W = 920, H = 190, n = rows.length || 1, slot = W / n;
  const maxP = Math.max(1, ...rows.flatMap(r => [r.balance, r.inv]));
  const maxN = Math.max(0, ...rows.flatMap(r => [-r.balance, -r.inv]));
  const base = (maxP / (maxP + maxN)) * (H - 20) + 4;
  const scale = (H - 24) / (maxP + maxN);
  let s = '';
  rows.forEach((r, i) => {
    const x0 = i * slot + slot / 2 - 22;
    [[r.balance, '#141414', 0], [r.inv, '#A8A39A', 24]].forEach(([v, c, off]) => {
      const h = Math.abs(v) * scale;
      s += `<rect x="${(x0 + off).toFixed(1)}" y="${(v >= 0 ? base - h : base).toFixed(1)}" width="20" height="${Math.max(h, 0.5).toFixed(1)}" fill="${c}"></rect>`;
    });
  });
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#141414" stroke-width="1.5" vector-effect="non-scaling-stroke"></line>`;
  return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="各月结余与投资净投入柱状图" style="display:block">${s}</svg>
<div style="position:relative;height:18px">${rows.map((r, i) => `<span style="position:absolute;left:${((i + 0.5) / n * 100).toFixed(2)}%;transform:translateX(-50%);font-size:12px" class="mono mut">${r.month}</span>`).join('')}</div>`;
}

function drawCF() {
  const d = CF.d, ms = d.months;
  const grid = `grid-template-columns:minmax(150px,1.6fr) repeat(${ms.length},minmax(64px,1fr)) minmax(84px,1.1fr)`;
  const c = (v, key, dp) => `<button type="button" class="cv ${v > 0 ? 'up' : v < 0 ? 'dn' : 'mut'}${CF.drill === key ? ' on' : ''}" data-drill="${key}">${sgn(v, dp)}</button>`;
  const period = ms.length ? `${esc(d.year)} 年 1–${ms[ms.length - 1]} 月` : `${esc(d.year)} 年`;
  CF.root.innerHTML = `<div class="pg">${strip()}<div class="wrap">${reportHeader('cf', yearSel(d.years, d.year))}
<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:14px;padding:20px 0 14px">
<div style="display:flex;flex-direction:column;gap:8px"><span class="kick">现金流量表 · ${period}</span><h1 class="h1" style="font-size:40px;line-height:1.1">结余 ${fmt(d.total.balance, 0)}，其中 ${fmt(Math.max(d.total.inv, 0), 0)} 投向了投资</h1>
<p class="dek"><b>投资净投入</b> = 人民币买入标的 + 购汇 − 卖出部分的成本 − 结汇本金。点任一数字可下钻到构成它的流水或交易。</p></div>
<span class="mut" style="font-size:12px;display:flex;gap:14px;align-items:center"><i style="display:inline-block;width:12px;height:12px;background:#141414"></i>结余<i style="display:inline-block;width:12px;height:12px;background:#A8A39A"></i>投资净投入</span></div>
${ms.length ? `<div style="border-top:5px solid #141414;padding-top:16px">${cfChart(d.rows)}</div>
<div class="scroll" style="margin-top:12px"><div style="min-width:${300 + ms.length * 84}px">
<div class="er mono" style="${grid};font-size:12px;color:#4A4740;border-bottom:2px solid #141414"><span>项目</span>${ms.map(m => `<span>${m} 月</span>`).join('')}<span>1–${ms[ms.length - 1]} 月</span></div>
<div class="er" style="${grid};align-items:center"><span style="font-weight:700">结余</span>${d.rows.map(r => c(r.balance, `balance|${r.month}`, 0)).join('')}${c(d.total.balance, 'balance|all', 0)}</div>
<div class="er" style="${grid};align-items:center;border-bottom:6px double #141414"><span style="font-weight:700">投资净投入</span>${d.rows.map(r => c(r.inv, `inv|${r.month}`, 2)).join('')}${c(d.total.inv, 'inv|all', 2)}</div>
</div></div>` : '<div class="empty" style="border-top:5px solid #141414">这一年还没有流水或交易。</div>'}
<div class="cols" style="padding-top:26px"><section class="main" id="drill">${CF.drill ? '<div class="loading">加载中…</div>' : ''}</section>
<aside class="side" style="gap:10px"><div class="sec s3"><b>不计入的</b></div>
<p style="margin:0;font-size:13px;line-height:1.7">转账（还款、余额宝转入转出、借出与收回）、外币资产之间的买卖、期初录入的持仓与外币。外币标的卖出的盈利只增加外币余额，结汇时才以汇兑损益进入结余。</p></aside></div>
</div></div>`;
  CF.root.querySelector('[name="year"]').addEventListener('change', e => go(`#/cf?year=${e.target.value}`));
  CF.root.querySelectorAll('[data-drill]').forEach(b => b.addEventListener('click', () => { CF.drill = CF.drill === b.dataset.drill ? null : b.dataset.drill; drawCF(); }));
  if (CF.drill) showCFDrill();
}

const KIND = { buy: '买入', sell: '卖出', fx_buy: '购汇', fx_sell: '结汇' };

async function showCFDrill() {
  const [row, m] = CF.drill.split('|');
  const period = m === 'all' ? CF.d.year : `${CF.d.year}-${String(m).padStart(2, '0')}`;
  const key = CF.drill, d0 = CF.d, root0 = CF.root;
  const res = await get(`/api/cf/drill?period=${period}&row=${row}`);
  if (CF.drill !== key || CF.d !== d0 || CF.root !== root0) return;
  const el = CF.root.querySelector('#drill');
  if (!el) return;
  const when = m === 'all' ? `${esc(CF.d.year)} 年` : `${+m} 月`;
  if (row === 'inv') {
    const items = res.items;
    const total = items.reduce((a, t) => a + (t.inv || 0), 0);
    el.innerHTML = `<div class="sec"><b>下钻 · ${when}投资净投入 ${fmt(total)}</b><button type="button" class="lk" data-close>收起 ×</button></div>
<div class="dr mono mut" style="font-size:12px;border-bottom:2px solid #141414"><span>日期</span><span>交易</span><span>说明</span><span>计入</span></div>
${items.map(t => `<div class="dr"${Math.abs(t.inv || 0) < 0.005 ? ' style="color:#4A4740"' : ''}><span class="mono">${dShort(t.date)}</span><span>${t.opening ? '期初' : ''}${KIND[t.kind]}</span><span>${desc(t)}</span><span>${Math.abs(t.inv || 0) < 0.005 ? '不计入' : sgn(t.inv)}</span></div>`).join('') || '<div class="empty">没有交易</div>'}
<div class="dr" style="border-bottom:2px solid #141414;font-weight:700"><span></span><span>合计</span><span></span><span>${fmt(total)}</span></div>`;
  } else {
    const items = res.items;
    const total = items.reduce((a, f) => a + (f.type === 'income' ? f.amount : -f.amount), 0);
    el.innerHTML = `<div class="sec"><b>下钻 · ${when}结余 ${fmt(total)}</b><button type="button" class="lk" data-close>收起 ×</button></div>
<div class="dr mono mut" style="font-size:12px;border-bottom:2px solid #141414"><span>日期</span><span>类型</span><span>商户 / 分类</span><span>金额</span></div>
${items.map(f => { const a = flowAmount(f); return `<div class="dr"><span class="mono">${dShort(f.date)}</span><span>${TYPE_NAME[f.type]}</span><span>${esc(f.merchant)} <span class="mut" style="font-size:12px">${esc(f.l1 || '未分类')}${f.cat_name ? ' · ' + esc(f.cat_name) : ''}</span></span><span class="${a.cls}">${a.text}</span></div>`; }).join('') || '<div class="empty">没有流水</div>'}
<div class="dr" style="border-bottom:2px solid #141414;font-weight:700"><span></span><span>合计</span><span></span><span>${fmt(total)}</span></div>`;
  }
  el.querySelector('[data-close]').addEventListener('click', () => { CF.drill = null; drawCF(); });
}

function desc(t) {
  const sym = t.book === 'CNY' ? '' : (CUR_SYM[t.inst_currency] || '');
  if (t.kind === 'buy') return `${esc(t.name)} ${esc(t.code)} · ${qty(t.qty)}${t.book === 'CNY' ? '' : ` · ${sym}${fmt(t.amount)}，外币资产买卖不计入`}`;
  if (t.kind === 'sell') return t.book === 'CNY'
    ? `${esc(t.name)} ${esc(t.code)} · 到手 ${fmt(t.amount)}，只减成本；${fmt(t.realized)} 已计入结余`
    : `${esc(t.name)} ${esc(t.code)} · 到手 ${sym}${fmt(t.amount)}，外币资产买卖不计入`;
  if (t.kind === 'fx_buy') return `${t.currency} ${fmt(t.qty)} · 支付 ${fmt(t.amount)}${t.opening ? '（期初，不计入）' : '（含手续费）'}`;
  return `${t.currency} ${fmt(t.qty)} · 本金 ${fmt(t.principal)}；${fmt(t.pnl)} 已计入结余`;
}
