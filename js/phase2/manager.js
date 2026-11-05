/* ==========================================================================
 * 文件：js/phase2/manager.js
 * 作用：区域经理（自动化管理）—— 门店多了以后，不用每天手动补货改价：
 *   📦 自动补货：每天开门前把各店货架补到目标库存（预算 = 现金的一定比例）
 *   🏷️ 自动定价：按本区当前热度和价格敏感度调整加价（热销提价、滞销降价）
 *   🚚 断供应急：遇到断供自动找应急供应商
 *   🤝 留人：有人来挖墙脚时，开价不超过身价 1.5 倍就自动加薪挽留
 *   日薪 ¥40 + 每家门店 ¥10（4 家店 ¥80/天），相当于花一点钱买省心。
 * 数据：S.biz.mgr = { on, autoRestock, target, budget, autoPrice, emergency, keepTalent, last }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U;
  var Mgr = BT.Manager = {};

  Mgr.get = function (S) {
    if (!S.biz) return null;
    if (!S.biz.mgr) S.biz.mgr = { on: false, autoRestock: true, target: 40, budget: 0.5, autoPrice: true, emergency: true, keepTalent: true, autoDefend: true, last: '' };
    return S.biz.mgr;
  };
  Mgr.wage = function (S) { return 40 + (S.biz ? S.biz.shops.length : 0) * 10; };
  Mgr.hire = function (S) {
    var m = Mgr.get(S); if (!m) return { ok: false, msg: '成立公司后才能聘请区域经理' };
    if (m.on) return { ok: false, msg: '已经有区域经理了' };
    var fee = Mgr.wage(S) * 3; if (S.cash < fee) return { ok: false, msg: '签约费不够（需要 ' + U.money(fee) + '）' };
    BT.Eco.pay(S, fee, '聘请区域经理（签约费）'); m.on = true;
    return { ok: true, msg: '区域经理到岗！每天开门前自动帮你打理门店（日薪 ' + U.money(Mgr.wage(S)) + '）' };
  };
  Mgr.fire = function (S) { var m = Mgr.get(S); if (!m || !m.on) return { ok: false, msg: '没有区域经理' }; m.on = false; return { ok: true, msg: '已解聘区域经理' }; };
  Mgr.set = function (S, key, val) {
    var m = Mgr.get(S); if (!m) return { ok: false };
    if (key === 'target') val = U.clamp(Math.round(val), 10, 200);
    if (key === 'budget') val = U.clamp(val, 0.1, 0.9);
    m[key] = val; return { ok: true, msg: '已更新经理设置' };
  };
  /** 按需求与价格敏感度算出建议加价 */
  Mgr.suggestMarkup = function (S, rid, gid) {
    if (C.goodsMap[gid].lux) return 1.3;
    var d = BT.Eco.demand(S, rid, gid), sens = C.REGION_PRICE_SENS[rid] || 1;
    return U.round2(U.clamp(1.22 + (d - 1) * 0.35 - (sens - 1) * 0.25, 1.05, 1.7));
  };
  /** 每天开门前（economy.sleep 在门店结算之前调用） */
  Mgr.dailyTick = function (S) {
    var m = S.biz && S.biz.mgr; if (!m || !m.on) return;
    var wage = Mgr.wage(S); BT.Eco.pay(S, wage, '区域经理工资');
    var notes = [];
    if (m.autoPrice) {
      var n = 0;
      S.biz.shops.forEach(function (sh) { U.keys(sh.shelf).forEach(function (g) { var t = Mgr.suggestMarkup(S, sh.regionId, g); if (!C.goodsMap[g].lux && !(sh.lock && sh.lock[g]) && Math.abs(t - sh.shelf[g]) >= 0.02) { sh.shelf[g] = t; n++; } }); });
      if (n) notes.push('调价 ' + n + ' 项');
    }
    if (m.autoRestock && S.cash > 0) {
      var r = BT.Biz.autoRestock(S, m.target, { budget: m.budget, emergency: m.emergency });
      if (r.ok) notes.push(r.msg.replace('一键补货完成', '补货'));
    }
    /* v7.3：自动应战 —— 有对手针对哪家店打价格战 / 散户甩卖，经理就替你开「自动应战」，打完再关掉（你自己开的不会被关） */
    if (m.autoDefend !== false && BT.Rivals && BT.Rivals.threats) {
      var hot = {}; BT.Rivals.threats(S).forEach(function (t) { if (t.kind === 'war') hot[t.rid] = true; });
      S.biz.shops.forEach(function (sh) {
        if (hot[sh.regionId] && !sh.match) { sh.match = true; sh.matchByMgr = true; notes.push(C.regionMap[sh.regionId].name + '店开启自动应战'); }
        else if (!hot[sh.regionId] && sh.matchByMgr) { sh.match = false; sh.matchByMgr = false; notes.push(C.regionMap[sh.regionId].name + '店价格战结束，关闭自动应战'); }
      });
    }
    if (m.keepTalent && BT.Rivals) {
      BT.Rivals.deals(S).filter(function (d) { return d.type === 'poach'; }).forEach(function (d) {
        var sh = BT.Biz.findShop(S.biz, d.shopId), e = sh && sh.employees.filter(function (x) { return x.id === d.empId; })[0];
        if (e && d.wage <= BT.Biz.fairWage(e) * 1.5) { BT.Rivals.respond(S, d.id, 'accept'); notes.push('加薪留住 ' + e.name); }
      });
    }
    m.last = notes.join('；') || '今天没什么要处理的';
    BT.Log.add('🧑‍💼 区域经理：' + m.last, 'info');
  };
})();
