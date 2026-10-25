/**
 * 图表模块 - 平台多选 + 统计节点 + 曲线模式切换
 */
import {
  PLATFORMS,
  CHART_COLORS,
  EXPECTED_TOPICS,
  GAME_INFO,
  getSelectedPlatforms,
  getPlatformData,
  getWorkCountData,
  getFilteredDates,
  formatVolume,
  escapeHtml,
  getPreviousDate,
  indexByDateTopic,
  lookupRecord,
} from './data.js';
import { state } from './state.js';
import { ICONS } from './components.js';

const chartInstances = {};
const FONT = "'Inter', 'Noto Sans SC', -apple-system, sans-serif";

function destroyCharts(prefix) {
  Object.keys(chartInstances)
    .filter((k) => k.startsWith(prefix))
    .forEach((k) => {
      chartInstances[k].destroy();
      delete chartInstances[k];
    });
}

function getNodeDates(dates, granularity) {
  if (!dates.length) return [];
  if (granularity === 'day') return dates;

  const nodes = [];
  let lastKey = '';
  let lastDate = '';

  dates.forEach((d) => {
    let key = d.slice(0, 7);
    if (granularity === 'week') {
      const dt = new Date(`${d}T00:00:00`);
      const day = dt.getDay() || 7;
      dt.setDate(dt.getDate() - day + 1);
      key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    if (lastKey && key !== lastKey && lastDate) {
      nodes.push(lastDate);
    }
    lastKey = key;
    lastDate = d;
  });

  if (lastDate) nodes.push(lastDate);
  return nodes;
}


function transformSeries(values, curve) {
  if (curve === 'raw') return values;
  if (curve === 'log') {
    return values.map((v) => (v != null && v > 0 ? Math.log10(v) : null));
  }

  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      out.push(null);
      continue;
    }
    const prev = values[i - 1];
    const cur = values[i];
    if (prev == null || cur == null) {
      out.push(null);
      continue;
    }
    if (curve === 'derivative') {
      out.push(cur - prev);
    } else if (curve === 'log_derivative') {
      out.push(prev > 0 && cur > 0 ? Math.log(cur) - Math.log(prev) : null);
    }
  }
  return out;
}

function getTrendMeta(curve) {
  if (curve === 'derivative') {
    return { title: '热度趋势（一阶导）', subtitle: '', yLabel: '增量（亿）' };
  }
  if (curve === 'log') {
    return { title: '热度趋势（对数）', subtitle: '', yLabel: 'log10(累计播放)' };
  }
  if (curve === 'log_derivative') {
    return { title: '热度趋势（log 导数）', subtitle: '', yLabel: 'Δlog(累计播放)' };
  }
  return { title: '热度趋势', subtitle: '累计播放量 / 亿', yLabel: '累计播放（亿）' };
}

function makeLegendConfig() {
  return {
    position: 'bottom',
    labels: {
      usePointStyle: true,
      pointStyle: 'rectRounded',
      pointStyleWidth: 10,
      padding: 14,
      font: { size: 11, family: FONT, weight: '500' },
      color: '#6b7280',
      generateLabels(chart) {
        const datasets = chart.data.datasets;
        return datasets.map((ds, i) => {
          const vals = ds.data.filter((v) => v != null);
          const lastVal = vals.length ? vals[vals.length - 1] : null;
          return {
            text: `${ds.label}: ${lastVal != null ? Number(lastVal).toFixed(2) : '-'}`,
            fillStyle: ds.borderColor,
            strokeStyle: ds.borderColor,
            lineWidth: 0,
            pointStyle: 'rectRounded',
            hidden: !chart.isDatasetVisible(i),
            datasetIndex: i,
          };
        });
      },
    },
  };
}

