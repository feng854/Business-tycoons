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
    $('tb-cash').textContent = U.money(S.cash);
    $('tb-net').textContent = U.money(BT.netWorth(S));
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
   * 二、日志面板
   * ===================================================================== */
  R.log = function () {
    var list = BT.Log.list.slice(-60);
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
    $('trade-bag').textContent = BT.Trade.bagUsed(S) + ' / ' + S.bagCap;

    $('trade-goods-list').innerHTML = C.GOODS.map(function (g) {
      var buy = BT.Eco.buyPrice(S, g.id, S.region), sell = BT.Eco.sellPrice(S, g.id, S.region);
      var have = BT.Trade.qtyOf(S, g.id);
      var favored = g.favored.indexOf(S.region) >= 0;
      return '<div class="item-row">' +
        '<span class="icon">' + g.icon + '</span>' +
        '<div><div class="name">' + g.name + (favored ? ' <span class="tag up">本地特产</span>' : '') + '</div>' +
        '<div class="sub">进价 ¥' + buy.toFixed(2) + ' · 售价 ¥' + sell.toFixed(2) + ' · 持有 ' + have + (g.spoil ? ' · 易腐' : '') + '</div></div>' +
        '<div class="spacer"></div>' +
        '<button class="small" onclick="BT.App.showPriceCompare(\'' + g.id + '\')">比价</button>' +
        '<input type="number" min="1" value="1" style="width:56px" id="qty-' + g.id + '">' +
        '<button class="small primary" onclick="BT.App.buyGoods(\'' + g.id + '\')">买入</button>' +
        '<button class="small" onclick="BT.App.sellGoods(\'' + g.id + '\')" ' + (have <= 0 ? 'disabled' : '') + '>卖出</button>' +
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
      var done = S.jobsDoneToday[j.id];
      return '<div class="item-row"><span class="icon">' + j.icon + '</span>' +
        '<div><div class="name">' + j.name + '</div><div class="sub">耗时' + j.hours + 'h · 体力-' + j.stamina + ' · 精力-' + j.energy + ' · 报酬 ¥' + j.pay + '</div></div>' +
        '<div class="spacer"></div><button class="small primary" ' + (done ? 'disabled' : '') +
        ' onclick="BT.App.doJob(\'' + j.id + '\')">' + (done ? '今日已做' : '开始') + '</button></div>';
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
  R.biz = function () {
    var S = BT.S; if (!S) return;
    var box = $('biz-box');
    if (!S.biz) { box.innerHTML = '<div class="hint">达成里程碑「第一桶金」（净资产 ¥10,000）后将自动成立公司。</div>'; return; }
    var biz = S.biz;
    var html = '';
    html += '<div class="card"><h3>🏢 公司总览</h3><div class="grid cols-3">' +
      '<div class="kv"><span>品牌声望</span><b>' + biz.brand.toFixed(1) + '/100</b></div>' +
      '<div class="kv"><span>信用评级</span><b>' + biz.creditScore + '/850</b></div>' +
      '<div class="kv"><span>总负债</span><b>' + U.money(U.sum(biz.loans, function (l) { return l.remaining; })) + '</b></div>' +
      '</div></div>';

    html += '<div class="card"><h3>🏬 店铺列表</h3>' +
      biz.shops.map(function (shop) { return bizShopCard(S, shop); }).join('') +
      '<div class="grid cols-3" style="margin-top:6px">' + S.unlockedRegions.filter(function (rid) {
        return !biz.shops.some(function (s) { return s.regionId === rid; });
      }).map(function (rid) {
        var r = C.regionMap[rid];
        return '<button onclick="BT.App.bizOpenShop(\'' + rid + '\')">开设新店：' + r.name + '</button>';
      }).join('') + '</div></div>';

    html += '<div class="card"><h3>📦 仓库与批发</h3>' + warehouseBox(S) + '</div>';
    html += '<div class="card"><h3>🏦 银行贷款</h3>' + loanBox(S, biz) + '</div>';
    html += '<div class="card"><h3>📊 财务报表</h3><div class="chart-box small"><canvas id="bizLedgerChart"></canvas></div>' + ledgerTable(biz) + '</div>';

    if (BT.Empire.unlocked(S)) {
      html += '<div class="card"><h3>🌍 资本帝国</h3><div class="desc">跨城市经营 / 房地产投资 / 企业收购与合并 —— 敬请期待，以下为可用的并购功能。</div>' + empireBox(S) + '</div>';
    } else {
      html += '<div class="card"><h3>🌍 资本帝国</h3><div class="desc">解锁条件：≥' + BT.Empire.GATE.minShops + '间店铺 且净资产 ≥ ' + U.money(BT.Empire.GATE.minNet) + '（当前 ' + biz.shops.length + '间 / ' + U.money(BT.netWorth(S)) + '）</div></div>';
    }

    box.innerHTML = html;
    var hist = biz.ledger.map(function (l) { return { v: l.profit, label: l.day }; });
    if (hist.length) BT.Chart.drawLine($('bizLedgerChart'), hist, { color: '#ffd766' });
  };

  function bizShopCard(S, shop) {
    var region = C.regionMap[shop.regionId];
    var cap = 2 + Math.floor((shop.value || 0) / 2000);
    return '<div class="item-row" style="align-items:flex-start;flex-direction:column">' +
      '<div style="display:flex;width:100%;align-items:center"><b>' + region.icon + region.name + '</b>' +
      '<span class="spacer"></span><span class="sub">声望' + shop.reputation.toFixed(0) + ' · 估值' + U.money(shop.value) + '</span></div>' +
      '<div class="sub" style="margin:4px 0">员工 ' + shop.employees.length + '/' + cap + '：' +
      (shop.employees.map(function (e) { return e.name + '(' + BT.Biz.EMP_ROLES.filter(function(r){return r.id===e.role;})[0].name + 'Lv' + e.skill + ')'; }).join('、') || '无') + '</div>' +
      '<div class="grid cols-4" style="width:100%">' +
      '<select id="role-' + shop.id + '">' + BT.Biz.EMP_ROLES.map(function (r) { return '<option value="' + r.id + '">' + r.name + '</option>'; }).join('') + '</select>' +
      '<button class="small" onclick="BT.App.bizHire(\'' + shop.id + '\')">招聘</button>' +
      '<button class="small" onclick="BT.App.bizTransfer(\'' + shop.id + '\')">仓库调货</button>' +
      '<button class="small danger" onclick="BT.App.bizCloseShop(\'' + shop.id + '\')">关店</button></div>' +
      shelfRowsBiz(S, shop) + '</div>';
  }
  function shelfRowsBiz(S, shop) {
    return '<div class="grid cols-2" style="width:100%;margin-top:6px">' + C.GOODS.filter(function (g) {
      return (shop.inventory[g.id] || 0) > 0 || shop.shelf[g.id];
    }).map(function (g) {
      var inv = shop.inventory[g.id] || 0; var on = shop.shelf[g.id];
      return '<div class="sub">' + g.icon + g.name + ' 库存' + inv + (on ? ' 加价×' + on.toFixed(2) : ' 未上架') +
        ' <button class="small" onclick="BT.App.bizSetShelf(\'' + shop.id + '\',\'' + g.id + '\')">设置</button></div>';
    }).join('') + '</div>';
  }
  function warehouseBox(S) {
    var html = '<div class="grid cols-2">';
    S.unlockedRegions.forEach(function (rid) {
      var wh = BT.Biz.warehouse(S, rid);
      html += '<div class="item-row" style="flex-direction:column;align-items:flex-start">' +
        '<b>' + C.regionMap[rid].name + ' 仓库</b><div class="sub">容量 ' + wh.used + '/' + wh.cap + '</div>' +
        '<button class="small" onclick="BT.App.bizUpgradeWarehouse(\'' + rid + '\')">扩容(¥' + Math.round(wh.cap * 0.6) + ')</button></div>';
    });
    html += '</div><div class="hint" style="margin-top:8px">批发采购：</div><div class="grid cols-4">' +
      '<select id="wh-region">' + S.unlockedRegions.map(function (rid) { return '<option value="' + rid + '">' + C.regionMap[rid].name + '</option>'; }).join('') + '</select>' +
      '<select id="wh-goods">' + C.GOODS.map(function (g) { return '<option value="' + g.id + '">' + g.icon + g.name + '</option>'; }).join('') + '</select>' +
      '<input type="number" id="wh-qty" value="50" min="10">' +
      '<button class="primary" onclick="BT.App.bizWholesale()">批发进货</button></div>';
    return html;
  }
  function loanBox(S, biz) {
    var html = '<div class="kv"><span>可贷额度</span><b>' + U.money(BT.Biz.maxLoan(S)) + '</b></div>' +
      '<div class="kv"><span>当前日利率</span><b>' + (BT.Biz.loanRate(S) * 100).toFixed(3) + '%</b></div>' +
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
    return '<table class="datatable"><tr><th>天</th><th>营收</th><th>成本</th><th>租金</th><th>工资</th><th>净利</th></tr>' +
      rows.map(function (r) { return '<tr><td>D' + r.day + '</td><td>' + U.compact(r.revenue) + '</td><td>' + U.compact(r.cogs) +
        '</td><td>' + U.compact(r.rent) + '</td><td>' + U.compact(r.wage) + '</td><td>' + U.compact(r.profit) + '</td></tr>'; }).join('') + '</table>';
  }
  function empireBox(S) {
    var html = '<div class="grid cols-3">';
    C.CITIES.forEach(function (c) {
      html += '<div class="item-row" style="flex-direction:column"><b>' + c.name + '</b><span class="tag">' +
        (c.status === 'active' ? '运营中' : '敬请期待') + '</span></div>';
    });
    html += '</div>';
    if (S.empireOffer) {
      var o = S.empireOffer, r = C.regionMap[o.regionId];
      html += '<div class="card" style="margin-top:8px"><h3>🤝 并购要约</h3><div class="desc">' + r.name + ' 竞争对手愿以 ' + U.money(o.price) + ' 出让份额</div>' +
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
    var S = BT.S; BT.Market.ensure(S);
    $('mkt-index').textContent = '大盘指数 ' + S.market.index.toFixed(2);
    ['stock', 'future', 'forex'].forEach(function (t) {
      var el = $('mkt-tab-' + t); if (el) el.className = t === marketTab ? 'active' : '';
    });
    var defs = marketTab === 'stock' ? BT.Market.STOCKS : (marketTab === 'future' ? BT.Market.FUTURES : BT.Market.FOREX);
    var seriesMap = marketTab === 'stock' ? S.market.stocks : (marketTab === 'future' ? S.market.futures : S.market.forex);
    if (!defs.some(function (d) { return d.id === selectedInstr; })) selectedInstr = defs[0].id;

    $('mkt-list').innerHTML = defs.map(function (d) {
      var series = seriesMap[d.id];
      var hist = series.hist; var prev = hist.length > 1 ? hist[hist.length - 2].c : series.price;
      var chg = prev ? (series.price - prev) / prev : 0;
      return '<div class="ticker-row ' + (d.id === selectedInstr ? 'active' : '') + '" onclick="BT.App.selectInstrument(\'' + d.id + '\')">' +
        '<div><div class="name">' + (d.name || d.ticker) + '</div><div class="code">' + d.ticker + '</div></div>' +
        '<div class="spacer"></div><div class="price">' + series.price.toFixed(2) + '</div>' +
        '<div class="chg ' + (chg >= 0 ? 'up' : 'down') + '">' + U.pct(chg) + '</div></div>';
    }).join('');

    renderInstrumentDetail(S, defs.filter(function (d) { return d.id === selectedInstr; })[0]);
    renderPortfolio(S);
  };

  function renderInstrumentDetail(S, def) {
    if (!def) return;
    var seriesMap = marketTab === 'stock' ? S.market.stocks : (marketTab === 'future' ? S.market.futures : S.market.forex);
    var series = seriesMap[def.id];
    $('instr-title').textContent = (def.name || def.ticker) + '（' + def.ticker + '）';
    var markers = [];
    if (marketTab === 'stock' && series.financials.length) {
      markers = series.financials.map(function (r) { return { day: r.day, color: r.surprise >= 0 ? '#2f9e5e' : '#e5534b' }; });
    }
    BT.Chart.drawCandles($('instrChart'), series.hist.slice(-60), { markers: markers });

    var info = '';
    if (marketTab === 'stock') {
      info = '<div class="grid cols-3">' +
        '<div class="kv"><span>最新价</span><b>¥' + series.price.toFixed(2) + '</b></div>' +
        '<div class="kv"><span>流通盘</span><b>' + U.compact(def.float, 1) + '股</b></div>' +
        '<div class="kv"><span>总市值</span><b>' + U.money(series.price * def.float) + '</b></div></div>';
      var rep = series.financials[series.financials.length - 1];
      if (rep) info += '<div class="hint" style="margin-top:6px">最新季报（第' + rep.day + '天）：营收 ' + U.compact(rep.revenue) +
        '（' + U.pct(rep.revenueGrowth) + '）· 净利 ' + U.compact(rep.profit) + ' · EPS ' + rep.eps.toFixed(2) + '</div>';
      info += tradePanelStock(S, def, series);
    } else if (marketTab === 'future') {
      info = '<div class="grid cols-3">' +
        '<div class="kv"><span>最新价</span><b>' + series.price.toFixed(2) + ' ' + def.unit + '</b></div>' +
        '<div class="kv"><span>合约乘数</span><b>×' + def.mult + '</b></div>' +
        '<div class="kv"><span>保证金率</span><b>' + (def.marginRate * 100) + '%</b></div></div>';
      info += tradePanelFutures(S, def, series);
    } else {
      info = '<div class="grid cols-3">' +
        '<div class="kv"><span>最新汇率</span><b>' + series.price.toFixed(4) + '</b></div>' +
        '<div class="kv"><span>合约单位</span><b>' + def.lot + '</b></div>' +
        '<div class="kv"><span>保证金率</span><b>' + (def.marginRate * 100) + '%</b></div></div>';
      info += tradePanelForex(S, def, series);
    }
    $('instr-info').innerHTML = info;
  }
  function tradePanelStock(S, def, series) {
    var pos = S.market.posStock[def.id];
    return '<div class="grid cols-3" style="margin-top:8px"><input type="number" id="trade-qty" value="100" min="1">' +
      '<button class="primary" onclick="BT.App.marketBuyStock()">买入</button>' +
      '<button onclick="BT.App.marketSellStock()">卖出</button></div>' +
      (pos ? '<div class="hint">持仓 ' + pos.qty + ' 股，成本 ¥' + pos.cost.toFixed(2) + '，浮动盈亏 ' + U.money((series.price - pos.cost) * pos.qty) + '</div>' : '');
  }
  function tradePanelFutures(S, def, series) {
    var pos = S.market.posFut[def.id];
    return '<div class="grid cols-3" style="margin-top:8px"><input type="number" id="trade-qty" value="1" min="1">' +
      '<button class="good" onclick="BT.App.marketOpenFutures(\'long\')">开多</button>' +
      '<button class="danger" onclick="BT.App.marketOpenFutures(\'short\')">开空</button></div>' +
      (pos ? '<div class="hint">持仓 ' + pos.qty + ' 手，均价 ' + pos.cost.toFixed(2) + '，保证金 ' + U.money(pos.margin) +
        ' <button class="small" onclick="BT.App.marketCloseFutures()">平仓</button></div>' : '');
  }
  function tradePanelForex(S, def, series) {
    var pos = S.market.posFx[def.id];
    return '<div class="grid cols-3" style="margin-top:8px"><input type="number" id="trade-qty" value="1" min="1">' +
      '<button class="good" onclick="BT.App.marketOpenForex(\'long\')">买入</button>' +
      '<button class="danger" onclick="BT.App.marketOpenForex(\'short\')">卖出</button></div>' +
      (pos ? '<div class="hint">持仓 ' + pos.qty + ' 手，均价 ' + pos.cost.toFixed(4) + '，保证金 ' + U.money(pos.margin) +
        ' <button class="small" onclick="BT.App.marketCloseForex()">平仓</button></div>' : '');
  }
  function renderPortfolio(S) {
    var pf = BT.Market.portfolio(S);
    var html = '';
    if (pf.stocks.length) html += '<div class="hint">股票持仓</div>' + pf.stocks.map(function (p) {
      return '<div class="kv"><span>' + p.name + ' x' + p.qty + '</span><b style="color:' + (p.pnl >= 0 ? '#46c47e' : '#ff6b63') + '">' + U.money(p.pnl) + '</b></div>';
    }).join('');
    if (pf.futures.length) html += '<div class="hint">期货持仓</div>' + pf.futures.map(function (p) {
      return '<div class="kv"><span>' + p.name + ' ' + (p.qty > 0 ? '多' : '空') + Math.abs(p.qty) + '手</span><b style="color:' + (p.pnl >= 0 ? '#46c47e' : '#ff6b63') + '">' + U.money(p.pnl) + '</b></div>';
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
    $('quest-ach').innerHTML = BT.Quests.allAchievements().map(function (a) {
      var done = S.achievements[a.id];
      return '<div class="tag ' + (done ? 'up' : '') + '" style="margin:3px">' + (done ? '🎖️' : '🔒') + ' ' + a.name + '</div>';
    }).join('');
  };

  /* ========================================================================
   * 十一、存档
   * ===================================================================== */
  R.saveTab = function () {
    var html = '';
    for (var i = 0; i < 3; i++) {
      var info = BT.slotInfo(i);
      html += '<div class="item-row"><div><div class="name">存档 ' + (i + 1) + '</div><div class="sub">' +
        (info ? ('第' + info.day + '天 · 阶段' + info.phase + ' · 净资产' + U.money(info.net)) : '空') + '</div></div>' +
        '<div class="spacer"></div><button class="small primary" onclick="BT.App.saveToSlot(' + i + ')">保存</button>' +
        (info ? '<button class="small" onclick="BT.App.loadFromSlot(' + i + ')">读取</button>' : '') + '</div>';
    }
    $('save-slots').innerHTML = html;
  };

  /* ========================================================================
   * 十二、总渲染入口
   * ===================================================================== */
  R.all = function () {
    if (!BT.S) return;
    R.topbar(); R.sidebar(); R.log();
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
