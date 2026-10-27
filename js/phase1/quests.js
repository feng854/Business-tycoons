/* ==========================================================================
 * 文件：js/phase1/quests.js
 * 作用：第一阶段 —— 新手任务链、随机委托、成就系统
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var U = BT.U, Eco = BT.Eco;
  var Q = BT.Quests = {};

  /* ========================================================================
   * 一、新手任务链（按顺序解锁，完成一个才出现下一个）
   * ===================================================================== */
  var CHAIN = [
    { id: 'q1', name: '找到第一份工作', desc: '完成任意一次临时工', reward: 30,
      done: function (S, ev) { return ev && ev.kind === 'job'; } },
    { id: 'q2', name: '第一次进货', desc: '在批发市场买入任意商品', reward: 30,
      done: function (S, ev) { return ev && ev.kind === 'buy'; } },
    { id: 'q3', name: '第一次摆摊', desc: '成功摆摊卖出至少1件商品', reward: 50,
      done: function (S, ev) { return ev && ev.kind === 'stallSell' && ev.data.sold > 0; } },
    { id: 'q4', name: '学习一门技能', desc: '在学院区/老街/批发市场学习任意技能', reward: 60,
      done: function (S, ev) { return ev && ev.kind === 'skill'; } }
  ];

  /* ========================================================================
   * 二、随机委托（里程碑1后解锁，每隔几天刷新）
   * ===================================================================== */
  var COMMISSION_POOL = [
    { id: 'c_sell', name: '代卖委托', desc: '累计出售 15 件任意商品', target: 15, track: 'sellCount', reward: 80 },
    { id: 'c_earn', name: '业绩冲刺', desc: '累计赚取 ¥500', target: 500, track: 'earnAmount', reward: 100 },
    { id: 'c_job', name: '勤劳打工人', desc: '累计完成 5 次临时工', target: 5, track: 'jobCount', reward: 70 }
  ];

  /* ========================================================================
   * 三、成就（仅展示/收藏，不影响数值）
   * ===================================================================== */
  var ACHIEVEMENTS = [
    { id: 'a_first_k', name: '第一桶金', cond: function (S) { return S.milestones.m3; } },
    { id: 'a_no_stayup', name: '作息规律', cond: function (S) { return (S.stats.daysPlayed || 0) >= 7 && (S.streakNoLate || 0) >= 7; } },
    { id: 'a_big_day', name: '日入过百', cond: function (S) { return (S.bestDayIncome || 0) >= 100; } },
    { id: 'a_skill_max', name: '一技之长', cond: function (S) { return U.keys(S.skills).some(function (k) { return S.skills[k] >= 5; }); } }
  ];

  Q.init = function (S) {
    S.questChain = S.questChain || 0; /* 已完成的新手任务数量 */
    S.commission = S.commission || null;
    S.progress = S.progress || { sellCount: 0, earnAmount: 0, jobCount: 0 };
    S.achievements = S.achievements || {};
  };

  /** 各系统调用：通知一个事件发生，用于推进任务/成就 */
  Q.notify = function (S, kind, data) {
    Q.init(S);
    var ev = { kind: kind, data: data || {} };
    /* 新手任务链 */
    if (S.questChain < CHAIN.length) {
      var cur = CHAIN[S.questChain];
      if (cur.done(S, ev)) {
        S.questChain += 1;
        Eco.earn(S, cur.reward, '完成任务「' + cur.name + '」');
      }
    }
    /* 进度累加 */
    if (kind === 'job') S.progress.jobCount += 1;
    if (kind === 'stallSell' || kind === 'shopProfit') S.progress.sellCount += (data.sold || 0);
    if (kind === 'buy') { /* 由 Trade.buy 可选调用，当前版本通过通用拦截在 UI 层触发 */ }
  };

  Q.earnTrack = function (S, amount) { Q.init(S); S.progress.earnAmount += amount; };

  /** 每日检查：刷新委托、结算成就 */
  Q.dailyCheck = function (S) {
    Q.init(S);
    if (!S.milestones.m1) return;
    if (!S.commission && BT.rng.chance(0.5)) {
      var pick = BT.rng.pick(COMMISSION_POOL);
      S.commission = { id: pick.id, name: pick.name, desc: pick.desc, target: pick.target, track: pick.track,
        reward: pick.reward, startVal: S.progress[pick.track] || 0 };
      BT.Log.add('📋 新的委托：' + pick.name + ' —— ' + pick.desc, 'event');
    } else if (S.commission) {
      var c = S.commission;
      var cur = (S.progress[c.track] || 0) - c.startVal;
      if (cur >= c.target) {
        Eco.earn(S, c.reward, '完成委托「' + c.name + '」');
        S.commission = null;
      }
    }
    ACHIEVEMENTS.forEach(function (a) {
      if (!S.achievements[a.id] && a.cond(S)) {
        S.achievements[a.id] = S.day;
        BT.Log.add('🎖️ 成就解锁：' + a.name, 'good');
      }
    });
    var todayNet = (S.todayIncome || 0) - (S.todayExpense || 0);
    S.bestDayIncome = Math.max(S.bestDayIncome || 0, S.todayIncome || 0);
  };

  Q.chainInfo = function (S) { Q.init(S); return S.questChain < CHAIN.length ? CHAIN[S.questChain] : null; };
  Q.allAchievements = function () { return ACHIEVEMENTS; };
})();
