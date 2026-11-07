/* ==========================================================================
 * 文件：js/phase2/groupbuy.js
 * 作用：社区团购（v7.4）—— 先收钱、后交货，玩的是现金流
 *   · 在有门店的区（门店当自提点）或雇了团长的区开团：选商品、定团购价（零售价的 7~9.5 折）和成团人数；
 *   · 每晚结单：成团就当天收款（记一笔「预收款」负债，净资产会扣掉），第二天早上交货；不成团就退款；
 *   · 交货先用该区仓库 / 门店库存，不够就按当天进价现买 —— 夜里涨价、现金不够都是你的事；
 *   · 预收款可以随便花（进货、扩张、炒股），但交不了货就违约：全额退款、口碑和信用大跌；
 *     30 天内违约 2 次 → 监管罚款 + 停团 15 天；3 次 → 停团 45 天、品牌 −10；
 *   · 需求：人流 × 价格敏感（城中村、学院区最爱）× 口碑 × 团长；生鲜 ×1.3；会分走同区自家门店约三成的单量；
 *   · 散户被团购抢生意；折扣型 AI 看你做大了会开「补贴大战」，双方都烧钱。
 * 数据：S.biz.gb = { leaders:{rid:{loy}}, groups:[{id,rid,gid,ratio,minN,y}], due:[], prepaid, defaults:[], banUntil, war, seq, last, hist }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var GB = BT.GroupBuy = {};

  C.GB = { k: 20, leaderCost: 800, comm: 0.08, maxGroups: 3, fresh: ['fruit', 'veg'], cannibal: 0.3, handling: 0.4, payFee: 0.02, cardCups: 5, cardDays: 30 }; /* 每单分拣包装 ¥0.4 + 支付手续费 2%；奶茶券 = 5 杯、30 天有效 */
  /* v7.5：团购卖「奶茶券」（gid = 'teacard'，要该区有你的奶茶店）；折扣低于 7.5 折算「引流款」，第二天给同区门店 / 奶茶店带客；
           回头客（loyal）：按时交货慢慢积累、违约减半；办了会员的公司团单 +10% */
  GB.isCard = function (gid) { return gid === 'teacard'; };
  GB.gname = function (gid) { return GB.isCard(gid) ? '🎟️奶茶券（' + C.GB.cardCups + '杯）' : C.goodsMap[gid].icon + C.goodsMap[gid].name; };
  function teaShopIn(S, rid) { return S.biz.tea ? S.biz.tea.shops.filter(function (s) { return s.rid === rid; })[0] : null; }
  function memberBonus(S) { return S.biz.shops.some(function (s) { return s.memberProg; }) ? 1.1 : 1; }

  GB.ensure = function (S) {
    var biz = S.biz; if (!biz) return null;
    if (!biz.gb) biz.gb = { leaders: {}, groups: [], due: [], prepaid: 0, defaults: [], banUntil: 0, war: null, seq: 1, last: null, hist: [] };
    return biz.gb;
  };
  function hasShop(S, rid) { return S.biz.shops.some(function (s) { return s.regionId === rid; }); }
  GB.canRun = function (S, rid) { return hasShop(S, rid) || !!GB.ensure(S).leaders[rid]; };
  GB.hireLeader = function (S, rid) {
    var g = GB.ensure(S); if (!g) return { ok: false, msg: '先成立公司' };
    if (g.leaders[rid]) return { ok: false, msg: '这个区已经有团长了' };
    if (S.cash < C.GB.leaderCost) return { ok: false, msg: '签约费不够' };
    BT.Eco.pay(S, C.GB.leaderCost, '签约团长（' + C.regionMap[rid].name + '）');
    g.leaders[rid] = { loy: 70, since: S.day };
    return { ok: true, msg: '签下' + C.regionMap[rid].name + '的团长：按团购额抽 ' + Math.round(C.GB.comm * 100) + '% 佣金，帮你拉群、收货、分货。' };
  };
  GB.open = function (S, rid, gid, ratio, minN) {
    var g = GB.ensure(S); if (!g) return { ok: false, msg: '先成立公司' };
    if (g.banUntil >= S.day) return { ok: false, msg: '被监管停团中（还剩 ' + (g.banUntil - S.day + 1) + ' 天）' };
    if (!GB.canRun(S, rid)) return { ok: false, msg: '这个区没有门店当自提点，先签个团长' };
    if (GB.isCard(gid)) { if (!teaShopIn(S, rid)) return { ok: false, msg: '这个区没有你的奶茶店，卖不了奶茶券' }; }
    else if (!C.goodsMap[gid] || C.goodsMap[gid].lux) return { ok: false, msg: '这件货不适合团购' };
    if (g.groups.length >= C.GB.maxGroups) return { ok: false, msg: '同时最多开 ' + C.GB.maxGroups + ' 个团' };
    if (g.groups.some(function (x) { return x.rid === rid && x.gid === gid; })) return { ok: false, msg: '这个团已经在开了' };
    ratio = U.clamp(+ratio || 0.88, 0.6, 0.95); minN = U.clamp(Math.round(+minN || 15), 5, 80);
    g.groups.push({ id: 'g' + (g.seq++), rid: rid, gid: gid, ratio: Math.round(ratio * 100) / 100, minN: minN, y: null, since: S.day });
    return { ok: true, msg: '开团：' + C.regionMap[rid].name + ' ' + GB.gname(gid) + '，' + Math.round(ratio * 100) / 10 + ' 折，' + minN + ' 人成团。' + (GB.isCard(gid) ? '券卖出去钱先到账，顾客 30 天内来奶茶店兑换。' : '每晚结单，第二天早上交货。') + (ratio < 0.75 ? '（引流款：明天同区门店 / 奶茶店会多来客人）' : '') };
  };
  GB.close = function (S, id) { var g = GB.ensure(S); g.groups = g.groups.filter(function (x) { return x.id !== id; }); return { ok: true, msg: '已停止这个团（已付款的订单明早照常交货）' }; };
  GB.priceOf = function (S, grp) {
    if (GB.isCard(grp.gid)) { var ts = teaShopIn(S, grp.rid); var avg = ts ? U.sum(ts.menu, function (m) { return m.price; }) / ts.menu.length : 10; return U.round2(avg * C.GB.cardCups * grp.ratio); }
    return U.round2(BT.Eco.sellPrice(S, grp.gid, grp.rid) * grp.ratio);
  };

  /** 预估某个团今晚能收多少单（UI 和结算共用） */
  GB.expect = function (S, grp) {
    var g = S.biz.gb, r = C.regionMap[grp.rid], sens = C.REGION_PRICE_SENS[grp.rid] || 1, card = GB.isCard(grp.gid);
    var dm = card ? (C.TEA.fit[grp.rid] || 1) * 0.3 : BT.Eco.demand(S, grp.rid, grp.gid), loyal = (g.loyal && g.loyal[grp.rid]) || 0;
    var cardRoom = 1;
    if (card) { var ts0 = teaShopIn(S, grp.rid); if (!ts0) return 0; var V0 = U.sum(ts0.vouch || [], function (v) { return v.cups; }); cardRoom = Math.max(0, 1 - V0 / (BT.Tea.cap(ts0) * 4)); } /* 没兑完的券太多，大家就不买了 */
    var shop = S.biz.shops.filter(function (s) { return s.regionId === grp.rid; })[0];
    var rep = shop ? 0.6 + shop.reputation / 125 : 0.6 + (g.leaders[grp.rid] ? g.leaders[grp.rid].loy / 150 : 0);
    var priceK = U.clamp(1 + (1 - grp.ratio) * sens * 5, 0.5, 2.6);
    var fresh = C.GB.fresh.indexOf(grp.gid) >= 0 ? 1.3 : 1;
    var war = g.war && g.war.until >= S.day && g.war.rid === grp.rid ? 0.6 : 1;
    return Math.max(0, r.traffic * C.GB.k * sens * rep * priceK * fresh * Math.pow(dm, 1.3) * war * (g.leaders[grp.rid] ? 1.25 : 1) * (1 + loyal) * memberBonus(S) * cardRoom);
  };

  /* ========================================================================
   * 每日结算：① 早上交付昨晚的订单 ② 晚上结今天的单（这里合并在一次 tick 里：先交货、再结单）
   * ===================================================================== */
  GB.dailyTick = function (S) {
    var g = S.biz && S.biz.gb; if (!g) return null;
    var out = { rev: 0, cogs: 0, cost: 0, orders: 0, delivered: 0, refund: 0, defaulted: 0 };
    /* ① 交货 */
    g.due.forEach(function (d) {
      var need = d.qty, cost = 0, src = [];
      var whs = [d.rid].concat(U.keys(S.biz.warehouses).filter(function (r) { return r !== d.rid; }));
      whs.forEach(function (rid) { if (need <= 0) return; var wh = S.biz.warehouses[rid]; if (!wh) return; var q = Math.min(need, wh.goods[d.gid] || 0); if (q > 0) { wh.goods[d.gid] -= q; need -= q; cost += q * ((wh.cost && wh.cost[d.gid]) || BT.Eco.buyPrice(S, d.gid, rid) * 0.85); } });
      var shop = S.biz.shops.filter(function (s) { return s.regionId === d.rid; })[0];
      if (need > 0 && shop) { var q2 = Math.min(need, shop.inventory[d.gid] || 0); if (q2 > 0) { shop.inventory[d.gid] -= q2; need -= q2; cost += q2 * ((shop.cost && shop.cost[d.gid]) || BT.Eco.buyPrice(S, d.gid, d.rid) * 0.9); } }
      if (need > 0) { /* 早上现买：按当天进价，不打批发折扣 */
        var unit = BT.Eco.buyPrice(S, d.gid, d.rid), buy = Math.min(need, Math.floor(Math.max(0, S.cash) / unit));
        if (buy > 0) { S.cash -= buy * unit; cost += buy * unit; need -= buy; }
      }
      var ok = d.qty - need;
      out.cogs += cost; out.delivered += ok; g.prepaid = Math.max(0, g.prepaid - d.paid);
      g.loyal = g.loyal || {};
      if (need <= 0) g.loyal[d.rid] = Math.min(0.8, (g.loyal[d.rid] || 0) + 0.01); /* 按时交货 → 回头客慢慢变多 */
      else g.loyal[d.rid] = (g.loyal[d.rid] || 0) * 0.5;
      if (need > 0) { /* 违约：没交的部分退款 */
        var refund = U.round2(d.paid * need / d.qty);
        S.cash -= refund; out.refund += refund; out.rev -= refund; out.defaulted++;
        g.defaults.push(S.day);
        if (shop) shop.reputation = Math.max(0, shop.reputation - 8);
        if (g.leaders[d.rid]) g.leaders[d.rid].loy = Math.max(0, g.leaders[d.rid].loy - 20);
        S.biz.creditScore = U.clamp(S.biz.creditScore - 15, 300, 850);
        BT.Log.add('💥 团购违约：' + C.regionMap[d.rid].name + '「' + C.goodsMap[d.gid].name + '」有 ' + need + ' 份交不出货，退款 ' + U.money(refund) + '，口碑和信用大跌。', 'bad');
      }
    });
    g.due = [];
    /* 监管：30 天内违约次数 */
    g.defaults = g.defaults.filter(function (d) { return d > S.day - 30; });
    if (out.defaulted && g.defaults.length >= 2 && !(g.banUntil >= S.day)) {
      var heavy = g.defaults.length >= 3, fine = Math.round(Math.max(3000, U.sum(g.hist.slice(-30), function (h) { return h.rev; }) * 0.1));
      BT.Eco.pay(S, fine, '团购违约罚款'); g.banUntil = S.day + (heavy ? 45 : 15); g.groups = [];
      if (heavy) S.biz.brand = Math.max(0, S.biz.brand - 10);
      BT.Log.add('⚖️ 市场监管局：你 30 天内团购违约 ' + g.defaults.length + ' 次，涉嫌「预收款跑路」—— 罚款 ' + U.money(fine) + '，停团 ' + (heavy ? 45 : 15) + ' 天' + (heavy ? '，品牌 −10' : '') + '。', 'bad');
    }
    /* ② 结单 */
    if (!(g.banUntil >= S.day)) g.groups.forEach(function (grp) {
      var n = BT.rng.poisson(GB.expect(S, grp)), price = GB.priceOf(S, grp);
      grp.y = { day: S.day, n: n, ok: n >= grp.minN, price: price };
      if (n < grp.minN) return;
      var L = g.leaders[grp.rid], paid = U.round2(n * price), comm = (L ? paid * (L.comm || C.GB.comm) : 0) + n * C.GB.handling + paid * C.GB.payFee;
      S.cash += paid - comm; g.prepaid += paid;
      if (!GB.isCard(grp.gid)) out.rev += paid; /* 奶茶券的收入等兑换时记到奶茶线（先是负债） */
      out.cost += comm; out.orders += n;
      var ts = teaShopIn(S, grp.rid);
      if (GB.isCard(grp.gid)) { ts.vouch = ts.vouch || []; ts.vouch.push({ cups: n * C.GB.cardCups, unit: U.round2(price / C.GB.cardCups), exp: S.day + C.GB.cardDays }); }
      else g.due.push({ rid: grp.rid, gid: grp.gid, qty: n, paid: paid });
      if (grp.ratio < 0.75) { /* 引流款：明天给同区门店、奶茶店带客 */
        var sh0 = S.biz.shops.filter(function (s) { return s.regionId === grp.rid; })[0];
        if (sh0) sh0.gbBoost = (sh0.gbBoost || 0) + Math.round(n * 0.5);
        if (ts) ts.gbBoost = (ts.gbBoost || 0) + Math.round(n * 0.3);
      }
      /* 分走自家门店的生意、挤压散户 */
      var shop = S.biz.shops.filter(function (s) { return s.regionId === grp.rid; })[0];
      if (shop && !GB.isCard(grp.gid)) shop.gbCannibal = Math.round(n * C.GB.cannibal / 1.6);
      if (BT.Hawkers && n > 20 && rng.chance(0.15)) BT.Hawkers.clear(S, grp.rid, 1);
      if (g.leaders[grp.rid]) g.leaders[grp.rid].loy = Math.min(100, g.leaders[grp.rid].loy + 0.5);
    });
    /* 团长被挖 */
    U.keys(g.leaders).forEach(function (rid) { var L = g.leaders[rid]; if (L.loy < 40 && rng.chance(0.03)) { delete g.leaders[rid]; BT.Log.add('🧍 ' + C.regionMap[rid].name + '的团长被对手挖走了（忠诚度太低）。', 'bad'); } });
    /* 补贴大战：折扣型 AI 看你某区团购做大了 */
    if (!(g.war && g.war.until >= S.day) && BT.Rivals) {
      var big = g.groups.filter(function (x) { return x.y && x.y.ok && x.y.n >= 40 && !GB.isCard(x.gid); })[0];
      var rv = big && BT.Rivals.alive(S).filter(function (r) { return (r.style === 'discount' || r.style === 'aggressive') && r.shops[big.rid] && !BT.Rivals.allied(S, r) && r.cash > 20000; })[0];
      if (rv && rng.chance(0.05)) {
        g.war = { by: rv.id, rid: big.rid, until: S.day + 12 };
        BT.Log.add('🧧 ' + rv.icon + rv.name + ' 在' + C.regionMap[big.rid].name + '搞「团购补贴大战」：一分钱秒杀、满减券，你的团单会少四成（约 12 天）。它每天烧不少钱。', 'bad');
      }
    }
    if (g.war && g.war.until >= S.day) { var wr = BT.Rivals.get(S, g.war.by); if (wr) wr.cash -= C.regionMap[g.war.rid].traffic * 600; }
    out.rev = Math.round(out.rev); out.cogs = Math.round(out.cogs); out.cost = Math.round(out.cost);
    out.profit = out.rev - out.cogs - out.cost;
    g.last = out; g.hist.push({ day: S.day, rev: out.rev, profit: out.profit, orders: out.orders }); if (g.hist.length > 30) g.hist.shift();
    return out;
  };
  /** 明早要交的货：每样多少、现在库存够不够 */
  GB.needs = function (S) {
    var g = S.biz && S.biz.gb; if (!g) return [];
    return g.due.map(function (d) {
      var have = U.sum(U.keys(S.biz.warehouses), function (r) { return S.biz.warehouses[r].goods[d.gid] || 0; });
      var shop = S.biz.shops.filter(function (s) { return s.regionId === d.rid; })[0]; if (shop) have += shop.inventory[d.gid] || 0;
      return { rid: d.rid, gid: d.gid, qty: d.qty, have: have, paid: d.paid, buyCost: Math.round(Math.max(0, d.qty - have) * BT.Eco.buyPrice(S, d.gid, d.rid)) };
    });
  };
  /** 净资产：预收款是负债 */
  GB.liability = function (S) { var g = S.biz && S.biz.gb; return g ? Math.round(g.prepaid) : 0; };
})();
