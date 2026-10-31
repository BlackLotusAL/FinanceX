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
  const ytd = d.base ? d.net - d.base.net : null;
  const ytdPct = d.base && d.base.net ? ytd / Math.abs(d.base.net) : null;
  const mname = cnMonth(d.month);
  const head = delta === null ? `净资产 ${wan(d.net)} 万元`
    : `净资产 ${wan(d.net)} 万元，<br>${mname}${delta >= 0 ? '再添' : '减少'} ${wan(Math.abs(delta))} 万`;
  const arrow = v => (v >= 0 ? '▲' : '▼');
  const next = monthAdd(d.month, 1);
  // 缺月提示：标出最早的几个未盘点月份
  const gaps = d.series.filter(s => !s.groups).map(s => s.month.slice(2).replace('-', '.'));
  const gapHint = gaps.length ? `${gaps.slice(0, 3).join('、')}${gaps.length > 3 ? ` 等 ${gaps.length} 个月` : ''} 未盘点，可在盘点里补录。` : '';
  return `<main class="cols" style="gap:44px;padding-top:28px">
<article class="main" style="gap:14px">
<span class="kick">${monthLabel(d.month)}快照</span>
<h1 class="h1" style="font-size:66px;line-height:1.06">${head}</h1>
<div style="display:flex;flex-wrap:wrap;gap:6px 32px;align-items:baseline;font-size:13px;border-top:5px solid #141414;padding-top:12px">
${delta === null ? '<span class="mut">上个月没有快照，无法对比</span>' : ''}
${ytd === null ? '' : `<span><span class="mut">今年以来</span> <span class="${cls(ytd)}" style="font-size:16px;font-weight:700">${arrow(ytd)} ${wan(Math.abs(ytd))} 万</span> <span class="mono ${cls(ytd)}" style="font-size:12px">${ytdPct === null ? '' : (ytdPct >= 0 ? '+' : '−') + Math.abs(ytdPct * 100).toFixed(2) + '%'}</span> <span class="mut" style="font-size:12px">较 ${d.base.month.replace('-', '.')} 快照</span></span>`}
</div>
<div class="sec" style="margin-top:22px"><b>净资产走势</b><span class="mono mut" style="font-size:12px">按币种堆叠 · 万元</span></div>
${chart(d.series)}
<div class="sec s3" style="margin-top:18px"><b>最近 12 个月</b><span class="mono mut" style="font-size:12px">月末净资产 · 万元 · 较上月</span></div>
${last12(d.series)}
</article>
<aside class="side" style="gap:6px">
<div class="sec"><b>上次盘点</b><span class="mono" style="font-size:12px">${dDot(d.date)}</span></div>
<p style="margin:8px 0 0;font-size:15px;line-height:1.6">已盘点 <b>${mShort(d.month)}</b>。下次：${+monthAdd(next, 1).slice(5)} 月初盘点 ${+next.slice(5)} 月。</p>
<a href="#/stocktake" class="btn pri" style="margin-top:14px;height:52px;font-size:15px;align-self:stretch">盘点</a>
${gapHint ? `<span class="mut" style="font-size:12px;margin-top:6px">${gapHint}</span>` : ''}
<div class="sec s3" style="margin-top:30px"><b>按币种 · ${mShort(d.month)}</b><span class="mono mut" style="font-size:12px">万元 · 较上月</span></div>
${ORDER.map(g => {
    const v = d.groups[g] || 0, p = d.prev ? (d.prev.groups[g] || 0) : null;
    return `<div class="cur"><i style="background:${GROUP_COLOR[g]}"></i><span>${CUR_NAME[g]}</span><span class="num" style="font-size:22px;line-height:1">${wan(v)}</span><span class="mono ${p === null ? 'mut' : cls(v - p)}" style="text-align:right;font-size:12px">${p === null ? '—' : (v - p >= 0 ? '+' : '−') + wan(Math.abs(v - p))}</span></div>`;
  }).join('')}
<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;padding:12px 0;border-bottom:2px solid #141414;font-weight:700"><span>合计</span><span class="num" style="font-size:22px">${wan(d.net)}</span></div>
<span class="mut" style="font-size:12px;margin-top:6px">外币按 ${d.date.slice(5).replace('-', '.')} 即期汇率折算；USDT 按 1:1 美元。</span>
</aside></main>`;
}

