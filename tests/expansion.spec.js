/* ==========================================================================
 * 文件：tests/expansion.spec.js
 * 作用：第 1~3 批新功能回归 —— 下架退仓、iPad 长按调试、PWA 文件、广告、保险、热销轮换、物业免租、
 *       区域经理、城市事件、仪表盘、罢工 / 会员、云存档（真实运行 functions/api/save.js + 模拟 KV）、
 *       加盟、政府招标、天使投资、商会人脉、商业情报、富豪榜、股权激励、长跑无 NaN、iPad 不溢出
 * 运行：node tests/expansion.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs'), { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..'), PORT = 8957;
const KV = new Map(), mockEnv = { BT_SAVES: { get: async k => KV.has(k) ? KV.get(k) : null, put: async (k, v) => { KV.set(k, v); } } };
let fails = 0;
function check(name, ok, extra) { console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; }

(async () => {
  const fn = await import(pathToFileURL(path.join(ROOT, 'functions/api/save.js')).href);
  http.createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/api/save') {
      let body = ''; for await (const c of req) body += c;
      const r = await fn.onRequest({ request: new Request('http://x/api/save', { method: req.method, body: req.method === 'POST' ? body : undefined, headers: { 'content-type': 'application/json' } }), env: mockEnv });
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text()); return;
    }
    fs.readFile(path.join(ROOT, p), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[path.extname(p)] || 'application/octet-stream' }); res.end(data);
    });
  }).listen(PORT);
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' }), page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|TUNNEL|CONNECTION|status of 40[034]/.test(m.text())) errors.push(m.text()); }); /* 云存档测试故意触发的 400/403/404 不算 */
  await page.goto(`http://localhost:${PORT}/index.html`); await page.click('#btn-newgame'); await page.waitForSelector('#game.active');
  await page.evaluate(() => BT.FX.tutSkip());

  /* PWA 文件 */
  const pwa = await page.evaluate(async () => {
    const m = await (await fetch('manifest.json')).json(), sw = await fetch('sw.js'), ic = await fetch('icons/icon-512.png');
    return { name: m.short_name === '商业巨子', icons: m.icons.length === 2, sw: sw.ok, icon: ic.ok, meta: !!document.querySelector('meta[name=apple-mobile-web-app-capable]') };
  });
  check('主屏幕 App：manifest / 图标 / 离线缓存脚本 / iOS 元信息', Object.values(pwa).every(Boolean), JSON.stringify(pwa));

  const r = await page.evaluate(() => {
    const S = BT.S, B = BT.Biz, C = BT.CFG, o = {};
    S.cash = 400000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = C.REGIONS.map(x => x.id); S.phase = 2; B.ensure(S); BT.Market.ensure(S); S.biz.brand = 45;
    ['cbd', 'oldst', 'college', 'port'].forEach(r => B.openShop(S, r));
    S.biz.shops.forEach(sh => { B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'clerk'); ['snack', 'drink', 'daily', 'stationery'].forEach(g => B.setShelf(S, sh.id, g, 1.3)); });
    B.autoRestock(S);
    const sh = S.biz.shops[0];
    /* 下架退仓 */
    const q = sh.inventory.snack, w0 = B.warehouse(S, 'cbd').goods.snack || 0; const un = B.unshelf(S, sh.id, 'snack');
    o.unshelf = un.ok && !sh.inventory.snack && !sh.shelf.snack && (B.warehouse(S, 'cbd').goods.snack || 0) === w0 + q;
    /* 广告 */
    const t0 = BT.Eco.trafficMul(S, 'cbd'); o.flyer = BT.Ads.run(S, 'flyer', 'cbd').ok && BT.Eco.trafficMul(S, 'cbd') > t0 && !BT.Ads.run(S, 'flyer', 'cbd').ok;
    const b0 = S.biz.brand; o.tv = BT.Ads.run(S, 'tv').ok; for (let i = 0; i < 3; i++) BT.Ads.dailyTick(S); o.tvBrand = S.biz.brand > b0;
    o.kol = BT.Ads.run(S, 'kol', 'college', 'stationery').ok;
    /* 保险 */
    o.ins = BT.Insurance.buy(S, 'property').ok && BT.Insurance.has(S, 'property') && BT.Insurance.claim(S, 'property', 1000, 0.9, 'test') === 900;
    o.insCargo = BT.Insurance.buy(S, 'cargo').ok;
    /* 热销轮换：季节 + 爆款 */
    o.season = BT.Trends.season(BT.U.dayOfDate(2026, 7, 15)).some(x => x.gid === 'drink' && x.mul > 1) && BT.Trends.season(BT.U.dayOfDate(2026, 9, 5)).some(x => x.rid === 'college' && x.gid === 'stationery');
    S.trends = { viral: [{ id: 'v1', rid: 'oldst', gid: 'tea', mul: 2.5, start: S.day, end: S.day + 3, announced: true }], researchUntil: 0 };
    o.viral = Math.abs(BT.Trends.mul(S, 'oldst', 'tea') / BT.Trends.mul(S, 'cbd', 'tea') - 2.5) < 0.01 && BT.Eco.demand(S, 'oldst', 'tea') > C.demandOf('oldst', 'tea') * 2;
    o.research = BT.Trends.research(S).ok && BT.Trends.researchActive(S);
    /* 物业免租 */
    const rent = sh.rent; o.estateBuy = BT.Empire.buy(S, 'cbd').ok;
    BT.Eco.sleep(S); o.rentFree = sh.ownBuilding === true && S.biz.ledger.slice(-1)[0].rent < S.biz.shops.reduce((a, x) => a + x.rent, 0) && BT.Empire.dailyRent(S, 'cbd') === 0;
    /* 城市事件：强制一次地铁 + 台风 + 火灾 */
    const City = BT.City, cs = City.state(S);
    const p0 = BT.Empire.price(S, 'oldst');
    cs.pending.push({ type: 'metro', rids: ['oldst', 'college'], line: 3, publicDay: S.day + 1, at: S.day + 2 });
    BT.Eco.sleep(S); o.metroAnnounce = BT.Empire.price(S, 'oldst') > p0 * 1.04;
    BT.Eco.sleep(S); o.metroOpen = (cs.perm.oldst || 1) >= 1.08 && City.traffic(S, 'oldst') > 1.05;
    const inv0 = S.biz.shops.reduce((a, x) => a + Object.values(x.inventory).reduce((p, q) => p + q, 0), 0), cl0 = S.biz.ins.claims;
    B.setShelf(S, sh.id, 'drink', 1.3); B.autoRestock(S);
    cs.pending.push({ type: 'fire', rids: [sh.regionId], shopId: sh.id, at: S.day + 1 });
    BT.Eco.sleep(S);
    o.fire = sh.closedDays > 0 && S.biz.ins.claims > cl0;
    /* 区域经理 */
    o.mgrHire = BT.Manager.hire(S).ok; sh.inventory.drink = 0;
    BT.Eco.sleep(S); BT.Eco.sleep(S);
    o.mgrWork = (sh.inventory.drink || 0) > 0 || sh.closedDays > 0; o.mgrPrice = Object.keys(sh.shelf).every(g => Math.abs(sh.shelf[g] - BT.Manager.suggestMarkup(S, sh.regionId, g)) < 0.03);
    /* 罢工 / 会员 */
    const s2 = S.biz.shops[1]; B.hire(S, s2.id, 'clerk'); s2.employees.forEach(e => { e.loyalty = 10; e.wage = 30; }); s2.strike = 3;
    o.strike = B.settleStrike(S, s2.id).ok && !s2.strike && s2.employees.every(e => e.loyalty >= 25);
    o.member = B.startMembership(S, s2.id).ok; for (let i = 0; i < 10; i++) BT.Eco.sleep(S); o.members = s2.members > 0;
    /* 加盟 */
    const F = BT.Franchise; o.frSetup = F.setup(S, 10000, 0.05).ok;
    F.get(S).apps.push({ id: 'fa1', name: '测试', rid: 'slum', quality: 0.8, grade: 'A', fee: 10000, expire: S.day + 3 });
    const c1 = S.cash; o.frApprove = F.approve(S, 'fa1').ok && S.cash === c1 + 10000;
    for (let i = 0; i < 5; i++) BT.Eco.sleep(S); o.frIncome = F.get(S).income > 0;
    /* 政府招标：投标 → 中标（报很低）→ 交货 */
    const Td = BT.Tender, ts = (S.tenders = S.tenders || { list: [], next: 999 });
    ts.next = 9999; ts.list.push({ id: 'tt', buyer: '测试局', gid: 'drink', qty: 50, budget: 99, open: S.day, close: S.day + 1, deadline: S.day + 6, status: 'open' });
    o.bid = Td.bid(S, 'tt', 0.5).ok; o.bidCap = !Td.bid(S, 'tt', 120).ok;
    BT.Eco.sleep(S); const t = ts.list.find(x => x.id === 'tt'); o.won = t.status === 'won';
    B.wholesaleBuy(S, 'cbd', 'drink', 60); const cr0 = S.biz.creditScore; o.deliver = Td.deliver(S, 'tt').ok && t.status === 'delivered' && S.biz.creditScore > cr0;
    /* 天使投资 */
    const V = BT.Venture, vs = V.state(S); vs.pitches.push({ id: 'vp', name: '测试科技', icon: '🤖', sector: 'tech', desc: 'x', valuation: 500000, ask: 20000, stake: 0.04, expire: S.day + 3, risk: '' });
    const nw0 = BT.netWorth(S); o.vc = V.invest(S, 'vp').ok && Math.abs(BT.netWorth(S) - nw0) < 50;
    vs.holds[0].next = S.day + 1; vs.holds[0].round = 5; let rounds = 0; while (vs.holds[0].alive && rounds++ < 20) { vs.holds[0].next = S.day + 1; BT.Eco.sleep(S); }
    o.vcResolve = !vs.holds[0].alive;
    /* 商会 */
    const So = BT.Social; o.join = So.join(S).ok;
    const lr0 = B.loanRate(S); So.state(S).contacts.banker.rel = 65; o.banker = B.loanRate(S) < lr0 * 0.75;
    S.hour = 8; o.dinner = So.dinner(S, 'realtor').ok && !So.dinner(S, 'realtor').ok;
    So.state(S).contacts.realtor.rel = 60; o.insiderLevel = So.level(S, 'realtor') >= 50;
    /* 商业情报 */
    const rv = BT.Rivals.alive(S)[0]; o.spy = So.spy(S, rv.id).ok && !!So.intel(S, rv);
    /* 富豪榜 */
    So.state(S).nextRich = S.day; BT.Eco.sleep(S); o.rich = !!So.state(S).rich && So.state(S).rich.rows.some(x => x.me);
    /* 股权激励（直接置为上市状态测试） */
    BT.IPO.ensure(S); Object.assign(S.ipo, { status: 'listed', totalShares: 100000, holdShares: 85000, listDay: S.day, ipoPrice: 10, basePrice: 10, name: 'T', ticker: 'TTTT' });
    S.market.stocks.mine = { price: 10, hist: [], financials: [], float: 15000 }; BT.IPO.syncDef(S);
    const esh = S.biz.shops.find(x => x.employees.length) || S.biz.shops[1]; if (!esh.employees.length) B.hire(S, esh.id, 'clerk'); /* 前面罢工测试故意压低了工资，员工可能已辞职 */
    const emp = esh.employees[0]; o.equity = BT.IPO.grantEquity(S, esh.id, emp.id).ok && emp.loyalty === 100 && S.ipo.holdShares === 84500;
    /* 仪表盘渲染 */
    BT.App.switchTab('biz'); ['dash', 'promo', 'expand', 'shops', 'rivals'].forEach(t => BT.App.bizTab(t));
    BT.App.bizTab('dash'); o.dash = !!document.querySelector('#biz-box .alert-row, #biz-box .hint') && /经营仪表盘/.test(document.getElementById('biz-box').innerText);
    BT.App.bizTab('expand'); o.expandUi = /加盟连锁/.test(document.getElementById('biz-box').innerText) && /新港富豪榜/.test(document.getElementById('biz-box').innerText);
    o.audit = BT.Debug.audit(); o.finite = isFinite(BT.netWorth(S));
    return o;
  });
  console.log('   ', JSON.stringify(r));
  check('下架：库存连成本退回仓库', r.unshelf);
  check('广告：传单加客流且不能重复 / 电视加品牌 / 网红带货', r.flyer && r.tv && r.tvBrand && r.kol);
  check('保险：财产险投保与理赔 / 货运险', r.ins && r.insCargo);
  check('热销轮换：季节规则 / 网红爆款 / 市场调研', r.season && r.viral && r.research);
  check('物业挂钩：买下门店所在物业后免租', r.estateBuy && r.rentFree);
  check('城市事件：地铁公布房价涨 / 通车客流永久提升 / 火灾停业 + 保险理赔', r.metroAnnounce && r.metroOpen && r.fire);
  check('区域经理：自动补货 + 自动定价', r.mgrHire && r.mgrWork && r.mgrPrice);
  check('罢工可平息 / 会员积累', r.strike && r.member && r.members);
  check('加盟：开放招商 / 批准收加盟费 / 每日抽成', r.frSetup && r.frApprove && r.frIncome);
  check('政府招标：投标 / 预算上限 / 中标 / 交货加信用', r.bid && r.bidCap && r.won && r.deliver);
  check('天使投资：按成本计净资产 / 轮次结算', r.vc && r.vcResolve);
  check('商会：入会 / 银行家降息 / 宴请冷却 / 地产商内部消息等级', r.join && r.banker && r.dinner && r.insiderLevel);
  check('商业情报 / 富豪榜 / 股权激励', r.spy && r.rich && r.equity);
  check('仪表盘与拓展页渲染', r.dash && r.expandUi);
  check('新功能后一致性审计 + 数值有效', r.finite && r.audit.length === 0, JSON.stringify(r.audit));

  /* 云存档：真实调用 functions/api/save.js（模拟 KV） */
  const cloud = await page.evaluate(async () => {
    const o = {}, C = BT.Cloud, day = BT.S.day;
    o.bad = !(await C.upload('ab', '1234')).ok;
    o.up = (await C.upload('TESTCODE1', 'pass1234')).ok;
    o.wrong = (await C.download('TESTCODE1', 'nope1234')).ok === false;
    BT.Eco.sleep(BT.S); BT.Eco.sleep(BT.S);
    const d = await C.download('TESTCODE1', 'pass1234'); o.down = d.ok && BT.S.day === day;
    o.missing = (await C.download('NOSUCH99', 'pass1234')).ok === false;
    return o;
  });
  check('云存档：校验 / 上传 / 错误密码 / 下载回滚 / 不存在', Object.values(cloud).every(Boolean), JSON.stringify(cloud));
  const kvRaw = [...KV.values()][0] || '{}';
  check('云存档服务端不存明文密码', kvRaw.indexOf('pass1234') < 0 && /"hash":"[0-9a-f]{64}"/.test(kvRaw));

  /* iPad 长按标题打开调试 */
  await page.goto(`http://localhost:${PORT}/index.html?debug=1`); await page.click('#btn-newgame'); await page.waitForSelector('#game.active');
  await page.evaluate(() => BT.FX.tutSkip()); await page.click('[data-tab="market"]'); await page.waitForTimeout(300);
  const box = await (await page.$('#mkt-title')).boundingBox();
  await page.mouse.move(box.x + 20, box.y + 8); await page.mouse.down(); await page.waitForTimeout(3300); await page.mouse.up();
  check('iPad：长按标题 3 秒打开调试', await page.evaluate(() => BT.Debug.isOpen()));
  await page.evaluate(() => BT.Debug.close());

  /* 长跑：两家门店 + 所有新系统 300 天 */
  const run = await page.evaluate(() => {
    BT.App.newGame('normal'); BT.FX.tutSkip(); const S = BT.S, B = BT.Biz;
    S.cash = 80000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = BT.CFG.REGIONS.map(x => x.id); S.phase = 2; B.ensure(S); BT.Market.ensure(S);
    ['market', 'oldst', 'cbd'].forEach(r => B.openShop(S, r)); S.biz.shops.forEach(sh => { B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'clerk'); });
    B.autoRestock(S); BT.Manager.hire(S); BT.Social.join(S); BT.Insurance.buy(S, 'property');
    const bad = []; const ev = { city: 0, viral: 0, tender: 0, pitch: 0 };
    for (let d = 0; d < 300; d++) {
      (S.biz.deals || []).slice().forEach(x => BT.Rivals.respond(S, x.id, 'decline'));
      if (S.biz.fr && S.biz.fr.apps.length) BT.Franchise.approve(S, S.biz.fr.apps[0].id);
      if (d === 60) { S.biz.brand = Math.max(S.biz.brand, 45); BT.Franchise.setup(S, 12000, 0.06); }
      BT.Eco.sleep(S);
      ev.city = (S.city && S.city.news.length) || 0; ev.tender = Math.max(ev.tender, (S.tenders && S.tenders.list.length) || 0); ev.viral = Math.max(ev.viral, (S.trends && S.trends.viral.length) || 0); ev.pitch += (S.vc && S.vc.pitches.length) ? 1 : 0;
      if (!isFinite(BT.netWorth(S)) || !isFinite(S.cash)) { bad.push('NaN@' + d); break; }
      if (S.gameOver) { break; }
    }
    return { bad, ev, audit: BT.Debug.audit(), day: S.day, net: BT.netWorth(S), over: S.gameOver && S.gameOver.type, size: JSON.stringify(S).length };
  });
  console.log('    长跑:', JSON.stringify(run));
  check('300 天长跑：无 NaN、审计通过、城市 / 爆款 / 招标 / 路演都出现过', !run.bad.length && !run.audit.length && run.ev.city > 0 && run.ev.viral > 0 && run.ev.tender > 0 && run.ev.pitch > 0);
  check('存档体积合理（< 1MB）', run.size < 1e6, Math.round(run.size / 1024) + 'KB');

  /* iPad 横屏：新页面不溢出 */
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(300);
  const over = await page.evaluate(() => {
    const out = {}; BT.App.switchTab('biz');
    ['dash', 'shops', 'promo', 'expand', 'supply', 'rivals'].forEach(t => { BT.App.bizTab(t); out[t] = document.documentElement.scrollWidth <= window.innerWidth + 1; });
    BT.App.switchTab('save'); out.save = document.documentElement.scrollWidth <= window.innerWidth + 1;
    return out;
  });
  check('iPad 横屏：仪表盘 / 门店 / 营销 / 拓展 / 供应链 / 竞争 / 存档页不溢出', Object.values(over).every(Boolean), JSON.stringify(over));
  check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(fails ? '\n❌ expansion 测试有 ' + fails + ' 项失败' : '\n🎉 expansion 测试全部通过');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
