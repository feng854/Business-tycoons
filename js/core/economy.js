/* ==========================================================================
 * 文件：js/core/economy.js
 * 作用：商品价格引擎、时间推进（小时/天）、体力健康精力结算、天气轮换
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Eco = BT.Eco = {};

  /* ========================================================================
   * 一、价格引擎
   *    每件商品维护一个“当日基准价”，由 随机游走(drift) + 区域系数 + 事件系数 构成。
   *    priceState: goodsId -> { base, trendDay } 存在 S.prices 里（惰性生成，按天缓存）
   * ===================================================================== */
  function ensurePriceDay(S) {
    S.prices = S.prices || {};
    if (S.pricesDay === S.day) return;
    S.pricesDay = S.day;
    C.GOODS.forEach(function (g) {
      var prev = S.prices[g.id] ? S.prices[g.id].v : g.base;
      /* 均值回归的随机游走：价格会围绕 base 波动，但不会无限漂移 */
      var revert = (g.base - prev) * 0.08;
      var noise = g.base * g.vol * (rng.next() * 2 - 1);
      var next = Math.max(g.base * 0.4, prev + revert + noise);
      S.prices[g.id] = { v: U.round2(next) };
    });
  }
  Eco.ensurePriceDay = ensurePriceDay;

  /** 某商品在某区域、考虑事件系数与谈判技能后的「进货价」 */
  Eco.buyPrice = function (S, goodsId, regionId) {
    ensurePriceDay(S);
    var g = C.goodsMap[goodsId];
    var base = (S.prices[goodsId] || { v: g.base }).v;
    var regionMul = C.REGION_PRICE_MUL[regionId] || 1;
    var favoredMul = (g.favored.indexOf(regionId) >= 0) ? 0.85 : 1;
    var eventMul = (S.events && S.events.priceMul && S.events.priceMul[goodsId]) || 1;
    var negoLv = (S.skills && S.skills.nego) || 0;
    var negoMul = 1 - negoLv * 0.025;
    return Math.max(0.5, U.round2(base * regionMul * favoredMul * eventMul * negoMul));
  };
  /** 零售价（卖给顾客/区域），比进货价略高一个基础毛利系数 */
  Eco.sellPrice = function (S, goodsId, regionId) {
    var buy = Eco.buyPrice(S, goodsId, regionId);
    var g = C.goodsMap[goodsId];
    var margin = 1.28 + (g.vol); /* 波动越大的商品，潜在利润空间也越大 */
    var eventMul = (S.events && S.events.demandMul && S.events.demandMul[goodsId]) || 1;
    return U.round2(buy * margin * eventMul);
  };

  /* ========================================================================
   * 二、天气
   * ===================================================================== */
  Eco.rollWeather = function (S) {
    S.weather = rng.weighted(C.WEATHERS, function (w) { return w.w; }).id;
  };
  Eco.weatherInfo = function (S) {
    var id = S.weather || 'sunny';
    for (var i = 0; i < C.WEATHERS.length; i++) if (C.WEATHERS[i].id === id) return C.WEATHERS[i];
    return C.WEATHERS[0];
  };

  /* ========================================================================
   * 三、状态消耗与恢复
   * ===================================================================== */
  Eco.spend = function (S, cost) {
    cost = cost || {};
    if (cost.stamina) S.stamina = U.clamp(S.stamina - cost.stamina, 0, S.staminaMax);
    if (cost.energy) S.energy = U.clamp(S.energy - cost.energy, 0, S.energyMax);
    if (cost.health) S.health = U.clamp(S.health - cost.health, 0, 100);
    if (cost.hours) Eco.advanceHour(S, cost.hours);
  };

  /** 体力/精力过低时的工作效率惩罚（0.4~1.0） */
  Eco.fatiguePenalty = function (S) {
    var s = S.stamina / S.staminaMax, e = S.energy / S.energyMax;
    var worst = Math.min(s, e);
    if (worst > 0.35) return 1;
    return U.clamp(0.4 + worst * 1.7, 0.4, 1);
  };

  /* ========================================================================
   * 四、时间推进
   *    小时制：每次行动消耗若干小时；超过 24 点自动进入「睡觉结算」。
   * ===================================================================== */
  Eco.advanceHour = function (S, hours) {
    S.hour += hours;
    BT.Bus.emit('hour', S.hour);
    if (S.hour >= C.DAY_END_H) {
      Eco.sleep(S);
    }
  };

  /** 立即睡觉（玩家主动选择，或超时自动触发） */
  Eco.sleep = function (S) {
    var overtime = Math.max(0, S.hour - C.DAY_END_H);
    S.hour = C.DAY_END_H;

    /* 当日收支结算：用于判断“连续盈利”的里程碑条件 */
    var todayProfit = (S.todayIncome || 0) - (S.todayExpense || 0);
    if (todayProfit > 0 && (S.stall || S.shop)) S.bizProfitStreak = (S.bizProfitStreak || 0) + 1;
    else if (S.stall || S.shop) S.bizProfitStreak = 0;

    /* 固定开销：房租 + 伙食（由当前区域房租决定） */
    var region = C.regionMap[S.region] || C.regionMap.slum;
    var rent = region.rent, food = 10 + rng.int(0, 4);
    var dailyCost = rent + food;
    S.cash -= dailyCost; S.stats.totalSpent += dailyCost;
    BT.Log.add('🌙 夜间结算：房租 ' + U.money(rent) + '，伙食 ' + U.money(food) + '。', 'info');

    /* 破产救济：现金严重为负且尚未领取过时，发放一次性社会救济金，避免玩家被卡死
       （对应设计文档「失败成本可承受」原则），救济金计入负债，仍需后续靠打工偿还 */
    if (S.cash < -80 && !S.gotRelief) {
      var relief = 150;
      S.cash += relief; S.debt += relief; S.gotRelief = true;
      BT.Log.add('🆘 现金见底，社区救济金 ' + U.money(relief) + ' 已到账（计入负债），振作起来继续打工吧！', 'event');
    }

    /* 睡眠恢复（熬夜惩罚：overtime 每多1小时，体力/精力上限恢复打折） */
    var penalty = overtime > 0 ? Math.max(0.3, 1 - overtime * C.LATE_SLEEP_PENALTY * 0.25) : 1;
    S.stamina = U.clamp(S.stamina + C.SLEEP_RECOVER.stamina * penalty, 0, S.staminaMax);
    S.energy = U.clamp(S.energy + C.SLEEP_RECOVER.energy * penalty, 0, S.energyMax);
    S.health = U.clamp(S.health + (penalty < 1 ? -3 : C.SLEEP_RECOVER.health), 0, 100);
    if (S.health <= 0) { S.stamina = Math.min(S.stamina, 40); BT.Log.add('⚠️ 健康过低，今天状态很差。', 'bad'); }

    /* 商品过期结算 */
    spoilBag(S);

    /* 新的一天 */
    S.day += 1; S.hour = C.DAY_START_H;
    S.jobsDoneToday = {};
    S.todayIncome = 0; S.todayExpense = 0;
    S.stats.daysPlayed += 1;
    Eco.rollWeather(S);
    ensurePriceDay(S);
    if (BT.Events && BT.Events.rollDaily) BT.Events.rollDaily(S);
    if (BT.Shop && BT.Shop.dailyTick) BT.Shop.dailyTick(S);
    if (BT.Quests && BT.Quests.dailyCheck) BT.Quests.dailyCheck(S);
    if (BT.Biz && BT.Biz.dailyTick) BT.Biz.dailyTick(S);
    if (BT.Market && BT.Market.dailyTick) BT.Market.dailyTick(S);
    if (BT.Empire && BT.Empire.dailyTick) BT.Empire.dailyTick(S);
    BT.checkMilestones(S);
    BT.save();
    BT.Bus.emit('dayStart', S.day);
    BT.Log.add('☀️ 第 ' + S.day + ' 天（' + U.dateOf(S.day).str + ' ' + U.dateOf(S.day).wd + '），天气：' +
      Eco.weatherInfo(S).icon + Eco.weatherInfo(S).name, 'sys');
  };

  function spoilBag(S) {
    U.keys(S.bag).forEach(function (gid) {
      var g = C.goodsMap[gid]; if (!g || !g.spoil) return;
      var lots = S.bag[gid] || [];
      var lost = 0;
      lots.forEach(function (lot) {
        var d = Math.ceil(lot.qty * g.spoil);
        d = Math.min(d, lot.qty);
        lot.qty -= d; lost += d;
      });
      S.bag[gid] = lots.filter(function (l) { return l.qty > 0; });
      if (lost > 0) BT.Log.add('🥀 ' + g.icon + g.name + ' 过期损耗 ' + lost + ' 件。', 'bad');
    });
  }

  /* ========================================================================
   * 五、记账辅助（供各模块调用，统一走这里以便净资产/里程碑一致）
   * ===================================================================== */
  Eco.earn = function (S, amount, reason) {
    S.cash += amount; S.stats.totalEarned += amount; S.todayIncome = (S.todayIncome || 0) + amount;
    if (BT.Quests && BT.Quests.earnTrack) BT.Quests.earnTrack(S, amount);
    if (reason) BT.Log.add('💰 ' + reason + ' +' + U.money(amount), 'good');
  };
  Eco.pay = function (S, amount, reason) {
    S.cash -= amount; S.stats.totalSpent += amount; S.todayExpense = (S.todayExpense || 0) + amount;
    if (reason) BT.Log.add('💸 ' + reason + ' -' + U.money(amount), 'bad');
  };
})();
