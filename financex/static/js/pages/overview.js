import { get, header, mainStrip, wan, fmt, cls, monthLabel, monthAdd, mShort, cnMonth, dDot, CUR_NAME, GROUP_COLOR, esc } from '../util.js';

const ORDER = ['CNY', 'HKD', 'USD', 'CRYPTO'];

export async function render(root) {
  const d = await get('/api/overview');
  root.innerHTML = `<div class="pg">${mainStrip()}<div class="wrap">${header('overview')}
${d.empty ? empty(d) : body(d)}</div></div>`;
}

function empty(d) {
  return `<main class="cols" style="padding-top:28px">
<article class="main" style="gap:14px"><span class="kick">净资产</span>
<h1 class="h1" style="font-size:56px;line-height:1.08">还没有盘点过</h1>
<p class="dek">净资产只来自盘点。先在盘点面板里新增手填账户（银行卡、余额宝、公积金、外币账户……）并填上余额；
投资标的在 <a href="#/instrument">持仓 · 新增标的</a> 里录入期初持仓，盘点时会自动估值。完成后这里会出现净资产与走势。</p>
<p class="dek">也可以先 <a href="#/import">导入账单</a>，在账单页整理收支。</p></article>
<aside class="side" style="gap:6px"><div class="sec"><b>盘点</b></div>
<p style="margin:8px 0 0;font-size:15px;line-height:1.6">默认盘点 <b>${monthLabel(d.default_month)}</b>，也可以选择更早的月份补录。</p>
<a href="#/stocktake" class="btn pri" style="margin-top:14px;height:52px;font-size:15px">盘点</a></aside></main>`;
}

function body(d) {
  const delta = d.prev ? d.net - d.prev.net : null;
  const pct = d.prev && d.prev.net ? delta / Math.abs(d.prev.net) : null;
  const ytd = d.base ? d.net - d.base.net : null;
  const ytdPct = d.base && d.base.net ? ytd / Math.abs(d.base.net) : null;
  const mname = cnMonth(d.month);
  const head = delta === null ? `净资产 ${wan(d.net)} 万元`
    : `净资产 ${wan(d.net)} 万元，<br>${mname}${delta >= 0 ? '再添' : '减少'} ${wan(Math.abs(delta))} 万`;
  const arrow = v => (v >= 0 ? '▲' : '▼');
  const next = monthAdd(d.month, 1);
  return `<main class="cols" style="gap:44px;padding-top:28px">
<article class="main" style="gap:14px">
<span class="kick">净资产 · ${monthLabel(d.month)}快照</span>
<h1 class="h1" style="font-size:66px;line-height:1.06">${head}</h1>
<div style="display:flex;flex-wrap:wrap;gap:6px 32px;align-items:baseline;font-size:13px;border-top:5px solid #141414;padding-top:12px">
${delta === null ? '<span class="mut">上个月没有快照，无法对比</span>' : `<span><span class="mut">较上月</span> <span class="${cls(delta)}" style="font-size:16px;font-weight:700">${arrow(delta)} ${wan(Math.abs(delta))} 万</span> <span class="mono ${cls(delta)}" style="font-size:12px">${pct === null ? '' : (pct >= 0 ? '+' : '−') + Math.abs(pct * 100).toFixed(2) + '%'}</span></span>`}
${ytd === null ? '' : `<span><span class="mut">今年以来</span> <span class="${cls(ytd)}" style="font-size:16px;font-weight:700">${arrow(ytd)} ${wan(Math.abs(ytd))} 万</span> <span class="mono ${cls(ytd)}" style="font-size:12px">${ytdPct === null ? '' : (ytdPct >= 0 ? '+' : '−') + Math.abs(ytdPct * 100).toFixed(2) + '%'}</span> <span class="mut" style="font-size:12px">较 ${d.base.month.replace('-', '.')} 快照</span></span>`}
</div>
<div class="sec" style="margin-top:22px"><b>净资产走势</b><span class="mono mut" style="font-size:12px">按币种堆叠 · 万元 · 缺月留空、不插值</span></div>
${chart(d.series)}
<div class="sec s3" style="margin-top:18px"><b>最近 12 个月</b><span class="mono mut" style="font-size:12px">月末净资产 · 万元 · 较上月</span></div>
${last12(d.series)}
</article>
<aside class="side" style="gap:6px">
<div class="sec"><b>上次盘点</b><span class="mono" style="font-size:12px">${dDot(d.date)}</span></div>
<p style="margin:8px 0 0;font-size:15px;line-height:1.6">盘点了 <b>${mShort(d.month)}</b>：${d.accounts} 个手填账户、${d.positions} 只持仓标的。下一次在 ${+monthAdd(next, 1).slice(5)} 月初盘点 ${+next.slice(5)} 月。</p>
<a href="#/stocktake" class="btn pri" style="margin-top:14px;height:52px;font-size:15px;align-self:stretch">盘点</a>
<span class="mut" style="font-size:12px;margin-top:6px">也可在盘点面板里选历史月份补录。</span>
<div class="sec s3" style="margin-top:30px"><b>按币种 · ${mShort(d.month)}</b><span class="mono mut" style="font-size:12px">万元 · 较上月</span></div>
${ORDER.map(g => {
    const v = d.groups[g] || 0, p = d.prev ? (d.prev.groups[g] || 0) : null;
    return `<div class="cur"><i style="background:${GROUP_COLOR[g]}"></i><span>${CUR_NAME[g]}</span><span class="num" style="font-size:22px;line-height:1">${wan(v)}</span><span class="mono ${p === null ? 'mut' : cls(v - p)}" style="text-align:right;font-size:12px">${p === null ? '—' : (v - p >= 0 ? '+' : '−') + wan(Math.abs(v - p))}</span></div>`;
  }).join('')}
<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;padding:12px 0;border-bottom:2px solid #141414;font-weight:700"><span>合计</span><span class="num" style="font-size:22px">${wan(d.net)}</span></div>
<span class="mut" style="font-size:12px;margin-top:6px">外币按 ${d.date.slice(5).replace('-', '.')} 即期汇率折算；USDT 按 1:1 美元。</span>
</aside></main>`;
}

