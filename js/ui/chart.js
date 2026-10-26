/* ==========================================================================
 * 文件：js/ui/chart.js
 * 作用：K线图 / 折线图渲染（Canvas 2D，不依赖第三方图表库）
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var Chart = BT.Chart = {};

  var COL = {
    up: '#e5534b', down: '#2f9e5e', grid: '#2a2f3a', axis: '#6b7280',
    text: '#c9d1d9', bg: 'transparent', line: '#4f8ff7', vol: '#394150'
  };

  function dpr() { return Math.max(1, Math.min(2, window.devicePixelRatio || 1)); }

  /** 把 canvas 的像素尺寸同步到其 CSS 显示尺寸（保证清晰不糊） */
  function fit(canvas) {
    var r = dpr();
    var w = canvas.clientWidth || 600, h = canvas.clientHeight || 300;
    if (canvas.width !== Math.round(w * r) || canvas.height !== Math.round(h * r)) {
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  /* ========================================================================
   * 一、K线图（含成交量子图）
   *    candles: [{day,o,h,l,c,v}]  markers: [{day, text, color}] 可选标注（如财报日）
   * ===================================================================== */
  Chart.drawCandles = function (canvas, candles, opts) {
    opts = opts || {};
    var f = fit(canvas), ctx = f.ctx, W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);
    if (!candles || !candles.length) { emptyState(ctx, W, H); return; }

    var showVol = opts.volume !== false;
    var padL = 54, padR = 12, padT = 14, padB = showVol ? 70 : 28;
    var volH = showVol ? 46 : 0;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var n = candles.length;
    var slotW = plotW / n;
    var bodyW = Math.max(2, Math.min(14, slotW * 0.62));

    var hi = -Infinity, lo = Infinity, volMax = 0;
    candles.forEach(function (c) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; if (c.v > volMax) volMax = c.v; });
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.08; hi += pad; lo -= pad;

    function y(price) { return padT + (hi - price) / (hi - lo) * plotH; }
    function x(i) { return padL + i * slotW + slotW / 2; }

    /* 网格 + 价格轴 */
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1; ctx.font = '11px "Noto Sans SC", sans-serif';
    ctx.fillStyle = COL.axis; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    var rows = 4;
    for (var g = 0; g <= rows; g++) {
      var py = padT + (plotH * g / rows);
      ctx.beginPath(); ctx.moveTo(padL, py + 0.5); ctx.lineTo(W - padR, py + 0.5); ctx.stroke();
      var priceAt = hi - (hi - lo) * g / rows;
      ctx.fillText(priceAt >= 1000 ? priceAt.toFixed(0) : priceAt.toFixed(2), 2, py);
    }

    /* K线 */
    candles.forEach(function (c, i) {
      var cx = x(i); var up = c.c >= c.o;
      ctx.strokeStyle = ctx.fillStyle = up ? COL.up : COL.down;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y(c.h)); ctx.lineTo(cx, y(c.l)); ctx.stroke();
      var top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
      var bh = Math.max(1, bot - top);
      ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    });

    /* 事件标注（财报/新闻） */
    if (opts.markers) {
      opts.markers.forEach(function (mk) {
        var idx = candles.findIndex(function (c) { return c.day === mk.day; });
        if (idx < 0) return;
        var cx = x(idx);
        ctx.fillStyle = mk.color || '#d4a72c';
        ctx.beginPath(); ctx.moveTo(cx, padT - 2); ctx.lineTo(cx - 4, padT + 6); ctx.lineTo(cx + 4, padT + 6); ctx.closePath(); ctx.fill();
      });
    }

    /* 成交量子图 */
    if (showVol) {
      var volTop = padT + plotH + 14, volBottom = volTop + volH;
      ctx.fillStyle = COL.axis; ctx.font = '10px sans-serif'; ctx.fillText('成交量', 2, volTop - 6);
      candles.forEach(function (c, i) {
        var cx = x(i); var up = c.c >= c.o;
        var bh = volMax > 0 ? (c.v / volMax) * volH : 0;
        ctx.fillStyle = up ? 'rgba(229,83,75,0.55)' : 'rgba(47,158,94,0.55)';
        ctx.fillRect(cx - bodyW / 2, volBottom - bh, bodyW, bh);
      });
    }

    /* 横轴日期（首/中/尾） */
    ctx.fillStyle = COL.axis; ctx.textAlign = 'center'; ctx.font = '10px sans-serif';
    [0, Math.floor(n / 2), n - 1].forEach(function (i) {
      ctx.fillText('D' + candles[i].day, x(i), H - 6);
    });

    /* 最新价横线 */
    var last = candles[n - 1];
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#d4a72c';
    ctx.beginPath(); ctx.moveTo(padL, y(last.c)); ctx.lineTo(W - padR, y(last.c)); ctx.stroke();
    ctx.setLineDash([]);
  };

  /* ========================================================================
   * 二、折线图（净资产曲线 / 大盘指数）
   * ===================================================================== */
  Chart.drawLine = function (canvas, points, opts) {
    opts = opts || {};
    var f = fit(canvas), ctx = f.ctx, W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);
    if (!points || points.length < 2) { emptyState(ctx, W, H); return; }
    var padL = 54, padR = 12, padT = 14, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var hi = -Infinity, lo = Infinity;
    points.forEach(function (p) { if (p.v > hi) hi = p.v; if (p.v < lo) lo = p.v; });
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.1; hi += pad; lo -= pad;
    function y(v) { return padT + (hi - v) / (hi - lo) * plotH; }
    function x(i) { return padL + (i / (points.length - 1)) * plotW; }

    ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.axis; ctx.font = '11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var py = padT + plotH * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, py + 0.5); ctx.lineTo(W - padR, py + 0.5); ctx.stroke();
      var val = hi - (hi - lo) * g / 4;
      ctx.fillText(BT.U.compact(val, 1), 2, py);
    }

    /* 渐变填充 */
    var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, 'rgba(79,143,247,0.35)'); grad.addColorStop(1, 'rgba(79,143,247,0.02)');
    ctx.beginPath(); ctx.moveTo(x(0), y(points[0].v));
    points.forEach(function (p, i) { ctx.lineTo(x(i), y(p.v)); });
    ctx.lineTo(x(points.length - 1), padT + plotH); ctx.lineTo(x(0), padT + plotH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath(); ctx.strokeStyle = opts.color || COL.line; ctx.lineWidth = 2;
    points.forEach(function (p, i) { var fn = i === 0 ? 'moveTo' : 'lineTo'; ctx[fn](x(i), y(p.v)); });
    ctx.stroke();

    ctx.fillStyle = COL.axis; ctx.textAlign = 'center';
    [0, Math.floor(points.length / 2), points.length - 1].forEach(function (i) {
      ctx.fillText(points[i].label != null ? ('D' + points[i].label) : '', x(i), H - 8);
    });
  };

  function emptyState(ctx, W, H) {
    ctx.fillStyle = COL.axis; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('暂无数据', W / 2, H / 2);
  }
})();
