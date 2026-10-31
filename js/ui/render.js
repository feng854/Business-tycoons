/* ==========================================================================
 * 文件：js/ui/render.js
 * 作用：把游戏状态 S 渲染到页面各个标签页（纯函数式渲染，每次整块刷新对应区域）
 * 说明：按钮用行内 onclick="BT.App.xxx(...)" 调用 app.js 里的动作处理函数。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U;
  var R = BT.Render = {};
  var $ = function (id) { return document.getElementById(id); };

  /* ========================================================================
   * 一、顶部状态栏 + 侧边栏
   * ===================================================================== */
  R.topbar = function () {
    var S = BT.S; if (!S) return;
    var d = U.dateOf(S.day);
    var w = BT.Eco.weatherInfo(S);
    $('tb-date').textContent = '第' + S.day + '天 · ' + d.short + ' ' + d.wd;
    $('tb-time').textContent = U.hhmm(S.hour);
    $('tb-weather').textContent = w.icon + w.name;
    var nw = BT.netWorth(S);
    if (BT.FX) { BT.FX.tween($('tb-cash'), R._lastCash, S.cash, U.money); BT.FX.tween($('tb-net'), R._lastNet, nw, U.money); }
    else { $('tb-cash').textContent = U.money(S.cash); $('tb-net').textContent = U.money(nw); }
    R._lastCash = S.cash; R._lastNet = nw;
    $('tb-cash').parentNode.classList.toggle('neg', S.cash < 0);
    var phaseName = { 1: '白手起家', 2: '商业扩张', 3: '资本帝国' }[S.phase] || '白手起家';
    $('tb-phase').textContent = 'P' + S.phase + ' · ' + phaseName;
  };

  R.sidebar = function () {
    var S = BT.S; if (!S) return;
    setBar('bar-stamina', S.stamina, S.staminaMax);
    setBar('bar-energy', S.energy, S.energyMax);
    setBar('bar-health', S.health, 100);
    $('nav-biz-lock').style.display = (S.milestones.m2 || S.shop || S.biz) ? 'none' : '';
    $('nav-biz2-lock').style.display = S.biz ? 'none' : '';
    var dot = $('nav-event-dot'); if (dot) dot.style.display = (BT.Events && BT.Events.pending) ? '' : 'none';
    var bd = $('nav-biz-dot'), nd = S.biz && BT.Rivals ? BT.Rivals.deals(S).length + (S.empireOffer ? 1 : 0) : 0;
    if (bd) { bd.style.display = nd ? '' : 'none'; bd.textContent = nd; }
    $('side-region').textContent = C.regionMap[S.region].icon + ' ' + C.regionMap[S.region].name;
  };
  function setBar(prefix, v, max) {
    var pct = U.clamp((v / max) * 100, 0, 100);
    var fill = document.querySelector('#' + prefix + ' .bar-fill');
    var label = document.querySelector('#' + prefix + ' .val');
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = Math.round(v) + '/' + Math.round(max);
  }

  /* ========================================================================
   * 背包面板：右侧栏常驻 + 顶部栏 + 交易页（显示每种商品数量、均价、估值与易腐提示）
   * ===================================================================== */
  R.bag = function () {
    var S = BT.S; if (!S) return;
    var used = BT.Trade.bagUsed(S), cap = S.bagCap, pct = U.clamp(used / cap * 100, 0, 100);
    var rows = C.GOODS.map(function (g) { return { g: g, qty: BT.Trade.qtyOf(S, g.id), cost: BT.Trade.avgCost(S, g.id) }; })
      .filter(function (r) { return r.qty > 0; });
    var totalQty = rows.reduce(function (a, r) { return a + r.qty; }, 0);
    var totalCost = rows.reduce(function (a, r) { return a + r.qty * r.cost; }, 0);
    var warn = pct >= 90 ? ' style="background:linear-gradient(90deg,#e5534b,#f08a5d)"' : '';
    if ($('tb-bag')) $('tb-bag').textContent = used + '/' + cap;
    if ($('bag-count')) $('bag-count').textContent = used + ' / ' + cap + ' 格';
    var fill = $('bag-fill'); if (fill) { fill.style.width = pct + '%'; fill.style.background = pct >= 90 ? 'linear-gradient(90deg,#e5534b,#f08a5d)' : ''; }
    if ($('bag-panel')) $('bag-panel').innerHTML = rows.length
      ? rows.map(function (r) {
          return '<div class="bag-row"><span>' + r.g.icon + '</span><span class="bn">' + r.g.name + (r.g.spoil ? ' <span class="tag down">易腐</span>' : '') + '</span>' +
            '<span class="bq">×' + r.qty + '</span><span class="bc">占' + r.qty * r.g.unit + '格</span></div>';
        }).join('') + '<div class="hint" style="margin-top:6px">共 ' + totalQty + ' 件 · 占 ' + used + ' 格 / 剩 ' + (cap - used) + ' 格 · 成本 ' + U.money(totalCost) + '</div>'
      : '<div class="bag-empty">背包是空的，去「交易」页进货吧。</div>';
    /* 交易页的背包概览 */
    if ($('trade-bag')) $('trade-bag').textContent = used + ' / ' + cap + ' 格';
    var tf = $('trade-bag-fill'); if (tf) { tf.style.width = pct + '%'; tf.style.background = pct >= 90 ? 'linear-gradient(90deg,#e5534b,#f08a5d)' : ''; }
    if ($('trade-bag-items')) $('trade-bag-items').innerHTML = rows.length
      ? rows.map(function (r) { return '<span class="tag up">' + r.g.icon + ' ' + r.g.name + ' ×' + r.qty + '（' + r.qty * r.g.unit + '格）</span>'; }).join('')
      : '<span class="hint">暂无库存</span>';
  };

  /* ========================================================================
   * 二、日志面板
   * ===================================================================== */
  R.log = function () {
    var list = BT.Log.list.slice(-60).reverse(); /* 最新的在最上面 */
    $('logList').innerHTML = list.map(function (e) {
      return '<div class="log-item ' + e.t + '"><span class="t">D' + e.day + ' ' + U.hhmm(e.hour) + '</span>' + escapeHtml(e.m) + '</div>';
    }).join('');
  };

  /* ========================================================================
   * 三、地图 / 行动 面板
   * ===================================================================== */
  R.map = function () {
    var S = BT.S; if (!S) return;
    BT.MapUI.render();
    /* 机会事件横幅：大订单 —— 选择商品与数量后接单，或拒绝 */
    var banner = $('event-banner'), pend = BT.Events && BT.Events.pending;
    if (pend) {
      banner.style.display = '';
      banner.innerHTML = '<h3>✨ 机会：大订单</h3><div class="desc">' + pend.text + '</div>' +
        '<div class="grid cols-4"><select id="bigorder-goods">' + C.GOODS.map(function (g) { return '<option value="' + g.id + '">' + g.icon + g.name + '（进价¥' + BT.Eco.buyPrice(S, g.id, S.region).toFixed(2) + '）</option>'; }).join('') + '</select>' +
        '<input type="number" id="bigorder-qty" value="30" min="1">' +
        '<button class="primary" onclick="BT.App.acceptBigOrder()">接单</button>' +
        '<button onclick="BT.App.declineBigOrder()">拒绝</button></div>';
    } else if (banner.style.display !== 'none') { banner.style.display = 'none'; banner.innerHTML = ''; }
    var region = C.regionMap[S.region];
    $('map-region-name').textContent = region.icon + ' ' + region.name;
    $('map-region-desc').textContent = region.desc;
    $('map-unlock-list').innerHTML = C.REGIONS.filter(function (r) { return S.unlockedRegions.indexOf(r.id) < 0; }).map(function (r) {
      var cond = r.unlock.type === 'net' ? ('净资产达到 ' + U.money(r.unlock.value)) : '—';
      var ok = r.unlock.type === 'net' && BT.netWorth(S) >= r.unlock.value;
      return '<div class="item-row"><span class="icon">🔒</span><div><div class="name">' + r.name + '</div>' +
        '<div class="sub">解锁条件：' + cond + '</div></div><div class="spacer"></div>' +
        '<button class="small ' + (ok ? 'primary' : '') + '" ' + (ok ? '' : 'disabled') +
        ' onclick="BT.App.unlockRegion(\'' + r.id + '\')">' + (ok ? '解锁' : '未达成') + '</button></div>';
    }).join('') || '<div class="hint">全部区域已解锁。</div>';

    var ms = C.MILESTONES.map(function (m) {
      var done = S.milestones[m.id];
      var pct = U.clamp(BT.netWorth(S) / m.need * 100, 0, 100);
      return '<div class="milestone-row"><div class="milestone-dot ' + (done ? 'done' : '') + '"></div>' +
        '<div style="flex:1"><div class="kv"><span>' + m.name + '</span><b>' + (done ? '已达成' : U.money(BT.netWorth(S)) + ' / ' + U.money(m.need)) + '</b></div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="hint">' + m.desc + '</div></div></div>';
    }).join('');
    $('milestone-list').innerHTML = ms;
  };

  /* ========================================================================
   * 四、交易（买卖商品）
   * ===================================================================== */
  R.trade = function () {
    var S = BT.S; if (!S) return;
    var region = C.regionMap[S.region];
    $('trade-region').textContent = region.icon + region.name;
    $('bag-upgrades').innerHTML = C.BAG_UPGRADES.map(function (u) {
      var owned = S.bagUpgrades && S.bagUpgrades[u.id], here = S.region === 'market';
      return '<div class="item-row"><span class="icon">' + u.icon + '</span><div><div class="name">' + u.name + ' <span class="tag up">+' + u.cap + ' 格</span></div>' +
        '<div class="sub">价格 ' + U.money(u.cost) + (here ? '' : ' · 需前往批发市场') + '</div></div><div class="spacer"></div>' +
        '<button class="small primary" ' + (owned || !here || S.cash < u.cost ? 'disabled' : '') + ' onclick="BT.App.buyBagUpgrade(\'' + u.id + '\')">' + (owned ? '已拥有' : '购买') + '</button></div>';
    }).join('');

    $('trade-goods-list').innerHTML = C.GOODS.map(function (g) {
      var buy = BT.Eco.buyPrice(S, g.id, S.region), sell = BT.Eco.sellPrice(S, g.id, S.region);
      var have = BT.Trade.qtyOf(S, g.id);
      var favored = g.favored.indexOf(S.region) >= 0;
      return '<div class="item-row">' +
        '<span class="icon">' + g.icon + '</span>' +
        '<div><div class="name">' + g.name + (favored ? ' <span class="tag up">本地特产</span>' : '') + '</div>' +
        '<div class="sub">进价 ¥' + buy.toFixed(2) + ' · 售价 ¥' + sell.toFixed(2) + ' · 持有 ' + have + '（占 ' + have * g.unit + ' 格）' + (g.spoil ? ' · 易腐' : '') + '</div>' +
        '<div class="sub">每件占 ' + g.unit + ' 格 · 现在最多可买 ' + BT.Trade.maxBuy(S, g.id) + ' 件</div></div>' +
        '<div class="spacer"></div>' +
        '<button class="small" onclick="BT.App.showPriceCompare(\'' + g.id + '\')">比价</button>' +
        '<input type="number" min="1" value="1" style="width:56px" id="qty-' + g.id + '">' +
        '<button class="small" title="填入最多能买的数量" onclick="BT.App.fillMax(\'' + g.id + '\')">最大</button>' +
        '<button class="small primary" onclick="BT.App.buyGoods(\'' + g.id + '\')">买入</button>' +
        '<button class="small" onclick="BT.App.sellGoods(\'' + g.id + '\')" ' + (have <= 0 ? 'disabled' : '') + '>卖出</button>' +
        '<button class="small" onclick="BT.App.sellAll(\'' + g.id + '\')" ' + (have <= 0 ? 'disabled' : '') + '>全卖</button>' +
        '</div>';
    }).join('');
  };

  R.priceCompare = function (goodsId) {
    var S = BT.S; var rows = BT.Trade.priceTable(S, goodsId);
    var g = C.goodsMap[goodsId];
    $('price-compare-title').textContent = g.icon + ' ' + g.name + ' 各区域价格';
    $('price-compare-table').innerHTML = '<table class="datatable"><tr><th>区域</th><th>进价</th><th>售价</th></tr>' +
      rows.map(function (r) {
        return '<tr><td>' + r.name + (r.region === S.region ? ' (当前)' : '') + '</td><td>¥' + r.buy.toFixed(2) + '</td><td>¥' + r.sell.toFixed(2) + '</td></tr>';
      }).join('') + '</table>';
  };

  /* ========================================================================
   * 五、打工与技能
   * ===================================================================== */
  R.jobs = function () {
    var S = BT.S; if (!S) return;
    var jobs = BT.Jobs.available(S);
    $('jobs-list').innerHTML = jobs.length ? jobs.map(function (j) {
      var cnt = BT.Jobs.doneCount(S, j.id), done = cnt >= C.JOB_DAILY_LIMIT;
      return '<div class="item-row"><span class="icon">' + j.icon + '</span>' +
        '<div><div class="name">' + j.name + '</div><div class="sub">耗时' + j.hours + 'h · 体力-' + j.stamina + ' · 精力-' + j.energy + ' · 报酬 ¥' + j.pay + ' · 今日 ' + cnt + '/' + C.JOB_DAILY_LIMIT + '</div></div>' +
        '<div class="spacer"></div><button class="small primary" ' + (done ? 'disabled' : '') +
        ' onclick="BT.App.doJob(\'' + j.id + '\')">' + (done ? '今日已满' : '开始 (' + cnt + '/' + C.JOB_DAILY_LIMIT + ')') + '</button></div>';
    }).join('') : '<div class="hint">这个区域暂无临时工，换个地方看看。</div>';

    $('skills-list').innerHTML = C.SKILLS.map(function (sk) {
      var lv = BT.Jobs.skillLevel(S, sk.id);
      var here = S.region === sk.region;
      var cost = C.skillCost(sk.costBase, lv), time = C.skillTime(sk.timeBase, lv);
      return '<div class="item-row"><span class="icon">' + sk.icon + '</span>' +
        '<div><div class="name">' + sk.name + ' Lv.' + lv + '/5</div><div class="sub">' + sk.desc + '</div>' +
        '<div class="sub">在' + C.regionMap[sk.region].name + '学习 · 花费 ¥' + cost + ' · ' + time + 'h</div></div>' +
        '<div class="spacer"></div><button class="small primary" ' + (lv >= 5 || !here ? 'disabled' : '') +
        ' onclick="BT.App.learnSkill(\'' + sk.id + '\')">' + (lv >= 5 ? '已满级' : (here ? '学习' : '需前往')) + '</button></div>';
    }).join('');
  };

  /* ========================================================================
   * 六、摆摊
   * ===================================================================== */
  R.stall = function () {
    var S = BT.S; if (!S) return;
    var box = $('stall-box');
    if (!S.stall) {
      box.innerHTML = '<div class="card"><h3>🧺 开摊</h3><div class="desc">选择一件背包里的商品作为主打商品，就能在当前区域摆摊了。摊位费：¥' +
        BT.Stall.FEE[S.region] + '/轮</div>' + stallGoodsOptions(S) + '</div>';
    } else {
      var st = S.stall, g = C.goodsMap[st.goodsId];
      var here = st.regionId === S.region;
      box.innerHTML = '<div class="card"><h3>🏪 摊位经营中</h3>' +
        '<div class="kv"><span>位置</span><b>' + C.regionMap[st.regionId].name + (here ? '' : '（需前往）') + '</b></div>' +
        '<div class="kv"><span>主打商品</span><b>' + g.icon + g.name + '（库存 ' + BT.Trade.qtyOf(S, st.goodsId) + '）</b></div>' +
        '<div class="kv"><span>等级</span><b>Lv.' + st.level + '</b></div>' +
        '<div class="kv"><span>定价倍率</span><b id="stall-markup-val">' + st.markup.toFixed(2) + ' × 基准价</b></div>' +
        '<div style="margin:10px 0"><input type="range" min="0.7" max="1.8" step="0.05" value="' + st.markup +
        '" oninput="BT.App.setStallMarkup(this.value)" style="width:100%"></div>' +
        '<div class="grid cols-3">' +
        '<button class="primary" ' + (here ? '' : 'disabled') + ' onclick="BT.App.stallRun()">营业一轮(2h)</button>' +
        '<button onclick="BT.App.stallUpgrade()">升级摊位</button>' +
        '<button class="danger" onclick="BT.App.stallClose()">收摊</button></div></div>';
    }
  };
  function stallGoodsOptions(S) {
    var owned = C.GOODS.filter(function (g) { return BT.Trade.qtyOf(S, g.id) > 0; });
    if (!owned.length) return '<div class="hint">背包里还没有商品，先去「交易」进货。</div>';
    return '<div class="grid cols-2">' + owned.map(function (g) {
      return '<button onclick="BT.App.stallOpen(\'' + g.id + '\')">' + g.icon + ' ' + g.name + '（x' + BT.Trade.qtyOf(S, g.id) + '）</button>';
    }).join('') + '</div>';
  }

  /* ========================================================================
   * 七、店铺（第一阶段单店 / 第二阶段多店公司）
   * ===================================================================== */
  R.shop = function () {
    var S = BT.S; if (!S) return;
    var box = $('shop-box');
    if (S.biz) { box.innerHTML = '<div class="hint">你已经拥有公司了，请前往「公司」标签页管理所有店铺。</div>'; return; }
    if (!S.shop) {
      var chk = BT.Shop.canOpen(S);
      box.innerHTML = '<div class="card"><h3>🏬 租店开业</h3><div class="desc">' + (chk.ok ? '选择一个已解锁的区域开店（押金 = 区域日租×3×20）。' : chk.msg) + '</div>' +
        (chk.ok ? '<div class="grid cols-2">' + S_unlockedRegionsBtns(S) + '</div>' : '') + '</div>';
    } else {
      var shop = S.shop, region = C.regionMap[shop.regionId];
      box.innerHTML = '<div class="card"><h3>🏬 ' + region.name + ' 店铺 · ' + BT.Shop.tierName(shop) + '</h3>' +
        '<div class="grid cols-2">' +
        '<div class="kv"><span>日租金</span><b>¥' + shop.rent + '</b></div>' +
        '<div class="kv"><span>声望</span><b>' + shop.reputation.toFixed(0) + '/100</b></div>' +
        '<div class="kv"><span>员工</span><b>' + (shop.employee ? '1名（日薪¥' + shop.employee.wage + '）' : '无') + '</b></div>' +
        '<div class="kv"><span>估值</span><b>' + U.money(shop.value) + '</b></div></div>' +
        '<div class="grid cols-3" style="margin-top:8px">' +
        '<button ' + (shop.employee ? 'disabled' : '') + ' onclick="BT.App.shopHire()">雇佣员工</button>' +
        '<button ' + (shop.employee ? '' : 'disabled') + ' class="danger" onclick="BT.App.shopFire()">解雇员工</button>' +
        '<button class="danger" onclick="BT.App.shopClose()">关闭店铺</button></div></div>' +
        '<div class="card"><h3>📦 货架管理</h3><div class="desc">把背包里的商品上架销售，系统每晚自动结算一次客流。</div>' +
        shelfRows(S, shop) + '</div>';
    }
  };
  function S_unlockedRegionsBtns(S) {
    return S.unlockedRegions.map(function (rid) {
      var r = C.regionMap[rid];
      return '<button onclick="BT.App.shopRent(\'' + rid + '\')">' + r.icon + ' ' + r.name + '（押金¥' + (r.rent * 60) + '）</button>';
    }).join('');
  }
  function shelfRows(S, shop) {
    return C.GOODS.map(function (g) {
      var have = BT.Trade.qtyOf(S, g.id);
      var on = shop.shelf[g.id];
      return '<div class="item-row"><span class="icon">' + g.icon + '</span>' +
        '<div><div class="name">' + g.name + '</div><div class="sub">背包库存 ' + have + (on ? ' · 加价×' + on.toFixed(2) : '') + '</div></div>' +
        '<div class="spacer"></div>' +
        (on ? '<button class="small danger" onclick="BT.App.shopUnstock(\'' + g.id + '\')">下架</button>'
            : '<button class="small primary" ' + (have <= 0 ? 'disabled' : '') + ' onclick="BT.App.shopStock(\'' + g.id + '\')">上架</button>') +
        '</div>';
    }).join('');
  }

  /* ========================================================================
   * 八、公司（第二阶段：多店/员工/仓库/贷款/财报/并购）
   * ===================================================================== */
  var bizTab = 'shops';
  R.setBizTab = function (t) { bizTab = t; };
  R.getBizTab = function () { return bizTab; };
  var BIZ_TABS = [['shops', '🏬 门店'], ['talent', '🧑‍💼 人才'], ['supply', '🚚 供应链'], ['rivals', '🥊 竞争'], ['finance', '📊 财务'], ['empire', '🌍 帝国']];
  R.biz = function () {
    var S = BT.S; if (!S) return;
    var box = $('biz-box');
    if (!S.biz) { box.innerHTML = '<div class="hint">达成里程碑「第一桶金」（净资产 ¥10,000）后将自动成立公司。</div>'; return; }
    if (box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName) && !R._force) return; /* 正在输入时不被后台刷新打断 */
    var biz = S.biz, B = BT.Biz;
    var html = '<div class="card biz-head"><div class="grid cols-4">' +
      '<div class="kv"><span>品牌声望</span><b>' + biz.brand.toFixed(1) + '/100</b></div>' +
      '<div class="kv"><span>信用评级</span><b>' + biz.creditScore + '/850</b></div>' +
      '<div class="kv"><span>门店 / 员工</span><b>' + biz.shops.length + ' / ' + U.sum(biz.shops, function (s) { return s.employees.length; }) + '</b></div>' +
      '<div class="kv"><span>总负债</span><b>' + U.money(U.sum(biz.loans, function (l) { return l.remaining; })) + '</b></div></div>' +
      '<div class="pill-group" style="margin:10px 0 0">' + BIZ_TABS.map(function (t) {
        var dot = (t[0] === 'rivals' && dealsCount(S)) ? ' <span class="tag down">' + dealsCount(S) + '</span>' : '';
        return '<button class="' + (bizTab === t[0] ? 'active' : '') + '" onclick="BT.App.bizTab(\'' + t[0] + '\')">' + t[1] + dot + '</button>';
      }).join('') + '</div></div>';
    html += dealsCard(S);
    if (bizTab === 'shops') html += shopsTab(S);
    else if (bizTab === 'talent') html += talentTab(S);
    else if (bizTab === 'supply') html += supplyTab(S);
    else if (bizTab === 'rivals') html += rivalsTab(S);
    else if (bizTab === 'finance') html += financeTab(S);
    else html += empireTab(S);
    box.innerHTML = html;
    if (bizTab === 'finance') { var hist = biz.ledger.map(function (l) { return { v: l.profit, label: l.day }; }); if (hist.length) BT.Chart.drawLine($('bizLedgerChart'), hist, { color: '#ffd766' }); }
  };
  function dealsCount(S) { return (BT.Rivals ? BT.Rivals.deals(S).length : 0) + (S.empireOffer ? 1 : 0); }

  /* ---- 待处理要约（挖人 / 卖店 / 收购）：任何子页都显示在最上面 ---- */
  function dealsCard(S) {
    var ds = BT.Rivals ? BT.Rivals.deals(S) : [];
    if (!ds.length) return '';
    var LBL = { poach: ['加薪挽留', '放他走'], sellShop: ['接手门店', '不要'], buyMyShop: ['卖给它', '拒绝'], buyout: ['接受收购', '硬扛到底'] };
    var ICON = { poach: '🕵️', sellShop: '🏚️', buyMyShop: '💰', buyout: '📨' };
    return '<div class="card deal-card"><h3>📨 待处理要约 <span class="tag down">' + ds.length + '</span></h3>' + ds.map(function (d) {
      var l = LBL[d.type] || ['接受', '拒绝'];
      return '<div class="item-row deal-row"><span class="icon">' + (ICON[d.type] || '📨') + '</span><div style="flex:1"><div class="sub" style="font-size:12.5px;color:var(--text)">' + d.text + '</div>' +
        '<div class="hint">' + (d.expire > S.day ? '明天' : '今天') + '之内答复，过期' + (d.type === 'poach' ? '由员工自己决定去留' : '自动作废') + '</div></div>' +
        '<button class="small primary" onclick="BT.App.dealRespond(\'' + d.id + '\',\'accept\')">' + l[0] + '</button>' +
        '<button class="small" onclick="BT.App.dealRespond(\'' + d.id + '\',\'decline\')">' + l[1] + '</button></div>';
    }).join('') + '</div>';
  }

  /* ---- 门店页：每店 KPI、客流曲线、员工、货架、促销、搬迁；底部开新店（选址预估） ---- */
  function shopsTab(S) {
    var biz = S.biz, B = BT.Biz;
    var html = '<div class="card"><h3>🏬 门店 <span class="spacer"></span><button class="small primary" onclick="BT.App.autoRestock()">📦 一键补货</button></h3>' +
      (biz.shops.length ? biz.shops.map(function (shop) { return bizShopCard(S, shop); }).join('') : '<div class="hint">还没有门店，在下面选个位置开第一家吧。</div>') + '</div>';
    var free = S.unlockedRegions.filter(function (rid) { return !biz.shops.some(function (s) { return s.regionId === rid; }); });
    if (free.length) {
      html += '<div class="card"><h3>📍 选址开新店</h3><div class="desc">同一区域不同地段：租金、装修和路过客流差别很大。预估按 2 名员工、当前竞争格局计算。</div>' +
        '<div class="site-grid">' + free.map(function (rid) {
          var r = C.regionMap[rid];
          return '<div class="site-card"><b>' + r.icon + ' ' + r.name + '</b><div class="hint">对手：' + ((biz.competitors[rid] || {}).name || '暂无') + ' · 一周客流 ' + weekSpark(C.WEEK_TRAFFIC[rid]) + '</div>' +
            C.LOCATIONS.map(function (l) {
              var f = B.siteForecast(S, rid, l.id);
              return '<div class="site-opt"><span>' + l.icon + l.name + '</span><span class="hint">日租' + U.money(f.rent) + ' · 约' + f.customers + '人/天</span>' +
                '<button class="small" ' + (S.cash < f.cost ? 'disabled' : '') + ' onclick="BT.App.bizOpenShop(\'' + rid + '\',\'' + l.id + '\')">' + U.money(f.cost) + ' 开店</button></div>';
            }).join('') + '</div>';
        }).join('') + '</div></div>';
    }
    return html;
  }
  function weekSpark(arr) {
    if (!arr) return '';
    var WD = '日一二三四五六', max = Math.max.apply(null, arr);
    return '<span class="spark">' + arr.map(function (v, i) { return '<i title="周' + WD[i] + ' ×' + v + '" style="height:' + Math.round(v / max * 14) + 'px"></i>'; }).join('') + '</span>';
  }
  function trafficBars(shop) {
    var h = (shop.trafficHist || []).slice(-10); if (!h.length) return '<span class="hint">营业后显示</span>';
    var max = Math.max.apply(null, h.map(function (x) { return x.c; }).concat([1]));
    return '<span class="tbars">' + h.map(function (x) {
      var lostH = x.c ? Math.round(x.lost / max * 26) : 0, okH = Math.round((x.c - x.lost) / max * 26);
      return '<i title="第' + x.day + '天：到店 ' + x.c + '，缺货流失 ' + x.lost + '"><b style="height:' + lostH + 'px" class="lost"></b><b style="height:' + okH + 'px"></b></i>';
    }).join('') + '</span>';
  }
  function bizShopCard(S, shop) {
    var B = BT.Biz, region = C.regionMap[shop.regionId], loc = C.locMap[shop.loc] || C.locMap.street;
    var cap = B.empCap(shop), last = shop.last || {};
    var war = BT.Rivals && BT.Rivals.alive(S).filter(function (rv) { return rv.war[shop.regionId] > 0; })[0];
    var empRows = shop.employees.map(function (e) {
      var fair = B.fairWage(e), tr = C.traitMap[e.trait] || {}, low = e.wage < fair * 0.95;
      return '<tr><td><b>' + e.name + '</b> <span class="tag">' + B.roleOf(e.role).name + '</span>' + (tr.name && tr.id !== 'plain' ? ' <span class="tag" title="' + (tr.desc || '') + '">' + tr.name + '</span>' : '') + (e.offDuty ? ' <span class="tag down">培训中</span>' : '') + '</td>' +
        '<td>' + stars(e.skill) + '</td><td>' + stars(e.service) + '</td>' +
        '<td><span class="loy" style="--v:' + Math.round(e.loyalty) + '%"></span> ' + Math.round(e.loyalty) + '</td>' +
        '<td' + (low ? ' class="down" title="低于身价 ' + U.money(fair) + '，忠诚度会下降"' : '') + '>' + U.money(e.wage) + (low ? '↓' : '') + '</td>' +
        '<td class="emp-act"><button class="small" title="销售培训 ' + U.money(B.trainCost(e, 'sales')) + '" ' + (e.skill >= 5 || e.offDuty ? 'disabled' : '') + ' onclick="BT.App.bizTrain(\'' + shop.id + '\',\'' + e.id + '\',\'sales\')">🗣️' + U.money(B.trainCost(e, 'sales')) + '</button>' +
        '<button class="small" title="服务培训 ' + U.money(B.trainCost(e, 'service')) + '" ' + (e.service >= 5 || e.offDuty ? 'disabled' : '') + ' onclick="BT.App.bizTrain(\'' + shop.id + '\',\'' + e.id + '\',\'service\')">🤝' + U.money(B.trainCost(e, 'service')) + '</button>' +
        '<button class="small" title="加薪 10%，忠诚 +12" onclick="BT.App.bizRaise(\'' + shop.id + '\',\'' + e.id + '\')">💴</button>' +
        '<button class="small danger" title="解雇" onclick="BT.App.bizFire(\'' + shop.id + '\',\'' + e.id + '\')">✕</button></td></tr>';
    }).join('');
    return '<div class="shop-card">' +
      '<div class="shop-top"><b>' + region.icon + region.name + '</b> <span class="tag">' + loc.icon + loc.name + '</span>' + (shop.promoDays > 0 ? ' <span class="tag up">促销中 ' + shop.promoDays + '天</span>' : '') +
      (war ? ' <span class="tag down">⚔️ ' + war.name + ' 价格战</span>' : '') + '<span class="spacer"></span><span class="sub">日租 ' + U.money(shop.rent) + ' · 估值 ' + U.money(shop.value) + '</span></div>' +
      '<div class="shop-kpi">' +
      kpi('口碑', Math.round(shop.reputation)) + kpi('昨日到店', last.customers != null ? last.customers : '-') + kpi('成交', last.buyers != null ? last.buyers : '-') +
      kpi('缺货流失', last.lost != null ? last.lost : '-', last.lost > (last.customers || 0) * 0.2 ? 'down' : '') +
      kpi('昨日净利', last.profit != null ? U.money(last.profit) : '-', last.profit < 0 ? 'down' : 'up') +
      kpi('竞争系数', shop.cf != null ? Math.round(shop.cf * 100) + '%' : '-') +
      '<div class="kpi wide"><span>近10天客流</span>' + trafficBars(shop) + '</div></div>' +
      '<div class="tbl-wrap"><table class="datatable emp-table"><tr><th>员工 ' + shop.employees.length + '/' + cap + '</th><th>销售</th><th>服务</th><th>忠诚</th><th>日薪</th><th></th></tr>' +
      (empRows || '<tr><td colspan="6" class="hint">没有员工，客流只有三成多。去「人才」页签人，或在下面直接招一个普通员工。</td></tr>') + '</table></div>' +
      '<div class="shop-actions"><select id="role-' + shop.id + '">' + B.EMP_ROLES.map(function (r) { return '<option value="' + r.id + '">' + r.name + '（日薪¥' + r.wageBase + '）</option>'; }).join('') + '</select>' +
      '<button class="small" onclick="BT.App.bizHire(\'' + shop.id + '\')">直接招人</button>' +
      '<button class="small good" ' + (shop.promoDays > 0 ? 'disabled' : '') + ' onclick="BT.App.bizPromote(\'' + shop.id + '\')">📣 促销 ' + U.money(B.promoCost(shop)) + '</button>' +
      '<select id="reloc-' + shop.id + '">' + C.LOCATIONS.filter(function (l) { return l.id !== shop.loc; }).map(function (l) { return '<option value="' + l.id + '">搬到' + l.name + '（' + U.money(Math.round(B.shopCost(shop.regionId, l.id) * 0.6)) + '）</option>'; }).join('') + '</select>' +
      '<button class="small" onclick="BT.App.bizRelocate(\'' + shop.id + '\')">搬迁</button>' +
      '<button class="small danger" onclick="BT.App.bizCloseShop(\'' + shop.id + '\')">关店</button></div>' +
      transferRow(S, shop) + shelfRowsBiz(S, shop) + '</div>';
  }
  function kpi(label, v, cls) { return '<div class="kpi"><span>' + label + '</span><b class="' + (cls || '') + '">' + v + '</b></div>'; }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆'; return '<span class="stars">' + s + '</span>'; }
  /* 仓库调货：下拉选择仓库现有商品 + 数量输入 */
  function transferRow(S, shop) {
    var wh = BT.Biz.warehouse(S, shop.regionId);
    var opts = C.GOODS.filter(function (g) { return (wh.goods[g.id] || 0) > 0; }).map(function (g) {
      return '<option value="' + g.id + '">' + g.icon + g.name + '（仓库' + wh.goods[g.id] + '）</option>';
    }).join('');
    if (!opts) return '<div class="sub" style="margin-top:6px">本区仓库暂无存货，可在「供应链」页批发进货，或直接点「一键补货」。</div>';
    return '<div class="grid cols-3" style="width:100%;margin-top:6px"><select id="xfer-goods-' + shop.id + '">' + opts + '</select>' +
      '<input type="number" min="1" value="20" id="xfer-qty-' + shop.id + '">' +
      '<button class="small" onclick="BT.App.bizTransfer(\'' + shop.id + '\')">仓库调货到门店</button></div>';
  }
  function shelfRowsBiz(S, shop) {
    var rows = C.GOODS.filter(function (g) { return (shop.inventory[g.id] || 0) > 0 || shop.shelf[g.id]; });
    if (!rows.length) return '';
    return '<div class="shelf-grid">' + rows.map(function (g) {
      var inv = shop.inventory[g.id] || 0; var on = shop.shelf[g.id];
      return '<div class="shelf-item' + (on && inv <= 0 ? ' empty' : '') + '">' + g.icon + g.name + ' <b>' + inv + '</b>' + (on ? '' : ' <span class="tag">未上架</span>') +
        ' <input type="number" step="0.05" min="0.8" max="2.5" id="markup-' + shop.id + '-' + g.id + '" value="' + (on || 1.3) + '" title="加价倍率">' +
        '<button class="small" onclick="BT.App.bizSetShelf(\'' + shop.id + '\',\'' + g.id + '\')">' + (on ? '改价' : '上架') + '</button></div>';
    }).join('') + '</div>';
  }

  /* ---- 人才页：人才市场候选人（AI 公司也会来抢） ---- */
  function talentTab(S) {
    var biz = S.biz, B = BT.Biz;
    var shopOpts = biz.shops.map(function (sh) { return '<option value="' + sh.id + '">' + C.regionMap[sh.regionId].name + '店（' + sh.employees.length + '/' + B.empCap(sh) + '）</option>'; }).join('');
    var cands = (biz.candidates || []).map(function (c) {
      var tr = C.traitMap[c.trait] || {};
      return '<div class="item-row"><span class="icon">🧑‍💼</span><div style="flex:1"><div class="name">' + c.name + ' <span class="tag">' + B.roleOf(c.role).name + '</span> <span class="tag" title="' + (tr.desc || '') + '">' + (tr.name || '') + '</span></div>' +
        '<div class="sub">销售 ' + stars(c.skill) + ' 服务 ' + stars(c.service) + ' · 要价 ' + U.money(c.wage) + '/天 · 签约费 ' + U.money(c.wage * 2) + '</div><div class="hint">' + (tr.desc || '') + '</div></div>' +
        (shopOpts ? '<select id="cand-shop-' + c.id + '">' + shopOpts + '</select><button class="small primary" onclick="BT.App.bizHireCand(\'' + c.id + '\')">签下</button>' : '') + '</div>';
    }).join('') || '<div class="hint">候选人都被签走了，过几天会有新的人来应聘。</div>';
    return '<div class="card"><h3>🧑‍💼 人才市场 <span class="hint">每 5 天刷新 · 下次 ' + Math.max(0, 5 - (S.day - (biz.candDay || 0))) + ' 天后</span></h3>' +
      '<div class="desc">比「直接招人」能力更好、要价也更高。动作要快：优秀的候选人每天都可能被 AI 公司抢先签走。</div>' + cands + '</div>' +
      '<div class="card"><h3>📘 员工说明</h3><div class="hint">· 销售：提高成交（到店顾客数）；服务：口碑增长更快；店长：全店加成；采购：批发额外折扣（最强采购每级 1.2%）。</div>' +
      '<div class="hint">· 培训：脱产 1 天，当天不上班；能力上去后身价也上去，工资低于身价忠诚度会掉，忠诚低于 20 可能辞职，AI 公司也更容易挖走他。</div>' +
      '<div class="hint">· 特质：' + C.EMP_TRAITS.map(function (t) { return t.name + '（' + t.desc + '）'; }).join('，') + '。</div></div>';
  }

  /* ---- 供应链页：预警 / 断供 / 长约 + 仓库与批发 ---- */
  function supplyTab(S) {
    var Sup = BT.Supply, board = Sup ? Sup.board(S) : [];
    var STATE = { out: ['down', '⛔ 断供中'], rise: ['down', '📈 涨价中'], 'warn-out': ['', '⚠️ 即将断供'], 'warn-rise': ['', '⚠️ 即将涨价'] };
    var html = '<div class="card"><h3>🚚 供应链动态</h3>' + (board.length ? board.map(function (b) {
      var g = C.goodsMap[b.gid], st = STATE[b.state];
      var detail = b.state === 'out' ? '还剩 ' + b.days + ' 天' : (b.state === 'rise' ? '+' + Math.round((b.mul - 1) * 100) + '%，还剩 ' + b.days + ' 天' : (b.days + ' 天后开始' + (b.state === 'warn-rise' ? '，+' + Math.round((b.mul - 1) * 100) + '%' : '') + '，持续约 ' + b.len + ' 天'));
      return '<div class="kv"><span>' + g.icon + g.name + ' <span class="tag ' + st[0] + '">' + st[1] + '</span></span><b>' + detail + '</b></div>';
    }).join('') : '<div class="hint">供应一切正常。</div>') +
      '<div class="hint" style="margin-top:6px">预警出现后有 1~3 天窗口：可以提前囤货，或签长约锁价。断供期间批发进不到货，只能找应急供应商（加价 40%、每单最多 ' + C.SUPPLY.emergencyCap + ' 件）。</div></div>';
    html += '<div class="card"><h3>📄 长期供货合同</h3><div class="desc">锁定当前价的 95%，' + C.SUPPLY.contractDays + ' 天内批发都按锁定价；断供时也优先给你供货。但如果市价下跌，你仍然要按锁定价买 —— 这是对赌。</div>' +
      '<div class="tbl-wrap"><table class="datatable"><tr><th>商品</th><th>当前进价</th><th>锁定价</th><th>状态</th><th></th></tr>' + C.GOODS.map(function (g) {
        var c = Sup && Sup.contract(S, g.id), price = BT.Eco.buyPrice(S, g.id, 'market'), ratio = c ? Sup.contractRatio(S, g.id) : 1;
        return '<tr><td>' + g.icon + g.name + '</td><td>¥' + price.toFixed(2) + '</td><td>' + (c ? '¥' + (price * ratio).toFixed(2) + ' <span class="' + (ratio < 1 ? 'up' : 'down') + '">' + (ratio < 1 ? '省' : '亏') + Math.abs(Math.round((1 - ratio) * 100)) + '%</span>' : '-') + '</td>' +
          '<td>' + (c ? '剩 ' + (c.until - S.day) + ' 天' : '') + '</td><td>' + (c ? '' : '<button class="small" onclick="BT.App.signContract(\'' + g.id + '\')">签约 ' + U.money(Sup.contractFee(g.id)) + '</button>') + '</td></tr>';
      }).join('') + '</table></div></div>';
    html += '<div class="card"><h3>📦 仓库与批发</h3>' + warehouseBox(S) + '</div>';
    return html;
  }
  function warehouseBox(S) {
    var html = '<div class="grid cols-3">';
    S.unlockedRegions.forEach(function (rid) {
      var wh = BT.Biz.warehouse(S, rid);
      html += '<div class="item-row" style="flex-direction:column;align-items:flex-start">' +
        '<b>' + C.regionMap[rid].name + ' 仓库</b><div class="sub">容量 ' + wh.used + '/' + wh.cap + '</div>' +
        '<button class="small" onclick="BT.App.bizUpgradeWarehouse(\'' + rid + '\')">扩容(¥' + Math.round(wh.cap * 0.6) + ')</button></div>';
    });
    var bd = BT.Biz.buyerDiscount(S);
    html += '</div><div class="hint" style="margin-top:8px">批发采购（≥50件 8% / ≥100件 15% / ≥200件 22% 折扣' + (bd ? '，采购员额外 ' + Math.round(bd * 1000) / 10 + '%' : '') + '）：</div><div class="grid cols-4">' +
      '<select id="wh-region">' + S.unlockedRegions.map(function (rid) { return '<option value="' + rid + '">' + C.regionMap[rid].name + '</option>'; }).join('') + '</select>' +
      '<select id="wh-goods">' + C.GOODS.map(function (g) { return '<option value="' + g.id + '">' + g.icon + g.name + (BT.Supply && BT.Supply.isOut(S, g.id) ? '（断供）' : '') + '</option>'; }).join('') + '</select>' +
      '<input type="number" id="wh-qty" value="50" min="10">' +
      '<button class="primary" onclick="BT.App.bizWholesale()">批发进货</button></div>' +
      '<label class="hint" style="display:block;margin-top:6px"><input type="checkbox" id="wh-emergency"> 断供时找应急供应商（加价 40%，限量）</label>';
    return html;
  }

  /* ---- 竞争页：各区市场份额 + AI 公司档案 + 动态 ---- */
  function rivalsTab(S) {
    var Rv = BT.Rivals; if (!Rv) return '';
    var html = '<div class="card"><h3>🗺️ 各区域市场份额</h3><div class="desc">份额按吸引力（规模、口碑、品牌、地段、促销/价格战）分配。你在某区份额太高，激进/折扣型对手就会发起价格战。</div>' +
      C.REGIONS.map(function (r) {
        var sh = Rv.shares(S, r.id);
        return '<div class="share-row"><span class="share-name">' + r.icon + r.name + '</span><div class="share-bar">' + sh.map(function (x) {
          return '<i style="width:' + (x.share * 100).toFixed(1) + '%;background:' + x.color + '" title="' + x.name + ' ' + Math.round(x.share * 100) + '%' + (x.war ? '（价格战）' : '') + '">' + (x.share > 0.12 ? (x.me ? '我' : x.icon) + Math.round(x.share * 100) + '%' : '') + (x.war ? '⚔️' : '') + '</i>';
        }).join('') + (sh.length ? '' : '<span class="hint">无人经营</span>') + '</div></div>';
      }).join('') + '</div>';
    html += '<div class="card"><h3>🏢 AI 竞争对手</h3><div class="rival-grid">' + S.biz.rivals.map(function (rv) {
      var shops = U.keys(rv.shops), wars = U.keys(rv.war);
      var stock = rv.listed && S.market ? S.market.stocks[rv.listed] : null;
      var canBuy = rv.alive && !rv.listed && BT.Empire.unlocked(S);
      return '<div class="rival-card' + (rv.alive ? '' : ' dead') + '" style="--c:' + rv.color + '"><div class="rival-top"><b>' + rv.icon + ' ' + rv.name + '</b> <span class="tag">' + (C.STYLE_NAMES[rv.style] || rv.style) + '</span>' +
        (rv.listed ? ' <span class="tag up">上市 ' + rv.listed.toUpperCase() + (stock ? ' ¥' + stock.price.toFixed(2) : '') + '</span>' : '') + (rv.alive ? '' : ' <span class="tag down">' + (rv.fate === 'acquired' ? '已被你收购' : '已破产') + '</span>') + '</div>' +
        '<div class="hint">' + rv.desc + '</div>' +
        (rv.alive ? '<div class="kv"><span>现金（估）</span><b class="' + (rv.cash < 0 ? 'down' : '') + '">' + U.money(Math.round(rv.cash / 100) * 100) + '</b></div>' +
        '<div class="kv"><span>品牌</span><b>' + rv.brand.toFixed(0) + '</b></div>' +
        '<div class="kv"><span>门店</span><b>' + shops.map(function (rid) { return C.regionMap[rid].name + 'Lv' + rv.shops[rid].level; }).join('、') + '</b></div>' +
        '<div class="kv"><span>近7日利润</span><b>' + U.money(U.sum(rv.profit7 || [])) + '</b></div>' +
        (wars.length ? '<div class="kv"><span>价格战</span><b class="down">' + wars.map(function (rid) { return C.regionMap[rid].name + '（' + rv.war[rid] + '天）'; }).join('、') + '</b></div>' : '') +
        (rv.listed ? '' : '<div class="trade-row" style="margin-top:6px;grid-template-columns:1fr"><button class="small ' + (canBuy ? 'primary' : '') + '" ' + (canBuy ? '' : 'disabled title="解锁「资本帝国」后可收购"') + ' onclick="BT.App.acquireRival(\'' + rv.id + '\')">🏆 整体收购 ' + U.money(Rv.acquireCost(S, rv)) + '</button></div>') : '') + '</div>';
    }).join('') + '</div></div>';
    html += '<div class="card"><h3>📰 竞争动态</h3>' + ((S.biz.rivalNews || []).slice(0, 12).map(function (n) {
      return '<div class="news-row"><span class="hint">第' + n.day + '天</span> ' + escapeHtml(n.text) + '</div>';
    }).join('') || '<div class="hint">暂时风平浪静。</div>') + '</div>';
    return html;
  }

  function financeTab(S) {
    var biz = S.biz;
    return '<div class="card"><h3>📊 财务报表</h3><div class="chart-box small"><canvas id="bizLedgerChart"></canvas></div>' + ledgerTable(biz) + '</div>' +
      '<div class="card"><h3>🏦 银行贷款</h3>' + loanBox(S, biz) + '</div>';
  }
  function empireTab(S) {
    var biz = S.biz;
    if (BT.Empire.unlocked(S)) return '<div class="card"><h3>🌍 资本帝国</h3><div class="desc">企业并购、房地产与慈善捐赠；在「竞争」页可以整体收购 AI 公司。</div>' + empireBox(S) + '</div>' + estateCard(S);
    return '<div class="card"><h3>🌍 资本帝国</h3><div class="desc">解锁条件：≥' + BT.Empire.GATE.minShops + '间店铺 且净资产 ≥ ' + U.money(BT.Empire.GATE.minNet) + '（当前 ' + biz.shops.length + '间 / ' + U.money(BT.netWorth(S)) + '）</div></div>';
  }

  function estateCard(S) {
    var E = BT.Empire; E.ensure(S);
    var rows = C.REGIONS.map(function (r) {
      var own = S.estate[r.id], p = E.price(S, r.id);
      return '<div class="item-row"><div><div class="name">' + r.icon + r.name + ' 物业</div><div class="sub">市价 ' + U.money(p) +
        (own ? '（买入 ' + U.money(own.cost) + '，盈亏 ' + U.money(p - own.cost) + '）· 日租 ' + U.money(E.dailyRent(S, r.id)) : ' · 预计日租 ' + U.money(E.dailyRent(S, r.id))) + '</div></div><div class="spacer"></div>' +
        (own ? '<button class="small" onclick="BT.App.estateSell(\'' + r.id + '\')">出售</button>' : '<button class="small primary" onclick="BT.App.estateBuy(\'' + r.id + '\')">购入</button>') + '</div>';
    }).join('');
    return '<div class="card"><h3>🏢 房地产</h3><div class="desc">买入含 2% 税费，卖出扣 3%，每日租金约为市价的 0.12%（已扣维护费）。名下地产市值 ≥ ¥200,000 达成「地产大亨」。当前地产市值 ' + U.money(E.netWorth(S)) + '</div>' + rows + '</div>' +
      '<div class="card"><h3>❤️ 慈善捐赠</h3><div class="desc">累计捐赠 ' + U.money(S.stats.donated || 0) + ' / ¥50,000 可达成「慈善家」结局；捐赠还能提升品牌声望。</div>' +
      '<div class="trade-row"><input type="number" id="donate-amt" value="1000" min="100"><button class="primary" onclick="BT.App.donate()">捐赠</button></div></div>';
  }
  function loanBox(S, biz) {
    var hgd = S.market && S.market.rates ? S.market.rates.hgd : 0.025;
    var html = '<div class="kv"><span>可贷额度</span><b>' + U.money(BT.Biz.maxLoan(S)) + '</b></div>' +
      '<div class="kv"><span>当前日利率</span><b>' + (BT.Biz.loanRate(S) * 100).toFixed(3) + '%</b></div>' +
      '<div class="kv"><span>新港央行基准利率</span><b>' + (hgd * 100).toFixed(2) + '%（央行加息，贷款就变贵）</b></div>' +
      '<div class="grid cols-2" style="margin:8px 0"><input type="number" id="loan-amount" value="1000" min="100">' +
      '<button class="primary" onclick="BT.App.bizTakeLoan()">申请贷款</button></div>';
    if (biz.loans.length) {
      html += biz.loans.map(function (l) {
        return '<div class="item-row"><div><div class="name">贷款 #' + l.id + '</div><div class="sub">剩余 ' + U.money(l.remaining) + '</div></div>' +
          '<div class="spacer"></div><input type="number" style="width:80px" id="repay-' + l.id + '" value="' + Math.round(l.remaining) + '">' +
          '<button class="small primary" onclick="BT.App.bizRepay(\'' + l.id + '\')">还款</button></div>';
      }).join('');
    } else html += '<div class="hint">暂无贷款。</div>';
    return html;
  }
  function ledgerTable(biz) {
    var rows = biz.ledger.slice(-7);
    if (!rows.length) return '<div class="hint">暂无数据。</div>';
    return '<div class="tbl-wrap"><table class="datatable"><tr><th>天</th><th>营收</th><th>成本</th><th>租金</th><th>工资</th><th>净利</th></tr>' +
      rows.map(function (r) { return '<tr><td>D' + r.day + '</td><td>' + U.compact(r.revenue) + '</td><td>' + U.compact(r.cogs) +
        '</td><td>' + U.compact(r.rent) + '</td><td>' + U.compact(r.wage) + '</td><td class="' + (r.profit >= 0 ? 'up' : 'down') + '">' + U.compact(r.profit) + '</td></tr>'; }).join('') + '</table></div>';
  }
  function empireBox(S) {
    var html = '<div class="grid cols-3">';
    C.CITIES.forEach(function (c) {
      html += '<div class="item-row" style="flex-direction:column"><b>' + c.name + '</b><span class="tag">' +
        (c.status === 'active' ? '运营中' : '敬请期待') + '</span></div>';
    });
    html += '</div>';
    if (S.empireOffer) {
      var o = S.empireOffer, r = C.regionMap[o.regionId], rv = BT.Rivals && BT.Rivals.get(S, o.rivalId);
      html += '<div class="card" style="margin-top:8px"><h3>🤝 并购要约</h3><div class="desc">' + (rv ? rv.name : '竞争对手') + ' 愿以 ' + U.money(o.price) + ' 出让' + r.name + '门店（' + (o.level || 1) + '级）及客源</div>' +
        '<div class="grid cols-2"><button class="primary" onclick="BT.App.empireAccept()">接受</button><button onclick="BT.App.empireDecline()">拒绝</button></div></div>';
    }
    return html;
  }

  /* ========================================================================
   * 九、金融市场（股票 / 期货 / 外汇）
   * ===================================================================== */
  var marketTab = 'stock', selectedInstr = 'xjhg';
  R.setMarketTab = function (t) { marketTab = t; selectedInstr = ({ stock: 'xjhg', future: 'soy', forex: 'usd' })[t]; };
  R.setSelected = function (id) { selectedInstr = id; };
  R.getSelected = function () { return selectedInstr; };
  R.getMarketTab = function () { return marketTab; };
  R.market = function () {
    var S = BT.S; BT.Market.prepare(S);
    $('mkt-index').textContent = '大盘指数 ' + S.market.index.toFixed(2) + ' · 盘中 ' + U.hhmm(S.hour);
    ['stock', 'future', 'forex'].forEach(function (t) {
      var el = $('mkt-tab-' + t); if (el) el.className = t === marketTab ? 'active' : '';
    });
    var defs = marketTab === 'stock' ? BT.Market.STOCKS : (marketTab === 'future' ? BT.Market.FUTURES : BT.Market.FOREX);
    var seriesMap = marketTab === 'stock' ? S.market.stocks : (marketTab === 'future' ? S.market.futures : S.market.forex);
    if (!defs.some(function (d) { return d.id === selectedInstr; })) selectedInstr = defs[0].id;

    $('mkt-list').innerHTML = defs.map(function (d) {
      var series = seriesMap[d.id];
      var hist = series.hist; var prev = hist.length ? hist[hist.length - 1].c : series.price; /* 昨收 */
      var chg = prev ? (series.price - prev) / prev : 0;
      var lastPx = lastPrices[d.id], flash = lastPx != null && lastPx !== series.price ? (series.price > lastPx ? ' flash-up' : ' flash-down') : '';
      lastPrices[d.id] = series.price;
      var sub = d.float ? ' · 流通 ' + U.compact(d.float, 1) + '股' : (series.ct ? ' · 主力 ' + series.ct.code + '（' + Math.max(0, series.ct.expiry - S.day) + '天到期）' : (S.market.rates ? ' · 利率 ' + ((S.market.rates[d.id] || 0) * 100).toFixed(2) + '%' : ''));
      return '<div class="ticker-row ' + (d.id === selectedInstr ? 'active' : '') + flash + '" onclick="BT.App.selectInstrument(\'' + d.id + '\')">' +
        '<div class="t-main"><div class="name">' + (d.name || d.ticker) + (d.tier ? ' <span class="tag">' + d.tier + '</span>' : '') + (d.group ? ' <span class="tag">' + BT.Market.GROUPS[d.group].slice(0, 2) + '</span>' : '') + '</div>' +
        '<div class="code">' + d.ticker + sub + '</div></div>' +
        '<div class="t-px"><div class="price">' + series.price.toFixed(2) + '</div>' +
        '<div class="chg ' + (chg >= 0 ? 'up' : 'down') + '">' + U.pct(chg) + '</div></div></div>';
    }).join('');

    renderInstrumentDetail(S, defs.filter(function (d) { return d.id === selectedInstr; })[0]);
    renderCalendar(S);
    renderPortfolio(S);
    renderNews(S);
    renderTrades(S);
    renderDebug(S);
  };

  var lastPrices = {};
  /* 财报季日历 + 板块表现（股票）/ 合约月份（期货）/ 利率与隔夜利息（外汇） */
  function renderCalendar(S) {
    var el = $('mkt-calendar'), h = $('mkt-calendar-title'); if (!el) return;
    var M = BT.Market, m = S.market;
    if (marketTab === 'stock') {
      if (h) h.textContent = '🗓️ 财报季 · 板块';
      var groups = {};
      M.STOCKS.forEach(function (d) {
        var ser = m.stocks[d.id], prev = ser.hist.length ? ser.hist[ser.hist.length - 1].c : ser.price;
        (groups[d.group] = groups[d.group] || []).push((ser.price - prev) / prev);
      });
      var sec = '<div class="sector-row">' + U.keys(groups).map(function (g) {
        var v = U.sum(groups[g]) / groups[g].length;
        return '<span class="sector ' + (v >= 0 ? 'up' : 'down') + '">' + M.GROUPS[g] + ' <b>' + U.pct(v) + '</b></span>';
      }).join('') + '</div>';
      var cal = M.earnCalendar(S);
      el.innerHTML = sec + (cal.length ? '<div class="tbl-wrap"><table class="datatable"><tr><th>公司</th><th>公布</th><th>预期EPS</th><th>预期增速</th></tr>' + cal.map(function (c) {
        var dd = c.day - S.day;
        return '<tr' + (dd <= 0 ? ' class="hl"' : '') + '><td>' + c.name + '</td><td>' + (dd <= 0 ? '今晚' : dd + '天后') + '</td><td>' + (c.cons.eps != null ? c.cons.eps.toFixed(2) : '-') + '</td><td>' + U.pct(c.cons.growth, 1) + '</td></tr>';
      }).join('') + '</table></div>' : '<div class="hint">本季财报已全部公布。</div>') +
        '<div class="hint">实际 EPS 高于预期 → 跳涨，低于 → 跳跌；同板块个股会跟随（板块联动）。新辉零售的营收来自它在你身边开的那些门店。</div>';
    } else if (marketTab === 'future') {
      if (h) h.textContent = '📆 合约月份';
      el.innerHTML = '<div class="tbl-wrap"><table class="datatable"><tr><th>主力</th><th>到期</th><th>次月价</th><th>升贴水</th></tr>' + M.FUTURES.map(function (f) {
        var ct = m.futures[f.id].ct, left = ct.expiry - S.day;
        return '<tr' + (left <= 5 ? ' class="hl"' : '') + ' title="' + f.name + ' 次月合约 ' + ct.next + '"><td>' + ct.code + '</td><td>' + (left <= 0 ? '今天' : left + '天') + '</td><td>' + M.futPx(S, f.id, ct.next).toFixed(2) + '</td><td class="' + (f.basis >= 0 ? 'up' : 'down') + '">' + U.pct(f.basis, 1) + '</td></tr>';
      }).join('') + '</table></div><div class="hint">每月 15 日主力合约到期。个人账户不能交割：到期前要「换月」到次月合约，否则按结算价强制平仓。最后 5 天保证金上调 50%。</div>';
    } else {
      if (h) h.textContent = '💱 利率与隔夜利息';
      var r = m.rates || M.RATES0;
      el.innerHTML = '<div class="kv"><span>新港元 HGD 基准利率</span><b>' + (r.hgd * 100).toFixed(2) + '%</b></div>' +
        '<div class="tbl-wrap"><table class="datatable"><tr><th>货币对</th><th>外币利率</th><th>多单/天/手</th><th>空单/天/手</th></tr>' + M.FOREX.map(function (f) {
          var l = M.swapPerLot(S, f.id, 1), sh = M.swapPerLot(S, f.id, -1);
          return '<tr><td>' + f.ticker + '</td><td>' + ((r[f.id] || 0) * 100).toFixed(2) + '%</td><td class="' + (l >= 0 ? 'up' : 'down') + '">' + (l >= 0 ? '+' : '') + l.toFixed(2) + '</td><td class="' + (sh >= 0 ? 'up' : 'down') + '">' + (sh >= 0 ? '+' : '') + sh.toFixed(2) + '</td></tr>';
        }).join('') + '</table></div><div class="hint">持仓过夜按利差收付利息（已含 0.6% 点差），直接计入保证金。高息货币做多能「吃利息」，但汇率波动可能吃掉全部利差。</div>';
    }
  }
  /* 五档盘口 + 逐笔成交：每档标出对手方 */
  function bookHtml(S, def) {
    var b = BT.Market.book(S, def.id);
    function row(cls, name, l) { return '<tr class="' + cls + '" onclick="BT.App.pickPrice(' + l.p.toFixed(2) + ')" title="点击填入价格"><td>' + name + '</td><td>' + l.p.toFixed(2) + '</td><td>' + l.q + '</td><td class="who">' + l.who + '</td></tr>'; }
    var asks = b.asks.slice().reverse().map(function (l, k) { return row('ask', '卖' + (5 - k), l); }).join('');
    var bids = b.bids.map(function (l, k) { return row('bid', '买' + (k + 1), l); }).join('');
    var tape = (S.market.tape[def.id] || []).slice(0, 7).map(function (t) {
      return '<div class="hint ' + (t.big ? 'tape-big' : '') + '">' + (t.day === S.day ? U.hhmm(t.hour) : '昨日') + ' ' + t.who + ' ' + t.dir + ' ' + t.q + ' @ ' + t.p.toFixed(2) + '</div>';
    }).join('') || '<div class="hint">暂无</div>';
    return {
      book: '<table class="book"><tr><th></th><th>价格</th><th>挂单量</th><th>对手方</th></tr>' + asks +
        '<tr class="mid"><td colspan="4">最新价 ' + S.market.stocks[def.id].price.toFixed(2) + '</td></tr>' + bids + '</table>' +
        '<div class="hint">点击价格自动填入下单价；买单吃卖盘、卖单吃买盘。</div>',
      tape: '<div class="hint">AI 参与者之间的实时成交：</div>' + tape
    };
  }
  /* 我的成交明细：每笔订单分档成交的对手方、价格、数量 */
  function renderTrades(S) {
    var el = $('mkt-trades'); if (!el) return;
    var list = (S.market.trades || []).slice(0, 15);
    el.innerHTML = list.length ? list.map(function (t) {
      var buy = t.side === 'buy';
      return '<details class="trade-rec"><summary><span class="tag ' + (buy ? 'up' : 'down') + '">' + (buy ? '买入' : '卖出') + '</span> ' + t.name + ' ' + t.qty + (t.qty < t.ordered ? '/' + t.ordered : '') + '股 @' + t.avg.toFixed(2) +
        ' <span class="hint">第' + t.day + '天 ' + U.hhmm(t.hour) + (t.pnl != null ? ' · 盈亏 ' + U.money(t.pnl) : '') + '</span></summary>' +
        '<div class="hint">成交额 ' + U.money(t.amount) + ' · ' + (buy ? '佣金 ' : '佣金+印花税 ') + U.money(t.fee) + '</div>' +
        t.fills.map(function (f) { return '<div class="hint">· ' + f.who + '：' + f.q + '股 @ ' + f.p.toFixed(2) + '</div>'; }).join('') + '</details>';
    }).join('') : '<div class="hint">还没有成交记录。</div>';
  }

  /* 市场新闻：利好 / 利空 + 受影响标的 */
  var newsKey = '';
  function renderNews(S) {
    var el = $('mkt-news'); if (!el) return;
    var list = (S.market.news || []).slice(0, 8);
    var key = list.map(function (n) { return n.day + n.text; }).join('|');
    if (key === newsKey && el.innerHTML) return; /* 内容没变就不重绘，滚动不会被打断 */
    newsKey = key;
    var rows = list.map(function (n) {
      var good = n.jump >= 0;
      return '<div class="news-row"><span class="tag ' + (good ? 'up' : 'down') + '">' + (good ? '利好' : '利空') + '</span> ' +
        '<span class="hint">第' + n.day + '天</span> ' + n.text.replace(/^[^一-龥]*/, '') +
        ' <b class="' + (good ? 'up' : 'down') + '">' + U.pct(n.jump) + '</b>' +
        '<div class="hint">影响：' + (n.targets || []).join('、') + '</div></div>';
    }).join('');
    if (!list.length) { el.innerHTML = '<div class="hint">暂无重大新闻。</div>'; return; }
    /* 条数多时内容复制一份做无缝向上滚动；条数少就静止显示 */
    el.innerHTML = list.length > 2 ? '<div class="marq" style="animation-duration:' + (list.length * 5) + 's">' + rows + rows + '</div>' : rows;
  }

  /* 调试后门：修改股票持仓数量等，并一键检查数据一致性 */
  function renderDebug(S) {
    var card = $('debug-card'); if (!card) return;
    var open = BT.Debug && BT.Debug.enabled() && BT.Debug.isOpen();
    card.style.display = open ? '' : 'none'; if (!open) return;
    var body = $('debug-body');
    if (body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; /* 输入中不重绘 */
    var opts = BT.Market.STOCKS.map(function (d) { return '<option value="' + d.id + '">' + d.name + '</option>'; }).join('');
    var gopts = BT.CFG.GOODS.map(function (g) { return '<option value="' + g.id + '">' + g.name + '（占' + g.unit + '格）</option>'; }).join('');
    body.innerHTML =
      '<div class="hint">用于测试数量/格数相关 BUG。使用后存档标记为作弊。</div>' +
      '<div class="trade-row"><select id="dbg-stock" style="flex:1">' + opts + '</select><input type="number" id="dbg-qty" value="1000" min="0"></div>' +
      '<div class="trade-row"><button onclick="BT.App.dbgSetStock()">设为该持仓</button><button onclick="BT.App.dbgAddStock(100)">+100</button><button onclick="BT.App.dbgAddStock(-100)">-100</button></div>' +
      '<div class="trade-row"><select id="dbg-goods" style="flex:1">' + gopts + '</select><button onclick="BT.App.dbgSetBag()">设背包数量</button></div>' +
      '<div class="trade-row"><input type="number" id="dbg-cash" value="100000"><button onclick="BT.App.dbgSetCash()">设现金</button></div>' +
      '<div class="trade-row"><button class="primary" onclick="BT.App.dbgAudit()">🔍 一致性检查</button></div><div id="dbg-out" class="hint"></div>';
  }

  function renderInstrumentDetail(S, def) {
    if (!def) return;
    var seriesMap = marketTab === 'stock' ? S.market.stocks : (marketTab === 'future' ? S.market.futures : S.market.forex);
    var series = seriesMap[def.id];
    $('instr-title').textContent = (def.name || def.ticker) + '（' + def.ticker + '）';
    var markers = [];
    if (marketTab === 'stock' && series.financials.length) {
      markers = series.financials.map(function (r) { return { day: r.day, color: r.surprise >= 0 ? '#2f9e5e' : '#e5534b' }; });
    }
    if (marketTab === 'future' && series.rolls) markers = series.rolls.map(function (d) { return { day: d, color: '#ffd766' }; });
    BT.Chart.drawCandles($('instrChart'), BT.Market.chartCandles(S, marketTab === 'stock' ? 'stocks' : (marketTab === 'future' ? 'futures' : 'forex'), def.id, 60), { markers: markers });

    var tapeHtml = '', info = '', trade = '', book = '<div class="hint">期货 / 外汇没有五档盘口：按最新价加减半个买卖价差成交（见下单区说明）。</div>';
    if (marketTab === 'stock') {
      var lastV = S.market.live && S.market.live[def.id] ? S.market.live[def.id].v : 0; /* 今日累计成交量 */
      info = '<div class="stat-grid">' +
        '<div class="kv"><span>最新价</span><b>¥' + series.price.toFixed(2) + '</b></div>' +
        '<div class="kv"><span>总股本</span><b>' + U.compact(def.totalShares, 1) + '股</b></div>' +
        '<div class="kv"><span>流通盘</span><b>' + U.compact(def.float, 1) + '股（' + Math.round(def.floatRatio * 100) + '%）</b></div>' +
        '<div class="kv"><span>流通市值</span><b>' + U.money(BT.Market.floatCap(def, series.price)) + '</b></div>' +
        '<div class="kv"><span>总市值</span><b>' + U.money(BT.Market.totalCap(def, series.price)) + '</b></div>' +
        '<div class="kv"><span>规模 / 换手率</span><b>' + def.tier + ' / ' + (lastV ? (lastV / def.float * 100).toFixed(2) + '%' : '-') + '</b></div></div>' +
        '<div class="hint">流通盘越小，股价波动越大，大额买卖对价格的冲击也越明显。</div>';
      var bt = bookHtml(S, def); book = bt.book; tapeHtml = bt.tape;
      var rep = series.financials[series.financials.length - 1];
      if (rep) info += '<div class="hint" style="margin-top:6px">最新季报（第' + rep.day + '天）：营收 ' + U.compact(rep.revenue) +
        '（' + U.pct(rep.revenueGrowth) + '）· 净利 ' + U.compact(rep.profit) + ' · EPS ' + rep.eps.toFixed(2) + '</div>';
      trade = tradePanelStock(S, def, series);
    } else if (marketTab === 'future') {
      var ct = series.ct, left = ct.expiry - S.day, mr = BT.Market.marginRateOf(S, 'fut', def.id, ct.code);
      info = '<div class="stat-grid">' +
        '<div class="kv"><span>主力 ' + ct.code + '</span><b>' + series.price.toFixed(2) + ' ' + def.unit + '</b></div>' +
        '<div class="kv"><span>次月 ' + ct.next + '</span><b>' + BT.Market.futPx(S, def.id, ct.next).toFixed(2) + '（' + (def.basis >= 0 ? '升水 ' : '贴水 ') + Math.abs(def.basis * 100).toFixed(1) + '%）</b></div>' +
        '<div class="kv"><span>主力到期</span><b class="' + (left <= 5 ? 'down' : '') + '">' + U.dateOf(ct.expiry).short + '（' + (left <= 0 ? '今天' : left + ' 天后') + '）</b></div>' +
        '<div class="kv"><span>合约乘数</span><b>×' + def.mult + '</b></div>' +
        '<div class="kv"><span>保证金率</span><b>' + (mr * 100).toFixed(1) + '%' + (mr > def.marginRate ? '（临近到期上调）' : '') + '</b></div></div>';
      trade = tradePanelFutures(S, def, series);
    } else {
      var rr = S.market.rates || BT.Market.RATES0;
      info = '<div class="stat-grid">' +
        '<div class="kv"><span>最新汇率</span><b>' + series.price.toFixed(4) + '</b></div>' +
        '<div class="kv"><span>合约单位</span><b>' + def.lot + '</b></div>' +
        '<div class="kv"><span>保证金率</span><b>' + (def.marginRate * 100) + '%</b></div>' +
        '<div class="kv"><span>利差（外币−HGD）</span><b>' + (((rr[def.id] || 0) - rr.hgd) * 100).toFixed(2) + '%</b></div>' +
        '<div class="kv"><span>隔夜利息 多/空（每手每天）</span><b>' + BT.Market.swapPerLot(S, def.id, 1).toFixed(2) + ' / ' + BT.Market.swapPerLot(S, def.id, -1).toFixed(2) + '</b></div></div>';
      trade = tradePanelForex(S, def, series);
    }
    var keep = {}; ['trade-qty', 'trade-price'].forEach(function (k) { var el = $(k); if (el && el.getAttribute('data-instr') === def.id) keep[k] = el.value; });
    $('instr-info').innerHTML = info;
    $('instr-book').innerHTML = book;
    $('instr-tape').innerHTML = tapeHtml || '<div class="hint">仅股票有逐笔成交。</div>';
    $('instr-trade').innerHTML = trade;
    ['trade-qty', 'trade-price'].forEach(function (k) { var el = $(k); if (!el) return; el.setAttribute('data-instr', def.id); if (keep[k] !== undefined) el.value = keep[k]; });
  }
  function tradePanelStock(S, def, series) {
    var pos = S.market.posStock[def.id], orders = (S.market.orders || []).filter(function (o) { return o.id === def.id; });
    return '<div class="trade-row"><input type="number" id="trade-qty" value="100" min="1" title="数量（股）">' +
      '<input type="number" id="trade-price" step="0.01" min="0" placeholder="价格（留空=市价）" title="限价：买入不高于、卖出不低于该价才成交，未成交部分挂单到收盘">' +
      '<button class="primary" onclick="BT.App.marketBuyStock()">买入</button>' +
      '<button onclick="BT.App.marketSellStock()">卖出</button></div>' +
      '<div class="trade-row"><button class="small" onclick="BT.App.pickPrice(' + series.price.toFixed(2) + ')">最新价</button>' +
      '<button class="small" onclick="BT.App.pickPrice(' + BT.Market.book(S, def.id).asks[0].p.toFixed(2) + ')">卖一</button>' +
      '<button class="small" onclick="BT.App.pickPrice(' + BT.Market.book(S, def.id).bids[0].p.toFixed(2) + ')">买一</button>' +
      '<button class="small" onclick="BT.App.pickPrice(0)">市价</button></div>' +
      '<div class="hint" style="margin-top:6px">价格留空 = 市价单，按盘口逐档成交；填价格 = 限价单，成交不了的部分挂单（当日有效，价格触及时自动成交）。手续费：佣金 0.03%（最低¥5），卖出另收印花税 0.1%。</div>' +
      (orders.length ? '<div class="hint" style="margin-top:6px">📋 我的挂单</div>' + orders.map(function (o) {
        return '<div class="kv"><span>' + (o.side === 'buy' ? '买入' : '卖出') + ' ' + o.left + '股 @' + o.price.toFixed(2) + '</span><b><button class="small" onclick="BT.App.cancelOrder(\'' + o.oid + '\')">撤单</button></b></div>';
      }).join('') : '') +
      (pos ? '<div class="hint" style="margin-top:8px">持仓 ' + pos.qty + ' 股，成本 ¥' + pos.cost.toFixed(2) + '，浮动盈亏 ' + U.money((series.price - pos.cost) * pos.qty) + '</div>' : '');
  }
  /* 期货 / 外汇通用交易面板：说明开多/开空逻辑、显示最大可开手数、持仓明细（方向/均价/保证金/浮盈/强平价）与平仓 */
  function levPanel(S, def, series, kind) {
    var fut = kind === 'fut', pos = fut ? S.market.posFut[def.id] : S.market.posFx[def.id];
    var L = fut ? { l: '开多', s: '开空', ln: '多', sn: '空', dp: 2, open: 'marketOpenFutures', close: 'marketCloseFutures', mult: def.mult }
                : { l: '买入', s: '卖出', ln: '买', sn: '卖', dp: 4, open: 'marketOpenForex', close: 'marketCloseForex', mult: def.lot };
    var useNext = fut && $('fut-ct') && $('fut-ct').value === 'next';
    var mr = BT.Market.marginRateOf(S, kind, def.id, fut ? (useNext ? series.ct.next : series.ct.code) : null);
    var maxLots = BT.Market.maxLots(S, kind, def.id, useNext), per = (fut ? BT.Market.futPx(S, def.id, useNext ? series.ct.next : series.ct.code) : series.price) * L.mult * mr;
    var html = (fut ? '<div class="trade-row" style="grid-template-columns:auto 1fr"><span class="hint" style="align-self:center">交易合约</span><select id="fut-ct" onchange="BT.Render.market()">' +
        '<option value="main"' + (useNext ? '' : ' selected') + '>主力 ' + series.ct.code + '（' + Math.max(0, series.ct.expiry - S.day) + '天到期）</option>' +
        '<option value="next"' + (useNext ? ' selected' : '') + '>次月 ' + series.ct.next + '</option></select></div>' : '') +
      '<div class="trade-row"><input type="number" id="trade-qty" value="1" min="1" title="手数">' +
      '<button class="good" onclick="BT.App.' + L.open + '(\'long\')">' + L.l + '（看涨）</button>' +
      '<button class="danger" onclick="BT.App.' + L.open + '(\'short\')">' + L.s + '（看跌）</button></div>' +
      '<div class="hint" style="margin-top:6px">每手保证金 ' + U.money(per) + '（杠杆 ' + Math.round(1 / mr) + ' 倍），按现金最多可开 ' + maxLots + ' 手。' +
      L.l + '：涨了赚、跌了亏；' + L.s + '：跌了赚、涨了亏。盈亏 = 方向 ×（平仓价−开仓价）× ' + L.mult + ' × 手数。反向下单会先平掉已有持仓；开平仓各有半个买卖价差和每手手续费。</div>';
    if (pos) {
      var p = BT.Market.portfolio(S)[fut ? 'futures' : 'forex'].filter(function (x) { return x.id === def.id; })[0];
      var long = pos.qty > 0, n = Math.abs(pos.qty);
      html += '<div class="kv" style="margin-top:8px"><span>持仓方向</span><b>' + (long ? L.ln + '单（看涨）' : L.sn + '单（看跌）') + ' ' + n + ' 手</b></div>' +
        '<div class="kv"><span>开仓均价 / 最新价</span><b>' + p.cost.toFixed(L.dp) + ' / ' + series.price.toFixed(L.dp) + '</b></div>' +
        '<div class="kv"><span>占用保证金 / 当前权益</span><b>' + U.money(pos.margin) + ' / ' + U.money(p.equity) + '</b></div>' +
        '<div class="kv"><span>累计浮动盈亏</span><b style="color:' + (p.pnl >= 0 ? '#46c47e' : '#ff6b63') + '">' + U.money(p.pnl) + '</b></div>' +
        '<div class="kv"><span>强平价（约）</span><b>' + p.liq.toFixed(L.dp) + '</b></div>' +
        (fut ? '<div class="kv"><span>持仓合约</span><b>' + (pos.ct || series.ct.code) + (pos.ct === series.ct.code && series.ct.expiry - S.day <= 5 ? ' <span class="tag down">即将到期</span>' : '') + '</b></div>' : '') +
        (!fut ? '<div class="kv"><span>累计隔夜利息</span><b class="' + ((pos.swap || 0) >= 0 ? 'up' : 'down') + '">' + U.money(pos.swap || 0) + '</b></div>' : '') +
        '<div class="trade-row" style="margin-top:6px"><button class="small" onclick="BT.App.' + L.close + '(true)">全部平仓</button>' +
        '<button class="small" onclick="BT.App.' + L.close + '(false)">按上面手数平仓</button>' +
        (fut && pos.ct !== series.ct.next ? '<button class="small primary" onclick="BT.App.marketRollFutures()" title="平主力、开次月">🔁 换月到 ' + series.ct.next + '</button>' : '') + '</div>';
    }
    return html;
  }
  function tradePanelFutures(S, def, series) { return levPanel(S, def, series, 'fut'); }
  function tradePanelForex(S, def, series) { return levPanel(S, def, series, 'fx'); }
  function renderPortfolio(S) {
    var pf = BT.Market.portfolio(S);
    var html = '';
    if (pf.stocks.length) html += '<div class="hint">股票持仓</div>' + pf.stocks.map(function (p) {
      return '<div class="kv"><span>' + p.name + ' x' + p.qty + '</span><b style="color:' + (p.pnl >= 0 ? '#46c47e' : '#ff6b63') + '">' + U.money(p.pnl) + '</b></div>';
    }).join('');
    if (pf.futures.length) html += '<div class="hint">期货持仓</div>' + pf.futures.map(function (p) {
      return '<div class="kv"><span>' + p.name + (p.ct ? ' ' + p.ct : '') + ' ' + (p.qty > 0 ? '多' : '空') + Math.abs(p.qty) + '手 · 强平价 ' + p.liq.toFixed(2) + '</span><b style="color:' + (p.pnl >= 0 ? '#46c47e' : '#ff6b63') + '">' + U.money(p.pnl) + '</b></div>';
    }).join('');
    if (pf.forex.length) html += '<div class="hint">外汇持仓</div>' + pf.forex.map(function (p) {
      return '<div class="kv"><span>' + p.name + ' ' + (p.qty > 0 ? '买' : '卖') + Math.abs(p.qty) + '手</span><b style="color:' + (p.pnl >= 0 ? '#46c47e' : '#ff6b63') + '">' + U.money(p.pnl) + '</b></div>';
    }).join('');
    $('mkt-portfolio').innerHTML = html || '<div class="hint">暂无持仓</div>';
  }

  /* ========================================================================
   * 十、任务与成就
   * ===================================================================== */
  R.quests = function () {
    var S = BT.S; if (!S) return; BT.Quests.init(S);
    var cur = BT.Quests.chainInfo(S);
    $('quest-chain').innerHTML = cur ? ('<div class="item-row"><span class="icon">📋</span><div><div class="name">' + cur.name +
      '</div><div class="sub">' + cur.desc + ' · 奖励 ¥' + cur.reward + '</div></div></div>') : '<div class="hint">新手任务链已全部完成！</div>';
    $('quest-commission').innerHTML = S.commission ? ('<div class="item-row"><span class="icon">✨</span><div><div class="name">' +
      S.commission.name + '</div><div class="sub">' + S.commission.desc + ' · 奖励 ¥' + S.commission.reward + '</div></div></div>') : '<div class="hint">暂无委托，达成里程碑1后会定期刷新。</div>';
    renderEndings(S); renderStats(S);
    $('quest-ach').innerHTML = BT.Quests.allAchievements().map(function (a) {
      var done = S.achievements[a.id];
      return '<div class="tag ' + (done ? 'up' : '') + '" style="margin:3px">' + (done ? '🎖️' : '🔒') + ' ' + a.name + '</div>';
    }).join('');
  };

  /* ========================================================================
   * 十一、存档
   * ===================================================================== */
  R.saveTab = function () {
    var box = $('save-slots'); if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && !R._force) return;
    var html = '<div class="slot-grid">';
    for (var i = 0; i < BT.SLOT_COUNT; i++) {
      var info = BT.slotInfo(i);
      html += '<div class="save-slot' + (info ? '' : ' empty') + '"><div class="ss-head"><b>#' + (i + 1) + '</b> ' + (info ? escapeHtml(info.label || '存档 ' + (i + 1)) : '<span class="hint">空槽位</span>') + '</div>' +
        (info ? '<div class="sub">第' + info.day + '天 · 阶段' + info.phase + ' · ' + (C.DIFFICULTY[info.diff] || {}).name + (info.shops ? ' · ' + info.shops + '店' : '') + '</div>' +
          '<div class="sub">净资产 <b>' + U.money(info.net) + '</b>' + (info.cheated ? ' <span class="tag down">调试</span>' : '') + (info.challenge ? ' <span class="tag">挑战</span>' : '') + '</div>' +
          '<div class="hint">' + BT.App.timeAgo(info.time) + '</div>' : '') +
        '<input type="text" id="slot-label-' + i + '" maxlength="16" placeholder="存档名（可选）" value="' + (info && info.label ? escapeHtml(info.label) : '') + '">' +
        '<div class="ss-btns"><button class="small primary" onclick="BT.App.saveToSlot(' + i + ')">' + (info ? '覆盖' : '保存') + '</button>' +
        (info ? '<button class="small" onclick="BT.App.loadFromSlot(' + i + ')">读取</button><button class="small danger" onclick="BT.App.deleteSlot(' + i + ')">删除</button>' : '') + '</div></div>';
    }
    html += '</div>';
    var bk = BT.backupInfo && BT.backupInfo();
    if (bk) html += '<div class="item-row" style="margin-top:8px"><span class="icon">⏪</span><div><div class="name">自动备份（前一天）</div><div class="sub">第' + bk.day + '天 · 净资产 ' + U.money(bk.net) + '</div></div><div class="spacer"></div><button class="small" onclick="BT.App.loadBackup()">回到这一天</button></div>';
    box.innerHTML = html;
  };

  /* ========================================================================
   * 十二、总渲染入口
   * ===================================================================== */
  /* 结局遮罩：破产（只能重开）/ 通关（可继续玩） */
  R.ending = function () {
    var S = BT.S, mask = document.getElementById('ending-mask');
    var go = S.gameOver, eid = (S.endingQueue && S.endingQueue[0]) || null;
    var key = go ? 'go' + go.type : (eid ? 'e' + eid : null);
    if (!key) { if (mask) mask.remove(); return; }
    if (mask && mask.getAttribute('data-key') === key) return;
    if (mask) mask.remove();
    mask = document.createElement('div'); mask.id = 'ending-mask'; mask.className = 'modal-mask'; mask.setAttribute('data-key', key);
    var n = U.keys(S.endings || {}).length, total = U.keys(C.ENDINGS).length, html;
    if (go && go.type === 'challenge') {
      html = '<h2>📅 每日挑战结束</h2><p>' + S.challenge.date + ' 的 ' + C.DAILY_CHALLENGE_DAYS + ' 天挑战完成！最终净资产 <b>' + U.money(go.score) + '</b>' +
        (S.cheated ? '（使用过调试后门，成绩不计入纪录）' : '，今日最佳 ' + U.money(go.best)) + '。</p><div class="modal-actions"><button class="primary" onclick="BT.App.restart()">开始新游戏</button></div>';
    } else if (go) {
      html = '<h2>💀 破产了</h2><p>你在第 ' + go.day + ' 天宣告破产，累计盈利 ' + U.money(S.stats.totalEarned) + '。</p><p class="hint">小贴士：控制进货量，别让贷款利息吃掉利润。</p><div class="modal-actions"><button class="primary" onclick="BT.App.restart()">重新开始</button></div>';
    } else {
      var e = C.ENDINGS[eid];
      html = '<h2>' + e.icon + ' 结局达成：' + e.name + '</h2><p>' + e.desc + '</p><p class="hint">第 ' + S.endings[eid] + ' 天达成 · 已收集结局 ' + n + '/' + total + '</p>' +
        '<div class="modal-actions"><button class="primary" onclick="BT.App.keepPlaying()">继续经营</button><button onclick="BT.App.restart()">再开一局</button></div>';
      if (BT.Audio) BT.Audio.sfx('win');
    }
    mask.innerHTML = '<div class="modal-box">' + html + '</div>';
    document.body.appendChild(mask);
  };

  /* 新手引导条：根据进度给出下一步建议，可关闭 */
  R.guide = function () {
    var S = BT.S, el = $('guide-bar'); if (!el) return;
    var msg = null;
    var cur = BT.Quests.chainInfo(S);
    if (cur) msg = '📋 当前任务「' + cur.name + '」：' + cur.desc + '（奖励 ¥' + cur.reward + '）';
    else if (!S.milestones.m1) msg = '🎯 目标：先攒够第一笔资金，把货倒卖出去，再解锁更多区域。';
    else if (!S.stall && !S.shop && !S.biz) msg = '🎯 下一步：在老街/批发市场摆摊，用买卖差价赚钱。';
    else if (!S.biz) msg = '🎯 下一步：净资产达到 ¥10,000 即成立公司，进入「商业扩张」。';
    else if (S.biz.shops.length < 3) msg = '🎯 下一步：开更多分店（目前 ' + S.biz.shops.length + '/3），记得招店员并用「一键补货」。';
    else if (S.phase < 3 || !BT.Empire.unlocked(S)) msg = '🎯 下一步：净资产 ≥ ' + U.money(BT.Empire.GATE.minNet) + ' 解锁「资本帝国」：并购、房地产、慈善。';
    else msg = '🎯 冲刺目标：净资产 ' + U.money(C.VICTORY_NET) + '，或去收集更多结局（见「任务」页）。';
    if (S.cash < 0) msg = '⚠️ 现金为负！先去打工或卖掉库存，连续资不抵债会破产。';
    var key = msg.slice(0, 12);
    if (S.guideHidden === key) { el.style.display = 'none'; return; }
    el.style.display = ''; el.innerHTML = '<span>' + msg + '</span><button class="small" onclick="BT.App.hideGuide()">知道了</button>';
    el.setAttribute('data-key', key);
  };

  /* 统计：净资产走势 / 收入构成 / 各店利润 */
  function renderStats(S) {
    var hist = (S.netHist || []).slice(-90);
    if ($('netChart')) BT.Chart.drawLine($('netChart'), hist.map(function (h) { return { v: h.v != null ? h.v : h, label: h.day != null ? h.day : '' }; }), { color: '#6fd0ff' });
    var inc = S.stats.income || {}, tot = U.sum(U.keys(inc), function (k) { return inc[k]; }) || 1;
    $('income-bars').innerHTML = U.keys(inc).sort(function (a, b) { return inc[b] - inc[a]; }).map(function (k) {
      var pc = Math.round(inc[k] / tot * 100);
      return '<div class="kv"><span>' + (BT.Eco.CAT_NAMES[k] || k) + '</span><b>' + U.money(inc[k]) + ' · ' + pc + '%</b></div><div class="progress-track"><div class="progress-fill" style="width:' + pc + '%"></div></div>';
    }).join('') || '<div class="hint">还没有收入记录。</div>';
    $('shop-profit').innerHTML = (S.biz && S.biz.shops.length) ? S.biz.shops.map(function (sh) {
      return '<div class="kv"><span>' + C.regionMap[sh.regionId].icon + C.regionMap[sh.regionId].name + '</span><b>' + U.money(sh.profitTotal || 0) + '（营收 ' + U.money(sh.revTotal || 0) + '）</b></div>';
    }).join('') : '<div class="hint">开店后显示。</div>';
  }
  function renderEndings(S) {
    $('quest-endings').innerHTML = U.keys(C.ENDINGS).map(function (id) {
      var e = C.ENDINGS[id], d = S.endings && S.endings[id];
      return '<div class="item-row"><span class="icon">' + (d ? e.icon : '🔒') + '</span><div><div class="name">' + (d ? e.name : '？？？') + '</div><div class="sub">' + (d ? '第' + d + '天达成' : e.desc) + '</div></div></div>';
    }).join('');
  }

  R.all = function () {
    if (!BT.S) return;
    R.topbar(); R.sidebar(); R.bag(); R.log(); R.ending(); R.guide();
    var active = document.querySelector('.tabpage.active');
    if (!active) return;
    var id = active.id;
    if (id === 'tab-map') R.map();
    else if (id === 'tab-trade') R.trade();
    else if (id === 'tab-jobs') R.jobs();
    else if (id === 'tab-stall') R.stall();
    else if (id === 'tab-shop') R.shop();
    else if (id === 'tab-biz') R.biz();
    else if (id === 'tab-market') R.market();
    else if (id === 'tab-quests') R.quests();
    else if (id === 'tab-save') R.saveTab();
  };

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
})();
