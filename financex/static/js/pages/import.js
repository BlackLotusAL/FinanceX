import {
  get, post, strip, stripDate, ghost, esc, fmt, sgn, dShort, today, catOptions, typeOptions, SRC_NAME, toast, fail, go,
} from '../util.js';

let S = null;

export async function render(root) {
  const bills = await get(`/api/bills?month=${today().slice(0, 7)}`);
  S = { root, ghost: ghost(bills.summary, bills.month), phase: 'pick', tab: 'all', data: null, busy: false };
  draw();
}

function shell(inner) {
  return `<div class="pg">${strip(`<span>${stripDate()}</span>`, '<span>数据仅存本机</span>')}
<div class="drawer">${S.ghost}<aside aria-label="导入账单">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
<div style="display:flex;flex-direction:column;gap:8px"><span class="kick">${S.phase === 'pick' ? '导入账单' : '导入预览'}</span><h1 class="h1" style="font-size:40px">${S.phase === 'pick' ? '把账单文件拖进来' : '逐条看一遍，再入账'}</h1></div>
<a href="#/bills" aria-label="关闭" class="x-close">×</a></div>${inner}</aside></div></div>`;
}

function draw() {
  S.root.innerHTML = shell(S.phase === 'pick' ? pick() : preview());
  bind();
}

function pick() {
  return `<p style="margin:0;padding:14px 0;border-top:5px solid #141414;border-bottom:1px solid #141414;font-size:16px;line-height:1.6">
每个渠道只认一种格式：<b>支付宝 CSV</b>（GBK）、<b>微信 xlsx</b>、<b>农行信用卡 PDF</b>。可以一次拖入多份。原文件不保存，只保存解析出的流水。</p>
<label class="dz" id="dz"><input type="file" id="file" multiple accept=".csv,.xlsx,.pdf" style="display:none">
<svg width="44" height="44" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 2v13M5 10l6 6 6-6M3 20h16" fill="none" stroke="#24399A" stroke-width="2"></path></svg>
<b style="font-size:17px">${S.busy ? '正在解析…' : '拖入文件，或点这里选择'}</b>
<span class="mut">支付宝：我的 → 账单 → 开具交易流水证明 → 用于个人对账（CSV）<br>微信：我 → 服务 → 钱包 → 账单 → 下载账单 → 用于个人对账（xlsx）<br>农行信用卡：电子对账单 PDF</span></label>
${S.errors?.length ? `<div style="border:2px solid #B3261E;padding:10px 14px;font-size:13px">${S.errors.map(e => `<div><b>${esc(e.file)}</b>：${esc(e.error)}</div>`).join('')}</div>` : ''}
<div class="foot"><span style="font-size:13px">入账前会自动备份；有误可在账单页「撤销这次导入」。</span><a href="#/bills" class="btn">取消</a></div>`;
}

function statusOf(r) {
  if (r.state === 'skipped') return ['已跳过', false];
  if (r.state === 'duplicate') return ['已导入 · 拦截', false];
  if (r.state === 'suspect_keep' || r.state === 'suspect_drop') return [`疑似重复 · ${r.checked ? '保留' : '不导入'}`, true];
  if (!r.prefilled && r.type !== 'transfer' && !r.category_id) return ['<span style="font-size:8px;vertical-align:2px">●</span> 无预填', true];
  if (!r.prefilled) return ['<span style="font-size:8px;vertical-align:2px">●</span> 无预填', true];
  return ['待入账', false];
}

function ordered(rows) {
  const out = [];
  const done = new Set();
  const sorted = [...rows].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || a.id - b.id);
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const r of sorted) {
    if (done.has(r.id)) continue;
    if (r.pair !== null && r.source === 'abc') continue; // 跟在伙伴后面
    out.push(r); done.add(r.id);
    if (r.pair !== null && byId.has(r.pair) && !done.has(r.pair)) { out.push(byId.get(r.pair)); done.add(r.pair); }
  }
  for (const r of sorted) if (!done.has(r.id)) out.push(r);
  return out;
}

function inTab(r) {
  const t = S.tab;
  if (t === 'all') return r.state !== 'skipped' && r.state !== 'duplicate';
  if (t === 'noprefill') return !r.prefilled && r.state !== 'skipped' && r.state !== 'duplicate';
  if (t === 'suspect') return r.state.startsWith('suspect');
  if (t === 'transfer') return r.type === 'transfer' && r.state !== 'skipped' && r.state !== 'duplicate';
  if (t === 'need') return r.checked && r.type !== 'transfer' && !r.category_id;
  return r.state === 'skipped' || r.state === 'duplicate';
}

