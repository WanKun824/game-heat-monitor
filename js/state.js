/**
 * 应用全局状态管理 - 平台支持多选
 */
import { getAllTopicsSorted, DATES, latestSelectableDate } from './data.js';

class AppState {
  constructor() {
    this._selectedGames = ['和平精英', '王者荣耀', '蛋仔派对', '三角洲行动', '暗区突围'];
    this._selectedPlatforms = ['douyin'];

    const end = latestSelectableDate();
    this._dateRange = 'latest';
    this._dateStart = end;
    this._dateEnd = end;


    this._rankPlatform = 'douyin';
    this._rankSortBy = 'volume';
    this._rankCompany = '';
    this._rankCategory = '';
    this._rankGames = []; // 游戏多选筛选

    // 图表分析控制
    this._analysisGranularity = 'day'; // day | week | month
    this._trendCurve = 'raw'; // raw | derivative | log | log_derivative
    this._growthView = 'rate'; // rate | increment

    this._allTopics = getAllTopicsSorted();
    this._listeners = [];
  }

  get selectedGames() { return this._selectedGames; }
  get selectedPlatforms() { return this._selectedPlatforms; }
  get dateRange() { return this._dateRange; }
  get dateStart() { return this._dateStart; }
  get dateEnd() { return this._dateEnd; }
  get rankPlatform() { return this._rankPlatform; }
  get rankSortBy() { return this._rankSortBy; }
  get rankCompany() { return this._rankCompany; }
  get rankCategory() { return this._rankCategory; }
  get rankGames() { return this._rankGames; }
  get analysisGranularity() { return this._analysisGranularity; }
  get trendCurve() { return this._trendCurve; }
  get growthView() { return this._growthView; }
  get allTopics() { return this._allTopics; }

  getDisplayGames(fallbackCount = 5) {
    return this._selectedGames.length > 0
      ? this._selectedGames
      : this._allTopics.slice(0, fallbackCount);
  }

  setSelectedGames(games) {
    this._selectedGames = [...games];
    this._notify();
  }

  addGame(game) {
    if (!this._selectedGames.includes(game)) {
      this._selectedGames.push(game);
      this._notify();
    }
  }

  removeGame(game) {
    this._selectedGames = this._selectedGames.filter((g) => g !== game);
    this._notify();
  }

  togglePlatform(platformKey) {
    const idx = this._selectedPlatforms.indexOf(platformKey);
    if (idx >= 0) {
      if (this._selectedPlatforms.length > 1) {
        this._selectedPlatforms.splice(idx, 1);
      }
    } else {
      this._selectedPlatforms.push(platformKey);
    }
    this._notify();
  }

  isPlatformSelected(platformKey) {
    return this._selectedPlatforms.includes(platformKey);
  }

  setDateRange(range) {
    this._dateRange = range;
    if (range === 'all') {
      this._dateStart = DATES[0];
      this._dateEnd = DATES[DATES.length - 1];
    }
    this._notify();
  }

  setDateStartEnd(start, end) {
    this._dateStart = start;
    this._dateEnd = end;
    this._dateRange = 'custom';
    this._notify();
  }

  setRankPlatform(platform) {
    this._rankPlatform = platform;
    this._notifyRankOnly();
  }

  setRankSortBy(sortBy) {
    this._rankSortBy = sortBy;
    this._notifyRankOnly();
  }

  setRankCompany(company) {
    this._rankCompany = company || '';
    this._notifyRankOnly();
  }

  setRankCategory(category) {
    this._rankCategory = category || '';
    this._notifyRankOnly();
  }

  setRankGames(games) {
    this._rankGames = games || [];
    this._notifyRankOnly();
  }

  toggleRankGame(game) {
    const idx = this._rankGames.indexOf(game);
    if (idx >= 0) {
      this._rankGames = this._rankGames.filter((g) => g !== game);
    } else {
      this._rankGames = [...this._rankGames, game];
    }
    this._notifyRankOnly();
  }

  setAnalysisGranularity(granularity) {
    this._analysisGranularity = granularity;
    this._notify();
  }

  setTrendCurve(curve) {
    this._trendCurve = curve;
    this._notify();
  }

  setGrowthView(view) {
    this._growthView = view;
    this._notify();
  }

  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  _notify() {
    this._listeners.forEach((fn) => fn('all'));
  }

  _notifyRankOnly() {
    this._listeners.forEach((fn) => fn('rank'));
  }
}

export const state = new AppState();
