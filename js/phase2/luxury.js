/* ==========================================================================
 * 文件：js/phase2/luxury.js
 * 作用：奢侈品与进口贸易 —— 模拟真实的进口流程：
 *   ① 正规进口（一般贸易）：先拿品牌代理权（授权费 + 每 30 天配额）→ 下单时按实时汇率锁定外币货款 →
 *      海运在途 4 天 → 到港报关（25% 概率被抽中查验，多等 1~3 天）→ 缴关税 / 增值税 / 消费税 → 入库。
 *   ② 水货（平行进口）：不用代理权、不交税，在途 2 天，价格便宜三成多；但每批都可能被海关查扣
 *      （没收货物 + 罚款 + 门店口碑受损），还可能混进假货（被顾客发现 → 口碑大跌）。
 *   奢侈品只能在做过「精品装修」的门店上架，有单独的奢侈品买家客流（商业街最多）。
 * 联动：外币计价，人民币进价随外汇行情变动，可在金融页用外汇仓位对冲；节日旺季需求翻倍；
 *       海关严打新闻让水货查扣率 ×3；关税调整新闻改变正规进口成本。
 * 数据：S.lux = { licenses:{gid:{until, quota, used, period}}, orders:[...], crackdown, dutyAdj, festival, stats }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Lux = BT.Lux = {};
  var T = C.TRADE;

  Lux.ensure = function (S) {
    if (!S.lux) S.lux = { licenses: {}, orders: [], crackdown: 0, dutyAdj: 0, festival: 0, stats: { seized: 0, fines: 0, fakes: 0, imported: 0 } };
    return S.lux;
  };
  Lux.isLux = function (gid) { var g = C.goodsMap[gid]; return !!(g && g.lux); };

  /* ========================================================================
   * 一、价格：外币 × 实时汇率 × 税费
   * ===================================================================== */
  Lux.fx = function (S, ccy) {
    var f = S && S.market && S.market.forex && S.market.forex[ccy];
    return f ? f.price : (ccy === 'usd' ? 7.1 : 7.75);
  };
  Lux.taxMul = function (S, g) {
    var adj = (S && S.lux && S.lux.dutyAdj) || 0;
    return (1 + Math.max(0, g.duty + adj)) * (1 + g.vat) * (1 + g.excise);
  };
  /** 正规进口到岸成本（含全部税费），每件 ¥ */
  Lux.officialCost = function (S, gid) { var g = C.goodsMap[gid]; return U.round2(g.fob * Lux.fx(S, g.ccy) * Lux.taxMul(S, g)); };
  /** 水货拿货价（境外零售渠道，比出厂价贵，但不交税），每件 ¥ */
  Lux.greyCost = function (S, gid) { var g = C.goodsMap[gid]; return U.round2(g.fob * Lux.fx(S, g.ccy) * T.greyMarkup); };
  /** 成本拆解（UI 用） */
  Lux.breakdown = function (S, gid) {
    var g = C.goodsMap[gid], fx = Lux.fx(S, g.ccy), cif = g.fob * fx, adj = (S.lux && S.lux.dutyAdj) || 0;
    var duty = cif * Math.max(0, g.duty + adj), vat = (cif + duty) * g.vat, excise = (cif + duty + vat) * g.excise;
    return { fob: g.fob, ccy: g.ccy.toUpperCase(), fx: fx, cif: U.round2(cif), duty: U.round2(duty), vat: U.round2(vat), excise: U.round2(excise), total: U.round2(cif + duty + vat + excise), grey: Lux.greyCost(S, gid) };
  };

  /* ========================================================================
   * 二、品牌代理权
   * ===================================================================== */
  Lux.licenseFee = function (gid) { var g = C.goodsMap[gid]; return Math.round(g.fob * (g.ccy === 'usd' ? 7.1 : 7.75) * 4 + 3000); };
  Lux.license = function (S, gid) { var l = S.lux && S.lux.licenses[gid]; return l && l.until >= S.day ? l : null; };
  Lux.quotaLeft = function (S, gid) {
    var l = Lux.license(S, gid); if (!l) return 0;
    if (S.day - l.period >= 30) { l.period = S.day; l.used = 0; }
    return Math.max(0, l.quota - l.used);
  };
  Lux.buyLicense = function (S, gid) {
    if (!S.biz) return { ok: false, msg: '成立公司后才能谈品牌代理' };
    var g = C.goodsMap[gid]; if (!g || !g.lux) return { ok: false, msg: '不是奢侈品' };
    var lx = Lux.ensure(S); if (Lux.license(S, gid)) return { ok: false, msg: g.name + ' 代理权还在有效期内' };
    if (S.biz.brand < 15) return { ok: false, msg: '品牌声望太低（需要 ≥15），品牌方不愿授权' };
    var fee = Lux.licenseFee(gid);
    if (S.cash < fee) return { ok: false, msg: '授权费不够（需要 ' + U.money(fee) + '）' };
    BT.Eco.pay(S, fee, g.name + ' 品牌代理授权费');
    lx.licenses[gid] = { until: S.day + T.licenseDays, quota: T.licenseQuota, used: 0, period: S.day };
    return { ok: true, msg: '拿下 ' + g.icon + g.name + ' 代理权：' + T.licenseDays + ' 天，每 30 天可正规进口 ' + T.licenseQuota + ' 件' };
  };

  /* ========================================================================
   * 三、下单进口（货款当场按实时汇率付清 → 在途 → 到港 → 入库）
   * ===================================================================== */
  Lux.order = function (S, regionId, gid, qty, channel) {
    if (!S.biz) return { ok: false, msg: '成立公司后才能做进口贸易' };
    var g = C.goodsMap[gid]; if (!g || !g.lux) return { ok: false, msg: '不是奢侈品' };
    if (!C.regionMap[regionId] || S.unlockedRegions.indexOf(regionId) < 0) return { ok: false, msg: '目的仓库所在区域未解锁' };
    var lx = Lux.ensure(S); qty = Math.floor(qty); if (!(qty >= 1)) return { ok: false, msg: '数量无效' };
    var grey = channel === 'grey';
    if (!grey) {
      if (!Lux.license(S, gid)) return { ok: false, msg: '没有 ' + g.name + ' 的品牌代理权，不能正规进口（可以先买代理权，或者走水货）' };
      var left = Lux.quotaLeft(S, gid); if (qty > left) return { ok: false, msg: '本期配额只剩 ' + left + ' 件' };
    } else if (qty > 20) return { ok: false, msg: '水货一次最多夹带 20 件，多了太显眼' };
    var wh = BT.Biz.warehouse(S, regionId), inTransit = U.sum(lx.orders.filter(function (o) { return o.regionId === regionId; }), function (o) { return o.qty; });
    if (wh.used + inTransit + qty * g.unit > wh.cap) return { ok: false, msg: '目的仓库容量不够' };
    var unit = grey ? Lux.greyCost(S, gid) : Lux.officialCost(S, gid), total = U.round2(unit * qty);
    if (S.cash < total) return { ok: false, msg: '资金不够（需要 ' + U.money(total) + '）' };
    BT.Eco.pay(S, total, (grey ? '水货拿货 ' : '正规进口 ') + g.name + ' x' + qty + '（' + g.ccy.toUpperCase() + ' 汇率 ' + Lux.fx(S, g.ccy).toFixed(4) + '）');
    if (!grey) Lux.license(S, gid).used += qty;
    var lead = grey ? T.greyLead : T.officialLead, inspect = !grey && rng.chance(T.inspectRate);
    if (inspect) lead += rng.int(1, 3);
    var o = { id: BT.uid('imp'), gid: gid, qty: qty, unit: unit, channel: grey ? 'grey' : 'official', regionId: regionId, day: S.day, arrive: S.day + lead, inspect: inspect };
    lx.orders.push(o);
    return { ok: true, msg: (grey ? '水货已下单，' : '已下单进口，') + lead + ' 天后到' + C.regionMap[regionId].name + '仓库' + (inspect ? '（被海关抽中查验，多等几天）' : '') + '，货款 ' + U.money(total) };
  };

  function arrive(S, o) {
    var g = C.goodsMap[o.gid], lx = S.lux, value = o.unit * o.qty;
    if (o.channel === 'grey') {
      var seize = T.seizeRate * (lx.crackdown > 0 ? 3 : 1);
      if (rng.chance(seize)) {
        var fine = Math.round(value * T.fineMul);
        BT.Eco.pay(S, fine, '海关罚款（水货 ' + g.name + '）');
        lx.stats.seized += o.qty; lx.stats.fines += fine;
        S.biz.brand = U.clamp(S.biz.brand - 3, 0, 100);
        S.biz.shops.forEach(function (sh) { if (sh.boutique) sh.reputation = U.clamp(sh.reputation - 8, 0, 100); });
        BT.Log.add('🚨 海关查扣：一批 ' + g.icon + g.name + ' 水货 ×' + o.qty + ' 被没收（货值 ' + U.money(value) + '），另罚款 ' + U.money(fine) + '。品牌 −3，精品店口碑 −8。', 'bad');
        BT.Bus.emit('fx', { kind: 'alert', text: '🚨 水货被海关查扣！' });
        return;
      }
    }
    var wh = BT.Biz.warehouse(S, o.regionId), oldQ = wh.goods[o.gid] || 0;
    wh.cost = wh.cost || {};
    wh.cost[o.gid] = oldQ > 0 ? (oldQ * (wh.cost[o.gid] || o.unit) + o.qty * o.unit) / (oldQ + o.qty) : o.unit;
    wh.goods[o.gid] = oldQ + o.qty;
    if (o.channel === 'grey') { wh.grey = wh.grey || {}; wh.grey[o.gid] = (wh.grey[o.gid] || 0) + o.qty; if (rng.chance(g.fake * 3)) { wh.fake = wh.fake || {}; wh.fake[o.gid] = (wh.fake[o.gid] || 0) + Math.max(1, Math.round(o.qty * 0.3)); } }
    lx.stats.imported += o.qty;
    BT.Log.add('🚢 ' + g.icon + g.name + ' ×' + o.qty + (o.channel === 'grey' ? '（水货）' : '（正规进口，已完税）') + ' 到达' + C.regionMap[o.regionId].name + '仓库。', 'good');
  }

  /* ========================================================================
   * 四、精品装修（奢侈品专柜）
   * ===================================================================== */
  Lux.makeBoutique = function (S, shopId) {
    var shop = BT.Biz.findShop(S.biz, shopId); if (!shop) return { ok: false, msg: '店铺不存在' };
    if (shop.boutique) return { ok: false, msg: '已经是精品店了' };
    if (S.cash < T.boutiqueCost) return { ok: false, msg: '装修费不够（需要 ' + U.money(T.boutiqueCost) + '）' };
    BT.Eco.pay(S, T.boutiqueCost, '精品装修（' + C.regionMap[shop.regionId].name + '）');
    shop.boutique = true; shop.value += T.boutiqueCost * 0.6;
    BT.Bus.emit('fx', { kind: 'level', text: '💎 ' + C.regionMap[shop.regionId].name + ' 精品专柜开业' });
    return { ok: true, msg: C.regionMap[shop.regionId].name + ' 店完成精品装修，可以上架奢侈品了（每天安保保险 ' + U.money(T.boutiqueUpkeep) + '）' };
  };

  /** Biz.dailyTick 调用：精品店的奢侈品买家（单独一股客流，按门店到店人数 × 区域奢侈品比例） */
  Lux.sellInShop = function (S, shop, customers, avgService) {
    var out = { sold: 0, rev: 0, cogs: 0, lost: 0, fakeHit: false };
    if (!shop.boutique) return out;
    var items = U.keys(shop.shelf).filter(Lux.isLux).map(function (gid) {
      var mk = shop.shelf[gid], cost = (shop.cost && shop.cost[gid]) || Lux.officialCost(S, gid);
      return { gid: gid, price: U.round2(Lux.officialCost(S, gid) * mk), cost: cost, appeal: U.clamp(1.4 - (mk - 1) * C.LUX_PRICE_SENS, 0.2, 1.4) };
    });
    if (!items.length) return out;
    var lx = Lux.ensure(S), rate = (C.LUX_RATE[shop.regionId] || 0.002) * (lx.festival > 0 ? 2 : 1);
    /* 同区有高端定位的 AI 对手（星耀集团）在抢奢侈品客户 */
    if (BT.Rivals) BT.Rivals.alive(S).forEach(function (rv) { if (rv.style === 'premium' && rv.shops[shop.regionId]) rate *= 0.7; });
    var buyersN = rng.poisson(customers * rate * (0.6 + avgService * 0.15) * (0.6 + shop.reputation / 125));
    var tot = U.sum(items, function (x) { return x.appeal; });
    for (var i = 0; i < buyersN; i++) {
      var r = rng.next() * tot, pick = items[items.length - 1];
      for (var k = 0; k < items.length; k++) { r -= items[k].appeal; if (r <= 0) { pick = items[k]; break; } }
      if ((shop.inventory[pick.gid] || 0) <= 0) { out.lost++; continue; }
      shop.inventory[pick.gid] -= 1; out.sold++; out.rev += pick.price; out.cogs += pick.cost;
      /* 卖出的是假货？顾客鉴定出来就要退款赔偿，口碑大跌 */
      if (shop.fake && shop.fake[pick.gid] > 0) {
        shop.fake[pick.gid]--;
        if (rng.chance(0.5)) {
          out.rev -= pick.price; out.fakeHit = true; lx.stats.fakes++;
          shop.reputation = U.clamp(shop.reputation - 12, 0, 100); S.biz.brand = U.clamp(S.biz.brand - 2, 0, 100);
          BT.Eco.pay(S, Math.round(pick.price * 0.5), '假货赔偿（' + C.goodsMap[pick.gid].name + '，退一赔半）');
          BT.Log.add('😡 顾客拿去鉴定，发现在' + C.regionMap[shop.regionId].name + '店买的' + C.goodsMap[pick.gid].name + '是假货！全额退款并赔偿，口碑 −12、品牌 −2。', 'bad');
        }
      }
    }
    if (rng.chance(0.012)) { /* 失窃（有安保，概率很低） */
      var have = items.filter(function (x) { return (shop.inventory[x.gid] || 0) > 0; });
      if (have.length) { var t = rng.pick(have); shop.inventory[t.gid]--; BT.Log.add('🕵️ ' + C.regionMap[shop.regionId].name + '精品店丢了一件' + C.goodsMap[t.gid].name + '（保险赔了一半）。', 'bad'); BT.Eco.earn(S, Math.round(t.cost * 0.5), '保险理赔'); }
    }
    return out;
  };
  /** 调货时把水货 / 假货标记一起带到门店 */
  Lux.onTransfer = function (S, wh, shop, gid, qty) {
    if (!Lux.isLux(gid) || !wh.fake || !wh.fake[gid]) return;
    var whQty = (wh.goods[gid] || 0) + qty, share = Math.min(wh.fake[gid], Math.round(wh.fake[gid] * qty / Math.max(1, whQty)) || (qty >= whQty ? wh.fake[gid] : 0));
    if (share <= 0 && rng.chance(qty / Math.max(1, whQty))) share = 1;
    share = Math.min(share, wh.fake[gid]);
    wh.fake[gid] -= share; shop.fake = shop.fake || {}; shop.fake[gid] = (shop.fake[gid] || 0) + share;
  };

  /* ========================================================================
   * 五、每日：到货、代理到期、严打 / 旺季 / 关税新闻
   * ===================================================================== */
  function isFestival(S) {
    var d = U.dateOf(S.day);
    /* 春节前后（1 月下旬~2 月中）、七夕（8 月中）、双十一（11 月 1~11 日）、圣诞（12 月下旬） */
    return (d.m === 1 && d.d >= 20) || (d.m === 2 && d.d <= 15) || (d.m === 8 && d.d >= 10 && d.d <= 20) || (d.m === 11 && d.d <= 11) || (d.m === 12 && d.d >= 18);
  }
  Lux.dailyTick = function (S) {
    if (!S.biz) return;
    var lx = Lux.ensure(S);
    lx.orders = lx.orders.filter(function (o) { if (o.arrive <= S.day) { arrive(S, o); return false; } return true; });
    U.keys(lx.licenses).forEach(function (gid) { var l = lx.licenses[gid]; if (l.until === S.day) BT.Log.add('📄 ' + C.goodsMap[gid].name + ' 品牌代理权今天到期。', 'sys'); if (l.until < S.day) delete lx.licenses[gid]; });
    if (lx.crackdown > 0 && --lx.crackdown === 0) BT.Log.add('🛃 海关专项打击结束，水货查扣率恢复正常。', 'info');
    var fest = isFestival(S);
    if (fest && !lx.festival) BT.Log.add('🎁 礼品旺季到了：奢侈品买家翻倍！', 'good');
    lx.festival = fest ? 1 : 0;
    if (lx.dutyDays > 0 && --lx.dutyDays === 0) { lx.dutyAdj = 0; BT.Log.add('🧾 临时关税调整到期，奢侈品关税恢复。', 'info'); }
    /* 新闻（仅在有奢侈品业务时出现） */
    var active = U.keys(lx.licenses).length || lx.orders.length || S.biz.shops.some(function (sh) { return sh.boutique; });
    if (!active) return;
    if (!lx.crackdown && rng.chance(0.03)) { lx.crackdown = rng.int(8, 14); BT.Log.add('🛃 新闻：海关开展打击走私专项行动，水货查扣率 ×3，持续约 ' + lx.crackdown + ' 天。', 'event'); }
    if (!lx.dutyDays && rng.chance(0.015)) {
      lx.dutyAdj = rng.chance(0.5) ? -0.05 : 0.05; lx.dutyDays = rng.int(20, 40);
      BT.Log.add('🧾 新闻：奢侈品进口关税临时' + (lx.dutyAdj < 0 ? '下调' : '上调') + ' 5 个百分点，持续约 ' + lx.dutyDays + ' 天' + (lx.dutyAdj < 0 ? '，正规进口更划算了。' : '，水货的价格优势更大了。'), 'event');
    }
  };

  /** 在途订单（UI） */
  Lux.inTransit = function (S) { return (S.lux && S.lux.orders) || []; };
})();
