import {
  get, post, put, qs, strip, esc, fmt, sgn, wan, qty, priceFmt, dDot, today, monthLabel, mShort, parseNum,
  CUR_NAME, CUR_CODE, toast, fail, go, confirmBox, stripDate, once, busyAttr,
} from '../util.js';

let S = null;
const GROUPS = ['CNY', 'HKD', 'USD', 'CRYPTO'];

export async function render(root) {
  const q = qs();
  const d = await get(`/api/stocktake${q.month ? `?month=${q.month}` : ''}`);
  const snap = d.snapshot;
  S = {
    root, d, month: d.month, menu: null, rateEdited: {}, adding: false, showDisabled: false, fetching: false,
    date: snap ? snap.date : today(),
    rates: { USD: snap?.rates.USD ?? '', HKD: snap?.rates.HKD ?? '' },
    rateNote: snap?.rate_note || '',
    acc: d.accounts.map(a => ({ ...a, input: a.value === null || a.value === undefined ? '' : fmt(a.value) })),
    pos: d.positions.map(p => ({ ...p, input: p.price === null || p.price === undefined ? '' : String(p.price), note: p.price_note })),
    newAcc: { name: '', currency: 'CNY', balance: '' },
  };
  draw();
  if (!snap && d.month === d.default_month) fetchPrices();
}

function rate(cur) {
  if (cur === 'CNY') return 1;
  const v = parseNum(cur === 'HKD' ? S.rates.HKD : S.rates.USD);
  return v > 0 ? v : null;
}

function calc() {
  let net = 0, todo = 0;
  for (const a of S.acc) {
    const v = parseNum(a.input), r = rate(a.currency);
    if (v === null || Number.isNaN(v) || r === null) { todo++; continue; }
    net += v * r;
  }
  for (const p of S.pos) {
    const v = parseNum(p.input), r = rate(p.currency === 'USDT' ? 'USD' : p.currency);
    if (v === null || Number.isNaN(v) || r === null) { todo++; continue; }
    net += p.qty * v * r;
  }
  return { net, todo };
}

function mvOf(p) {
  const v = parseNum(p.input), r = rate(p.currency === 'USDT' ? 'USD' : p.currency);
  return v === null || Number.isNaN(v) || r === null ? null : p.qty * v * r;
}

