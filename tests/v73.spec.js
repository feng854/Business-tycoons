/* ==========================================================================
 * 文件：tests/v73.spec.js
 * 作用：v7.3 回归 —— 经济平衡与门店诊断、已知坑修复（还款刷信用 / 招标背包交货 / 经理自动应战）、
 *       竞争第二步（锁供应 / 抢铺位 / 抬租 / 结盟 / 反垄断）、期货外汇对手盘（滑点 / 对手方 / 持仓报告 / 猎杀 / 追加保证金）、UI 与 iPad 横屏
 * 运行：node tests/v73.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 8963;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(PORT);
let fails = 0;
function check(name, ok, extra) { console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; }

(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' }), page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|TUNNEL|CONNECTION/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`); await page.click('#btn-newgame'); await page.waitForSelector('#game.active');

  /* 1. 经济平衡 + 诊断 + 已知坑 */
  const e = await page.evaluate(() => {
    const o = {}, C = BT.CFG;
    /* 认真经营（商业街、2 个店员、本区热销货）应该赚钱；城中村配 3 个人 + 冷门货应该亏，而且诊断能说出原因 */
    const run = (rid, staff, goods, mk) => {
      BT.newGame(21); BT.Eco.rollWeather(BT.S); BT.Eco.ensurePriceDay(BT.S);
      const S = BT.S, B = BT.Biz; S.cash = 80000; S.unlockedRegions = C.REGIONS.map(r => r.id); S.milestones = { m1: true, m2: true, m3: true }; S.phase = 2;
      B.ensure(S); B.openShop(S, rid); const sh = S.biz.shops[0]; for (let i = 0; i < staff; i++) B.hire(S, sh.id, 'clerk');
      for (let d = 0; d < 20; d++) { goods.forEach(g => { if ((sh.inventory[g] || 0) < 40) { B.wholesaleBuy(S, rid, g, 100); B.transferToShop(S, sh.id, g, 100); } B.setShelf(S, sh.id, g, mk); }); (S.biz.deals || []).slice().forEach(x => BT.Rivals.respond(S, x.id, 'decline')); BT.Eco.sleep(S); }
      return { d: B.diagnose(S, sh), S: S, sh: sh };
    };
    const good = run('cbd', 2, ['cloth', 'phonecase', 'drink', 'tea'], 1.35);
    o.goodNet = Math.round(good.d.avg.net); o.good = good.d.avg.net > 0 && good.d.grade !== 'loss';
    const bad = run('slum', 3, ['antique', 'tea', 'cloth'], 1.6);
    o.badNet = Math.round(bad.d.avg.net);
    o.bad = bad.d.avg.net < good.d.avg.net / 3 && bad.d.items.some(x => /不好卖/.test(x.t)) && bad.d.items.some(x => /价格很敏感|人手/.test(x.t));
    o.diagShape = bad.d.items.every(x => x.t && x.lv) && bad.d.avg && isFinite(bad.d.avg.gp);
    /* 还款刷信用修复 */
    const S = bad.S, B = BT.Biz; S.cash = 100000; B.takeLoan(S, 5000); const l = S.biz.loans[0]; const c0 = S.biz.creditScore;
    for (let i = 0; i < 20; i++) B.repayLoan(S, l.id, 1);
    o.noFarm = S.biz.creditScore === c0;
    B.repayLoan(S, l.id, 1000); const c1 = S.biz.creditScore; B.repayLoan(S, l.id, 1000);
    o.repayOnce = c1 === c0 + 2 && S.biz.creditScore === c1;
    /* 招标：背包里的货也能交 */
    const Td = BT.Tender, ts = (S.tenders = S.tenders || { list: [], next: 999 });
    ts.list.push({ id: 't1', buyer: '测试', gid: 'snack', qty: 30, budget: 9, myPrice: 8, myBond: 10, status: 'won', deadline: S.day + 5, close: S.day });
    S.region = 'market'; S.bag.snack = []; BT.Trade.buy(S, 'snack', 20);
    U = BT.U; Object.keys(S.biz.warehouses).forEach(r => S.biz.warehouses[r].goods.snack = 0); B.warehouse(S, 'market').goods.snack = 10;
    o.tdHave = Td.have(S, 'snack') === 30;
    const dr = Td.deliver(S, 't1'); o.tdBag = dr.ok && BT.Trade.qtyOf(S, 'snack') === 0 && (B.warehouse(S, 'market').goods.snack || 0) === 0;
    /* 经理自动应战 */
    BT.Manager.get(S); S.biz.mgr.on = true; const sh = bad.sh; sh.match = false;
    const wj = BT.Rivals.get(S, 'wanjia'); wj.shops.slum = wj.shops.slum || { level: 1, rep: 50 };
    wj.war.slum = 5; wj.camp.slum = { on: 'me', goods: ['cloth'], mode: 'undercut', cut: 0.1, my0: 0.3, spent: 0 };
    BT.Manager.dailyTick(S); o.mgrOn = sh.match && sh.matchByMgr;
    delete wj.war.slum; delete wj.camp.slum; BT.Manager.dailyTick(S); o.mgrOff = !sh.match;
    return o;
  });
  check('平衡：认真经营的商业街店能赚钱', e.good, '日均净利 ' + e.goodNet);
  check('平衡：城中村 + 冷门高价货远不如认真经营，诊断说出原因', e.bad, '日均净利 ' + e.badNet);
  check('诊断数据结构完整', e.diagShape);
  check('修复：反复还 ¥1 刷不了信用', e.noFarm);
  check('修复：正常还款每天只加一次信用', e.repayOnce);
  check('修复：招标可用背包 + 仓库的货交付', e.tdHave && e.tdBag);
  check('区域经理：被打价格战时自动开「自动应战」，打完自动关', e.mgrOn && e.mgrOff);

  /* 2. 竞争第二步 */
  const c = await page.evaluate(() => {
    const o = {}, C = BT.CFG;
    BT.newGame(33); BT.Eco.rollWeather(BT.S); BT.Eco.ensurePriceDay(BT.S);
    const S = BT.S, B = BT.Biz, Rv = BT.Rivals, T = Rv._t;
    S.cash = 400000; S.unlockedRegions = C.REGIONS.map(r => r.id); S.milestones = { m1: true, m2: true, m3: true }; S.phase = 2;
    B.ensure(S); S.biz.founded = S.day - 60;
    B.openShop(S, 'oldst', 'corner'); B.openShop(S, 'market');
    S.biz.shops.forEach(sh => { B.hire(S, sh.id, 'clerk'); ['snack', 'drink'].forEach(g => { B.wholesaleBuy(S, sh.regionId, g, 100); B.transferToShop(S, sh.id, g, 100); B.setShelf(S, sh.id, g, 1.3); }); });
    for (let i = 0; i < 4; i++) { (S.biz.deals || []).slice().forEach(x => Rv.respond(S, x.id, 'decline')); BT.Eco.sleep(S); }
    const xh = Rv.get(S, 'xinhui'), wj = Rv.get(S, 'wanjia');
    /* 锁供应：敌对巨头安排锁货 → 到期生效 → 你批发贵 30%；签了长约不受影响 */
    xh.att = -90; xh.fear = 0; xh.plan = null; xh.nextLock = 0; xh.nextSite = 999; xh.war = {}; xh.camp = {};
    let n = 0; while (!(xh.plan && xh.plan.act === 'lock') && n++ < 3000) { xh.plan = null; T.planTactics(S, xh); if (xh.plan && xh.plan.act !== 'lock') xh.plan = null; }
    o.lockPlan = xh.plan && xh.plan.act === 'lock' && S.biz.rivalNews.some(x => /独家供货|供应商/.test(x.text));
    const g = xh.plan.gid; xh.plan.start = S.day; T.launchPlan(S, xh);
    o.lockOn = !!Rv.lockOn(S, g);
    const p0 = BT.Eco.buyPrice(S, g, 'market'); const cash0 = S.cash; B.wholesaleBuy(S, 'market', g, 10); const paid = cash0 - S.cash;
    o.lockPrice = Math.abs(paid - BT.U.round2(BT.U.round2(p0 * 1.3) * (1 - B.buyerDiscount(S))) * 10) < 1;
    BT.Supply.sign(S, g); const cash1 = S.cash; B.wholesaleBuy(S, 'market', g, 10); o.lockContract = (cash1 - S.cash) < paid * 0.85;
    o.threatLock = Rv.threats(S).some(t => t.kind === 'lock');
    /* 抢铺位：你开的是路口旺铺 → 抬租；否则占旺铺 → 你开不了旺铺 */
    xh.plan = null; xh.nextSite = 0; xh.nextLock = 999; xh.cash = 300000;
    const oldShop = S.biz.shops.find(s => s.regionId === 'oldst'); oldShop.last.profit = 100; xh.shops.oldst = xh.shops.oldst || { level: 2, rep: 50 };
    n = 0; while (!(xh.plan && xh.plan.act === 'site') && n++ < 5000) { xh.plan = null; T.planTactics(S, xh); if (xh.plan && xh.plan.act !== 'site') xh.plan = null; }
    o.sitePlan = xh.plan && xh.plan.hike === true;
    xh.plan.start = S.day; T.launchPlan(S, xh);
    o.hike = oldShop.hike && oldShop.hike.mul === 1.25;
    const r0 = oldShop.rent; BT.Eco.sleep(S); o.hikeRent = Math.abs(oldShop.last.rent - Math.round(r0 * 1.25)) <= 1;
    S.biz.sites = { cbd: { by: 'xinhui', until: S.day + 30 } };
    o.cornerBlock = !B.openShop(S, 'cbd', 'corner').ok && B.openShop(S, 'cbd', 'street').ok;
    /* 结盟：巨头不结；区域连锁按态度结；盟友不对你下手、巨头打你时出手 */
    o.noBigAlly = !Rv.proposeAlly(S, 'xinhui').ok;
    wj.att = 80; wj.cash = 10000; wj.war = {}; wj.camp = {}; wj.plan = null; wj.allyAsk = 0;
    let ar; n = 0; do { wj.allyAsk = 0; ar = Rv.proposeAlly(S, 'wanjia'); } while (!ar.ok && n++ < 50);
    o.ally = ar.ok && Rv.allied(S, wj);
    wj.att = 80; wj.nextWar = 0; wj.aggr = 1; for (let i = 0; i < 300; i++) T.planWar(S, wj);
    o.allyPeace = !wj.plan;
    wj.shops.market = wj.shops.market || { level: 1, rep: 50 }; xh.shops.market = { level: 1, rep: 50 };
    xh.plan = { act: 'war', on: 'me', rid: 'market', goods: ['snack'], mode: 'undercut', days: 10, start: S.day, cut: 0.1 }; T.launchPlan(S, xh);
    o.allyHelp = wj.war.market > 0 && wj.camp.market && wj.camp.market.on === 'xinhui';
    /* 反垄断：有证据 → 罚款、停战、解锁；没证据 → 你的信用 −10 */
    xh.cash = 300000; S.biz.locks = {}; S.biz.locks.drink = { by: 'xinhui', until: S.day + 10, mul: 1.3 };
    xh.camp.market.mode = 'predatory';
    const ch = Rv.reportChance(S, xh); o.evid = ch >= 0.6;
    const rr = Rv.report(S, 'xinhui'); const pr = S.biz.probes[0]; pr.p = 1; pr.until = S.day;
    const xc = xh.cash; T.probeTick(S);
    o.guilty = rr.ok && xh.cash < xc && !xh.war.market && !Rv.lockOn(S, 'drink') && xh.nextWar > S.day + 30;
    const yy = Rv.get(S, 'yuanyang'); Rv.report(S, 'yuanyang'); S.biz.probes[0].p = 0; S.biz.probes[0].until = S.day;
    const cr = S.biz.creditScore; T.probeTick(S); o.innocent = S.biz.creditScore === Math.max(300, cr - 10);
    return o;
  });
  check('锁供应：敌对巨头先放风声再锁货', c.lockPlan && c.lockOn);
  check('锁供应：你批发被锁的货贵 30%', c.lockPrice);
  check('锁供应：签了长期供货合同就不受影响', c.lockContract);
  check('锁供应出现在「针对你的行动」', c.threatLock);
  check('抢铺位：你开路口旺铺 → 对手找房东抬租 25%', c.sitePlan && c.hike && c.hikeRent);
  check('抢铺位：旺铺被占时开不了旺铺、临街照开', c.cornerBlock);
  check('结盟：巨头不结盟', c.noBigAlly);
  check('结盟：区域连锁可以结，结了不再对你下手', c.ally && c.allyPeace);
  check('结盟：巨头打你时盟友在同区对它开战', c.allyHelp);
  check('反垄断：掠夺定价 + 锁货证据充分，胜算高', c.evid);
  check('反垄断：裁定违法 → 罚款、停战、解锁、冷却', c.guilty);
  check('反垄断：证据不足 → 你的信用 −10', c.innocent);

  /* 3. 期货 / 外汇对手盘 */
  const f = await page.evaluate(() => {
    const o = {}, S = BT.S, M = BT.Market, CP = BT.CP;
    S.cash = 50000000; M.ensure(S); M.prepare(S); CP.ensure(S);
    const px0 = S.market.futures.soy.price;
    const small = M.openFutures(S, 'soy', 1, 'long'); M.closeFutures(S, 'soy', 1);
    const big = M.openFutures(S, 'soy', 1200, 'long');
    o.who = /对手方：/.test(big.msg); o.moved = S.market.futures.soy.price > px0;
    const pos = S.market.posFut.soy; o.slip = pos.entry > px0 * (1 + 0.0003 / 2) + 0.01;
    const sum = Object.values(S.market.cp.soy.pos).reduce((a, b) => a + b, 0) + pos.qty; o.zeroSum = Math.abs(sum) < 2;
    o.tape = S.market.cp.soy.tape.length >= 2 && S.market.cp.soy.tape[0].q === 1200;
    const info = CP.info(S, 'soy'); o.info = info.rows.length === 5 && info.asks.length === 5 && info.me && info.me.lots === 1200 && info.oi > 0;
    /* 追加保证金：强平价远离 */
    const liq0 = M.portfolio(S).futures.find(x => x.id === 'soy').liq;
    M.addMargin(S, 'fut', 'soy', 2000000); const liq1 = M.portfolio(S).futures.find(x => x.id === 'soy').liq;
    o.addMargin = liq1 < liq0;
    M.closeFutures(S, 'soy', 1200);
    /* 猎杀：大仓位 + 离强平价近 → 对冲基金反向做单 */
    S.cash = 3000000; const lots = M.maxLots(S, 'fx', 'usd'); M.openForex(S, 'usd', Math.min(lots, 200), 'long');
    const p = S.market.posFx.usd; p.margin = p.margin * 0.55; /* 手动让它接近强平 */
    let hunted = false; for (let i = 0; i < 30 && !hunted; i++) { S.market.cp.usd.hunt = null; CP.daily(S); hunted = !!S.market.cp.usd.hunt; }
    o.hunt = hunted && S.market.cp.usd.hunt.dir === -1 && S.market.cp.usd.tgt.hunter < 0;
    const p1 = S.market.forex.usd.price; for (let t = 0; t < 12; t++) { S.market.cp.usd.hunt.until = S.day + 3; const it = { kind: 'forex', id: 'usd', def: M.fxMap.usd }; CP.tickFlow(S, it); }
    o.hunterSold = S.market.cp.usd.pos.hunter < -10;
    if (S.market.posFx.usd) M.closeForex(S, 'usd', Math.abs(S.market.posFx.usd.qty));
    /* 金管局：偏离超过 3% 入场 */
    S.market.forex.eur.price = M.fxMap.eur.base * 1.06; CP.daily(S);
    o.cb = S.market.cp.eur.cbOn && S.market.cp.eur.tgt.cb < 0;
    /* 长跑 100 天无 NaN */
    let bad = 0; for (let d = 0; d < 100; d++) { BT.Eco.sleep(S); Object.values(S.market.cp).forEach(x => Object.values(x.pos).forEach(v => { if (!isFinite(v)) bad++; })); ['soy', 'rb', 'cl', 'au'].forEach(k => { if (!(S.market.futures[k].price > 0)) bad++; }); }
    o.finite = bad === 0;
    return o;
  });
  check('对手盘：成交时显示对手方', f.who);
  check('对手盘：大单有滑点、价格被推开', f.slip && f.moved);
  check('对手盘：AI + 你的仓位多空相抵（零和）', f.zeroSum);
  check('对手盘：成交记录与持仓报告数据', f.tape && f.info);
  check('追加保证金：强平价远离', f.addMargin);
  check('猎杀：仓位大又接近强平 → 对冲基金反向做单', f.hunt && f.hunterSold);
  check('金管局：汇率偏离 3% 以上入场干预', f.cb);
  check('对手盘长跑 100 天无 NaN', f.finite);

  /* 4. UI */
  const ui = await page.evaluate(() => {
    const o = {}, S = BT.S;
    BT.App.switchTab('biz'); BT.App.bizTab('shops'); o.diag = /门店诊断/.test(document.body.innerText);
    BT.App.bizTab('rivals'); const t = document.body.innerText; o.diplo = /结盟|盟约/.test(t) && /举报/.test(t);
    BT.App.bizTab('supply');
    BT.App.switchTab('market'); BT.Render.setMarketTab('future'); BT.Render.market(); o.cp = /持仓报告/.test(document.body.innerText) && /每档约/.test(document.body.innerText);
    BT.Render.setMarketTab('forex'); BT.Render.market(); o.cpfx = /金管局/.test(document.body.innerText);
    return o;
  });
  check('门店页显示门店诊断', ui.diag);
  check('竞争页显示结盟 / 举报', ui.diplo);
  check('期货页显示盘口深度 + 持仓报告', ui.cp);
  check('外汇页持仓报告含金管局', ui.cpfx);
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(200);
  const over = await page.evaluate(() => { const out = {}; BT.App.switchTab('biz'); ['shops', 'rivals', 'supply', 'dash'].forEach(t => { BT.App.bizTab(t); out[t] = document.documentElement.scrollWidth <= window.innerWidth + 1; }); BT.App.switchTab('market'); ['future', 'forex'].forEach(t => { BT.Render.setMarketTab(t); BT.Render.market(); out[t] = document.documentElement.scrollWidth <= window.innerWidth + 1; }); return out; });
  check('iPad 横屏：门店 / 竞争 / 供应链 / 仪表盘 / 期货 / 外汇不溢出', Object.values(over).every(Boolean), JSON.stringify(over));

  check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(fails ? '\n❌ v7.3 有 ' + fails + ' 项失败' : '\n🎉 v7.3 测试全部通过');
  process.exit(fails ? 1 : 0);
})();
