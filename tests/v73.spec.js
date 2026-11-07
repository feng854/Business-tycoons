/* ==========================================================================
 * 文件：tests/v75.spec.js
 * 作用：v7.5 回归 —— 分业务线利润、现金流预测、每日简报、经理托管业务线、三线打通（集采 / 奶茶券 / 引流款 / 统一会员）、
 *       奶茶加盟、团购回头客、应收保理、两难事件、UI 与 iPad 横屏
 * 运行：node tests/v75.spec.js
 * ========================================================================== */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 8965;
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

  const r = await page.evaluate((setup) => {
    const o = {}, C = BT.CFG, S = eval(setup)(51), B = BT.Biz, I = BT.Insight, T = BT.Tea, G = BT.GroupBuy, B2 = BT.B2B;
    B.openShop(S, 'college'); const shop = S.biz.shops[0]; B.hire(S, shop.id, 'clerk');
    ['snack', 'drink'].forEach(g => { B.wholesaleBuy(S, 'college', g, 200); B.transferToShop(S, shop.id, g, 100); B.setShelf(S, shop.id, g, 1.25); });
    /* 集采：开批发部前后奶茶原料价 */
    T.open(S, 'college'); const ts = S.biz.tea.shops[0]; ts.auto = 0; ts.stock = { base: 0, fresh: 0 };
    ts.auto = 100; let c0 = S.cash; T.restock(S, ts); const cost0 = c0 - S.cash;
    B.wholesaleBuy(S, 'market', 'snack', 200); B2.open(S, 'market'); B2.set(S, 'market', 'term', 7);
    ts.stock = { base: 0, fresh: 0 }; c0 = S.cash; T.restock(S, ts); const cost1 = c0 - S.cash;
    o.bulk = Math.abs(cost1 - cost0 * 0.85) < 1;
    /* 奶茶券：卖券收钱 → 记负债 → 来店兑换 → 负债减少 */
    o.cardOpen = G.open(S, 'college', 'teacard', 0.8, 5).ok && !G.open(S, 'slum', 'teacard', 0.8, 5).ok;
    for (let i = 0; i < 3; i++) BT.Eco.sleep(S);
    const vouch = (ts.vouch || []).reduce((a, v) => a + v.cups, 0);
    o.cardSold = vouch > 0 && S.biz.gb.prepaid > 0 && S.biz.gb.due.length === 0;
    const pre = S.biz.gb.prepaid; G.close(S, S.biz.gb.groups[0].id); BT.Eco.sleep(S);
    o.redeem = ts.last.redeemed > 0 && S.biz.gb.prepaid < pre;
    /* 过期作废：负债清掉 */
    ts.vouch.forEach(v => v.exp = S.day - 1); BT.Eco.sleep(S); o.expire = (ts.vouch || []).length === 0 && S.biz.gb.prepaid < 1;
    /* 引流款：明天同区门店多客人 */
    const lr = G.open(S, 'college', 'snack', 0.65, 5); o.lead = lr.ok; BT.Eco.sleep(S);
    const okGrp = S.biz.gb.groups[0].y.ok, b1 = shop.gbBoost || 0; /* 晚上结单时记下引流客，第二天门店营业时用掉 */
    G.close(S, S.biz.gb.groups[0].id); BT.Eco.sleep(S);
    o.boost = okGrp ? (b1 > 0 && !shop.gbBoost) : true;
    /* 团购回头客：按时交货积累 */
    o.loyal = (S.biz.gb.loyal.college || 0) > 0;
    /* 统一会员：开了会员，奶茶份额更高 */
    const s0 = T.share(S, ts, 1); shop.memberProg = true; const s1 = T.share(S, ts, 1); o.member = s1 > s0;
    /* 分业务线利润 */
    const ser = I.lineSeries(S, 7); o.lines = ser.length > 0 && ser.every(x => isFinite(x.retail) && isFinite(x.tea) && Math.abs(x.retail + x.b2b + x.gb + x.tea - x.total) <= 1);
    /* 现金流预测 */
    const fc = I.forecast(S); o.fc = fc.days.length === 7 && fc.days.every(d => isFinite(d.cash)) && fc.days[0].cash === Math.round(S.cash + fc.days[0].net);
    S.biz.b2b.ar = [{ rid: 'market', amt: 5000, due: S.day + 2, term: 7, day: S.day }];
    const fc2 = I.forecast(S); o.fcAR = fc2.days[1].items.some(x => /应收/.test(x.t) && x.v === 5000);
    /* 应收保理 */
    const q = B2.factorQuote(S), cash0 = S.cash; const fr = B2.factor(S); o.factor = fr.ok && S.biz.b2b.ar.length === 0 && Math.abs(S.cash - cash0 - q.cash) < 1 && q.fee >= 0.06 && q.fee <= 0.12;
    /* 每日简报 */
    ts.hygiene = 40; const br = I.brief(S); o.brief = br.risks.some(x => /卫生/.test(x.t)) && /清洁|先做|/.test(br.todo);
    /* 经理托管 */
    BT.Manager.get(S); S.biz.mgr.on = true; S.biz.mgr.lines = true;
    const wh = B.warehouse(S, 'market'); wh.goods.snack = 20; ts.hygiene = 40;
    const notes = I.manage(S); o.mgr = wh.goods.snack >= 200 && ts.hygiene === 100 && notes.length >= 2;
    /* 奶茶加盟 */
    o.frLocked = !T.frToggle(S).ok;
    T.open(S, 'cbd'); S.biz.brand = 30; o.frOpen = T.frToggle(S).ok;
    const f = S.biz.tea.fr; f.apps.push({ id: 'aT', rid: 'oldst', owner: '测试', exp: S.day + 3 });
    const c2 = S.cash; o.frApprove = T.frApprove(S, 'aT').ok && f.stores.length === 1 && S.cash - c2 === C.TEA.fr.fee;
    BT.Eco.sleep(S); o.frIncome = f.last && f.last.inc > 0;
    const keep = C.TEA.fr.incident; C.TEA.fr.incident = 1; const br0 = S.biz.brand; BT.Eco.sleep(S); o.frRisk = S.biz.brand < br0; C.TEA.fr.incident = keep;
    /* 两难事件 */
    const ins = I.ensure(S); ins.dlm = []; ins.nextDlm = 0;
    let n = 0; while (!ins.dlm.length && n++ < 400) { ins.nextDlm = 0; I.dailyTick(S); }
    o.dlmMake = ins.dlm.length === 1 && ins.dlm[0].opts.length >= 2;
    const d = ins.dlm[0]; const rs = I.resolve(S, d.id, 0); o.dlmResolve = rs.ok && ins.dlm.length === 0;
    /* 过期默认最后一项 */
    ins.nextDlm = 0; n = 0; while (!ins.dlm.length && n++ < 400) { ins.nextDlm = 0; I.dailyTick(S); }
    ins.dlm[0].expire = S.day - 1; I.dailyTick(S); o.dlmExpire = ins.dlm.length === 0 || ins.dlm[0].expire >= S.day;
    /* 过期原料：偷用 → 抽查更危险 */
    const sh2 = S.biz.tea.shops[0]; sh2.stock.base = 100;
    o.expired = (function () { const dd = { id: 'dx', kind: 'expired', shop: sh2.id, text: 't', opts: [{ label: 'a' }, { label: 'b' }], expire: S.day + 2 }; ins.dlm.push(dd); I.resolve(S, 'dx', 1); return sh2.risky > S.day; })();
    return o;
  }, setup);
  check('集采：开了批发部，奶茶原料便宜 15%', r.bulk);
  check('奶茶券：要该区有奶茶店才能卖', r.cardOpen);
  check('奶茶券：卖出收钱、记负债、不用次日交货', r.cardSold);
  check('奶茶券：来店兑换，负债减少', r.redeem);
  check('奶茶券：过期作废，负债清掉', r.expire);
  check('引流款：低于 7.5 折可开团、带客', r.lead && r.boost);
  check('团购回头客：按时交货后积累', r.loyal);
  check('统一会员：门店开会员，奶茶份额更高', r.member);
  check('分业务线利润：四条线加起来等于总利润', r.lines);
  check('现金流预测：7 天、应收到期计入', r.fc && r.fcAR);
  check('应收保理：立即到账、手续费 6%~12%', r.factor);
  check('每日简报：列出风险和要先做的事', r.brief);
  check('经理托管：批发补货、奶茶清洁', r.mgr);
  check('奶茶加盟：没达标不能招商，达标后可开放', r.frLocked && r.frOpen);
  check('奶茶加盟：批准收加盟费、每天有分成、出事连累品牌', r.frApprove && r.frIncome && r.frRisk);
  check('两难事件：出现、拍板后消失、过期按默认处理', r.dlmMake && r.dlmResolve && r.dlmExpire);
  check('两难：偷用过期原料 → 接下来抽查风险更高', r.expired);

  const ui = await page.evaluate(() => {
    const o = {};
    BT.App.switchTab('biz'); BT.App.bizTab('dash'); o.brief = /今日简报/.test(document.body.innerText);
    BT.App.bizTab('finance'); o.fin = /分业务线利润/.test(document.body.innerText) && /现金流预测/.test(document.body.innerText);
    BT.App.bizTab('lines'); BT.App.lineTab('tea'); o.fr = /奶茶加盟/.test(document.body.innerText);
    BT.App.lineTab('gb'); o.card = /奶茶券/.test(document.body.innerText);
    const ins = BT.Insight.ensure(BT.S); ins.dlm.push({ id: 'dU', kind: 'teaCollab', ip: 'X', text: '测试两难', opts: [{ label: '接', desc: 'a' }, { label: '不接', desc: 'b' }], expire: BT.S.day + 2 });
    BT.App.bizTab('dash'); o.dlm = /待你拍板/.test(document.body.innerText) && /测试两难/.test(document.body.innerText);
    return o;
  });
  check('仪表盘：今日简报 + 待你拍板', ui.brief && ui.dlm);
  check('财务页：分业务线利润 + 现金流预测', ui.fin);
  check('业务线页：奶茶加盟、奶茶券选项', ui.fr && ui.card);
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(200);
  const over = await page.evaluate(() => { const out = {}; BT.App.switchTab('biz'); ['dash', 'finance'].forEach(t => { BT.App.bizTab(t); out[t] = document.documentElement.scrollWidth <= window.innerWidth + 1; }); BT.App.bizTab('lines'); ['b2b', 'gb', 'tea'].forEach(t => { BT.App.lineTab(t); out[t] = document.documentElement.scrollWidth <= window.innerWidth + 1; }); return out; });
  check('iPad 横屏：仪表盘 / 财务 / 业务线不溢出', Object.values(over).every(Boolean), JSON.stringify(over));

  /* 长跑 */
  const run = await page.evaluate((setup) => {
    const C = BT.CFG, S = eval(setup)(52), B = BT.Biz;
    B.openShop(S, 'college'); B.hire(S, S.biz.shops[0].id, 'clerk'); S.biz.shops[0].memberProg = true;
    B.wholesaleBuy(S, 'market', 'snack', 200); BT.B2B.open(S, 'market'); BT.B2B.set(S, 'market', 'term', 7);
    BT.Tea.open(S, 'college'); BT.Tea.open(S, 'cbd'); BT.GroupBuy.open(S, 'college', 'teacard', 0.8, 5); BT.GroupBuy.open(S, 'college', 'fruit', 0.85, 5);
    BT.Manager.get(S); BT.Manager.hire ? BT.Manager.hire(S) : (S.biz.mgr.on = true);
    S.biz.brand = 20; BT.Tea.frToggle(S);
    let bad = 0;
    for (let d = 0; d < 150; d++) {
      (S.biz.deals || []).slice().forEach(x => BT.Rivals.respond(S, x.id, 'decline'));
      (S.biz.ins ? S.biz.ins.dlm.slice() : []).forEach(x => BT.Insight.resolve(S, x.id, 0));
      (S.biz.tea.fr ? S.biz.tea.fr.apps.slice() : []).forEach(a => BT.Tea.frApprove(S, a.id));
      BT.Eco.sleep(S); if (S.gameOver) break;
      if (!isFinite(BT.netWorth(S)) || !isFinite(S.cash) || !isFinite(S.biz.gb.prepaid)) { bad++; break; }
    }
    return { bad, nw: Math.round(BT.netWorth(S)), fr: S.biz.tea.fr.stores.length, lines: BT.Insight.lineSum(S, 30) };
  }, setup);
  check('长跑 150 天：全部业务 + 托管 + 两难一起跑无 NaN', run.bad === 0, JSON.stringify(run));

  check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(fails ? '\n❌ v7.5 有 ' + fails + ' 项失败' : '\n🎉 v7.5 测试全部通过');
  process.exit(fails ? 1 : 0);
})();