function draw() {
  const d = S.d;
  const c = calc();
  const isHist = S.month !== d.default_month;
  S.root.innerHTML = `<div class="pg">${strip(`<a href="#/overview" class="back">← 总览</a><span>${stripDate()}</span>`, '<span>联网仅用于取价与汇率</span>')}<div class="wrap">
<div class="lhd"><h1 class="h1">盘点 · ${monthLabel(S.month)}</h1>
<div style="display:flex;flex-wrap:wrap;gap:28px;align-items:flex-end">
<label style="display:flex;flex-direction:column;gap:4px;font-size:12px" class="mut">盘点月份<select name="month" style="font-size:16px;font-weight:600;color:#141414;height:34px;border-bottom:1px solid #141414;font-family:var(--f-mono)">
${d.months.map(m => `<option value="${m.month}"${m.month === S.month ? ' selected' : ''}>${monthLabel(m.month)}${m.month === d.default_month ? '（默认上一个月）' : ''}${m.snapshot ? ' · 已有快照' : m.month !== d.default_month ? ' · 未盘点，补录' : ''}</option>`).join('')}</select></label>
<label style="display:flex;flex-direction:column;gap:4px;font-size:12px" class="mut">盘点日期<input class="f" type="date" name="date" value="${S.date}" style="width:150px;font-size:16px;font-weight:600;height:34px"></label></div></div>
${d.snapshot ? `<div class="banner" style="margin-top:12px"><span><b>${mShort(S.month)}已有快照</b>（${dDot(d.snapshot.date)} 盘点）。修改后「完成盘点」会先自动备份，再覆盖这份快照。</span></div>` : ''}
${isHist && !d.snapshot ? `<div class="banner" style="margin-top:12px"><span><b>补录历史月份</b>：没有价格历史，取到的是现在的最新价。请按当时的价格与汇率修改，或手填。</span></div>` : ''}
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 24px;padding:12px 0;border-bottom:1px solid #141414;font-size:13px"><b>即期汇率</b>
<label class="mono" style="display:flex;gap:6px;align-items:center">USD <input class="f r${S.rates.USD === '' ? ' todo' : ''}" name="rate-USD" value="${esc(S.rates.USD)}" placeholder="待填" style="width:80px"></label>
<label class="mono" style="display:flex;gap:6px;align-items:center">HKD <input class="f r${S.rates.HKD === '' ? ' todo' : ''}" name="rate-HKD" value="${esc(S.rates.HKD)}" placeholder="待填" style="width:80px"></label>
<span class="mono">USDT 按 1:1 美元</span><span class="mut mono" style="font-size:12px">${esc(S.rateNote)}</span><span style="flex:1"></span>
<button type="button" class="lk" data-act="fetch"${S.fetching ? ' disabled' : ''}>${S.fetching ? '取价中…' : '↻ 重新取价'}</button></div>
<div class="cols" style="padding-top:18px">
<section style="flex:1 1 560px;min-width:0;display:flex;flex-direction:column">${manualPanel()}</section>
<section style="flex:1 1 560px;min-width:0;display:flex;flex-direction:column">${posPanel()}</section>
</div></div>
<div class="dock"><span><span class="k">已填部分 · 净资产</span><span class="v" id="dock-net">${wan(c.net)} 万</span></span><span><span class="k">待填</span><span class="v" id="dock-todo">${c.todo} 格</span></span><span style="flex:1"></span>
<span class="mut" style="font-size:12px;max-width:300px">完成后存为 ${mShort(S.month)}快照；同月再盘点会先自动备份再覆盖，存档后每格仍可直接改。</span>
<button type="button" class="btn pri" data-act="save" data-once="stocktake-save"${busyAttr('stocktake-save')} style="height:50px;padding:0 30px">完成盘点</button></div></div>`;
  bind();
}

