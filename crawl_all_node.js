// 跑四平台热榜: 抖音/快手短视频/B站(all+game)/微博
const playwright = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTDIR = path.join(__dirname, 'hot_list_output');
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR);

const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

// 全局排除词：命中的标题不写入热榜与归档
const EXCLUDED_TITLES = new Set([
  '首批2名外籍航天员为巴基斯坦籍',
  '首位外籍航天员将进入中国空间站',
]);

function isExcludedTitle(title) {
  const t = String(title || '').trim();
  return t && EXCLUDED_TITLES.has(t);
}


function parseViewCount(s) {
  if (!s) return 0;
  s = String(s);
  if (s.includes('万')) return parseFloat(s) * 10000;
  if (s.includes('亿')) return parseFloat(s) * 100000000;
  return parseInt(s) || 0;
}
function formatCount(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

// ============ 抖音热榜 ============
async function crawlDouyin() {
  console.log('\n[抖音] 开始爬取...');
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://www.douyin.com/hot', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const data = await page.evaluate(() => {
      const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

      // 优先使用结构化节点（class 可能变，但语义结构基本稳定：rank + h3 + heat）
      const hotItems = Array.from(document.querySelectorAll('li')).filter(el => {
        const titleNode = el.querySelector('h3');
        const rankNode = el.querySelector('.CjXX0j55, [class*=listStyle], [class*=rank], [class*=index], [class*=num]');
        const heatNode = el.querySelector('.WreZoKD3, [class*=heat], [class*=hot]');
        const text = normalize(el.textContent);
        return !!titleNode && (!!heatNode || text.includes('热度')) && !!rankNode;
      });

      const results = [];
      hotItems.forEach((el, idx) => {
        const text = normalize(el.textContent);
        const title = normalize(el.querySelector('h3')?.textContent);
        if (!title) return;

        // rank：优先取独立 rank 节点，避免把标题数字拼进序号（如 43 + 2026 => 432026）
        let rank = '置顶';
        const rankRaw = normalize(el.querySelector('.CjXX0j55, [class*=listStyle], [class*=rank], [class*=index], [class*=num]')?.textContent);
        const rankMatch = rankRaw.match(/^([1-9]\d?)/);
        if (rankMatch) rank = rankMatch[1];

        // heat：优先取独立 heat 节点，避免把标题尾号拼进热度（如 0426 + 481.4万）
        let heat = '-';
        const heatRaw = normalize(el.querySelector('.WreZoKD3, [class*=heat], [class*=hot]')?.textContent);
        const heatRawMatch = heatRaw.match(/(\d+(?:\.\d+)?)\s*(亿|万)/);
        if (heatRawMatch) {
          heat = `${heatRawMatch[1]}${heatRawMatch[2]}`;
        } else {
          // 兜底：从全文本中提取靠近“热度”的数值
          const m = text.match(/(\d{1,4}(?:\.\d+)?)\s*(亿|万)\s*热度/);
          if (m) heat = `${m[1]}${m[2]}`;
        }

        if (rank !== '置顶') {
          const rv = parseInt(rank, 10);
          if (!Number.isFinite(rv) || rv <= 0 || rv > 99) rank = String(idx + 1);
        }

        const href = el.querySelector('a[href]')?.getAttribute('href') || '';
        const url = href ? (href.startsWith('http') ? href : location.origin + href) : '';
        results.push({ rank, title, heat, url });
      });

      return results.slice(0, 50);
    });
    console.log(`[抖音] 捕获 ${data.length} 条`);
    return data;
  } finally {
    await browser.close();
  }
}

