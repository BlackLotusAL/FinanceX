import { get, put, header, mainStrip, esc, fmt, sgn, qty, dDot, mShort, CAT_NAME, CUR_SYM, toast, fail, confirmBox } from '../util.js';

let S = { open: new Set() };

export async function render(root) {
  S.root = root;
  S.data = await get('/api/holdings');
  draw();
}

const FX_NAME = { HKD: '港币', USD: '美元' };

function costText(it) {
  const sym = it.book === 'CNY' ? '¥' : CUR_SYM[it.currency];
  const dp = it.avg !== 0 && Math.abs(it.avg) < 10 ? 4 : 2;
  return `${sym}${fmt(it.avg, dp)}`;
}
function realizedText(it) {
  if (!it.has_sell) return '<span class="mut">—</span>';
  const pre = it.book === 'CNY' ? '' : `${CUR_SYM[it.currency].trim()} `;
  return `<span class="${it.realized >= 0 ? 'up' : 'dn'}">${pre}${sgn(it.realized)}</span>`;
}

function draw() {
  const d = S.data;
  // 仍按手填余额记的基金类账户，提示可转为标的
  const fundAcc = d.manual_accounts.find(a => /基金/.test(a.name));
  const items = d.accounts.flatMap(a => a.items);
  S.root.innerHTML = `<div class="pg">${mainStrip()}<div class="wrap">${header('holdings')}
<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;padding:20px 0 14px">
<div style="display:flex;flex-direction:column;gap:8px"><span class="kick">${items.filter(i => !i.disabled).length} 只标的</span>
<h1 class="h1" style="font-size:44px;line-height:1.1">今年已实现盈亏 ${sgn(d.realized_year, 0)}</h1>
<p class="dek">人民币标的累计 <b>${sgn(d.realized_all, 0)}</b>，每笔卖出已自动记入账单。市值与浮动盈亏见 <a href="#/bs">资产负债表</a>。</p></div>
<div style="display:flex;flex-wrap:wrap;gap:22px;align-items:center"><a class="lk" href="#/instrument">+ 新增标的</a><a class="lk" href="#/fx">购汇 / 结汇</a><a class="btn pri" href="#/trade">+ 录入交易</a></div></div>
<div style="border-top:5px solid #141414"></div>
<div class="cols" style="gap:36px;padding-top:4px">
<section class="main">${items.length ? table(d) : `<div class="empty">还没有标的。点 <a href="#/instrument">+ 新增标的</a> 录入股票、ETF、基金或加密货币，并填写启用前已有的期初持仓。</div>`}
<span class="mut" style="font-size:12px;margin-top:10px">平均成本按移动加权；外币标的的已实现盈亏按原币记录，不进利润表。港股通按人民币标的记账。</span></section>
<aside class="side" style="gap:24px;padding-top:16px">
<div class="panel"><div class="sec s3"><b>外币 · 购汇余额与成本</b><a class="lk" href="#/fx" style="font-size:12px;min-height:0">购汇 / 结汇 →</a></div>
<div class="fxr mono mut" style="font-size:12px;border-bottom:2px solid #141414"><span>币种</span><span>购汇余额</span><span>平均购汇成本</span></div>
${d.fx.length ? d.fx.map(f => `<div class="fxr"><span><b>${FX_NAME[f.currency] || f.currency}</b> ${f.currency}</span><span class="mono">${fmt(f.bal)}</span><span class="mono">${fmt(f.avg, 4)}</span></div>`).join('') : '<div class="fxr"><span class="mut">还没有购汇记录</span><span></span><span></span></div>'}
<p style="margin:10px 0 0;font-size:12.5px;line-height:1.6" class="mut">购汇余额只由购汇、结汇推算，不等于实际外币余额。${d.actual_month ? `${mShort(d.actual_month)}盘点的实际余额：${['HKD', 'USD'].filter(c => d.actual_fx[c] !== undefined).map(c => `${c} ${fmt(d.actual_fx[c])}`).join(' · ') || '无外币账户'}。` : ''}</p></div>
<div class="panel"><div class="sec s3"><b>手填账户转为标的</b></div>
<p style="margin:8px 0 0;font-size:13px;line-height:1.6">${d.manual_accounts.length ? (fundAcc ? `「${esc(fundAcc.name)}」仍是手填账户，转为标的后盘点可自动估值。` : '手填账户转为标的后，盘点可自动估值。') : '目前没有手填账户。'}</p>
${d.manual_accounts.length ? '<a class="lk" href="#/instrument?tab=convert" style="align-self:flex-start">转为标的 →</a>' : ''}</div>
<div style="border-top:2px solid #141414"></div></aside></div></div></div>`;
  bind();
}

