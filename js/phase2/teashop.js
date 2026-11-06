/* ==========================================================================
 * 文件：js/phase2/teashop.js
 * 作用：奶茶店（餐饮店型，v7.4）—— 和零售完全不同的一本账
 *   · 每个区可以另开一家奶茶店（不占零售店名额）；学院区、商业街最好，城中村很差；
 *   · 毛利高（约 60%），但人工重：每个店员一天最多做约 50 杯，做不过来就排队、有人走掉（排长队本身会涨品牌）；
 *   · 原料：基础料（茶 / 奶 / 珍珠）每天坏 10%，鲜果每天坏 30%，要精确备货（可设「每日自动备料到 X 杯」）；
 *   · 菜单最多 4 款，每款有「新鲜度」每天掉 2%，卖久了没人买；花 ¥3,000、3 天研发新品，品质随机，爆品能掀起一波热度；
 *   · 茶饮潮流：隔一阵某款饮品爆火（如杨枝甘露），谁先上架谁吃红利；你的爆品火了几天后，AI 茶饮品牌会跟风出同款；
 *   · 两家 AI 茶饮品牌：蜜城茶饮（低价走量）、喜悦茶研（高端网红），会跟风、会开新店；
 *   · 食品安全：卫生分每天掉，抽查不合格停业 3 天、口碑大跌；花 ¥300 做一次清洁消杀。
 *   · 天气：晴 / 酷热卖得多，下雨、降雪卖得少。
 * 数据：S.biz.tea = { shops:[], rd:null, owned:[], rivals:{}, trend:null, seq, last, hist }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var T = BT.Tea = {};

  C.TEA = {
    products: [
      { id: 'pearl', name: '珍珠奶茶', icon: '🧋', price: 8, fresh: 0, q: 1.0 },
      { id: 'lemon', name: '手打柠檬茶', icon: '🍋', price: 9, fresh: 1, q: 1.0 },
      { id: 'fruit', name: '满杯水果茶', icon: '🍹', price: 10, fresh: 1, q: 1.0 },
      { id: 'cheese', name: '芝士奶盖', icon: '🧀', price: 12, fresh: 0, q: 1.0 },
      { id: 'coffee', name: '生椰拿铁', icon: '☕', price: 12, fresh: 0, q: 1.0 },
      { id: 'mango', name: '杨枝甘露', icon: '🥭', price: 13, fresh: 1, q: 1.0 },
      { id: 'grape', name: '多肉葡萄', icon: '🍇', price: 14, fresh: 1, q: 1.0 },
      { id: 'taro', name: '芋泥波波', icon: '🍠', price: 11, fresh: 0, q: 1.0 }
    ],
    starter: ['pearl', 'lemon', 'fruit'],
    fit: { slum: 0.45, market: 0.85, oldst: 1.0, cbd: 1.35, port: 0.9, college: 1.6 },
    pool: { slum: 60, market: 150, oldst: 190, cbd: 280, port: 160, college: 280 }, /* 各区每天的奶茶总需求（杯），你按茶饮市场份额分 */
    weather: { sunny: 1.2, cloudy: 1.0, rain: 0.7, storm: 0.45, hot: 1.45, snow: 0.6 },
    k: 55, cupsPerStaff: 50, wage: 65,
    base: 2.6, freshCost: 1.6,           /* 每杯原料 + 杯子包装成本：基础料 + 鲜果（有鲜果的饮品才用） */
    spoil: { base: 0.10, fresh: 0.30 },
    rdCost: 3000, rdDays: 3, cleanCost: 300,
    openMul: 150,                         /* 开店费（装修 + 设备）= 区域日租 × 150 × 档次 */
    rivals: [
      { id: 'mixue', name: '蜜城茶饮', icon: '🍦', price: 0.65, q: 0.85, regions: { slum: 1, market: 1, college: 1, port: 1 }, copyDays: [4, 7] },
      { id: 'heytea', name: '喜悦茶研', icon: '🌿', price: 1.3, q: 1.2, regions: { cbd: 1, oldst: 1, college: 1 }, copyDays: [6, 10] }
    ]
  };
  T.P = {}; C.TEA.products.forEach(function (p) { T.P[p.id] = p; });

  T.ensure = function (S) {
    var biz = S.biz; if (!biz) return null;
    if (!biz.tea) {
      var rv = {}; C.TEA.rivals.forEach(function (r) { rv[r.id] = { regions: U.clone(r.regions), copies: {} }; });
      biz.tea = { shops: [], rd: null, owned: C.TEA.starter.slice(), quality: {}, rivals: rv, trend: null, nextTrend: S.day + rng.int(15, 30), seq: 1, last: null, hist: [] };
    }
    return biz.tea;
  };
  T.openCost = function (rid, lv) { return Math.round(C.regionMap[rid].rent * C.TEA.openMul * (lv || 1)); };
  T.rent = function (sh) { return Math.round(C.regionMap[sh.rid].rent * 1.5 * (1 + (sh.level - 1) * 0.6)); };
  T.cap = function (sh) { return Math.round(sh.staff * C.TEA.cupsPerStaff * (1 + (sh.level - 1) * 0.25)); };
  T.find = function (S, id) { var t = S.biz && S.biz.tea; return t ? t.shops.filter(function (s) { return s.id === id; })[0] : null; };

  T.open = function (S, rid) {
    var t = T.ensure(S); if (!t) return { ok: false, msg: '先成立公司' };
    if (t.shops.some(function (s) { return s.rid === rid; })) return { ok: false, msg: '这个区已经有你的奶茶店了' };
    if (S.unlockedRegions.indexOf(rid) < 0) return { ok: false, msg: '这个区还没解锁' };
    var cost = T.openCost(rid, 1); if (S.cash < cost) return { ok: false, msg: '开店费不够（' + U.money(cost) + '）' };
    BT.Eco.pay(S, cost, '开奶茶店（' + C.regionMap[rid].name + '）');
    var sh = { id: 't' + (t.seq++), rid: rid, level: 1, staff: 2, menu: C.TEA.starter.map(function (p) { return { pid: p, fresh: 0.8, price: T.P[p].price }; }),
      stock: { base: 0, fresh: 0 }, auto: 150, rep: 50, hygiene: 100, closed: 0, invest: cost, last: null, h7: [], days: 0 };
    t.shops.push(sh);
    T.restock(S, sh, true);
    return { ok: true, msg: '奶茶店开张！2 个店员、3 款基础饮品。记得每天备料、勤做研发，卫生别出问题。' };
  };
  /** 备料到 auto 杯（基础料全部饮品都要，鲜果按菜单里鲜果饮品的比例备） */
  T.restock = function (S, sh, silent) {
    var fr = sh.menu.filter(function (m) { return T.P[m.pid].fresh; }).length / Math.max(1, sh.menu.length);
    var nb = Math.max(0, Math.round(sh.auto - sh.stock.base)), nf = Math.max(0, Math.round(sh.auto * fr - sh.stock.fresh));
    var cost = nb * C.TEA.base + nf * C.TEA.freshCost;
    if (cost <= 0) return { ok: true, msg: '原料已经够了' };
    if (S.cash < cost) return { ok: false, msg: '现金不够备料' };
    S.cash -= cost; sh.stock.base += nb; sh.stock.fresh += nf; sh.todayIngr = (sh.todayIngr || 0) + cost;
    return { ok: true, msg: '备料 ' + nb + ' 杯基础料 + ' + nf + ' 份鲜果，花 ' + U.money(cost) };
  };
  T.setAuto = function (S, id, n) { var sh = T.find(S, id); if (!sh) return { ok: false, msg: '店不存在' }; sh.auto = U.clamp(Math.round(+n || 0), 0, 2000); return { ok: true, msg: '每天开门前自动备料到 ' + sh.auto + ' 杯' }; };
  T.staff = function (S, id, d) {
    var sh = T.find(S, id); if (!sh) return { ok: false, msg: '店不存在' };
    var n = sh.staff + d; if (n < 1) return { ok: false, msg: '至少留一个人' }; if (n > 2 + sh.level * 2) return { ok: false, msg: '店太小，最多 ' + (2 + sh.level * 2) + ' 个店员（升级店铺能多放人）' };
    sh.staff = n; return { ok: true, msg: '店员 ' + n + ' 人，日产能约 ' + T.cap(sh) + ' 杯，日薪共 ' + U.money(n * C.TEA.wage) };
  };
  T.upgrade = function (S, id) {
    var sh = T.find(S, id); if (!sh) return { ok: false, msg: '店不存在' }; if (sh.level >= 3) return { ok: false, msg: '已经是旗舰店' };
    var cost = T.openCost(sh.rid, sh.level + 1); if (S.cash < cost) return { ok: false, msg: '升级费不够（' + U.money(cost) + '）' };
    BT.Eco.pay(S, cost, '奶茶店升级'); sh.level++; sh.invest += cost; sh.rep = Math.min(100, sh.rep + 5);
    return { ok: true, msg: '升级到 ' + sh.level + ' 级：产能 +25%、能多放 2 个店员、颜值更高（口碑 +5），房租也更贵' };
  };
  T.setPrice = function (S, id, pid, price) { var sh = T.find(S, id), m = sh && sh.menu.filter(function (x) { return x.pid === pid; })[0]; if (!m) return { ok: false, msg: '菜单里没有这款' }; m.price = U.clamp(Math.round(+price), 6, 40); return { ok: true, msg: T.P[pid].name + ' 定价 ¥' + m.price }; };
  T.addMenu = function (S, id, pid) {
    var t = T.ensure(S), sh = T.find(S, id); if (!sh) return { ok: false, msg: '店不存在' };
    if (t.owned.indexOf(pid) < 0) return { ok: false, msg: '这款还没研发出来' };
    if (sh.menu.some(function (m) { return m.pid === pid; })) return { ok: false, msg: '已经在菜单上' };
    if (sh.menu.length >= 4) return { ok: false, msg: '菜单最多 4 款，先下架一款' };
    sh.menu.push({ pid: pid, fresh: 1, price: T.P[pid].price }); return { ok: true, msg: '上架 ' + T.P[pid].name };
  };
  T.removeMenu = function (S, id, pid) { var sh = T.find(S, id); if (!sh) return { ok: false, msg: '店不存在' }; if (sh.menu.length <= 1) return { ok: false, msg: '至少留一款' }; sh.menu = sh.menu.filter(function (m) { return m.pid !== pid; }); return { ok: true, msg: '已下架 ' + T.P[pid].name }; };
  T.clean = function (S, id) { var sh = T.find(S, id); if (!sh) return { ok: false, msg: '店不存在' }; if (S.cash < C.TEA.cleanCost) return { ok: false, msg: '钱不够' }; BT.Eco.pay(S, C.TEA.cleanCost, '奶茶店清洁消杀'); sh.hygiene = 100; return { ok: true, msg: '清洁消杀完成，卫生分 100' }; };
  /** 研发：没研发过的新品，或者改良已有的（提升品质、新鲜度回满） */
  T.research = function (S, pid) {
    var t = T.ensure(S); if (!t) return { ok: false, msg: '先成立公司' };
    if (t.rd) return { ok: false, msg: '研发中（' + T.P[t.rd.pid].name + '，还剩 ' + Math.max(0, t.rd.ready - S.day) + ' 天）' };
    if (!T.P[pid]) return { ok: false, msg: '没有这款' };
    if (S.cash < C.TEA.rdCost) return { ok: false, msg: '研发费不够（' + U.money(C.TEA.rdCost) + '）' };
    BT.Eco.pay(S, C.TEA.rdCost, '茶饮研发：' + T.P[pid].name);
    t.rd = { pid: pid, ready: S.day + C.TEA.rdDays };
    return { ok: true, msg: '开始研发 ' + T.P[pid].name + '（' + C.TEA.rdDays + ' 天后出结果，品质随机）' };
  };

  /** 一款饮品的吸引力：品质 × 新鲜度 × 价格 × 潮流 × 被跟风 */
  T.appeal = function (S, sh, m) {
    var t = S.biz.tea, p = T.P[m.pid], q = (t.quality[m.pid] || p.q);
    var priceK = U.clamp(1 + (p.price - m.price) / p.price * 1.6, 0.25, 1.6);
    var trend = t.trend && t.trend.pid === m.pid && t.trend.until >= S.day ? 1.8 : 1;
    var copied = U.keys(t.rivals).some(function (r) { var c = t.rivals[r].copies[m.pid]; return c && c <= S.day && t.rivals[r].regions[sh.rid]; }) ? 0.75 : 1;
    return q * (0.35 + 0.65 * m.fresh) * priceK * trend * copied;
  };
  /** 区域茶饮市场里你的份额（你 vs 两家 AI 品牌 vs 街边饮料摊） */
  T.share = function (S, sh, appealAvg) {
    var t = S.biz.tea, mine = appealAvg * (0.6 + sh.rep / 125) * (1 + S.biz.brand / 200) * (1 + (sh.level - 1) * 0.15);
    var tot = mine + 0.35; /* 街边饮料摊 / 便利店 */
    C.TEA.rivals.forEach(function (r) {
      if (!t.rivals[r.id].regions[sh.rid]) return;
      var sens = C.REGION_PRICE_SENS[sh.rid] || 1, copies = U.keys(t.rivals[r.id].copies).filter(function (p) { return t.rivals[r.id].copies[p] <= S.day; }).length;
      tot += r.q * U.clamp(1 + (1 - r.price) * sens * 0.6, 0.6, 1.5) * (1 + copies * 0.08) * t.rivals[r.id].regions[sh.rid];
    });
    return mine / tot;
  };

  T.dailyTick = function (S) {
    var t = S.biz && S.biz.tea; if (!t) return null;
    var out = { rev: 0, cogs: 0, cost: 0, cups: 0, lost: 0 };
    var w = BT.Eco.weatherInfo(S), wk = C.TEA.weather[w.id] || 1;
    /* 研发出结果 */
    if (t.rd && S.day >= t.rd.ready) {
      var pid = t.rd.pid, q = U.round2(rng.range(0.6, 1.35)), p = T.P[pid];
      t.quality[pid] = Math.max(t.quality[pid] || 0, q); if (t.owned.indexOf(pid) < 0) t.owned.push(pid);
      t.shops.forEach(function (sh) { sh.menu.forEach(function (m) { if (m.pid === pid) m.fresh = 1; }); });
      BT.Log.add(q >= 1.15 ? '🎉 研发出爆品潜力的 ' + p.icon + p.name + '（品质 ' + q.toFixed(2) + '）！赶紧上架。' : (q < 0.8 ? '😕 ' + p.name + ' 研发得一般（品质 ' + q.toFixed(2) + '），上架效果有限。' : '🧪 研发完成：' + p.icon + p.name + '（品质 ' + q.toFixed(2) + '），可以上架了。'), q >= 1.15 ? 'good' : 'event');
      t.rd = null;
    }
    /* 茶饮潮流 */
    if (!(t.trend && t.trend.until >= S.day) && S.day >= t.nextTrend) {
      var tp = rng.pick(C.TEA.products.filter(function (x) { return C.TEA.starter.indexOf(x.id) < 0; }));
      t.trend = { pid: tp.id, until: S.day + 10 }; t.nextTrend = S.day + rng.int(25, 40);
      BT.Log.add('🔥 茶饮潮流：' + tp.icon + tp.name + ' 突然爆火（约 10 天）！菜单上有它的奶茶店客流翻倍。还没研发的赶紧研发。', 'event');
      C.TEA.rivals.forEach(function (r) { t.rivals[r.id].copies[tp.id] = Math.min(t.rivals[r.id].copies[tp.id] || 999, S.day + rng.int(2, 4)); }); /* AI 品牌追潮流很快 */
    }
    t.shops.forEach(function (sh) {
      sh.days++; sh.todayIngr = sh.todayIngr || 0;
      /* 原料损耗（隔夜） */
      sh.stock.base = Math.floor(sh.stock.base * (1 - C.TEA.spoil.base)); sh.stock.fresh = Math.floor(sh.stock.fresh * (1 - C.TEA.spoil.fresh));
      if (sh.auto > 0) T.restock(S, sh, true);
      var rent = T.rent(sh), wage = sh.staff * C.TEA.wage;
      if (sh.closed > 0) {
        sh.closed--; out.cost += rent + wage; S.cash -= rent + wage;
        sh.last = { day: S.day, closed: true, cups: 0, demand: 0, rev: 0, cogs: sh.todayIngr, rent: rent, wage: wage, profit: -(rent + wage + sh.todayIngr) };
        out.cogs += sh.todayIngr; sh.todayIngr = 0; push7(sh); return;
      }
      /* 需求 */
      var ap = sh.menu.map(function (m) { return T.appeal(S, sh, m); }), apAvg = U.sum(ap) / Math.max(1, ap.length), apMax = Math.max.apply(null, ap.concat([0]));
      var menuK = 0.6 * apMax + 0.4 * apAvg + 0.08 * (sh.menu.length - 1);
      var share = T.share(S, sh, menuK);
      var demand = BT.rng.poisson((C.TEA.pool[sh.rid] || 100) * wk * share * BT.Eco.trafficMul(S, sh.rid));
      var cap = T.cap(sh), served = Math.min(demand, cap), queueLost = demand - served;
      /* 按吸引力分到各款，受原料限制 */
      var cups = 0, rev = 0, left = served, tot = U.sum(ap) || 1, sold = {};
      sh.menu.forEach(function (m, i) {
        var want = Math.min(left, Math.round(served * ap[i] / tot)), p = T.P[m.pid]; /* 四舍五入不能超过产能 */
        left -= want;
        var n = Math.min(want, sh.stock.base, p.fresh ? sh.stock.fresh : 1e9);
        sh.stock.base -= n; if (p.fresh) sh.stock.fresh -= n;
        cups += n; rev += n * m.price; sold[m.pid] = n;
        m.fresh = Math.max(0, m.fresh - 0.02 - (U.keys(t.rivals).some(function (r) { var c = t.rivals[r].copies[m.pid]; return c && c <= S.day; }) ? 0.01 : 0));
        m.sold7 = (m.sold7 || []); m.sold7.push(n); if (m.sold7.length > 7) m.sold7.shift();
      });
      var stockLost = Math.max(0, served - left - cups);
      /* 排长队 = 网红效应；断料 / 让人等太久 = 口碑掉 */
      if (queueLost > served * 0.15) { S.biz.brand = Math.min(100, S.biz.brand + 0.05); sh.rep = Math.min(100, sh.rep + 0.3); }
      if (stockLost > served * 0.2) sh.rep = Math.max(0, sh.rep - 1.5);
      sh.rep = U.clamp(sh.rep + (cups > 0 ? 0.1 : -0.3), 0, 100);
      /* 卫生：越忙掉得越快 */
      sh.hygiene = Math.max(0, sh.hygiene - 0.8 - (cups > cap * 0.9 ? 0.6 : 0));
      if (rng.chance(0.02 + (sh.hygiene < 50 ? 0.03 : 0))) {
        if (sh.hygiene < 60) { sh.closed = 3; sh.rep = Math.max(0, sh.rep - 15); BT.Log.add('🚫 食品安全抽查：' + C.regionMap[sh.rid].name + '奶茶店卫生不合格（' + Math.round(sh.hygiene) + ' 分），停业整改 3 天，口碑 −15。', 'bad'); }
        else BT.Log.add('✅ 食品安全抽查：' + C.regionMap[sh.rid].name + '奶茶店合格（' + Math.round(sh.hygiene) + ' 分）。', 'good');
      }
      /* AI 品牌跟风：你的某款卖爆了、又够新 */
      sh.menu.forEach(function (m) {
        var s7 = U.sum(m.sold7 || []); if (s7 < 200 || m.fresh < 0.5) return;
        C.TEA.rivals.forEach(function (r) {
          if (t.rivals[r.id].copies[m.pid] || !rng.chance(0.15)) return;
          t.rivals[r.id].copies[m.pid] = S.day + rng.int(r.copyDays[0], r.copyDays[1]);
          BT.Log.add('👀 ' + r.icon + r.name + ' 盯上了你卖爆的 ' + T.P[m.pid].name + '，正在研发同款（几天后上市）。', 'bad');
        });
      });
      var cogs = cups * C.TEA.base + U.sum(sh.menu, function (m) { return T.P[m.pid].fresh ? sold[m.pid] * C.TEA.freshCost : 0; });
      var spoilCost = Math.max(0, sh.todayIngr - cogs); /* 进了没用掉、过夜会坏的部分算进成本里（按当天进货算，简化） */
      S.cash += rev; S.cash -= rent + wage;
      var profit = rev - sh.todayIngr - rent - wage;
      sh.last = { day: S.day, demand: demand, cap: cap, cups: cups, queueLost: queueLost, stockLost: stockLost, rev: Math.round(rev), cogs: Math.round(sh.todayIngr), rent: rent, wage: wage, profit: Math.round(profit), share: Math.round(share * 100) / 100, spoil: Math.round(spoilCost) };
      push7(sh);
      out.rev += rev; out.cogs += sh.todayIngr; out.cost += rent + wage; out.cups += cups; out.lost += queueLost + stockLost;
      sh.todayIngr = 0;
    });
    /* AI 茶饮品牌开新店：你在哪个区卖得好，它们就跟过去 */
    t.shops.forEach(function (sh) {
      if (!sh.last || sh.last.profit < 150) return;
      C.TEA.rivals.forEach(function (r) {
        var R = t.rivals[r.id]; if (R.regions[sh.rid] || !rng.chance(0.01)) return;
        R.regions[sh.rid] = 1; BT.Log.add('🧋 ' + r.icon + r.name + ' 在' + C.regionMap[sh.rid].name + '开了新店，就在你的奶茶店附近。', 'bad');
      });
    });
    out.rev = Math.round(out.rev); out.cogs = Math.round(out.cogs); out.cost = Math.round(out.cost); out.profit = out.rev - out.cogs - out.cost;
    t.last = out; t.hist.push({ day: S.day, rev: out.rev, profit: out.profit }); if (t.hist.length > 30) t.hist.shift();
    return out;
  };
  function push7(sh) { sh.h7.push(sh.last); if (sh.h7.length > 7) sh.h7.shift(); }
  T.netWorth = function (S) { var t = S.biz && S.biz.tea; return t ? Math.round(U.sum(t.shops, function (s) { return s.invest * 0.6 + s.stock.base * C.TEA.base * 0.5; })) : 0; };
})();
