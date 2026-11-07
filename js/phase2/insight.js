/* ==========================================================================
 * 文件：js/phase2/insight.js
 * 作用：经营洞察（v7.5）—— 让业务多了以后「看得懂、管得过来」
 *   · 分业务线利润：门店 / 批发 / 团购 / 奶茶 各赚多少（来自每日流水里的 lines 字段）；
 *   · 现金流预测：按近 7 天经营 + 已知的收付款（应收账款到期、团购明早缺货要现买、奶茶券兑付）推算未来 7 天现金，算出「现金还能撑几天」；
 *   · 每日简报：昨天各线利润、今天的风险清单、最该先做的一件事；
 *   · 经理托管业务线：批发部自动补货、团购缺货自动进货、奶茶店自动清洁 / 按销量调备料（区域经理开启「托管业务线」时）；
 *   · 两难事件：原料快过期、团长要涨佣金、散户要延长账期、团购被曝光、联名邀约 —— 每个选择影响口碑 / 信用 / 现金。
 * 数据：S.biz.ins = { cash:[{day,cash}], dlm:[], nextDlm }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var I = BT.Insight = {};

  I.ensure = function (S) { var b = S.biz; if (!b) return null; if (!b.ins) b.ins = { cash: [], dlm: [], nextDlm: S.day + 8, seq: 1 }; return b.ins; };

  /* ========================================================================
   * 一、分业务线利润
   * ===================================================================== */
  I.lineSeries = function (S, n) {
    var led = (S.biz && S.biz.ledger || []).slice(-(n || 14));
    return led.map(function (L) {
      var ln = L.lines || {}, b2b = ln.b2b || 0, gb = ln.gb || 0, tea = ln.tea || 0;
      return { day: L.day, retail: Math.round(L.profit - b2b - gb - tea), b2b: Math.round(b2b), gb: Math.round(gb), tea: Math.round(tea), total: Math.round(L.profit) };
    });
  };
  I.lineSum = function (S, n) {
    var s = { retail: 0, b2b: 0, gb: 0, tea: 0, total: 0 };
    I.lineSeries(S, n).forEach(function (x) { U.keys(s).forEach(function (k) { s[k] += x[k]; }); });
    return s;
  };

  /* ========================================================================
   * 二、现金流预测（未来 7 天）
   *   基线 = 近 7 天日均利润 − 日均赊销（钱还没到）+ 日均利息（利息记在贷款上、不扣现金）
   *   再叠加已知事项：应收账款到期回款、团购明早缺货要现买
   * ===================================================================== */
  I.forecast = function (S) {
    var biz = S.biz, led = biz.ledger.slice(-7), n = Math.max(1, led.length);
    var prof = U.sum(led, function (L) { return L.profit; }) / n, intr = U.sum(led, function (L) { return L.interest || 0; }) / n;
    var b = biz.b2b, credit = b ? U.sum((b.hist || []).slice(-7), function (h) { return h.credit || 0; }) / n : 0;
    var base = Math.round(prof - credit + intr);
    var days = [], cash = S.cash;
    var gbShort = BT.GroupBuy ? U.sum(BT.GroupBuy.needs(S), function (x) { return x.buyCost; }) : 0;
    for (var i = 1; i <= 7; i++) {
      var d = S.day + i, items = [];
      var ar = b ? U.sum(b.ar.filter(function (a) { return a.due === d || (i === 1 && a.due < d); }), function (a) { return a.amt; }) : 0;
      if (ar) items.push({ t: '应收账款到期', v: Math.round(ar) });
      if (i === 1 && gbShort) items.push({ t: '团购缺货现买', v: -gbShort });
      var net = base + U.sum(items, function (x) { return x.v; });
      cash += net;
      days.push({ day: d, base: base, items: items, net: Math.round(net), cash: Math.round(cash) });
    }
    var burn = base < 0 ? -base : 0;
    return { base: base, days: days, runway: burn ? Math.floor(Math.max(0, S.cash) / burn) : null, minCash: Math.min.apply(null, days.map(function (x) { return x.cash; })) };
  };

  /* ========================================================================
   * 三、每日简报
   * ===================================================================== */
  I.brief = function (S) {
    var biz = S.biz; if (!biz) return null;
    var y = I.lineSeries(S, 1)[0] || null, risks = [];
    var add = function (lv, t, fix) { risks.push({ lv: lv, t: t, fix: fix || '' }); };
    var fc = I.forecast(S);
    if (fc.runway != null && fc.runway < 15) add('bad', '按现在的速度，现金只够撑约 ' + fc.runway + ' 天（日均净流出 ' + U.money(-fc.base) + '）', '先砍亏损业务、催收账款，或者保理应收账款');
    else if (fc.minCash < 0) add('bad', '未来 7 天现金会跌到 ' + U.money(fc.minCash), '提前准备现金：保理应收账款或贷款');
    if (BT.Rivals) BT.Rivals.threats(S).forEach(function (t) {
      if (t.kind === 'war') add('bad', t.rv.name + ' 在' + C.regionMap[t.rid].name + (t.mode === 'predatory' ? '掠夺定价' : '打价格战') + '（还剩 ' + t.left + ' 天）', '门店开「自动应战」');
      else if (t.kind === 'plan') add('warn', t.rv.name + ' 准备' + (t.act === 'lock' ? '锁你的货源' : (t.act === 'site' ? '抢铺位 / 抬租' : '打价格战')), t.act === 'lock' ? '签长期供货合同' : '提前备好对策');
      else if (t.kind === 'lock') add('warn', C.goodsMap[t.gid].name + ' 被锁货中，批发贵 ' + Math.round((t.mul - 1) * 100) + '%', '换货或签长约');
    });
    if (BT.GroupBuy) BT.GroupBuy.needs(S).forEach(function (n) { if (n.qty > n.have) add(S.cash < n.buyCost ? 'bad' : 'warn', '团购明早要交 ' + C.goodsMap[n.gid].name + ' ' + n.qty + ' 份，库存只有 ' + n.have, S.cash < n.buyCost ? '现金不够现买，会违约！马上进货或筹钱' : '今天批发进货更便宜（早上现买不打折）'); });
    if (biz.gb && biz.gb.banUntil >= S.day) add('warn', '团购被停团中（还剩 ' + (biz.gb.banUntil - S.day + 1) + ' 天）');
    if (biz.b2b) {
      var due = U.sum(biz.b2b.ar.filter(function (a) { return a.due <= S.day + 1; }), function (a) { return a.amt; });
      if (due > 0) add('info', '明天约有 ' + U.money(due) + ' 应收账款到期回款（有坏账风险）');
      if (biz.b2b.war && biz.b2b.war.until >= S.day) add('warn', '巨头在打批发价格战（还剩 ' + (biz.b2b.war.until - S.day + 1) + ' 天）', '降点批发价或给更长账期');
    }
    if (biz.tea) biz.tea.shops.forEach(function (sh) {
      var rn = C.regionMap[sh.rid].name;
      if (sh.hygiene < 65) add(sh.hygiene < 50 ? 'bad' : 'warn', rn + '奶茶店卫生 ' + Math.round(sh.hygiene) + ' 分，抽查会停业', '做一次清洁消杀');
      var stale = sh.menu.filter(function (m) { return m.fresh < 0.4; });
      if (stale.length) add('warn', rn + '奶茶店 ' + stale.map(function (m) { return BT.Tea.P[m.pid].name; }).join('、') + ' 不新鲜了，卖不动', '研发新品或改良');
    });
    if (biz.tea && biz.tea.trend && biz.tea.trend.until >= S.day && biz.tea.owned.indexOf(biz.tea.trend.pid) < 0) add('info', '茶饮潮流「' + BT.Tea.P[biz.tea.trend.pid].name + '」正火，你还没研发', '趁热研发上架');
    biz.shops.forEach(function (sh) { if ((sh.h7 || []).length >= 3 && BT.Biz.diagnose) { var d = BT.Biz.diagnose(S, sh); if (d.grade === 'loss') add('warn', C.regionMap[sh.regionId].name + '门店近 7 天日均亏 ' + U.money(-d.avg.net), (d.items.filter(function (x) { return x.lv !== 'good' && x.w < 90; })[0] || {}).fix || '看门店诊断'); } });
    if (BT.Tender && S.tenders) (S.tenders.list || []).forEach(function (t) { if (t.status === 'won' && t.deadline - S.day <= 3) add('bad', '招标「' + C.goodsMap[t.gid].name + ' ×' + t.qty + '」还有 ' + Math.max(0, t.deadline - S.day) + ' 天到期', '备货交付，逾期罚款扣信用'); });
    var ins = I.ensure(S); if (ins.dlm.length) add('warn', '有 ' + ins.dlm.length + ' 件事等你拍板', '看「待你拍板」');
    var order = { bad: 0, warn: 1, info: 2 }; risks.sort(function (a, b) { return order[a.lv] - order[b.lv]; });
    var todo = risks.filter(function (r) { return r.fix; })[0];
    return { y: y, risks: risks, todo: todo ? todo.fix + '（' + todo.t + '）' : '一切正常，可以考虑扩张或研发新品。', fc: fc };
  };

  /* ========================================================================
   * 四、经理托管业务线（区域经理在岗 + 勾选「托管业务线」）
   * ===================================================================== */
  I.manage = function (S) {
    var biz = S.biz, m = biz && biz.mgr; if (!m || !m.on || m.lines === false) return [];
    var notes = [], reserve = 5000;
    /* 批发部补货：经营中的货（仓库有、或合同要的）低于 150 件就批 200 件（享受批发折扣） */
    if (biz.b2b) U.keys(biz.b2b.depots).forEach(function (rid) {
      var wh = BT.Biz.warehouse(S, rid), need = {};
      C.HAWKERS.goods.forEach(function (g) { if ((wh.goods[g] || 0) > 0 || (wh.carried && wh.carried[g])) need[g] = 1; });
      biz.b2b.contracts.forEach(function (c) { need[c.gid] = 1; });
      U.keys(need).forEach(function (g) {
        wh.carried = wh.carried || {}; wh.carried[g] = true;
        if ((wh.goods[g] || 0) < 150 && S.cash > reserve + BT.Eco.buyPrice(S, g, rid) * 200) { var r = BT.Biz.wholesaleBuy(S, rid, g, 200); if (r.ok) notes.push('批发部补 ' + C.goodsMap[g].name + ' 200 件'); }
      });
    });
    /* 团购缺货：在交货区批发进货（比早上现买便宜） */
    if (BT.GroupBuy) BT.GroupBuy.needs(S).forEach(function (n) {
      var short = n.qty - n.have; if (short <= 0) return;
      var q = Math.max(short, 50); if (S.cash < reserve + BT.Eco.buyPrice(S, n.gid, n.rid) * q) return;
      var r = BT.Biz.wholesaleBuy(S, n.rid, n.gid, q); if (r.ok) notes.push('团购备货 ' + C.goodsMap[n.gid].name + ' ' + q + ' 件');
    });
    /* 奶茶店：卫生低于 65 清洁；备料目标跟着昨天的销量走（多 25% 余量） */
    if (biz.tea) biz.tea.shops.forEach(function (sh) {
      if (sh.hygiene < 65 && S.cash > reserve) { BT.Tea.clean(S, sh.id); notes.push(C.regionMap[sh.rid].name + '奶茶店清洁'); }
      if (sh.last && sh.last.demand != null && !sh.last.closed) { var tgt = U.clamp(Math.round(Math.min(sh.last.demand, BT.Tea.cap(sh)) * 1.25 + 10), 30, 2000); if (Math.abs(tgt - sh.auto) > 10) { sh.auto = tgt; notes.push(C.regionMap[sh.rid].name + '奶茶店备料调到 ' + tgt + ' 杯'); } }
    });
    if (notes.length) m.last = (m.last ? m.last + '；' : '') + '业务线：' + notes.join('、');
    return notes;
  };

  /* ========================================================================
   * 五、两难事件
   * ===================================================================== */
  var DLM = {
    expired: {
      when: function (S) { return S.biz.tea && S.biz.tea.shops.some(function (s) { return s.stock.base >= 40; }); },
      make: function (S) { var sh = rng.pick(S.biz.tea.shops.filter(function (s) { return s.stock.base >= 40; })); return { shop: sh.id, text: '🧋 ' + C.regionMap[sh.rid].name + '奶茶店有一批原料（约 ' + Math.round(sh.stock.base * 0.5) + ' 杯的量）明天就过期了。', opts: [
        { label: '全部倒掉', desc: '损失这批原料，安全第一' }, { label: '偷偷继续用', desc: '省钱，但接下来 10 天抽查更容易出事，出事就是大新闻' }] }; },
      apply: function (S, d, i) {
        var sh = BT.Tea.find(S, d.shop); if (!sh) return '店已不在';
        if (i === 0) { var lost = Math.round(sh.stock.base * 0.5); sh.stock.base -= lost; return '倒掉了 ' + lost + ' 杯的原料。'; }
        sh.risky = S.day + 10; return '继续用了……祈祷别被查到。';
      }
    },
    leaderRaise: {
      when: function (S) { return S.biz.gb && U.keys(S.biz.gb.leaders).length > 0; },
      make: function (S) { var rid = rng.pick(U.keys(S.biz.gb.leaders)); return { rid: rid, text: '🧍 ' + C.regionMap[rid].name + '的团长说：对手出 12% 佣金挖他，要你也涨到 12%，不然就带着群走。', opts: [
        { label: '答应涨到 12%', desc: '佣金变高，团长更死心塌地' }, { label: '谈判：给 ¥1,000 红包、涨到 10%', desc: '花点钱，折中' }, { label: '拒绝', desc: '一半可能他真走，还带走一部分回头客' }] }; },
      apply: function (S, d, i) {
        var g = S.biz.gb, L = g.leaders[d.rid]; if (!L) return '团长已经不在了';
        if (i === 0) { L.comm = 0.12; L.loy = Math.min(100, L.loy + 20); return '佣金涨到 12%，团长很满意。'; }
        if (i === 1) { if (S.cash < 1000) return '现金不够发红包'; BT.Eco.pay(S, 1000, '团长红包'); L.comm = 0.10; L.loy = Math.min(100, L.loy + 8); return '谈成了：佣金 10%。'; }
        if (rng.chance(0.5)) { delete g.leaders[d.rid]; g.loyal = g.loyal || {}; g.loyal[d.rid] = (g.loyal[d.rid] || 0) * 0.7; return '团长真的带着群走了，' + C.regionMap[d.rid].name + '的回头客少了三成。'; }
        L.loy = Math.max(0, L.loy - 15); return '团长嘴上抱怨，暂时没走（忠诚度下降）。';
      }
    },
    termDemand: {
      when: function (S) { return S.biz.b2b && U.keys(S.biz.b2b.depots).some(function (r) { return S.biz.b2b.depots[r].term < 15; }); },
      make: function (S) { var rid = rng.pick(U.keys(S.biz.b2b.depots).filter(function (r) { return S.biz.b2b.depots[r].term < 15; })); var d = S.biz.b2b.depots[rid]; return { rid: rid, text: '🧺 一群散户联名找上门：要' + C.regionMap[rid].name + '批发部把账期从' + (d.term ? d.term + ' 天' : '现结') + '延长到 ' + (d.term ? 15 : 7) + ' 天，不然集体换供应商。', opts: [
        { label: '同意延长', desc: '客户稳了，但回款更慢、坏账更多' }, { label: '拒绝', desc: '账期不变，但供货口碑（稳定性）大降' }] }; },
      apply: function (S, d, i) { var dp = S.biz.b2b.depots[d.rid]; if (!dp) return '批发部已不在'; if (i === 0) { dp.term = dp.term ? 15 : 7; return '账期延长到 ' + dp.term + ' 天。'; } dp.rel = Math.max(0.3, dp.rel - 0.25); return '拒绝了，散户们很不满（供货稳定 −25%）。'; }
    },
    gbScandal: {
      when: function (S) { var g = S.biz.gb; return g && g.hist.slice(-3).some(function (h) { return h.orders >= 30; }); },
      make: function (S) { var g = S.biz.gb, grp = g.groups[0], rid = grp ? grp.rid : U.keys(g.loyal || {})[0] || 'slum'; return { rid: rid, text: '📰 有记者拿着几张「团购生鲜烂了」的照片要发稿，点名你在' + C.regionMap[rid].name + '的团购。', opts: [
        { label: '花 ¥3,000 公关', desc: '稿子撤了，什么都没发生' }, { label: '主动召回、赔付', desc: '赔一笔钱，但回头客和品牌反而涨' }, { label: '不理会', desc: '一半可能不了了之，一半可能品牌和回头客大跌' }] }; },
      apply: function (S, d, i) {
        var g = S.biz.gb; g.loyal = g.loyal || {};
        if (i === 0) { if (S.cash < 3000) return '现金不够'; BT.Eco.pay(S, 3000, '公关费'); return '稿子撤了。'; }
        if (i === 1) { var pay = Math.round(Math.max(800, U.sum(g.hist.slice(-1), function (h) { return h.rev; }) * 0.5)); BT.Eco.pay(S, pay, '团购召回赔付'); g.loyal[d.rid] = Math.min(1, (g.loyal[d.rid] || 0) + 0.15); S.biz.brand = Math.min(100, S.biz.brand + 2); return '召回赔付 ' + U.money(pay) + '，顾客觉得你靠谱（品牌 +2、回头客增加）。'; }
        if (rng.chance(0.5)) { S.biz.brand = Math.max(0, S.biz.brand - 8); g.loyal[d.rid] = (g.loyal[d.rid] || 0) * 0.5; return '稿子发了，品牌 −8，回头客跑了一半。'; }
        return '稿子没掀起什么水花。';
      }
    },
    teaCollab: {
      when: function (S) { return S.biz.tea && S.biz.tea.shops.length > 0 && S.biz.brand >= 12 && !(S.biz.tea.collab && S.biz.tea.collab.until >= S.day); },
      make: function (S) { var ip = rng.pick(['国漫《山海少年》', '人气游戏《星海旅人》', '老字号糕点「福记」', '网红博物馆']); return { ip: ip, text: '🤝 ' + ip + ' 想和你的奶茶店搞联名，授权费 ¥5,000，做 7 天。', opts: [
        { label: '接下联名', desc: '7 天客流 ×1.5；有 20% 可能翻车（品牌 −5）' }, { label: '婉拒', desc: '什么都不变' }] }; },
      apply: function (S, d, i) {
        if (i === 1) return '婉拒了联名。';
        if (S.cash < 5000) return '现金不够付授权费';
        BT.Eco.pay(S, 5000, '联名授权费'); S.biz.tea.collab = { until: S.day + 7, ip: d.ip };
        if (rng.chance(0.2)) { S.biz.brand = Math.max(0, S.biz.brand - 5); return '联名上线了，但包装设计被骂「敷衍」（品牌 −5），客流照样会涨一些。'; }
        return '联名上线！接下来 7 天奶茶店客流 ×1.5。';
      }
    }
  };
  I.resolve = function (S, id, i) {
    var ins = I.ensure(S), d = ins.dlm.filter(function (x) { return x.id === id; })[0]; if (!d) return { ok: false, msg: '事情已经过去了' };
    ins.dlm = ins.dlm.filter(function (x) { return x !== d; });
    var msg = DLM[d.kind].apply(S, d, i);
    BT.Log.add('🧭 ' + d.opts[i].label + '：' + msg, 'event');
    return { ok: true, msg: msg };
  };

  I.dailyTick = function (S) {
    var biz = S.biz; if (!biz) return;
    var ins = I.ensure(S);
    ins.cash.push({ day: S.day, cash: Math.round(S.cash) }); if (ins.cash.length > 30) ins.cash.shift();
    I.manage(S);
    /* 过期没拍板 → 按最后一个选项（通常是拒绝 / 不理会）处理 */
    ins.dlm.slice().forEach(function (d) { if (d.expire < S.day) { var msg = DLM[d.kind].apply(S, d, d.opts.length - 1); ins.dlm = ins.dlm.filter(function (x) { return x !== d; }); BT.Log.add('🧭 没拍板，默认「' + d.opts[d.opts.length - 1].label + '」：' + msg, 'event'); } });
    if (!ins.dlm.length && S.day >= ins.nextDlm && rng.chance(0.08)) {
      var ks = U.keys(DLM).filter(function (k) { return DLM[k].when(S); });
      if (ks.length) { var k = rng.pick(ks), d = DLM[k].make(S); d.id = 'd' + (ins.seq++); d.kind = k; d.expire = S.day + 2; ins.dlm.push(d); ins.nextDlm = S.day + rng.int(5, 9); BT.Log.add('🧭 有件事要你拍板：' + d.text, 'event'); }
    }
  };
})();
