/* ==========================================================================
 * 文件：js/phase3/venture.js
 * 作用：天使投资 —— 不定期有初创公司来路演，你出钱换股份：
 *   每过 25~40 天走一轮：倒闭（血本无归）/ 估值下调 / 新一轮融资估值翻 2~3.5 倍 / 被收购或上市退出（3~15 倍）。
 *   大多数会失败，少数大赚。科技类项目受科技股（云港科技）近期走势影响。
 *   未退出的投资按成本计入净资产（保守估值），退出时才兑现。
 * 数据：S.vc = { pitches:[...], holds:[{id,name,sector,invest,stake,valuation,round,next,alive}], realized, lost }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var U = BT.U, rng = BT.rng;
  var VC = BT.Venture = {};
  var IDEAS = [
    ['tech', '🤖', '智能收银机器人'], ['tech', '📱', '社区团购小程序'], ['tech', '🛰️', '无人机配送'], ['tech', '🧠', 'AI 选品助手'],
    ['food', '🧋', '新式茶饮连锁'], ['food', '🥟', '速冻手工饺子'], ['food', '🍜', '螺蛳粉预制菜'],
    ['retail', '🧸', '潮玩盲盒'], ['retail', '👟', '国潮运动鞋'], ['retail', '💄', '平价彩妆'],
    ['green', '🔋', '换电电动车'], ['green', '♻️', '旧衣回收']
  ];
  var PREFIX = ['小', '快', '新', '乐', '优', '云', '派', '酷'];
  function st(S) { if (!S.vc) S.vc = { pitches: [], holds: [], realized: 0, lost: 0, next: S.day + 6 }; return S.vc; }
  VC.state = st;
  VC.unlocked = function (S) { return BT.netWorth(S) >= 50000; };
  VC.netWorth = function (S) { return S.vc ? U.sum(S.vc.holds.filter(function (h) { return h.alive; }), function (h) { return h.invest; }) : 0; };
  VC.paperValue = function (h) { return Math.round(h.valuation * h.stake); };
  VC.invest = function (S, id) {
    var v = st(S), p = v.pitches.filter(function (x) { return x.id === id; })[0]; if (!p) return { ok: false, msg: '项目已经找到别的投资人了' };
    if (!VC.unlocked(S)) return { ok: false, msg: '净资产 ≥ ¥50,000 才有人找你投资' };
    if (S.cash < p.ask) return { ok: false, msg: '现金不够（需要 ' + U.money(p.ask) + '）' };
    var old = BT.Eco.cat; BT.Eco.pay(S, p.ask, '天使投资：' + p.name);
    v.pitches = v.pitches.filter(function (x) { return x.id !== id; });
    v.holds.push({ id: BT.uid('vch'), name: p.name, icon: p.icon, sector: p.sector, invest: p.ask, stake: p.stake, valuation: p.valuation, round: 0, next: S.day + rng.int(25, 40), alive: true, day: S.day });
    return { ok: true, msg: '投资 ' + p.name + ' ' + U.money(p.ask) + '，占股 ' + (p.stake * 100).toFixed(1) + '%' };
  };
  function techTrend(S) { var h = S.market && S.market.stocks.ygkj && S.market.stocks.ygkj.hist; if (!h || h.length < 21) return 0; return h[h.length - 1].c / h[h.length - 21].c - 1; }
  VC.dailyTick = function (S) {
    var v = st(S);
    v.pitches = v.pitches.filter(function (p) { return p.expire >= S.day; });
    if (S.day >= v.next && VC.unlocked(S)) {
      v.next = S.day + rng.int(8, 14);
      var idea = rng.pick(IDEAS), val = Math.round(rng.range(1, 10)) * 100000, ask = Math.round(val * rng.range(0.03, 0.12) / 1000) * 1000;
      v.pitches.push({ id: BT.uid('vcp'), name: rng.pick(PREFIX) + idea[2].slice(0, 2) + ['科技', '优品', '生活', '工坊'][rng.int(0, 3)], icon: idea[1], sector: idea[0], desc: idea[2], valuation: val, ask: ask, stake: ask / val, expire: S.day + 5,
        risk: idea[0] === 'tech' ? '高风险高回报' : (idea[0] === 'food' ? '中等风险' : '中高风险') });
      BT.Log.add('💡 有创业者来路演：' + idea[1] + idea[2] + '，估值 ' + U.money(val) + '，想融 ' + U.money(ask) + '（5 天内有效）。', 'event');
    }
    v.holds.forEach(function (h) {
      if (!h.alive || S.day < h.next) return;
      h.round += 1; h.next = S.day + rng.int(25, 40);
      var tech = h.sector === 'tech' ? U.clamp(techTrend(S) * 1.5, -0.1, 0.1) : 0, r = rng.next();
      var pFail = (h.sector === 'tech' ? 0.33 : 0.27) - tech, pDown = 0.25, pExit = h.round >= 2 ? 0.14 + tech / 2 : 0.04;
      if (h.round >= 5) pExit = 0.6;
      if (r < pFail) {
        h.alive = false; h.fate = '倒闭'; v.lost += h.invest;
        BT.Log.add('💀 ' + h.icon + h.name + ' 烧完钱倒闭了，投资 ' + U.money(h.invest) + ' 打了水漂。', 'bad');
      } else if (r < pFail + pExit) {
        var mul = h.round >= 3 && rng.chance(0.4) ? rng.range(6, 15) : rng.range(3, 6), cash = Math.round(h.valuation * mul * h.stake);
        h.alive = false; h.fate = mul >= 6 ? '上市' : '被收购'; h.exit = cash; v.realized += cash;
        var old = BT.Eco.cat; BT.Eco.cat = 'invest'; BT.Eco.earn(S, cash, '天使投资退出：' + h.name + '（' + h.fate + '）'); BT.Eco.cat = old;
        BT.Log.add('🎉 ' + h.icon + h.name + (h.fate === '上市' ? ' 成功上市！' : ' 被大公司收购！') + '你的股份兑现 ' + U.money(cash) + '（投入 ' + U.money(h.invest) + '，' + (cash / h.invest).toFixed(1) + ' 倍）。', 'good');
        BT.Bus.emit('fx', { kind: 'big', text: '🎉 ' + h.name + ' ' + h.fate + '！' });
      } else if (r < pFail + pExit + pDown) {
        h.valuation = Math.round(h.valuation * rng.range(0.6, 1)); BT.Log.add('📉 ' + h.icon + h.name + ' 新一轮融资估值下调到 ' + U.money(h.valuation) + '。', 'info');
      } else {
        h.valuation = Math.round(h.valuation * rng.range(1.8, 3.5)); h.stake *= 0.85; /* 新一轮融资会稀释你的股份 */
        BT.Log.add('🚀 ' + h.icon + h.name + ' 完成新一轮融资，估值涨到 ' + U.money(h.valuation) + '（你的股份被稀释到 ' + (h.stake * 100).toFixed(1) + '%）。', 'good');
      }
    });
  };
})();
