/**
 * 热榜爬取 + 健康检查（本地脚本）
 * 1. 跑 crawl_all_node.js 爬 5 平台热榜
 * 2. 跑 check_hotlist_health.py 做数据健康检查
 *
 * 不包含任何部署 / API / 环境变量逻辑。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORK_DIR = __dirname;
const LOG_FILE = path.join(WORK_DIR, 'hotlist_schedule.log');

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

function run(command, maxBuffer) {
  const out = execSync(command, {
    cwd: WORK_DIR,
    encoding: 'utf-8',
    maxBuffer,
  });
  out.split('\n').filter(l => l.trim()).forEach(l => log('  ' + l));
}

function check() {
  run(`python "${path.join(WORK_DIR, 'check_hotlist_health.py')}" --strict`, 8 * 1024 * 1024);
}

async function main() {
  log('===== 热榜爬取+健康检查 开始 =====');

  log('步骤1: 爬取热榜（crawl_all_node.js）');
  try {
    run(`node "${path.join(WORK_DIR, 'crawl_all_node.js')}"`, 32 * 1024 * 1024);
  } catch (e) {
    log('爬取失败/写入前校验未通过');
    const detail = `${e.stdout || ''}${e.stderr || ''}`;
    detail.split('\n').filter(l => l.trim()).forEach(l => log('  ' + l));
    try {
      log('补充巡检（check_hotlist_health.py）');
      check();
    } catch (e2) {
      const d2 = `${e2.stdout || ''}${e2.stderr || ''}`;
      d2.split('\n').filter(l => l.trim()).forEach(l => log('  ' + l));
    }
    process.exit(1);
  }

  log('步骤2: 数据健康巡检（check_hotlist_health.py）');
  try {
    check();
  } catch (e) {
    log('巡检未通过');
    const detail = `${e.stdout || ''}${e.stderr || ''}`;
    detail.split('\n').filter(l => l.trim()).forEach(l => log('  ' + l));
    process.exit(1);
  }

  log('===== 完成 =====\n');
}

main().catch(e => {
  log('FATAL: ' + e.message);
  process.exit(3);
});
