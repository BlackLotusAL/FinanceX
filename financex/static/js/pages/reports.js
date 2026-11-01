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

// ---------- 图表公用 ----------
const L1_COLOR = { 住房物业: '#3A55C4', 餐饮食品: '#D29B38', 交通出行: '#3E9CCB', 实体商品: '#9A4F94',
  数字订阅: '#2E8B6E', 生活服务: '#C25B7A', 健康保障: '#7A8B2E', 其他消费: '#B0703A' };
const OTHER = '其他消费';
const n0 = v => fmt(v, 0);

// 消费支出取金额最大的 4 个一级分类，其余（含「其他消费」与未分类）并为「其他消费」
function spendGroups(totals) {
  const top = Object.entries(totals).filter(([k, v]) => k !== OTHER && k !== '未分类' && v > 0.5)
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
  return top;
}

// ---------- 利润表 ----------
let IS = { open: new Set(), drill: null };

function median(a) {
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function isChart(d) {
  const ms = d.months, cats = d.categories;
  const val = (id, m) => (d.cells[id] || [])[m - 1] || 0;
  const l1Of = (l1, m) => cats.filter(c => c.l1 === l1).reduce((a, c) => a + val(c.id, m), 0);
  const consumeL1 = [...new Set(cats.filter(c => c.kind === 'expense' && c.l1 !== '工资减扣').map(c => c.l1))];
  const totals = Object.fromEntries(consumeL1.map(l1 => [l1, ms.reduce((a, m) => a + l1Of(l1, m), 0)]));
  const top = spendGroups(totals);
  // 每段：名称、颜色、各月金额；「其他消费」= 消费支出 − 前 4 类，未分类也算在里面
  let groups = top.map(l1 => ({ name: l1, l1, color: L1_COLOR[l1] || '#6E6A62', vals: ms.map(m => l1Of(l1, m)) }));
  const other = { name: OTHER, color: L1_COLOR[OTHER], vals: ms.map((m, i) => d.summary[m].consume - groups.reduce((a, g) => a + g.vals[i], 0)) };
  if (other.vals.some(v => v > 0.5)) groups.push(other);
  // 波动小的放下面、波动大的放上面，尖峰更容易看出来
  const cv = g => { const mean = g.vals.reduce((a, b) => a + b, 0) / ms.length; if (mean <= 0) return 0; return Math.sqrt(g.vals.reduce((a, v) => a + (v - mean) ** 2, 0) / ms.length) / mean; };
  groups.sort((a, b) => cv(a) - cv(b));
  const deduct = { name: '工资减扣', l1: '工资减扣', color: 'url(#hd)', vals: ms.map(m => d.summary[m].deduct) };
  const stack = deduct.vals.some(v => v > 0.5) ? [deduct, ...groups] : groups;
  if (!stack.length) return '';

  const W = 1344, X0 = 56, BASE = 290, PLOT = 240;
  const tot = ms.map((m, i) => stack.reduce((a, g) => a + Math.max(g.vals[i], 0), 0));
  const max = Math.max(...tot, 1);
  const k = PLOT / max;
  const step = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].find(s => max / s <= 4) || 1000000;
  const tick = v => v >= 10000 ? `${+(v / 10000).toFixed(1)} 万` : n0(v);
  const slot = (W - X0) / ms.length, bw = Math.min(50, slot * 0.5);
  let s = '';
  for (let v = step; v <= max; v += step) {
    const y = BASE - v * k;
    s += `<line x1="${X0}" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="#8A877F" stroke-dasharray="1 3"></line><text x="${X0 - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${tick(v)}</text>`;
  }
  const segs = []; // 记下每段的位置，供标注用
  ms.forEach((m, i) => {
    const x = X0 + slot * i + (slot - bw) / 2;
    let y = BASE;
    for (const g of stack) {
      const v = Math.max(g.vals[i], 0);
      if (v < 0.5) continue;
      const h = v * k;
      s += `<rect x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h - 2, 0.5).toFixed(1)}" fill="${g.color}"><title>${m} 月 · ${esc(g.name)} ${n0(v)}</title></rect>`;
      segs.push({ g, i, m, x, mid: y - h / 2 - 1, v });
      y -= h;
    }
    s += `<text class="t" x="${(x + bw / 2).toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle">${n0(tot[i])}</text>`;
    s += `<text x="${(x + bw / 2).toFixed(1)}" y="310" text-anchor="middle">${m} 月</text>`;
  });
  s += `<line x1="${X0}" y1="${BASE}" x2="${W}" y2="${BASE}" stroke="#141414" stroke-width="2"></line>`;

  // 标注：某月某段明显高于该段的中位数（≥ 2 倍，且超出量够大），最多两处
  if (ms.length >= 3) {
    const meds = new Map(stack.map(g => [g, median(g.vals)]));
    const hits = segs.map(p => ({ ...p, ex: p.v - meds.get(p.g) }))
      .filter(p => p.v >= 2 * meds.get(p.g) && p.ex >= max * 0.1)
      .sort((a, b) => b.ex - a.ex).slice(0, 2);
    for (const p of hits) {
      let name = p.g.name, v = p.v;
      if (p.g.l1) { // 超出部分主要来自某个二级分类时，标这个二级分类
        const kids = cats.filter(c => c.l1 === p.g.l1).map(c => { const vs = ms.map(m => val(c.id, m)); return { c, v: vs[p.i], ex: vs[p.i] - median(vs) }; });
        const best = kids.sort((a, b) => b.ex - a.ex)[0];
        if (best && best.ex >= p.ex * 0.6) { name = best.c.name; v = best.v; }
      }
      const right = p.i < ms.length - 1, edge = right ? p.x + bw + 3 : p.x - 3, dir = right ? 1 : -1;
      const tx = edge + dir * 13, an = right ? 'start' : 'end';
      s += `<line x1="${edge.toFixed(1)}" y1="${p.mid.toFixed(1)}" x2="${(edge + dir * 9).toFixed(1)}" y2="${p.mid.toFixed(1)}" stroke="#141414"></line>`
        + `<text class="k halo" x="${tx.toFixed(1)}" y="${(p.mid + 1).toFixed(1)}" text-anchor="${an}">${esc(name)}</text>`
        + `<text class="halo" x="${tx.toFixed(1)}" y="${(p.mid + 17).toFixed(1)}" text-anchor="${an}">${n0(v)}</text>`;
    }
  }
  const sw = (c, hatch) => `<i style="display:inline-block;width:12px;height:12px;background:${hatch ? 'repeating-linear-gradient(45deg,#6E6A62 0 2px,#B9B5AC 2px 6px)' : c}"></i>`;
  const legend = [...stack].reverse().map(g => `<span style="display:inline-flex;align-items:center;gap:6px">${sw(g.color, g === deduct)}${esc(g.name)} <span class="mono mut">${n0(g.vals.reduce((a, b) => a + b, 0))}</span></span>`).join('');
  const period = ms.length === 1 ? '1 月' : `1–${ms[ms.length - 1]} 月`;
  return `<div style="border-top:5px solid #141414;padding-top:14px"><div class="sec s3" style="border-top:0;padding-top:0"><b>每月支出构成</b><span class="mono mut" style="font-size:12px">按一级分类 · 元 · 悬停查看各段</span></div>
<div style="display:flex;flex-wrap:wrap;gap:6px 22px;font-size:13px;padding:12px 0 4px">${legend}</div>
<div class="scroll"><div style="min-width:900px"><svg class="chart" viewBox="0 0 ${W} 330" width="100%" role="img" aria-label="${esc(d.year)} 年 ${period}每月支出构成分段柱状图，按一级分类堆叠" style="display:block;height:auto"><defs><pattern id="hd" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#B9B5AC"></rect><line x1="0" y1="0" x2="0" y2="6" stroke="#6E6A62" stroke-width="2"></line></pattern></defs>${s}</svg></div></div></div>
<div style="border-top:2px solid #141414;margin-top:18px"></div>`;
}

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
${(ms.length && isChart(d)) || '<div style="border-top:5px solid #141414"></div>'}
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

