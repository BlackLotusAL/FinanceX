import { get, post, put, del, state, loadMeta, backStrip, esc, toast, fail, confirmBox, once } from '../util.js';

let S = { all: false };

export async function render(root) {
  S.root = root;
  S.edit = null; S.adding = null;
  S.backups = await get('/api/backups');
  draw();
}

function chips(l1) {
  const cats = state.meta.categories.filter(c => c.l1 === l1);
  let h = cats.map(c => {
    if (c.auto) return `<span class="cchip auto">${esc(c.name)} <span style="font-size:11px">自动</span></span>`;
    if (S.edit === c.id) return `<span class="cchip ed"><input class="f" type="text" data-rename="${c.id}" value="${esc(c.name)}" aria-label="重命名二级分类" style="width:${Math.max(80, c.name.length * 15)}px;height:30px;border:0"><button type="button" class="x" data-save="${c.id}" aria-label="保存">✓</button></span>`;
    return `<span class="cchip"><button type="button" class="nm" data-edit="${c.id}" title="点击重命名">${esc(c.name)}</button><button type="button" class="x" data-del="${c.id}" aria-label="删除 ${esc(c.name)}">×</button></span>`;
  }).join('');
  h += S.adding === l1
    ? `<span class="cchip ed"><input class="f" type="text" data-new="${esc(l1)}" placeholder="新二级" aria-label="新二级分类名称" style="width:110px;height:30px;border:0"><button type="button" class="x" data-addsave="${esc(l1)}" aria-label="添加">✓</button></span>`
    : `<button type="button" class="cchip add" data-add="${esc(l1)}">+ 二级</button>`;
  return h;
}

function draw() {
  const cats = state.meta.categories;
  // 一级分类是固定的，即使下面的二级全删了也要显示，才能再加回二级
  const l1s = kind => [...new Set([...(state.meta.l1?.[kind] || []), ...cats.filter(c => c.kind === kind).map(c => c.l1)])];
  const subCount = cats.length;
  const bk = S.backups.items;
  const list = S.all ? bk : bk.slice(0, 6);
  S.root.innerHTML = `<div class="pg">${backStrip('#/overview', '总览', '分类与备份')}<div class="wrap">
<div class="lhd"><h1 class="h1">分类与备份</h1><span class="mut" style="font-size:13px">数据存于本机 ${esc(state.meta.db)} · 只监听 127.0.0.1</span></div>
<div class="cols" style="gap:48px;padding-top:20px">
<section class="main">
<div class="sec"><b>收支分类</b><span class="mono mut" style="font-size:12px">一级 11 个固定 · 二级 ${subCount} 个可增删改</span></div>
<p class="dek" style="font-size:14px;margin-bottom:6px">一级决定账单页和利润表的结构，不可改；点二级即可重命名。拿不准是什么的记「???」，查清再改；确定但没有合适分类的记「其他」，年底把其中反复出现的单独建类。</p>
<div class="grp" style="color:#141414;border-bottom:2px solid #141414">收入</div>
${l1s('income').map(l1 => `<div class="c1"><span class="n">${esc(l1)}</span><div style="display:flex;flex-wrap:wrap;gap:6px">${chips(l1)}</div></div>`).join('')}
<div class="grp" style="color:#141414;border-bottom:2px solid #141414;margin-top:10px">支出</div>
${l1s('expense').map(l1 => `<div class="c1"><span class="n">${esc(l1)}</span><div style="display:flex;flex-wrap:wrap;gap:6px">${chips(l1)}</div></div>`).join('')}
<span class="mut" style="font-size:12px;margin-top:10px"><span class="cchip auto" style="min-height:22px;font-size:11px">虚线</span> 由卖出、结汇交易自动生成，不需要手选，也不能删除。删除仍有流水的二级时，需先把流水改到别的分类。</span>
</section>
<aside class="side" style="flex:1 1 400px;gap:28px">
<div class="panel"><div class="sec s3"><b>自动备份</b><span class="mono mut" style="font-size:12px">启动 10 份 · 导入前 10 份</span></div>
<p style="margin:8px 0 6px;font-size:13px;line-height:1.6">每次启动、每次导入账单前自动备份，各保留最近 10 份；覆盖已有盘点前也会备份。恢复会回到那一刻，之后的修改全部撤销。</p>
${list.map(b => `<div class="bk"><span class="mono">${b.time.slice(0, 16).replace(/-/g, '.')}</span><span>${esc(b.label)}</span><span class="mono mut">${(b.size / 1048576).toFixed(1)} MB</span><button type="button" class="lk" data-restore="${esc(b.file)}" style="justify-content:flex-end">恢复到此</button></div>`).join('') || '<div class="mut" style="font-size:13px">还没有备份</div>'}
${bk.length > 6 ? `<button type="button" class="lk" data-act="all" style="align-self:flex-start;color:#4A4740;font-weight:500">${S.all ? '收起 ▾' : `显示全部 ${bk.length} 份 ▸`}</button>` : ''}
<span class="mut mono" style="font-size:11px;margin-top:6px;word-break:break-all">${esc(S.backups.dir)}</span></div>
<div class="panel" style="gap:10px"><div class="sec s3"><b>导出</b></div>
<p style="margin:0;font-size:13px;line-height:1.6">导出全部流水为 CSV（UTF-8），含原始商户与商品说明。</p>
<a class="btn" href="/api/export.csv" download style="align-self:flex-start">导出全部流水 CSV</a></div>
<div class="panel" style="gap:8px"><div class="sec s3"><b>迁移</b></div>
<p style="margin:0;font-size:13px;line-height:1.6">整个应用的数据就是 <span class="mono">data/wealthx.db</span> 这一个文件，拷到新电脑即可。联网只在盘点时取价格和汇率（以及新增标的时手动点「识别」），请求里只有标的代码与币种。</p></div>
<div style="border-top:2px solid #141414"></div></aside></div></div></div>`;
  bind();
}

