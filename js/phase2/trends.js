/* ==========================================================================
 * 文件：js/phase2/trends.js
 * 作用：热销品类轮换 —— 在「区域客群」底色上叠加会变化的流行趋势：
 *   🌤️ 季节：夏天饮料水果海产旺、冬天服饰茶叶旺；春节礼品季；开学季文具；暑假学院区冷清；国庆黄金周码头老街人多。
 *   🔥 网红爆款：随机某区某商品爆火 3~7 天（需求 ×1.6~2.2），过后 5 天回落到 ×0.75。新闻会提前 3 天预告。
 *   🔍 市场调研：花钱看到未来 14 天的全部爆款排期（比新闻早，抢先备货）。
 * 数据：S.trends = { viral: [{id, rid, gid, mul, start, end, announced}], researchUntil }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Tr = BT.Trends = {};
  var HANG = 5; /* 爆款退烧期：×0.75 */

  function inRange(d, m1, d1, m2, d2) { var k = d.m * 100 + d.d; return k >= m1 * 100 + d1 && k <= m2 * 100 + d2; }
  /** 当天生效的季节性规则：[{rid:'*'|区域, gid:'*'|商品, mul, traffic?, label}] */
  Tr.season = function (day) {
    var d = U.dateOf(day), r = [];
    if (d.m >= 6 && d.m <= 8) r.push({ rid: '*', gid: 'drink', mul: 1.25, label: '☀️ 夏季' }, { rid: '*', gid: 'fruit', mul: 1.15, label: '☀️ 夏季' }, { rid: '*', gid: 'seafood', mul: 1.15, label: '☀️ 夏季' }, { rid: '*', gid: 'cloth', mul: 0.8, label: '☀️ 夏季' }, { rid: '*', gid: 'tea', mul: 0.85, label: '☀️ 夏季' });
    if (d.m === 12 || d.m <= 2) r.push({ rid: '*', gid: 'cloth', mul: 1.25, label: '❄️ 冬季' }, { rid: '*', gid: 'tea', mul: 1.1, label: '❄️ 冬季' }, { rid: '*', gid: 'drink', mul: 0.8, label: '❄️ 冬季' }, { rid: '*', gid: 'fruit', mul: 0.9, label: '❄️ 冬季' });
    if (inRange(d, 1, 20, 2, 15)) r.push({ rid: '*', gid: 'tea', mul: 1.25, label: '🧧 春节礼品季' }, { rid: '*', gid: 'fruit', mul: 1.2, label: '🧧 春节礼品季' }, { rid: '*', gid: 'snack', mul: 1.15, label: '🧧 春节礼品季' }, { rid: '*', gid: 'toy', mul: 1.15, label: '🧧 春节礼品季' }, { rid: '*', gid: 'stationery', mul: 0.8, label: '🧧 春节礼品季' }, { rid: 'cbd', traffic: 0.85, label: '🧧 春节（写字楼放假）' });
    if (inRange(d, 1, 15, 2, 20)) r.push({ rid: 'college', traffic: 0.75, label: '❄️ 寒假（学院区冷清）' });
    if (inRange(d, 2, 20, 3, 10) || inRange(d, 9, 1, 9, 20)) r.push({ rid: 'college', gid: 'stationery', mul: 1.5, label: '🎒 开学季' }, { rid: 'college', gid: 'phonecase', mul: 1.2, label: '🎒 开学季' });
    if (d.m === 7 || d.m === 8) r.push({ rid: 'college', traffic: 0.7, label: '🏖️ 暑假（学院区冷清）' });
    if (inRange(d, 10, 1, 10, 7)) r.push({ rid: 'port', traffic: 1.3, label: '🇨🇳 国庆黄金周' }, { rid: 'oldst', traffic: 1.25, label: '🇨🇳 国庆黄金周' });
    return r;
  };
  function st(S) { if (!S.trends) S.trends = { viral: [], researchUntil: 0 }; return S.trends; }

  Tr.mul = function (S, rid, gid) {
    if (!S) return 1;
    var m = 1;
    Tr.season(S.day).forEach(function (x) { if (x.mul && (x.rid === '*' || x.rid === rid) && (x.gid === '*' || x.gid === gid)) m *= x.mul; });
    (S.trends ? S.trends.viral : []).forEach(function (v) {
      if (v.rid !== rid || v.gid !== gid) return;
      if (S.day >= v.start && S.day <= v.end) m *= v.mul;
      else if (S.day > v.end && S.day <= v.end + HANG) m *= 0.75;
    });
    return m;
  };
  Tr.traffic = function (S, rid) {
    if (!S) return 1; var m = 1;
    Tr.season(S.day).forEach(function (x) { if (x.traffic && (x.rid === '*' || x.rid === rid)) m *= x.traffic; });
    return m;
  };

  /** 每日：预告 3 天内的爆款、清理过期、保持未来 14 天的排期 */
  Tr.dailyTick = function (S) {
    var t = st(S);
    t.viral = t.viral.filter(function (v) { return S.day <= v.end + HANG; });
    t.viral.forEach(function (v) {
      var g = C.goodsMap[v.gid], rn = C.regionMap[v.rid].name;
      if (!v.announced && v.start - S.day <= 3) { v.announced = true; BT.Log.add('📈 流行预告：' + rn + '的' + g.icon + g.name + ' 正在社交平台走红，预计 ' + Math.max(0, v.start - S.day) + ' 天后开始热销（约 ×' + v.mul + '，持续 ' + (v.end - v.start + 1) + ' 天）。', 'event'); }
      if (S.day === v.start) BT.Log.add('🔥 ' + rn + ' ' + g.icon + g.name + ' 爆火了！', 'good');
      if (S.day === v.end + 1) BT.Log.add('📉 ' + rn + ' ' + g.name + ' 热度退去，接下来几天会比平时还冷一点。', 'info');
    });
    var future = t.viral.filter(function (v) { return v.start > S.day; }).length;
    if (future < 3 && rng.chance(0.25)) {
      var rid = rng.pick(C.REGIONS).id;
      var cands = C.GOODS.filter(function (g) { return C.demandOf(rid, g.id) >= 0.8 && !t.viral.some(function (v) { return v.rid === rid && v.gid === g.id; }); });
      if (cands.length) {
        var start = S.day + rng.int(4, 14), dur = rng.int(3, 7);
        t.viral.push({ id: BT.uid('vir'), rid: rid, gid: rng.pick(cands).id, mul: U.round2(rng.range(1.6, 2.2)), start: start, end: start + dur - 1, announced: false });
      }
    }
  };

  Tr.researchCost = function (S) { return 800 + (S.biz ? S.biz.shops.length * 200 : 0); };
  Tr.research = function (S) {
    if (!S.biz) return { ok: false, msg: '成立公司后才能委托调研公司' };
    var c = Tr.researchCost(S); if (S.cash < c) return { ok: false, msg: '调研费不够（需要 ' + U.money(c) + '）' };
    BT.Eco.pay(S, c, '市场调研报告');
    st(S).researchUntil = S.day + 14;
    return { ok: true, msg: '调研报告到手：未来 14 天的流行趋势已全部可见' };
  };
  Tr.researchActive = function (S) { return !!(S.trends && S.trends.researchUntil >= S.day); };
  /** 给 UI：当前季节规则 + 爆款（未调研时只显示已预告的） */
  Tr.board = function (S) {
    var t = st(S), seeAll = Tr.researchActive(S);
    var seasons = {}; Tr.season(S.day).forEach(function (x) { (seasons[x.label] = seasons[x.label] || []).push(x); });
    var viral = t.viral.filter(function (v) { return seeAll || v.announced || S.day >= v.start; }).map(function (v) {
      var state = S.day < v.start ? 'soon' : (S.day <= v.end ? 'hot' : 'cool');
      return { v: v, state: state, insider: !v.announced && S.day < v.start };
    }).sort(function (a, b) { return a.v.start - b.v.start; });
    return { seasons: seasons, viral: viral, research: seeAll, researchLeft: seeAll ? t.researchUntil - S.day : 0 };
  };
})();
