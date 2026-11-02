/* ==========================================================================
 * 文件：js/core/city.js
 * 作用：城市发展事件 —— 让城市本身在变化：
 *   🚇 地铁规划：公布后沿线两个区房价 +8%，30 天后通车，客流永久 +8%、房价再 +7%
 *   🏗️ 新商圈规划：某区客流永久 +6%，房价 +10%
 *   地段升值的代价：这些区的门店房租上涨 10%（自有物业不受影响），还会吸引一家 AI 公司进驻或扩店。
 *   🏚️ 旧城改造：城中村 / 老街施工 10 天客流 −25%；你在那里的物业被征收，按市价 1.4 倍补偿
 *   🌀 台风：提前 1 天预警；码头、批发市场停业 2 天，其余区客流 −40%；码头 / 批发仓库与门店损失 15% 存货（财产险赔 90%）
 *   🔥 火灾：随机一家门店存货烧毁 40%，停业 2 天（财产险赔 90%）
 *   🎪 大型展会：提前 3 天公布，商业街客流 ×1.4 持续 4 天
 *   商会里和「地产商」关系好，规划类消息会提前 7 天以「内部消息」告诉你（房价还没涨）。
 * 数据：S.city = { perm:{rid:mul}, temp:[{rid, mul, days, label}], pending:[{type, rids, at, publicDay, ...}], lastDay, metroLines }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var City = BT.City = {};

  function st(S) { if (!S.city) S.city = { perm: {}, temp: [], pending: [], lastDay: 0, metroLines: 0, news: [] }; S.city.news = S.city.news || []; return S.city; }
  City.state = st;
  City.traffic = function (S, rid) {
    if (!S || !S.city) return 1;
    var m = S.city.perm[rid] || 1;
    S.city.temp.forEach(function (t) { if (t.rid === rid) m *= t.mul; });
    return m;
  };
  function news(S, text, type) { var c = st(S); c.news.unshift({ day: S.day, text: text }); if (c.news.length > 20) c.news.pop(); BT.Log.add(text, type || 'event'); }
  function bump(S, rid, pct) { if (BT.Empire && BT.Empire.bump) BT.Empire.bump(S, rid, pct); }
  function rn(rid) { return C.regionMap[rid].name; }
  function insider(S) { return BT.Social && BT.Social.level && BT.Social.level(S, 'realtor') >= 50; }

  /** 灾害损失：按区域烧毁 / 冲走门店与仓库存货的一定比例，财产险赔 90% */
  function loseGoods(S, rids, frac, what, shopOnly) {
    if (!S.biz) return 0;
    var loss = 0;
    S.biz.shops.forEach(function (sh) {
      if (rids.indexOf(sh.regionId) < 0 || (shopOnly && sh.id !== shopOnly)) return;
      U.keys(sh.inventory).forEach(function (g) { var q = Math.floor((sh.inventory[g] || 0) * frac); if (q > 0) { sh.inventory[g] -= q; loss += q * ((sh.cost && sh.cost[g]) || BT.Eco.buyPrice(S, g, sh.regionId)); } });
    });
    if (!shopOnly) rids.forEach(function (rid) {
      var wh = S.biz.warehouses[rid]; if (!wh) return;
      U.keys(wh.goods).forEach(function (g) { var q = Math.floor((wh.goods[g] || 0) * frac); if (q > 0) { wh.goods[g] -= q; loss += q * ((wh.cost && wh.cost[g]) || BT.Eco.buyPrice(S, g, rid)); } });
    });
    loss = Math.round(loss);
    if (loss > 0) {
      var paid = BT.Insurance ? BT.Insurance.claim(S, 'property', loss, 0.9, what) : 0;
      BT.Log.add('💥 ' + what + '：存货损失 ' + U.money(loss) + (paid ? '，财产险赔付 ' + U.money(paid) : '，没买财产险，损失自担') + '。', 'bad');
    }
    return loss;
  }

  var TYPES = {
    metro: { w: 3, cooldown: 60 }, district: { w: 3, cooldown: 50 }, renewal: { w: 2, cooldown: 80 },
    typhoon: { w: 3, cooldown: 35 }, fire: { w: 2, cooldown: 40, needBiz: true }, expo: { w: 4, cooldown: 25 }
  };
  City.dailyTick = function (S) {
    var c = st(S);
    /* 1) 临时效果倒计时；关店倒计时 */
    c.temp = c.temp.filter(function (t) { t.days -= 1; if (t.days <= 0 && t.end) BT.Log.add(t.end, 'info'); return t.days > 0; });
    if (S.biz) S.biz.shops.forEach(function (sh) { if (sh.closedDays > 0) sh.closedDays--; });
    /* 2) 待发生的事件 */
    c.pending = c.pending.filter(function (p) {
      if (p.publicDay != null && S.day === p.publicDay) publicize(S, p);
      if (S.day < p.at) return true;
      happen(S, p); return false;
    });
    /* 3) 新事件（开局 10 天后，平均约 12 天一件） */
    if (S.day < 10 || S.day - c.lastDay < 6 || !rng.chance(0.09)) return;
    c.hist = c.hist || {};
    var pool = U.keys(TYPES).filter(function (k) { var t = TYPES[k]; return (!t.needBiz || (S.biz && S.biz.shops.length)) && (c.hist[k] == null || S.day - c.hist[k] >= t.cooldown); });
    var type = rng.weighted(pool, function (k) { return TYPES[k].w; }); if (!type) return;
    c.hist[type] = S.day; c.lastDay = S.day;
    plan(S, type);
  };
  function plan(S, type) {
    var c = st(S), p = { type: type };
    if (type === 'metro') {
      var pool = C.REGIONS.map(function (r) { return r.id; }); var a = rng.pick(pool), b = rng.pick(pool.filter(function (x) { return x !== a; }));
      c.metroLines += 1; p.rids = [a, b]; p.line = c.metroLines + 2; p.publicDay = S.day + 7; p.at = p.publicDay + 30;
    } else if (type === 'district') { p.rids = [rng.pick(C.REGIONS).id]; p.publicDay = S.day + 7; p.at = p.publicDay + 15; }
    else if (type === 'renewal') { p.rids = [rng.pick(['slum', 'oldst'])]; p.publicDay = S.day + 7; p.at = p.publicDay + 10; }
    else if (type === 'typhoon') { p.rids = ['port', 'market']; p.at = S.day + 1; news(S, '🌀 气象台台风预警：台风明天登陆！码头、批发市场将停业 2 天，其他区域客流大减。可以提前把货调走，或者赶紧买财产险。', 'bad'); }
    else if (type === 'fire') { var sh = rng.pick(S.biz.shops); p.rids = [sh.regionId]; p.shopId = sh.id; p.at = S.day; }
    else if (type === 'expo') { p.rids = ['cbd']; p.at = S.day + 3; news(S, '🎪 新港国际商品博览会 3 天后在商业街开幕，届时客流 ×1.4，持续 4 天。', 'event'); }
    if (p.publicDay != null && insider(S)) BT.Log.add('🤫 内部消息（地产商朋友透露）：' + describe(p) + '。7 天后才会正式公布，现在房价还没动。', 'good');
    c.pending.push(p);
    if (p.at <= S.day) { c.pending.pop(); happen(S, p); }
  }
  /** 地段升值的代价：房租涨 10%（自有物业的店不受影响）；一家 AI 公司进驻或扩店 */
  function hotter(S, rid) {
    if (S.biz) S.biz.shops.forEach(function (sh) { if (sh.regionId === rid) sh.rent = Math.round(sh.rent * 1.1); });
    if (!BT.Rivals || !S.biz || !S.biz.rivals) return;
    var rv = rng.pick(BT.Rivals.alive(S)); if (!rv) return;
    if (rv.shops[rid]) { if (rv.shops[rid].level < 3) rv.shops[rid].level++; }
    else rv.shops[rid] = { level: 1, rep: 40 };
    BT.Log.add('🏗️ ' + rv.icon + rv.name + ' 看好' + rn(rid) + '，' + (rv.shops[rid].level > 1 ? '扩大了门店' : '进驻开店') + '。', 'event');
  }
  function describe(p) {
    if (p.type === 'metro') return '地铁' + p.line + '号线将连通' + rn(p.rids[0]) + '和' + rn(p.rids[1]);
    if (p.type === 'district') return rn(p.rids[0]) + '将被规划为新商圈';
    if (p.type === 'renewal') return rn(p.rids[0]) + '将启动旧城改造';
    return '';
  }
  function publicize(S, p) {
    if (p.type === 'metro') { p.rids.forEach(function (r) { bump(S, r, 0.08); }); news(S, '🚇 规划公布：' + describe(p) + '，30 天后通车。沿线房价应声上涨 8%。'); }
    else if (p.type === 'district') news(S, '🏗️ 规划公布：' + describe(p) + '，15 天后正式启用。');
    else if (p.type === 'renewal') news(S, '🏚️ 规划公布：' + describe(p) + '，10 天后开工。片区内的物业将被征收（按市价 1.4 倍补偿）。');
  }
  function happen(S, p) {
    var c = st(S);
    if (p.type === 'metro') {
      p.rids.forEach(function (r) { c.perm[r] = U.round2((c.perm[r] || 1) * 1.08); bump(S, r, 0.07); hotter(S, r); });
      news(S, '🚇 地铁' + p.line + '号线通车！' + rn(p.rids[0]) + '、' + rn(p.rids[1]) + '客流永久 +8%，房价再涨 7%；沿线门店房租上涨 10%，也引来了新的竞争者。', 'good');
    } else if (p.type === 'district') {
      var r = p.rids[0]; c.perm[r] = U.round2((c.perm[r] || 1) * 1.06); bump(S, r, 0.1); hotter(S, r);
      news(S, '🏙️ ' + rn(r) + '新商圈启用：客流永久 +6%，房价 +10%；门店房租上涨 10%，对手也闻风而来。', 'good');
    } else if (p.type === 'renewal') {
      var r2 = p.rids[0];
      c.temp.push({ rid: r2, mul: 0.75, days: 10, label: '施工', end: '🏚️ ' + rn(r2) + '改造施工结束。' });
      if (S.estate && S.estate[r2] && BT.Empire) {
        var comp = Math.round(BT.Empire.price(S, r2) * 1.4); delete S.estate[r2];
        BT.Eco.earn(S, comp, rn(r2) + '物业征收补偿');
        news(S, '🏚️ ' + rn(r2) + '旧城改造开工，你的物业被征收，获得补偿 ' + U.money(comp) + '（市价 1.4 倍）。施工期间客流 −25%。', 'good');
      } else news(S, '🏚️ ' + rn(r2) + '旧城改造开工，施工 10 天客流 −25%。');
      bump(S, r2, 0.12);
    } else if (p.type === 'typhoon') {
      C.REGIONS.forEach(function (r) { c.temp.push({ rid: r.id, mul: p.rids.indexOf(r.id) >= 0 ? 0.02 : 0.6, days: 2, label: '🌀 台风', end: r.id === 'port' ? '🌤️ 台风过去了，各区恢复营业。' : null }); });
      news(S, '🌀 台风登陆！码头、批发市场停业 2 天，全城客流大减。', 'bad');
      loseGoods(S, p.rids, 0.15, '台风');
    } else if (p.type === 'fire') {
      var sh = S.biz && BT.Biz.findShop(S.biz, p.shopId); if (!sh) return;
      sh.closedDays = 2;
      news(S, '🔥 ' + rn(sh.regionId) + '店发生火灾！门店停业 2 天。', 'bad');
      BT.Bus.emit('fx', { kind: 'alert', text: '🔥 ' + rn(sh.regionId) + '店失火' });
      loseGoods(S, [sh.regionId], 0.4, rn(sh.regionId) + '店火灾', sh.id);
    } else if (p.type === 'expo') {
      c.temp.push({ rid: 'cbd', mul: 1.4, days: 4, label: '🎪 博览会', end: '🎪 博览会闭幕。' });
      news(S, '🎪 博览会开幕！商业街客流 ×1.4，持续 4 天。', 'good');
    }
  }
  /** 给 UI：各区当前的城市修正 */
  City.board = function (S) {
    var c = st(S);
    return C.REGIONS.map(function (r) {
      return { rid: r.id, perm: c.perm[r.id] || 1, temp: c.temp.filter(function (t) { return t.rid === r.id; }), now: City.traffic(S, r.id) };
    });
  };
  City.upcoming = function (S) {
    var c = st(S);
    return c.pending.filter(function (p) { return p.publicDay == null || S.day >= p.publicDay || insider(S); }).map(function (p) { return { p: p, text: describe(p) || ({ typhoon: '🌀 台风登陆', expo: '🎪 博览会开幕', fire: '' })[p.type], inDays: p.at - S.day, insider: p.publicDay != null && S.day < p.publicDay }; });
  };
})();
