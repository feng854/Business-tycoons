/* 背包格数一致性 + 调试后门回归测试 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, r) => { let f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200); r.end(d); } }); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port;
  const b = await chromium.launch(); const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.goto(`http://localhost:${port}/`); await pg.waitForTimeout(500);
  const out = await pg.evaluate(() => {
    const res = {}; BT.App.newGame && BT.App.newGame();
    const S = BT.S; S.cash = 5000; const goods = BT.CFG.GOODS; const log = [];
    for (let i = 0; i < 60; i++) {
      const g = goods[i % goods.length];
      if (i % 3 === 2) { try { BT.Trade.sell(S, g.id, 1); } catch (e) {} } else { try { BT.Trade.buy(S, g.id, 1 + (i % 4)); } catch (e) {} }
      const p = BT.Debug.audit(); if (p.length) { log.push(i + ':' + p.join('|')); break; }
    }
    res.seq = log;
    BT.Debug.setStock('xjhg', 12345); res.qty = S.market.posStock.xjhg.qty; res.audit1 = BT.Debug.audit();
    BT.Debug.setStock('xjhg', 0); res.gone = !S.market.posStock.xjhg;
    BT.Debug.setBag('veg', 10); res.audit2 = BT.Debug.audit(); res.cheated = S.cheated;
    return res;
  });
  console.log(JSON.stringify(out));
  const ok = out.seq.length === 0 && out.qty === 12345 && out.audit1.length === 0 && out.gone && out.cheated && !errs.length;
  if (errs.length) console.log(errs);
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
