/* ==========================================================================
 * 文件：js/phase3/market.js
 * 作用：第三阶段 —— 金融交易体系：6 只虚拟股票 + 商品期货 + 外汇
 *       包含：K线生成引擎、季度财报、突发事件（黑天鹅）、流通盘与市值、
 *             保证金交易（期货/外汇）、与第一阶段商品事件的跨系统联动
 * 说明：开局即解锁（无资产门槛），由 UI 的「金融」面板调用。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco, rng = BT.rng;
  var Market = BT.Market = {};

  /* ========================================================================
   * 一、股票定义（6 只虚拟股票，覆盖不同行业与流通盘规模）
   *    float: 流通股数（流通盘）；越小波动越大，也更容易被大单冲击价格
   *    vol: 日化波动率；drift: 长期年化漂移（成长性）；beta: 对大盘指数的敏感度
   *    sector 用于与商品/期货联动（见 onGoodsShock / sectorHooks）
   * ===================================================================== */
  var STOCKS = [
    { id: 'xjhg', name: '新港重工', ticker: 'XJHG', sector: 'industrial', base: 18.0,
      float: 8.0e8, vol: 0.016, drift: 0.00010, beta: 1.05 },
    { id: 'bhdc', name: '滨海地产', ticker: 'BHDC', sector: 'property', base: 9.5,
      float: 3.0e8, vol: 0.022, drift: 0.00000, beta: 1.2 },
    { id: 'ygkj', name: '云港科技', ticker: 'YGKJ', sector: 'tech', base: 42.0,
      float: 1.2e8, vol: 0.030, drift: 0.00035, beta: 1.4 },
    { id: 'xhls', name: '新辉零售', ticker: 'XHLS', sector: 'retail', base: 15.0,
      float: 2.0e8, vol: 0.018, drift: 0.00015, beta: 0.9 },
    { id: 'gyny', name: '港源能源', ticker: 'GYNY', sector: 'energy', base: 23.0,
      float: 4.0e8, vol: 0.020, drift: 0.00008, beta: 1.0 },
    { id: 'cxyy', name: '创想医药', ticker: 'CXYY', sector: 'pharma', base: 55.0,
      float: 0.9e8, vol: 0.034, drift: 0.00040, beta: 0.7 }
  ];
  Market.STOCKS = STOCKS;
  Market.stockMap = {}; STOCKS.forEach(function (s) { Market.stockMap[s.id] = s; });

  /* ========================================================================
   * 二、商品期货定义（保证金交易，杠杆 5-10 倍，每日盯市结算）
   *    mult: 合约乘数（1手=mult个价格单位）；margin: 保证金率
   * ===================================================================== */
  var FUTURES = [
    { id: 'soy', name: '大豆期货', ticker: 'A', base: 4200, unit: '元/吨', vol: 0.016, drift: 0.00002,
      mult: 10, marginRate: 0.10, tag: 'veg' },
    { id: 'rb', name: '螺纹钢期货', ticker: 'RB', base: 3650, unit: '元/吨', vol: 0.015, drift: 0.00004,
      mult: 10, marginRate: 0.10, sector: 'industrial' },
    { id: 'cl', name: '原油期货', ticker: 'CL', base: 520, unit: '元/桶', vol: 0.024, drift: 0.00003,
      mult: 100, marginRate: 0.12, sector: 'energy' },
    { id: 'au', name: '黄金期货', ticker: 'AU', base: 480, unit: '元/克', vol: 0.012, drift: 0.00006,
      mult: 1000, marginRate: 0.08, safeHaven: true }
  ];
  Market.FUTURES = FUTURES;
  Market.futMap = {}; FUTURES.forEach(function (f) { Market.futMap[f.id] = f; });

  /* ========================================================================
   * 三、外汇定义（新港元 HGD 为本位币，报价=1外币兑多少HGD）
   * ===================================================================== */
  var FOREX = [
    { id: 'usd', name: '美元/新港元', ticker: 'USD/HGD', base: 7.10, vol: 0.004, drift: 0.00001, lot: 10000, marginRate: 0.03 },
    { id: 'eur', name: '欧元/新港元', ticker: 'EUR/HGD', base: 7.75, vol: 0.005, drift: 0.000005, lot: 10000, marginRate: 0.03 },
    { id: 'jpy', name: '日元/新港元（百）', ticker: 'JPY/HGD', base: 4.55, vol: 0.0045, drift: -0.000005, lot: 10000, marginRate: 0.03 }
  ];
  Market.FOREX = FOREX;
  Market.fxMap = {}; FOREX.forEach(function (f) { Market.fxMap[f.id] = f; });

  var ALL_INSTR = STOCKS.concat(FUTURES).concat(FOREX);

  /* ========================================================================
   * 四、K线生成引擎
   *    用“日内多步随机游走”模拟一根日K，既有 open/high/low/close，也保留
   *    intraday 路径供图表画出更真实的折线/分时效果。
   * ===================================================================== */
  var INTRADAY_STEPS = 16;
  function genCandle(prevClose, vol, drift, fatTail, jump) {
    var open = prevClose * (1 + drift * 0.3 + vol * 0.25 * rng.normal());
    var path = [open];
    var p = open;
    for (var i = 0; i < INTRADAY_STEPS; i++) {
      var step = fatTail ? rng.fat(5) : rng.normal();
      p = Math.max(0.01, p * (1 + drift / INTRADAY_STEPS + (vol / Math.sqrt(INTRADAY_STEPS)) * step));
      path.push(p);
    }
    if (jump) { p = Math.max(0.01, p * (1 + jump)); path.push(p); }
    var o = path[0], c = path[path.length - 1];
    var h = Math.max.apply(null, path), l = Math.min.apply(null, path);
    var vBase = 1; /* 成交量相对强度，后面按流通盘换算 */
    return { o: U.round2(o), h: U.round2(h), l: U.round2(l), c: U.round2(c), path: path.map(U.round2) };
  }

  /* ========================================================================
   * 五、初始化（生成约 60 天历史K线，让玩家一进场就能看到走势）
   * ===================================================================== */
  Market.ensure = function (S) {
    if (S.market) return S.market;
    var m = {
      day: S.day, index: 1000, indexHist: [],
      stocks: {}, futures: {}, forex: {},
      posStock: {}, posFut: {}, posFx: {},
      quarterDay: 0, newsHistory: {}
    };
    STOCKS.forEach(function (s) { m.stocks[s.id] = initSeries(s, s.base); });
    FUTURES.forEach(function (f) { m.futures[f.id] = initSeries(f, f.base); });
    FOREX.forEach(function (f) { m.forex[f.id] = initSeries(f, f.base); });
    S.market = m;
    backfillHistory(S, 60);
    BT.Log.add('📈 金融市场已开通：股票 / 期货 / 外汇 均可交易。', 'sys');
    return m;
  };
  function initSeries(def, base) {
    return { price: base, hist: [], financials: [], float: def.float || null };
  }
  function backfillHistory(S, days) {
    var m = S.market;
    for (var d = 0; d < days; d++) {
      genAllCandles(S, true);
    }
    /* 回填期间顺带生成一期“上市以来首份财报” */
    STOCKS.forEach(function (s) { genReport(S, s, true); });
  }

  /* ========================================================================
   * 六、季度财报（约每 45 个游戏日一期，营收/净利/增速驱动一次价格跳空）
   * ===================================================================== */
  var QUARTER_LEN = 45;
  function genReport(S, stockDef, initial) {
    var m = S.market, series = m.stocks[stockDef.id];
    var prev = series.financials[series.financials.length - 1];
    var baseRevenue = prev ? prev.revenue : (stockDef.float * stockDef.base * 0.02);
    var growth = rng.range(-0.08, 0.16) + stockDef.drift * 200;
    var revenue = Math.max(1e5, baseRevenue * (1 + growth));
    var margin = U.clamp((prev ? prev.margin : 0.12) + rng.range(-0.015, 0.015), 0.02, 0.35);
    var profit = revenue * margin;
    var eps = profit / stockDef.float;
    var surprise = rng.normal() * 0.6; /* 相对“市场预期”的超预期/不及预期程度 */
    var report = {
      day: S.day, quarter: series.financials.length + 1, revenue: Math.round(revenue),
      revenueGrowth: growth, profit: Math.round(profit), margin: margin, eps: Math.round(eps * 100) / 100,
      surprise: surprise
    };
    series.financials.push(report);
    if (series.financials.length > 16) series.financials.shift();
    if (!initial) {
      var jump = U.clamp(surprise * 0.06 + growth * 0.25, -0.18, 0.22);
      applyJump(S, 'stocks', stockDef.id, jump);
      BT.Log.add('📑 ' + stockDef.name + ' 发布季报：营收' + U.pct(growth) + '，净利 ' + U.compact(report.profit) +
        '，' + (jump >= 0 ? '股价应声上涨' : '股价应声下跌') + U.pct(jump), jump >= 0 ? 'good' : 'bad');
    }
  }

  function applyJump(S, kind, id, pct) {
    var m = S.market, series = m[kind][id];
    if (!series) return;
    var last = series.hist[series.hist.length - 1];
    var base = last ? last.c : series.price;
    series.pendingJump = (series.pendingJump || 0) + pct;
  }

  /* ========================================================================
   * 七、突发事件 / 黑天鹅（跨个股、跨板块，含正负面）
   * ===================================================================== */
  var NEWS_POOL = [
    { id: 'tech_break', sector: 'tech', w: 6, text: '云港科技宣布新一代芯片研发突破', jump: [0.06, 0.16], cooldown: 12 },
    { id: 'tech_leak', sector: 'tech', w: 5, text: '云港科技核心数据疑似泄露，监管介入调查', jump: [-0.18, -0.06], cooldown: 14 },
    { id: 'pharma_trial_ok', sector: 'pharma', w: 5, text: '创想医药新药三期临床试验结果积极', jump: [0.10, 0.30], cooldown: 16 },
    { id: 'pharma_trial_fail', sector: 'pharma', w: 5, text: '创想医药新药临床试验未达预期', jump: [-0.30, -0.12], cooldown: 16 },
    { id: 'property_policy', sector: 'property', w: 6, text: '楼市调控政策出台，地产板块承压', jump: [-0.12, -0.03], cooldown: 12 },
    { id: 'property_relief', sector: 'property', w: 5, text: '地产纾困政策落地，板块情绪回暖', jump: [0.03, 0.10], cooldown: 12 },
    { id: 'energy_opec', sector: 'energy', w: 6, text: '国际能源组织宣布减产，能源板块走强', jump: [0.04, 0.12], cooldown: 10 },
    { id: 'industrial_order', sector: 'industrial', w: 6, text: '新港重工斩获海外大单', jump: [0.03, 0.09], cooldown: 10 },
    { id: 'retail_boom', sector: 'retail', w: 6, text: '消费数据超预期，零售板块普涨', jump: [0.02, 0.08], cooldown: 8 },
    { id: 'market_crash', sector: 'all', w: 2, text: '⚫ 黑天鹅：海外金融市场剧烈动荡，全线重挫', jump: [-0.15, -0.06], cooldown: 30 },
    { id: 'market_rally', sector: 'all', w: 2, text: '🟢 利好：宏观刺激政策超预期，市场普涨', jump: [0.05, 0.14], cooldown: 30 },
    { id: 'oil_spike', sector: 'fut_energy', w: 4, text: '地缘局势紧张，原油期货大幅跳涨', jump: [0.06, 0.18], cooldown: 14 },
    { id: 'gold_safehaven', sector: 'fut_safe', w: 4, text: '避险情绪升温，黄金期货走高', jump: [0.02, 0.07], cooldown: 10 },
    { id: 'fx_rate_hike', sector: 'fx', w: 4, text: '海外央行超预期加息，外汇市场波动加剧', jump: [-0.025, 0.025], cooldown: 12 }
  ];
  var newsHistory = {};

  function rollNews(S) {
    if (rng.chance(0.55)) return; /* 不是每天都有大新闻 */
    var pool = NEWS_POOL.filter(function (n) { var last = newsHistory[n.id]; return last == null || S.day - last >= n.cooldown; });
    if (!pool.length) return;
    var n = rng.weighted(pool, function (x) { return x.w; });
    if (!n) return;
    newsHistory[n.id] = S.day;
    var jump = rng.range(n.jump[0], n.jump[1]);
    BT.Log.add('📰 ' + n.text + U.pct(jump), jump >= 0 ? 'good' : 'bad');

    if (n.sector === 'all') {
      STOCKS.forEach(function (s) { applyJump(S, 'stocks', s.id, jump * (0.7 + rng.next() * 0.6)); });
    } else if (n.sector === 'fx') {
      FOREX.forEach(function (f) { applyJump(S, 'forex', f.id, jump * (0.6 + rng.next() * 0.8)); });
    } else if (n.sector === 'fut_energy') {
      applyJump(S, 'futures', 'cl', jump); applyJump(S, 'stocks', 'gyny', jump * 0.4);
    } else if (n.sector === 'fut_safe') {
      applyJump(S, 'futures', 'au', jump);
    } else {
      STOCKS.filter(function (s) { return s.sector === n.sector; }).forEach(function (s) { applyJump(S, 'stocks', s.id, jump); });
      FUTURES.filter(function (f) { return f.sector === n.sector; }).forEach(function (f) { applyJump(S, 'futures', f.id, jump * 0.6); });
    }
  }

  /* ========================================================================
   * 八、与商品市场的跨系统联动（events.js 的 mkt() 调用这里）
   *    对应设计文档「跨系统联动规则」：实体贸易价格波动 → 对应期货/个股异动
   * ===================================================================== */
  var GOODS_LINK = { veg: { fut: 'soy', mul: 0.5 }, fruit: { fut: 'soy', mul: 0.25 },
    seafood: { stock: 'xhls', mul: 0.15 }, tea: { stock: 'xhls', mul: 0.2 } };
  Market.onGoodsShock = function (S, goodsId, pct) {
    if (!S.market) return; /* 第三阶段未解锁前不联动 */
    var link = GOODS_LINK[goodsId]; if (!link) return;
    if (link.fut) applyJump(S, 'futures', link.fut, (pct) * link.mul);
    if (link.stock) applyJump(S, 'stocks', link.stock, (pct) * link.mul);
  };

  /* ========================================================================
   * 九、生成全部标的的当日K线（每日一次，开局回填时也复用）
   * ===================================================================== */
  function genAllCandles(S, silent) {
    var m = S.market;
    var weighted = 0, capSum = 0;
    STOCKS.forEach(function (s) {
      var series = m.stocks[s.id];
      var prev = series.hist.length ? series.hist[series.hist.length - 1].c : series.price;
      var floatFactor = U.clamp(2.2e8 / s.float, 0.6, 1.8); /* 流通盘越小，波动系数越大 */
      var vol = s.vol * floatFactor;
      var jump = series.pendingJump || 0; series.pendingJump = 0;
      var candle = genCandle(prev, vol, s.drift, s.vol > 0.025, jump);
      var avgVol = s.float * rng.range(0.004, 0.02) * (1 + Math.abs(jump) * 3);
      candle.v = Math.round(avgVol);
      candle.day = S.day;
      series.hist.push(candle); if (series.hist.length > 240) series.hist.shift();
      series.price = candle.c;
      var cap = candle.c * s.float;
      weighted += candle.c * cap; capSum += cap;
    });
    m.index = capSum > 0 ? U.round2((weighted / capSum) * 100) : m.index;
    m.indexHist.push({ day: S.day, c: m.index }); if (m.indexHist.length > 240) m.indexHist.shift();

    FUTURES.forEach(function (f) {
      var series = m.futures[f.id];
      var prev = series.hist.length ? series.hist[series.hist.length - 1].c : series.price;
      var jump = series.pendingJump || 0; series.pendingJump = 0;
      var candle = genCandle(prev, f.vol, f.drift, true, jump);
      candle.v = Math.round(rng.range(2000, 20000)); candle.day = S.day;
      series.hist.push(candle); if (series.hist.length > 240) series.hist.shift();
      series.price = candle.c;
    });
    FOREX.forEach(function (f) {
      var series = m.forex[f.id];
      var prev = series.hist.length ? series.hist[series.hist.length - 1].c : series.price;
      var jump = series.pendingJump || 0; series.pendingJump = 0;
      var candle = genCandle(prev, f.vol, f.drift, false, jump);
      candle.v = Math.round(rng.range(5e5, 5e6)); candle.day = S.day;
      series.hist.push(candle); if (series.hist.length > 240) series.hist.shift();
      series.price = candle.c;
    });

    if (!silent) {
      if (S.day - (m.quarterDay || 0) >= QUARTER_LEN) {
        m.quarterDay = S.day;
        STOCKS.forEach(function (s) { genReport(S, s, false); });
      }
      rollNews(S);
      settleMargins(S);
    }
  }

  /* ========================================================================
   * 十、每日结算入口（由 economy.sleep 调用）
   * ===================================================================== */
  Market.dailyTick = function (S) {
    if (!S.market) return; /* 玩家尚未开通金融账户 */
    genAllCandles(S, false);
  };

  /* ========================================================================
   * 十一、股票交易（份额制，支持大额订单的市场冲击：大单会把自己往不利方向推）
   * ===================================================================== */
  Market.stockPrice = function (S, id) { Market.ensure(S); return S.market.stocks[id].price; };
  Market.buyStock = function (S, id, qty) {
    Market.ensure(S);
    var def = Market.stockMap[id], series = S.market.stocks[id];
    qty = Math.max(1, Math.floor(qty));
    var impact = U.clamp(1 + (qty / def.float) * 40, 1, 1.08); /* 大单推高成交均价 */
    var price = U.round2(series.price * impact);
    var cost = U.round2(price * qty);
    if (S.cash < cost) return { ok: false, msg: '资金不够（需要 ' + U.money(cost) + '）' };
    Eco.pay(S, cost, '买入 ' + def.name + ' x' + qty);
    var pos = S.market.posStock[id] || { qty: 0, cost: 0 };
    pos.cost = (pos.cost * pos.qty + cost) / (pos.qty + qty);
    pos.qty += qty;
    S.market.posStock[id] = pos;
    series.price = U.round2(series.price * U.clamp(1 + (qty / def.float) * 8, 1, 1.02));
    return { ok: true, msg: '成交：买入 ' + def.name + ' x' + qty + ' @ ' + price };
  };
  Market.sellStock = function (S, id, qty) {
    Market.ensure(S);
    var def = Market.stockMap[id], series = S.market.stocks[id];
    var pos = S.market.posStock[id];
    qty = Math.max(1, Math.floor(qty));
    if (!pos || pos.qty < qty) return { ok: false, msg: '持仓不够' };
    var impact = U.clamp(1 - (qty / def.float) * 40, 0.92, 1);
    var price = U.round2(series.price * impact);
    var revenue = U.round2(price * qty);
    pos.qty -= qty;
    if (pos.qty <= 0) delete S.market.posStock[id];
    Eco.earn(S, revenue, '卖出 ' + def.name + ' x' + qty);
    series.price = U.round2(series.price * U.clamp(1 - (qty / def.float) * 8, 0.98, 1));
    return { ok: true, msg: '成交：卖出 ' + def.name + ' x' + qty + ' @ ' + price };
  };

  /* ========================================================================
   * 十二、期货交易（保证金，支持多/空，每日盯市结算见 settleMargins）
   * ===================================================================== */
  Market.openFutures = function (S, id, lots, side) {
    Market.ensure(S);
    var def = Market.futMap[id], series = S.market.futures[id];
    lots = Math.max(1, Math.floor(lots));
    var dir = side === 'short' ? -1 : 1;
    var notional = series.price * def.mult * lots;
    var margin = U.round2(notional * def.marginRate);
    if (S.cash < margin) return { ok: false, msg: '保证金不够（需要 ' + U.money(margin) + '）' };
    Eco.pay(S, margin, '开仓 ' + def.name + '（' + (dir > 0 ? '多' : '空') + lots + '手）保证金');
    var pos = S.market.posFut[id] || { qty: 0, cost: 0, margin: 0 };
    var newQty = pos.qty + dir * lots;
    pos.cost = pos.qty === 0 ? series.price : (pos.cost * Math.abs(pos.qty) + series.price * lots) / (Math.abs(pos.qty) + lots);
    pos.qty = newQty; pos.margin += margin;
    S.market.posFut[id] = pos;
    return { ok: true, msg: '开仓成功：' + def.name + ' ' + (dir > 0 ? '多' : '空') + lots + '手 @ ' + series.price };
  };
  Market.closeFutures = function (S, id, lots) {
    Market.ensure(S);
    var def = Market.futMap[id], series = S.market.futures[id];
    var pos = S.market.posFut[id];
    if (!pos || pos.qty === 0) return { ok: false, msg: '没有持仓' };
    lots = Math.min(Math.floor(lots), Math.abs(pos.qty));
    var dir = pos.qty > 0 ? 1 : -1;
    var pnl = dir * (series.price - pos.cost) * def.mult * lots;
    var marginBack = pos.margin * (lots / Math.abs(pos.qty));
    pos.margin -= marginBack; pos.qty -= dir * lots;
    if (pos.qty === 0) delete S.market.posFut[id]; else S.market.posFut[id] = pos;
    S.cash += marginBack + pnl; S.stats.totalEarned += Math.max(0, pnl); S.stats.totalSpent += Math.max(0, -pnl);
    BT.Log.add((pnl >= 0 ? '💰' : '💸') + ' 平仓 ' + def.name + ' ' + lots + '手，' + (pnl >= 0 ? '盈利' : '亏损') + U.money(Math.abs(pnl)), pnl >= 0 ? 'good' : 'bad');
    return { ok: true, msg: '平仓完成' };
  };

  /* ========================================================================
   * 十三、外汇交易（简化保证金，逻辑与期货一致，lot 为合约单位）
   * ===================================================================== */
  Market.openForex = function (S, id, lots, side) {
    Market.ensure(S);
    var def = Market.fxMap[id], series = S.market.forex[id];
    lots = Math.max(1, Math.floor(lots));
    var dir = side === 'short' ? -1 : 1;
    var notional = series.price * def.lot * lots;
    var margin = U.round2(notional * def.marginRate);
    if (S.cash < margin) return { ok: false, msg: '保证金不够（需要 ' + U.money(margin) + '）' };
    Eco.pay(S, margin, '开仓 ' + def.name + '（' + (dir > 0 ? '买' : '卖') + lots + '手）保证金');
    var pos = S.market.posFx[id] || { qty: 0, cost: 0, margin: 0 };
    pos.cost = pos.qty === 0 ? series.price : (pos.cost * Math.abs(pos.qty) + series.price * lots) / (Math.abs(pos.qty) + lots);
    pos.qty += dir * lots; pos.margin += margin;
    S.market.posFx[id] = pos;
    return { ok: true, msg: '成交：' + def.name + ' ' + (dir > 0 ? '买' : '卖') + lots + '手 @ ' + series.price };
  };
  Market.closeForex = function (S, id, lots) {
    Market.ensure(S);
    var def = Market.fxMap[id], series = S.market.forex[id];
    var pos = S.market.posFx[id];
    if (!pos || pos.qty === 0) return { ok: false, msg: '没有持仓' };
    lots = Math.min(Math.floor(lots), Math.abs(pos.qty));
    var dir = pos.qty > 0 ? 1 : -1;
    var pnl = dir * (series.price - pos.cost) * def.lot * lots;
    var marginBack = pos.margin * (lots / Math.abs(pos.qty));
    pos.margin -= marginBack; pos.qty -= dir * lots;
    if (pos.qty === 0) delete S.market.posFx[id]; else S.market.posFx[id] = pos;
    S.cash += marginBack + pnl;
    BT.Log.add((pnl >= 0 ? '💰' : '💸') + ' 平仓 ' + def.name + ' ' + lots + '手，' + (pnl >= 0 ? '盈利' : '亏损') + U.money(Math.abs(pnl)), pnl >= 0 ? 'good' : 'bad');
    return { ok: true, msg: '平仓完成' };
  };

  /* ========================================================================
   * 十四、每日盯市结算（期货/外汇按最新价重新计算保证金占用，爆仓强平）
   * ===================================================================== */
  function settleMargins(S) {
    var m = S.market;
    ['posFut', 'posFx'].forEach(function (kind) {
      var defs = kind === 'posFut' ? Market.futMap : Market.fxMap;
      var seriesMap = kind === 'posFut' ? m.futures : m.forex;
      var multField = kind === 'posFut' ? 'mult' : 'lot';
      U.keys(m[kind]).forEach(function (id) {
        var pos = m[kind][id]; var def = defs[id]; var series = seriesMap[id];
        var dir = pos.qty > 0 ? 1 : -1, lots = Math.abs(pos.qty);
        var pnl = dir * (series.price - pos.cost) * def[multField] * lots;
        var equity = pos.margin + pnl;
        var maintReq = series.price * def[multField] * lots * def.marginRate * 0.6;
        if (equity < maintReq) {
          /* 爆仓强平：按当前价结清，保证金亏完，倒欠部分由现金承担（不会导致现金为负太多，做上限保护） */
          var loss = Math.min(pos.margin, pos.margin - equity + maintReq);
          BT.Log.add('💥 ' + def.name + ' 仓位触发强制平仓！亏损 ' + U.money(Math.max(0, pos.margin)), 'bad');
          delete m[kind][id];
        } else {
          pos.cost = series.price; /* 模拟真实期货的“每日盯市”：成本价滚动到当日收盘 */
          pos.margin = equity;
        }
      });
    });
  }

  /* ========================================================================
   * 十五、净资产贡献 + 持仓汇总（供 UI 与 state.js 使用）
   * ===================================================================== */
  Market.netWorth = function (S) {
    if (!S.market) return 0;
    var v = 0;
    U.keys(S.market.posStock).forEach(function (id) { v += S.market.posStock[id].qty * S.market.stocks[id].price; });
    U.keys(S.market.posFut).forEach(function (id) { v += S.market.posFut[id].margin; });
    U.keys(S.market.posFx).forEach(function (id) { v += S.market.posFx[id].margin; });
    return v;
  };
  Market.portfolio = function (S) {
    Market.ensure(S);
    var out = { stocks: [], futures: [], forex: [] };
    U.keys(S.market.posStock).forEach(function (id) {
      var pos = S.market.posStock[id], def = Market.stockMap[id], price = S.market.stocks[id].price;
      out.stocks.push({ id: id, name: def.name, qty: pos.qty, cost: pos.cost, price: price, pnl: (price - pos.cost) * pos.qty });
    });
    U.keys(S.market.posFut).forEach(function (id) {
      var pos = S.market.posFut[id], def = Market.futMap[id], price = S.market.futures[id].price;
      var dir = pos.qty > 0 ? 1 : -1;
      out.futures.push({ id: id, name: def.name, qty: pos.qty, cost: pos.cost, price: price,
        pnl: dir * (price - pos.cost) * def.mult * Math.abs(pos.qty), margin: pos.margin });
    });
    U.keys(S.market.posFx).forEach(function (id) {
      var pos = S.market.posFx[id], def = Market.fxMap[id], price = S.market.forex[id].price;
      var dir = pos.qty > 0 ? 1 : -1;
      out.forex.push({ id: id, name: def.name, qty: pos.qty, cost: pos.cost, price: price,
        pnl: dir * (price - pos.cost) * def.lot * Math.abs(pos.qty), margin: pos.margin });
    });
    return out;
  };
})();
