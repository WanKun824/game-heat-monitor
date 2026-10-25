/**
 * 应用入口
 */
import { state } from './state.js';
import { initPlatformTabs, initDateRangePicker, initGameSelector, initHeaderDate } from './components.js';
import { renderStats, renderPlatformCharts, renderRanking } from './charts.js';

function updateAll() {
  renderStats();
  renderPlatformCharts();
  renderRanking();
}

function init() {
  initHeaderDate();
  initPlatformTabs();
  initDateRangePicker();
  initGameSelector();
  import('./download.js')
    .then((mod) => mod.initDownloadButton())
    .catch((err) => console.warn('download init failed', err));

  state.subscribe((scope) => {
    if (scope === 'rank') {
      renderRanking();
    } else {
      updateAll();
    }
  });

  updateAll();
}

init();
