import {
  get, post, put, state, header, mainStrip, esc, fmt, sgn, monthLabel, monthAdd, mShort, cnMonth, dShort, today,
  catOptions, typeOptions, flowAmount, SRC_NAME, TYPE_NAME, parseNum, toast, fail, confirmBox, go,
} from '../util.js';

let S = null;

export async function render(root, { rest }) {
  const month = rest[0] && /^\d{4}-\d{2}$/.test(rest[0]) ? rest[0] : (S?.month || today().slice(0, 7));
  if (!S || S.month !== month) S = { month, filter: 'all', sel: new Set(), edit: null, open: new Set() };
  S.root = root;
  S.data = await get(`/api/bills?month=${month}`);
  S.sel = new Set([...S.sel].filter(id => S.data.flows.some(f => f.id === id)));
  draw();
}

function draw() {
  const { data, month } = S;
  const s = data.summary;
  const rate = s.rate !== null ? `，储蓄率 ${(s.rate * 100).toFixed(1)}%` : '';
  S.root.innerHTML = `<div class="pg">${mainStrip()}<div class="wrap">${header('bills')}
<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;padding:20px 0 14px">
<div style="display:flex;flex-direction:column;gap:8px"><span class="kick">月度账单 · ${monthLabel(month)}</span>
<h1 class="h1" style="font-size:44px;line-height:1.1">${cnMonth(month)}结余 ${fmt(s.balance, 0)}${rate}</h1></div>
<div style="display:flex;flex-wrap:wrap;gap:22px;align-items:center;font-size:13px;font-weight:700">
<span style="display:flex;align-items:center;gap:6px"><a href="#/bills/${monthAdd(month, -1)}" aria-label="上一月" class="lk plain" style="font-size:18px;font-weight:400;min-width:32px;justify-content:center">‹</a>${+month.slice(0, 4) !== +today().slice(0, 4) ? month.slice(0, 4) + ' 年 ' : ''}${mShort(month)}<a href="#/bills/${monthAdd(month, 1)}" aria-label="下一月" class="lk plain" style="font-size:18px;font-weight:400;min-width:32px;justify-content:center">›</a></span>
<a class="lk" href="#/copy/${month}">复制上月流水</a><button type="button" class="lk" data-act="new">+ 记一笔</button></div></div>
<div style="display:flex;flex-wrap:wrap;border-top:5px solid #141414;border-bottom:1px solid #141414">
<div class="kpi" style="border-left:0;padding-left:0;flex:1 1 150px"><span class="l">收入</span><span class="num" style="font-size:30px">${fmt(s.income, 0)}</span></div>
<div class="kpi" style="flex:2 1 300px"><span class="l">支出</span><span class="num" style="font-size:30px">${fmt(s.expense, 0)}</span><span style="font-size:12px">工资减扣 <b class="mono">${fmt(s.deduct, 0)}</b>　消费支出 <b class="mono">${fmt(s.consume, 0)}</b></span></div>
<div class="kpi" style="flex:1 1 150px"><span class="l">结余</span><span class="num ${s.balance >= 0 ? 'up' : 'dn'}" style="font-size:30px">${fmt(s.balance, 0)}</span></div>
<div class="kpi" style="flex:1 1 150px"><span class="l">储蓄率</span><span class="num" style="font-size:30px">${s.rate !== null ? (s.rate * 100).toFixed(1) + '%' : '<span class="mut" style="font-size:16px">本月无工资收入</span>'}</span></div>
</div>
${banner(data.batch)}
<div class="cols" style="gap:32px;padding-top:22px">
<section class="main">${flowList()}</section>
<aside class="side">${summaryPanel()}</aside>
</div></div></div>`;
  bind();
}

function banner(b) {
  if (!b) return '';
  const srcs = [...new Set(b.files.map(f => SRC_NAME[f.source] || f.source))].join(' / ');
  return `<div class="banner"><span><b>${dShort(b.created.slice(0, 10))} 导入</b> ${esc(srcs)} ${b.files.length} 份账单，入账 ${b.count} 笔。导入前已自动备份。</span>
<span style="flex:1"></span><button type="button" class="lk" data-act="undo">撤销这次导入</button><span class="mut" style="font-size:12px">会同时撤销导入之后的所有修改</span></div>`;
}

function visible() {
  const f = S.filter;
  return S.data.flows.filter(x => f === 'all' ? true : f === 'unknown' ? x.cat_name === '???' : x.type === f);
}