function manualPanel() {
  const todo = S.acc.filter(a => a.input === '').length;
  let h = `<div class="sec"><b>手填账户</b><span style="display:flex;gap:16px;align-items:baseline"><span class="mono mut" style="font-size:12px">${S.acc.length} 个${todo ? ` · ${todo} 个待填` : ''}</span><button type="button" class="lk" data-act="copy-prev"${S.d.prev_month ? '' : ' disabled title="没有更早的快照"'}>复制上月值</button></span></div>
<div class="scroll"><div style="min-width:560px">
<div class="mr mono" style="font-size:12px;color:#4A4740;padding-top:10px"><span>账户</span><span>币种</span><span style="text-align:right">上月</span><span style="text-align:right">本月余额（原币）</span><span style="text-align:right">较上月</span><span></span></div>`;
  for (const g of GROUPS) {
    const list = S.acc.filter(a => a.currency === g);
    if (!list.length) continue;
    h += `<div class="grp" style="border-bottom:2px solid #141414;color:#141414">${CUR_NAME[g]}</div>`;
    for (const a of list) {
      const v = parseNum(a.input);
      const delta = a.prev !== null && a.prev !== undefined && v !== null && !Number.isNaN(v) ? v - a.prev : null;
      h += `<div class="mr rel" data-acc="${a.id}"><span><b style="font-weight:500">${esc(a.name)}</b>${a.note ? ` <span class="mut" style="font-size:12px">${esc(a.note)}</span>` : ''}${a.disabled ? ' <span class="mut" style="font-size:12px">已停用</span>' : ''}</span>
<span class="mono mut" style="font-size:12px">${CUR_CODE[a.currency]}</span><span class="mono mut" style="text-align:right">${a.prev === null || a.prev === undefined ? '—' : fmt(a.prev)}</span>
<input class="f r${a.input === '' ? ' todo' : ''}" type="text" inputmode="decimal" data-bal="${a.id}" value="${esc(a.input)}" placeholder="待填" aria-label="${esc(a.name)} 本月余额">
<span class="mono ${delta === null ? '' : delta > 0 ? 'up' : delta < 0 ? 'dn' : 'mut'}" style="font-size:12px;text-align:right" data-delta="${a.id}">${delta === null ? '' : sgn(delta)}</span>
<button type="button" aria-label="${esc(a.name)} 更多操作" class="lk plain" data-menu="${a.id}" style="justify-content:center;min-width:32px">⋯</button>
${S.menu === a.id ? menu(a) : ''}</div>`;
    }
  }
  if (!S.acc.length) h += `<div class="empty">还没有手填账户。银行卡、余额宝、公积金、外币账户、借出借入都建为手填账户，盘点时填余额（负债填负数）。</div>`;
  if (S.adding) {
    const n = S.newAcc;
    h += `<div class="mr new"><input class="f" type="text" name="new-name" value="${esc(n.name)}" placeholder="账户名称，如 借入 · 家里" aria-label="新账户名称">
<select name="new-cur" aria-label="币种" class="ul">${GROUPS.map(g => `<option value="${g}"${g === n.currency ? ' selected' : ''}>${g === 'CRYPTO' ? '加密货币' : g}</option>`).join('')}</select>
<span class="mono mut" style="text-align:right">—</span><input class="f r" type="text" name="new-bal" value="${esc(n.balance)}" placeholder="余额" aria-label="余额">
<span class="mut" style="font-size:12px;text-align:right">负债填负数</span><button type="button" class="lk" data-act="add" style="justify-content:center">添加</button></div>`;
  }
  const dis = S.d.disabled;
  h += `<div style="display:flex;flex-wrap:wrap;gap:8px 22px;padding-top:10px;font-size:13px"><button type="button" class="lk" data-act="new">${S.adding ? '收起新增' : '+ 新增手填账户'}</button><span class="mut">⋯ 菜单：改名称 · 改币种 · 停用</span><span style="flex:1"></span>
${dis.length ? `<button type="button" class="lk" data-act="disabled" style="color:#4A4740;font-weight:500">已停用 ${dis.length} 个 ${S.showDisabled ? '▾' : '▸'}</button>` : ''}</div>`;
  if (S.showDisabled) h += dis.map(a => `<div class="mr" style="color:#4A4740"><span>${esc(a.name)}</span><span class="mono" style="font-size:12px">${CUR_CODE[a.currency]}</span><span></span><span></span><span></span><button type="button" class="lk" data-enable="${a.id}" style="font-size:12px">启用</button></div>`).join('');
  return h + '</div></div>';
}

function menu(a) {
  return `<div class="menu" role="menu"><span class="mut" style="font-size:12px;padding:4px 14px">改名称</span>
<input class="f" type="text" name="m-name" value="${esc(a.name)}" aria-label="账户名称">
<span class="mut" style="font-size:12px;padding:8px 14px 0">备注（如：借出）</span><input class="f" type="text" name="m-note" value="${esc(a.note || '')}" aria-label="备注">
<span class="mut" style="font-size:12px;padding:8px 14px 0">币种</span>
<select name="m-cur" class="ul" style="margin:4px 14px" aria-label="币种">${GROUPS.map(g => `<option value="${g}"${g === a.currency ? ' selected' : ''}>${g === 'CRYPTO' ? '加密货币' : g}</option>`).join('')}</select>
<button type="button" data-act="m-save" style="font-weight:700">保存</button><button type="button" data-act="m-disable">停用这个账户</button><button type="button" data-act="m-close" class="mut">关闭</button></div>`;
}

