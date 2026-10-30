import { loadMeta, esc } from './util.js';

const ROUTES = {
  overview: () => import('./pages/overview.js'),
  bills: () => import('./pages/bills.js'),
  import: () => import('./pages/import.js'),
  copy: () => import('./pages/copy.js'),
  holdings: () => import('./pages/holdings.js'),
  trade: () => import('./pages/trade.js'),
  fx: () => import('./pages/fx.js'),
  instrument: () => import('./pages/instrument.js'),
  stocktake: () => import('./pages/stocktake.js'),
  bs: () => import('./pages/reports.js'),
  is: () => import('./pages/reports.js'),
  cf: () => import('./pages/reports.js'),
  settings: () => import('./pages/settings.js'),
};

const root = document.getElementById('app');
let seq = 0;
let shown = null; // 当前显示的页面模块

async function render() {
  const my = ++seq;
  const [path] = (location.hash.replace(/^#\/?/, '') || 'overview').split('?');
  const [name, ...rest] = path.split('/');
  const loader = ROUTES[name] || ROUTES.overview;
  // 每次导航渲染到一个新的、尚未挂到页面上的容器里，渲染完成且仍是最新一次导航时才换上去。
  // 这样页面在等待接口时用户又切走了，迟到的结果只会写进被丢弃的容器，不会覆盖当前页面。
  const view = document.createElement('div');
  try {
    const [mod] = await Promise.all([loader(), loadMeta()]);
    if (my !== seq) return;
    await mod.render(view, { name, rest });
    if (my !== seq) {
      // 迟到的渲染可能改写了同一页面模块里的状态（指向被丢弃的容器），重新渲染当前页面以恢复
      if (mod === shown) render();
      return;
    }
    shown = mod;
    root.replaceChildren(view);
    if (!location.hash.includes('keep')) window.scrollTo(0, 0);
  } catch (e) {
    if (my !== seq) return;
    console.error(e);
    root.innerHTML = `<div class="pg"><div class="wrap"><div class="empty">页面出错：<b>${esc(e.message)}</b><br>
<a href="#/overview">回到总览</a></div></div></div>`;
  }
}

window.addEventListener('hashchange', render);
render();
