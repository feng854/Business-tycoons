/* ==========================================================================
 * 文件：js/core/state.js
 * 作用：游戏状态 S 的定义、新建存档、读写 localStorage、净资产计算、里程碑判定
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG;
  var SAVE_KEY = 'bt_save_v1';
  var SAVE_VERSION = 1;

  /* ========================================================================
   * 一、新建存档
   * ===================================================================== */
  function newGame(seed) {
    BT.rng.seed(seed || Date.now());
    var S = {
      version: SAVE_VERSION,
      seed: BT.rng.getState(),
      uidCounter: 0,
      phase: 1,                 /* 1=白手起家 2=商业扩张 3=资本帝国 */
      day: 1,
      hour: C.DAY_START_H,
      cash: C.START_CASH,
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
      stats: { totalEarned: 0, totalSpent: 0, daysPlayed: 0 },
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
      localStorage.setItem(SAVE_KEY, JSON.stringify(S));
      return true;
    } catch (e) { console.warn('[存档失败]', e); return false; }
  }
  BT.save = save;

  function saveToSlot(slot) {
    var S = BT.S; if (!S) return false;
    S.updatedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY + '_slot' + slot, JSON.stringify(S)); return true; }
    catch (e) { return false; }
  }
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
  function migrate(S) { S.version = SAVE_VERSION; return S; } /* 预留：未来版本在此迁移旧存档 */

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

  BT.hasAutoSave = function () { return !!localStorage.getItem(SAVE_KEY); };
  BT.slotInfo = function (slot) {
    var S = loadRaw(SAVE_KEY + '_slot' + slot);
    if (!S) return null;
    return { day: S.day, phase: S.phase, net: netWorth(S), time: S.updatedAt };
  };
  BT.deleteAll = function () {
    for (var i = 0; i < 3; i++) localStorage.removeItem(SAVE_KEY + '_slot' + i);
    localStorage.removeItem(SAVE_KEY);
  };
})();
