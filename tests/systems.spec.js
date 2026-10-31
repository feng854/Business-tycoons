/* ==========================================================================
 * 文件：tests/systems.spec.js
 * 作用：本轮新系统回归 —— AI 竞争对手（分流/价格战/挖人/卖店/收购/被收购）、员工培训与忠诚、
 *       选址、供应链断供与长约、财报季与板块联动、期货换月与到期、外汇隔夜利息、
 *       6 存档位 + 备份、离线收益、新手引导、手机布局
 * 运行：node tests/systems.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 8955;
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(PORT);
let fails = 0;
function check(name, ok, extra) { console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; }

(async () => {
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|TUNNEL|CONNECTION/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`); await page.click('#btn-newgame'); await page.waitForSelector('#game.active');

  const r = await page.evaluate(() => {
    const o = {}, S = BT.S, B = BT.Biz, Rv = BT.Rivals, M = BT.Market;
    S.cash = 200000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = BT.CFG.REGIONS.map(x => x.id); S.phase = 2;
    B.ensure(S); M.ensure(S);
    o.rivals = S.biz.rivals.length === 4 && S.biz.rivals.some(x => x.listed === 'xhls');
    /* 选址：路口旺铺更贵、客流更多 */
    const fa = B.siteForecast(S, 'oldst', 'alley'), fc = B.siteForecast(S, 'oldst', 'corner');
    o.site = fc.customers > fa.customers && fc.rent > fa.rent && fc.cost > fa.cost;
    B.openShop(S, 'oldst', 'corner'); const sh = S.biz.shops[0];
    o.loc = sh.loc === 'corner' && sh.rent === B.shopRent('oldst', 'corner');
    /* 份额：有我的店后份额表里有「我」 */
    o.share = Rv.shares(S, 'oldst').some(x => x.me) && Math.abs(Rv.shares(S, 'oldst').reduce((a, x) => a + x.share, 0) - 1) < 1e-6;
    /* 对手越强，竞争系数越低 */
    const cf0 = Rv.compFactor(S, 'oldst', 1); S.biz.rivals.find(x => x.id === 'xinhui').war.oldst = 5; const cf1 = Rv.compFactor(S, 'oldst', 1);
    o.war = cf1 < cf0; delete S.biz.rivals.find(x => x.id === 'xinhui').war.oldst;
    /* 人才市场与培训 */
    o.cands = S.biz.candidates.length === 4;
    const c = S.biz.candidates[0]; const h = B.hireCandidate(S, sh.id, c.id); o.hireCand = h.ok && sh.employees.length === 1 && !S.biz.candidates.find(x => x.id === c.id);
    const e = sh.employees[0], sk = e.skill, sv = e.service;
    const t1 = B.train(S, sh.id, e.id, 'service'); o.train = t1.ok && e.service > sv && e.offDuty === 1;
    o.trainBlock = !B.train(S, sh.id, e.id, 'sales').ok; /* 培训中不能再培训 */
    const w0 = e.wage; B.raise(S, sh.id, e.id); o.raise = e.wage > w0;
    B.hire(S, sh.id, 'buyer');
    ['snack', 'drink', 'tea'].forEach(g => B.setShelf(S, sh.id, g, 1.3)); B.autoRestock(S);
    BT.Eco.sleep(S);
    o.offDutyReset = !e.offDuty && sh.last && sh.last.customers >= 0 && sh.trafficHist.length === 1;
    /* 挖人要约：加薪挽留 */
    S.biz.deals.push({ id: 'd1', type: 'poach', rivalId: 'xingyao', shopId: sh.id, empId: e.id, wage: e.wage + 50, expire: S.day + 1, text: 't' });
    const pr = Rv.respond(S, 'd1', 'accept'); o.poachKeep = pr.ok && sh.employees.some(x => x.id === e.id && x.wage === e.wage);
    /* 对手卖店：接手 */
    const wj = S.biz.rivals.find(x => x.id === 'wanjia'); wj.cash = -100;
    S.biz.deals.push({ id: 'd2', type: 'sellShop', rivalId: 'wanjia', regionId: 'market', level: 2, rep: 50, price: 1000, expire: S.day + 2, text: 't' });
    const n0 = S.biz.shops.length; const sr = Rv.respond(S, 'd2', 'accept');
    o.takeover = sr.ok && S.biz.shops.length === n0 + 1 && !wj.shops.market;
    /* 收购整家 AI 公司（资本帝国已解锁） */
    while (S.biz.shops.length < 3) B.openShop(S, BT.CFG.REGIONS.find(x => !S.biz.shops.some(s => s.regionId === x.id)).id);
    const yy = S.biz.rivals.find(x => x.id === 'yuanyang'); const ac = Rv.acquire(S, 'yuanyang');
    o.acquire = ac.ok && !yy.alive && S.biz.shops.some(s => s.regionId === 'port');
    o.listedBlock = !Rv.acquire(S, 'xinhui').ok;
    /* 被收购：濒临破产时收到整体收购要约，接受后门店清空、现金增加 */
    S.insolventDays = 2; S.biz.deals = []; Rv.dailyTick(S);
    const bo = S.biz.deals.find(d => d.type === 'buyout'); const cash0 = S.cash;
    const br = bo && Rv.respond(S, bo.id, 'accept'); o.buyout = !!bo && br.ok && S.biz.shops.length === 0 && S.cash > cash0;
    S.insolventDays = 0;
    /* 供应链：断供阻断批发，应急可买，长约保供 */
    BT.Supply.ensure(S).goods.tea = { mul: 1, days: 3, out: true };
    o.outBlock = !B.wholesaleBuy(S, 'oldst', 'tea', 20).ok;
    const em = B.wholesaleBuy(S, 'oldst', 'tea', 200, true); o.emergency = em.ok && /应急/.test(S.logs.slice(-1)[0].m);
    o.supplyPrice = BT.Eco.buyPrice(S, 'tea', 'market') > 0;
    delete S.supply.goods.tea; const sg = BT.Supply.sign(S, 'drink'); S.supply.goods.drink = { mul: 1.3, days: 5, out: true };
    o.contract = sg.ok && B.wholesaleBuy(S, 'oldst', 'drink', 20).ok && BT.Supply.contractRatio(S, 'drink') < 0.8;
    /* 财报季：日历 + 预期 + 公布后带板块联动 */
    const cal = M.earnCalendar(S); o.calendar = cal.length === 6 && cal.every(x => x.cons && x.day >= S.day);
    const target = cal[0]; S.market.earn.sched[target.id] = S.day; const nf = S.market.stocks[target.id].financials.length;
    BT.Eco.sleep(S);
    const rep = S.market.stocks[target.id].financials.slice(-1)[0];
    o.report = S.market.stocks[target.id].financials.length === nf + 1 && rep.expEps != null && typeof rep.beat === 'boolean';
    /* 期货：换月 + 到期强平 + 换月后的仓位跨到期仍存在 */
    M.openFutures(S, 'rb', 1, 'long'); const ct = S.market.futures.rb.ct;
    const roll = M.rollFutures(S, 'rb'); o.roll = roll.ok && S.market.posFut.rb.ct === ct.next;
    M.openFutures(S, 'cl', 1, 'short');
    S.cash += 50000; let guard = 0; S.market.posFut.rb.margin += 30000; S.market.posFut.rb.init += 30000; S.market.posFut.cl.margin += 30000; S.market.posFut.cl.init += 30000; /* 加足保证金，避免随机行情先触发强平 */ const pxRb = M.futPx(S, 'rb', ct.next);
    while (S.market.futures.rb.ct.code === ct.code && guard++ < 40) BT.Eco.sleep(S); /* 推进到真实到期日（每月 15 日） */
    o.expiry = !S.market.posFut.cl && !!S.market.posFut.rb && S.market.futures.rb.ct.code === ct.next && S.market.futures.rb.rolls.length >= 1;
    o.rollContinuity = Math.abs(M.futPx(S, 'rb', S.market.posFut.rb.ct) / pxRb - 1) < 0.25;
    o.mixBlock = !M.openFutures(S, 'rb', 1, 'long', true).ok; /* 持仓在主力时不能开次月 */
    /* 外汇隔夜利息：高息货币多单收息、低息空单… */
    o.swapSign = M.swapPerLot(S, 'usd', 1) > 0 && M.swapPerLot(S, 'jpy', 1) < 0 && M.swapPerLot(S, 'jpy', -1) > 0;
    S.cash += 50000; M.openForex(S, 'usd', 2, 'long'); S.market.posFx.usd.margin += 30000; S.market.posFx.usd.init += 30000; BT.Eco.sleep(S); BT.Eco.sleep(S);
    o.swapApplied = (S.market.posFx.usd.swap || 0) > 0;
    /* 央行利率影响贷款 */
    const lr0 = B.loanRate(S); S.market.rates.hgd += 0.02; o.loanRate = B.loanRate(S) > lr0; S.market.rates.hgd -= 0.02;
    o.audit = BT.Debug.audit();
    /* 长跑：AI 公司 200 天不出 NaN */
    S.cash = 100000; B.openShop(S, 'cbd'); let nan = false;
    for (let i = 0; i < 200; i++) { (S.biz.deals || []).slice().forEach(d => Rv.respond(S, d.id, 'decline')); BT.Eco.sleep(S); if (!isFinite(BT.netWorth(S)) || S.biz.rivals.some(x => !isFinite(x.cash))) { nan = true; break; } }
    o.longRun = !nan;
    return o;
  });
  check('AI 竞争对手初始化（含上市公司新辉零售）', r.rivals);
  check('选址预估：旺铺客流多、租金贵', r.site);
  check('按地段开店', r.loc);
  check('区域份额含玩家且合计 100%', r.share);
  check('价格战降低玩家竞争系数', r.war);
  check('人才市场 4 名候选人 / 签约', r.cands && r.hireCand);
  check('培训：能力提升 + 脱产一天 + 不能重复培训', r.train && r.trainBlock && r.offDutyReset);
  check('加薪', r.raise);
  check('挖人要约：加薪挽留', r.poachKeep);
  check('接手 AI 公司转让的门店', r.takeover);
  check('整体收购 AI 公司 / 上市公司不可收购', r.acquire && r.listedBlock);
  check('濒临破产 → 收到并可接受整体收购', r.buyout);
  check('断供阻断批发、应急采购可用', r.outBlock && r.emergency && r.supplyPrice);
  check('长约：断供保供 + 锁价', r.contract);
  check('财报日历与一致预期', r.calendar);
  check('财报按日历公布（含预期与超预期判定）', r.report);
  check('期货换月', r.roll);
  check('期货到期：未换月强平、已换月保留、主力切换', r.expiry && r.rollContinuity);
  check('同品种不能同时持有两个合约', r.mixBlock);
  check('外汇隔夜利息方向 / 计入保证金', r.swapSign && r.swapApplied);
  check('央行利率影响公司贷款利率', r.loanRate);
  check('新系统后数据一致性审计通过', r.audit.length === 0, JSON.stringify(r.audit));
  check('AI 公司 200 天长跑无 NaN', r.longRun);

  /* 存档位 / 备份 / 离线收益 / 新手引导 */
  const s2 = await page.evaluate(() => {
    const o = {};
    o.slots = BT.SLOT_COUNT === 6;
    BT.saveToSlot(5, '第六格'); o.slot6 = BT.slotInfo(5) && BT.slotInfo(5).label === '第六格';
    BT.deleteSlot(5); o.del = !BT.slotInfo(5);
    BT.save(); BT.Eco.sleep(BT.S); o.backup = BT.hasBackup() && BT.backupInfo().day === BT.S.day - 1;
    const S = BT.S; if (!S.biz.shops.length) BT.Biz.openShop(S, 'oldst'); for (let i = 0; i < 7; i++) S.biz.ledger.push({ day: S.day, profit: 1000 }); S.updatedAt = Date.now() - 6 * 3600e3;
    const q = BT.FX.offlineQuote(S); o.offline = !!q && q.amount > 0 && q.counted <= 12;
    const c0 = S.cash; BT.FX.claimOffline(q.amount); o.claim = Math.abs(S.cash - c0 - q.amount) < 0.01 && !BT.FX.offlineQuote(S);
    S.updatedAt = Date.now() - 100 * 3600e3; o.cap = BT.FX.offlineQuote(S).counted === 12;
    return o;
  });
  check('6 个存档位 + 命名 + 删除', s2.slots && s2.slot6 && s2.del);
  check('自动保留前一天备份', s2.backup);
  check('离线收益：计算 / 领取 / 12 小时封顶', s2.offline && s2.claim && s2.cap);

  await page.evaluate(() => { localStorage.removeItem('bt_tut_done'); });
  await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForSelector('#btn-newgame');
  const tutBox = await page.$eval('#boot-tut', el => el.checked);
  await page.click('#btn-newgame'); await page.waitForTimeout(500);
  await page.click('#tut-tip button.primary'); await page.waitForTimeout(500);
  await page.click('[data-tab="jobs"]'); await page.waitForTimeout(800);
  const step = await page.evaluate(() => BT.S.tut.step);
  await page.click('#jobs-list button.primary'); await page.waitForTimeout(800);
  const step2 = await page.evaluate(() => BT.S.tut.step);
  check('新手引导：默认勾选、跟随操作推进', tutBox && step === 2 && step2 === 3, 'step=' + step + '→' + step2);
  await page.evaluate(() => BT.FX.tutSkip());

  /* 手机布局：底部导航固定、无横向滚动、金融页下单区在 K 线下方 */
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await page.click('[data-tab="market"]'); await page.waitForTimeout(500);
  const mob = await page.evaluate(() => ({
    navFixed: getComputedStyle(document.querySelector('#sidebar .nav-list')).position === 'fixed',
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    sideInline: document.getElementById('mk-side').parentNode.classList.contains('mk-mid')
  }));
  check('手机布局：底部导航 / 无横向滚动 / 下单区跟随 K 线', mob.navFixed && mob.noHScroll && mob.sideInline, JSON.stringify(mob));
  check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(fails ? '\n❌ systems 测试有 ' + fails + ' 项失败' : '\n🎉 systems 测试全部通过');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
