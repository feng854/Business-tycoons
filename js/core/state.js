/* ==========================================================================
 * 文件：js/core/state.js
 * 作用：游戏状态 S 的定义、新建存档、读写 localStorage、净资产计算、里程碑判定
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG;
  var SAVE_KEY = 'bt_save_v1';
  var SAVE_VERSION = 4;
  var SLOT_COUNT = 6;
  BT.SLOT_COUNT = SLOT_COUNT;
  /* 存档时丢掉日内路径等可再生数据，压缩体积 */
  function ser(S) { return JSON.stringify(S, function (k, v) { return k === 'path' && Array.isArray(v) ? undefined : v; }); }

  /* ========================================================================
   * 一、新建存档
   * ===================================================================== */
  function newGame(seed, difficulty) {
    BT.rng.seed(seed || Date.now());
    var diff = C.DIFFICULTY[difficulty] ? difficulty : 'normal';
    var S = {
      version: SAVE_VERSION,
      seed: BT.rng.getState(),
      uidCounter: 0,
      phase: 1,                 /* 1=白手起家 2=商业扩张 3=资本帝国 */
      day: 1,
      hour: C.DAY_START_H,
      cash: C.DIFFICULTY[diff].startCash,
      difficulty: diff,
      endings: {}, endingQueue: [],
      netHist: [],               /* 每日净资产历史（统计图用） */
      bagUpgrades: {},
      insolventDays: 0,
      debt: 0,
      bagCap: C.START_BAG,
      bag: {},                  /* goodsId -> [{qty, cost, boughtDay}] 批次，便于过期与成本核算 */
      region: 'slum',
      stamina: 100, staminaMax: 100,
      energy: 100, energyMax: 100,
      health: 100,
      skills: {},                /* skillId -> level(0-5) */
      unlockedRegions: ['slum', 'market', 'oldst'],
      jobsDoneToday: {},
      milestones: { m1: false, m2: false, m3: false },
      bizProfitStreak: 0,        /* 连续盈利天数（用于里程碑 needBiz 判定） */
      stall: null,               /* {regionId, goodsId, price, level} */
      shop: null,                /* 第一阶段的第一间店 */
      quests: [], achievements: {},
      weather: 'sunny',
      logs: [],
      stats: { totalEarned: 0, totalSpent: 0, daysPlayed: 0, income: {}, stockPnl: 0, stockTrades: 0, donated: 0 },
      /* 第二阶段 */
      biz: null,
      /* 第三阶段 */
      market: null,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    BT.S = S;
    BT.Log.list = [];
    BT.Bus.emit('newgame', S);
    return S;
  }
  BT.newGame = newGame;

  /* ========================================================================
   * 二、净资产计算
   *    净资产 = 现金 + 存货(按成本的80%估值) + 摊位/店铺资产 + 第二/三阶段资产 - 负债
   * ===================================================================== */
  function bagValue(S) {
    var v = 0;
    BT.U.keys(S.bag).forEach(function (gid) {
      (S.bag[gid] || []).forEach(function (lot) { v += lot.qty * lot.cost * 0.8; });
    });
    return v;
  }
  function netWorth(S) {
    S = S || BT.S;
    var v = S.cash - S.debt + bagValue(S);
    if (S.stall) v += (S.stall.invested || 0) * 0.5;
    if (S.shop) v += (S.shop.value || 0);
    if (S.biz && BT.Biz && BT.Biz.netWorth) v += BT.Biz.netWorth(S);
    if (S.market && BT.Market && BT.Market.netWorth) v += BT.Market.netWorth(S);
    if (S.estate && BT.Empire && BT.Empire.netWorth) v += BT.Empire.netWorth(S);
    return Math.round(v);
  }
  BT.netWorth = netWorth;

  /* ========================================================================
   * 三、里程碑判定（每日结算后调用）
   * ===================================================================== */
  function checkMilestones(S) {
    var nw = netWorth(S);
    var hasBiz = !!(S.stall || S.shop);
    var profitOK = S.bizProfitStreak >= 3;
    C.MILESTONES.forEach(function (m) {
      if (S.milestones[m.id]) return;
      var ok = nw >= m.need && (!m.needBiz || (hasBiz && profitOK));
      if (ok) {
        S.milestones[m.id] = true;
        BT.Log.add('🏆 里程碑达成：' + m.name + '（净资产 ' + BT.U.money(nw) + '）', 'good');
        BT.Bus.emit('milestone', m);
        if (m.id === 'm3' && S.phase === 1) {
          S.phase = 2;
          if (BT.Biz && BT.Biz.ensure) BT.Biz.ensure(S);
          BT.Log.add('📈 进入第二阶段「商业扩张」！', 'sys');
          BT.Bus.emit('phase', 2);
        }
      }
    });
  }
  BT.checkMilestones = checkMilestones;

  /* ========================================================================
   * 四、存档读写
   * ===================================================================== */
  function save() {
    var S = BT.S; if (!S) return false;
    S.updatedAt = Date.now();
    S.seed = BT.rng.getState();
    S.logs = BT.Log.list.slice(-120);
    try {
      /* 每过一个游戏日，把上一份自动存档留作备份（误操作 / 破产前可以回退一天） */
      var prev = localStorage.getItem(SAVE_KEY);
      if (prev) { var pd = prev.match(/"day":(\d+)/); if (pd && +pd[1] !== S.day && prev.indexOf('"createdAt":' + S.createdAt) >= 0) localStorage.setItem(SAVE_KEY + '_bak', prev); }
      localStorage.setItem(SAVE_KEY, ser(S));
      return true;
    } catch (e) { console.warn('[存档失败]', e); return false; }
  }
  BT.save = save;

  function saveToSlot(slot, label) {
    var S = BT.S; if (!S) return false;
    S.updatedAt = Date.now(); S.seed = BT.rng.getState(); S.logs = BT.Log.list.slice(-120);
    if (label != null) S.slotLabel = String(label).slice(0, 16);
    try { localStorage.setItem(SAVE_KEY + '_slot' + slot, ser(S)); return true; }
    catch (e) { console.warn('[存档失败]', e); return false; }
  }
  BT.deleteSlot = function (slot) { try { localStorage.removeItem(SAVE_KEY + '_slot' + slot); return true; } catch (e) { return false; } };
  BT.hasBackup = function () { try { return !!localStorage.getItem(SAVE_KEY + '_bak'); } catch (e) { return false; } };
  BT.backupInfo = function () { var S = loadRaw(SAVE_KEY + '_bak'); return S ? { day: S.day, net: netWorth(S), time: S.updatedAt } : null; };
  BT.loadBackup = function () {
    var S = loadRaw(SAVE_KEY + '_bak'); if (!S) return false;
    BT.S = S; BT.rng.setState(S.seed || 1); BT.Log.list = S.logs || [];
    BT.Bus.emit('loaded', S); return true;
  };
  BT.saveToSlot = saveToSlot;

  function loadRaw(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var S = JSON.parse(raw);
      if (S.version !== SAVE_VERSION) { S = migrate(S); }
      return S;
    } catch (e) { console.warn('[读档失败]', e); return null; }
  }
  /** 旧存档迁移：补齐新版本新增的字段，保证老玩家的存档能继续玩 */
  function migrate(S) {
    var rs = BT.rng.getState(); /* 迁移过程中可能用到随机数，不能打乱当前对局的随机序列 */
    try { migrateInner(S); } finally { BT.rng.setState(rs); }
    return S;
  }
  function migrateInner(S) {
    S.version = SAVE_VERSION;
    S.jobsDoneToday = S.jobsDoneToday || {};
    Object.keys(S.jobsDoneToday).forEach(function (k) { if (S.jobsDoneToday[k] === true) S.jobsDoneToday[k] = 1; }); /* 旧版“每天一次”布尔值 → 次数 */
    S.insolventDays = S.insolventDays || 0;
    S.difficulty = S.difficulty || 'normal';
    S.endings = S.endings || {}; S.endingQueue = S.endingQueue || [];
    S.netHist = S.netHist || []; S.bagUpgrades = S.bagUpgrades || {};
    S.stats = S.stats || {}; S.stats.income = S.stats.income || {};
    ['stockPnl', 'stockTrades', 'donated'].forEach(function (k) { S.stats[k] = S.stats[k] || 0; });
    if (S.market && !S.market.news) S.market.news = [];
    if (S.biz) {
      (S.biz.loans || []).forEach(function (l) { l.lateCount = l.lateCount || 0; });
      if (BT.Biz && BT.Biz.nameCompetitors) BT.Biz.nameCompetitors(S.biz);
      if (BT.Biz && BT.Biz.migrate) BT.Biz.migrate(S); /* v4：门店地段、员工能力/忠诚、AI 竞争对手 */
    }
    /* v4：期货合约月份、外汇利率、财报季日历由 Market.prepare 自动补齐 */
    if (S.market && BT.Market && BT.Market.prepare) { var keep = BT.S; BT.S = S; try { BT.Market.prepare(S); } catch (e) { console.warn(e); } BT.S = keep; }
    return S;
  }

  function load() {
    var S = loadRaw(SAVE_KEY);
    if (!S) return false;
    BT.S = S;
    BT.rng.setState(S.seed || 1);
    BT.Log.list = S.logs || [];
    BT.Bus.emit('loaded', S);
    return true;
  }
  BT.load = load;

  function loadSlot(slot) {
    var S = loadRaw(SAVE_KEY + '_slot' + slot);
    if (!S) return false;
    BT.S = S; BT.rng.setState(S.seed || 1); BT.Log.list = S.logs || [];
    BT.Bus.emit('loaded', S);
    return true;
  }
  BT.loadSlot = loadSlot;

  /* ========================================================================
   * 存档导出 / 导入（一段文本，可复制到别处备份、换浏览器继续玩）
   * ===================================================================== */
  BT.exportSave = function () {
    var S = BT.S; if (!S) return '';
    S.seed = BT.rng.getState(); S.logs = BT.Log.list.slice(-120);
    return 'BT3:' + btoa(unescape(encodeURIComponent(JSON.stringify(S))));
  };
  BT.importSave = function (text) {
    try {
      text = (text || '').trim();
      if (text.indexOf('BT3:') !== 0) return { ok: false, msg: '格式不对：存档文本应以 BT3: 开头' };
      var S = JSON.parse(decodeURIComponent(escape(atob(text.slice(4)))));
      if (!S || typeof S.day !== 'number' || typeof S.cash !== 'number' || !S.skills) return { ok: false, msg: '存档内容不完整，无法导入' };
      S = migrate(S);
      BT.S = S; BT.rng.setState(S.seed || 1); BT.Log.list = S.logs || [];
      BT.save(); BT.Bus.emit('loaded', S);
      return { ok: true, msg: '导入成功：第 ' + S.day + ' 天，净资产 ' + BT.U.money(netWorth(S)) };
    } catch (e) { return { ok: false, msg: '导入失败：存档文本损坏' }; }
  };

  BT.hasAutoSave = function () { return !!localStorage.getItem(SAVE_KEY); };
  BT.slotInfo = function (slot) {
    var S = loadRaw(SAVE_KEY + '_slot' + slot);
    if (!S) return null;
    return { day: S.day, phase: S.phase, net: netWorth(S), time: S.updatedAt, label: S.slotLabel || '', diff: S.difficulty, challenge: !!S.challenge, cheated: !!S.cheated, shops: S.biz ? S.biz.shops.length : 0 };
  };
  BT.deleteAll = function () {
    for (var i = 0; i < SLOT_COUNT; i++) localStorage.removeItem(SAVE_KEY + '_slot' + i);
    localStorage.removeItem(SAVE_KEY + '_bak');
    localStorage.removeItem(SAVE_KEY);
  };
})();