function posPanel() {
  let h = `<div class="sec"><b>持仓标的 · 自动估值</b><span class="mono mut" style="font-size:12px">市值 = 数量 × 最新价 × 即期汇率</span></div>
<div class="scroll"><div style="min-width:560px">
<div class="hd mono" style="font-size:12px;color:#4A4740;padding-top:10px;border-bottom:0"><span>标的</span><span>数量</span><span>最新价</span><span>取价</span><span>汇率</span><span>市值 ¥</span></div>`;
  const accs = [...new Set(S.pos.map(p => p.account_name))];
  for (const an of accs) {
    h += `<div class="grp" style="border-bottom:2px solid #141414;color:#141414">${esc(an)}</div>`;
    for (const p of S.pos.filter(x => x.account_name === an)) {
      const r = p.currency === 'CNY' ? null : rate(p.currency === 'USDT' ? 'USD' : p.currency);
      const mv = mvOf(p);
      const failed = p.note && p.note.startsWith('!');
      h += `<div class="hd"><span><b style="font-weight:500">${esc(p.name)}</b><br><span class="mono mut" style="font-size:12px">${esc(p.code)}</span></span>
<span class="mono">${qty(p.qty)}</span>
<span style="display:flex;align-items:center;gap:4px"><input class="f r${p.input === '' ? ' todo' : ''}" type="text" inputmode="decimal" data-price="${p.instrument_id}" value="${esc(p.input)}" placeholder="${p.category === 'fund' ? '手填净值' : '手填价格'}" aria-label="${esc(p.name)} 价格"><span class="mut" style="font-size:11px">${CUR_CODE[p.currency]}</span></span>
<span class="mono${failed ? '' : ' mut'}" style="font-size:12px${failed ? ';font-weight:700' : ''}">${esc(failed ? p.note.slice(1) : p.note || '手填')}</span>
<span class="mono mut">${p.currency === 'CNY' ? '—' : r === null ? '待填' : r.toFixed(4)}</span>
<span class="mono${mv === null ? ' mut' : ''}" data-mv="${p.instrument_id}">${mv === null ? '待填' : fmt(mv, 0)}</span></div>`;
    }
  }
  if (!S.pos.length) h += `<div class="empty">这个月末没有持仓标的。标的在 <a href="#/instrument">持仓 · 新增标的</a> 录入。</div>`;
  return h + `</div></div><span class="mut" style="font-size:12px;margin-top:10px">股票、场内 ETF、加密货币取最新成交价（休市取最近收盘）；场外基金取最新一期净值。取不到的格留空待手填，不影响其他格。</span>`;
}

const SRC_FAIL = { fund: '天天基金未返回', crypto: 'OKX 未返回' };

// 取价请求返回时，如果用户已经离开这次盘点（换了页面或月份），就丢弃结果，不再重绘
function stillHere(st) {
  return S === st && /^#\/stocktake(\?|$)/.test(location.hash);
}

async function fetchPrices() {
  const st = S;
  // 记下请求发出后用户手动改过的格，返回时保留这些格
  S.rateEdited = {};
  S.pos.forEach(p => { p.edited = false; });
  S.fetching = true; draw();
  let res;
  try {
    res = await post('/api/stocktake/prices', { instrument_ids: S.pos.map(p => p.instrument_id) });
  } catch (e) {
    if (!stillHere(st)) return;
    fail(e); S.fetching = false; draw(); return;
  }
  if (!stillHere(st)) return;
  try {
    if (res.rates) {
      for (const k of ['USD', 'HKD']) if (!S.rateEdited[k]) S.rates[k] = String(res.rates[k]);
      S.rateNote = S.rateEdited.USD || S.rateEdited.HKD ? '手填' : `${res.rates.time} 取自 open.er-api.com`;
    } else toast('汇率没有取到，请手填', true);
    let miss = 0;
    for (const p of S.pos) {
      if (p.edited) continue;
      const r = res.prices[p.instrument_id];
      if (r) { p.input = String(r.price); p.note = r.time || r.source; } else { miss++; p.note = '!' + (SRC_FAIL[p.category] || '东方财富未返回'); }
    }
    if (miss) toast(`${miss} 个标的没有取到价格，请手填`, true);
  } catch (e) { fail(e); }
  S.fetching = false; draw();
}

