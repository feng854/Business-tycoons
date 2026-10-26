/* ==========================================================================
 * 文件：js/ui/app.js
 * 作用：应用主控制器 —— 启动流程、标签页切换、所有按钮动作处理、提示/弹窗
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var U = BT.U, C = BT.CFG;
  var App = BT.App = {};
  var $ = function (id) { return document.getElementById(id); };
  var qty = function (id, def) { var el = $(id); var v = el ? parseFloat(el.value) : def; return isFinite(v) && v > 0 ? v : def; };

  /* ========================================================================
   * 一、启动流程
   * ===================================================================== */
  App.boot = function () {
    $('btn-newgame').onclick = function () { App.newGame(); };
    $('btn-continue').onclick = function () { App.continueGame(); };
    $('btn-continue').style.display = BT.hasAutoSave() ? '' : 'none';
    renderSlotPicker();
    bindNav();
    BT.MapUI.init($('mapCanvas'));
    BT.Bus.on('changed', BT.Render.all);
    BT.Bus.on('log', function () { if (document.querySelector('.tabpage.active')) BT.Render.log(); });
  };

  function renderSlotPicker() {
    var html = '';
    for (var i = 0; i < 3; i++) {
      var info = BT.slotInfo(i);
      html += '<div class="slot-card"><b>存档 ' + (i + 1) + '</b><br>' +
        (info ? ('第' + info.day + '天 · 净资产 ' + U.money(info.net)) : '（空）') +
        (info ? '<br><button class="small" style="margin-top:6px" onclick="BT.App.startFromSlot(' + i + ')">读取</button>' : '') +
        '</div>';
    }
    $('slot-list').innerHTML = html;
  }

  App.newGame = function () {
    BT.newGame();
    BT.Eco.rollWeather(BT.S);
    BT.Eco.ensurePriceDay(BT.S);
    BT.Quests.init(BT.S);
    enterGame();
    BT.Log.add('🎬 欢迎来到新港市！从打工、进货、摆摊开始你的创业之路吧。', 'sys');
    App.switchTab('map');
  };
  App.continueGame = function () { if (BT.load()) { enterGame(); App.switchTab('map'); } else App.newGame(); };
  App.startFromSlot = function (i) { if (BT.loadSlot(i)) { enterGame(); App.switchTab('map'); } };

  function enterGame() {
    $('boot-screen').style.display = 'none';
    $('game').className = 'active';
    BT.Render.all();
  }

  /* ========================================================================
   * 二、导航
   * ===================================================================== */
  function bindNav() {
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.onclick = function () { App.switchTab(btn.getAttribute('data-tab')); };
    });
    document.querySelectorAll('[data-mkt-tab]').forEach(function (btn) {
      btn.onclick = function () { BT.Render.setMarketTab(btn.getAttribute('data-mkt-tab')); BT.Render.market(); };
    });
  }
  App.switchTab = function (tab) {
    document.querySelectorAll('.tabpage').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.nav-list button').forEach(function (b) { b.classList.remove('active'); });
    var page = $('tab-' + tab); if (page) page.classList.add('active');
    var btn = document.querySelector('[data-tab="' + tab + '"]'); if (btn) btn.classList.add('active');
    BT.Render.all();
  };

  /* ========================================================================
   * 三、提示 Toast
   * ===================================================================== */
  App.toast = function (res) {
    if (!res) return;
    var wrap = $('toast-wrap');
    var t = document.createElement('div');
    t.className = 'toast ' + (res.ok === false ? 'bad' : 'good');
    t.textContent = res.msg || (res.ok === false ? '操作失败' : '操作成功');
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  };
  function act(res) { App.toast(res); BT.save(); BT.Render.all(); return res; }

  /* ========================================================================
   * 四、地图与移动
   * ===================================================================== */
  App.travelTo = function (regionId) {
    var S = BT.S; if (!S) return;
    if (S.unlockedRegions.indexOf(regionId) < 0) { App.toast({ ok: false, msg: '该区域尚未解锁' }); return; }
    if (S.region === regionId) return;
    if (S.hour + 1 > C.DAY_END_H + 2) { App.toast({ ok: false, msg: '太晚了，先睡觉吧' }); return; }
    S.region = regionId;
    BT.Eco.advanceHour(S, 1);
    act({ ok: true, msg: '来到了 ' + C.regionMap[regionId].name });
  };
  App.unlockRegion = function (rid) {
    var S = BT.S, r = C.regionMap[rid];
    if (BT.netWorth(S) < r.unlock.value) { App.toast({ ok: false, msg: '净资产还不够' }); return; }
    S.unlockedRegions.push(rid);
    BT.Log.add('🗺️ 解锁新区域：' + r.name, 'good');
    act({ ok: true, msg: '解锁成功' });
  };
  App.sleepNow = function () { BT.Eco.sleep(BT.S); act({ ok: true, msg: '新的一天开始了' }); };
  App.skipHour = function () { BT.Eco.advanceHour(BT.S, 1); act({ ok: true, msg: '时间推进了1小时' }); };

  /* ========================================================================
   * 五、交易
   * ===================================================================== */
  App.buyGoods = function (gid) { act(BT.Trade.buy(BT.S, gid, qty('qty-' + gid, 1))); };
  App.sellGoods = function (gid) { act(BT.Trade.sell(BT.S, gid, qty('qty-' + gid, 1))); };
  App.showPriceCompare = function (gid) {
    openModal('<div id="price-compare-title"></div><div id="price-compare-table"></div>');
    BT.Render.priceCompare(gid);
  };

  /* ========================================================================
   * 六、打工与技能
   * ===================================================================== */
  App.doJob = function (id) { act(BT.Jobs.do(BT.S, id)); };
  App.learnSkill = function (id) { act(BT.Jobs.learn(BT.S, id)); };

  /* ========================================================================
   * 七、摆摊
   * ===================================================================== */
  App.stallOpen = function (gid) { act(BT.Stall.open(BT.S, gid, 1.1)); };
  App.stallRun = function () { act(BT.Stall.run(BT.S)); };
  App.stallUpgrade = function () { act(BT.Stall.upgrade(BT.S)); };
  App.stallClose = function () { act(BT.Stall.close(BT.S)); };
  App.setStallMarkup = function (v) {
    if (!BT.S.stall) return;
    BT.S.stall.markup = parseFloat(v);
    var label = $('stall-markup-val');
    if (label) label.textContent = parseFloat(v).toFixed(2) + ' × 基准价';
  };

  /* ========================================================================
   * 八、第一阶段店铺
   * ===================================================================== */
  App.shopRent = function (rid) { act(BT.Shop.rent(BT.S, rid)); };
  App.shopHire = function () { act(BT.Shop.hire(BT.S)); };
  App.shopFire = function () { act(BT.Shop.fire(BT.S)); };
  App.shopClose = function () { act(BT.Shop.close(BT.S)); };
  App.shopStock = function (gid) { act(BT.Shop.stock(BT.S, gid, 1.3)); };
  App.shopUnstock = function (gid) { act(BT.Shop.unstock(BT.S, gid)); };

  /* ========================================================================
   * 九、第二阶段公司
   * ===================================================================== */
  App.bizOpenShop = function (rid) { act(BT.Biz.openShop(BT.S, rid)); };
  App.bizCloseShop = function (id) { act(BT.Biz.closeShop(BT.S, id)); };
  App.bizHire = function (shopId) {
    var sel = $('role-' + shopId); var role = sel ? sel.value : 'clerk';
    act(BT.Biz.hire(BT.S, shopId, role));
  };
  App.bizTransfer = function (shopId) {
    var shop = BT.Biz.findShop(BT.S.biz, shopId);
    var gid = prompt('输入要调货的商品ID（如 veg / fruit / cloth 等）：'); if (!gid) return;
    var n = prompt('调货数量：', '20'); if (!n) return;
    act(BT.Biz.transferToShop(BT.S, shopId, gid, parseInt(n, 10) || 0));
  };
  App.bizSetShelf = function (shopId, gid) {
    var m = prompt('设置加价倍率（0.8~2.5，如 1.3）：', '1.3'); if (!m) return;
    act(BT.Biz.setShelf(BT.S, shopId, gid, parseFloat(m)));
  };
  App.bizUpgradeWarehouse = function (rid) { act(BT.Biz.upgradeWarehouse(BT.S, rid)); };
  App.bizWholesale = function () {
    var rid = $('wh-region').value, gid = $('wh-goods').value, n = qty('wh-qty', 50);
    act(BT.Biz.wholesaleBuy(BT.S, rid, gid, n));
  };
  App.bizTakeLoan = function () { act(BT.Biz.takeLoan(BT.S, qty('loan-amount', 1000))); };
  App.bizRepay = function (loanId) { act(BT.Biz.repayLoan(BT.S, loanId, qty('repay-' + loanId, 0))); };
  App.empireAccept = function () { act(BT.Empire.acceptOffer(BT.S)); };
  App.empireDecline = function () { act(BT.Empire.declineOffer(BT.S)); };

  /* ========================================================================
   * 十、金融市场
   * ===================================================================== */
  App.selectInstrument = function (id) { BT.Render.setSelected(id); BT.Render.market(); };
  function curInstr() { return BT.Render.getSelected(); }
  App.marketBuyStock = function () { act(BT.Market.buyStock(BT.S, curInstr(), qty('trade-qty', 100))); };
  App.marketSellStock = function () { act(BT.Market.sellStock(BT.S, curInstr(), qty('trade-qty', 100))); };
  App.marketOpenFutures = function (side) { act(BT.Market.openFutures(BT.S, curInstr(), qty('trade-qty', 1), side)); };
  App.marketCloseFutures = function () {
    var pos = BT.S.market.posFut[curInstr()]; if (!pos) return;
    act(BT.Market.closeFutures(BT.S, curInstr(), Math.abs(pos.qty)));
  };
  App.marketOpenForex = function (side) { act(BT.Market.openForex(BT.S, curInstr(), qty('trade-qty', 1), side)); };
  App.marketCloseForex = function () {
    var pos = BT.S.market.posFx[curInstr()]; if (!pos) return;
    act(BT.Market.closeForex(BT.S, curInstr(), Math.abs(pos.qty)));
  };

  /* ========================================================================
   * 十一、存档
   * ===================================================================== */
  App.saveToSlot = function (i) { act({ ok: BT.saveToSlot(i), msg: '已保存到存档 ' + (i + 1) }); };
  App.loadFromSlot = function (i) { if (BT.loadSlot(i)) act({ ok: true, msg: '已读取存档 ' + (i + 1) }); };

  /* ========================================================================
   * 十二、简易弹窗
   * ===================================================================== */
  function openModal(html) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal-box">' + html + '<div class="modal-actions"><button onclick="this.closest(\'.modal-mask\').remove()">关闭</button></div></div>';
    mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
    document.body.appendChild(mask);
  }

  document.addEventListener('DOMContentLoaded', App.boot);
})();
