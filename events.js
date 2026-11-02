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
      text: ['持续高温，饮料需求大增。', '气象台发布高温橙色预警，冷饮卖疯了。'],
      apply: function (S) { bump(S, 'demandMul', 'drink', 1.4); } },

    /* ---------------- 以下为新增事件（文案带多个版本，随机挑一句） ---------------- */
    { id: 'festival', type: 'market', w: 5, cooldown: 14,
      text: ['老街庙会开幕，摊贩云集、游客如织！', '传统灯会在老街举办，夜里人山人海。'],
      apply: function (S) { S.events.trafficMul = { oldst: 1.5 }; bump(S, 'demandMul', 'snack', 1.25); bump(S, 'demandMul', 'toy', 1.3); } },
    { id: 'exam_week', type: 'market', w: 5, cooldown: 12,
      text: ['学院区进入期末考试周，文具被抢购一空。', '考研冲刺季，学生们的文具和饮料消耗量猛增。'],
      apply: function (S) { bump(S, 'demandMul', 'stationery', 1.45); bump(S, 'demandMul', 'drink', 1.15); } },
    { id: 'cruise', type: 'market', w: 5, cooldown: 10,
      text: ['一艘国际邮轮靠港，码头涌来大批游客。', '旅游旺季到了，车站码头人潮汹涌。'],
      apply: function (S) { S.events.trafficMul = { port: 1.45 }; bump(S, 'demandMul', 'tea', 1.2); bump(S, 'demandMul', 'seafood', 1.2); } },
    { id: 'fishing_ban', type: 'market', w: 5, cooldown: 14,
      text: ['伏季休渔开始，海产供应骤减，批发价上涨。'],
      apply: function (S) { bump(S, 'priceMul', 'seafood', 1.35); } },
    { id: 'phone_launch', type: 'market', w: 5, cooldown: 12,
      text: ['某品牌新手机发布，手机壳和配件跟着火了。', '新款手机开卖，配件店门口排起长队。'],
      apply: function (S) { bump(S, 'demandMul', 'phonecase', 1.4); } },
    { id: 'antique_fake', type: 'market', w: 4, cooldown: 14,
      text: ['媒体曝光假古玩骗局，古玩市场人心惶惶。'],
      apply: function (S) { bump(S, 'demandMul', 'antique', 0.7); bump(S, 'priceMul', 'antique', 0.85); } },
    { id: 'antique_show', type: 'market', w: 4, cooldown: 14,
      text: ['电视鉴宝节目在本市录制，老街古玩身价倍增。'],
      apply: function (S) { bump(S, 'demandMul', 'antique', 1.35); } },
    { id: 'cold_snap', type: 'market', w: 4, cooldown: 10,
      text: ['寒潮来袭，服饰类商品走俏。', '气温骤降，大家都在抢购厚衣服。'],
      apply: function (S) { bump(S, 'demandMul', 'cloth', 1.35); } },
    { id: 'kids_day', type: 'market', w: 4, cooldown: 20,
      text: ['亲子节将至，小玩具需求大增。'],
      apply: function (S) { bump(S, 'demandMul', 'toy', 1.45); } },
    { id: 'tea_counterfeit', type: 'market', w: 4, cooldown: 14,
      text: ['有商贩以次充好卖假茶，消费者对茶叶变得谨慎。'],
      apply: function (S) { bump(S, 'demandMul', 'tea', 0.75); } },
    { id: 'influencer', type: 'opportunity', w: 4, cooldown: 12,
      text: ['一位探店博主路过你的摊位，拍了条视频，今天来的人特别多！', '有人在短视频平台夸你家东西实惠，客流明显增加。'],
      apply: function (S) { var t = {}; t[S.region] = 1.5; S.events.trafficMul = t; if (S.biz) S.biz.brand = U.clamp(S.biz.brand + 1.5, 0, 100); } },
    { id: 'lucky_find', type: 'opportunity', w: 3, cooldown: 15,
      text: ['打扫时在旧柜子里翻出一个红包。', '老家亲戚寄来一笔小钱，说是给你创业的。'],
      apply: function (S) { BT.Eco.earn(S, 40 + rng.int(0, 60), '意外之财'); } },
    { id: 'gov_subsidy', type: 'opportunity', w: 3, cooldown: 30, needBiz: true,
      text: ['政府发放小微企业稳岗补贴。', '商务局对新开门店发放开业补贴。'],
      apply: function (S) { BT.Eco.earn(S, Math.round(300 + S.biz.shops.length * 250), '政府补贴'); } },
    { id: 'good_review', type: 'opportunity', w: 5, cooldown: 8, needBiz: true,
      text: ['一位顾客在点评网站写了长篇好评，门店口碑上升。', '你家店员热心帮老人搬东西的视频火了。'],
      apply: function (S) { var sh = rng.pick(S.biz.shops); if (sh) sh.reputation = U.clamp(sh.reputation + 6, 0, 100); } },
    { id: 'rent_hike', type: 'trouble', w: 4, cooldown: 30, needBiz: true,
      text: ['房东通知：门店续租要涨租金了。', '商场物业上调了管理费。'],
      apply: function (S) { var sh = rng.pick(S.biz.shops); if (sh) { sh.rent = Math.round(sh.rent * 1.12); BT.Log.add('🏠 ' + BT.CFG.regionMap[sh.regionId].name + ' 店日租涨到 ' + U.money(sh.rent) + '。', 'bad'); } } },
    { id: 'bad_review', type: 'trouble', w: 4, cooldown: 10, needBiz: true,
      text: ['有顾客在网上吐槽你家服务差，口碑受损。', '一条差评被顶上了热门，门店口碑下滑。'],
      apply: function (S) { var sh = rng.pick(S.biz.shops); if (sh) sh.reputation = U.clamp(sh.reputation - 7, 0, 100); } },
    { id: 'emp_sick', type: 'trouble', w: 4, cooldown: 8, needBiz: true,
      text: ['一名员工请了病假，今天店里少一个人。'],
      apply: function (S) { var all = []; S.biz.shops.forEach(function (sh) { sh.employees.forEach(function (e) { all.push(e); }); }); var e = rng.pick(all); if (e) e.offDuty = 1; } },
    { id: 'emp_birthday', type: 'personal', w: 4, cooldown: 12, needBiz: true,
      text: ['你给过生日的员工买了蛋糕，大家都很开心。'],
      apply: function (S) { S.biz.shops.forEach(function (sh) { sh.employees.forEach(function (e) { e.loyalty = U.clamp((e.loyalty || 60) + 4, 0, 100); }); }); BT.Eco.pay(S, 60, '员工生日蛋糕'); } },
    { id: 'tax_audit', type: 'trouble', w: 3, cooldown: 30, needBiz: true,
      text: ['税务部门例行抽查，补缴了一笔税款。'],
      apply: function (S) { BT.Eco.pay(S, Math.round(200 + S.biz.shops.length * 150), '补缴税款'); } },
    { id: 'power_cut', type: 'trouble', w: 4, cooldown: 12,
      text: ['片区停电半天，生意受影响。', '自来水管爆裂，整条街封路抢修。'],
      apply: function (S) { var t = {}; t[rng.pick(BT.CFG.REGIONS).id] = 0.6; S.events.trafficMul = t; } },
    { id: 'sleep_well', type: 'personal', w: 5, cooldown: 7,
      text: ['昨晚睡得特别香，今天精神饱满。'],
      apply: function (S) { S.energy = U.clamp(S.energy + 15, 0, S.energyMax); } },
    { id: 'back_pain', type: 'personal', w: 4, cooldown: 10,
      text: ['搬货时闪了腰，今天干不了重活。'],
      apply: function (S) { S.stamina = U.clamp(S.stamina - 20, 0, S.staminaMax); } }
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
  /* 开新局时清空冷却记录与待处理事件（否则上一局的状态会带进新局） */
  BT.Bus.on('newgame', function () { Ev.history = {}; Ev.pending = null; });

  Ev.rollDaily = function (S) {
    S.events = { priceMul: {}, demandMul: {}, trafficMul: {}, inspectionRisk: 0.08, bonusJob: false };
    Ev.pending = null;
    /* 30% 概率不触发事件，保持日常节奏 */
    if (rng.chance(0.3)) return;
    var pool = POOL.filter(function (e) {
      var last = Ev.history[e.id];
      if (e.needBiz && !(S.biz && S.biz.shops.length)) return false;
      return last == null || (S.day - last) >= e.cooldown;
    });
    if (!pool.length) return;
    var tm = (C.DIFFICULTY[S.difficulty] || C.DIFFICULTY.normal).trouble;
    var ev = rng.weighted(pool, function (e) { return e.w * (e.type === 'trouble' ? tm : 1); });
    if (!ev) return;
    Ev.history[ev.id] = S.day;
    ev.apply(S);
    var tag = { market: '📊', opportunity: '✨', trouble: '⚠️', personal: '🙂' }[ev.type] || '📰';
    var text = Array.isArray(ev.text) ? rng.pick(ev.text) : ev.text;
    BT.Log.add(tag + ' ' + text, ev.type === 'trouble' ? 'bad' : (ev.type === 'opportunity' ? 'good' : 'event'));
    S.lastEvent = { day: S.day, id: ev.id, type: ev.type, text: text };
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
