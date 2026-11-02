/* ==========================================================================
 * 文件：js/phase2/franchise.js
 * 作用：加盟连锁 —— 品牌声望 ≥40 且门店 ≥3 后开放加盟：
 *   你定加盟费和抽成比例 → AI 加盟商陆续申请（加盟费越低、抽成越低、品牌越响，申请越多）→ 你审核 →
 *   加盟店每天按营收给你抽成。资质好的加盟店慢慢提升品牌；资质差的会拖累品牌，甚至闹出丑闻。可以付违约金解约。
 * 数据：S.biz.fr = { open, fee, royalty, stores:[{id,name,rid,quality,grade,opened,paid}], apps:[...], income }
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, rng = BT.rng;
  var Fr = BT.Franchise = {};
  var OWNERS = ['张老板', '刘姐', '陈先生', '王总', '赵阿姨', '黄老板', '周先生', '吴女士', '郑老板', '孙先生', '马总', '林小姐'];
  Fr.MAX = 8;
  Fr.get = function (S) { if (!S.biz) return null; if (!S.biz.fr) S.biz.fr = { open: false, fee: 15000, royalty: 0.06, stores: [], apps: [], income: 0 }; return S.biz.fr; };
  Fr.unlocked = function (S) { return !!(S.biz && S.biz.brand >= 40 && S.biz.shops.length >= 3); };
  Fr.setup = function (S, fee, royalty) {
    var f = Fr.get(S); if (!f) return { ok: false, msg: '还没有公司' };
    if (!Fr.unlocked(S)) return { ok: false, msg: '需要品牌声望 ≥40 且门店 ≥3' };
    f.fee = U.clamp(Math.round(fee / 1000) * 1000, 5000, 50000); f.royalty = U.clamp(Math.round(royalty * 100) / 100, 0.03, 0.15); f.open = true;
    return { ok: true, msg: '加盟招商已开放：加盟费 ' + U.money(f.fee) + '，抽成 ' + Math.round(f.royalty * 100) + '%' };
  };
  Fr.close = function (S) { var f = Fr.get(S); if (f) { f.open = false; f.apps = []; } return { ok: true, msg: '已暂停招商（现有加盟店不受影响）' }; };
  function grade(q) { var n = U.clamp(q + rng.range(-0.12, 0.12), 0, 1); return n >= 0.7 ? 'A' : (n >= 0.45 ? 'B' : 'C'); } /* 资质评估有误差 */
  Fr.approve = function (S, id) {
    var f = Fr.get(S), a = f && f.apps.filter(function (x) { return x.id === id; })[0]; if (!a) return { ok: false, msg: '申请已失效' };
    if (f.stores.length >= Fr.MAX) return { ok: false, msg: '加盟店最多 ' + Fr.MAX + ' 家' };
    f.apps = f.apps.filter(function (x) { return x.id !== id; });
    f.stores.push({ id: BT.uid('frs'), name: a.name, rid: a.rid, quality: a.quality, grade: a.grade, opened: S.day, paid: 0 });
    var old = BT.Eco.cat; BT.Eco.cat = 'biz'; BT.Eco.earn(S, a.fee, '加盟费（' + a.name + '·' + C.regionMap[a.rid].name + '）'); BT.Eco.cat = old;
    return { ok: true, msg: a.name + ' 的加盟店在' + C.regionMap[a.rid].name + '开业' };
  };
  Fr.reject = function (S, id) { var f = Fr.get(S); if (f) f.apps = f.apps.filter(function (x) { return x.id !== id; }); return { ok: true, msg: '已婉拒' }; };
  Fr.terminate = function (S, id) {
    var f = Fr.get(S), st = f && f.stores.filter(function (x) { return x.id === id; })[0]; if (!st) return { ok: false, msg: '加盟店不存在' };
    var pen = Math.round(f.fee * 0.5); if (S.cash < pen) return { ok: false, msg: '违约金不够（' + U.money(pen) + '）' };
    BT.Eco.pay(S, pen, '解除加盟违约金（' + st.name + '）'); f.stores = f.stores.filter(function (x) { return x.id !== id; });
    return { ok: true, msg: '已和 ' + st.name + ' 解约' };
  };
  Fr.dailyTick = function (S) {
    var f = S.biz && S.biz.fr; if (!f) return;
    /* 申请 */
    f.apps = f.apps.filter(function (a) { return a.expire >= S.day; });
    if (f.open && Fr.unlocked(S) && f.stores.length + f.apps.length < Fr.MAX) {
      var attract = (S.biz.brand / 50) * U.clamp(1.25 - f.royalty * 4, 0.5, 1.2) * Math.sqrt(15000 / f.fee);
      if (rng.chance(U.clamp(0.05 * attract, 0.01, 0.15))) {
        var q = rng.range(0.25, 0.95), rid = rng.pick(C.REGIONS).id;
        f.apps.push({ id: BT.uid('fra'), name: rng.pick(OWNERS), rid: rid, quality: q, grade: grade(q), fee: f.fee, expire: S.day + 4 });
        BT.Log.add('🤝 有人想加盟：' + f.apps[f.apps.length - 1].name + ' 想在' + C.regionMap[rid].name + '开加盟店（资质评估 ' + f.apps[f.apps.length - 1].grade + '），4 天内答复。', 'event');
      }
    }
    /* 经营与抽成 */
    var inc = 0;
    f.stores.forEach(function (st) {
      var r = C.regionMap[st.rid], rev = r.traffic * 480 * st.quality * (1 + S.biz.brand / 100) * rng.range(0.8, 1.2) * (BT.Eco.trafficMul ? BT.Eco.trafficMul(S, st.rid) : 1);
      var cut = Math.round(rev * f.royalty); inc += cut; st.paid += cut;
      if (st.quality >= 0.6) S.biz.brand = U.clamp(S.biz.brand + 0.03, 0, 100);
      else if (st.quality < 0.4) {
        S.biz.brand = U.clamp(S.biz.brand - 0.04, 0, 100);
        if (rng.chance(0.012)) { S.biz.brand = U.clamp(S.biz.brand - 4, 0, 100); BT.Log.add('😡 丑闻：' + C.regionMap[st.rid].name + '加盟店（' + st.name + '）卖过期商品被曝光，连累品牌 −4！可以考虑解约。', 'bad'); BT.Bus.emit('fx', { kind: 'alert', text: '😡 加盟店丑闻' }); }
      }
    });
    if (inc > 0) { var old = BT.Eco.cat; BT.Eco.cat = 'biz'; BT.Eco.earn(S, inc, ''); BT.Eco.cat = old; f.income += inc; }
    if (inc > 0 && S.day % 7 === 0) BT.Log.add('🤝 本周加盟抽成累计到账，加盟店 ' + f.stores.length + ' 家，总抽成 ' + U.money(f.income) + '。', 'good');
  };
})();
