/* ==========================================================================
 * 文件：js/core/utils.js
 * 作用：全局命名空间 BT、可存档随机数、金额/日期格式化、事件总线、日志
 * 说明：所有脚本都是普通 <script>（不依赖打包工具），双击 index.html 也能运行。
 * ========================================================================== */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;
  var BT = root.BT = root.BT || {};

  /* ======================================================================
   * 一、可存档的随机数生成器（mulberry32）
   *    状态保存在存档里，读档后随机序列可以继续，便于复现与测试。
   * ====================================================================== */
  var rngState = 123456789;
  var rng = {
    seed: function (s) { rngState = (s >>> 0) || 1; },
    getState: function () { return rngState >>> 0; },
    setState: function (s) { rngState = (s >>> 0) || 1; },
    /** [0,1) 均匀随机数 */
    next: function () {
      rngState = (rngState + 0x6D2B79F5) >>> 0;
      var t = rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** [a,b) 区间浮点 */
    range: function (a, b) { return a + (b - a) * rng.next(); },
    /** [a,b] 区间整数 */
    int: function (a, b) { return a + Math.floor(rng.next() * (b - a + 1)); },
    /** 以概率 p 返回 true */
    chance: function (p) { return rng.next() < p; },
    /** 从数组随机取一个 */
    pick: function (arr) { return arr[Math.floor(rng.next() * arr.length)]; },
    /** 标准正态分布（Box-Muller） */
    normal: function () {
      var u = 0, v = 0;
      while (u === 0) u = rng.next();
      while (v === 0) v = rng.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** 厚尾分布（方差归一的 Student-t，df 越小尾部越厚），用于模拟真实行情的“黑天鹅”尖峰 */
    fat: function (df) {
      df = df || 5;
      var chi = 0;
      for (var i = 0; i < df; i++) { var z = rng.normal(); chi += z * z; }
      return rng.normal() * Math.sqrt(df / chi) * Math.sqrt((df - 2) / df);
    },
    /** 按权重函数抽取：list 为数组，wf(item) 返回权重 */
    weighted: function (list, wf) {
      var tot = 0, i, w;
      for (i = 0; i < list.length; i++) { w = wf(list[i]); if (w > 0) tot += w; }
      if (tot <= 0) return null;
      var r = rng.next() * tot;
      for (i = 0; i < list.length; i++) {
        w = wf(list[i]); if (w <= 0) continue;
        r -= w; if (r <= 0) return list[i];
      }
      return list[list.length - 1];
    },
    /** 泊松分布（小均值用乘积法，大均值用正态近似） */
    poisson: function (lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rng.normal()));
      var L = Math.exp(-lambda), k = 0, p = 1;
      do { k++; p *= rng.next(); } while (p > L);
      return k - 1;
    }
  };
  BT.rng = rng;

  /* ======================================================================
   * 二、数学与格式化工具
   * ====================================================================== */
  var U = BT.U = {};
  U.clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.round2 = function (x) { return Math.round(x * 100) / 100; };
  U.sum = function (arr, f) { var s = 0; for (var i = 0; i < arr.length; i++) s += f ? f(arr[i]) : arr[i]; return s; };
  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  U.keys = function (o) { return Object.keys(o || {}); };

  /** 金额格式：≥1亿显示“x.xx亿”，≥1000万显示“x万”，其余千分位 */
  U.money = function (n) {
    if (!isFinite(n)) return '¥0';
    var s = n < 0 ? '-' : '', a = Math.abs(n), r;
    if (a >= 1e8) r = (a / 1e8).toFixed(2) + '亿';
    else if (a >= 1e7) r = (a / 1e4).toFixed(0) + '万';
    else if (a >= 1000) r = Math.round(a).toLocaleString('en-US');
    else r = (Math.round(a * 100) / 100).toFixed(Math.abs(a % 1) > 0.004 ? 2 : 0);
    return s + '¥' + r;
  };
  /** 数量缩写：万/亿 */
  U.compact = function (n, d) {
    d = d == null ? 2 : d;
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e8) return s + (a / 1e8).toFixed(d) + '亿';
    if (a >= 1e4) return s + (a / 1e4).toFixed(d) + '万';
    return s + Math.round(a).toLocaleString('en-US');
  };
  U.pct = function (x, d) { d = d == null ? 2 : d; return (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%'; };
  U.fix = function (x, d) { return Number(x).toFixed(d); };
  U.hhmm = function (h) {
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  };

  /* ======================================================================
   * 三、日期：第 1 天 = 2026-01-05（周一）
   * ====================================================================== */
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var dateCache = {};
  U.dateOf = function (day) {
    if (dateCache[day]) return dateCache[day];
    var t = new Date(Date.UTC(2026, 0, 5 + day - 1));
    var y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate(), w = t.getUTCDay();
    var o = {
      y: y, m: m, d: d, w: w, wd: WD[w], key: y * 10000 + m * 100 + d,
      str: y + '年' + m + '月' + d + '日', ym: y * 100 + m,
      short: m + '月' + d + '日', season: (m === 12 || m <= 2) ? 'winter' : (m <= 5 ? 'spring' : (m <= 8 ? 'summer' : 'autumn'))
    };
    dateCache[day] = o;
    return o;
  };
  /** 是否交易日（周一至周五） */
  U.isTradingDay = function (day) { var w = U.dateOf(day).w; return w >= 1 && w <= 5; };
  /** 查找某个“年月日”对应的游戏天数（用于历史数据生成，day≤0 表示开局之前） */
  U.dayOfDate = function (y, m, d) {
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 5)) / 86400000) + 1;
  };

  /* ======================================================================
   * 四、事件总线：各模块通过 on/emit 解耦
   *    约定事件：hour(小时结束) dayEnd(睡觉结算) dayStart(新的一天)
   *             changed(状态变化，UI刷新) phase(阶段变化) log(新日志)
   * ====================================================================== */
  var handlers = {};
  BT.Bus = {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit: function (ev, a, b, c) {
      var hs = handlers[ev]; if (!hs) return;
      for (var i = 0; i < hs.length; i++) hs[i](a, b, c);
    },
    clear: function () { handlers = {}; }
  };

  /* ======================================================================
   * 五、日志与新闻
   * ====================================================================== */
  BT.Log = {
    list: [],
    /** type: info 普通 / good 好事 / bad 坏事 / event 事件 / sys 系统 */
    add: function (msg, type) {
      var S = BT.S;
      var e = { t: type || 'info', m: msg, day: S ? S.day : 0, hour: S ? S.hour : 0 };
      BT.Log.list.push(e);
      if (BT.Log.list.length > 300) BT.Log.list.shift();
      if (S) { S.logs = BT.Log.list.slice(-120); }
      BT.Bus.emit('log', e);
    }
  };

  /** 唯一ID生成（计数器随存档保存） */
  BT.uid = function (prefix) {
    var S = BT.S; if (!S) return (prefix || 'id') + Math.random().toString(36).slice(2, 8);
    S.uidCounter = (S.uidCounter || 0) + 1;
    return (prefix || 'id') + S.uidCounter;
  };
})();