function live() {
  const c = calc();
  S.root.querySelector('#dock-net').textContent = `${wan(c.net)} 万`;
  S.root.querySelector('#dock-todo').textContent = `${c.todo} 格`;
  for (const a of S.acc) {
    const el = S.root.querySelector(`[data-delta="${a.id}"]`);
    const v = parseNum(a.input);
    if (!el) continue;
    const d = a.prev !== null && a.prev !== undefined && v !== null && !Number.isNaN(v) ? v - a.prev : null;
    el.textContent = d === null ? '' : sgn(d);
    el.className = `mono ${d === null ? '' : d > 0 ? 'up' : d < 0 ? 'dn' : 'mut'}`;
  }
  for (const p of S.pos) {
    const el = S.root.querySelector(`[data-mv="${p.instrument_id}"]`);
    const mv = mvOf(p);
    if (el) { el.textContent = mv === null ? '待填' : fmt(mv, 0); el.className = `mono${mv === null ? ' mut' : ''}`; }
  }
}

function bind() {
  const r = S.root;
  r.querySelector('[name="month"]').addEventListener('change', e => go(`#/stocktake?month=${e.target.value}`));
  r.querySelector('[name="date"]').addEventListener('change', e => { S.date = e.target.value; });
  for (const k of ['USD', 'HKD']) r.querySelector(`[name="rate-${k}"]`).addEventListener('input', e => { S.rates[k] = e.target.value; S.rateEdited[k] = true; live(); });
  r.querySelectorAll('[data-bal]').forEach(el => el.addEventListener('input', () => {
    S.acc.find(a => a.id === +el.dataset.bal).input = el.value; el.classList.toggle('todo', el.value === ''); live();
  }));
  r.querySelectorAll('[data-price]').forEach(el => el.addEventListener('input', () => {
    const p = S.pos.find(x => x.instrument_id === +el.dataset.price);
    p.input = el.value; p.edited = true; if (!p.note || p.note.startsWith('!')) p.note = '手填'; el.classList.toggle('todo', el.value === ''); live();
  }));
  r.querySelector('[data-act="fetch"]').addEventListener('click', fetchPrices);
  r.querySelector('[data-act="copy-prev"]').addEventListener('click', () => {
    let n = 0;
    S.acc.forEach(a => { if (a.input === '' && a.prev !== null && a.prev !== undefined) { a.input = fmt(a.prev); n++; } });
    toast(n ? `已把 ${n} 个空格填为上月值` : '没有需要填的空格');
    draw();
  });
  r.querySelector('[data-act="new"]').addEventListener('click', () => { S.adding = !S.adding; draw(); r.querySelector('[name="new-name"]')?.focus(); });
  r.querySelector('[data-act="disabled"]')?.addEventListener('click', () => { S.showDisabled = !S.showDisabled; draw(); });
  r.querySelectorAll('[data-enable]').forEach(b => b.addEventListener('click', async () => {
    try {
      await put(`/api/accounts/${b.dataset.enable}`, { disabled: 0 });
      const a = S.d.disabled.find(x => x.id === +b.dataset.enable);
      S.d.disabled = S.d.disabled.filter(x => x !== a);
      // 存档快照里已有这个账户（保留了余额）时就地启用，不再追加一行
      const existing = S.acc.find(x => x.id === a.id);
      if (existing) existing.disabled = 0;
      else S.acc.push({ ...a, disabled: 0, prev: null, input: '' });
      draw();
    } catch (e) { fail(e); }
  }));
  if (S.adding) {
    const n = S.newAcc;
    r.querySelector('[name="new-name"]').addEventListener('input', e => { n.name = e.target.value; });
    r.querySelector('[name="new-cur"]').addEventListener('change', e => { n.currency = e.target.value; });
    r.querySelector('[name="new-bal"]').addEventListener('input', e => { n.balance = e.target.value; });
    r.querySelector('[data-act="add"]').addEventListener('click', once('acc-add', async () => {
      if (!n.name.trim()) return toast('请填写账户名称', true);
      try {
        const res = await post('/api/accounts', { name: n.name.trim(), currency: n.currency, kind: 'manual' });
        S.acc.push({ id: res.id, name: n.name.trim(), currency: n.currency, note: '', prev: null, input: n.balance, disabled: 0 });
        S.newAcc = { name: '', currency: 'CNY', balance: '' };
        toast('已添加账户'); draw();
      } catch (e) { fail(e); }
    }));
  }
  r.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); const id = +b.dataset.menu; S.menu = S.menu === id ? null : id; draw();
  }));
  const m = r.querySelector('.menu');
  if (m) {
    const a = S.acc.find(x => x.id === S.menu);
    m.querySelector('[data-act="m-close"]').addEventListener('click', () => { S.menu = null; draw(); });
    m.querySelector('[data-act="m-save"]').addEventListener('click', async () => {
      const body = { name: m.querySelector('[name="m-name"]').value.trim(), note: m.querySelector('[name="m-note"]').value.trim(), currency: m.querySelector('[name="m-cur"]').value };
      try { await put(`/api/accounts/${a.id}`, body); Object.assign(a, body); S.menu = null; toast('已保存'); draw(); } catch (e) { fail(e); }
    });
    m.querySelector('[data-act="m-disable"]').addEventListener('click', async () => {
      if (!await confirmBox(`停用「${a.name}」`, '停用后保留历史数据，不再出现在盘点面板。可以在「已停用」里重新启用。', '停用')) return;
      try {
        await put(`/api/accounts/${a.id}`, { disabled: 1 });
        S.acc = S.acc.filter(x => x !== a); S.d.disabled.push({ ...a, disabled: 1 }); S.menu = null; draw();
      } catch (e) { fail(e); }
    });
  }
  r.querySelector('[data-act="save"]').addEventListener('click', save);
}

