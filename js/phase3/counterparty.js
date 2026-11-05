/* ==========================================================================
 * 文件：js/phase3/counterparty.js
 * 作用：期货 / 外汇的「对手盘」（v7.3）—— 你每一手单子背后都有真实的 AI 对手：
 *   · 盘口有深度：一口气下大单会一档档往上吃，成交均价变差（滑点），价格被你推开后再慢慢回落；
 *   · 每个品种有一群性格不同的 AI 机构，每天按自己的逻辑调仓，资金流推动价格：
 *       期货：趋势基金（追涨杀跌）、产业套保（高抛低吸）、游资（短线投机）、对冲基金（猎杀大户）、做市商（被动接单）
 *       外汇：金管局（汇率偏离太多就干预）、套息基金（借低息买高息，避险时集体平仓）、出口商结汇（汇率高就卖外币）、趋势基金、对冲基金
 *   · 猎杀止损：你仓位大、离强平价又近，对冲基金会反向猛砸 / 猛拉，把你打爆后再撤；临近交割的大仓位会被「逼仓」；
 *   · 持仓报告（类似 COT）：能看到各家 AI 的净多 / 净空、今日增减、你占总持仓量的比例。
 * 联动：market.js 的 tick（资金流进公允价）、开平仓（滑点 + 对手方）、收盘（各家调仓目标 / 猎杀判定）。
 * 数据：S.market.cp = { [id]: { pos:{agent:手}, tgt:{agent:手}, chg:{agent:手}, hunt, cbOn, carryOff, tape:[] } }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var CP = BT.CP = {};

  /* D：盘口每档深度（手），也是各家 AI 仓位的尺度；step：每吃掉一档价格挪多少 */
  CP.CFG = {
    soy: { D: 400, hedge: '中粮油脂' }, rb: { D: 500, hedge: '宝钢集团' }, cl: { D: 150, hedge: '中石化' }, au: { D: 120, hedge: '金店联盟' },
    usd: { D: 60, fx: true }, eur: { D: 60, fx: true }, jpy: { D: 60, fx: true }
  };
  var STEP = { fut: 0.0004, fx: 0.00015 }, FLOWK = { fut: 0.0006, fx: 0.0004 };
  var AG = {
    cta:      { name: '动量资本', icon: '📈', style: '趋势跟踪：涨了追、跌了杀' },
    hedge:    { name: '产业套保', icon: '🏭', style: '产业套保：价高卖出锁利润、价低买入' },
    spec:     { name: '浙江游资', icon: '🎲', style: '短线投机：来去如风' },
    hunter:   { name: '黑石对冲', icon: '🦈', style: '专挑大户：仓位重、离强平近的会被它反向猎杀' },
    cb:       { name: '新港金管局', icon: '🏛️', style: '汇率偏离基准 3% 以上就入场干预' },
    carry:    { name: '套息基金', icon: '💹', style: '借低息货币买高息货币；市场恐慌时集体平仓' },
    exporter: { name: '出口商结汇', icon: '🚢', style: '外币贵了就卖外币换新港元' },
    mm:       { name: '做市商', icon: '🏦', style: '被动接单：别人不接的单都由它接' }
  };
  CP.AGENTS = AG;
  function list(id) { return CP.CFG[id].fx ? ['cb', 'carry', 'exporter', 'cta', 'hunter', 'mm'] : ['hedge', 'cta', 'spec', 'hunter', 'mm']; }
  function kindOf(id) { return CP.CFG[id].fx ? 'fx' : 'fut'; }
  function agName(id, a) { return a === 'hedge' ? CP.CFG[id].hedge : (a === 'mm' ? (CP.CFG[id].fx ? '外资银行做市' : '期货公司做市') : AG[a].name); }
  CP.agName = agName;

  CP.ensure = function (S) {
    var m = S.market; if (!m) return null;
    m.cp = m.cp || {};
    U.keys(CP.CFG).forEach(function (id) {
      if (m.cp[id]) return;
      var D = CP.CFG[id].D, o = { pos: {}, tgt: {}, chg: {}, hunt: null, cbOn: false, carryOff: false, tape: [] };
      list(id).forEach(function (a) { o.pos[a] = 0; o.tgt[a] = 0; o.chg[a] = 0; });
      if (!CP.CFG[id].fx) { o.pos.hedge = o.tgt.hedge = -Math.round(0.4 * D); o.pos.spec = Math.round(0.4 * D); } /* 套保盘天生偏空，游资接了多头 */
      m.cp[id] = o;
    });
    return m.cp;
  };
  function series(S, id) { return CP.CFG[id].fx ? S.market.forex[id] : S.market.futures[id]; }
  function def(id) { return CP.CFG[id].fx ? BT.Market.fxMap[id] : BT.Market.futMap[id]; }
  function myPos(S, id) { var m = S.market; return CP.CFG[id].fx ? m.posFx[id] : m.posFut[id]; }
  /** 总持仓量（手）：AI 多空合计的一半 + 散户底仓 */
  CP.oi = function (S, id) { var o = S.market.cp[id], t = 0; U.keys(o.pos).forEach(function (a) { t += Math.abs(o.pos[a]); }); var p = myPos(S, id); return Math.round(t / 2 + 6 * CP.CFG[id].D + (p ? Math.abs(p.qty) / 2 : 0)); };
  function tape(o, rec) { o.tape.unshift(rec); if (o.tape.length > 24) o.tape.length = 24; }

  /* ========================================================================
   * 一、盘中：各家按目标仓位逐步调仓，净买卖推动公允价（market.js 的 tick 调用）
   * ===================================================================== */
  CP.tickFlow = function (S, it) {
    var cp = CP.ensure(S); if (!cp || !cp[it.id]) return 0;
    var o = cp[it.id], D = CP.CFG[it.id].D, F = 0;
    list(it.id).forEach(function (a) {
      if (a === 'mm') return;
      var rate = a === 'hunter' || a === 'cb' ? 0.3 : (a === 'spec' ? 0.25 : 0.12);
      var d = (o.tgt[a] - o.pos[a]) * rate;
      if (Math.abs(d) < 0.5) return;
      o.pos[a] += d; o.chg[a] += d; F += d;
    });
    o.pos.mm -= F; o.chg.mm -= F; /* 做市商被动接走净流量 */
    var k = kindOf(it.id), v = def(it.id).vol / Math.sqrt(18);
    return U.clamp(F / D * FLOWK[k], -v * 1.5, v * 1.5);
  };

  /* ========================================================================
   * 二、玩家下单：一档档吃盘口（滑点）+ 价格被推开（之后逐 tick 回落）+ 谁接了你的单
   *   dir：+1 买入（开多 / 平空）、-1 卖出（开空 / 平多）；px：已含半个价差的报价
   * ===================================================================== */
  CP.slipOf = function (id, lots) { var k = kindOf(id); return STEP[k] * lots / (2 * CP.CFG[id].D); };
  CP.fill = function (S, kind, id, dir, lots, px) {
    var cp = CP.ensure(S); if (!cp || !cp[id]) return { px: px, who: '' };
    var o = cp[id], D = CP.CFG[id].D, k = kindOf(id), dp = k === 'fx' ? 4 : 2;
    var avg = Math.round(px * (1 + dir * CP.slipOf(id, lots)) * Math.pow(10, dp)) / Math.pow(10, dp);
    var ser = series(S, id);
    ser.price = Math.max(0.01, Math.round(ser.price * (1 + dir * STEP[k] * lots / D * 0.7) * Math.pow(10, dp)) / Math.pow(10, dp)); /* 公允价不动 → 之后回落 */
    if (BT.Market.syncPrice) BT.Market.syncPrice(S, CP.CFG[id].fx ? 'forex' : 'futures', id);
    /* 对手方：先找本来就想反方向调仓的机构，剩下的做市商接 */
    var left = lots, who = [];
    list(id).filter(function (a) { return a !== 'mm' && (o.tgt[a] - o.pos[a]) * -dir > 0.5; })
      .sort(function (a, b) { return Math.abs(o.tgt[b] - o.pos[b]) - Math.abs(o.tgt[a] - o.pos[a]); })
      .forEach(function (a) { if (left <= 0) return; var q = Math.min(left, Math.round(Math.abs(o.tgt[a] - o.pos[a]))); if (q <= 0) return; o.pos[a] -= dir * q; o.chg[a] -= dir * q; left -= q; who.push(agName(id, a) + ' ' + q + '手'); });
    if (left > 0) { o.pos.mm -= dir * left; o.chg.mm -= dir * left; who.push(agName(id, 'mm') + ' ' + left + '手'); }
    tape(o, { day: S.day, hour: S.hour, me: true, dir: dir, q: lots, p: avg, who: who.join('、') });
    return { px: avg, who: who.join('、'), slip: Math.abs(avg - px) };
  };

  /* ========================================================================
   * 三、收盘：各家重新定目标仓位；判定猎杀 / 逼仓 / 干预 / 套息平仓
   * ===================================================================== */
  function trend(S, id) {
    var h = series(S, id).hist; if (!h || h.length < 6) return 0;
    var p0 = h[h.length - 6].c, p1 = series(S, id).price;
    return Math.log(p1 / p0) / (def(id).vol * Math.sqrt(5));
  }
  function news(S, text, type) { BT.Log.add(text, type || 'event'); var m = S.market; m.cpNews = m.cpNews || []; m.cpNews.unshift({ day: S.day, text: text }); if (m.cpNews.length > 20) m.cpNews.pop(); }
  CP.daily = function (S) {
    var cp = CP.ensure(S); if (!cp) return;
    var m = S.market, rates = m.rates || BT.Market.RATES0;
    var ih = m.indexHist || [], riskOff = ih.length > 6 && ih[ih.length - 1].c / ih[ih.length - 6].c - 1 < -0.04;
    U.keys(CP.CFG).forEach(function (id) {
      var o = cp[id], D = CP.CFG[id].D, d = def(id), P = series(S, id).price, base = d.base, fx = CP.CFG[id].fx, name = d.name;
      list(id).forEach(function (a) { o.chg[a] = 0; });
      var tr = U.clamp(trend(S, id), -2, 2), dev = Math.log(P / base);
      o.tgt.cta = Math.round(tr * 0.9 * D);
      if (!fx) {
        o.tgt.hedge = Math.round(-0.4 * D - U.clamp(dev / (d.vol * 8), -2, 2) * D);
        o.tgt.spec = Math.round(0.7 * o.tgt.spec + rng.normal() * 0.5 * D);
      } else {
        var diff = (rates[id] || 0) - rates.hgd;
        var carry = U.clamp(diff / 0.015, -2, 2) * D;
        if (riskOff && Math.abs(carry) > 0.3 * D) { if (!o.carryOff) news(S, '💹 市场恐慌：套息基金在 ' + name + ' 上集体平仓（' + (carry > 0 ? '抛售外币' : '回补外币') + '），汇率可能急跌急涨。', 'bad'); o.carryOff = true; carry *= -0.5; } else o.carryOff = false;
        o.tgt.carry = Math.round(carry);
        o.tgt.exporter = Math.round(-U.clamp(dev / 0.02, -1.5, 2) * 0.8 * D);
        var pd = P / base - 1, band = 0.03;
        if (Math.abs(pd) > band) {
          o.tgt.cb = Math.round(-Math.sign(pd) * Math.min(4 * D, (Math.abs(pd) - band) / 0.005 * D + D));
          if (!o.cbOn) news(S, '🏛️ 新港金管局入场干预 ' + name + '：汇率偏离基准 ' + (pd * 100).toFixed(1) + '%，它在' + (pd > 0 ? '抛售外币' : '买入外币') + '，逆势做单要小心。', 'event');
          o.cbOn = true;
        } else { o.tgt.cb = Math.round(o.tgt.cb * 0.5); if (o.cbOn && Math.abs(pd) < band * 0.6) o.cbOn = false; }
      }
      /* 猎杀：你的仓位重、离强平价近 / 临近交割还占大比例 → 对冲基金反向猛打 */
      var pos = myPos(S, id);
      if (o.hunt && o.hunt.until < S.day) { o.hunt = null; news(S, '🦈 黑石对冲在 ' + name + ' 上的' + (o.huntDir > 0 ? '多' : '空') + '单开始撤退，价格可能回弹。', 'event'); }
      if (pos && pos.qty && !o.hunt) {
        var lots = Math.abs(pos.qty), pdir = pos.qty > 0 ? 1 : -1, L = fx ? 'fx' : 'fut';
        var price = BT.Market.posPrice(S, L, id, pos), liq = BT.Market.liqPrice(pos, d, { mult: fx ? 'lot' : 'mult' }, BT.Market.marginRateOf(S, L, id, pos.ct));
        var dist = liq > 0 ? Math.abs(price - liq) / price : 1, share = lots / CP.oi(S, id);
        var nearExp = !fx && m.futures[id].ct && m.futures[id].ct.expiry - S.day <= 5 && pos.ct === m.futures[id].ct.code;
        var why = null;
        if (lots >= 0.3 * D && dist < (fx ? 0.012 : 0.05) && rng.chance(0.5)) why = '冲着附近的强平单来的（你的强平价约 ' + liq.toFixed(fx ? 4 : 2) + '，只差 ' + (dist * 100).toFixed(1) + '%）';
        else if (nearExp && share >= 0.08 && rng.chance(0.6)) why = '临近交割，你占了 ' + Math.round(share * 100) + '% 的持仓，它在「逼仓」';
        else if (lots >= 1.5 * D && rng.chance(0.15)) why = '你的仓位太显眼（占持仓量 ' + Math.round(share * 100) + '%）';
        if (why) {
          o.hunt = { dir: -pdir, until: S.day + rng.int(1, 3), start: S.day }; o.huntDir = -pdir;
          news(S, '🦈 盘面异动：黑石对冲在 ' + name + ' 上大举' + (pdir > 0 ? '做空' : '做多') + '，' + why + '。可以减仓、追加保证金，或者先撤。', 'bad');
          BT.Bus.emit('fx', { kind: 'alert', text: '🦈 ' + name + ' 有人在猎杀你的仓位' });
        }
      }
      o.tgt.hunter = o.hunt ? Math.round(o.hunt.dir * Math.min(3 * D, Math.max(D, (pos ? Math.abs(pos.qty) : 0) * 1.5))) : 0;
    });
  };

  /* ========================================================================
   * 四、UI 数据：盘口深度、持仓报告、近期对手盘动态
   * ===================================================================== */
  CP.info = function (S, id) {
    var cp = CP.ensure(S); if (!cp || !cp[id]) return null;
    var o = cp[id], D = CP.CFG[id].D, k = kindOf(id), P = series(S, id).price, sp = k === 'fx' ? 0.0002 : 0.0003, dp = k === 'fx' ? 4 : 2;
    var asks = [], bids = [];
    for (var i = 0; i < 5; i++) {
      asks.push({ p: (P * (1 + sp / 2 + STEP[k] * i)).toFixed(dp), q: Math.round(D * (1 + i * 0.25)) });
      bids.push({ p: (P * (1 - sp / 2 - STEP[k] * i)).toFixed(dp), q: Math.round(D * (1 + i * 0.25)) });
    }
    var rows = list(id).map(function (a) { return { id: a, name: agName(id, a), icon: AG[a].icon, style: AG[a].style, pos: Math.round(o.pos[a]), chg: Math.round(o.chg[a]), hunting: a === 'hunter' && !!o.hunt }; });
    var pos = myPos(S, id), oi = CP.oi(S, id);
    var notes = [];
    if (o.hunt) notes.push({ lv: 'bad', t: '🦈 黑石对冲正在' + (o.hunt.dir > 0 ? '拉高' : '打压') + '，目标是你的仓位（约 ' + (o.hunt.until - S.day + 1) + ' 天）' });
    if (o.cbOn) notes.push({ lv: 'warn', t: '🏛️ 金管局正在干预，逆着它做单很难赚' });
    if (o.carryOff) notes.push({ lv: 'warn', t: '💹 套息基金在恐慌平仓' });
    if (Math.abs(o.pos.cta) > D) notes.push({ lv: 'info', t: '📈 趋势基金重仓' + (o.pos.cta > 0 ? '做多' : '做空') + '，趋势还在延续' });
    return { D: D, asks: asks, bids: bids, rows: rows, oi: oi, me: pos ? { lots: pos.qty, share: Math.abs(pos.qty) / oi } : null, notes: notes, tape: o.tape, slip: function (lots) { return CP.slipOf(id, lots); } };
  };
})();
