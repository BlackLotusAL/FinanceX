import { get, post, put, del, qs, backStrip, esc, fmt, sgn, qty, dDot, today, parseNum, CUR_SYM, toast, fail, go, confirmBox, once, busyAttr } from '../util.js';

let S = null;

export async function render(root) {
  const q = qs();
  const hold = await get('/api/holdings');
  const insts = hold.accounts.flatMap(a => a.items.map(i => ({ ...i, account_name: a.name })));
  let t = null;
  if (q.id) t = await get(`/api/trades/${q.id}`);
  if (t && t.kind.startsWith('fx')) { go(`#/fx?id=${t.id}`); return; }
  const inst = t ? t.instrument_id : q.inst ? +q.inst : (insts.find(i => !i.disabled)?.id ?? null);
  S = {
    root, insts, id: t?.id || null,
    f: {
      kind: t?.kind || q.kind || (q.inst && insts.find(i => i.id === +q.inst)?.qty > 0 ? 'buy' : 'buy'),
      instrument_id: inst, date: t?.date || today(),
      qty: t ? String(t.qty) : '', amount: t ? String(t.amount) : '', opening: !!t?.opening,
    },
    pv: null,
  };
  draw();
  preview();
}

const cur = () => S.insts.find(i => i.id === S.f.instrument_id);
const sym = it => (it ? (it.book === 'CNY' ? '¥' : CUR_SYM[it.currency]) : '¥');

function draw() {
  const f = S.f, it = cur(), sell = f.kind === 'sell';
  const pv = S.pv;
  const opts = S.insts.filter(i => !i.disabled || i.id === f.instrument_id)
    .map(i => `<option value="${i.id}"${i.id === f.instrument_id ? ' selected' : ''}>${esc(i.name)} ${esc(i.code)} · ${esc(i.account_name)}</option>`).join('');
  const s = sym(it);
  const unit = it?.category === 'fund' ? '份' : it?.category === 'crypto' ? '' : '股';
  // 按这笔交易日期时的持仓判断（补录、修改旧交易时与当前持仓不同）
  const heldThen = pv?.result?.qty_before ?? pv?.before?.qty;
  const over = sell && it && heldThen !== undefined && parseNum(f.qty) > heldThen + 1e-9;
  S.root.innerHTML = `<div class="pg">${backStrip('#/holdings', '持仓', '录入交易')}<div class="wrap">
<div class="lhd"><h1 class="h1">${S.id ? '修改' : '记'}一笔${f.opening ? '期初持仓' : sell ? '卖出' : '买入'}</h1>${S.id ? '<button type="button" class="lk" data-act="del" style="color:#B3261E">删除这笔交易</button>' : ''}</div>
${!S.insts.length ? '<div class="empty">还没有标的。先 <a href="#/instrument">新增标的</a>。</div>' : `
<div class="cols" style="gap:48px;padding-top:18px">
<section style="flex:999 1 560px;min-width:0;max-width:820px;display:flex;flex-direction:column;gap:22px">
<div class="ty" role="group" aria-label="交易类型"><button type="button" data-kind="buy" class="${!sell ? 'on' : ''}">买入</button><button type="button" data-kind="sell" class="${sell ? 'on' : ''}">卖出</button></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px">
<label class="fld">标的<select name="instrument_id">${opts}</select></label>
<label class="fld">日期<input type="date" name="date" value="${f.date}"></label>
<label class="fld">${sell ? '卖出' : '买入'}数量<input type="text" name="qty" inputmode="decimal" value="${esc(f.qty)}" style="text-align:right"><span class="h${over ? ' err' : ''}">${heldThen !== undefined ? `${pv?.result?.qty_before !== undefined ? '当时' : '当前'}持有 ${qty(heldThen)} ${unit}${over ? '，卖出数量超过持仓' : ''}` : ''}</span></label>
<label class="fld">${f.opening ? '总成本' : sell ? '实际到手金额' : '总金额'}（${s.trim()}）<input type="text" name="amount" inputmode="decimal" value="${esc(f.amount)}" style="text-align:right"><span class="h">${sell ? '已扣除手续费和税费' : f.opening ? (it?.category === 'crypto' ? '参照投资明细子表' : '参照券商 App') : '含手续费的总支出'}</span></label>
</div>
${result()}
<div style="border-top:1px solid #141414;padding-top:14px;display:flex;flex-direction:column;gap:10px">
${sell ? `<span style="font-size:13px;font-weight:700">切到「买入」时</span>
<span class="mut" style="font-size:13px;line-height:1.6">填数量与总金额（含手续费的总支出）。勾选「期初持仓」可录入启用前已有的持仓：填数量与总成本，股票、基金参照券商 App，加密货币参照投资明细子表；期初买入不计入投资净投入。</span>` :
    '<span class="mut" style="font-size:13px;line-height:1.6">启用前已有的持仓录为一笔期初买入：填数量与总成本（股票、基金参照券商 App，加密货币参照投资明细子表），不计入投资净投入。</span>'}
<label class="chk"${sell ? ' style="color:#4A4740"' : ''}><input type="checkbox" name="opening"${f.opening && !sell ? ' checked' : ''}${sell ? ' disabled' : ''}> 期初持仓${sell ? '（仅买入可用）' : ''}</label>
</div></section>
<aside class="side" style="gap:26px;padding-left:28px">${aside(it)}</aside></div>`}
</div>
${S.insts.length ? dock() : ''}</div>`;
  bind();
}

