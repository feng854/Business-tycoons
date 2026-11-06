/* ==========================================================================
 * 文件：tests/v74.spec.js
 * 作用：v7.4 业务线回归 —— 批发商（B2B）/ 社区团购 / 奶茶店，以及与流水、净资产、散户、AI 的联动、UI、iPad 横屏
 * 运行：node tests/v74.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 8964;
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

  const setup = `(function (seed) { BT.newGame(seed); BT.Eco.rollWeather(BT.S); BT.Eco.ensurePriceDay(BT.S); var S = BT.S, C = BT.CFG;
    S.cash = 300000; S.unlockedRegions = C.REGIONS.map(function (r) { return r.id; }); S.milestones = { m1: true, m2: true, m3: true }; S.phase = 2; BT.Biz.ensure(S); S.biz.creditScore = 700; return S; })`;

  /* 1. 批发商 */
  const b = await page.evaluate((setup) => {
    const o = {}, C = BT.CFG, S = eval(setup)(41), B = BT.Biz, B2 = BT.B2B;
    o.needWh = !B2.open(S, 'market').ok;
    B.wholesaleBuy(S, 'market', 'snack', 200);
    S.biz.creditScore = 500; o.needCredit = !B2.open(S, 'market').ok; S.biz.creditScore = 700;
    const c0 = S.cash; o.open = B2.open(S, 'market').ok && c0 - S.cash === C.B2B.cost;
    C.HAWKERS.goods.forEach(g => B.wholesaleBuy(S, 'market', g, 300));
    B2.set(S, 'market', 'term', 7);
    BT.Eco.sleep(S);
    const L = S.biz.b2b.last; o.sold = L.units > 0 && L.rev > 0 && S.biz.b2b.ar.length > 0 && Object.keys(S.biz.b2b.share.market || {}).length > 0;
    o.arWorth = B2.netWorth(S) > 0;
    /* 渠道控价：抬批发价 → 散户零售价跟着涨 */
    S.biz.b2b.share.market = { snack: 0.8 }; S.biz.b2b.depots.market.price = 1.0; const h0 = BT.Hawkers.price(S, 'market', 'snack');
    S.biz.b2b.depots.market.price = 1.15; const h1 = BT.Hawkers.price(S, 'market', 'snack');
    o.channel = h1 > h0; S.biz.b2b.depots.market.price = 1.0;
    /* 账期到期收款；坏账 */
    const ar0 = S.biz.b2b.ar.length; S.biz.b2b.ar.forEach(a => a.due = S.day + 1); const keep = C.B2B.badDebt.market; C.B2B.badDebt.market = 1;
    BT.Eco.sleep(S); o.bad = S.biz.b2b.bad.length > 0 && S.biz.b2b.last.bad > 0; C.B2B.badDebt.market = keep;
    const bc = S.cash; const cr = B2.collect(S); o.collect = cr.ok && S.biz.b2b.bad.length === 0;
    /* AI 合同：签约 → 每天送货 → 断供 */
    const rv = BT.Rivals.get(S, 'wanjia'); rv.att = 20;
    S.biz.b2b.offers.push({ id: 'oT', rivalId: 'wanjia', gid: 'drink', qty: 30, price: 5, days: 30, expire: S.day + 2 });
    o.sign = B2.respond(S, 'oT', true).ok && S.biz.b2b.contracts.length === 1;
    const st0 = B.warehouse(S, 'market').goods.drink; BT.Eco.sleep(S);
    o.deliver = B.warehouse(S, 'market').goods.drink <= st0 - 30 || S.biz.b2b.contracts[0].miss === 0;
    rv.shops.market = rv.shops.market || { level: 1, rep: 50 };
    const p0 = BT.Rivals.pull(rv, 'market'); const cut = B2.cutOff(S, S.biz.b2b.contracts[0].id);
    o.cut = cut.ok && rv.cutUntil > S.day && BT.Rivals.pull(rv, 'market') < p0 * 0.85 && S.biz.b2b.contracts.length === 0;
    /* 流水并入 */
    const led = S.biz.ledger[S.biz.ledger.length - 1]; o.ledger = led && led.lines && led.lines.b2b != null;
    return o;
  }, setup);
  check('批发部：要先有仓库、信用够才能开', b.needWh && b.needCredit && b.open);
  check('批发部：给散户出货、按账期记应收、算份额', b.sold && b.arWorth);
  check('渠道控价：抬批发价，散户零售价跟着涨', b.channel);
  check('账期到期可能坏账；催收清账', b.bad && b.collect);
  check('AI 供货合同：签约、送货', b.sign && b.deliver);
  check('断供：对方吸引力下降、合同终止', b.cut);
  check('批发利润并入公司流水', b.ledger);

  /* 2. 社区团购 */
  const g = await page.evaluate((setup) => {
    const o = {}, C = BT.CFG, S = eval(setup)(42), B = BT.Biz, G = BT.GroupBuy;
    o.needShop = !G.open(S, 'slum', 'fruit', 0.85, 5).ok;
    B.openShop(S, 'slum'); const sh = S.biz.shops[0]; B.hire(S, sh.id, 'clerk');
    o.open = G.open(S, 'slum', 'fruit', 0.8, 5).ok;
    B.wholesaleBuy(S, 'slum', 'fruit', 200);
    const nw0 = BT.netWorth(S);
    BT.Eco.sleep(S);
    const gb = S.biz.gb;
    o.orders = gb.last.orders > 0 && gb.prepaid > 0 && gb.due.length === 1;
    o.liab = BT.GroupBuy.liability(S) === Math.round(gb.prepaid);
    const st = B.warehouse(S, 'slum').goods.fruit, due = gb.due[0].qty;
    G.close(S, gb.groups[0].id); BT.Eco.sleep(S);
    o.deliver = gb.prepaid === 0 && gb.due.length === 0 && B.warehouse(S, 'slum').goods.fruit === st - due;
    /* 违约：没货、没钱 → 退款、信用 −15；两次 → 罚款停团 */
    B.warehouse(S, 'slum').goods.fruit = 0; sh.inventory.fruit = 0;
    gb.due = [{ rid: 'slum', gid: 'fruit', qty: 40, paid: 200 }]; gb.prepaid = 200; S.cash = 0; const cr = S.biz.creditScore;
    BT.Eco.sleep(S); o.default = gb.last.defaulted === 1 && S.biz.creditScore <= cr - 15;
    gb.due = [{ rid: 'slum', gid: 'fruit', qty: 40, paid: 200 }]; gb.prepaid = 200; S.cash = 0;
    BT.Eco.sleep(S); o.ban = gb.banUntil > S.day && gb.groups.length === 0 && !G.open(S, 'slum', 'fruit', 0.85, 5).ok;
    /* 团长 */
    S.cash = 50000; o.leader = G.hireLeader(S, 'college').ok && G.canRun(S, 'college');
    return o;
  }, setup);
  check('团购：没门店也没团长的区开不了', g.needShop && g.open);
  check('团购：当晚收款、记预收款负债、明早待交', g.orders && g.liab);
  check('团购：第二天交货、清掉预收款、扣库存', g.deliver);
  check('团购违约：退款、信用 −15', g.default);
  check('团购：30 天内违约 2 次 → 罚款停团', g.ban);
  check('团购：签团长后可在没门店的区开团', g.leader);

  /* 3. 奶茶店 */
  const t = await page.evaluate((setup) => {
    const o = {}, C = BT.CFG, S = eval(setup)(43), T = BT.Tea;
    o.open = T.open(S, 'college').ok && S.biz.tea.shops.length === 1 && !T.open(S, 'college').ok;
    const sh = S.biz.tea.shops[0];
    BT.Eco.sleep(S);
    o.sell = sh.last.cups > 0 && sh.last.rev > 0 && sh.last.cups <= T.cap(sh);
    /* 产能：人少 → 排队流失 */
    sh.staff = 1; const keep = C.TEA.pool.college; C.TEA.pool.college = 2000; BT.Eco.sleep(S); o.queue = sh.last.queueLost > 0 && sh.last.cups <= T.cap(sh); C.TEA.pool.college = keep; sh.staff = 2;
    /* 原料损耗 */
    sh.auto = 0; sh.stock = { base: 100, fresh: 100 }; const st = Object.assign({}, sh.stock); BT.Eco.sleep(S);
    o.spoil = sh.stock.fresh < st.fresh * 0.75; sh.auto = 150;
    /* 新鲜度下降、研发、上架 */
    const f0 = sh.menu[0].fresh; BT.Eco.sleep(S); o.fresh = sh.menu[0].fresh < f0;
    o.rd = T.research(S, 'mango').ok && !T.research(S, 'grape').ok;
    for (let i = 0; i < 3; i++) BT.Eco.sleep(S);
    o.rdDone = S.biz.tea.owned.indexOf('mango') >= 0 && !S.biz.tea.rd && T.addMenu(S, sh.id, 'mango').ok && sh.menu.length === 4 && !T.addMenu(S, sh.id, 'pearl').ok;
    /* 卫生抽查：不合格停业 */
    sh.hygiene = 10; let n = 0; while (!sh.closed && n++ < 300) { sh.hygiene = 10; BT.Eco.sleep(S); }
    o.closed = sh.closed > 0 || sh.last.closed;
    T.clean(S, sh.id); o.clean = sh.hygiene === 100;
    /* 潮流 + 跟风 */
    S.biz.tea.trend = null; S.biz.tea.nextTrend = S.day; BT.Eco.sleep(S);
    o.trend = !!S.biz.tea.trend && Object.keys(S.biz.tea.rivals).some(r => S.biz.tea.rivals[r].copies[S.biz.tea.trend.pid]);
    o.worth = T.netWorth(S) > 0;
    const led = S.biz.ledger[S.biz.ledger.length - 1]; o.ledger = led && led.lines && led.lines.tea != null;
    o.upgrade = T.upgrade(S, sh.id).ok && sh.level === 2 && T.cap(sh) > 100;
    return o;
  }, setup);
  check('奶茶店：每区一家、开张即营业', t.open && t.sell);
  check('奶茶店：人手不够就排队流失', t.queue);
  check('奶茶店：鲜果隔夜损耗', t.spoil);
  check('奶茶店：饮品新鲜度每天下降', t.fresh);
  check('奶茶店：研发 3 天出结果，可上架（菜单最多 4 款）', t.rd && t.rdDone);
  check('奶茶店：卫生太差被抽查停业，清洁恢复', t.closed && t.clean);
  check('奶茶店：茶饮潮流出现，AI 品牌跟风', t.trend);
  check('奶茶店：计入净资产与公司流水、可升级', t.worth && t.ledger && t.upgrade);

  /* 4. UI */
  const ui = await page.evaluate(() => {
    const o = {};
    BT.App.switchTab('biz'); BT.App.bizTab('lines');
    o.b2b = /批发商：给散户/.test(document.body.innerText);
    BT.App.lineTab('gb'); o.gb = /先收钱、后交货/.test(document.body.innerText);
    BT.App.lineTab('tea'); o.tea = /毛利高、人工重/.test(document.body.innerText) && /研发/.test(document.body.innerText);
    return o;
  });
  check('业务线页：批发 / 团购 / 奶茶三个子页', ui.b2b && ui.gb && ui.tea);
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(200);
  const over = await page.evaluate(() => { const out = {}; ['b2b', 'gb', 'tea'].forEach(t => { BT.App.lineTab(t); out[t] = document.documentElement.scrollWidth <= window.innerWidth + 1; }); return out; });
  check('iPad 横屏：三个子页不溢出', Object.values(over).every(Boolean), JSON.stringify(over));

  /* 5. 长跑：三条业务线一起跑 120 天 */
  const run = await page.evaluate((setup) => {
    const C = BT.CFG, S = eval(setup)(44), B = BT.Biz;
    B.openShop(S, 'slum'); B.hire(S, S.biz.shops[0].id, 'clerk');
    B.wholesaleBuy(S, 'market', 'snack', 200); BT.B2B.open(S, 'market'); BT.B2B.set(S, 'market', 'term', 7);
    BT.GroupBuy.open(S, 'slum', 'fruit', 0.85, 8); BT.Tea.open(S, 'oldst');
    let bad = 0;
    for (let d = 0; d < 120; d++) {
      C.HAWKERS.goods.forEach(g => { if ((B.warehouse(S, 'market').goods[g] || 0) < 200) B.wholesaleBuy(S, 'market', g, 300); });
      if ((B.warehouse(S, 'slum').goods.fruit || 0) < 100) B.wholesaleBuy(S, 'slum', 'fruit', 200);
      (S.biz.deals || []).slice().forEach(x => BT.Rivals.respond(S, x.id, 'decline'));
      BT.Eco.sleep(S); if (S.gameOver) break;
      if (!isFinite(BT.netWorth(S)) || !isFinite(S.cash)) { bad++; break; }
    }
    return { bad, nw: BT.netWorth(S), b2b: BT.B2B.summary(S).p7, gb: S.biz.gb.hist.length, tea: S.biz.tea.hist.length };
  }, setup);
  check('长跑 120 天：三条业务线一起运行无 NaN', run.bad === 0 && run.gb > 0 && run.tea > 0, JSON.stringify(run));

  check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(fails ? '\n❌ v7.4 有 ' + fails + ' 项失败' : '\n🎉 v7.4 测试全部通过');
  process.exit(fails ? 1 : 0);
})();
