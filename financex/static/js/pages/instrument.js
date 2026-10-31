import { get, post, put, qs, state, backStrip, esc, today, parseNum, CAT_NAME, toast, fail, go, once, busyAttr } from '../util.js';

let S = null;

export async function render(root) {
  const q = qs();
  let inst = null;
  if (q.id) inst = await get(`/api/instruments/${q.id}`);
  const invAccounts = state.meta.accounts.filter(a => a.kind === 'investment' && !a.disabled);
  const manual = state.meta.accounts.filter(a => a.kind === 'manual' && !a.disabled);
  S = {
    root, inst, invAccounts, manual, focus: q.tab === 'convert' ? 'convert' : 'add',
    a: inst ? { code: inst.code, name: inst.name, category: inst.category, currency: inst.currency, connect: !!inst.connect, account_id: inst.account_id, newName: '', newCur: 'CNY', opening: false, qty: '', amount: '', date: today(), hint: '' }
      : { code: '', name: '', category: 'stock', currency: 'CNY', connect: false, account_id: invAccounts[0]?.id || 'new', newName: '', newCur: 'CNY', opening: true, qty: '', amount: '', date: today(), hint: '' },
    c: { manual_account_id: manual[0]?.id || '', code: '', name: '', category: 'fund', currency: 'CNY', account_id: invAccounts[0]?.id || 'new', newName: '', newCur: 'CNY', date: today(), qty: '', amount: '', hint: '' },
  };
  draw();
  if (S.focus === 'convert') root.querySelector('#convert')?.scrollIntoView();
}

function guess(code) {
  const c = code.trim().toUpperCase();
  if (/-USDT$|^(BTC|ETH|DOGE|SOL|BNB|XRP|USDC)$/.test(c)) return { category: 'crypto', currency: 'USDT' };
  if (/^\d{5}$/.test(c)) return { category: 'stock', currency: 'HKD' };
  if (/^(5[0-9]|15|16)\d{4}$/.test(c)) return { category: 'etf', currency: 'CNY' };
  if (/^[036]\d{5}$/.test(c)) return { category: 'stock', currency: 'CNY' };
  if (/^\d{6}$/.test(c)) return { category: 'fund', currency: 'CNY' };
  if (/^[A-Z.]{1,6}$/.test(c)) return { category: 'stock', currency: 'USD' };
  return null;
}

