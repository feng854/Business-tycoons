/* ==========================================================================
 * 文件：js/phase3/ipo.js
 * 作用：公司上市（IPO）—— 满足条件后申请上市 → 交费审核 10 天 → 定价发行、募集资金 →
 *       公司作为一只真实股票出现在金融市场，股价由你的真实经营业绩驱动（季报用公司账本的真实营收和利润）。
 *       上市后可以分红、锁定期满后减持。控股股权不按市值计入净资产（否则一上市身家暴涨直接通关），
 *       只有减持套现、募集资金这些真金白银才算；持股市值单独显示为「身价」。
 * 数据：S.ipo = { status: 'none'|'review'|'rejected'|'listed', applyDay, reviewEnd, fee, name, ticker,
 *                 def{股票定义}, totalShares, holdShares, listDay, ipoPrice, raised, lastDiv, rejectReason, cooldownUntil }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var IPO = BT.IPO = {};
  var STOCK_ID = 'mine';

  /* 上市条件与参数（调数值只改这里） */
  IPO.CFG = {
    minShops: 3,          /* 门店数 */
    minAge: 60,           /* 公司成立天数 */
    minNet: 100000,       /* 净资产 */
    minProfit30: 5000,    /* 近 30 天累计净利 */
    minCredit: 660,       /* 信用评级（盈利月份 +6，按时还贷 +2） */
    maxDebtRatio: 0.5,    /* 贷款 / (门店资产 + 现金) */
    reviewDays: 10,       /* 审核期 */
    feeRate: 0.015, feeMin: 5000,  /* 保荐审计费：预估估值的 1.5%，最低 ¥5,000（被否不退） */
    publicRatio: 0.15,    /* 公开发行比例（向公众出售 15% 新股） */
    underwrite: 0.03,     /* 承销费：募集资金的 3% */
    lockDays: 90,         /* 控股股东锁定期 */
    sellStep: 0.05,       /* 每次减持最多占总股本 5% */
    sellCooldown: 15,     /* 两次减持至少间隔天数 */
    minHold: 0.51,        /* 至少保留 51% 控股权 */
    divCooldown: 30,      /* 分红间隔 */
    retryDays: 30         /* 被否后多久可以重新申请 */
  };

  IPO.ensure = function (S) { if (!S.ipo) S.ipo = { status: 'none' }; return S.ipo; };
  IPO.listed = function (S) { return !!(S && S.ipo && S.ipo.status === 'listed'); };

  /* ========================================================================
   * 一、条件检查
   * ===================================================================== */
  function profit30(S) { return S.biz ? U.sum(S.biz.ledger.slice(-30), function (x) { return x.profit; }) : 0; }
  function revenue30(S) { return S.biz ? U.sum(S.biz.ledger.slice(-30), function (x) { return x.revenue; }) : 0; }
  function loans(S) { return S.biz ? U.sum(S.biz.loans, function (l) { return l.remaining; }) : 0; }
  function book(S) { return S.biz && BT.Biz ? BT.Biz.netWorth(S) : 0; }
  function age(S) { var b = S.biz; if (!b) return 0; if (b.founded == null) b.founded = S.day - (b.ledger || []).length; return S.day - b.founded; }
  IPO.debtRatio = function (S) { var a = book(S) + Math.max(0, S.cash); return a > 0 ? loans(S) / a : (loans(S) > 0 ? 9 : 0); };

  /** 逐条列出上市条件：[{name, ok, cur, need}] */
  IPO.conditions = function (S) {
    var c = IPO.CFG, biz = S.biz;
    if (!biz) return [{ name: '成立公司', ok: false, cur: '未成立', need: '达成里程碑「第一桶金」' }];
    var p30 = profit30(S), dr = IPO.debtRatio(S), nw = BT.netWorth(S);
    return [
      { name: '门店数量', ok: biz.shops.length >= c.minShops, cur: biz.shops.length + ' 家', need: '≥ ' + c.minShops + ' 家' },
      { name: '公司成立', ok: age(S) >= c.minAge, cur: age(S) + ' 天', need: '≥ ' + c.minAge + ' 天' },
      { name: '净资产', ok: nw >= c.minNet, cur: U.money(nw), need: '≥ ' + U.money(c.minNet) },
      { name: '近 30 天净利', ok: p30 >= c.minProfit30, cur: U.money(p30), need: '≥ ' + U.money(c.minProfit30) },
      { name: '信用评级', ok: biz.creditScore >= c.minCredit, cur: String(biz.creditScore), need: '≥ ' + c.minCredit },
      { name: '资产负债率', ok: dr <= c.maxDebtRatio, cur: Math.round(dr * 100) + '%', need: '≤ ' + Math.round(c.maxDebtRatio * 100) + '%' },
      { name: '经营正常', ok: !(S.insolventDays > 0) && !(BT.Rivals && BT.Rivals.deals(S).some(function (d) { return d.type === 'buyout'; })), cur: S.insolventDays > 0 ? '资不抵债中' : '正常', need: '无资不抵债 / 无被收购要约' }
    ];
  };
  IPO.eligible = function (S) { return IPO.conditions(S).every(function (x) { return x.ok; }); };

  /* ========================================================================
   * 二、估值：门店账面 + 年化利润 × 市盈率（品牌越强、大盘越好，市盈率越高）
   * ===================================================================== */
  IPO.pe = function (S) {
    var h = S.market && S.market.indexHist, trend = h && h.length > 21 ? h[h.length - 1].c / h[h.length - 21].c - 1 : 0;
    return U.round2(U.clamp(8 + (S.biz ? S.biz.brand : 0) / 15 + U.clamp(trend * 30, -3, 3), 5, 15));
  };
  IPO.quote = function (S) {
    var b = book(S), annual = Math.max(0, profit30(S)) * 12, pe = IPO.pe(S);
    var val = Math.round(b + annual * pe);
    var shares = Math.max(10000, Math.round(val / 12 / 1000) * 1000); /* 让发行价落在 ¥12 左右 */
    var price = U.round2(val / shares), pub = Math.round(shares * IPO.CFG.publicRatio);
    var raise = Math.round(pub * price * (1 - IPO.CFG.underwrite));
    return { valuation: val, book: Math.round(b), annual: Math.round(annual), pe: pe, shares: shares, price: price, publicShares: pub, raise: raise,
      fee: Math.max(IPO.CFG.feeMin, Math.round(val * IPO.CFG.feeRate)) };
  };

  /* ========================================================================
   * 三、申请 / 撤回 / 审核
   * ===================================================================== */
  IPO.apply = function (S, name, ticker) {
    var ip = IPO.ensure(S);
    if (ip.status === 'listed') return { ok: false, msg: '公司已经上市了' };
    if (ip.status === 'review') return { ok: false, msg: '上市申请正在审核中' };
    if (ip.cooldownUntil && S.day < ip.cooldownUntil) return { ok: false, msg: '上次申请被否，' + (ip.cooldownUntil - S.day) + ' 天后才能重新申请' };
    var bad = IPO.conditions(S).filter(function (x) { return !x.ok; });
    if (bad.length) return { ok: false, msg: '还不满足上市条件：' + bad.map(function (x) { return x.name; }).join('、') };
    var q = IPO.quote(S);
    if (S.cash < q.fee) return { ok: false, msg: '保荐审计费不够（需要 ' + U.money(q.fee) + '）' };
    name = String(name || '').trim().slice(0, 8) || '新港商业';
    ticker = String(ticker || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'XGSY';
    if (BT.Market && BT.Market.STOCKS.some(function (d) { return d.ticker === ticker && !d.own; })) return { ok: false, msg: '股票代码 ' + ticker + ' 已被占用' };
    BT.Eco.pay(S, q.fee, '上市保荐与审计费');
    ip.status = 'review'; ip.applyDay = S.day; ip.reviewEnd = S.day + IPO.CFG.reviewDays; ip.fee = q.fee; ip.name = name; ip.ticker = ticker; ip.rejectReason = null;
    BT.Log.add('🔔 已向交易所递交上市申请：' + name + '（' + ticker + '），审核期 ' + IPO.CFG.reviewDays + ' 天。审核期间要保持经营达标。', 'sys');
    return { ok: true, msg: '上市申请已递交，' + IPO.CFG.reviewDays + ' 天后出结果' };
  };
  IPO.withdraw = function (S) {
    var ip = IPO.ensure(S); if (ip.status !== 'review') return { ok: false, msg: '没有审核中的申请' };
    ip.status = 'none'; BT.Log.add('↩️ 撤回了上市申请（已交的费用不退）。', 'info');
    return { ok: true, msg: '已撤回上市申请' };
  };
  function reject(S, reason) {
    var ip = S.ipo; ip.status = 'rejected'; ip.rejectReason = reason; ip.cooldownUntil = S.day + IPO.CFG.retryDays;
    BT.Log.add('❌ 上市审核未通过：' + reason + '。' + IPO.CFG.retryDays + ' 天后可重新申请。', 'bad');
    BT.Bus.emit('fx', { kind: 'alert', text: '❌ 上市被否：' + reason });
  }
  function reviewTick(S) {
    var ip = S.ipo;
    /* 审核期内明显恶化就会被否（比申请门槛宽松一些） */
    if (S.insolventDays > 0) return reject(S, '审核期间出现资不抵债');
    if (profit30(S) < 0) return reject(S, '近 30 天由盈转亏');
    if (S.biz.creditScore < IPO.CFG.minCredit - 40) return reject(S, '信用评级大幅下降');
    if (IPO.debtRatio(S) > IPO.CFG.maxDebtRatio + 0.15) return reject(S, '负债率过高');
    if (S.biz.shops.length < IPO.CFG.minShops - 1) return reject(S, '门店大量关闭');
    if (S.day === ip.applyDay + 4 && rng.chance(0.25)) { ip.reviewEnd += 3; BT.Log.add('📝 交易所发来问询函，要求补充材料，审核延长 3 天。', 'event'); }
    if (S.day >= ip.reviewEnd) list(S);
  }

  /* ========================================================================
   * 四、挂牌上市：生成股票、募集资金、首份“招股书”财报
   * ===================================================================== */
  function makeDef(ip) {
    var pub = Math.round(ip.totalShares * IPO.CFG.publicRatio);
    return { id: STOCK_ID, name: ip.name, ticker: ip.ticker, sector: 'retail', group: 'cons', base: ip.basePrice || ip.ipoPrice,
      float: pub, floatRatio: IPO.CFG.publicRatio, totalShares: ip.totalShares, vol: 0.014, drift: 0.0002, beta: 0.9, tier: '小盘股', own: true };
  }
  /** 把玩家公司的股票定义同步进 Market.STOCKS（只对当前存档；读档 / 新局时自动增删） */
  IPO.syncDef = function (S) {
    var M = BT.Market; if (!M) return;
    for (var i = M.STOCKS.length - 1; i >= 0; i--) if (M.STOCKS[i].own) M.STOCKS.splice(i, 1);
    delete M.stockMap[STOCK_ID];
    if (!IPO.listed(S) || !S.market || !S.market.stocks[STOCK_ID]) return;
    var def = makeDef(S.ipo); M.STOCKS.push(def); M.stockMap[STOCK_ID] = def;
  };
  BT.Bus.on('newgame', function (S) { IPO.syncDef(S || BT.S); });
  BT.Bus.on('loaded', function (S) { IPO.syncDef(S || BT.S); });

  function list(S) {
    var ip = S.ipo, q = IPO.quote(S), M = BT.Market;
    M.ensure(S);
    ip.status = 'listed'; ip.listDay = S.day; ip.totalShares = q.shares; ip.holdShares = q.shares - q.publicShares;
    ip.ipoPrice = q.price; ip.basePrice = q.price; ip.raised = q.raise; ip.valuationAtIpo = q.valuation;
    var m = S.market;
    m.stocks[STOCK_ID] = { price: q.price, hist: [], financials: [], float: q.publicShares };
    /* 首份财报 = 招股书：用近 45 天账本 */
    var f = IPO.fundamentals(S, null);
    m.stocks[STOCK_ID].financials.push({ day: S.day, quarter: 0, revenue: Math.round(f.revenue), revenueGrowth: 0, profit: Math.round(f.profit), margin: f.margin,
      eps: Math.round(f.profit / q.shares * 100) / 100, surprise: 0, prospectus: true });
    IPO.syncDef(S); M.prepare(S);
    if (m.earn) { m.earn.sched[STOCK_ID] = Math.max(S.day + 20, m.earn.start + rng.int(0, 9)); m.earn.cons[STOCK_ID] = { growth: 0.05, eps: Math.round(f.profit * 1.05 / q.shares * 100) / 100 }; }
    var old = BT.Eco.cat; BT.Eco.cat = 'invest';
    BT.Eco.earn(S, q.raise, 'IPO 募集资金（发行 ' + U.compact(q.publicShares, 1) + ' 股 @ ¥' + q.price.toFixed(2) + '，扣 3% 承销费）');
    BT.Eco.cat = old;
    S.biz.brand = U.clamp(S.biz.brand + 8, 0, 100);
    S.biz.creditScore = U.clamp(S.biz.creditScore + 30, 300, 850);
    BT.Log.add('🔔 敲钟上市！' + ip.name + '（' + ip.ticker + '）发行价 ¥' + q.price.toFixed(2) + '，市值 ' + U.money(q.valuation) + '，你持股 ' + Math.round(ip.holdShares / ip.totalShares * 100) + '%。品牌 +8、信用 +30。', 'good');
    BT.Bus.emit('fx', { kind: 'big', text: '🔔 ' + ip.name + ' 敲钟上市！' });
    if (BT.Eco.triggerEnding && C.ENDINGS.ipo) BT.Eco.triggerEnding(S, 'ipo');
  }

  /** 季报用：公司账本近 45 天的真实营收 / 利润，及相对上一季的增速 */
  IPO.fundamentals = function (S, prev) {
    var l = S.biz ? S.biz.ledger.slice(-45) : [];
    var rev = U.sum(l, function (x) { return x.revenue; }), pro = U.sum(l, function (x) { return x.profit; });
    var g = prev && prev.revenue > 0 ? rev / prev.revenue - 1 : 0;
    return { revenue: Math.max(1, rev), profit: pro, margin: rev > 0 ? pro / rev : 0, growth: U.clamp(g, -0.9, 3) };
  };

  /* ========================================================================
   * 五、上市后：每日业绩信号、估值锚、分红、减持
   * ===================================================================== */
  IPO.price = function (S) { return IPO.listed(S) && S.market.stocks[STOCK_ID] ? S.market.stocks[STOCK_ID].price : 0; };
  IPO.holdRatio = function (S) { return IPO.listed(S) ? S.ipo.holdShares / S.ipo.totalShares : 0; };
  IPO.marketCap = function (S) { return IPO.listed(S) ? IPO.price(S) * S.ipo.totalShares : 0; };
  IPO.stakeValue = function (S) { return IPO.listed(S) ? IPO.price(S) * S.ipo.holdShares : 0; };
  /** 上市溢价 = 持股市值 − 门店账面。只用于显示「身价」，不计入净资产（减持套现后才变成真钱） */
  IPO.premium = function (S) { return IPO.listed(S) ? IPO.stakeValue(S) - book(S) : 0; };
  IPO.wealth = function (S) { return BT.netWorth(S) + Math.max(0, IPO.premium(S)); };
  IPO.fundamentalPrice = function (S) {
    var pe = IPO.pe(S), annual = Math.max(0, profit30(S)) * 12;
    return Math.max(0.5, (book(S) + annual * pe) / S.ipo.totalShares);
  };

  IPO.dailyTick = function (S) {
    if (!S.biz) return;
    var ip = IPO.ensure(S);
    if (ip.status === 'review') return reviewTick(S);
    if (ip.status !== 'listed' || !S.market || !S.market.stocks[STOCK_ID]) return;
    if (!BT.Market.stockMap[STOCK_ID]) IPO.syncDef(S);
    /* 估值锚：股价长期围绕「账面 + 年化利润 × 市盈率」波动（每天向基本面靠拢 3%） */
    ip.basePrice = U.round2(ip.basePrice * 0.97 + IPO.fundamentalPrice(S) * 0.03);
    BT.Market.stockMap[STOCK_ID].base = ip.basePrice;
    /* 业绩信号：近 7 天日均利润相对上市以来的预期日均利润，超出就涨、不及就跌（次日开盘体现） */
    var l7 = S.biz.ledger.slice(-7), avg = l7.length ? U.sum(l7, function (x) { return x.profit; }) / l7.length : 0;
    ip.expDaily = ip.expDaily == null ? avg : ip.expDaily * 0.95 + avg * 0.05;
    var sig = U.clamp((avg - ip.expDaily) / Math.max(300, Math.abs(ip.expDaily)) * 0.02, -0.02, 0.02);
    if (Math.abs(sig) > 0.002) BT.Market.rivalSignal(S, STOCK_ID, sig);
  };

  /** 分红：按每股金额发放，你自己持股部分的钱又回到你手里，实际支出 = 公众股东那部分；股价小涨、品牌 +1 */
  IPO.dividend = function (S, total) {
    var ip = S.ipo; if (!IPO.listed(S)) return { ok: false, msg: '公司还没上市' };
    if (ip.lastDiv && S.day - ip.lastDiv < IPO.CFG.divCooldown) return { ok: false, msg: '距上次分红不足 ' + IPO.CFG.divCooldown + ' 天' };
    total = Math.floor(total); if (!(total >= 1000)) return { ok: false, msg: '分红总额至少 ¥1,000' };
    var outside = Math.round(total * (1 - IPO.holdRatio(S)));
    if (S.cash < total) return { ok: false, msg: '现金不够（需要先拿出 ' + U.money(total) + '）' };
    BT.Eco.pay(S, outside, '向公众股东分红');
    var yieldPct = total / Math.max(1, IPO.marketCap(S));
    BT.Market.rivalSignal(S, STOCK_ID, U.clamp(yieldPct * 2, 0.002, 0.04));
    S.biz.brand = U.clamp(S.biz.brand + 1, 0, 100);
    ip.lastDiv = S.day; ip.divTotal = (ip.divTotal || 0) + total;
    BT.Log.add('💰 ' + ip.name + ' 派发现金红利 ' + U.money(total) + '（每股 ¥' + (total / ip.totalShares).toFixed(3) + '），你持股部分 ' + U.money(total - outside) + ' 回到自己口袋。', 'good');
    return { ok: true, msg: '分红完成：实际支出 ' + U.money(outside) + '（股息率 ' + (yieldPct * 100).toFixed(2) + '%）' };
  };

  /** 减持：锁定期后，以市价 95% 大宗交易卖出，单次 ≤ 总股本 5%，至少保留 51% */
  IPO.canSellShares = function (S) {
    var ip = S.ipo, c = IPO.CFG; if (!IPO.listed(S)) return 0;
    if (S.day < ip.listDay + c.lockDays) return 0;
    if (ip.lastSell && S.day - ip.lastSell < c.sellCooldown) return 0;
    return Math.max(0, Math.min(Math.floor(ip.totalShares * c.sellStep), ip.holdShares - Math.ceil(ip.totalShares * c.minHold)));
  };
  IPO.sellShares = function (S, qty) {
    var ip = S.ipo, c = IPO.CFG; if (!IPO.listed(S)) return { ok: false, msg: '公司还没上市' };
    if (S.day < ip.listDay + c.lockDays) return { ok: false, msg: '控股股东锁定期还剩 ' + (ip.listDay + c.lockDays - S.day) + ' 天' };
    if (ip.lastSell && S.day - ip.lastSell < c.sellCooldown) return { ok: false, msg: '两次减持至少间隔 ' + c.sellCooldown + ' 天（还剩 ' + (ip.lastSell + c.sellCooldown - S.day) + ' 天）' };
    var max = IPO.canSellShares(S); qty = Math.min(Math.floor(qty), max);
    if (!(qty > 0)) return { ok: false, msg: '不能再减持了（单次最多 5%，至少保留 51% 控股权）' };
    var px = U.round2(IPO.price(S) * 0.95), amt = Math.round(qty * px);
    ip.holdShares -= qty; ip.lastSell = S.day; ip.sold = (ip.sold || 0) + amt;
    var old = BT.Eco.cat; BT.Eco.cat = 'invest'; BT.Eco.earn(S, amt, '减持 ' + ip.name + ' ' + U.compact(qty, 1) + ' 股（大宗交易 @¥' + px.toFixed(2) + '）'); BT.Eco.cat = old;
    var m = S.market.stocks[STOCK_ID]; m.float = (m.float || 0) + qty; BT.Market.stockMap[STOCK_ID].float = ip.totalShares - ip.holdShares;
    BT.Market.rivalSignal(S, STOCK_ID, -0.02 * qty / (ip.totalShares * c.sellStep));
    BT.Log.add('📉 大股东减持公告：' + ip.name + ' 控股股东减持 ' + (qty / ip.totalShares * 100).toFixed(1) + '%，股价承压。', 'event');
    return { ok: true, msg: '减持成功，到手 ' + U.money(amt) + '，现持股 ' + (IPO.holdRatio(S) * 100).toFixed(1) + '%' };
  };
})();
