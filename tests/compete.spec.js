/* ==========================================================================
 * 文件：tests/compete.spec.js
 * 作用：分层 AI 竞争（第一步）回归 —— 大/中/小三层、单品比价、价格战紧咬你的价格 + 底线、
 *       自动应战、先算账再出手（宽限期 / 同时最多 2 家 / 钱不够不打）、风声与内线、态度与记忆、
 *       提前撤退、外来巨头入场、散户池（摆摊分流 / 甩卖 / 跟风 / 城管清场）、旧存档迁移、UI 与 iPad 横屏
 * 运行：node tests/compete.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 8961;
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

  /* 1. 散户池：摆摊阶段就有人抢客 */
  const h = await page.evaluate(() => {
    const o = {}, S = BT.S, Hk = BT.Hawkers, C = BT.CFG;
    Hk.ensure(S);
    o.init = C.REGIONS.every(r => S.hawkers.r[r.id].n === C.HAWKERS.base[r.id]);
    const p = BT.Eco.sellPrice(S, 'snack', 'market');
    const f1 = Hk.factor(S, 'market', 'snack', p), fCheap = Hk.factor(S, 'market', 'snack', p * 0.85), fDear = Hk.factor(S, 'market', 'snack', p * 1.3);
    o.factor = f1.mul < 1 && fCheap.mul > f1.mul && fDear.mul < f1.mul;
    o.noCarry = Hk.factor(S, 'market', 'antique', 999).mul === 1;
    S.hawkers.r.market.follow = { gid: 'snack', until: S.day + 5 };
    o.follow = Hk.factor(S, 'market', 'snack', p).mul < f1.mul; S.hawkers.r.market.follow = null;
    S.hawkers.r.market.cut.snack = { v: 0.15, until: S.day + 2 };
    o.dump = Hk.price(S, 'market', 'snack') < p * 0.9 && Hk.dumping(S, 'market', 'snack');
    delete S.hawkers.r.market.cut.snack;
    const n0 = S.hawkers.r.market.n; Hk.clear(S, 'market', 2); o.clear = S.hawkers.r.market.n === n0 - 2;
    /* 摆摊结算带上散户系数 */
    S.region = 'market'; S.hour = 9; S.stamina = 100; S.cash = 500;
    BT.Trade.buy(S, 'snack', 20); BT.Stall.open(S, 'snack', 1.1);
    const r = BT.Stall.run(S); o.stall = r.ok && r.hawk > 0 && r.hawk < 1;
    for (let i = 0; i < 40; i++) BT.Eco.sleep(S);
    o.bounded = C.REGIONS.every(r => S.hawkers.r[r.id].n >= 0 && S.hawkers.r[r.id].n <= C.HAWKERS.base[r.id] * 2.2 + 2);
    return o;
  });
  check('散户池：按区初始化', h.init);
  check('散户：同款越多 / 你越贵 → 分走越多，便宜能抢回来', h.factor);
  check('散户：不卖的货不受影响', h.noCarry);
  check('散户：跟风同款时分流更狠', h.follow);
  check('散户：游击甩卖压低价格', h.dump);
  check('散户：城管清场减少摊贩', h.clear);
  check('摆摊结算计入散户竞争', h.stall);
  check('散户数量 40 天内保持在合理范围', h.bounded);

  await page.evaluate(() => { BT.App.switchTab('stall'); });
  check('摆摊页显示附近摊贩信息', await page.evaluate(() => /附近摊贩/.test(document.getElementById('stall-box').innerText)));

  /* 2. 公司阶段：层级、单品比价、价格战 */
  const r = await page.evaluate(() => {
    const o = {}, S = BT.S, C = BT.CFG, B = BT.Biz, Rv = BT.Rivals, T = Rv._t;
    S.stall = null; S.cash = 300000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = C.REGIONS.map(x => x.id); S.phase = 2;
    B.ensure(S);
    const xh = Rv.get(S, 'xinhui'), wj = Rv.get(S, 'wanjia'), yy = Rv.get(S, 'yuanyang');
    o.tiers = xh.tier === 'big' && wj.tier === 'mid' && S.biz.rivals.every(x => x.mem && x.camp && x.att != null);
    /* 巨头进货便宜：同样的加价，巨头标价更低 */
    o.bigCheap = Rv.unitCost(S, xh, 'oldst', 'snack') < BT.Eco.buyPrice(S, 'snack', 'oldst');
    B.openShop(S, 'market'); B.openShop(S, 'oldst');
    const sh = S.biz.shops.find(s => s.regionId === 'market');
    B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'clerk');
    ['snack', 'drink', 'fruit'].forEach(g => { B.wholesaleBuy(S, 'market', g, 200); B.transferToShop(S, sh.id, g, 200); B.setShelf(S, sh.id, g, 1.3); });
    /* 单品比价：你越贵，被比下去越多 */
    const price = BT.Eco.buyPrice(S, 'snack', 'market');
    const hLow = Rv.priceHit(S, sh, 'snack', price * 1.1), hHigh = Rv.priceHit(S, sh, 'snack', price * 1.6);
    o.hit = hHigh.mul < hLow.mul && hLow.mul <= 1.2 && hHigh.mul >= 0.3;
    /* 宽限期内中大型不针对你（先把你在批发市场做强，让它有动机） */
    sh.reputation = 90; S.biz.brand = 50; wj.shops.market = { level: 1, rep: 40 }; wj.cash = 40000; wj.fear = 0; /* 固定对手强弱，避免随机开局导致份额不够、不想开战 */
    S.biz.founded = S.day; wj.aggr = 1; wj.att = -100; wj.nextWar = 0;
    for (let i = 0; i < 300; i++) T.planWar(S, wj);
    o.grace = !wj.plan;
    /* 宽限期过后：放风声 → 到期开战 */
    S.biz.founded = S.day - 60; S.biz.rivalNews = [];
    let tries = 0; while (!wj.plan && tries++ < 3000) T.planWar(S, wj);
    o.plan = !!wj.plan && wj.plan.on === 'me' && wj.plan.rid === 'market' && S.biz.rivalNews.some(n => /风声/.test(n.text));
    /* 同时最多 2 家：再塞一个计划，第三家不会再来 */
    yy.shops.market = { level: 1, rep: 50 }; yy.plan = { on: 'me', rid: 'market', goods: ['snack'], mode: 'undercut', days: 9, start: S.day + 2, cut: 0.1 };
    const xy = Rv.get(S, 'xingyao'); xy.shops.market = { level: 1, rep: 50 }; xy.aggr = 1; xy.att = -100; xy.nextWar = 0;
    for (let i = 0; i < 500; i++) T.planWar(S, xy);
    o.cap = !xy.plan; yy.plan = null; delete yy.shops.market; delete xy.shops.market;
    /* 内线：买了情报 → 准确日期 */
    const pl = wj.plan; wj.plan = null; wj.intelUntil = S.day + 10; wj.nextWar = 0; S.biz.rivalNews = [];
    tries = 0; while (!wj.plan && tries++ < 3000) T.planWar(S, wj);
    o.intel = S.biz.rivalNews.some(n => /内线消息/.test(n.text) && /第 \d+ 天/.test(n.text));
    /* 开战 */
    wj.plan.start = S.day; wj.plan.goods = ['snack']; wj.plan.mode = 'undercut'; wj.plan.cut = 0.1; wj.plan.days = 10;
    T.launchPlan(S, wj);
    const cp = wj.camp.market;
    o.war = wj.war.market === 10 && cp && cp.on === 'me' && cp.goods[0] === 'snack' && wj.mem.wars >= 1 && Rv.threats(S).some(t => t.kind === 'war');
    /* 紧咬你的价格：你降它跟，但不会低于底线 */
    const myP = price * 1.3;
    const p1 = Rv.priceOf(S, wj, 'market', 'snack', myP), p2 = Rv.priceOf(S, wj, 'market', 'snack', myP * 0.8), p3 = Rv.priceOf(S, wj, 'market', 'snack', price * 0.5);
    const floor = Rv.unitCost(S, wj, 'market', 'snack') * C.COMPETE.floor.mid;
    o.follow = p1 < myP && p2 < p1 && Math.abs(p3 - Math.round(floor * 100) / 100) < 0.02;
    o.otherGoods = Rv.priceOf(S, wj, 'market', 'drink', myP) > Rv.priceOf(S, wj, 'market', 'snack', myP) * 0 && Rv.priceHit(S, sh, 'snack', myP).camp === cp;
    /* 被点名的货比没被点名的伤得重 */
    o.targetHurts = Rv.priceHit(S, sh, 'snack', myP).mul < Rv.priceHit(S, sh, 'drink', BT.Eco.buyPrice(S, 'drink', 'market') * 1.3).mul;
    /* 自动应战：跟到攻击价，不低于进价 +2% */
    sh.match = true; sh.effP = {}; BT.Eco.sleep(S);
    const cost = (sh.cost && sh.cost.snack) || price * 0.9;
    const shelfNow = Math.round(BT.Eco.buyPrice(S, 'snack', 'market') * 1.3 * 100) / 100; /* 过了一天，进价变了，按当天标价比 */
    o.match = sh.effP.snack < shelfNow - 0.005 && sh.effP.snack >= Math.round(cost * 1.02 * 100) / 100 - 0.01 && (cp.matched || 0) >= 0;
    o.notOthers = Math.abs(sh.effP.drink - Math.round(BT.Eco.buyPrice(S, 'drink', 'market') * 1.3 * 100) / 100) < 0.02 || sh.effP.drink >= BT.Eco.buyPrice(S, 'drink', 'market') * 1.2;
    /* 战果：你扛住 → 它更怕你 */
    const f0 = wj.fear, l0 = wj.mem.lost; cp.my0 = 0.01;
    T.endCampaign(S, wj, 'market', false);
    o.held = wj.fear > f0 && wj.mem.lost === l0 + 1 && !wj.war.market && !wj.camp.market && wj.nextWar > S.day;
    /* 战果：你被打退 → 它更敢来 */
    wj.war.market = 3; wj.camp.market = { on: 'me', goods: ['snack'], mode: 'undercut', cut: 0.1, my0: 0.95, spent: 100 };
    const w0 = wj.mem.won, f1 = wj.fear; T.endCampaign(S, wj, 'market', false);
    o.lost = wj.mem.won === w0 + 1 && wj.fear <= f1;
    /* 钱不够撑完全程就不打 */
    wj.cash = 100; const ev = T.evalWar(S, wj, sh); o.broke = ev && ev.score < 0 && /钱撑不住/.test(ev.why); wj.cash = 40000;
    /* 撑不住提前撤 */
    wj.war.market = 8; wj.camp.market = { on: 'me', goods: ['snack'], mode: 'undercut', cut: 0.1, my0: 0.3, spent: 0 }; wj.cash = 1000;
    Rv.dailyTick(S); o.retreat = !wj.war.market && S.biz.rivalNews.some(n => /提前撤出/.test(n.text));
    /* 巨头掠夺定价：份额高时选择亏本打 */
    xh.cash = 200000; xh.shops.market = { level: 1, rep: 20 };
    const sh2 = S.biz.shops.find(s => s.regionId === 'market'); sh2.reputation = 100; S.biz.brand = 90; sh2.promoDays = 5;
    const evx = T.evalWar(S, xh, sh2); o.predatory = evx && evx.mode === 'predatory';
    delete xh.shops.market;
    /* 态度：你在它地盘新开店 → 敌意上升 */
    wj.att = 0; const a0 = wj.att; wj.seen = wj.seen.filter(x => x !== 'slum'); const os = B.openShop(S, 'slum'); Rv.dailyTick(S);
    o.att = wj.att < a0 - 5 && Rv.attLabel(-60).t === '敌对' && Rv.attLabel(40).t === '友好';
    /* 外来巨头：预告 → 入场 */
    S.biz.founded = S.day - 100; S.biz.giant = null; let gi = 0; while (!S.biz.giant && gi++ < 2000) T.giantTick(S);
    const ann = !!S.biz.giant && S.biz.rivalNews.some(n => /宣布 10 天后进军/.test(n.text));
    S.day = S.biz.giant.arrive; T.giantTick(S);
    const g = Rv.get(S, 'dingsheng'); o.giant = ann && g && g.tier === 'big' && g.alive && U_keys(g.shops).length === 1;
    function U_keys(x) { return Object.keys(x); }
    /* 旧存档迁移：去掉新字段后 ensure 能补齐 */
    const old = S.biz.rivals[0]; delete old.tier; delete old.att; delete old.mem; delete old.camp; delete old.plan; delete old.fear;
    Rv.ensure(S); o.migrate = old.tier && old.mem && old.camp && old.att != null && old.fear === 0;
    return o;
  });
  check('层级：新辉零售是巨头，其余是区域连锁，字段齐全', r.tiers);
  check('巨头进货比你便宜', r.bigCheap);
  check('单品比价：你越贵，被比下去越多', r.hit);
  check('公司成立头 30 天中大型不针对你', r.grace);
  check('宽限期后算账出手：先放风声、定好目标区和商品', r.plan);
  check('同时最多 2 家针对你', r.cap);
  check('买了情报：拿到准确开战日期', r.intel);
  check('预告到期正式开战，记入交手次数', r.war);
  check('价格战紧咬你的价格：你降它跟，压到底线为止', r.follow);
  check('被点名的货伤得比没被点名的重', r.targetHurts);
  check('自动应战：跟到攻击价，不低于保本价', r.match);
  check('自动应战：没被攻击的货保持标价', r.notOthers);
  check('你扛住了 → 它更忌惮你，冷却一段时间', r.held);
  check('你被打退 → 它记作胜利，更敢来', r.lost);
  check('钱不够撑完全程就不打', r.broke);
  check('现金见底提前撤退', r.retreat);
  check('巨头在你份额高时选择掠夺性定价', r.predatory);
  check('态度：在它地盘开店 → 敌意上升；标签正确', r.att);
  check('外来巨头：提前 10 天预告，到期入场', r.giant);
  check('旧存档 AI 公司自动补齐新字段', r.migrate);

  /* 3. UI：竞争页 / 门店页 / 仪表盘 */
  const ui = await page.evaluate(() => {
    const o = {}, S = BT.S, Rv = BT.Rivals, wj = Rv.get(S, 'wanjia');
    wj.war.market = 6; wj.camp.market = { on: 'me', goods: ['snack'], mode: 'undercut', cut: 0.1, my0: 0.3, spent: 1234, matched: 0, start: S.day };
    wj.cash = 40000;
    BT.App.switchTab('biz'); BT.App.bizTab('rivals');
    const t = document.body.innerText;
    o.threat = /针对你的行动/.test(t) && /万家连锁/.test(t) && /还剩 6 天/.test(t);
    o.cards = /对你的态度/.test(t) && /和你交手/.test(t) && /巨头/.test(t) && /区域连锁/.test(t);
    o.hawk = /🧺/.test(t);
    BT.App.bizTab('shops');
    const t2 = document.body.innerText;
    o.shop = /自动应战/.test(t2) && /价格战/.test(t2) && document.querySelector('.sp-rival') !== null;
    BT.App.bizTab('dash'); o.dash = /冲你来的/.test(document.body.innerText);
    return o;
  });
  check('竞争页：针对你的行动卡片', ui.threat);
  check('竞争页：对手卡显示层级 / 态度 / 交手记录', ui.cards);
  check('竞争页：份额条旁显示散户数', ui.hawk);
  check('门店页：自动应战按钮、价格战标签、货架对手价', ui.shop);
  check('仪表盘提醒：冲你来的价格战', ui.dash);

  /* 4. iPad 横屏不溢出 */
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(200);
  const over = await page.evaluate(() => { const out = {}; ['rivals', 'shops', 'dash'].forEach(t => { BT.App.bizTab(t); out[t] = document.documentElement.scrollWidth <= window.innerWidth + 1; }); BT.App.switchTab('stall'); out.stall = document.documentElement.scrollWidth <= window.innerWidth + 1; return out; });
  check('iPad 横屏：竞争 / 门店 / 仪表盘 / 摆摊不溢出', Object.values(over).every(Boolean), JSON.stringify(over));
  await page.setViewportSize({ width: 1400, height: 900 });

  /* 5. 长跑：200 天无 NaN，价格战真的会发生 */
  const run = await page.evaluate(() => {
    BT.newGame(7); BT.Eco.rollWeather(BT.S); BT.Eco.ensurePriceDay(BT.S);
    const S = BT.S, C = BT.CFG, B = BT.Biz;
    S.cash = 60000; S.unlockedRegions = C.REGIONS.map(r => r.id); S.milestones = { m1: true, m2: true, m3: true }; S.phase = 2;
    B.ensure(S); ['market', 'oldst', 'cbd'].forEach(rid => B.openShop(S, rid));
    S.biz.shops.forEach(sh => { B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'clerk'); sh.match = true; });
    let bad = 0, wars = 0;
    for (let d = 0; d < 200; d++) {
      S.biz.shops.forEach(sh => ['snack', 'drink', 'daily', 'cloth'].forEach(g => { if ((sh.inventory[g] || 0) < 25) { B.wholesaleBuy(S, sh.regionId, g, 60); B.transferToShop(S, sh.id, g, 60); } if (!sh.shelf[g]) B.setShelf(S, sh.id, g, 1.3); }));
      (S.biz.deals || []).slice().forEach(x => BT.Rivals.respond(S, x.id, 'decline'));
      BT.Eco.sleep(S);
      if (S.gameOver) break;
      if (!isFinite(BT.netWorth(S)) || S.biz.rivals.some(x => !isFinite(x.cash) || !isFinite(x.att))) { bad++; break; }
      S.biz.shops.forEach(sh => Object.values(sh.effP || {}).forEach(v => { if (!(v > 0)) bad++; }));
    }
    wars = S.biz.rivals.reduce((a, x) => a + (x.mem ? x.mem.wars : 0), 0);
    return { bad, wars, audit: BT.Debug && BT.Debug.audit ? BT.Debug.audit(S) : [], day: S.day };
  });
  check('长跑 200 天：无 NaN、价格战发生过', run.bad === 0 && run.wars > 0 && !(run.audit || []).length, JSON.stringify(run));

  check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(fails ? '\n❌ compete 有 ' + fails + ' 项失败' : '\n🎉 compete 测试全部通过');
  process.exit(fails ? 1 : 0);
})();
