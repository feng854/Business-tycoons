/* ==========================================================================
 * 文件：js/phase1/hawkers.js
 * 作用：小型对手「散户池」—— 个体小店 / 流动摊贩。从第一阶段摆摊开始就和你抢客。
 *   · 不单独建模，每个区域只记一个数量 n，平时围着基准值波动；
 *   · 跟风：你在哪个区卖什么赚了钱，就有人跟着卖同款；什么货爆火，他们就扎堆；
 *   · 游击压价：隔三岔五有人甩卖某样货（比基准价低 10%~18%，持续 2~4 天）；
 *   · 城管查摊时他们也会被清走一部分。
 * 影响：摆摊（Stall.run）、第一阶段小店（Shop.dailyTick）、公司门店的单品比价（Rivals.priceHit）。
 * 数据：S.hawkers = { r: { regionId: { n, heat, follow:{gid,until}, cut:{gid:{v,until}} } } }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Hk = BT.Hawkers = {};

  Hk.ensure = function (S) {
    if (!S.hawkers) S.hawkers = { r: {} };
    C.REGIONS.forEach(function (r) {
      if (!S.hawkers.r[r.id]) S.hawkers.r[r.id] = { n: C.HAWKERS.base[r.id] || 4, heat: 0, follow: null, cut: {} };
    });
    return S.hawkers;
  };
  function reg(S, rid) { return Hk.ensure(S).r[rid]; }
  function carries(gid) { return C.HAWKERS.goods.indexOf(gid) >= 0; }
  function hot(S, rid, gid) {
    var h = reg(S, rid);
    if (h.follow && h.follow.gid === gid && h.follow.until >= S.day) return true;
    return BT.Trends && BT.Trends.mul ? BT.Trends.mul(S, rid, gid) >= 1.3 : false;
  }

  /** 在卖这件货的摊贩有几家（跟风 / 爆款时一半人都在卖；平时每样大众货约 18% 的人在卖） */
  Hk.sellers = function (S, rid, gid) {
    var h = reg(S, rid); if (!h || h.n <= 0) return 0;
    if (hot(S, rid, gid)) return h.n * 0.5;
    return carries(gid) ? h.n * 0.18 : 0;
  };
  /** 摊贩的售价（不卖这件货时返回 0） */
  Hk.price = function (S, rid, gid) {
    if (!Hk.sellers(S, rid, gid)) return 0;
    var c = reg(S, rid).cut[gid], cut = c && c.until >= S.day ? c.v : C.HAWKERS.cut;
    return U.round2(BT.Eco.sellPrice(S, gid, rid) * (1 - cut));
  };
  /** 是否正在甩卖这件货（游击压价） */
  Hk.dumping = function (S, rid, gid) { var c = reg(S, rid) && reg(S, rid).cut[gid]; return !!(c && c.until >= S.day && Hk.sellers(S, rid, gid)); };
  /** 对你摆摊 / 小店客流的影响：同款摊贩越多、你比他们贵得越多，分走越多。weight 用来调强弱（小店 0.5） */
  Hk.factor = function (S, rid, gid, myPrice, weight) {
    var m = Hk.sellers(S, rid, gid), hp = Hk.price(S, rid, gid);
    if (!m || !hp) return { mul: 1, n: 0, price: 0 };
    var sens = C.REGION_PRICE_SENS[rid] || 1;
    var adv = U.clamp(1 + (myPrice / hp - 1) * sens * 2, 0.4, 3);
    var mul = 1 / (1 + m * C.HAWKERS.k * adv * (weight == null ? 1 : weight));
    return { mul: U.round2(mul), n: Math.round(m * 10) / 10, price: hp, total: reg(S, rid).n };
  };
  /** 你在某区卖货赚了钱 → 记“热度”，引来跟风的人 */
  Hk.note = function (S, rid, gid, revenue) {
    var h = reg(S, rid); if (!h) return;
    h.heat += revenue;
    if (revenue > 60 && carries(gid) && !(h.follow && h.follow.until >= S.day) && rng.chance(Math.min(0.35, revenue / 600))) {
      h.follow = { gid: gid, until: S.day + rng.int(5, 10) };
      h.n += rng.int(1, 2);
      var g = C.goodsMap[gid];
      BT.Log.add('👀 ' + C.regionMap[rid].name + '有摊贩看你卖' + g.icon + g.name + '赚钱，也跟着卖同款了（约 ' + (h.follow.until - S.day) + ' 天）。', 'bad');
    }
  };
  /** 城管清场：摊贩也会被赶走一部分 */
  Hk.clear = function (S, rid, k) { var h = reg(S, rid); if (h) h.n = Math.max(0, h.n - (k || 2)); };

  Hk.dailyTick = function (S) {
    Hk.ensure(S);
    var mine = {}; /* 你有生意的区域：只有这些区的游击压价才发新闻 */
    if (S.stall) mine[S.stall.regionId] = S.stall.goodsId;
    if (S.shop) mine[S.shop.regionId] = mine[S.shop.regionId] || U.keys(S.shop.shelf)[0];
    if (S.biz) S.biz.shops.forEach(function (sh) { if (!mine[sh.regionId]) mine[sh.regionId] = U.keys(sh.shelf).filter(carries)[0] || null; });
    C.REGIONS.forEach(function (r) {
      var h = S.hawkers.r[r.id], base = C.HAWKERS.base[r.id] || 4;
      h.heat *= 0.8;
      /* 进场：基准概率 + 你在这赚得越多越吸引人；离场：人太多、压价太狠都待不住，并向基准值回归 */
      var enter = 0.08 + Math.min(0.35, h.heat / 1500);
      var leave = 0.06 + (h.n > base * 1.5 ? 0.15 : 0) + (h.n > base ? 0.05 : 0);
      if (h.n < base * 2.2 && rng.chance(enter)) h.n += 1;
      if (h.n > 0 && rng.chance(leave)) h.n -= 1;
      if (h.n < base * 0.5 && rng.chance(0.3)) h.n += 1;
      /* 清理过期的跟风 / 压价 */
      if (h.follow && h.follow.until < S.day) h.follow = null;
      U.keys(h.cut).forEach(function (g) { if (h.cut[g].until < S.day) delete h.cut[g]; });
      /* 游击压价：优先挑你正在卖的货 */
      if (h.n >= 2 && !U.keys(h.cut).length && rng.chance(0.04 * (h.heat > 300 ? 1.5 : 1))) {
        var gid = mine[r.id] && carries(mine[r.id]) && rng.chance(0.6) ? mine[r.id] : rng.pick(C.HAWKERS.goods);
        var v = U.round2(rng.range(0.10, 0.18)), days = rng.int(2, 4);
        h.cut[gid] = { v: v, until: S.day + days - 1 };
        if (mine[r.id] !== undefined) {
          var g = C.goodsMap[gid];
          BT.Log.add('🛒 ' + r.name + '有几家摊贩在甩卖' + g.icon + g.name + '，比市价便宜 ' + Math.round(v * 100) + '%，持续约 ' + days + ' 天。', gid === mine[r.id] ? 'bad' : 'event');
        }
      }
    });
  };

  /** UI：某区散户概况 */
  Hk.info = function (S, rid) {
    var h = reg(S, rid); if (!h) return null;
    var cuts = U.keys(h.cut).filter(function (g) { return h.cut[g].until >= S.day; }).map(function (g) { return { gid: g, v: h.cut[g].v, left: h.cut[g].until - S.day + 1 }; });
    return { n: h.n, base: C.HAWKERS.base[rid] || 4, follow: h.follow && h.follow.until >= S.day ? h.follow : null, cuts: cuts };
  };
})();
