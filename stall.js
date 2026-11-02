/* ==========================================================================
 * 文件：js/phase1/stall.js
 * 作用：第一阶段 —— 摆摊创业系统（选址、进货定价、客流结算、城管风险）
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco, rng = BT.rng;
  var Stall = BT.Stall = {};

  var FEE = { slum: 6, market: 10, oldst: 8, cbd: 22, port: 14, college: 10 };
  Stall.FEE = FEE;

  /* ========================================================================
   * 一、开摊 / 收摊
   * ===================================================================== */
  Stall.open = function (S, goodsId, priceMarkup) {
    if (S.stall) return { ok: false, msg: '已经有一个摊位了，请先收摊' };
    var have = BT.Trade.qtyOf(S, goodsId);
    if (have < 1) return { ok: false, msg: '背包里没有这件商品，先去进货' };
    S.stall = { regionId: S.region, goodsId: goodsId, markup: priceMarkup || 1.0, invested: 0, level: 1, daysOpen: 0 };
    return { ok: true, msg: '摊位已摆好，开始营业！' };
  };
  Stall.close = function (S) { S.stall = null; return { ok: true, msg: '已收摊。' }; };

  /* ========================================================================
   * 二、营业（消耗2小时，当场结算一轮客流成交）
   *    成交量 = 区域人流 × 时段系数 × 天气系数 × 价格吸引力 × 摊位等级
   * ===================================================================== */
  Stall.run = function (S) {
    var st = S.stall; if (!st) return { ok: false, msg: '还没有摊位' };
    if (st.regionId !== S.region) return { ok: false, msg: '摊位在' + C.regionMap[st.regionId].name + '，请先过去' };
    if (S.stamina < 10) return { ok: false, msg: '体力不足，撑不住摆摊了' };
    var hours = 2;
    if (S.hour + hours > C.DAY_END_H + 2) return { ok: false, msg: '太晚了，收摊回家吧' };

    var g = C.goodsMap[st.goodsId];
    var region = C.regionMap[S.region];
    var w = Eco.weatherInfo(S);
    var fee = FEE[S.region] || 8;

    var basePrice = Eco.sellPrice(S, st.goodsId, S.region);
    var price = U.round2(basePrice * st.markup);
    var appeal = U.clamp(2.1 - price / basePrice, 0.2, 1.8); /* 定价越高于基准，吸引力越低 */
    var trafficMul = ((S.events && S.events.trafficMul && S.events.trafficMul[S.region]) || 1) * (Eco.trafficMul ? Eco.trafficMul(S, S.region) : 1);
    var cookLv = (S.skills && S.skills.cook) || 0;
    var levelMul = 1 + (st.level - 1) * 0.25 + cookLv * 0.04;

    /* 散户竞争：附近卖同款的摊贩越多、你比他们贵得越多，客人被分走越多 */
    var hk = BT.Hawkers ? BT.Hawkers.factor(S, S.region, st.goodsId, price) : { mul: 1 };
    var expected = region.traffic * 55 * w.traffic * trafficMul * appeal * levelMul * hk.mul;
    var sold = Math.min(BT.Trade.qtyOf(S, st.goodsId), rng.poisson(expected));
    var revenue = U.round2(sold * price);
    var fined = BT.Events.checkInspection(S);
    if (fined && BT.Hawkers) BT.Hawkers.clear(S, S.region, 2); /* 城管来了，别的摊贩也被清走几家 */
    if (sold > 0 && BT.Hawkers) BT.Hawkers.note(S, S.region, st.goodsId, revenue);

    if (sold > 0) BT.Trade.sell(S, st.goodsId, sold, price); /* 复用 trade 的成本核算，按摊位自己的定价成交 */
    Eco.pay(S, fee, '摊位费');
    st.invested += fee;
    st.daysOpen += 1;

    Eco.spend(S, { stamina: 16, energy: 8, hours: hours });
    var msg = '本轮摆摊卖出 ' + sold + ' 件 ' + g.name + '，营收 ' + U.money(revenue) + '，摊位费 ' + U.money(fee) + '。';
    if (fined) msg += '（被城管罚款了）';
    if (hk.mul < 0.85) msg += '附近 ' + Math.round(hk.n) + ' 家摊贩在卖同款（¥' + hk.price.toFixed(2) + '），分走了约 ' + Math.round((1 - hk.mul) * 100) + '% 的客人。';
    if (sold === 0) msg = '这一轮没卖出去，考虑降价或换个时段' + (hk.mul < 0.85 ? '（同款摊贩 ' + Math.round(hk.n) + ' 家，卖 ¥' + hk.price.toFixed(2) + '）' : '') + '。';
    BT.Log.add('🏪 ' + msg, sold > 0 ? 'good' : 'info');
    if (BT.Quests && BT.Quests.notify) BT.Quests.notify(S, 'stallSell', { sold: sold });
    return { ok: true, msg: msg, sold: sold, revenue: revenue, hawk: hk.mul };
  };

  /** 升级摊位（提升等级上限由净资产里程碑决定，这里仅做数值升级） */
  Stall.upgrade = function (S) {
    var st = S.stall; if (!st) return { ok: false, msg: '还没有摊位' };
    if (st.level >= 3) return { ok: false, msg: '摊位已达到当前阶段上限' };
    var cost = 200 * st.level;
    if (S.cash < cost) return { ok: false, msg: '资金不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '升级摊位');
    st.level += 1;
    BT.Log.add('⬆️ 摊位升级到 Lv.' + st.level + '！', 'good');
    return { ok: true, msg: '摊位升级成功' };
  };
})();
