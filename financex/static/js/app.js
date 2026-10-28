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

async function render() {
  const my = ++seq;
  const [path] = (location.hash.replace(/^#\/?/, '') || 'overview').split('?');
  const [name, ...rest] = path.split('/');
  const loader = ROUTES[name] || ROUTES.overview;
  try {
    const [mod] = await Promise.all([loader(), loadMeta()]);
    if (my !== seq) return;
    await mod.render(root, { name, rest });
    if (my === seq && !location.hash.includes('keep')) window.scrollTo(0, 0);
  } catch (e) {
    if (my !== seq) return;
    console.error(e);
    root.innerHTML = `<div class="pg"><div class="wrap"><div class="empty">页面出错：<b>${esc(e.message)}</b><br>
<a href="#/overview">回到总览</a></div></div></div>`;
  }
}

window.addEventListener('hashchange', render);
render();
