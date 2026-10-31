/* ==========================================================================
 * 文件：js/ui/audio.js
 * 作用：WebAudio 简易音效（无需音频文件）+ 顶栏金额飘字；可在顶栏静音，设置记在 localStorage
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var A = BT.Audio = {}, ctx = null, muted = false;
  try { muted = localStorage.getItem('bt_mute') === '1'; } catch (e) {}

  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, delay, slideTo) {
    if (muted) return; var c = ac(); if (!c) return;
    var t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  A.sfx = function (name) {
    if (name === 'earn') { tone(880, 0.09, 'triangle'); tone(1320, 0.12, 'triangle', 0.07, 0.07); }
    else if (name === 'pay') { tone(300, 0.12, 'square', 0.04); }
    else if (name === 'bad') { tone(200, 0.2, 'sawtooth', 0.05); }
    else if (name === 'sleep') { tone(523, 0.18, 'sine'); tone(392, 0.25, 'sine', 0.07, 0.15); }
    else if (name === 'win') { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.25, 'triangle', 0.09, i * 0.12); }); }
    else if (name === 'click') { tone(1800, 0.03, 'square', 0.015); }
    else if (name === 'coin') { tone(988, 0.07, 'square', 0.05); tone(1319, 0.18, 'square', 0.05, 0.07); }
    else if (name === 'register') { tone(1568, 0.05, 'triangle', 0.06); tone(2093, 0.05, 'triangle', 0.06, 0.05); tone(2637, 0.22, 'triangle', 0.05, 0.1); } /* 收银机“叮” */
    else if (name === 'level') { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.12, 'square', 0.045, i * 0.06); }); }
    else if (name === 'alert') { tone(660, 0.12, 'sawtooth', 0.05); tone(440, 0.2, 'sawtooth', 0.05, 0.13); }
    else if (name === 'error') { tone(220, 0.08, 'square', 0.04); tone(180, 0.14, 'square', 0.04, 0.08); }
    else if (name === 'trade') { tone(700, 0.05, 'triangle', 0.05, 0, 1100); }
    else if (name === 'walk') { tone(160, 0.05, 'triangle', 0.04); tone(140, 0.05, 'triangle', 0.04, 0.16); }
    else if (name === 'pop') { tone(400, 0.08, 'sine', 0.06, 0, 900); }
  };
  A.isMuted = function () { return muted; };
  A.toggle = function () {
    muted = !muted; try { localStorage.setItem('bt_mute', muted ? '1' : '0'); } catch (e) {}
    var b = document.getElementById('btn-mute'); if (b) b.textContent = muted ? '🔇' : '🔊';
    if (!muted) A.sfx('earn');
  };

  /* 金额飘字：挂在现金数字旁边 */
  /* 飘字位置：刚点过按钮（1 秒内）就从按钮处飘起，否则挂在顶栏现金旁 */
  var lastPtr = { x: 0, y: 0, t: 0 };
  document.addEventListener('pointerdown', function (e) { lastPtr = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
  function floatText(text, cls, big) {
    var el = document.createElement('div'), x, y;
    if (Date.now() - lastPtr.t < 1000 && lastPtr.x) { x = lastPtr.x; y = lastPtr.y - 18; el.className = 'float-money rise ' + cls; }
    else {
      var anchor = document.getElementById('tb-cash'); if (!anchor) return;
      var r = anchor.getBoundingClientRect(); x = r.left + r.width / 2; y = r.bottom + 2; el.className = 'float-money ' + cls;
    }
    if (big) el.className += ' big';
    el.textContent = text; el.style.left = x + 'px'; el.style.top = y + 'px';
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 1500);
    /* 顶栏现金跳一下 */
    var cash = document.getElementById('tb-cash'); if (cash) { cash.classList.remove('bump-up', 'bump-down'); void cash.offsetWidth; cash.classList.add(cls === 'up' ? 'bump-up' : 'bump-down'); }
  }
  A.floatText = floatText;
  var pend = 0, timer = null;
  function queue(sign, amount) {
    if (amount < 1) return; pend += sign * amount;
    if (timer) return;
    timer = setTimeout(function () { /* 同一瞬间的多笔合并成一条，避免刷屏 */
      var v = Math.round(pend); pend = 0; timer = null; if (!v) return;
      floatText((v > 0 ? '+¥' : '-¥') + Math.abs(v).toLocaleString('zh-CN'), v > 0 ? 'up' : 'down', Math.abs(v) >= 1000);
      A.sfx(v > 0 ? (v >= 500 ? 'register' : 'earn') : 'pay');
    }, 80);
  }
  BT.Bus.on('earn', function (e) { queue(1, e.amount); });
  BT.Bus.on('pay', function (e) { queue(-1, e.amount); });
  document.addEventListener('DOMContentLoaded', function () { var b = document.getElementById('btn-mute'); if (b) b.textContent = muted ? '🔇' : '🔊'; });
})();
