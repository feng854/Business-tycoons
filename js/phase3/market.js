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
      float: 8.0e8, floatRatio: 0.80, vol: 0.016, drift: 0.00010, beta: 1.05 },
    { id: 'bhdc', name: '滨海地产', ticker: 'BHDC', sector: 'property', base: 9.5,
      float: 3.0e8, floatRatio: 0.75, vol: 0.022, drift: 0.00000, beta: 1.2 },
    { id: 'ygkj', name: '云港科技', ticker: 'YGKJ', sector: 'tech', base: 42.0,
      float: 1.2e8, floatRatio: 0.60, vol: 0.030, drift: 0.00035, beta: 1.4 },
    { id: 'xhls', name: '新辉零售', ticker: 'XHLS', sector: 'retail', base: 15.0,
      float: 2.0e8, floatRatio: 0.70, vol: 0.018, drift: 0.00015, beta: 0.9 },
    { id: 'gyny', name: '港源能源', ticker: 'GYNY', sector: 'energy', base: 23.0,
      float: 4.0e8, floatRatio: 0.85, vol: 0.020, drift: 0.00008, beta: 1.0 },
    { id: 'cxyy', name: '创想医药', ticker: 'CXYY', sector: 'pharma', base: 55.0,
      float: 0.9e8, floatRatio: 0.55, vol: 0.034, drift: 0.00040, beta: 0.7 }
  ];
  /* 每只股票显式设定：float 流通盘(股)、floatRatio 流通比例 → totalShares 总股本 = float / floatRatio；
   * tier 规模档位：流通盘 ≥6亿=大盘股、≥2.5亿=中盘股、其余=小盘股（小盘股波动大、易被大单冲击） */
  /* 板块：周期（重工/地产/能源）、成长（科技/医药）、消费（零售）。同板块股票每个 tick 共享一部分板块因子，
   * 财报公布时同板块个股也会跟涨跟跌（板块联动）。所有股票再共享一个大盘因子（按 beta 加权）。 */
  var GROUP_OF = { industrial: 'cyc', property: 'cyc', energy: 'cyc', tech: 'growth', pharma: 'growth', retail: 'cons' };
  Market.GROUPS = { cyc: '周期板块', growth: '成长板块', cons: '消费板块' };
  STOCKS.forEach(function (d) {
    d.group = GROUP_OF[d.sector] || 'cons';
    d.totalShares = Math.round(d.float / d.floatRatio);
    d.tier = d.float >= 6e8 ? '大盘股' : (d.float >= 2.5e8 ? '中盘股' : '小盘股');
  });
  /** 流通市值 = 价格 × 流通盘；总市值 = 价格 × 总股本 */
  Market.floatCap = function (def, price) { return price * def.float; };
  Market.totalCap = function (def, price) { return price * def.totalShares; };
  /* 交易费用（对应真实市场）：股票佣金万3（最低5元），卖出另收印花税千1；期货每手5元，外汇每手2元 */
  Market.FEE = { comm: 0.0003, minComm: 5, stamp: 0.001, futPerLot: 5, fxPerLot: 2 };
  Market.stockFee = function (amount, isSell) {
    var f = Market.FEE;
    return U.round2(Math.max(f.minComm, amount * f.comm) + (isSell ? amount * f.stamp : 0));
  };
  Market.STOCKS = STOCKS;
  Market.stockMap = {}; STOCKS.forEach(function (s) { Market.stockMap[s.id] = s; });

  /* ========================================================================
   * 二、商品期货定义（保证金交易，杠杆 5-10 倍，每日盯市结算）
   *    mult: 合约乘数（1手=mult个价格单位）；margin: 保证金率
   * ===================================================================== */
  var FUTURES = [
    { id: 'soy', name: '大豆期货', ticker: 'A', base: 4200, unit: '元/吨', vol: 0.016, drift: 0.00002,
      mult: 10, marginRate: 0.10, tag: 'veg', basis: 0.006 },
    { id: 'rb', name: '螺纹钢期货', ticker: 'RB', base: 3650, unit: '元/吨', vol: 0.015, drift: 0.00004,
      mult: 10, marginRate: 0.10, sector: 'industrial', basis: 0.004 },
    { id: 'cl', name: '原油期货', ticker: 'CL', base: 520, unit: '元/桶', vol: 0.024, drift: 0.00003,
      mult: 100, marginRate: 0.12, sector: 'energy', basis: -0.006 },
    { id: 'au', name: '黄金期货', ticker: 'AU', base: 480, unit: '元/克', vol: 0.012, drift: 0.00006,
      mult: 1000, marginRate: 0.08, safeHaven: true, basis: 0.003 }
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
  /* 年化基准利率：新港元 HGD 与各外币。隔夜利息（掉期）= 方向 ×（外币利率 − 新港元利率）− 0.6% 点差，按日计。
     央行加息 / 降息新闻会改变利率，新港元利率同时决定公司银行贷款的利率。 */
  Market.RATES0 = { hgd: 0.025, usd: 0.045, eur: 0.03, jpy: 0.001 };
  Market.SWAP_MARKUP = 0.006;
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
    return { o: U.round2(o), h: U.round2(h), l: U.round2(l), c: U.round2(c) }; /* 不再保存日内路径，存档体积小很多 */
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
      quarterDay: 0, newsHistory: {}, news: []
    };
    STOCKS.forEach(function (s) { m.stocks[s.id] = initSeries(s, s.base); });
    FUTURES.forEach(function (f) { m.futures[f.id] = initSeries(f, f.base); });
    FOREX.forEach(function (f) { m.forex[f.id] = initSeries(f, f.base); });
    S.market = m;
    backfillHistory(S, 60);
    BT.Log.add('📈 金融市场已开通：股票 / 期货 / 外汇 均可交易。', 'sys');
    Market.prepare(S);
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
    /* 历史K线的日期倒推（避免图上全是 D1） */
    ['stocks', 'futures', 'forex'].forEach(function (k) {
      U.keys(m[k]).forEach(function (id) { var h = m[k][id].hist; h.forEach(function (c, i) { c.day = S.day - (h.length - i); }); });
    });
  }

  /* ========================================================================
   * 六、季度财报（约每 45 个游戏日一期，营收/净利/增速驱动一次价格跳空）
   * ===================================================================== */
  var QUARTER_LEN = 45, SEASON_SPAN = 9;
  /** 排一季财报：每只股票在 [start, start+9] 内各自的公布日 + 市场一致预期（EPS 与营收增速） */
  function scheduleSeason(S, start) {
    var m = S.market, sched = {}, cons = {};
    STOCKS.forEach(function (d) {
      if (!m.stocks[d.id]) return;
      sched[d.id] = start + rng.int(0, SEASON_SPAN);
      var last = m.stocks[d.id].financials.slice(-1)[0];
      var expG = d.drift * 200 + rng.range(-0.02, 0.05);
      cons[d.id] = { growth: U.round2(expG * 1000) / 1000, eps: last ? Math.round(last.eps * (1 + expG) * 100) / 100 : null };
    });
    m.earn = { start: start, sched: sched, cons: cons, season: ((m.earn && m.earn.season) || 0) + 1 };
  }
  Market.earnCalendar = function (S) {
    var m = Market.prepare(S), out = [];
    STOCKS.forEach(function (d) { var day = m.earn.sched[d.id]; if (day != null) out.push({ id: d.id, name: d.name, day: day, cons: m.earn.cons[d.id], group: Market.GROUPS[d.group] }); });
    return out.sort(function (a, b) { return a.day - b.day; });
  };
  function genReport(S, stockDef, initial) {
    var m = S.market, series = m.stocks[stockDef.id];
    var prev = series.financials[series.financials.length - 1];
    var cons = !initial && m.earn && m.earn.cons[stockDef.id];
    var baseRevenue = prev ? prev.revenue : (stockDef.float * stockDef.base * 0.02);
    var growth = rng.range(-0.08, 0.16) + stockDef.drift * 200;
    /* 经营 → 金融：上市 AI 公司（新辉零售）的真实季度营收增速，占季报增速的六成 */
    if (!initial && BT.Rivals && BT.Rivals.quarterGrowth) { var rg = BT.Rivals.quarterGrowth(S, stockDef.id); if (rg != null) growth = growth * 0.4 + rg * 0.6; }
    var revenue = Math.max(1e5, baseRevenue * (1 + growth));
    var margin = U.clamp((prev ? prev.margin : 0.12) + rng.range(-0.015, 0.015), 0.02, 0.35);
    var profit = revenue * margin;
    var eps = profit / stockDef.float;
    /* 玩家自己的上市公司：季报直接用公司账本的真实营收 / 利润 */
    if (stockDef.own && BT.IPO && BT.IPO.fundamentals) {
      var ff = BT.IPO.fundamentals(S, prev); revenue = ff.revenue; profit = ff.profit; margin = ff.margin; growth = ff.growth; eps = profit / stockDef.totalShares;
    }
    var surprise = cons && cons.eps ? U.clamp((eps - cons.eps) / Math.max(0.01, Math.abs(cons.eps)), -1.5, 1.5) : rng.normal() * 0.3;
    var report = {
      day: S.day, quarter: series.financials.length + 1, revenue: Math.round(revenue),
      revenueGrowth: growth, profit: Math.round(profit), margin: margin, eps: Math.round(eps * 100) / 100,
      surprise: surprise, expEps: cons ? cons.eps : null, expGrowth: cons ? cons.growth : null
    };
    series.financials.push(report);
    if (series.financials.length > 16) series.financials.shift();
    if (!initial) {
      var jump = U.clamp(surprise * 0.45 + (growth - (cons ? cons.growth : 0.03)) * 0.3, -0.2, 0.22);
      report.jump = jump; report.beat = surprise >= 0;
      applyJump(S, 'stocks', stockDef.id, jump);
      BT.Log.add('📑 ' + stockDef.name + ' 季报：EPS ' + report.eps.toFixed(2) + (cons && cons.eps ? '（预期 ' + cons.eps.toFixed(2) + '，' + (surprise >= 0 ? '超预期' : '不及预期') + '）' : '') +
        '，营收' + U.pct(growth) + '，' + (jump >= 0 ? '股价应声上涨 ' : '股价应声下跌 ') + U.pct(jump), jump >= 0 ? 'good' : 'bad');
      /* 板块联动：同板块其他个股按 30% 跟随 */
      var peers = STOCKS.filter(function (x) { return x.group === stockDef.group && x.id !== stockDef.id; });
      if (peers.length && Math.abs(jump) > 0.02) {
        peers.forEach(function (x) { applyJump(S, 'stocks', x.id, jump * 0.3); });
        BT.Log.add('🔗 板块联动：' + Market.GROUPS[stockDef.group] + '受 ' + stockDef.name + ' 财报带动，' + peers.map(function (x) { return x.name; }).join('、') + (jump >= 0 ? ' 跟涨' : ' 跟跌'), 'event');
      }
      m.news = m.news || [];
      m.news.unshift({ day: S.day, text: stockDef.name + ' 发布季报' + (surprise >= 0 ? '，业绩超预期' : '，业绩不及预期'), jump: jump, targets: [stockDef.name].concat(peers.map(function (x) { return x.name; })) });
      if (m.news.length > 30) m.news.pop();
    }
  }
  /** 经营系统对个股的影响（如上市 AI 公司的份额变化），次日开盘体现 */
  Market.rivalSignal = function (S, stockId, pct) { if (S.market && S.market.stocks[stockId]) applyJump(S, 'stocks', stockId, pct); };

  /* ------------------------------------------------------------------------
   * 期货合约月份：每月 15 日为当月合约最后交易日，之后主力切换到下月合约。
   * 同时报价「主力」和「次月」，次月价 = 主力价 ×(1+basis)（basis>0 升水 / <0 贴水）。
   * 个人账户不能进入交割：到期仍持有主力合约的仓位会被按结算价强制平仓；
   * 想继续持有，要在到期前「换月」（平主力、开次月，付两次价差和手续费）。最后 5 天保证金上调 50%。
   * ---------------------------------------------------------------------- */
  function contractAt(def, day) {
    var d = U.dateOf(day), y = d.y, mo = d.m;
    if (d.d > 15) { mo++; if (mo > 12) { mo = 1; y++; } }
    var ny = y, nm = mo + 1; if (nm > 12) { nm = 1; ny++; }
    var code = function (yy, mm) { return def.ticker + String(yy).slice(2) + (mm < 10 ? '0' : '') + mm; };
    return { code: code(y, mo), expiry: U.dayOfDate(y, mo, 15), next: code(ny, nm) };
  }
  Market.contract = function (S, id) { var m = Market.prepare(S); return m.futures[id].ct; };
  Market.daysToExpiry = function (S, id) { return Market.contract(S, id).expiry - S.day; };
  /** 某合约的价格：主力 = 序列价格；次月 = 主力 ×(1+basis) */
  Market.futPx = function (S, id, code) {
    var ser = S.market.futures[id], ct = ser.ct;
    return ct && code && code === ct.next ? U.round2(ser.price * (1 + (Market.futMap[id].basis || 0))) : ser.price;
  };
  /** 有效保证金率：主力合约最后 5 天上调 50% */
  Market.marginRateOf = function (S, kind, id, code) {
    if (kind === 'fx') return Market.fxMap[id].marginRate;
    var def = Market.futMap[id], ct = S.market.futures[id].ct;
    var near = ct && (!code || code === ct.code) && ct.expiry - S.day <= 5;
    return def.marginRate * (near ? 1.5 : 1);
  };

  function applyJump(S, kind, id, pct) {
    var m = S.market, series = m[kind][id];
    if (!series) return;
    var last = series.hist[series.hist.length - 1];
    var base = last ? last.c : series.price;
    series.pendingJump = U.clamp((series.pendingJump || 0) + pct, -0.3, 0.3); /* 单日消息冲击封顶 ±30% */
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
    { id: 'fx_rate_hike', sector: 'fx_hike', w: 4, text: '海外央行超预期加息', jump: [0.006, 0.02], cooldown: 12 },
    { id: 'fx_rate_cut', sector: 'fx_cut', w: 3, text: '海外央行意外降息', jump: [-0.02, -0.006], cooldown: 12 },
    { id: 'hgd_hike', sector: 'hgd_hike', w: 2, text: '新港央行上调基准利率 0.25 个百分点，贷款成本上升', jump: [-0.04, -0.01], cooldown: 25 },
    { id: 'hgd_cut', sector: 'hgd_cut', w: 2, text: '新港央行下调基准利率 0.25 个百分点，市场流动性改善', jump: [0.01, 0.04], cooldown: 25 },
    { id: 'retail_slump', sector: 'retail', w: 4, text: '社零数据疲软，零售板块走弱', jump: [-0.07, -0.02], cooldown: 10 },
    { id: 'tech_policy', sector: 'tech', w: 4, text: '产业扶持政策出台，科技板块受益', jump: [0.03, 0.09], cooldown: 14 },
    { id: 'steel_cut', sector: 'industrial', w: 4, text: '钢铁限产消息传出，螺纹钢与重工股异动', jump: [0.02, 0.07], cooldown: 12 },
    { id: 'pharma_vbp', sector: 'pharma', w: 4, text: '药品集采降价超预期，医药板块承压', jump: [-0.12, -0.04], cooldown: 16 }
  ];
  var newsHistory = {};
  BT.Bus.on('newgame', function () { newsHistory = {}; });

  /** 利率类新闻：改变对应货币的年化利率，返回说明文字 */
  function applyRateNews(S, n) {
    var r = S.market.rates || (S.market.rates = U.clone(Market.RATES0)), step = 0.0025;
    if (n.sector === 'fx_hike' || n.sector === 'fx_cut') {
      var f = rng.pick(FOREX); S.market._rateCcy = f.id;
      r[f.id] = U.clamp(r[f.id] + (n.sector === 'fx_hike' ? step : -step) * rng.int(1, 2), 0, 0.1);
      return { text: n.text.replace('海外', f.id === 'usd' ? '美联储' : (f.id === 'eur' ? '欧洲央行' : '日本央行')), note: f.ticker.split('/')[0] + ' 利率调整为 ' + (r[f.id] * 100).toFixed(2) + '%' };
    }
    if (n.sector === 'hgd_hike' || n.sector === 'hgd_cut') {
      r.hgd = U.clamp(r.hgd + (n.sector === 'hgd_hike' ? step : -step), 0.005, 0.08);
      return { text: n.text, note: '新港元基准利率 ' + (r.hgd * 100).toFixed(2) + '%' };
    }
    return { text: n.text, note: '' };
  }
  function rollNews(S) {
    if (rng.chance(0.55)) return; /* 不是每天都有大新闻 */
    var pool = NEWS_POOL.filter(function (n) { var last = newsHistory[n.id]; return last == null || S.day - last >= n.cooldown; });
    if (!pool.length) return;
    var n = rng.weighted(pool, function (x) { return x.w; });
    if (!n) return;
    newsHistory[n.id] = S.day;
    var jump = rng.range(n.jump[0], n.jump[1]);
    var rn = applyRateNews(S, n), text = rn.text;
    BT.Log.add('📰 ' + text + (rn.note ? '（' + rn.note + '）' : '') + U.pct(jump), jump >= 0 ? 'good' : 'bad');
    BT.Bus.emit('marketNews', { sector: n.sector, jump: jump, id: n.id });
    /* 记入「市场新闻」面板：标明利好/利空与受影响的标的 */
    var targets = [];
    if (n.sector === 'all') targets = ['全市场'];
    else if (/^fx|^hgd/.test(n.sector)) targets = n.sector.indexOf('hgd') === 0 ? ['外汇', '全部股票', '公司贷款利率'] : ['外汇'];
    else if (n.sector === 'fut_energy') targets = ['原油期货', '港源能源'];
    else if (n.sector === 'fut_safe') targets = ['黄金期货'];
    else {
      STOCKS.filter(function (x) { return x.sector === n.sector; }).forEach(function (x) { targets.push(x.name); });
      FUTURES.filter(function (x) { return x.sector === n.sector; }).forEach(function (x) { targets.push(x.name); });
    }
    S.market.news = S.market.news || [];
    S.market.news.unshift({ day: S.day, text: text + (rn.note ? '（' + rn.note + '）' : ''), jump: jump, targets: targets });
    if (S.market.news.length > 30) S.market.news.pop();

    if (n.sector === 'all') {
      STOCKS.forEach(function (s) { applyJump(S, 'stocks', s.id, jump * (0.7 + rng.next() * 0.6)); });
    } else if (n.sector === 'fx_hike' || n.sector === 'fx_cut') {
      applyJump(S, 'forex', S.market._rateCcy || 'usd', jump);
    } else if (n.sector === 'hgd_hike' || n.sector === 'hgd_cut') {
      FOREX.forEach(function (f) { applyJump(S, 'forex', f.id, -jump * 0.4); }); /* 本币加息 → 外币相对走弱 */
      STOCKS.forEach(function (s) { applyJump(S, 'stocks', s.id, jump * (s.sector === 'property' ? 1.5 : 0.6)); });
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
  /* 商品事件（如蔬菜涨价 +90%）对期货/股票的传导系数要很小，否则一次事件就让大豆期货暴涨 45% */
  var GOODS_LINK = { veg: { fut: 'soy', mul: 0.08 }, fruit: { fut: 'soy', mul: 0.05 },
    seafood: { stock: 'xhls', mul: 0.04 }, tea: { stock: 'xhls', mul: 0.05 } };
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
      var cap = candle.c * s.float; /* 指数按流通市值加权 */
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
  /* ------------------------------------------------------------------------
   * 实时行情引擎：游戏里每过 1 小时，全市场（股票/期货/外汇）走一个 tick。
   * 世界是「活」的：除了玩家，其余所有参与者（机构/游资/做市商/散户）都是 AI，
   * 他们不停地买卖，推动价格、刷新盘口、产生逐笔成交；玩家只是其中一个参与者。
   * 价格 = 公允价值（随机游走）×(1+偏离)，玩家的大单会把价格推离公允价，之后逐 tick 衰减回归。
   * ---------------------------------------------------------------------- */
  var TICKS_PER_DAY = 18; /* 6:00 → 24:00 */
  var AI_NAMES = null;
  function allInstr() {
    var list = [];
    STOCKS.forEach(function (d) { list.push({ kind: 'stocks', id: d.id, def: d }); });
    FUTURES.forEach(function (d) { list.push({ kind: 'futures', id: d.id, def: d }); });
    FOREX.forEach(function (d) { list.push({ kind: 'forex', id: d.id, def: d }); });
    return list;
  }
  function roundP(kind, v) { return kind === 'forex' ? Math.round(v * 10000) / 10000 : U.round2(v); }
  function volOf(it) {
    var d = it.def; if (it.kind === 'stocks') return d.vol * U.clamp(2.2e8 / d.float, 0.6, 1.8);
    return d.vol;
  }
  function newLive(kind, px) { return { o: px, h: px, l: px, c: px, v: 0, live: true }; }
  /** 初始化/补齐实时行情所需的数据（兼容旧存档） */
  Market.prepare = function (S) {
    var m = Market.ensure(S); ensureTradeStore(S);
    m.fair = m.fair || {}; m.live = m.live || {}; m.tape = m.tape || {}; m.orders = m.orders || [];
    allInstr().forEach(function (it) {
      if (!m[it.kind][it.id]) return; /* 别的存档里的玩家上市股，本存档没有 */
      var px = m[it.kind][it.id].price;
      if (!m.fair[it.id]) m.fair[it.id] = px;
      if (!m.live[it.id]) m.live[it.id] = newLive(it.kind, px);
      if (!m.tape[it.id]) m.tape[it.id] = [];
    });
    ['posFut', 'posFx'].forEach(function (k) { U.keys(m[k]).forEach(function (id) { var p = m[k][id]; if (p.entry == null) p.entry = p.cost; if (p.init == null) p.init = p.margin; }); });
    if (m.tickHour == null) m.tickHour = S.hour; /* 注意：不能在这里按 S.hour 回拨，收盘补 tick 时 S.hour 已是次日清晨 */
    if (!m.rates) m.rates = U.clone(Market.RATES0);
    if (!m.earn) scheduleSeason(S, Math.max(S.day + 3, (m.quarterDay || S.day) + QUARTER_LEN));
    FUTURES.forEach(function (f) {
      var ser = m.futures[f.id]; if (!ser.ct) ser.ct = contractAt(f, S.day); ser.rolls = ser.rolls || [];
      U.keys(m.posFut).forEach(function (id) { if (id === f.id && !m.posFut[id].ct) m.posFut[id].ct = ser.ct.code; });
    });
    return m;
  };
  /** 今日实时K线 = 已收盘的历史 + 当天正在形成的这一根 */
  Market.chartCandles = function (S, kind, id, n) {
    Market.prepare(S);
    var series = S.market[kind][id], lv = S.market.live[id];
    var arr = series.hist.slice(-(n - 1));
    arr.push({ o: lv.o, h: lv.h, l: lv.l, c: lv.c, v: lv.v, day: S.day, live: true });
    return arr;
  };
  /** 外部（玩家成交/调试后门）改动价格后，同步今日K线 */
  function touchLive(S, kind, id, px, vol) {
    var lv = S.market.live[id]; if (!lv) return;
    lv.c = px; lv.h = Math.max(lv.h, px); lv.l = Math.min(lv.l, px); lv.v += vol || 0;
  }
  Market.syncPrice = function (S, kind, id) { Market.prepare(S); var px = S.market[kind][id].price; touchLive(S, kind, id, px, 0); };

  function updateIndex(S) {
    var m = S.market, weighted = 0, capSum = 0;
    STOCKS.forEach(function (s) { var px = m.stocks[s.id].price, cap = px * s.float; weighted += px * cap; capSum += cap; });
    if (capSum > 0) m.index = U.round2((weighted / capSum) * 100);
  }

  function tickOne(S, it) {
    var m = S.market, series = m[it.kind][it.id], def = it.def, live = m.live[it.id];
    var oldPx = series.price, fair = m.fair[it.id];
    var dev = (oldPx / fair - 1) * 0.6 + 0.0015 * rng.normal(); /* 玩家造成的偏离每 tick 衰减 40% */
    var vol = volOf(it), fat = it.kind === 'stocks' ? def.vol > 0.025 : it.kind === 'futures';
    var z = fat ? rng.fat(5) : rng.normal(), fac = S._fac;
    if (it.kind === 'stocks' && fac) {
      /* 因子模型：大盘因子(按 beta) + 板块因子 + 个股特质，三者方差合计≈1 —— 同板块同涨同跌、大盘普涨普跌 */
      var a = U.clamp(0.45 * (def.beta || 1), 0.2, 0.65), b = 0.4, c = Math.sqrt(Math.max(0.15, 1 - a * a - b * b));
      z = a * fac.m + b * fac[def.group] + c * z;
      if (S.market.earn && S.market.earn.sched[it.id] === S.day) vol *= 1.25; /* 财报前夜波动放大 */
    }
    var step = (vol / Math.sqrt(TICKS_PER_DAY)) * z + (def.drift || 0) / TICKS_PER_DAY
      + 0.0008 * Math.log((def.base || fair) / fair); /* 弱均值回归：价格长期围绕基准价波动，半衰期约 40 天，防止单边暴涨暴跌 */
    if (it.kind !== 'stocks' && BT.CP) step += BT.CP.tickFlow(S, it); /* v7.3 对手盘：AI 机构的资金流推动期货 / 外汇 */
    fair = Math.max(0.01, fair * (1 + step)); m.fair[it.id] = fair;
    var px = Math.max(0.01, roundP(it.kind, fair * (1 + dev)));
    series.price = px;
    var v = it.kind === 'stocks' ? def.float * rng.range(0.0003, 0.0012) : (it.kind === 'futures' ? rng.range(2000, 20000) / TICKS_PER_DAY : rng.range(5e5, 5e6) / TICKS_PER_DAY);
    live.c = px; live.h = Math.max(live.h, px, oldPx); live.l = Math.min(live.l, px, oldPx); live.v += Math.round(v);
    if (it.kind === 'stocks') aiTape(S, it, oldPx, px);
  }
  /* AI 参与者的逐笔成交：价格沿本 tick 的走势分布，涨则买多卖少，跌则反之 */
  function aiTape(S, it, oldPx, newPx) {
    var m = S.market, def = it.def, tape = m.tape[it.id], n = rng.int(2, 5), up = newPx >= oldPx;
    for (var k = 0; k < n; k++) {
      var buy = rng.chance(up ? 0.65 : 0.35), t = (k + 1) / n;
      var p = U.round2(oldPx + (newPx - oldPx) * t + oldPx * rng.range(-0.0008, 0.0008));
      var q = Math.max(100, Math.round(def.float * rng.range(0.00002, 0.00012) / 100) * 100);
      var big = rng.chance(0.04); if (big) q *= 8;
      var who = rng.pick(COUNTERPARTS);
      tape.unshift({ day: S._stampDay, hour: S._stampHour, p: p, q: q, dir: buy ? '买' : '卖', who: who, big: big });
      var bl = m.bigLog = (m.bigLog && m.bigLog.day === S._stampDay) ? m.bigLog : { day: S._stampDay, n: 0 };
      if (big && bl.n < 2 && !S._bigLogged && who !== '散户集合') { /* 日志里每天最多提 2 条大单动向，避免刷屏 */
        S._bigLogged = true; bl.n++;
        BT.Log.add('🏦 ' + who + (buy ? ' 大举买入 ' : ' 大幅抛售 ') + def.name + ' ' + U.compact(q, 1) + '股 @' + p.toFixed(2), 'event');
      }
    }
    if (tape.length > 40) tape.length = 40;
  }
  /** until：补齐到几点（收盘结算时传 24，此时 S.day/S.hour 已经是次日清晨，所以时间戳要用前一天） */
  Market.tick = function (S, until) {
    if (!S.market) return;
    var m = Market.prepare(S), target = Math.min(until != null ? until : S.hour, C.DAY_END_H);
    S._bigLogged = false; S._stampDay = until != null ? S.day - 1 : S.day;
    while (m.tickHour < target) {
      m.tickHour++; S._stampHour = m.tickHour;
      S._fac = { m: rng.normal(), cyc: rng.normal(), growth: rng.normal(), cons: rng.normal() };
      allInstr().forEach(function (it) { tickOne(S, it); });
      delete S._fac;
      updateIndex(S);
      Market.marginCheck(S);
      Market.regenBooks(S);
      Market.matchOrders(S);
    }
    delete S._bigLogged; delete S._stampDay; delete S._stampHour;
  };
  BT.Bus.on('hour', function () { if (BT.S && BT.S.market) Market.tick(BT.S); });

  Market.dailyTick = function (S) {
    if (!S.market) return; /* 玩家尚未开通金融账户 */
    var m = Market.prepare(S);
    /* 1) 补齐今天剩余的 tick，收盘 */
    Market.tick(S, C.DAY_END_H);
    /* 2) 未成交的限价委托当日有效，收盘撤销 */
    if (m.orders.length) { BT.Log.add('📋 收盘：' + m.orders.length + ' 笔未成交委托已自动撤销。', 'sys'); m.orders = []; }
    /* 3) 今日K线入库 */
    allInstr().forEach(function (it) {
      var lv = m.live[it.id], series = m[it.kind][it.id];
      series.hist.push({ o: U.round2(lv.o), h: roundP(it.kind, lv.h), l: roundP(it.kind, lv.l), c: roundP(it.kind, series.price), v: lv.v, day: S.day - 1 });
      if (series.hist.length > 240) series.hist.shift();
    });
    m.indexHist.push({ day: S.day, c: m.index }); if (m.indexHist.length > 240) m.indexHist.shift();
    /* 4) 财报季：各股按日历在收盘后发布（产生的跳空在次日开盘体现）/ 新闻 / 期货外汇每日结算 */
    var closedDay = S.day - 1, pending = 0;
    STOCKS.forEach(function (s) {
      var d0 = m.earn.sched[s.id]; if (d0 == null) return;
      if (d0 <= closedDay) { m.earn.sched[s.id] = null; m.quarterDay = closedDay; genReport(S, s, false); } else pending++;
    });
    if (!pending) scheduleSeason(S, m.earn.start + QUARTER_LEN);
    else if (STOCKS.some(function (s) { return m.earn.sched[s.id] === S.day; })) {
      BT.Log.add('🗓️ 财报季：今晚 ' + STOCKS.filter(function (s) { return m.earn.sched[s.id] === S.day; }).map(function (s) { return s.name; }).join('、') + ' 发布季报。', 'sys');
    }
    rollNews(S);
    settleMargins(S);
    applySwap(S);
    if (BT.CP) BT.CP.daily(S); /* 对手盘：各家 AI 重定仓位、猎杀 / 干预判定 */
    expireFutures(S, closedDay);
    /* 5) 次日开盘：隔夜跳空 + 消息冲击，开出新的一根K线 */
    var gapFac = { m: rng.normal(), cyc: rng.normal(), growth: rng.normal(), cons: rng.normal() };
    allInstr().forEach(function (it) {
      var series = m[it.kind][it.id], jump = series.pendingJump || 0; series.pendingJump = 0;
      var zz = rng.normal();
      if (it.kind === 'stocks') zz = 0.5 * gapFac.m + 0.35 * gapFac[it.def.group] + 0.79 * zz;
      var gap = (it.def.drift || 0) * 0.3 + volOf(it) * 0.25 * zz + jump;
      m.fair[it.id] = Math.max(0.01, m.fair[it.id] * (1 + gap));
      series.price = Math.max(0.01, roundP(it.kind, series.price * (1 + gap)));
      m.live[it.id] = newLive(it.kind, series.price);
    });
    updateIndex(S);
    m.tickHour = C.DAY_START_H;
    Market.regenBooks(S);
  };

  /* ========================================================================
   * 十一、股票交易（份额制，支持大额订单的市场冲击：大单会把自己往不利方向推）
   * ===================================================================== */
  Market.stockPrice = function (S, id) { Market.ensure(S); return S.market.stocks[id].price; };

  /* ------------------------------------------------------------------------
   * 盘口与对手盘：每只股票每天生成「五档买卖盘」，每档挂着真实的对手方（机构/游资/散户）。
   * 玩家的买单吃卖盘、卖单吃买盘，逐档成交；盘口深度不够就只能部分成交，被吃掉的档位当天不再补。
   * 每日结算后盘口按新价格重新生成。S.market.books[id] = {day, ref, asks:[{p,q,who}], bids:[...], tape:[...]}
   * ---------------------------------------------------------------------- */
  var COUNTERPARTS = ['北辰基金', '华远资管', '险资专户', '老鹰席位', '深南路营业部', '量化做市商', '外资通道', '散户集合'];
  function ensureTradeStore(S) { var m = S.market; m.books = m.books || {}; m.trades = m.trades || []; return m; }
  function genBook(S, id) {
    var m = ensureTradeStore(S), def = Market.stockMap[id], px = m.stocks[id].price;
    var step = 0.0008 + 0.0006 * U.clamp(2.2e8 / def.float, 0.6, 2.2); /* 流通盘越小，档位间距越大 */
    var asks = [], bids = [], k;
    for (k = 1; k <= 5; k++) {
      var depth = def.float * rng.range(0.0001, 0.0004) * (1.15 - k * 0.1);
      asks.push({ p: U.round2(px * (1 + step * k)), q: Math.max(100, Math.round(depth / 100) * 100), who: rng.pick(COUNTERPARTS) });
      bids.push({ p: U.round2(px * (1 - step * k)), q: Math.max(100, Math.round(depth * rng.range(0.8, 1.2) / 100) * 100), who: rng.pick(COUNTERPARTS) });
    }
    m.books[id] = { day: S.day, ref: px, asks: asks, bids: bids };
    return m.books[id];
  }
  Market.book = function (S, id) {
    var m = ensureTradeStore(S), b = m.books[id];
    /* 日期变了，或价格被外部改动（每日行情/调试后门），盘口重新生成 */
    if (!b || b.day !== S.day || Math.abs(b.ref - m.stocks[id].price) > 0.0051) b = genBook(S, id);
    return b;
  };
  Market.regenBooks = function (S, id) { if (S.market) STOCKS.forEach(function (d) { if (!id || d.id === id) genBook(S, d.id); }); };

  /** 逐档撮合：side='buy' 吃卖盘 / 'sell' 吃买盘；limit 为限价（买不高于/卖不低于）。不改动盘口，确认成交后再扣量 */
  function matchBook(book, side, want, limit) {
    var lv = side === 'buy' ? book.asks : book.bids, fills = [], left = want, amount = 0, filled = 0;
    for (var i = 0; i < lv.length && left > 0; i++) {
      if (limit > 0 && (side === 'buy' ? lv[i].p > limit : lv[i].p < limit)) break;
      var take = Math.min(left, lv[i].q); if (take <= 0) continue;
      fills.push({ i: i, p: lv[i].p, q: take, who: lv[i].who });
      left -= take; filled += take; amount += take * lv[i].p;
    }
    return { fills: fills, qty: filled, amount: U.round2(amount) };
  }
  function recordTrade(S, rec) {
    var m = ensureTradeStore(S); m.trades.unshift(rec); if (m.trades.length > 80) m.trades.pop();
  }
  function pubFills(fills) { return fills.map(function (f) { return { p: f.p, q: f.q, who: f.who }; }); }

  /** 股票成交核心：market 单 / 限价单共用。返回 {ok, filled, msg}；ok=false 表示资金/持仓问题，filled=0 且 ok=true 表示没有对手盘能成交 */
  function execStock(S, id, side, qty, limit) {
    Market.prepare(S);
    if (Market.stockMap[id] && Market.stockMap[id].own) return { ok: false, filled: 0, msg: '这是你自己的上市公司：控股股东不能在二级市场随意买卖，请到「公司 → 上市」页分红或减持' };
    var def = Market.stockMap[id], series = S.market.stocks[id], book = Market.book(S, id), buy = side === 'buy';
    var pos = S.market.posStock[id];
    qty = Math.max(1, Math.floor(qty));
    if (!buy && (!pos || pos.qty < qty)) return { ok: false, filled: 0, msg: '持仓不够（当前持有 ' + (pos ? pos.qty : 0) + ' 股）' };
    var mt = matchBook(book, side, qty, limit);
    if (mt.qty <= 0) return { ok: true, filled: 0, msg: limit > 0 ? '限价 ' + limit.toFixed(2) + ' 暂时没有对手盘愿意成交' : (buy ? '卖盘空了，暂时没有对手盘' : '买盘空了，暂时没有对手盘') };
    var amount = mt.amount, fee = Market.stockFee(amount, !buy), avg = U.round2(amount / mt.qty), pnl = null;
    if (buy) {
      if (S.cash < amount + fee) return { ok: false, filled: 0, msg: '资金不够（需要 ' + U.money(amount + fee) + '，含佣金 ' + U.money(fee) + '）' };
      Eco.pay(S, amount, '买入 ' + def.name + ' x' + mt.qty);
      Eco.pay(S, fee, '股票佣金');
      var p0 = pos || { qty: 0, cost: 0 };
      p0.cost = (p0.cost * p0.qty + amount + fee) / (p0.qty + mt.qty); /* 成本含佣金，盈亏更真实 */
      p0.qty += mt.qty; S.market.posStock[id] = p0;
    } else {
      var costBasis = pos.cost * mt.qty; pnl = amount - fee - costBasis;
      pos.qty -= mt.qty; if (pos.qty <= 0) delete S.market.posStock[id];
      Eco.earn(S, amount - fee, '卖出 ' + def.name + ' x' + mt.qty);
      S.stats.stockPnl = (S.stats.stockPnl || 0) + pnl;
    }
    S.stats.stockTrades = (S.stats.stockTrades || 0) + 1;
    series.price = U.round2(mt.fills[mt.fills.length - 1].p); /* 最新价 = 最后一笔成交价；之后价格会逐 tick 回归公允价 */
    touchLive(S, 'stocks', id, series.price, mt.qty);
    book.ref = series.price; Market.regenBooks(S, id); /* 做市商按新价格重新报价 */
    updateIndex(S);
    recordTrade(S, { day: S.day, hour: S.hour, side: side, id: id, name: def.name, ordered: qty, qty: mt.qty, avg: avg, amount: amount, fee: fee, pnl: pnl, limit: limit || 0, fills: pubFills(mt.fills) });
    var part = mt.qty < qty ? '（只成交 ' + mt.qty + ' / ' + qty + ' 股）' : '';
    var msg = '成交：' + (buy ? '买入 ' : '卖出 ') + def.name + ' x' + mt.qty + ' 均价 ' + avg + '，分 ' + mt.fills.length + ' 档成交，' + (buy ? '佣金 ' : '佣金+印花税 ') + U.money(fee) + (pnl != null ? '，本笔盈亏 ' + U.money(pnl) : '') + part;
    return { ok: true, filled: mt.qty, msg: msg };
  }
  Market.buyStock = function (S, id, qty) { var r = execStock(S, id, 'buy', qty, 0); if (r.ok && r.filled === 0) r.ok = false; return r; };
  Market.sellStock = function (S, id, qty) { var r = execStock(S, id, 'sell', qty, 0); if (r.ok && r.filled === 0) r.ok = false; return r; };

  /** 下单：price 为空/0 = 市价；有价格 = 限价单，能成交的先成交，剩余部分挂单到收盘 */
  Market.placeStockOrder = function (S, id, side, qty, price) {
    Market.prepare(S);
    qty = Math.max(1, Math.floor(qty)); price = Number(price) > 0 ? U.round2(Number(price)) : 0;
    if (!price) return side === 'buy' ? Market.buyStock(S, id, qty) : Market.sellStock(S, id, qty);
    var def = Market.stockMap[id], m = S.market;
    if (side === 'buy' && S.cash < price * qty) return { ok: false, msg: '资金不够：限价 ' + price.toFixed(2) + ' × ' + qty + ' 需要 ' + U.money(price * qty) };
    var r = execStock(S, id, side, qty, price);
    if (!r.ok) return r;
    var left = qty - r.filled;
    if (left <= 0) return r;
    m.orders.push({ oid: BT.uid('ord'), id: id, side: side, price: price, qty: qty, left: left, day: S.day, hour: S.hour });
    return { ok: true, msg: (r.filled ? r.msg + '；' : '') + '剩余 ' + left + ' 股已挂单：' + (side === 'buy' ? '买入' : '卖出') + ' ' + def.name + ' @' + price.toFixed(2) + '（当日有效，价格触及时自动成交）' };
  };
  Market.cancelOrder = function (S, oid) {
    var m = S.market, n = m.orders.length;
    m.orders = m.orders.filter(function (o) { return o.oid !== oid; });
    return m.orders.length < n ? { ok: true, msg: '委托已撤销' } : { ok: false, msg: '委托不存在' };
  };
  /** 每个 tick 之后：价格触及挂单则撮合；资金/持仓不足的挂单自动作废 */
  Market.matchOrders = function (S) {
    var m = S.market; if (!m.orders || !m.orders.length) return;
    m.orders = m.orders.filter(function (o) {
      var r = execStock(S, o.id, o.side, o.left, o.price);
      if (!r.ok) { BT.Log.add('📋 委托作废：' + r.msg, 'bad'); return false; }
      if (r.filled > 0) { BT.Log.add('📋 挂单成交：' + r.msg, 'good'); o.left -= r.filled; }
      return o.left > 0;
    });
  };

  /* ========================================================================
   * 十二、期货 / 外汇（保证金杠杆交易，两者共用一套逻辑）
   *
   *  开多 / 买入  = 看涨：按当前价「买入」合约，价格上涨赚钱、下跌亏钱。
   *  开空 / 卖出  = 看跌：先「卖出」合约，价格下跌赚钱、上涨亏钱。
   *  盈亏        = 方向 ×（平仓价 − 开仓价）× 合约乘数 × 手数。
   *  保证金      = 合约价值 × 保证金率（只需押这一部分，所以有杠杆 = 1 / 保证金率）。
   *  买卖价差    = 开仓、平仓都按不利方向各吃半个价差（期货 0.03%、外汇 0.02%），另收每手手续费。
   *  反向下单    = 先平掉反向持仓，多出来的手数才新开仓（不会出现同一合约多空同时持有）。
   *  每日盯市    = 每天收盘把盈亏滚进保证金；盘中每个 tick 都检查，
   *                权益低于维持保证金（初始保证金的 60%）就强制平仓，剩余权益退回，穿仓部分由现金承担。
   * ===================================================================== */
  var LEV = {
    fut: { pos: 'posFut', ser: 'futures', defs: function () { return Market.futMap; }, mult: 'mult', spread: 0.0003, fee: function () { return Market.FEE.futPerLot; }, name: '期货', long: '多', short: '空', dp: 2 },
    fx:  { pos: 'posFx',  ser: 'forex',   defs: function () { return Market.fxMap; },  mult: 'lot',  spread: 0.0002, fee: function () { return Market.FEE.fxPerLot; },  name: '外汇', long: '买', short: '卖', dp: 4 }
  };
  function levPx(L, price, dir, opening) { /* 开仓买/平仓卖吃不利价差 */
    var adverse = opening ? dir : -dir;
    return Math.round(price * (1 + adverse * L.spread / 2) * Math.pow(10, L.dp)) / Math.pow(10, L.dp);
  }
  /** 持仓对应的最新价：期货按持仓合约（主力 / 次月），外汇直接取序列价 */
  function posPrice(S, kind, id, pos) { return kind === 'fut' ? Market.futPx(S, id, pos && pos.ct) : S.market.forex[id].price; }
  Market.posPrice = posPrice;
  Market.levEquity = function (pos, price, def, L) {
    var dir = pos.qty > 0 ? 1 : -1;
    return pos.margin + dir * (price - pos.cost) * def[L.mult] * Math.abs(pos.qty);
  };
  /** 估算强平价：权益刚好等于维持保证金时的价格 */
  Market.liqPrice = function (pos, def, L, rate) {
    var dir = pos.qty > 0 ? 1 : -1, lots = Math.abs(pos.qty), mult = def[L.mult];
    /* margin + dir*(p-cost)*mult*lots = p*mult*lots*rate*0.6  → 解 p */
    var k = mult * lots, r = (rate || def.marginRate) * 0.6;
    var p = (pos.margin - dir * pos.cost * k) / (k * (r - dir));
    return p > 0 ? p : 0;
  };
  Market.maxLots = function (S, kind, id, useNext) {
    var L = LEV[kind], def = L.defs()[id], code = kind === 'fut' ? (useNext ? S.market.futures[id].ct.next : S.market.futures[id].ct.code) : null;
    var price = kind === 'fut' ? Market.futPx(S, id, code) : S.market[L.ser][id].price;
    var per = price * def[L.mult] * Market.marginRateOf(S, kind, id, code) + L.fee();
    return Math.max(0, Math.floor(S.cash / per));
  };
  function openLev(S, kind, id, lots, side, useNext) {
    Market.prepare(S);
    var L = LEV[kind], def = L.defs()[id], series = S.market[L.ser][id], book = S.market[L.pos];
    lots = Math.max(1, Math.floor(lots));
    var dir = side === 'short' ? -1 : 1, pos = book[id], msgs = [];
    var code = kind === 'fut' ? (useNext ? series.ct.next : series.ct.code) : null;
    if (kind === 'fut' && pos && pos.qty !== 0 && pos.ct && pos.ct !== code) return { ok: false, msg: '你的持仓在 ' + pos.ct + ' 合约，同一品种只能持有一个合约：请先平仓或在到期前「换月」' };
    /* 有反向持仓：先平仓，剩余才开新仓 */
    if (pos && pos.qty !== 0 && (pos.qty > 0) !== (dir > 0)) {
      var closeN = Math.min(lots, Math.abs(pos.qty));
      var r = closeLev(S, kind, id, closeN); if (!r.ok) return r;
      msgs.push(r.msg); lots -= closeN;
      if (lots <= 0) return { ok: true, msg: msgs.join('；') };
      pos = book[id];
    }
    var rate = Market.marginRateOf(S, kind, id, code);
    var px = levPx(L, kind === 'fut' ? Market.futPx(S, id, code) : series.price, dir, true);
    var cpf = BT.CP ? BT.CP.fill(S, kind, id, dir, lots, px) : null; if (cpf) px = cpf.px; /* 对手盘：大单吃多档，均价变差 */
    var margin = U.round2(px * def[L.mult] * lots * rate), fee = L.fee() * lots;
    if (S.cash < margin + fee) return { ok: false, msg: '保证金不够（需要 ' + U.money(margin + fee) + '，含手续费 ' + U.money(fee) + '；按当前资金最多可开 ' + Market.maxLots(S, kind, id, useNext) + ' 手）' };
    S.cash -= margin; /* 保证金只是冻结，不算花费 */
    Eco.pay(S, fee, L.name + '手续费');
    pos = pos || { qty: 0, cost: px, entry: px, margin: 0, init: 0 };
    if (code) pos.ct = code;
    var q0 = Math.abs(pos.qty);
    pos.entry = q0 === 0 ? px : (pos.entry * q0 + px * lots) / (q0 + lots);
    pos.cost = q0 === 0 ? px : (pos.cost * q0 + px * lots) / (q0 + lots);
    pos.qty += dir * lots; pos.margin += margin; pos.init = (pos.init || 0) + margin;
    book[id] = pos;
    msgs.push('成交：' + def.name + (code ? ' ' + code : '') + ' ' + (dir > 0 ? L.long : L.short) + lots + '手 @ ' + px + '（保证金 ' + U.money(margin) + '，强平价约 ' + Market.liqPrice(pos, def, L, rate).toFixed(L.dp) + '）' + (cpf && cpf.who ? '，对手方：' + cpf.who : ''));
    return { ok: true, msg: msgs.join('；') };
  }
  function closeLev(S, kind, id, lots) {
    var L = LEV[kind], def = L.defs()[id], series = S.market[L.ser][id], book = S.market[L.pos], pos = book[id];
    if (!pos || pos.qty === 0) return { ok: false, msg: '没有持仓' };
    lots = Math.min(Math.max(1, Math.floor(lots)), Math.abs(pos.qty));
    var dir = pos.qty > 0 ? 1 : -1, px = levPx(L, posPrice(S, kind, id, pos), dir, false), ratio = lots / Math.abs(pos.qty);
    var cpf = BT.CP && !S._liq ? BT.CP.fill(S, kind, id, -dir, lots, px) : null; if (cpf) px = cpf.px;
    var pnl = dir * (px - pos.cost) * def[L.mult] * lots;
    var marginBack = pos.margin * ratio, initPart = (pos.init || pos.margin) * ratio;
    var total = pnl + marginBack - initPart; /* 本次平仓相对初始保证金的累计盈亏（含此前每日盯市滚入的部分） */
    pos.margin -= marginBack; pos.init = (pos.init || 0) - initPart; pos.qty -= dir * lots;
    if (pos.qty === 0) delete book[id];
    S.cash += marginBack;
    var fee = L.fee() * lots; Eco.pay(S, fee, L.name + '平仓手续费');
    if (pnl >= 0) Eco.earn(S, pnl, '平仓 ' + def.name + ' ' + lots + '手盈利'); else Eco.pay(S, -pnl, '平仓 ' + def.name + ' ' + lots + '手亏损');
    return { ok: true, msg: '平仓 ' + def.name + ' ' + lots + '手 @ ' + px + '，累计' + (total >= 0 ? '盈利 ' : '亏损 ') + U.money(Math.abs(total)) + (cpf && cpf.who ? '，对手方：' + cpf.who : '') };
  }
  Market.openFutures = function (S, id, lots, side, useNext) { return openLev(S, 'fut', id, lots, side, useNext); };
  /** 换月：把主力合约持仓移到次月合约（平主力、开次月，各吃半个价差 + 手续费），保证金与累计盈亏不变 */
  Market.rollFutures = function (S, id) {
    Market.prepare(S);
    var L = LEV.fut, def = Market.futMap[id], ser = S.market.futures[id], pos = S.market.posFut[id];
    if (!pos || !pos.qty) return { ok: false, msg: '没有持仓可换月' };
    if (pos.ct === ser.ct.next) return { ok: false, msg: '已经在次月合约 ' + pos.ct + ' 上了' };
    var dir = pos.qty > 0 ? 1 : -1, lots = Math.abs(pos.qty);
    var exitPx = levPx(L, ser.price, dir, false), enterPx = levPx(L, Market.futPx(S, id, ser.ct.next), dir, true);
    var realized = dir * (exitPx - pos.cost) * def.mult * lots, fee = L.fee() * lots * 2;
    if (S.cash < fee) return { ok: false, msg: '手续费不够' };
    pos.margin += realized; pos.cost = enterPx; pos.entry = (pos.entry || exitPx) + (enterPx - exitPx); pos.ct = ser.ct.next;
    Eco.pay(S, fee, '期货换月手续费');
    S.stats.rolls = (S.stats.rolls || 0) + 1;
    return { ok: true, msg: def.name + ' ' + lots + '手已换月到 ' + pos.ct + '（' + (def.basis >= 0 ? '升水 ' : '贴水 ') + Math.abs(def.basis * 100).toFixed(1) + '%，开仓价 ' + enterPx + '）' };
  };
  Market.closeFutures = function (S, id, lots) { return closeLev(S, 'fut', id, lots); };
  /** v7.3：追加保证金（现金 → 持仓保证金，强平价远离；被猎杀时的保命手段） */
  Market.addMargin = function (S, kind, id, amt) {
    var L = LEV[kind], pos = S.market[L.pos][id]; if (!pos || !pos.qty) return { ok: false, msg: '没有持仓' };
    amt = Math.floor(amt); if (!(amt > 0)) return { ok: false, msg: '金额无效' };
    if (S.cash < amt) return { ok: false, msg: '现金不够' };
    S.cash -= amt; pos.margin += amt; pos.init = (pos.init || 0) + amt;
    var def = L.defs()[id];
    return { ok: true, msg: '已追加保证金 ' + U.money(amt) + '，新强平价约 ' + Market.liqPrice(pos, def, L, Market.marginRateOf(S, kind, id, pos.ct)).toFixed(L.dp) };
  };
  Market.openForex = function (S, id, lots, side) { return openLev(S, 'fx', id, lots, side); };
  Market.closeForex = function (S, id, lots) { return closeLev(S, 'fx', id, lots); };

  /* ========================================================================
   * 十四、保证金检查与每日盯市（盘中每个 tick 调用 marginCheck，收盘调用 settleMargins）
   * ===================================================================== */
  function liquidate(S, L, def, id, pos, equity) {
    var cash0 = S.cash;
    if (equity >= 0) S.cash += equity;
    else S.cash = Math.max(S.cash + equity, Math.min(S.cash, 0)); /* 穿仓：亏空由现金承担，现金不够则止于 0 */
    delete S.market[L.pos][id];
    var lost = (pos.init || pos.margin) - Math.max(0, equity);
    BT.Log.add('💥 ' + def.name + ' 触发强制平仓！保证金不足维持仓位，本次亏损 ' + U.money(Math.max(0, lost)) + (equity < 0 ? '（穿仓，另从现金扣除 ' + U.money(cash0 - S.cash) + '）' : '，剩余权益 ' + U.money(equity) + ' 已退回'), 'bad');
    S.stats.totalSpent += Math.max(0, lost);
  }
  Market.marginCheck = function (S) {
    var m = S.market;
    ['fut', 'fx'].forEach(function (kind) {
      var L = LEV[kind], defs = L.defs();
      U.keys(m[L.pos]).forEach(function (id) {
        var pos = m[L.pos][id], def = defs[id];
        if (!pos || !pos.qty) { delete m[L.pos][id]; return; }
        var price = posPrice(S, kind, id, pos);
        var equity = Market.levEquity(pos, price, def, L);
        var maint = price * def[L.mult] * Math.abs(pos.qty) * Market.marginRateOf(S, kind, id, pos.ct) * 0.6;
        if (equity < maint) liquidate(S, L, def, id, pos, equity);
        else if (equity < maint * 1.35 && pos.warnDay !== S.day) {
          pos.warnDay = S.day;
          BT.Log.add('⚠️ ' + def.name + ' 保证金预警：权益 ' + U.money(equity) + ' 接近维持线 ' + U.money(maint) + '，请追加平仓或减仓！', 'bad');
        }
      });
    });
  };
  function settleMargins(S) {
    var m = S.market;
    Market.marginCheck(S);
    ['fut', 'fx'].forEach(function (kind) {
      var L = LEV[kind], defs = L.defs();
      U.keys(m[L.pos]).forEach(function (id) { /* 每日盯市：盈亏滚入保证金，成本价滚到收盘价 */
        var pos = m[L.pos][id], price = posPrice(S, kind, id, pos);
        pos.margin = Market.levEquity(pos, price, defs[id], L); pos.cost = price;
      });
    });
  }
  Market.settleMargins = settleMargins;

  /* ========================================================================
   * 十四·二、外汇隔夜利息（每日收盘计入保证金）与期货到期
   * ===================================================================== */
  /** 每手每日隔夜利息（正=收、负=付）：方向 ×（外币利率 − 新港元利率）− 点差 */
  Market.swapPerLot = function (S, id, dir) {
    var m = S.market, f = Market.fxMap[id], r = m.rates || Market.RATES0;
    var rate = dir * ((r[id] || 0) - r.hgd) - Market.SWAP_MARKUP;
    return f.lot * m.forex[id].price * rate / 365;
  };
  function applySwap(S) {
    var m = S.market, tot = 0;
    U.keys(m.posFx).forEach(function (id) {
      var pos = m.posFx[id]; if (!pos || !pos.qty) return;
      var dir = pos.qty > 0 ? 1 : -1, amt = U.round2(Market.swapPerLot(S, id, dir) * Math.abs(pos.qty));
      pos.margin += amt; pos.swap = U.round2((pos.swap || 0) + amt); tot += amt;
    });
    if (Math.abs(tot) >= 0.5) BT.Log.add('💱 外汇隔夜利息：' + (tot >= 0 ? '收入 ' : '支出 ') + U.money(Math.abs(tot)) + '（已计入保证金）', tot >= 0 ? 'good' : 'info');
  }
  /** 期货到期：closedDay 是刚收盘的那天；主力到期 → 强平未换月的仓位，序列换到下一合约 */
  function expireFutures(S, closedDay) {
    var m = S.market;
    FUTURES.forEach(function (f) {
      var ser = m.futures[f.id], ct = ser.ct; if (!ct) return;
      var left = ct.expiry - S.day;
      if (left === 5) BT.Log.add('⏳ ' + f.name + ' ' + ct.code + ' 还有 5 天到期，保证金上调 50%；持仓请及时换月或平仓。', 'sys');
      if (closedDay < ct.expiry) return;
      var pos = m.posFut[f.id];
      if (pos && pos.qty && pos.ct === ct.code) {
        var r = closeLev(S, 'fut', f.id, Math.abs(pos.qty));
        BT.Log.add('📆 ' + ct.code + ' 合约到期：个人账户不能交割，' + r.msg + '（到期自动平仓）', 'bad');
      }
      var b = 1 + (f.basis || 0);
      ser.price = U.round2(ser.price * b); m.fair[f.id] = m.fair[f.id] * b;
      var lv = m.live[f.id]; if (lv) { lv.o = U.round2(lv.o * b); lv.h = U.round2(lv.h * b); lv.l = U.round2(lv.l * b); lv.c = ser.price; }
      ser.ct = contractAt(f, S.day); ser.rolls = ser.rolls || []; ser.rolls.push(S.day); if (ser.rolls.length > 12) ser.rolls.shift();
      BT.Log.add('🔁 ' + f.name + ' 主力合约切换为 ' + ser.ct.code + '（价格 ' + (f.basis >= 0 ? '升水' : '贴水') + ' ' + U.pct(f.basis) + '，K 线上会出现换月缺口）。', 'sys');
    });
  }
  Market.expireFutures = expireFutures;

  /* ========================================================================
   * 十五、净资产贡献 + 持仓汇总（供 UI 与 state.js 使用）
   * ===================================================================== */
  Market.netWorth = function (S) {
    if (!S.market) return 0;
    var v = 0, m = S.market;
    U.keys(m.posStock).forEach(function (id) { v += m.posStock[id].qty * m.stocks[id].price; });
    ['fut', 'fx'].forEach(function (kind) {
      var L = LEV[kind];
      U.keys(m[L.pos]).forEach(function (id) { v += Market.levEquity(m[L.pos][id], posPrice(S, kind, id, m[L.pos][id]), L.defs()[id], L); }); /* 保证金 + 浮动盈亏 */
    });
    return v;
  };
  Market.portfolio = function (S) {
    Market.ensure(S);
    var out = { stocks: [], futures: [], forex: [] }, m = S.market;
    U.keys(m.posStock).forEach(function (id) {
      var pos = m.posStock[id], def = Market.stockMap[id], price = m.stocks[id].price;
      out.stocks.push({ id: id, name: def.name, qty: pos.qty, cost: pos.cost, price: price, pnl: (price - pos.cost) * pos.qty });
    });
    [['fut', 'futures'], ['fx', 'forex']].forEach(function (k) {
      var L = LEV[k[0]];
      U.keys(m[L.pos]).forEach(function (id) {
        var pos = m[L.pos][id], def = L.defs()[id], price = posPrice(S, k[0], id, pos), eq = Market.levEquity(pos, price, def, L);
        out[k[1]].push({ id: id, name: def.name, qty: pos.qty, cost: pos.entry || pos.cost, price: price, margin: pos.margin, ct: pos.ct, swap: pos.swap || 0,
          pnl: eq - (pos.init || pos.margin), equity: eq, liq: Market.liqPrice(pos, def, L, Market.marginRateOf(S, k[0], id, pos.ct)) });
      });
    });
    return out;
  };
})();
