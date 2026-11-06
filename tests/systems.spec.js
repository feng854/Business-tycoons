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

  /* 门店 BUG 回归：①一键补货要补全部门店（含空货架新店）②搬迁下拉框不被刷新重置 + 搬迁冷却 ③空店也有上架 / 改价 */
  const shopFix = await page.evaluate(() => {
    BT.App.newGame('normal'); const S = BT.S, B = BT.Biz, o = {};
    S.cash = 60000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = BT.CFG.REGIONS.map(x => x.id); S.phase = 2; B.ensure(S);
    B.openShop(S, 'cbd', 'corner'); B.openShop(S, 'college', 'corner'); B.openShop(S, 'port', 'street');
    const [a, b, c] = S.biz.shops;
    ['fruit', 'snack', 'drink', 'daily', 'phonecase', 'toy', 'stationery'].forEach(g => B.setShelf(S, a.id, g, 1.3)); /* 只有第一家店有货架 */
    const r = B.autoRestock(S);
    o.all = r.ok && [a, b, c].every(sh => Object.keys(sh.shelf).length > 0 && Object.keys(sh.inventory).some(g => sh.inventory[g] > 0));
    o.msg = r.msg;
    BT.App.switchTab('biz'); BT.App.bizTab('shops');
    o.addRow = !!document.getElementById('shelf-add-' + c.id) || Object.keys(c.shelf).length === BT.CFG.GOODS.length;
    o.priceRows = !!document.querySelector('[id^="markup-' + b.id + '-"]') && !!document.querySelector('[id^="markup-' + c.id + '-"]');
    /* 空店上架新商品 */
    const sel = document.getElementById('shelf-add-' + c.id), gid = sel.options[0].value;
    BT.App.bizShelfAdd(c.id); o.added = !!c.shelf[gid];
    /* 搬迁下拉框：选第二项后后台刷新，不应跳回第一项 */
    const rs = document.getElementById('reloc-' + c.id); rs.value = rs.options[1].value; const want = rs.value;
    document.body.focus(); BT.Bus.emit('changed');
    o.keepSel = document.getElementById('reloc-' + c.id).value === want;
    /* 搬迁冷却 */
    o.reloc1 = B.relocate(S, c.id, want).ok; o.reloc2 = !B.relocate(S, c.id, 'street').ok;
    BT.Render.all(); o.coolUi = !document.getElementById('reloc-' + c.id);
    return o;
  });
  console.log('   门店修复:', JSON.stringify(shopFix));
  check('一键补货：所有门店一起补（含空货架门店）', shopFix.all, shopFix.msg);
  check('空货架门店也有上架 / 改价入口，并能上架', shopFix.addRow && shopFix.priceRows && shopFix.added);
  check('搬迁下拉框刷新后保持选择 + 30 天冷却', shopFix.keepSel && shopFix.reloc1 && shopFix.reloc2 && shopFix.coolUi);

  /* 区域客群 + 奢侈品进口贸易 */
  const lux = await page.evaluate(() => {
    BT.App.newGame('normal'); const S = BT.S, B = BT.Biz, L = BT.Lux, C = BT.CFG, o = {};
    o.noBag = !BT.Trade.buy(S, 'watch', 1).ok && !C.GOODS.some(g => g.lux);
    S.cash = 300000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = C.REGIONS.map(x => x.id); S.phase = 2; B.ensure(S); BT.Market.ensure(S); S.biz.brand = 20;
    B.openShop(S, 'cbd', 'corner'); const sh = S.biz.shops[0]; B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'clerk');
    o.noWholesale = !B.wholesaleBuy(S, 'cbd', 'watch', 10).ok;
    o.needBoutique = !B.setShelf(S, sh.id, 'watch', 1.3).ok;
    o.boutique = L.makeBoutique(S, sh.id).ok && B.setShelf(S, sh.id, 'watch', 1.3).ok;
    o.needLicense = !L.order(S, 'cbd', 'watch', 3, 'official').ok;
    /* 成本随汇率：美元升值 → 名表进价变贵 */
    const c0 = L.officialCost(S, 'watch'); S.market.forex.usd.price *= 1.1; o.fxLink = L.officialCost(S, 'watch') > c0 * 1.09; S.market.forex.usd.price /= 1.1;
    const bd = L.breakdown(S, 'watch'); o.breakdown = Math.abs(bd.cif + bd.duty + bd.vat + bd.excise - bd.total) < 0.05 && bd.grey < bd.total;
    o.license = L.buyLicense(S, 'watch').ok && L.quotaLeft(S, 'watch') === C.TRADE.licenseQuota;
    const or = L.order(S, 'cbd', 'watch', 5, 'official'); o.order = or.ok && L.inTransit(S).length === 1 && L.quotaLeft(S, 'watch') === C.TRADE.licenseQuota - 5;
    o.greyCap = !L.order(S, 'cbd', 'perfume', 25, 'grey').ok;
    for (let i = 0; i < 8; i++) { S.biz.deals = []; BT.Eco.sleep(S); }
    const got = (B.warehouse(S, 'cbd').goods.watch || 0) + (sh.inventory.watch || 0); /* 正规进口有 8% 概率货损，到货可能少于 5 */
    o.arrived = L.inTransit(S).length === 0 && got >= 1 && got <= 5;
    B.autoRestock(S); o.restockLux = (sh.inventory.watch || 0) === got;
    let sold = 0; for (let i = 0; i < 40; i++) { S.biz.deals = []; const n0 = sh.inventory.watch || 0; BT.Eco.sleep(S); sold += Math.max(0, n0 - (sh.inventory.watch || 0)); B.autoRestock(S); }
    o.luxSells = (sh.luxSold || 0) > 0;
    /* 水货：严打期间多下几单，必然有被查扣的 */
    S.lux.crackdown = 30; let seized0 = S.lux.stats.seized; for (let i = 0; i < 12; i++) { L.order(S, 'cbd', 'perfume', 5, 'grey'); S.biz.deals = []; BT.Eco.sleep(S); BT.Eco.sleep(S); }
    o.seize = S.lux.stats.seized > seized0 && S.lux.stats.fines > 0;
    /* 区域客群：学院区文具热销、古玩滞销 */
    o.demand = C.demandOf('college', 'stationery') > 1.2 && C.demandOf('college', 'antique') < 0.7 && C.demandOf('cbd', 'nope') === 1;
    o.finite = isFinite(BT.netWorth(S)); o.audit = BT.Debug.audit();
    return o;
  });
  console.log('   奢侈品:', JSON.stringify(lux));
  check('奢侈品：不能背包倒卖 / 不能普通批发 / 要精品装修才能上架', lux.noBag && lux.noWholesale && lux.needBoutique && lux.boutique);
  check('奢侈品：外币 × 汇率 × 税费，汇率变动影响进价', lux.fxLink && lux.breakdown);
  check('进口：无代理权不能正规进口 / 代理权配额 / 在途后入库', lux.needLicense && lux.license && lux.order && lux.arrived);
  check('进口：一键补货只调不进口 / 精品店能卖出奢侈品', lux.restockLux && lux.luxSells);
  check('水货：数量上限 / 严打期间会被查扣罚款', lux.greyCap && lux.seize);
  check('区域客群需求表', lux.demand);
  check('奢侈品后数值有效 + 一致性审计', lux.finite && lux.audit.length === 0, JSON.stringify(lux.audit));

  /* 上市：条件 → 申请 → 审核 → 挂牌（股票出现在行情、真实财报、上市溢价计入净资产）→ 分红 → 锁定期 → 减持；读档后股票定义同步 */
  const ipo = await page.evaluate(() => {
    BT.App.newGame('normal'); const S = BT.S, B = BT.Biz, I = BT.IPO, o = {};
    S.cash = 30000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = BT.CFG.REGIONS.map(x => x.id); S.phase = 2; B.ensure(S); BT.Market.ensure(S);
    o.blocked = !I.eligible(S) && !I.apply(S, '测试', 'TEST').ok;
    ['oldst', 'cbd', 'market'].forEach(r => B.openShop(S, r));
    S.biz.shops.forEach(sh => { B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'clerk'); ['snack', 'drink', 'daily'].forEach(g => B.setShelf(S, sh.id, g, 1.3)); });
    for (let i = 0; i < 65; i++) { if (i === 59) S.biz.creditScore = Math.max(S.biz.creditScore, 660); B.autoRestock(S); (S.biz.deals || []).slice().forEach(d => BT.Rivals.respond(S, d.id, 'decline')); BT.Eco.sleep(S); }
    S.cash += 150000; for (let i = 0; i < 30; i++) S.biz.ledger.push({ day: S.day, revenue: 3000, profit: 600, cogs: 0, rent: 0, wage: 0 });
    o.conds = I.conditions(S).map(x => x.name + ':' + x.ok).join(',');
    o.eligible = I.eligible(S);
    const nw0 = BT.netWorth(S);
    const a = I.apply(S, '巨子商业', 'JZSY'); o.apply = a.ok && S.ipo.status === 'review';
    o.stockBlocked = !BT.Market.stockMap.mine;
    for (let i = 0; i < 16 && S.ipo.status === 'review'; i++) { B.autoRestock(S); S.biz.ledger.push({ day: S.day, revenue: 3000, profit: 600 }); BT.Eco.sleep(S); }
    o.listed = S.ipo.status === 'listed' ? true : S.ipo.status + ':' + S.ipo.rejectReason;
    if (S.ipo.status !== 'listed') return o;
    o.inMarket = BT.Market.STOCKS.some(d => d.id === 'mine' && d.own) && S.market.stocks.mine.price > 0;
    o.hold = Math.abs(I.holdRatio(S) - 0.85) < 0.01;
    o.nwUp = BT.netWorth(S) > nw0;
    o.noTrade = !BT.Market.buyStock(S, 'mine', 100).ok;
    o.ending = !!S.endings.ipo;
    const d = I.dividend(S, 2000); o.div = d.ok && !I.dividend(S, 2000).ok;
    o.lock = !I.sellShares(S, 100).ok;
    for (let i = 0; i < 95; i++) { S.biz.ledger.push({ day: S.day, revenue: 3000, profit: 600 }); BT.Eco.sleep(S); }
    o.reports = S.market.stocks.mine.financials.filter(f => !f.prospectus).length >= 1;
    const rep = S.market.stocks.mine.financials.slice(-1)[0]; o.realProfit = rep.prospectus || rep.profit > 0;
    const max = I.canSellShares(S), h0 = S.ipo.holdShares, c0 = S.cash; const sr = I.sellShares(S, max * 10);
    o.sell = sr.ok && S.ipo.holdShares === h0 - max && S.cash > c0 && !I.sellShares(S, 100).ok; /* 冷却期 */
    for (let k = 0; k < 20; k++) { S.ipo.lastSell = 0; I.sellShares(S, 1e9); }
    o.keep51 = I.holdRatio(S) >= 0.51;
    o.finite = isFinite(BT.netWorth(S)) && isFinite(I.price(S));
    o.audit = BT.Debug.audit();
    /* 存档 → 新局（股票定义应移除）→ 读档（应恢复） */
    BT.saveToSlot(4, 'ipo'); BT.App.newGame('normal'); o.removed = !BT.Market.stockMap.mine && !BT.Market.STOCKS.some(x => x.own);
    BT.Market.ensure(BT.S); for (let i = 0; i < 3; i++) BT.Eco.sleep(BT.S);
    BT.loadSlot(4); o.restored = !!BT.Market.stockMap.mine; BT.Eco.sleep(BT.S); BT.deleteSlot(4);
    return o;
  });
  console.log('   上市:', JSON.stringify(ipo));
  check('上市：条件不足不能申请', ipo.blocked);
  check('上市：满足条件后可申请并进入审核', ipo.eligible && ipo.apply && ipo.stockBlocked, ipo.conds);
  check('上市：审核通过挂牌，股票出现在行情、持股 85%', ipo.listed === true && ipo.inMarket && ipo.hold, String(ipo.listed));
  check('上市：净资产增加 / 自家股票不能在二级市场买卖 / 结局', ipo.nwUp && ipo.noTrade && ipo.ending);
  check('上市：分红（含冷却）/ 锁定期内不能减持', ipo.div && ipo.lock);
  check('上市：季报用真实账本', ipo.reports && ipo.realProfit);
  check('上市：锁定期后减持（单次上限、保留 51%）', ipo.sell && ipo.keep51);
  check('上市：数值有效 + 一致性审计', ipo.finite && ipo.audit.length === 0, JSON.stringify(ipo.audit));
  check('上市：新局移除 / 读档恢复股票', ipo.removed && ipo.restored);

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

  /* 调试后门：界面无按钮；未解锁时连点标题 / 快捷键无效；?debug=1 解锁后两个入口都能开关；?debug=0 上锁 */
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`http://localhost:${PORT}/index.html?debug=0`); await page.click('#btn-newgame'); await page.waitForSelector('#game.active');
  await page.click('[data-tab="market"]'); await page.waitForTimeout(300);
  const noBtn = await page.evaluate(() => !Array.from(document.querySelectorAll('button')).some(b => /调试/.test(b.textContent) && b.offsetParent));
  const title = '#tab-market h3';
  for (let i = 0; i < 5; i++) await page.click(title);
  await page.keyboard.press('Control+Shift+D'); await page.waitForTimeout(200);
  const lockedHidden = await page.evaluate(() => getComputedStyle(document.getElementById('debug-card')).display === 'none' && !BT.Debug.isOpen() && /未解锁/.test(BT.Debug.open()));
  await page.goto(`http://localhost:${PORT}/index.html?debug=1`); await page.click('#btn-newgame'); await page.waitForSelector('#game.active');
  await page.click('[data-tab="market"]'); await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) await page.click(title);
  await page.waitForTimeout(2200); await page.click(title); /* 超过 2 秒重新计数：这 5 下不该打开 */
  const notByStale = await page.evaluate(() => !BT.Debug.isOpen());
  for (let i = 0; i < 4; i++) await page.click(title);
  const byTap = await page.evaluate(() => BT.Debug.isOpen() && getComputedStyle(document.getElementById('debug-card')).display !== 'none');
  await page.keyboard.press('Control+Shift+D'); const byKeyClose = await page.evaluate(() => !BT.Debug.isOpen());
  await page.keyboard.press('Control+Shift+D'); const byKeyOpen = await page.evaluate(() => BT.Debug.isOpen());
  check('调试后门：无按钮 / 未解锁无效 / 2 秒连点 5 次 / Ctrl+Shift+D', noBtn && lockedHidden && notByStale && byTap && byKeyClose && byKeyOpen, JSON.stringify({ noBtn, lockedHidden, notByStale, byTap, byKeyClose, byKeyOpen }));
  await page.evaluate(() => BT.Debug.close());

  /* iPad 横屏：右栏变抽屉、页面不横向溢出、下单区跟随 K 线 */
  await page.evaluate(() => BT.FX.tutSkip && BT.FX.tutSkip());
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(300);
  await page.click('[data-tab="market"]'); await page.waitForTimeout(400);
  const pad = await page.evaluate(() => ({
    drawerBtn: getComputedStyle(document.getElementById('btn-drawer')).display !== 'none',
    panelHidden: document.getElementById('rightpanel').getBoundingClientRect().left >= window.innerWidth - 2,
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    sideInline: document.getElementById('mk-side').parentNode.classList.contains('mk-mid')
  }));
  await page.click('#btn-drawer'); await page.waitForTimeout(400);
  pad.drawerOpen = await page.evaluate(() => document.getElementById('rightpanel').getBoundingClientRect().right <= window.innerWidth + 2);
  await page.click('#drawer-mask'); await page.waitForTimeout(300);
  pad.drawerClosed = await page.evaluate(() => !document.body.classList.contains('drawer-open'));
  check('iPad 横屏：抽屉 / 无横向溢出 / 下单区在 K 线下', Object.values(pad).every(Boolean), JSON.stringify(pad));

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