function result() {
  const pv = S.pv, f = S.f, it = cur();
  if (!pv || !pv.result || !it) return `<div style="border-top:2px solid #141414;padding-top:14px"><span class="mut" style="font-size:13px">填写数量和金额后，这里显示保存后的结果。</span></div>`;
  const r = pv.result, a = pv.after, b = pv.before;
  const cny = it.book === 'CNY';
  const md = `${+f.date.slice(5, 7)} 月 ${+f.date.slice(8)} 日`;
  if (f.kind === 'sell') {
    return `<div style="border-top:2px solid #141414;padding-top:14px;display:flex;flex-direction:column;gap:8px"><span class="mut" style="font-size:12px">保存后</span>
<h2 class="h1" style="font-size:24px;line-height:1.35">已实现盈亏 <span class="${r.realized >= 0 ? 'up' : 'dn'}">${sgn(r.realized)}</span>${cny ? '，自动生成一笔「投资收益 · 已实现盈亏」流水' : '，按原币记录，不进利润表'}</h2>
<span class="mut" style="font-size:13px">到手 ${fmt(parseNum(f.amount))} − 成本 ${qty(parseNum(f.qty))} × ${fmt(r.avg_before ?? b.avg, 3)} = ${fmt(r.realized)}${cny ? `，记在 ${md}；成本 ${fmt(r.cost_sold)} 从投资净投入中减去。` : '；外币标的卖出只增加外币余额，结汇时才以汇兑损益计入结余。'}</span></div>`;
  }
  return `<div style="border-top:2px solid #141414;padding-top:14px;display:flex;flex-direction:column;gap:8px"><span class="mut" style="font-size:12px">保存后</span>
<h2 class="h1" style="font-size:24px;line-height:1.35">持仓 ${qty(a.qty)}，平均成本 ${fmt(a.avg, 4)}</h2>
<span class="mut" style="font-size:13px">${f.opening ? '期初买入不计入投资净投入。' : cny ? `投资净投入 +${fmt(parseNum(f.amount))}，记在 ${md}。` : '外币资产之间的买卖不计入投资净投入。'}</span></div>`;
}

