/* ==========================================================================
 * 文件：js/phase2/biz.js
 * 作用：第二阶段 —— 商业扩张：多店铺、员工、供应商、仓库、地产、贷款、财报、竞争
 * 触发：净资产达到里程碑3（¥10,000）后 S.phase = 2，首次进入时迁移第一阶段店铺
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco, rng = BT.rng;
  var Biz = BT.Biz = {};

  var EMP_SLOT_BASE = 2;        /* 每间店基础员工上限 */
  var EMP_ROLES = [
    { id: 'clerk', name: '店员', wageBase: 55, skillGain: 0.08 },
    { id: 'buyer', name: '采购', wageBase: 75, skillGain: 0.10 },
    { id: 'manager', name: '店长', wageBase: 120, skillGain: 0.16 }
  ];
  Biz.EMP_ROLES = EMP_ROLES;

  var NAMES = ['小林', '阿强', '美玲', '建国', '晓雯', '老王', '小芳', '志伟', '雅婷', '大勇', '思琪', '浩然', '春燕', '德华', '佳怡', '子轩', '秀英', '文杰', '梦洁', '国栋'];

  /* ========================================================================
   * 一、初始化 / 迁移
   * ===================================================================== */
  Biz.ensure = function (S) {
    if (S.biz) return S.biz;
    var biz = {
      shops: [], warehouses: {}, /* regionId -> {cap, goods:{gid:qty}} */
      loans: [], creditScore: 650,
      brand: 10, /* 品牌声望（0-100），影响所有店铺的基础客流加成 */
      ledger: [], /* 每日流水：{day, revenue, cogs, rent, wage, interest, other, profit} */
      monthly: [], /* 月度财报快照 */
      competitors: {}, candidates: [], candDay: 0, founded: S.day
    };
    /* 迁移第一阶段的店铺与库存 */
    if (S.shop) {
      biz.shops.push(migrateShop(S.shop));
      S.shop = null;
    }
    S.biz = biz;
    if (BT.Rivals) BT.Rivals.ensure(S);
    Biz.refreshCandidates(S, true);
    BT.Log.add('🏢 公司成立！可以开设更多店铺、招聘员工、申请贷款了。注意：新港市还有几家 AI 公司在和你抢生意。', 'sys');
    return biz;
  };

  function migrateShop(shop) {
    return normShop({
      id: BT.uid('shop'), regionId: shop.regionId, shelf: shop.shelf || {},
      reputation: shop.reputation || 30, employees: shop.employee ? [{
        id: BT.uid('emp'), name: rng.pick(NAMES), role: 'clerk', wage: shop.employee.wage, skill: shop.employee.skill
      }] : [], rent: shop.rent, value: shop.value || 0, daysOpen: shop.daysOpen || 0,
      inventory: {} /* 门店自身库存，由仓库调货补充 */
    });
  }
  /** 补齐新版字段（地段、员工能力/忠诚/特质），兼容旧存档 */
  function normShop(sh) {
    sh.loc = sh.loc || 'street'; sh.trafficHist = sh.trafficHist || []; sh.promoDays = sh.promoDays || 0;
    sh.inventory = sh.inventory || {}; sh.shelf = sh.shelf || {};
    (sh.employees || []).forEach(normEmp);
    return sh;
  }
  function normEmp(e) {
    if (e.service == null) e.service = 1;
    if (e.loyalty == null) e.loyalty = 60;
    if (!e.trait) e.trait = 'plain';
    e.skill = e.skill || 1;
    return e;
  }
  Biz.normShop = normShop;
  /** 旧存档迁移入口（state.js 调用） */
  Biz.migrate = function (S) {
    if (!S.biz) return;
    S.biz.shops.forEach(normShop);
    S.biz.candidates = S.biz.candidates || []; S.biz.candDay = S.biz.candDay || 0;
    if (BT.Rivals) BT.Rivals.ensure(S);
  };

  /** 区域竞争对手视图（兼容旧版 biz.competitors：每区显示最强的那家 AI 公司） */
  var COMP_NAMES = { slum: '老李杂货', market: '万家批发', oldst: '福记百货', cbd: '星耀商城', port: '远洋贸易', college: '学府书吧' };
  Biz.nameCompetitors = function (biz) {
    biz.competitors = biz.competitors || {};
    U.keys(biz.competitors).forEach(function (rid) { if (!biz.competitors[rid].name) biz.competitors[rid].name = COMP_NAMES[rid] || '本地商行'; });
  };

  /* ========================================================================
   * 二、开设新店铺（押金 + 装修费）—— 选址：地段决定租金与客流
   * ===================================================================== */
  Biz.shopCost = function (regionId, locId) { var r = C.regionMap[regionId], l = C.locMap[locId || 'street']; return Math.round(r.rent * 90 * l.costMul); }; /* v7.3：开店成本翻倍（门店更赚钱了，回本期约 1~3 周） */
  Biz.shopRent = function (regionId, locId) { var r = C.regionMap[regionId], l = C.locMap[locId || 'street']; return Math.round(r.rent * 3 * l.rentMul); };
  Biz.openShop = function (S, regionId, locId) {
    var biz = Biz.ensure(S);
    locId = C.locMap[locId] ? locId : 'street';
    var region = C.regionMap[regionId]; if (!region) return { ok: false, msg: '区域不存在' };
    if (S.unlockedRegions.indexOf(regionId) < 0) return { ok: false, msg: '该区域尚未解锁' };
    var exists = biz.shops.some(function (s) { return s.regionId === regionId; });
    if (exists) return { ok: false, msg: '该区域已有店铺' };
    var taken = locId === 'corner' && BT.Rivals && BT.Rivals.cornerTaken ? BT.Rivals.cornerTaken(S, regionId) : null;
    if (taken) return { ok: false, msg: '这个区的路口旺铺被 ' + ((BT.Rivals.get(S, taken.by) || {}).name || '对手') + ' 占了（还剩 ' + (taken.until - S.day + 1) + ' 天），换个地段吧' };
    var cost = Biz.shopCost(regionId, locId);
    if (S.cash < cost) return { ok: false, msg: '资金不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '新店押金与装修（' + region.name + ' · ' + C.locMap[locId].name + '）');
    biz.shops.push(normShop({ id: BT.uid('shop'), regionId: regionId, loc: locId, shelf: {}, reputation: 20, employees: [],
      rent: Biz.shopRent(regionId, locId), value: cost, daysOpen: 0, inventory: {} }));
    BT.Bus.emit('fx', { kind: 'open', text: '🎉 新店开业：' + region.name });
    return { ok: true, msg: '在' + region.name + '（' + C.locMap[locId].name + '）新开一间店铺！' };
  };
  /** 搬迁换地段：花一笔装修费（新地段装修的 60%），声望打 8 折（老顾客流失一部分） */
  Biz.RELOC_COOLDOWN = 30; /* 搬迁后至少 30 天才能再搬 */
  Biz.relocate = function (S, shopId, locId) {
    var biz = Biz.ensure(S), shop = findShop(biz, shopId);
    if (!shop) return { ok: false, msg: '店铺不存在' };
    if (!C.locMap[locId]) return { ok: false, msg: '地段不存在' };
    if (shop.loc === locId) return { ok: false, msg: '已经在这个地段了' };
    var taken = locId === 'corner' && BT.Rivals && BT.Rivals.cornerTaken ? BT.Rivals.cornerTaken(S, shop.regionId) : null;
    if (taken) return { ok: false, msg: '路口旺铺被 ' + ((BT.Rivals.get(S, taken.by) || {}).name || '对手') + ' 占了（还剩 ' + (taken.until - S.day + 1) + ' 天）' };
    if (shop.relocDay != null && S.day - shop.relocDay < Biz.RELOC_COOLDOWN) return { ok: false, msg: '刚搬过家，' + (shop.relocDay + Biz.RELOC_COOLDOWN - S.day) + ' 天后才能再搬' };
    var cost = Math.round(Biz.shopCost(shop.regionId, locId) * 0.6);
    if (S.cash < cost) return { ok: false, msg: '搬迁费用不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '店铺搬迁到' + C.locMap[locId].name);
    shop.loc = locId; shop.rent = Biz.shopRent(shop.regionId, locId); delete shop.hike; /* 搬走了，对手抬的租也就不算了 */
    shop.reputation = shop.reputation * 0.8; shop.value = Math.max(shop.value, cost); shop.relocDay = S.day;
    return { ok: true, msg: '已搬到' + C.locMap[locId].name + '，新日租 ' + U.money(shop.rent) };
  };
  /** 选址预估：在某区某地段开店，正常情况下每天大概有多少顾客（2 名员工、当前竞争格局） */
  Biz.siteForecast = function (S, regionId, locId) {
    var biz = Biz.ensure(S), r = C.regionMap[regionId], l = C.locMap[locId || 'street'];
    var week = C.WEEK_TRAFFIC[regionId] || [1, 1, 1, 1, 1, 1, 1];
    var avgWeek = U.sum(week) / 7;
    var pull = (1 + biz.brand / 150) * 0.8;
    var cf = BT.Rivals ? BT.Rivals.compFactor(S, regionId, pull) : 0.6;
    var staff = U.clamp(0.5 + 2 * 1.12 * 0.22, 0.5, 2.2);
    return { customers: Math.round(r.traffic * C.SHOP_TRAFFIC * avgWeek * l.traffic * staff * Math.min(1.5, 2.0 * cf)), rent: Biz.shopRent(regionId, locId), cost: Biz.shopCost(regionId, locId), cf: cf, week: week };
  };

  Biz.closeShop = function (S, shopId) {
    var biz = Biz.ensure(S);
    biz.shops = biz.shops.filter(function (s) { return s.id !== shopId; });
    return { ok: true, msg: '已关闭该店铺' };
  };

  /** 平息罢工：全店加薪 15%，忠诚 +15，立刻复工 */
  Biz.settleStrike = function (S, shopId) {
    var shop = findShop(Biz.ensure(S), shopId); if (!shop || !shop.strike) return { ok: false, msg: '这家店没有罢工' };
    shop.employees.forEach(function (e) { e.wage = Math.round(e.wage * 1.15); e.loyalty = U.clamp(e.loyalty + 15, 0, 100); });
    shop.strike = 0;
    return { ok: true, msg: '谈判成功：全员加薪 15%，明天复工' };
  };
  /** 会员计划：一次性 ¥2,000 办卡系统；回头客按口碑和成交慢慢积累，不受对手分流影响（会员价 99 折） */
  Biz.MEMBER_COST = 2000;
  Biz.startMembership = function (S, shopId) {
    var shop = findShop(Biz.ensure(S), shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    if (shop.memberProg) return { ok: false, msg: '已经开通会员了' };
    if (S.cash < Biz.MEMBER_COST) return { ok: false, msg: '需要 ' + U.money(Biz.MEMBER_COST) };
    Eco.pay(S, Biz.MEMBER_COST, '会员系统（' + C.regionMap[shop.regionId].name + '）');
    shop.memberProg = true; shop.members = shop.members || 0;
    return { ok: true, msg: '会员计划上线：口碑越好、成交越多，会员积累越快' };
  };

  /** 促销活动：5 天内该店吸引力 ×1.3，并小幅提升声望 */
  Biz.promoCost = function (shop) { return Math.round(300 + shop.rent * 8); };
  Biz.promote = function (S, shopId) {
    var biz = Biz.ensure(S), shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    if (shop.promoDays > 0) return { ok: false, msg: '促销还在进行中（剩 ' + shop.promoDays + ' 天）' };
    var cost = Biz.promoCost(shop);
    if (S.cash < cost) return { ok: false, msg: '促销预算不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '促销活动（' + C.regionMap[shop.regionId].name + '）');
    shop.promoDays = 5; shop.reputation = U.clamp(shop.reputation + 3, 0, 100);
    return { ok: true, msg: C.regionMap[shop.regionId].name + ' 促销 5 天：吸引力 ×1.3，对抗价格战很管用' };
  };

  /* ========================================================================
   * 三、员工：人才市场招聘 / 培训（销售·服务）/ 加薪 / 解雇
   *    每名员工：skill=销售能力、service=服务能力（1-5）、loyalty 忠诚度、trait 特质
   *    工资低于身价 → 忠诚度下降 → 容易被 AI 公司挖走或主动离职
   * ===================================================================== */
  function roleOf(id) { return EMP_ROLES.filter(function (r) { return r.id === id; })[0] || EMP_ROLES[0]; }
  Biz.roleOf = roleOf;
  /** 员工身价（合理日薪）：能力越高身价越高，培训后要记得加薪 */
  Biz.fairWage = function (e) { return Math.round(roleOf(e.role).wageBase * (1 + 0.12 * (e.skill - 1) + 0.08 * ((e.service || 1) - 1))); };
  Biz.empCap = function (shop) { return EMP_SLOT_BASE + Math.floor((shop.value || 0) / 2000); };
  function makeCandidate(S, roleId, quality) {
    var role = roleOf(roleId || rng.pick(['clerk', 'clerk', 'buyer', 'manager']));
    var q = quality == null ? rng.next() : quality;
    var e = { id: BT.uid('cand'), name: rng.pick(NAMES), role: role.id,
      skill: U.clamp(1 + Math.floor(q * 3 + rng.next()), 1, 4), service: U.clamp(1 + Math.floor(rng.next() * 3 * q + rng.next()), 1, 4),
      trait: rng.pick(C.EMP_TRAITS).id, loyalty: Math.round(rng.range(45, 75)) };
    e.wage = Math.round(Biz.fairWage(e) * rng.range(0.95, 1.15));
    return e;
  }
  Biz.refreshCandidates = function (S, force) {
    var biz = S.biz; if (!biz) return;
    if (!force && S.day - (biz.candDay || 0) < 5 && biz.candidates.length) return;
    biz.candDay = S.day; biz.candidates = [];
    for (var i = 0; i < 4; i++) {
      var r = rng.pick(EMP_ROLES);
      biz.candidates.push(makeCandidate(S, r.id));
    }
  };
  function addEmp(shop, c) {
    var e = normEmp({ id: BT.uid('emp'), name: c.name, role: c.role, wage: c.wage, skill: c.skill, service: c.service, trait: c.trait, loyalty: c.loyalty, hired: BT.S ? BT.S.day : 0 });
    shop.employees.push(e); return e;
  }
  /** 直接招聘一名普通员工（能力随机偏低，兼容旧接口） */
  Biz.hire = function (S, shopId, roleId) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    var cap = Biz.empCap(shop);
    if (shop.employees.length >= cap) return { ok: false, msg: '该店员工已满（上限 ' + cap + '）' };
    var role = roleOf(roleId);
    var hireFee = role.wageBase * 2;
    if (S.cash < hireFee) return { ok: false, msg: '招聘费不够（需要 ' + U.money(hireFee) + '）' };
    Eco.pay(S, hireFee, '招聘' + role.name);
    var c = makeCandidate(S, role.id, 0.15); c.skill = 1; c.wage = role.wageBase;
    var e = addEmp(shop, c);
    return { ok: true, msg: '招聘了一名' + role.name + '：' + e.name + '（' + C.traitMap[e.trait].name + '）' };
  };
  /** 从人才市场签下候选人（能力更好，但要价也更高；AI 公司也会来抢） */
  Biz.hireCandidate = function (S, shopId, candId) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    var c = biz.candidates.filter(function (x) { return x.id === candId; })[0];
    if (!c) return { ok: false, msg: '这位候选人已经被别家签走了' };
    var cap = Biz.empCap(shop);
    if (shop.employees.length >= cap) return { ok: false, msg: '该店员工已满（上限 ' + cap + '）' };
    var fee = c.wage * 2;
    if (S.cash < fee) return { ok: false, msg: '签约费不够（需要 ' + U.money(fee) + '）' };
    Eco.pay(S, fee, '签约' + roleOf(c.role).name + c.name);
    biz.candidates = biz.candidates.filter(function (x) { return x.id !== candId; });
    addEmp(shop, c);
    BT.Bus.emit('fx', { kind: 'hire', text: '🤝 ' + c.name + ' 加入！' });
    return { ok: true, msg: c.name + ' 入职 ' + C.regionMap[shop.regionId].name + ' 店' };
  };
  Biz.fire = function (S, shopId, empId) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    shop.employees = shop.employees.filter(function (e) { return e.id !== empId; });
    return { ok: true, msg: '已解雇' };
  };
  function findEmp(biz, shopId, empId) {
    var shop = findShop(biz, shopId); if (!shop) return {};
    return { shop: shop, emp: shop.employees.filter(function (e) { return e.id === empId; })[0] };
  }
  Biz.trainCost = function (e, course) { var c = C.TRAINING[course] || C.TRAINING.sales; return c.base + (course === 'service' ? e.service : e.skill) * 130; };
  /** 培训：脱产 1 天（明天结算时不上班），销售或服务能力 +1；有野心的员工有概率 +2 */
  Biz.train = function (S, shopId, empId, course) {
    var biz = Biz.ensure(S); course = C.TRAINING[course] ? course : 'sales';
    var f = findEmp(biz, shopId, empId); if (!f.shop) return { ok: false, msg: '店铺不存在' };
    var emp = f.emp; if (!emp) return { ok: false, msg: '员工不存在' };
    var key = course === 'service' ? 'service' : 'skill';
    if (emp[key] >= 5) return { ok: false, msg: '已经满级了' };
    if (emp.offDuty) return { ok: false, msg: emp.name + ' 已经在培训中' };
    var cost = Biz.trainCost(emp, course);
    if (S.cash < cost) return { ok: false, msg: '培训费不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, C.TRAINING[course].name + '：' + emp.name);
    var tr = C.traitMap[emp.trait] || {}, n = (tr.learn && rng.chance(tr.learn)) ? 2 : 1;
    emp[key] = Math.min(5, emp[key] + n); emp.offDuty = 1;
    BT.Bus.emit('fx', { kind: 'level', text: '⬆️ ' + emp.name + ' ' + (key === 'skill' ? '销售' : '服务') + ' Lv.' + emp[key] });
    return { ok: true, msg: emp.name + ' ' + C.TRAINING[course].name + '完成，' + (key === 'skill' ? '销售' : '服务') + '提升到 Lv.' + emp[key] + (n > 1 ? '（悟性高，连升两级！）' : '') + '；明天脱产不上班。身价涨到 ' + U.money(Biz.fairWage(emp)) + '/天，记得考虑加薪。' };
  };
  /** 加薪 10%：忠诚度 +12 */
  Biz.raise = function (S, shopId, empId) {
    var biz = Biz.ensure(S), f = findEmp(biz, shopId, empId);
    if (!f.emp) return { ok: false, msg: '员工不存在' };
    f.emp.wage = Math.round(f.emp.wage * 1.1); f.emp.loyalty = U.clamp(f.emp.loyalty + 12, 0, 100);
    return { ok: true, msg: f.emp.name + ' 日薪涨到 ' + U.money(f.emp.wage) + '，忠诚度 ' + Math.round(f.emp.loyalty) };
  };
  function findShop(biz, id) { return biz.shops.filter(function (s) { return s.id === id; })[0]; }
  Biz.findShop = findShop;

  /* ========================================================================
   * 四、供应商批发：按件数阶梯折扣，直接送入指定区域仓库
   * ===================================================================== */
  /** 公司里最强采购员带来的额外折扣（每级 1.2%） */
  Biz.buyerDiscount = function (S) {
    if (!S.biz) return 0; var best = 0;
    S.biz.shops.forEach(function (sh) { sh.employees.forEach(function (e) { if (e.role === 'buyer' && !e.offDuty) best = Math.max(best, e.skill); }); });
    return best * 0.012;
  };
  /** 批发进货。emergency=true：断供时找应急供应商（加价 40%、单笔限量） */
  Biz.wholesaleBuy = function (S, regionId, goodsId, qty, emergency) {
    var biz = Biz.ensure(S);
    var g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '商品不存在' };
    if (g.lux) return { ok: false, msg: g.name + ' 是进口奢侈品，要在「供应链 → 进口贸易」下单' };
    qty = Math.max(10, Math.floor(qty));
    var Sup = BT.Supply, contract = Sup && Sup.contract(S, goodsId), out = Sup && Sup.isOut(S, goodsId);
    if (out && !contract && !emergency) return { ok: false, msg: g.name + ' 正在断供，可以找应急供应商（加价 40%，每单最多 ' + C.SUPPLY.emergencyCap + ' 件），或签长约保供', outage: true };
    if (out && !contract && emergency) qty = Math.min(qty, C.SUPPLY.emergencyCap);
    var wh = Biz.warehouse(S, regionId);
    if (wh.used + qty * g.unit > wh.cap) return { ok: false, msg: '仓库容量不够' };
    var unit = Eco.buyPrice(S, goodsId, regionId);
    var lock = !contract && BT.Rivals && BT.Rivals.lockOn ? BT.Rivals.lockOn(S, goodsId) : null; /* 被对手锁了独家供货：加价（签了长约不受影响） */
    if (lock) unit = U.round2(unit * lock.mul);
    if (contract) unit = U.round2(unit * Sup.contractRatio(S, goodsId));
    else if (out && emergency) unit = U.round2(unit / 1.5 * C.SUPPLY.emergencyMul); /* 应急：不吃断供溢价，改收应急加价 */
    var discount = (qty >= 200 ? 0.78 : (qty >= 100 ? 0.85 : (qty >= 50 ? 0.92 : 1))) - Biz.buyerDiscount(S);
    var total = U.round2(unit * discount * qty);
    if (S.cash < total) return { ok: false, msg: '资金不够（需要 ' + U.money(total) + '）' };
    Eco.pay(S, total, (out && !contract ? '应急采购 ' : '批发采购 ') + g.name + ' x' + qty + (contract ? '（长约价）' : ''));
    /* 记录仓库该商品的加权平均成本，调货到门店时一并带过去，销售时才能算出真实毛利 */
    wh.cost = wh.cost || {};
    var oldQ = wh.goods[goodsId] || 0, unitPaid = unit * discount;
    wh.cost[goodsId] = oldQ > 0 ? (oldQ * (wh.cost[goodsId] || unitPaid) + qty * unitPaid) / (oldQ + qty) : unitPaid;
    wh.goods[goodsId] = oldQ + qty;
    return { ok: true, msg: '批发入库 ' + g.name + ' x' + qty + '，折扣 ' + Math.round((1 - discount) * 100) + '%' + (contract ? '，按长约价' : '') + (lock ? '（被 ' + ((BT.Rivals.get(S, lock.by) || {}).name || '对手') + ' 锁货，加价 ' + Math.round((lock.mul - 1) * 100) + '%）' : '') };
  };

  Biz.warehouse = function (S, regionId) {
    var biz = Biz.ensure(S);
    if (!biz.warehouses[regionId]) biz.warehouses[regionId] = { cap: 2000, goods: {} };
    var wh = biz.warehouses[regionId];
    wh.used = 0;
    U.keys(wh.goods).forEach(function (gid) { wh.used += wh.goods[gid] * (C.goodsMap[gid] ? C.goodsMap[gid].unit : 1); });
    return wh;
  };
  Biz.upgradeWarehouse = function (S, regionId) {
    var wh = Biz.warehouse(S, regionId);
    var cost = Math.round(wh.cap * 0.6);
    if (S.cash < cost) return { ok: false, msg: '资金不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '扩建仓库（' + C.regionMap[regionId].name + '）');
    wh.cap = Math.round(wh.cap * 1.5);
    return { ok: true, msg: '仓库扩容到 ' + wh.cap };
  };

  /** 从仓库调货到门店库存 */
  Biz.transferToShop = function (S, shopId, goodsId, qty) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    var wh = Biz.warehouse(S, shop.regionId);
    var have = wh.goods[goodsId] || 0;
    qty = Math.min(qty, have);
    if (qty <= 0) return { ok: false, msg: '仓库里没有这件商品' };
    wh.goods[goodsId] -= qty;
    var inCost = (wh.cost && wh.cost[goodsId]) || Eco.buyPrice(S, goodsId, shop.regionId) * 0.9;
    var shopQ = shop.inventory[goodsId] || 0; shop.cost = shop.cost || {};
    shop.cost[goodsId] = shopQ > 0 ? (shopQ * (shop.cost[goodsId] || inCost) + qty * inCost) / (shopQ + qty) : inCost;
    shop.inventory[goodsId] = shopQ + qty;
    if (BT.Lux && BT.Lux.onTransfer) BT.Lux.onTransfer(S, wh, shop, goodsId, qty);
    return { ok: true, msg: '调货 ' + qty + ' 件到门店' };
  };

  /** 一键补货：把每家店货架上的商品补到目标库存（默认 40 件），不够的先从批发采购到仓库再调货；最多动用 60% 现金 */
  /** 一键补货：所有门店一起补。货架为空的门店先按其他门店的货架（没有就用默认商品）自动上架；
   *  预算（现金的 60%）按门店平均分配，前面的店用不完的额度顺延给后面的店，避免第一家店把钱用光。 */
  var DEFAULT_SHELF = ['snack', 'drink', 'daily', 'stationery'];
  Biz.autoRestock = function (S, target, opts) {
    var biz = Biz.ensure(S); target = target || 40; opts = opts || {};
    if (!biz.shops.length) return { ok: false, msg: '还没有店铺' };
    var shelved = [];
    var template = {}; biz.shops.forEach(function (sh) { U.keys(sh.shelf).forEach(function (g) { if (!C.goodsMap[g].lux) template[g] = template[g] || sh.shelf[g]; }); });
    if (!U.keys(template).length) DEFAULT_SHELF.forEach(function (g) { template[g] = 1.3; });
    biz.shops.forEach(function (sh) {
      if (U.keys(sh.shelf).length) return;
      U.keys(template).forEach(function (g) { sh.shelf[g] = template[g]; });
      shelved.push(C.regionMap[sh.regionId].name);
    });
    var budget = Math.max(0, S.cash * (opts.budget || 0.6)), spent = 0, bought = 0, moved = 0, done = [];
    biz.shops.forEach(function (shop, idx) {
      var share = (budget - spent) / (biz.shops.length - idx), used = 0, got = 0;
      U.keys(shop.shelf).forEach(function (gid) {
        var isLux = C.goodsMap[gid].lux;
        var need = (isLux ? C.TRADE.targetStock : target) - (shop.inventory[gid] || 0); if (need <= 0) return;
        var wh = Biz.warehouse(S, shop.regionId), have = wh.goods[gid] || 0;
        if (have < need && !isLux) { /* 奢侈品只从仓库调货，不会自动进口 */
          var buyQ = Math.max(10, need - have), est = Eco.buyPrice(S, gid, shop.regionId) * buyQ;
          if (used + est <= share) {
            var before = S.cash, r = Biz.wholesaleBuy(S, shop.regionId, gid, buyQ);
            if (!r.ok && r.outage && opts.emergency) r = Biz.wholesaleBuy(S, shop.regionId, gid, buyQ, true); /* 断供：找应急供应商 */
            if (r.ok) { used += before - S.cash; bought += Math.min(buyQ, r.outage ? C.SUPPLY.emergencyCap : buyQ); }
          }
        }
        var t = Biz.transferToShop(S, shop.id, gid, need); if (t.ok) { moved += 1; got += 1; }
      });
      spent += used;
      if (got) done.push(C.regionMap[shop.regionId].name);
    });
    if (!bought && !moved) return { ok: false, msg: '没有需要补的货，或资金/仓库不足' };
    return { ok: true, msg: '一键补货完成（' + done.join('、') + '）：采购 ' + bought + ' 件，花费 ' + U.money(spent) + '，调货 ' + moved + ' 次' +
      (shelved.length ? '；' + shelved.join('、') + ' 货架原本是空的，已自动上架 ' + U.keys(template).map(function (g) { return C.goodsMap[g].name; }).join('、') : '') };
  };

  /* ========================================================================
   * 五、货架定价（门店自有库存，与第一阶段 shelf 逻辑一致但数据源是 inventory）
   * ===================================================================== */
  /** opts.lock = true：手动改价后锁定，区域经理的「自动定价」不再改这一项 */
  Biz.setShelf = function (S, shopId, goodsId, markup, opts) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    if (!C.goodsMap[goodsId]) return { ok: false, msg: '商品不存在' };
    if (C.goodsMap[goodsId].lux && !shop.boutique) return { ok: false, msg: '奢侈品只能在做过「精品装修」的门店上架' };
    var was = shop.shelf[goodsId];
    shop.shelf[goodsId] = U.clamp(markup || 1.3, 0.8, 2.5);
    if (opts && opts.lock) { shop.lock = shop.lock || {}; shop.lock[goodsId] = true; }
    var mgrOn = biz.mgr && biz.mgr.on && biz.mgr.autoPrice;
    return { ok: true, msg: C.goodsMap[goodsId].name + (was ? ' 改价为 ×' : ' 已上架，加价 ×') + shop.shelf[goodsId].toFixed(2) + (opts && opts.lock && mgrOn ? '（已🔒，区域经理不再自动调这一项）' : '') };
  };
  /** 🛡️ 自动应战（跟价）：有对手打价格战 / 散户甩卖时，被压价的货自动跟到它的价格，但不低于进价 +2%；平时不动你的标价 */
  Biz.toggleMatch = function (S, shopId) {
    var shop = findShop(Biz.ensure(S), shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    shop.match = !shop.match;
    return { ok: true, msg: shop.match ? '🛡️ ' + C.regionMap[shop.regionId].name + '店已开启自动应战：对手打价格战 / 甩卖时自动跟价（最低保本 +2%）' : C.regionMap[shop.regionId].name + '店已关闭自动应战，被压价也按货架标价卖' };
  };
  Biz.isLocked = function (shop, gid) { return !!(shop.lock && shop.lock[gid]); };
  /** 🔒 切换：锁定后区域经理自动定价跳过这一项 */
  Biz.toggleLock = function (S, shopId, goodsId) {
    var shop = findShop(Biz.ensure(S), shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    if (!shop.shelf[goodsId]) return { ok: false, msg: '先上架才能锁价' };
    shop.lock = shop.lock || {};
    if (shop.lock[goodsId]) { delete shop.lock[goodsId]; return { ok: true, msg: '🔓 ' + C.goodsMap[goodsId].name + ' 已解锁，交给区域经理自动定价' }; }
    shop.lock[goodsId] = true; return { ok: true, msg: '🔒 ' + C.goodsMap[goodsId].name + ' 已锁定 ×' + shop.shelf[goodsId].toFixed(2) + '，区域经理不会再改' };
  };
  /** 门店单品销售统计：today = 今天，d7 = 近 7 天合计（真实逐日累加，不是衰减估计） */
  /* ========================================================================
   * 五·一、门店诊断（v7.3）：用近 7 天的真实经营数据，告诉你这家店为什么赚 / 为什么亏、该怎么改
   *   返回 { grade, avg:{rev,gp,rent,wage,net,cust,lost}, items:[{lv:'bad'|'warn'|'good', t, fix}] }，items 按严重程度排序
   * ===================================================================== */
  Biz.diagnose = function (S, shop) {
    var h = shop.h7 || [], n = h.length;
    if (n < 2) return { grade: 'new', avg: null, items: [{ lv: 'info', t: '新店数据还不够（至少营业 2 天），过两天再来看诊断。', fix: '' }] };
    var A = { rev: 0, gp: 0, rent: 0, wage: 0, net: 0, cust: 0, lost: 0, buyers: 0, sold: 0, staff: 0 };
    h.forEach(function (d) { A.rev += d.rev || 0; A.gp += (d.rev || 0) - (d.cogs || 0); A.rent += d.rent || 0; A.wage += d.wage || 0; A.net += d.profit || 0; A.cust += d.customers || 0; A.lost += d.lost || 0; A.buyers += d.buyers || 0; A.sold += d.sold || 0; A.staff += d.staff || 0; });
    U.keys(A).forEach(function (k) { A[k] = A[k] / n; });
    var rid = shop.regionId, rn = C.regionMap[rid].name, sens = C.REGION_PRICE_SENS[rid] || 1, items = [];
    var add = function (lv, t, fix, w) { items.push({ lv: lv, t: t, fix: fix, w: w || 0 }); };
    var fixed = A.rent + A.wage;
    /* 1) 毛利撑不起固定成本 */
    if (A.net < 0) {
      if (A.gp < fixed * 0.6) add('bad', '毛利只有 ' + U.money(A.gp) + '/天，房租+工资要 ' + U.money(fixed) + '/天，差得太远。', '先砍成本（减人、搬到巷内小铺），或者上架更贵、本区热销的货。', 100);
      else add('bad', '每天亏 ' + U.money(-A.net) + '：毛利 ' + U.money(A.gp) + '，房租 ' + U.money(A.rent) + '，工资 ' + U.money(A.wage) + '。', '差得不多，看下面几条，改一两处就能扭亏。', 90);
    } else add('good', '近 ' + n + ' 天日均净赚 ' + U.money(A.net) + '（毛利 ' + U.money(A.gp) + '，固定成本 ' + U.money(fixed) + '）。', '', -10);
    /* 2) 房租占比 */
    if (A.rev > 0 && A.rent / Math.max(1, A.gp) > 0.45 && A.rent > 20) add(A.net < 0 ? 'bad' : 'warn', '房租吃掉了 ' + Math.round(A.rent / Math.max(1, A.gp) * 100) + '% 的毛利。', shop.loc === 'corner' ? '路口旺铺租金是临街的 1.8 倍，客流撑不起就搬回临街铺面。' : (shop.loc === 'street' ? '客流一般的区，可以搬到巷内小铺（租金 6 折）。' : '买下这块物业就不用交租（帝国页）。'), 60);
    /* 3) 人手 */
    if (!A.staff) add('bad', '没有员工上班，客流只有满员时的三成多。', '至少招一个店员。', 95);
    else {
      var perStaff = A.cust / A.staff;
      if (A.wage > A.gp * 0.6 && perStaff < 12) add('warn', '人手偏多：每个员工每天只接待 ' + perStaff.toFixed(0) + ' 位顾客，工资占了毛利的 ' + Math.round(A.wage / Math.max(1, A.gp) * 100) + '%。', '客流小的区一个店员就够，解雇一个能省 ' + U.money(A.wage / A.staff) + '/天。', 55);
      else if (perStaff > 30 && A.net > 0) add('info', '员工很忙（每人每天 ' + perStaff.toFixed(0) + ' 位顾客），再加一个人还能多接一些客。', '人手是客流的乘数，忙的店加人通常划算。', 5);
    }
    /* 4) 缺货 */
    if (A.cust > 0 && A.lost / A.cust > 0.15) add('bad', '近 7 天平均每天有 ' + Math.round(A.lost) + ' 位顾客因为缺货走了（' + Math.round(A.lost / A.cust * 100) + '%），还会拉低口碑。', '多补货；或者开区域经理「自动补货」。', 80);
    /* 5) 定价 vs 本区价格敏感度 */
    var ks = U.keys(shop.shelf).filter(function (g) { return C.goodsMap[g] && !C.goodsMap[g].lux; });
    if (ks.length) {
      var avgMk = U.sum(ks, function (g) { return shop.shelf[g]; }) / ks.length;
      if (sens >= 1.3 && avgMk > 1.32) add('warn', rn + '的人对价格很敏感，你的平均加价 ×' + avgMk.toFixed(2) + ' 偏高，看了不买的人多。', '这区建议 ×1.15~1.25，薄利多销。', 50);
      if (sens <= 0.9 && avgMk < 1.28) add('info', rn + '的客人不太在乎价格，你只加价 ×' + avgMk.toFixed(2) + '，有点亏。', '可以试试 ×1.4~1.5，成交不会掉太多。', 20);
      /* 6) 被对手比价 */
      var hits = shop.hit ? U.keys(shop.hit) : [];
      if (hits.length) {
        var worst = hits.sort(function (a, b) { return shop.hit[a] - shop.hit[b]; })[0];
        if (shop.hit[worst] < 0.8) add('warn', '对手卖得比你便宜：' + hits.slice(0, 3).map(function (g) { return C.goodsMap[g].name + ' 少成交 ' + Math.round((1 - shop.hit[g]) * 100) + '%'; }).join('、') + '。', '把这几样降一点价，或开「自动应战」；品牌、口碑、会员高了，顾客就没那么容易被低价拉走。', 45);
      }
      /* 7) 选品：滞销货 / 漏掉的热销货 / 货太便宜 */
      var cold = ks.filter(function (g) { return BT.Eco.demand(S, rid, g) <= 0.75; });
      if (cold.length) add('warn', '这些货在' + rn + '不好卖：' + cold.map(function (g) { return C.goodsMap[g].name; }).join('、') + '。', '下架换成本区热销的货。', 40);
      var hot = C.GOODS.filter(function (g) { return !shop.shelf[g.id] && BT.Eco.demand(S, rid, g.id) >= 1.2; });
      if (hot.length) add('info', rn + '热销但你没卖：' + hot.slice(0, 4).map(function (g) { return g.icon + g.name; }).join('、') + '。', '上架这些，客单价和成交率都会更高。', 30);
      var perItem = A.sold > 0 ? A.gp / A.sold : 0;
      if (A.net < 0 && perItem > 0 && perItem < 1.6) add('warn', '平均每件货只赚 ' + U.money(perItem) + '，卖再多也很难覆盖房租工资。', '加一些单价高的货（服饰、手机配件、茶叶等，看本区口味）。', 65);
    } else add('bad', '货架是空的。', '先上架商品再补货。', 99);
    /* 8) 口碑 / 竞争 */
    if (shop.reputation < 30) add('warn', '口碑只有 ' + Math.round(shop.reputation) + '，客人进店意愿低。', '做一次促销、给员工做服务培训、别断货。', 35);
    if (shop.cf != null && shop.cf < 0.3) add('warn', '竞争很激烈：同区对手吸走了大部分客流（竞争系数 ' + Math.round(shop.cf * 100) + '%）。', '拉品牌（广告）、办会员（回头客不被分流），或者换个对手少的区。', 42);
    items.sort(function (a, b) { return b.w - a.w; });
    return { grade: A.net >= 30 ? 'good' : (A.net >= 0 ? 'thin' : 'loss'), avg: A, items: items };
  };
  Biz.goodsStats = function (S, shop) {
    var days = (shop.gHist || []).filter(function (h) { return S.day - h.day < 7; }), out = {};
    days.forEach(function (h) { U.keys(h.g).forEach(function (gid) {
      var a = h.g[gid], o = out[gid] || (out[gid] = { n7: 0, rev7: 0, cogs7: 0, n1: 0, rev1: 0 });
      o.n7 += a[0]; o.rev7 += a[1]; o.cogs7 += a[2];
      if (shop.last && h.day === shop.last.day) { o.n1 += a[0]; o.rev1 += a[1]; }
    }); });
    return { goods: out, days: days.length };
  };
  /** 下架：门店里剩下的货连同进货成本退回本区仓库（假货标记也一起带回），货架上这一格消失 */
  Biz.unshelf = function (S, shopId, goodsId) {
    var shop = findShop(Biz.ensure(S), shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    if (!shop.shelf[goodsId] && !(shop.inventory[goodsId] > 0)) return { ok: false, msg: '没有上架这件商品' };
    delete shop.shelf[goodsId]; if (shop.lock) delete shop.lock[goodsId];
    var q = shop.inventory[goodsId] || 0;
    if (q > 0) {
      var wh = Biz.warehouse(S, shop.regionId), oldQ = wh.goods[goodsId] || 0, c = (shop.cost && shop.cost[goodsId]) || Eco.buyPrice(S, goodsId, shop.regionId) * 0.9;
      wh.cost = wh.cost || {};
      wh.cost[goodsId] = oldQ > 0 ? (oldQ * (wh.cost[goodsId] || c) + q * c) / (oldQ + q) : c;
      wh.goods[goodsId] = oldQ + q;
      if (shop.fake && shop.fake[goodsId]) { wh.fake = wh.fake || {}; wh.fake[goodsId] = (wh.fake[goodsId] || 0) + shop.fake[goodsId]; delete shop.fake[goodsId]; }
      delete shop.inventory[goodsId]; if (shop.cost) delete shop.cost[goodsId];
    }
    return { ok: true, msg: C.goodsMap[goodsId].name + ' 已下架' + (q > 0 ? '，店里剩下的 ' + q + ' 件退回' + C.regionMap[shop.regionId].name + '仓库' : '') };
  };

  /* ========================================================================
   * 六、银行贷款与信用评级
   *    信用分 300-850：按时还款上升，逾期/负债过高下降；利率随信用分走低。
   * ===================================================================== */
  Biz.maxLoan = function (S) {
    var biz = Biz.ensure(S);
    var lateSum = U.sum(biz.loans, function (l) { return l.lateCount || 0; });
    var penalty = lateSum * 300; /* 逾期次数越多，可贷额度惩罚越重 */
    var cap = Math.max(0, Math.round(BT.netWorth(S) * 0.8 + biz.creditScore * 10 - penalty));
    return BT.Social ? Math.round(cap * BT.Social.loanCapMul(S)) : cap;
  };
  Biz.loanRate = function (S) {
    var biz = Biz.ensure(S);
    var base = U.clamp(0.00035 - (biz.creditScore - 300) / 550 * 0.00022, 0.00013, 0.00035); /* 日利率 */
    /* 与金融市场联动：新港央行基准利率（外汇页可见）每高出 1 个百分点，贷款日利率 +0.0027% */
    var hgd = S.market && S.market.rates ? S.market.rates.hgd : 0.025;
    return Math.max(0.0001, (base + (hgd - 0.025) / 365) * (BT.Social ? BT.Social.loanMul(S) : 1)); /* 商会：银行家关系好，利率打折 */
  };
  Biz.takeLoan = function (S, amount) {
    var biz = Biz.ensure(S);
    amount = Math.max(100, Math.round(amount));
    var cur = BT.U.sum(biz.loans, function (l) { return l.remaining; });
    if (cur + amount > Biz.maxLoan(S)) return { ok: false, msg: '超过可贷额度（剩余额度 ' + U.money(Biz.maxLoan(S) - cur) + '）' };
    biz.loans.push({ id: BT.uid('loan'), principal: amount, remaining: amount, rate: Biz.loanRate(S), day: S.day, lateCount: 0 });
    S.cash += amount; S.debt += amount;
    BT.Log.add('🏦 获得银行贷款 ' + U.money(amount) + '（日利率 ' + (Biz.loanRate(S) * 100).toFixed(3) + '%）', 'info');
    return { ok: true, msg: '贷款到账' };
  };
  Biz.repayLoan = function (S, loanId, amount) {
    var biz = Biz.ensure(S);
    var loan = biz.loans.filter(function (l) { return l.id === loanId; })[0];
    if (!loan) return { ok: false, msg: '贷款不存在' };
    amount = Math.min(amount, loan.remaining, S.cash);
    if (amount <= 0) return { ok: false, msg: '金额无效' };
    var before = loan.remaining;
    loan.remaining -= amount; S.cash -= amount; S.debt -= amount;
    /* 信用加分：单笔还款至少 ¥500 或剩余本息的 10%，且每天最多加一次（防止反复还 ¥1 刷信用） */
    if ((amount >= 500 || amount >= before * 0.1 - 0.01) && biz.repayDay !== S.day) { biz.repayDay = S.day; biz.creditScore = U.clamp(biz.creditScore + 2, 300, 850); }
    if (loan.remaining <= 0.01) {
      if (loan.lateCount > 0) biz.creditScore = U.clamp(biz.creditScore + 5, 300, 850); /* 补还逾期贷款，小幅修复信用 */
      biz.loans = biz.loans.filter(function (l) { return l.id !== loanId; });
      biz.loansRepaid = (biz.loansRepaid || 0) + 1;
    }
    return { ok: true, msg: '还款成功' };
  };

  /* ========================================================================
   * 七、每日结算：各店销售、员工工资、租金、仓储、贷款利息、竞争与声望、财报
   * ===================================================================== */
  Biz.dailyTick = function (S) {
    if (!S.biz) return;
    var biz = S.biz;
    var w = Eco.weatherInfo(S);
    var dayRevenue = 0, dayCogs = 0, dayRent = 0, dayWage = 0, dayInterest = 0;

    var wd = U.dateOf(S.day).w;
    biz.shops.forEach(function (shop) {
      normShop(shop);
      var region = C.regionMap[shop.regionId], loc = C.locMap[shop.loc] || C.locMap.street;
      /* 1) 员工：今天在岗的人（培训脱产的不算），经理带队加成 */
      var onDuty = shop.strike > 0 ? [] : shop.employees.filter(function (e) { return !e.offDuty; }); /* 罢工期间没人上班 */
      var mgr = onDuty.filter(function (e) { return e.role === 'manager'; }).reduce(function (a, e) { return Math.max(a, e.skill); }, 0);
      var empPower = onDuty.reduce(function (a, e) { var t = C.traitMap[e.trait] || {}; return a + 1 + (e.skill + (t.sales || 0)) * 0.12; }, 0) * (1 + mgr * 0.04);
      var staffMul = onDuty.length ? U.clamp(0.5 + empPower * 0.22, 0.5, 2.2) : 0.35;
      var avgService = onDuty.length ? U.sum(onDuty, function (e) { var t = C.traitMap[e.trait] || {}; return e.service + (t.service || 0); }) / onDuty.length : 0;
      /* 2) 客流：区域人流 × 天气 × 星期几 × 地段 × 事件；再和同区 AI 公司按吸引力分流 */
      var week = (C.WEEK_TRAFFIC[shop.regionId] || [])[wd] || 1;
      var evT = (S.events && S.events.trafficMul && S.events.trafficMul[shop.regionId]) || 1;
      var promo = shop.promoDays > 0 ? 1.3 : 1;
      var repMul = 0.7 + shop.reputation / 200;
      var pull = (1 + biz.brand / 150) * repMul * promo * (BT.Rivals ? BT.Rivals.playerPriceMul(S, shop) : 1);
      var cf = BT.Rivals ? BT.Rivals.compFactor(S, shop.regionId, pull) : 0.6;
      shop.cf = cf;

      /* 顾客模型（以店为单位）：先算出当日到店顾客数，再让每位顾客按“价格吸引力”在上架商品里挑 1 件（30% 再多买 1 件）。
         挑中的商品缺货 → 记为「缺货流失」，会拖累口碑。 */
      var shopSold = 0, shopRev = 0, shopCogs = 0, buyers = 0, lost = 0, customers = 0;
      /* 区域客群：需求倍率决定挑中概率与成交率；价格敏感度决定加价的杀伤力 */
      var sens = C.REGION_PRICE_SENS[shop.regionId] || 1;
      /* 单品比价：同区 AI 门店 / 散户卖得比你便宜 → 顾客看了不买（去对手那买了）。
         开了「自动应战」：有对手打价格战 / 散户甩卖时，跟到它的价格（不低于进价 +2%）；平时按你的货架标价 */
      var effP = {}, effMk = {};
      var stocked = U.keys(shop.shelf).filter(function (gid) { return !C.goodsMap[gid].lux; }).map(function (gid) {
        var markup = shop.shelf[gid], unitCost = Eco.buyPrice(S, gid, shop.regionId), dm = Eco.demand(S, shop.regionId, gid);
        var price = U.round2(unitCost * markup), cost = (shop.cost && shop.cost[gid]) || unitCost * 0.9;
        var ref = (shop.effP && shop.effP[gid]) || price, hit = BT.Rivals ? BT.Rivals.priceHit(S, shop, gid, price, ref) : { mul: 1 };
        if (shop.match && hit.attack && hit.attack < price) {
          var mp = Math.min(price, Math.max(U.round2(cost * 1.02), U.round2(hit.attack - 0.01)));
          if (mp < price) { if (hit.camp && mp <= hit.attack) hit.camp.matched = (hit.camp.matched || 0) + 1; price = mp; hit = BT.Rivals.priceHit(S, shop, gid, price, ref); }
        }
        var mk = price / Math.max(0.01, unitCost);
        effP[gid] = price; effMk[gid] = U.round2(mk);
        var appeal = U.clamp(1.6 - (mk - 1) * sens, 0.25, 1.6);
        return { gid: gid, price: price, cost: cost, appeal: appeal * dm, hit: hit.mul,
          /* v7.3：本区不爱买的货成交率掉得更狠；单价远超本区购买力的货也难卖（别在城中村卖古董） */
          conv: U.clamp(0.15 + 0.85 * Math.pow(dm, 1.6), 0.08, 1) * U.clamp(Math.sqrt((C.REGION_WEALTH[shop.regionId] || 1) * 40 / Math.max(1, price)), 0.25, 1) *
            U.clamp(1.25 - (mk - 1) * sens * 0.8, 0.3, 1) * hit.mul };
      });
      shop.effP = effP; shop.effMk = effMk;
      shop.hit = {}; stocked.forEach(function (x) { if (x.hit < 0.98) shop.hit[x.gid] = U.round2(x.hit); });
      var anyStock = stocked.some(function (x) { return (shop.inventory[x.gid] || 0) > 0; });
      var cann = shop.gbCannibal || 0; shop.gbCannibal = 0; /* 自家团购分走的客人 */
      customers = rng.poisson(region.traffic * C.SHOP_TRAFFIC * w.traffic * week * evT * Eco.trafficMul(S, shop.regionId) * loc.traffic * staffMul * Math.min(1.5, 2.0 * cf));
      customers = Math.max(0, customers - cann + (shop.gbBoost || 0)); shop.gbBoost = 0; /* 团购引流款带来的客人 */
      /* 会员：回头客不受竞争分流影响 */
      if (shop.members > 0) customers += rng.poisson(shop.members * 0.04 * Math.min(1.2, Eco.trafficMul(S, shop.regionId)));
      customers = Math.min(customers, 500);
      if (shop.closedDays > 0) customers = 0; /* 火灾 / 台风等停业 */
      var gday = {}; /* 今天各商品 [件数, 营收, 成本] */
      var inv0 = {}; U.keys(shop.inventory).forEach(function (g) { inv0[g] = shop.inventory[g]; });
      if (stocked.length && anyStock) {
        var totalAppeal = U.sum(stocked, function (x) { return x.appeal; });
        for (var ci = 0; ci < customers; ci++) {
          var bq = rng.next(), qtyWanted = bq < C.BASKET[0] ? 1 : (bq < C.BASKET[0] + C.BASKET[1] ? 2 : 3);
          var roll = rng.next() * totalAppeal, pick = stocked[stocked.length - 1];
          for (var si = 0; si < stocked.length; si++) { roll -= stocked[si].appeal; if (roll <= 0) { pick = stocked[si]; break; } }
          var have = shop.inventory[pick.gid] || 0; if (have <= 0) { lost++; continue; }
          if (!rng.chance(pick.conv)) continue; /* 看了没买（滞销品类 / 嫌贵） */
          var n = Math.min(have, qtyWanted); buyers++;
          shop.inventory[pick.gid] -= n; shopSold += n; shopRev += n * pick.price; shopCogs += n * pick.cost;
          var ga = gday[pick.gid] || (gday[pick.gid] = [0, 0, 0]); ga[0] += n; ga[1] += n * pick.price; ga[2] += n * pick.cost;
        }
      } else lost = customers;
      /* 奢侈品专柜：单独一股奢侈品买家 */
      var lux = BT.Lux ? BT.Lux.sellInShop(S, shop, customers, avgService) : null;
      if (lux) { shopSold += lux.sold; shopRev += lux.rev; shopCogs += lux.cogs; buyers += lux.sold; lost += lux.lost; shop.luxSold = (shop.luxSold || 0) + lux.sold; }
      if (lux && lux.by) U.keys(lux.by).forEach(function (gid) { var b = lux.by[gid]; gday[gid] = [b[0], b[1], b[2]]; });
      if (shop.boutique) dayRent += C.TRADE.boutiqueUpkeep;
      if (shop.members > 0) { shopRev *= 0.99; U.keys(gday).forEach(function (g) { gday[g][1] *= 0.99; }); } /* 会员折扣 */
      U.keys(gday).forEach(function (g) { gday[g][1] = U.round2(gday[g][1]); gday[g][2] = U.round2(gday[g][2]); });
      shop.gHist = shop.gHist || []; shop.gHist.push({ day: S.day, g: gday }); if (shop.gHist.length > 7) shop.gHist.shift();
      /* 近 7 天各商品销量（指数衰减），仪表盘用 */
      shop.sold7 = shop.sold7 || {};
      U.keys(shop.sold7).forEach(function (g) { shop.sold7[g] *= 6 / 7; if (shop.sold7[g] < 0.05) delete shop.sold7[g]; });
      U.keys(inv0).forEach(function (g) { var d = inv0[g] - (shop.inventory[g] || 0); if (d > 0) shop.sold7[g] = (shop.sold7[g] || 0) + d; });
      if (shop.memberProg) shop.members = Math.max(0, (shop.members || 0) * 0.99 + buyers * 0.03 * (shop.reputation / 100));
      shop.profitTotal = (shop.profitTotal || 0) + shopRev - shopCogs; shop.revTotal = (shop.revTotal || 0) + shopRev;
      dayRevenue += shopRev; dayCogs += shopCogs;
      var ownBuilding = !!(S.estate && S.estate[shop.regionId]); /* 物业是自己的 → 不交房租 */
      var rentToday = ownBuilding ? 0 : Math.round(shop.rent * (shop.hike && shop.hike.until >= S.day ? shop.hike.mul : 1)); shop.ownBuilding = ownBuilding; /* 被对手抬租 */
      dayRent += rentToday;
      var wageToday = 0;
      shop.employees.forEach(function (e) { dayWage += e.wage; wageToday += e.wage; });
      shop.last = { day: S.day, customers: customers, buyers: buyers, lost: lost, sold: shopSold, rev: shopRev, cogs: shopCogs, rent: rentToday + (shop.boutique ? C.TRADE.boutiqueUpkeep : 0), wage: wageToday,
        profit: shopRev - shopCogs - rentToday - wageToday - (shop.boutique ? C.TRADE.boutiqueUpkeep : 0), cf: cf, week: week, staff: onDuty.length };
      shop.h7 = shop.h7 || []; shop.h7.push(shop.last); if (shop.h7.length > 7) shop.h7.shift(); /* 诊断用：近 7 天经营明细 */
      shop.trafficHist.push({ day: S.day, c: customers, lost: lost }); if (shop.trafficHist.length > 14) shop.trafficHist.shift();
      shop.profitHist = shop.profitHist || []; shop.profitHist.push(shop.last.profit); if (shop.profitHist.length > 14) shop.profitHist.shift();
      /* 3) 口碑：有成交 + 服务好 → 涨；缺货流失多 / 无货 → 跌 */
      var dRep = shopSold > 0 ? 0.5 + avgService * 0.22 : -1.5;
      if (customers > 0 && lost / customers > 0.3) dRep -= 0.8;
      if (shop.promoDays > 0) { dRep += 0.3; shop.promoDays -= 1; }
      if (shop.strike > 0) { dRep -= 1; if (--shop.strike === 0) BT.Log.add('✊ ' + region.name + '店员工结束罢工，复工了。', 'info'); }
      shop.reputation = U.clamp(shop.reputation + dRep, 0, 100);
      shop.daysOpen += 1;
      shop.value = Math.max(0, shop.value * 0.998 + Math.max(0, shopRev - shopCogs) * 0.1); /* 店铺估值：随自身利润缓慢增长 */
      /* 4) 员工：自然成长、忠诚度（工资 vs 身价）、低忠诚离职 */
      shop.employees = shop.employees.filter(function (e) {
        var t = C.traitMap[e.trait] || {};
        if (e.offDuty) { e.offDuty = 0; }
        else if (rng.chance(0.012 + (t.grow || 0))) { e.skill = Math.min(5, e.skill + 1); BT.Log.add('📈 ' + e.name + ' 在工作中成长，销售 Lv.' + e.skill + '。', 'good'); }
        var ratio = e.wage / Math.max(1, Biz.fairWage(e));
        e.loyalty = e.equity ? 100 : U.clamp(e.loyalty + 0.15 + (t.loyalty || 0) + (ratio - 1) * 3, 0, 100); /* 拿了股权激励的员工忠诚度锁定 */
        if (e.loyalty < 20 && rng.chance(0.05)) {
          BT.Log.add('🚪 ' + e.name + '（' + roleOf(e.role).name + '）嫌工资低，辞职走人了。', 'bad');
          return false;
        }
        return true;
      });
      /* 5) 罢工：3 人以上的店，平均忠诚度长期过低，可能集体罢工 2~4 天（可以加薪平息） */
      if (!shop.strike && shop.employees.length >= 3) {
        var avgLoy = U.sum(shop.employees, function (e) { return e.loyalty; }) / shop.employees.length;
        if (avgLoy < 35 && rng.chance(0.05)) {
          shop.strike = rng.int(2, 4);
          BT.Log.add('✊ ' + region.name + '店员工嫌工资低，集体罢工 ' + shop.strike + ' 天！可以在门店页「加薪平息」。', 'bad');
          BT.Bus.emit('fx', { kind: 'alert', text: '✊ ' + region.name + '店罢工了' });
        }
      }
    });

    /* 贷款利息（复利按日计） */
    biz.loans.forEach(function (l) {
      var interest = l.remaining * l.rate;
      dayInterest += interest; l.remaining += interest;
    });
    /* 利息只计入贷款余额与负债（复利），不再重复从现金扣除，否则等于被双重计息 */
    if (dayInterest > 0) { S.debt += dayInterest; S.stats.totalSpent += dayInterest; }
    if (dayRent > 0) Eco.pay(S, dayRent, '各店租金');
    if (dayWage > 0) Eco.pay(S, dayWage, '员工工资');
    if (dayRevenue > 0) Eco.earn(S, dayRevenue, '各店营收');

    /* 信用分动态调整：负债占净资产比例过高、或现金严重见底时扣分，并累计逾期次数 */
    var totalDebt = U.sum(biz.loans, function (l) { return l.remaining; });
    if (totalDebt > 0) {
      var ratio = totalDebt / Math.max(1, BT.netWorth(S));
      if (ratio > 0.9) biz.creditScore = U.clamp(biz.creditScore - 1, 300, 850);
      if (S.cash < -300) {
        biz.loans.forEach(function (l) { l.lateCount = (l.lateCount || 0) + 1; });
        biz.creditScore = U.clamp(biz.creditScore - 3, 300, 850);
        BT.Log.add('⚠️ 现金严重不足，贷款出现逾期，信用评级下降。', 'bad');
      }
    }

    var profit = dayRevenue - dayCogs - dayRent - dayWage - dayInterest;
    biz.brand = U.clamp(biz.brand + (profit > 0 ? 0.3 : -0.2), 0, 100);
    Biz.refreshCandidates(S, false);

    biz.ledger.push({ day: S.day, revenue: dayRevenue, cogs: dayCogs, rent: dayRent, wage: dayWage,
      interest: dayInterest, profit: profit });
    if (biz.ledger.length > 90) biz.ledger.shift();
    if (S.day % 30 === 0) snapshotMonthly(S, biz);

    if (biz.shops.length) {
      BT.Log.add('📊 公司日结：营收 ' + U.money(dayRevenue) + '，净利 ' + U.money(profit) +
        '，品牌 ' + biz.brand.toFixed(1) + '，信用 ' + biz.creditScore + '。', profit >= 0 ? 'good' : 'bad');
    }
  };

  function snapshotMonthly(S, biz) {
    var last30 = biz.ledger.slice(-30);
    var sum = function (f) { return U.sum(last30, f); };
    biz.monthly.push({
      day: S.day, revenue: sum(function (x) { return x.revenue; }), cogs: sum(function (x) { return x.cogs; }),
      rent: sum(function (x) { return x.rent; }), wage: sum(function (x) { return x.wage; }),
      interest: sum(function (x) { return x.interest; }), profit: sum(function (x) { return x.profit; }),
      shops: biz.shops.length, employees: U.sum(biz.shops, function (s) { return s.employees.length; })
    });
    if (biz.monthly.length > 24) biz.monthly.shift();
    var mp = biz.monthly[biz.monthly.length - 1].profit, late = biz.loans.some(function (l) { return (l.lateCount || 0) > 0; });
    /* 经营记录良好：本月盈利且没有逾期 → 信用 +6（不借贷也能慢慢积累信用，满足上市等条件） */
    if (mp > 0 && !late) biz.creditScore = U.clamp(biz.creditScore + 6, 300, 850);
    BT.Log.add('🗓️ 月度财报已生成（第 ' + S.day + ' 天），净利 ' + U.money(mp) + (mp > 0 && !late ? '，经营良好，信用 +6（' + biz.creditScore + '）' : ''), 'sys');
  }

  /* ========================================================================
   * 八、净资产贡献（供 state.js 的 netWorth 调用）
   * ===================================================================== */
  Biz.netWorth = function (S) {
    if (!S.biz) return 0;
    var v = 0;
    S.biz.shops.forEach(function (s) {
      v += s.value || 0;
      U.keys(s.inventory).forEach(function (gid) {
        var g = C.goodsMap[gid]; v += (s.inventory[gid] || 0) * Eco.buyPrice(S, gid, s.regionId) * 0.7;
      });
    });
    if (BT.B2B) v += BT.B2B.netWorth(S);       /* 应收账款 */
    if (BT.Tea) v += BT.Tea.netWorth(S);       /* 奶茶店 */
    if (BT.GroupBuy) v -= BT.GroupBuy.liability(S); /* 团购预收款是负债 */
    U.keys(S.biz.warehouses).forEach(function (rid) {
      var wh = S.biz.warehouses[rid];
      U.keys(wh.goods).forEach(function (gid) { v += (wh.goods[gid] || 0) * Eco.buyPrice(S, gid, rid) * 0.7; });
    });
    return v;
  };
})();