function flowList() {
  const c = S.data.counts;
  const tab = (k, label) => `<button type="button" data-filter="${k}" class="${S.filter === k ? 'on' : ''}">${label}</button>`;
  const rows = visible();
  const n = S.sel.size;
  const allSel = rows.length > 0 && rows.every(r => S.sel.has(r.id));
  return `<div class="sec"><b>流水 · ${c.all} 笔</b><span class="tabs">${tab('all', '全部')}${tab('income', `收入 ${c.income}`)}${tab('expense', `支出 ${c.expense}`)}${tab('transfer', `转账 ${c.transfer}`)}${tab('unknown', `??? ${c.unknown}`)}</span></div>
${n ? `<div class="selbar"><b>已选 ${n} 笔</b>
<label style="display:flex;align-items:center;gap:6px"><span class="sr-only" style="position:absolute;left:-9999px">改分类</span><select data-act="bulk-cat" aria-label="改分类"><option value="">改分类…</option>${catOptions('income', null, { placeholder: false }).replace('<option value="">请选择…</option>', '')}${catOptions('expense', null).replace('<option value="">请选择…</option>', '')}</select></label>
<select data-act="bulk-type" aria-label="改类型"><option value="">改类型…</option>${typeOptions('')}</select>
<button type="button" class="lk" data-act="bulk-copy">复制到下月</button><span style="flex:1"></span>
<button type="button" class="lk" data-act="bulk-del" style="color:#F2B8B5">删除</button></div>` : ''}
<div class="scroll"><div style="min-width:720px">
<div class="tx mono" style="font-size:12px;color:#4A4740;border-bottom:2px solid #141414"><input type="checkbox" data-act="all" aria-label="全选"${allSel ? ' checked' : ''}><span>日期</span><span>商户 / 商品说明</span><span>类型</span><span>分类</span><span>来源</span><span>金额</span></div>
${S.edit === 'new' ? editor(null) : ''}
${rows.length ? rows.map(f => (S.edit === f.id ? editor(f) : row(f))).join('') : `<div class="empty">本月${S.filter === 'all' ? '还没有流水。可以 <a href="#/import">导入账单</a>、<a href="#/copy/' + S.month + '">复制上月流水</a> 或点「+ 记一笔」。' : '没有这一类流水。'}</div>`}
</div></div>
<span class="mut" style="font-size:12px;margin-top:10px">转账只在内部账户间移动，不计入收支；退款记为负数支出，显示为 +。点任一行可直接修改。</span>`;
}

function row(f) {
  const a = flowAmount(f);
  const tags = [];
  if (f.cat_name === '???') tags.push('<span class="tag hot">待查</span>');
  if (f.type === 'expense' && f.amount < 0) tags.push('<span class="tag">退款</span>');
  if (f.tag) tags.push(`<span class="tag">${esc(f.tag)}</span>`);
  const on = S.sel.has(f.id);
  return `<div class="tx row${on ? ' on' : ''}" data-id="${f.id}"><input type="checkbox" data-act="sel" aria-label="选择 ${dShort(f.date)} ${esc(f.merchant)}"${on ? ' checked' : ''}>
<span class="mono">${dShort(f.date)}</span>
<span style="min-width:0"><b style="font-weight:500">${esc(f.merchant || '—')}</b>${tags.join('')}<br><span class="mut" style="font-size:12px">${esc(f.description || '—')}</span></span>
<span class="${f.type === 'transfer' ? 'mut' : ''}">${TYPE_NAME[f.type]}</span>
<span>${f.type === 'transfer' ? '<span class="mut">—</span>' : f.category_id ? `${esc(f.l1)} · ${esc(f.cat_name)}` : '<b>未分类</b>'}</span>
<span class="mut">${SRC_NAME[f.source] || f.source}</span><span class="${a.cls}">${a.text}</span></div>`;
}

