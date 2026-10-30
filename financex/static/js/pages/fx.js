import { get, post, put, del, qs, backStrip, esc, fmt, sgn, dDot, today, parseNum, toast, fail, go, confirmBox } from '../util.js';

const NAME = { USD: '美元 USD', HKD: '港币 HKD' };
let S = null;

export async function render(root) {
  const q = qs();
  let t = null;
  if (q.id) t = await get(`/api/trades/${q.id}`);
  const hold = await get('/api/holdings');
  S = {
    root, id: t?.id || null, hold,
    f: { kind: t?.kind || (q.kind === 'fx_sell' ? 'fx_sell' : 'fx_buy'), currency: t?.currency || q.currency || 'USD',
      date: t?.date || today(), qty: t ? String(t.qty) : '', amount: t ? String(t.amount) : '', opening: !!t?.opening },
    pv: null,
  };
  draw();
  preview();
}

function draw() {
  const f = S.f, sell = f.kind === 'fx_sell';
  const pv = S.pv, r = pv?.result, b = pv?.before, a = pv?.after;
  // 公式用这笔交易发生时（按日期重放）的余额与成本，而不是当前的最终状态
  const tb = r && r.bal_before !== undefined ? { bal: r.bal_before, avg: r.avg_before } : b;
  const ta = r && r.bal_after !== undefined ? { bal: r.bal_after, avg: r.avg_after } : a;
  const fxq = parseNum(f.qty), cny = parseNum(f.amount);
  const hist = (S.hold.fx.find(x => x.currency === f.currency)?.trades || []);
  S.root.innerHTML = `<div class="pg">${backStrip('#/holdings', '持仓', '购汇 / 结汇')}<div class="wrap">
<div class="lhd"><h1 class="h1">${S.id ? '修改' : '记'}一笔${f.opening ? '期初购汇' : sell ? '结汇' : '购汇'}</h1>${S.id ? '<button type="button" class="lk" data-act="del" style="color:#B3261E">删除这笔</button>' : ''}</div>
<div class="cols" style="gap:48px;padding-top:18px">
<section style="flex:999 1 560px;min-width:0;max-width:820px;display:flex;flex-direction:column;gap:22px">
<div class="ty" role="group" aria-label="外币交易类型"><button type="button" data-kind="fx_buy" class="${!sell ? 'on' : ''}">购汇</button><button type="button" data-kind="fx_sell" class="${sell ? 'on' : ''}">结汇</button></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px">
<label class="fld">币种<select name="currency">${['USD', 'HKD'].map(c => `<option value="${c}"${c === f.currency ? ' selected' : ''}>${NAME[c]}</option>`).join('')}</select></label>
<label class="fld">日期<input type="date" name="date" value="${f.date}"></label>
${sell
    ? `<label class="fld">结汇外币数量（${f.currency}）<input type="text" name="qty" inputmode="decimal" value="${esc(f.qty)}" style="text-align:right"></label>
<label class="fld">收到人民币（¥）<input type="text" name="amount" inputmode="decimal" value="${esc(f.amount)}" style="text-align:right"></label>`
    : `<label class="fld">${f.opening ? '人民币成本（实际或估计，¥）' : '支付人民币（含手续费，¥）'}<input type="text" name="amount" inputmode="decimal" value="${esc(f.amount)}" style="text-align:right"></label>
<label class="fld">获得外币（${f.currency}）<input type="text" name="qty" inputmode="decimal" value="${esc(f.qty)}" style="text-align:right"></label>`}
</div>
<div style="border-top:2px solid #141414;padding-top:14px;display:flex;flex-direction:column;gap:10px">
<span class="mut" style="font-size:12px">按统计口径计算</span>
${r && tb ? (sell ? `<div class="kv"><span>结汇本金 = ${fmt(Math.min(fxq, tb.bal))} × 平均购汇成本 ${fmt(tb.avg, 4)}${fxq > tb.bal + 1e-9 ? `（超出当时购汇余额的 ${fmt(fxq - tb.bal)} 本金为 0）` : ''}</span><span>${fmt(r.principal)}</span></div>
<div class="kv"><span>汇兑损益 = 收到 ${fmt(cny)} − 本金 ${fmt(r.principal)}</span><span class="${r.pnl >= 0 ? 'up' : 'dn'}">${sgn(r.pnl)}</span></div>
<div class="kv t"><span>人民币现金增加</span><span>${fmt(cny)}</span></div>
<span style="font-size:13px;line-height:1.6">保存后自动生成一笔「投资收益 · 汇兑损益」<b class="${r.pnl >= 0 ? 'up' : 'dn'}">${sgn(r.pnl)}</b>（可能为负），计入利润表与结余；投资净投入减去本金 <b>${fmt(r.principal)}</b>。超出购汇余额的部分本金为 0，全部计为损益。</span>`
    : `<div class="kv"><span>新成本 =（${fmt(tb.bal)} × ${fmt(tb.avg, 4)} + ${fmt(cny)}）÷（${fmt(tb.bal)} + ${fmt(fxq)}）</span><span>${fmt(ta.avg, 4)}</span></div>
<div class="kv"><span>购汇余额（${dDot(f.date)} 时）</span><span>${fmt(tb.bal)} → ${fmt(ta.bal)}</span></div>
<span style="font-size:13px;line-height:1.6">${f.opening ? '期初购汇不计入投资净投入。' : `投资净投入 <b>+${fmt(cny)}</b>。`}</span>`)
    : '<span class="mut" style="font-size:13px">填写数量和金额后显示计算结果。</span>'}
</div>
<div style="border-top:1px solid #141414;padding-top:14px;display:flex;flex-direction:column;gap:10px">
${sell ? `<span style="font-size:13px;font-weight:700">切到「购汇」时</span>
<span class="mut" style="font-size:13px;line-height:1.6">填日期、支付人民币（含手续费）、获得外币。新成本 =（购汇余额 × 旧成本 + 支付人民币）÷（购汇余额 + 获得外币）。启用前已有的外币勾选「期初购汇」，人民币成本按实际或估计填写。</span>` :
    '<span class="mut" style="font-size:13px;line-height:1.6">启用前已有的外币勾选「期初购汇」，人民币成本按实际或估计填写；期初购汇不计入投资净投入。</span>'}
<label class="chk"${sell ? ' style="color:#4A4740"' : ''}><input type="checkbox" name="opening"${f.opening && !sell ? ' checked' : ''}${sell ? ' disabled' : ''}> 期初购汇${sell ? '（仅购汇可用）' : ''}</label>
</div></section>
<aside class="side" style="gap:26px">
<div class="panel"><div class="sec s3"><b>${NAME[f.currency].split(' ')[0]} · ${sell ? '结汇' : '购汇'}前后</b></div>
<div class="kv mono mut" style="font-size:12px;border-bottom:2px solid #141414"><span>项目</span><span>前 → 后</span></div>
<div class="kv"><span>购汇余额</span><span>${b ? fmt(b.bal) : '—'} → <b>${a ? fmt(a.bal) : '—'}</b></span></div>
<div class="kv"><span>平均购汇成本</span><span>${b ? fmt(b.avg, 4) : '—'} → ${a ? fmt(a.avg, 4) : '—'}</span></div>
<span class="mut" style="font-size:12px;margin-top:8px;line-height:1.6">结汇不改成本；余额最低为 0。</span></div>
<div class="panel"><div class="sec s3"><b>不改变购汇余额与成本的</b></div>
<p style="margin:8px 0 0;font-size:13px;line-height:1.7">外币消费、买卖外币资产、外币之间兑换、账户间划转。外币账户里的消费、利息、分红不录流水，只体现在盘点余额里。</p></div>
<div class="panel"><div class="sec s3"><b>购汇余额 ≠ 实际外币余额</b></div>
<p style="margin:8px 0 0;font-size:13px;line-height:1.7">比如用 1,000 美元买了 VOO，购汇余额不变；实际有多少美元，以盘点为准。</p></div>
<div class="panel"><div class="sec s3"><b>${f.currency} 的购汇 / 结汇记录</b></div>
${hist.length ? hist.map(t => `<div class="kv"><span><span class="mono mut">${dDot(t.date)}</span>　${t.kind === 'fx_buy' ? (t.opening ? '期初购汇' : '购汇') : '结汇'} ${fmt(t.qty)}</span><span><a class="lk" href="#/fx?id=${t.id}" style="min-height:0;font-size:12px">¥${fmt(t.amount)}</a></span></div>`).join('') : '<div class="kv"><span class="mut">还没有记录</span><span></span></div>'}</div>
</aside></div></div>
<div class="dock">${sell ? `<span><span class="k">汇兑损益</span><span class="v ${r ? (r.pnl >= 0 ? 'up' : 'dn') : ''}">${r ? sgn(r.pnl) : '—'}</span></span>` : ''}
<span><span class="k">投资净投入</span><span class="v">${r ? sgn(r.inv) : '—'}</span></span>
<span><span class="k">${f.currency} 购汇余额</span><span class="v">${a ? fmt(a.bal) : '—'}</span></span><span style="flex:1"></span>
<a href="#/holdings" class="btn">取消</a><button type="button" class="btn pri" data-act="save" style="padding:0 30px">保存${sell ? '结汇' : '购汇'}</button></div></div>`;
  bind();
}

