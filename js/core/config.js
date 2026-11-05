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
  /* 区域在地图街区上的“门口”坐标（与 js/ui/map.js 的 REGION_BLOCK 一致），用于按路程计算前往耗时 */
  C.REGION_DOOR = {
    oldst: { u: 1.5, road: 3 }, college: { u: 9.5, road: 3 }, slum: { u: 1.5, road: 7 },
    cbd: { u: 5.5, road: 3 }, market: { u: 5.5, road: 7 }, port: { u: 9.5, road: 7 }
  };
  /** 两区域之间的步行路程（格）：同一条横路直接走；不同横路需绕到中间竖路 u≈3.9 */
  C.travelDistance = function (a, b) {
    var A = C.REGION_DOOR[a], B = C.REGION_DOOR[b]; if (!A || !B || a === b) return 0;
    if (A.road === B.road) return Math.abs(A.u - B.u);
    return Math.abs(A.u - 3.94) + Math.abs(B.u - 3.94) + Math.abs(A.road - B.road);
  };
  /** 前往耗时（小时）：约每 4 格 1 小时，至少 1 小时 */
  C.travelHours = function (a, b) { return Math.max(1, Math.round(C.travelDistance(a, b) / 4)); };
  /* 通关目标：净资产达到该值视为“资本帝国”达成 */
  C.VICTORY_NET = 1000000;
  /* 破产判定：净资产低于该值的连续天数达到上限则游戏结束 */
  C.BANKRUPT_NET = -200; C.BANKRUPT_DAYS = 5;
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
  /* 每份临时工每天最多可做的次数，以及第N次的报酬系数（第2、3次略有递减，避免刷工资过强） */
  C.JOB_DAILY_LIMIT = 3;
  C.JOB_REPEAT_MUL = [1, 0.65, 0.4];
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
  C.START_BAG = 40;        /* 初始背包容量（格） */
  /* 背包升级：每项只能买一次，在批发市场购买，容量累加 */
  C.BAG_UPGRADES = [
    { id: 'cart', name: '手推车', icon: '🛒', cap: 20, cost: 150 },
    { id: 'tricycle', name: '三轮车', icon: '🛺', cap: 40, cost: 500 },
    { id: 'van', name: '小货车', icon: '🚐', cap: 80, cost: 1800 },
    { id: 'truck', name: '厢式货车', icon: '🚚', cap: 160, cost: 6000 }
  ];
  /* 难度：startCash 起始资金；costMul 房租伙食倍率；bankruptDays 破产容忍天数；trouble 麻烦事件权重倍率 */
  C.DIFFICULTY = {
    easy:   { name: '休闲', desc: '起始 ¥600，开销 ×0.7，破产容忍 8 天', startCash: 600, costMul: 0.7, bankruptDays: 8, trouble: 0.6 },
    normal: { name: '标准', desc: '起始 ¥300，标准节奏', startCash: 300, costMul: 1, bankruptDays: 5, trouble: 1 },
    hard:   { name: '硬核', desc: '起始 ¥150，开销 ×1.4，破产容忍 3 天，麻烦事件更多', startCash: 150, costMul: 1.4, bankruptDays: 3, trouble: 1.6 }
  };
  /* 结局：达成后弹出一次，可选择继续经营 */
  C.ENDINGS = {
    tycoon:   { name: '资本帝国', icon: '👑', desc: '净资产突破 ¥1,000,000，你建成了资本帝国！' },
    stock:    { name: '股神', icon: '📈', desc: '股票交易累计已实现盈利超过 ¥100,000，华尔街都听说了你的名字。' },
    chain:    { name: '连锁大亨', icon: '🏬', desc: '六大区域全部开设分店且品牌声望超过 60，新港市处处是你的招牌。' },
    landlord: { name: '地产大亨', icon: '🏢', desc: '名下地产市值突破 ¥200,000，躺着收租也能富甲一方。' },
    charity:  { name: '慈善家', icon: '❤️', desc: '累计捐赠超过 ¥50,000，你的善举被全城传颂。' },
    ipo:      { name: '敲钟上市', icon: '🔔', desc: '你的公司在新港交易所挂牌上市，从此成为一只真正的股票。' }
  };
  C.DAILY_CHALLENGE_DAYS = 60;

  /* ========================================================================
   * 八、经营深度：门店地段 / 一周客流曲线 / 员工特质与培训
   * ===================================================================== */
  /* 地段：rentMul 租金倍率；traffic 路过客流倍率；costMul 开店装修倍率 */
  C.LOCATIONS = [
    { id: 'alley', name: '巷内小铺', icon: '🏚️', rentMul: 0.6, traffic: 0.62, costMul: 0.7, desc: '租金便宜、客流少，适合低价走量或做熟客生意' },
    { id: 'street', name: '临街铺面', icon: '🏠', rentMul: 1.0, traffic: 1.0, costMul: 1.0, desc: '中规中矩的选择' },
    { id: 'corner', name: '路口旺铺', icon: '🏙️', rentMul: 1.8, traffic: 1.5, costMul: 1.6, desc: '人流最大，但租金和装修都贵，货一断就亏' }
  ];
  C.locMap = {}; C.LOCATIONS.forEach(function (l) { C.locMap[l.id] = l; });
  /* 一周客流（下标 0=周日 … 6=周六）：写字楼区工作日旺，老街/码头周末旺 */
  C.WEEK_TRAFFIC = {
    slum:    [1.05, 0.95, 0.95, 0.95, 1.0, 1.05, 1.1],
    market:  [0.85, 1.1, 1.05, 1.05, 1.05, 1.1, 0.9],
    oldst:   [1.3, 0.85, 0.9, 0.9, 0.95, 1.05, 1.35],
    cbd:     [0.75, 1.15, 1.1, 1.1, 1.15, 1.25, 0.85],
    port:    [1.2, 0.95, 0.9, 0.9, 0.95, 1.1, 1.25],
    college: [0.7, 1.1, 1.15, 1.15, 1.1, 0.95, 0.75]
  };
  /* 员工特质：sales/service 为能力加成；loyalty 为忠诚度每日漂移；learn 为培训加成 */
  C.EMP_TRAITS = [
    { id: 'warm', name: '热情', desc: '销售+0.5', sales: 0.5 },
    { id: 'careful', name: '细心', desc: '服务+0.5', service: 0.5 },
    { id: 'steady', name: '稳重', desc: '忠诚度更稳，难被挖角', loyalty: 0.25 },
    { id: 'ambitious', name: '有野心', desc: '培训有概率连升两级，但更容易跳槽', learn: 0.35, loyalty: -0.2 },
    { id: 'slow', name: '慢热', desc: '刚入职表现一般，自己慢慢成长得快', grow: 0.02 },
    { id: 'plain', name: '踏实', desc: '没有明显特点' }
  ];
  C.traitMap = {}; C.EMP_TRAITS.forEach(function (t) { C.traitMap[t.id] = t; });
  /* 培训课程：脱产 1 天（当天不上班），费用随等级递增 */
  C.TRAINING = {
    sales: { name: '销售培训', icon: '🗣️', desc: '提升成交（销售能力）', base: 120 },
    service: { name: '服务培训', icon: '🤝', desc: '提升口碑增长（服务能力）', base: 100 }
  };

  /* ========================================================================
   * 八·二、区域客群：各区对各品类的需求倍率（>1 热销、<1 滞销，默认 1）+ 价格敏感度
   *    需求影响「顾客挑中这件商品的概率」和「挑中后真的掏钱的概率」；价格敏感度越高，加价越伤销量。
   * ===================================================================== */
  C.REGION_DEMAND = {
    slum:    { veg: 1.4, daily: 1.35, drink: 1.25, snack: 1.15, cloth: 0.8, tea: 0.5, antique: 0.3, phonecase: 0.8, toy: 0.9, seafood: 0.7 },
    market:  { veg: 1.15, fruit: 1.15, daily: 1.1, cloth: 1.1, antique: 0.6, tea: 0.85 },
    oldst:   { antique: 1.5, tea: 1.4, veg: 1.2, fruit: 1.2, phonecase: 0.65, stationery: 0.8, toy: 1.1 },
    cbd:     { cloth: 1.35, phonecase: 1.3, tea: 1.15, drink: 1.1, veg: 0.45, daily: 0.8, toy: 0.85 },
    port:    { seafood: 1.5, tea: 1.3, drink: 1.25, snack: 1.2, daily: 0.75, stationery: 0.6 },
    college: { stationery: 1.55, phonecase: 1.4, snack: 1.3, drink: 1.25, antique: 0.3, tea: 0.6, cloth: 1.05 }
  };
  C.demandOf = function (rid, gid) { var t = C.REGION_DEMAND[rid]; return t && t[gid] != null ? t[gid] : 1; };
  /* 价格敏感度：城中村、学院区的人对价格很敏感；商业街不太在乎 */
  C.REGION_PRICE_SENS = { slum: 1.6, market: 1.3, oldst: 1.0, cbd: 0.65, port: 0.9, college: 1.4 };
  /* 公司门店客流基数（区域人流 × 这个数 = 满员、无竞争时的日客流）与顾客一次买几件的概率（1 / 2 / 3 件）
     v7.3 平衡：原来 55 + 平均 1.3 件，一家店的毛利撑不起两个店员的工资；现在认真经营的店能赚钱，乱开的店照样亏 */
  C.SHOP_TRAFFIC = 64;
  /* 区域购买力：越高越买得起贵货（门店里单价远超购买力的货，成交率会打折） */
  C.REGION_WEALTH = { slum: 0.55, market: 0.85, oldst: 0.95, cbd: 1.6, port: 1.15, college: 0.75 };
  C.BASKET = [0.45, 0.35, 0.20];

  /* ========================================================================
   * 八·三、奢侈品（只在公司阶段、做过「精品装修」的门店经营；不能背包倒卖、不能普通批发）
   *    fob: 海外出厂价（外币）；ccy: 计价货币（汇率取金融页实时外汇）；
   *    duty 关税、vat 增值税、excise 消费税（按完税价计）；risk: 水货里混入假货的概率
   *    官方进口到岸成本 = fob × 汇率 × (1+关税) × (1+增值税) × (1+消费税)
   * ===================================================================== */
  C.LUX = [
    { id: 'watch',   name: '瑞士名表', icon: '⌚', ccy: 'usd', fob: 300, duty: 0.11, vat: 0.13, excise: 0.20, unit: 1, fake: 0.10, cat: '腕表' },
    { id: 'bag',     name: '意式名包', icon: '👜', ccy: 'eur', fob: 230, duty: 0.10, vat: 0.13, excise: 0, unit: 1, fake: 0.12, cat: '皮具' },
    { id: 'jewel',   name: '珠宝首饰', icon: '💍', ccy: 'usd', fob: 150, duty: 0.08, vat: 0.13, excise: 0.10, unit: 1, fake: 0.08, cat: '珠宝' },
    { id: 'wine',    name: '进口名酒', icon: '🍷', ccy: 'eur', fob: 75,  duty: 0.14, vat: 0.13, excise: 0.10, unit: 1, fake: 0.06, cat: '酒类' },
    { id: 'perfume', name: '香水美妆', icon: '💄', ccy: 'eur', fob: 30,  duty: 0.05, vat: 0.13, excise: 0.15, unit: 1, fake: 0.07, cat: '美妆' }
  ];
  C.LUX.forEach(function (g) { g.lux = true; g.spoil = 0; g.vol = 0; g.favored = []; g.base = g.fob * (g.ccy === 'usd' ? 7.1 : 7.75); C.goodsMap[g.id] = g; });
  C.ALL_GOODS = C.GOODS.concat(C.LUX);
  /* 奢侈品客流：到店顾客里有多大比例是奢侈品买家（商业街最高） */
  C.LUX_RATE = { cbd: 0.035, port: 0.016, college: 0.008, oldst: 0.008, market: 0.002, slum: 0.001 };
  C.LUX_PRICE_SENS = 0.55; /* 奢侈品买家对加价不太敏感 */
  C.TRADE = {
    boutiqueCost: 15000,   /* 精品装修（奢侈品专柜）一次性费用 */
    boutiqueUpkeep: 80,    /* 每日安保与保险 */
    licenseDays: 90,       /* 品牌代理权期限 */
    licenseQuota: 30,      /* 代理期内每 30 天的进货配额（件） */
    officialLead: 4,       /* 正规进口：海运 + 报关，天 */
    greyLead: 2,           /* 水货：旅客/小船夹带，天 */
    inspectRate: 0.25,     /* 正规进口被海关抽中查验的概率（查验要多等 1~3 天） */
    greyMarkup: 1.12,      /* 水货：在境外按零售价拿货（出厂价 ×1.12），但不交关税/增值税/消费税 —— 税越重的商品，水货价差越大 */
    seizeRate: 0.12,       /* 水货每批被海关查扣的概率（严打期间 ×3） */
    fineMul: 0.5,          /* 查扣后罚款 = 货值 × 0.5 */
    targetStock: 6         /* 一键补货时奢侈品每件补到几件（只从仓库调，不会自动进口） */
  };

  /* ========================================================================
   * 九、AI 竞争对手公司（第二阶段起与玩家抢客流、抢人才，可并购或被并购）
   *    style: premium 高端 / discount 折扣 / balanced 均衡 / aggressive 激进
   *    aggr: 扩张与打价格战的倾向；listed: 对应的上市股票（经营好坏影响股价）
   * ===================================================================== */
  C.RIVALS = [
    { id: 'xingyao', name: '星耀集团', icon: '💎', style: 'premium', home: 'cbd', cash: 60000, brand: 42, aggr: 0.35, color: '#c58cff',
      regions: { cbd: 2, college: 1 }, desc: '主打高端，品牌强，不爱打价格战，喜欢挖人。' },
    { id: 'wanjia', name: '万家连锁', icon: '🛒', style: 'discount', home: 'market', cash: 42000, brand: 28, aggr: 0.65, color: '#ff9f43',
      regions: { market: 2, slum: 1 }, desc: '低价走量，看到你赚钱就开打价格战。' },
    { id: 'xinhui', name: '新辉零售', icon: '🏪', style: 'balanced', home: 'oldst', cash: 160000, brand: 38, aggr: 0.4, color: '#4fd1c5', listed: 'xhls',
      regions: { oldst: 2, cbd: 1, port: 1 }, desc: '本地巨头、上市公司（股票 XHLS），进货便宜、钱多，敢打持久战；经营数据写进季报，直接影响股价。' },
    { id: 'yuanyang', name: '远洋商贸', icon: '⚓', style: 'aggressive', home: 'port', cash: 36000, brand: 24, aggr: 0.8, color: '#6aa3ff',
      regions: { port: 2 }, desc: '扩张激进、爱借钱，行情好时猛冲，行情差时最先出问题。' }
  ];
  C.STYLE_NAMES = { premium: '高端', discount: '折扣', balanced: '均衡', aggressive: '激进' };
  /* 规模层级：big 巨头（钱厚、进货便宜、能长期亏本打掠夺性定价）/ mid 区域连锁（钱有限，只敢小幅压价）
     小型（个体店 / 摊贩）不单独建模，见下方 C.HAWKERS 散户池 */
  C.RIVAL_TIER = { xinhui: 'big' };
  C.TIER_NAMES = { big: '巨头', mid: '区域连锁' };
  /* 外来巨头：公司做大后才会进军新港市 */
  C.GIANT = { id: 'dingsheng', name: '鼎盛集团', icon: '🏛️', style: 'discount', tier: 'big', cash: 320000, brand: 50, aggr: 0.6, color: '#ff6b6b',
    desc: '全国连锁巨头，进货比谁都便宜，敢长期亏本卖货把对手挤死。' };

  /* ========================================================================
   * 九·一、竞争参数（AI 定价 / 价格战 / 玩家价格敏感）
   * ===================================================================== */
  C.COMPETE = {
    markup: { premium: 1.55, balanced: 1.38, discount: 1.22, aggressive: 1.28 }, /* AI 平时的加价倍率（玩家默认 1.3 左右） */
    costMul: { big: 0.9, mid: 1 },     /* 进货成本：巨头规模采购便宜 10% */
    floor: { mid: 1.02, big: 0.98, predatory: 0.85 }, /* 价格战最低能压到 成本 × 这个数 */
    refMarkup: 1.35,                   /* 吸引力里的“正常价位” */
    hitK: 2.5,                         /* 单品被对手比下去时的成交损失系数 */
    grace: 30,                         /* 公司成立头 30 天，中大型 AI 不主动针对你 */
    maxOnMe: 2,                        /* 同时针对你的 AI 最多几家 */
    maxShops: { big: 6, mid: 4 },
    giantDay: 60                       /* 公司成立满 60 天且做到一定规模，外来巨头可能入场 */
  };

  /* ========================================================================
   * 九·二、散户池（小型对手：个体店 / 流动摊贩）—— 不单独建模，每区一个数量
   *    base: 各区平时有多少家；goods: 他们会卖的大众货；跟风：你在哪赚钱、什么货火，他们就往哪扎堆
   * ===================================================================== */
  C.HAWKERS = {
    base: { slum: 7, market: 10, oldst: 8, cbd: 3, port: 5, college: 6 },
    goods: ['veg', 'fruit', 'snack', 'drink', 'stationery', 'phonecase', 'toy'],
    k: 0.09,          /* 每家同款摊贩对你摆摊客流的分流强度 */
    cut: 0.03         /* 平时比基准价便宜 3% */
  };

  /* ========================================================================
   * 十、供应链（涨价 / 断供 / 长约）：影响全局进货价与第二阶段批发
   * ===================================================================== */
  C.SUPPLY = {
    startDay: 8,          /* 开局几天后才开始出现供应链事件 */
    dailyChance: 0.16,    /* 每天出现一条供应链预警的概率 */
    contractDays: 30,     /* 长约期限 */
    contractDiscount: 0.95, /* 长约锁定价 = 签约时市价 × 0.95 */
    emergencyMul: 1.4,    /* 断供时找应急供应商的加价 */
    emergencyCap: 60      /* 应急采购每单上限（件） */
  };
  C.DAY_START_H = 6;
  C.DAY_END_H = 24;
  C.SLEEP_RECOVER = { stamina: 55, energy: 50, health: 4 };
  C.LATE_SLEEP_PENALTY = 0.6; /* 熬夜：每晚睡超过24点扣除下日体力上限的比例 */
})();
