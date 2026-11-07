/* ==========================================================================
 * 文件：js/phase2/b2b.js
 * 作用：批发商（B2B 分销，v7.4）—— 把对手变成你的客户
 *   · 在有仓库的区开「批发部」，从这个仓库给全城散户摊贩供货（本区全覆盖，外区 5 成覆盖，外区送货加 4% 运费）；
 *   · 散户在你和「市场批发价」之间选：你的批发价、账期（现结 / 7 天 / 15 天）、供货稳定性决定你的份额；
 *   · 账期 = 应收账款：到期按区域坏账率可能收不回，欠款多的区偶尔有摊贩卷货跑路；坏账可以花钱催收；
 *   · 渠道控价：散户从你这进货，零售价就跟着你的批发价走 —— 抬批发价，散户卖得贵，你门店的竞争就小（但抬太狠散户就跑）；
 *     账期给得好，会吸引更多散户入场（下游变多，既是客户也是对手）；
 *   · AI 连锁供货合同：不敌对的 AI 会找你签 30 天供货单；它打你时可以「断供」（它全城吸引力 ×0.8 十天，但你付违约金、它恨你）；
 *   · 反制：你的批发份额太大，巨头会开自己的批发部打批发价格战。
 * 数据：S.biz.b2b = { depots:{rid:{price,term,rel,open}}, share:{rid:{gid:s}}, ar:[], bad:[], contracts:[], offers:[], war, seq, last }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var B2 = BT.B2B = {};

  C.B2B = {
    cost: 20000, minCredit: 600,
    perSeller: 10,                       /* 每个在卖这样货的摊贩每天进多少件 */
    termBonus: { 0: 1, 7: 1.3, 15: 1.6 },
    badDebt: { slum: 0.04, market: 0.025, oldst: 0.02, cbd: 0.01, port: 0.02, college: 0.03 }, /* 每个账期收不回的概率（15 天账期再 ×1.5） */
    runaway: 0.004,                      /* 欠款超过 ¥2000 的区，每天有摊贩卷货跑路的概率 */
    freight: 0.04                        /* 外区送货运费 */
  };

  B2.ensure = function (S) {
    var biz = S.biz; if (!biz) return null;
    if (!biz.b2b) biz.b2b = { depots: {}, share: {}, ar: [], bad: [], contracts: [], offers: [], war: null, seq: 1, last: null, hist: [] };
    return biz.b2b;
  };
  B2.canOpen = function (S, rid) {
    var biz = S.biz; if (!biz) return { ok: false, msg: '先成立公司' };
    if (!biz.warehouses[rid]) return { ok: false, msg: '批发部要开在有仓库的区（先在这个区批发进一次货，就有仓库了）' };
    if (biz.creditScore < C.B2B.minCredit) return { ok: false, msg: '信用评级要 ≥ ' + C.B2B.minCredit + ' 才有散户敢跟你做账期生意' };
    if (B2.ensure(S).depots[rid]) return { ok: false, msg: '这个区已经有批发部了' };
    if (S.cash < C.B2B.cost) return { ok: false, msg: '开设费不够（' + U.money(C.B2B.cost) + '）' };
    return { ok: true };
  };
  B2.open = function (S, rid) {
    var ck = B2.canOpen(S, rid); if (!ck.ok) return ck;
    BT.Eco.pay(S, C.B2B.cost, '开设批发部（' + C.regionMap[rid].name + '）');
    B2.ensure(S).depots[rid] = { price: 1.0, term: 0, rel: 0.8, open: S.day };
    return { ok: true, msg: '批发部开张！从' + C.regionMap[rid].name + '仓库给全城散户供货。仓库里要备好大众货（' + C.HAWKERS.goods.map(function (g) { return C.goodsMap[g].name; }).join('、') + '）' };
  };
  B2.set = function (S, rid, key, val) {
    var d = B2.ensure(S).depots[rid]; if (!d) return { ok: false, msg: '没有批发部' };
    if (key === 'price') d.price = U.clamp(Math.round(+val * 100) / 100, 0.85, 1.2);
    else if (key === 'term') d.term = [0, 7, 15].indexOf(+val) >= 0 ? +val : 0;
    return { ok: true, msg: '已更新' + C.regionMap[rid].name + '批发部：批发价 ×' + d.price.toFixed(2) + '，账期 ' + (d.term ? d.term + ' 天' : '现结') };
  };

  /* ---- 给散户模块的钩子：你的批发价左右散户的零售价；账期好吸引散户入场 ---- */
  B2.hawkerCostMul = function (S, rid, gid) {
    var b = S.biz && S.biz.b2b; if (!b || !b.share[rid] || !b.share[rid][gid]) return 1;
    var d = bestDepot(S, rid); if (!d) return 1;
    return 1 + (d.price - 1) * b.share[rid][gid];
  };
  B2.hawkerBoost = function (S, rid) {
    var b = S.biz && S.biz.b2b; if (!b || !b.share[rid]) return 0;
    var d = bestDepot(S, rid); if (!d) return 0;
    var vals = U.keys(b.share[rid]).map(function (g) { return b.share[rid][g]; }), avg = vals.length ? U.sum(vals) / vals.length : 0;
    return avg * 0.06 * C.B2B.termBonus[d.term];
  };
  function bestDepot(S, rid) {
    var b = S.biz.b2b, ds = b.depots;
    if (ds[rid]) return Object.assign({ rid: rid, reach: 1 }, ds[rid]);
    var best = null; U.keys(ds).forEach(function (r) { if (!best || ds[r].price < best.price) best = Object.assign({ rid: r, reach: 0.5 }, ds[r]); });
    return best;
  }
  function attract(S, d, mkt, my) {
    var pf = U.clamp(1 + (1 - my / mkt) * 6, 0.1, 2.5);
    return d.rel * d.reach * C.B2B.termBonus[d.term] * pf;
  }

  /* ========================================================================
   * 每日结算：散户进货 → 收款 / 记应收 → 到期收账、坏账、跑路 → AI 合同送货 → 新合同邀约 → 巨头反制
   * ===================================================================== */
  B2.dailyTick = function (S) {
    var b = S.biz && S.biz.b2b; if (!b || !U.keys(b.depots).length) { if (b) b.last = null; return null; }
    var Hk = BT.Hawkers, out = { rev: 0, cogs: 0, cost: 0, cash: 0, units: 0, credit: 0, bad: 0, lost: 0 };
    b.share = {};
    var rivalA = b.war && b.war.until >= S.day ? 2.2 : 1; /* 巨头开了批发部：市场那一侧更有吸引力 */
    C.REGIONS.forEach(function (r) {
      var d = bestDepot(S, r.id); if (!d || !Hk) return;
      var wh = BT.Biz.warehouse(S, d.rid); b.share[r.id] = {};
      C.HAWKERS.goods.forEach(function (gid) {
        var sellers = Hk.sellers(S, r.id, gid); if (!sellers) return;
        var demand = Math.round(sellers * C.B2B.perSeller);
        var mkt = Math.min(BT.Eco.buyPrice(S, gid, r.id), BT.Eco.buyPrice(S, gid, 'market') * 1.03), my = /* 散户也可以自己跑批发市场进货 */ U.round2(BT.Eco.buyPrice(S, gid, d.rid) * d.price * (d.reach < 1 ? 1 + C.B2B.freight : 1));
        var A = attract(S, d, mkt, my), share = Math.min(0.85, A / (A + rivalA));
        var want = Math.round(demand * share), have = wh.goods[gid] || 0, q = Math.min(want, have);
        b.share[r.id][gid] = Math.round((want ? share * q / want : share) * 100) / 100;
        if (want > have && have > 0) { out.lost += want - have; b.depots[d.rid].short = true; } /* 卖着卖着断货才算不稳定；压根没进的货 = 不经营 */
        if (q <= 0) return;
        wh.goods[gid] = have - q;
        var unitCost = (wh.cost && wh.cost[gid]) || BT.Eco.buyPrice(S, gid, d.rid) * 0.85, amt = U.round2(q * my);
        out.rev += amt; out.cogs += q * unitCost; out.units += q;
        if (d.reach < 1) out.cost += q * my * C.B2B.freight;
        if (d.term) { b.ar.push({ rid: r.id, amt: amt, due: S.day + d.term, term: d.term, day: S.day }); out.credit += amt; }
        else out.cash += amt;
      });
    });
    U.keys(b.depots).forEach(function (rid) { var dd = b.depots[rid]; dd.rel = dd.short ? Math.max(0.3, dd.rel - 0.05) : Math.min(1, dd.rel + 0.02); dd.short = false; });
    /* 收账 / 坏账 */
    b.ar = b.ar.filter(function (a) {
      if (a.due > S.day) return true;
      var p = (C.B2B.badDebt[a.rid] || 0.02) * (a.term >= 15 ? 1.5 : 1);
      if (rng.chance(p)) { b.bad.push({ rid: a.rid, amt: a.amt, day: S.day }); out.bad += a.amt; }
      else out.cash += a.amt;
      return false;
    });
    /* 卷货跑路：某区欠款太多 */
    C.REGIONS.forEach(function (r) {
      var owed = U.sum(b.ar.filter(function (a) { return a.rid === r.id; }), function (a) { return a.amt; });
      if (owed > 2000 && rng.chance(C.B2B.runaway)) {
        var lost = 0; b.ar.forEach(function (a) { if (a.rid === r.id) { var x = a.amt * 0.15; a.amt -= x; lost += x; } });
        b.bad.push({ rid: r.id, amt: Math.round(lost), day: S.day, run: true }); out.bad += lost;
        BT.Log.add('🏃 ' + r.name + '有个欠你货款的摊贩卷货跑路了，损失约 ' + U.money(lost) + '。账期给得越长、欠款越集中，越容易出这种事。', 'bad');
      }
    });
    if (b.bad.length > 30) b.bad = b.bad.slice(-30);
    /* AI 连锁供货合同：每天送货，货到付款 */
    b.contracts = b.contracts.filter(function (c) {
      var rv = BT.Rivals && BT.Rivals.get(S, c.rivalId);
      if (!rv || !rv.alive) return false;
      if (c.until < S.day) { BT.Log.add('📜 和 ' + rv.name + ' 的 ' + C.goodsMap[c.gid].name + ' 供货合同到期了。', 'event'); return false; }
      var src = U.keys(b.depots).filter(function (r) { return (BT.Biz.warehouse(S, r).goods[c.gid] || 0) >= c.qty; })[0];
      if (!src) {
        var pen = Math.round(c.qty * c.price * 0.5); out.cost += pen; c.miss = (c.miss || 0) + 1; rv.att -= 3;
        BT.Log.add('⚠️ 仓库 ' + C.goodsMap[c.gid].name + ' 不够，给 ' + rv.name + ' 的供货违约，赔付 ' + U.money(pen) + '。', 'bad');
        if (c.miss >= 3) { BT.Log.add('📜 连续违约，' + rv.name + ' 终止了供货合同。', 'bad'); rv.att -= 10; return false; }
        return true;
      }
      var wh = BT.Biz.warehouse(S, src), uc = (wh.cost && wh.cost[c.gid]) || BT.Eco.buyPrice(S, c.gid, src) * 0.85;
      wh.goods[c.gid] -= c.qty; out.rev += c.qty * c.price; out.cogs += c.qty * uc; out.cash += c.qty * c.price; out.units += c.qty;
      rv.att = Math.min(100, rv.att + 0.15); /* 合作越久关系越好 */
      return true;
    });
    /* 新邀约：不敌对的 AI 每隔一阵来找你 */
    b.offers = b.offers.filter(function (o) { return o.expire >= S.day; });
    if (BT.Rivals && S.day >= (b.nextOffer || 0) && rng.chance(0.12)) {
      var cand = BT.Rivals.alive(S).filter(function (rv) { return rv.att > -15 && !b.contracts.some(function (c) { return c.rivalId === rv.id; }); });
      if (cand.length) {
        var rv = rng.pick(cand), gid = rng.pick(C.HAWKERS.goods), base = BT.Eco.buyPrice(S, gid, 'market');
        b.offers.push({ id: 'o' + (b.seq++), rivalId: rv.id, gid: gid, qty: rng.int(2, 6) * 10, price: U.round2(base * rng.range(0.98, 1.06)), days: 30, expire: S.day + 3 });
        b.nextOffer = S.day + rng.int(6, 12);
        BT.Log.add('📨 ' + rv.icon + rv.name + ' 想找你长期供货 ' + C.goodsMap[gid].name + '（「业务线 → 批发」查看）。', 'event');
      }
    }
    /* 巨头反制：你的批发份额太大 → 开自己的批发部打价格战 */
    if (!(b.war && b.war.until >= S.day)) {
      var all = []; U.keys(b.share).forEach(function (r) { U.keys(b.share[r]).forEach(function (g) { all.push(b.share[r][g]); }); });
      var avg = all.length ? U.sum(all) / all.length : 0, big = BT.Rivals && BT.Rivals.alive(S).filter(function (x) { return x.tier === 'big' && x.cash > 60000 && !BT.Rivals.allied(S, x); })[0];
      if (big && avg > 0.4 && rng.chance(0.012)) {
        b.war = { by: big.id, until: S.day + 15 }; big.cash -= 15000;
        BT.Log.add('🦈 ' + big.icon + big.name + ' 也开了批发部，低价抢散户客户（约 15 天）。你的批发份额会被分走，可以降价或给更长账期顶住。', 'bad');
      }
    }
    S.cash += out.cash; if (out.cost) S.cash -= out.cost;
    out.rev = Math.round(out.rev); out.cogs = Math.round(out.cogs); out.cost = Math.round(out.cost); out.bad = Math.round(out.bad);
    out.profit = out.rev - out.cogs - out.cost - out.bad;
    b.last = out; b.hist.push({ day: S.day, profit: out.profit, rev: out.rev, credit: Math.round(out.credit) }); if (b.hist.length > 30) b.hist.shift();
    return out;
  };

  /* ---- AI 合同：接受 / 拒绝 / 断供 ---- */
  B2.respond = function (S, offerId, accept) {
    var b = B2.ensure(S), o = b.offers.filter(function (x) { return x.id === offerId; })[0];
    if (!o) return { ok: false, msg: '邀约已过期' };
    b.offers = b.offers.filter(function (x) { return x !== o; });
    var rv = BT.Rivals.get(S, o.rivalId);
    if (!accept) { if (rv) rv.att -= 2; return { ok: true, msg: '已婉拒' }; }
    if (!U.keys(b.depots).length) return { ok: false, msg: '先开一个批发部' };
    b.contracts.push({ id: 'c' + (b.seq++), rivalId: o.rivalId, gid: o.gid, qty: o.qty, price: o.price, until: S.day + o.days, start: S.day });
    if (rv) rv.att = Math.min(100, rv.att + 8);
    return { ok: true, msg: '签约：每天给 ' + (rv ? rv.name : '对方') + ' 供 ' + C.goodsMap[o.gid].name + ' ' + o.qty + ' 件 @' + U.money(o.price) + '，' + o.days + ' 天。仓库记得备货！' };
  };
  B2.cutOff = function (S, cid) {
    var b = B2.ensure(S), c = b.contracts.filter(function (x) { return x.id === cid; })[0]; if (!c) return { ok: false, msg: '合同不存在' };
    var rv = BT.Rivals.get(S, c.rivalId), pen = Math.round(c.qty * c.price * Math.max(0, c.until - S.day) * 0.2);
    if (S.cash < pen) return { ok: false, msg: '违约金不够（' + U.money(pen) + '）' };
    BT.Eco.pay(S, pen, '断供违约金：' + (rv ? rv.name : ''));
    b.contracts = b.contracts.filter(function (x) { return x !== c; });
    if (rv) { rv.cutUntil = S.day + 10; rv.att -= 30; }
    BT.Log.add('✂️ 你对 ' + (rv ? rv.icon + rv.name : '对方') + ' 断供了 ' + C.goodsMap[c.gid].name + '：它 10 天内货架空一块，全城吸引力 ×0.8。它会记恨你。', 'event');
    return { ok: true, msg: '已断供，付违约金 ' + U.money(pen) };
  };
  /** 催收坏账：付 20% 手续费，60% 概率追回一半；口碑（品牌）−1 */
  B2.collect = function (S) {
    var b = B2.ensure(S), tot = U.sum(b.bad, function (x) { return x.amt; });
    if (tot < 100) return { ok: false, msg: '没有可以催收的坏账' };
    var fee = Math.round(tot * 0.2); if (S.cash < fee) return { ok: false, msg: '手续费不够（' + U.money(fee) + '）' };
    BT.Eco.pay(S, fee, '委托催收坏账'); S.biz.brand = Math.max(0, S.biz.brand - 1);
    b.bad = [];
    if (rng.chance(0.6)) { var back = Math.round(tot * 0.5); BT.Eco.earn(S, back, '催收追回坏账'); return { ok: true, msg: '追回了 ' + U.money(back) + '（坏账共 ' + U.money(tot) + '）' }; }
    return { ok: true, msg: '催收没成功，坏账 ' + U.money(tot) + ' 只能认了' };
  };
  /** v7.5 应收账款保理：把还没到期的应收账款卖给银行，立刻拿钱（无追索权：之后的坏账算银行的）。
   *  手续费 6% + 平均剩余天数 × 0.3%（最多 12%），信用 ≥ 600 才做 */
  B2.factorQuote = function (S) {
    var b = S.biz && S.biz.b2b; if (!b || !b.ar.length) return null;
    var amt = U.sum(b.ar, function (a) { return a.amt; }), days = U.sum(b.ar, function (a) { return Math.max(0, a.due - S.day) * a.amt; }) / Math.max(1, amt);
    var fee = Math.min(0.12, 0.06 + days * 0.003);
    return { amt: Math.round(amt), fee: Math.round(fee * 1000) / 1000, cash: Math.round(amt * (1 - fee)), days: Math.round(days * 10) / 10 };
  };
  B2.factor = function (S) {
    var q = B2.factorQuote(S); if (!q) return { ok: false, msg: '没有应收账款' };
    if (S.biz.creditScore < 600) return { ok: false, msg: '信用评级要 ≥ 600 银行才肯做保理' };
    S.biz.b2b.ar = []; BT.Eco.earn(S, q.cash, '应收账款保理');
    var L = S.biz.ledger[S.biz.ledger.length - 1]; if (L) { L.other = (L.other || 0) + (q.amt - q.cash); L.profit -= q.amt - q.cash; }
    return { ok: true, msg: '保理成功：' + U.money(q.amt) + ' 应收账款按 ' + Math.round((1 - q.fee) * 1000) / 10 + '% 折现，到账 ' + U.money(q.cash) + '（之后的坏账风险归银行）' };
  };
  /** 净资产：应收账款按 9 折计 */
  B2.netWorth = function (S) { var b = S.biz && S.biz.b2b; return b ? Math.round(U.sum(b.ar, function (a) { return a.amt; }) * 0.9) : 0; };
  B2.summary = function (S) {
    var b = S.biz && S.biz.b2b; if (!b) return null;
    var ar = U.sum(b.ar, function (a) { return a.amt; }), soon = U.sum(b.ar.filter(function (a) { return a.due <= S.day + 3; }), function (a) { return a.amt; });
    var bad30 = U.sum(b.bad.filter(function (x) { return x.day > S.day - 30; }), function (x) { return x.amt; });
    var p7 = U.sum(b.hist.slice(-7), function (h) { return h.profit; });
    return { ar: Math.round(ar), soon: Math.round(soon), bad: Math.round(U.sum(b.bad, function (x) { return x.amt; })), bad30: Math.round(bad30), p7: Math.round(p7) };
  };
})();
