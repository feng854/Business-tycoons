/* tests/pricing.spec.js —— v7.1：🔒 锁价 / 售价预览 / 门店销售统计 / 代理权前置检查（iPad 横屏） */
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 8961;
let fails = 0;
function check(name, ok, extra) { console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; }
(async () => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    fs.readFile(path.join(ROOT, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
  }).listen(PORT);
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' }), page = await ctx.newPage();
  const errors = []; let dialogs = 0;
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { dialogs++; d.accept(); });
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|TUNNEL|CONNECTION|status of 40/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`); await page.click('#btn-newgame'); await page.waitForSelector('#game.active');
  await page.evaluate(() => BT.FX.tutSkip());
  await page.evaluate(() => {
    const S = BT.S, B = BT.Biz, C = BT.CFG;
    S.cash = 300000; S.milestones = { m1: true, m2: true, m3: true }; S.unlockedRegions = C.REGIONS.map(x => x.id); S.phase = 2; B.ensure(S); BT.Market.ensure(S);
    B.openShop(S, 'cbd'); const sh = S.biz.shops[0]; B.hire(S, sh.id, 'clerk'); B.hire(S, sh.id, 'clerk');
    ['snack', 'drink', 'daily'].forEach(g => B.setShelf(S, sh.id, g, 1.3)); B.autoRestock(S);
    BT.Manager.hire ? BT.Manager.hire(S) : (S.biz.mgr = Object.assign(BT.Manager.get(S), { on: true }));
    S.biz.mgr.on = true; S.biz.mgr.autoPrice = true;
    BT.App.switchTab('biz'); BT.App.bizTab('shops'); BT.Render.all();
  });
  const sid = await page.evaluate(() => BT.S.biz.shops[0].id);
  /* 改价 snack → 1.95 自动锁定 */
  await page.fill(`#markup-${sid}-snack`, '1.95');
  const preview = await page.$eval(`#markup-${sid}-snack`, el => el.nextSibling.textContent);
  check('输入系数后实时显示售价和毛利', /→¥\d/.test(preview) && /毛利/.test(preview), preview);
  await page.evaluate(([s]) => BT.App.bizSetShelf(s, 'snack'), [sid]);
  const r1 = await page.evaluate(() => { const sh = BT.S.biz.shops[0]; return { mk: sh.shelf.snack, lock: BT.Biz.isLocked(sh, 'snack'), drinkLock: BT.Biz.isLocked(sh, 'drink') }; });
  check('改价后自动 🔒', r1.lock && r1.mk === 1.95 && !r1.drinkLock, JSON.stringify(r1));
  for (let i = 0; i < 4; i++) await page.evaluate(() => { BT.Biz.autoRestock(BT.S); BT.Eco.sleep(BT.S); BT.Render.all(); });
  const r2 = await page.evaluate(() => { const sh = BT.S.biz.shops[0]; return { snack: sh.shelf.snack, drink: sh.shelf.drink, sugg: BT.Manager.suggestMarkup(BT.S, sh.regionId, 'drink') }; });
  check('过 4 天：锁定的不被区域经理改，未锁定的被改', r2.snack === 1.95 && Math.abs(r2.drink - r2.sugg) < 0.03, JSON.stringify(r2));
  await page.evaluate(([s]) => BT.App.bizToggleLock(s, 'snack'), [sid]);
  await page.evaluate(() => { BT.Eco.sleep(BT.S); BT.Render.all(); });
  const r3 = await page.evaluate(() => BT.S.biz.shops[0].shelf.snack);
  check('🔓 解锁后经理接管', r3 !== 1.95, String(r3));
  /* 销售统计 */
  await page.evaluate(([s]) => BT.App.toggleShopStats(s), [sid]);
  const st = await page.evaluate(() => { const t = document.querySelector('.stats-table'); const S = BT.S, sh = S.biz.shops[0], g = BT.Biz.goodsStats(S, sh);
    const sumN = Object.values(g.goods).reduce((a, o) => a + o.n7, 0), sumRev = Object.values(g.goods).reduce((a, o) => a + o.rev7, 0);
    const ledRev = S.biz.ledger.slice(-g.days).reduce((a, x) => a + x.revenue, 0);
    return { table: !!t, rows: t ? t.querySelectorAll('tr').length : 0, days: g.days, sumN, sumRev: Math.round(sumRev), ledRev: Math.round(ledRev), nan: t ? /NaN|undefined/.test(t.textContent) : true };
  });
  check('门店销售统计表展开、数据与账本营收一致', st.table && st.rows >= 4 && !st.nan && st.sumN > 0 && Math.abs(st.sumRev - st.ledRev) <= Math.max(5, st.ledRev * 0.01), JSON.stringify(st));
  await page.evaluate(() => BT.Render.all());
  check('后台刷新后统计表保持展开', await page.evaluate(() => !!document.querySelector('.stats-table')));
  if (process.env.SHOT) { await page.evaluate(() => { const el = document.querySelector('.shop-stats'); el.scrollIntoView(); }); await page.evaluate(() => document.querySelector('.shelf-grid').scrollIntoView()); await page.screenshot({ path: process.env.SHOT.replace('.png', '-shelf.png') }); await page.evaluate(() => document.querySelector('.shop-stats').scrollIntoView()); await page.screenshot({ path: process.env.SHOT.replace('.png', '-shop.png') }); }
  /* 代理权：品牌不足 → 按钮置灰写原因，点了不弹付款确认 */
  await page.evaluate(() => { BT.S.biz.brand = 12; BT.App.bizTab('supply'); BT.Render.all(); });
  const lic = await page.evaluate(() => { const b = [...document.querySelectorAll('.lux-table button')].filter(x => /代理权/.test(x.textContent)); return { n: b.length, disabled: b.every(x => x.disabled), why: (document.querySelector('.lic-why') || {}).textContent, prereq: (document.querySelector('.prereq-row') || {}).textContent }; });
  check('品牌不足：代理权按钮置灰并显示原因、前置条件清单', lic.n > 0 && lic.disabled && /品牌≥15/.test(lic.why) && /品牌声望/.test(lic.prereq), JSON.stringify(lic));
  const d0 = dialogs; await page.evaluate(() => BT.App.buyLicense('watch'));
  const toast = await page.evaluate(() => [...document.querySelectorAll('.toast.bad')].map(t => t.textContent).pop());
  check('直接调用也不弹付款确认，给出明确提示', dialogs === d0 && /品牌声望太低/.test(toast || ''), toast);
  if (process.env.SHOT) { await page.evaluate(() => document.querySelector('.prereq-row').scrollIntoView()); await page.screenshot({ path: process.env.SHOT }); }
  await page.evaluate(() => { BT.S.biz.brand = 30; BT.Render.all(); });
  const ok = await page.evaluate(() => { const b = [...document.querySelectorAll('.lux-table button')].filter(x => /代理权/.test(x.textContent))[0]; b.click(); return !!BT.Lux.license(BT.S, 'watch') || Object.keys(BT.Lux.ensure(BT.S).licenses).length; });
  check('品牌够了：点击 → 确认 → 拿到代理权', ok && dialogs === d0 + 1);
  check('iPad 横屏无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('没有 JS 报错', errors.length === 0, errors.join(' | '));
  console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 pricing 测试全部通过');
  await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