async function reload() { await loadMeta(); draw(); }

function bind() {
  const r = S.root;
  r.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { S.edit = +b.dataset.edit; S.adding = null; draw(); const i = r.querySelector('[data-rename]'); i.focus(); i.select(); }));
  const saveRename = async id => {
    const v = r.querySelector(`[data-rename="${id}"]`).value.trim();
    try { await put(`/api/categories/${id}`, { name: v }); S.edit = null; toast('已重命名'); await reload(); } catch (e) { fail(e); }
  };
  r.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => saveRename(+b.dataset.save)));
  r.querySelector('[data-rename]')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveRename(+e.target.dataset.rename); if (e.key === 'Escape') { S.edit = null; draw(); } });
  r.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const c = state.meta.categories.find(x => x.id === +b.dataset.del);
    if (!await confirmBox(`删除「${c.l1} · ${c.name}」`, '只能删除没有流水的二级分类。', '删除', true)) return;
    try { await del(`/api/categories/${c.id}`); toast('已删除'); await reload(); } catch (e) { fail(e); }
  }));
  r.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { S.adding = b.dataset.add; S.edit = null; draw(); r.querySelector('[data-new]').focus(); }));
  const saveNew = once('cat-add', async l1 => {
    const v = r.querySelector('[data-new]').value.trim();
    if (!v) { S.adding = null; draw(); return; }
    try { await post('/api/categories', { l1, name: v }); S.adding = null; toast('已添加'); await reload(); } catch (e) { fail(e); }
  });
  r.querySelector('[data-addsave]')?.addEventListener('click', e => saveNew(e.currentTarget.dataset.addsave));
  r.querySelector('[data-new]')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveNew(e.target.dataset.new); if (e.key === 'Escape') { S.adding = null; draw(); } });
  r.querySelector('[data-act="all"]')?.addEventListener('click', () => { S.all = !S.all; draw(); });
  r.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
    const it = S.backups.items.find(x => x.file === b.dataset.restore);
    if (!await confirmBox('恢复备份', `回到 <b>${esc(it.time)}</b>（${esc(it.label)}）。这之后的所有修改都会撤销。`, '恢复', true)) return;
    try { await post('/api/backups/restore', { file: it.file }); toast('已恢复'); await loadMeta(); S.backups = await get('/api/backups'); draw(); } catch (e) { fail(e); }
  }));
}