function renderAnalysisToolbar() {
  const bar = document.getElementById('analysisToolbar');
  if (!bar) return;

  // 热度趋势：仅原始，日期粒度由日期选择器控制
  const trendOpts = [
    { key: 'raw', name: '原始' },
  ];

  // 增长对比：按日期选择器中的粒度动态改标签

  const gLabel = state.analysisGranularity === 'week' ? '周'
               : state.analysisGranularity === 'month' ? '月'
               : '日';
  const growthOpts = [
    { key: 'increment', name: `${gLabel}增量` },
    { key: 'rate',      name: `${gLabel}增长率` },
  ];

  const makeTabs = (label, opts, cur, onClick) => {
    const group = document.createElement('div');
    group.className = 'analysis-group';
    const lb = document.createElement('span');
    lb.className = 'analysis-label';
    lb.textContent = label;

    const tabs = document.createElement('div');
    tabs.className = 'analysis-tabs';
    opts.forEach((opt) => {
      const tab = document.createElement('div');
      tab.className = 'analysis-tab' + (cur === opt.key ? ' is-active' : '');
      tab.textContent = opt.name;
      tab.addEventListener('click', () => onClick(opt.key));
      tabs.appendChild(tab);
    });

    group.appendChild(lb);
    group.appendChild(tabs);
    return group;
  };

  bar.innerHTML = '';
  bar.appendChild(
    makeTabs('热度趋势', trendOpts, state.trendCurve, (key) => state.setTrendCurve(key))
  );

  bar.appendChild(
    makeTabs('增长对比', growthOpts, state.growthView, (key) => state.setGrowthView(key))
  );
}

// ======================
// Stats - per platform column
// ======================

export function renderStats() {
  const area = document.getElementById('statsArea');
  if (!area) return;
  area.innerHTML = '';

  const games = state.getDisplayGames(5);
  const allPlats = PLATFORMS.filter((p) => p.key !== 'all');
  const dates = getFilteredDates(state.dateStart, state.dateEnd);
  if (!dates.length) return;

  const dateSet = new Set(dates);
  const growthPairs = dates.length === 1
    ? (() => {
        const prev = getPreviousDate(dates[0]);
        return prev ? [{ prevDate: prev, curDate: dates[0] }] : [];
      })()
    : dates.slice(1).map((curDate, i) => ({ prevDate: dates[i], curDate }));

  allPlats.forEach((platform) => {
    const col = document.createElement('div');
    col.className = 'stats-column';
    const data = getPlatformData(platform.key).filter((d) => d.v != null && games.includes(d.t));
    const index = indexByDateTopic(data);

    const periodRecords = data.filter((d) => dateSet.has(d.d)).sort((a, b) => b.v - a.v);
    const hottest = periodRecords[0];

    let maxGrowth = null;
    let maxGrowthTopic = '';
    let maxGrowthDate = '';
    games.forEach((game) => {
      growthPairs.forEach(({ prevDate, curDate }) => {
        const cur = lookupRecord(index, curDate, game);
        const prev = lookupRecord(index, prevDate, game);
        if (cur && prev) {
          const g = cur.v - prev.v;
          if (maxGrowth == null || g > maxGrowth) {
            maxGrowth = g;
            maxGrowthTopic = cur.t;
            maxGrowthDate = curDate;
          }
        }
      });
    });

    col.innerHTML = `
      <div class="stat-card">
        <div>
          <div class="stat-card__label">${platform.name} · 区间最热话题</div>
          <div class="stat-card__value">${escapeHtml(hottest ? hottest.t : '-')}</div>
          <div class="stat-card__sub">${hottest ? `${formatVolume(hottest.v)} · ${hottest.d}` : '-'}</div>
        </div>
        <div class="stat-card__icon" style="background:${platform.color}0d">
          <svg viewBox="0 0 256 256" fill="none" stroke="${platform.color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="160 16 144 96 208 120 96 240 112 160 48 136 160 16"/>
          </svg>
        </div>
      </div>
      <div class="stat-card">
        <div>
          <div class="stat-card__label">${platform.name} · 区间单日增长</div>
          <div class="stat-card__value">${escapeHtml(maxGrowthTopic || '-')}</div>
          <div class="stat-card__sub ${maxGrowth != null && maxGrowth > 0 ? 'stat-card__sub--up' : ''}">${maxGrowth != null ? `${(maxGrowth > 0 ? '+' : '') + maxGrowth.toFixed(2)}亿 · ${maxGrowthDate}` : '-'}</div>
        </div>
        <div class="stat-card__icon" style="background:${platform.color}0d">
          <svg viewBox="0 0 256 256" fill="none" stroke="${platform.color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="232 56 136 152 96 112 24 184"/>
            <polyline points="232 120 232 56 168 56"/>
          </svg>
        </div>
      </div>`;

    area.appendChild(col);
  });

  area.style.gridTemplateColumns = `repeat(${allPlats.length}, 1fr)`;
}


