/* ==========================================================================
 * 文件：js/phase2/tender.js
 * 作用：政府招标 —— 不定期发布政府采购（例如「学校采购 400 件文具」）：
 *   投标期 3 天，交 5% 保证金报单价（不能高于预算价）；和 2~4 家 AI 公司比价，信用评级高有加分（850 分约便宜 10% 的竞争力）。
 *   中标后在交货期限内从任意仓库交货 → 收货款、退保证金、信用 +5、品牌 +1；逾期没交 → 没收保证金 + 罚合同额 20%、信用 −25。
 * 数据：S.tenders = { list:[...], next }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Td = BT.Tender = {};
  var BUYERS = [['🏫 市第一中学', ['stationery', 'snack', 'drink']], ['🏥 人民医院', ['daily', 'fruit', 'drink']], ['🏛️ 市政府机关', ['tea', 'daily', 'stationery']], ['🚒 消防支队', ['drink', 'snack', 'cloth']], ['🏟️ 体育局（运动会）', ['drink', 'cloth', 'snack']], ['🧓 养老院', ['fruit', 'daily', 'veg']]];
  Td.BOND = 0.05;
  function st(S) { if (!S.tenders) S.tenders = { list: [], next: S.day + 8 }; return S.tenders; }
  Td.list = function (S) { return st(S).list; };
  function cost(S, gid) { return BT.Eco.buyPrice(S, gid, 'market'); }
  Td.bid = function (S, id, unit) {
    var t = st(S).list.filter(function (x) { return x.id === id; })[0]; if (!t || t.status !== 'open') return { ok: false, msg: '投标已截止' };
    unit = U.round2(Number(unit)); if (!(unit > 0)) return { ok: false, msg: '报价无效' };
    if (unit > t.budget) return { ok: false, msg: '报价不能高于预算价 ¥' + t.budget.toFixed(2) };
    var bond = Math.round(unit * t.qty * Td.BOND), oldBond = t.myBond || 0;
    if (S.cash < bond - oldBond) return { ok: false, msg: '保证金不够（需要 ' + U.money(bond) + '）' };
    if (oldBond) S.cash += oldBond; /* 改价：先退旧保证金 */
    S.cash -= bond; t.myBond = bond; t.myPrice = unit;
    return { ok: true, msg: '已投标：单价 ¥' + unit.toFixed(2) + '，冻结保证金 ' + U.money(bond) };
  };
  Td.whHave = function (S, gid) { var n = 0; if (S.biz) U.keys(S.biz.warehouses).forEach(function (rid) { n += S.biz.warehouses[rid].goods[gid] || 0; }); return n; };
  /** 可交货数量 = 各仓库 + 背包（v7.3：背包里的货也能交） */
  Td.have = function (S, gid) { return Td.whHave(S, gid) + (BT.Trade ? BT.Trade.qtyOf(S, gid) : 0); };
  Td.deliver = function (S, id) {
    var t = st(S).list.filter(function (x) { return x.id === id; })[0]; if (!t || t.status !== 'won') return { ok: false, msg: '没有待交货的中标合同' };
    if (Td.have(S, t.gid) < t.qty) return { ok: false, msg: C.goodsMap[t.gid].name + ' 不够（需要 ' + t.qty + '，仓库 ' + Td.whHave(S, t.gid) + ' + 背包 ' + BT.Trade.qtyOf(S, t.gid) + '）' };
    var left = t.qty;
    if (BT.Trade && left > 0) left -= BT.Trade.take(S, t.gid, Math.min(left, BT.Trade.qtyOf(S, t.gid))).taken; /* 先用背包里的（易腐货放背包会坏） */
    U.keys(S.biz.warehouses).forEach(function (rid) { var wh = S.biz.warehouses[rid], q = Math.min(left, wh.goods[t.gid] || 0); if (q > 0) { wh.goods[t.gid] -= q; left -= q; } });
    S.cash += t.myBond; t.myBond = 0; t.status = 'delivered';
    var old = BT.Eco.cat; BT.Eco.cat = 'bonus'; BT.Eco.earn(S, Math.round(t.myPrice * t.qty), '政府采购货款（' + t.buyer + '）'); BT.Eco.cat = old;
    S.biz.creditScore = U.clamp(S.biz.creditScore + 5, 300, 850); S.biz.brand = U.clamp(S.biz.brand + 1, 0, 100);
    return { ok: true, msg: '交货完成！收款 ' + U.money(t.myPrice * t.qty) + '，保证金已退，信用 +5、品牌 +1' };
  };
  Td.dailyTick = function (S) {
    if (!S.biz) return;
    var s = st(S);
    s.list.forEach(function (t) {
      if (t.status === 'open' && S.day >= t.close) {
        var n = rng.int(2, 4), c = cost(S, t.gid), ai = []; for (var i = 0; i < n; i++) ai.push(U.round2(c * rng.range(1.02, 1.28)));
        t.ai = ai; var best = Math.min.apply(null, ai);
        if (!t.myPrice) { t.status = 'closed'; t.winPrice = best; return; }
        var myScore = t.myPrice * (1 - U.clamp((S.biz.creditScore - 650) / 2000, -0.05, 0.1));
        if (myScore <= best) { t.status = 'won'; BT.Log.add('🏆 中标！' + t.buyer + ' 采购 ' + C.goodsMap[t.gid].name + ' ×' + t.qty + '，单价 ¥' + t.myPrice.toFixed(2) + '，请在第 ' + t.deadline + ' 天前交货。', 'good'); BT.Bus.emit('fx', { kind: 'level', text: '🏆 政府招标中标' }); }
        else { t.status = 'lost'; t.winPrice = best; S.cash += t.myBond; t.myBond = 0; BT.Log.add('📋 ' + t.buyer + ' 的招标没中，中标价 ¥' + best.toFixed(2) + '（你报 ¥' + t.myPrice.toFixed(2) + '），保证金已退。', 'info'); }
      } else if (t.status === 'won' && S.day > t.deadline) {
        var fine = Math.round(t.myPrice * t.qty * 0.2); t.status = 'failed';
        BT.Eco.pay(S, fine, '政府采购违约罚款'); S.biz.creditScore = U.clamp(S.biz.creditScore - 25, 300, 850); t.myBond = 0;
        BT.Log.add('⚠️ ' + t.buyer + ' 的合同逾期未交货：没收保证金，罚款 ' + U.money(fine) + '，信用 −25。', 'bad');
      }
    });
    s.list = s.list.filter(function (t) { return t.status === 'open' || t.status === 'won' || S.day - t.close < 10; });
    if (S.day >= s.next && S.biz.shops.length) {
      s.next = S.day + rng.int(8, 14);
      var b = rng.pick(BUYERS), gid = rng.pick(b[1]), qty = rng.int(15, 60) * 10;
      var t = { id: BT.uid('tnd'), buyer: b[0], gid: gid, qty: qty, budget: U.round2(cost(S, gid) * 1.3), open: S.day, close: S.day + 3, status: 'open' };
      t.deadline = t.close + rng.int(5, 9);
      s.list.push(t);
      BT.Log.add('📢 政府招标：' + t.buyer + ' 采购 ' + C.goodsMap[gid].icon + C.goodsMap[gid].name + ' ×' + qty + '，预算单价 ¥' + t.budget.toFixed(2) + '，3 天后截止投标。', 'event');
    }
  };
})();
