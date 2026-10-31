/* ==========================================================================
 * 文件：js/core/debug.js
 * 作用：测试后门 —— 直接修改股票持仓数量、价格、现金、背包，并提供一致性检查，方便排查 BUG
 * 打开方式（任选其一，会弹出一个浮层面板）：
 *   1) 在「金融」页连续点击标题「金融市场」5 次（再点 5 次关闭）
 *   2) 浏览器控制台执行  BT.Debug.open()
 * 控制台也可直接调用：BT.Debug.setStock('xjhg', 12345)  /  BT.Debug.audit()
 * 注意：使用后门会给存档打上「作弊」标记，每日挑战的成绩将不计入最佳纪录。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U;
  var D = BT.Debug = {};
  var KEY = 'bt_debug';

  D.enabled = function () {
    try {
      if (/[?&]debug=1/.test(location.search)) localStorage.setItem(KEY, '1');
      return localStorage.getItem(KEY) === '1';
    } catch (e) { return false; }
  };
  var opened = false;
  D.isOpen = function () { return opened; };
  D.open = function () { D.enable(); opened = true; BT.Bus.emit('changed'); };
  D.close = function () { opened = false; BT.Bus.emit('changed'); };
  D.toggle = function () { if (opened) D.close(); else D.open(); };
  D.enable = function () { try { localStorage.setItem(KEY, '1'); } catch (e) {} BT.Bus.emit('changed'); return '调试后门已开启'; };
  D.disable = function () { try { localStorage.removeItem(KEY); } catch (e) {} BT.Bus.emit('changed'); return '调试后门已关闭'; };

  function mark(S, what) {
    if (!S.cheated) { S.cheated = true; BT.Log.add('🛠️ 使用了调试后门（存档已标记为作弊，不计入每日挑战纪录）。', 'sys'); }
    BT.Log.add('🛠️ 调试：' + what, 'sys');
    BT.Bus.emit('changed');
  }

  /** 直接设定某只股票的持仓数量（qty=0 表示清空）；cost 不填则用当前价 */
  D.setStock = function (id, qty, cost) {
    var S = BT.S, M = BT.Market; M.ensure(S);
    var def = M.stockMap[id]; if (!def) return { ok: false, msg: '没有这只股票：' + id };
    qty = Math.max(0, Math.floor(Number(qty)));
    if (!isFinite(qty)) return { ok: false, msg: '数量不是有效数字' };
    if (qty === 0) delete S.market.posStock[id];
    else S.market.posStock[id] = { qty: qty, cost: isFinite(cost) && cost > 0 ? Number(cost) : S.market.stocks[id].price };
    mark(S, def.name + ' 持仓设为 ' + qty + ' 股');
    return { ok: true, msg: def.name + ' 持仓已设为 ' + qty + ' 股' };
  };
  D.addStock = function (id, delta) {
    var S = BT.S, pos = S.market && S.market.posStock[id];
    return D.setStock(id, (pos ? pos.qty : 0) + Math.floor(Number(delta)));
  };
  D.setPrice = function (id, price) {
    var S = BT.S, M = BT.Market; M.ensure(S);
    price = Number(price); if (!M.stockMap[id] || !(price > 0)) return { ok: false, msg: '参数无效' };
    S.market.stocks[id].price = U.round2(price); M.prepare(S); S.market.fair[id] = S.market.stocks[id].price; M.syncPrice(S, 'stocks', id); M.regenBooks(S); mark(S, M.stockMap[id].name + ' 价格设为 ' + price);
    return { ok: true, msg: '价格已设为 ' + price };
  };
  D.setCash = function (v) { var S = BT.S; v = Number(v); if (!isFinite(v)) return { ok: false, msg: '无效数字' }; S.cash = Math.round(v * 100) / 100; mark(S, '现金设为 ' + v); return { ok: true, msg: '现金已设为 ' + U.money(v) }; };
  D.setBag = function (goodsId, qty) {
    var S = BT.S, g = C.goodsMap[goodsId]; if (!g) return { ok: false, msg: '没有这个商品：' + goodsId };
    qty = Math.max(0, Math.floor(Number(qty))); if (!isFinite(qty)) return { ok: false, msg: '无效数字' };
    S.bag[goodsId] = qty > 0 ? [{ qty: qty, cost: BT.Eco.buyPrice(S, goodsId, S.region), boughtDay: S.day }] : [];
    mark(S, g.name + ' 背包数量设为 ' + qty); return { ok: true, msg: g.name + ' 数量已设为 ' + qty };
  };

  /** 一致性检查：背包格数、持仓、现金、仓库…… 返回问题列表（空数组=一切正常） */
  D.audit = function () {
    var S = BT.S, problems = [], i;
    if (!isFinite(S.cash)) problems.push('现金不是有效数字：' + S.cash);
    /* 背包格数 = Σ 数量×每件占格 */
    var expect = 0;
    U.keys(S.bag).forEach(function (gid) {
      var g = C.goodsMap[gid]; if (!g) { problems.push('背包里有未知商品 ' + gid); return; }
      (S.bag[gid] || []).forEach(function (lot) {
        if (!(lot.qty > 0) || Math.floor(lot.qty) !== lot.qty) problems.push(g.name + ' 批次数量异常：' + lot.qty);
        expect += lot.qty * g.unit;
      });
    });
    var used = BT.Trade.bagUsed(S);
    if (used !== expect) problems.push('背包格数 ' + used + ' ≠ 按数量×占格计算的 ' + expect);
    if (used > S.bagCap) problems.push('背包已用 ' + used + ' 超过容量 ' + S.bagCap);
    var upCap = 0; C.BAG_UPGRADES.forEach(function (u) { if (S.bagUpgrades[u.id]) upCap += u.cap; });
    if (S.bagCap !== C.START_BAG + upCap) problems.push('背包容量 ' + S.bagCap + ' ≠ 初始 ' + C.START_BAG + ' + 升级 ' + upCap);
    if (S.market) {
      U.keys(S.market.posStock).forEach(function (id) {
        var p = S.market.posStock[id];
        if (!(p.qty > 0) || Math.floor(p.qty) !== p.qty) problems.push('股票 ' + id + ' 持仓数量异常：' + p.qty);
        if (!isFinite(p.cost) || p.cost <= 0) problems.push('股票 ' + id + ' 成本异常：' + p.cost);
      });
      U.keys(S.market.stocks).forEach(function (id) { var pr = S.market.stocks[id].price; if (!(pr > 0) || !isFinite(pr)) problems.push('股票 ' + id + ' 价格异常：' + pr); });
      ['posFut', 'posFx'].forEach(function (k) {
        U.keys(S.market[k]).forEach(function (id) {
          var p = S.market[k][id];
          if (!p.qty || Math.floor(p.qty) !== p.qty) problems.push(k + ' ' + id + ' 手数异常：' + p.qty);
          if (!isFinite(p.margin) || !isFinite(p.cost) || !isFinite(p.init)) problems.push(k + ' ' + id + ' 保证金/成本不是有效数字');
          if (p.margin <= 0) problems.push(k + ' ' + id + ' 保证金非正：' + p.margin);
        });
      });
      (S.market.orders || []).forEach(function (o) { if (!(o.left > 0)) problems.push('挂单剩余数量异常'); });
      var pf = BT.Market.portfolio(S); pf.stocks.forEach(function (p) { if (!isFinite(p.pnl)) problems.push(p.name + ' 盈亏不是有效数字'); });
    }
    if (S.biz) U.keys(S.biz.warehouses).forEach(function (rid) {
      var wh = BT.Biz.warehouse(S, rid), e = 0;
      U.keys(wh.goods).forEach(function (gid) { if (wh.goods[gid] < 0) problems.push('仓库 ' + rid + ' ' + gid + ' 为负'); e += wh.goods[gid] * (C.goodsMap[gid] ? C.goodsMap[gid].unit : 1); });
      if (wh.used !== e) problems.push('仓库 ' + rid + ' 占用 ' + wh.used + ' ≠ ' + e);
    });
    if (!(S.hour >= C.DAY_START_H && S.hour < C.DAY_END_H)) problems.push('当前时间异常：' + S.hour + ' 点');
    if (S.biz) { var ld = 0; S.biz.loans.forEach(function (l) { ld += l.remaining; }); if (S.debt < ld - 1) problems.push('负债 ' + S.debt + ' 小于贷款余额合计 ' + ld); }
    if (S.cash < -1e7) problems.push('现金异常：' + S.cash);
    var nw = BT.netWorth(S); if (!isFinite(nw)) problems.push('净资产不是有效数字');
    return problems;
  };
})();
