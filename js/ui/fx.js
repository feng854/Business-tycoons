/* ==========================================================================
 * 文件：js/ui/fx.js
 * 作用：反馈与手感 —— 庆祝横幅 + 彩纸、按钮音效、现金数字滚动、错误提示音；
 *       交互式新手引导（高亮目标按钮，一步步带玩家走完 打工→进货→摆摊→睡觉）；
 *       离线收益（关掉游戏一段时间后回来，店员照常营业，按最近利润发一笔收益）。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var U = BT.U;
  var FX = BT.FX = {};
  var sfx = function (n) { if (BT.Audio) BT.Audio.sfx(n); };

  /* ========================================================================
   * 一、庆祝 / 警告横幅（排队依次播放，最多积压 3 条）
   * ===================================================================== */
  var queue = [], showing = false;
  FX.banner = function (text, kind) {
    if (queue.length >= 3) queue.shift();
    queue.push({ text: text, kind: kind || 'level' });
    if (!showing) next();
  };
  function next() {
    var b = queue.shift(); if (!b) { showing = false; return; }
    showing = true;
    var el = document.createElement('div');
    el.className = 'fx-banner ' + b.kind; el.textContent = b.text;
    document.body.appendChild(el);
    if (b.kind === 'alert') sfx('alert');
    else { sfx(b.kind === 'big' ? 'win' : 'level'); confetti(b.kind === 'big' ? 46 : 22); }
    setTimeout(function () { el.classList.add('out'); }, 1500);
    setTimeout(function () { el.remove(); next(); }, 1850);
  }
  var COLORS = ['#ffd766', '#4f8ff7', '#46c47e', '#ff6b63', '#c58cff', '#4fd1c5'];
  function confetti(n) {
    var cx = window.innerWidth / 2, cy = window.innerHeight * 0.32;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i'); p.className = 'confetti';
      var ang = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 180;
      p.style.left = cx + 'px'; p.style.top = cy + 'px'; p.style.background = COLORS[i % COLORS.length];
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px'); p.style.setProperty('--dy', (Math.sin(ang) * dist * 0.6 + 120) + 'px');
      p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      document.body.appendChild(p);
      (function (q) { setTimeout(function () { q.remove(); }, 1300); })(p);
    }
  }
  FX.confetti = confetti;

  BT.Bus.on('fx', function (e) { if (e && e.text) FX.banner(e.text, e.kind === 'alert' ? 'alert' : (e.kind === 'big' ? 'big' : 'level')); });
  BT.Bus.on('milestone', function (m) { FX.banner('🏆 里程碑达成：' + m.name, 'big'); });
  BT.Bus.on('phase', function (p) { FX.banner(p === 2 ? '📈 进入第二阶段「商业扩张」' : '🌍 进入「资本帝国」', 'big'); });
  BT.Bus.on('achievement', function (a) { FX.banner('🎖️ 成就解锁：' + a.name, 'level'); });

  /* ========================================================================
   * 二、按钮音效 / 失败提示音 / 现金数字滚动
   * ===================================================================== */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button');
    if (b && !b.disabled) sfx('click');
  }, true);
  /** 数字从 from 滚到 to（约 0.4 秒） */
  FX.tween = function (el, from, to, fmt) {
    if (!el) return;
    if (el._tw) cancelAnimationFrame(el._tw);
    if (from == null || !isFinite(from) || from === to || Math.abs(to - from) < 1) { el.textContent = fmt(to); return; }
    var t0 = performance.now(), dur = 420;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) el._tw = requestAnimationFrame(step); else el._tw = null;
    })(t0);
  };

  /* ========================================================================
   * 三、交互式新手引导
   * ===================================================================== */
  var TUT_KEY = 'bt_tut_done';
  function bagQty(S) { var n = 0; U.keys(S.bag).forEach(function (g) { (S.bag[g] || []).forEach(function (l) { n += l.qty; }); }); return n; }
  function tabIs(t) { var p = document.querySelector('.tabpage.active'); return p && p.id === 'tab-' + t; }
  var STEPS = [
    { text: '👋 欢迎来到新港市！你身上只有一点钱。跟着高亮提示走一遍最基本的赚钱循环：<b>打工 → 进货 → 摆摊 → 睡觉</b>。', btn: '开始引导' },
    { target: '[data-tab="jobs"]', text: '先去「打工与技能」赚点启动资金。', done: function (S) { return tabIs('jobs') || S.questChain >= 1; } },
    { target: '#jobs-list button.primary:not([disabled])', text: '点「开始」做一份临时工。打工会消耗<b>时间、体力和精力</b>，同一份工每天最多做 3 次，越往后报酬越低。', done: function (S) { return S.questChain >= 1 || (S.progress && S.progress.jobCount >= 1); } },
    { target: '[data-tab="trade"]', text: '有了本钱，去「交易」进点货。', done: function (S) { return tabIs('trade') || bagQty(S) > 0; } },
    { target: '#trade-goods-list .item-row button.primary', text: '买入一些便宜的商品，比如🥤饮料、🍪零食（🥬蔬菜这类易腐品会每天损耗）。不同区域价格不同，「比价」可以看差价。', done: function (S) { return bagQty(S) > 0; } },
    { target: '[data-tab="stall"]', text: '去「摆摊」把货卖出去。', done: function (S) { return tabIs('stall') || !!S.stall; } },
    { target: '#stall-box button', text: '选一件背包里的商品作为主打，在当前区域开摊。', done: function (S) { return !!S.stall; } },
    { target: '#stall-box button.primary', text: '点「营业一轮」。上面的滑块是定价：贵了卖得少、便宜了赚得少，自己试试最赚钱的位置。', done: function (S) { return S.questChain >= 3 || (S.stall && S.stall.daysOpen >= 1); } },
    { target: '#btn-sleep', text: '一天结束就「睡觉」：结算房租伙食、恢复体力，第二天天气和行情都会变。', done: function (S) { return S.day > (S.tut.startDay || 1); } },
    { text: '🎉 引导完成！接下来：净资产 ¥1,000 解锁更多机会，¥10,000 成立公司——那时你会遇到几家 <b>AI 竞争对手</b>。📈 金融市场随时都能交易。顶部「💾」随时存档，有 6 个存档位。', btn: '开始经营' }
  ];
  FX.tutActive = function () { var S = BT.S; return !!(S && S.tut && !S.tut.done); };
  FX.tutStart = function () { var S = BT.S; if (!S) return; S.tut = { step: 0, startDay: S.day }; renderTut(); };
  FX.tutSkip = function () { var S = BT.S; if (S) S.tut = { done: true }; try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {} clearTut(); };
  FX.tutNext = function () {
    var S = BT.S; if (!FX.tutActive()) return;
    S.tut.step++; sfx('pop');
    if (S.tut.step >= STEPS.length) { FX.tutSkip(); FX.banner('🎓 新手引导完成', 'level'); return; }
    if (STEPS[S.tut.step].target === '#btn-sleep') S.tut.startDay = S.day;
    renderTut();
  };
  FX.tutSeen = function () { try { return localStorage.getItem(TUT_KEY) === '1'; } catch (e) { return false; } };
  function clearTut() { ['tut-hole', 'tut-tip'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); }); }
  function renderTut() {
    var S = BT.S; if (!FX.tutActive()) { clearTut(); return; }
    var st = STEPS[S.tut.step]; if (!st) { clearTut(); return; }
    var hole = document.getElementById('tut-hole'), tip = document.getElementById('tut-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'tut-tip'; document.body.appendChild(tip); }
    var key = S.tut.step + '';
    if (tip.getAttribute('data-k') !== key) {
      tip.setAttribute('data-k', key);
      tip.innerHTML = '<div class="tut-step">新手引导 ' + (S.tut.step + 1) + '/' + STEPS.length + '</div><div>' + st.text + '</div>' +
        '<div class="tut-btns">' + (st.btn ? '<button class="small primary" onclick="BT.FX.tutNext()">' + st.btn + '</button>' : '') +
        '<button class="small" onclick="BT.FX.tutSkip()">跳过引导</button></div>';
    }
    var el = st.target ? Array.prototype.filter.call(document.querySelectorAll(st.target), function (x) { return x.offsetParent !== null; })[0] : null;
    if (el) {
      var r = el.getBoundingClientRect();
      if (!hole) { hole = document.createElement('div'); hole.id = 'tut-hole'; document.body.appendChild(hole); }
      hole.style.left = (r.left - 6) + 'px'; hole.style.top = (r.top - 6) + 'px'; hole.style.width = (r.width + 12) + 'px'; hole.style.height = (r.height + 12) + 'px';
      var below = r.bottom + 170 < window.innerHeight;
      var tw = tip.offsetWidth || 300, left = U.clamp(r.left + r.width / 2 - tw / 2, 8, Math.max(8, window.innerWidth - tw - 8));
      tip.className = 'anchored'; tip.style.left = left + 'px'; tip.style.top = (below ? r.bottom + 14 : Math.max(8, r.top - tip.offsetHeight - 14)) + 'px';
    } else {
      if (hole) hole.remove();
      tip.className = 'center'; tip.style.left = ''; tip.style.top = '';
    }
  }
  setInterval(function () {
    var S = BT.S; if (!FX.tutActive()) { if (document.getElementById('tut-tip')) clearTut(); return; }
    var st = STEPS[S.tut.step];
    if (st && st.done && st.done(S)) { FX.tutNext(); return; }
    renderTut();
  }, 350);
  window.addEventListener('resize', function () { if (FX.tutActive()) renderTut(); });

  /* ========================================================================
   * 四、离线收益：按最近 7 天平均日利润（只算正的）+ 物业租金的 50%，最多结算 12 小时
   * ===================================================================== */
  FX.OFFLINE_MAX_H = 12; FX.OFFLINE_RATE = 0.5;
  FX.offlineQuote = function (S, now) {
    if (!S || S.challenge || S.gameOver || !S.updatedAt) return null;
    var hrs = ((now || Date.now()) - S.updatedAt) / 3600000;
    if (!(hrs >= 0.25)) return null;
    var daily = 0;
    if (S.biz && S.biz.shops.length && S.biz.ledger.length) {
      var l7 = S.biz.ledger.slice(-7); daily += Math.max(0, U.sum(l7, function (x) { return x.profit; }) / l7.length);
    }
    if (S.estate && BT.Empire) U.keys(S.estate).forEach(function (rid) { daily += BT.Empire.dailyRent(S, rid); });
    var h = Math.min(hrs, FX.OFFLINE_MAX_H), amt = Math.round(daily * h / 24 * FX.OFFLINE_RATE);
    if (amt < 5) return null;
    return { hours: hrs, counted: h, amount: amt, daily: Math.round(daily) };
  };
  FX.checkOffline = function () {
    var S = BT.S, q = FX.offlineQuote(S); if (!q) return;
    var mask = document.createElement('div'); mask.className = 'modal-mask'; mask.id = 'offline-mask';
    var hh = q.hours >= 24 ? Math.floor(q.hours / 24) + ' 天 ' + Math.round(q.hours % 24) + ' 小时' : (q.hours >= 1 ? q.hours.toFixed(1) + ' 小时' : Math.round(q.hours * 60) + ' 分钟');
    mask.innerHTML = '<div class="modal-box offline-box"><h2>🌙 欢迎回来！</h2><p>你离开了 <b>' + hh + '</b>，店员和物业照常运转。</p>' +
      '<div class="offline-amt">+' + U.money(q.amount) + '</div>' +
      '<p class="hint">按最近 7 天平均日利润 ' + U.money(q.daily) + ' 的 50% 计算，最多结算 ' + FX.OFFLINE_MAX_H + ' 小时（游戏内时间不会推进）。</p>' +
      '<div class="modal-actions"><button class="primary" onclick="BT.FX.claimOffline(' + q.amount + ')">领取</button></div></div>';
    document.body.appendChild(mask);
  };
  FX.claimOffline = function (amt) {
    var S = BT.S, m = document.getElementById('offline-mask'); if (m) m.remove();
    if (!S) return;
    var old = BT.Eco.cat; BT.Eco.cat = 'biz'; BT.Eco.earn(S, amt, '离线收益'); BT.Eco.cat = old;
    S.updatedAt = Date.now(); BT.save(); confetti(30); sfx('register');
    BT.Bus.emit('changed');
  };
})();