function editor(f) {
  const typ = f ? f.type : 'expense';
  const amt = f ? (f.type === 'income' ? sgn(f.amount) : f.type === 'transfer' ? fmt(f.amount) : sgn(-f.amount)) : '';
  return `<div class="tx edit" data-editor="${f ? f.id : 'new'}"><span></span>
<input class="f" type="date" name="date" value="${f ? f.date : (S.month === today().slice(0, 7) ? today() : S.month + '-01')}" aria-label="日期" style="font-size:12px">
<span style="display:flex;flex-direction:column;gap:2px"><input class="f" type="text" name="merchant" value="${esc(f?.merchant || '')}" placeholder="商户" aria-label="商户"><input class="f" type="text" name="description" value="${esc(f?.description || '')}" placeholder="商品说明" aria-label="商品说明" style="height:28px;font-size:12px"></span>
<select name="type" aria-label="类型" class="ul">${typeOptions(typ)}</select>
<select name="category_id" aria-label="分类" class="ul"${typ === 'transfer' ? ' disabled' : ''}>${typ === 'transfer' ? '<option value="">— 转账不分类</option>' : catOptions(typ, f?.category_id || null, { placeholder: true })}</select>
<span class="mut">${f ? SRC_NAME[f.source] : '手动'}</span>
<input class="f r" type="text" name="amount" value="${amt}" placeholder="${typ === 'expense' ? '−0.00' : '0.00'}" aria-label="金额"></div>
<div class="editbar"><span class="mut" style="font-size:12px;margin-right:auto">支出直接填金额；退款填 +金额。回车保存，Esc 取消。</span>
${f ? '<button type="button" class="lk" data-act="del-one" style="color:#B3261E">删除</button>' : ''}
<button type="button" class="lk" data-act="cancel" style="color:#4A4740">取消</button><button type="button" class="lk" data-act="save">保存这笔</button></div>`;
}

function summaryPanel() {
  const cats = state.meta.categories;
  const totals = S.data.totals;
  const groups = [
    ['收入', cats.filter(c => c.kind === 'income')],
    ['支出 · 工资减扣', cats.filter(c => c.l1 === '工资减扣')],
    ['支出 · 消费支出', cats.filter(c => c.kind === 'expense' && c.l1 !== '工资减扣')],
  ];
  let html = `<div class="sec s3"><b>两级分类汇总</b><span class="mut" style="font-size:12px">一级始终显示 · 二级只列有发生额的</span></div>`;
  for (const [title, list] of groups) {
    const sum = list.reduce((a, c) => a + (totals[c.id] || 0), 0);
    html += `<div class="cgrp"><span>${title}</span><span class="mono">${fmt(sum)}</span></div>`;
    const l1s = [...new Set(list.map(c => c.l1))];
    for (const l1 of l1s) {
      const subs = list.filter(c => c.l1 === l1);
      const t = subs.reduce((a, c) => a + (totals[c.id] || 0), 0);
      const nz = subs.filter(c => Math.abs(totals[c.id] || 0) > 0.004);
      const open = S.open.has(l1);
      const shown = open ? subs : nz;
      html += `<div class="cl1"><span>${esc(l1)}</span><span class="mono">${fmt(t)}</span></div>`;
      html += shown.map(c => `<div class="cl2"><span class="mut">${esc(c.name)}</span><span class="mono mut">${fmt(totals[c.id] || 0)}</span></div>`).join('');
      const zero = subs.length - nz.length;
      if (zero) html += `<button type="button" class="lk" data-l1="${esc(l1)}" style="font-weight:400;font-size:12px;color:#4A4740;padding-left:16px;min-height:24px">${open ? '▾ 收起为 0 的项' : `▸ 其余 ${zero} 项为 0`}</button>`;
      html += '<div style="border-bottom:1px dotted #8A877F;margin-top:4px"></div>';
    }
  }
  return html + '<div style="border-top:2px solid #141414;margin-top:10px"></div>';
}

function readEditor(box) {
  const v = n => box.querySelector(`[name="${n}"]`)?.value ?? '';
  const type = v('type');
  const raw = v('amount').trim();
  const num = parseNum(raw);
  if (num === null || Number.isNaN(num)) throw new Error('请填写有效金额');
  let amount;
  if (type === 'expense') amount = raw.startsWith('+') ? -Math.abs(num) : Math.abs(num);
  else if (type === 'transfer') amount = Math.abs(num);
  else amount = num;
  return { date: v('date'), merchant: v('merchant'), description: v('description'), type,
    category_id: v('category_id') ? +v('category_id') : null, amount };
}

