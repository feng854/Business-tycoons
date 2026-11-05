/* ==========================================================================
 * 文件：js/phase3/empire.js
 * 作用：第三阶段 —— 资本帝国的轻量实现：企业并购（M&A）与连锁品牌加成；
 *       跨城市经营 / 房地产投资 / 大宗制造物流 作为「敬请期待」占位，
 *       但数据结构（见下方 C.CITIES）已预留，方便后续直接扩展不用重构。
 * 解锁条件（闸门二，可在 config 调整）：拥有 ≥3 间店铺 且净资产 ≥ ¥20,000
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco, rng = BT.rng;
  var Empire = BT.Empire = {};

  /* 预留：未来「跨城市经营」直接往这个数组里加新城市 + 新区域即可，
     不需要改动 Biz / Market 的任何数据结构（它们都是按 regionId 寻址的）。 */
  C.CITIES = [
    { id: 'newport', name: '新港市', regions: C.REGIONS, status: 'active' },
    { id: 'rivercity', name: '江城', regions: [], status: 'locked' },
    { id: 'skyharbor', name: '云港', regions: [], status: 'locked' }
  ];

  Empire.GATE = { minShops: 3, minNet: 20000 };

  Empire.unlocked = function (S) {
    var biz = S.biz;
    if (!biz) return false;
    return biz.shops.length >= Empire.GATE.minShops && BT.netWorth(S) >= Empire.GATE.minNet;
  };

  /* ========================================================================
   * 一、并购要约（随机事件：可以出价收购某区域的竞争对手份额）
   * ===================================================================== */
  Empire.rollOffer = function (S) {
    if (!Empire.unlocked(S)) return;
    if (S.empireOffer) return;
    if (!rng.chance(0.12) || !BT.Rivals) return;
    var cands = [];
    BT.Rivals.alive(S).forEach(function (rv) { U.keys(rv.shops).forEach(function (rid) { cands.push({ rv: rv, rid: rid }); }); });
    if (!cands.length) return;
    var c = rng.pick(cands), sh = c.rv.shops[c.rid];
    var price = Math.round(C.regionMap[c.rid].rent * 45 * sh.level * 1.6 + sh.rep * 60 + rng.int(500, 3000));
    S.empireOffer = { regionId: c.rid, rivalId: c.rv.id, level: sh.level, rep: sh.rep, price: price };
    BT.Log.add('🤝 并购机会：' + c.rv.name + ' 愿以 ' + U.money(price) + ' 出让' + C.regionMap[c.rid].name + '的 ' + sh.level + ' 级门店及其客源。', 'event');
  };

  Empire.acceptOffer = function (S) {
    var offer = S.empireOffer; if (!offer) return { ok: false, msg: '没有待处理的并购要约' };
    if (S.cash < offer.price) return { ok: false, msg: '资金不够' };
    var rv = BT.Rivals && BT.Rivals.get(S, offer.rivalId);
    Eco.pay(S, offer.price, '并购' + C.regionMap[offer.regionId].name + (rv ? ' ' + rv.name + ' 门店' : '竞争对手'));
    if (rv && rv.shops[offer.regionId]) {
      BT.Rivals.takeOverShop(S, offer.regionId, offer.level || 1, offer.rep || 40, offer.price * 0.6);
      delete rv.shops[offer.regionId]; delete rv.war[offer.regionId]; rv.cash += offer.price;
    }
    S.biz.brand = U.clamp(S.biz.brand + 4, 0, 100);
    BT.Log.add('🏢 并购完成！' + C.regionMap[offer.regionId].name + ' 的市场份额已纳入麾下。', 'good');
    S.empireOffer = null;
    if (BT.Rivals) BT.Rivals.syncCompetitors(S);
    return { ok: true, msg: '并购成功' };
  };
  Empire.declineOffer = function (S) { S.empireOffer = null; return { ok: true, msg: '已拒绝' }; };

  /* ========================================================================
   * 二、房地产：每个区域可买一处物业，价格随机游走，每日收租、扣维护费
   *     S.estate[regionId] = { cost, bought }；S.estatePrice[regionId] = 当前市价
   * ===================================================================== */
  Empire.BUY_FEE = 0.02; Empire.SELL_FEE = 0.03; Empire.YIELD = 0.0016; Empire.UPKEEP = 0.25;
  Empire.basePrice = function (rid) { return Math.round(C.regionMap[rid].rent * 3000); };
  Empire.ensure = function (S) {
    S.estate = S.estate || {}; S.estatePrice = S.estatePrice || {};
    C.REGIONS.forEach(function (r) { if (!S.estatePrice[r.id]) S.estatePrice[r.id] = Empire.basePrice(r.id); });
  };
  Empire.price = function (S, rid) { Empire.ensure(S); return S.estatePrice[rid]; };
  /** 自己在这个区有门店 → 物业自用，不对外出租（门店免交房租） */
  Empire.selfUse = function (S, rid) { return !!(S.biz && S.biz.shops.some(function (sh) { return sh.regionId === rid; })); };
  Empire.dailyRent = function (S, rid) { return Empire.selfUse(S, rid) ? 0 : Math.round(Empire.price(S, rid) * Empire.YIELD * (1 - Empire.UPKEEP)); };
  Empire.marketRent = function (S, rid) { return Math.round(Empire.price(S, rid) * Empire.YIELD * (1 - Empire.UPKEEP)); };
  /** 城市事件对房价的冲击（地铁、新商圈、改造） */
  Empire.bump = function (S, rid, pct) { Empire.ensure(S); S.estatePrice[rid] = Math.round(S.estatePrice[rid] * (1 + pct)); };
  Empire.netWorth = function (S) {
    var v = 0; U.keys(S.estate || {}).forEach(function (rid) { v += (S.estatePrice && S.estatePrice[rid]) || 0; });
    return v;
  };
  Empire.buy = function (S, rid) {
    if (!Empire.unlocked(S)) return { ok: false, msg: '资本帝国尚未解锁' };
    Empire.ensure(S); if (S.estate[rid]) return { ok: false, msg: '已经拥有这里的物业' };
    var free = BT.Social && BT.Social.estateFeeFree(S); /* 商会：和地产商关系好，免税费 */
    var price = S.estatePrice[rid], total = Math.round(price * (1 + (free ? 0 : Empire.BUY_FEE)));
    if (S.cash < total) return { ok: false, msg: '资金不足（' + (free ? '' : '含 2% 税费') + '需要 ' + U.money(total) + '）' };
    Eco.pay(S, total, '购置' + C.regionMap[rid].name + '物业');
    S.estate[rid] = { cost: price, bought: S.day };
    return { ok: true, msg: '已购入 ' + C.regionMap[rid].name + ' 物业' + (free ? '（地产商朋友帮忙免了税费）' : '') + '，' + (Empire.selfUse(S, rid) ? '你在这里的门店从此免交房租' : '每日约收租 ' + U.money(Empire.dailyRent(S, rid))) };
  };
  Empire.sell = function (S, rid) {
    if (!S.estate || !S.estate[rid]) return { ok: false, msg: '没有这处物业' };
    var net = Math.round(S.estatePrice[rid] * (1 - Empire.SELL_FEE));
    Eco.earn(S, net, '出售' + C.regionMap[rid].name + '物业（扣3%税费）');
    delete S.estate[rid];
    return { ok: true, msg: '物业已出售' };
  };
  Empire.estateTick = function (S) {
    Empire.ensure(S);
    C.REGIONS.forEach(function (r) {
      var base = Empire.basePrice(r.id), p = S.estatePrice[r.id];
      /* 缓慢均值回归 + 小幅随机 + 跟随地产股（滨海地产）当日涨跌 + 新港元利率（降息房价涨） */
      var link = 0;
      if (S.market && S.market.stocks.bhdc) { var h = S.market.stocks.bhdc.hist, prev = h.length ? h[h.length - 1].c : 0; if (prev) link += (S.market.stocks.bhdc.price / prev - 1) * 0.35; }
      if (S.market && S.market.rates) link += (0.025 - S.market.rates.hgd) * 0.4;
      var anchor = base * ((S.city && S.city.perm && S.city.perm[r.id]) || 1); /* 城市发展后，房价的长期中枢也抬高 */
      p *= 1 + rng.range(-0.012, 0.0135) + (anchor - p) / anchor * 0.01 + link;
      S.estatePrice[r.id] = Math.max(Math.round(base * 0.4), Math.round(p));
    });
    var total = 0;
    U.keys(S.estate).forEach(function (rid) { total += Empire.dailyRent(S, rid); });
    if (total > 0) { var old = Eco.cat; Eco.cat = 'estate'; Eco.earn(S, total, '物业租金'); Eco.cat = old; }
  };

  /* ========================================================================
   * 三、慈善捐赠：提升品牌声望，累计捐赠达标解锁「慈善家」结局
   * ===================================================================== */
  Empire.donate = function (S, amount) {
    amount = Math.floor(amount);
    if (!(amount >= 100)) return { ok: false, msg: '单次至少捐赠 ¥100' };
    if (S.cash < amount) return { ok: false, msg: '现金不足' };
    Eco.pay(S, amount, '慈善捐赠');
    S.stats.donated = (S.stats.donated || 0) + amount;
    if (S.biz) S.biz.brand = U.clamp(S.biz.brand + Math.min(3, amount / 3000), 0, 100);
    return { ok: true, msg: '感谢善举！累计捐赠 ' + U.money(S.stats.donated) };
  };

  Empire.dailyTick = function (S) { Empire.rollOffer(S); if (Empire.unlocked(S) || U.keys(S.estate || {}).length) Empire.estateTick(S); };
})();
