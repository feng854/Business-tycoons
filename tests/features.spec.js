/* ==========================================================================
 * 文件：tests/features.spec.js
 * 作用：新功能与后期阶段的回归测试 —— 打工3次/天、旧存档迁移、按路程耗时与地图点击、
 *       破产结局、大订单横幅、仓库调货输入框、大额二次确认、第二/三阶段长期模拟
 * 运行：node tests/features.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 8951;
function serve() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    fs.readFile(path.join(ROOT, p), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(data);
    });
  }).listen(PORT);
}
let fails = 0;
function check(name, ok, extra) { console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; }

(async () => {
  const server = serve(), browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; let dialogs = 0, acceptDialog = true;
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|TUNNEL|CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('dialog', d => { dialogs++; acceptDialog ? d.accept() : d.dismiss(); });
  const fresh = async () => { await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForSelector('#btn-newgame'); await page.click('#btn-newgame'); await page.waitForSelector('#game.active'); };
  await fresh();

  /* 1. 打工每天 3 次 */
  let r = await page.evaluate(() => {
    const S = BT.S, out = [];
    for (let i = 0; i < 4; i++) out.push(BT.Jobs.do(S, 'flyer').ok);
    const cnt = BT.Jobs.doneCount(S, 'flyer'); const pays = S.stats.totalEarned;
    return { out, cnt, pays };
  });
  check('打工：同一份工每天最多 3 次', JSON.stringify(r.out) === '[true,true,true,false]' && r.cnt === 3, JSON.stringify(r.out));
  r = await page.evaluate(() => { BT.Eco.sleep(BT.S); return BT.Jobs.doneCount(BT.S, 'flyer'); });
  check('打工：次日计数清零', r === 0);

  /* 2. 旧存档迁移 */
  await page.evaluate(() => {
    BT.newGame(); const S = BT.S; S.version = 1; S.jobsDoneToday = { flyer: true }; delete S.insolventDays;
    S.biz = { shops: [], warehouses: {}, loans: [{ id: 'l1', remaining: 100 }], creditScore: 650, brand: 10, ledger: [], monthly: [], competitors: { slum: { strength: 0.5 } } };
    localStorage.setItem('bt_save_v1', JSON.stringify(S));
  });
  r = await page.evaluate(() => { BT.S = null; BT.load(); return { c: BT.Jobs.doneCount(BT.S, 'flyer'), v: BT.S.version, late: BT.S.biz.loans[0].lateCount, name: BT.S.biz.competitors.slum.name }; });
  check('旧存档迁移（次数/版本/逾期/竞争对手名）', r.c === 1 && r.v === 4 && r.late === 0 && !!r.name, JSON.stringify(r));

  /* 3. 按路程耗时 + 地图点击前往 */
  await fresh();
  r = await page.evaluate(() => ({ a: BT.CFG.travelHours('slum', 'oldst'), b: BT.CFG.travelHours('slum', 'port'), c: BT.CFG.travelHours('cbd', 'port'), same: BT.CFG.travelHours('cbd', 'cbd') }));
  check('路程耗时表合理（近1h，远≥2h）', r.a >= 1 && r.b >= 2 && r.c >= 2, JSON.stringify(r));
  await page.click('[data-tab="map"]'); await page.waitForTimeout(400);
  const bb = await (await page.$('#mapCanvas')).boundingBox();
  const pos = await page.evaluate(() => BT.MapUI.regionScreenPos('market'));
  const h0 = await page.evaluate(() => BT.S.hour);
  await page.mouse.click(bb.x + pos.x, bb.y + pos.y); await page.waitForTimeout(300);
  r = await page.evaluate(() => ({ reg: BT.S.region, h: BT.S.hour }));
  check('点击地图建筑可前往（批发市场）', r.reg === 'market', JSON.stringify(r) + ' 起始小时=' + h0);
  check('前往耗时与路程一致', r.h - h0 === (await page.evaluate(() => BT.CFG.travelHours('slum', 'market'))));

  /* 4. 大订单横幅 */
  await page.evaluate(() => { BT.Events.pending = { id: 'big_order', text: '测试大订单' }; BT.Bus.emit('changed'); });
  await page.waitForTimeout(200);
  check('大订单横幅显示', await page.isVisible('#event-banner'));
  r = await page.evaluate(() => { const c0 = BT.S.cash; BT.App.acceptBigOrder(); return { dc: BT.S.cash - c0, pend: !!BT.Events.pending }; });
  check('接受大订单后待处理清除', !r.pend, JSON.stringify(r));
  await page.evaluate(() => { BT.Events.pending = { id: 'big_order', text: 'x' }; BT.Bus.emit('changed'); BT.App.declineBigOrder(); });
  check('拒绝大订单', await page.evaluate(() => !BT.Events.pending) && !(await page.isVisible('#event-banner')));

  /* 5. 大额二次确认 */
  dialogs = 0; acceptDialog = false;
  await page.evaluate(() => { const S = BT.S; S.cash = 100; S.region = 'market'; BT.Bus.emit('changed'); });
  await page.click('[data-tab="trade"]'); await page.fill('#qty-veg', '30');
  await page.evaluate(() => BT.App.buyGoods('veg'));
  check('大额买入触发二次确认且取消后不扣款', dialogs >= 1 && (await page.evaluate(() => BT.S.cash)) === 100, 'dialogs=' + dialogs);
  acceptDialog = true;

  /* 6. 破产结局 */
  await fresh();
  r = await page.evaluate(() => { const S = BT.S; for (let i = 0; i < 6; i++) { S.cash = -3000; BT.Eco.sleep(S); if (S.gameOver) return { over: true, day: S.day, inso: S.insolventDays }; } return { over: false }; });
  check('长期资不抵债触发破产', r.over, JSON.stringify(r));
  await page.waitForTimeout(200);
  check('破产遮罩出现', await page.evaluate(() => { BT.Render.all(); return !!document.getElementById('ending-mask'); }));
  await page.evaluate(() => BT.App.restart()); await page.waitForTimeout(200);
  check('重新开始后新游戏', await page.evaluate(() => BT.S.day === 1 && !BT.S.gameOver && !document.getElementById('ending-mask')));

  /* 7. 股票流通盘字段 */
  r = await page.evaluate(() => BT.Market.STOCKS.map(s => [s.ticker, s.float, s.totalShares, s.tier]));
  check('6只股票均设定流通盘/总股本/档位', r.length === 6 && r.every(x => x[1] > 0 && x[2] > x[1] && x[3]), JSON.stringify(r.map(x => x[0] + ':' + x[3])));

  /* 8. 第二/三阶段长期模拟（机器人经营 120 天） */
  await fresh();
  const sim = await page.evaluate(() => {
    const S = BT.S, C = BT.CFG, B = BT.Biz, rep = { problems: [] };
    S.cash = 40000; S.unlockedRegions = C.REGIONS.map(r => r.id); S.milestones = { m1: true, m2: true, m3: true }; S.phase = 2; S.region = 'market';
    B.ensure(S);
    const rids = ['market', 'oldst', 'cbd', 'port'];
    rids.forEach(rid => { const o = B.openShop(S, rid); if (!o.ok) rep.problems.push('开店失败 ' + rid + ': ' + o.msg); });
    S.biz.shops.forEach(sh => { B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'buyer'); });
    const loan = B.takeLoan(S, 5000); rep.loanOk = loan.ok;
    const goods = ['snack', 'drink', 'daily', 'cloth', 'phonecase', 'tea'];
    const nets = [], profits = [];
    let bad = 0;
    for (let d = 0; d < 120; d++) {
      S.biz.shops.forEach(sh => {
        goods.forEach(g => { if ((sh.inventory[g] || 0) < 25) { B.wholesaleBuy(S, sh.regionId, g, 50); B.transferToShop(S, sh.id, g, 50); } B.setShelf(S, sh.id, g, 1.3); });
      });
      if (d === 10) { BT.Market.ensure(S); BT.Market.buyStock(S, 'xjhg', 2000); BT.Market.openFutures(S, 'au', 1, 'long'); BT.Market.openForex(S, 'usd', 1, 'long'); }
      BT.Eco.sleep(S);
      if (S.gameOver) { rep.problems.push('第' + d + '天破产'); break; }
      const nw = BT.netWorth(S); if (!isFinite(nw) || isNaN(S.cash)) { bad++; rep.problems.push('第' + d + '天出现NaN'); break; }
      nets.push(nw);
      const led = S.biz.ledger[S.biz.ledger.length - 1]; if (led) profits.push(led.profit);
    }
    const avg = profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    rep.days = S.day; rep.finalNet = nets[nets.length - 1]; rep.avgDailyProfit = Math.round(avg); rep.shops = S.biz.shops.length;
    rep.credit = S.biz.creditScore; rep.loans = S.biz.loans.length; rep.empireUnlocked = BT.Empire.unlocked(S);
    rep.minNet = Math.min.apply(null, nets);
    return rep;
  });
  console.log('   模拟结果:', JSON.stringify(sim));
  check('第二/三阶段120天模拟无 NaN/崩溃', sim.problems.length === 0, sim.problems.join(';'));
  check('分店平均每日利润在合理区间（0~3000）', sim.avgDailyProfit >= 0 && sim.avgDailyProfit <= 3000, '平均日利润=' + sim.avgDailyProfit);

  /* 新增：地产 / 捐赠 / 结局队列 / 导入导出 / 难度 / 每日挑战 / 快进 / 补货 / 调试审计 */
  const ex = await page.evaluate(() => {
    const o = {};
    BT.App.newGame('hard'); let S = BT.S;
    o.hardCash = S.cash === BT.CFG.DIFFICULTY.hard.startCash;
    BT.App.newGame('normal'); S = BT.S;
    /* 地产 */
    S.cash = 500000; S.biz = null; BT.Biz.ensure(S);
    for (let i = 0; i < 3; i++) S.biz.shops.push({ id: 'x' + i, regionId: ['slum', 'market', 'oldst'][i], shelf: {}, inventory: {}, employees: [], rent: 10, value: 5000, reputation: 50, daysOpen: 1 });
    S.netHist = [];
    o.unlocked = BT.Empire.unlocked(S);
    const before = S.cash; const r1 = BT.Empire.buy(S, 'cbd'); o.buy = r1.ok;
    const nw1 = BT.netWorth(S);
    BT.Eco.sleep(S); o.rent = S.stats.income.estate > 0;
    o.sell = BT.Empire.sell(S, 'cbd').ok;
    const d = BT.Empire.donate(S, 1000); o.donate = d.ok && S.stats.donated === 1000;
    /* 结局队列 */
    S.stats.donated = 60000; BT.Eco.checkEndings(S); o.charity = S.endingQueue.indexOf('charity') >= 0;
    BT.App.keepPlaying(); o.queuePop = S.endingQueue.indexOf('charity') < 0;
    /* 导入导出 */
    const txt = BT.exportSave(); S.cash = 12345; const day = S.day;
    const imp = BT.importSave(txt); o.imp = imp.ok && BT.S.day === day && BT.S.cash !== 12345;
    o.impBad = BT.importSave('garbage').ok === false;
    /* 快进 */
    S = BT.S; S.cash = 5000; BT.Events.pending = null; S.empireOffer = null; S.endingQueue = []; const d0 = S.day; BT.App.fastForward(3); o.ff = S.day >= d0 + 1;
    /* 补货 */
    BT.Biz.ensure(S); S.cash = 20000; const sh = S.biz.shops[0]; if (sh) { sh.shelf.veg = 1.3; o.restock = BT.Biz.autoRestock(S).ok; o.stocked = (sh.inventory.veg || 0) >= 40; }
    /* 每日挑战 */
    BT.App.newDaily(); o.daily = !!BT.S.challenge && BT.S.challenge.seed > 20200101;
    BT.S.day = BT.CFG.DAILY_CHALLENGE_DAYS + 1; BT.Eco.checkEndings(BT.S); o.dailyEnd = BT.S.gameOver && BT.S.gameOver.type === 'challenge';
    BT.App.newGame('normal'); o.audit = BT.Debug.audit();
    return o;
  });
  check('难度：硬核起始资金', ex.hardCash);
  check('地产：解锁/买入/收租/出售', ex.unlocked && ex.buy && ex.rent && ex.sell, JSON.stringify(ex));
  check('捐赠记录', ex.donate);
  check('结局队列：慈善家触发并可关闭', ex.charity && ex.queuePop);
  check('存档导出/导入（含非法文本）', ex.imp && ex.impBad);
  check('快进推进天数', ex.ff);
  check('一键补货', ex.restock && ex.stocked, JSON.stringify(ex));
  check('每日挑战开始与结算', ex.daily && ex.dailyEnd);
  check('新局数据一致性审计通过', Array.isArray(ex.audit) && ex.audit.length === 0, JSON.stringify(ex.audit));

  /* 股票盘口 / 对手盘 / 成交明细 */
  const bk = await page.evaluate(() => {
    BT.App.newGame('normal'); const S = BT.S; BT.Market.ensure(S); S.cash = 5e7; const o = {};
    const b = BT.Market.book(S, 'ygkj'); o.levels = b.asks.length === 5 && b.bids.length === 5 && !!b.asks[0].who;
    const r = BT.Market.buyStock(S, 'ygkj', 100); o.buy = r.ok; const t = S.market.trades[0];
    o.rec = t && t.side === 'buy' && t.qty === 100 && t.fills.length >= 1 && !!t.fills[0].who && t.fills[0].p > S.market.stocks.ygkj.hist[0].c * 0;
    const big = BT.Market.buyStock(S, 'ygkj', 1e9); /* 远超盘口深度：要么资金不够，要么只能部分成交 */
    o.bigMsg = big.msg;
    o.partial = big.ok && /只成交/.test(big.msg) && S.market.trades[0].fills.length === 5;
    const again = BT.Market.buyStock(S, 'ygkj', 100); o.swept = BT.Market.book(S, 'ygkj').asks.every(l => l.q > 0) && BT.Market.book(S, 'ygkj').bids.every(l => l.q > 0);
    const sold = BT.Market.sellStock(S, 'ygkj', 100); o.sell = sold.ok && S.market.trades[0].side === 'sell' && S.market.trades[0].pnl != null;
    BT.Eco.sleep(S); o.refill = BT.Market.buyStock(S, 'ygkj', 100).ok;
    o.audit = BT.Debug.audit();
    return o;
  });
  check('盘口五档且带对手方', bk.levels);
  check('买入生成成交明细（分档/对手方）', bk.buy && bk.rec, JSON.stringify(bk));
  check('大单只能按盘口深度部分成交', bk.partial, JSON.stringify(bk));
  check('成交后盘口无空档位（做市商重新报价）', bk.swept);
  check('卖出生成成交明细并带盈亏', bk.sell);
  check('次日盘口重新补充', bk.refill);
  check('成交后一致性审计通过', bk.audit.length === 0, JSON.stringify(bk.audit));

  /* 实时行情：每小时 tick、今日K线生长、AI 逐笔、限价单挂单/成交/撤单 */
  const lv = await page.evaluate(() => {
    BT.App.newGame('normal'); const S = BT.S; BT.Market.ensure(S); S.cash = 1e7; const o = {};
    const m = S.market, ids = Object.keys(m.stocks);
    const p0 = ids.map(i => m.stocks[i].price), len0 = m.stocks.xjhg.hist.length, tape0 = m.tape.xjhg.length;
    for (let i = 0; i < 6; i++) BT.Eco.advanceHour(S, 1);
    const p1 = ids.map(i => m.stocks[i].price);
    o.moved = p1.some((p, i) => p !== p0[i]);
    o.noNewHist = m.stocks.xjhg.hist.length === len0;
    o.liveCandle = BT.Market.chartCandles(S, 'stocks', 'xjhg', 60).slice(-1)[0].live === true && m.live.xjhg.h >= m.live.xjhg.l;
    o.tape = m.tape.xjhg.length > tape0;
    o.fut = m.futures.soy.price !== undefined && m.live.soy.v > 0;
    /* 限价买单：价格远低于市价 → 挂单；撤单 */
    const px = m.stocks.xjhg.price;
    const r = BT.Market.placeStockOrder(S, 'xjhg', 'buy', 100, (px * 0.5).toFixed(2)); o.rested = r.ok && m.orders.length === 1;
    o.cancel = BT.Market.cancelOrder(S, m.orders[0].oid).ok && m.orders.length === 0;
    /* 限价买单：价格高于卖一 → 立即成交 */
    const r2 = BT.Market.placeStockOrder(S, 'xjhg', 'buy', 100, (px * 1.2).toFixed(2)); o.crossed = r2.ok && m.trades[0].limit > 0 && m.orders.length === 0;
    /* 限价卖单：高价挂单，次日收盘撤销 */
    BT.Market.placeStockOrder(S, 'xjhg', 'sell', 100, (px * 3).toFixed(2)); o.sellRest = m.orders.length === 1;
    const d0 = S.day; BT.Eco.sleep(S); o.dayEnd = S.day === d0 + 1 && m.orders.length === 0 && m.stocks.xjhg.hist.length === len0 + 1 && m.live.xjhg.o === m.stocks.xjhg.price;
    o.audit = BT.Debug.audit();
    return o;
  });
  check('每小时 tick 推动价格 / 不提前入库K线', lv.moved && lv.noNewHist, JSON.stringify(lv));
  check('今日K线实时生长 + AI 逐笔成交', lv.liveCandle && lv.tape && lv.fut, JSON.stringify(lv));
  check('限价单：挂单 / 撤单 / 越价立即成交', lv.rested && lv.cancel && lv.crossed, JSON.stringify(lv));
  check('收盘：K线入库、未成交委托撤销、次日开盘', lv.sellRest && lv.dayEnd, JSON.stringify(lv));
  check('实时行情后一致性审计通过', lv.audit.length === 0, JSON.stringify(lv.audit));

  /* 期货 / 外汇：多空逻辑、反向净额、保证金不计支出、强平、净资产含浮盈 */
  const lev = await page.evaluate(() => {
    BT.App.newGame('normal'); const S = BT.S, M = BT.Market; M.ensure(S); S.cash = 2e6; const o = {};
    const id = 'soy', def = M.futMap[id], ser = S.market.futures[id];
    const exp0 = S.todayExpense || 0, nw0 = BT.netWorth(S);
    const r = M.openFutures(S, id, 10, 'long'); o.open = r.ok;
    const margin = S.market.posFut[id].margin; o.expNoMargin = ((S.todayExpense || 0) - exp0) < margin * 0.2; /* 只有手续费进支出 */
    o.nwOpen = Math.abs(BT.netWorth(S) - nw0) < 0.002 * 2e6; /* 刚开仓净资产只少一点点（价差+手续费） */
    const entry = S.market.posFut[id].entry;
    ser.price = ser.price * 1.05; S.market.fair[id] = ser.price; /* 涨 5% → 多单盈利 */
    const pf = M.portfolio(S).futures[0]; o.longProfit = pf.pnl > 0 && Math.abs(pf.pnl - (ser.price - entry) * def.mult * 10) < def.mult * ser.price * 10 * 0.002;
    o.nwUnreal = BT.netWorth(S) > nw0;
    const cashBefore = S.cash; M.closeFutures(S, id, 10); o.closed = !S.market.posFut[id] && S.cash > cashBefore;
    /* 反向净额：多5 → 空8 = 平5 开空3 */
    ser.price = 4000; S.market.fair[id] = 4000; M.openFutures(S, id, 5, 'long'); const r2 = M.openFutures(S, id, 8, 'short');
    const p2 = S.market.posFut[id]; o.netting = r2.ok && p2 && p2.qty === -3;
    M.closeFutures(S, id, 3);
    /* 空头：价格下跌赚钱 */
    ser.price = 4000; S.market.fair[id] = 4000; M.openFutures(S, id, 5, 'short'); const e1 = S.market.posFut[id].entry;
    ser.price = 3800; const f1 = M.portfolio(S).futures[0]; o.shortProfit = f1.pnl > 0;
    /* 强平：价格大涨 → 空头爆仓，仓位清除，现金不会无故为负 */
    ser.price = 4000 * 2; S.market.fair[id] = ser.price; M.marginCheck(S); o.liq = !S.market.posFut[id];
    /* 外汇买入看涨 */
    const fx = S.market.forex.usd; M.openForex(S, 'usd', 3, 'long'); const fp = fx.price; fx.price = fp * 1.02; const g = M.portfolio(S).forex[0]; o.fx = g.pnl > 0;
    M.closeForex(S, 'usd', 3);
    o.audit = BT.Debug.audit();
    return o;
  });
  check('期货：开多/浮盈/平仓、保证金不计入支出', lev.open && lev.expNoMargin && lev.nwOpen && lev.longProfit && lev.nwUnreal && lev.closed, JSON.stringify(lev));
  check('期货：反向下单先平仓再开新仓', lev.netting, JSON.stringify(lev));
  check('期货：开空跌了赚钱 + 强平清仓', lev.shortProfit && lev.liq, JSON.stringify(lev));
  check('外汇：买入涨了赚钱', lev.fx);
  check('杠杆仓位一致性审计通过', lev.audit.length === 0, JSON.stringify(lev.audit));

  /* 睡觉后时间应回到清晨；摆摊定价真正影响收入 */
  const misc = await page.evaluate(() => {
    BT.App.newGame('normal'); const S = BT.S, o = {}; BT.Market.ensure(S);
    BT.Eco.sleep(S); o.hour = S.hour === BT.CFG.DAY_START_H;
    S.region = 'oldst'; S.cash = 1000; BT.Trade.buy(S, 'veg', 5); const c0 = S.cash;
    const base = BT.Eco.sellPrice(S, 'veg', S.region);
    BT.Trade.sell(S, 'veg', 2, base * 2); o.price = Math.abs(S.cash - c0 - base * 4) < 0.05;
    return o;
  });
  check('睡觉后时间回到清晨', misc.hour);
  check('卖出按指定定价成交（摆摊/店铺加价生效）', misc.price);

  check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(fails ? `\n❌ ${fails} 项失败` : '\n🎉 features 测试全部通过');
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
