/* ==========================================================================
 * 文件：js/phase2/insurance.js
 * 作用：企业保险 —— 按 30 天一期投保：
 *   🏢 财产险：保费 = 门店 + 存货价值的 0.5%（最低 ¥200）。火灾、台风等灾害损失赔 90%，奢侈品失窃全赔。
 *   🚢 货运险：每期 ¥800。正规进口海运途中有 8% 概率货损（损坏 10~30%），投保则全额赔付。
 *      水货被海关没收属于违法风险，任何保险都不赔。
 * 数据：S.biz.ins = { property: 到期日, cargo: 到期日, claims: 累计理赔 }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U;
  var Ins = BT.Insurance = {};
  Ins.DAYS = 30; Ins.CARGO_FEE = 800; Ins.CARGO_DAMAGE = 0.08;

  function st(S) { S.biz.ins = S.biz.ins || { property: 0, cargo: 0, claims: 0 }; return S.biz.ins; }
  Ins.has = function (S, kind) { return !!(S && S.biz && S.biz.ins && S.biz.ins[kind] >= S.day); };
  Ins.daysLeft = function (S, kind) { return Ins.has(S, kind) ? S.biz.ins[kind] - S.day : 0; };
  Ins.insuredValue = function (S) {
    var v = 0; if (!S.biz) return 0;
    S.biz.shops.forEach(function (sh) { v += sh.value || 0; U.keys(sh.inventory).forEach(function (g) { v += (sh.inventory[g] || 0) * BT.Eco.buyPrice(S, g, sh.regionId); }); });
    U.keys(S.biz.warehouses).forEach(function (rid) { var wh = S.biz.warehouses[rid]; U.keys(wh.goods).forEach(function (g) { v += (wh.goods[g] || 0) * BT.Eco.buyPrice(S, g, rid); }); });
    return v;
  };
  Ins.premium = function (S, kind) { return kind === 'cargo' ? Ins.CARGO_FEE : Math.max(200, Math.round(Ins.insuredValue(S) * 0.005)); };
  Ins.buy = function (S, kind) {
    if (!S.biz) return { ok: false, msg: '成立公司后才能投保' };
    if (kind !== 'property' && kind !== 'cargo') return { ok: false, msg: '没有这个险种' };
    var p = Ins.premium(S, kind); if (S.cash < p) return { ok: false, msg: '保费不够（需要 ' + U.money(p) + '）' };
    BT.Eco.pay(S, p, (kind === 'cargo' ? '货运险' : '财产险') + '保费（30 天）');
    var i = st(S); i[kind] = Math.max(i[kind] || 0, S.day - 1) + Ins.DAYS;
    return { ok: true, msg: (kind === 'cargo' ? '货运险' : '财产险') + '已生效，保到第 ' + i[kind] + ' 天' };
  };
  /** 理赔：rate=赔付比例；返回实际赔了多少 */
  Ins.claim = function (S, kind, loss, rate, what) {
    if (!Ins.has(S, kind) || !(loss > 0)) return 0;
    var pay = Math.round(loss * rate); if (pay <= 0) return 0;
    var old = BT.Eco.cat; BT.Eco.cat = 'other'; BT.Eco.earn(S, pay, '保险理赔：' + what); BT.Eco.cat = old;
    st(S).claims += pay;
    return pay;
  };
  Ins.dailyTick = function (S) {
    if (!S.biz || !S.biz.ins) return;
    ['property', 'cargo'].forEach(function (k) { if (S.biz.ins[k] === S.day) BT.Log.add('🛡️ ' + (k === 'cargo' ? '货运险' : '财产险') + '今天到期，记得续保。', 'sys'); });
  };
})();