function preview() {
  const d = S.data;
  const live = d.rows.filter(r => r.state !== 'skipped' && r.state !== 'duplicate');
  const checked = d.rows.filter(r => r.checked);
  const need = checked.filter(r => r.type !== 'transfer' && !r.category_id).length;
  const noPre = live.filter(r => !r.prefilled).length;
  const tab = (k, label, n) => `<button type="button" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${label} ${n}</button>`;
  const rows = ordered(d.rows).filter(inTab);
  const fileLine = d.files.map(f => `<span><b>${esc(f.name)}</b> <span class="mut mono">${f.encoding ? f.encoding + ' · ' : ''}${f.count} 条</span></span>`).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px 22px;font-size:13px">${fileLine}</div>
${d.errors.length ? `<div style="border:2px solid #B3261E;padding:10px 14px;font-size:13px">${d.errors.map(e => `<div><b>${esc(e.file)}</b>：${esc(e.error)}</div>`).join('')}</div>` : ''}
<p style="margin:0;padding:14px 0;border-top:5px solid #141414;border-bottom:1px solid #141414;font-size:16px;line-height:1.6">共解析 <b>${d.stats.parsed}</b> 条，与原文件一致。跳过交易关闭 <b>${d.stats.skipped}</b> 条；按订单号拦截已导入的 <b>${d.stats.duplicate}</b> 条；信用卡与支付宝 / 微信<b>疑似重复 ${d.stats.suspect}</b> ${d.stats.suspect ? '对' : '条'}，默认不导入信用卡一侧（另一侧已入账的，这次的一侧不导入）。将入账 <b>${checked.length}</b> 条，其中 <b>${noPre}</b> 条没有预填分类，需要手选。</p>
<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px">
<div class="tabs">${tab('all', '全部', live.length)}${tab('noprefill', '无预填', noPre)}${tab('need', '未选分类', need)}${tab('suspect', '疑似重复', d.rows.filter(r => r.state.startsWith('suspect')).length)}${tab('transfer', '转账', live.filter(r => r.type === 'transfer').length)}${tab('skipped', '已跳过', d.stats.skipped + d.stats.duplicate)}</div>
<span class="mut" style="font-size:12px;display:flex;align-items:center;gap:8px"><i style="display:inline-block;width:14px;height:14px;background:#F3F1EC;border:1px solid #CFCBC2"></i>浅底 = 尚未入账　<i style="display:inline-block;width:4px;height:14px;background:#141414"></i>同一对疑似重复</span></div>
<div class="scroll"><div style="min-width:860px;display:flex;flex-direction:column;border-top:3px solid #141414">
<div class="pv mono" style="font-size:12px;color:#4A4740;border-bottom:2px solid #141414;background:transparent"><input type="checkbox" data-act="all" aria-label="全选"${rows.length && rows.filter(r => r.state !== 'skipped' && r.state !== 'duplicate').every(r => r.checked) ? ' checked' : ''}><span>状态</span><span>日期</span><span>来源</span><span>商户 / 商品说明</span><span>类型</span><span>分类（按商户最近一笔预填）</span><span style="text-align:right">金额</span></div>
${rows.length ? rows.map(rowHtml).join('') : '<div class="empty">这一栏没有条目。</div>'}
</div></div>
<div class="foot"><span style="font-size:13px">入账前自动备份；有误可在账单页「撤销这次导入」。${need ? `<b>还有 ${need} 条未选分类。</b>` : ''}</span>
<div style="display:flex;gap:10px"><button type="button" class="btn" data-act="back">重新选择文件</button><a href="#/bills" class="btn">取消</a><button type="button" class="btn pri" data-act="confirm"${checked.length && !need && !S.busy ? '' : ' disabled'}>${S.busy ? '正在入账…' : `确认入账 ${checked.length} 条`}</button></div></div>`;
}

function rowHtml(r) {
  const [st, bold] = statusOf(r);
  const dead = r.state === 'skipped' || r.state === 'duplicate';
  const amt = r.type === 'transfer' ? { t: fmt(r.amount), c: 'mut' } : r.type === 'income' ? { t: sgn(r.amount), c: r.amount >= 0 ? 'up' : 'dn' } : { t: sgn(-r.amount), c: r.amount > 0 ? 'dn' : 'up' };
  if (dead) {
    return `<div class="pv skip"><span></span><span class="st">${st}</span><span class="mono">${dShort(r.date)}</span><span>${SRC_NAME[r.source]}</span>
<span><s>${esc(r.merchant)}</s><br><span style="font-size:12px">${esc(r.skip_reason || r.description || '')}</span></span><span>—</span><span>—</span><span class="mono" style="text-align:right">${amt.t}</span></div>`;
  }
  const pair = r.state.startsWith('suspect');
  const appstore = /app store|apple\.com|google play|苹果|App Store/i.test(r.merchant);
  const cat = r.type === 'transfer'
    ? `<span class="mut"${r.prefilled ? '' : ' style="font-size:12px"'}>${r.prefilled ? '— 转账不分类' : '选「转账」后无需分类'}</span>`
    : `<select data-f="category_id" aria-label="分类"${r.category_id ? '' : ' class="need"'}>${catOptions(r.type, r.category_id, { placeholder: true })}</select>`;
  return `<div class="pv${pair ? ' pair' : ''}${r.checked ? '' : ' off'}" data-id="${r.id}">
<input type="checkbox" data-f="checked" aria-label="导入 ${dShort(r.date)} ${esc(r.merchant)}"${r.checked ? ' checked' : ''}>
<span class="st"${bold ? ' style="font-weight:700"' : ''}>${st}</span><span class="mono">${dShort(r.date)}</span><span>${SRC_NAME[r.source]}</span>
<span style="min-width:0">${esc(r.merchant)}<br><span class="mut" style="font-size:12px">${esc(r.description || '—')}${appstore ? '<br><span style="font-size:12px;font-weight:700">代扣渠道：同商户的不同订阅会预填成同一类，请看商品说明</span>' : ''}${r.note ? `<br><span style="font-size:12px;font-weight:700">${esc(r.note)}</span>` : ''}</span></span>
<select data-f="type" aria-label="类型">${typeOptions(r.type)}</select><span>${cat}</span>
<span class="mono ${amt.c}" style="text-align:right">${amt.t}</span></div>`;
}

async function readFiles(list) {
  const files = [];
  for (const f of list) {
    const data = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(f);
    });
    files.push({ name: f.name, data });
  }
  return files;
}

async function handle(list) {
  if (!list.length) return;
  S.busy = true; draw();
  try {
    const files = await readFiles([...list]);
    const d = await post('/api/import/preview', { files });
    S.busy = false;
    if (!d.rows.length) { S.errors = d.errors.length ? d.errors : [{ file: '文件', error: '没有解析出任何条目' }]; draw(); return; }
    S.data = d; S.phase = 'preview'; S.tab = 'all'; S.errors = null;
    draw();
  } catch (e) { S.busy = false; draw(); fail(e); }
}

function bind() {
  const r = S.root;
  if (S.phase === 'pick') {
    const dz = r.querySelector('#dz');
    r.querySelector('#file').addEventListener('change', e => handle(e.target.files));
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files); });
    return;
  }
  const byId = id => S.data.rows.find(x => x.id === id);
  r.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; draw(); }));
  r.querySelector('[data-act="back"]').addEventListener('click', () => { S.phase = 'pick'; S.data = null; draw(); });
  r.querySelector('[data-act="all"]')?.addEventListener('change', e => {
    ordered(S.data.rows).filter(inTab).filter(x => x.state !== 'skipped' && x.state !== 'duplicate').forEach(x => { x.checked = e.target.checked; });
    draw();
  });
  r.querySelectorAll('.pv[data-id]').forEach(el => {
    const row = byId(+el.dataset.id);
    el.querySelector('[data-f="checked"]').addEventListener('change', e => { row.checked = e.target.checked; draw(); });
    el.querySelector('[data-f="type"]').addEventListener('change', e => {
      row.type = e.target.value; row.category_id = null; draw();
    });
    el.querySelector('[data-f="category_id"]')?.addEventListener('change', e => {
      row.category_id = e.target.value ? +e.target.value : null; draw();
    });
  });
  r.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
    const rows = S.data.rows.filter(x => x.checked).map(x => ({
      source: x.source, date: x.date, merchant: x.merchant, description: x.description, amount: x.amount,
      type: x.type, category_id: x.type === 'transfer' ? null : x.category_id, order_no: x.order_no, raw: x.raw,
    }));
    S.busy = true; draw();
    try {
      const res = await post('/api/import/confirm', { files: S.data.files, rows });
      toast(`已入账 ${res.count} 条`);
      const months = {};
      rows.forEach(x => { months[x.date.slice(0, 7)] = (months[x.date.slice(0, 7)] || 0) + 1; });
      const top = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
      go(`#/bills/${top ? top[0] : today().slice(0, 7)}`);
    } catch (e) { S.busy = false; draw(); fail(e); }
  });
}
