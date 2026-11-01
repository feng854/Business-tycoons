/* ==========================================================================
 * 文件：js/phase2/rivals.js
 * 作用：AI 竞争对手公司 —— 和玩家在各区域分流客流、打价格战、抢人才，
 *       资金链断了会卖店 / 破产，玩家可以接手门店或整体收购；玩家撑不住时，AI 也会来收购玩家。
 * 联动：
 *   经营 → 金融：新辉零售（上市，XHLS）的市场份额与营收写进季报，份额变化每天影响股价；
 *   金融 → 经营：大盘黑天鹅 / 普涨新闻会打击 / 补充 AI 公司的现金（激进型加杠杆，受影响最大），
 *                牛市里 AI 扩张更快；新港央行利率决定它们的借贷成本。
 * 数据：S.biz.rivals = [{id,name,cash,brand,shops:{regionId:{level,rep}},war:{regionId:days},...}]
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
    return { id: def.id, name: def.name, icon: def.icon, style: def.style, color: def.color, cash: def.cash, brand: def.brand, aggr: def.aggr,
      listed: def.listed || null, desc: def.desc || '', shops: shops, war: {}, alive: true, debt: def.style === 'aggressive' ? 30000 : 0,
      revQ: 0, revQPrev: 0, profit7: [], shareRef: null, founded: BT.S ? BT.S.day : 1 };
  }
  Rv.ensure = function (S) {
    var biz = S.biz; if (!biz) return null;
    if (!biz.rivals) biz.rivals = C.RIVALS.map(makeRival);
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
  /** AI 门店的吸引力：规模^0.7 × 口碑 × 品牌 × 风格适配 × 价格战 */
  Rv.pull = function (rv, rid) {
    var sh = rv.alive && rv.shops[rid]; if (!sh) return 0;
    var fit = (FIT[rv.style] || {})[rid] || 1;
    return Math.pow(sh.level, 0.7) * (0.6 + sh.rep / 100) * (1 + rv.brand / 150) * fit * (rv.war[rid] > 0 ? 1.5 : 1);
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
    return (1 + S.biz.brand / 150) * (0.7 + sh.reputation / 200) * (sh.promoDays > 0 ? 1.3 : 1) * staff * (C.locMap[sh.loc] || C.locMap.street).traffic;
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
      var war = rv.war[rid] > 0;
      var r1 = cust * TICKET[rv.style] * (war ? 0.82 : 1);
      rev += r1;
      profit += r1 * (war ? 0.12 : 0.3) - r.rent * 3 * sh.level - 40 * sh.level;
      sh.rep = U.clamp(sh.rep + rng.range(-0.6, 0.7) + (war ? 0.2 : 0), 15, 90);
      if (war) { rv.war[rid] -= 1; if (rv.war[rid] <= 0) { delete rv.war[rid]; news(S, '🕊️ ' + rv.icon + rv.name + ' 在' + r.name + '的价格战告一段落。', 'good'); } }
    });
    profit -= rv.debt * (hgd * 2) / 365; /* 借贷成本随央行利率浮动 */
    rv.cash += profit; rv.revQ += rev;
    rv.profit7.push(Math.round(profit)); if (rv.profit7.length > 7) rv.profit7.shift();
    rv.brand = U.clamp(rv.brand + (profit > 0 ? 0.05 : -0.08), 5, 95);
    rv.lastRev = Math.round(rev); rv.lastProfit = Math.round(profit);
  }

  /* ========================================================================
   * 四、AI 决策：扩张 / 升级 / 价格战 / 挖人 / 抢候选人 / 卖店 / 收购玩家门店
   * ===================================================================== */
  function decide(S, rv) {
    var biz = S.biz, idx = indexTrend(S);
    var shopCost = function (rid, lv) { return C.regionMap[rid].rent * 45 * lv; };
    var nShops = U.keys(rv.shops).length;
    /* 4.1 扩张：跟进玩家赚钱的区域，或随机进入新区域；牛市（大盘 20 日涨 >5%）融资容易，扩张更快 */
    var bull = idx > 0.05 ? 2 : (idx < -0.05 ? 0.5 : 1);
    if (nShops < 4) {
      var target = null;
      biz.shops.forEach(function (sh) { if (!rv.shops[sh.regionId] && sh.last && sh.last.profit > 0 && !target && rng.chance(rv.aggr * 0.006 * bull)) target = sh.regionId; });
      if (!target && rng.chance(0.004 * bull)) { var free = C.REGIONS.filter(function (r) { return !rv.shops[r.id]; }); if (free.length) target = rng.pick(free).id; }
      if (target && rv.cash > shopCost(target, 1) * 2.5) {
        rv.cash -= shopCost(target, 1); rv.shops[target] = { level: 1, rep: 35 };
        var follow = biz.shops.some(function (s) { return s.regionId === target; });
        news(S, '🏗️ ' + rv.icon + rv.name + ' 在' + C.regionMap[target].name + '开了新店' + (follow ? '，冲着你的生意来的！' : '。'), follow ? 'bad' : 'event');
      }
    }
    /* 4.2 升级门店 */
    if (rv.cash > 25000 && rng.chance(0.03)) {
      var up = U.keys(rv.shops).filter(function (rid) { return rv.shops[rid].level < 3; });
      if (up.length) { var rid0 = rng.pick(up), lv = rv.shops[rid0].level + 1; rv.cash -= shopCost(rid0, lv); rv.shops[rid0].level = lv; news(S, '⬆️ ' + rv.icon + rv.name + ' 把' + C.regionMap[rid0].name + '门店升级到 ' + lv + ' 级旗舰店。'); }
    }
    /* 4.3 价格战：玩家在它的地盘份额过高，激进/折扣型最爱打 */
    if (!U.keys(rv.war).length) {
      biz.shops.forEach(function (sh) {
        if (!rv.shops[sh.regionId] || rv.war[sh.regionId]) return;
        var sh2 = Rv.shares(S, sh.regionId), me = sh2.filter(function (x) { return x.me; })[0], it = sh2.filter(function (x) { return x.id === rv.id; })[0];
        if (me && it && me.share > it.share * 0.9 && rng.chance(rv.aggr * 0.03 * (rv.style === 'premium' ? 0.3 : 1))) {
          rv.war[sh.regionId] = rng.int(7, 12);
          news(S, '⚔️ ' + rv.icon + rv.name + ' 在' + C.regionMap[sh.regionId].name + '发起价格战！它的吸引力 ×1.5，持续约 ' + rv.war[sh.regionId] + ' 天。可以搞促销、降价，或者先避其锋芒。', 'bad');
          BT.Bus.emit('fx', { kind: 'alert', text: '⚔️ ' + rv.name + ' 发起价格战！' });
        }
      });
    }
    /* 4.4 挖人：盯上你能力强、忠诚度不高的员工（高端型最爱挖人） */
    if (!pendingOf(S, 'poach') && rng.chance(0.03 * (rv.style === 'premium' ? 2 : 1))) {
      var best = null, bs = 0;
      biz.shops.forEach(function (sh) { sh.employees.forEach(function (e) {
        var t = C.traitMap[e.trait] || {}, score = e.skill + e.service - (t.loyalty ? 2 : 0);
        if (e.skill + e.service >= 4 && e.loyalty < 80 && score > bs) { bs = score; best = { sh: sh, e: e }; }
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
      delete rv.shops[d.regionId]; delete rv.war[d.regionId]; rv.cash += d.price;
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
        if (rv && rv.shops[d.regionId] && rv.cash < 0) { delete rv.shops[d.regionId]; rv.cash += d.price * 0.5; news(S, '🏚️ ' + rv.icon + rv.name + ' 关闭了' + C.regionMap[d.regionId].name + '门店。'); }
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
      decide(S, rv);
      /* 破产 */
      if (rv.cash < -15000 || (!U.keys(rv.shops).length && rv.cash < 0)) {
        rv.alive = false; rv.diedDay = S.day; rv.fate = 'bankrupt'; rv.shops = {}; rv.war = {};
        news(S, '💀 ' + rv.icon + rv.name + ' 资不抵债，宣布破产清算。', 'good');
        if (rv.listed && BT.Market && BT.Market.rivalSignal) BT.Market.rivalSignal(S, rv.listed, -0.25);
      }
    });
    /* 新玩家入场：有公司倒下 45 天后，新的 AI 公司进入市场 */
    S.biz.rivals.forEach(function (rv, i) {
      if (!rv.alive && !rv.replaced && S.day - (rv.diedDay || S.day) >= 45 && !rv.listed) {
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
