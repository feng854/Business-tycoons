/* ==========================================================================
 * 文件：js/ui/map.js
 * 作用：像素风城市地图渲染（Canvas），点击区域节点可移动
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG;
  var MapUI = BT.MapUI = {};
  var canvas, ctx, hoverId = null;

  MapUI.init = function (canvasEl) {
    canvas = canvasEl; ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false; /* 像素风：关闭抗锯齿，避免矩形/图形被模糊插值 */
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', function () { hoverId = null; MapUI.render(); });
  };

  function toLocal(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width / (window.devicePixelRatio || 1);
    var sy = canvas.height / rect.height / (window.devicePixelRatio || 1);
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
  function hitRegion(pt) {
    for (var i = 0; i < C.REGIONS.length; i++) {
      var r = C.REGIONS[i];
      var dx = pt.x - r.x, dy = pt.y - r.y;
      if (dx * dx + dy * dy <= 26 * 26) return r;
    }
    return null;
  }
  function onMove(e) {
    var r = hitRegion(toLocal(e));
    var id = r ? r.id : null;
    if (id !== hoverId) { hoverId = id; MapUI.render(); }
    canvas.style.cursor = r ? 'pointer' : 'default';
  }
  function onClick(e) {
    var r = hitRegion(toLocal(e));
    if (r && BT.App) BT.App.travelTo(r.id);
  }

  /* 简易像素云朵/装饰（纯视觉，不含交互） */
  var DECOR = [
    { x: 500, y: 40, s: 10 }, { x: 40, y: 30, s: 8 }, { x: 260, y: 330, s: 9 }
  ];

  MapUI.render = function () {
    if (!canvas) return;
    var r = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    var w = canvas.clientWidth || 560, h = canvas.clientHeight || 360;
    if (canvas.width !== Math.round(w * r)) { canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); }
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.imageSmoothingEnabled = false; /* resize 会重置 canvas 状态，每帧都要重新关闭 */
    var scaleX = w / 560, scaleY = h / 360;

    /* 背景底色（随天气/时间微调） */
    var S = BT.S;
    var dayPhase = S ? (S.hour < 7 ? 'dawn' : S.hour < 17 ? 'day' : S.hour < 20 ? 'dusk' : 'night') : 'day';
    var bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    var bgColors = { dawn: ['#3b4a6b', '#c98a5b'], day: ['#7fb8e0', '#c9e4b5'],
      dusk: ['#5a4a7a', '#d98a5f'], night: ['#0d1526', '#1b2740'] }[dayPhase];
    bgGrad.addColorStop(0, bgColors[0]); bgGrad.addColorStop(1, bgColors[1]);
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, w, h);

    ctx.save(); ctx.scale(scaleX, scaleY);

    /* 装饰云朵 */
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    DECOR.forEach(function (d) { pixelCloud(d.x, d.y, d.s); });

    /* 区域之间的连线（像素风虚线道路） */
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    var order = ['slum', 'market', 'oldst', 'college', 'cbd', 'port', 'market'];
    ctx.beginPath();
    for (var i = 0; i < order.length - 1; i++) {
      var a = C.regionMap[order[i]], b = C.regionMap[order[i + 1]];
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke(); ctx.setLineDash([]);

    /* 区域节点 */
    C.REGIONS.forEach(function (reg) {
      var unlocked = S && S.unlockedRegions.indexOf(reg.id) >= 0;
      var isHere = S && S.region === reg.id;
      var isHover = hoverId === reg.id;
      drawNode(reg, unlocked, isHere, isHover);
    });

    ctx.restore();
  };

  function pixelCloud(x, y, s) {
    ctx.fillRect(x, y, s * 2, s);
    ctx.fillRect(x - s * 0.6, y + s * 0.3, s * 1.2, s * 0.7);
    ctx.fillRect(x + s * 1.4, y + s * 0.3, s * 1.2, s * 0.7);
  }

  function drawNode(reg, unlocked, isHere, isHover) {
    var x = reg.x, y = reg.y;
    /* 底座阴影 */
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 20, 18, 6, 0, 0, Math.PI * 2); ctx.fill();

    /* 建筑方块（像素风：几个矩形叠加），未解锁则灰暗+问号 */
    var base = unlocked ? reg.theme : '#555b66';
    ctx.fillStyle = base;
    roundRect(x - 18, y - 14, 36, 28, 3); ctx.fill();
    ctx.fillStyle = shade(base, isHover ? 1.15 : 1);
    roundRect(x - 18, y - 22, 36, 10, 3); ctx.fill();

    ctx.strokeStyle = isHere ? '#ffd766' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = isHere ? 3 : 1.5;
    roundRect(x - 18, y - 22, 36, 36, 4); ctx.stroke();

    /* 图标 */
    ctx.font = '18px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(unlocked ? reg.icon : '🔒', x, y - 2);

    /* 名称标签 */
    ctx.font = 'bold 12px "Noto Sans SC", sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    var tw = ctx.measureText(reg.name).width;
    ctx.fillRect(x - tw / 2 - 5, y + 22, tw + 10, 16);
    ctx.fillStyle = unlocked ? '#fff' : '#aaa';
    ctx.fillText(reg.name, x, y + 30);

    if (isHere) {
      ctx.fillStyle = '#ffd766'; ctx.font = '14px sans-serif';
      ctx.fillText('▼', x, y - 34);
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    var b = Math.min(255, Math.round((n & 255) * f));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
})();
