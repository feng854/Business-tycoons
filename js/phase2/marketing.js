/* ==========================================================================
 * 文件：js/phase2/marketing.js
 * 作用：广告投放 —— 四种渠道，覆盖范围、价格、效果各不相同：
 *   📄 传单：便宜，只覆盖一个区，4 天客流 +15%
 *   🚇 地铁广告：按线路覆盖 3 个区，7 天客流 +12%，品牌 +1
 *   📺 电视广告：全城 10 天客流 +10%，品牌每天 +0.4（共 +4）
 *   🤳 网红带货：指定区域 + 商品，结果随机：爆火（该商品需求 ×2.5，5 天，品牌 +2）/ 一般（×1.3，3 天）/ 翻车（口碑 −10，品牌 −2）
 * 数据：S.biz.ads = [{ch, regions:[], days, mul, gid, gmul, brandPerDay}]
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Ads = BT.Ads = {};

  Ads.METRO = { line1: { name: '1号线（商业街—批发市场—车站码头）', regions: ['cbd', 'market', 'port'] }, line2: { name: '2号线（老街—学院区—城中村）', regions: ['oldst', 'college', 'slum'] } };
  Ads.CH = {
    flyer: { name: '传单', icon: '📄', days: 4, mul: 1.15, desc: '一个区 4 天，客流 +15%' },
    metro: { name: '地铁广告', icon: '🚇', days: 7, mul: 1.12, cost: 6000, desc: '一条线 3 个区 7 天，客流 +12%，品牌 +1' },
    tv: { name: '电视广告', icon: '📺', days: 10, mul: 1.10, cost: 25000, desc: '全城 10 天，客流 +10%，品牌共 +4' },
    kol: { name: '网红带货', icon: '🤳', cost: 3000, desc: '指定区域 + 商品：可能爆火、一般或翻车' }
  };
  Ads.flyerCost = function (rid) { return 300 + C.regionMap[rid].rent * 10; };
  function list(S) { S.biz.ads = S.biz.ads || []; return S.biz.ads; }
  Ads.active = function (S) { return S.biz ? list(S) : []; };

  Ads.traffic = function (S, rid) {
    if (!S || !S.biz || !S.biz.ads) return 1;
    var m = 1; S.biz.ads.forEach(function (a) { if (a.mul && a.regions.indexOf(rid) >= 0) m *= a.mul; });
    return m;
  };
  Ads.demand = function (S, rid, gid) {
    if (!S || !S.biz || !S.biz.ads) return 1;
    var m = 1; S.biz.ads.forEach(function (a) { if (a.gid === gid && a.regions.indexOf(rid) >= 0 && a.gmul) m *= a.gmul; });
    return m;
  };

  /** 投放：ch=渠道；arg=区域（传单 / 网红）或线路（地铁）；gid=网红带货的商品 */
  Ads.run = function (S, ch, arg, gid) {
    if (!S.biz) return { ok: false, msg: '成立公司后才能投广告' };
    var c = Ads.CH[ch]; if (!c) return { ok: false, msg: '没有这个渠道' };
    var cost = ch === 'flyer' ? Ads.flyerCost(arg) : c.cost, regions;
    if (ch === 'flyer' || ch === 'kol') { if (!C.regionMap[arg]) return { ok: false, msg: '请选择区域' }; regions = [arg]; }
    else if (ch === 'metro') { var line = Ads.METRO[arg]; if (!line) return { ok: false, msg: '请选择线路' }; regions = line.regions.slice(); }
    else regions = C.REGIONS.map(function (r) { return r.id; });
    if (ch === 'kol' && (!C.goodsMap[gid] || C.goodsMap[gid].lux)) return { ok: false, msg: '请选择要带货的普通商品' };
    if (list(S).some(function (a) { return a.ch === ch && a.regions.join() === regions.join() && (ch !== 'kol' || a.gid === gid); })) return { ok: false, msg: '同样的广告还在投放中' };
    if (S.cash < cost) return { ok: false, msg: '预算不够（需要 ' + U.money(cost) + '）' };
    BT.Eco.pay(S, cost, c.name + '投放');
    var a = { id: BT.uid('ad'), ch: ch, regions: regions, days: c.days || 0, mul: c.mul || 0, label: c.icon + c.name };
    if (ch === 'metro') S.biz.brand = U.clamp(S.biz.brand + 1, 0, 100);
    if (ch === 'tv') a.brandPerDay = 0.4;
    var msg = c.name + '已投放：' + regions.map(function (r) { return C.regionMap[r].name; }).join('、');
    if (ch === 'kol') {
      var roll = rng.next(), g = C.goodsMap[gid], rn = C.regionMap[arg].name;
      a.gid = gid; a.mul = 0;
      if (roll < 0.6) { a.gmul = 2.5; a.days = 5; S.biz.brand = U.clamp(S.biz.brand + 2, 0, 100); msg = '🔥 爆了！网红在' + rn + '带货' + g.icon + g.name + '，需求 ×2.5 持续 5 天，品牌 +2'; BT.Bus.emit('fx', { kind: 'level', text: '🔥 ' + g.name + ' 带货爆火！' }); }
      else if (roll < 0.85) { a.gmul = 1.3; a.days = 3; msg = '网红带货反响一般：' + rn + ' ' + g.name + ' 需求 ×1.3，3 天'; }
      else {
        a.days = 0; S.biz.brand = U.clamp(S.biz.brand - 2, 0, 100);
        S.biz.shops.forEach(function (sh) { if (sh.regionId === arg) sh.reputation = U.clamp(sh.reputation - 10, 0, 100); });
        msg = '😱 翻车了！网红直播时说错产品信息被骂上热搜，' + rn + '门店口碑 −10，品牌 −2';
        BT.Bus.emit('fx', { kind: 'alert', text: '😱 网红带货翻车' });
      }
      a.label += '·' + g.name;
    }
    if (a.days > 0) list(S).push(a);
    BT.Log.add('📣 ' + msg, ch === 'kol' && !a.days ? 'bad' : 'good');
    return { ok: true, msg: msg };
  };

  Ads.dailyTick = function (S) {
    if (!S.biz || !S.biz.ads) return;
    S.biz.ads = S.biz.ads.filter(function (a) {
      if (a.brandPerDay) S.biz.brand = U.clamp(S.biz.brand + a.brandPerDay, 0, 100);
      a.days -= 1;
      if (a.days <= 0) BT.Log.add('📣 ' + a.label + '（' + a.regions.map(function (r) { return C.regionMap[r].name; }).join('、') + '）投放结束。', 'info');
      return a.days > 0;
    });
  };
})();
