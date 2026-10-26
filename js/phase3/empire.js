/* ==========================================================================
 * 文件：js/phase3/empire.js
 * 作用：第三阶段 —— 资本帝国的轻量实现：企业并购（M&A）与连锁品牌加成；
 *       跨城市经营 / 房地产投资 / 大宗制造物流 作为「敬请期待」占位，
 *       但数据结构（见下方 C.CITIES）已预留，方便后续直接扩展不用重构。
 * 解锁条件（闸门二，可在 config 调整）：拥有 ≥3 间店铺 且净资产 ≥ ¥20,000
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco, rng = BT.rng;
  var Empire = BT.Empire = {};

  /* 预留：未来「跨城市经营」直接往这个数组里加新城市 + 新区域即可，
     不需要改动 Biz / Market 的任何数据结构（它们都是按 regionId 寻址的）。 */
  C.CITIES = [
    { id: 'newport', name: '新港市', regions: C.REGIONS, status: 'active' },
    { id: 'rivercity', name: '江城', regions: [], status: 'locked' },
    { id: 'skyharbor', name: '云港', regions: [], status: 'locked' }
  ];

  Empire.GATE = { minShops: 3, minNet: 20000 };

  Empire.unlocked = function (S) {
    var biz = S.biz;
    if (!biz) return false;
    return biz.shops.length >= Empire.GATE.minShops && BT.netWorth(S) >= Empire.GATE.minNet;
  };

  /* ========================================================================
   * 一、并购要约（随机事件：可以出价收购某区域的竞争对手份额）
   * ===================================================================== */
  Empire.rollOffer = function (S) {
    if (!Empire.unlocked(S)) return;
    if (S.empireOffer) return;
    if (!rng.chance(0.12)) return;
    var biz = S.biz;
    var regionIds = U.keys(biz.competitors).filter(function (r) { return biz.competitors[r].strength > 0.3; });
    if (!regionIds.length) return;
    var rid = rng.pick(regionIds);
    var comp = biz.competitors[rid];
    var price = Math.round(comp.strength * 8000 + rng.int(500, 3000));
    S.empireOffer = { regionId: rid, price: price, strengthGain: comp.strength * 0.6 };
    BT.Log.add('🤝 并购机会：' + C.regionMap[rid].name + ' 的竞争对手愿意以 ' + U.money(price) + ' 出让部分市场份额。', 'event');
  };

  Empire.acceptOffer = function (S) {
    var offer = S.empireOffer; if (!offer) return { ok: false, msg: '没有待处理的并购要约' };
    if (S.cash < offer.price) return { ok: false, msg: '资金不够' };
    Eco.pay(S, offer.price, '并购' + C.regionMap[offer.regionId].name + '竞争对手');
    var comp = S.biz.competitors[offer.regionId];
    comp.strength = Math.max(0.1, comp.strength - offer.strengthGain);
    S.biz.brand = U.clamp(S.biz.brand + 4, 0, 100);
    BT.Log.add('🏢 并购完成！' + C.regionMap[offer.regionId].name + ' 的市场份额已纳入麾下。', 'good');
    S.empireOffer = null;
    return { ok: true, msg: '并购成功' };
  };
  Empire.declineOffer = function (S) { S.empireOffer = null; return { ok: true, msg: '已拒绝' }; };

  Empire.dailyTick = function (S) { Empire.rollOffer(S); };
})();
