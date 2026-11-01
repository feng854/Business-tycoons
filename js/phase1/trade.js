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
  /** 每件商品占用的格数（不同商品不同：蔬菜 1 格，服饰 3 格，古玩 4 格……） */
  Trade.slotsOf = function (goodsId) { var g = C.goodsMap[goodsId]; return g ? g.unit : 1; };
  /** 当前最多还能买几件：同时受背包剩余格数和现金限制 */
  Trade.maxBuy = function (S, goodsId) {
    var price = Eco.buyPrice(S, goodsId, S.region) || 1;
    return Math.max(0, Math.min(Math.floor(Trade.bagFree(S) / Trade.slotsOf(goodsId)), Math.floor(S.cash / price)));
  };
  /** 背包升级：每种只能买一次，需要在批发市场购买，容量累加 */
  Trade.upgradeBag = function (S, id) {
    var up = C.BAG_UPGRADES.filter(function (u) { return u.id === id; })[0]; if (!up) return { ok: false, msg: '没有这个升级' };
    if (S.bagUpgrades[id]) return { ok: false, msg: '已经买过了' };
    if (S.region !== 'market') return { ok: false, msg: '要去批发市场才能买' };
    if (S.cash < up.cost) return { ok: false, msg: '现金不够（需要 ' + U.money(up.cost) + '）' };
    Eco.pay(S, up.cost, '购买' + up.name);
    S.bagUpgrades[id] = S.day; S.bagCap += up.cap;
    return { ok: true, msg: up.name + ' 到手，背包容量 +' + up.cap + ' 格' };
  };

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
    if (g.lux) return { ok: false, msg: '奢侈品不能背包倒卖，要成立公司后走进口贸易' };
    qty = Math.max(1, Math.floor(qty));
    var need = qty * g.unit;
    if (Trade.bagFree(S) < need) return { ok: false, msg: '背包装不下：' + g.name + ' 每件占 ' + g.unit + ' 格，买 ' + qty + ' 件要 ' + need + ' 格，只剩 ' + Trade.bagFree(S) + ' 格（最多买 ' + Math.floor(Trade.bagFree(S) / g.unit) + ' 件）' };
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
  /** unitPrice：可选，指定成交单价（摆摊/店铺按自己的定价卖）；不填则按当地基准零售价 */
  Trade.sell = function (S, goodsId, qty, unitPrice) {
    var g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '商品不存在' };
    qty = Math.max(1, Math.floor(qty));
    var have = Trade.qtyOf(S, goodsId);
    if (have < qty) return { ok: false, msg: '库存不够（只有 ' + have + ' 件）' };
    var price = unitPrice > 0 ? unitPrice : Eco.sellPrice(S, goodsId, S.region);
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