function niceMax(v) {
  if (v <= 0) return 10000;
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10];
  const mag = 10 ** Math.floor(Math.log10(v / 4));
  for (const s of steps) if (s * mag * 4 >= v) return s * mag * 4;
  return 40 * mag;
}

function chart(series) {
  const n = series.length;
  const max = niceMax(Math.max(...series.map(s => s.net || 0)) * 1.02);
  const W = 1000, H = 300;
  const x = i => (n === 1 ? W / 2 : (i * W) / (n - 1));
  const y = v => H - (Math.max(v, 0) / max) * H;
  let svg = '';
  for (let k = 1; k < 4; k++) svg += `<line x1="0" y1="${H * k / 4}" x2="${W}" y2="${H * k / 4}" stroke="#8A877F" stroke-width="1" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"></line>`;
  // 按连续有数据的月份分段
  const segs = [];
  let cur = [];
  series.forEach((s, i) => { if (s.groups) cur.push(i); else { if (cur.length) segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  const gaps = [];
  series.forEach((s, i) => { if (!s.groups) gaps.push(i); });
  for (const seg of segs) {
    const pts = seg.length === 1 ? [{ i: seg[0], dx: -6 }, { i: seg[0], dx: 6 }] : seg.map(i => ({ i, dx: 0 }));
    let lower = pts.map(() => 0);
    for (const g of ORDER) {
      const upper = pts.map((p, k) => lower[k] + Math.max(series[p.i].groups[g] || 0, 0));
      const top = pts.map((p, k) => `${(x(p.i) + p.dx).toFixed(1)},${y(upper[k]).toFixed(1)}`);
      const bot = pts.map((p, k) => `${(x(p.i) + p.dx).toFixed(1)},${y(lower[k]).toFixed(1)}`).reverse();
      svg += `<polygon points="${[...top, ...bot].join(' ')}" fill="${GROUP_COLOR[g]}"></polygon>`;
      lower = upper;
    }
    svg += `<polyline points="${pts.map((p, k) => `${(x(p.i) + p.dx).toFixed(1)},${y(lower[k]).toFixed(1)}`).join(' ')}" fill="none" stroke="#141414" stroke-width="1.5" vector-effect="non-scaling-stroke"></polyline>`;
  }
  svg += `<line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="#141414" stroke-width="2" vector-effect="non-scaling-stroke"></line>`;
  const yl = [1, 2, 3, 4].map(k => `<span class="mut mono" style="position:absolute;right:0;top:calc(${100 - k * 25}% - 9px);font-size:12px">${fmt(max * k / 4 / 10000, max >= 400000 ? 0 : 1)} 万</span>`).join('');
  // 缺月标签：每段连续缺月标一次
  const gapGroups = [];
  gaps.forEach(i => { const last = gapGroups[gapGroups.length - 1]; if (last && last[last.length - 1] === i - 1) last.push(i); else gapGroups.push([i]); });
  const gl = gapGroups.slice(0, 6).map(g => {
    const mid = (g[0] + g[g.length - 1]) / 2;
    const lbl = g.length === 1 ? `${series[g[0]].month.slice(2).replace('-', '.')} 未盘点` : `${series[g[0]].month.slice(2).replace('-', '.')}–${series[g[g.length - 1]].month.slice(2).replace('-', '.')} 未盘点`;
    return `<span style="position:absolute;left:calc((100% - 56px) * ${(n === 1 ? 0.5 : mid / (n - 1)).toFixed(4)});top:46%;transform:translateX(-50%);font-size:12px;background:#E9E7E1;padding:2px 4px;border:1px dashed #141414;white-space:nowrap">${lbl}</span>`;
  }).join('');
  // 横轴：首、尾和每年 1 月、7 月
  const xl = [];
  series.forEach((s, i) => {
    const mm = s.month.slice(5);
    if (i === 0 || i === n - 1 || ((mm === '01' || mm === '07') && i > 1 && i < n - 2)) {
      const left = n === 1 ? 50 : (i / (n - 1)) * 100;
      const tr = i === 0 ? '0' : i === n - 1 ? '-100%' : '-50%';
      xl.push(`<span style="position:absolute;left:${left.toFixed(2)}%;transform:translateX(${tr});font-size:12px" class="mono mut">${s.month.replace('-', '.')}</span>`);
    }
  });
  return `<div style="position:relative;height:300px;margin-top:8px">
<svg width="100%" height="300" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(series[0].month)} 至 ${esc(series[n - 1].month)} 净资产走势，按币种堆叠" style="width:calc(100% - 56px);display:block">${svg}</svg>
${yl}${gl}</div>
<div style="position:relative;height:22px;margin-right:56px">${xl.join('')}</div>`;
}

function last12(series) {
  const tail = series.slice(-12);
  const cells = tail.map((s, k) => {
    const idx = series.length - tail.length + k;
    const prev = idx > 0 ? series[idx - 1] : null;
    const d = s.net !== null && prev && prev.net !== null ? s.net - prev.net : null;
    const last = k === tail.length - 1;
    return `<div><span class="mono mut" style="font-size:12px">${s.month.slice(2).replace('-', '.')}</span>
<span class="num" style="font-size:${last ? 18 : 16}px">${s.net === null ? '<span class="mut">—</span>' : wan(s.net)}</span>
<span class="mono ${d === null ? 'mut' : cls(d)}" style="font-size:12px">${d === null ? (s.net === null ? '未盘点' : '—') : (d >= 0 ? '+' : '−') + wan(Math.abs(d))}</span></div>`;
  }).join('');
  return `<div class="scroll"><div class="mgrid" style="grid-template-columns:repeat(${tail.length},minmax(68px,1fr));min-width:${tail.length * 68}px">${cells}</div></div>`;
}