function payload() {
  const f = S.f;
  return { id: S.id, kind: f.kind, currency: f.currency, date: f.date, qty: parseNum(f.qty), amount: parseNum(f.amount), opening: f.kind === 'fx_buy' && f.opening };
}

let timer;
function preview() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const b = payload();
    const ok = b.qty > 0 && Number.isFinite(b.amount);
    try {
      const pv = await post('/api/trades/preview', { ...b, qty: ok ? b.qty : 1, amount: ok ? b.amount : 0 });
      if (!ok) { pv.result = null; pv.after = pv.before; }
      S.pv = pv;
      const focus = document.activeElement?.name, pos = document.activeElement?.selectionStart;
      draw();
      if (focus) { const el = S.root.querySelector(`[name="${focus}"]`); el?.focus(); try { el?.setSelectionRange(pos, pos); } catch { /* 日期框 */ } }
    } catch { /* 忽略 */ }
  }, 220);
}

function bind() {
  const r = S.root;
  r.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { S.f.kind = b.dataset.kind; if (S.f.kind === 'fx_sell') S.f.opening = false; draw(); preview(); }));
  r.querySelector('[name="currency"]').addEventListener('change', e => { S.f.currency = e.target.value; draw(); preview(); });
  for (const n of ['date', 'qty', 'amount']) r.querySelector(`[name="${n}"]`).addEventListener('input', e => { S.f[n] = e.target.value; preview(); });
  r.querySelector('[name="opening"]').addEventListener('change', e => { S.f.opening = e.target.checked; draw(); preview(); });
  r.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const b = payload();
    if (!(b.qty > 0)) return toast('请填写外币数量', true);
    if (!Number.isFinite(b.amount)) return toast('请填写人民币金额', true);
    try {
      if (S.id) await put(`/api/trades/${S.id}`, b); else await post('/api/trades', b);
      toast('已保存'); go('#/holdings');
    } catch (e) { fail(e); }
  });
  r.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
    if (!await confirmBox('删除这笔记录', '购汇余额、平均成本和自动生成的汇兑损益流水会重新计算。', '删除', true)) return;
    try { await del(`/api/trades/${S.id}`); toast('已删除'); go('#/holdings'); } catch (e) { fail(e); }
  });
}