const catSel = (name, v) => `<select name="${name}">${Object.entries(CAT_NAME).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
const curSel = (name, v, list = ['CNY', 'HKD', 'USD', 'USDT']) => `<select name="${name}">${list.map(c => `<option value="${c}"${c === v ? ' selected' : ''}>${c === 'CRYPTO' ? '加密货币' : c}</option>`).join('')}</select>`;
function accSel(name, v) {
  return `<select name="${name}">${S.invAccounts.map(a => `<option value="${a.id}"${a.id === v ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="new"${v === 'new' ? ' selected' : ''}>新建投资账户…</option></select>`;
}
function newAccBox(p, o) {
  if (o.account_id !== 'new') return '';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px;background:#F3F1EC;outline:2px solid #141414;outline-offset:-2px;padding:14px 16px">
<label class="fld">新账户名称<input type="text" name="${p}newName" value="${esc(o.newName)}" placeholder="如：华泰证券"></label>
<label class="fld">币种${curSel(p + 'newCur', o.newCur, ['CNY', 'HKD', 'USD', 'CRYPTO'])}</label></div>`;
}

function draw() {
  const a = S.a, c = S.c, edit = !!S.inst;
  S.root.innerHTML = `<div class="pg">${backStrip('#/holdings', '持仓', '')}<div class="wrap">
<div class="lhd"><h1 class="h1">标的</h1></div>
<div class="cols" style="gap:48px;padding-top:20px">
<section style="flex:1 1 520px;min-width:0;display:flex;flex-direction:column;gap:20px" data-form="a">
<div class="sec"><b>${edit ? '编辑标的' : '新增标的'}</b></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px">
<label class="fld">代码<span style="display:flex;gap:10px;align-items:flex-end"><input type="text" name="code" value="${esc(a.code)}" placeholder="如 513100、00700、VOO、BTC-USDT"><button type="button" class="lk" data-lookup="a" style="white-space:nowrap">识别</button></span><span class="h">${esc(a.hint)}</span></label>
<label class="fld">名称<input type="text" name="name" value="${esc(a.name)}"></label>
<label class="fld">类别${catSel('category', a.category)}</label>
<label class="fld">计价币种${curSel('currency', a.currency)}</label>
</div>
${a.currency === 'HKD' ? `<label class="chk"><input type="checkbox" name="connect"${a.connect ? ' checked' : ''}> 港股通（按人民币标的记账：成本与卖出金额按人民币结算额录入，归入 CNY 分组）</label>` : ''}
<div style="display:flex;flex-direction:column;gap:10px"><label class="fld">所属投资账户${accSel('account_id', a.account_id)}</label>${newAccBox('', a)}</div>
${edit ? '' : `<div style="border-top:1px solid #141414;padding-top:12px;display:flex;flex-direction:column;gap:14px">
<label class="chk"><input type="checkbox" name="opening"${a.opening ? ' checked' : ''}> 同时录入期初持仓</label>
${a.opening ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:22px">
<label class="fld">日期<input type="date" name="date" value="${a.date}"></label>
<label class="fld">数量<input type="text" name="qty" inputmode="decimal" value="${esc(a.qty)}" style="text-align:right"></label>
<label class="fld">总成本（${a.connect || a.currency === 'CNY' ? '¥' : a.currency}）<input type="text" name="amount" inputmode="decimal" value="${esc(a.amount)}" style="text-align:right"><span class="h">${a.category === 'crypto' ? '参照投资明细子表' : '参照券商 App'}</span></label></div>` : ''}</div>`}
<div style="display:flex;gap:10px;border-top:3px solid #141414;padding-top:14px"><a href="#/holdings" class="btn">取消</a><button type="button" class="btn pri" data-act="save-a" data-once="inst-save-a"${busyAttr('inst-save-a')}>保存标的</button></div>
</section>
${edit ? '' : `<section id="convert" style="flex:1 1 520px;min-width:0;display:flex;flex-direction:column;gap:20px;border-left:1px solid #141414;padding-left:40px" data-form="c">
<div class="sec"><b>手填账户转为标的</b></div>
${S.manual.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px">
<label class="fld">手填账户<select name="manual_account_id">${S.manual.map(m => `<option value="${m.id}"${m.id === +c.manual_account_id ? ' selected' : ''}>${esc(m.name)} · ${m.currency === 'CRYPTO' ? 'USDT' : m.currency}</option>`).join('')}</select></label>
<label class="fld">标的代码<span style="display:flex;gap:10px;align-items:flex-end"><input type="text" name="code" value="${esc(c.code)}"><button type="button" class="lk" data-lookup="c">识别</button></span><span class="h">${esc(c.hint)}</span></label>
<label class="fld">名称<input type="text" name="name" value="${esc(c.name)}"></label>
<label class="fld">类别${catSel('category', c.category)}</label>
<label class="fld">计价币种${curSel('currency', c.currency)}</label>
<label class="fld">挂到投资账户${accSel('account_id', c.account_id)}</label>
<label class="fld">日期<input type="date" name="date" value="${c.date}"></label>
<label class="fld">期初数量（份）<input type="text" name="qty" inputmode="decimal" value="${esc(c.qty)}" style="text-align:right"></label>
<label class="fld">期初成本（¥）<input type="text" name="amount" inputmode="decimal" value="${esc(c.amount)}" style="text-align:right"></label>
</div>${newAccBox('', c)}
<div style="border-top:2px solid #141414;padding-top:14px;display:flex;flex-direction:column;gap:8px"><span class="mut" style="font-size:12px">转换后</span>
<div class="kv"><span>${esc(S.manual.find(m => m.id === +c.manual_account_id)?.name || '')}（手填）</span><span class="mut">停用 · 历史快照保留</span></div>
<div class="kv"><span>${esc(c.name || '新标的')}（标的）</span><span>期初买入 ${c.qty ? esc(c.qty) : '—'} 份</span></div>
<div class="kv"><span>${c.date ? `${+c.date.slice(5, 7)} 月起盘点` : '之后盘点'}</span><span>自动按${c.category === 'fund' ? '净值' : '最新价'}估值</span></div></div>
<div style="display:flex;gap:10px;border-top:3px solid #141414;padding-top:14px"><a href="#/holdings" class="btn">取消</a><button type="button" class="btn pri" data-act="save-c" data-once="inst-save-c"${busyAttr('inst-save-c')}>转为标的</button></div>`
    : '<div class="empty">目前没有可转换的手填账户。</div>'}
</section>`}
</div></div></div>`;
  bind();
}

function payload(o) {
  const body = { code: o.code.trim(), name: o.name.trim(), category: o.category, currency: o.currency, connect: o.currency === 'HKD' && o.connect };
  if (o.account_id === 'new') body.new_account = { name: o.newName.trim(), currency: o.newCur };
  else body.account_id = +o.account_id;
  return body;
}

function bind() {
  const r = S.root;
  for (const key of ['a', 'c']) {
    const form = r.querySelector(`[data-form="${key}"]`);
    if (!form) continue;
    const o = S[key];
    form.querySelectorAll('input,select').forEach(el => {
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const n = el.name;
        o[n] = el.type === 'checkbox' ? el.checked : el.value;
        if (n === 'account_id' && el.value !== 'new') o.account_id = +el.value;
        if (n === 'code') {
          const g = guess(el.value);
          if (g && !S.inst) { o.category = key === 'c' && g.category === 'stock' && g.currency === 'CNY' ? o.category : g.category; o.currency = g.currency; }
          return;
        }
        if (['category', 'currency', 'account_id', 'opening', 'connect', 'manual_account_id'].includes(n)) draw();
      });
    });
    form.querySelector('[name="code"]')?.addEventListener('change', () => draw());
  }
  r.querySelectorAll('[data-lookup]').forEach(b => b.addEventListener('click', async () => {
    const o = S[b.dataset.lookup];
    if (!o.code.trim()) return toast('先填写代码', true);
    b.textContent = '识别中…';
    try {
      const res = await post('/api/lookup', { code: o.code, category: o.category, currency: o.currency });
      if (res.result) { o.name = o.name || res.result.name; o.hint = `已识别：${res.result.name} · ${res.result.source}`; }
      else o.hint = '没有识别到，请确认代码与类别，或直接填写名称';
    } catch (e) { o.hint = '识别失败（需要联网）'; }
    draw();
  }));
  r.querySelector('[data-act="save-a"]')?.addEventListener('click', once('inst-save-a', async () => {
    const a = S.a;
    const body = payload(a);
    try {
      if (S.inst) {
        await put(`/api/instruments/${S.inst.id}`, body);
      } else {
        if (a.opening) {
          const q = parseNum(a.qty), amt = parseNum(a.amount);
          if (!(q > 0) || !Number.isFinite(amt)) throw new Error('请填写期初数量与总成本，或取消勾选「同时录入期初持仓」');
          body.opening = { date: a.date, qty: q, amount: amt };
        }
        await post('/api/instruments', body);
      }
      toast('已保存标的'); go('#/holdings');
    } catch (e) { fail(e); }
  }));
  r.querySelector('[data-act="save-c"]')?.addEventListener('click', once('inst-save-c', async () => {
    const c = S.c;
    const q = parseNum(c.qty), amt = parseNum(c.amount);
    if (!(q > 0) || !Number.isFinite(amt)) return toast('请填写期初数量与成本', true);
    try {
      await post('/api/instruments/convert', { ...payload(c), manual_account_id: +c.manual_account_id, date: c.date, qty: q, amount: amt });
      toast('已转为标的，原手填账户已停用'); go('#/holdings');
    } catch (e) { fail(e); }
  }));
}
