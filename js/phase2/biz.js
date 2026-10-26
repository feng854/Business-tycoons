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

  var NAMES = ['小林', '阿强', '美玲', '建国', '晓雯', '老王', '小芳', '志伟', '雅婷', '大勇'];

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
      competitors: buildCompetitors()
    };
    /* 迁移第一阶段的店铺与库存 */
    if (S.shop) {
      biz.shops.push(migrateShop(S.shop));
      S.shop = null;
    }
    S.biz = biz;
    BT.Log.add('🏢 公司成立！可以开设更多店铺、招聘员工、申请贷款了。', 'sys');
    return biz;
  };

  function migrateShop(shop) {
    return {
      id: BT.uid('shop'), regionId: shop.regionId, shelf: shop.shelf || {},
      reputation: shop.reputation || 30, employees: shop.employee ? [{
        id: BT.uid('emp'), name: rng.pick(NAMES), role: 'clerk', wage: shop.employee.wage, skill: shop.employee.skill
      }] : [], rent: shop.rent, value: shop.value || 0, daysOpen: shop.daysOpen || 0,
      inventory: {} /* 门店自身库存，由仓库调货补充 */
    };
  }

  function buildCompetitors() {
    /* 简化的竞争对手：每个区域一个 NPC 品牌，瓜分区域客流 */
    var m = {};
    C.REGIONS.forEach(function (r) { m[r.id] = { strength: rng.range(0.3, 0.8) }; });
    return m;
  }

  /* ========================================================================
   * 二、开设新店铺（押金 + 装修费）
   * ===================================================================== */
  Biz.openShop = function (S, regionId) {
    var biz = Biz.ensure(S);
    var region = C.regionMap[regionId]; if (!region) return { ok: false, msg: '区域不存在' };
    if (S.unlockedRegions.indexOf(regionId) < 0) return { ok: false, msg: '该区域尚未解锁' };
    var exists = biz.shops.some(function (s) { return s.regionId === regionId; });
    if (exists) return { ok: false, msg: '该区域已有店铺' };
    var cost = region.rent * 45;
    if (S.cash < cost) return { ok: false, msg: '资金不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '新店押金与装修（' + region.name + '）');
    biz.shops.push({ id: BT.uid('shop'), regionId: regionId, shelf: {}, reputation: 20, employees: [],
      rent: region.rent * 3, value: cost, daysOpen: 0, inventory: {} });
    return { ok: true, msg: '在' + region.name + '新开一间店铺！' };
  };

  Biz.closeShop = function (S, shopId) {
    var biz = Biz.ensure(S);
    biz.shops = biz.shops.filter(function (s) { return s.id !== shopId; });
    return { ok: true, msg: '已关闭该店铺' };
  };

  /* ========================================================================
   * 三、员工：招聘 / 培训 / 解雇
   * ===================================================================== */
  Biz.hire = function (S, shopId, roleId) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    var cap = EMP_SLOT_BASE + Math.floor((shop.value || 0) / 2000);
    if (shop.employees.length >= cap) return { ok: false, msg: '该店员工已满（上限 ' + cap + '）' };
    var role = EMP_ROLES.filter(function (r) { return r.id === roleId; })[0] || EMP_ROLES[0];
    var hireFee = role.wageBase * 2;
    if (S.cash < hireFee) return { ok: false, msg: '招聘费不够（需要 ' + U.money(hireFee) + '）' };
    Eco.pay(S, hireFee, '招聘' + role.name);
    shop.employees.push({ id: BT.uid('emp'), name: rng.pick(NAMES), role: role.id, wage: role.wageBase, skill: 1 });
    return { ok: true, msg: '招聘了一名' + role.name };
  };
  Biz.fire = function (S, shopId, empId) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    shop.employees = shop.employees.filter(function (e) { return e.id !== empId; });
    return { ok: true, msg: '已解雇' };
  };
  Biz.train = function (S, shopId, empId) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    var emp = shop.employees.filter(function (e) { return e.id === empId; })[0];
    if (!emp) return { ok: false, msg: '员工不存在' };
    if (emp.skill >= 5) return { ok: false, msg: '已经满级了' };
    var cost = emp.skill * 150 + 100;
    if (S.cash < cost) return { ok: false, msg: '培训费不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '培训' + emp.name);
    emp.skill += 1;
    return { ok: true, msg: emp.name + ' 技能提升到 Lv.' + emp.skill };
  };
  function findShop(biz, id) { return biz.shops.filter(function (s) { return s.id === id; })[0]; }
  Biz.findShop = findShop;

  /* ========================================================================
   * 四、供应商批发：按件数阶梯折扣，直接送入指定区域仓库
   * ===================================================================== */
  Biz.wholesaleBuy = function (S, regionId, goodsId, qty) {
    var biz = Biz.ensure(S);
    var g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '商品不存在' };
    qty = Math.max(10, Math.floor(qty));
    var wh = Biz.warehouse(S, regionId);
    if (wh.used + qty * g.unit > wh.cap) return { ok: false, msg: '仓库容量不够' };
    var unit = Eco.buyPrice(S, goodsId, regionId);
    var discount = qty >= 200 ? 0.78 : (qty >= 100 ? 0.85 : (qty >= 50 ? 0.92 : 1));
    var total = U.round2(unit * discount * qty);
    if (S.cash < total) return { ok: false, msg: '资金不够（需要 ' + U.money(total) + '）' };
    Eco.pay(S, total, '批发采购 ' + g.name + ' x' + qty);
    wh.goods[goodsId] = (wh.goods[goodsId] || 0) + qty;
    return { ok: true, msg: '批发入库 ' + g.name + ' x' + qty + '，折扣 ' + Math.round((1 - discount) * 100) + '%' };
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
    shop.inventory[goodsId] = (shop.inventory[goodsId] || 0) + qty;
    return { ok: true, msg: '调货 ' + qty + ' 件到门店' };
  };

  /* ========================================================================
   * 五、货架定价（门店自有库存，与第一阶段 shelf 逻辑一致但数据源是 inventory）
   * ===================================================================== */
  Biz.setShelf = function (S, shopId, goodsId, markup) {
    var biz = Biz.ensure(S);
    var shop = findShop(biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    shop.shelf[goodsId] = U.clamp(markup || 1.3, 0.8, 2.5);
    return { ok: true };
  };

  /* ========================================================================
   * 六、银行贷款与信用评级
   *    信用分 300-850：按时还款上升，逾期/负债过高下降；利率随信用分走低。
   * ===================================================================== */
  Biz.maxLoan = function (S) {
    var biz = Biz.ensure(S);
    return Math.round(BT.netWorth(S) * 0.8 + biz.creditScore * 10);
  };
  Biz.loanRate = function (S) {
    var biz = Biz.ensure(S);
    return U.clamp(0.00035 - (biz.creditScore - 300) / 550 * 0.00022, 0.00013, 0.00035); /* 日利率 */
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
    loan.remaining -= amount; S.cash -= amount; S.debt -= amount;
    biz.creditScore = U.clamp(biz.creditScore + 2, 300, 850);
    if (loan.remaining <= 0.01) biz.loans = biz.loans.filter(function (l) { return l.id !== loanId; });
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

    biz.shops.forEach(function (shop) {
      var region = C.regionMap[shop.regionId];
      var comp = biz.competitors[shop.regionId] || { strength: 0.5 };
      var empPower = shop.employees.reduce(function (a, e) { return a + 1 + e.skill * 0.12; }, 0);
      var staffMul = shop.employees.length ? U.clamp(0.5 + empPower * 0.22, 0.5, 2.2) : 0.35;
      var brandMul = 1 + biz.brand / 150;
      var shareMul = U.clamp(1 - comp.strength * 0.4, 0.35, 1);

      var items = U.keys(shop.shelf);
      var shopSold = 0;
      items.forEach(function (gid) {
        var have = shop.inventory[gid] || 0; if (have <= 0) return;
        var g = C.goodsMap[gid];
        var markup = shop.shelf[gid];
        var unitCost = Eco.buyPrice(S, gid, shop.regionId);
        var price = U.round2(unitCost * markup);
        var appeal = U.clamp(1.6 - (markup - 1), 0.25, 1.6);
        var expected = region.traffic * 90 * w.traffic * appeal * staffMul * brandMul * shareMul;
        var sold = Math.min(have, rng.poisson(expected));
        if (sold <= 0) return;
        shop.inventory[gid] -= sold; shopSold += sold;
        dayRevenue += sold * price; dayCogs += sold * unitCost;
      });
      dayRent += shop.rent;
      shop.employees.forEach(function (e) { dayWage += e.wage; if (rng.chance(0.015)) e.skill = Math.min(5, e.skill + 1); });
      shop.reputation = U.clamp(shop.reputation + (shopSold > 0 ? 1.2 : -1.5), 0, 100);
      shop.daysOpen += 1;
      shop.value = Math.max(shop.value * 0.998, shop.value * 0.998 + (dayRevenue - dayCogs) * 0.1);
    });

    /* 贷款利息（复利按日计） */
    biz.loans.forEach(function (l) {
      var interest = l.remaining * l.rate;
      dayInterest += interest; l.remaining += interest;
    });
    if (dayInterest > 0) { S.cash -= dayInterest; S.debt += dayInterest; S.stats.totalSpent += dayInterest; }
    if (dayRent > 0) Eco.pay(S, dayRent, '各店租金');
    if (dayWage > 0) Eco.pay(S, dayWage, '员工工资');
    if (dayRevenue > 0) Eco.earn(S, dayRevenue, '各店营收');

    var profit = dayRevenue - dayCogs - dayRent - dayWage - dayInterest;
    biz.brand = U.clamp(biz.brand + (profit > 0 ? 0.3 : -0.2), 0, 100);
    /* 竞争对手自身也会消长，制造此消彼长的区域竞争感 */
    U.keys(biz.competitors).forEach(function (rid) {
      biz.competitors[rid].strength = U.clamp(biz.competitors[rid].strength + rng.range(-0.03, 0.03), 0.15, 0.9);
    });

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
    BT.Log.add('🗓️ 月度财报已生成（第 ' + S.day + ' 天），净利 ' + U.money(biz.monthly[biz.monthly.length - 1].profit), 'sys');
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
    U.keys(S.biz.warehouses).forEach(function (rid) {
      var wh = S.biz.warehouses[rid];
      U.keys(wh.goods).forEach(function (gid) { v += (wh.goods[gid] || 0) * Eco.buyPrice(S, gid, rid) * 0.7; });
    });
    return v;
  };
})();
