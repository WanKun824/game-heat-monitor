/** 分开下载当前选定日期范围的数据 / 作品数 / 热榜 */
import {
  PLATFORMS,
  RAW_DATA,
  WORK_COUNT,
  getFilteredDates,
} from './data.js';
import { state } from './state.js';

const HOT_PLATFORMS = [
  { key: 'douyin', name: '抖音热榜' },
  { key: 'kuaishou', name: '快手热榜' },
  { key: 'bilibili', name: 'B站-总体热榜' },
  { key: 'bilibili_game', name: 'B站-游戏热榜' },
  { key: 'weibo', name: '微博热榜' },
];

function csvEscape(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join('、') : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 60000);
}

function downloadExcel(filename, rows, sheetName) {
  if (window.XLSX) {
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    window.XLSX.writeFile(wb, filename);
    return;
  }

  // 兜底：如果 XLSX 库加载失败，仍生成 Excel 可打开的 xls 文件。
  const html = `<!doctype html><html><head><meta charset="UTF-8"></head><body><table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
  downloadBlob(filename.replace(/\.xlsx$/i, '.xls'), new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' }));
}

async function fetchJson(url) {
  try {
    const resp = await fetch(`${url}?t=${Date.now()}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) {
    return null;
  }
}

function getScope() {
  return {
    dates: getFilteredDates(state.dateStart, state.dateEnd),
    platforms: state.selectedPlatforms.filter((p) => p !== 'all'),
    games: state.getDisplayGames(9999),
  };
}

function filename(prefix, dates) {
  const start = dates[0] || state.dateStart;
  const end = dates[dates.length - 1] || state.dateEnd;
  return start === end ? `${prefix}_${start}.xlsx` : `${prefix}_${start}_至_${end}.xlsx`;
}

function platformName(platformKey) {
  return PLATFORMS.find((p) => p.key === platformKey)?.name || platformKey;
}

function buildHeatRows(dates, platforms, games) {
  const dateSet = new Set(dates);
  const gameSet = new Set(games);
  const rows = [['日期', '平台', '游戏', '累计热度/亿']];

  platforms.forEach((platform) => {
    (RAW_DATA[platform] || []).forEach((rec) => {
      if (!dateSet.has(rec.d) || !gameSet.has(rec.t)) return;
      rows.push([rec.d, platformName(platform), rec.t, rec.v]);
    });
  });

  return rows;
}

function buildWorkRows(dates, platforms, games) {
  const dateSet = new Set(dates);
  const gameSet = new Set(games);
  const rows = [['日期', '平台', '游戏', '作品数']];

  platforms.forEach((platform) => {
    (WORK_COUNT?.[platform] || []).forEach((rec) => {
      if (!dateSet.has(rec.d) || !gameSet.has(rec.t)) return;
      rows.push([rec.d, platformName(platform), rec.t, rec.v]);
    });
  });

  return rows;
}

async function buildHotRows(dates, games) {
  const gameSet = new Set(games);
  const index = await fetchJson('hot_list_output/archive/index.json');
  const snapshots = index?.snapshots || [];
  const rows = [['日期', '平台', '排名', '标题/热榜话题', '热度/播放量', '作者', '链接', '匹配游戏', '更新时间']];

  for (const d of dates) {
    const snap = snapshots.find((x) => x.date === d);
    if (!snap) {
      rows.push([d, '热榜归档', '', '该日期暂无热榜快照', '', '', '', '', '']);
      continue;
    }

    for (const hp of HOT_PLATFORMS) {
      const data = await fetchJson(`hot_list_output/archive/${snap.id}/${hp.key}.json`);
      const items = data?.items || [];
      items.forEach((item) => {
        const matchedGames = item.games || [];
        if (matchedGames.length && !matchedGames.some((g) => gameSet.has(g))) return;
        rows.push([
          d,
          hp.name,
          item.rank || '',
          item.title || item.caption || '',
          item.heat || item.viewCount || '',
          item.author || '',
          item.url || '',
          matchedGames,
          data.lastUpdated || data.crawlTime || '',
        ]);
      });
    }
  }

  return rows;
}

function bindDownload(id, pendingText, handler) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = pendingText;
    try {
      await handler();
      btn.textContent = '已生成';
      setTimeout(() => { btn.textContent = originalText; }, 1200);
    } catch (err) {
      console.error('download failed', err);
      btn.textContent = '下载失败';
      alert('下载失败，请刷新页面后重试');
      setTimeout(() => { btn.textContent = originalText; }, 1500);
    } finally {
      btn.disabled = false;
    }
  });
}

export function initDownloadButton() {
  bindDownload('downloadHeatBtn', '生成中...', async () => {
    const { dates, platforms, games } = getScope();
    downloadExcel(filename('热度数据', dates), buildHeatRows(dates, platforms, games), '热度数据');
  });

  bindDownload('downloadWorkBtn', '生成中...', async () => {
    const { dates, platforms, games } = getScope();
    downloadExcel(filename('作品数数据', dates), buildWorkRows(dates, platforms, games), '作品数数据');
  });

  bindDownload('downloadHotBtn', '生成中...', async () => {
    const { dates, games } = getScope();
    const rows = await buildHotRows(dates, games);
    downloadExcel(filename('热榜数据', dates), rows, '热榜数据');
  });
}
