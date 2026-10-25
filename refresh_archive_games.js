/**
 * 刷新近 7 天历史归档的 games 字段。
 * 用与前端 game-hot-list.html 完全一致的 GAME_DICT / detectGames（含 tags）重新识别，
 * 修复历史数据里"王者万象棋/王者荣耀""明日方舟/终末地""洲彦祖/三角洲"等误判残留。
 */
const fs = require('fs');
const path = require('path');

const ARCHIVE = path.join(__dirname, 'hot_list_output', 'archive');

// 与前端 game-hot-list.html 保持一致
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
  { name: '王者荣耀', aliases: ['王者荣耀', '王者', '敖丙', '敖隐', '墨子', '碎光执事'] },
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

function detectGames(title, author = '', tags = []) {
  const tagText = Array.isArray(tags) ? tags.join(' ') : String(tags || '');
  const text = `${title || ''} ${author || ''} ${tagText}`;
  if (!text.trim()) return [];
  const found = new Set();
  const hits = [];
  for (const e of MATCH_ENTRIES) {
    if (text.includes(e.alias)) {
      found.add(e.name);
      hits.push(e);
    }
  }
  // 子串互斥：命中更具体别名时剔除父话题
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

// 近 7 天日期（本地时区，与 archiveSnapshot 命名一致）
const recentDays = [];
for (let i = 0; i < 7; i++) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  recentDays.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
}

let totalFiles = 0;
let totalItems = 0;
let changedItems = 0;

for (const day of recentDays) {
  const dir = path.join(ARCHIVE, day);
  if (!fs.existsSync(dir)) {
    console.log(`[跳过] ${day} 不存在`);
    continue;
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const fp = path.join(dir, f);
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      console.log(`[失败] ${day}/${f}: ${e.message}`);
      continue;
    }
    if (!obj || !Array.isArray(obj.items)) continue;
    totalFiles++;
    for (const it of obj.items) {
      totalItems++;
      const oldGames = it.games;
      const newGames = detectGames(it.title || '', it.author || '', it.tags || []);
      it.games = newGames;
      if (JSON.stringify(oldGames) !== JSON.stringify(newGames)) changedItems++;
    }
    fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
  }
}

console.log(`\n处理完成：近 7 天目录 ${recentDays.join(', ')}`);
console.log(`  文件数: ${totalFiles}`);
console.log(`  条目数: ${totalItems}`);
console.log(`  games 变更条目数: ${changedItems}`);
