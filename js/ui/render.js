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
        hawkerBox(S, st) +
        '<div style="margin:10px 0"><input type="range" min="0.7" max="1.8" step="0.05" value="' + st.markup +
        '" oninput="BT.App.setStallMarkup(this.value)" style="width:100%"></div>' +
        '<div class="grid cols-3">' +
        '<button class="primary" ' + (here ? '' : 'disabled') + ' onclick="BT.App.stallRun()">营业一轮(2h)</button>' +
        '<button onclick="BT.App.stallUpgrade()">升级摊位</button>' +
        '<button class="danger" onclick="BT.App.stallClose()">收摊</button></div></div>';
    }
  };
  /** 摆摊：附近散户摊贩概况 */
  function hawkerBox(S, st) {
    if (!BT.Hawkers) return '';
    var g = C.goodsMap[st.goodsId], price = BT.Eco.sellPrice(S, st.goodsId, st.regionId) * st.markup;
    var f = BT.Hawkers.factor(S, st.regionId, st.goodsId, price), info = BT.Hawkers.info(S, st.regionId);
    var cut = info.cuts.filter(function (c) { return c.gid === st.goodsId; })[0];
    return '<div class="hawk-box"><div class="kv"><span>🧺 附近摊贩</span><b>' + info.n + ' 家' + (f.n ? '（约 ' + Math.max(1, Math.round(f.n)) + ' 家卖' + g.name + '）' : '（没人卖' + g.name + '）') + '</b></div>' +
      (f.n ? '<div class="kv"><span>他们卖 / 你卖</span><b class="' + (price > f.price ? 'down' : 'up') + '">¥' + f.price.toFixed(2) + ' / ¥' + price.toFixed(2) + '</b></div>' +
      '<div class="kv"><span>被分走的客人</span><b class="' + (f.mul < 0.8 ? 'down' : '') + '">约 ' + Math.round((1 - f.mul) * 100) + '%</b></div>' : '') +
      (cut ? '<div class="hint down">🔻 有人在甩卖' + g.name + '（便宜 ' + Math.round(cut.v * 100) + '%，还剩 ' + cut.left + ' 天）</div>' : '') +
      (info.follow && info.follow.gid === st.goodsId ? '<div class="hint down">👀 有人看你赚钱在跟风卖同款</div>' : '') + '</div>';
  }
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
  var bizTab = 'dash';
  R.setBizTab = function (t) { bizTab = t; };
  R.getBizTab = function () { return bizTab; };
  var BIZ_TABS = [['dash', '📈 仪表盘'], ['shops', '🏬 门店'], ['talent', '🧑‍💼 人才'], ['supply', '🚚 供应链'], ['promo', '📣 营销保险'], ['rivals', '🥊 竞争'], ['finance', '📊 财务'], ['ipo', '🔔 上市'], ['expand', '🌐 拓展'], ['empire', '🌍 帝国']];
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
        if (t[0] === 'ipo' && BT.IPO && S.ipo && S.ipo.status === 'review') dot = ' <span class="tag">审核中</span>';
        else if (t[0] === 'ipo' && BT.IPO && (!S.ipo || S.ipo.status !== 'listed') && BT.IPO.eligible(S)) dot = ' <span class="tag up">可申请</span>';
        return '<button class="' + (bizTab === t[0] ? 'active' : '') + '" onclick="BT.App.bizTab(\'' + t[0] + '\')">' + t[1] + dot + '</button>';
      }).join('') + '</div></div>';
    /* 重绘前记下页面里所有输入框 / 下拉框的值，重绘后按 id 填回去（否则每次刷新下拉框都会跳回第一项） */
    var keep = {};
    Array.prototype.forEach.call(box.querySelectorAll('input[id], select[id]'), function (el) { keep[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
    html += dealsCard(S);
    if (bizTab === 'dash') html += dashTab(S);
    else if (bizTab === 'shops') html += shopsTab(S);
    else if (bizTab === 'talent') html += talentTab(S);
    else if (bizTab === 'supply') html += supplyTab(S);
    else if (bizTab === 'rivals') html += rivalsTab(S);
    else if (bizTab === 'finance') html += financeTab(S);
    else if (bizTab === 'ipo') html += ipoTab(S);
    else if (bizTab === 'promo') html += promoTab(S);
    else if (bizTab === 'expand') html += expandTab(S);
    else html += empireTab(S);
    box.innerHTML = html;
    U.keys(keep).forEach(function (id) {
      var el = document.getElementById(id); if (!el || R._resetIds && R._resetIds[id]) return;
      if (el.type === 'checkbox') el.checked = keep[id];
      else if (el.tagName === 'SELECT') { if (Array.prototype.some.call(el.options, function (o) { return o.value === keep[id]; })) el.value = keep[id]; }
      else if (!/^markup-/.test(id)) el.value = keep[id]; /* 改价框显示的是实际售价倍率，不回填旧输入 */
    });
    R._resetIds = null;
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
    var html = managerCard(S) + '<div class="card"><h3>🏬 门店 <span class="spacer"></span><button class="small primary" onclick="BT.App.autoRestock()">📦 一键补货</button></h3>' +
      (biz.shops.length ? biz.shops.map(function (shop) { return bizShopCard(S, shop); }).join('') : '<div class="hint">还没有门店，在下面选个位置开第一家吧。</div>') + '</div>';
    var free = S.unlockedRegions.filter(function (rid) { return !biz.shops.some(function (s) { return s.regionId === rid; }); });
    if (free.length) {
      html += '<div class="card"><h3>📍 选址开新店</h3><div class="desc">同一区域不同地段：租金、装修和路过客流差别很大。预估按 2 名员工、当前竞争格局计算。</div>' +
        '<div class="site-grid">' + free.map(function (rid) {
          var r = C.regionMap[rid];
          return '<div class="site-card"><b>' + r.icon + ' ' + r.name + '</b><div class="hint">对手：' + ((biz.competitors[rid] || {}).name || '暂无') + ' · 一周客流 ' + weekSpark(C.WEEK_TRAFFIC[rid]) + '</div><div class="hint">' + regionTaste(rid) + '</div>' +
            C.LOCATIONS.map(function (l) {
              var f = B.siteForecast(S, rid, l.id), tk = l.id === 'corner' && BT.Rivals && BT.Rivals.cornerTaken ? BT.Rivals.cornerTaken(S, rid) : null;
              if (tk) return '<div class="site-opt"><span>' + l.icon + l.name + '</span><span class="hint down">被 ' + ((BT.Rivals.get(S, tk.by) || {}).name || '对手') + ' 占了（' + (tk.until - S.day + 1) + '天）</span><button class="small" disabled>—</button></div>';
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
    var relocLeft = shop.relocDay != null ? shop.relocDay + B.RELOC_COOLDOWN - S.day : 0;
    var war = BT.Rivals && BT.Rivals.alive(S).filter(function (rv) { return rv.war[shop.regionId] > 0; })[0];
    var thr = BT.Rivals ? BT.Rivals.threats(S).filter(function (t) { return t.rid === shop.regionId; }) : [];
    var empRows = shop.employees.map(function (e) {
      var fair = B.fairWage(e), tr = C.traitMap[e.trait] || {}, low = e.wage < fair * 0.95;
      return '<tr><td><b>' + e.name + '</b> <span class="tag">' + B.roleOf(e.role).name + '</span>' + (tr.name && tr.id !== 'plain' ? ' <span class="tag" title="' + (tr.desc || '') + '">' + tr.name + '</span>' : '') + (e.offDuty ? ' <span class="tag down">培训中</span>' : '') + '</td>' +
        '<td>' + stars(e.skill) + '</td><td>' + stars(e.service) + '</td>' +
        '<td><span class="loy" style="--v:' + Math.round(e.loyalty) + '%"></span> ' + Math.round(e.loyalty) + '</td>' +
        '<td' + (low ? ' class="down" title="低于身价 ' + U.money(fair) + '，忠诚度会下降"' : '') + '>' + U.money(e.wage) + (low ? '↓' : '') + '</td>' +
        '<td class="emp-act"><button class="small" title="销售培训 ' + U.money(B.trainCost(e, 'sales')) + '" ' + (e.skill >= 5 || e.offDuty ? 'disabled' : '') + ' onclick="BT.App.bizTrain(\'' + shop.id + '\',\'' + e.id + '\',\'sales\')">🗣️' + U.money(B.trainCost(e, 'sales')) + '</button>' +
        '<button class="small" title="服务培训 ' + U.money(B.trainCost(e, 'service')) + '" ' + (e.service >= 5 || e.offDuty ? 'disabled' : '') + ' onclick="BT.App.bizTrain(\'' + shop.id + '\',\'' + e.id + '\',\'service\')">🤝' + U.money(B.trainCost(e, 'service')) + '</button>' +
        '<button class="small" title="加薪 10%，忠诚 +12" onclick="BT.App.bizRaise(\'' + shop.id + '\',\'' + e.id + '\')">💴</button>' +
        (BT.IPO && BT.IPO.listed(S) ? (e.equity ? '<span class="tag up" title="持有公司股票，挖不走">📜</span>' : '<button class="small" title="股权激励：授予 0.5% 公司股票，忠诚拉满、挖不走" onclick="BT.App.grantEquity(\'' + shop.id + '\',\'' + e.id + '\')">📜</button>') : '') +
        '<button class="small danger" title="解雇" onclick="BT.App.bizFire(\'' + shop.id + '\',\'' + e.id + '\')">✕</button></td></tr>';
    }).join('');
    return '<div class="shop-card">' +
      '<div class="shop-top"><b>' + region.icon + region.name + '</b> <span class="tag">' + loc.icon + loc.name + '</span>' + (shop.promoDays > 0 ? ' <span class="tag up">促销中 ' + shop.promoDays + '天</span>' : '') +
      (war ? ' <span class="tag down">' + (war.camp[shop.regionId] && war.camp[shop.regionId].mode === 'predatory' ? '🩸 ' + war.name + ' 掠夺定价 ' : '⚔️ ' + war.name + ' 价格战 ') + war.war[shop.regionId] + '天</span>' : '') +
      thr.filter(function (t) { return t.kind === 'plan'; }).map(function (t) { return ' <span class="tag warn">📡 ' + t.rv.name + ' 准备动手</span>'; }).join('') +
      (shop.match ? ' <span class="tag up">🛡️ 自动应战</span>' : '') +
      (shop.hike && shop.hike.until >= S.day ? ' <span class="tag down">🏚️ 被抬租 +' + Math.round((shop.hike.mul - 1) * 100) + '%（' + (shop.hike.until - S.day + 1) + '天）</span>' : '') +
      (shop.closedDays > 0 ? ' <span class="tag down">🚧 停业 ' + shop.closedDays + ' 天</span>' : '') +
      (shop.strike > 0 ? ' <span class="tag down">✊ 罢工中 ' + shop.strike + ' 天</span> <button class="small" onclick="BT.App.settleStrike(\'' + shop.id + '\')">加薪平息</button>' : '') +
      (shop.memberProg ? ' <span class="tag up">💳 会员 ' + Math.round(shop.members || 0) + '</span>' : '') +
      '<span class="spacer"></span><span class="sub">' + (S.estate && S.estate[shop.regionId] ? '<span class="tag up">🏠 自有物业·免租</span>' : '日租 ' + U.money(shop.rent)) + ' · 估值 ' + U.money(shop.value) + '</span></div>' +
      '<div class="shop-kpi">' +
      kpi('口碑', Math.round(shop.reputation)) + kpi('昨日到店', last.customers != null ? last.customers : '-') + kpi('成交', last.buyers != null ? last.buyers : '-') +
      kpi('缺货流失', last.lost != null ? last.lost : '-', last.lost > (last.customers || 0) * 0.2 ? 'down' : '') +
      kpi('昨日净利', last.profit != null ? U.money(last.profit) : '-', last.profit < 0 ? 'down' : 'up') +
      kpi('竞争系数', shop.cf != null ? Math.round(shop.cf * 100) + '%' : '-') +
      '<div class="kpi wide"><span>近10天客流</span>' + trafficBars(shop) + '</div></div>' +
      '<div class="hint taste">' + regionTaste(shop.regionId) + '</div>' + diagBox(S, shop) +
      '<div class="tbl-wrap"><table class="datatable emp-table"><tr><th>员工 ' + shop.employees.length + '/' + cap + '</th><th>销售</th><th>服务</th><th>忠诚</th><th>日薪</th><th></th></tr>' +
      (empRows || '<tr><td colspan="6" class="hint">没有员工，客流只有三成多。去「人才」页签人，或在下面直接招一个普通员工。</td></tr>') + '</table></div>' +
      '<div class="shop-actions"><select id="role-' + shop.id + '">' + B.EMP_ROLES.map(function (r) { return '<option value="' + r.id + '">' + r.name + '（日薪¥' + r.wageBase + '）</option>'; }).join('') + '</select>' +
      '<button class="small" onclick="BT.App.bizHire(\'' + shop.id + '\')">直接招人</button>' +
      '<button class="small good" ' + (shop.promoDays > 0 ? 'disabled' : '') + ' onclick="BT.App.bizPromote(\'' + shop.id + '\')">📣 促销 ' + U.money(B.promoCost(shop)) + '</button>' +
      (relocLeft > 0 ? '<span class="hint" style="align-self:center">刚搬到' + loc.name + '，' + relocLeft + ' 天后可再搬</span>' :
      '<select id="reloc-' + shop.id + '">' + C.LOCATIONS.filter(function (l) { return l.id !== shop.loc; }).map(function (l) { return '<option value="' + l.id + '">搬到' + l.name + '（' + U.money(Math.round(B.shopCost(shop.regionId, l.id) * 0.6)) + '）</option>'; }).join('') + '</select>' +
      '<button class="small" onclick="BT.App.bizRelocate(\'' + shop.id + '\')">搬迁</button>') +
      (shop.memberProg ? '' : '<button class="small" title="回头客不受对手分流影响" onclick="BT.App.startMembership(\'' + shop.id + '\')">💳 会员 ' + U.money(BT.Biz.MEMBER_COST) + '</button>') +
      '<button class="small' + (shop.match ? ' primary' : '') + '" title="对手打价格战 / 散户甩卖时，被压价的货自动跟到它的价格（最低保本 +2%）；平时不动你的标价。守份额，代价是毛利变薄" onclick="BT.App.bizToggleMatch(\'' + shop.id + '\')">🛡️ 自动应战：' + (shop.match ? '开' : '关') + '</button>' +
      (shop.boutique ? '<span class="tag lux" style="align-self:center">💎 精品专柜</span>' : '<button class="small" title="装修成奢侈品专柜，才能上架奢侈品" onclick="BT.App.makeBoutique(\'' + shop.id + '\')">💎 精品装修 ' + U.money(C.TRADE.boutiqueCost) + '</button>') +
      '<button class="small danger" onclick="BT.App.bizCloseShop(\'' + shop.id + '\')">关店</button></div>' +
      transferRow(S, shop) + shelfRowsBiz(S, shop) + shopStatsBox(S, shop) + '</div>';
  }
  /* 门店诊断（v7.3）：默认只显示结论 + 最要紧的一条，展开看全部 */
  var diagOpen = {};
  R.toggleDiag = function (id) { diagOpen[id] = !diagOpen[id]; };
  function diagBox(S, shop) {
    if (!BT.Biz.diagnose) return '';
    var d = BT.Biz.diagnose(S, shop), open = !!diagOpen[shop.id];
    var G = { good: ['up', '✅ 健康'], thin: ['warn', '⚖️ 勉强保本'], loss: ['down', '🚨 亏损'], 'new': ['', '🆕 新店'] }[d.grade];
    var list = open ? d.items : d.items.filter(function (x) { return x.lv !== 'good'; }).slice(0, 1);
    if (!open && !list.length) list = d.items.slice(0, 1);
    var row = function (x) { return '<div class="diag-item ' + x.lv + '"><span>' + ({ bad: '🔴', warn: '🟡', info: '💡', good: '🟢' }[x.lv] || '•') + ' ' + escapeHtml(x.t) + '</span>' + (x.fix ? '<i>→ ' + escapeHtml(x.fix) + '</i>' : '') + '</div>'; };
    return '<div class="diag-box"><div class="diag-head"><b>🩺 门店诊断</b> <span class="tag ' + G[0] + '">' + G[1] + '</span>' +
      (d.avg ? '<span class="hint">近 ' + Math.min(7, (shop.h7 || []).length) + ' 天日均：营收 ' + U.money(d.avg.rev) + ' · 毛利 ' + U.money(d.avg.gp) + ' · 房租 ' + U.money(d.avg.rent) + ' · 工资 ' + U.money(d.avg.wage) + ' · 净利 <b class="' + (d.avg.net < 0 ? 'down' : 'up') + '">' + U.money(d.avg.net) + '</b></span>' : '') +
      '<span class="spacer"></span>' + (d.items.length > 1 ? '<button class="small" onclick="BT.App.toggleDiag(\'' + shop.id + '\')">' + (open ? '收起' : '全部 ' + d.items.length + ' 条 ▼') + '</button>' : '') + '</div>' +
      list.map(row).join('') + '</div>';
  }
  /* 门店销售统计：每件商品今日 / 近 7 日的销量、营收、毛利 */
  var statsOpen = {};
  R.toggleShopStats = function (id) { statsOpen[id] = !statsOpen[id]; };
  function shopStatsBox(S, shop) {
    var open = !!statsOpen[shop.id];
    var head = '<div class="shop-stats"><button class="small" onclick="BT.App.toggleShopStats(\'' + shop.id + '\')">📊 销售统计 ' + (open ? '▲ 收起' : '▼ 展开') + '</button>';
    if (!open) return head + '</div>';
    var st = BT.Biz.goodsStats(S, shop), G = st.goods;
    var ids = U.keys(G).concat(U.keys(shop.shelf).filter(function (g) { return !G[g]; }));
    if (!ids.length) return head + '<div class="hint">还没有销售记录，过一天就有数据了。</div></div>';
    var rows = ids.map(function (gid) {
      var o = G[gid] || { n7: 0, rev7: 0, cogs7: 0, n1: 0, rev1: 0 };
      return { gid: gid, o: o, gp: o.rev7 - o.cogs7, inv: shop.inventory[gid] || 0 };
    }).sort(function (a, b) { return b.gp - a.gp || b.o.n7 - a.o.n7; });
    var T = { n1: 0, n7: 0, rev7: 0, gp: 0, inv: 0 };
    var body = rows.map(function (r) {
      var g = C.goodsMap[r.gid], o = r.o, perDay = o.n7 / Math.max(1, st.days);
      T.n1 += o.n1; T.n7 += o.n7; T.rev7 += o.rev7; T.gp += r.gp; T.inv += r.inv;
      var cover = perDay > 0 ? r.inv / perDay : null;
      return '<tr><td>' + g.icon + g.name + (shop.shelf[r.gid] ? '' : ' <span class="tag">未上架</span>') + '</td><td>' + o.n1 + '</td><td>' + o.n7 + '</td><td>' + U.money(o.rev7) + '</td>' +
        '<td class="' + (r.gp < 0 ? 'down' : 'up') + '">' + U.money(r.gp) + '</td><td>' + (o.rev7 > 0 ? Math.round(r.gp / o.rev7 * 100) + '%' : '-') + '</td>' +
        '<td>' + (o.n7 ? '¥' + (o.rev7 / o.n7).toFixed(2) : '-') + '</td><td>' + r.inv + '</td>' +
        '<td class="' + (cover != null && cover < 2 ? 'down' : '') + '">' + (cover == null ? (r.inv ? '滞销' : '-') : (cover >= 99 ? '99+' : cover.toFixed(1)) + ' 天') + '</td></tr>';
    }).join('');
    return head + '<div class="tbl-wrap"><table class="datatable stats-table"><tr><th>商品</th><th>今日销量</th><th>近' + st.days + '日销量</th><th>近' + st.days + '日营收</th><th>毛利</th><th>毛利率</th><th>均价</th><th>店内库存</th><th>可卖</th></tr>' + body +
      '<tr class="total"><td>合计</td><td>' + T.n1 + '</td><td>' + T.n7 + '</td><td>' + U.money(T.rev7) + '</td><td class="' + (T.gp < 0 ? 'down' : 'up') + '">' + U.money(T.gp) + '</td><td>' + (T.rev7 > 0 ? Math.round(T.gp / T.rev7 * 100) + '%' : '-') + '</td><td></td><td>' + T.inv + '</td><td></td></tr></table></div>' +
      '<div class="hint">毛利 = 营收 − 进货成本（不含房租工资）。按毛利从高到低排；「可卖」= 店内库存 ÷ 近期日均销量，红色表示快断货。</div></div>';
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
  function demandTag(rid, g) {
    if (g.lux) return '<span class="tag lux" title="奢侈品">💎</span>';
    var d = BT.Eco.demand(BT.S, rid, g.id);
    return d >= 1.2 ? '<span class="tag hot" title="本区热销 ×' + d + '">🔥</span>' : (d <= 0.7 ? '<span class="tag cold" title="本区滞销 ×' + d + '">❄</span>' : '');
  }
  /** 区域客群简介：热销 / 滞销品类 + 价格敏感度 */
  function regionTaste(rid) {
    var t = C.REGION_DEMAND[rid] || {}, hot = [], cold = [];
    U.keys(t).sort(function (a, b) { return t[b] - t[a]; }).forEach(function (g) { if (t[g] >= 1.2) hot.push(C.goodsMap[g].icon + C.goodsMap[g].name); else if (t[g] <= 0.7) cold.push(C.goodsMap[g].icon + C.goodsMap[g].name); });
    var sens = C.REGION_PRICE_SENS[rid] || 1, lr = C.LUX_RATE[rid] || 0;
    return '🔥 ' + (hot.join('、') || '—') + '　❄ ' + (cold.join('、') || '—') + '　💰 价格敏感度 ' + (sens >= 1.3 ? '高（别加价太多）' : (sens <= 0.8 ? '低（可以卖贵）' : '中')) + '　💎 奢侈品客流 ' + (lr >= 0.03 ? '旺' : (lr >= 0.012 ? '一般' : '很少'));
  }
  R.regionTaste = regionTaste;
  /* 货架：已上架 / 店里有库存的商品逐个改价、下架；任何门店（包括空店）都有「上架新商品」一行 */
  /** 货架单品：对手最低价（被点名打价格战的标 ⚔️），跟价中显示实际成交价 */
  function rivalPriceTag(S, shop, gid, price) {
    if (!BT.Rivals) return '';
    var h = BT.Rivals.bestPrice(S, shop, gid); if (!h.best || !h.by) return '';
    var eff = shop.match && shop.effP && shop.effP[gid] && shop.effP[gid] < price - 0.005 ? shop.effP[gid] : 0;
    var cheaper = h.best < (eff || price) - 0.005, lose = shop.hit && shop.hit[gid] ? Math.round((1 - shop.hit[gid]) * 100) : 0;
    return '<span class="sp-rival' + (h.camp ? ' war' : (cheaper ? ' down' : '')) + '" title="同区对手里最便宜的是 ' + h.by.name + '。比你便宜时，价格敏感的顾客会去它那买' + (lose ? '；昨天这件货因此少成交约 ' + lose + '%' : '') + '">' +
      (h.camp ? '⚔️' : (cheaper ? '⚠' : '✓')) + h.by.name + ' ¥' + h.best.toFixed(2) + (eff ? ' · 跟价¥' + eff.toFixed(2) : '') + (lose ? ' · −' + lose + '%' : '') + '</span>';
  }
  function shelfRowsBiz(S, shop) {
    var all = C.GOODS.concat(shop.boutique ? C.LUX : []);
    var rows = C.ALL_GOODS.filter(function (g) { return (shop.inventory[g.id] || 0) > 0 || shop.shelf[g.id]; });
    var off = all.filter(function (g) { return !shop.shelf[g.id]; }).sort(function (a, b) { return (b.lux ? 0.9 : BT.Eco.demand(S, shop.regionId, b.id)) - (a.lux ? 0.9 : BT.Eco.demand(S, shop.regionId, a.id)); });
    var mgrPrice = S.biz.mgr && S.biz.mgr.on && S.biz.mgr.autoPrice;
    var html = rows.length ? '<div class="shelf-grid">' + rows.map(function (g) {
      var inv = shop.inventory[g.id] || 0; var on = shop.shelf[g.id], locked = on && BT.Biz.isLocked(shop, g.id);
      var base = g.lux && BT.Lux ? BT.Lux.officialCost(S, g.id) : BT.Eco.buyPrice(S, g.id, shop.regionId), mk = on || 1.3;
      var cost = (shop.cost && shop.cost[g.id]) || base * 0.9, price = base * mk;
      return '<div class="shelf-item' + (on && inv <= 0 ? ' empty' : '') + (locked ? ' locked' : '') + '">' + demandTag(shop.regionId, g) + g.icon + g.name + ' <b>' + inv + '</b>' + (on ? '' : ' <span class="tag">未上架</span>') +
        ' ×<input type="number" step="0.05" min="0.8" max="2.5" id="markup-' + shop.id + '-' + g.id + '" value="' + mk + '" title="加价系数：售价 = 当天进价 × 系数" oninput="var p=' + base.toFixed(4) + '*this.value;this.nextSibling.innerHTML=\'→¥\'+p.toFixed(2)+\' <i>毛利¥\'+(p-' + cost.toFixed(4) + ').toFixed(1)+\'</i>\'">' +
        '<span class="sp-price" title="当天进价 ¥' + base.toFixed(2) + '，库存成本 ¥' + cost.toFixed(2) + '">→¥' + price.toFixed(2) + ' <i class="' + (price - cost < 0 ? 'down' : '') + '">毛利¥' + (price - cost).toFixed(1) + '</i></span>' +
        (on && !g.lux ? rivalPriceTag(S, shop, g.id, price) : '') +
        '<button class="small" onclick="BT.App.bizSetShelf(\'' + shop.id + '\',\'' + g.id + '\')">' + (on ? '改价' : '上架') + '</button>' +
        (on ? '<button class="small lock-btn' + (locked ? ' on' : '') + '" title="' + (locked ? '已锁定：区域经理不会改这一项，点一下解锁' : '未锁定' + (mgrPrice ? '：区域经理每天会按热度自动调价' : '') + '，点一下锁定') + '" onclick="BT.App.bizToggleLock(\'' + shop.id + '\',\'' + g.id + '\')">' + (locked ? '🔒' : '🔓') + '</button>' : '') +
        (on ? '<button class="small" title="下架（库存退回本区仓库）" onclick="BT.App.bizUnshelf(\'' + shop.id + '\',\'' + g.id + '\')">下架</button>' : '') + '</div>';
    }).join('') + '</div>' + '<div class="hint shelf-tip">售价 = 当天进价 × 系数，进价随行情变动所以售价每天会略有浮动。' + (mgrPrice ? '区域经理开着「自动定价」：🔓 的商品他每天会调，点「改价」或 🔒 后他就不再动。' : '') + '</div>' : '<div class="hint" style="margin-top:6px">这家店货架还是空的：先在下面上架商品，再点「一键补货」（空货架的店一键补货时也会自动照其他门店上架）。</div>';
    if (off.length) html += '<div class="shelf-add"><span class="hint">上架新商品</span><select id="shelf-add-' + shop.id + '">' + off.map(function (g) {
        var dm = BT.Eco.demand(S, shop.regionId, g.id);
        return '<option value="' + g.id + '">' + (g.lux ? '💎' : (dm >= 1.2 ? '🔥' : (dm <= 0.7 ? '❄' : '　'))) + g.icon + g.name + '（进价' + U.money(BT.Eco.buyPrice(S, g.id, shop.regionId)) + (g.lux ? '' : (dm >= 1.2 ? '，本区热销' : (dm <= 0.7 ? '，本区滞销' : ''))) + '）</option>';
      }).join('') + '</select><input type="number" step="0.05" min="0.8" max="2.5" id="shelf-add-mk-' + shop.id + '" value="1.3" title="加价倍率">' +
      '<button class="small primary" onclick="BT.App.bizShelfAdd(\'' + shop.id + '\')">上架</button></div>';
    return html;
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
    html += importCard(S);
    html += '<div class="card"><h3>📄 长期供货合同</h3><div class="desc">锁定当前价的 95%，' + C.SUPPLY.contractDays + ' 天内批发都按锁定价；断供时也优先给你供货。但如果市价下跌，你仍然要按锁定价买 —— 这是对赌。</div>' +
      '<div class="tbl-wrap"><table class="datatable"><tr><th>商品</th><th>当前进价</th><th>锁定价</th><th>状态</th><th></th></tr>' + C.GOODS.map(function (g) {
        var c = Sup && Sup.contract(S, g.id), price = BT.Eco.buyPrice(S, g.id, 'market'), ratio = c ? Sup.contractRatio(S, g.id) : 1;
        return '<tr><td>' + g.icon + g.name + '</td><td>¥' + price.toFixed(2) + '</td><td>' + (c ? '¥' + (price * ratio).toFixed(2) + ' <span class="' + (ratio < 1 ? 'up' : 'down') + '">' + (ratio < 1 ? '省' : '亏') + Math.abs(Math.round((1 - ratio) * 100)) + '%</span>' : '-') + '</td>' +
          '<td>' + (c ? '剩 ' + (c.until - S.day) + ' 天' : '') + '</td><td>' + (c ? '' : '<button class="small" onclick="BT.App.signContract(\'' + g.id + '\')">签约 ' + U.money(Sup.contractFee(g.id)) + '</button>') + '</td></tr>';
      }).join('') + '</table></div></div>';
    var locks = BT.Rivals && S.biz.locks ? U.keys(S.biz.locks).filter(function (g) { return S.biz.locks[g].until >= S.day; }) : [];
    if (locks.length) html = '<div class="card lock-card"><h3>🔒 被锁的货源</h3>' + locks.map(function (g) { var lk = S.biz.locks[g], rv = BT.Rivals.get(S, lk.by) || {};
      return '<div class="kv"><span>' + C.goodsMap[g].icon + C.goodsMap[g].name + '：' + (rv.icon || '') + (rv.name || '对手') + ' 的独家供货</span><b class="down">批发 +' + Math.round((lk.mul - 1) * 100) + '% · 还剩 ' + (lk.until - S.day + 1) + ' 天</b></div>'; }).join('') +
      '<div class="hint">签了长期供货合同的货不受影响；也可以到「竞争」页举报它。</div></div>' + html;
    html += '<div class="card"><h3>📦 仓库与批发</h3>' + warehouseBox(S) + '</div>';
    return html;
  }
  /* ---- 进口贸易（奢侈品）：成本拆解 / 代理权 / 下单（正规 or 水货）/ 在途 ---- */
  function licensePrereq(S) {
    var L = BT.Lux, need = L.LICENSE_BRAND, b = S.biz.brand, bq = S.biz.shops.some(function (sh) { return sh.boutique; });
    var minFee = Math.min.apply(null, C.LUX.map(function (g) { return L.licenseFee(g.id); }));
    function it(ok, txt) { return '<span class="prereq ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✅' : '⬜') + ' ' + txt + '</span>'; }
    return '<div class="prereq-row"><b>正规代理前置条件：</b>' +
      it(b >= need, '品牌声望 ≥' + need + '（当前 ' + b.toFixed(1) + '，看页面顶部「品牌声望」）') +
      it(bq, '至少一家店做了「💎 精品装修」（门店页）') +
      it(S.cash >= minFee, '现金够付代理费（最低 ' + U.money(minFee) + '）') +
      (b < need ? '<div class="hint">涨品牌：门店每天盈利 +0.3、地铁广告 +1、网红带货爆单 +2、政府中标 +1。走水货不需要代理权。</div>' : '') + '</div>';
  }
  function importCard(S) {
    var L = BT.Lux; if (!L) return '';
    var lx = L.ensure(S), T = C.TRADE;
    var rows = C.LUX.map(function (g) {
      var b = L.breakdown(S, g.id), lic = L.license(S, g.id), whTot = U.sum(S.unlockedRegions, function (rid) { return BT.Biz.warehouse(S, rid).goods[g.id] || 0; });
      return '<tr><td>' + g.icon + g.name + '</td><td>' + b.ccy + ' ' + b.fob + ' × ' + b.fx.toFixed(3) + '</td><td>' + U.money(b.cif) + '</td>' +
        '<td class="hint2">' + U.money(b.duty) + ' / ' + U.money(b.vat) + ' / ' + U.money(b.excise) + '</td><td><b>' + U.money(b.total) + '</b></td>' +
        '<td>' + U.money(b.grey) + ' <span class="up">−' + Math.round((1 - b.grey / b.total) * 100) + '%</span></td>' +
        '<td>' + (lic ? '剩 ' + (lic.until - S.day) + ' 天 · 配额 ' + L.quotaLeft(S, g.id) + '/' + lic.quota : (function () { var ck = L.licenseCheck(S, g.id);
          return '<button class="small' + (ck.ok ? ' primary' : '') + '"' + (ck.ok ? '' : ' disabled title="' + ck.msg + '"') + ' onclick="BT.App.buyLicense(\'' + g.id + '\')">代理权 ' + U.money(L.licenseFee(g.id)) + '</button>' + (ck.ok ? '' : '<div class="lic-why">' + ck.short + '</div>'); })()) + '</td>' +
        '<td>' + whTot + '</td></tr>';
    }).join('');
    var transit = L.inTransit(S).map(function (o) {
      var g = C.goodsMap[o.gid];
      return '<div class="kv"><span>' + (o.channel === 'grey' ? '🕶️ 水货 ' : '🚢 正规 ') + g.icon + g.name + ' ×' + o.qty + ' → ' + C.regionMap[o.regionId].name + (o.inspect ? ' <span class="tag">海关查验</span>' : '') + '</span><b>' + (o.arrive - S.day <= 0 ? '今晚到' : (o.arrive - S.day) + ' 天后到') + '</b></div>';
    }).join('');
    var st = lx.stats;
    return '<div class="card"><h3>🌍 进口贸易 · 奢侈品 ' + (lx.festival ? '<span class="tag up">🎁 礼品旺季 买家×2</span>' : '') + (lx.crackdown ? ' <span class="tag down">🛃 海关严打 ' + lx.crackdown + '天</span>' : '') + (lx.dutyAdj ? ' <span class="tag">关税' + (lx.dutyAdj < 0 ? '下调' : '上调') + '5%</span>' : '') + '</h3>' +
      licensePrereq(S) +
      '<div class="desc">奢侈品按外币计价：人民币进价 = 外币价 × 实时汇率（金融页外汇行情）× 税费。只能在「💎 精品装修」过的门店上架，商业街买家最多，星耀集团在的区域会被抢走三成客户。</div>' +
      '<div class="tbl-wrap"><table class="datatable lux-table"><tr><th>商品</th><th>外币价 × 汇率</th><th>完税价格</th><th>关税 / 增值税 / 消费税</th><th>正规到岸</th><th>水货价</th><th>品牌代理</th><th>库存</th></tr>' + rows + '</table></div>' +
      '<div class="lux-order"><select id="imp-goods">' + C.LUX.map(function (g) { return '<option value="' + g.id + '">' + g.icon + g.name + '</option>'; }).join('') + '</select>' +
      '<select id="imp-region">' + S.unlockedRegions.map(function (rid) {
        var bq = S.biz.shops.some(function (sh) { return sh.regionId === rid && sh.boutique; });
        return '<option value="' + rid + '"' + (bq && rid === (S.biz.shops.filter(function (sh) { return sh.boutique; })[0] || {}).regionId ? ' selected' : '') + '>到' + C.regionMap[rid].name + '仓库' + (bq ? '（💎精品店）' : '') + '</option>'; }).join('') + '</select>' +
      '<input type="number" id="imp-qty" value="5" min="1" max="30" title="件数">' +
      '<button class="primary" onclick="BT.App.importOrder(\'official\')">🚢 正规进口</button>' +
      '<button class="danger" onclick="BT.App.importOrder(\'grey\')">🕶️ 走水货</button></div>' +
      '<div class="trade-notes">' +
      '<div><b>🚢 正规进口（一般贸易）</b>：需要品牌代理权（' + T.licenseDays + ' 天，每 30 天配额 ' + T.licenseQuota + ' 件，品牌声望 ≥15 才肯授权）。下单当场按实时汇率付清货款和税费，海运在途 ' + T.officialLead + ' 天，' + Math.round(T.inspectRate * 100) + '% 概率被海关抽中查验、多等 1~3 天。零风险。</div>' +
      '<div><b>🕶️ 水货（平行进口）</b>：不要代理权、不交税，在途 ' + T.greyLead + ' 天，每单最多 20 件。每批 ' + Math.round(T.seizeRate * 100) + '% 概率被海关查扣（严打期间 ×3）：货物没收 + 罚款货值 50% + 品牌 −3 + 精品店口碑 −8；还可能混进假货，卖出去被顾客鉴定出来要退一赔半、口碑 −12。</div>' +
      '<div><b>💱 汇率风险</b>：名表、珠宝按美元，名包、名酒、香水按欧元。外币升值，进价就变贵 —— 大批进货前可以在金融页做一笔外汇对冲（卖空对应外币的汇率涨了会亏，正好抵消进价上涨）。</div>' +
      '<div><b>🎁 旺季</b>：春节前后、七夕、双十一、圣诞，奢侈品买家翻倍，提前备货。</div></div>' +
      (transit ? '<div class="hint" style="margin-top:8px">📦 在途订单</div>' + transit : '') +
      (st.imported || st.seized ? '<div class="hint" style="margin-top:6px">累计到货 ' + st.imported + ' 件 · 被查扣 ' + st.seized + ' 件 · 罚款 ' + U.money(st.fines) + ' · 假货被识破 ' + st.fakes + ' 次</div>' : '') + '</div>';
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

  /* ---- 竞争页：针对你的行动 + 各区市场份额（含散户）+ AI 公司档案（层级 / 态度 / 战绩）+ 动态 ---- */
  function threatCard(S) {
    var Rv = BT.Rivals, th = Rv.threats(S), biz = S.biz;
    var grace = C.COMPETE.grace - (S.day - (biz.founded || 0));
    var gn = function (gs) { return gs.map(function (g) { return C.goodsMap[g].icon + C.goodsMap[g].name; }).join('、'); };
    var rows = th.map(function (t) {
      var rv = t.rv, rn = t.rid ? C.regionMap[t.rid].name : '', pred = t.mode === 'predatory';
      if (t.kind === 'plan' && t.act === 'lock') return '<div class="threat plan"><b>📡 ' + rv.icon + rv.name + '</b> 想锁住 <b>' + gn(t.goods) + '</b> 的货源' +
        '<div class="hint">' + (t.exact ? '🕵️ 内线：第 ' + rv.plan.start + ' 天签独家协议，之后约 ' + rv.plan.days + ' 天你批发要贵 30%。' : '风声：近两天可能签独家协议。') + ' 现在去「供应链」签长期供货合同就不受影响。</div></div>';
      if (t.kind === 'plan' && t.act === 'site') return '<div class="threat plan"><b>📡 ' + rv.icon + rv.name + '</b> 在打' + rn + '铺面的主意' +
        '<div class="hint">' + (rv.plan.hike ? '它想找房东抬你路口旺铺的租（+25%）。买下这块物业（帝国页）就不怕。' : '它想抢先签下路口旺铺，之后你在这个区开不了 / 搬不进旺铺。') + '</div></div>';
      if (t.kind === 'lock') return '<div class="threat war"><b>🔒 ' + rv.icon + rv.name + '</b> 锁了 <b>' + gn(t.goods) + '</b> 的独家货源 · 还剩 ' + t.left + ' 天' +
        '<div class="hint">你批发这样货要贵 ' + Math.round((t.mul - 1) * 100) + '%。对策：签长期供货合同、换别的货卖，或者举报它（排他协议）。</div></div>';
      if (t.kind === 'site') return '<div class="threat war"><b>📍 ' + rv.icon + rv.name + '</b> 占着' + rn + '的路口旺铺 · 还剩 ' + t.left + ' 天<div class="hint">这期间你在' + rn + '开不了 / 搬不进路口旺铺。</div></div>';
      if (t.kind === 'hike') return '<div class="threat war"><b>🏚️ ' + rv.icon + rv.name + '</b> 抬了你' + rn + '店的房租 +' + Math.round((t.mul - 1) * 100) + '% · 还剩 ' + t.left + ' 天<div class="hint">买下这块物业（帝国页）就免租；或者搬到别的地段。</div></div>';
      if (t.kind === 'plan') return '<div class="threat plan"><b>📡 ' + rv.icon + rv.name + '</b> 准备在 <b>' + rn + '</b> ' + (pred ? '搞掠夺性定价' : '打价格战') +
        '<div class="hint">' + (t.exact ? '🕵️ 内线：第 ' + rv.plan.start + ' 天动手（' + t.left + ' 天后），目标 ' + gn(t.goods) + '，' + (pred ? '低于成本卖' : '比你便宜约 ' + Math.round(t.cut * 100) + '%') + '，约 ' + rv.plan.days + ' 天'
          : '只听到风声：近 1~3 天内可能动手。买「商业调查」能拿到准确日期和目标商品') + '</div></div>';
      var sh = biz.shops.filter(function (x) { return x.regionId === t.rid; })[0];
      var items = sh ? t.goods.map(function (g) {
        var h = Rv.bestPrice(S, sh, g), mine = sh.effP && sh.effP[g] ? sh.effP[g] : BT.Eco.buyPrice(S, g, t.rid) * (sh.shelf[g] || 1.3);
        return '<span class="tg">' + C.goodsMap[g].icon + C.goodsMap[g].name + ' 它¥' + (h.best ? h.best.toFixed(2) : '-') + ' / 你¥' + mine.toFixed(2) + (sh.hit && sh.hit[g] ? ' <i class="down">少成交' + Math.round((1 - sh.hit[g]) * 100) + '%</i>' : '') + '</span>';
      }).join('') : '';
      return '<div class="threat war' + (pred ? ' pred' : '') + '"><b>' + (pred ? '🩸 ' : '⚔️ ') + rv.icon + rv.name + '</b> 在 <b>' + rn + '</b> ' + (pred ? '掠夺性定价' : '价格战') + ' · 还剩 ' + t.left + ' 天 · 它已烧掉 ' + U.money(t.spent) + (rv.camp[t.rid] && rv.camp[t.rid].lastLoss > 0 ? '（这家店每天亏约 ' + U.money(rv.camp[t.rid].lastLoss) + '）' : '') +
        '<div class="tgs">' + items + '</div><div class="hint">' + (pred ? '它在亏本卖，扛得越久它亏越多。开「自动应战」守份额、拿会员和口碑硬扛，或者把被点名的货换掉。' : '你降价它会跟，直到它的底线。开「自动应战」、做促销，或者避开被点名的货。') + (sh && !sh.match ? ' <button class="small" onclick="BT.App.bizToggleMatch(\'' + sh.id + '\')">🛡️ 开启' + rn + '店自动应战</button>' : '') + '</div></div>';
    }).join('');
    var probes = (biz.probes || []).map(function (p) { var rv = Rv.get(S, p.rivalId); return rv ? '<div class="threat probe"><b>⚖️ 反垄断调查中：' + rv.icon + rv.name + '</b> · 约 ' + Math.max(0, p.until - S.day) + ' 天后出结果 · 胜算约 ' + Math.round(p.p * 100) + '%</div>' : ''; }).join('');
    rows += probes;
    return '<div class="card"><h3>🎯 针对你的行动</h3>' + (rows || '<div class="hint">' + (grace > 0 ? '公司刚成立，中大型对手还在观察你（约 ' + grace + ' 天后可能开始针对你）。散户摊贩不讲这个规矩。' : '暂时没人对你动手。你在谁的地盘份额太高、比它便宜，它就会盯上你。') + '</div>') +
      '<div class="hint" style="margin-top:6px">同一时间最多 ' + C.COMPETE.maxOnMe + ' 家针对你。它们开战前要算账：钱不够、怕你反击、你份额不大都不会打；打输了会记住你不好惹。</div></div>';
  }
  function rivalsTab(S) {
    var Rv = BT.Rivals; if (!Rv) return '';
    var html = threatCard(S);
    html += '<div class="card"><h3>🗺️ 各区域市场份额</h3><div class="desc">份额按吸引力（规模、口碑、品牌、地段、价位、促销/价格战）分配；🧺 是该区的散户摊贩数（他们抢的是单品生意，不占份额条）。</div>' +
      C.REGIONS.map(function (r) {
        var sh = Rv.shares(S, r.id), hk = BT.Hawkers ? BT.Hawkers.info(S, r.id) : null;
        return '<div class="share-row"><span class="share-name">' + r.icon + r.name + (hk ? '<br><span class="hint" title="散户摊贩（平时约 ' + hk.base + ' 家）">🧺' + hk.n + (hk.cuts.length ? ' 🔻' : '') + '</span>' : '') + '</span><div class="share-bar">' + sh.map(function (x) {
          return '<i style="width:' + (x.share * 100).toFixed(1) + '%;background:' + x.color + '" title="' + x.name + ' ' + Math.round(x.share * 100) + '%' + (x.war ? '（价格战）' : '') + '">' + (x.share > 0.12 ? (x.me ? '我' : x.icon) + Math.round(x.share * 100) + '%' : '') + (x.war ? '⚔️' : '') + '</i>';
        }).join('') + (sh.length ? '' : '<span class="hint">无人经营</span>') + '</div></div>';
      }).join('') + '</div>';
    html += '<div class="card"><h3>🏢 AI 竞争对手</h3><div class="rival-grid">' + S.biz.rivals.map(function (rv) {
      var shops = U.keys(rv.shops), wars = U.keys(rv.war);
      var stock = rv.listed && S.market ? S.market.stocks[rv.listed] : null;
      var canBuy = rv.alive && !rv.listed && BT.Empire.unlocked(S);
      var al = Rv.attLabel(rv.att || 0), m = rv.mem || { wars: 0, won: 0, lost: 0 };
      return '<div class="rival-card' + (rv.alive ? '' : ' dead') + (rv.tier === 'big' ? ' big' : '') + '" style="--c:' + rv.color + '"><div class="rival-top"><b>' + rv.icon + ' ' + rv.name + '</b> <span class="tag' + (rv.tier === 'big' ? ' lux' : '') + '">' + (C.TIER_NAMES[rv.tier] || '区域连锁') + '</span> <span class="tag">' + (C.STYLE_NAMES[rv.style] || rv.style) + '</span>' +
        (rv.listed ? ' <span class="tag up">上市 ' + rv.listed.toUpperCase() + (stock ? ' ¥' + stock.price.toFixed(2) : '') + '</span>' : '') + (rv.alive ? '' : ' <span class="tag down">' + (rv.fate === 'acquired' ? '已被你收购' : '已破产') + '</span>') + '</div>' +
        '<div class="hint">' + rv.desc + '</div>' +
        (rv.alive ? '<div class="kv"><span>对你的态度</span><b><span class="tag ' + al.c + '">' + al.t + '</span>' + (rv.fear > 0.2 ? ' <span class="tag up" title="之前在你手上吃过亏">忌惮你</span>' : '') + '</b></div>' +
        '<div class="kv"><span>当前动向</span><b>' + (rv.mood || '观望') + '</b></div>' +
        '<div class="kv"><span>和你交手</span><b>' + (m.wars ? m.wars + ' 次（它赢 ' + m.won + ' / 你赢 ' + m.lost + '）' : '还没有') + '</b></div>' +
        '<div class="kv"><span>现金（估）</span><b class="' + (rv.cash < 0 ? 'down' : '') + '">' + U.money(Math.round(rv.cash / 100) * 100) + '</b></div>' +
        '<div class="kv"><span>品牌</span><b>' + rv.brand.toFixed(0) + '</b></div>' +
        '<div class="rv-shops"><span class="hint">门店（近 7 天日均利润）</span>' + shops.map(function (rid) {
          var sh = rv.shops[rid], ph = (sh.ph || []).slice(-7), a = ph.length ? Math.round(U.sum(ph) / ph.length) : null;
          return '<span class="rv-shop">' + C.regionMap[rid].name + ' Lv' + sh.level + (a != null ? ' <b class="' + (a < 0 ? 'down' : 'up') + '">' + (a >= 0 ? '+' : '') + a + '</b>' : '') +
            (sh.lean ? ' <i title="精简了人手省成本，口碑会慢慢掉">✂️</i>' : '') + (sh.px && Math.abs(sh.px - 1) >= 0.02 ? ' <i title="价位 ×' + sh.px.toFixed(2) + '">' + (sh.px < 1 ? '🔻' : '🔺') + '</i>' : '') + '</span>';
        }).join('') + '</div>' +
        '<div class="kv"><span>近7日利润</span><b>' + U.money(U.sum(rv.profit7 || [])) + '</b></div>' +
        (wars.length ? '<div class="kv"><span>价格战</span><b class="down">' + wars.map(function (rid) { var cp = rv.camp[rid], tgt = cp && cp.on !== 'me' ? (Rv.get(S, cp.on) || {}).name : (cp ? '你' : ''); return C.regionMap[rid].name + (tgt ? '→' + tgt : '') + '（' + rv.war[rid] + '天）'; }).join('、') + '</b></div>' : '') +
        intelBox(S, rv) + diploBox(S, rv) +
        (rv.listed ? '' : '<div class="trade-row" style="margin-top:6px;grid-template-columns:1fr"><button class="small ' + (canBuy ? 'primary' : '') + '" ' + (canBuy ? '' : 'disabled title="解锁「资本帝国」后可收购"') + ' onclick="BT.App.acquireRival(\'' + rv.id + '\')">🏆 整体收购 ' + U.money(Rv.acquireCost(S, rv)) + '</button></div>') : '') + '</div>';
    }).join('') + '</div></div>';
    html += '<div class="card"><h3>📰 竞争动态</h3>' + ((S.biz.rivalNews || []).slice(0, 12).map(function (n) {
      return '<div class="news-row' + (n.type === 'bad' ? ' bad' : '') + '"><span class="hint">第' + n.day + '天</span> ' + escapeHtml(n.text) + '</div>';
    }).join('') || '<div class="hint">暂时风平浪静。</div>') + '</div>';
    return html;
  }

  /** 结盟 / 举报（v7.3） */
  function diploBox(S, rv) {
    var Rv = BT.Rivals; if (!Rv.proposeAlly || !rv.alive) return '';
    var allied = Rv.allied(S, rv), ev = Rv.evidence(S, rv), probing = (S.biz.probes || []).some(function (p) { return p.rivalId === rv.id; });
    var ally = rv.tier === 'big' ? '' : (allied ? '<div class="kv"><span>🤝 盟约</span><b class="up">还剩 ' + (rv.ally.until - S.day) + ' 天 <button class="small" onclick="BT.App.breakAlly(\'' + rv.id + '\')">解除</button></b></div>'
      : '<button class="small" title="互不侵犯 90 天：它不打你、不跟你抢区、不挖人；巨头打你时它会帮忙。成功率约 ' + Math.round(Rv.allyChance(S, rv) * 100) + '%（看它对你的态度）" onclick="BT.App.proposeAlly(\'' + rv.id + '\')">🤝 结盟 ' + U.money(Rv.allyFee(S, rv)) + '（约 ' + Math.round(Rv.allyChance(S, rv) * 100) + '%）</button>');
    var rep = probing ? '<span class="tag">⚖️ 调查中</span>' : '<button class="small" title="证据：' + (ev.map(function (e) { return e.t; }).join('、') || '暂无，几乎不可能成功，失败会扣信用') + '" onclick="BT.App.reportRival(\'' + rv.id + '\')">⚖️ 举报（胜算 ' + Math.round(Rv.reportChance(S, rv) * 100) + '%）</button>';
    return '<div class="diplo">' + ally + rep + '</div>' + (ev.length && !probing ? '<div class="hint">可举报：' + ev.map(function (e) { return e.t; }).join('、') + '</div>' : '');
  }
  function intelBox(S, rv) {
    var So = BT.Social; if (!So || !rv.alive) return '';
    var it = So.intel(S, rv);
    if (!it) return '<div class="trade-row" style="margin-top:6px;grid-template-columns:1fr"><button class="small" onclick="BT.App.spy(\'' + rv.id + '\')">🕵️ 商业调查 ' + U.money(So.SPY_COST) + '（15% 会被发现）</button></div>';
    return '<div class="intel"><b>🕵️ 内部情报（剩 ' + (rv.intelUntil - S.day) + ' 天）' + (it.angry ? ' <span class="tag down">被激怒</span>' : '') + '</b>' +
      '<div class="kv"><span>真实现金</span><b class="' + (it.cash < 0 ? 'down' : '') + '">' + U.money(it.cash) + '</b></div><div class="kv"><span>近 7 日利润</span><b>' + U.money(it.profit7) + '</b></div>' +
      '<div class="kv"><span>激进程度</span><b>' + Math.round(it.aggr * 100) + '%</b></div><div class="kv"><span>怕你程度</span><b>' + Math.round((rv.fear || 0) * 100) + '%</b></div>' +
      (rv.thought ? '<div class="hint">🧠 它在盘算：' + escapeHtml(rv.thought) + '</div>' : '') +
      '<div class="hint">可能对你下手：' + (it.targets.join('、') || '暂无') + '</div></div>';
  }

  /* ---- 拓展页：加盟 / 政府招标 / 天使投资 / 商会人脉 / 富豪榜 ---- */
  function expandTab(S) {
    return franchiseCard(S) + tenderCard(S) + ventureCard(S) + socialCard(S) + richCard(S);
  }
  function franchiseCard(S) {
    var F = BT.Franchise; if (!F) return '';
    var f = F.get(S), un = F.unlocked(S);
    var html = '<div class="card"><h3>🤝 加盟连锁' + (f.open ? ' <span class="tag up">招商中</span>' : '') + '</h3>';
    if (!un) return html + '<div class="desc">品牌声望 ≥40 且门店 ≥3 后开放（当前品牌 ' + S.biz.brand.toFixed(1) + '、门店 ' + S.biz.shops.length + '）。加盟商出钱开店，你收加盟费和每天营收抽成；加盟店资质差会拖累品牌。</div></div>';
    html += '<div class="desc">加盟费越低、抽成越低、品牌越响，申请的人越多。资质评估（A/B/C）有误差：A 店慢慢给品牌加分，C 店会拖累品牌甚至闹丑闻。最多 ' + F.MAX + ' 家。</div>' +
      '<div class="mgr-row"><span class="hint">加盟费</span><input type="number" id="fr-fee" value="' + f.fee + '" min="5000" max="50000" step="1000"><span class="hint">抽成</span><select id="fr-roy">' + [0.03, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15].map(function (v) { return '<option value="' + v + '"' + (Math.abs(v - f.royalty) < 0.001 ? ' selected' : '') + '>' + Math.round(v * 100) + '%</option>'; }).join('') + '</select>' +
      '<button class="small primary" onclick="BT.App.frSetup()">' + (f.open ? '更新条件' : '开放招商') + '</button>' + (f.open ? '<button class="small" onclick="BT.App.frClose()">暂停招商</button>' : '') + '</div>';
    if (f.apps.length) html += '<div class="hint" style="margin-top:6px">待审核申请</div>' + f.apps.map(function (a) {
      return '<div class="item-row"><span class="icon">🙋</span><div style="flex:1"><div class="name">' + a.name + ' · ' + C.regionMap[a.rid].name + ' <span class="tag ' + (a.grade === 'A' ? 'up' : (a.grade === 'C' ? 'down' : '')) + '">资质 ' + a.grade + '</span></div><div class="sub">加盟费 ' + U.money(a.fee) + ' · ' + (a.expire - S.day) + ' 天内答复</div></div>' +
        '<button class="small primary" onclick="BT.App.frApprove(\'' + a.id + '\')">批准</button><button class="small" onclick="BT.App.frReject(\'' + a.id + '\')">婉拒</button></div>';
    }).join('');
    if (f.stores.length) html += '<div class="hint" style="margin-top:6px">加盟店 ' + f.stores.length + ' 家 · 累计抽成 ' + U.money(f.income) + '</div>' + f.stores.map(function (s) {
      return '<div class="kv"><span>' + C.regionMap[s.rid].icon + C.regionMap[s.rid].name + ' · ' + s.name + ' <span class="tag ' + (s.grade === 'A' ? 'up' : (s.grade === 'C' ? 'down' : '')) + '">' + s.grade + '</span> · 已付 ' + U.money(s.paid) + '</span><b><button class="small danger" onclick="BT.App.frTerminate(\'' + s.id + '\')">解约</button></b></div>';
    }).join('');
    return html + '</div>';
  }
  function tenderCard(S) {
    var Td = BT.Tender; if (!Td) return '';
    var list = Td.list(S);
    var STATUS = { open: '投标中', won: '🏆 已中标，待交货', lost: '未中标', closed: '已结束', delivered: '✅ 已交货', failed: '❌ 违约' };
    return '<div class="card"><h3>📢 政府招标</h3><div class="desc">报价不能高于预算价，投标冻结 5% 保证金；和 2~4 家 AI 公司比价，信用评级高有加分。中标后按期交货（各仓库 + 背包里的货都算），逾期要罚款扣信用。货要提前备好（在「供应链」批发到仓库最省事）。</div>' +
      (list.length ? list.slice().reverse().map(function (t) {
        var g = C.goodsMap[t.gid], have = Td.have(S, t.gid);
        var act = t.status === 'open' ? '<input type="number" step="0.01" id="td-' + t.id + '" value="' + (t.myPrice || U.round2(t.budget * 0.92)).toFixed(2) + '" title="单价"><button class="small primary" onclick="BT.App.tdBid(\'' + t.id + '\')">' + (t.myPrice ? '改价' : '投标') + '</button>'
          : (t.status === 'won' ? '<button class="small primary" ' + (have >= t.qty ? '' : 'disabled') + ' onclick="BT.App.tdDeliver(\'' + t.id + '\')" title="仓库 ' + Td.whHave(S, t.gid) + ' + 背包 ' + BT.Trade.qtyOf(S, t.gid) + '">交货（现有 ' + have + '/' + t.qty + '）</button>' : '');
        return '<div class="item-row tender-row"><span class="icon">' + g.icon + '</span><div style="flex:1"><div class="name">' + t.buyer + ' · ' + g.name + ' ×' + t.qty + ' <span class="tag">' + STATUS[t.status] + '</span></div>' +
          '<div class="sub">预算单价 ¥' + t.budget.toFixed(2) + '（批发参考 ¥' + BT.Eco.buyPrice(S, t.gid, 'market').toFixed(2) + '）' + (t.status === 'open' ? ' · ' + Math.max(0, t.close - S.day) + ' 天后开标' : '') + (t.status === 'won' ? ' · 第 ' + t.deadline + ' 天前交货 · 合同额 ' + U.money(t.myPrice * t.qty) : '') +
          (t.myPrice ? ' · 我的报价 ¥' + t.myPrice.toFixed(2) : '') + (t.winPrice && t.status !== 'won' ? ' · 中标价 ¥' + t.winPrice.toFixed(2) : '') + '</div></div>' + act + '</div>';
      }).join('') : '<div class="hint">暂时没有招标，大约每 8~14 天会有一个。</div>') + '</div>';
  }
  function ventureCard(S) {
    var V = BT.Venture; if (!V) return '';
    var v = V.state(S);
    var html = '<div class="card"><h3>💡 天使投资</h3><div class="desc">' + (V.unlocked(S) ? '' : '净资产 ≥ ¥50,000 后才会有人来找你。') + '大多数初创公司会失败，少数能翻几倍甚至十几倍。每 25~40 天走一轮：倒闭 / 估值下调 / 新一轮融资（估值涨、你的股份被稀释）/ 被收购或上市。科技项目受科技股走势影响。未退出的投资按成本计入净资产。</div>';
    html += v.pitches.length ? v.pitches.map(function (p) {
      return '<div class="item-row"><span class="icon">' + p.icon + '</span><div style="flex:1"><div class="name">' + p.name + ' <span class="tag">' + p.risk + '</span></div><div class="sub">' + p.desc + ' · 估值 ' + U.money(p.valuation) + ' · 融资 ' + U.money(p.ask) + ' 换 ' + (p.stake * 100).toFixed(1) + '% · ' + (p.expire - S.day) + ' 天内有效</div></div><button class="small primary" onclick="BT.App.vcInvest(\'' + p.id + '\')">投资</button></div>';
    }).join('') : '<div class="hint">暂时没有路演项目。</div>';
    if (v.holds.length) html += '<div class="hint" style="margin-top:6px">我的投资 · 已兑现 ' + U.money(v.realized) + ' · 已亏 ' + U.money(v.lost) + '</div>' + v.holds.slice().reverse().map(function (h) {
      return '<div class="kv"><span>' + h.icon + h.name + ' · 投入 ' + U.money(h.invest) + ' · 占股 ' + (h.stake * 100).toFixed(1) + '%</span><b class="' + (h.alive ? '' : (h.exit ? 'up' : 'down')) + '">' + (h.alive ? '账面 ' + U.money(V.paperValue(h)) + ' · 第' + h.round + '轮 · ' + (h.next - S.day) + '天后下一轮' : (h.exit ? h.fate + ' 兑现 ' + U.money(h.exit) : '倒闭')) + '</b></div>';
    }).join('');
    return html + '</div>';
  }
  function socialCard(S) {
    var So = BT.Social; if (!So) return '';
    var s = So.state(S), mem = So.member(S);
    var html = '<div class="card"><h3>🤝 新港商会' + (mem ? ' <span class="tag up">会员 剩' + (s.until - S.day) + '天</span>' : '') + '<span class="spacer"></span><button class="small ' + (mem ? '' : 'primary') + '" onclick="BT.App.joinClub()">' + (mem ? '续费' : '入会') + ' ' + U.money(So.FEE) + '/' + So.DAYS + '天</button></h3>' +
      '<div class="desc">净资产 ≥ ' + U.money(So.MIN_NET) + ' 可入会。宴请朋友加深关系（每人 3 天一次，花 3 小时和精力），关系会慢慢变淡。</div><div class="ad-grid">';
    U.keys(So.CONTACTS).forEach(function (k) {
      var c = So.CONTACTS[k], rel = Math.round(s.contacts[k].rel), cd = s.contacts[k].last + 3 - S.day;
      html += '<div class="ad-card"><b>' + c.icon + ' ' + c.name + ' <span class="hint">' + c.role + '</span></b><div class="progress-track"><div class="progress-fill" style="width:' + rel + '%"></div></div><div class="hint">关系 ' + rel + '/100 · ' + c.perk + '</div>' +
        '<button class="small" ' + (mem && cd <= 0 ? '' : 'disabled') + ' onclick="BT.App.dinner(\'' + k + '\')">🍽️ 宴请 ' + U.money(So.dinnerCost(S, k)) + (cd > 0 ? '（' + cd + '天后）' : '') + '</button></div>';
    });
    return html + '</div></div>';
  }
  function richCard(S) {
    var So = BT.Social; if (!So) return '';
    var s = So.state(S), rows = s.rich ? s.rich.rows : So.richList(S).slice(0, 12);
    return '<div class="card"><h3>🏆 新港富豪榜 <span class="hint">' + (s.rich ? '第 ' + s.rich.day + ' 天发布 · 你排第 ' + s.rich.myRank + ' 名' : '实时预估') + ' · 下次发布：第 ' + s.nextRich + ' 天</span></h3>' +
      '<div class="desc">每 90 天发布一次。进前 10 品牌 +2；进前 3 太显眼，AI 对手 30 天内更激进。</div>' +
      '<div class="tbl-wrap"><table class="datatable"><tr><th>名次</th><th>姓名</th><th>身家</th></tr>' + rows.map(function (r) { return '<tr' + (r.me ? ' class="hl"' : '') + '><td>' + r.rank + '</td><td>' + (r.me ? '⭐ 你' : r.name) + '</td><td>' + U.money(r.wealth) + '</td></tr>'; }).join('') + '</table></div></div>';
  }

  /* ---- 区域经理（门店页顶部） ---- */
  function managerCard(S) {
    var M = BT.Manager; if (!M) return '';
    var m = M.get(S);
    if (!m.on) return '<div class="card mgr-card"><h3>🧑‍💼 区域经理 <span class="spacer"></span><button class="small primary" onclick="BT.App.mgrHire()">聘请（签约费 ' + U.money(M.wage(S) * 3) + '，日薪 ' + U.money(M.wage(S)) + '）</button></h3><div class="hint">每天开门前自动补货、按热度调价、断供找应急货源、有人挖墙脚自动加薪留人。门店多了以后不用每天手动操作。</div></div>';
    function chk(k, label) { return '<label class="mgr-opt"><input type="checkbox" ' + (m[k] ? 'checked' : '') + ' onchange="BT.App.mgrSet(\'' + k + '\', this.checked)"> ' + label + '</label>'; }
    return '<div class="card mgr-card"><h3>🧑‍💼 区域经理 <span class="tag up">在岗 · 日薪 ' + U.money(M.wage(S)) + '</span><span class="spacer"></span><button class="small danger" onclick="BT.App.mgrFire()">解聘</button></h3>' +
      '<div class="mgr-row">' + chk('autoRestock', '📦 自动补货') + '<span class="hint">目标库存</span><input type="number" id="mgr-target" value="' + m.target + '" min="10" max="200" onchange="BT.App.mgrSet(\'target\', +this.value)">' +
      '<span class="hint">预算（现金占比）</span><select onchange="BT.App.mgrSet(\'budget\', +this.value)">' + [0.3, 0.5, 0.7].map(function (v) { return '<option value="' + v + '"' + (m.budget === v ? ' selected' : '') + '>' + v * 100 + '%</option>'; }).join('') + '</select>' +
      chk('autoPrice', '🏷️ 自动定价（🔒的不动）') + chk('emergency', '🚚 断供应急') + chk('keepTalent', '🤝 自动留人') + '<label class="mgr-opt"><input type="checkbox" ' + (m.autoDefend !== false ? 'checked' : '') + ' onchange="BT.App.mgrSet(\'autoDefend\', this.checked)"> 🛡️ 被打价格战自动应战</label></div>' +
      '<div class="hint">昨日工作：' + escapeHtml(m.last || '刚到岗') + '</div></div>';
  }

  /* ---- 仪表盘：一页看全公司 ---- */
  function dashTab(S) {
    var biz = S.biz, l7 = biz.ledger.slice(-7), sum = function (f) { return U.sum(l7, f); };
    var rev7 = sum(function (x) { return x.revenue; }), pro7 = sum(function (x) { return x.profit; });
    var fixed = l7.length ? sum(function (x) { return (x.rent || 0) + (x.wage || 0); }) / l7.length : 0;
    var runway = fixed > 0 ? Math.floor(Math.max(0, S.cash) / fixed) : 999;
    var invVal = 0, sold7 = 0;
    biz.shops.forEach(function (sh) { U.keys(sh.inventory).forEach(function (g) { invVal += (sh.inventory[g] || 0) * BT.Eco.buyPrice(S, g, sh.regionId); }); U.keys(sh.sold7 || {}).forEach(function (g) { sold7 += sh.sold7[g] * BT.Eco.buyPrice(S, g, sh.regionId); }); });
    U.keys(biz.warehouses).forEach(function (rid) { var wh = biz.warehouses[rid]; U.keys(wh.goods).forEach(function (g) { invVal += (wh.goods[g] || 0) * BT.Eco.buyPrice(S, g, rid); }); });
    var turn = sold7 > 0 ? Math.round(invVal / (sold7 / 7)) : null;
    var html = '<div class="card"><h3>📈 经营仪表盘</h3><div class="shop-kpi">' +
      kpi('近7日营收', U.money(rev7)) + kpi('近7日净利', U.money(pro7), pro7 < 0 ? 'down' : 'up') + kpi('日均净利', U.money(l7.length ? pro7 / l7.length : 0), pro7 < 0 ? 'down' : 'up') +
      kpi('现金', U.money(S.cash), S.cash < 0 ? 'down' : '') + kpi('现金够付租金工资', runway >= 999 ? '—' : runway + ' 天', runway < 10 ? 'down' : '') +
      kpi('存货总值', U.money(invVal)) + kpi('存货周转', turn == null ? '—' : turn + ' 天', turn > 30 ? 'down' : '') + '</div></div>';
    /* 预警 */
    var al = alerts(S);
    html += '<div class="card"><h3>🚨 需要注意 <span class="tag ' + (al.length ? 'down' : 'up') + '">' + al.length + '</span></h3>' + (al.length ? al.map(function (a) { return '<div class="alert-row ' + a.lv + '">' + a.t + '</div>'; }).join('') : '<div class="hint">一切正常 👍</div>') + '</div>';
    /* 门店排行 */
    var rows = biz.shops.map(function (sh) {
      var ph = (sh.profitHist || []).slice(-7), p7 = U.sum(ph), th = (sh.trafficHist || []).slice(-7);
      var cust = th.length ? Math.round(U.sum(th, function (x) { return x.c; }) / th.length) : 0, lostR = th.length ? U.sum(th, function (x) { return x.lost; }) / Math.max(1, U.sum(th, function (x) { return x.c; })) : 0;
      var tip = p7 < 0 ? (lostR > 0.2 ? '缺货严重，先补货' : (sh.cf < 0.35 ? '竞争太激烈，考虑促销或换品类' : (cust < 15 ? '客流少，考虑换地段 / 投广告' : '成本偏高，检查员工和租金'))) : (lostR > 0.15 ? '卖得好但常断货，提高库存' : '经营良好');
      return { sh: sh, p7: p7, cust: cust, lostR: lostR, tip: tip };
    }).sort(function (a, b) { return b.p7 - a.p7; });
    html += '<div class="card"><h3>🏆 门店排行（近 7 天）</h3><div class="tbl-wrap"><table class="datatable"><tr><th>门店</th><th>7日净利</th><th>日均客流</th><th>缺货率</th><th>竞争系数</th><th>口碑</th><th>建议</th></tr>' + rows.map(function (r) {
      return '<tr><td>' + C.regionMap[r.sh.regionId].icon + C.regionMap[r.sh.regionId].name + '</td><td class="' + (r.p7 < 0 ? 'down' : 'up') + '">' + U.money(r.p7) + '</td><td>' + r.cust + '</td><td class="' + (r.lostR > 0.15 ? 'down' : '') + '">' + Math.round(r.lostR * 100) + '%</td><td>' + (r.sh.cf != null ? Math.round(r.sh.cf * 100) + '%' : '-') + '</td><td>' + Math.round(r.sh.reputation) + '</td><td class="hint2">' + r.tip + '</td></tr>';
    }).join('') + '</table></div></div>';
    /* 商品表现 */
    var gs = {};
    biz.shops.forEach(function (sh) {
      U.keys(sh.shelf).concat(U.keys(sh.sold7 || {})).forEach(function (g) { gs[g] = gs[g] || { sold: 0, inv: 0, shops: {} }; gs[g].shops[sh.regionId] = 1; });
      U.keys(sh.sold7 || {}).forEach(function (g) { gs[g].sold += sh.sold7[g]; });
      U.keys(sh.inventory).forEach(function (g) { if (gs[g]) gs[g].inv += sh.inventory[g] || 0; });
    });
    var glist = U.keys(gs).map(function (g) { var x = gs[g]; x.g = C.goodsMap[g]; x.turn = x.sold > 0.5 ? x.inv / (x.sold / 7) : null; return x; }).sort(function (a, b) { return b.sold - a.sold; });
    html += '<div class="card"><h3>📦 商品表现（近 7 天，所有门店合计）</h3><div class="tbl-wrap"><table class="datatable"><tr><th>商品</th><th>7日销量</th><th>门店库存</th><th>周转天数</th><th>在售门店</th><th>判断</th></tr>' + glist.map(function (x) {
      var verdict = x.sold < 1 ? '❄ 卖不动，考虑下架' : (x.turn != null && x.turn < 3 ? '🔥 快卖空了' : (x.turn != null && x.turn > 20 ? '积压' : '正常'));
      return '<tr><td>' + x.g.icon + x.g.name + '</td><td>' + Math.round(x.sold) + '</td><td>' + x.inv + '</td><td>' + (x.turn == null ? '—' : x.turn.toFixed(1)) + '</td><td>' + U.keys(x.shops).map(function (r) { return C.regionMap[r].name; }).join('、') + '</td><td>' + verdict + '</td></tr>';
    }).join('') + '</table></div></div>';
    html += trendsCard(S) + cityCard(S);
    return html;
  }
  function alerts(S) {
    var biz = S.biz, a = [];
    if (S.cash < 0) a.push({ lv: 'bad', t: '💸 现金为负，赶紧回笼资金（卖货、还少买点、贷款）' });
    biz.shops.forEach(function (sh) {
      var rn = C.regionMap[sh.regionId].name, ph = (sh.profitHist || []).slice(-7);
      if (ph.length >= 5 && ph.every(function (p) { return p < 0; })) a.push({ lv: 'bad', t: '📉 ' + rn + '店连续亏损 ' + ph.length + ' 天' });
      if (sh.strike > 0) a.push({ lv: 'bad', t: '✊ ' + rn + '店正在罢工' });
      if (sh.closedDays > 0) a.push({ lv: 'bad', t: '🚧 ' + rn + '店停业中（' + sh.closedDays + ' 天）' });
      var empty = U.keys(sh.shelf).filter(function (g) { return !(sh.inventory[g] > 0); });
      if (empty.length) a.push({ lv: 'warn', t: '📦 ' + rn + '店缺货：' + empty.map(function (g) { return C.goodsMap[g].name; }).join('、') });
      var low = sh.employees.filter(function (e) { return e.loyalty < 30; });
      if (low.length) a.push({ lv: 'warn', t: '😠 ' + rn + '店 ' + low.map(function (e) { return e.name; }).join('、') + ' 忠诚度很低，可能辞职 / 被挖 / 罢工' });
      if (!U.keys(sh.shelf).length) a.push({ lv: 'warn', t: '🗄️ ' + rn + '店货架是空的' });
      if (BT.Biz.diagnose && (sh.h7 || []).length >= 3) { var dg = BT.Biz.diagnose(S, sh); if (dg.grade === 'loss') { var top = dg.items.filter(function (x) { return x.lv !== 'good' && x.w < 90; })[0] || dg.items[0]; a.push({ lv: 'bad', t: '🩺 ' + rn + '店近 7 天日均亏 ' + U.money(-dg.avg.net) + (top ? '：' + top.t : '') + '（门店页看诊断）' }); } }
    });
    if (BT.Rivals) BT.Rivals.alive(S).forEach(function (rv) { U.keys(rv.war).forEach(function (rid) { if (biz.shops.some(function (sh) { return sh.regionId === rid; })) a.push({ lv: rv.camp[rid] && rv.camp[rid].on === 'me' ? 'bad' : 'warn', t: (rv.camp[rid] && rv.camp[rid].mode === 'predatory' ? '🩸 ' + rv.name + ' 在' + C.regionMap[rid].name + '掠夺定价' : '⚔️ ' + rv.name + ' 在' + C.regionMap[rid].name + '打价格战') + (rv.camp[rid] && rv.camp[rid].on === 'me' ? '（冲你来的，' : '（') + rv.war[rid] + ' 天）' }); }); });
    if (BT.Rivals) BT.Rivals.threats(S).filter(function (t) { return t.kind === 'plan'; }).forEach(function (t) { a.push({ lv: 'warn', t: '📡 ' + t.rv.name + ' 准备在' + C.regionMap[t.rid].name + '动手（' + (t.exact ? t.left + ' 天后' : '近几天') + '，竞争页看详情）' }); });
    if (BT.Supply) BT.Supply.board(S).forEach(function (b) { if (b.state === 'warn-out' || b.state === 'out') a.push({ lv: 'warn', t: (b.state === 'out' ? '⛔ 断供中：' : '⚠️ 即将断供：') + C.goodsMap[b.gid].name }); });
    if (S.lux) U.keys(S.lux.licenses).forEach(function (g) { var l = S.lux.licenses[g]; if (l.until - S.day <= 7) a.push({ lv: 'warn', t: '📄 ' + C.goodsMap[g].name + ' 代理权 ' + (l.until - S.day) + ' 天后到期' }); });
    if (S.supply) U.keys(S.supply.contracts).forEach(function (g) { var c = S.supply.contracts[g]; if (c.until - S.day <= 3 && c.until >= S.day) a.push({ lv: 'info', t: '📄 ' + C.goodsMap[g].name + ' 长约 ' + (c.until - S.day) + ' 天后到期' }); });
    if (BT.Insurance && biz.ins) ['property', 'cargo'].forEach(function (k) { var d = BT.Insurance.daysLeft(S, k); if (biz.ins[k] && d <= 3) a.push({ lv: 'info', t: '🛡️ ' + (k === 'cargo' ? '货运险' : '财产险') + (d ? ' ' + d + ' 天后到期' : '已到期') }); });
    if (BT.Rivals && BT.Rivals.deals(S).length) a.push({ lv: 'warn', t: '📨 有 ' + BT.Rivals.deals(S).length + ' 个要约待处理（竞争页）' });
    return a;
  }
  /* 流行趋势 */
  function trendsCard(S) {
    var Tr = BT.Trends; if (!Tr) return '';
    var b = Tr.board(S);
    var seasons = U.keys(b.seasons).map(function (lbl) {
      return '<div class="kv"><span>' + lbl + '</span><b>' + b.seasons[lbl].map(function (x) {
        return (x.rid === '*' ? '' : C.regionMap[x.rid].name) + (x.gid ? C.goodsMap[x.gid].icon + C.goodsMap[x.gid].name : '客流') + ' ×' + (x.mul || x.traffic);
      }).join('、') + '</b></div>';
    }).join('') || '<div class="hint">当前没有季节性变化。</div>';
    var viral = b.viral.map(function (x) {
      var v = x.v, g = C.goodsMap[v.gid];
      var when = x.state === 'soon' ? (v.start - S.day) + ' 天后开始' : (x.state === 'hot' ? '🔥 热销中，剩 ' + (v.end - S.day + 1) + ' 天' : '📉 退烧中（×0.75）');
      return '<div class="kv"><span>' + C.regionMap[v.rid].icon + C.regionMap[v.rid].name + ' · ' + g.icon + g.name + (x.insider ? ' <span class="tag lux">🔍 调研</span>' : '') + '</span><b class="' + (x.state === 'hot' ? 'up' : '') + '">×' + v.mul + ' · ' + when + '</b></div>';
    }).join('') || '<div class="hint">暂时没有已知的爆款。</div>';
    return '<div class="card"><h3>🔥 流行趋势 <span class="spacer"></span>' + (b.research ? '<span class="tag up">调研报告有效 ' + b.researchLeft + ' 天</span>' : '<button class="small" onclick="BT.App.research()">🔍 市场调研 ' + U.money(Tr.researchCost(S)) + '</button>') + '</h3>' +
      '<div class="hint">季节</div>' + seasons + '<div class="hint" style="margin-top:6px">网红爆款（新闻提前 3 天预告；做市场调研能看到未来 14 天全部排期）</div>' + viral + '</div>';
  }
  /* 城市发展 */
  function cityCard(S) {
    var City = BT.City; if (!City) return '';
    var board = City.board(S), up = City.upcoming(S), c = City.state(S);
    return '<div class="card"><h3>🏙️ 城市动态</h3>' +
      '<div class="city-grid">' + board.map(function (b) {
        var r = C.regionMap[b.rid];
        return '<div class="city-cell"><b>' + r.icon + r.name + '</b><span class="' + (b.now > 1.001 ? 'up' : (b.now < 0.999 ? 'down' : '')) + '">客流 ×' + b.now.toFixed(2) + '</span>' + (b.temp.length ? '<span class="hint">' + b.temp.map(function (t) { return t.label + ' ' + t.days + '天'; }).join('、') + '</span>' : '') + '</div>';
      }).join('') + '</div>' +
      (up.length ? '<div class="hint" style="margin-top:6px">即将发生</div>' + up.map(function (u) { return '<div class="kv"><span>' + (u.insider ? '🤫 内部消息：' : '') + u.text + '</span><b>' + (u.inDays <= 0 ? '今天' : u.inDays + ' 天后') + '</b></div>'; }).join('') : '') +
      (c.news.length ? '<div class="hint" style="margin-top:6px">近期新闻</div>' + c.news.slice(0, 5).map(function (n) { return '<div class="news-row"><span class="hint">第' + n.day + '天</span> ' + escapeHtml(n.text) + '</div>'; }).join('') : '') + '</div>';
  }

  /* ---- 营销保险页：广告投放 + 企业保险 ---- */
  function promoTab(S) {
    var A = BT.Ads, I = BT.Insurance; if (!A || !I) return '';
    var regOpts = S.unlockedRegions.map(function (rid) { return '<option value="' + rid + '">' + C.regionMap[rid].icon + C.regionMap[rid].name + '</option>'; }).join('');
    var goodsOpts = C.GOODS.map(function (g) { return '<option value="' + g.id + '">' + g.icon + g.name + '</option>'; }).join('');
    var act = A.active(S).map(function (a) {
      return '<div class="kv"><span>' + a.label + ' · ' + a.regions.map(function (r) { return C.regionMap[r].name; }).join('、') + (a.gmul ? ' · 需求 ×' + a.gmul : (a.mul ? ' · 客流 ×' + a.mul : '')) + '</span><b>剩 ' + a.days + ' 天</b></div>';
    }).join('');
    var html = '<div class="card"><h3>📣 广告投放</h3><div class="desc">广告效果和门店客流、热销品类叠加计算；同一个广告在投放期内不能重复买。</div>' +
      '<div class="ad-grid">' +
      '<div class="ad-card"><b>📄 传单</b><div class="hint">' + A.CH.flyer.desc + '，费用按区域租金</div><select id="ad-flyer-r">' + regOpts + '</select><button class="small primary" onclick="BT.App.runAd(\'flyer\')">发传单</button></div>' +
      '<div class="ad-card"><b>🚇 地铁广告 ' + U.money(A.CH.metro.cost) + '</b><div class="hint">' + A.CH.metro.desc + '</div><select id="ad-metro-l">' + U.keys(A.METRO).map(function (k) { return '<option value="' + k + '">' + A.METRO[k].name + '</option>'; }).join('') + '</select><button class="small primary" onclick="BT.App.runAd(\'metro\')">投放</button></div>' +
      '<div class="ad-card"><b>📺 电视广告 ' + U.money(A.CH.tv.cost) + '</b><div class="hint">' + A.CH.tv.desc + '</div><button class="small primary" onclick="BT.App.runAd(\'tv\')">投放</button></div>' +
      '<div class="ad-card"><b>🤳 网红带货 ' + U.money(A.CH.kol.cost) + '</b><div class="hint">60% 爆火（需求 ×2.5，5 天）· 25% 一般 · 15% 翻车（口碑 −10）</div><select id="ad-kol-r">' + regOpts + '</select><select id="ad-kol-g">' + goodsOpts + '</select><button class="small primary" onclick="BT.App.runAd(\'kol\')">找网红</button></div>' +
      '</div>' + (act ? '<div class="hint" style="margin-top:8px">投放中</div>' + act : '') + '</div>';
    var claims = S.biz.ins ? S.biz.ins.claims : 0;
    html += '<div class="card"><h3>🛡️ 企业保险 <span class="hint">每期 30 天，可提前续保</span></h3>' +
      '<div class="ad-grid">' +
      '<div class="ad-card"><b>🏢 财产险 ' + (I.has(S, 'property') ? '<span class="tag up">保障中 剩' + I.daysLeft(S, 'property') + '天</span>' : '<span class="tag">未投保</span>') + '</b><div class="hint">保费 = 门店与存货价值的 0.5%（当前 ' + U.money(I.premium(S, 'property')) + '）。火灾、台风等灾害损失赔 90%，奢侈品失窃全赔。</div><button class="small primary" onclick="BT.App.buyIns(\'property\')">' + (I.has(S, 'property') ? '续保' : '投保') + ' ' + U.money(I.premium(S, 'property')) + '</button></div>' +
      '<div class="ad-card"><b>🚢 货运险 ' + (I.has(S, 'cargo') ? '<span class="tag up">保障中 剩' + I.daysLeft(S, 'cargo') + '天</span>' : '<span class="tag">未投保</span>') + '</b><div class="hint">每期 ' + U.money(I.CARGO_FEE) + '。正规进口海运有 8% 概率货损 10~30%，投保全额赔。水货被海关没收属违法，任何保险都不赔。</div><button class="small primary" onclick="BT.App.buyIns(\'cargo\')">' + (I.has(S, 'cargo') ? '续保' : '投保') + ' ' + U.money(I.CARGO_FEE) + '</button></div>' +
      '</div>' + (claims ? '<div class="hint" style="margin-top:6px">累计获得理赔 ' + U.money(claims) + '</div>' : '') + '</div>';
    return html;
  }

  /* ---- 上市页：条件清单 → 申请 / 审核进度 → 上市后的股票面板（分红、减持） ---- */
  function ipoTab(S) {
    var I = BT.IPO; if (!I) return '';
    var ip = I.ensure(S), c = I.CFG;
    if (ip.status === 'listed') {
      var px = I.price(S), cap = I.marketCap(S), hr = I.holdRatio(S), ser = S.market.stocks.mine, prev = ser.hist.length ? ser.hist[ser.hist.length - 1].c : ip.ipoPrice;
      var chg = prev ? (px - prev) / prev : 0, sinceIpo = px / ip.ipoPrice - 1, can = I.canSellShares(S), lockLeft = ip.listDay + c.lockDays - S.day;
      var rep = ser.financials[ser.financials.length - 1], nextRep = S.market.earn && S.market.earn.sched.mine;
      var annual = Math.max(0, U.sum(S.biz.ledger.slice(-30), function (x) { return x.profit; })) * 12;
      return '<div class="card ipo-card"><h3>🔔 ' + escapeHtml(ip.name) + '（' + ip.ticker + '） <span class="tag up">已上市 · 第' + ip.listDay + '天</span>' +
        '<span class="spacer"></span><button class="small" onclick="BT.App.viewMyStock()">📈 看 K 线</button></h3>' +
        '<div class="ipo-price"><b class="' + (chg >= 0 ? 'red' : 'green') + '">¥' + px.toFixed(2) + '</b> <span class="' + (chg >= 0 ? 'red' : 'green') + '">' + U.pct(chg) + '</span><span class="hint"> · 发行价 ¥' + ip.ipoPrice.toFixed(2) + '（' + U.pct(sinceIpo) + '）</span></div>' +
        '<div class="shop-kpi">' + kpi('总市值', U.money(cap)) + kpi('你持股', (hr * 100).toFixed(1) + '%') + kpi('持股市值', U.money(I.stakeValue(S))) +
        kpi('身价（含持股）', U.money(I.wealth(S))) + kpi('市盈率', annual > 0 ? (cap / annual).toFixed(1) : '亏损') +
        kpi('下次季报', nextRep ? (nextRep - S.day <= 0 ? '今晚' : (nextRep - S.day) + ' 天后') : '-') + '</div>' +
        '<div class="hint">「身价」= 净资产 + 持股市值超出门店账面的部分。控股股权不按市值计入净资产，要靠减持套现或分红才变成真钱；经营越好、股价越高，减持能拿到的钱越多。' + (ip.sold ? ' 累计减持套现 ' + U.money(ip.sold) + '。' : '') + '</div>' +
        (rep ? '<div class="hint">最新财报（第' + rep.day + '天' + (rep.prospectus ? '，招股书' : '') + '）：营收 ' + U.money(rep.revenue) + ' · 净利 ' + U.money(rep.profit) + ' · EPS ' + rep.eps.toFixed(2) + (rep.expEps != null ? '（预期 ' + rep.expEps.toFixed(2) + '）' : '') + '</div>' : '') +
        '<div class="hint">季报直接用你公司账本的真实营收和利润，超预期就涨；每天的利润走势也会影响股价。零售板块新闻、新辉零售的财报也会带动它。</div></div>' +
        '<div class="card"><h3>💰 分红</h3><div class="desc">每 ' + c.divCooldown + ' 天最多一次。你持股的那部分钱会回到你手里，实际支出只是公众股东那 ' + Math.round((1 - hr) * 100) + '%；股价小涨、品牌 +1。' + (ip.divTotal ? '累计分红 ' + U.money(ip.divTotal) + '。' : '') + '</div>' +
        '<div class="trade-row"><input type="number" id="ipo-div" value="' + Math.max(1000, Math.round(cap * 0.01 / 100) * 100) + '" min="1000" title="分红总额"><button class="primary" ' + (ip.lastDiv && S.day - ip.lastDiv < c.divCooldown ? 'disabled' : '') + ' onclick="BT.App.ipoDividend()">派发红利</button></div></div>' +
        '<div class="card"><h3>📉 减持</h3><div class="desc">' + (lockLeft > 0 ? '控股股东锁定期还剩 <b>' + lockLeft + '</b> 天。' : '锁定期已过。') + '以市价 95% 大宗交易卖出，单次最多总股本 ' + Math.round(c.sellStep * 100) + '%、两次间隔 ≥ ' + c.sellCooldown + ' 天，至少保留 ' + Math.round(c.minHold * 100) + '% 控股权；减持公告会压低股价。</div>' +
        '<div class="trade-row"><input type="number" id="ipo-sell" value="' + can + '" min="1" max="' + can + '" title="减持股数"><button ' + (can > 0 ? '' : 'disabled') + ' onclick="BT.App.ipoSell()">减持（最多 ' + U.compact(can, 1) + ' 股，约 ' + U.money(can * I.price(S) * 0.95) + '）</button></div></div>';
    }
    var conds = I.conditions(S), ok = conds.every(function (x) { return x.ok; }), q = I.quote(S);
    var html = '<div class="card"><h3>🔔 申请上市</h3><div class="desc">在新港交易所挂牌：向公众发行 ' + Math.round(c.publicRatio * 100) + '% 新股募集资金，你保留 ' + Math.round((1 - c.publicRatio) * 100) + '% 控股权。上市后公司变成金融页里的一只股票，股价跟着你的经营业绩走。</div>' +
      '<div class="tbl-wrap"><table class="datatable cond-table"><tr><th>上市条件</th><th>要求</th><th>当前</th><th></th></tr>' + conds.map(function (x) {
        return '<tr><td>' + x.name + '</td><td>' + x.need + '</td><td class="' + (x.ok ? 'up' : 'down') + '">' + x.cur + '</td><td>' + (x.ok ? '✅' : '❌') + '</td></tr>';
      }).join('') + '</table></div></div>';
    if (ip.status === 'review') {
      var tot = ip.reviewEnd - ip.applyDay, done = U.clamp(S.day - ip.applyDay, 0, tot);
      html += '<div class="card"><h3>⏳ 审核中：' + escapeHtml(ip.name) + '（' + ip.ticker + '）</h3><div class="progress-track"><div class="progress-fill" style="width:' + Math.round(done / tot * 100) + '%"></div></div>' +
        '<div class="hint">第 ' + done + ' / ' + tot + ' 天，预计第 ' + ip.reviewEnd + ' 天出结果。审核期间出现资不抵债、由盈转亏、信用或负债率明显恶化，会被否（费用不退）。</div>' +
        '<div class="hint">按当前数据预估：估值 ' + U.money(q.valuation) + '，发行价约 ¥' + q.price.toFixed(2) + '，募资约 ' + U.money(q.raise) + '（最终以挂牌当天的数据定价）。</div>' +
        '<div class="trade-row" style="grid-template-columns:auto"><button class="small danger" onclick="BT.App.ipoWithdraw()">撤回申请</button></div></div>';
      return html;
    }
    var cool = ip.cooldownUntil && S.day < ip.cooldownUntil;
    html += '<div class="card"><h3>📄 发行预估</h3>' +
      (ip.status === 'rejected' ? '<div class="hint down">上次被否：' + escapeHtml(ip.rejectReason || '') + (cool ? '，' + (ip.cooldownUntil - S.day) + ' 天后可重新申请' : '') + '</div>' : '') +
      '<div class="shop-kpi">' + kpi('门店账面', U.money(q.book)) + kpi('年化利润', U.money(q.annual)) + kpi('市盈率', q.pe + ' 倍') + kpi('估值', U.money(q.valuation)) +
      kpi('发行价', '¥' + q.price.toFixed(2)) + kpi('预计募资', U.money(q.raise)) + '</div>' +
      '<div class="hint">估值 = 门店账面 + 近 30 天利润 × 12 × 市盈率；市盈率 5~15 倍，品牌越强、大盘近一个月越好就越高。募资扣 3% 承销费，募到的钱直接进现金。</div>' +
      '<div class="grid cols-3" style="margin-top:8px"><input type="text" id="ipo-name" maxlength="8" placeholder="公司简称（≤8字）" value="' + escapeHtml(ip.name || '新港商业') + '">' +
      '<input type="text" id="ipo-ticker" maxlength="4" placeholder="代码（4个字母）" value="' + escapeHtml(ip.ticker || 'XGSY') + '">' +
      '<button class="primary" ' + (ok && !cool ? '' : 'disabled') + ' onclick="BT.App.ipoApply()">🔔 申请上市（保荐审计费 ' + U.money(q.fee) + '）</button></div>' +
      '<div class="hint">' + (ok ? (cool ? '冷却期内暂不能申请。' : '条件全部满足！递交后审核 ' + c.reviewDays + ' 天，费用无论成败都不退。') : '还有条件没达到，满足后按钮才能点。') + '</div></div>';
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
        (own ? '（买入 ' + U.money(own.cost) + '，盈亏 ' + U.money(p - own.cost) + '）· ' + (E.selfUse(S, r.id) ? '<b class="up">自用：门店免租</b>' : '日租 ' + U.money(E.dailyRent(S, r.id))) : ' · ' + (E.selfUse(S, r.id) ? '买下后你的门店免交房租（现日租 ' + U.money((S.biz.shops.filter(function (sh) { return sh.regionId === r.id; })[0] || {}).rent || 0) + '）' : '预计日租 ' + U.money(E.marketRent(S, r.id)))) +
        (S.city && S.city.perm && S.city.perm[r.id] > 1 ? ' · <span class="up">城市发展 ×' + S.city.perm[r.id] + '</span>' : '') + '</div></div><div class="spacer"></div>' +
        (own ? '<button class="small" onclick="BT.App.estateSell(\'' + r.id + '\')">出售</button>' : '<button class="small primary" onclick="BT.App.estateBuy(\'' + r.id + '\')">购入</button>') + '</div>';
    }).join('');
    return '<div class="card"><h3>🏢 房地产</h3><div class="desc">买下自己门店所在区的物业，门店就不用再交房租；没开店的区则对外出租收租。房价跟着地产股（滨海地产）、央行利率、城市规划（地铁 / 新商圈）涨跌。买入含 2% 税费，卖出扣 3%，对外出租每日租金约为市价的 0.12%（已扣维护费）。名下地产市值 ≥ ¥200,000 达成「地产大亨」。当前地产市值 ' + U.money(E.netWorth(S)) + '</div>' + rows + '</div>' +
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
        '<div class="t-main"><div class="name">' + (d.name || d.ticker) + (d.own ? ' <span class="tag up">我的公司</span>' : (d.tier ? ' <span class="tag">' + d.tier + '</span>' : '')) + (d.group ? ' <span class="tag">' + BT.Market.GROUPS[d.group].slice(0, 2) + '</span>' : '') + '</div>' +
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
    if (marketTab !== 'stock' && BT.CP) { var cph = cpHtml(S, def.id); book = cph.book; tapeHtml = cph.tape; }
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
    $('instr-tape').innerHTML = tapeHtml || '<div class="hint">暂无成交记录。</div>';
    $('instr-trade').innerHTML = trade;
    ['trade-qty', 'trade-price'].forEach(function (k) { var el = $(k); if (!el) return; el.setAttribute('data-instr', def.id); if (keep[k] !== undefined) el.value = keep[k]; });
  }
  /** 期货 / 外汇对手盘（v7.3）：盘口深度 + 持仓报告 + 对手盘动态 */
  function cpHtml(S, id) {
    var I = BT.CP.info(S, id); if (!I) return { book: '', tape: '' };
    var maxQ = Math.max.apply(null, I.asks.concat(I.bids).map(function (x) { return x.q; }));
    var lvl = function (x, side, i) { return '<div class="book-row ' + side + '"><span>' + (side === 'ask' ? '卖' : '买') + (i + 1) + '</span><b>' + x.p + '</b><i style="--w:' + Math.round(x.q / maxQ * 100) + '%">' + x.q + '手</i></div>'; };
    var book = '<div class="cp-book">' + I.asks.slice().reverse().map(function (x, i) { return lvl(x, 'ask', 4 - i); }).join('') + I.bids.map(function (x, i) { return lvl(x, 'bid', i); }).join('') + '</div>' +
      '<div class="hint">每档约 ' + I.D + ' 手。大单会一档档往上吃：下 ' + I.D + ' 手均价差约 ' + (I.slip(I.D) * 100).toFixed(3) + '%，下 ' + I.D * 3 + ' 手约 ' + (I.slip(I.D * 3) * 100).toFixed(3) + '%；价格被你推开后会慢慢回落。</div>';
    var maxP = Math.max.apply(null, I.rows.map(function (r) { return Math.abs(r.pos); }).concat([1]));
    var cot = '<div class="cp-cot"><div class="cp-cot-head"><b>📋 持仓报告</b><span class="hint">总持仓 ' + U.compact(I.oi, 1) + ' 手' + (I.me ? ' · 你 ' + (I.me.lots > 0 ? '多 ' : '空 ') + Math.abs(I.me.lots) + ' 手（' + (I.me.share * 100).toFixed(1) + '%）' : '') + '</span></div>' +
      I.rows.map(function (r) {
        var w = Math.round(Math.abs(r.pos) / maxP * 50);
        return '<div class="cp-row' + (r.hunting ? ' hunting' : '') + '" title="' + r.style + '"><span class="cp-name">' + r.icon + r.name + '</span>' +
          '<span class="cp-bar"><i class="' + (r.pos >= 0 ? 'long' : 'short') + '" style="width:' + w + '%;' + (r.pos >= 0 ? 'left:50%' : 'right:50%') + '"></i></span>' +
          '<span class="cp-num ' + (r.pos >= 0 ? 'up' : 'down') + '">' + (r.pos >= 0 ? '多' : '空') + Math.abs(r.pos) + '</span><span class="cp-chg hint">' + (r.chg ? (r.chg > 0 ? '+' : '') + r.chg : '') + '</span></div>';
      }).join('') +
      (I.notes.length ? I.notes.map(function (n) { return '<div class="cp-note ' + n.lv + '">' + n.t + '</div>'; }).join('') : '') + '</div>';
    var tape = cot + '<div class="hint" style="margin-top:6px">你的成交 / 对手方</div>' + (I.tape.length ? I.tape.slice(0, 8).map(function (t) {
      return '<div class="tape-row"><span class="hint">第' + t.day + '天 ' + t.hour + ':00</span> <b class="' + (t.dir > 0 ? 'up' : 'down') + '">' + (t.dir > 0 ? '买' : '卖') + t.q + '手</b> @' + t.p + ' <span class="hint">← ' + escapeHtml(t.who) + '</span></div>';
    }).join('') : '<div class="hint">还没有成交。每一手都有人接：先是想反向调仓的机构，剩下的由做市商接。</div>');
    return { book: book, tape: tape };
  }
  function tradePanelStock(S, def, series) {
    if (def.own) return '<div class="hint">这是你自己的上市公司。控股股东不能在二级市场随意买卖，请到「公司 → 🔔 上市」页分红或减持。</div>' +
      '<div class="kv"><span>你持股</span><b>' + U.compact(S.ipo.holdShares, 1) + ' 股（' + (BT.IPO.holdRatio(S) * 100).toFixed(1) + '%）</b></div>' +
      '<div class="kv"><span>持股市值</span><b>' + U.money(BT.IPO.stakeValue(S)) + '</b></div>' +
      '<div class="trade-row" style="grid-template-columns:1fr;margin-top:6px"><button class="small" onclick="BT.App.switchTab(\'biz\');BT.App.bizTab(\'ipo\')">去上市页</button></div>';
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
      L.l + '：涨了赚、跌了亏；' + L.s + '：跌了赚、涨了亏。盈亏 = 方向 ×（平仓价−开仓价）× ' + L.mult + ' × 手数。反向下单会先平掉已有持仓；开平仓各有半个买卖价差和每手手续费，大单另有滑点（见左侧盘口）。仓位太重、离强平价太近，会被对冲基金盯上。</div>';
    if (pos) {
      var p = BT.Market.portfolio(S)[fut ? 'futures' : 'forex'].filter(function (x) { return x.id === def.id; })[0];
      var long = pos.qty > 0, n = Math.abs(pos.qty), addAmt = Math.max(100, Math.round((pos.init || pos.margin) * 0.2));
      /* v7.3.1：平仓按钮放在持仓信息最上面（之前被追加保证金挤到屏幕外，看起来像不能平仓） */
      html += '<div class="trade-row close-row" style="margin-top:8px"><button class="primary" onclick="BT.App.' + L.close + '(true)">平仓（全部 ' + n + ' 手）</button>' +
        '<button onclick="BT.App.' + L.close + '(false)" title="按上面输入框里的手数平仓">平仓（按输入手数）</button></div>' +
        '<div class="kv"><span>持仓方向</span><b>' + (long ? L.ln + '单（看涨）' : L.sn + '单（看跌）') + ' ' + n + ' 手</b></div>' +
        '<div class="kv"><span>开仓均价 / 最新价</span><b>' + p.cost.toFixed(L.dp) + ' / ' + series.price.toFixed(L.dp) + '</b></div>' +
        '<div class="kv"><span>占用保证金 / 当前权益</span><b>' + U.money(pos.margin) + ' / ' + U.money(p.equity) + '</b></div>' +
        '<div class="kv"><span>累计浮动盈亏</span><b style="color:' + (p.pnl >= 0 ? '#46c47e' : '#ff6b63') + '">' + U.money(p.pnl) + '</b></div>' +
        '<div class="kv"><span>强平价（约）</span><b>' + p.liq.toFixed(L.dp) + '</b></div>' +
        (fut ? '<div class="kv"><span>持仓合约</span><b>' + (pos.ct || series.ct.code) + (pos.ct === series.ct.code && series.ct.expiry - S.day <= 5 ? ' <span class="tag down">即将到期</span>' : '') + '</b></div>' : '') +
        (!fut ? '<div class="kv"><span>累计隔夜利息</span><b class="' + ((pos.swap || 0) >= 0 ? 'up' : 'down') + '">' + U.money(pos.swap || 0) + '</b></div>' : '') +
        '<div class="trade-row" style="margin-top:6px">' +
        (fut && pos.ct !== series.ct.next ? '<button class="small" onclick="BT.App.marketRollFutures()" title="平主力、开次月">🔁 换月到 ' + series.ct.next + '</button>' : '') +
        '<button class="small" title="把现金追加进保证金，强平价远离（不是平仓；被猎杀、快爆仓时保命用）" onclick="BT.App.marketAddMargin(\'' + kind + '\',' + addAmt + ')">➕ 追加保证金 ' + U.money(addAmt) + '</button></div>';
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
    html += cloudCard();
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

  function cloudCard() {
    var Cl = BT.Cloud; if (!Cl) return '';
    var sv = Cl.saved();
    return '<div class="cloud-card"><h3>☁️ 云存档（iPad 和电脑互通）</h3><div class="hint">用同一个「存档码 + 密码」，在任何设备上传 / 下载。第一次上传会创建存档码；以后要密码正确才能覆盖或读取。' + (sv.last ? '本机上次上传：' + BT.App.timeAgo(+sv.last) : '') + '</div>' +
      '<div class="cloud-row"><input type="text" id="cloud-code" maxlength="12" placeholder="存档码（6~12 位字母数字）" value="' + escapeHtml(sv.code) + '"><button class="small" onclick="BT.App.cloudNewCode()">随机生成</button>' +
      '<input type="password" id="cloud-pass" maxlength="32" placeholder="密码（4 位以上）" value="' + escapeHtml(sv.pass) + '"><label class="hint"><input type="checkbox" id="cloud-keep"' + (sv.pass ? ' checked' : '') + '> 记住密码</label></div>' +
      '<div class="cloud-row"><button class="primary" onclick="BT.App.cloudUpload()">⬆️ 上传到云端</button><button onclick="BT.App.cloudDownload()">⬇️ 从云端下载</button><span id="cloud-msg" class="hint"></span></div></div>';
  }

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
