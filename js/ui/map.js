/* ==========================================================================
 * 文件：js/ui/map.js   （2.5D 等距城市地图 · v2 精细版）
 * 作用：Canvas 绘制整座「新港市」：9 个街区、6 个可前往区域 + 3 个装饰街区，
 *       带道路/人行道/斑马线/红绿灯、车辆与行人、昼夜光影、天气、潮汐水面。
 * 交互：滚轮缩放、拖动平移、点击建筑前往、悬停显示信息卡、右上角放大/复位。
 *
 * 目录
 *   一、常量与布局          五、各街区建筑（场景构建）
 *   二、投影与绘图基础      六、动态对象：车辆 / 行人 / 玩家
 *   三、立体构件（棱柱/屋顶/窗户）七、天空、天气、光效
 *   四、地面静态层（缓存）  八、主循环与交互
 *
 * 坐标约定：网格单位 (u,v)，12×12 格；屏幕 x=OX+(u-v)*TW/2，y=OY+(u+v)*TH/2-z
 *          u 向右下、v 向左下；z 为像素高度。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG;
  var MapUI = BT.MapUI = {};

  /* ========================================================================
   * 一、常量与布局
   *    道路位于第 3、7 行/列；街区区间：A=0..3，B=4..7，C=8..12
   * ===================================================================== */
  var W = 1000, H = 620;
  var TW = 80, TH = 40, OX = 500, OY = 86, N = 12;
  var ROADS = [3, 7];
  var FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

  /* 6 个区域所在街区、主入口（人行道上的站立点）、悬浮标签高度 */
  var REGION_BLOCK = {
    oldst:   { u0: 0, v0: 0, u1: 3,  v1: 3,  door: { u: 1.5, road: 3 }, top: 46 },
    college: { u0: 8, v0: 0, u1: 12, v1: 3,  door: { u: 9.5, road: 3 }, top: 78 },
    slum:    { u0: 0, v0: 8, u1: 3,  v1: 12, door: { u: 1.5, road: 7 }, top: 34 },
    cbd:     { u0: 4, v0: 4, u1: 7,  v1: 7,  door: { u: 5.5, road: 3 }, top: 140 },
    market:  { u0: 4, v0: 8, u1: 7,  v1: 12, door: { u: 5.5, road: 7 }, top: 40 },
    port:    { u0: 8, v0: 8, u1: 12, v1: 12, door: { u: 9.5, road: 7 }, top: 70 }
  };
  /* 地面类型（装饰街区） */
  var GROUND_TYPE = {
    '0,0': 'stone', '2,0': 'lawn', '0,2': 'dirt', '1,1': 'plaza', '1,2': 'yard', '2,2': 'concrete',
    '1,0': 'park', '0,1': 'lawn2', '2,1': 'asphalt'
  };

  var canvas, ctx, hoverId = null, lastT = 0, rafId = 0;
  var view = { zoom: 1, panX: 0, panY: 0, k: 1, cw: W, ch: H };
  var env = { t: 0, phase: 'day', lit: false, wk: 'sunny', shadow: { x: 0, y: 0.2, a: 0.2 } };
  var glows = [];

  /* ========================================================================
   * 二、投影与绘图基础
   * ===================================================================== */
  function P(u, v, z) { return { x: OX + (u - v) * TW / 2, y: OY + (u + v) * TH / 2 - (z || 0) }; }
  function parse(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  var grey = false; /* 绘制未解锁区域时置 true：颜色整体去饱和变暗（比 ctx.filter 快得多） */
  function desat(c) { var l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return [(c[0] * 0.2 + l * 0.8) * 0.85, (c[1] * 0.2 + l * 0.8) * 0.85, (c[2] * 0.2 + l * 0.8) * 0.88]; }
  function shade(hex, f) {
    var c = parse(hex); if (grey) c = desat(c);
    return 'rgb(' + Math.min(255, Math.round(c[0] * f)) + ',' + Math.min(255, Math.round(c[1] * f)) + ',' + Math.min(255, Math.round(c[2] * f)) + ')';
  }
  function mix(h1, h2, t) {
    var a = parse(h1), b = parse(h2); if (grey) { a = desat(a); b = desat(b); }
    return '#' + [0, 1, 2].map(function (i) { var v = Math.round(a[i] + (b[i] - a[i]) * t); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function hash(a, b) { var x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
  function poly(pts, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function ell(x, y, rx, ry, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fill(); }
  function rrect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hull(pts) { /* 凸包（单调链），用于阴影与点击区域 */
    pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  function inPoly(pt, poly_) {
    var inside = false;
    for (var i = 0, j = poly_.length - 1; i < poly_.length; j = i++) {
      var a = poly_[i], b = poly_[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function glow(x, y, r, rgb, a) { if (env.lit) glows.push({ x: x, y: y, r: r, c: rgb, a: a }); }

  function dayPhase() {
    var S = BT.S; if (!S) return 'day';
    var h = S.hour;
    return h < 7 ? 'dawn' : h < 17 ? 'day' : h < 20 ? 'dusk' : 'night';
  }

  /* ========================================================================
   * 三、立体构件
   * ===================================================================== */
  /** 地面投影：按太阳方向把棱柱底面沿阴影向量拉伸，取凸包 */
  function shadowOf(u0, v0, u1, v1, h) {
    var s = env.shadow; if (s.a <= 0.01 || h < 3) return;
    var base = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], all = base.slice();
    base.forEach(function (p) { all.push({ x: p.x + s.x * h, y: p.y + s.y * h }); });
    poly(hull(all), 'rgba(12,20,40,' + s.a + ')');
  }

  /** 长方体：覆盖 [u0,u1]×[v0,v1]，底 z0，高 h。o.band=玻璃带状窗；o.line=楼层线 */
  function prism(u0, v0, u1, v1, z0, h, base, o) {
    o = o || {};
    if (z0 === 0 && o.shadow !== false) shadowOf(u0, v0, u1, v1, h);
    var zt = z0 + h;
    var Lf = [P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, zt), P(u0, v1, zt)];
    var Rf = [P(u1, v1, z0), P(u1, v0, z0), P(u1, v0, zt), P(u1, v1, zt)];
    var Tp = [P(u0, v0, zt), P(u1, v0, zt), P(u1, v1, zt), P(u0, v1, zt)];
    var hv = o.hover ? 1.12 : 1;
    poly(Lf, shade(base, 0.94 * hv)); poly(Rf, shade(base, 0.66 * hv)); poly(Tp, shade(base, (o.topMul || 1.14) * hv));
    /* 楼层线 / 砖缝：增加质感 */
    if (o.line) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1; ctx.beginPath();
      for (var k = 1; k < h / o.line; k++) {
        var t = k * o.line / h;
        ctx.moveTo(P(u0, v1, z0 + h * t).x, P(u0, v1, z0 + h * t).y); ctx.lineTo(P(u1, v1, z0 + h * t).x, P(u1, v1, z0 + h * t).y);
        ctx.moveTo(P(u1, v1, z0 + h * t).x, P(u1, v1, z0 + h * t).y); ctx.lineTo(P(u1, v0, z0 + h * t).x, P(u1, v0, z0 + h * t).y);
      }
      ctx.stroke();
    }
    /* 边线高光 + 暗角 */
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(Lf[3].x, Lf[3].y); ctx.lineTo(Lf[2].x, Lf[2].y); ctx.lineTo(Rf[2].x, Rf[2].y); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.beginPath();
    ctx.moveTo(Lf[1].x, Lf[1].y); ctx.lineTo(Lf[2].x, Lf[2].y); ctx.stroke();
    return { u0: u0, v0: v0, u1: u1, v1: v1, z0: z0, h: h };
  }

  /** 侧面参数点：L 面（v=v1 平面）/ R 面（u=u1 平面），s、t∈[0,1] 自左向右、自下向上 */
  function fp(b, face, s, t) {
    return face === 'L' ? P(b.u0 + (b.u1 - b.u0) * s, b.v1, b.z0 + b.h * t) : P(b.u1, b.v1 + (b.v0 - b.v1) * s, b.z0 + b.h * t);
  }
  function fquad(b, face, s0, s1, t0, t1, fill, stroke) {
    poly([fp(b, face, s0, t0), fp(b, face, s1, t0), fp(b, face, s1, t1), fp(b, face, s0, t1)], fill, stroke);
  }
  /** 窗户网格；style: 'win' 普通窗（带窗框与亮灯）| 'band' 玻璃幕墙 */
  function windows(b, face, cols, rows, o) {
    o = o || {};
    var lit = env.lit, seed = o.seed || 0, pad = o.pad == null ? 0.18 : o.pad;
    var t0 = o.t0 == null ? 0.12 : o.t0, t1 = o.t1 == null ? 0.92 : o.t1;
    for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
      var s0 = (i + pad) / cols, s1 = (i + 1 - pad) / cols;
      var a0 = t0 + (t1 - t0) * (j + pad) / rows, a1 = t0 + (t1 - t0) * (j + 1 - pad) / rows;
      var on = lit && hash(i + seed, j * 5 + (face === 'L' ? 1 : 2)) > 0.38;
      var glass = on ? '#ffe9a6' : (lit ? '#46536b' : (o.glass || '#9cc6e6'));
      if (face === 'R' && !on) glass = shade(glass.indexOf('#') === 0 ? glass : '#6f8fb0', 0.78);
      fquad(b, face, s0, s1, a0, a1, glass, 'rgba(0,0,0,0.35)');
      if (!on && !lit) { /* 玻璃反光斜线 */
        var p = fp(b, face, s0, a1), q = fp(b, face, s1, a0);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(p.x + (q.x - p.x) * 0.2, p.y + (q.y - p.y) * 0.2); ctx.lineTo(p.x + (q.x - p.x) * 0.55, p.y + (q.y - p.y) * 0.55); ctx.stroke();
      }
      if (on && o.glow !== false) { var c = fp(b, face, (s0 + s1) / 2, (a0 + a1) / 2); glow(c.x, c.y, 9, '255,220,140', 0.22); }
    }
  }
  /** 连续玻璃幕墙：横向带 + 竖向分格，带天空渐变反光 */
  function curtain(b, face, floors, mullions, color) {
    var lit = env.lit;
    for (var j = 0; j < floors; j++) {
      var t0 = (j + 0.12) / floors, t1 = (j + 0.9) / floors;
      var tl = fp(b, face, 0.05, t0), br = fp(b, face, 0.95, t1);
      var g = ctx.createLinearGradient(tl.x, tl.y, br.x, br.y);
      if (lit) { g.addColorStop(0, '#2a3550'); g.addColorStop(1, '#3a4a6a'); } else { g.addColorStop(0, '#bfe0f5'); g.addColorStop(1, color || '#5d93c4'); }
      poly([fp(b, face, 0.05, t0), fp(b, face, 0.95, t0), fp(b, face, 0.95, t1), fp(b, face, 0.05, t1)], g);
      if (lit) for (var i = 0; i < mullions; i++) {
        if (hash(i + j * 7, floors) > 0.5) {
          var s0 = 0.05 + 0.9 * i / mullions, s1 = 0.05 + 0.9 * (i + 0.85) / mullions;
          fquad(b, face, s0, s1, t0 + 0.01, t1 - 0.01, 'rgba(255,228,150,0.9)');
        }
      }
    }
    ctx.strokeStyle = 'rgba(20,30,50,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var m = 0; m <= mullions; m++) { var s = 0.05 + 0.9 * m / mullions, a = fp(b, face, s, 0.04), c = fp(b, face, s, 0.96); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); }
    ctx.stroke();
  }
  /** 门 */
  function door(b, face, s, w, hFrac, color) {
    fquad(b, face, s, s + w, 0, hFrac, color || '#5a3a26', 'rgba(0,0,0,0.5)');
  }
  /** 在侧面上写字（用仿射变换把文字贴到墙面） */
  function faceText(b, face, text, s, t, size, color, align) {
    var p = fp(b, face, s, t);
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.transform(1, face === 'L' ? 0.5 : -0.5, 0, 1, 0, 0);
    ctx.font = 'bold ' + size + 'px ' + FONT; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0); ctx.restore();
  }
  function faceSign(b, face, text, s0, s1, t0, t1, bg, fg, size) {
    fquad(b, face, s0, s1, t0, t1, bg, 'rgba(0,0,0,0.5)');
    var mid = fp(b, face, (s0 + s1) / 2, (t0 + t1) / 2);
    ctx.save(); ctx.translate(mid.x, mid.y); ctx.transform(1, face === 'L' ? 0.5 : -0.5, 0, 1, 0, 0);
    ctx.font = 'bold ' + size + 'px ' + FONT; ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0); ctx.restore();
  }

  /** 四坡屋顶（庑殿顶）：脊线沿长边 */
  function hipRoof(u0, v0, u1, v1, z, rh, color, ov) {
    ov = ov == null ? 0.08 : ov;
    var a = u0 - ov, b = u1 + ov, c = v0 - ov, d = v1 + ov;
    var alongU = (b - a) >= (d - c), r0, r1;
    if (alongU) { var ins = (d - c) / 2; r0 = P(a + ins, (c + d) / 2, z + rh); r1 = P(b - ins, (c + d) / 2, z + rh); }
    else { var ins2 = (b - a) / 2; r0 = P((a + b) / 2, c + ins2, z + rh); r1 = P((a + b) / 2, d - ins2, z + rh); }
    var A = P(a, c, z), B = P(b, c, z), Cc = P(b, d, z), D = P(a, d, z);
    poly([A, B, r1, r0], shade(color, 1.0));              /* 后坡（被遮挡，先画） */
    poly([A, D, r0], shade(color, 0.9));
    poly(alongU ? [D, Cc, r1, r0] : [D, Cc, r1], shade(color, 1.06));   /* 前左坡 */
    poly(alongU ? [B, Cc, r1] : [B, Cc, r1, r0], shade(color, 0.72));   /* 前右坡 */
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(D.x, D.y); ctx.lineTo(Cc.x, Cc.y); ctx.lineTo(B.x, B.y); ctx.moveTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y); ctx.stroke();
    /* 瓦垄 */
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath();
    for (var i = 1; i < 5; i++) { var f = i / 5; ctx.moveTo(D.x + (r0.x - D.x) * f, D.y + (r0.y - D.y) * f); ctx.lineTo(Cc.x + (r1.x - Cc.x) * f, Cc.y + (r1.y - Cc.y) * f); }
    ctx.stroke();
  }
  /** 双坡屋顶（人字顶），脊线沿 u 方向；山墙朝右 */
  function gableRoof(u0, v0, u1, v1, z, rh, roofColor, wallColor) {
    var vm = (v0 + v1) / 2, ov = 0.06;
    var A = P(u0 - ov, v1 + ov, z), B = P(u1 + ov, v1 + ov, z), Cc = P(u1 + ov, v0 - ov, z);
    var r0 = P(u0 - ov, vm, z + rh), r1 = P(u1 + ov, vm, z + rh);
    poly([P(u1, v0, z), P(u1, v1, z), P(u1, vm, z + rh)], shade(wallColor, 0.66));  /* 右侧山墙 */
    poly([A, B, r1, r0], shade(roofColor, 1.05));                                    /* 前坡 */
    poly([B, Cc, r1], shade(roofColor, 0.7), null);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(r1.x, r1.y); ctx.lineTo(r0.x, r0.y); ctx.closePath(); ctx.stroke();
  }

  /** 树：kind 0 阔叶 / 1 松 / 2 银杏(黄) / 3 樱花(粉) */
  function tree(u, v, kind, sc) {
    sc = sc || 1; var p = P(u, v), sway = Math.sin(env.t / 1100 + u * 3 + v) * 1.4 * sc;
    ell(p.x + env.shadow.x * 10, p.y + 2 + env.shadow.y * 6, 10 * sc, 4 * sc, 'rgba(10,20,30,' + env.shadow.a * 0.9 + ')');
    ctx.fillStyle = '#5b4026'; ctx.fillRect(p.x - 1.6 * sc, p.y - 12 * sc, 3.2 * sc, 13 * sc);
    var cols = [['#2f7a3d', '#3e9650', '#58b068'], ['#1f5f3a', '#2b7a4b', '#3d9560'], ['#c9a227', '#e0bb3a', '#f0d25a'], ['#d98aa6', '#eaa5bd', '#f6c6d6']][kind % 4];
    if (kind === 1) {
      for (var i = 0; i < 3; i++) poly([{ x: p.x - (13 - i * 3) * sc + sway * i * 0.4, y: p.y - (8 + i * 9) * sc }, { x: p.x + (13 - i * 3) * sc + sway * i * 0.4, y: p.y - (8 + i * 9) * sc }, { x: p.x + sway * (i + 1) * 0.5, y: p.y - (22 + i * 9) * sc }], cols[i]);
    } else {
      ell(p.x + sway * 0.3, p.y - 17 * sc, 12 * sc, 10 * sc, cols[0]);
      ell(p.x - 4 * sc + sway * 0.6, p.y - 22 * sc, 9 * sc, 8 * sc, cols[1]);
      ell(p.x + 5 * sc + sway * 0.8, p.y - 24 * sc, 8 * sc, 7 * sc, cols[2]);
    }
  }
  function bush(u, v, col) { var p = P(u, v); ell(p.x, p.y - 2, 6, 4, shade(col || '#3a8a4a', 0.8)); ell(p.x - 2, p.y - 4, 5, 3.5, col || '#3a8a4a'); }

  /* ========================================================================
   * 四、地面静态层（缓存到离屏画布，尺寸变化时重建）
   * ===================================================================== */
  var groundCache = null;
  function isRoadCell(g) { return g === 3 || g === 7; }
  function blk(g) { return g < 3 ? 0 : (g < 8 ? 1 : 2); }
  function isWater(gx, gy) { return gx >= 10 && gy >= 7; }

  function quadCell(gx, gy, u0, v0, u1, v1, fill) {
    poly([P(gx + u0, gy + v0), P(gx + u1, gy + v0), P(gx + u1, gy + v1), P(gx + u0, gy + v1)], fill);
  }
  function buildGround(scale) {
    var cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    var saved = ctx; ctx = cv.getContext('2d'); ctx.scale(scale, scale);
    var gx, gy;
    /* 底座厚度（右下两侧可见） */
    for (gx = 0; gx < N; gx++) { if (isWater(gx, N - 1)) continue;
      poly([P(gx, N), P(gx + 1, N), { x: P(gx + 1, N).x, y: P(gx + 1, N).y + 16 }, { x: P(gx, N).x, y: P(gx, N).y + 16 }], '#6f5236'); }
    for (gy = 0; gy < N; gy++) { if (isWater(N - 1, gy)) continue;
      poly([P(N, gy), P(N, gy + 1), { x: P(N, gy + 1).x, y: P(N, gy + 1).y + 16 }, { x: P(N, gy).x, y: P(N, gy).y + 16 }], '#54402b'); }
    for (gy = 0; gy < N; gy++) for (gx = 0; gx < N; gx++) {
      if (isWater(gx, gy)) continue;
      var rx = isRoadCell(gx), ry = isRoadCell(gy);
      if (rx || ry) { /* 道路 */
        quadCell(gx, gy, 0, 0, 1, 1, '#4a5058');
        /* 路沿 + 人行道 */
        var curb = '#c9c5ba';
        if (ry && !rx) { quadCell(gx, gy, 0, 0, 1, 0.13, curb); quadCell(gx, gy, 0, 0.87, 1, 1, curb); }
        if (rx && !ry) { quadCell(gx, gy, 0, 0, 0.13, 1, curb); quadCell(gx, gy, 0.87, 0, 1, 1, curb); }
        if (rx && ry) { /* 路口：四角圆台 */
          quadCell(gx, gy, 0, 0, 0.13, 0.13, curb); quadCell(gx, gy, 0.87, 0, 1, 0.13, curb); quadCell(gx, gy, 0, 0.87, 0.13, 1, curb); quadCell(gx, gy, 0.87, 0.87, 1, 1, curb);
          /* 斑马线 */
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          for (var z = 0; z < 6; z++) {
            var f0 = 0.16 + z * 0.14, f1 = f0 + 0.07;
            [[f0, 0.02, f1, 0.12], [f0, 0.88, f1, 0.98]].forEach(function (r) { poly([P(gx + r[0], gy + r[1]), P(gx + r[2], gy + r[1]), P(gx + r[2], gy + r[3]), P(gx + r[0], gy + r[3])], 'rgba(255,255,255,0.85)'); });
            [[0.02, f0, 0.12, f1], [0.88, f0, 0.98, f1]].forEach(function (r) { poly([P(gx + r[0], gy + r[1]), P(gx + r[2], gy + r[1]), P(gx + r[2], gy + r[3]), P(gx + r[0], gy + r[3])], 'rgba(255,255,255,0.85)'); });
          }
        } else {
          /* 车道中线（黄虚线） */
          ctx.strokeStyle = 'rgba(255,205,90,0.85)'; ctx.lineWidth = 1.6; ctx.setLineDash([7, 6]); ctx.beginPath();
          if (ry) { var a = P(gx, gy + 0.5), b = P(gx + 1, gy + 0.5); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
          else { var c = P(gx + 0.5, gy), d = P(gx + 0.5, gy + 1); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); }
          ctx.stroke(); ctx.setLineDash([]);
        }
        continue;
      }
      /* 街区地面 */
      var type = GROUND_TYPE[blk(gx) + ',' + blk(gy)];
      var palette = {
        stone: ['#b3a995', '#a89e8b'], lawn: ['#79b266', '#70a95e'], dirt: ['#8f7d5e', '#85734f'], plaza: ['#bdb9ae', '#b2aea3'],
        yard: ['#8a8070', '#80766a'], concrete: ['#979aa0', '#8c8f95'], park: ['#6fae5e', '#66a557'], lawn2: ['#86b872', '#7cae69'], asphalt: ['#6a6e75', '#62666d']
      }[type];
      quadCell(gx, gy, 0, 0, 1, 1, palette[(gx + gy) % 2]);
      /* 纹理：草丛 / 泥点 / 铺装缝 */
      var n = 5;
      for (var k = 0; k < n; k++) {
        var hx = hash(gx * 13 + k, gy * 7), hy = hash(gx * 5, gy * 11 + k), pp = P(gx + hx, gy + hy);
        if (type === 'lawn' || type === 'park' || type === 'lawn2') { ctx.fillStyle = hash(k, gx + gy) > 0.5 ? 'rgba(40,110,50,0.35)' : 'rgba(150,210,110,0.35)'; ctx.fillRect(pp.x, pp.y, 2, 1.4); }
        else if (type === 'dirt') { ctx.fillStyle = 'rgba(60,40,20,0.25)'; ctx.fillRect(pp.x, pp.y, 3, 1.6); }
        else { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(pp.x, pp.y, 2, 1); }
      }
      if (type === 'plaza' || type === 'stone' || type === 'concrete') {
        ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1; ctx.beginPath();
        var m1 = P(gx + 0.5, gy), m2 = P(gx + 0.5, gy + 1), m3 = P(gx, gy + 0.5), m4 = P(gx + 1, gy + 0.5);
        ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.moveTo(m3.x, m3.y); ctx.lineTo(m4.x, m4.y); ctx.stroke();
      }
      /* 街区边缘人行道（靠近道路的一侧） */
      var sw = '#cfcbc0';
      if (gy + 1 < N && isRoadCell(gy + 1) && !isRoadCell(gx)) quadCell(gx, gy, 0, 0.84, 1, 1, sw);
      if (gy - 1 >= 0 && isRoadCell(gy - 1) && !isRoadCell(gx)) quadCell(gx, gy, 0, 0, 1, 0.16, sw);
      if (gx + 1 < N && isRoadCell(gx + 1) && !isRoadCell(gy)) quadCell(gx, gy, 0.84, 0, 1, 1, sw);
      if (gx - 1 >= 0 && isRoadCell(gx - 1) && !isRoadCell(gy)) quadCell(gx, gy, 0, 0, 0.16, 1, sw);
    }
    /* 停车场划线（右中街区） */
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2;
    for (var pl = 0; pl < 7; pl++) { var q1 = P(8.3 + pl * 0.5, 6.0), q2 = P(8.3 + pl * 0.5, 6.7); ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke(); }
    /* 城中村泥坑 */
    var mud = P(1.2, 8.1); ell(mud.x, mud.y, 14, 5, 'rgba(70,52,30,0.5)');
    /* 校园小径、公园小径 */
    function path(a, b, c, d, col) { poly([P(a, b), P(c, b), P(c, d), P(a, d)], col); }
    path(8.2, 1.78, 11.9, 1.98, 'rgba(225,215,190,0.9)');
    path(4.0, 1.4, 7.0, 1.6, 'rgba(225,215,190,0.8)');
    path(5.4, 0.1, 5.6, 2.9, 'rgba(225,215,190,0.8)');
    ctx = saved; return cv;
  }

  /* ========================================================================
   * 五、各街区建筑 —— 场景在 init 时一次性构建（静态物件），动态对象每帧追加
   * ===================================================================== */
  var SCENE = [];
  function add(d, rid, fn) { SCENE.push({ d: d, rid: rid, draw: fn }); }
  function dOf(u0, v0, u1, v1) { return (u0 + u1 + v0 + v1) / 2; }

  /* ---- 老街：灰瓦白墙四合院 + 牌坊 + 灯笼 ---- */
  function buildOldStreet() {
    var houses = [[0.3, 0.3, 1.3, 1.15, 20], [1.7, 0.3, 2.75, 1.05, 26], [0.3, 1.55, 1.2, 2.45, 18], [1.75, 1.45, 2.75, 2.35, 22]];
    houses.forEach(function (h, idx) {
      add(dOf(h[0], h[1], h[2], h[3]), 'oldst', function () {
        var b = prism(h[0], h[1], h[2], h[3], 0, h[4], '#ece4d2', { line: 7 });
        /* 木柱 + 窗格 + 门 */
        fquad(b, 'L', 0.0, 0.06, 0, 1, '#7a3b2e'); fquad(b, 'L', 0.94, 1, 0, 1, '#7a3b2e');
        windows(b, 'L', 2, 1, { seed: idx * 3, t0: 0.38, t1: 0.85, glass: '#b6d0dc', pad: 0.2 });
        door(b, 'L', 0.42, 0.16, 0.45, '#7a3b2e');
        windows(b, 'R', 2, 1, { seed: idx * 5 + 2, t0: 0.38, t1: 0.85, glass: '#9db7c4', pad: 0.2 });
        hipRoof(h[0], h[1], h[2], h[3], h[4], 11, '#5b6570', 0.12);
        /* 屋檐灯笼 */
        var l = fp(b, 'L', 0.2, 0.78), r = fp(b, 'L', 0.8, 0.78);
        [l, r].forEach(function (p) { ell(p.x, p.y + 4, 2.6, 3.4, '#e0402f'); glow(p.x, p.y + 4, 14, '255,110,70', 0.35); });
      });
    });
    /* 牌坊 */
    add(2.95 + 1.5, 'oldst', function () {
      var u = 1.5, v = 2.78;
      prism(u - 0.4, v, u - 0.3, v + 0.1, 0, 30, '#a3322a'); prism(u + 0.3, v, u + 0.4, v + 0.1, 0, 30, '#a3322a');
      prism(u - 0.5, v - 0.02, u + 0.5, v + 0.12, 30, 4, '#8f2a22', { shadow: false });
      prism(u - 0.62, v - 0.06, u + 0.62, v + 0.16, 34, 2.5, '#d6a43a', { shadow: false });
      var t = P(u, v + 0.05, 36); ctx.font = 'bold 8px ' + FONT; ctx.fillStyle = '#ffe9a6'; ctx.textAlign = 'center'; ctx.fillText('老街', t.x, t.y + 6 - 6);
    });
    add(1.3 + 1.6, 'oldst', function () { tree(1.5, 1.35, 2, 1.1); });
    add(1.2 + 2.5, 'oldst', function () { var p = P(1.45, 2.45); ell(p.x, p.y, 7, 3.4, '#7a7f86'); ell(p.x, p.y - 2, 5.5, 2.6, '#2a4a5a'); });   /* 古井 */
    add(0.4 + 0.1, 'oldst', function () { tree(0.15, 0.2, 0, 0.8); });
  }

  /* ---- 学院区：主楼+立柱、钟楼、图书馆、宿舍、喷泉 ---- */
  function buildCollege() {
    add(dOf(8.8, 0.5, 11, 1.6), 'college', function () {
      var b = prism(8.8, 0.5, 11.0, 1.5, 0, 28, '#ddd4c2', { line: 7 });
      windows(b, 'L', 6, 2, { t0: 0.1, t1: 0.9, seed: 21, glass: '#a9cbe0', pad: 0.2 });
      windows(b, 'R', 3, 2, { t0: 0.1, t1: 0.9, seed: 22, glass: '#8fb2c8', pad: 0.2 });
      /* 门廊立柱 */
      for (var i = 0; i < 5; i++) prism(8.95 + i * 0.45, 1.52, 9.03 + i * 0.45, 1.6, 0, 26, '#f1ebdd');
      prism(8.85, 1.5, 10.95, 1.72, 26, 2, '#e8e0cf', { shadow: false });
      gableRoof(8.78, 0.5, 11.0, 1.74, 28, 12, '#7b4a3b', '#ddd4c2');
      /* 校徽 */
      var c = fp({ u0: 8.8, v0: 0.5, u1: 11, v1: 1.74, z0: 28, h: 12 }, 'L', 0.5, 0.35);
      ell(c.x, c.y, 5, 3.4, '#c9a227');
    });
    add(dOf(8.7, 1.5, 11, 1.9) + 0.2, 'college', function () { prism(8.85, 1.72, 10.95, 1.92, 0, 3, '#cfc8b8', { shadow: false }); });
    /* 钟楼 */
    add(dOf(11.1, 0.3, 11.8, 1.0) + 0.4, 'college', function () {
      var b = prism(11.1, 0.3, 11.8, 1.0, 0, 56, '#d3c5aa', { line: 6 });
      windows(b, 'L', 1, 2, { t0: 0.1, t1: 0.5, seed: 31, pad: 0.25 });
      /* 钟面：随游戏时间转动 */
      var S = BT.S, hr = S ? (S.hour % 12) : 9;
      [['L', 0.5], ['R', 0.5]].forEach(function (f) {
        var p = fp(b, f[0], f[1], 0.82);
        ctx.save(); ctx.translate(p.x, p.y); ctx.transform(1, f[0] === 'L' ? 0.5 : -0.5, 0, 1, 0, 0);
        ctx.fillStyle = '#fbf7ea'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.2832); ctx.fill(); ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(hr / 12 * 6.2832) * 4.5, -Math.cos(hr / 12 * 6.2832) * 4.5);
        ctx.moveTo(0, 0); ctx.lineTo(Math.sin((env.t / 4000) % 6.2832) * 6.5, -Math.cos((env.t / 4000) % 6.2832) * 6.5); ctx.stroke(); ctx.restore();
      });
      prism(11.05, 0.25, 11.85, 1.05, 56, 3, '#a89570', { shadow: false });
      hipRoof(11.1, 0.3, 11.8, 1.0, 59, 20, '#4b3a8f', 0.04);
      var tp = P(11.45, 0.65, 80); ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(tp.x, tp.y - 12); ctx.stroke();
      var fw = Math.sin(env.t / 160) * 2; poly([{ x: tp.x, y: tp.y - 12 }, { x: tp.x + 12, y: tp.y - 9 + fw }, { x: tp.x, y: tp.y - 6 }], '#ffd766');
    });
    add(dOf(8.2, 1.95, 9.0, 2.8), 'college', function () {
      var b = prism(8.2, 1.95, 9.0, 2.8, 0, 16, '#b8c4cc', { line: 8 });
      curtain(b, 'L', 2, 3, '#6fa0c8'); windows(b, 'R', 3, 1, { t0: 0.2, t1: 0.8, seed: 41 });
      prism(8.3, 2.05, 8.9, 2.7, 16, 2, '#4a5560', { shadow: false });
      for (var i = 0; i < 3; i++) { var p = P(8.4 + i * 0.2, 2.35, 19); poly([{ x: p.x - 5, y: p.y }, { x: p.x + 5, y: p.y }, { x: p.x + 5, y: p.y - 4 }, { x: p.x - 5, y: p.y - 4 }], '#2a4f8a'); }
    });
    add(dOf(10.2, 2.0, 11.6, 2.8), 'college', function () {
      var b = prism(10.2, 2.0, 11.6, 2.8, 0, 24, '#b5513d', { line: 6 });
      windows(b, 'L', 5, 3, { seed: 51, t0: 0.1, t1: 0.92, pad: 0.22 }); windows(b, 'R', 2, 3, { seed: 52, t0: 0.1, t1: 0.92, pad: 0.22 });
      prism(10.15, 1.95, 11.65, 2.85, 24, 2, '#8a3b2b', { shadow: false });
    });
    /* 喷泉（带水柱动画） */
    add(9.7 + 2.3, 'college', function () {
      var p = P(9.7, 2.35); ell(p.x, p.y + 1, 15, 7, '#9a9486'); ell(p.x, p.y, 13, 6, '#4c93c6'); ell(p.x, p.y - 2, 4, 2, '#cde7f6');
      ctx.strokeStyle = 'rgba(220,240,255,0.85)'; ctx.lineWidth = 1.4;
      for (var i = 0; i < 5; i++) {
        var a = (i / 5) * 6.2832 + env.t / 900, ph = ((env.t / 700) + i * 0.2) % 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.quadraticCurveTo(p.x + Math.cos(a) * 7, p.y - 18 - Math.sin(ph * 3.14) * 6, p.x + Math.cos(a) * 12, p.y - 1); ctx.stroke();
      }
    });
    [[8.15, 0.3], [11.7, 2.3], [8.3, 2.9], [10.0, 0.2], [11.6, 1.3]].forEach(function (t, i) { add(t[0] + t[1] + 0.2, 'college', function () { tree(t[0], t[1], i % 2 ? 0 : 3, 1); }); });
  }

  /* ---- 城中村：密集铁皮屋 + 晾衣绳 + 电线杆 + 水塔 ---- */
  function buildSlum() {
    var shacks = [[0.2, 8.3, 1.0, 9.0, 12, '#9a7b55', '#6b7a86'], [1.2, 8.2, 2.2, 9.1, 16, '#7d8c78', '#a0522d'], [2.3, 8.4, 2.85, 9.2, 10, '#a88f6a', '#4f6f8f'],
      [0.3, 9.4, 1.2, 10.3, 14, '#8a6f55', '#8b4a3a'], [1.5, 9.45, 2.4, 10.4, 21, '#b0a08a', '#5f6b73'], [0.2, 10.6, 1.1, 11.5, 11, '#6f7f8f', '#7a5a3a'], [1.4, 10.8, 2.5, 11.7, 15, '#a9855a', '#3f5f7f']];
    shacks.forEach(function (s, i) {
      add(dOf(s[0], s[1], s[2], s[3]), 'slum', function () {
        var b = prism(s[0], s[1], s[2], s[3], 0, s[4], s[5], { line: 5 });
        windows(b, 'L', 2, s[4] > 15 ? 2 : 1, { seed: i * 4, t0: 0.25, t1: 0.9, pad: 0.22, glass: '#9fb8c8' });
        door(b, 'R', 0.3, 0.3, 0.5, '#4a3626');
        /* 铁皮屋顶 */
        var r = prism(s[0] - 0.05, s[1] - 0.05, s[2] + 0.05, s[3] + 0.05, s[4], 2.5, s[6], { shadow: false, topMul: 1.0 });
        ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath();
        for (var k = 1; k < 8; k++) { var f = k / 8, a = P(s[0] + (s[2] - s[0]) * f, s[1] - 0.05, s[4] + 2.5), c = P(s[0] + (s[2] - s[0]) * f, s[3] + 0.05, s[4] + 2.5); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); }
        ctx.stroke();
        if (i % 3 === 0) { var w = P((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, s[4] + 2.5); ell(w.x, w.y, 6, 3, '#5b8fb0'); ctx.fillStyle = '#4b7a99'; ctx.fillRect(w.x - 6, w.y - 9, 12, 9); ell(w.x, w.y - 9, 6, 3, '#6aa3c6'); }
        if (i % 3 === 1) { var an = P(s[2] - 0.2, s[1] + 0.2, s[4] + 2.5); ctx.strokeStyle = '#ccd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(an.x, an.y); ctx.lineTo(an.x, an.y - 12); ctx.moveTo(an.x - 5, an.y - 8); ctx.lineTo(an.x + 5, an.y - 8); ctx.stroke(); }
      });
    });
    /* 晾衣绳 */
    [[1.05, 9.15, 1.2, 12], [2.35, 10.0, 2.6, 10], [1.25, 11.0, 1.35, 9]].forEach(function (l) {
      add(l[0] + l[1] + 0.1, 'slum', function () {
        var a = P(l[0], l[1], l[3]), b = P(l[2] + 0.35, l[1] + 0.12, l[3]);
        ctx.strokeStyle = 'rgba(60,50,40,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 4, b.x, b.y); ctx.stroke();
        var cols = ['#e5534b', '#4b8ee5', '#f0d25a', '#ffffff', '#58b068'];
        for (var i = 0; i < 5; i++) { var f = (i + 0.5) / 5, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f + Math.sin(f * 3.14) * 2.5, sw = Math.sin(env.t / 500 + i) * 1.2;
          poly([{ x: x, y: y }, { x: x + 3.4, y: y }, { x: x + 3 + sw, y: y + 7 }, { x: x + sw * 0.5, y: y + 7 }], cols[i]); }
      });
    });
    /* 电线杆与电线 */
    var poles = [[0.12, 8.2], [0.12, 9.8], [0.12, 11.4], [2.95, 9.0], [2.95, 10.6]];
    poles.forEach(function (p) { add(p[0] + p[1], 'slum', function () { var a = P(p[0], p[1]), t = P(p[0], p[1], 36); ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(t.x - 7, t.y + 3); ctx.lineTo(t.x + 7, t.y + 3); ctx.stroke(); }); });
    add(0.12 + 11.5, 'slum', function () {
      ctx.strokeStyle = 'rgba(20,20,20,0.7)'; ctx.lineWidth = 1;
      for (var i = 0; i < poles.length - 1; i++) { if (i === 2) continue; var a = P(poles[i][0], poles[i][1], 36), b = P(poles[i + 1][0], poles[i + 1][1], 36); ctx.beginPath(); ctx.moveTo(a.x, a.y + 3); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 8, b.x, b.y + 3); ctx.stroke(); }
    });
    /* 杂物 */
    [[1.2, 9.3], [2.7, 9.9], [0.2, 10.4], [1.3, 11.8]].forEach(function (c, i) { add(c[0] + c[1], 'slum', function () { prism(c[0], c[1], c[0] + 0.14, c[1] + 0.14, 0, 7, i % 2 ? '#c06a3a' : '#4f7f9f', { shadow: false }); }); });
    add(2.0 + 8.0, 'slum', function () { /* 烟囱烟雾 */
      var p = P(1.7, 8.7, 20);
      for (var s = 0; s < 4; s++) { var ph = ((env.t / 2600) + s / 4) % 1; ctx.fillStyle = 'rgba(235,235,235,' + (0.5 * (1 - ph)) + ')'; ctx.beginPath(); ctx.arc(p.x + ph * 12, p.y - ph * 30, 2 + ph * 6, 0, 6.2832); ctx.fill(); }
    });
    add(0.3 + 11.9, 'slum', function () { tree(0.25, 11.85, 0, 0.9); });
  }

  /* ---- 商业街 CBD：基座 + 四座塔楼 + 霓虹/航空灯 ---- */
  function buildCBD() {
    add(4.15 + 4.15, 'cbd', function () { prism(4.12, 4.12, 6.88, 6.88, 0, 6, '#8d97a4', { topMul: 1.05 }); });
    var towers = [
      [4.4, 4.4, 5.5, 5.5, 96, '#4a79b0', 'T1'], [5.7, 4.45, 6.65, 5.35, 70, '#4c8f98', 'T2'],
      [4.45, 5.75, 5.3, 6.65, 54, '#6b73b3', 'T3'], [5.75, 5.75, 6.7, 6.7, 84, '#34557f', 'T4']
    ];
    towers.forEach(function (t, i) {
      add(dOf(t[0], t[1], t[2], t[3]) + 0.3, 'cbd', function () {
        var z0 = 6, b = prism(t[0], t[1], t[2], t[3], z0, t[4], t[5], { topMul: 1.2 });
        curtain(b, 'L', Math.round(t[4] / 8), 5, shade(t[5], 1.1));
        curtain(b, 'R', Math.round(t[4] / 8), 4, shade(t[5], 0.8));
        /* 退台与屋顶设备 */
        var inset = 0.12, z1 = z0 + t[4];
        var b2 = prism(t[0] + inset, t[1] + inset, t[2] - inset, t[3] - inset, z1, 14, mix(t[5], '#ffffff', 0.18), { shadow: false });
        curtain(b2, 'L', 2, 3); curtain(b2, 'R', 2, 3);
        var top = P((t[0] + t[2]) / 2, (t[1] + t[3]) / 2, z1 + 14);
        ctx.strokeStyle = '#dde'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - 20 - i * 3); ctx.stroke();
        var blink = (Math.floor(env.t / (500 + i * 120)) % 2) === 0;
        ell(top.x, top.y - 20 - i * 3, 2.4, 2.4, blink ? '#ff4d4d' : '#6a2020'); if (blink) glow(top.x, top.y - 20 - i * 3, 12, '255,60,60', 0.5);
        /* LED 广告牌 */
        if (i === 0) {
          var hue = (env.t / 40) % 360;
          faceSign(b, 'L', 'NEW PORT', 0.12, 0.88, 0.36, 0.46, 'hsl(' + hue + ',70%,38%)', '#fff', 9);
          glow(fp(b, 'L', 0.5, 0.41).x, fp(b, 'L', 0.5, 0.41).y, 22, '120,180,255', 0.25);
        }
        if (i === 3) faceSign(b, 'L', '商业街', 0.15, 0.85, 0.25, 0.33, '#c4372e', '#ffe9a6', 8);
      });
    });
    /* 广场：花坛、树、长椅 */
    [[4.05, 4.05], [6.95, 4.05], [4.05, 6.95], [6.95, 6.95]].forEach(function (t, i) { add(t[0] + t[1] + 0.2, 'cbd', function () { tree(t[0], t[1], i % 2 ? 3 : 0, 0.85); }); });
    add(5.5 + 5.5, 'cbd', function () { var p = P(5.55, 5.55); ell(p.x, p.y, 10, 5, '#b9b2a6'); ell(p.x, p.y - 1, 8, 3.8, '#4c93c6'); });
  }

  /* ---- 批发市场：仓库 + 摊位 + 货车 + 货箱 ---- */
  function buildMarket() {
    add(dOf(4.3, 8.25, 6.7, 9.2), 'market', function () {
      var b = prism(4.3, 8.25, 6.7, 9.15, 0, 26, '#c98a4b', { line: 6 });
      faceSign(b, 'L', '批发市场', 0.2, 0.8, 0.66, 0.9, '#7a3b1e', '#ffe9a6', 11);
      for (var i = 0; i < 4; i++) fquad(b, 'L', 0.08 + i * 0.22, 0.24 + i * 0.22, 0, 0.5, '#8d9aa5', 'rgba(0,0,0,0.45)');   /* 卷帘门 */
      windows(b, 'R', 2, 1, { t0: 0.45, t1: 0.8, seed: 61 });
      prism(4.25, 8.2, 6.75, 9.2, 26, 2.5, '#9b6a38', { shadow: false });
      for (var v = 0; v < 3; v++) prism(4.7 + v * 0.7, 8.5, 4.95 + v * 0.7, 8.75, 28.5, 3, '#6a6f78', { shadow: false });
    });
    var colors = ['#d9573f', '#3f8fd9', '#e0b43a', '#58b068', '#c06ab0'];
    for (var row = 0; row < 2; row++) for (var i = 0; i < 5; i++) {
      (function (row, i) {
        var u = 4.3 + i * 0.5, v = 9.7 + row * 0.95, col = colors[(i + row * 2) % 5];
        add(u + v + 0.45, 'market', function () {
          [[u + 0.02, v + 0.02], [u + 0.4, v + 0.02], [u + 0.02, v + 0.44], [u + 0.4, v + 0.44]].forEach(function (p) { prism(p[0], p[1], p[0] + 0.03, p[1] + 0.03, 0, 11, '#6b5a47', { shadow: false }); });
          prism(u + 0.04, v + 0.2, u + 0.4, v + 0.4, 0, 5, '#a9814f', { shadow: false });                           /* 货台 */
          for (var g = 0; g < 4; g++) { var gp = P(u + 0.08 + g * 0.08, v + 0.3, 5); ell(gp.x, gp.y - 1.5, 2.6, 2.2, ['#e5534b', '#f0a030', '#8bc34a', '#fff'][(g + i) % 4]); }
          /* 条纹遮阳篷 */
          var A = P(u, v, 12), B = P(u + 0.46, v, 12), Cc = P(u + 0.46, v + 0.5, 12), D = P(u, v + 0.5, 12);
          var A2 = P(u, v, 15), B2 = P(u + 0.46, v, 15);
          poly([A, B, Cc, D], shade(col, 0.9));
          for (var s = 0; s < 4; s++) { var f0 = s / 4, f1 = (s + 0.5) / 4; poly([P(u + 0.46 * f0, v, 12.5), P(u + 0.46 * f1, v, 12.5), P(u + 0.46 * f1, v + 0.5, 12.5), P(u + 0.46 * f0, v + 0.5, 12.5)], '#fff3d6'); }
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(D.x, D.y); ctx.lineTo(Cc.x, Cc.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        });
      })(row, i);
    }
    add(5.2 + 11.5, 'market', function () { /* 货车 */
      var b = prism(4.6, 11.35, 5.7, 11.7, 0, 12, '#e8e8ea', { shadow: true, line: 12 });
      prism(5.7, 11.4, 6.05, 11.7, 0, 8, '#c4372e', { shadow: false });
      faceText(b, 'L', '鲜', 0.4, 0.5, 8, '#c4372e', 'center');
    });
    add(6.3 + 9.5, 'market', function () { prism(6.3, 9.5, 6.6, 9.8, 0, 6, '#b88a4f'); prism(6.35, 9.55, 6.55, 9.75, 6, 5, '#c89a5f'); });
    add(6.4 + 11.2, 'market', function () { tree(6.5, 11.3, 0, 0.9); });
  }

  /* ---- 车站码头：集装箱堆场 + 龙门吊 + 货轮 + 灯塔 ---- */
  function buildPort() {
    add(8.2 + 8.2, 'port', function () {
      var b = prism(8.2, 8.2, 9.8, 8.95, 0, 22, '#7e8da0', { line: 7 });
      faceSign(b, 'L', '车站码头', 0.2, 0.8, 0.62, 0.88, '#1f4d6b', '#e8f6ff', 10);
      windows(b, 'L', 4, 1, { t0: 0.12, t1: 0.5, seed: 71 }); windows(b, 'R', 2, 1, { t0: 0.2, t1: 0.7, seed: 72 });
      prism(8.15, 8.15, 9.85, 9.0, 22, 2, '#5c6a7a', { shadow: false });
    });
    var cc = ['#d9573f', '#3f8fd9', '#e0b43a', '#58b068', '#8a5fb8', '#e07a2f'];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 4; c++) {
      (function (r, c) {
        var u = 8.3 + c * 0.4, v = 9.3 + r * 0.85, hgt = 1 + Math.floor(hash(r, c) * 3);
        add(u + v + 0.4, 'port', function () { for (var k = 0; k < hgt; k++) prism(u, v, u + 0.36, v + 0.78, k * 9, 9, cc[(r * 3 + c + k) % 6], { line: 3, shadow: k === 0 }); });
      })(r, c);
    }
    /* 码头栈桥 */
    add(10.0 + 9.3, 'port', function () {
      prism(9.9, 9.3, 11.9, 10.0, 0, 3, '#8c6b44', { shadow: false });
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); for (var k = 1; k < 8; k++) { var a = P(9.9 + k * 0.25, 9.3, 3), b = P(9.9 + k * 0.25, 10.0, 3); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
      [10.3, 11.0, 11.7].forEach(function (u) { var p = P(u, 10.0, 3); ctx.fillStyle = '#2f3338'; ctx.fillRect(p.x - 2, p.y - 5, 4, 5); });
    });
    /* 龙门吊（吊具往复移动） */
    add(10.3 + 10.0 + 0.5, 'port', function () {
      var legs = [[10.1, 9.2], [10.1, 10.15], [11.5, 9.2], [11.5, 10.15]];
      legs.forEach(function (l) { prism(l[0], l[1], l[0] + 0.07, l[1] + 0.07, 0, 52, '#e8b93a', { shadow: false }); });
      prism(10.05, 9.15, 11.62, 10.25, 52, 4, '#d9a52a', { shadow: false });
      var f = (Math.sin(env.t / 1800) + 1) / 2, u = 10.3 + f * 1.0, p = P(u, 9.7, 52);
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + 22 + Math.sin(env.t / 900) * 5); ctx.stroke();
      var q = P(u, 9.7, 52); ctx.fillStyle = '#d9573f'; ctx.fillRect(q.x - 6, q.y + 20 + Math.sin(env.t / 900) * 5, 12, 6);
    });
    /* 货轮 */
    add(11.0 + 10.6, 'port', function () {
      var bob = Math.sin(env.t / 700) * 1.2;
      var b = prism(10.15, 10.25, 11.95, 11.0, -2 + bob, 11, '#233b57', { shadow: false });
      fquad(b, 'L', 0, 1, 0.75, 1, '#b93a32');
      var col = ['#d9573f', '#3f8fd9', '#e0b43a', '#58b068'];
      for (var i = 0; i < 4; i++) prism(10.45 + i * 0.33, 10.35, 10.45 + i * 0.33 + 0.29, 10.9, 9 + bob, 8, col[i], { shadow: false, line: 4 });
      var br = prism(10.2, 10.45, 10.5, 10.85, 9 + bob, 16, '#f1f1ee', { shadow: false });
      windows(br, 'L', 2, 1, { t0: 0.6, t1: 0.9, seed: 81, glow: false });
      var s = P(10.35, 10.65, 25 + bob); ctx.fillStyle = '#c4372e'; ctx.fillRect(s.x - 3, s.y - 8, 6, 8);
      for (var k = 0; k < 3; k++) { var ph = ((env.t / 2000) + k / 3) % 1; ctx.fillStyle = 'rgba(210,210,210,' + 0.5 * (1 - ph) + ')'; ctx.beginPath(); ctx.arc(s.x + ph * 8, s.y - 10 - ph * 20, 2 + ph * 5, 0, 6.2832); ctx.fill(); }
    });
    /* 灯塔 */
    add(11.6 + 8.2, 'port', function () {
      var b = prism(11.4, 8.1, 11.8, 8.5, 0, 46, '#f4f0e6', { line: 9 });
      fquad(b, 'L', 0, 1, 0.3, 0.45, '#d9423a'); fquad(b, 'L', 0, 1, 0.65, 0.8, '#d9423a');
      var top = P(11.6, 8.3, 46); ell(top.x, top.y - 4, 5, 4, env.lit ? '#fff6b0' : '#cfd8dd');
      if (env.lit) { var a = env.t / 800; glow(top.x, top.y - 4, 30, '255,240,160', 0.5);
        ctx.fillStyle = 'rgba(255,245,170,0.16)'; ctx.beginPath(); ctx.moveTo(top.x, top.y - 4); ctx.lineTo(top.x + Math.cos(a) * 90 - 14, top.y - 4 + Math.sin(a) * 40); ctx.lineTo(top.x + Math.cos(a) * 90 + 14, top.y - 4 + Math.sin(a) * 40); ctx.fill(); }
    });
    [[8.25, 11.7], [9.6, 11.7]].forEach(function (t) { add(t[0] + t[1], 'port', function () { prism(t[0], t[1], t[0] + 0.25, t[1] + 0.2, 0, 7, '#9aa0a8'); }); });
  }

  /* ---- 装饰街区：公园 / 住宅 / 停车场与加油站 ---- */
  function buildFiller() {
    /* 公园：池塘、凉亭、树、长椅 */
    add(5.5 + 1.6, null, function () {
      var c = P(5.5, 1.4), w = Math.sin(env.t / 800) * 0.6;
      ell(c.x, c.y + 2, 54, 25, '#9aa58a'); ell(c.x, c.y, 50, 23, '#3f8fc0'); ell(c.x - 6, c.y - 2, 38 + w, 16, '#4ea3d4');
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(c.x - 12, c.y + 2, 14 + ((env.t / 90) % 14), 5 + ((env.t / 160) % 6), 0, 0, 6.2832); ctx.stroke();
      [[-18, 3], [22, -5], [5, 9]].forEach(function (l) { ell(c.x + l[0], c.y + l[1], 4.5, 2.2, '#58b068'); });
    });
    add(6.3 + 0.6, null, function () {
      var b = prism(6.15, 0.35, 6.75, 0.95, 0, 2, '#c9c1b0', { shadow: false });
      [[6.2, 0.4], [6.65, 0.4], [6.2, 0.85], [6.65, 0.85]].forEach(function (p) { prism(p[0], p[1], p[0] + 0.05, p[1] + 0.05, 2, 20, '#a3322a', { shadow: false }); });
      hipRoof(6.1, 0.3, 6.8, 1.0, 22, 12, '#3f7a4a', 0.05);
    });
    [[4.3, 0.4, 0], [4.6, 2.5, 3], [6.7, 2.4, 0], [5.0, 0.3, 1], [6.9, 1.7, 2], [4.2, 1.5, 0], [5.9, 2.7, 3], [4.8, 2.9, 0]].forEach(function (t, i) {
      add(t[0] + t[1] + 0.2, null, function () { tree(t[0], t[1], t[2], 1 + (i % 3) * 0.1); });
    });
    [[5.0, 1.95], [6.0, 1.95]].forEach(function (b) { add(b[0] + b[1], null, function () { prism(b[0], b[1], b[0] + 0.3, b[1] + 0.1, 0, 3, '#7a5b3a', { shadow: false }); prism(b[0], b[1], b[0] + 0.3, b[1] + 0.03, 3, 3, '#7a5b3a', { shadow: false }); }); });
    /* 住宅小区 */
    var apts = [[0.3, 4.3, 1.35, 5.3, 36, '#e8dcc6'], [1.65, 4.4, 2.7, 5.2, 30, '#cfd8e0'], [0.4, 5.8, 1.5, 6.7, 26, '#e2c9c0'], [1.8, 5.7, 2.8, 6.8, 42, '#d8d0e0']];
    apts.forEach(function (a, i) {
      add(dOf(a[0], a[1], a[2], a[3]), null, function () {
        var b = prism(a[0], a[1], a[2], a[3], 0, a[4], a[5], { line: 6 });
        windows(b, 'L', 4, Math.round(a[4] / 9), { seed: 90 + i * 3, t0: 0.12, t1: 0.95, pad: 0.22 }); windows(b, 'R', 3, Math.round(a[4] / 9), { seed: 95 + i * 3, t0: 0.12, t1: 0.95, pad: 0.22 });
        door(b, 'L', 0.42, 0.16, 0.12, '#6a4a30');
        prism(a[0] + 0.1, a[1] + 0.1, a[0] + 0.4, a[1] + 0.35, a[4], 6, '#a9b0b8', { shadow: false });
      });
    });
    [[0.2, 4.2, 0], [2.8, 4.3, 3], [0.2, 7.0, 0], [2.85, 6.9, 0]].forEach(function (t) { add(t[0] + t[1] + 0.2, null, function () { tree(t[0], t[1], t[2], 0.9); }); });
    /* 小商铺 + 加油站 + 停车 */
    add(dOf(8.3, 4.2, 9.8, 5.0), null, function () {
      var b = prism(8.3, 4.2, 9.8, 5.0, 0, 15, '#c9b08a', { line: 7 });
      faceSign(b, 'L', '便利店', 0.1, 0.5, 0.55, 0.85, '#2f7a3d', '#fff', 8); windows(b, 'L', 3, 1, { t0: 0.15, t1: 0.5, seed: 101, pad: 0.15 });
      prism(8.25, 4.15, 9.85, 5.05, 15, 2, '#8a7352', { shadow: false });
    });
    add(dOf(10.2, 5.0, 11.8, 6.6), null, function () {
      [[10.3, 5.1], [11.6, 5.1], [10.3, 6.4], [11.6, 6.4]].forEach(function (p) { prism(p[0], p[1], p[0] + 0.08, p[1] + 0.08, 0, 18, '#d8d8d8', { shadow: false }); });
      prism(10.2, 5.0, 11.8, 6.6, 18, 3, '#e04a3a', { topMul: 1.1 });
      prism(10.9, 5.5, 11.0, 5.6, 0, 7, '#2f6fb3', { shadow: false });
    });
    [[8.45, 6.1, '#d9573f'], [8.95, 6.1, '#3f8fd9'], [9.45, 6.1, '#e8e8ea'], [9.95, 6.1, '#58b068']].forEach(function (c) { add(c[0] + c[1] + 0.3, null, function () { staticCar(c[0], c[1], c[2], false); }); });
    add(8.2 + 4.1, null, function () { tree(8.2, 4.1, 0, 0.9); });
  }

  /** 路灯 / 红绿灯 / 公交站（沿道路摆放） */
  function buildStreetFurniture() {
    ROADS.forEach(function (r) {
      for (var u = 0.6; u < 12; u += 2) {
        if (u % 12 > 2.7 && u % 12 < 4.3 || u > 6.7 && u < 8.3) continue;
        [[u, r + 0.07], [u + 1, r + 0.93]].forEach(function (l) {
          if ((l[0] > 2.7 && l[0] < 4.3) || (l[0] > 6.7 && l[0] < 8.3)) return;
          add(l[0] + l[1], null, function () { lamp(l[0], l[1]); });
          add(l[1] + l[0] + 0.01, null, function () { });
        });
        /* 竖向道路（u 方向互换） */
        [[r + 0.07, u], [r + 0.93, u + 1]].forEach(function (l) {
          if ((l[1] > 2.7 && l[1] < 4.3) || (l[1] > 6.7 && l[1] < 8.3)) return;
          add(l[0] + l[1], null, function () { lamp(l[0], l[1]); });
        });
      }
    });
    ROADS.forEach(function (ru) { ROADS.forEach(function (rv) {
      add(ru + rv + 1.15, null, function () { trafficLight(ru + 0.9, rv + 0.1); });
      add(ru + rv + 0.05, null, function () { trafficLight(ru + 0.1, rv + 0.9); });
    }); });
    add(5.5 + 3.1, null, function () { /* 公交站 */
      var b = prism(5.9, 3.0, 6.7, 3.1, 0, 18, '#d6e6ee', { shadow: false });
      prism(5.85, 2.95, 6.75, 3.15, 18, 2, '#c4372e', { shadow: false });
      faceText(b, 'L', '公交站', 0.5, 0.55, 7, '#1f4d6b', 'center');
    });
  }
  function lamp(u, v) {
    var p = P(u, v), t = P(u, v, 26);
    ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(t.x, t.y); ctx.lineTo(t.x + 5, t.y - 1); ctx.stroke();
    ell(t.x + 5, t.y, 3, 2, env.lit ? '#fff1b8' : '#aab'); glow(t.x + 5, t.y + 6, 26, '255,236,170', 0.4);
  }
  function trafficLight(u, v) {
    var p = P(u, v), t = P(u, v, 24), st = lightState();
    ctx.strokeStyle = '#2d3238'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    ctx.fillStyle = '#23272d'; ctx.fillRect(t.x - 4, t.y - 12, 8, 12);
    var c = st.h === 'green' ? '#37e07a' : (st.h === 'yellow' ? '#ffd23a' : '#ff4a3a');
    ell(t.x - 1, t.y - 8, 2.2, 2.2, c); glow(t.x, t.y - 8, 10, st.h === 'green' ? '60,230,120' : (st.h === 'yellow' ? '255,210,60' : '255,70,60'), 0.35);
    c = st.v === 'green' ? '#37e07a' : (st.v === 'yellow' ? '#ffd23a' : '#ff4a3a'); ell(t.x + 1, t.y - 3.5, 2.2, 2.2, c);
  }

  /* ========================================================================
   * 六、动态对象：红绿灯相位、车辆、行人、玩家
   * ===================================================================== */
  /** 红绿灯相位：水平方向（沿 u）与竖直方向（沿 v）交替通行 */
  function lightState() {
    var c = (env.t / 1000) % 16;
    if (c < 6.5) return { h: 'green', v: 'red' };
    if (c < 8) return { h: 'yellow', v: 'red' };
    if (c < 14.5) return { h: 'red', v: 'green' };
    return { h: 'red', v: 'yellow' };
  }
  var cars = [], walkers = [], boats = [];
  var CARCOL = ['#d9573f', '#3f8fd9', '#e0b43a', '#58b068', '#e8e8ea', '#2f3a4a', '#8a5fb8'];
  function initActors() {
    cars = []; walkers = []; boats = [];
    /* 每条道路 2 条车道，每条车道若干辆车（horiz=沿 u 行驶） */
    var id = 0;
    ROADS.forEach(function (r) {
      [true, false].forEach(function (horiz) {
        [1, -1].forEach(function (dir) {
          for (var k = 0; k < 2; k++) cars.push({ id: id++, horiz: horiz, r: r, dir: dir, lane: dir === 1 ? 0.7 : 0.3, pos: (k * 6 + (dir > 0 ? 0 : 3) + hash(id, r) * 3) % 12, speed: 1.1 + hash(id, 7) * 0.5, color: CARCOL[id % CARCOL.length], wait: 0 });
        });
      });
    });
    /* 行人沿人行道往返 */
    var wc = ['#e5534b', '#4b8ee5', '#e5b84b', '#7a52c7', '#2f9e8f', '#d9739a', '#f5f5f5'];
    for (var i = 0; i < 18; i++) {
      var r2 = ROADS[i % 2], horiz2 = i % 4 < 2;
      walkers.push({ horiz: horiz2, r: r2, side: i % 3 === 0 ? 0.05 : 0.94, pos: hash(i, 3) * 12, dir: i % 2 ? 1 : -1, speed: 0.28 + hash(i, 9) * 0.22, color: wc[i % wc.length], hair: ['#2a1d12', '#5a3a1a', '#111', '#c9a227'][i % 4], seed: i * 1.7 });
    }
    boats.push({ u: 10.6, v: 7.6, dir: 1, speed: 0.12, kind: 0 }, { u: 11.4, v: 11.6, dir: -1, speed: 0.1, kind: 1 });
  }
  function carPos(c) {
    return c.horiz ? { u: c.pos, v: c.r + c.lane } : { u: c.r + c.lane, v: c.pos };
  }
  function updateActors(dt) {
    var st = lightState(), S = BT.S, slow = (S && S.weather === 'storm') ? 0.6 : (S && S.weather === 'rain' ? 0.8 : 1);
    cars.forEach(function (c) {
      var sp = c.speed * slow * dt, go = true;
      var green = (c.horiz ? st.h : st.v) === 'green';
      /* 路口停车线：红灯/黄灯时在路口前停下 */
      ROADS.forEach(function (ic) {
        if (!green) {
          if (c.dir === 1 && c.pos < ic - 0.18 && c.pos + sp + 0.3 >= ic - 0.12) go = false;
          if (c.dir === -1 && c.pos > ic + 1.18 && c.pos - sp - 0.3 <= ic + 1.12) go = false;
        }
      });
      /* 跟车：前车过近则等待 */
      cars.forEach(function (o) {
        if (o === c || o.horiz !== c.horiz || o.r !== c.r || o.dir !== c.dir) return;
        var gap = (o.pos - c.pos) * c.dir; if (gap < 0) gap += 12;
        if (gap > 0 && gap < 0.75) go = false;
      });
      if (go) c.pos += c.dir * sp;
      if (c.pos > 12) c.pos -= 12; if (c.pos < 0) c.pos += 12;
    });
    walkers.forEach(function (w) { w.pos += w.dir * w.speed * dt; if (w.pos > 12) w.dir = -1; if (w.pos < 0) w.dir = 1; });
    boats.forEach(function (b) { b.u += b.dir * b.speed * dt; if (b.u > 11.7) b.dir = -1; if (b.u < 10.3) b.dir = 1; });
  }
  function drawPerson(x, y, sc, body, hair, phase, opt) {
    opt = opt || {};
    var sw = Math.sin(phase) * 2 * sc, bob = Math.abs(Math.sin(phase)) * 1.2 * sc;
    ell(x + env.shadow.x * 6, y + 1, 4.5 * sc, 1.8 * sc, 'rgba(10,20,40,' + env.shadow.a * 1.4 + ')');
    ctx.fillStyle = '#2f3440'; ctx.fillRect(x - 2 * sc + sw * 0.5, y - 5 * sc, 1.8 * sc, 5 * sc); ctx.fillRect(x + 0.4 * sc - sw * 0.5, y - 5 * sc, 1.8 * sc, 5 * sc);
    ctx.fillStyle = body; rrect(x - 3 * sc, y - 12 * sc - bob, 6 * sc, 8 * sc, 1.6 * sc); ctx.fill();
    ctx.fillStyle = shade(body.indexOf('#') === 0 ? body : '#888888', 0.8); ctx.fillRect(x - 3.8 * sc - sw * 0.3, y - 11 * sc - bob, 1.3 * sc, 5 * sc); ctx.fillRect(x + 2.5 * sc + sw * 0.3, y - 11 * sc - bob, 1.3 * sc, 5 * sc);
    ctx.fillStyle = '#f0c8a0'; ctx.beginPath(); ctx.arc(x, y - 15 * sc - bob, 2.8 * sc, 0, 6.2832); ctx.fill();
    ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(x, y - 16 * sc - bob, 2.9 * sc, 3.14, 6.2832); ctx.fill();
    if (opt.tie) { ctx.fillStyle = '#c4372e'; ctx.fillRect(x - 0.5 * sc, y - 11 * sc - bob, 1 * sc, 4 * sc); }
    if (opt.case_) { ctx.fillStyle = '#7a4a2a'; ctx.fillRect(x + 3 * sc, y - 5 * sc - bob, 4.2 * sc, 3.4 * sc); ctx.fillStyle = '#d6a43a'; ctx.fillRect(x + 4.6 * sc, y - 5.4 * sc - bob, 1 * sc, 0.8 * sc); }
  }
  function drawWalker(w) {
    var p = w.horiz ? P(w.pos, w.r + w.side) : P(w.r + w.side, w.pos);
    drawPerson(p.x, p.y, 0.95, w.color, w.hair, env.t / 140 + w.seed);
  }
  function drawCar(c) {
    var pos = carPos(c), l = 0.5, w = 0.26;
    var u0 = c.horiz ? pos.u - l / 2 : pos.u - w / 2, u1 = c.horiz ? pos.u + l / 2 : pos.u + w / 2;
    var v0 = c.horiz ? pos.v - w / 2 : pos.v - l / 2, v1 = c.horiz ? pos.v + w / 2 : pos.v + l / 2;
    paintCar(u0, v0, u1, v1, c.color, c.horiz, c.dir, true);
  }
  function staticCar(u, v, color, horiz) { paintCar(u, v, u + (horiz ? 0.5 : 0.26), v + (horiz ? 0.26 : 0.5), color, horiz, 1, false); }
  function paintCar(u0, v0, u1, v1, color, horiz, dir, moving) {
    var b = prism(u0, v0, u1, v1, 1.5, 5, color, { shadow: false, topMul: 1.1 });
    var su = (u1 - u0) * 0.2, sv = (v1 - v0) * 0.2;
    var cab = prism(horiz ? u0 + su * 1.2 : u0 + 0.03, horiz ? v0 + 0.03 : v0 + sv * 1.2, horiz ? u1 - su * 1.2 : u1 - 0.03, horiz ? v1 - 0.03 : v1 - sv * 1.2, 6.5, 4, '#c9e2f2', { shadow: false });
    ctx.fillStyle = shade(color, 1.1); poly([P(horiz ? u0 + su * 1.2 : u0 + 0.03, horiz ? v0 + 0.03 : v0 + sv * 1.2, 10.5), P(horiz ? u1 - su * 1.2 : u1 - 0.03, horiz ? v0 + 0.03 : v0 + sv * 1.2, 10.5), P(horiz ? u1 - su * 1.2 : u1 - 0.03, horiz ? v1 - 0.03 : v1 - sv * 1.2, 10.5), P(horiz ? u0 + su * 1.2 : u0 + 0.03, horiz ? v1 - 0.03 : v1 - sv * 1.2, 10.5)], shade(color, 1.05));
    var mid = P((u0 + u1) / 2, (v0 + v1) / 2, 0); ell(mid.x, mid.y + 3, 7, 2.5, 'rgba(10,20,40,' + env.shadow.a + ')');
    if (moving && env.lit) { /* 车灯 */
      var hl = horiz ? P(dir > 0 ? u1 : u0, (v0 + v1) / 2, 4) : P((u0 + u1) / 2, dir > 0 ? v1 : v0, 4);
      glow(hl.x, hl.y, 20, '255,240,180', 0.45);
    }
  }
  function drawBoat(b) {
    var p = P(b.u, b.v), bob = Math.sin(env.t / 500 + b.u * 3) * 1.4;
    ell(p.x, p.y + 4, 14, 5, 'rgba(0,30,60,0.25)');
    var hull = prism(b.u - 0.2, b.v - 0.08, b.u + 0.2, b.v + 0.08, 0 + bob, 5, '#f4f2ee', { shadow: false });
    ctx.strokeStyle = '#d8d4cc'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y - 5 + bob); ctx.lineTo(p.x, p.y - 28 + bob); ctx.stroke();
    poly([{ x: p.x, y: p.y - 28 + bob }, { x: p.x + 12, y: p.y - 7 + bob }, { x: p.x, y: p.y - 7 + bob }], '#fff'); poly([{ x: p.x, y: p.y - 24 + bob }, { x: p.x - 9, y: p.y - 7 + bob }, { x: p.x, y: p.y - 7 + bob }], '#e8eef2');
  }

  /** 玩家：沿道路人行道行走到目标区域门口 */
  var hero = null;
  function doorPoint(rid) { var b = REGION_BLOCK[rid]; return { u: b.door.u, v: b.door.road + 0.94 }; }
  function routeTo(from, rid) {
    var b = REGION_BLOCK[rid], to = doorPoint(rid), road = b.door.road;
    /* 当前在哪条横路上（v 靠近 3 或 7），否则先走到最近的横路 */
    var fr = Math.abs(from.v - 3.94) < Math.abs(from.v - 7.94) ? 3 : 7;
    var pts = [{ u: from.u, v: fr + 0.94 }];
    if (fr !== road) { pts.push({ u: 3.94, v: fr + 0.94 }); pts.push({ u: 3.94, v: road + 0.94 }); }
    pts.push(to); return pts;
  }
  function updateHero(dt) {
    var S = BT.S; if (!S || !REGION_BLOCK[S.region]) return;
    if (!hero) { var d = doorPoint(S.region); hero = { u: d.u, v: d.v, path: [], face: 1, region: S.region, phase: 0 }; }
    if (hero.region !== S.region) { hero.region = S.region; hero.path = routeTo(hero, S.region); }
    if (hero.path.length) {
      var t = hero.path[0], du = t.u - hero.u, dv = t.v - hero.v, dist = Math.sqrt(du * du + dv * dv), step = 2.3 * dt;
      if (dist <= step) { hero.u = t.u; hero.v = t.v; hero.path.shift(); } else { hero.u += du / dist * step; hero.v += dv / dist * step; }
      hero.phase += dt * 14;
    }
  }
  function drawHero() {
    if (!hero) return;
    var p = P(hero.u, hero.v), moving = hero.path.length > 0, bob = moving ? 0 : Math.sin(env.t / 380) * 1;
    /* 金色光圈 + 箭头 */
    var pulse = 0.5 + 0.5 * Math.sin(env.t / 260);
    ctx.strokeStyle = 'rgba(255,215,102,' + (0.6 + pulse * 0.4) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, 11 + pulse * 3, 5 + pulse * 1.4, 0, 0, 6.2832); ctx.stroke();
    drawPerson(p.x, p.y, 1.55, '#2c3e66', '#1c1410', hero.phase, { tie: true, case_: true });
    var ay = p.y - 38 - (moving ? 0 : 0) + bob - Math.abs(Math.sin(env.t / 300)) * 3;
    poly([{ x: p.x - 5, y: ay }, { x: p.x + 5, y: ay }, { x: p.x, y: ay + 7 }], '#ffd766', 'rgba(0,0,0,0.5)');
  }

  /* ========================================================================
   * 七、天空、云、鸟、天气与光效
   * ===================================================================== */
  var SKY = { dawn: ['#46567e', '#f0b080'], day: ['#5aa7e0', '#dff0fa'], dusk: ['#4f3f78', '#f4a672'], night: ['#070d1c', '#1b2a4a'] };
  var clouds = [{ x: 90, y: 50, s: 1.2 }, { x: 420, y: 28, s: 1.5 }, { x: 760, y: 70, s: 1 }, { x: 600, y: 130, s: 0.8 }];
  var birds = [{ x: 100, y: 110, s: 18, p: 0 }, { x: 220, y: 90, s: 14, p: 2 }, { x: 300, y: 130, s: 20, p: 4 }];
  var parts = [];
  function initParts() { parts = []; for (var i = 0; i < 140; i++) parts.push({ x: Math.random() * (W + 120), y: Math.random() * H, s: 0.6 + Math.random() * 0.8 }); }

  function drawSky(dt) {
    var phase = env.phase, g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, SKY[phase][0]); g.addColorStop(1, SKY[phase][1]); ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, H * 3);
    if (phase === 'night') {
      for (var i = 0; i < 70; i++) { ctx.globalAlpha = (0.3 + 0.7 * Math.abs(Math.sin(env.t / 800 + i))) * 0.85; ctx.fillStyle = '#fff'; ctx.fillRect((i * 137) % W, (i * 61) % 200, 1.6, 1.6); }
      ctx.globalAlpha = 1; ctx.fillStyle = '#f5f0c8'; ctx.beginPath(); ctx.arc(840, 70, 20, 0, 6.2832); ctx.fill();
      ctx.fillStyle = SKY.night[0]; ctx.beginPath(); ctx.arc(848, 65, 18, 0, 6.2832); ctx.fill();
    } else {
      var hr = BT.S ? BT.S.hour : 12, fx = 80 + (hr - 6) / 14 * 800, fy = 150 - Math.sin(Math.min(1, Math.max(0, (hr - 6) / 14)) * 3.14) * 110;
      var sg = ctx.createRadialGradient(fx, fy, 4, fx, fy, 60); sg.addColorStop(0, phase === 'day' ? 'rgba(255,248,200,0.95)' : 'rgba(255,170,100,0.9)'); sg.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = sg; ctx.fillRect(fx - 60, fy - 60, 120, 120);
      ctx.fillStyle = phase === 'day' ? '#fff6c0' : '#ffb676'; ctx.beginPath(); ctx.arc(fx, fy, 15, 0, 6.2832); ctx.fill();
    }
    var dark = env.wk === 'storm' || env.wk === 'rain' || env.wk === 'cloudy';
    ctx.fillStyle = dark ? 'rgba(130,140,155,0.9)' : (phase === 'night' ? 'rgba(55,65,95,0.65)' : 'rgba(255,255,255,0.8)');
    clouds.forEach(function (c) {
      c.x += 7 * dt * c.s; if (c.x > W + 120) c.x = -140;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, 40 * c.s, 12 * c.s, 0, 0, 6.2832); ctx.ellipse(c.x + 26 * c.s, c.y - 9 * c.s, 26 * c.s, 12 * c.s, 0, 0, 6.2832); ctx.ellipse(c.x - 24 * c.s, c.y - 6 * c.s, 22 * c.s, 10 * c.s, 0, 0, 6.2832); ctx.fill();
    });
    if (phase === 'day' && !dark) { /* 飞鸟 */
      ctx.strokeStyle = 'rgba(40,50,60,0.7)'; ctx.lineWidth = 1.3;
      birds.forEach(function (b) { b.x += 26 * dt; if (b.x > W + 30) { b.x = -30; b.y = 70 + Math.random() * 90; } var f = Math.sin(env.t / 120 + b.p) * 4;
        ctx.beginPath(); ctx.moveTo(b.x - 7, b.y + f); ctx.quadraticCurveTo(b.x - 3, b.y - 3, b.x, b.y); ctx.quadraticCurveTo(b.x + 3, b.y - 3, b.x + 7, b.y + f); ctx.stroke(); });
    }
  }
  function drawWeather(dt) {
    var wk = env.wk;
    if (wk === 'rain' || wk === 'storm') {
      ctx.strokeStyle = 'rgba(200,220,255,0.6)'; ctx.lineWidth = 1; var n = wk === 'storm' ? 140 : 80; ctx.beginPath();
      for (var i = 0; i < n; i++) { var p = parts[i]; p.y += 420 * p.s * dt; p.x -= 90 * p.s * dt; if (p.y > H) { p.y = -12; p.x = Math.random() * (W + 120); } ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 4, p.y + 11); }
      ctx.stroke();
      if (wk === 'storm' && Math.random() < 0.006) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(0, 0, W, H); }
    } else if (wk === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (var j = 0; j < 110; j++) { var q = parts[j]; q.y += 45 * q.s * dt; q.x += Math.sin(q.y / 28 + j) * 10 * dt; if (q.y > H) { q.y = -6; q.x = Math.random() * W; } ctx.fillRect(q.x, q.y, 2.4 * q.s, 2.4 * q.s); }
    } else if (wk === 'hot') { ctx.fillStyle = 'rgba(255,150,40,0.10)'; ctx.fillRect(0, 0, W, H); }
  }
  function drawGlows() {
    if (!glows.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glows.forEach(function (g) {
      var rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
      rg.addColorStop(0, 'rgba(' + g.c + ',' + g.a + ')'); rg.addColorStop(1, 'rgba(' + g.c + ',0)');
      ctx.fillStyle = rg; ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
    });
    ctx.restore();
  }

  /* ========================================================================
   * 八、主循环与交互
   * ===================================================================== */
  var hitShapes = {};
  function regionHull(rid) {
    var b = REGION_BLOCK[rid], pts = [P(b.u0, b.v0), P(b.u1, b.v0), P(b.u1, b.v1), P(b.u0, b.v1), P(b.u0, b.v0, b.top), P(b.u1, b.v0, b.top), P(b.u1, b.v1, b.top), P(b.u0, b.v1, b.top)];
    return hull(pts);
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!canvas || document.hidden || !canvas.offsetParent) { lastT = now; return; }
    draw(now);
  }

  function applyView(dpr) {
    var k = view.k * view.zoom;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (view.cw / 2 + view.panX - W / 2 * k), dpr * (view.ch / 2 + view.panY - H / 2 * k));
  }
  function clampPan() {
    var k = view.k * view.zoom, mx = Math.max(0, (W * k - view.cw) / 2) + 80, my = Math.max(0, (H * k - view.ch) / 2) + 60;
    view.panX = Math.max(-mx, Math.min(mx, view.panX)); view.panY = Math.max(-my, Math.min(my, view.panY));
  }

  function draw(now) {
    if (!canvas) return;
    var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016; lastT = now;
    var S = BT.S, dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    var cw = canvas.clientWidth || W, ch = canvas.clientHeight || H;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    view.cw = cw; view.ch = ch; view.k = Math.min(cw / W, ch / H); clampPan();

    env.t = now; env.phase = dayPhase(); env.lit = env.phase === 'night' || env.phase === 'dusk'; env.wk = S ? S.weather : 'sunny';
    var hr = S ? S.hour : 12;
    env.shadow = { x: (hr - 13) * 0.07, y: 0.2 + Math.abs(hr - 13) * 0.012, a: env.phase === 'night' ? 0.0 : (env.wk === 'rain' || env.wk === 'storm' || env.wk === 'cloudy' ? 0.10 : (env.phase === 'day' ? 0.24 : 0.18)) };
    glows = [];

    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = SKY[env.phase][0]; ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyView(dpr);
    updateActors(dt); updateHero(dt);
    drawSky(dt);

    /* 地面静态层（缓存） */
    var gs = Math.min(2.5, Math.max(1, view.k * view.zoom * dpr));
    if (!groundCache || Math.abs(groundCache.scale - gs) > 0.45) groundCache = { scale: gs, cv: buildGround(gs) };
    ctx.drawImage(groundCache.cv, 0, 0, W, H);

    /* 水面（动画） */
    for (var gy = 7; gy < N; gy++) for (var gx = 10; gx < N; gx++) {
      var wob = Math.sin(now / 700 + gx * 1.3 + gy) * 0.5 + 0.5;
      poly([P(gx, gy), P(gx + 1, gy), P(gx + 1, gy + 1), P(gx, gy + 1)], 'rgb(' + Math.round(38 + wob * 14) + ',' + Math.round(116 + wob * 22) + ',' + Math.round(178 + wob * 16) + ')');
      var m = P(gx + 0.5, gy + 0.5), ph = (now / 1200 + hash(gx, gy) * 5) % 1;
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.35 * (1 - ph) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(m.x, m.y, 5 + ph * 16, 2.5 + ph * 8, 0, 0, 6.2832); ctx.stroke();
      if (gy === N - 1) poly([P(gx, N), P(gx + 1, N), { x: P(gx + 1, N).x, y: P(gx + 1, N).y + 12 }, { x: P(gx, N).x, y: P(gx, N).y + 12 }], '#1d5f92');
      if (gx === N - 1) poly([P(N, gy), P(N, gy + 1), { x: P(N, gy + 1).x, y: P(N, gy + 1).y + 12 }, { x: P(N, gy).x, y: P(N, gy).y + 12 }], '#164f7c');
    }

    /* 物件按深度排序后绘制（画家算法） */
    var items = SCENE.slice();
    cars.forEach(function (c) { var p = carPos(c); items.push({ d: p.u + p.v + 0.2, rid: null, draw: function () { drawCar(c); } }); });
    walkers.forEach(function (w) { var uv = w.horiz ? w.pos + w.r + w.side : w.r + w.side + w.pos; items.push({ d: uv, rid: null, draw: function () { drawWalker(w); } }); });
    boats.forEach(function (b) { items.push({ d: b.u + b.v, rid: null, draw: function () { drawBoat(b); } }); });
    if (hero) items.push({ d: hero.u + hero.v + 0.3, rid: null, draw: drawHero });
    items.sort(function (a, b) { return a.d - b.d; });

    items.forEach(function (it) {
      var locked = it.rid && S && S.unlockedRegions.indexOf(it.rid) < 0;
      grey = !!locked; it.draw(); grey = false;
    });

    /* 悬停高亮：街区地面描边 */
    if (hoverId && REGION_BLOCK[hoverId]) {
      var hb = REGION_BLOCK[hoverId];
      poly([P(hb.u0, hb.v0), P(hb.u1, hb.v0), P(hb.u1, hb.v1), P(hb.u0, hb.v1)], 'rgba(255,230,140,0.14)', 'rgba(255,215,102,0.95)', 2.2);
    }
    if (S) { var cb = REGION_BLOCK[S.region]; if (cb) poly([P(cb.u0, cb.v0), P(cb.u1, cb.v0), P(cb.u1, cb.v1), P(cb.u0, cb.v1)], null, 'rgba(255,215,102,' + (0.45 + 0.3 * Math.sin(now / 300)) + ')', 2); }

    drawWeather(dt);
    var tint = { night: 'rgba(8,16,52,0.42)', dusk: 'rgba(120,60,90,0.17)', dawn: 'rgba(80,90,140,0.15)', day: null }[env.phase];
    if (tint) { ctx.fillStyle = tint; ctx.fillRect(-W, -H, W * 3, H * 3); }
    drawGlows();

    /* 区域名牌（最后绘制，避免被建筑遮挡） */
    drawLabels(S);

    /* 屏幕空间：悬停信息卡 */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTooltip(S);
  }

  function drawLabels(S) {
    C.REGIONS.forEach(function (reg) {
      var b = REGION_BLOCK[reg.id]; if (!b) return;
      var locked = S && S.unlockedRegions.indexOf(reg.id) < 0, isHere = S && S.region === reg.id, isHover = hoverId === reg.id;
      var p = P((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, b.top + 16), bob = Math.sin(env.t / 500 + b.u0) * 1.6;
      var ls = 1 / Math.pow(view.zoom, 0.65); ctx.save(); ctx.translate(p.x, p.y); ctx.scale(ls, ls); ctx.translate(-p.x, -p.y);
      ctx.font = 'bold 14px ' + FONT; var tw = ctx.measureText(reg.name).width + (locked ? 34 : 22);
      var x = p.x - tw / 2, y = p.y - 11 + bob;
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; rrect(x + 1, y + 3, tw, 24, 8); ctx.fill();
      ctx.fillStyle = isHover ? '#ffe08a' : (isHere ? '#2e5a8f' : 'rgba(18,26,42,0.88)'); rrect(x, y, tw, 24, 8); ctx.fill();
      ctx.strokeStyle = isHere ? '#ffd766' : (isHover ? '#fff' : 'rgba(255,255,255,0.28)'); ctx.lineWidth = isHere ? 2 : 1; rrect(x, y, tw, 24, 8); ctx.stroke();
      poly([{ x: p.x - 5, y: y + 24 }, { x: p.x + 5, y: y + 24 }, { x: p.x, y: y + 31 }], isHover ? '#ffe08a' : (isHere ? '#2e5a8f' : 'rgba(18,26,42,0.88)'));
      ctx.fillStyle = reg.theme; ctx.beginPath(); ctx.arc(x + 11, y + 12, 4, 0, 6.2832); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = isHover ? '#3a2a00' : '#fff'; ctx.fillText(reg.name, x + 20, y + 13);
      if (locked) { /* 矢量挂锁 */
        var lx = x + tw - 14, ly = y + 13; ctx.strokeStyle = '#e8c15a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(lx, ly - 2.5, 3.2, 3.14, 6.2832); ctx.stroke();
        ctx.fillStyle = '#e8c15a'; rrect(lx - 4.5, ly - 2, 9, 7, 1.5); ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawTooltip(S) {
    if (!hoverId || !S || !pointer.in) return;
    var reg = C.regionMap[hoverId]; if (!reg) return;
    var locked = S.unlockedRegions.indexOf(hoverId) < 0, here = S.region === hoverId;
    var lines = [reg.name, '日租 ¥' + reg.rent + ' · 人流 ' + Math.round(reg.traffic * 100) + '%', reg.desc];
    lines.push(locked ? ('🔒 解锁条件：净资产 ≥ ¥' + (reg.unlock.value || 0)) : (here ? '📍 你正在这里' : '点击前往（耗时 1 小时）'));
    ctx.font = '12px ' + FONT; var w = 0; lines.forEach(function (l) { w = Math.max(w, ctx.measureText(l).width); }); w += 20;
    var h = lines.length * 18 + 14, x = Math.min(pointer.x + 16, view.cw - w - 6), y = Math.min(pointer.y + 16, view.ch - h - 6);
    ctx.fillStyle = 'rgba(14,20,34,0.94)'; rrect(x, y, w, h, 8); ctx.fill(); ctx.strokeStyle = 'rgba(255,215,102,0.7)'; ctx.lineWidth = 1; rrect(x, y, w, h, 8); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    lines.forEach(function (l, i) { ctx.font = (i === 0 ? 'bold 13px ' : '12px ') + FONT; ctx.fillStyle = i === 0 ? '#ffd766' : (i === 3 ? (locked ? '#ff9f8a' : '#9fe0a8') : '#cfd6e4'); ctx.fillText(l, x + 10, y + 16 + i * 18); });
  }

  /* ---------- 交互：缩放 / 平移 / 点击 / 悬停 ---------- */
  var pointer = { x: 0, y: 0, in: false }, drag = null;
  function toWorld(cx, cy) {
    var k = view.k * view.zoom;
    return { x: (cx - (view.cw / 2 + view.panX) + W / 2 * k) / k, y: (cy - (view.ch / 2 + view.panY) + H / 2 * k) / k };
  }
  function hit(cx, cy) {
    var w = toWorld(cx, cy), best = null, bestD = -1;
    Object.keys(REGION_BLOCK).forEach(function (id) {
      var hl = hitShapes[id] || (hitShapes[id] = regionHull(id));
      if (inPoly(w, hl)) { var b = REGION_BLOCK[id], d = b.u1 + b.v1; if (d > bestD) { bestD = d; best = id; } }
    });
    return best;
  }
  function local(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function bind() {
    canvas.addEventListener('mousedown', function (e) { var p = local(e); drag = { x: p.x, y: p.y, px: view.panX, py: view.panY, moved: false }; });
    window.addEventListener('mouseup', function (e) {
      if (drag && !drag.moved && e.target === canvas) { var p = local(e), id = hit(p.x, p.y); if (id && BT.App) BT.App.travelTo(id); }
      drag = null; if (canvas) canvas.style.cursor = hoverId ? 'pointer' : 'grab';
    });
    canvas.addEventListener('mousemove', function (e) {
      var p = local(e); pointer = { x: p.x, y: p.y, in: true };
      if (drag) { var dx = p.x - drag.x, dy = p.y - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { view.panX = drag.px + dx; view.panY = drag.py + dy; canvas.style.cursor = 'grabbing'; hoverId = null; return; } }
      hoverId = hit(p.x, p.y); canvas.style.cursor = hoverId ? 'pointer' : 'grab';
    });
    canvas.addEventListener('mouseleave', function () { hoverId = null; pointer.in = false; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault(); var p = local(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { MapUI.reset(); });
    /* 触屏：单指拖动、双指缩放 */
    var tpts = {}, pinch = 0;
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); Array.prototype.forEach.call(e.touches, function (t) { tpts[t.identifier] = t; });
      if (e.touches.length === 1) { var p = { x: e.touches[0].clientX - canvas.getBoundingClientRect().left, y: e.touches[0].clientY - canvas.getBoundingClientRect().top }; drag = { x: p.x, y: p.y, px: view.panX, py: view.panY, moved: false }; }
      if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); var r = canvas.getBoundingClientRect();
      if (e.touches.length === 2) { var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); if (pinch) zoomAt((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top, d / pinch); pinch = d; if (drag) drag.moved = true; }
      else if (drag) { var dx = e.touches[0].clientX - r.left - drag.x, dy = e.touches[0].clientY - r.top - drag.y; if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true; if (drag.moved) { view.panX = drag.px + dx; view.panY = drag.py + dy; } } }, { passive: false });
    canvas.addEventListener('touchend', function (e) { e.preventDefault();
      if (drag && !drag.moved && e.changedTouches.length) { var r = canvas.getBoundingClientRect(), id = hit(e.changedTouches[0].clientX - r.left, e.changedTouches[0].clientY - r.top); if (id && BT.App) BT.App.travelTo(id); }
      if (!e.touches.length) { drag = null; pinch = 0; } }, { passive: false });
  }
  function zoomAt(cx, cy, f) {
    var before = toWorld(cx, cy), nz = Math.max(1, Math.min(3, view.zoom * f)); if (nz === view.zoom) return;
    view.zoom = nz; var k = view.k * view.zoom;
    view.panX = cx - view.cw / 2 - (before.x - W / 2) * k; view.panY = cy - view.ch / 2 - (before.y - H / 2) * k; clampPan();
  }

  /* ========================================================================
   * 九、对外接口
   * ===================================================================== */
  MapUI.init = function (canvasEl) {
    canvas = canvasEl; ctx = canvas.getContext('2d');
    SCENE = []; buildOldStreet(); buildCollege(); buildSlum(); buildCBD(); buildMarket(); buildPort(); buildFiller(); buildStreetFurniture();
    initActors(); initParts(); bind(); canvas.style.cursor = 'grab';
    if (!rafId) rafId = requestAnimationFrame(frame);
  };
  /* 动画循环每帧自动重绘，数据变化无需手动刷新（保留接口以兼容 render.js 调用） */
  MapUI.render = function () { };
  MapUI.zoomBy = function (f) { zoomAt(view.cw / 2, view.ch / 2, f); };
  MapUI.reset = function () { view.zoom = 1; view.panX = 0; view.panY = 0; };
  MapUI.toggleBig = function () {
    var wrap = document.getElementById('map-wrap'); if (!wrap) return;
    wrap.classList.toggle('map-big'); document.body.classList.toggle('no-scroll', wrap.classList.contains('map-big')); MapUI.reset(); groundCache = null;
  };
})();