const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10];

function niceStep(v) {
  if (v <= 0) return 2500;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const s of STEPS) if (s * mag >= v) return s * mag;
  return 10 * mag;
}

// 纵轴范围：正值（资产）向上堆叠，负值（负债超过资产的币种）向下堆叠
function scale(series) {
  let hi = 0, lo = 0;
  for (const s of series) {
    if (!s.groups) continue;
    let pos = 0, neg = 0;
    for (const g of ORDER) { const v = s.groups[g] || 0; if (v > 0) pos += v; else neg += v; }
    hi = Math.max(hi, pos * 1.02); lo = Math.min(lo, neg * 1.02);
  }
  const step = niceStep((hi - lo) / 4);
  const top = Math.max(step, Math.ceil(hi / step - 1e-9) * step);
  const bottom = lo < 0 ? -Math.ceil(-lo / step - 1e-9) * step : 0;
  return { top, bottom, step };
}

function chart(series) {
  const n = series.length;
  const { top, bottom, step } = scale(series);
  const W = 1000, H = 300;
  const x = i => (n === 1 ? W / 2 : (i * W) / (n - 1));
  const y = v => H - ((v - bottom) / (top - bottom)) * H;
  const ticks = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  let svg = '';
  for (const v of ticks) {
    if (v === bottom || v === top) continue;
    svg += v === 0
      ? `<line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" stroke="#141414" stroke-width="1" vector-effect="non-scaling-stroke"></line>`
      : `<line x1="0" y1="${y(v).toFixed(1)}" x2="${W}" y2="${y(v).toFixed(1)}" stroke="#8A877F" stroke-width="1" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"></line>`;
  }
  // 按连续有数据的月份分段
  const segs = [];
  let cur = [];
  series.forEach((s, i) => { if (s.groups) cur.push(i); else { if (cur.length) segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  const gaps = [];
  series.forEach((s, i) => { if (!s.groups) gaps.push(i); });
  for (const seg of segs) {
    const pts = seg.length === 1 ? [{ i: seg[0], dx: -6 }, { i: seg[0], dx: 6 }] : seg.map(i => ({ i, dx: 0 }));
    const px = p => (x(p.i) + p.dx).toFixed(1);
    let upPos = pts.map(() => 0), upNeg = pts.map(() => 0);
    for (const g of ORDER) {
      const vals = pts.map(p => series[p.i].groups[g] || 0);
      for (const sign of [1, -1]) {
        const base = sign > 0 ? upPos : upNeg;
        const next = base.map((b, k) => b + ((sign > 0 ? vals[k] > 0 : vals[k] < 0) ? vals[k] : 0));
        if (next.some((v, k) => v !== base[k])) {
          const t = pts.map((p, k) => `${px(p)},${y(next[k]).toFixed(1)}`);
          const bt = pts.map((p, k) => `${px(p)},${y(base[k]).toFixed(1)}`).reverse();
          svg += `<polygon points="${[...t, ...bt].join(' ')}" fill="${GROUP_COLOR[g]}"${sign < 0 ? ' fill-opacity="0.55"' : ''}></polygon>`;
        }
        if (sign > 0) upPos = next; else upNeg = next;
      }
    }
    // 粗线是净资产 = 资产堆叠 + 负值堆叠
    svg += `<polyline points="${pts.map((p, k) => `${px(p)},${y(upPos[k] + upNeg[k]).toFixed(1)}`).join(' ')}" fill="none" stroke="#141414" stroke-width="1.5" vector-effect="non-scaling-stroke"></polyline>`;
  }
  svg += `<line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="#141414" stroke-width="2" vector-effect="non-scaling-stroke"></line>`;
  const big = Math.max(top, -bottom) >= 400000;
  const yl = ticks.filter(v => v !== bottom || bottom < 0).map(v => `<span class="mut mono" style="position:absolute;right:0;top:calc(${(100 * (top - v) / (top - bottom)).toFixed(2)}% - 9px);font-size:12px">${v < 0 ? '−' : ''}${fmt(Math.abs(v) / 10000, big ? 0 : 1)} 万</span>`).join('');
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