// ============ 快手热榜（首页「快手热榜」模块 DOM 抓取，翻页取全） ============
async function crawlKuaishou() {
  console.log('\n[快手] 开始爬取热榜...');
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  try {
    // 首页热榜模块为服务端渲染，需带上反自动化伪装，否则无头环境拿不到内容
    await page.goto('https://www.kuaishou.com/?isHome=1&source=NewReco', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.waitForSelector('h2:has-text("快手热榜")', { timeout: 25000 }).catch(() => {});

    // 逐页点击「下一页」，最多 8 页
    const items = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const findBox = () => {
        const h2 = [...document.querySelectorAll('h2')].find(e => e.textContent.trim() === '快手热榜');
        if (!h2) return null;
        let box = h2.parentElement, g = 0;
        while (box && box.querySelectorAll('a[href*="/search/"]').length < 5 && g++ < 8) {
          box = box.parentElement;
        }
        return box;
      };
      const grab = () => {
        const box = findBox();
        if (!box) return { items: [], next: null };
        const rows = [];
        box.querySelectorAll('a[href*="/search/"]').forEach(a => {
          const inner = a.closest('div');
          const cont = inner ? inner.parentElement : null;
          const rankEl = cont ? cont.querySelector('h3') : null;
          let heat = '';
          if (inner) {
            const c = [...inner.children].map(e => e.textContent.trim()).find(t => /热度$/.test(t));
            if (c) heat = c;
          }
          rows.push({
            rank: rankEl ? rankEl.textContent.trim() : '',
            title: a.textContent.trim(),
            heat,
            url: a.href,
          });
        });
        const root = box.parentElement;
        const btns = root ? [...root.querySelectorAll('button')] : [];
        return { items: rows, next: btns.length ? btns[btns.length - 1] : null };
      };

      const out = [], seen = new Set();
      for (let p = 0; p < 8; p++) {
        if (p) await sleep(1800);
        const r = grab();
        r.items.forEach(it => {
          const k = it.rank + '|' + it.title;
          if (it.title && !seen.has(k)) { seen.add(k); out.push(it); }
        });
        if (!r.next || r.next.disabled) break;
        r.next.click();
      }
      return out;
    });

    // rank 0 为置顶位（无热度），与抖音保持一致标记为「置顶」
    const data = items
      .filter(it => it.title)
      .slice(0, 51)
      .map(it => {
        let rank = String(it.rank || '').trim();
        const n = parseInt(rank, 10);
        if (rank === '0' || !Number.isFinite(n)) rank = '置顶';
        let heat = '-';
        const m = String(it.heat || '').match(/(\d+(?:\.\d+)?)\s*(亿|万)/);
        if (m) heat = `${m[1]}${m[2]}`;
        return { rank, title: it.title, heat, url: it.url || '', tags: [] };
      });

    console.log(`[快手] 捕获 ${data.length} 条`);
    return data;
  } finally {
    await browser.close();
  }
}