// 桑基图：来源（收入一级分类）→ 收入 → 工资减扣 / 消费支出 / 结余 → 消费明细 / 投资净投入 / 未投资结余
function cfSankey(d, period) {
  const f = d.flow, inv = d.total.inv;
  const saving = f.income - f.deduct - f.consume;
  const pos = v => v > 0.5;
  const src = Object.entries(f.income_l1).filter(([, v]) => pos(v)).sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, v }));
  if (saving < -0.5) src.push({ name: '动用存量', v: -saving }); // 花的比挣的多
  const T = src.reduce((a, s) => a + s.v, 0);
  if (!pos(T)) return '';

  const H = 400, TOP = 30, BOT = 395, k = 300 / T;
  const X = [170, 520, 870, 1150], NW = 10;
  const GREY = ['#A8A39A', '.38'], BLUE = ['#24399A', '.42'], PALE = ['#24399A', '.22'];
  // 列内纵向居中排布；gaps[i] 是第 i 个节点上方的间距
  const place = (nodes, gaps) => {
    const total = nodes.reduce((a, n, i) => a + n.v * k + (i ? gaps[i] : 0), 0);
    let y = TOP + (BOT - TOP - total) / 2;
    nodes.forEach((n, i) => { if (i) y += gaps[i]; n.y = y; n.h = n.v * k; n.out = y; n.in = y; y += n.h; });
  };
  const mid = { name: src.some(s => s.name === '动用存量') ? '支出来源' : '收入', v: T };
  const c3 = [
    pos(f.deduct) && { name: '工资减扣', v: f.deduct },
    pos(f.consume) && { name: '消费支出', v: f.consume, kids: true },
    pos(saving) && { name: '结余', v: saving, blue: true },
  ].filter(Boolean);
  const totals = f.consume_l1;
  const top = spendGroups(totals);
  const c4 = top.map(name => ({ name, v: totals[name], from: '消费支出' }));
  const rest = f.consume - c4.reduce((a, n) => a + n.v, 0);
  if (pos(rest)) c4.push({ name: OTHER, v: rest, from: '消费支出' });
  if (pos(saving)) {
    const put = Math.min(Math.max(inv, 0), saving);
    if (pos(put)) c4.push({ name: '投资净投入', v: put, label: inv, from: '结余', blue: true, c: BLUE });
    if (pos(saving - put)) c4.push({ name: '未投资结余', v: saving - put, from: '结余', blue: true, c: PALE });
  }
  place(src, src.map(() => 18));
  place([mid], [0]);
  place(c3, c3.map(() => 22));
  place(c4, c4.map((n, i) => (i && c4[i - 1].from !== n.from ? 22 : 8)));

  const link = (a, b, v, [col, op], tip) => {
    const h = v * k, x0 = a.x + NW, x1 = b.x, mx = (x0 + x1) / 2;
    const y0 = a.out, y1 = b.in; a.out += h; b.in += h;
    return `<path d="M${x0},${y0.toFixed(1)} C${mx},${y0.toFixed(1)} ${mx},${y1.toFixed(1)} ${x1},${y1.toFixed(1)} L${x1},${(y1 + h).toFixed(1)} C${mx},${(y1 + h).toFixed(1)} ${mx},${(y0 + h).toFixed(1)} ${x0},${(y0 + h).toFixed(1)} Z" fill="${col}" fill-opacity="${op}"><title>${esc(tip)} ${n0(v)}</title></path>`;
  };
  src.forEach(n => (n.x = X[0])); mid.x = X[1]; c3.forEach(n => (n.x = X[2])); c4.forEach(n => (n.x = X[3]));
  let s = '';
  for (const n of src) s += link(n, mid, n.v, GREY, `${n.name} → ${mid.name}`);
  for (const n of c3) s += link(mid, n, n.v, n.blue ? BLUE : GREY, `${mid.name} → ${n.name}`);
  for (const n of c4) { const p = c3.find(x => x.name === n.from); s += link(p, n, n.v, n.c || GREY, `${n.from} → ${n.name}`); }
  const rect = n => `<rect x="${n.x}" y="${n.y.toFixed(1)}" width="${NW}" height="${Math.max(n.h, 1).toFixed(1)}" fill="${n.blue ? '#24399A' : '#141414'}"><title>${esc(n.name)} ${n0(n.label ?? n.v)}</title></rect>`;
  s += [...src, mid, ...c3, ...c4].map(rect).join('');
  // 标签：名称一行、金额一行；小节点的标签往下推，避免重叠
  const spread = (ys, gap) => { for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gap); return ys; };
  const two = (x, y, anchor, name, val) => `<text class="k halo" x="${x}" y="${(y - 2).toFixed(1)}" text-anchor="${anchor}">${esc(name)}</text><text class="halo" x="${x}" y="${(y + 14).toFixed(1)}" text-anchor="${anchor}">${val}</text>`;
  spread(src.map(n => n.y + n.h / 2), 34).forEach((y, i) => (s += two(160, y, 'end', src[i].name, n0(src[i].v))));
  s += `<text class="k" x="${mid.x + NW / 2}" y="${mid.y - 24}" text-anchor="middle">${mid.name}</text><text x="${mid.x + NW / 2}" y="${mid.y - 9}" text-anchor="middle">${n0(T)}</text>`;
  const share = v => (pos(f.income) ? ` · ${(v / f.income * 100).toFixed(1)}%` : '');
  spread(c3.map(n => n.y + n.h / 2), 34).forEach((y, i) => (s += two(888, y, 'start', c3[i].name, n0(c3[i].v) + share(c3[i].v))));
  spread(c4.map(n => n.y + n.h / 2 + 4.5), 16).forEach((y, i) => (s += `<text class="k" x="1168" y="${y.toFixed(1)}">${esc(c4[i].name)}<tspan dx="8">${n0(c4[i].label ?? c4[i].v)}</tspan></text>`));
  s += `<text x="170" y="14" text-anchor="end" letter-spacing="1">来源</text><text x="880" y="14" letter-spacing="1">去向</text>${c4.length ? '<text x="1160" y="14" letter-spacing="1">明细</text>' : ''}`;
  s += `<line x1="0" y1="${H - 0.5}" x2="1344" y2="${H - 0.5}" stroke="#141414"></line>`;
  const aria = `${period}收入去向桑基图：收入 ${n0(f.income)}，其中工资减扣 ${n0(f.deduct)}，消费支出 ${n0(f.consume)}，结余 ${n0(saving)}${inv > 0 ? `；投资净投入 ${n0(inv)}` : ''}`;
  return `<div style="border-top:5px solid #141414;padding-top:14px"><div class="sec s3" style="border-top:0;padding-top:0"><b>${period} · 钱去了哪里</b><span class="mono mut" style="font-size:12px">元 · 色带宽度 = 金额</span></div>
<div class="scroll" style="margin-top:10px"><div style="min-width:980px"><svg class="chart" viewBox="0 0 1344 ${H}" width="100%" role="img" aria-label="${esc(aria)}" style="display:block;height:auto;overflow:visible">${s}</svg></div></div></div>`;
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
<span class="mut" style="font-size:12px">悬停色带查看金额</span></div>
${ms.length ? `${cfSankey(d, ms.length === 1 ? '1 月' : `1–${ms[ms.length - 1]} 月`) || '<div style="border-top:5px solid #141414"></div>'}
<div class="scroll" style="margin-top:22px"><div style="min-width:${300 + ms.length * 84}px">
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