// ======================
// Platform Charts
// ======================

export function renderPlatformCharts() {
  const area = document.getElementById('platformChartsArea');
  if (!area) return;

  renderAnalysisToolbar();

  destroyCharts('trend_');
  destroyCharts('growth_');
  destroyCharts('work_');
  area.innerHTML = '';

  const platforms = getSelectedPlatforms(state.selectedPlatforms).filter(
    (p) => getPlatformData(p.key).length > 0
  );

  if (!platforms.length) {
    area.innerHTML = '<div class="chart-card empty-state">暂无数据</div>';
    return;
  }

  const games = state.getDisplayGames(5);
  const dates = getFilteredDates(state.dateStart, state.dateEnd);
  const displayDates = getNodeDates(dates, state.analysisGranularity);
  const trendDates = displayDates;
  const growthNodeDates = displayDates;

  const gLabel = state.analysisGranularity === 'week' ? '周'
               : state.analysisGranularity === 'month' ? '月'
               : '日';
  const trendMeta = getTrendMeta(state.trendCurve);

  platforms.forEach((platform) => {
    const section = document.createElement('div');
    section.className = 'platform-section';
    section.innerHTML = `
      <div class="platform-section__header">
        <span class="platform-dot" style="background:${platform.color}"></span>
        ${platform.name}
      </div>`;

    const row = document.createElement('div');
    row.className = 'platform-section__row';

    const trendId = 'trend_' + platform.key;
    const trendCard = document.createElement('div');
    trendCard.className = 'chart-card';
    trendCard.innerHTML = `
      <div class="chart-card__header">
        <div class="chart-card__title-group">
          <div class="chart-card__title">${trendMeta.title}</div>
          <div class="chart-card__subtitle">${trendMeta.subtitle}</div>
        </div>
        <span class="chart-card__badge">${platform.name}</span>
      </div>
      <div class="chart-card__canvas"><canvas id="${trendId}"></canvas></div>`;
    row.appendChild(trendCard);

    const growthId = 'growth_' + platform.key;
    const growthTitle = state.growthView === 'rate' ? `${gLabel}增长率` : `${gLabel}增量`;
    const growthSub = state.growthView === 'rate'
      ? ''
      : `每${gLabel}绝对增长量（亿）`;
    const growthCard = document.createElement('div');
    growthCard.className = 'chart-card';
    growthCard.innerHTML = `
      <div class="chart-card__header">
        <div class="chart-card__title-group">
          <div class="chart-card__title">${growthTitle}</div>
          <div class="chart-card__subtitle">${growthSub}</div>
        </div>
        <span class="chart-card__badge">${platform.name}</span>
      </div>
      <div class="chart-card__canvas"><canvas id="${growthId}"></canvas></div>`;
    row.appendChild(growthCard);

    section.appendChild(row);

    // 作品数据：单独一行，与热度趋势/增长对比样式一致
    const workData = getWorkCountData(platform.key);
    const workIndex = indexByDateTopic(workData);
    if (workData.length > 0) {
      const workRow = document.createElement('div');
      workRow.className = 'platform-section__row';

      const workId = 'work_' + platform.key;
      const workCard = document.createElement('div');
      workCard.className = 'chart-card';
      workCard.innerHTML = `
        <div class="chart-card__header">
          <div class="chart-card__title-group">
            <div class="chart-card__title">作品数据</div>
            <div class="chart-card__subtitle">每日新增作品数</div>
          </div>
          <span class="chart-card__badge">${platform.name}</span>
        </div>
        <div class="chart-card__canvas"><canvas id="${workId}"></canvas></div>`;
      workRow.appendChild(workCard);
      section.appendChild(workRow);
    }

    area.appendChild(section);

    const data = getPlatformData(platform.key);
    const index = indexByDateTopic(data);

    const trendDatasets = [];
    // 超过 7 天就不显示圆点（保持折线清爽），hover 时仍可见
    const showPoint = trendDates.length <= 7;

    games.forEach((game, gi) => {
      const rawValues = trendDates.map((date) => {
        const rec = lookupRecord(index, date, game);
        return rec && rec.v != null ? rec.v : null;
      });
      const values = transformSeries(rawValues, state.trendCurve);
      if (values.some((v) => v != null)) {
        trendDatasets.push({
          label: game,
          data: values,
          borderColor: CHART_COLORS[gi % CHART_COLORS.length],
          backgroundColor: CHART_COLORS[gi % CHART_COLORS.length],
          fill: false,
          tension: 0.35,
          pointRadius: showPoint ? 4 : 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderWidth: 2,
          pointHoverBorderWidth: 2.5,
          borderWidth: 2.5,
        });
      }
    });

    const trendEl = document.getElementById(trendId);
    if (trendEl) {
      chartInstances[trendId] = new Chart(trendEl, {
        type: 'line',
        data: { labels: trendDates.map((d) => d.slice(5)), datasets: trendDatasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: makeLegendConfig(),
            tooltip: {
              backgroundColor: 'rgba(17,24,39,0.9)',
              titleFont: { size: 12, weight: '600', family: FONT },
              bodyFont: { size: 12, family: FONT },
              padding: 10,
              cornerRadius: 8,
              boxPadding: 4,
              callbacks: {
                label: (ctx) => {
                  const y = ctx.parsed.y;
                  if (y == null) return ` ${ctx.dataset.label}: -`;
                  return ` ${ctx.dataset.label}: ${y.toFixed(2)}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 11, family: FONT }, color: '#9ca3af' },
              border: { display: false },
            },
            y: {
              grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false },
              border: { display: false },
              ticks: {
                font: { size: 11, family: FONT },
                color: '#9ca3af',
                padding: 8,
                callback: (v) => Number(v).toFixed(2),
              },
              title: {
                display: true,
                text: trendMeta.yLabel,
                font: { size: 11, family: FONT },
                color: '#9ca3af',
              },
            },
          },
        },
      });
    }

    if (growthNodeDates.length >= 2) {
      const xLabels = growthNodeDates.slice(1).map((d) => d.slice(5));
      const growthDatasets = [];
      const showGrowthPoint = growthNodeDates.length <= 7;

      games.forEach((game, gi) => {
        const values = [];
        for (let i = 1; i < growthNodeDates.length; i++) {
          const prev = lookupRecord(index, growthNodeDates[i - 1], game);
          const cur = lookupRecord(index, growthNodeDates[i], game);
          if (!(prev && cur) || prev.v == null || cur.v == null) {
            values.push(null);
            continue;
          }
          if (state.growthView === 'rate') {
            values.push(prev.v > 0 ? Math.round(((cur.v - prev.v) / prev.v) * 10000) / 10 : null);
          } else {
            values.push(cur.v - prev.v);
          }
        }

        if (values.some((v) => v != null)) {
          growthDatasets.push({
            label: game,
            data: values,
            borderColor: CHART_COLORS[gi % CHART_COLORS.length],
            backgroundColor: CHART_COLORS[gi % CHART_COLORS.length] + (state.growthView === 'increment' ? '88' : ''),
            fill: false,
            tension: 0.35,
            pointRadius: state.growthView === 'rate' && showGrowthPoint ? 5 : 0,
            pointHoverRadius: state.growthView === 'rate' ? 7 : 6,
            pointBackgroundColor: '#fff',
            pointBorderWidth: 2,
            borderWidth: 2.5,
          });
        }
      });

      const growthEl = document.getElementById(growthId);
      if (growthEl) {
        chartInstances[growthId] = new Chart(growthEl, {
          type: state.growthView === 'rate' ? 'line' : 'bar',
          data: { labels: xLabels, datasets: growthDatasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: makeLegendConfig(),
              tooltip: {
                backgroundColor: 'rgba(17,24,39,0.9)',
                titleFont: { size: 12, weight: '600', family: FONT },
                bodyFont: { size: 12, family: FONT },
                padding: 10,
                cornerRadius: 8,
                boxPadding: 4,
                callbacks: {
                  label: (ctx) => {
                    const y = ctx.parsed.y;
                    if (y == null) return ` ${ctx.dataset.label}: -`;
                    if (state.growthView === 'rate') {
                      return ` ${ctx.dataset.label}: ${(y >= 0 ? '+' : '') + y.toFixed(2)}‰`;
                    }
                    return ` ${ctx.dataset.label}: ${(y >= 0 ? '+' : '') + y.toFixed(2)}亿`;
                  },
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: 11, family: FONT }, color: '#9ca3af' },
                border: { display: false },
              },
              y: {
                grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false },
                border: { display: false },
                ticks: {
                  font: { size: 11, family: FONT },
                  color: '#9ca3af',
                  padding: 8,
                  callback: (v) => state.growthView === 'rate' ? `${Number(v).toFixed(1)}‰` : `${Number(v).toFixed(2)}亿`,
                },
                title: {
                  display: true,
                  text: state.growthView === 'rate' ? `${gLabel}增长率(‰)` : `${gLabel}增量（亿）`,
                  font: { size: 11, family: FONT },
                  color: '#9ca3af',
                },
              },
            },
          },
        });
      }
    }

    // 作品数据图表（与所选日期范围一致）
    if (workData.length > 0) {
      const workId = 'work_' + platform.key;
      const workEl = document.getElementById(workId);
      if (workEl) {
        const dateSet = new Set(dates);
        const useDates = [...new Set(workData.map((x) => x.d))].sort().filter((d) => dateSet.has(d));
        const showWorkPoint = useDates.length <= 14;

        const workDatasets = [];
        games.forEach((game, gi) => {
          const values = useDates.map((d) => {
            const rec = lookupRecord(workIndex, d, game);
            return rec && rec.v != null ? rec.v : null;
          });
          if (values.some((v) => v != null)) {
            workDatasets.push({
              label: game,
              data: values,
              borderColor: CHART_COLORS[gi % CHART_COLORS.length],
              backgroundColor: CHART_COLORS[gi % CHART_COLORS.length],
              fill: false,
              tension: 0.35,
              pointRadius: showWorkPoint ? 4 : 0,
              pointHoverRadius: 6,
              pointBackgroundColor: '#fff',
              pointBorderWidth: 2,
              pointHoverBorderWidth: 2.5,
              borderWidth: 2.5,
            });
          }
        });

        chartInstances[workId] = new Chart(workEl, {
          type: 'line',
          data: { labels: useDates.map((d) => d.slice(5)), datasets: workDatasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: makeLegendConfig(),
              tooltip: {
                backgroundColor: 'rgba(17,24,39,0.9)',
                titleFont: { size: 12, weight: '600', family: FONT },
                bodyFont: { size: 12, family: FONT },
                padding: 10,
                cornerRadius: 8,
                boxPadding: 4,
                callbacks: {
                  label: (ctx) => {
                    const y = ctx.parsed.y;
                    if (y == null) return ` ${ctx.dataset.label}: -`;
                    return ` ${ctx.dataset.label}: ${Number(y).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  },
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: 11, family: FONT }, color: '#9ca3af' },
                border: { display: false },
              },
              y: {
                grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false },
                border: { display: false },
                ticks: {
                  font: { size: 11, family: FONT },
                  color: '#9ca3af',
                  padding: 8,
                  callback: (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                },
                title: {
                  display: true,
                  text: '每日新增作品数',
                  font: { size: 11, family: FONT },
                  color: '#9ca3af',
                },
              },
            },
          },
        });
      }
    }
  });
}