// ============ B站排行榜（all + game） ============
async function crawlBilibili(category, label) {
  console.log(`\n[B站-${label}] 开始爬取...`);
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const evaluateList = () => {
      const items = document.querySelectorAll('.rank-item, li.rank-item, .rank-list li');
      const results = [];
      const parseLocalCount = (s) => {
        if (!s) return 0;
        const t = String(s);
        if (t.includes('亿')) return parseFloat(t) * 100000000;
        if (t.includes('万')) return parseFloat(t) * 10000;
        return parseInt(t, 10) || 0;
      };
      items.forEach((el, idx) => {
        const rankEl = el.querySelector('.num, .rank-num');
        const titleEl = el.querySelector('.title, a.title');
        const authorEl = el.querySelector('.up-name, .name');
        const statsEl = el.querySelector('.detail, .data-box, .stats');
        const rank = rankEl?.textContent?.trim() || String(idx + 1);
        const title = titleEl?.textContent?.trim() || '';
        const author = authorEl?.textContent?.trim() || '-';
        const url = titleEl?.href ? new URL(titleEl.href, location.origin).href : '';
        const statsText = statsEl?.textContent?.trim() || '';
        // 兼容 B 站 DOM：detail 里可能混有 UP 主名、播放量、弹幕等多个数字
        // 规则：先去掉 author 文本，再提取所有“万/亿”数字，取数值最大的作为播放量
        let play = '-';
        const cleanedStats = author ? statsText.replaceAll(author, ' ') : statsText;
        const numMatches = [...cleanedStats.matchAll(/([\d.]+)\s*(亿|万)/g)].map(m => `${m[1]}${m[2]}`);
        if (numMatches.length) {
          let best = numMatches[0];
          let bestVal = parseLocalCount(best);
          for (const n of numMatches.slice(1)) {
            const v = parseLocalCount(n);
            if (v > bestVal) { best = n; bestVal = v; }
          }
          play = best;
        }
        if (title) results.push({ rank, title, author, heat: play, url, tags: [] });
      });
      return results;
    };

    // 反爬重试：B 站对连续请求限流，捕获 0 条时等待后重试
    let data = [];
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await page.goto(`https://www.bilibili.com/v/popular/rank/${category}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      data = await page.evaluate(evaluateList);
      if (data.length > 0) break;
      console.log(`[B站-${label}] 第 ${attempt + 1} 次捕获 0 条，8s 后重试...`);
      await page.waitForTimeout(8000);
    }

    // 深度抓取：进入视频页补全标签字段（用于游戏识别）
    const fetchVideoTags = async (videoUrl) => {
      if (!videoUrl) return [];
      const p = await browser.newPage();
      try {
        await p.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await p.waitForTimeout(1200);
        const tags = await p.evaluate(() => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const set = new Set();

          const nodes = document.querySelectorAll(
            '.tag-area a, .video-tag-container a, .tag-panel a, a.tag-link, [class*=tag] a, a[href*="/v/topic/"]'
          );
          nodes.forEach(n => {
            const t = norm(n.textContent).replace(/^#/, '');
            if (t && t.length <= 30 && !/查看更多|收起|举报|投诉/.test(t)) set.add(t);
          });

          const kw = document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
          kw.split(',').map(s => norm(s).replace(/^#/, '')).forEach(t => {
            if (t && t.length <= 30) set.add(t);
          });

          return Array.from(set).slice(0, 20);
        });
        return tags;
      } catch (e) {
        return [];
      } finally {
        await p.close();
      }
    };

    const targets = data.filter(it => it.url);
    let cursor = 0;
    const CONCURRENCY = Math.min(4, targets.length || 1);
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < targets.length) {
        const i = cursor++;
        targets[i].tags = await fetchVideoTags(targets[i].url);
      }
    });
    await Promise.all(workers);

    const tagged = targets.filter(it => (it.tags || []).length > 0).length;
    console.log(`[B站-${label}] 捕获 ${data.length} 条，补全标签 ${tagged} 条`);
    return data;
  } finally {
    await browser.close();
  }
}

// ============ 微博热搜 ============
async function crawlWeibo() {
  console.log('\n[微博] 开始爬取...');
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://s.weibo.com/top/summary', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
    const data = await page.evaluate(() => {
      const items = document.querySelectorAll('#pl_top_realtimehot tbody tr');
      const results = [];
      items.forEach(el => {
        const rank = el.querySelector('td:first-child')?.textContent?.trim() || '';
        const titleEl = el.querySelector('td:nth-child(2) a') || el.querySelector('.td-02 a');
        const title = titleEl?.textContent?.trim() || '';
        const heatEl = el.querySelector('td:nth-child(2) span') || el.querySelector('.td-02 span');
        const heat = heatEl?.textContent?.trim() || '-';
        const tagEl = el.querySelector('td:nth-child(3)');
        const tag = tagEl?.textContent?.trim() || '';
        if (title && rank) results.push({ rank, title, heat, tag });
      });
      return results;
    });
    console.log(`[微博] 捕获 ${data.length} 条`);
    return data;
  } finally {
    await browser.close();
  }
}

// ============ 保存 ============
function saveFile(prefix, header, cols, data) {
  const ts = nowStamp();
  const filtered = (data || []).filter(it => !isExcludedTitle(it?.title));
  // 构造 MD
  const mdLines = [`# ${header}`, '', `> 爬取时间：${ts}`, '', cols];
  filtered.forEach(it => {
    if (prefix.startsWith('bilibili')) {
      mdLines.push(`| ${it.rank} | ${it.title} | ${it.author || '-'} | ${it.heat} |`);
    } else if (prefix === 'weibo') {
      mdLines.push(`| ${it.rank} | ${it.title} | ${it.heat} | ${it.tag || '-'} |`);
    } else {
      mdLines.push(`| ${it.rank} | ${it.title} | ${it.heat} |`);
    }
  });
  fs.writeFileSync(path.join(OUTDIR, `${prefix}_hot_list.md`), mdLines.join('\n') + '\n', 'utf8');

  // 构造 JSON
  const jsonObj = {
    platform: header,
    timestamp: ts,
    crawlTime: new Date().toISOString(),
    items: filtered,
  };
  fs.writeFileSync(path.join(OUTDIR, `${prefix}_hot_list.json`), JSON.stringify(jsonObj, null, 2), 'utf8');

  const removed = (data?.length || 0) - filtered.length;
  console.log(`  [保存] ${prefix}_hot_list.md / .json (${filtered.length} 条${removed > 0 ? `, 已过滤 ${removed} 条` : ''})`);
}


// ============ 游戏关键词（与前端 game-hot-list.html 保持一致） ============
const GAME_DICT = [
  { name: '原神', aliases: ['原神', '派蒙'] },
  { name: '元梦之星', aliases: ['元梦之星'] },
  { name: '永劫无间手游', aliases: ['永劫无间手游'] },
  { name: '异环', aliases: ['异环'] },
  { name: '英雄联盟手游', aliases: ['英雄联盟手游', 'LOL手游'] },
  { name: '燕云十六声', aliases: ['燕云十六声'] },
  { name: '无畏契约：源能行动', aliases: ['无畏契约：源能行动', '无畏契约:源能行动', '源能行动'] },
  { name: '无畏契约', aliases: ['无畏契约', 'Valorant'] },
  { name: '我的世界', aliases: ['我的世界', 'Minecraft'] },
  { name: '王者荣耀世界', aliases: ['王者荣耀世界'] },
  { name: '王者万象棋', aliases: ['王者万象棋'] },
  { name: '王者荣耀', aliases: ['王者荣耀', '王者', '敖丙', '敖隐'] },
  { name: '使命召唤手游', aliases: ['使命召唤手游', 'COD手游'] },
  { name: '三角洲行动', aliases: ['三角洲行动', '三角洲', '红狼', '零号大坝', '麦小鼠', '洲彦祖'] },

  { name: '七日世界', aliases: ['七日世界'] },
  { name: '逆战：未来', aliases: ['逆战：未来', '逆战:未来', '逆战未来'] },
  { name: '逆水寒手游', aliases: ['逆水寒手游'] },
  { name: '鸣潮', aliases: ['鸣潮'] },
  { name: '明日方舟：终末地', aliases: ['明日方舟：终末地', '明日方舟:终末地', '明日方舟终末地', '终末地'] },
  { name: '明日方舟', aliases: ['明日方舟'] },
  { name: '洛克王国世界', aliases: ['洛克王国世界', '洛克王国'] },
  { name: '绝区零', aliases: ['绝区零'] },
  { name: '金铲铲之战', aliases: ['金铲铲之战', '金铲铲'] },
  { name: '火影忍者手游', aliases: ['火影忍者手游', '火影手游'] },
  { name: '和平精英', aliases: ['和平精英'] },
  { name: '光遇', aliases: ['光遇'] },
  { name: '第五人格', aliases: ['第五人格'] },
  { name: '蛋仔派对', aliases: ['蛋仔派对', '蛋仔'] },
  { name: '穿越火线：枪战王者', aliases: ['穿越火线：枪战王者', '穿越火线:枪战王者', '穿越火线枪战王者', 'CF手游'] },
  { name: '穿越火线', aliases: ['穿越火线', 'CF'] },
  { name: '超自然行动组', aliases: ['超自然行动组'] },
  { name: '崩坏：星穹铁道', aliases: ['崩坏：星穹铁道', '崩坏:星穹铁道', '崩坏星穹铁道', '崩铁', '星穹铁道', '星铁'] },
  { name: '暗区突围', aliases: ['暗区突围'] },
  { name: 'QQ飞车手游', aliases: ['QQ飞车手游', 'QQ飞车'] },
  { name: 'PUBG', aliases: ['PUBG', '绝地求生'] },
  { name: '地下城与勇士：起源', aliases: ['地下城与勇士：起源', '地下城与勇士:起源', '地下城与勇士起源', 'DNF手游', '地下城起源'] }
];
const MATCH_ENTRIES = GAME_DICT
  .flatMap(g => g.aliases.map(a => ({ name: g.name, alias: a })))
  .sort((a, b) => b.alias.length - a.alias.length);

function detectGames(title, author = '') {
  const text = `${title || ''} ${author || ''}`;
  if (!text.trim()) return [];
  const found = new Set();
  const hits = [];
  for (const e of MATCH_ENTRIES) {
    if (text.includes(e.alias)) {
      found.add(e.name);
      hits.push(e);
    }
  }
  // 子串互斥：当命中更具体的别名（如"王者万象棋""明日方舟终末地"）时，
  // 剔除被其包含的父话题（如"王者荣耀""明日方舟"），避免把子话题误判成父话题
  for (const e of hits) {
    for (const o of hits) {
      if (e.name === o.name) continue;
      if (o.alias.length > e.alias.length && o.alias.includes(e.alias)) {
        found.delete(e.name);
      }
    }
  }
  return Array.from(found);
}

// ============ 归档：按天保存游戏相关快照（同日合并去重） ============
function archiveSnapshot() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const snapshotId = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; // YYYYMMDD
  const archiveRoot = path.join(OUTDIR, 'archive');
  const snapshotDir = path.join(archiveRoot, snapshotId);
  if (!fs.existsSync(archiveRoot)) fs.mkdirSync(archiveRoot);
  if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir);

  const platformKeys = ['douyin', 'kuaishou', 'bilibili', 'bilibili_game', 'weibo'];
  const summary = [];
  platformKeys.forEach(k => {
    const src = path.join(OUTDIR, `${k}_hot_list.json`);
    if (!fs.existsSync(src)) return;
    let srcJson;
    try { srcJson = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { return; }
    // 只保留游戏相关条目
    const gameItems = (srcJson.items || [])
      .map(it => ({ ...it, _games: detectGames(it.title || '', it.author || '') }))
      .filter(it => it._games.length > 0);

    const dst = path.join(snapshotDir, `${k}.json`);
    // 合并当天已有条目，按 title 去重（保留最早一条）
    let merged = [];
    if (fs.existsSync(dst)) {
      try {
        const old = JSON.parse(fs.readFileSync(dst, 'utf8'));
        merged = (old.items || []).filter(it => !isExcludedTitle(it?.title));
      } catch (e) { merged = []; }
    }
    const seen = new Set(merged.map(it => (it.title || '').trim()));

    gameItems.forEach(it => {
      const key = (it.title || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push({
        rank: it.rank,
        title: it.title,
        heat: it.heat,
        author: it.author,
        url: it.url,
        tags: it.tags,
        viewCount: it.viewCount,
        tag: it.tag,
        games: it._games,
        firstSeenAt: new Date().toISOString(),
      });
    });

    const out = {
      platform: srcJson.platform,
      date: dateStr,
      lastUpdated: new Date().toISOString(),
      total: merged.length,
      items: merged,
    };
    fs.writeFileSync(dst, JSON.stringify(out, null, 2), 'utf8');
    summary.push(`${k}:${merged.length}(+${gameItems.length})`);
  });

  // 更新索引 index.json（按天一条）
  const indexPath = path.join(archiveRoot, 'index.json');
  let index = { snapshots: [] };
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (e) { index = { snapshots: [] }; }
  }
  index.snapshots = (index.snapshots || []).filter(s => s.id !== snapshotId);
  index.snapshots.push({
    id: snapshotId,
    date: dateStr,
    lastUpdated: new Date().toISOString(),
  });
  index.snapshots.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

  console.log(`  [归档] ${snapshotId} (${dateStr}): ${summary.join(', ')}`);
  console.log(`  [索引] 共 ${index.snapshots.length} 天的历史快照`);
  return snapshotId;
}