const save = once('stocktake-save', async () => {
  for (const a of S.acc) if (a.input !== '' && Number.isNaN(parseNum(a.input))) return toast(`「${a.name}」的余额不是数字`, true);
  for (const p of S.pos) if (p.input !== '' && Number.isNaN(parseNum(p.input))) return toast(`「${p.name}」的价格不是数字`, true);
  const c = calc();
  if (S.d.snapshot && !await confirmBox(`覆盖${mShort(S.month)}快照`, `${mShort(S.month)}已有一份快照。会先自动备份，再用现在的值覆盖。`, '覆盖')) return;
  if (c.todo && !await confirmBox('还有待填的格', `还有 <b>${c.todo}</b> 格没填，没填的不计入净资产。存档后仍可回来补。`, '仍然存档')) return;
  const body = {
    month: S.month, date: S.date, rates: { USD: parseNum(S.rates.USD), HKD: parseNum(S.rates.HKD) }, rate_note: S.rateNote,
    balances: S.acc.map(a => ({ account_id: a.id, balance: a.input === '' ? null : parseNum(a.input) })),
    positions: S.pos.map(p => ({ instrument_id: p.instrument_id, qty: p.qty, cost: p.cost, price: p.input === '' ? null : parseNum(p.input), price_note: p.note && !p.note.startsWith('!') ? p.note : '' })),
  };
  try {
    await post('/api/stocktake', body);
    toast(`已存为 ${mShort(S.month)}快照`);
    go(`#/bs?month=${S.month}`);
  } catch (e) { fail(e); }
});
