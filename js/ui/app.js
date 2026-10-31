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
  /** 启动步骤逐个隔离：某一步出错（如某个存档损坏）不影响「新游戏」等按钮，错误显示在开屏界面 */
  function safe(name, fn) { try { return fn(); } catch (e) { console.error(e); if (window.__btShowErr) window.__btShowErr('[' + name + '] ' + (e && e.message) + ' ' + String(e && e.stack || '').split('\n')[1]); } }
  App.safe = safe;
  App.copyBootError = function () {
    var t = (window.__btErrors || []).join('\n') + '\nUA: ' + navigator.userAgent;
    try { navigator.clipboard.writeText(t); App.toast({ ok: true, msg: '已复制' }); } catch (e) { window.prompt('复制下面的文字：', t); }
  };
  App.boot = function () {
    $('btn-newgame').onclick = function () { App.newGame($('boot-diff').value); };
    $('btn-daily').onclick = function () { App.newDaily(); };
    var di = $('daily-info'), dt = dailyDate(), best = 0;
    try { best = parseFloat(localStorage.getItem('bt_daily_' + dt)) || 0; } catch (e) {}
    if (di) di.textContent = '今日（' + dt + '）固定种子，限时 ' + BT.CFG.DAILY_CHALLENGE_DAYS + ' 天比净资产' + (best ? ' · 今日最佳 ' + U.money(best) : '');
    $('btn-continue').onclick = function () { App.continueGame(); };
    $('btn-continue').style.display = BT.hasAutoSave() ? '' : 'none';
    if ($('boot-tut')) $('boot-tut').checked = !(BT.FX && BT.FX.tutSeen());
    safe('读取存档列表', renderSlotPicker);
    safe('绑定导航', bindNav);
    safe('初始化地图', function () { BT.MapUI.init($('mapCanvas')); });
    BT.Bus.on('changed', function () { safe('刷新界面', BT.Render.all); });
    BT.Bus.on('log', function () { if (document.querySelector('.tabpage.active')) BT.Render.log(); });
  };

  function renderSlotPicker() {
    var html = '';
    for (var i = 0; i < BT.SLOT_COUNT; i++) {
      var info = BT.slotInfo(i);
      if (!info) { html += '<div class="slot-card empty"><b>存档 ' + (i + 1) + '</b><br><span class="hint">（空）</span></div>'; continue; }
      html += '<div class="slot-card" onclick="BT.App.startFromSlot(' + i + ')" title="点击读取"><b>' + (info.label ? escapeHtml(info.label) : '存档 ' + (i + 1)) + '</b><br>' +
        '第' + info.day + '天 · P' + info.phase + ' · ' + U.money(info.net) + '<br><span class="hint">' + timeAgo(info.time) + '</span></div>';
    }
    $('slot-list').innerHTML = html;
    var bk = BT.backupInfo && BT.backupInfo();
    if ($('boot-backup')) $('boot-backup').innerHTML = bk ? '<button class="small" style="margin-top:10px" onclick="BT.App.loadBackup()">⏪ 读取前一天的自动备份（第' + bk.day + '天 · ' + U.money(bk.net) + '）</button>' : '';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function timeAgo(t) {
    if (!t) return ''; var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return '刚刚'; if (m < 60) return m + ' 分钟前'; if (m < 1440) return Math.round(m / 60) + ' 小时前';
    var d = new Date(t); return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  App.timeAgo = timeAgo;
  App.loadBackup = function () {
    if (BT.S && !window.confirm('读取前一天的备份会覆盖当前进度，确定吗？')) return;
    if (BT.loadBackup()) { enterGame(); App.switchTab('map'); App.toast({ ok: true, msg: '已回到第 ' + BT.S.day + ' 天' }); }
  };

  /** 结局界面按钮：破产后重新开始 / 通关后继续玩 */
  App.restart = function () { var m = document.getElementById('ending-mask'); if (m) m.remove(); App.newGame(BT.S && BT.S.difficulty); };
  App.keepPlaying = function () { var m = document.getElementById('ending-mask'); if (m) m.remove(); if (BT.S && BT.S.endingQueue.length) BT.S.endingQueue.shift(); BT.Render.all(); };
  function dailyDate() { var d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  App.newDaily = function () {
    var date = dailyDate();
    App.newGame('normal', date); BT.S.challenge = { seed: date, date: date };
    BT.Log.add('📅 每日挑战开始：' + BT.CFG.DAILY_CHALLENGE_DAYS + ' 天内尽可能提高净资产！', 'sys'); BT.Render.all();
  };
  App.hideGuide = function () { var el = $('guide-bar'); BT.S.guideHidden = el.getAttribute('data-key'); BT.Render.guide(); };
  App.autoRestock = function () { act(BT.Biz.autoRestock(BT.S)); };
  /* 快进：连续睡觉 n 天；遇到待处理事件/并购/结局/破产立即停下 */
  App.fastForward = function (n) {
    var S = BT.S, done = 0;
    for (var i = 0; i < n; i++) {
      if (S.gameOver || (BT.Events && BT.Events.pending) || S.empireOffer || S.endingQueue.length || (BT.Rivals && BT.Rivals.hasUrgent(S))) break;
      BT.Eco.sleep(S); done++;
    }
    act({ ok: true, msg: '快进了 ' + done + ' 天' + (done < n ? '（有事情需要处理，已停下）' : '') });
    if (BT.Audio) BT.Audio.sfx('sleep');
  };
  /* 存档导入导出 */
  App.exportSave = function () { $('save-text').value = BT.exportSave(); App.toast({ ok: true, msg: '已生成存档文本，请复制保存' }); };
  App.copySave = function () {
    var t = $('save-text'); if (!t.value) t.value = BT.exportSave(); t.select();
    try { document.execCommand('copy'); App.toast({ ok: true, msg: '已复制到剪贴板' }); } catch (e) { App.toast({ ok: false, msg: '请手动复制文本框内容' }); }
  };
  App.importSave = function () {
    if (!window.confirm('导入会覆盖当前进度，确定吗？')) return;
    var r = BT.importSave($('save-text').value); App.toast(r); if (r.ok) { BT.Quests.init(BT.S); BT.Render.all(); }
  };
  App.newGame = function (difficulty, seed) {
    if (safe('新游戏', function () { App._newGame(difficulty, seed); return true; }) !== true && BT.S) enterGame();
  };
  App._newGame = function (difficulty, seed) {
    BT.newGame(seed, difficulty);
    BT.Eco.rollWeather(BT.S);
    BT.Eco.ensurePriceDay(BT.S);
    BT.Quests.init(BT.S);
    enterGame();
    BT.Log.add('🎬 欢迎来到新港市！从打工、进货、摆摊开始你的创业之路吧。', 'sys');
    App.switchTab('map');
    var tut = $('boot-tut'); if (BT.FX && tut && tut.checked && !BT.S.challenge) BT.FX.tutStart();
  };
  App.continueGame = function () { safe('继续游戏', function () { App._continue(); }); };
  App._continue = function () { if (BT.load()) { enterGame(); App.switchTab('map'); if (BT.FX) BT.FX.checkOffline(); } else App.newGame($('boot-diff').value); };
  App.startFromSlot = function (i) { if (BT.loadSlot(i)) { enterGame(); App.switchTab('map'); if (BT.FX) BT.FX.checkOffline(); } };

  function enterGame() {
    $('boot-screen').style.display = 'none';
    $('game').className = 'active';
    safe('渲染界面', BT.Render.all);
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
    document.body.classList.toggle('on-market', tab === 'market'); /* 金融页：右侧日志压缩到底部 */
    var page = $('tab-' + tab); if (page) page.classList.add('active');
    App.placeMkSide();
    var btn = document.querySelector('[data-tab="' + tab + '"]'); if (btn) btn.classList.add('active');
    safe('切换页面', BT.Render.all);
  };

  /** 手机端：把「新闻 / 持仓 / 下单」挪到 K 线图下面，不用滚到页面最底部才能下单 */
  App.placeMkSide = function () {
    var side = $('mk-side'), chart = document.querySelector('.mk-mid > .card'), rp = $('rightpanel');
    if (!side || !chart || !rp) return;
    var mobile = window.innerWidth <= 760;
    if (mobile && side.parentNode !== chart.parentNode) { chart.parentNode.insertBefore(side, chart.nextSibling); side.classList.add('inline'); }
    else if (!mobile && side.parentNode !== rp) { rp.insertBefore(side, rp.firstChild); side.classList.remove('inline'); }
  };
  window.addEventListener('resize', function () { App.placeMkSide(); });

  /* ========================================================================
   * 三、提示 Toast
   * ===================================================================== */
  App.toast = function (res) {
    if (!res) return;
    var wrap = $('toast-wrap');
    var t = document.createElement('div');
    t.className = 'toast ' + (res.ok === false ? 'bad' : 'good');
    if (res.ok === false && BT.Audio) BT.Audio.sfx('error');
    t.textContent = res.msg || (res.ok === false ? '操作失败' : '操作成功');
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  };
  /* 大额支出二次确认：花费 ≥ 现金的一半时弹出确认框，返回 true 表示继续 */
  function confirmIf(cost, label) {
    var S = BT.S;
    if (!S || cost <= 0 || S.cash <= 0 || cost < S.cash * 0.5) return true;
    return window.confirm(label + ' 将花费 ' + U.money(cost) + '（约占现金的 ' + Math.round(cost / S.cash * 100) + '%），确定吗？');
  }
  function act(res) { App.toast(res); BT.save(); BT.Render._force = true; try { BT.Render.all(); } finally { BT.Render._force = false; } return res; }

  /* ========================================================================
   * 四、地图与移动
   * ===================================================================== */
  App.travelTo = function (regionId) {
    var S = BT.S; if (!S) return;
    if (S.unlockedRegions.indexOf(regionId) < 0) { App.toast({ ok: false, msg: '该区域尚未解锁' }); return; }
    if (S.region === regionId) return;
    var hrs = C.travelHours(S.region, regionId);
    if (S.hour + hrs > C.DAY_END_H + 2) { App.toast({ ok: false, msg: '太晚了，路上要 ' + hrs + ' 小时，先睡觉吧' }); return; }
    S.region = regionId;
    if (BT.Audio) BT.Audio.sfx('walk');
    BT.Eco.advanceHour(S, hrs);
    act({ ok: true, msg: '来到了 ' + C.regionMap[regionId].name + '（路上 ' + hrs + ' 小时）' });
  };
  App.unlockRegion = function (rid) {
    var S = BT.S, r = C.regionMap[rid];
    if (BT.netWorth(S) < r.unlock.value) { App.toast({ ok: false, msg: '净资产还不够' }); return; }
    S.unlockedRegions.push(rid);
    BT.Log.add('🗺️ 解锁新区域：' + r.name, 'good');
    act({ ok: true, msg: '解锁成功' });
    if (BT.FX) BT.FX.banner('🗺️ 解锁新区域：' + r.icon + r.name, 'level');
  };
  App.sleepNow = function () { BT.Eco.sleep(BT.S); act({ ok: true, msg: '新的一天开始了' }); if (BT.Audio) BT.Audio.sfx('sleep'); };
  App.skipHour = function () { BT.Eco.advanceHour(BT.S, 1); act({ ok: true, msg: '时间推进了1小时' }); };

  /* ========================================================================
   * 五、交易
   * ===================================================================== */
  App.buyGoods = function (gid) {
    var n = qty('qty-' + gid, 1);
    if (!confirmIf(BT.Eco.buyPrice(BT.S, gid, BT.S.region) * n, '买入')) return;
    act(BT.Trade.buy(BT.S, gid, n));
  };
  App.fillMax = function (gid) { var el = $('qty-' + gid); if (el) el.value = Math.max(1, BT.Trade.maxBuy(BT.S, gid)); };
  App.sellAll = function (gid) { act(BT.Trade.sell(BT.S, gid, BT.Trade.qtyOf(BT.S, gid))); };
  App.buyBagUpgrade = function (id) { var r = act(BT.Trade.upgradeBag(BT.S, id)); if (r && r.ok && BT.FX) BT.FX.banner('🎒 背包扩容 → ' + BT.S.bagCap + ' 格', 'level'); };
  App.sellGoods = function (gid) { act(BT.Trade.sell(BT.S, gid, qty('qty-' + gid, 1))); };
  App.showPriceCompare = function (gid) {
    openModal('<div id="price-compare-title"></div><div id="price-compare-table"></div>');
    BT.Render.priceCompare(gid);
  };

  /* ========================================================================
   * 六、打工与技能
   * ===================================================================== */
  App.doJob = function (id) { act(BT.Jobs.do(BT.S, id)); };
  App.learnSkill = function (id) {
    var r = act(BT.Jobs.learn(BT.S, id));
    if (r && r.ok && BT.FX) BT.FX.banner('📚 ' + BT.CFG.skillMap[id].name + ' Lv.' + BT.Jobs.skillLevel(BT.S, id), 'level');
  };

  /* ========================================================================
   * 七、摆摊
   * ===================================================================== */
  App.stallOpen = function (gid) { act(BT.Stall.open(BT.S, gid, 1.1)); };
  App.stallRun = function () { act(BT.Stall.run(BT.S)); };
  App.stallUpgrade = function () { var r = act(BT.Stall.upgrade(BT.S)); if (r && r.ok && BT.FX) BT.FX.banner('⬆️ 摊位升级到 Lv.' + BT.S.stall.level, 'level'); };
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
  App.shopRent = function (rid) {
    if (!confirmIf(C.regionMap[rid].rent * 60, '租下店铺（押金）')) return;
    act(BT.Shop.rent(BT.S, rid));
  };
  App.shopHire = function () { act(BT.Shop.hire(BT.S)); };
  App.shopFire = function () { act(BT.Shop.fire(BT.S)); };
  App.shopClose = function () { act(BT.Shop.close(BT.S)); };
  App.shopStock = function (gid) { act(BT.Shop.stock(BT.S, gid, 1.3)); };
  App.shopUnstock = function (gid) { act(BT.Shop.unstock(BT.S, gid)); };

  /* ========================================================================
   * 九、第二阶段公司
   * ===================================================================== */
  App.bizOpenShop = function (rid, loc) {
    if (!confirmIf(BT.Biz.shopCost(rid, loc), '开设新店')) return;
    act(BT.Biz.openShop(BT.S, rid, loc));
  };
  App.bizTab = function (t) { BT.Render.setBizTab(t); BT.Render.all(); };
  App.bizTrain = function (shopId, empId, course) { act(BT.Biz.train(BT.S, shopId, empId, course)); };
  App.bizRaise = function (shopId, empId) { act(BT.Biz.raise(BT.S, shopId, empId)); };
  App.bizFire = function (shopId, empId) { if (window.confirm('确定解雇这名员工吗？')) act(BT.Biz.fire(BT.S, shopId, empId)); };
  App.bizPromote = function (shopId) { act(BT.Biz.promote(BT.S, shopId)); };
  App.bizRelocate = function (shopId) {
    var sel = $('reloc-' + shopId); if (!sel) return;
    if (!window.confirm('搬迁会花一笔装修费，口碑打 8 折，确定吗？')) return;
    act(BT.Biz.relocate(BT.S, shopId, sel.value));
  };
  App.bizHireCand = function (candId) { var sel = $('cand-shop-' + candId); if (sel) act(BT.Biz.hireCandidate(BT.S, sel.value, candId)); };
  App.signContract = function (gid) { act(BT.Supply.sign(BT.S, gid)); };
  App.dealRespond = function (dealId, choice) { var r = act(BT.Rivals.respond(BT.S, dealId, choice)); if (r && r.ok && BT.Audio) BT.Audio.sfx(choice === 'accept' ? 'coin' : 'click'); };
  App.acquireRival = function (id) {
    var rv = BT.Rivals.get(BT.S, id); if (!rv) return;
    if (!window.confirm('以 ' + U.money(BT.Rivals.acquireCost(BT.S, rv)) + ' 整体收购 ' + rv.name + '？它的门店会并入你的公司。')) return;
    act(BT.Rivals.acquire(BT.S, id));
  };
  App.bizCloseShop = function (id) { act(BT.Biz.closeShop(BT.S, id)); };
  App.bizHire = function (shopId) {
    var sel = $('role-' + shopId); var role = sel ? sel.value : 'clerk';
    act(BT.Biz.hire(BT.S, shopId, role));
  };
  App.bizTransfer = function (shopId) {
    var sel = $('xfer-goods-' + shopId); if (!sel) return;
    act(BT.Biz.transferToShop(BT.S, shopId, sel.value, Math.floor(qty('xfer-qty-' + shopId, 1))));
  };
  App.bizSetShelf = function (shopId, gid) {
    act(BT.Biz.setShelf(BT.S, shopId, gid, qty('markup-' + shopId + '-' + gid, 1.3)));
  };
  App.bizUpgradeWarehouse = function (rid) { act(BT.Biz.upgradeWarehouse(BT.S, rid)); };
  App.bizWholesale = function () {
    var rid = $('wh-region').value, gid = $('wh-goods').value, n = qty('wh-qty', 50), em = $('wh-emergency') && $('wh-emergency').checked;
    if (!confirmIf(BT.Eco.buyPrice(BT.S, gid, rid) * n * 0.9, '批发进货')) return;
    act(BT.Biz.wholesaleBuy(BT.S, rid, gid, n, em));
  };
  App.bizTakeLoan = function () { act(BT.Biz.takeLoan(BT.S, qty('loan-amount', 1000))); };
  App.bizRepay = function (loanId) { act(BT.Biz.repayLoan(BT.S, loanId, qty('repay-' + loanId, 0))); };
  /* 机会事件：大订单 */
  App.acceptBigOrder = function () {
    var g = $('bigorder-goods'); if (!g) return;
    var n = Math.floor(qty('bigorder-qty', 1));
    if (!confirmIf(BT.Eco.buyPrice(BT.S, g.value, BT.S.region) * n, '垫资接单')) return;
    act(BT.Events.acceptBigOrder(BT.S, g.value, n));
  };
  App.declineBigOrder = function () { act(BT.Events.declinePending(BT.S)); };
  App.estateBuy = function (rid) { act(BT.Empire.buy(BT.S, rid)); };
  App.estateSell = function (rid) { if (window.confirm('确定出售这处物业吗？将扣除 3% 税费。')) act(BT.Empire.sell(BT.S, rid)); };
  App.donate = function () { act(BT.Empire.donate(BT.S, qty('donate-amt', 1000))); };
  App.empireAccept = function () { act(BT.Empire.acceptOffer(BT.S)); };
  App.empireDecline = function () { act(BT.Empire.declineOffer(BT.S)); };

  /* ========================================================================
   * 十、金融市场
   * ===================================================================== */
  /* ---- 调试后门（见 js/core/debug.js） ---- */
  function dbgv(id) { return document.getElementById(id).value; }
  function dbgDone(r) { BT.Render.all(); var o = document.getElementById('dbg-out'); if (o) o.textContent = r.msg; }
  App.dbgSetStock = function () { dbgDone(BT.Debug.setStock(dbgv('dbg-stock'), dbgv('dbg-qty'))); };
  App.dbgAddStock = function (d) { dbgDone(BT.Debug.addStock(dbgv('dbg-stock'), d)); };
  App.dbgSetBag = function () { dbgDone(BT.Debug.setBag(dbgv('dbg-goods'), dbgv('dbg-qty'))); };
  App.dbgSetCash = function () { dbgDone(BT.Debug.setCash(dbgv('dbg-cash'))); };
  App.dbgAudit = function () {
    var p = BT.Debug.audit(), o = document.getElementById('dbg-out');
    if (o) o.innerHTML = p.length ? '<b class="down">发现 ' + p.length + ' 个问题：</b><br>' + p.join('<br>') : '<b class="up">✅ 一致性检查通过</b>';
  };
  var titleClicks = 0;
  App.titleTap = function () { if (++titleClicks >= 5) { titleClicks = 0; BT.Debug.toggle(); } };
  App.selectInstrument = function (id) { BT.Render.setSelected(id); BT.Render.market(); };
  function curInstr() { return BT.Render.getSelected(); }
  function orderPrice() { var el = $('trade-price'), v = el ? parseFloat(el.value) : 0; return v > 0 ? v : 0; }
  App.pickPrice = function (p) { var el = $('trade-price'); if (el) el.value = p > 0 ? p.toFixed(2) : ''; };
  App.marketBuyStock = function () {
    if (BT.Audio) BT.Audio.sfx('trade');
    var n = qty('trade-qty', 100), lim = orderPrice(), p = lim || BT.S.market.stocks[curInstr()].price;
    if (!confirmIf(p * n, '买入股票')) return;
    act(BT.Market.placeStockOrder(BT.S, curInstr(), 'buy', n, lim));
  };
  App.marketSellStock = function () { act(BT.Market.placeStockOrder(BT.S, curInstr(), 'sell', qty('trade-qty', 100), orderPrice())); };
  App.cancelOrder = function (oid) { act(BT.Market.cancelOrder(BT.S, oid)); };
  App.marketOpenFutures = function (side) {
    var f = BT.Market.futMap[curInstr()], n = qty('trade-qty', 1), nx = $('fut-ct') && $('fut-ct').value === 'next';
    if (!confirmIf(BT.S.market.futures[f.id].price * f.mult * f.marginRate * n, '开仓（保证金）')) return;
    act(BT.Market.openFutures(BT.S, curInstr(), n, side, nx));
  };
  App.marketRollFutures = function () { act(BT.Market.rollFutures(BT.S, curInstr())); };
  App.marketCloseFutures = function (all) {
    var pos = BT.S.market.posFut[curInstr()]; if (!pos) return;
    act(BT.Market.closeFutures(BT.S, curInstr(), all === false ? qty('trade-qty', 1) : Math.abs(pos.qty)));
  };
  App.marketOpenForex = function (side) {
    var f = BT.Market.fxMap ? BT.Market.fxMap[curInstr()] : null, n = qty('trade-qty', 1);
    if (f && !confirmIf(BT.S.market.forex[f.id].price * f.lot * f.marginRate * n, '开仓（保证金）')) return;
    act(BT.Market.openForex(BT.S, curInstr(), n, side));
  };
  App.marketCloseForex = function (all) {
    var pos = BT.S.market.posFx[curInstr()]; if (!pos) return;
    act(BT.Market.closeForex(BT.S, curInstr(), all === false ? qty('trade-qty', 1) : Math.abs(pos.qty)));
  };

  /* ========================================================================
   * 十一、存档
   * ===================================================================== */
  App.saveToSlot = function (i) {
    var info = BT.slotInfo(i);
    if (info && !window.confirm('存档 ' + (i + 1) + ' 已有进度（第' + info.day + '天），确定覆盖吗？')) return;
    var el = $('slot-label-' + i), label = el ? el.value.trim() : '';
    var ok = BT.saveToSlot(i, label || (BT.CFG.DIFFICULTY[BT.S.difficulty] || {}).name + '·第' + BT.S.day + '天');
    act({ ok: ok, msg: ok ? '已保存到存档 ' + (i + 1) : '保存失败：浏览器存储空间不足，可以删掉几个旧存档再试' });
  };
  App.loadFromSlot = function (i) {
    if (!window.confirm('读取存档 ' + (i + 1) + ' 会丢掉当前未保存的进度，确定吗？')) return;
    if (BT.loadSlot(i)) { act({ ok: true, msg: '已读取存档 ' + (i + 1) }); if (BT.FX) BT.FX.checkOffline(); }
  };
  App.deleteSlot = function (i) { if (window.confirm('删除存档 ' + (i + 1) + '？删除后无法恢复。')) act({ ok: BT.deleteSlot(i), msg: '已删除存档 ' + (i + 1) }); };

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
