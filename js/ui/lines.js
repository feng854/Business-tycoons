/* ==========================================================================
 * 文件：js/ui/lines.js
 * 作用：公司页「🧩 业务线」标签（v7.4）：批发商 / 社区团购 / 奶茶店 的界面与按钮动作
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U;
  var UI = BT.LinesUI = {};
  var sub = 'b2b';
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function act(res) { BT.App.toast(res); BT.save(); BT.Render._force = true; try { BT.Render.all(); } finally { BT.Render._force = false; } return res; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function gname(g) { return BT.GroupBuy && BT.GroupBuy.isCard(g) ? BT.GroupBuy.gname(g) : C.goodsMap[g].icon + C.goodsMap[g].name; }
  function rname(r) { return C.regionMap[r].icon + C.regionMap[r].name; }
  function sign(n) { return '<b class="' + (n < 0 ? 'down' : 'up') + '">' + (n >= 0 ? '+' : '') + U.money(n) + '</b>'; }

  UI.tab = function (S) {
    var subs = [['b2b', '🚚 批发商'], ['gb', '🛒 社区团购'], ['tea', '🧋 奶茶店']];
    var head = '<div class="card"><div class="pill-group">' + subs.map(function (t) {
      return '<button class="' + (sub === t[0] ? 'active' : '') + '" onclick="BT.App.lineTab(\'' + t[0] + '\')">' + t[1] + '</button>';
    }).join('') + '</div>' + summary(S) + '</div>';
    return UI.dilemmaCard(S) + head + (sub === 'b2b' ? b2bTab(S) : (sub === 'gb' ? gbTab(S) : teaTab(S)));
  };
  function summary(S) {
    var p = function (h) { return U.sum((h || []).slice(-7), function (x) { return x.profit; }); };
    var b = S.biz.b2b, g = S.biz.gb, t = S.biz.tea;
    return '<div class="grid cols-3 line-sum"><div class="kv"><span>批发 近7日利润</span>' + (b ? sign(p(b.hist)) : '<b class="hint">未开展</b>') + '</div>' +
      '<div class="kv"><span>团购 近7日利润</span>' + (g && g.hist.length ? sign(p(g.hist)) : '<b class="hint">未开展</b>') + '</div>' +
      '<div class="kv"><span>奶茶 近7日利润</span>' + (t && t.shops.length ? sign(p(t.hist)) : '<b class="hint">未开展</b>') + '</div></div>';
  }

  /* ---------------------------------------------------------------- 批发商 */
  function b2bTab(S) {
    var B2 = BT.B2B, b = B2.ensure(S), html = '';
    html += '<div class="card"><h3>🚚 批发商：给散户和 AI 连锁供货</h3><div class="desc">在有仓库的区开批发部，从这个仓库给全城散户供货（本区全覆盖、外区一半、外区运费 4%）。散户在你和市场批发价之间选：<b>批发价</b>、<b>账期</b>、<b>供货稳定</b>决定份额。' +
      '账期越长客户越多，但钱回得慢、坏账越多。抬高批发价 → 散户卖得贵 → 你门店的竞争变小（抬太狠散户就跑）。</div>';
    var whs = U.keys(S.biz.warehouses);
    var can = whs.filter(function (r) { return !b.depots[r]; });
    if (can.length) html += '<div class="trade-row" style="margin-top:6px;grid-template-columns:1fr auto"><select id="b2b-open-r">' + can.map(function (r) { return '<option value="' + r + '">' + rname(r) + '（仓库 ' + BT.Biz.warehouse(S, r).used + '/' + BT.Biz.warehouse(S, r).cap + '）</option>'; }).join('') + '</select>' +
      '<button class="primary" onclick="BT.App.b2bOpen()">开批发部 ' + U.money(C.B2B.cost) + '</button></div><div class="hint">要求：信用 ≥ ' + C.B2B.minCredit + '（你现在 ' + S.biz.creditScore + '）</div>';
    else if (!whs.length) html += '<div class="hint">还没有仓库：先在「供应链」批发进一次货，就会在那个区建仓库。</div>';
    html += '</div>';
    U.keys(b.depots).forEach(function (rid) {
      var d = b.depots[rid], wh = BT.Biz.warehouse(S, rid);
      html += '<div class="card"><h3>🏭 ' + rname(rid) + '批发部 <span class="tag">供货稳定 ' + Math.round(d.rel * 100) + '%</span></h3>' +
        '<div class="trade-row" style="grid-template-columns:auto 1fr auto auto 1fr"><span class="hint">批发价 × 市价</span><input id="b2b-p-' + rid + '" type="number" step="0.01" min="0.85" max="1.2" value="' + d.price.toFixed(2) + '">' +
        '<span class="hint">账期</span><select id="b2b-t-' + rid + '">' + [0, 7, 15].map(function (x) { return '<option value="' + x + '"' + (d.term === x ? ' selected' : '') + '>' + (x ? x + ' 天' : '现结') + '</option>'; }).join('') + '</select>' +
        '<button class="small primary" onclick="BT.App.b2bSet(\'' + rid + '\')">保存</button></div>' +
        '<div class="hint">0.95 以下抢客户但利润薄；1.05 以上散户会流失。你大批进货（200 件以上 78 折）才有利润空间。仓库里没有的货就是不经营；卖着卖着断货才会降低「供货稳定」。</div>' +
        '<table class="mini-table"><tr><th>商品</th><th>仓库库存</th>' + C.REGIONS.map(function (r) { return '<th>' + r.name + '</th>'; }).join('') + '</tr>' +
        C.HAWKERS.goods.map(function (g) {
          return '<tr><td>' + gname(g) + '</td><td class="' + ((wh.goods[g] || 0) < 50 ? 'down' : '') + '">' + (wh.goods[g] || 0) + '</td>' + C.REGIONS.map(function (r) { var sh = b.share[r.id] && b.share[r.id][g]; return '<td>' + (sh ? Math.round(sh * 100) + '%' : '<span class="hint">-</span>') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</table><div class="hint">表里是你在各区散户进货中的份额（昨天）。仓库缺货会降低供货稳定性。</div></div>';
    });
    if (U.keys(b.depots).length) {
      var sm = B2.summary(S), L = b.last;
      html += '<div class="card"><h3>💳 应收账款与坏账</h3><div class="grid cols-4">' +
        '<div class="kv"><span>昨天出货</span><b>' + (L ? L.units + ' 件 / ' + U.money(L.rev) : '-') + '</b></div>' +
        '<div class="kv"><span>昨天利润</span>' + (L ? sign(L.profit) : '<b>-</b>') + '</div>' +
        '<div class="kv"><span>应收账款</span><b>' + U.money(sm.ar) + '</b></div>' +
        '<div class="kv"><span>3 天内到期</span><b>' + U.money(sm.soon) + '</b></div>' +
        '<div class="kv"><span>近 30 天坏账</span><b class="' + (sm.bad30 ? 'down' : '') + '">' + U.money(sm.bad30) + '</b></div>' +
        '<div class="kv"><span>缺货少卖</span><b>' + (L ? L.lost + ' 件' : '-') + '</b></div></div>' +
        (function () { var q = B2.factorQuote(S); return q && q.amt > 0 ? '<div class="trade-row" style="margin-top:6px;grid-template-columns:1fr"><button class="small" title="把还没到期的应收账款卖给银行，立刻拿钱；之后的坏账风险归银行。要信用 ≥ 600" onclick="BT.App.b2bFactor()">🏦 应收保理：' + U.money(q.amt) + ' 立即到账 ' + U.money(q.cash) + '（手续费 ' + (q.fee * 100).toFixed(1) + '%，平均还有 ' + q.days + ' 天到期）</button></div>' : ''; })() +
        (sm.bad ? '<div class="trade-row" style="margin-top:6px;grid-template-columns:1fr"><button class="small" onclick="BT.App.b2bCollect()" title="付 20% 手续费，60% 概率追回一半；品牌 −1">📞 委托催收坏账 ' + U.money(sm.bad) + '（手续费 ' + U.money(Math.round(sm.bad * 0.2)) + '）</button></div>' : '') +
        '<div class="hint">坏账率（每个账期）：城中村 4%、学院区 3%、批发市场 2.5%、老街 / 码头 2%、商业街 1%；15 天账期 ×1.5。某区欠款超过 ¥2,000 时，偶尔会有摊贩卷货跑路。</div>' +
        (b.war && b.war.until >= S.day ? '<div class="hint down">🦈 ' + (BT.Rivals.get(S, b.war.by) || {}).name + ' 在打批发价格战（还剩 ' + (b.war.until - S.day + 1) + ' 天）</div>' : '') + '</div>';
    }
    /* AI 合同 */
    html += '<div class="card"><h3>🤝 AI 连锁供货合同</h3>' +
      (b.offers.length ? b.offers.map(function (o) { var rv = BT.Rivals.get(S, o.rivalId) || {};
        return '<div class="deal-row"><span>' + (rv.icon || '') + (rv.name || '') + ' 想每天进 ' + gname(o.gid) + ' ' + o.qty + ' 件 @' + U.money(o.price) + '，' + o.days + ' 天（日营收约 ' + U.money(o.qty * o.price) + '）</span>' +
          '<button class="small primary" onclick="BT.App.b2bOffer(\'' + o.id + '\',true)">签约</button><button class="small" onclick="BT.App.b2bOffer(\'' + o.id + '\',false)">婉拒</button></div>'; }).join('') : '<div class="hint">暂时没有新邀约。不敌对的 AI 每隔一阵会来找你（态度越好越常来）。</div>') +
      (b.contracts.length ? '<div class="hint" style="margin-top:6px">执行中：</div>' + b.contracts.map(function (c) { var rv = BT.Rivals.get(S, c.rivalId) || {};
        return '<div class="deal-row"><span>' + (rv.icon || '') + (rv.name || '') + '：每天 ' + gname(c.gid) + ' ' + c.qty + ' 件 @' + U.money(c.price) + ' · 还剩 ' + (c.until - S.day) + ' 天' + (c.miss ? ' <span class="tag down">违约 ' + c.miss + ' 次</span>' : '') + '</span>' +
          '<button class="small" title="它 10 天内全城吸引力 ×0.8；你付剩余合同额 20% 违约金，它对你的态度 −30" onclick="BT.App.b2bCut(\'' + c.id + '\')">✂️ 断供</button></div>'; }).join('') : '') +
      '<div class="hint">合同货从任意批发部的仓库出，货到付款；仓库不够就违约赔付，连续 3 次对方终止。它打你价格战时可以断供反击。</div></div>';
    return html;
  }

  /* ---------------------------------------------------------------- 社区团购 */
  function gbTab(S) {
    var G = BT.GroupBuy, g = G.ensure(S), html = '';
    var ban = g.banUntil >= S.day;
    html += '<div class="card"><h3>🛒 社区团购：先收钱、后交货</h3><div class="desc">每晚结单：够人数就成团，<b>当晚收款</b>（记为预收款负债），<b>第二天早上交货</b>（先用仓库 / 门店库存，不够按当天进价现买）。' +
      '预收款可以随便花，但交不了货就违约：退款、口碑和信用大跌；30 天内违约 2 次会被罚款停团。生鲜（水果、蔬菜）最好卖，城中村、学院区最爱团购；会分走同区自家门店约三成的单量。</div>' +
      '<div class="grid cols-4"><div class="kv"><span>预收款（负债）</span><b>' + U.money(G.liability(S)) + '</b></div><div class="kv"><span>昨晚成团订单</span><b>' + (g.last ? g.last.orders : 0) + ' 份</b></div>' +
      '<div class="kv"><span>昨天利润</span>' + (g.last ? sign(g.last.profit) : '<b>-</b>') + '</div><div class="kv"><span>30 天内违约</span><b class="' + (g.defaults.length ? 'down' : '') + '">' + g.defaults.length + ' 次</b></div></div>' +
      (ban ? '<div class="hint down">⚖️ 被监管停团中，还剩 ' + (g.banUntil - S.day + 1) + ' 天</div>' : '') +
      (g.war && g.war.until >= S.day ? '<div class="hint down">🧧 ' + (BT.Rivals.get(S, g.war.by) || {}).name + ' 在' + C.regionMap[g.war.rid].name + '搞补贴大战（还剩 ' + (g.war.until - S.day + 1) + ' 天），那里的团单 −40%</div>' : '') + '</div>';
    /* 明早交货 */
    var needs = G.needs(S);
    html += '<div class="card"><h3>📦 明早要交的货</h3>' + (needs.length ? needs.map(function (n) {
      var short = n.qty > n.have;
      return '<div class="kv"><span>' + rname(n.rid) + ' ' + gname(n.gid) + ' × ' + n.qty + '（已收 ' + U.money(n.paid) + '）</span><b class="' + (short ? 'down' : 'up') + '">' + (short ? '库存 ' + n.have + '，缺的要现买约 ' + U.money(n.buyCost) + (S.cash < n.buyCost ? '（现金不够！）' : '') : '库存够') + '</b></div>';
    }).join('') + '<div class="hint">提前在「供应链」批发进货最省钱；早上现买按零售进价、不打折。</div>' : '<div class="hint">暂无待交订单。</div>') + '</div>';
    /* 开团 */
    var regs = S.unlockedRegions.filter(function (r) { return G.canRun(S, r); });
    html += '<div class="card"><h3>➕ 开团</h3>' + (regs.length && !ban ? '<div class="trade-row gb-form"><select id="gb-r">' + regs.map(function (r) { return '<option value="' + r + '">' + rname(r) + '</option>'; }).join('') + '</select>' +
      '<select id="gb-g"><option value="teacard">🎟️奶茶券（5 杯，要该区有你的奶茶店）</option>' + C.GOODS.filter(function (x) { return !x.lux; }).map(function (x) { return '<option value="' + x.id + '">' + x.icon + x.name + (C.GB.fresh.indexOf(x.id) >= 0 ? '（生鲜）' : '') + '</option>'; }).join('') + '</select>' +
      '<input id="gb-ratio" type="number" step="0.01" min="0.7" max="0.95" value="0.88" title="团购价 = 零售价 × 这个数"><input id="gb-min" type="number" min="5" max="80" value="15" title="成团人数">' +
      '<button class="primary" onclick="BT.App.gbOpen()">开团</button></div><div class="hint">折扣（零售价 × 0.6~0.95，低于 0.75 算「引流款」：亏点钱，第二天同区门店 / 奶茶店多来客人）· 成团人数（不够就全部退款）。奶茶券的钱先到账，顾客 30 天内来兑换，过期作废。同时最多 ' + C.GB.maxGroups + ' 个团，每晚自动结单，直到你停团。</div>'
      : (ban ? '<div class="hint">停团中。</div>' : '<div class="hint">要在有门店的区开团，或者先签团长。</div>')) + '</div>';
    if (g.groups.length) html += '<div class="card"><h3>📣 进行中的团</h3>' + g.groups.map(function (x) {
      var exp = Math.round(G.expect(S, x));
      return '<div class="deal-row"><span>' + rname(x.rid) + ' ' + gname(x.gid) + ' · ¥' + G.priceOf(S, x).toFixed(2) + '（' + Math.round(x.ratio * 100) / 10 + ' 折）· ' + x.minN + ' 人成团 · 预计 ' + exp + ' 单' +
        (x.y ? ' · 昨晚 ' + x.y.n + ' 单' + (x.y.ok ? ' ✅' : ' ❌未成团') : '') + (g.loyal && g.loyal[x.rid] ? ' · 回头客 +' + Math.round(g.loyal[x.rid] * 100) + '%' : '') + (x.ratio < 0.75 ? ' <span class="tag warn">引流</span>' : '') + '</span><button class="small" onclick="BT.App.gbClose(\'' + x.id + '\')">停团</button></div>';
    }).join('') + '</div>';
    /* 团长 */
    html += '<div class="card"><h3>🧍 团长（没门店的区靠他们拉群、分货）</h3><div class="leader-grid">' + S.unlockedRegions.map(function (r) {
      var L = g.leaders[r], shop = S.biz.shops.some(function (s) { return s.regionId === r; });
      return '<div class="kv"><span>' + rname(r) + (shop ? ' <span class="tag">有门店</span>' : '') + '</span><b>' + (L ? '团长 · 忠诚 ' + Math.round(L.loy) : '<button class="small" onclick="BT.App.gbLeader(\'' + r + '\')">签团长 ' + U.money(C.GB.leaderCost) + '</button>') + '</b></div>';
    }).join('') + '</div><div class="hint">团长抽 ' + Math.round(C.GB.comm * 100) + '% 佣金，团单 +25%；违约会让团长忠诚大跌，太低会被对手挖走。</div></div>';
    return html;
  }

  /* ---------------------------------------------------------------- 奶茶店 */
  function teaTab(S) {
    var T = BT.Tea, t = T.ensure(S), html = '';
    html += '<div class="card"><h3>🧋 奶茶店：毛利高、人工重、靠爆品</h3><div class="desc">每个区可以另开一家奶茶店（不占零售店名额）。一杯 ¥8~14，原料 + 杯子约 ¥2.6~4.2，但每个店员一天最多做约 ' + C.TEA.cupsPerStaff + ' 杯，做不过来就排队流失（排长队会涨品牌）。' +
      '鲜果每天坏 30%、基础料坏 10%，备多了浪费、备少了断料。饮品卖久了不新鲜，要研发新品；你卖爆的款，AI 茶饮品牌几天后会跟风。热天卖得多，雨雪天少。</div>' +
      (T.costMul(S) < 1 ? '<div class="hint up">🤝 自家批发部集采：原料便宜 15%</div>' : '<div class="hint">开了批发部之后，奶茶原料走集采能便宜 15%。</div>') +
      (t.collab && t.collab.until >= S.day ? '<div class="tea-trend">🤝 联名进行中：' + esc(t.collab.ip) + '（还剩 ' + (t.collab.until - S.day + 1) + ' 天，客流 ×1.5）</div>' : '') +
      (t.trend && t.trend.until >= S.day ? '<div class="tea-trend">🔥 当前潮流：' + T.P[t.trend.pid].icon + T.P[t.trend.pid].name + '（还剩 ' + (t.trend.until - S.day + 1) + ' 天，上架的店客流翻倍）' + (t.owned.indexOf(t.trend.pid) < 0 ? ' —— 你还没研发！' : '') + '</div>' : '') +
      '<div class="trade-row" style="margin-top:6px;grid-template-columns:1fr auto"><select id="tea-open-r">' + S.unlockedRegions.filter(function (r) { return !t.shops.some(function (s) { return s.rid === r; }); }).map(function (r) {
        var rv = C.TEA.rivals.filter(function (x) { return t.rivals[x.id].regions[r]; }).map(function (x) { return x.icon; }).join('');
        return '<option value="' + r + '">' + rname(r) + ' · 适合度 ' + Math.round((C.TEA.fit[r] || 1) * 100) + '% · 开店 ' + U.money(T.openCost(r, 1)) + (rv ? ' · 对手 ' + rv : '') + '</option>'; }).join('') + '</select>' +
      '<button class="primary" onclick="BT.App.teaOpen()">开奶茶店</button></div></div>';
    /* 研发 */
    html += '<div class="card"><h3>🧪 研发（' + U.money(C.TEA.rdCost) + ' · ' + C.TEA.rdDays + ' 天 · 品质随机 0.6~1.35）</h3>' +
      (t.rd ? '<div class="hint">研发中：' + T.P[t.rd.pid].icon + T.P[t.rd.pid].name + '（' + Math.max(0, t.rd.ready - S.day) + ' 天后出结果）</div>' : '') +
      '<div class="tea-rd">' + C.TEA.products.map(function (p) {
        var own = t.owned.indexOf(p.id) >= 0, q = t.quality[p.id] || p.q;
        return '<div class="tea-prod' + (own ? ' own' : '') + '"><b>' + p.icon + p.name + '</b><span class="hint">建议价 ¥' + p.price + (p.fresh ? ' · 鲜果' : '') + (own ? ' · 品质 ' + q.toFixed(2) : ' · 未研发') + '</span>' +
          '<button class="small" ' + (t.rd ? 'disabled' : '') + ' onclick="BT.App.teaRD(\'' + p.id + '\')">' + (own ? '改良' : '研发') + '</button></div>';
      }).join('') + '</div></div>';
    html += teaFrCard(S);
    t.shops.forEach(function (sh) {
      var L = sh.last || {}, cap = T.cap(sh);
      html += '<div class="card tea-shop"><h3>🧋 ' + rname(sh.rid) + '奶茶店 Lv' + sh.level + (sh.closed > 0 ? ' <span class="tag down">停业整改 ' + sh.closed + ' 天</span>' : '') +
        ' <span class="tag">口碑 ' + Math.round(sh.rep) + '</span> <span class="tag ' + (sh.hygiene < 60 ? 'down' : '') + '">卫生 ' + Math.round(sh.hygiene) + '</span></h3>' +
        '<div class="grid cols-4"><div class="kv"><span>昨天卖出 / 想买</span><b>' + (L.cups || 0) + ' / ' + (L.demand || 0) + ' 杯</b></div>' +
        '<div class="kv"><span>排队流失 / 断料</span><b class="' + ((L.queueLost || 0) + (L.stockLost || 0) ? 'down' : '') + '">' + (L.queueLost || 0) + ' / ' + (L.stockLost || 0) + ' 杯</b></div>' +
        '<div class="kv"><span>昨天营收</span><b>' + U.money(L.rev || 0) + '</b></div><div class="kv"><span>昨天净利</span>' + sign(L.profit || 0) + '</div>' +
        '<div class="kv"><span>原料 / 房租 / 工资</span><b>' + U.money(L.cogs || 0) + ' / ' + U.money(L.rent || T.rent(sh)) + ' / ' + U.money(L.wage || sh.staff * C.TEA.wage) + '</b></div>' +
        '<div class="kv"><span>茶饮市场份额</span><b>' + (L.share != null ? Math.round(L.share * 100) + '%' : '-') + '</b></div>' +
        '<div class="kv"><span>店员 / 日产能</span><b>' + sh.staff + ' 人 / ' + cap + ' 杯 <button class="small" onclick="BT.App.teaStaff(\'' + sh.id + '\',-1)">−</button><button class="small" onclick="BT.App.teaStaff(\'' + sh.id + '\',1)">+</button></b></div>' +
        '<div class="kv"><span>库存原料</span><b>基础 ' + sh.stock.base + ' · 鲜果 ' + sh.stock.fresh + '</b></div>' +
        (L.vouch || L.redeemed ? '<div class="kv"><span>🎟️ 奶茶券 未兑 / 昨天兑换</span><b>' + (L.vouch || 0) + ' / ' + (L.redeemed || 0) + ' 杯</b></div>' : '') + '</div>' +
        '<div class="trade-row" style="grid-template-columns:auto 1fr auto auto auto auto"><span class="hint">每天自动备料到</span><input id="tea-auto-' + sh.id + '" type="number" min="0" max="2000" value="' + sh.auto + '">' +
        '<button class="small" onclick="BT.App.teaAuto(\'' + sh.id + '\')">保存</button><button class="small" onclick="BT.App.teaRestock(\'' + sh.id + '\')">现在补料</button>' +
        '<button class="small" onclick="BT.App.teaClean(\'' + sh.id + '\')">🧽 清洁 ' + U.money(C.TEA.cleanCost) + '</button>' +
        (sh.level < 3 ? '<button class="small" onclick="BT.App.teaUpgrade(\'' + sh.id + '\')">⬆️ 升级 ' + U.money(T.openCost(sh.rid, sh.level + 1)) + '</button>' : '<span></span>') + '</div>' +
        '<div class="tea-menu">' + sh.menu.map(function (m) {
          var p = T.P[m.pid], s7 = U.sum(m.sold7 || []), copied = U.keys(t.rivals).filter(function (r) { var c = t.rivals[r].copies[m.pid]; return c && c <= S.day && t.rivals[r].regions[sh.rid]; });
          return '<div class="tea-item"><b>' + p.icon + p.name + '</b><span class="fresh"><i style="width:' + Math.round(m.fresh * 100) + '%"></i></span><span class="hint">新鲜 ' + Math.round(m.fresh * 100) + '% · 7日 ' + s7 + ' 杯' + (copied.length ? ' · <span class="down">已被跟风</span>' : '') + '</span>' +
            '<span class="price">¥<input id="tea-pr-' + sh.id + '-' + m.pid + '" type="number" min="6" max="40" value="' + m.price + '"><button class="small" onclick="BT.App.teaPrice(\'' + sh.id + '\',\'' + m.pid + '\')">改价</button><button class="small" onclick="BT.App.teaRemove(\'' + sh.id + '\',\'' + m.pid + '\')">下架</button></span></div>';
        }).join('') + '</div>' +
        (sh.menu.length < 4 ? '<div class="trade-row" style="grid-template-columns:1fr auto"><select id="tea-add-' + sh.id + '">' + t.owned.filter(function (p) { return !sh.menu.some(function (m) { return m.pid === p; }); }).map(function (p) { return '<option value="' + p + '">' + T.P[p].icon + T.P[p].name + '</option>'; }).join('') + '</select><button class="small" onclick="BT.App.teaAdd(\'' + sh.id + '\')">上架</button></div>' : '') +
        '<div class="hint">附近对手：' + (C.TEA.rivals.filter(function (r) { return t.rivals[r.id].regions[sh.rid]; }).map(function (r) { return r.icon + r.name + (r.price < 1 ? '（低价走量）' : '（高端网红）'); }).join('、') || '暂无') + '</div></div>';
    });
    return html;
  }

  function teaFrCard(S) {
    var T = BT.Tea, f = (S.biz.tea && S.biz.tea.fr) || { open: false, stores: [], apps: [] }, ok = T.frUnlocked(S), F = C.TEA.fr;
    var html = '<div class="card"><h3>🏪 奶茶加盟</h3><div class="desc">加盟商付 ' + U.money(F.fee) + ' 加盟费，之后每卖一杯给你 ¥' + F.perCup + '（品牌费 + 原料差价）。加盟店出食品安全事故会连累品牌；派督导（每店每天 ¥' + F.supCost + '）能把事故率压到三成。同区加盟店会分走直营店一些客人。</div>';
    if (!ok && !f.stores.length) return html + '<div class="hint">解锁：≥2 家直营奶茶店、品牌 ≥15（现在 ' + ((S.biz.tea && S.biz.tea.shops.length) || 0) + ' 家、品牌 ' + Math.round(S.biz.brand) + '）</div></div>';
    html += '<div class="trade-row" style="grid-template-columns:auto auto 1fr"><button class="small' + (f.open ? ' primary' : '') + '" onclick="BT.App.teaFrToggle()">' + (f.open ? '✅ 招商中（点击暂停）' : '开放招商') + '</button>' +
      '<button class="small' + (f.sup ? ' primary' : '') + '" onclick="BT.App.teaFrSup()">' + (f.sup ? '👮 督导中' : '派驻督导') + '</button><span class="hint">' + (f.last ? '昨天加盟店卖 ' + f.last.cups + ' 杯，你收 ' + U.money(f.last.inc) + (f.last.sup ? '，督导费 ' + U.money(f.last.sup) : '') : '') + '</span></div>';
    html += f.apps.map(function (a) { return '<div class="deal-row"><span>📝 ' + esc(a.owner) + ' 申请在' + C.regionMap[a.rid].name + '开加盟店</span><button class="small primary" onclick="BT.App.teaFrApprove(\'' + a.id + '\')">批准（收 ' + U.money(F.fee) + '）</button><button class="small" onclick="BT.App.teaFrReject(\'' + a.id + '\')">婉拒</button></div>'; }).join('');
    html += f.stores.length ? '<div class="leader-grid">' + f.stores.map(function (st) { return '<div class="kv"><span>' + esc(st.owner) + '</span><b>昨天 ' + (st.cups || 0) + ' 杯 <button class="small" onclick="BT.App.teaFrClose(\'' + st.id + '\')">解约</button></b></div>'; }).join('') + '</div>' : '<div class="hint">还没有加盟店。</div>';
    return html + '</div>';
  }

  /* ---------------------------------------------------------------- 财务 / 简报 / 两难（给 render.js 调用） */
  UI.financeCards = function (S) {
    var I = BT.Insight; if (!I) return '';
    var ser = I.lineSeries(S, 14), sum = I.lineSum(S, 14), keys = [['retail', '🏬 门店', '#6aa3ff'], ['b2b', '🚚 批发', '#f0b43c'], ['gb', '🛒 团购', '#46c47e'], ['tea', '🧋 奶茶', '#c58cff']];
    var max = Math.max.apply(null, keys.map(function (k) { return Math.abs(sum[k[0]]); }).concat([1]));
    var html = '<div class="card"><h3>🧩 分业务线利润（近 14 天）</h3><div class="line-bars">' + keys.map(function (k) {
      var v = sum[k[0]], w = Math.round(Math.abs(v) / max * 100);
      return '<div class="lb-row"><span>' + k[1] + '</span><span class="lb-bar"><i style="width:' + w + '%;background:' + (v < 0 ? '#e5534b' : k[2]) + '"></i></span><b class="' + (v < 0 ? 'down' : 'up') + '">' + (v >= 0 ? '+' : '') + U.money(v) + '</b></div>';
    }).join('') + '</div>' +
      '<table class="mini-table"><tr><th>日期</th>' + keys.map(function (k) { return '<th>' + k[1] + '</th>'; }).join('') + '<th>合计</th></tr>' + ser.slice(-7).reverse().map(function (x) {
        return '<tr><td>第' + x.day + '天</td>' + keys.map(function (k) { return '<td class="' + (x[k[0]] < 0 ? 'down' : '') + '">' + U.money(x[k[0]]) + '</td>'; }).join('') + '<td class="' + (x.total < 0 ? 'down' : 'up') + '">' + U.money(x.total) + '</td></tr>';
      }).join('') + '</table><div class="hint">门店 = 公司总利润减去三条业务线（也含利息、营销等公司层面的费用）。</div></div>';
    var fc = I.forecast(S);
    html += '<div class="card"><h3>💵 现金流预测（未来 7 天）</h3><div class="grid cols-3"><div class="kv"><span>现在现金</span><b>' + U.money(S.cash) + '</b></div><div class="kv"><span>日均经营现金流</span><b class="' + (fc.base < 0 ? 'down' : 'up') + '">' + (fc.base >= 0 ? '+' : '') + U.money(fc.base) + '</b></div>' +
      '<div class="kv"><span>现金还能撑</span><b class="' + (fc.runway != null && fc.runway < 15 ? 'down' : '') + '">' + (fc.runway == null ? '经营现金为正' : fc.runway + ' 天') + '</b></div></div>' +
      '<table class="mini-table"><tr><th>日期</th><th>经营</th><th>已知收付</th><th>当天净流入</th><th>预计现金</th></tr>' + fc.days.map(function (d) {
        return '<tr><td>第' + d.day + '天</td><td>' + U.money(d.base) + '</td><td>' + (d.items.map(function (x) { return x.t + ' ' + (x.v >= 0 ? '+' : '') + U.money(x.v); }).join('；') || '-') + '</td><td class="' + (d.net < 0 ? 'down' : 'up') + '">' + U.money(d.net) + '</td><td class="' + (d.cash < 0 ? 'down' : '') + '">' + U.money(d.cash) + '</td></tr>';
      }).join('') + '</table><div class="hint">经营 = 近 7 天日均利润 − 赊销（钱还没到）+ 利息（记在贷款上、不扣现金）；已知收付 = 应收账款到期、团购明早缺货要现买。团购预收款已经在现金里，但它是要交货的负债。</div></div>';
    return html;
  };
  UI.briefCard = function (S) {
    var I = BT.Insight; if (!I || !S.biz) return '';
    var b = I.brief(S), y = b.y, icon = { bad: '🔴', warn: '🟡', info: '💡' };
    return '<div class="card brief"><h3>☀️ 今日简报 <span class="hint">第 ' + S.day + ' 天</span></h3>' +
      (y ? '<div class="brief-y">昨天：<b class="' + (y.total < 0 ? 'down' : 'up') + '">' + (y.total >= 0 ? '+' : '') + U.money(y.total) + '</b>（门店 ' + U.money(y.retail) + (y.b2b ? ' · 批发 ' + U.money(y.b2b) : '') + (y.gb ? ' · 团购 ' + U.money(y.gb) : '') + (y.tea ? ' · 奶茶 ' + U.money(y.tea) : '') + '）</div>' : '') +
      '<div class="brief-todo">👉 先做：' + esc(b.todo) + '</div>' +
      (b.risks.length ? b.risks.slice(0, 6).map(function (r) { return '<div class="brief-risk ' + r.lv + '">' + icon[r.lv] + ' ' + esc(r.t) + (r.fix ? ' <i>→ ' + esc(r.fix) + '</i>' : '') + '</div>'; }).join('') + (b.risks.length > 6 ? '<div class="hint">还有 ' + (b.risks.length - 6) + ' 条…</div>' : '') : '<div class="hint">今天没有要特别注意的事。</div>') + '</div>';
  };
  UI.dilemmaCard = function (S) {
    var ins = S.biz && S.biz.ins; if (!ins || !ins.dlm.length) return '';
    return '<div class="card dlm-card"><h3>🧭 待你拍板</h3>' + ins.dlm.map(function (d) {
      return '<div class="dlm"><div>' + esc(d.text) + ' <span class="hint">（' + (d.expire - S.day + 1) + ' 天内不拍板，默认「' + esc(d.opts[d.opts.length - 1].label) + '」）</span></div><div class="dlm-opts">' + d.opts.map(function (o, i) {
        return '<button class="small' + (i === 0 ? ' primary' : '') + '" title="' + esc(o.desc) + '" onclick="BT.App.dlm(\'' + d.id + '\',' + i + ')">' + esc(o.label) + '<br><span class="hint">' + esc(o.desc) + '</span></button>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  };

  /* ---------------------------------------------------------------- 按钮动作 */
  var A = BT.App = BT.App || {};
  A.lineTab = function (t) { sub = t; BT.Render._force = true; try { BT.Render.all(); } finally { BT.Render._force = false; } };
  A.b2bOpen = function () { act(BT.B2B.open(BT.S, val('b2b-open-r'))); };
  A.b2bSet = function (rid) { BT.B2B.set(BT.S, rid, 'price', val('b2b-p-' + rid)); act(BT.B2B.set(BT.S, rid, 'term', val('b2b-t-' + rid))); };
  A.b2bOffer = function (id, ok) { act(BT.B2B.respond(BT.S, id, ok)); };
  A.b2bCut = function (id) { if (!confirm('断供要付剩余合同额 20% 的违约金，对方会记恨你。确定？')) return; act(BT.B2B.cutOff(BT.S, id)); };
  A.b2bCollect = function () { act(BT.B2B.collect(BT.S)); };
  A.gbOpen = function () { act(BT.GroupBuy.open(BT.S, val('gb-r'), val('gb-g'), val('gb-ratio'), val('gb-min'))); };
  A.gbClose = function (id) { act(BT.GroupBuy.close(BT.S, id)); };
  A.gbLeader = function (r) { act(BT.GroupBuy.hireLeader(BT.S, r)); };
  A.teaOpen = function () { act(BT.Tea.open(BT.S, val('tea-open-r'))); };
  A.teaRD = function (p) { act(BT.Tea.research(BT.S, p)); };
  A.teaStaff = function (id, d) { act(BT.Tea.staff(BT.S, id, d)); };
  A.teaAuto = function (id) { act(BT.Tea.setAuto(BT.S, id, val('tea-auto-' + id))); };
  A.teaRestock = function (id) { act(BT.Tea.restock(BT.S, BT.Tea.find(BT.S, id))); };
  A.teaClean = function (id) { act(BT.Tea.clean(BT.S, id)); };
  A.teaUpgrade = function (id) { act(BT.Tea.upgrade(BT.S, id)); };
  A.teaPrice = function (id, p) { act(BT.Tea.setPrice(BT.S, id, p, val('tea-pr-' + id + '-' + p))); };
  A.teaRemove = function (id, p) { act(BT.Tea.removeMenu(BT.S, id, p)); };
  A.teaAdd = function (id) { act(BT.Tea.addMenu(BT.S, id, val('tea-add-' + id))); };
  A.b2bFactor = function () { var q = BT.B2B.factorQuote(BT.S); if (!q || !confirm('把 ' + U.money(q.amt) + ' 应收账款卖给银行，立即到账 ' + U.money(q.cash) + '？')) return; act(BT.B2B.factor(BT.S)); };
  A.teaFrToggle = function () { act(BT.Tea.frToggle(BT.S)); };
  A.teaFrSup = function () { act(BT.Tea.frSup(BT.S)); };
  A.teaFrApprove = function (id) { act(BT.Tea.frApprove(BT.S, id)); };
  A.teaFrReject = function (id) { act(BT.Tea.frReject(BT.S, id)); };
  A.teaFrClose = function (id) { if (!confirm('解约这家加盟店？品牌 −1')) return; act(BT.Tea.frClose(BT.S, id)); };
  A.dlm = function (id, i) { act(BT.Insight.resolve(BT.S, id, i)); };
})();
