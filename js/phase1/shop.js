/* ==========================================================================
 * 文件：js/phase1/shop.js
 * 作用：第一阶段 —— 店铺经营（租店、货架定价、员工、每日自动结算）
 * 解锁：净资产达到里程碑2（¥3,000 且生意持续盈利）
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco, rng = BT.rng;
  var Shop = BT.Shop = {};

  var DEPOSIT_MUL = 20;   /* 押金 = 日租金 × 20 */
  var TIERS = ['木板摊位', '铁皮小棚', '标准店面', '精装门店']; /* 外观随声望升级，纯展示 */

  Shop.canOpen = function (S) {
    if (S.shop) return { ok: false, msg: '已经有店铺了' };
    if (!S.milestones.m1) return { ok: false, msg: '需要先达成里程碑「第一次积累」' };
    return { ok: true };
  };

  Shop.rent = function (S, regionId) {
    var chk = Shop.canOpen(S); if (!chk.ok) return chk;
    var region = C.regionMap[regionId]; if (!region) return { ok: false, msg: '区域不存在' };
    if (S.unlockedRegions.indexOf(regionId) < 0) return { ok: false, msg: '该区域尚未解锁' };
    var dailyRent = region.rent * 3;
    var deposit = dailyRent * DEPOSIT_MUL;
    if (S.cash < deposit) return { ok: false, msg: '押金不够（需要 ' + U.money(deposit) + '）' };
    Eco.pay(S, deposit, '店铺押金（' + region.name + '）');
    S.shop = {
      regionId: regionId, rent: dailyRent, shelf: {}, /* goodsId -> markup */
      reputation: 30, value: deposit, employee: null, daysOpen: 0, openHours: 10
    };
    BT.Log.add('🏬 在' + region.name + '租下店面，开始营业！', 'good');
    return { ok: true, msg: '店铺开业成功' };
  };

  Shop.close = function (S) {
    if (!S.shop) return { ok: false, msg: '还没有店铺' };
    S.shop = null;
    return { ok: true, msg: '店铺已关闭' };
  };

  /* ========================================================================
   * 二、货架管理：上架商品并设定加价倍率
   * ===================================================================== */
  Shop.stock = function (S, goodsId, markup) {
    if (!S.shop) return { ok: false, msg: '还没有店铺' };
    var g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '商品不存在' };
    S.shop.shelf[goodsId] = U.clamp(markup || 1.3, 0.8, 2.5);
    return { ok: true, msg: g.name + ' 已上架，加价倍率 ' + S.shop.shelf[goodsId].toFixed(2) };
  };
  Shop.unstock = function (S, goodsId) {
    if (!S.shop) return { ok: false, msg: '还没有店铺' };
    delete S.shop.shelf[goodsId];
    return { ok: true, msg: '已下架' };
  };

  /* ========================================================================
   * 三、雇佣第一名员工（固定日薪，上班时自动帮忙经营，减少所需玩家亲自在场）
   * ===================================================================== */
  Shop.hire = function (S) {
    if (!S.shop) return { ok: false, msg: '还没有店铺' };
    if (S.shop.employee) return { ok: false, msg: '已经有员工了' };
    if (!S.milestones.m2) return { ok: false, msg: '需要先达成里程碑「初步创业」' };
    S.shop.employee = { wage: 60, skill: 1 };
    BT.Log.add('🧑‍💼 雇佣了第一名员工，每天工资 ' + U.money(60) + '。', 'good');
    return { ok: true, msg: '雇佣成功' };
  };
  Shop.fire = function (S) {
    if (!S.shop || !S.shop.employee) return { ok: false, msg: '没有员工' };
    S.shop.employee = null;
    return { ok: true, msg: '已解雇员工' };
  };

  /* ========================================================================
   * 四、每日自动结算（在 economy.sleep() 中调用）
   *    无论玩家当天是否亲自经营，店铺都会按区域人流 × 声望 × 货架情况产生销售。
   * ===================================================================== */
  Shop.dailyTick = function (S) {
    var shop = S.shop; if (!shop) return;
    var region = C.regionMap[shop.regionId];
    var w = Eco.weatherInfo(S);
    var items = U.keys(shop.shelf);
    var totalRevenue = 0, totalCost = 0, totalSold = 0;

    items.forEach(function (gid) {
      var g = C.goodsMap[gid];
      var have = BT.Trade.qtyOf(S, gid);
      if (have <= 0) return;
      var markup = shop.shelf[gid];
      var price = U.round2(Eco.buyPrice(S, gid, shop.regionId) * markup);
      var appeal = U.clamp(1.6 - (markup - 1), 0.25, 1.6);
      var repMul = 0.5 + shop.reputation / 100;
      var empMul = shop.employee ? (1 + shop.employee.skill * 0.08) : 0.7; /* 没员工时顾客覆盖率打折 */
      var hk = BT.Hawkers ? BT.Hawkers.factor(S, shop.regionId, gid, price, 0.5).mul : 1; /* 店面比摊贩稳，受影响减半 */
      var expected = region.traffic * 70 * w.traffic * appeal * repMul * empMul * hk;
      var sold = Math.min(have, rng.poisson(expected));
      if (sold <= 0) return;
      var r = BT.Trade.sell(S, gid, sold, price);
      if (BT.Hawkers) BT.Hawkers.note(S, shop.regionId, gid, sold * price * 0.5);
      totalSold += sold; totalRevenue += sold * price; totalCost += sold * price - (r.profit || 0);
    });

    var wage = shop.employee ? shop.employee.wage : 0;
    if (wage > 0) Eco.pay(S, wage, '员工工资');
    Eco.pay(S, shop.rent, '店铺租金');

    var profit = totalRevenue - shop.rent - wage;
    shop.reputation = U.clamp(shop.reputation + (totalSold > 0 ? 1 : -1), 0, 100);
    shop.daysOpen += 1;
    shop.value = Math.max(shop.value, shop.value * 0.995 + profit * 0.3);

    BT.Log.add('🏬 店铺结算：卖出 ' + totalSold + ' 件，营收 ' + U.money(totalRevenue) +
      '，净利 ' + U.money(profit) + '，声望 ' + shop.reputation + '。', profit >= 0 ? 'good' : 'bad');
    if (BT.Quests && BT.Quests.notify) BT.Quests.notify(S, 'shopProfit', { profit: profit });
  };

  Shop.tierName = function (shop) {
    var idx = shop.reputation >= 80 ? 3 : (shop.reputation >= 55 ? 2 : (shop.reputation >= 30 ? 1 : 0));
    return TIERS[idx];
  };
})();
