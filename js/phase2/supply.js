/* ==========================================================================
 * 文件：js/phase2/supply.js
 * 作用：供应链 —— 供应商涨价 / 断供（提前预警），以及长期供货合同（锁价 + 断供优先供货）
 * 说明：涨价、断供系数接入 Eco.buyPrice，所以第一阶段倒卖也会感受到；
 *       断供只阻断第二阶段的「批发进货」，可以找应急供应商（加价、限量）或靠长约保供。
 *       S.supply = { goods: { gid: { mul, days, out } }, warn: [{gid, type, inDays, mul, days}], contracts: { gid: {lock, until} } }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Sup = BT.Supply = {};

  Sup.ensure = function (S) {
    if (!S.supply) S.supply = { goods: {}, warn: [], contracts: {} };
    S.supply.goods = S.supply.goods || {}; S.supply.warn = S.supply.warn || []; S.supply.contracts = S.supply.contracts || {};
    return S.supply;
  };
  function st(S, gid) { var sp = Sup.ensure(S); return sp.goods[gid] || null; }

  /** 进货价系数：涨价期间 ×mul；断供期间零售批发市场货少，价格 ×1.5 */
  Sup.mul = function (S, gid) {
    if (!S || !S.supply) return 1;
    var g = S.supply.goods[gid]; if (!g) return 1;
    return (g.mul || 1) * (g.out ? 1.5 : 1);
  };
  Sup.isOut = function (S, gid) { var g = S && S.supply && S.supply.goods[gid]; return !!(g && g.out); };
  Sup.contract = function (S, gid) {
    var c = S && S.supply && S.supply.contracts[gid];
    return c && c.until >= S.day ? c : null;
  };
  /** 签约价相对当前市价的比例（批发时乘上它）：涨价时 <1 划算，降价时 >1 吃亏 */
  Sup.contractRatio = function (S, gid) {
    var c = Sup.contract(S, gid); if (!c) return 1;
    BT.Eco.ensurePriceDay(S);
    var now = (S.prices[gid] ? S.prices[gid].v : C.goodsMap[gid].base) * Sup.mul(S, gid);
    return now > 0 ? c.lock / now : 1;
  };
  Sup.contractFee = function (gid) { return Math.round(200 + C.goodsMap[gid].base * 30); };

  /** 签订长期供货合同：锁定当前价 ×95%，为期 30 天，断供时优先供货 */
  Sup.sign = function (S, gid) {
    var g = C.goodsMap[gid]; if (!g) return { ok: false, msg: '商品不存在' };
    if (!S.biz) return { ok: false, msg: '成立公司后才能和供应商签长约' };
    if (Sup.contract(S, gid)) return { ok: false, msg: g.name + ' 已经有生效中的长约' };
    var fee = Sup.contractFee(gid);
    if (S.cash < fee) return { ok: false, msg: '签约保证金不够（需要 ' + U.money(fee) + '）' };
    BT.Eco.ensurePriceDay(S);
    var cur = (S.prices[gid] ? S.prices[gid].v : g.base) * Sup.mul(S, gid);
    BT.Eco.pay(S, fee, '签订 ' + g.name + ' 长期供货合同');
    Sup.ensure(S).contracts[gid] = { lock: U.round2(cur * C.SUPPLY.contractDiscount), until: S.day + C.SUPPLY.contractDays, signed: S.day };
    return { ok: true, msg: g.icon + g.name + ' 长约生效：' + C.SUPPLY.contractDays + ' 天内批发按锁定价供货，断供也优先给你' };
  };

  /* ========================================================================
   * 每日：预警倒计时 → 生效；生效中的倒计时 → 恢复；随机产生新预警
   * ===================================================================== */
  var RISE_TEXT = [
    '{s}通知：{g}原料成本上涨，{d}天后出厂价上调',
    '行业消息：{g}主产区减产，预计{d}天后批发价走高',
    '{s}来电：运费上涨，{g}{d}天后起提价'
  ];
  var OUT_TEXT = [
    '{s}通知：{g}生产线检修，{d}天后将暂停供货',
    '物流消息：通往{s}的高速封路，{g}{d}天后可能断货',
    '{s}工厂发生火灾，{g}预计{d}天后断供'
  ];
  var SUPPLIERS = ['南岭食品厂', '东海物流', '华鑫轻工', '旺达纺织', '港南贸易行', '义城小商品城'];
  function fill(t, gid, d) {
    var g = C.goodsMap[gid];
    return t.replace('{s}', rng.pick(SUPPLIERS)).replace('{g}', g.icon + g.name).replace('{d}', d);
  }

  Sup.dailyTick = function (S) {
    var sp = Sup.ensure(S);
    /* 1) 生效中的状态倒计时 */
    U.keys(sp.goods).forEach(function (gid) {
      var g = sp.goods[gid]; g.days -= 1;
      if (g.days <= 0) {
        delete sp.goods[gid];
        BT.Log.add('🚚 供应恢复：' + C.goodsMap[gid].icon + C.goodsMap[gid].name + ' 价格与供货回到正常。', 'good');
      }
    });
    /* 2) 预警到期 → 生效 */
    sp.warn = sp.warn.filter(function (w) {
      w.inDays -= 1;
      if (w.inDays > 0) return true;
      var g = C.goodsMap[w.gid];
      if (w.type === 'rise') {
        sp.goods[w.gid] = { mul: w.mul, days: w.days, out: false };
        BT.Log.add('📈 供应链：' + g.icon + g.name + ' 进货价上调 ' + Math.round((w.mul - 1) * 100) + '%，持续约 ' + w.days + ' 天。', 'bad');
        if (BT.Market && BT.Market.onGoodsShock) BT.Market.onGoodsShock(S, w.gid, (w.mul - 1) * 1.2);
      } else {
        sp.goods[w.gid] = { mul: 1, days: w.days, out: true };
        BT.Log.add('⛔ 断供：' + g.icon + g.name + ' 停止批发供货 ' + w.days + ' 天' + (Sup.contract(S, w.gid) ? '（你有长约，仍可按锁定价进货）' : '，只能找应急供应商（加价 40%、每单限量）') + '。', 'bad');
        if (BT.Market && BT.Market.onGoodsShock) BT.Market.onGoodsShock(S, w.gid, 0.6);
      }
      BT.Bus.emit('supply', w);
      return false;
    });
    /* 3) 合同到期提醒 */
    U.keys(sp.contracts).forEach(function (gid) {
      if (sp.contracts[gid].until === S.day) BT.Log.add('📄 ' + C.goodsMap[gid].name + ' 长期供货合同今天到期。', 'sys');
      if (sp.contracts[gid].until < S.day) delete sp.contracts[gid];
    });
    /* 4) 新预警 */
    if (S.day < C.SUPPLY.startDay || !rng.chance(C.SUPPLY.dailyChance)) return;
    var busy = {}; U.keys(sp.goods).forEach(function (k) { busy[k] = 1; }); sp.warn.forEach(function (w) { busy[w.gid] = 1; });
    var cand = C.GOODS.filter(function (g) { return !busy[g.id]; });
    if (!cand.length) return;
    var gid = rng.pick(cand).id;
    var outage = !!S.biz && rng.chance(0.38); /* 断供只在成立公司后出现（第一阶段只有涨价） */
    var w = outage
      ? { gid: gid, type: 'out', inDays: rng.int(1, 3), days: rng.int(3, 6), mul: 1 }
      : { gid: gid, type: 'rise', inDays: rng.int(1, 3), days: rng.int(6, 12), mul: U.round2(rng.range(1.15, 1.4)) };
    sp.warn.push(w);
    BT.Log.add('📦 ' + fill(rng.pick(outage ? OUT_TEXT : RISE_TEXT), gid, w.inDays) + '。' + (S.biz ? '可以提前囤货或签长约。' : '可以提前囤一点货。'), 'event');
  };

  /** 给 UI：当前所有供应链状态（生效中 + 预警中） */
  Sup.board = function (S) {
    var sp = Sup.ensure(S), rows = [];
    U.keys(sp.goods).forEach(function (gid) { var g = sp.goods[gid]; rows.push({ gid: gid, state: g.out ? 'out' : 'rise', mul: g.mul, days: g.days }); });
    sp.warn.forEach(function (w) { rows.push({ gid: w.gid, state: 'warn-' + w.type, mul: w.mul, days: w.inDays, len: w.days }); });
    return rows;
  };
})();
