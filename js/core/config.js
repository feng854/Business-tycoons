/* ==========================================================================
 * 文件：js/core/config.js
 * 作用：全局静态配置表 —— 区域、商品、临时工、技能、天气、里程碑等
 * 说明：所有数值都是可调参数，调数值只改这个文件，不改逻辑代码。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG = {};

  /* ========================================================================
   * 一、城市区域（新港市 6 区）
   *    rent: 每日固定开销基数；traffic: 人流基数(0-1)；unlock: 解锁条件
   * ===================================================================== */
  C.REGIONS = [
    { id: 'slum', name: '城中村', icon: '🏚️', x: 60, y: 230, rent: 8, traffic: 0.35, theme: '#8a6d3b',
      desc: '起始住所，房租最低，适合搬运与发传单。', unlock: { type: 'start' } },
    { id: 'market', name: '批发市场', icon: '📦', x: 220, y: 300, rent: 14, traffic: 0.55, theme: '#c0622a',
      desc: '商品种类最全、进价最低的地方。', unlock: { type: 'start' } },
    { id: 'oldst', name: '老街', icon: '🏮', x: 180, y: 120, rent: 10, traffic: 0.5, theme: '#b23b3b',
      desc: '本地居民为主，消费稳定，适合摆摊。', unlock: { type: 'start' } },
    { id: 'cbd', name: '商业街', icon: '🏙️', x: 400, y: 160, rent: 30, traffic: 0.85, theme: '#2f6fb3',
      desc: '购买力强、竞争也强，适合开店。', unlock: { type: 'net', value: 800 } },
    { id: 'port', name: '车站码头', icon: '🚢', x: 440, y: 320, rent: 18, traffic: 0.7, theme: '#2f9e8f',
      desc: '外地客流多，货物吞吐量大，适合倒货。', unlock: { type: 'net', value: 500 } },
    { id: 'college', name: '学院区', icon: '🎓', x: 330, y: 70, rent: 12, traffic: 0.45, theme: '#7a52c7',
      desc: '学生聚集，有培训点，学技能最划算。', unlock: { type: 'net', value: 300 } }
  ];
  C.regionMap = {};
  C.REGIONS.forEach(function (r) { C.regionMap[r.id] = r; });

  /* ========================================================================
   * 二、商品表（区域差价 + 买卖套利系统）
   *    base: 基础价；vol: 日波动幅度；spoil: 每日腐坏率(0=不过期)；
   *    unit: 体积（占用背包/仓库格数）；favored: 低价区域(进货更便宜)
   * ===================================================================== */
  C.GOODS = [
    { id: 'veg', name: '新鲜蔬菜', icon: '🥬', base: 4, vol: 0.18, spoil: 0.12, unit: 1, favored: ['market'] },
    { id: 'fruit', name: '时令水果', icon: '🍎', base: 7, vol: 0.2, spoil: 0.1, unit: 1, favored: ['market', 'port'] },
    { id: 'snack', name: '休闲零食', icon: '🍪', base: 6, vol: 0.08, spoil: 0, unit: 1, favored: ['market'] },
    { id: 'drink', name: '瓶装饮料', icon: '🥤', base: 3.5, vol: 0.06, spoil: 0, unit: 1, favored: ['market'] },
    { id: 'daily', name: '日用百货', icon: '🧴', base: 12, vol: 0.1, spoil: 0, unit: 2, favored: ['market'] },
    { id: 'cloth', name: '平价服饰', icon: '👕', base: 35, vol: 0.15, spoil: 0, unit: 3, favored: ['market', 'oldst'] },
    { id: 'phonecase', name: '手机配件', icon: '📱', base: 18, vol: 0.12, spoil: 0, unit: 1, favored: ['market', 'college'] },
    { id: 'toy', name: '小玩具', icon: '🧸', base: 15, vol: 0.14, spoil: 0, unit: 2, favored: ['market'] },
    { id: 'stationery', name: '文具用品', icon: '✏️', base: 9, vol: 0.07, spoil: 0, unit: 1, favored: ['market', 'college'] },
    { id: 'tea', name: '特产茶叶', icon: '🍵', base: 48, vol: 0.22, spoil: 0, unit: 2, favored: ['port'] },
    { id: 'seafood', name: '码头海产', icon: '🦐', base: 26, vol: 0.25, spoil: 0.2, unit: 2, favored: ['port'] },
    { id: 'antique', name: '老街古玩', icon: '🏺', base: 90, vol: 0.3, spoil: 0, unit: 4, favored: ['oldst'] }
  ];
  C.goodsMap = {};
  C.GOODS.forEach(function (g) { C.goodsMap[g.id] = g; });

  /* 区域价格系数：同一件商品在不同区域的基础倍率（favored 区域更低，CBD/码头更高） */
  C.REGION_PRICE_MUL = {
    slum: 1.00, market: 0.80, oldst: 1.05, cbd: 1.35, port: 1.15, college: 1.10
  };

  /* ========================================================================
   * 三、临时工（无门槛，体力消耗型）
   *    pay: 单次基础报酬；hours: 耗时；stamina/energy: 消耗；need: 解锁条件
   * ===================================================================== */
  C.TEMP_JOBS = [
    { id: 'flyer', name: '发传单', icon: '📄', region: 'slum', hours: 2, stamina: 15, energy: 5, pay: 36, need: null },
    { id: 'porter', name: '批发市场搬运工', icon: '🛒', region: 'market', hours: 3, stamina: 28, energy: 8, pay: 72, need: null },
    { id: 'dish', name: '餐馆洗碗', icon: '🍽️', region: 'oldst', hours: 3, stamina: 24, energy: 10, pay: 66, need: null },
    { id: 'delivery', name: '外卖骑手', icon: '🛵', region: 'cbd', hours: 4, stamina: 30, energy: 12, pay: 110, need: { skill: null } },
    { id: 'dock', name: '码头装卸工', icon: '⚓', region: 'port', hours: 4, stamina: 34, energy: 10, pay: 128, need: null },
    { id: 'tutor', name: '学院区家教', icon: '📖', region: 'college', hours: 2, stamina: 6, energy: 22, pay: 90, need: { skill: 'mind', lv: 1 } }
  ];

  /* ========================================================================
   * 四、技能（体力系 + 脑力系，1-5 级）
   *    costBase: 1级学费；timeBase: 1级耗时（小时）；每级成本递增 1.6 倍
   * ===================================================================== */
  C.SKILLS = [
    { id: 'carry', name: '搬运技巧', icon: '💪', type: 'body', region: 'market', costBase: 60, timeBase: 3,
      desc: '提升搬运、装卸类工作的时薪与进货效率。' },
    { id: 'cook', name: '烹饪手艺', icon: '🍳', type: 'body', region: 'oldst', costBase: 80, timeBase: 4,
      desc: '提升摊位小吃/摊位商品的成交率与利润。' },
    { id: 'nego', name: '议价谈判', icon: '🤝', type: 'mind', region: 'college', costBase: 100, timeBase: 3,
      desc: '进货更便宜，摆摊/开店售价上限更高。' },
    { id: 'acct', name: '会计记账', icon: '🧮', type: 'mind', region: 'college', costBase: 90, timeBase: 3,
      desc: '降低店铺经营成本，解锁更精细的账本。' },
    { id: 'mind', name: '表达与教学', icon: '🎙️', type: 'mind', region: 'college', costBase: 70, timeBase: 2,
      desc: '解锁家教等脑力工作，并提升销售成交率。' }
  ];
  C.skillMap = {};
  C.SKILLS.forEach(function (s) { C.skillMap[s.id] = s; });
  C.skillCost = function (base, lv) { return Math.round(base * Math.pow(1.6, lv)); };
  C.skillTime = function (base, lv) { return Math.round((base + lv * 1.2) * 10) / 10; };

  /* ========================================================================
   * 五、里程碑（第一阶段三级解锁）
   * ===================================================================== */
  C.MILESTONES = [
    { id: 'm1', name: '第一次积累', need: 1000, desc: '净资产达到 ¥1,000：解锁更多交易机会与新区域。' },
    { id: 'm2', name: '初步创业', need: 3000, needBiz: true, desc: '净资产达到 ¥3,000 且生意持续盈利：解锁店铺经营与员工系统。' },
    { id: 'm3', name: '第一桶金', need: 10000, needBiz: true, desc: '净资产达到 ¥10,000 且生意正常经营：开启第二阶段「商业扩张」。' }
  ];

  /* ========================================================================
   * 六、天气（影响摆摊客流与心情）
   * ===================================================================== */
  C.WEATHERS = [
    { id: 'sunny', name: '晴', icon: '☀️', traffic: 1.1, w: 42 },
    { id: 'cloudy', name: '阴', icon: '⛅', traffic: 1.0, w: 26 },
    { id: 'rain', name: '小雨', icon: '🌧️', traffic: 0.7, w: 16 },
    { id: 'storm', name: '暴雨', icon: '⛈️', traffic: 0.4, w: 6 },
    { id: 'hot', name: '酷热', icon: '🥵', traffic: 0.8, w: 6 },
    { id: 'snow', name: '降雪', icon: '❄️', traffic: 0.55, w: 4 }
  ];

  /* ========================================================================
   * 七、杂项数值
   * ===================================================================== */
  C.START_CASH = 300;
  C.START_BAG = 20;        /* 初始背包容量（格） */
  C.DAY_START_H = 6;
  C.DAY_END_H = 24;
  C.SLEEP_RECOVER = { stamina: 55, energy: 50, health: 4 };
  C.LATE_SLEEP_PENALTY = 0.6; /* 熬夜：每晚睡超过24点扣除下日体力上限的比例 */
})();