function aside(it) {
  const pv = S.pv;
  if (!it) return '';
  const b = pv?.before, a = pv?.after;
  const trades = it.trades.map(t => `<div class="kv"><span><span class="mono mut">${dDot(t.date)}</span>　${t.kind === 'buy' ? (t.opening ? '期初' : '买入') : '卖出'} ${qty(t.qty)}</span><span>${sym(it)}${fmt(t.amount)}</span></div>`).join('');
  return `<div class="panel"><div class="sec s3"><b>${esc(it.name)} · 当前持仓</b></div>
<div class="kv"><span>持仓数量</span><span>${b ? qty(b.qty) : qty(it.qty)}</span></div>
<div class="kv"><span>平均成本（移动加权）</span><span>${fmt(b ? b.avg : it.avg, 3)}</span></div>
<div class="kv"><span>持仓成本</span><span>${fmt(b ? b.cost : it.cost)}</span></div>
<div class="kv"><span>已实现盈亏 · 累计</span><span class="${(b ? b.realized : it.realized) >= 0 ? 'up' : 'dn'}">${sgn(b ? b.realized : it.realized)}</span></div></div>
${a ? `<div class="panel"><div class="sec s3"><b>${S.f.kind === 'sell' ? '卖出' : '买入'}后</b></div>
<div class="kv"><span>持仓数量</span><span>${a.qty <= 1e-9 ? '0 · 已清仓' : qty(a.qty)}</span></div>
<div class="kv"><span>平均成本</span><span>${Math.abs(a.avg - b.avg) < 1e-9 ? '<span class="mut">不变</span>' : fmt(a.avg, 3)}</span></div>
<div class="kv"><span>已实现盈亏 · 累计</span><span class="${a.realized >= 0 ? 'up' : 'dn'}">${sgn(a.realized)}</span></div>
<div class="kv"><span>${+S.f.date.slice(5, 7)} 月投资净投入</span><span class="${cls2(pv.result.inv)}">${sgn(pv.result.inv)}</span></div></div>` : ''}
<div class="panel"><div class="sec s3"><b>这只标的的交易</b></div>${trades || '<div class="kv"><span class="mut">还没有交易</span><span></span></div>'}</div>`;
}
const cls2 = v => (v > 0 ? 'up' : v < 0 ? 'dn' : 'mut');

function dock() {
  const r = S.pv?.result;
  return `<div class="dock">${S.f.kind === 'sell' ? `<span><span class="k">已实现盈亏</span><span class="v ${r ? (r.realized >= 0 ? 'up' : 'dn') : ''}">${r ? sgn(r.realized) : '—'}</span></span>` : ''}
<span><span class="k">投资净投入</span><span class="v">${r ? sgn(r.inv) : '—'}</span></span><span style="flex:1"></span>
<a href="#/holdings" class="btn">取消</a><button type="button" class="btn pri" data-act="save" data-once="trade-save"${busyAttr('trade-save')} style="padding:0 30px">保存交易</button></div>`;
}

let timer;
function preview() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const body = payload();
    if (!body.instrument_id) return;
    try {
      const pv = await post('/api/trades/preview', { ...body, qty: body.qty > 0 ? body.qty : 1e-12, amount: Number.isFinite(body.amount) ? body.amount : 0 });
      if (!(body.qty > 0) || !Number.isFinite(body.amount)) pv.result = null, pv.after = null;
      S.pv = pv;
      const focus = document.activeElement?.name;
      const pos = document.activeElement?.selectionStart;
      draw();
      if (focus) { const el = S.root.querySelector(`[name="${focus}"]`); el?.focus(); try { el?.setSelectionRange(pos, pos); } catch { /* 日期框 */ } }
    } catch { /* 预览失败不打扰 */ }
  }, 220);
}

function payload() {
  const f = S.f;
  return { id: S.id, kind: f.kind, instrument_id: f.instrument_id, date: f.date, qty: parseNum(f.qty), amount: parseNum(f.amount), opening: f.kind === 'buy' && f.opening };
}

function bind() {
  const r = S.root;
  r.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { S.f.kind = b.dataset.kind; if (S.f.kind === 'sell') S.f.opening = false; draw(); preview(); }));
  r.querySelector('[name="instrument_id"]')?.addEventListener('change', e => { S.f.instrument_id = +e.target.value; S.pv = null; draw(); preview(); });
  for (const n of ['date', 'qty', 'amount']) r.querySelector(`[name="${n}"]`)?.addEventListener('input', e => { S.f[n] = e.target.value; preview(); });
  r.querySelector('[name="opening"]')?.addEventListener('change', e => { S.f.opening = e.target.checked; draw(); preview(); });
  r.querySelector('[data-act="save"]')?.addEventListener('click', once('trade-save', async () => {
    const b = payload();
    if (!(b.qty > 0)) return toast('请填写数量', true);
    if (!Number.isFinite(b.amount)) return toast('请填写金额', true);
    try {
      if (S.id) await put(`/api/trades/${S.id}`, b); else await post('/api/trades', b);
      toast('已保存交易');
      go('#/holdings');
    } catch (e) { fail(e); }
  }));
  r.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
    if (!await confirmBox('删除这笔交易', '持仓、已实现盈亏和自动生成的流水会重新计算。已存档的快照不会改变。', '删除', true)) return;
    try { await del(`/api/trades/${S.id}`); toast('已删除'); go('#/holdings'); } catch (e) { fail(e); }
  });
}