// ============ 主流程 ============
(async () => {
  console.log('=== 热榜爬取开始 ===');
  console.log(`时间: ${nowStamp()}`);

  const douyin = await crawlDouyin().catch(e => { console.error('[抖音] 失败:', e.message); return []; });
  saveFile('douyin', '抖音热榜', '| 排名 | 热榜话题 | 热度 |\n|:----:|----------|-----:|', douyin);

  const kuaishou = await crawlKuaishou().catch(e => { console.error('[快手] 失败:', e.message); return []; });
  saveFile('kuaishou', '快手热榜', '| 排名 | 热榜话题 | 热度 |\n|:----:|----------|-----:|', kuaishou);

  const biliAll = await crawlBilibili('all', '全站').catch(e => { console.error('[B站all] 失败:', e.message); return []; });
  saveFile('bilibili', 'B站全站排行榜', '| 排名 | 标题 | UP主 | 播放量 |\n|:----:|----------|------|-----:|', biliAll);

  const biliGame = await crawlBilibili('game', '游戏').catch(e => { console.error('[B站game] 失败:', e.message); return []; });
  saveFile('bilibili_game', 'B站游戏排行榜', '| 排名 | 标题 | UP主 | 播放量 |\n|:----:|----------|------|-----:|', biliGame);

  const weibo = await crawlWeibo().catch(e => { console.error('[微博] 失败:', e.message); return []; });
  saveFile('weibo', '微博热搜', '| 排名 | 热搜话题 | 热度 | 标签 |\n|:----:|----------|-----:|:---:|', weibo);

  console.log('\n=== 归档快照 ===');
  archiveSnapshot();

  console.log('\n=== 全部完成 ===');
  console.log(`输出目录: ${OUTDIR}`);

  // Summary
  console.log('\n概览:');
  console.log(`  抖音         : ${douyin.length} 条`);
  console.log(`  快手热榜     : ${kuaishou.length} 条`);
  console.log(`  B站-全站     : ${biliAll.length} 条`);
  console.log(`  B站-游戏     : ${biliGame.length} 条`);
  console.log(`  微博         : ${weibo.length} 条`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
