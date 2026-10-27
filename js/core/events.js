/* ==========================================================================
 * 文件：js/core/events.js
 * 作用：全局事件系统 —— 每日随机事件池，影响价格/客流/现金，并联动金融市场
 * 说明：对应设计文档「三、全局事件系统」与「四、跨系统联动规则」。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Ev = BT.Events = {};

  /* ========================================================================
   * 一、事件定义
   *    type: weather(天气，由economy单独处理) / market(市场) / opportunity(机会)
   *          / trouble(麻烦) / personal(个人)
   *    apply(S): 事件生效时调用，可直接改 S，也可设置 S.events.* 系数供别处读取
   *    cooldown: 最少间隔天数，避免连续重复
   * ===================================================================== */
  var POOL = [
    { id: 'veg_surge', type: 'market', w: 10, cooldown: 6,
      text: '新闻：产地暴雨，蔬菜批发价大涨！',
      apply: function (S) { bump(S, 'priceMul', 'veg', 1.5); mkt(S, 'veg', 0.9, 1); } },
    { id: 'fruit_glut', type: 'market', w: 8, cooldown: 6,
      text: '新闻：水果大丰收，市场价格走低。',
      apply: function (S) { bump(S, 'priceMul', 'fruit', 0.7); mkt(S, 'fruit', -0.6, 1); } },
    { id: 'tea_hot', type: 'market', w: 6, cooldown: 8,
      text: '新闻：特产茶叶出口订单增加，收购价上涨。',
      apply: function (S) { bump(S, 'demandMul', 'tea', 1.35); } },
    { id: 'logistics', type: 'market', w: 7, cooldown: 7,
      text: '新闻：物流新规实施，部分商品运输成本上升。',
      apply: function (S) { ['daily', 'cloth', 'phonecase'].forEach(function (g) { bump(S, 'priceMul', g, 1.15); }); } },
    { id: 'big_order', type: 'opportunity', w: 6, cooldown: 10,
      text: '有客户想大批订购你摊位/店里的商品，但需要先垫资进货。',
      choice: true,
      apply: function (S) { Ev.pending = { id: 'big_order', text: '是否接下大订单？（需垫资，完成后有额外收益）' }; } },
    { id: 'friend_job', type: 'opportunity', w: 8, cooldown: 5,
      text: '老同学介绍了一份兼职，今天多一次高薪临时工机会。',
      apply: function (S) { S.events.bonusJob = true; } },
    { id: 'discount_stall', type: 'opportunity', w: 6, cooldown: 7,
      text: '批发市场今日清仓甩卖，部分商品进货价更低。',
      apply: function (S) { ['snack', 'drink', 'toy'].forEach(function (g) { bump(S, 'priceMul', g, 0.75); }); } },
    { id: 'inspection', type: 'trouble', w: 7, cooldown: 6,
      text: '城管今日加强检查，摆摊有被罚款的风险。',
      apply: function (S) { S.events.inspectionRisk = 0.35; } },
    { id: 'theft', type: 'trouble', w: 4, cooldown: 9,
      text: '小偷光顾了你的摊位，损失了一些现金。',
      apply: function (S) {
        var loss = Math.round(Math.min(S.cash * 0.08, 60 + rng.int(0, 60)));
        if (loss > 0) { BT.Eco.pay(S, loss, '遭遇小偷'); }
      } },
    { id: 'equip_break', type: 'trouble', w: 4, cooldown: 10,
      text: '手推车/工具损坏，需要花钱维修。',
      apply: function (S) { var c = 30 + rng.int(0, 40); BT.Eco.pay(S, c, '维修工具'); } },
    { id: 'cold', type: 'personal', w: 6, cooldown: 8,
      text: '你感冒了，今天状态不佳。',
      apply: function (S) { S.health = U.clamp(S.health - 10, 0, 100); } },
    { id: 'old_friend', type: 'personal', w: 5, cooldown: 10,
      text: '遇到老同学小聚，心情愉快，健康略有恢复。',
      apply: function (S) { S.health = U.clamp(S.health + 6, 0, 100); } },
    { id: 'school_out', type: 'market', w: 8, cooldown: 4,
      text: '学校放学高峰，老街/学院区人流明显增加。',
      apply: function (S) { S.events.trafficMul = { oldst: 1.3, college: 1.25 }; } },
    { id: 'heat_wave', type: 'market', w: 5, cooldown: 7,
      text: '持续高温，饮料需求大增。',
      apply: function (S) { bump(S, 'demandMul', 'drink', 1.4); } }
  ];

  function mkt(S, goodsId, pct, days) {
    /* 联动跨系统：若该商品是大宗贸易商品，影响对应期货/股票（见 market.js 的 onGoodsShock） */
    if (BT.Market && BT.Market.onGoodsShock) BT.Market.onGoodsShock(S, goodsId, pct);
  }
  function bump(S, field, goodsId, mul) {
    S.events = S.events || {};
    S.events[field] = S.events[field] || {};
    S.events[field][goodsId] = mul;
  }

  /* ========================================================================
   * 二、每日滚动事件（在 economy.sleep() 结算后调用）
   * ===================================================================== */
  Ev.history = {}; /* id -> 最近触发的 day，用于冷却 */

  Ev.rollDaily = function (S) {
    S.events = { priceMul: {}, demandMul: {}, trafficMul: {}, inspectionRisk: 0.08, bonusJob: false };
    Ev.pending = null;
    /* 30% 概率不触发事件，保持日常节奏 */
    if (rng.chance(0.3)) return;
    var pool = POOL.filter(function (e) {
      var last = Ev.history[e.id];
      return last == null || (S.day - last) >= e.cooldown;
    });
    if (!pool.length) return;
    var ev = rng.weighted(pool, function (e) { return e.w; });
    if (!ev) return;
    Ev.history[ev.id] = S.day;
    ev.apply(S);
    var tag = { market: '📊', opportunity: '✨', trouble: '⚠️', personal: '🙂' }[ev.type] || '📰';
    BT.Log.add(tag + ' ' + ev.text, ev.type === 'trouble' ? 'bad' : (ev.type === 'opportunity' ? 'good' : 'event'));
    BT.Bus.emit('event', ev);
  };

  /** 摆摊时调用：按当日事件风险判定是否被城管查到 */
  Ev.checkInspection = function (S) {
    var risk = (S.events && S.events.inspectionRisk) || 0.08;
    if (rng.chance(risk)) {
      var fine = 20 + rng.int(0, 50);
      BT.Eco.pay(S, fine, '被城管查到，罚款');
      return true;
    }
    return false;
  };

  /** 接受“大订单”机会事件（由UI调用） */
  Ev.acceptBigOrder = function (S, goodsId, qty) {
    var g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '商品不存在' };
    var cost = BT.Eco.buyPrice(S, goodsId, S.region) * qty;
    if (S.cash < cost) return { ok: false, msg: '现金不足，无法垫资进货' };
    BT.Eco.pay(S, cost, '大订单垫资进货 ' + g.name + ' x' + qty);
    var revenue = Math.round(cost * (1.45 + rng.next() * 0.3));
    BT.Eco.earn(S, revenue, '大订单交货 ' + g.name);
    Ev.pending = null;
    return { ok: true, msg: '订单完成，净赚 ' + U.money(revenue - cost) };
  };

  /** 拒绝当前待处理的机会事件（由UI调用） */
  Ev.declinePending = function (S) {
    Ev.pending = null;
    return { ok: true, msg: '已拒绝这笔订单' };
  };
})();
