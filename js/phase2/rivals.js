/* ==========================================================================
 * 文件：js/phase2/rivals.js
 * 作用：AI 竞争对手公司 —— 和玩家在各区域分流客流、打价格战、抢人才，
 *       资金链断了会卖店 / 破产，玩家可以接手门店或整体收购；玩家撑不住时，AI 也会来收购玩家。
 * 联动：
 *   经营 → 金融：新辉零售（上市，XHLS）的市场份额与营收写进季报，份额变化每天影响股价；
 *   金融 → 经营：大盘黑天鹅 / 普涨新闻会打击 / 补充 AI 公司的现金（激进型加杠杆，受影响最大），
 *                牛市里 AI 扩张更快；新港央行利率决定它们的借贷成本。
 * 分层：tier = big 巨头（进货便宜、钱厚、敢亏本打掠夺性定价）/ mid 区域连锁；小型散户见 phase1/hawkers.js
 * 智能：每天按「抢到的份额 × 未来利润 − 要烧的钱」给开战打分；对你有态度（友好↔敌对）、记得上次交手的输赢；
 *       开战前 1~3 天放出风声（买了情报能拿到准确日期和商品）；价格战盯住你卖得最好的货，你降价它跟，压到底线为止。
 * v7.3 竞争第二步：锁供应（独家供货协议，你批发这样货要加价）、抢铺位（占走路口旺铺 / 抬你的房租）、
 *       结盟（和区域连锁签互不侵犯 + 联手对抗巨头）、反垄断（举报掠夺定价 / 锁货 / 一家独大，监管也会盯你）
 * 数据：S.biz.rivals = [{id,name,tier,cash,brand,shops:{regionId:{level,rep}},war:{regionId:days},
 *                        camp:{regionId:{on,goods,mode,cut,my0,spent,matched}},plan,att,fear,mem,...}]
 *       S.biz.deals  = [{id,type,rivalId,...,expire}]  待玩家处理的要约（挖人/卖店/收购）
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Rv = BT.Rivals = {};

  var TICKET = { premium: 18, discount: 11, balanced: 14, aggressive: 13 }; /* 客单价 */
  var FIT = { premium: { cbd: 1.15, college: 1.1 }, discount: { slum: 1.15, market: 1.15 }, aggressive: { port: 1.1 }, balanced: {} };
  var NEW_NAMES = [['🦊', '灵狐优选'], ['🚀', '速达便利'], ['🌿', '绿野生活'], ['🐉', '龙腾商贸'], ['🎯', '优品汇']];

  /* ========================================================================
   * 一、初始化
   * ===================================================================== */
  function makeRival(def) {
    var shops = {};
    U.keys(def.regions || {}).forEach(function (rid) { shops[rid] = { level: def.regions[rid], rep: Math.round(rng.range(40, 65)) }; });
    return normRival({ id: def.id, name: def.name, icon: def.icon, style: def.style, color: def.color, cash: def.cash, brand: def.brand, aggr: def.aggr,
      listed: def.listed || null, desc: def.desc || '', shops: shops, war: {}, alive: true, debt: def.style === 'aggressive' ? 30000 : 0,
      revQ: 0, revQPrev: 0, profit7: [], shareRef: null, founded: BT.S ? BT.S.day : 1, tier: def.tier });
  }
  /** 补齐分层 / 态度 / 记忆字段（兼容旧存档） */
  function normRival(rv) {
    rv.tier = rv.tier || C.RIVAL_TIER[rv.id] || 'mid';
    if (rv.att == null) rv.att = rv.style === 'premium' ? 10 : 0;
    rv.fear = rv.fear || 0; rv.mem = rv.mem || { wars: 0, won: 0, lost: 0 };
    rv.camp = rv.camp || {}; rv.war = rv.war || {}; rv.plan = rv.plan || null; rv.seen = rv.seen || [];
    rv.nextWar = rv.nextWar || 0; rv.mood = rv.mood || '观望';
    return rv;
  }
  Rv.ensure = function (S) {
    var biz = S.biz; if (!biz) return null;
    if (!biz.rivals) biz.rivals = C.RIVALS.map(makeRival);
    biz.rivals.forEach(normRival);
    biz.deals = biz.deals || []; biz.rivalNews = biz.rivalNews || [];
    Rv.syncCompetitors(S);
    return biz.rivals;
  };
  Rv.alive = function (S) { return S.biz && S.biz.rivals ? S.biz.rivals.filter(function (r) { return r.alive; }) : []; };
  Rv.get = function (S, id) { return (S.biz && S.biz.rivals || []).filter(function (r) { return r.id === id; })[0]; };
  function news(S, text, type) {
    var biz = S.biz; biz.rivalNews.unshift({ day: S.day, text: text, type: type || 'event' });
    if (biz.rivalNews.length > 30) biz.rivalNews.pop();
    BT.Log.add(text, type === 'bad' ? 'bad' : (type === 'good' ? 'good' : 'event'));
  }

  /* ========================================================================
   * 二、区域竞争：吸引力 → 分流
   * ===================================================================== */
  /** AI 门店的吸引力：规模^0.7 × 口碑 × 品牌 × 风格适配 × 价位 × 价格战（掠夺定价更猛） */
  Rv.pull = function (rv, rid) {
    var sh = rv.alive && rv.shops[rid]; if (!sh) return 0;
    var fit = (FIT[rv.style] || {})[rid] || 1;
    return Math.pow(sh.level, 0.7) * (0.6 + sh.rep / 100) * (1 + rv.brand / 150) * fit * priceMul(Rv.markupAt(rv, rid), rid) * Rv.warMul(rv, rid) * (rv.cutUntil >= (BT.S ? BT.S.day : 0) ? 0.8 : 1); /* 被你断供 */
  };
  Rv.warMul = function (rv, rid) {
    if (!(rv.war && rv.war[rid] > 0)) return 1;
    var cp = rv.camp && rv.camp[rid];
    return cp && cp.mode === 'predatory' ? 1.45 : 1.25;
  };
  /** 价位对吸引力的影响：比“正常价位”便宜越多越吸引人（价格敏感的区域更明显） */
  function priceMul(markup, rid) {
    var sens = C.REGION_PRICE_SENS[rid] || 1;
    return U.clamp(1 + (C.COMPETE.refMarkup - markup) * sens * 0.6, 0.75, 1.3);
  }
  /** 玩家门店的价位系数（货架平均加价；跟价时按实际成交价） */
  Rv.playerPriceMul = function (S, shop) {
    var ks = U.keys(shop.shelf || {}).filter(function (g) { return C.goodsMap[g] && !C.goodsMap[g].lux; });
    if (!ks.length) return 1;
    var avg = U.sum(ks, function (g) { return (shop.effMk && shop.effMk[g]) || shop.shelf[g]; }) / ks.length;
    return priceMul(avg, shop.regionId);
  };

  /* ========================================================================
   * 二·一、单品比价：AI 的标价、价格战压价、你的货被比下去损失多少成交
   * ===================================================================== */
  Rv.markup = function (rv) { return C.COMPETE.markup[rv.style] || C.COMPETE.refMarkup; };
  /** v7.3.3：每家店自己的价位（px：0.88~1.15，AI 会按盈亏和份额调价） */
  Rv.markupAt = function (rv, rid) { var sh = rv.shops && rv.shops[rid]; return Rv.markup(rv) * ((sh && sh.px) || 1); };
  Rv.unitCost = function (S, rv, rid, gid) { return BT.Eco.buyPrice(S, gid, rid) * (C.COMPETE.costMul[rv.tier] || 1); };
  /** AI 某区某商品的售价。价格战时全场让利 3%；被点名的商品紧咬你的价格（ref = 你昨天的成交价），最多压到底线 */
  Rv.priceOf = function (S, rv, rid, gid, ref) {
    if (!rv.alive || !rv.shops[rid]) return 0;
    var g = C.goodsMap[gid]; if (!g || g.lux) return 0;
    var cost = Rv.unitCost(S, rv, rid, gid), p = cost * Rv.markupAt(rv, rid), cp = rv.camp[rid];
    if (rv.war[rid] > 0) {
      p *= 0.97;
      if (cp && cp.on === 'me' && cp.goods.indexOf(gid) >= 0 && ref > 0) {
        var floor = cost * (cp.mode === 'predatory' ? C.COMPETE.floor.predatory : C.COMPETE.floor[rv.tier]);
        p = Math.max(floor, Math.min(p, ref) * (1 - cp.cut)); /* 比你和它平时的价都再低一截 */
      }
    }
    return U.round2(p);
  };
  var shareCache = { day: -1, map: {} };
  function cachedShares(S, rid) {
    if (shareCache.day !== S.day || shareCache.S !== S) shareCache = { day: S.day, S: S, map: {} };
    return shareCache.map[rid] || (shareCache.map[rid] = Rv.shares(S, rid));
  }
  /** 你门店里某商品被对手（AI 门店 + 散户）比价后的成交倍率。
   *  ref：你昨天的成交价（AI 按它来压价）；myPrice：今天的标价。品牌、口碑、会员越高，顾客越不容易被低价拉走。 */
  Rv.priceHit = function (S, shop, gid, myPrice, ref) {
    var rid = shop.regionId, sens = C.REGION_PRICE_SENS[rid] || 1, K = C.COMPETE.hitK;
    var res = { mul: 1, best: 0, by: null, camp: null, list: [], attack: 0 }; /* attack：正在打价格战 / 甩卖的对手里的最低价（跟价只跟这个） */
    if (!S.biz || !myPrice) return res;
    var loyal = U.clamp((S.biz.brand || 0) / 250 + (shop.reputation || 0) / 300 + (shop.members > 0 ? shop.members / (shop.members + 200) : 0), 0, 0.6);
    var shs = cachedShares(S, rid), me = shs.filter(function (x) { return x.me; })[0], meS = me ? me.share : 0.3;
    var comps = [];
    Rv.alive(S).forEach(function (rv) {
      var p = Rv.priceOf(S, rv, rid, gid, ref || myPrice); if (!p) return;
      var it = shs.filter(function (x) { return x.id === rv.id; })[0], s = it ? it.share : 0;
      var cp = rv.camp[rid] && rv.war[rid] > 0 && rv.camp[rid].on === 'me' && rv.camp[rid].goods.indexOf(gid) >= 0 ? rv.camp[rid] : null;
      comps.push({ id: rv.id, name: rv.icon + rv.name, p: p, w: s / Math.max(0.05, s + meS), camp: cp, attack: !!cp }); /* 只有被点名压价的货算“攻击” */
    });
    if (BT.Hawkers) {
      var hp = BT.Hawkers.price(S, rid, gid);
      if (hp) comps.push({ id: 'hawker', name: '🧺散户', p: hp, w: Math.min(0.35, BT.Hawkers.sellers(S, rid, gid) * 0.06), attack: BT.Hawkers.dumping(S, rid, gid) });
    }
    comps.forEach(function (c) {
      var gap = myPrice / c.p - 1;
      if (gap > 0) res.mul *= U.clamp(1 - gap * sens * K * c.w * (1 - loyal), 0.35, 1);
      if (!res.best || c.p < res.best) { res.best = c.p; res.by = c; }
      if (c.camp) res.camp = c.camp;
      if (c.attack && (!res.attack || c.p < res.attack)) res.attack = c.p;
    });
    if (res.by && myPrice < res.by.p) res.mul *= 1 + Math.min(0.2, (res.by.p / myPrice - 1) * sens * 0.5 * res.by.w); /* 你最便宜 → 抢别人的客 */
    res.mul = Math.max(0.3, res.mul); res.list = comps;
    return res;
  };
  /** 某区某商品对手的最低价（UI / 跟价用） */
  Rv.bestPrice = function (S, shop, gid) {
    var price = U.round2(BT.Eco.buyPrice(S, gid, shop.regionId) * (shop.shelf[gid] || 1.3));
    return Rv.priceHit(S, shop, gid, price, (shop.effP && shop.effP[gid]) || price);
  };
  function rivalPullSum(S, rid) { return U.sum(Rv.alive(S), function (rv) { return Rv.pull(rv, rid); }); }
  /** 玩家门店客流的竞争系数（Biz.dailyTick 调用）：myPull / (myPull + 0.45×ΣAI吸引力) */
  Rv.compFactor = function (S, rid, myPull) {
    if (!S.biz || !S.biz.rivals) return 0.6;
    return myPull / (myPull + 0.45 * rivalPullSum(S, rid));
  };
  function playerPull(S, rid) {
    var sh = S.biz && S.biz.shops.filter(function (s) { return s.regionId === rid; })[0]; if (!sh) return 0;
    var staff = sh.employees.length ? Math.min(1.4, 0.6 + sh.employees.length * 0.2) : 0.5;
    return (1 + S.biz.brand / 150) * (0.7 + sh.reputation / 200) * (sh.promoDays > 0 ? 1.3 : 1) * staff * (C.locMap[sh.loc] || C.locMap.street).traffic * Rv.playerPriceMul(S, sh);
  }
  /** 某区域的市场份额（UI 用）：[{id,name,color,share,me}] */
  Rv.shares = function (S, rid) {
    var list = [], tot = 0, p = playerPull(S, rid);
    if (p > 0) { list.push({ id: 'me', name: '我的公司', color: '#ffd766', v: p, me: true }); tot += p; }
    Rv.alive(S).forEach(function (rv) { var v = Rv.pull(rv, rid); if (v > 0) { list.push({ id: rv.id, name: rv.name, icon: rv.icon, color: rv.color, v: v, war: rv.war[rid] > 0 }); tot += v; } });
    list.forEach(function (x) { x.share = tot > 0 ? x.v / tot : 0; });
    return list.sort(function (a, b) { return b.share - a.share; });
  };
  /** 兼容旧界面 / 旧逻辑：biz.competitors[rid] = 区内最强 AI 的名字 + 实力 */
  Rv.syncCompetitors = function (S) {
    var biz = S.biz; biz.competitors = biz.competitors || {};
    C.REGIONS.forEach(function (r) {
      var best = null, bv = 0, sum = 0;
      Rv.alive(S).forEach(function (rv) { var v = Rv.pull(rv, r.id); sum += v; if (v > bv) { bv = v; best = rv; } });
      biz.competitors[r.id] = { name: best ? best.name : '暂无对手', strength: U.round2(sum / (sum + 1.2)), rivalId: best ? best.id : null };
    });
  };

  /* ========================================================================
   * 三、AI 每日经营：营收 / 成本 / 口碑 / 价格战倒计时
   * ===================================================================== */
  function rivalEconomy(S, rv) {
    var w = BT.Eco.weatherInfo(S), wd = U.dateOf(S.day).w, profit = 0, rev = 0;
    var hgd = S.market && S.market.rates ? S.market.rates.hgd : 0.025;
    U.keys(rv.shops).forEach(function (rid) {
      var sh = rv.shops[rid], r = C.regionMap[rid];
      var D = r.traffic * 55 * w.traffic * ((C.WEEK_TRAFFIC[rid] || [])[wd] || 1);
      var mine = Rv.pull(rv, rid), tot = rivalPullSum(S, rid) + playerPull(S, rid);
      var cust = D * 2.2 * (tot > 0 ? mine / tot : 0) * rng.range(0.85, 1.15);
      var war = rv.war[rid] > 0, cp = rv.camp[rid];
      var scale = rv.tier === 'big' ? 1.06 : 1; /* 巨头进货便宜，平时毛利高一点 */
      var px = sh.px || 1;
      var base = cust * TICKET[rv.style] * px, m0 = 0.3 * scale + (px - 1) * 0.75; /* 提价：每单更赚、但吸引力下降（见 pull） */
      var fixed = r.rent * 3 * sh.level + 40 * sh.level * (sh.lean ? 0.7 : 1); /* 精简人手：人工省三成，口碑慢慢掉 */
      /* v7.3.2：价格战按它真实的标价记账 —— 全场让利 3%，被点名的货按实际压到的价格算（压到成本附近就几乎不赚、掠夺定价是亏本卖），
         另外每天还要烧促销补贴 / 广告费。打仗那家店基本是亏的，钱从别的店的利润里出 */
      var disc = 0, burn = 0;
      if (war) {
        var ws = Rv.warStats(S, rv, rid);
        disc = (1 - ws.f) * 0.03 + ws.f * ws.depth;
        burn = pool(rv, rid) * (cp && cp.mode === 'predatory' ? 0.22 : (cp && cp.on === 'me' ? 0.12 : 0.1));
      }
      var r1 = base * (1 - disc);
      rev += r1;
      var shopProfit = base * m0 - base * disc - burn - fixed;
      profit += shopProfit;
      sh.lastProfit = Math.round(shopProfit);
      sh.ph = sh.ph || []; sh.ph.push(sh.lastProfit); if (sh.ph.length > 14) sh.ph.shift();
      if (sh.lean) sh.rep = Math.max(15, sh.rep - 0.15);
      if (war && cp) { cp.spent = (cp.spent || 0) + base * disc + burn; cp.lastLoss = Math.round(-shopProfit); }
      sh.rep = U.clamp(sh.rep + rng.range(-0.6, 0.7) + (war ? 0.2 : 0), 15, 90);
      if (war) { rv.war[rid] -= 1; if (rv.war[rid] <= 0) endCampaign(S, rv, rid, false); }
    });
    profit -= rv.debt * (hgd * 2) / 365; /* 借贷成本随央行利率浮动 */
    rv.cash += profit; rv.revQ += rev;
    rv.profit7.push(Math.round(profit)); if (rv.profit7.length > 7) rv.profit7.shift();
    rv.brand = U.clamp(rv.brand + (profit > 0 ? 0.05 : -0.08), 5, 95);
    rv.lastRev = Math.round(rev); rv.lastProfit = Math.round(profit);
  }

  function avgOf(a, n) { a = (a || []).slice(-n); return a.length ? U.sum(a) / a.length : 0; }
  /** 估算在某区新开一家 1 级店每天能赚多少（和 rivalEconomy 同一套算法） */
  Rv.siteEstimate = function (S, rv, rid) {
    var r = C.regionMap[rid], fit = (FIT[rv.style] || {})[rid] || 1;
    var pullNew = (0.6 + 0.35) * (1 + rv.brand / 150) * fit * priceMul(Rv.markup(rv), rid);
    var tot = rivalPullSum(S, rid) + playerPull(S, rid) + pullNew;
    var cust = r.traffic * 55 * 2.2 * pullNew / tot;
    return Math.round(cust * TICKET[rv.style] * 0.3 * (rv.tier === 'big' ? 1.06 : 1) - (r.rent * 3 + 40));
  };
  /** 每周复盘：亏损店 → 精简人手 → 调价（价格敏感区降价抢客、份额大的店提价）→ 连续两周还亏就关店（先问你要不要接手） */
  function reviewShops(S, rv) {
    var ids = U.keys(rv.shops), m0 = rv.mood;
    ids.forEach(function (rid) {
      var sh = rv.shops[rid]; if (rv.war[rid] > 0) return;
      sh.px = sh.px || 1;
      var a7 = avgOf(sh.ph, 7), share = shareOf(Rv.shares(S, rid), rv.id), sens = C.REGION_PRICE_SENS[rid] || 1, rn = C.regionMap[rid].name;
      if ((sh.ph || []).length < 5) return;
      if (a7 < -12) {
        sh.bad = (sh.bad || 0) + 1;
        if (!sh.lean) { sh.lean = true; rv.mood = '降本'; }
        else if (share < 0.45 && sens >= 0.9 && sh.px > 0.9) { sh.px = U.round2(sh.px - 0.04); rv.mood = '降价抢客'; }
        else if (share >= 0.45 && sh.px < 1.12) { sh.px = U.round2(sh.px + 0.04); rv.mood = '提价保利润'; }
        /* 连续亏 3 周以上、而且不是唯一的店 → 关店止损 */
        if (sh.bad >= 3 && U.keys(rv.shops).length > 1) {
          var mine = S.biz.shops.some(function (s) { return s.regionId === rid; });
          if (!mine && !dealFor(S, rv.id, 'sellShop') && rng.chance(0.6)) {
            var price = Math.round(C.regionMap[rid].rent * 45 * sh.level * 0.55);
            addDeal(S, { type: 'sellShop', rivalId: rv.id, regionId: rid, level: sh.level, rep: sh.rep, price: price, expire: S.day + 2, forced: true,
              text: rv.icon + rv.name + ' 的' + rn + '门店连亏三周，打算关掉，愿以 ' + U.money(price) + ' 转让给你（' + sh.level + ' 级、口碑 ' + Math.round(sh.rep) + '）。' });
          } else {
            rv.cash += C.regionMap[rid].rent * 45 * sh.level * 0.4; delete rv.shops[rid]; delete rv.camp[rid];
            news(S, '🏚️ ' + rv.icon + rv.name + ' 关掉了连续亏损的' + rn + '门店（止损）。', mine ? 'good' : 'event');
          }
          rv.mood = '关店止损';
        }
      } else {
        sh.bad = 0;
        if (a7 > 40 && sh.lean && sh.rep < 45) sh.lean = false; /* 赚钱了，把人手补回来 */
        if (a7 > 40 && share >= 0.5 && sh.px < 1.12) { sh.px = U.round2(sh.px + 0.03); rv.mood = '提价'; }
        else if (a7 > 0 && sh.px < 1) sh.px = U.round2(Math.min(1, sh.px + 0.02)); /* 回到正常价位 */
      }
    });
    if (rv.mood !== m0) rv.moodDay = S.day; /* 复盘后的动向保留一周，不被每天的「观望」覆盖 */
  }

  /* ========================================================================
   * 四、AI 决策：扩张 / 升级 / 价格战 / 挖人 / 抢候选人 / 卖店 / 收购玩家门店
   * ===================================================================== */
  function decide(S, rv) {
    var biz = S.biz, idx = indexTrend(S);
    var shopCost = function (rid, lv) { return C.regionMap[rid].rent * 45 * lv; };
    var nShops = U.keys(rv.shops).length;
    /* 4.0 门店经营复盘（v7.3.3）：每周看一次各店盈亏 —— 亏了先精简人手、再调价，还亏就关店止损；赚钱又有份额就提价 */
    if (S.day >= (rv.nextReview || 0)) { rv.nextReview = S.day + 7; reviewShops(S, rv); }
    /* 4.1 扩张：先估算能不能赚钱再开（跟进你赚钱的区域、或找最有利可图的空白区）；牛市融资容易，扩张更积极 */
    var bull = idx > 0.05 ? 2 : (idx < -0.05 ? 0.5 : 1);
    if (U.keys(rv.shops).length < (C.COMPETE.maxShops[rv.tier] || 4) && rng.chance(0.02 * bull)) {
      var cands = C.REGIONS.filter(function (r) { return !rv.shops[r.id] && !(Rv.allied(S, rv) && biz.shops.some(function (s) { return s.regionId === r.id; })) && rv.cash > shopCost(r.id, 1) * 2.5; })
        .map(function (r) { var e = Rv.siteEstimate(S, rv, r.id), mine = biz.shops.some(function (s) { return s.regionId === r.id && s.last && s.last.profit > 0; }); return { rid: r.id, est: e, follow: mine, score: e + (mine ? 15 * rv.aggr : 0) }; })
        .filter(function (c) { return c.est > (c.follow ? -5 : 15); })
        .sort(function (a, b) { return b.score - a.score; });
      var tg = cands[0];
      if (tg) {
        rv.cash -= shopCost(tg.rid, 1); rv.shops[tg.rid] = { level: 1, rep: 35, px: 1 };
        rv.mood = tg.follow ? '贴脸开店' : '扩张';
        news(S, '🏗️ ' + rv.icon + rv.name + ' 在' + C.regionMap[tg.rid].name + '开了新店' + (tg.follow ? '，冲着你的生意来的！' : '。'), tg.follow ? 'bad' : 'event');
      }
    }
    /* 4.2 升级门店：只升级赚钱、有份额的店，并且留足现金 */
    if (rng.chance(0.04)) {
      var up = U.keys(rv.shops).filter(function (rid) { var sh = rv.shops[rid]; return sh.level < 3 && avgOf(sh.ph, 7) > 25 && shareOf(Rv.shares(S, rid), rv.id) >= 0.3 && rv.cash > Math.max(25000, shopCost(rid, sh.level + 1) * 3) && !(rv.war[rid] > 0); });
      if (up.length) { var rid0 = up.sort(function (a, b) { return avgOf(rv.shops[b].ph, 7) - avgOf(rv.shops[a].ph, 7); })[0], lv = rv.shops[rid0].level + 1; rv.cash -= shopCost(rid0, lv); rv.shops[rid0].level = lv; rv.mood = '升级门店'; news(S, '⬆️ ' + rv.icon + rv.name + ' 把' + C.regionMap[rid0].name + '门店升级到 ' + lv + ' 级旗舰店。'); }
    }
    /* 4.2b 有闲钱先还债（高杠杆的远洋商贸） */
    if (rv.debt > 0 && rv.cash > 60000) { var pay = Math.min(rv.debt, 10000); rv.debt -= pay; rv.cash -= pay; }
    /* 4.3 价格战：先算账再出手（见下方 planWar） */
    planWar(S, rv);
    /* 4.4 挖人：盯上你能力强、忠诚度不高的员工（高端型最爱挖人） */
    if (!pendingOf(S, 'poach') && !Rv.allied(S, rv) && rng.chance(0.03 * (rv.style === 'premium' ? 2 : 1))) {
      var best = null, bs = 0;
      biz.shops.forEach(function (sh) { sh.employees.forEach(function (e) {
        var t = C.traitMap[e.trait] || {}, score = e.skill + e.service - (t.loyalty ? 2 : 0);
        if (!e.equity && e.skill + e.service >= 4 && e.loyalty < 80 && score > bs) { bs = score; best = { sh: sh, e: e }; } /* 拿了股权激励的员工挖不走 */
      }); });
      if (best) {
        var wage = Math.round(best.e.wage * rng.range(1.25, 1.45) + 10);
        addDeal(S, { type: 'poach', rivalId: rv.id, shopId: best.sh.id, empId: best.e.id, wage: wage, expire: S.day + 1,
          text: rv.icon + rv.name + ' 想挖走你在' + C.regionMap[best.sh.regionId].name + '店的' + Biz().roleOf(best.e.role).name + ' ' + best.e.name + '（销售' + best.e.skill + '/服务' + best.e.service + '），开出日薪 ' + U.money(wage) + '。' });
        BT.Bus.emit('fx', { kind: 'alert', text: '🕵️ ' + rv.name + ' 来挖人了' });
      }
    }
    /* 4.5 资金链断裂：卖店求生（优先问玩家要不要接手） */
    if (rv.cash < 0 && U.keys(rv.shops).length) {
      if (!dealFor(S, rv.id, 'sellShop')) {
        var worst = U.keys(rv.shops).sort(function (a, b) { return rv.shops[a].rep - rv.shops[b].rep; })[0], s0 = rv.shops[worst];
        var price = Math.round(shopCost(worst, s0.level) * 0.7);
        addDeal(S, { type: 'sellShop', rivalId: rv.id, regionId: worst, level: s0.level, rep: s0.rep, price: price, expire: S.day + 2,
          text: rv.icon + rv.name + ' 资金紧张，愿以 ' + U.money(price) + ' 把' + C.regionMap[worst].name + '的 ' + s0.level + ' 级门店（口碑 ' + Math.round(s0.rep) + '）转让给你。' });
      }
    }
    /* 4.6 收购玩家的亏损门店 */
    if (rv.cash > 15000 && !dealFor(S, rv.id, 'buyMyShop')) {
      biz.shops.forEach(function (sh) {
        var ph = sh.profitHist || []; if (ph.length < 7 || pendingOf(S, 'buyMyShop')) return;
        var last7 = ph.slice(-7);
        if (last7.every(function (p) { return p < 0; }) && rng.chance(0.15)) {
          var inv = U.sum(U.keys(sh.inventory), function (g) { return (sh.inventory[g] || 0) * BT.Eco.buyPrice(S, g, sh.regionId) * 0.8; });
          var p = Math.round((sh.value || 0) * 1.1 + inv);
          addDeal(S, { type: 'buyMyShop', rivalId: rv.id, shopId: sh.id, price: p, expire: S.day + 3,
            text: rv.icon + rv.name + ' 看中你连续亏损的' + C.regionMap[sh.regionId].name + '店，出价 ' + U.money(p) + '（含库存）整体买下。' });
        }
      });
    }
  }
  /* ========================================================================
   * 四·一、价格战的“算账”决策
   *   收益 = 预计从你手里抢走的份额 × 区域客流池 × 正常毛利 × 回本周期（+ 把你挤出该区的可能）
   *   成本 = 开战天数 × 自己在该区的营收 × 让利损失
   *   打分 = (收益 − 成本) / 客流池 × 激进度 × 风格 × 敌意 × (1 − 怕你程度)；钱不够撑完全程就不打
   * ===================================================================== */
  var STYLE_K = { premium: 0.3, balanced: 1, discount: 1.25, aggressive: 1.35 };
  /** 价格战里这家店的让利情况：f = 被点名的货占它销售的比例，depth = 这些货比平时便宜了多少（按真实标价算） */
  Rv.warStats = function (S, rv, rid) {
    var cp = rv.camp[rid]; if (!cp || cp.on !== 'me' || !cp.goods.length) return { f: 0, depth: 0 };
    var mine = S.biz.shops.filter(function (s) { return s.regionId === rid; })[0], ds = [];
    cp.goods.forEach(function (g) {
      var normal = Rv.unitCost(S, rv, rid, g) * Rv.markupAt(rv, rid);
      var ref = mine ? ((mine.effP && mine.effP[g]) || BT.Eco.buyPrice(S, g, rid) * (mine.shelf[g] || 1.3)) : normal;
      var p = Rv.priceOf(S, rv, rid, g, ref); if (p > 0 && normal > 0) ds.push(U.clamp(1 - p / normal, 0, 0.6));
    });
    return { f: Math.min(0.6, 0.2 * cp.goods.length), depth: ds.length ? U.sum(ds) / ds.length : 0 };
  };
  function pool(rv, rid) { return C.regionMap[rid].traffic * 55 * 2.2 * TICKET[rv.style]; }
  function shareOf(list, id) { var x = list.filter(function (y) { return id === 'me' ? y.me : y.id === id; })[0]; return x ? x.share : 0; }
  function onMeCount(S) {
    return Rv.alive(S).filter(function (r) { return (r.plan && r.plan.on === 'me') || U.keys(r.camp).some(function (k) { return r.camp[k].on === 'me' && r.war[k] > 0; }); }).length;
  }
  function evalWar(S, rv, sh) {
    var rid = sh.regionId, shs = Rv.shares(S, rid), me = shareOf(shs, 'me'), it = shareOf(shs, rv.id);
    if (!me || !it) return null;
    var P = pool(rv, rid), rn = C.regionMap[rid].name;
    if (me < it * 0.8 && me < 0.3) return { score: -1, rid: rid, why: rn + '：你的份额不大（' + Math.round(me * 100) + '%），不值得打' };
    var pred = rv.tier === 'big' && rv.cash > 120000 && me > 0.28 && me >= it * 0.9; /* 巨头：你在它地盘上份额接近或超过它 → 下死手 */
    var days = pred ? 23 : 11, swing = pred ? 0.18 : 0.10;
    /* 把你挤出去的可能：你这家店最近老亏、你现金紧 → 更想下死手 */
    var ph = (sh.profitHist || []).slice(-14), losing = ph.filter(function (x) { return x < 0; }).length;
    var pKill = U.clamp(0.1 + losing / 14 * 0.5 + (S.cash < 5000 ? 0.25 : 0), 0, 0.85);
    var gain = swing * P * 0.3 * (pred ? 90 : 45) + me * P * 0.3 * 90 * pKill * (pred ? 1 : 0.4);
    /* 成本 = 每天促销补贴 + 让利损失（和 rivalEconomy 的记账一致） */
    var cost = days * P * ((pred ? 0.22 : 0.12) + (it + swing / 2) * (pred ? 0.21 : 0.075));
    if (cost > rv.cash * (rv.tier === 'big' ? 0.5 : 0.3)) return { score: -1, rid: rid, why: rn + '：想打，但钱撑不住（要烧 ¥' + Math.round(cost) + '）' };
    var hostile = 1 + Math.max(0, -rv.att) / 60, angry = rv.angryUntil >= S.day ? 1.5 : 1;
    var score = (gain - cost) / P * rv.aggr * (STYLE_K[rv.style] || 1) * hostile * angry * (1 - Math.min(0.85, rv.fear));
    return { score: score, rid: rid, mode: pred ? 'predatory' : 'undercut', days: days, gain: gain, cost: cost, me: me, it: it, shop: sh,
      why: rn + '：预计收益 ¥' + Math.round(gain) + ' / 成本 ¥' + Math.round(cost) + ' → ' + (score > 0 ? '有利可图' : '不划算') };
  }
  function topGoods(sh, n) {
    var s7 = sh.sold7 || {};
    var ks = U.keys(sh.shelf).filter(function (g) { return C.goodsMap[g] && !C.goodsMap[g].lux; });
    ks.sort(function (a, b) { return (s7[b] || 0) - (s7[a] || 0); });
    return ks.slice(0, n);
  }
  function planWar(S, rv) {
    var biz = S.biz, CP = C.COMPETE;
    if (rv.plan || U.keys(rv.war).length || S.day < rv.nextWar) {
      if (!U.keys(rv.war).length && !rv.plan) { if (!(rv.moodDay > S.day - 7) || Rv.allied(S, rv) || rv.cash < 0) rv.mood = Rv.allied(S, rv) ? '盟友' : (rv.cash < 0 ? '资金紧张' : '休整'); if (!Rv.allied(S, rv) && S.day - (biz.founded || 0) >= CP.grace) planTactics(S, rv); } /* 价格战冷却期也可能锁货 / 抢铺 */
      return;
    }
    var best = null;
    if (Rv.allied(S, rv)) { rv.mood = '盟友'; rv.thought = '和你有盟约，不会对你动手'; return; }
    if (S.day - (biz.founded || 0) >= CP.grace && planTactics(S, rv)) return; /* 锁供应 / 抢铺位 */
    if (S.day - (biz.founded || 0) >= CP.grace && onMeCount(S) < CP.maxOnMe) biz.shops.forEach(function (sh) {
      if (!rv.shops[sh.regionId] || sh.closedDays > 0) return;
      var ev = evalWar(S, rv, sh); if (ev && (!best || ev.score > best.score)) best = ev;
    });
    rv.thought = best ? best.why : (S.day - (biz.founded || 0) < CP.grace ? '先观察这家新公司' : '没有和你正面交锋的门店');
    if (!(rv.moodDay > S.day - 7) || rv.cash < 0) rv.mood = rv.cash < 0 ? '资金紧张' : '观望';
    if (best && best.score > 0 && rng.chance(Math.min(0.08, best.score * 0.06))) {
      var goods = topGoods(best.shop, best.mode === 'predatory' ? 3 : rng.int(1, 2));
      if (!goods.length) return;
      var days = best.mode === 'predatory' ? rng.int(18, 28) : rng.int(8, 14);
      rv.plan = { act: 'war', on: 'me', rid: best.rid, goods: goods, mode: best.mode, days: days, start: S.day + rng.int(1, 3),
        cut: U.round2(best.mode === 'predatory' ? 0.15 : 0.06 + rv.aggr * 0.06) };
      rv.mood = '筹备进攻';
      var gn = goods.map(function (g) { return C.goodsMap[g].icon + C.goodsMap[g].name; }).join('、'), rn = C.regionMap[best.rid].name;
      if (rv.intelUntil >= S.day) news(S, '🕵️ 内线消息：' + rv.icon + rv.name + ' 将在第 ' + rv.plan.start + ' 天于' + rn + '对你的 ' + gn + ' 发起' + (best.mode === 'predatory' ? '「掠夺性定价」（亏本卖，约 ' + days + ' 天）' : '价格战（比你便宜约 ' + Math.round(rv.plan.cut * 100) + '%，约 ' + days + ' 天）') + '。', 'bad');
      else if (best.mode === 'predatory') news(S, '📡 风声：' + rv.icon + rv.name + ' 总部给' + rn + '门店追加了一大笔预算，还在大量进 ' + gn + '，看样子要打持久战。', 'bad');
      else news(S, '📡 风声：' + rv.icon + rv.name + ' 在' + rn + '大量进 ' + gn + '，门店贴出了「即将大促」的海报（可能就在这几天）。', 'bad');
      return;
    }
    /* 巨头欺负弱小：同区有现金吃紧的中型对手 → 趁火打劫（顺带也会挤到你） */
    if (rv.tier === 'big' && rv.cash > 60000) {
      U.keys(rv.shops).some(function (rid) {
        var prey = Rv.alive(S).filter(function (o) { return o !== rv && o.tier === 'mid' && o.shops[rid] && o.cash < 15000; })[0];
        if (!prey || !rng.chance(0.06)) return false;
        rv.war[rid] = rng.int(10, 16); rv.camp[rid] = { on: prey.id, goods: [], mode: 'undercut', cut: 0, spent: 0, start: S.day };
        rv.mood = '围剿 ' + prey.name;
        news(S, '🦈 ' + rv.icon + rv.name + ' 趁' + prey.icon + prey.name + ' 资金吃紧，在' + C.regionMap[rid].name + '打起价格战想把它挤出去' + (biz.shops.some(function (s) { return s.regionId === rid; }) ? '，你的店也会被殃及。' : '。'), 'event');
        return true;
      });
    }
  }
  /** 预告到期 → 正式开战 */
  function launchPlan(S, rv) {
    var pl = rv.plan; if (!pl || S.day < pl.start) return;
    rv.plan = null;
    if (pl.act === 'lock') return launchLock(S, rv, pl);
    if (pl.act === 'site') return launchSite(S, rv, pl);
    var mine = S.biz.shops.filter(function (s) { return s.regionId === pl.rid; })[0];
    if (!mine || !rv.shops[pl.rid]) { rv.mood = '观望'; return; }
    var my0 = shareOf(Rv.shares(S, pl.rid), 'me');
    rv.war[pl.rid] = pl.days;
    rv.camp[pl.rid] = { on: 'me', goods: pl.goods, mode: pl.mode, cut: pl.cut, my0: my0, cash0: rv.cash, spent: 0, matched: 0, start: S.day };
    rv.mem.wars++; rv.mood = pl.mode === 'predatory' ? '掠夺定价' : '价格战';
    var gn = pl.goods.map(function (g) { return C.goodsMap[g].icon + C.goodsMap[g].name; }).join('、'), rn = C.regionMap[pl.rid].name;
    news(S, (pl.mode === 'predatory' ? '🩸 ' + rv.icon + rv.name + ' 在' + rn + '对 ' + gn + ' 搞「掠夺性定价」：低于成本卖，约 ' + pl.days + ' 天，想把你挤出去！'
      : '⚔️ ' + rv.icon + rv.name + ' 在' + rn + '发起价格战：' + gn + ' 比你便宜约 ' + Math.round(pl.cut * 100) + '%，你降价它也跟，约 ' + pl.days + ' 天。') +
      ' 对策：门店页开「自动应战」、搞促销，或者换货避开。', 'bad');
    BT.Bus.emit('fx', { kind: 'alert', text: (pl.mode === 'predatory' ? '🩸 ' : '⚔️ ') + rv.name + ' 打过来了！' });
    /* 盟友联手：巨头打你，同区的盟友也对它开战，分走它的客流 */
    if (rv.tier === 'big') Rv.alive(S).forEach(function (a) {
      if (a === rv || !Rv.allied(S, a) || !a.shops[pl.rid] || a.war[pl.rid] > 0) return;
      a.war[pl.rid] = Math.min(pl.days, rng.int(8, 14)); a.camp[pl.rid] = { on: rv.id, goods: [], mode: 'undercut', cut: 0, spent: 0, start: S.day }; a.mood = '援助盟友';
      news(S, '🤝 盟友 ' + a.icon + a.name + ' 出手：在' + C.regionMap[pl.rid].name + '对 ' + rv.name + ' 也打起价格战，帮你分担压力。', 'good');
    });
  }
  /** 价格战结束：看战果，更新记忆（你扛住了 → 它更怕你；你被打退 → 它更敢来） */
  function endCampaign(S, rv, rid, retreat) {
    var cp = rv.camp[rid]; delete rv.war[rid]; delete rv.camp[rid];
    var rn = C.regionMap[rid].name;
    rv.nextWar = S.day + 25;
    if (!cp || cp.on !== 'me') { news(S, '🕊️ ' + rv.icon + rv.name + ' 在' + rn + '的价格战告一段落。', 'event'); rv.mood = '休整'; return; }
    var hasShop = S.biz.shops.some(function (s) { return s.regionId === rid; });
    var now = hasShop ? shareOf(Rv.shares(S, rid), 'me') : 0, drop = (cp.my0 || 0) - now;
    var beat = !hasShop || drop >= Math.max(0.03, (cp.my0 || 0) * 0.15); /* 你的份额掉了 15% 以上（相对）算它赢 */
    var spent = Math.round(cp.spent || 0);
    if (!retreat && beat) {
      rv.mem.won++; rv.fear = Math.max(0, rv.fear - 0.1); rv.att = U.clamp(rv.att + 5, -100, 100); rv.mood = '得胜休整';
      rv.lastWar = { day: S.day, rid: rid, win: true, spent: spent, drop: drop };
      news(S, '💔 ' + rv.icon + rv.name + ' 在' + rn + '的价格战结束：' + (hasShop ? '你的份额从 ' + Math.round(cp.my0 * 100) + '% 掉到 ' + Math.round(now * 100) + '%' : '你已经撤出了') + '，它花了约 ' + U.money(spent) + '。尝到甜头，它以后会更敢来。', 'bad');
    } else {
      rv.mem.lost++; rv.fear = Math.min(0.85, rv.fear + 0.25 + ((cp.matched || 0) >= 3 ? 0.1 : 0)); rv.att = U.clamp(rv.att - 5, -100, 100); rv.mood = '舔伤口';
      rv.lastWar = { day: S.day, rid: rid, win: false, spent: spent, drop: drop };
      news(S, '🛡️ ' + rv.icon + rv.name + (retreat ? ' 资金吃紧，提前撤出了' : ' 结束了') + rn + '的价格战：烧掉约 ' + U.money(spent) + '，也没能撼动你（份额 ' + Math.round((cp.my0 || 0) * 100) + '% → ' + Math.round(now * 100) + '%）。它记住了你不好惹。', 'good');
    }
  }
  /** 态度：你抢它地盘、比它便宜、刺探被抓 → 越来越敌对；时间会慢慢冲淡 */
  function updateAttitude(S, rv) {
    rv.att += (0 - rv.att) * 0.01;
    S.biz.shops.forEach(function (sh) {
      var rid = sh.regionId; if (!rv.shops[rid]) return;
      if (rv.seen.indexOf(rid) < 0) { rv.seen.push(rid); if ((sh.daysOpen || 0) <= 2) rv.att -= 12; } /* 你刚在它的地盘开店 */
      var shs = Rv.shares(S, rid), me = shareOf(shs, 'me'), it = shareOf(shs, rv.id);
      if (me > it) rv.att -= Math.min(1.2, (me - it) * 4);
      if (Rv.playerPriceMul(S, sh) > priceMul(Rv.markupAt(rv, rid), rid) + 0.03) rv.att -= 0.2; /* 你比它便宜 */
    });
    if (rv.angryUntil >= S.day && !rv.angryNoted) { rv.angryNoted = true; rv.att -= 30; }
    if (!(rv.angryUntil >= S.day)) rv.angryNoted = false;
    rv.att = U.clamp(rv.att, -100, 100);
    rv.fear = Math.max(0, rv.fear - 0.002);
  }
  Rv.attLabel = function (att) {
    return att <= -50 ? { t: '敌对', c: 'down' } : (att <= -15 ? { t: '警惕', c: 'warn' } : (att < 25 ? { t: '中立', c: '' } : { t: '友好', c: 'up' }));
  };
  /** 正在 / 即将针对你的行动（UI 用） */
  Rv.threats = function (S) {
    var out = [];
    Rv.alive(S).forEach(function (rv) {
      if (rv.plan && rv.plan.on === 'me') out.push({ rv: rv, rid: rv.plan.rid, kind: 'plan', act: rv.plan.act || 'war', mode: rv.plan.mode, goods: rv.plan.goods || [], cut: rv.plan.cut, left: rv.plan.start - S.day, exact: rv.intelUntil >= S.day });
      U.keys(rv.camp).forEach(function (rid) { var cp = rv.camp[rid]; if (cp.on === 'me' && rv.war[rid] > 0) out.push({ rv: rv, rid: rid, kind: 'war', mode: cp.mode, goods: cp.goods, cut: cp.cut, left: rv.war[rid], spent: Math.round(cp.spent || 0), my0: cp.my0 }); });
    });
    var b = S.biz;
    U.keys(b.locks || {}).forEach(function (g) { var lk = b.locks[g], rv = Rv.get(S, lk.by); if (lk.until >= S.day && rv) out.push({ rv: rv, kind: 'lock', gid: g, mul: lk.mul, left: lk.until - S.day + 1, goods: [g] }); });
    U.keys(b.sites || {}).forEach(function (rid) { var st = b.sites[rid], rv = Rv.get(S, st.by); if (st.until >= S.day && rv) out.push({ rv: rv, rid: rid, kind: 'site', left: st.until - S.day + 1, goods: [] }); });
    b.shops.forEach(function (sh) { var hk = sh.hike, rv = hk && Rv.get(S, hk.by); if (hk && hk.until >= S.day && rv) out.push({ rv: rv, rid: sh.regionId, kind: 'hike', mul: hk.mul, left: hk.until - S.day + 1, goods: [] }); });
    return out;
  };
  /* 测试 / 调试入口 */
  Rv._t = { planWar: planWar, launchPlan: launchPlan, endCampaign: endCampaign, evalWar: evalWar, giantTick: function (S) { giantTick(S); }, normRival: normRival, planTactics: function (S, rv) { return planTactics(S, rv); }, probeTick: function (S) { probeTick(S); }, allyTick: function (S) { allyTick(S); } };
  /* ========================================================================
   * 四·二、竞争第二步：锁供应 / 抢铺位 / 结盟 / 反垄断（v7.3）
   * ===================================================================== */
  Rv.allied = function (S, rv) { return !!(rv && rv.ally && rv.ally.until >= S.day && rv.alive); };
  /** 某样货是否被锁（独家供货协议） */
  Rv.lockOn = function (S, gid) { var lk = S.biz && S.biz.locks && S.biz.locks[gid]; return lk && lk.until >= S.day ? lk : null; };
  /** 某区路口旺铺是否被对手占着 */
  Rv.cornerTaken = function (S, rid) { var st = S.biz && S.biz.sites && S.biz.sites[rid]; return st && st.until >= S.day ? st : null; };
  /** 你全公司卖得最好的货（锁供应的目标）：近 7 天销量，签了长约的不算 */
  function myTopGoods(S) {
    var tot = {};
    S.biz.shops.forEach(function (sh) { U.keys(sh.sold7 || {}).forEach(function (g) { if (!C.goodsMap[g].lux) tot[g] = (tot[g] || 0) + sh.sold7[g] * BT.Eco.buyPrice(S, g, sh.regionId); }); });
    return U.keys(tot).filter(function (g) { return !(BT.Supply && BT.Supply.contract(S, g)) && !Rv.lockOn(S, g); }).sort(function (a, b) { return tot[b] - tot[a]; });
  }
  /** 敌意够深的对手，除了价格战还会用别的手段：锁货、抢铺、抬租。返回 true = 已安排行动 */
  function planTactics(S, rv) {
    var biz = S.biz; biz.locks = biz.locks || {}; biz.sites = biz.sites || {};
    if (rv.att > -25 || rv.plan) return false;
    var hostile = Math.min(1.5, -rv.att / 60) * (1 - Math.min(0.85, rv.fear)) * (rv.angryUntil >= S.day ? 1.5 : 1);
    var intel = rv.intelUntil >= S.day;
    /* 锁供应：巨头或现金 8 万以上的才谈得下独家协议；同时最多锁 1 样 */
    var lockActive = U.keys(biz.locks).some(function (g) { return biz.locks[g].by === rv.id && biz.locks[g].until >= S.day; });
    if (!lockActive && S.day >= (rv.nextLock || 0) && (rv.tier === 'big' || rv.cash > 80000) && rng.chance(0.025 * hostile)) {
      var g = myTopGoods(S)[0];
      if (g) {
        rv.plan = { act: 'lock', on: 'me', gid: g, goods: [g], days: rng.int(20, 30), start: S.day + 2, mul: 1.3 };
        rv.mood = '筹备锁货'; rv.nextLock = S.day + 60;
        var gn = C.goodsMap[g].icon + C.goodsMap[g].name;
        news(S, intel ? '🕵️ 内线消息：' + rv.icon + rv.name + ' 第 ' + rv.plan.start + ' 天要和 ' + gn + ' 的供应商签独家协议，之后你批发它要贵 30%（约 ' + rv.plan.days + ' 天）。现在签「长期供货合同」可以躲开。'
          : '📡 风声：' + rv.icon + rv.name + ' 的采购总监最近频繁拜访 ' + gn + ' 的供应商，可能要搞独家供货。签了长约的不受影响。', 'bad');
        return true;
      }
    }
    /* 抢铺位：你在它也有店的区赚钱 → 你开的是路口旺铺就去找房东抬你的租，否则先把旺铺占了 */
    if (S.day >= (rv.nextSite || 0) && rv.cash > 50000 && rng.chance(0.02 * hostile)) {
      var sh = biz.shops.filter(function (x) { return rv.shops[x.regionId] && x.last && x.last.profit > 0 && !(x.hike && x.hike.until >= S.day); })[0];
      if (sh) {
        var hike = sh.loc === 'corner' && !(S.estate && S.estate[sh.regionId]);
        if (!hike && Rv.cornerTaken(S, sh.regionId)) return false;
        rv.plan = { act: 'site', on: 'me', rid: sh.regionId, hike: hike, shopId: sh.id, goods: [], days: hike ? 45 : 90, start: S.day + 2 };
        rv.mood = hike ? '找房东抬租' : '抢旺铺'; rv.nextSite = S.day + 70;
        var rn = C.regionMap[sh.regionId].name;
        news(S, hike ? '📡 风声：' + rv.icon + rv.name + ' 在打听你' + rn + '店那间路口旺铺的房东，想出高价挖走你的铺面。买下物业（帝国页）就不怕。'
          : '📡 风声：' + rv.icon + rv.name + ' 在谈' + rn + '路口旺铺的租约，想把最好的位置先占了。', 'bad');
        return true;
      }
    }
    return false;
  }
  function launchLock(S, rv, pl) {
    var g = C.goodsMap[pl.gid], gn = g.icon + g.name;
    if (BT.Supply && BT.Supply.contract(S, pl.gid)) { rv.mood = '观望'; news(S, '🛡️ ' + rv.icon + rv.name + ' 和 ' + gn + ' 的供应商签了独家协议，但你手上有长约，影响不到你。', 'good'); return; }
    S.biz.locks[pl.gid] = { by: rv.id, until: S.day + pl.days - 1, mul: pl.mul, start: S.day };
    rv.cash -= 4000 + Math.round(g.base * 150); rv.mood = '锁供应';
    news(S, '🔒 ' + rv.icon + rv.name + ' 拿下了 ' + gn + ' 的独家供货：接下来约 ' + pl.days + ' 天你批发它要贵 ' + Math.round((pl.mul - 1) * 100) + '%。对策：签长期供货合同、换货卖，或者去举报它（排他协议违反反垄断）。', 'bad');
    BT.Bus.emit('fx', { kind: 'alert', text: '🔒 ' + g.name + ' 被锁货了' });
  }
  function launchSite(S, rv, pl) {
    var biz = S.biz, rn = C.regionMap[pl.rid].name;
    var sh = biz.shops.filter(function (x) { return x.id === pl.shopId; })[0];
    if (pl.hike) {
      if (!sh || sh.loc !== 'corner' || (S.estate && S.estate[pl.rid])) { rv.mood = '观望'; return; }
      sh.hike = { by: rv.id, mul: 1.25, until: S.day + pl.days - 1 };
      rv.cash -= 6000; rv.mood = '抬租';
      news(S, '🏚️ ' + rv.icon + rv.name + ' 给房东出了高价：你' + rn + '店的房租上涨 25%，持续约 ' + pl.days + ' 天。买下物业就免租。', 'bad');
    } else {
      if (Rv.cornerTaken(S, pl.rid)) return;
      biz.sites[pl.rid] = { by: rv.id, until: S.day + pl.days - 1 };
      rv.cash -= 5000; rv.mood = '占旺铺';
      if (rv.shops[pl.rid]) rv.shops[pl.rid].rep = Math.min(90, rv.shops[pl.rid].rep + 5);
      news(S, '📍 ' + rv.icon + rv.name + ' 签下了' + rn + '的路口旺铺：约 ' + pl.days + ' 天内你在这个区开不了 / 搬不进路口旺铺。', 'bad');
    }
  }

  /* ---- 结盟：只和区域连锁结（巨头看不上你）。互不侵犯 90 天：它不打你、不跟你开店、不挖你的人；巨头打你时它会帮忙 ---- */
  Rv.allyFee = function (S, rv) { return Math.round(5000 + Rv.valuation(S, rv) * 0.04); };
  Rv.allyChance = function (S, rv) {
    var bigThreat = Rv.alive(S).some(function (o) { return o.tier === 'big' && o !== rv && U.keys(o.shops).some(function (r) { return rv.shops[r]; }); });
    return U.clamp(0.45 + rv.att / 100 + (bigThreat ? 0.25 : 0) + (rv.cash < 15000 ? 0.15 : 0) - (rv.mem.lost ? 0 : 0.05), 0.05, 0.95);
  };
  Rv.proposeAlly = function (S, id) {
    var rv = Rv.get(S, id); if (!rv || !rv.alive) return { ok: false, msg: '这家公司已经不在了' };
    if (rv.tier === 'big') return { ok: false, msg: rv.name + ' 是巨头，看不上和你结盟' };
    if (Rv.allied(S, rv)) return { ok: false, msg: '已经是盟友了（还剩 ' + (rv.ally.until - S.day) + ' 天）' };
    if (rv.allyAsk && S.day - rv.allyAsk < 10) return { ok: false, msg: '刚被拒绝过，' + (rv.allyAsk + 10 - S.day) + ' 天后再谈' };
    if (rv.att <= -50) return { ok: false, msg: rv.name + ' 对你充满敌意，根本不肯谈' };
    if (U.keys(rv.camp).some(function (k) { return rv.camp[k].on === 'me' && rv.war[k] > 0; })) return { ok: false, msg: '它正在和你打价格战，先打完再谈' };
    var fee = Rv.allyFee(S, rv); if (S.cash < fee) return { ok: false, msg: '结盟诚意金不够（' + U.money(fee) + '）' };
    if (!rng.chance(Rv.allyChance(S, rv))) { rv.allyAsk = S.day; return { ok: false, msg: rv.name + ' 婉拒了结盟（10 天后可以再谈）' }; }
    BT.Eco.pay(S, fee, '结盟诚意金：' + rv.name);
    rv.ally = { since: S.day, until: S.day + 90 }; rv.att = Math.max(rv.att, 30); rv.plan = null; rv.mood = '盟友';
    news(S, '🤝 你和 ' + rv.icon + rv.name + ' 签了 90 天互不侵犯协议：它不打你、不跟你抢区、不挖你的人；巨头打你时它会出手。', 'good');
    return { ok: true, msg: '结盟成功' };
  };
  Rv.breakAlly = function (S, id) {
    var rv = Rv.get(S, id); if (!Rv.allied(S, rv)) return { ok: false, msg: '你们没有盟约' };
    rv.ally = null; rv.att -= 25;
    news(S, '💔 你单方面解除了和 ' + rv.name + ' 的盟约，它很不爽。', 'bad');
    return { ok: true, msg: '已解除盟约' };
  };
  function allyTick(S) {
    Rv.alive(S).forEach(function (rv) {
      if (!rv.ally) return;
      if (rv.ally.until < S.day) { rv.ally = null; news(S, '📜 和 ' + rv.icon + rv.name + ' 的盟约到期了，可以续约。', 'event'); return; }
      rv.att = Math.max(rv.att, 20);
      if (rv.cash < 3000 || rng.chance(0.002)) { /* 自身难保 / 被巨头收买 → 背盟 */
        rv.ally = null; rv.att = -10;
        news(S, '🗡️ ' + rv.icon + rv.name + ' 背弃了盟约（' + (rv.cash < 3000 ? '它自己快撑不住了' : '传闻被巨头收买') + '），以后小心它。', 'bad');
      }
    });
  }

  /* ---- 反垄断：举报对手（掠夺定价 / 排他锁货 / 一家独大），监管调查 10~15 天出结果；你自己一家独大也会被查 ---- */
  Rv.REPORT_COST = 3000;
  /** 市场支配力：按区域人流加权的全城份额、份额超过 55% 的区数 */
  Rv.power = function (S, id) {
    var tw = 0, sw = 0, dom = 0;
    C.REGIONS.forEach(function (r) { var s = shareOf(Rv.shares(S, r.id), id); tw += r.traffic; sw += s * r.traffic; if (s > 0.55) dom++; });
    return { city: tw ? sw / tw : 0, dom: dom };
  };
  Rv.evidence = function (S, rv) {
    var pw = Rv.power(S, rv.id), ev = [];
    if (U.keys(rv.camp).some(function (k) { return rv.camp[k].on === 'me' && rv.camp[k].mode === 'predatory' && rv.war[k] > 0; })) ev.push({ k: 'pred', t: '低于成本倾销', p: 0.35 });
    if (U.keys(S.biz.locks || {}).some(function (g) { return S.biz.locks[g].by === rv.id && S.biz.locks[g].until >= S.day; })) ev.push({ k: 'lock', t: '排他性独家供货', p: 0.3 });
    if (pw.city > 0.35 || pw.dom >= 2) ev.push({ k: 'dom', t: '市场支配地位（全城 ' + Math.round(pw.city * 100) + '%，' + pw.dom + ' 个区过半）', p: 0.3 });
    if (U.keys(rv.camp).some(function (k) { return rv.camp[k].on === 'me' && rv.camp[k].mode !== 'predatory' && rv.war[k] > 0; })) ev.push({ k: 'war', t: '针对性压价（证据较弱）', p: 0.05 });
    return ev;
  };
  Rv.reportChance = function (S, rv) { return U.clamp(0.05 + U.sum(Rv.evidence(S, rv), function (e) { return e.p; }), 0.05, 0.9); };
  Rv.report = function (S, id) {
    var rv = Rv.get(S, id); if (!rv || !rv.alive) return { ok: false, msg: '这家公司已经不在了' };
    var biz = S.biz; biz.probes = biz.probes || [];
    if (biz.probes.some(function (p) { return p.rivalId === id; })) return { ok: false, msg: '监管已经在查它了' };
    if (S.cash < Rv.REPORT_COST) return { ok: false, msg: '律师费不够（' + U.money(Rv.REPORT_COST) + '）' };
    var ev = Rv.evidence(S, rv), p = Rv.reportChance(S, rv);
    BT.Eco.pay(S, Rv.REPORT_COST, '反垄断举报律师费');
    biz.probes.push({ rivalId: id, until: S.day + rng.int(10, 15), p: p, ev: ev.map(function (e) { return e.k; }), day: S.day });
    rv.att -= 15;
    news(S, '⚖️ 你向市场监管局举报了 ' + rv.icon + rv.name + (ev.length ? '（' + ev.map(function (e) { return e.t; }).join('、') + '）' : '（证据不足）') + '，调查约 10~15 天出结果。', 'event');
    return { ok: true, msg: '举报已受理，胜算约 ' + Math.round(p * 100) + '%' };
  };
  function probeTick(S) {
    var biz = S.biz; biz.probes = biz.probes || [];
    biz.probes = biz.probes.filter(function (pr) {
      if (S.day < pr.until) return true;
      var rv = Rv.get(S, pr.rivalId); if (!rv || !rv.alive) return false;
      if (rng.chance(pr.p)) {
        var fine = Math.round(15000 + Rv.valuation(S, rv) * 0.08) * (rv.tier === 'big' ? 2 : 1);
        rv.cash -= fine; rv.fear = Math.min(0.85, rv.fear + 0.3); rv.att -= 10; rv.nextWar = S.day + 60; rv.nextLock = S.day + 90; rv.nextSite = S.day + 90; rv.plan = null;
        U.keys(rv.camp).forEach(function (k) { if (rv.camp[k].on === 'me') { delete rv.war[k]; delete rv.camp[k]; } });
        U.keys(biz.locks || {}).forEach(function (g) { if (biz.locks[g].by === rv.id) delete biz.locks[g]; });
        U.keys(biz.sites || {}).forEach(function (r) { if (biz.sites[r].by === rv.id) delete biz.sites[r]; });
        biz.shops.forEach(function (sh) { if (sh.hike && sh.hike.by === rv.id) delete sh.hike; });
        rv.mood = '被罚整改';
        news(S, '⚖️ 监管裁定 ' + rv.icon + rv.name + ' 违反反垄断法：罚款 ' + U.money(fine) + '，立即停止针对你的价格战 / 锁货 / 抢铺，60 天内不得再犯。', 'good');
        BT.Bus.emit('fx', { kind: 'level', text: '⚖️ 举报成功：' + rv.name + ' 被罚' });
        /* 一家独大：责令剥离一家门店，优先卖给你 */
        if (pr.ev.indexOf('dom') >= 0) {
          var rid = U.keys(rv.shops).sort(function (a, b) { return shareOf(Rv.shares(S, b), rv.id) - shareOf(Rv.shares(S, a), rv.id); })[0];
          if (rid && U.keys(rv.shops).length > 1 && !biz.shops.some(function (s) { return s.regionId === rid; })) {
            var s0 = rv.shops[rid], price = Math.round(C.regionMap[rid].rent * 45 * s0.level * 0.6);
            addDeal(S, { type: 'sellShop', rivalId: rv.id, regionId: rid, level: s0.level, rep: s0.rep, price: price, expire: S.day + 3, forced: true,
              text: '⚖️ 监管责令 ' + rv.name + ' 剥离' + C.regionMap[rid].name + '的 ' + s0.level + ' 级门店，优先以 ' + U.money(price) + ' 转让给你。' });
          }
        }
      } else {
        biz.creditScore = U.clamp(biz.creditScore - 10, 300, 850); rv.att -= 20;
        news(S, '⚖️ 对 ' + rv.icon + rv.name + ' 的反垄断调查结束：证据不足，不予处罚。它记恨上你了，你的信用也 −10。', 'bad');
      }
      return false;
    });
    /* 你自己一家独大：监管同样会查你 */
    var me = Rv.power(S, 'me');
    if (me.city > 0.4 || me.dom >= 2) {
      if (!biz.atWarn) { biz.atWarn = S.day; news(S, '⚠️ 市场监管局注意到你的市场份额过高（全城 ' + Math.round(me.city * 100) + '%，' + me.dom + ' 个区过半），继续扩张可能被反垄断调查。', 'bad'); }
      else if (S.day - biz.atWarn > 20 && rng.chance(0.01)) {
        var f = Math.round(Math.max(5000, BT.netWorth(S) * 0.03)); BT.Eco.pay(S, f, '反垄断罚款'); biz.atWarn = S.day;
        news(S, '⚖️ 你因市场支配地位被监管罚款 ' + U.money(f) + '。', 'bad');
      }
    } else if (biz.atWarn && me.city < 0.32) biz.atWarn = 0;
  }

  /** 外来巨头：你的公司做大后，全国连锁巨头会宣布进军新港市（提前 10 天预告），落地在你最赚钱的区域 */
  function giantTick(S) {
    var biz = S.biz, G = C.GIANT; if (!G) return;
    if (!biz.giant) {
      var big = biz.shops.length >= 3 || BT.netWorth(S) >= 120000;
      if (S.day - (biz.founded || 0) >= C.COMPETE.giantDay && big && rng.chance(0.03)) {
        biz.giant = { announce: S.day, arrive: S.day + 10 };
        news(S, '📰 重磅：全国连锁巨头' + G.icon + G.name + ' 宣布 10 天后进军新港市！它进货比谁都便宜，最擅长亏本抢市场。提前备好口碑、会员和现金。', 'bad');
        BT.Bus.emit('fx', { kind: 'alert', text: '📰 ' + G.name + ' 要来了' });
      }
      return;
    }
    if (!biz.giant.done && S.day >= biz.giant.arrive) {
      biz.giant.done = true;
      var bestShop = biz.shops.slice().sort(function (a, b) { return ((b.last && b.last.profit) || 0) - ((a.last && a.last.profit) || 0); })[0];
      var rid = bestShop ? bestShop.regionId : 'cbd', regs = {}; regs[rid] = 2;
      var nr = makeRival({ id: G.id, name: G.name, icon: G.icon, style: G.style, tier: 'big', color: G.color, cash: G.cash, brand: G.brand, aggr: G.aggr, regions: regs, desc: G.desc });
      nr.att = -20; nr.nextWar = S.day + 7; nr.seen = [rid];
      biz.rivals.push(nr);
      news(S, '🏛️ ' + G.name + ' 正式入场：在' + C.regionMap[rid].name + '开出 2 级大店，就开在你最赚钱的门店旁边。', 'bad');
    }
  }

  function indexTrend(S) {
    var h = S.market && S.market.indexHist; if (!h || h.length < 21) return 0;
    return h[h.length - 1].c / h[h.length - 21].c - 1;
  }
  function Biz() { return BT.Biz; }

  /* ========================================================================
   * 五、要约（deals）
   * ===================================================================== */
  function addDeal(S, d) { d.id = BT.uid('deal'); d.day = S.day; S.biz.deals.push(d); BT.Log.add('📨 ' + d.text, 'event'); }
  function pendingOf(S, type) { return (S.biz.deals || []).some(function (d) { return d.type === type; }); }
  function dealFor(S, rivalId, type) { return (S.biz.deals || []).some(function (d) { return d.rivalId === rivalId && d.type === type; }); }
  Rv.deals = function (S) { return (S.biz && S.biz.deals) || []; };
  Rv.hasUrgent = function (S) { return Rv.deals(S).length > 0; };
  function removeDeal(S, id) { S.biz.deals = S.biz.deals.filter(function (d) { return d.id !== id; }); }

  /** 玩家回应要约。choice: 'accept' / 'decline'（挖人：accept=加薪挽留，decline=放人） */
  Rv.respond = function (S, dealId, choice) {
    var d = Rv.deals(S).filter(function (x) { return x.id === dealId; })[0];
    if (!d) return { ok: false, msg: '这个要约已经失效了' };
    var rv = Rv.get(S, d.rivalId), biz = S.biz, B = Biz();
    var accept = choice === 'accept';
    if (d.type === 'poach') {
      var sh = B.findShop(biz, d.shopId), e = sh && sh.employees.filter(function (x) { return x.id === d.empId; })[0];
      removeDeal(S, d.id);
      if (!e) return { ok: false, msg: '员工已不在了' };
      if (accept) { e.wage = d.wage; e.loyalty = U.clamp(e.loyalty + 20, 0, 100); return { ok: true, msg: '给 ' + e.name + ' 加薪到 ' + U.money(d.wage) + '，人留下了，忠诚度 ' + Math.round(e.loyalty) }; }
      sh.employees = sh.employees.filter(function (x) { return x.id !== e.id; });
      if (rv) rv.brand = U.clamp(rv.brand + 1, 5, 95);
      return { ok: true, msg: e.name + ' 跳槽去了 ' + (rv ? rv.name : '对手') };
    }
    if (d.type === 'sellShop') {
      if (!accept) { removeDeal(S, d.id); return { ok: true, msg: '已拒绝接手' }; }
      if (S.cash < d.price) return { ok: false, msg: '现金不够（需要 ' + U.money(d.price) + '）' };
      if (!rv || !rv.shops[d.regionId]) { removeDeal(S, d.id); return { ok: false, msg: '对方已经关店了' }; }
      BT.Eco.pay(S, d.price, '接手 ' + rv.name + ' ' + C.regionMap[d.regionId].name + '门店');
      takeOverShop(S, d.regionId, d.level, d.rep, d.price);
      delete rv.shops[d.regionId]; delete rv.war[d.regionId]; if (rv.camp) delete rv.camp[d.regionId]; rv.cash += d.price;
      removeDeal(S, d.id);
      BT.Bus.emit('fx', { kind: 'level', text: '🏬 接手 ' + C.regionMap[d.regionId].name + ' 门店' });
      return { ok: true, msg: '接手成功：' + C.regionMap[d.regionId].name + ' 的老顾客现在归你了' };
    }
    if (d.type === 'buyMyShop') {
      removeDeal(S, d.id);
      if (!accept) return { ok: true, msg: '已拒绝出售' };
      var shop = B.findShop(biz, d.shopId); if (!shop) return { ok: false, msg: '店铺已不存在' };
      biz.shops = biz.shops.filter(function (x) { return x.id !== shop.id; });
      BT.Eco.earn(S, d.price, '出售' + C.regionMap[shop.regionId].name + '店给 ' + (rv ? rv.name : '对手'));
      if (rv) { rv.cash -= d.price; rv.shops[shop.regionId] = rv.shops[shop.regionId] || { level: 1, rep: Math.max(30, shop.reputation) }; }
      return { ok: true, msg: '门店已出售，回笼资金 ' + U.money(d.price) };
    }
    if (d.type === 'buyout') {
      removeDeal(S, d.id);
      if (!accept) return { ok: true, msg: '你拒绝了收购，决定硬扛到底' };
      var total = d.price;
      biz.shops.forEach(function (sh) { if (rv) rv.shops[sh.regionId] = rv.shops[sh.regionId] || { level: 1, rep: Math.max(30, sh.reputation) }; });
      biz.shops = []; U.keys(biz.warehouses).forEach(function (rid) { biz.warehouses[rid].goods = {}; });
      BT.Eco.earn(S, total, '公司门店被 ' + (rv ? rv.name : '对手') + ' 整体收购');
      if (rv) rv.cash -= total * 0.6;
      S.insolventDays = 0; S.stats.soldOut = (S.stats.soldOut || 0) + 1;
      return { ok: true, msg: '门店和存货已整体出售，拿到 ' + U.money(total) + '。公司壳还在，可以东山再起。' };
    }
    removeDeal(S, d.id); return { ok: true, msg: '已处理' };
  };
  Rv.takeOverShop = function (S, rid, level, rep, price) { return takeOverShop(S, rid, level, rep, price); };
  function takeOverShop(S, rid, level, rep, price) {
    var biz = S.biz, B = Biz(), mine = biz.shops.filter(function (s) { return s.regionId === rid; })[0];
    if (mine) { mine.reputation = U.clamp(mine.reputation + 6 + level * 3, 0, 100); mine.value += price * 0.6; return mine; }
    var sh = B.normShop({ id: BT.uid('shop'), regionId: rid, loc: level >= 2 ? 'corner' : 'street', shelf: {}, reputation: Math.round(rep * 0.85), employees: [],
      rent: B.shopRent(rid, level >= 2 ? 'corner' : 'street'), value: price, daysOpen: 0, inventory: {} });
    biz.shops.push(sh);
    if (S.unlockedRegions.indexOf(rid) < 0) S.unlockedRegions.push(rid);
    return sh;
  }

  /** 要约过期处理：挖人没回应 → 看忠诚度决定走不走；其他要约直接作废 */
  function expireDeals(S) {
    S.biz.deals = S.biz.deals.filter(function (d) {
      if (d.expire >= S.day) return true;
      if (d.type === 'poach') {
        var sh = Biz().findShop(S.biz, d.shopId), e = sh && sh.employees.filter(function (x) { return x.id === d.empId; })[0];
        if (e) {
          var t = C.traitMap[e.trait] || {}, keep = e.loyalty + (t.loyalty ? 20 : 0);
          if (keep < 55) { sh.employees = sh.employees.filter(function (x) { return x.id !== e.id; }); news(S, '🚪 你没回应，' + e.name + ' 跳槽去了 ' + (Rv.get(S, d.rivalId) || {}).name + '。', 'bad'); }
          else { e.loyalty -= 5; news(S, '🙂 ' + e.name + ' 拒绝了 ' + (Rv.get(S, d.rivalId) || {}).name + ' 的邀约，选择留下。', 'good'); }
        }
      } else if (d.type === 'sellShop') {
        var rv = Rv.get(S, d.rivalId);
        if (rv && rv.shops[d.regionId] && (rv.cash < 0 || d.forced)) { delete rv.shops[d.regionId]; delete rv.war[d.regionId]; if (rv.camp) delete rv.camp[d.regionId]; rv.cash += d.price * 0.5; news(S, '🏚️ ' + rv.icon + rv.name + ' 关闭了' + C.regionMap[d.regionId].name + '门店。'); }
      }
      return false;
    });
  }

  /* ========================================================================
   * 六、玩家收购整家 AI 公司（资本帝国解锁后；上市公司不能整体收购）
   * ===================================================================== */
  Rv.valuation = function (S, rv) {
    var v = Math.max(0, rv.cash) - rv.debt + rv.brand * 300;
    U.keys(rv.shops).forEach(function (rid) { v += C.regionMap[rid].rent * 45 * rv.shops[rid].level; });
    return Math.max(5000, Math.round(v));
  };
  Rv.acquireCost = function (S, rv) { return Math.round(Rv.valuation(S, rv) * 1.3); };
  Rv.acquire = function (S, rivalId) {
    var rv = Rv.get(S, rivalId); if (!rv || !rv.alive) return { ok: false, msg: '这家公司已经不存在了' };
    if (rv.listed) return { ok: false, msg: rv.name + ' 是上市公司，不能整体收购（可以在金融页买它的股票）' };
    if (!BT.Empire || !BT.Empire.unlocked(S)) return { ok: false, msg: '需要先解锁「资本帝国」' };
    var cost = Rv.acquireCost(S, rv);
    if (S.cash < cost) return { ok: false, msg: '现金不够（收购价 ' + U.money(cost) + '，含 30% 控制权溢价）' };
    BT.Eco.pay(S, cost, '收购 ' + rv.name);
    U.keys(rv.shops).forEach(function (rid) { takeOverShop(S, rid, rv.shops[rid].level, rv.shops[rid].rep, C.regionMap[rid].rent * 45 * rv.shops[rid].level); });
    S.biz.brand = U.clamp(S.biz.brand + rv.brand * 0.12, 0, 100);
    rv.alive = false; rv.shops = {}; rv.war = {}; rv.diedDay = S.day; rv.fate = 'acquired';
    S.stats.acquired = (S.stats.acquired || 0) + 1;
    S.biz.deals = S.biz.deals.filter(function (d) { return d.rivalId !== rv.id; });
    news(S, '🏆 你完成了对 ' + rv.icon + rv.name + ' 的收购！它的门店和顾客全部并入你的公司。', 'good');
    BT.Bus.emit('fx', { kind: 'big', text: '🏆 收购 ' + rv.name });
    return { ok: true, msg: '收购完成' };
  };

  /* ========================================================================
   * 七、每日入口（economy.sleep 在 Biz.dailyTick 之后调用）
   * ===================================================================== */
  Rv.dailyTick = function (S) {
    if (!S.biz) return;
    Rv.ensure(S);
    expireDeals(S);
    Rv.alive(S).forEach(function (rv) {
      rivalEconomy(S, rv);
      updateAttitude(S, rv);
      launchPlan(S, rv);
      /* 撑不住了提前撤：中型现金见底、巨头掉到 3 万以下 */
      U.keys(rv.camp).forEach(function (rid) { if (rv.war[rid] > 0 && rv.camp[rid].on === 'me' && rv.cash < (rv.tier === 'big' ? 30000 : 3000)) endCampaign(S, rv, rid, true); });
      decide(S, rv);
      /* 破产 */
      if (rv.cash < -15000 || (!U.keys(rv.shops).length && rv.cash < 0)) {
        /* 巨头趁机接手它最好的一家店 */
        var heir = Rv.alive(S).filter(function (o) { return o !== rv && o.tier === 'big' && o.cash > 50000; })[0];
        var bestR = U.keys(rv.shops).sort(function (a, b) { return rv.shops[b].level - rv.shops[a].level; })[0];
        if (heir && bestR && !heir.shops[bestR] && rng.chance(0.6)) {
          heir.shops[bestR] = { level: rv.shops[bestR].level, rep: rv.shops[bestR].rep }; heir.cash -= C.regionMap[bestR].rent * 30 * rv.shops[bestR].level;
          news(S, '🦈 ' + heir.icon + heir.name + ' 低价接手了 ' + rv.name + ' 在' + C.regionMap[bestR].name + '的门店。', 'event');
        }
        rv.alive = false; rv.diedDay = S.day; rv.fate = 'bankrupt'; rv.shops = {}; rv.war = {}; rv.camp = {}; rv.plan = null;
        news(S, '💀 ' + rv.icon + rv.name + ' 资不抵债，宣布破产清算。', 'good');
        if (rv.listed && BT.Market && BT.Market.rivalSignal) BT.Market.rivalSignal(S, rv.listed, -0.25);
      }
    });
    giantTick(S);
    allyTick(S); probeTick(S);
    var bz = S.biz;
    U.keys(bz.locks || {}).forEach(function (g) { if (bz.locks[g].until < S.day) { var r = Rv.get(S, bz.locks[g].by); delete bz.locks[g]; news(S, '🔓 ' + (r ? r.name : '对手') + ' 对 ' + C.goodsMap[g].name + ' 的独家供货协议到期了，批发价恢复正常。', 'good'); } });
    U.keys(bz.sites || {}).forEach(function (rid) { if (bz.sites[rid].until < S.day) delete bz.sites[rid]; });
    bz.shops.forEach(function (sh) { if (sh.hike && sh.hike.until < S.day) { delete sh.hike; news(S, '🏠 ' + C.regionMap[sh.regionId].name + '店的房租恢复原价。', 'good'); } });
    /* 新玩家入场：有公司倒下 45 天后，新的 AI 公司进入市场 */
    S.biz.rivals.forEach(function (rv, i) {
      if (!rv.alive && !rv.replaced && S.day - (rv.diedDay || S.day) >= 45 && !rv.listed && rv.tier !== 'big') {
        rv.replaced = true;
        var nm = NEW_NAMES[(S.biz.rivals.length + i) % NEW_NAMES.length], rid = rng.pick(C.REGIONS).id, regs = {}; regs[rid] = 1;
        var nr = makeRival({ id: 'r' + S.day + '_' + i, name: nm[1], icon: nm[0], style: rng.pick(['discount', 'balanced', 'aggressive']), color: rng.pick(['#f6ad55', '#9ae6b4', '#fbb6ce']), cash: 30000, brand: 20, aggr: rng.range(0.4, 0.8), regions: regs, desc: '新入场的挑战者。' });
        S.biz.rivals.push(nr);
        news(S, '🆕 新对手入场：' + nm[0] + nm[1] + ' 在' + C.regionMap[rid].name + '开出第一家店。');
      }
    });
    /* 人才市场：AI 公司抢先签走优秀候选人 */
    S.biz.candidates = (S.biz.candidates || []).filter(function (c) {
      if (rng.chance(0.1)) {
        var rv = rng.pick(Rv.alive(S) || []); if (!rv) return true;
        if (c.skill + c.service >= 5) BT.Log.add('🧑‍💼 人才市场：' + c.name + '（销售' + c.skill + '/服务' + c.service + '）被 ' + rv.name + ' 抢先签走了。', 'event');
        return false;
      }
      return true;
    });
    /* 玩家濒临破产 → 最有钱的 AI 公司提出整体收购（可拒绝） */
    if ((S.insolventDays || 0) >= 2 && S.biz.shops.length && !pendingOf(S, 'buyout')) {
      var rich = Rv.alive(S).sort(function (a, b) { return b.cash - a.cash; })[0];
      if (rich) {
        var assets = BT.Biz.netWorth(S);
        var price = Math.round(Math.max(assets * 0.75, 2000));
        addDeal(S, { type: 'buyout', rivalId: rich.id, price: price, expire: S.day + 2,
          text: rich.icon + rich.name + ' 看你撑不住了，提出以 ' + U.money(price) + ' 整体收购你的全部门店和存货。接受可以避免破产，但你会失去所有店铺。' });
        BT.Bus.emit('fx', { kind: 'alert', text: '📨 收到收购要约' });
      }
    }
    /* 上市对手：份额变化 → 股价；季度营收供季报使用 */
    Rv.alive(S).forEach(function (rv) {
      if (!rv.listed || !BT.Market || !BT.Market.rivalSignal) return;
      var share = 0, n = 0;
      U.keys(rv.shops).forEach(function (rid) { var me = Rv.shares(S, rid).filter(function (x) { return x.id === rv.id; })[0]; if (me) { share += me.share; n++; } });
      share = n ? share / n : 0;
      if (rv.shareRef == null) rv.shareRef = share;
      var sig = U.clamp((share - rv.shareRef) * 0.25, -0.02, 0.02);
      if (Math.abs(sig) > 0.002) BT.Market.rivalSignal(S, rv.listed, sig);
      rv.shareRef = rv.shareRef * 0.9 + share * 0.1; rv.share = share;
    });
    Rv.syncCompetitors(S);
  };

  /** 季报用：上市对手本季营收增速（调用后滚动到下一季） */
  Rv.quarterGrowth = function (S, stockId) {
    var rv = (S.biz && S.biz.rivals || []).filter(function (r) { return r.listed === stockId; })[0];
    if (!rv) return null;
    var g = rv.revQPrev > 0 ? rv.revQ / rv.revQPrev - 1 : null;
    rv.revQPrev = rv.revQ; rv.revQ = 0;
    if (!rv.alive) return -0.4;
    return g == null ? null : U.clamp(g, -0.5, 0.6);
  };

  /** 金融新闻冲击 AI 公司现金（market.js 发出 marketNews 事件） */
  BT.Bus.on('marketNews', function (n) {
    var S = BT.S; if (!S || !S.biz || !S.biz.rivals) return;
    if (n.sector !== 'all' && n.sector !== 'retail' && n.sector !== 'property') return;
    Rv.alive(S).forEach(function (rv) {
      var k = rv.style === 'aggressive' ? 1.6 : 0.6, d = Math.round(Math.max(20000, Math.abs(rv.cash)) * n.jump * k);
      rv.cash += d;
    });
    if (n.sector === 'all' && n.jump < 0) news(S, '📉 金融市场动荡波及实体：几家 AI 公司账面受损，远洋商贸这类高杠杆公司最危险。', 'event');
  });
})();
