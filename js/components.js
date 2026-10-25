/**
 * UI 组件 - 平台多选 + Phosphor 图标
 */
import { PLATFORMS, DATE_SHORTCUTS, escapeHtml, formatDateLocal, latestSelectableDate } from './data.js';
import { state } from './state.js';

/** Phosphor-style icons */
const ICONS = {
  calendar: '<svg viewBox="0 0 256 256" fill="none"><rect x="40" y="40" width="176" height="176" rx="8" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><line x1="176" y1="24" x2="176" y2="56" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><line x1="80" y1="24" x2="80" y2="56" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><line x1="40" y1="88" x2="216" y2="88" stroke="currentColor" stroke-width="12" stroke-linecap="round"/></svg>',
  trendUp: '<svg viewBox="0 0 256 256" fill="none"><polyline points="232 56 136 152 96 112 24 184" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><polyline points="232 120 232 56 168 56" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chartLine: '<svg viewBox="0 0 256 256" fill="none"><polyline points="224 208 32 208 32 48" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><polyline points="224 96 160 152 96 104 32 168" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chartBar: '<svg viewBox="0 0 256 256" fill="none"><line x1="228" y1="208" x2="28" y2="208" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><rect x="60" y="112" width="40" height="96" rx="4" stroke="currentColor" stroke-width="12"/><rect x="108" y="64" width="40" height="144" rx="4" stroke="currentColor" stroke-width="12"/><rect x="156" y="136" width="40" height="72" rx="4" stroke="currentColor" stroke-width="12"/></svg>',
  lightning: '<svg viewBox="0 0 256 256" fill="none"><polygon points="160 16 144 96 208 120 96 240 112 160 48 136 160 16" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trophy: '<svg viewBox="0 0 256 256" fill="none"><line x1="96" y1="240" x2="160" y2="240" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><line x1="128" y1="176" x2="128" y2="240" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><path d="M56,56H200v48a72,72,0,0,1-144,0Z" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M200,80h24a16,16,0,0,1,16,16v16a48,48,0,0,1-48,48h-8" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M56,80H32A16,16,0,0,0,16,96v16a48,48,0,0,0,48,48h8" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronLeft: '<svg viewBox="0 0 256 256" fill="none"><polyline points="160 208 80 128 160 48" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronRight: '<svg viewBox="0 0 256 256" fill="none"><polyline points="96 48 176 128 96 208" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export { ICONS };

/** 初始化平台标签（多选，无"全部"） */
export function initPlatformTabs() {
  const container = document.getElementById('platformTabs');
  if (!container) return;

  const platformsNoAll = PLATFORMS.filter((p) => p.key !== 'all');

  function render() {
    container.innerHTML = '';
    platformsNoAll.forEach((platform) => {
      const tab = document.createElement('div');
      tab.className = 'platform-tab' + (state.isPlatformSelected(platform.key) ? ' is-active' : '');
      tab.textContent = platform.name;
      tab.addEventListener('click', () => {
        state.togglePlatform(platform.key);
        render();
      });
      container.appendChild(tab);
    });
  }

  render();
  state.subscribe(() => render());
}

/** Calendar panel */
class CalendarPanel {
  constructor(container, year, month, options = {}) {
    this.container = container;
    this.year = year;
    this.month = month;
    this.onDateClick = options.onDateClick || (() => { });
    this.onPrev = options.onPrev || (() => { });
    this.onNext = options.onNext || (() => { });
    this.onWeekClick = options.onWeekClick || this.onDateClick;
    this.showNav = options.showNav || 'both';
    this.granularity = options.granularity || 'day';
    this.maxDate = options.maxDate || '9999-12-31';
    this.getRangeState = options.getRangeState || (() => ({}));
    this.render();
  }

  render() {
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    const titleStr = `${this.year}年 ${this.month + 1}月`;
    const firstDay = (new Date(this.year, this.month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const prevDays = new Date(this.year, this.month, 0).getDate();
    const today = new Date();
    const todayStr = formatDateLocal(today);

    let html = '<div class="calendar-panel"><div class="calendar-panel__header">';
    if (this.showNav === 'both' || this.showNav === 'prev')
      html += `<button class="calendar-panel__nav calendar-panel__nav--prev" data-action="prev">${ICONS.chevronLeft}</button>`;
    html += `<span class="calendar-panel__title">${titleStr}</span>`;
    if (this.showNav === 'both' || this.showNav === 'next')
      html += `<button class="calendar-panel__nav calendar-panel__nav--next" data-action="next">${ICONS.chevronRight}</button>`;
    html += '</div>';

    if (this.granularity === 'week') {
      html += '<div class="calendar-panel__weekdays calendar-panel__weekdays--with-week"><span class="calendar-panel__weekday">周</span>';
      weekdays.forEach((w) => { html += `<span class="calendar-panel__weekday">${w}</span>`; });
      html += '</div><div class="calendar-panel__weeks">';

      const first = new Date(this.year, this.month, 1);
      const cursor = new Date(first);
      const day = cursor.getDay() || 7;
      cursor.setDate(cursor.getDate() - day + 1);
      const lastOfMonth = new Date(this.year, this.month + 1, 0);

      while (cursor <= lastOfMonth || cursor.getMonth() === this.month) {
        const weekStart = new Date(cursor);
        const weekEnd = new Date(cursor);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekStartStr = formatDateLocal(weekStart);
        const weekEndStr = formatDateLocal(weekEnd);
        const weekDisabled = weekEndStr > this.maxDate;
        const weekNum = getWeekNumber(weekStart);
        html += `<div class="calendar-week-row${weekDisabled ? ' is-disabled' : ''}" ${weekDisabled ? '' : `data-week-start="${weekStartStr}"`}><button class="calendar-week-num" ${weekDisabled ? 'disabled' : `data-week-start="${weekStartStr}"`}>${weekNum}</button>`;
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          const dateStr = formatDateLocal(d);
          const rs = this.getRangeState(dateStr);
          let cls = 'calendar-day';
          if (d.getMonth() !== this.month) cls += ' calendar-day--other calendar-day--other-clickable';
          if (dateStr > this.maxDate) cls += ' calendar-day--disabled';
          if (dateStr === todayStr) cls += ' calendar-day--today';
          if (rs.selected) cls += ' calendar-day--selected';
          if (rs.rangeStart) cls += ' calendar-day--range-start';
          if (rs.rangeEnd) cls += ' calendar-day--range-end';
          if (rs.inRange) cls += ' calendar-day--in-range';
          html += `<button class="${cls}" ${weekDisabled ? 'disabled' : `data-week-start="${weekStartStr}"`}>${d.getDate()}</button>`;
        }
        html += '</div>';
        cursor.setDate(cursor.getDate() + 7);
      }
      html += '</div></div>';
    } else {
      html += '<div class="calendar-panel__weekdays">';
      weekdays.forEach((w) => { html += `<span class="calendar-panel__weekday">${w}</span>`; });
      html += '</div><div class="calendar-panel__days">';

      for (let i = firstDay - 1; i >= 0; i--)
        html += `<button class="calendar-day calendar-day--other" disabled>${prevDays - i}</button>`;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${this.year}-${String(this.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const rs = this.getRangeState(dateStr);
        let cls = 'calendar-day';
        const disabled = dateStr > this.maxDate;
        if (dateStr === todayStr) cls += ' calendar-day--today';
        if (disabled) cls += ' calendar-day--disabled';
        if (rs.selected) cls += ' calendar-day--selected';
        if (rs.rangeStart) cls += ' calendar-day--range-start';
        if (rs.rangeEnd) cls += ' calendar-day--range-end';
        if (rs.inRange) cls += ' calendar-day--in-range';
        html += `<button class="${cls}" ${disabled ? 'disabled' : `data-date="${dateStr}"`}>${d}</button>`;
      }

      const rem = (firstDay + daysInMonth) % 7;
      if (rem > 0) for (let d = 1; d <= 7 - rem; d++)
        html += `<button class="calendar-day calendar-day--other" disabled>${d}</button>`;

      html += '</div></div>';
    }

    this.container.innerHTML = html;

    this.container.querySelectorAll('[data-action="prev"]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onPrev(); }));
    this.container.querySelectorAll('[data-action="next"]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onNext(); }));
    this.container.querySelectorAll('[data-date]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onDateClick(el.dataset.date); }));
    this.container.querySelectorAll('[data-week-start]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onWeekClick(el.dataset.weekStart); }));
  }

}

function getWeekNumber(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getWeekRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay() || 7;
  const start = new Date(d);
  start.setDate(d.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [formatDateLocal(start), formatDateLocal(end)];
}

function getMonthRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [formatDateLocal(start), formatDateLocal(end)];
}

/** 日期范围选择器 */
export function initDateRangePicker() {
  const sidebar = document.getElementById('drpSide');
  const btn = document.getElementById('drpBtn');
  const popup = document.getElementById('drpPop');
  const calendarsContainer = document.getElementById('drpCalendars');
  if (!sidebar || !btn || !popup) return;

  const maxSelectableDate = latestSelectableDate();
  let rangeStart = state.dateStart > maxSelectableDate ? maxSelectableDate : state.dateStart;
  let rangeEnd = state.dateEnd > maxSelectableDate ? maxSelectableDate : state.dateEnd;
  let selecting = false;

  const endDate = new Date(rangeEnd);
  let leftYear = endDate.getFullYear();
  let leftMonth = endDate.getMonth() - 1;
  if (leftMonth < 0) { leftMonth = 11; leftYear--; }
  let rightYear = endDate.getFullYear();
  let rightMonth = endDate.getMonth();

  function updateLabel() {
    const granularityName = DATE_SHORTCUTS.find((x) => x.key === state.analysisGranularity)?.name || '分日';
    let rangeText = `${rangeStart} <span class="date-picker__divider">~</span> ${rangeEnd}`;
    if (state.analysisGranularity === 'week') {
      const startDate = new Date(`${rangeStart}T00:00:00`);
      const endDate = new Date(`${rangeEnd}T00:00:00`);
      rangeText = `${startDate.getFullYear()}年第${getWeekNumber(startDate)}周 <span class="date-picker__divider">~</span> ${endDate.getFullYear()}年第${getWeekNumber(endDate)}周`;
    } else if (state.analysisGranularity === 'month') {
      const startDate = new Date(`${rangeStart}T00:00:00`);
      const endDate = new Date(`${rangeEnd}T00:00:00`);
      rangeText = `${startDate.getFullYear()}年${startDate.getMonth() + 1}月 <span class="date-picker__divider">~</span> ${endDate.getFullYear()}年${endDate.getMonth() + 1}月`;
    }
    document.getElementById('drpLabel').innerHTML =
      `${rangeText} <span class="date-picker__divider">·</span> ${granularityName}`;
  }



  function getRangeState(dateStr) {
    const r = {};
    if (dateStr === rangeStart && dateStr === rangeEnd) { r.selected = true; r.rangeStart = true; r.rangeEnd = true; }
    else if (dateStr === rangeStart) r.rangeStart = true;
    else if (dateStr === rangeEnd) r.rangeEnd = true;
    else if (rangeStart && rangeEnd && dateStr > rangeStart && dateStr < rangeEnd) r.inRange = true;
    return r;
  }

  function onWeekClick(weekStartStr) {
    const [start, end] = getWeekRange(weekStartStr);
    if (end > maxSelectableDate) return;
    if (!selecting) {
      rangeStart = start;
      rangeEnd = end;
      selecting = true;
    } else {
      if (start < rangeStart) {
        rangeEnd = rangeEnd || end;
        rangeStart = start;
      } else {
        rangeEnd = end;
      }
      selecting = false;
    }
    updateLabel();
    state.setDateStartEnd(rangeStart, rangeEnd);
    renderCalendars();
  }

  function onDateClick(dateStr) {
    if (dateStr > maxSelectableDate) return;
    if (!selecting) { rangeStart = dateStr; rangeEnd = dateStr; selecting = true; }

    else {
      if (dateStr < rangeStart) { rangeEnd = rangeStart; rangeStart = dateStr; }
      else rangeEnd = dateStr;
      selecting = false;
      updateLabel();
      state.setDateStartEnd(rangeStart, rangeEnd);
    }
    renderCalendars();
  }


  function goLeft(delta) {
    leftMonth += delta;
    if (leftMonth > 11) { leftMonth = 0; leftYear++; }
    if (leftMonth < 0) { leftMonth = 11; leftYear--; }
    rightMonth = leftMonth + 1;
    rightYear = leftYear;
    if (rightMonth > 11) { rightMonth = 0; rightYear++; }
    renderCalendars();
  }

  function renderMonthPicker() {
    const activeYear = rightYear;
    const months = Array.from({ length: 12 }, (_, i) => i);
    calendarsContainer.innerHTML = `
      <div class="month-panel">
        <div class="calendar-panel__header">
          <button class="calendar-panel__nav calendar-panel__nav--prev" data-action="year-prev">${ICONS.chevronLeft}</button>
          <span class="calendar-panel__title">${activeYear}年</span>
          <button class="calendar-panel__nav calendar-panel__nav--next" data-action="year-next">${ICONS.chevronRight}</button>
        </div>
        <div class="month-panel__grid">
          ${months.map((m) => {
      const start = `${activeYear}-${String(m + 1).padStart(2, '0')}-01`;
      const end = formatDateLocal(new Date(activeYear, m + 1, 0));
      const disabled = end > maxSelectableDate;
      const selected = rangeStart === start && rangeEnd === end;
      const inRange = rangeStart && rangeEnd && start >= rangeStart && end <= rangeEnd;
      const isStart = rangeStart === start;
      const isEnd = rangeEnd === end;
      const cls = ['month-panel__item', selected ? 'is-selected' : '', inRange ? 'is-in-range' : '', isStart ? 'is-range-start' : '', isEnd ? 'is-range-end' : '', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ');
      return `<button class="${cls}" ${disabled ? 'disabled' : `data-month="${m}"`}>${m + 1}月</button>`;
    }).join('')}
        </div>
      </div>`;

    calendarsContainer.querySelector('[data-action="year-prev"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      rightYear -= 1;
      leftYear = rightYear - 1;
      renderMonthPicker();
    });
    calendarsContainer.querySelector('[data-action="year-next"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      rightYear += 1;
      leftYear = rightYear - 1;
      renderMonthPicker();
    });
    calendarsContainer.querySelectorAll('[data-month]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = Number(el.dataset.month);
        const start = formatDateLocal(new Date(activeYear, m, 1));
        const end = formatDateLocal(new Date(activeYear, m + 1, 0));
        if (!selecting) {
          rangeStart = start;
          rangeEnd = end;
          selecting = true;
        } else {
          if (start < rangeStart) {
            rangeEnd = rangeEnd || end;
            rangeStart = start;
          } else {
            rangeEnd = end;
          }
          selecting = false;
        }
        updateLabel();
        state.setDateStartEnd(rangeStart, rangeEnd);
        renderMonthPicker();
      });
    });
  }

  function renderCalendars() {
    if (!calendarsContainer) return;
    if (state.analysisGranularity === 'month') {
      renderMonthPicker();
      return;
    }

    calendarsContainer.innerHTML = '<div id="calLeft"></div><div id="calRight"></div>';
    new CalendarPanel(document.getElementById('calLeft'), leftYear, leftMonth, {
      showNav: 'prev',
      granularity: state.analysisGranularity,
      maxDate: maxSelectableDate,
      onDateClick,
      onWeekClick,
      getRangeState,
      onPrev: () => goLeft(-1),
    });
    new CalendarPanel(document.getElementById('calRight'), rightYear, rightMonth, {
      showNav: 'next',
      granularity: state.analysisGranularity,
      maxDate: maxSelectableDate,
      onDateClick,
      onWeekClick,
      getRangeState,
      onNext: () => goLeft(1),
    });
  }


  DATE_SHORTCUTS.forEach((shortcut) => {
    const item = document.createElement('div');
    item.className = 'date-picker__option' + (state.analysisGranularity === shortcut.key ? ' is-active' : '');
    item.textContent = shortcut.name;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.querySelectorAll('.date-picker__option').forEach((el) => el.classList.remove('is-active'));
      item.classList.add('is-active');
      state.setAnalysisGranularity(shortcut.key);
      if (shortcut.key === 'week') {
        [rangeStart, rangeEnd] = getWeekRange(rangeEnd);
      } else if (shortcut.key === 'month') {
        [rangeStart, rangeEnd] = getMonthRange(rangeEnd);
        const endDate = new Date(`${rangeEnd}T00:00:00`);
        rightYear = endDate.getFullYear();
        leftYear = rightYear - 1;
      }
      selecting = false;
      updateLabel();
      state.setDateStartEnd(rangeStart, rangeEnd);
      renderCalendars();
    });
    sidebar.appendChild(item);
  });


  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.toggle('is-visible');
    if (popup.classList.contains('is-visible')) renderCalendars();
  });

  // 确定按钮
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'date-picker__confirm';
  confirmBtn.textContent = '确定';
  confirmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.setDateStartEnd(rangeStart, rangeEnd);
    popup.classList.remove('is-visible');
  });
  popup.appendChild(confirmBtn);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.date-picker')) popup.classList.remove('is-visible');
  });

  updateLabel();
}

