/* ==========================================================================
 * 文件：tests/balance.spec.js
 * 作用：数值平衡验证 —— 模拟三类玩家策略，检查是否能在设计文档预期天数内
 *       达成里程碑（对应文档第六章「数值框架与里程碑」的测试要点）。
 * 运行：node tests/balance.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 8935;

function serve() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const full = path.join(ROOT, p);
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);
}

/** 在页面上下文中跑一个简化策略 N 天，每天返回净资产，直到达成里程碑1或超时 */
async function runStrategy(page, strategyFn, maxDays) {
  await page.evaluate(() => { BT.newGame(1); BT.Eco.rollWeather(BT.S); BT.Eco.ensurePriceDay(BT.S); BT.Quests.init(BT.S); });
  const days = await page.evaluate(strategyFn, maxDays);
  return days;
}

(async () => {
  const server = serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#btn-newgame');

  console.log('===== 策略A：纯打工（每天在当前区域做能做的工作，不换区域） =====');
  let result = await runStrategy(page, (maxDays) => {
    for (let d = 0; d < maxDays; d++) {
      var S = BT.S;
      var jobs = BT.Jobs.available(S);
      jobs.forEach(function (j) { if (!S.jobsDoneToday[j.id] && BT.Jobs.canDo(S, j).ok) BT.Jobs.do(S, j.id); });
      BT.Eco.sleep(S);
      if (BT.netWorth(S) >= 1000) return { day: S.day, net: BT.netWorth(S), hit: true };
    }
    return { day: BT.S.day, net: BT.netWorth(BT.S), hit: false };
  }, 40);
  console.log('结果:', JSON.stringify(result));

  console.log('\n===== 策略B：倒买倒卖（批发市场进货，去商业街/码头找高价区卖出） =====');
  result = await runStrategy(page, (maxDays) => {
    for (let d = 0; d < maxDays; d++) {
      var S = BT.S;
      S.region = 'market';
      // 每天用约一半现金进货波动大的商品
      var g = BT.CFG.goodsMap['tea'];
      var price = BT.Eco.buyPrice(S, 'tea', 'market');
      var afford = Math.floor((S.cash * 0.6) / price / g.unit);
      var qty = Math.max(0, Math.min(afford, Math.floor(BT.Trade.bagFree(S) / g.unit)));
      if (qty > 0) BT.Trade.buy(S, 'tea', qty);
      // 卖掉背包里已有的（上一轮买的，在高价区域港口卖）
      S.region = 'port';
      var have = BT.Trade.qtyOf(S, 'tea');
      if (have > 0) BT.Trade.sell(S, 'tea', have);
      BT.Eco.sleep(S);
      if (BT.netWorth(S) >= 1000) return { day: S.day, net: BT.netWorth(S), hit: true };
    }
    return { day: BT.S.day, net: BT.netWorth(BT.S), hit: false };
  }, 40);
  console.log('结果:', JSON.stringify(result));

  console.log('\n===== 策略C：混合（打工攒本金 + 摆摊） =====');
  result = await runStrategy(page, (maxDays) => {
    for (let d = 0; d < maxDays; d++) {
      var S = BT.S;
      S.region = 'market';
      var jobs = BT.Jobs.available(S);
      jobs.forEach(function (j) { if (!S.jobsDoneToday[j.id] && BT.Jobs.canDo(S, j).ok) BT.Jobs.do(S, j.id); });
      if (!S.stall && BT.Trade.bagFree(S) > 5) {
        var price = BT.Eco.buyPrice(S, 'snack', 'market');
        var qty = Math.max(0, Math.min(10, Math.floor(S.cash * 0.3 / price)));
        if (qty > 0) { BT.Trade.buy(S, 'snack', qty); BT.Stall.open(S, 'snack', 1.1); }
      }
      if (S.stall) {
        S.region = S.stall.regionId;
        if (BT.Trade.qtyOf(S, S.stall.goodsId) > 0 && S.hour < 20) BT.Stall.run(S);
      }
      BT.Eco.sleep(S);
      if (BT.netWorth(S) >= 1000) return { day: S.day, net: BT.netWorth(S), hit: true };
    }
    return { day: BT.S.day, net: BT.netWorth(BT.S), hit: false };
  }, 40);
  console.log('结果:', JSON.stringify(result));

  await browser.close();
  server.close();
  console.log('\n设计文档预期：净资产1000应在 15-25 天内达成（参考值，可据此继续调数值）。');
})();
