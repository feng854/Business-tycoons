/* ==========================================================================
 * 文件：tests/smoke.spec.js
 * 作用：Playwright 冒烟测试 —— 启动本地静态服务器，用无头浏览器跑一遍主流程
 * 运行：node tests/smoke.spec.js  （需要已安装 playwright，见 README）
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 8934;

function serve() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const full = path.join(ROOT, p);
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);
}

(async () => {
  const server = serve();
  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    var t = msg.text();
    /* 沙盒测试环境可能无法访问 Google Fonts（被出站代理拦截），这与游戏逻辑无关，
       实际部署到 GitHub Pages 后可以正常加载，CSS 也已设置本地字体回退，忽略即可 */
    if (/fonts\.googleapis|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_REFUSED/.test(t)) return;
    errors.push('[console] ' + t);
  });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#btn-newgame');
  await page.click('#btn-newgame');
  await page.waitForSelector('#game.active');
  console.log('✅ 新游戏启动成功');

  // 顶部状态栏数据检查
  const cash1 = await page.textContent('#tb-cash');
  console.log('初始现金:', cash1);
  if (!cash1.includes('300')) errors.push('初始现金不是300: ' + cash1);

  // 遍历所有导航标签，确保每个页面都能正常渲染（没有JS报错）
  const tabs = ['map', 'trade', 'jobs', 'stall', 'shop', 'biz', 'market', 'quests', 'save'];
  for (const t of tabs) {
    await page.click(`[data-tab="${t}"]`);
    await page.waitForTimeout(150);
    console.log('  已切换到标签:', t);
  }

  // 金融市场：切换股票/期货/外汇三个子标签，并检查K线canvas确实画了东西
  await page.click('[data-tab="market"]');
  for (const mt of ['stock', 'future', 'forex']) {
    await page.click(`[data-mkt-tab="${mt}"]`);
    await page.waitForTimeout(150);
  }
  const instrTitle = await page.textContent('#instr-title');
  console.log('当前标的:', instrTitle);

  // 在交易页买入一些蔬菜
  await page.click('[data-tab="trade"]');
  await page.waitForTimeout(100);
  const buyBtn = await page.$('button[onclick*="buyGoods(\'veg\'"]');
  if (buyBtn) { await buyBtn.click(); await page.waitForTimeout(150); console.log('✅ 买入蔬菜'); }
  else errors.push('找不到买入蔬菜的按钮');

  // 打工
  await page.click('[data-tab="jobs"]');
  await page.waitForTimeout(100);
  const jobBtn = await page.$('.nav-list, #jobs-list button.primary:not(:disabled)');
  const jobBtn2 = await page.$('#jobs-list button.primary:not([disabled])');
  if (jobBtn2) { await jobBtn2.click(); await page.waitForTimeout(150); console.log('✅ 完成一次打工'); }

  // 摆摊：开摊 + 营业一轮
  await page.click('[data-tab="stall"]');
  await page.waitForTimeout(100);
  const stallOpenBtn = await page.$('#stall-box button[onclick*="stallOpen"]');
  if (stallOpenBtn) {
    await stallOpenBtn.click(); await page.waitForTimeout(150);
    const runBtn = await page.$('#stall-box button[onclick*="stallRun"]');
    if (runBtn) { await runBtn.click(); await page.waitForTimeout(150); console.log('✅ 摆摊营业一轮'); }
  } else {
    console.log('ℹ️ 暂无可摆摊商品（打工优先触发的随机流程），跳过摆摊测试');
  }

  // 连续推进 70 天，确认：价格引擎/事件/K线生成/里程碑判定 都不报错，且能产生历史数据
  await page.click('[data-tab="map"]');
  for (let i = 0; i < 70; i++) {
    await page.evaluate(() => { BT.S.cash += 60; BT.Eco.sleep(BT.S); }); /* 补贴现金，避免空转触发破产结局 */
  }
  await page.waitForTimeout(200);
  const day = await page.evaluate(() => BT.S.day);
  const net = await page.evaluate(() => BT.netWorth(BT.S));
  const phase = await page.evaluate(() => BT.S.phase);
  const logCount = await page.evaluate(() => BT.Log.list.length);
  const candleCount = await page.evaluate(() => BT.S.market.stocks.xjhg.hist.length);
  console.log(`✅ 推进到第${day}天，净资产=${net}，阶段=${phase}，日志条数=${logCount}，XJHG K线条数=${candleCount}`);
  if (day < 70) errors.push('天数推进异常: ' + day);
  if (candleCount < 60) errors.push('K线历史数据条数异常: ' + candleCount);

  // 重新渲染金融页，确认长时间运行后图表仍能正常绘制（抓取canvas像素，非全透明即说明画了内容）
  await page.click('[data-tab="market"]');
  await page.waitForTimeout(200);
  const hasPixels = await page.evaluate(() => {
    const c = document.getElementById('instrChart');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  });
  console.log('K线图已渲染像素:', hasPixels);
  if (!hasPixels) errors.push('K线图没有渲染出任何像素');

  // 股票买卖一次（走完整下单流程）
  await page.fill('#trade-qty', '50');
  const buyStockBtn = await page.$('button[onclick="BT.App.marketBuyStock()"]');
  if (buyStockBtn) { await buyStockBtn.click(); await page.waitForTimeout(150); console.log('✅ 买入股票'); }

  // 测试存档/读档往返
  await page.evaluate(() => BT.save());
  const saved = await page.evaluate(() => !!localStorage.getItem('bt_save_v1'));
  if (!saved) errors.push('存档失败，localStorage 中未找到存档');
  await page.reload();
  await page.waitForSelector('#btn-continue');
  const continueVisible = await page.isVisible('#btn-continue');
  if (!continueVisible) errors.push('读档入口未按预期显示（应检测到已有自动存档）');
  await page.click('#btn-continue');
  await page.waitForSelector('#game.active');
  const dayAfterReload = await page.evaluate(() => BT.S.day);
  console.log('✅ 读档成功，读档后天数=', dayAfterReload);
  if (dayAfterReload !== day) errors.push('读档后天数与存档前不一致: ' + dayAfterReload + ' vs ' + day);

  await browser.close();
  server.close();

  console.log('\n========== 测试结果 ==========');
  if (errors.length) {
    console.log('❌ 发现问题 (' + errors.length + ' 项):');
    errors.forEach((e) => console.log('  - ' + e));
    process.exit(1);
  } else {
    console.log('🎉 全部通过，没有发现 JS 报错或逻辑问题');
    process.exit(0);
  }
})();