/** 游戏选择器 */
export function initGameSelector() {
  const chipsContainer = document.getElementById('gameChips');
  const dropdown = document.getElementById('gdd');
  const searchInput = document.getElementById('gsearch');
  if (!chipsContainer || !dropdown) return;

  function renderChips() {
    chipsContainer.querySelectorAll('.game-chip').forEach((el) => el.remove());
    const ph = document.getElementById('gph');
    if (!state.selectedGames.length) { ph.style.display = ''; return; }
    ph.style.display = 'none';
    state.selectedGames.forEach((game) => {
      const chip = document.createElement('span');
      chip.className = 'game-chip';
      chip.innerHTML = `${escapeHtml(game)}<span class="game-chip__remove">&times;</span>`;
      chip.querySelector('.game-chip__remove').addEventListener('click', (e) => {
        e.stopPropagation(); state.removeGame(game); renderChips(); renderList();
      });
      chipsContainer.insertBefore(chip, ph);
    });
  }

  function renderList(filter = '') {
    const list = document.getElementById('glist');
    if (!list) return;
    list.innerHTML = '';
    // allTopics 已按播放量排序
    state.allTopics.filter((t) => t.toLowerCase().includes(filter.toLowerCase())).forEach((topic) => {
      const sel = state.selectedGames.includes(topic);
      const item = document.createElement('div');
      item.className = 'game-dropdown__item' + (sel ? ' is-selected' : '');
      item.innerHTML = `<span class="game-dropdown__item-check">${sel ? '✓' : ''}</span>${escapeHtml(topic)}`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        sel ? state.removeGame(topic) : state.addGame(topic);
        renderChips(); renderList(filter);
      });
      list.appendChild(item);
    });
  }

  chipsContainer.addEventListener('click', (e) => {
    if (e.target.closest('.game-chip__remove')) return;
    dropdown.classList.toggle('is-visible');
    if (dropdown.classList.contains('is-visible') && searchInput) searchInput.focus();
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => renderList(searchInput.value));
    searchInput.addEventListener('click', (e) => e.stopPropagation());
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.game-selector')) dropdown.classList.remove('is-visible');
  });

  state.subscribe(() => renderChips());
  renderChips();
  renderList();
}

/** header 日期 */
export function initHeaderDate() {
  const el = document.getElementById('hdrDate');
  if (el) {
    el.textContent = `数据截至 ${latestSelectableDate()}`;
  }
}
