/* 随机行为压力测试：多个种子、每局 ~250 天，随机做各种操作，每步检查异常/NaN/数据一致性 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0]; fs.readFile(path.join(root, u === '/' ? 'index.html' : u), (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200); r.end(d); } }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(); const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.goto(`http://localhost:${srv.address().port}/`); await pg.waitForTimeout(400);
  const seeds = (process.env.SEEDS || '1,2,3,4').split(',').map(Number), days = Number(process.env.DAYS || 250);
  let bad = 0;
  for (const seed of seeds) {
    const res = await pg.evaluate(({ seed, days }) => {
      let x = seed * 2654435761 % 4294967296; const R = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
      const pick = a => a[Math.floor(R() * a.length)], ri = (a, b) => a + Math.floor(R() * (b - a + 1));
      BT.App.newGame(pick(['easy', 'normal', 'hard']), seed); const issues = []; let lastAct = '';
      const finite = (o, p, d) => { if (d > 6 || o == null) return; if (typeof o === 'number') { if (!isFinite(o)) issues.push('非有限数 ' + p); return; } if (typeof o === 'object') for (const k in o) finite(o[k], p + '.' + k, d + 1); };
      const check = () => {
        try { const a = BT.Debug.audit(); if (a.length) issues.push(lastAct + ' => ' + a.slice(0, 3).join('|')); finite({ cash: BT.S.cash, debt: BT.S.debt, mkt: BT.S.market && { p: BT.S.market.posStock, f: BT.S.market.posFut, x: BT.S.market.posFx, s: BT.S.market.stocks }, biz: BT.S.biz }, 'S', 0); } catch (e) { issues.push('审计异常 ' + e.message); }
      };
      const G = BT.CFG.GOODS.map(g => g.id), M = BT.Market, regs = BT.CFG.REGIONS.map(r => r.id);
      const acts = {
        buy: () => { const S = BT.S; BT.Trade.buy(S, pick(G), ri(1, 10)); },
        sell: () => { const S = BT.S, g = pick(G); BT.Trade.sell(S, g, ri(1, 10)); },
        job: () => { const S = BT.S, j = BT.Jobs.available(S); if (j.length) BT.Jobs.do(S, pick(j).id); },
        travel: () => { const S = BT.S; BT.App.travelTo(pick(S.unlockedRegions)); },
        stall: () => { const S = BT.S; if (S.stall) { if (R() < 0.5) BT.Stall.run(S); else BT.Stall.close(S); } else BT.Stall.open(S, pick(G), 1.2); if (S.stall && R() < .5) BT.Stall.run(S); },
        shop: () => { const S = BT.S; if (!S.shop) BT.Shop.rent(S, pick(S.unlockedRegions)); else { BT.Shop.stock(S, pick(G), 1.3); if (R() < .1) BT.Shop.close(S); } },
        bag: () => { const S = BT.S; BT.Trade.upgradeBag(S, pick(BT.CFG.BAG_UPGRADES).id); },
        bizOpen: () => { const S = BT.S; if (S.biz) BT.Biz.openShop(S, pick(S.unlockedRegions)); },
        bizHire: () => { const S = BT.S; if (S.biz && S.biz.shops.length) BT.Biz.hire(S, pick(S.biz.shops).id, pick(['clerk', 'buyer', 'manager'])); },
        bizStock: () => { const S = BT.S; if (S.biz && S.biz.shops.length) { const sh = pick(S.biz.shops); BT.Biz.setShelf(S, sh.id, pick(G), 1.3); BT.Biz.autoRestock(S); } },
        loan: () => { const S = BT.S; if (S.biz) { if (R() < .6) BT.Biz.takeLoan(S, ri(500, 20000)); else if (S.biz.loans.length) BT.Biz.repayLoan(S, S.biz.loans[0].id, ri(100, 9000)); } },
        stockBuy: () => { const S = BT.S; M.ensure(S); const id = pick(M.STOCKS).id; const lim = R() < .5 ? 0 : S.market.stocks[id].price * (0.9 + R() * .2); M.placeStockOrder(S, id, 'buy', ri(1, 5000), lim); },
        stockSell: () => { const S = BT.S; M.ensure(S); const id = pick(M.STOCKS).id; const lim = R() < .5 ? 0 : S.market.stocks[id].price * (0.9 + R() * .2); M.placeStockOrder(S, id, 'sell', ri(1, 5000), lim); },
        cancel: () => { const S = BT.S; if (S.market && S.market.orders.length) M.cancelOrder(S, pick(S.market.orders).oid); },
        futOpen: () => { const S = BT.S; M.ensure(S); M.openFutures(S, pick(M.FUTURES).id, ri(1, 30), pick(['long', 'short'])); },
        futClose: () => { const S = BT.S; M.ensure(S); const k = Object.keys(S.market.posFut); if (k.length) M.closeFutures(S, pick(k), ri(1, 40)); },
        fxOpen: () => { const S = BT.S; M.ensure(S); M.openForex(S, pick(M.FOREX).id, ri(1, 30), pick(['long', 'short'])); },
        fxClose: () => { const S = BT.S; M.ensure(S); const k = Object.keys(S.market.posFx); if (k.length) M.closeForex(S, pick(k), ri(1, 40)); },
        estate: () => { const S = BT.S; if (S.biz) { if (R() < .6) BT.Empire.buy(S, pick(regs)); else BT.Empire.sell(S, pick(regs)); BT.Empire.donate(S, ri(100, 3000)); } },
        offer: () => { const S = BT.S; if (S.empireOffer) BT.Empire.acceptOffer(S); },
        event: () => { if (BT.Events.pending) BT.Events.declinePending(BT.S); },
        hour: () => BT.Eco.advanceHour(BT.S, ri(1, 3)),
        sleep: () => BT.Eco.sleep(BT.S),
        learn: () => { const S = BT.S; BT.Jobs.learn(S, pick(BT.CFG.SKILLS ? BT.CFG.SKILLS.map(s => s.id) : ['carry'])); }
      };
      const names = Object.keys(acts);
      for (let d = 0; d < days && !BT.S.gameOver; d++) {
        const S = BT.S;
        if (S.endingQueue.length) S.endingQueue.length = 0;
        if (d % 9 === 0 && S.cash < 3000) S.cash += ri(2000, 40000); /* 偶尔注资，让局面进入后期阶段 */
        if (d === 60 || d === 120) S.cash += 60000;
        const n = ri(5, 14);
        for (let i = 0; i < n; i++) {
          const nm = pick(names); lastAct = 'd' + S.day + ' ' + nm;
          try { acts[nm](); } catch (e) { issues.push(lastAct + ' 抛异常：' + e.message); }
          check();
        }
        if (BT.Events.pending) BT.Events.declinePending(S);
        lastAct = 'd' + S.day + ' sleep'; try { BT.Eco.sleep(S); } catch (e) { issues.push(lastAct + ' 抛异常：' + e.message); } check();
        if (issues.length > 8) break;
      }
      return { seed, day: BT.S.day, net: BT.netWorth(BT.S), over: BT.S.gameOver && BT.S.gameOver.type, issues: issues.slice(0, 8) };
    }, { seed, days });
    console.log(JSON.stringify(res));
    if (res.issues.length) bad++;
  }
  if (errs.length) { console.log('pageerror:', errs.slice(0, 3)); bad++; }
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