async function saveEditor() {
  const box = S.root.querySelector('[data-editor]');
  if (!box) return;
  try {
    const body = readEditor(box);
    if (body.type !== 'transfer' && !body.category_id) throw new Error('请选择分类');
    const id = box.dataset.editor;
    if (id === 'new') await post('/api/flows', body); else await put(`/api/flows/${id}`, body);
    toast('已保存');
    S.edit = null;
    if (body.date.slice(0, 7) !== S.month) go(`#/bills/${body.date.slice(0, 7)}`);
    else await refresh();
  } catch (e) { fail(e); }
}

async function refresh() {
  S.data = await get(`/api/bills?month=${S.month}`);
  S.sel = new Set([...S.sel].filter(id => S.data.flows.some(f => f.id === id)));
  draw();
}

async function bulk(action, extra = {}) {
  try {
    const res = await post('/api/flows/batch', { ids: [...S.sel], action, ...extra });
    if (action === 'copy_next') toast(`已复制 ${res.copied} 笔到下月`);
    else toast('已更新');
    if (action === 'delete') S.sel.clear();
    await refresh();
  } catch (e) { fail(e); }
}

function bind() {
  const r = S.root;
  r.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { S.filter = b.dataset.filter; draw(); }));
  r.querySelectorAll('[data-l1]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.l1; S.open.has(k) ? S.open.delete(k) : S.open.add(k); draw();
  }));
  r.querySelector('[data-act="new"]')?.addEventListener('click', () => { S.edit = 'new'; S.filter = 'all'; draw(); r.querySelector('[data-editor] [name="merchant"]')?.focus(); });
  r.querySelector('[data-act="undo"]')?.addEventListener('click', async () => {
    const ok = await confirmBox('撤销这次导入', '恢复到导入前的自动备份。<b>导入之后的所有修改</b>（包括手动记账、盘点、交易）都会一起撤销。', '撤销导入', true);
    if (!ok) return;
    try { await post('/api/import/undo', { batch_id: S.data.batch.id }); toast('已恢复到导入前'); await refresh(); } catch (e) { fail(e); }
  });
  r.querySelector('[data-act="all"]')?.addEventListener('change', e => {
    const rows = visible();
    if (e.target.checked) rows.forEach(x => S.sel.add(x.id)); else rows.forEach(x => S.sel.delete(x.id));
    draw();
  });
  r.querySelectorAll('.tx.row').forEach(el => el.addEventListener('click', e => {
    const id = +el.dataset.id;
    if (e.target.matches('input[type=checkbox]')) {
      e.target.checked ? S.sel.add(id) : S.sel.delete(id);
      draw();
      return;
    }
    const f = S.data.flows.find(x => x.id === id);
    if (f.trade_id) { toast('这笔由交易自动生成，请在持仓页修改对应交易'); return; }
    S.edit = id; draw();
    r.querySelector('[data-editor] [name="amount"]')?.focus();
  }));
  const box = r.querySelector('[data-editor]');
  if (box) {
    box.querySelector('[name="type"]').addEventListener('change', e => {
      const t = e.target.value;
      const sel = box.querySelector('[name="category_id"]');
      sel.disabled = t === 'transfer';
      sel.innerHTML = t === 'transfer' ? '<option value="">— 转账不分类</option>' : catOptions(t, null, { placeholder: true });
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveEditor(); }
      if (e.key === 'Escape') { S.edit = null; draw(); }
    });
  }
  r.querySelector('[data-act="save"]')?.addEventListener('click', saveEditor);
  r.querySelector('[data-act="cancel"]')?.addEventListener('click', () => { S.edit = null; draw(); });
  r.querySelector('[data-act="del-one"]')?.addEventListener('click', async () => {
    if (!await confirmBox('删除这笔流水', '删除后可从自动备份恢复。', '删除', true)) return;
    try { await post('/api/flows/batch', { ids: [S.edit], action: 'delete' }); S.edit = null; toast('已删除'); await refresh(); } catch (e) { fail(e); }
  });
  r.querySelector('[data-act="bulk-cat"]')?.addEventListener('change', e => e.target.value && bulk('set_category', { category_id: +e.target.value }));
  r.querySelector('[data-act="bulk-type"]')?.addEventListener('change', e => e.target.value && bulk('set_type', { type: e.target.value }));
  r.querySelector('[data-act="bulk-copy"]')?.addEventListener('click', () => bulk('copy_next'));
  r.querySelector('[data-act="bulk-del"]')?.addEventListener('click', async () => {
    if (await confirmBox(`删除 ${S.sel.size} 笔流水`, '删除后可从自动备份恢复。', '删除', true)) bulk('delete');
  });
}