function table(d) {
  let h = `<div class="scroll"><div style="min-width:640px">
<div class="hr mono" style="font-size:12px;color:#4A4740;border-bottom:0;padding-top:14px"><span>标的</span><span>持仓数量</span><span>平均成本</span><span>已实现盈亏</span><span style="text-align:right">交易记录</span></div>`;
  for (const a of d.accounts) {
    const kinds = [...new Set(a.items.map(i => i.connect ? '港股通' : CAT_NAME[i.category]))].join(' · ');
    h += `<div class="hg"><b>${esc(a.name)}</b><span class="mut" style="font-size:12px">${esc(a.note || kinds)}</span></div>`;
    if (!a.items.length) h += '<div class="hr"><span class="mut">还没有标的</span><span></span><span></span><span></span><span></span></div>';
    for (const it of a.items) {
      const open = S.open.has(it.id);
      const cleared = it.qty <= 1e-9;
      h += `<div class="hr"${cleared || it.disabled ? ' style="color:#4A4740"' : ''}><span><b>${esc(it.name)}</b> <span class="mono mut" style="font-size:12px">${esc(it.code)} · ${CAT_NAME[it.category]}${it.disabled ? ' · 已停用' : ''}</span></span>
<span>${cleared ? (it.trades.length ? '已清仓' : '0') : qty(it.qty)}</span><span>${it.trades.length ? costText(it) : '—'}</span><span>${realizedText(it)}</span>
<span><button type="button" class="lk" data-open="${it.id}" aria-expanded="${open}" style="font-weight:500">${open ? '▾' : '▸'} ${it.trades.length} 笔</button></span></div>`;
      if (open) h += detail(it);
    }
  }
  return h + '</div></div>';
}

function detail(it) {
  const sym = it.book === 'CNY' ? '¥' : CUR_SYM[it.currency];
  const rows = it.trades.map(t => `<div class="tt"><span class="mono">${dDot(t.date)}</span><span>${t.kind === 'buy' ? (t.opening ? '期初买入' : '买入') : '卖出'}</span><span>${qty(t.qty)}</span><span>${sym}${fmt(t.amount)}</span><span>${fmt(t.avg_after, 4)}</span>
<span>${t.realized === null || t.realized === undefined ? '<span class="mut">—</span>' : `<span class="${t.realized >= 0 ? 'up' : 'dn'}">${sgn(t.realized)}</span>`}</span><span><a class="lk" href="#/trade?id=${t.id}" style="font-size:12px;min-height:0">编辑</a></span></div>`).join('');
  return `<div class="tdet">
<div class="tt mono mut" style="font-size:12px;border-bottom:1px solid #141414"><span>日期</span><span>类型</span><span>数量</span><span>总金额</span><span>移动加权成本</span><span>已实现</span><span></span></div>
${rows || '<div class="mut" style="padding:6px 0">还没有交易</div>'}
<div style="display:flex;gap:18px;padding-top:6px"><a class="lk" href="#/trade?inst=${it.id}" style="font-size:12px">+ 录一笔交易</a><a class="lk" href="#/instrument?id=${it.id}" style="font-size:12px">编辑标的</a>
<button type="button" class="lk" data-toggle="${it.id}" style="font-size:12px;color:#4A4740">${it.disabled ? '重新启用' : '停用'}</button></div></div>`;
}

function bind() {
  S.root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    const id = +b.dataset.open; S.open.has(id) ? S.open.delete(id) : S.open.add(id); draw();
  }));
  S.root.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    const id = +b.dataset.toggle;
    const it = S.data.accounts.flatMap(a => a.items).find(x => x.id === id);
    if (!it.disabled && !await confirmBox(`停用「${it.name}」`, '停用后保留历史交易与快照，不再出现在盘点里。可随时重新启用。', '停用')) return;
    try { await put(`/api/instruments/${id}`, { disabled: !it.disabled }); toast(it.disabled ? '已启用' : '已停用'); S.data = await get('/api/holdings'); draw(); } catch (e) { fail(e); }
  }));
}
