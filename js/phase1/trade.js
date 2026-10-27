/* ==========================================================================
 * 文件：js/phase1/trade.js
 * 作用：第一阶段 —— 商品买卖、区域差价套利、背包管理
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco;
  var Trade = BT.Trade = {};

  /* ========================================================================
   * 一、背包容量与库存
   * ===================================================================== */
  Trade.bagUsed = function (S) {
    var used = 0;
    U.keys(S.bag).forEach(function (gid) {
      var g = C.goodsMap[gid];
      (S.bag[gid] || []).forEach(function (lot) { used += lot.qty * g.unit; });
    });
    return used;
  };
  Trade.bagFree = function (S) { return S.bagCap - Trade.bagUsed(S); };

  Trade.qtyOf = function (S, goodsId) {
    var lots = S.bag[goodsId] || [];
    var q = 0; lots.forEach(function (l) { q += l.qty; }); return q;
  };
  /** 该商品库存的加权平均成本（用于估值/结算） */
  Trade.avgCost = function (S, goodsId) {
    var lots = S.bag[goodsId] || [];
    var q = 0, v = 0; lots.forEach(function (l) { q += l.qty; v += l.qty * l.cost; });
    return q > 0 ? v / q : 0;
  };

  /* ========================================================================
   * 二、购买（在当前区域按当前进货价买入，记录批次成本便于过期/核算）
   * ===================================================================== */
  Trade.buy = function (S, goodsId, qty) {
    var g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '商品不存在' };
    qty = Math.max(1, Math.floor(qty));
    var need = qty * g.unit;
    if (Trade.bagFree(S) < need) return { ok: false, msg: '背包装不下了（还差 ' + (need - Trade.bagFree(S)) + ' 格）' };
    var price = Eco.buyPrice(S, goodsId, S.region);
    var total = U.round2(price * qty);
    if (S.cash < total) return { ok: false, msg: '现金不够（需要 ' + U.money(total) + '）' };
    Eco.pay(S, total, '进货 ' + g.icon + g.name + ' x' + qty);
    S.bag[goodsId] = S.bag[goodsId] || [];
    S.bag[goodsId].push({ qty: qty, cost: price, boughtDay: S.day });
    if (BT.Quests && BT.Quests.notify) BT.Quests.notify(S, 'buy', { goodsId: goodsId, qty: qty });
    return { ok: true, msg: '买入 ' + g.name + ' x' + qty + '，花费 ' + U.money(total) };
  };

  /* ========================================================================
   * 三、出售（卖给当前区域的“路人市场”，走 FIFO 批次核算成本和毛利）
   * ===================================================================== */
  Trade.sell = function (S, goodsId, qty) {
    var g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '商品不存在' };
    qty = Math.max(1, Math.floor(qty));
    var have = Trade.qtyOf(S, goodsId);
    if (have < qty) return { ok: false, msg: '库存不够（只有 ' + have + ' 件）' };
    var price = Eco.sellPrice(S, goodsId, S.region);
    var total = U.round2(price * qty);
    var remain = qty, costTotal = 0;
    var lots = S.bag[goodsId];
    for (var i = 0; i < lots.length && remain > 0; i++) {
      var take = Math.min(lots[i].qty, remain);
      costTotal += take * lots[i].cost;
      lots[i].qty -= take; remain -= take;
    }
    S.bag[goodsId] = lots.filter(function (l) { return l.qty > 0; });
    Eco.earn(S, total, '出售 ' + g.icon + g.name + ' x' + qty);
    var profit = total - costTotal;
    return { ok: true, msg: '卖出 ' + g.name + ' x' + qty + '，获得 ' + U.money(total) + '（毛利 ' + U.money(profit) + '）', profit: profit };
  };

  /* ========================================================================
   * 四、区域差价一览（辅助玩家判断倒货路线）
   * ===================================================================== */
  Trade.priceTable = function (S, goodsId) {
    return C.REGIONS.map(function (r) {
      return { region: r.id, name: r.name, buy: Eco.buyPrice(S, goodsId, r.id), sell: Eco.sellPrice(S, goodsId, r.id) };
    });
  };
})();