// ======================
// Ranking (sortable by volume or growth)
// ======================

export function renderRanking() {
  const container = document.getElementById('rankCard');
  if (!container) return;
  container.innerHTML = '';

  container.innerHTML = `<div class="rank-card__title">${ICONS.trophy} 游戏话题热度排行榜</div>`;

  const companies = [...new Set(Object.values(GAME_INFO).map((g) => g.company).filter(Boolean))].sort();
  const categories = [...new Set(Object.values(GAME_INFO).map((g) => g.category).filter(Boolean))].sort();

  const controlRow = document.createElement('div');
  controlRow.className = 'rank-controls';

  const filterBar = document.createElement('div');
  filterBar.className = 'rank-filter';
  PLATFORMS.filter((p) => p.key !== 'all').forEach((platform) => {
    const tab = document.createElement('div');
    tab.className = 'platform-tab' + (state.rankPlatform === platform.key ? ' is-active' : '');
    tab.textContent = platform.name;
    tab.addEventListener('click', () => state.setRankPlatform(platform.key));
    filterBar.appendChild(tab);
  });
  controlRow.appendChild(filterBar);

  const sortBar = document.createElement('div');
  sortBar.className = 'rank-filter';
  [
    { key: 'volume', label: '按累计播放' },
    { key: 'growth', label: '按增长' },
  ].forEach((opt) => {
    const tab = document.createElement('div');
    tab.className = 'platform-tab' + (state.rankSortBy === opt.key ? ' is-active' : '');
    tab.textContent = opt.label;
    tab.addEventListener('click', () => state.setRankSortBy(opt.key));
    sortBar.appendChild(tab);
  });
  controlRow.appendChild(sortBar);

  const compSelect = document.createElement('select');
  compSelect.className = 'rank-select';
  compSelect.innerHTML = '<option value="">全部公司</option>' + companies
    .map((c) => `<option value="${c}" ${state.rankCompany === c ? 'selected' : ''}>${c}</option>`)
    .join('');
  compSelect.addEventListener('change', () => state.setRankCompany(compSelect.value));
  controlRow.appendChild(compSelect);

  const catSelect = document.createElement('select');
  catSelect.className = 'rank-select';
  catSelect.innerHTML = '<option value="">全部品类</option>' + categories
    .map((c) => `<option value="${c}" ${state.rankCategory === c ? 'selected' : ''}>${c}</option>`)
    .join('');
  catSelect.addEventListener('change', () => state.setRankCategory(catSelect.value));
  controlRow.appendChild(catSelect);

  container.appendChild(controlRow);

  const dates = getFilteredDates(state.dateStart, state.dateEnd);
  const expectedTopicSet = new Set(EXPECTED_TOPICS.map((t) => t.toLowerCase()));
  const isSingleDay = dates.length === 1;
  const daySpan = dates.length >= 2 ? dates.length - 1 : 1;

  const table = document.createElement('table');
  table.className = 'rank-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:40px">排名</th>
        <th>游戏话题</th>
        <th>公司</th>
        <th>品类</th>
        <th style="text-align:right">累计播放（亿）</th>
        <th style="text-align:right">${isSingleDay ? '单日增长（亿）' : '日均增长（亿）'}</th>
        <th style="width:100px">热度</th>
      </tr>
    </thead>`;

  const tbody = document.createElement('tbody');
  const rows = [];

  PLATFORMS.filter((p) => p.key === state.rankPlatform).forEach((platform) => {
    const data = getPlatformData(platform.key);
    if (!data.length || !dates.length) return;
    const index = indexByDateTopic(data);

    const lastDate = dates[dates.length - 1];
    const firstDate = dates[0];
    const singleDayPrevDate = isSingleDay ? getPreviousDate(lastDate) : null;

    data
      .filter((d) => d.d === lastDate && d.v != null && expectedTopicSet.has(d.t.toLowerCase()))
      .forEach((rec) => {
        const info = GAME_INFO[rec.t] || { company: '-', category: '-' };
        if (state.rankCompany && info.company !== state.rankCompany) return;
        if (state.rankCategory && info.category !== state.rankCategory) return;
        if (state.rankGames.length > 0 && !state.rankGames.includes(rec.t)) return;

        let growth = null;
        if (isSingleDay) {
          const prev = singleDayPrevDate ? lookupRecord(index, singleDayPrevDate, rec.t) : null;
          if (prev && prev.v != null) growth = rec.v - prev.v;
        } else {
          const first = lookupRecord(index, firstDate, rec.t);
          if (first && first.v != null && daySpan >= 1) growth = (rec.v - first.v) / daySpan;
        }

        rows.push({
          topic: rec.t,
          pc: platform.color,
          volume: rec.v,
          growth,
          info,
        });
      });
  });

  if (state.rankSortBy === 'growth') {
    rows.sort((a, b) => (b.growth || 0) - (a.growth || 0));
  } else {
    rows.sort((a, b) => b.volume - a.volume);
  }

  const maxVal = rows.length
    ? state.rankSortBy === 'growth'
      ? Math.max(...rows.map((r) => Math.abs(r.growth || 0)), 0.1)
      : rows[0].volume
    : 1;

  rows.forEach((row, i) => {
    const rankClass = i === 0 ? 'rank-number--1' : i === 1 ? 'rank-number--2' : i === 2 ? 'rank-number--3' : 'rank-number--other';
    const hasGrowth = row.growth != null;
    const displayGrowth = hasGrowth ? Number(row.growth.toFixed(2)) : null;
    const badgeClass = hasGrowth
      ? displayGrowth > 0
        ? 'change-badge--up'
        : displayGrowth < 0
          ? 'change-badge--down'
          : 'change-badge--flat'
      : 'change-badge--flat';
    const growthText = hasGrowth ? (displayGrowth > 0 ? '+' : '') + displayGrowth.toFixed(2) : '-';
    const barVal = state.rankSortBy === 'growth' ? (hasGrowth ? Math.abs(row.growth) : 0) : row.volume;
    const barWidth = ((barVal / maxVal) * 100).toFixed(1);

    tbody.innerHTML += `
      <tr>
        <td><span class="rank-number ${rankClass}">${i + 1}</span></td>
        <td style="font-weight:600">${escapeHtml(row.topic)}</td>
        <td style="color:#6b7280;font-size:13px">${escapeHtml(row.info.company)}</td>
        <td style="color:#6b7280;font-size:13px">${escapeHtml(row.info.category)}</td>
        <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${row.volume.toFixed(1)}</td>
        <td style="text-align:right"><span class="change-badge ${badgeClass}">${growthText}</span></td>
        <td><div class="heat-bar" style="width:${barWidth}%;background:${row.pc}"></div></td>
      </tr>`;
  });

  table.appendChild(tbody);
  container.appendChild(table);

  const note = document.createElement('div');
  note.className = 'rank-note';
  if (!dates.length) {
    note.textContent = '当前日期范围无可用数据。';
  } else if (isSingleDay) {
    const prev = getPreviousDate(dates[0]);
    note.textContent = prev
      ? `当前为单日数据 ${dates[0]}，单日增长按 ${dates[0]} 相对 ${prev} 计算。`
      : `当前为单日数据 ${dates[0]}，由于无前一日数据，单日增长显示为 -。`;
  } else {
    note.textContent = `日期范围 ${dates[0]} ~ ${dates[dates.length - 1]}，日均增长按区间总增量除以 ${daySpan} 天计算。`;
  }
  container.appendChild(note);
}
