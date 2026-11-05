/* ==========================================================================
 * 文件：js/core/social.js
 * 作用：商会人脉 + 商业情报 + 新港富豪榜
 *   🤝 新港商会：净资产 ≥ ¥5 万可入会（会费 ¥8,000 / 180 天）。会里能结识三位朋友，宴请可以加深关系（每人 3 天一次，花钱花时间），关系会慢慢变淡：
 *      🏦 银行家：关系 ≥30 贷款利率 ×0.85；≥60 利率 ×0.7、可贷额度 +20%
 *      🏢 地产商：关系 ≥30 买物业免 2% 税费；≥50 城市规划提前 7 天「内部消息」
 *      🛃 报关专家：关系 ≥30 正规进口被抽检概率减半；≥60 水货查扣率 ×0.7（他熟悉查验规律）
 *   🕵️ 商业情报：花 ¥2,000 摸清一家 AI 公司 14 天的底细（真实现金、利润、最可能对你下手的区域）；15% 概率被发现，对方会更激进。
 *   🏆 新港富豪榜：每 90 天发布一次，你和 AI 公司、城里的老牌富豪同榜。进前 10 品牌 +2；进前 3 太显眼，对手 30 天内更激进。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var So = BT.Social = {};
  So.CONTACTS = {
    banker: { name: '钱行长', icon: '🏦', role: '新港银行行长', perk: '≥30 贷款利率 ×0.85；≥60 利率 ×0.7、额度 +20%' },
    realtor: { name: '房总', icon: '🏢', role: '地产开发商', perk: '≥30 买物业免税费；≥50 城市规划提前 7 天知道' },
    customs: { name: '关先生', icon: '🛃', role: '资深报关专家', perk: '≥30 正规进口抽检减半；≥60 水货查扣率 ×0.7' }
  };
  So.FEE = 8000; So.DAYS = 180; So.MIN_NET = 50000;
  var TYCOONS = [['李嘉华', 1.8e7], ['陈天佑', 9e6], ['黄美玲', 6.5e6], ['郑国强', 4.2e6], ['吴晓光', 2.6e6], ['林秀英', 1.5e6], ['赵建国', 8e5], ['孙小龙', 4.5e5]];

  function st(S) {
    if (!S.social) S.social = { until: 0, contacts: { banker: { rel: 0, last: -9 }, realtor: { rel: 0, last: -9 }, customs: { rel: 0, last: -9 } }, rich: null, nextRich: 90 };
    return S.social;
  }
  So.state = st;
  So.member = function (S) { return !!(S && S.social && S.social.until >= S.day); };
  So.level = function (S, k) { return So.member(S) && S.social.contacts[k] ? S.social.contacts[k].rel : 0; };
  So.join = function (S) {
    if (BT.netWorth(S) < So.MIN_NET) return { ok: false, msg: '商会只收净资产 ≥ ' + U.money(So.MIN_NET) + ' 的会员' };
    if (S.cash < So.FEE) return { ok: false, msg: '会费不够（' + U.money(So.FEE) + '）' };
    var s = st(S); BT.Eco.pay(S, So.FEE, '新港商会会费（' + So.DAYS + ' 天）');
    s.until = Math.max(s.until, S.day - 1) + So.DAYS;
    return { ok: true, msg: '入会成功，会籍到第 ' + s.until + ' 天' };
  };
  So.dinnerCost = function (S, k) { return 600 + Math.round(st(S).contacts[k].rel * 20); };
  So.dinner = function (S, k) {
    if (!So.member(S)) return { ok: false, msg: '先加入商会' };
    var c = st(S).contacts[k]; if (!c) return { ok: false, msg: '没有这个人' };
    if (S.day - c.last < 3) return { ok: false, msg: '刚请过，' + (c.last + 3 - S.day) + ' 天后再约' };
    var cost = So.dinnerCost(S, k); if (S.cash < cost) return { ok: false, msg: '饭钱不够（' + U.money(cost) + '）' };
    if (S.energy < 15) return { ok: false, msg: '太累了，应酬不动' };
    if (S.hour + 3 > C.DAY_END_H + 2) return { ok: false, msg: '太晚了，改天吧' };
    BT.Eco.pay(S, cost, '宴请' + So.CONTACTS[k].name);
    var gain = Math.round(rng.range(8, 14) * (1 - c.rel / 160)); c.rel = U.clamp(c.rel + gain, 0, 100); c.last = S.day;
    BT.Eco.spend(S, { energy: 15, hours: 3 });
    return { ok: true, msg: '和' + So.CONTACTS[k].name + '吃了顿饭，关系 +' + gain + '（' + Math.round(c.rel) + '）' };
  };
  /* 加成（被 Biz / Empire / Lux 调用） */
  So.loanMul = function (S) { var r = So.level(S, 'banker'); return r >= 60 ? 0.7 : (r >= 30 ? 0.85 : 1); };
  So.loanCapMul = function (S) { return So.level(S, 'banker') >= 60 ? 1.2 : 1; };
  So.estateFeeFree = function (S) { return So.level(S, 'realtor') >= 30; };
  So.inspectMul = function (S) { return So.level(S, 'customs') >= 30 ? 0.5 : 1; };
  So.seizeMul = function (S) { return So.level(S, 'customs') >= 60 ? 0.7 : 1; };

  /* 商业情报 */
  So.SPY_COST = 2000;
  So.spy = function (S, rivalId) {
    var rv = BT.Rivals && BT.Rivals.get(S, rivalId); if (!rv || !rv.alive) return { ok: false, msg: '这家公司已经不存在了' };
    if (S.cash < So.SPY_COST) return { ok: false, msg: '情报费不够（' + U.money(So.SPY_COST) + '）' };
    BT.Eco.pay(S, So.SPY_COST, '商业调查：' + rv.name);
    rv.intelUntil = S.day + 14;
    if (rng.chance(0.15)) {
      rv.aggr = Math.min(1, rv.aggr + 0.2); rv.angryUntil = S.day + 30;
      BT.Log.add('😠 打探 ' + rv.name + ' 的事被对方发现了，它放话要给你点颜色看看（30 天内更激进）。', 'bad');
      return { ok: true, msg: '拿到情报，但被对方发现了！' };
    }
    return { ok: true, msg: '拿到 ' + rv.name + ' 的内部情报（14 天有效）' };
  };
  /** 情报内容：对你威胁最大的区域（它最可能打价格战 / 跟进开店的地方） */
  So.intel = function (S, rv) {
    if (!(rv.intelUntil >= S.day)) return null;
    var targets = [];
    if (rv.plan && rv.plan.on === 'me') targets.push(C.regionMap[rv.plan.rid].name + '（已定好第 ' + rv.plan.start + ' 天动手：' + rv.plan.goods.map(function (g) { return C.goodsMap[g].name; }).join('、') + '）');
    if (S.biz) S.biz.shops.forEach(function (sh) {
      if (rv.plan && rv.plan.rid === sh.regionId) return;
      var share = BT.Rivals.shares(S, sh.regionId), me = share.filter(function (x) { return x.me; })[0], it = share.filter(function (x) { return x.id === rv.id; })[0];
      if (it && me && me.share > it.share * 0.9) targets.push(C.regionMap[sh.regionId].name + '（可能打价格战）');
      else if (!rv.shops[sh.regionId] && sh.last && sh.last.profit > 0) targets.push(C.regionMap[sh.regionId].name + '（可能跟进开店）');
    });
    return { cash: Math.round(rv.cash), profit7: U.sum(rv.profit7 || []), targets: targets, aggr: rv.aggr, angry: rv.angryUntil >= S.day };
  };

  /* 富豪榜 */
  So.richList = function (S) {
    var rows = [{ name: '你', wealth: BT.netWorth(S) + (BT.IPO && BT.IPO.premium ? Math.max(0, BT.IPO.premium(S)) : 0), me: true }];
    var grow = Math.pow(1.0015, S.day);
    TYCOONS.forEach(function (t, i) { rows.push({ name: t[0], wealth: Math.round(t[1] * grow * (1 + 0.15 * Math.sin(S.day / 60 + i))) }); });
    if (BT.Rivals && S.biz && S.biz.rivals) BT.Rivals.alive(S).forEach(function (rv) { rows.push({ name: rv.name + '（老板）', wealth: Math.round(BT.Rivals.valuation(S, rv) * 1.5) }); });
    rows.sort(function (a, b) { return b.wealth - a.wealth; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  };
  So.dailyTick = function (S) {
    var s = st(S);
    U.keys(s.contacts).forEach(function (k) { s.contacts[k].rel = Math.max(0, s.contacts[k].rel - 0.2); });
    if (s.until === S.day) BT.Log.add('🤝 商会会籍今天到期，记得续费。', 'sys');
    if (BT.Rivals && S.biz && S.biz.rivals) S.biz.rivals.forEach(function (rv) { if (rv.angryUntil === S.day) rv.aggr = Math.max(0.2, rv.aggr - 0.2); if (rv.spotUntil === S.day) rv.aggr = Math.max(0.2, rv.aggr - 0.1); });
    if (S.day >= s.nextRich) {
      s.nextRich = S.day + 90;
      var rows = So.richList(S), me = rows.filter(function (r) { return r.me; })[0];
      s.rich = { day: S.day, rows: rows.slice(0, 12), myRank: me.rank, total: rows.length };
      if (me.rank <= 10 && S.biz) S.biz.brand = U.clamp(S.biz.brand + 2, 0, 100);
      if (me.rank <= 3 && BT.Rivals && S.biz) BT.Rivals.alive(S).forEach(function (rv) { rv.aggr = Math.min(1, rv.aggr + 0.1); rv.spotUntil = S.day + 30; });
      S.stats.bestRank = Math.min(S.stats.bestRank || 99, me.rank);
      BT.Log.add('🏆 新港富豪榜发布：你排第 ' + me.rank + ' 名（身家 ' + U.money(me.wealth) + '）' + (me.rank <= 10 ? '，品牌 +2' : '') + (me.rank <= 3 ? '。太显眼了，对手们盯上你了' : '') + '。', me.rank <= 10 ? 'good' : 'info');
      if (me.rank <= 10) BT.Bus.emit('fx', { kind: 'level', text: '🏆 富豪榜第 ' + me.rank + ' 名' });
    }
  };
})();
