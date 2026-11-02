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
    { id: 'a_stock1', name: '初入股市', cond: function (S) { return (S.stats.stockTrades || 0) >= 1; } },
    { id: 'a_stock_win', name: '股市赢家', cond: function (S) { return (S.stats.stockPnl || 0) >= 5000; } },
    { id: 'a_chain3', name: '连锁起步', cond: function (S) { return S.biz && S.biz.shops.length >= 3; } },
    { id: 'a_debt_free', name: '无债一身轻', cond: function (S) { return S.biz && (S.biz.loansRepaid || 0) >= 1 && S.debt <= 0; } },
    { id: 'a_landlord', name: '包租公', cond: function (S) { return S.estate && U.keys(S.estate).length >= 1; } },
    { id: 'a_sold100', name: '百件成交', cond: function (S) { return (S.progress && S.progress.sellCount || 0) >= 100; } },
    { id: 'a_day30', name: '坚持一月', cond: function (S) { return S.day >= 30; } },
    { id: 'a_charity', name: '乐善好施', cond: function (S) { return (S.stats.donated || 0) >= 1000; } },
    { id: 'a_skill_max', name: '一技之长', cond: function (S) { return U.keys(S.skills).some(function (k) { return S.skills[k] >= 5; }); } },
    { id: 'a_rich10', name: '登上富豪榜', cond: function (S) { return (S.stats.bestRank || 99) <= 10; } },
    { id: 'a_tender', name: '政府供应商', cond: function (S) { return S.tenders && S.tenders.list.some(function (t) { return t.status === 'delivered'; }); } },
    { id: 'a_unicorn', name: '慧眼识珠', cond: function (S) { return S.vc && S.vc.holds.some(function (h) { return h.exit && h.exit >= h.invest * 5; }); } },
    { id: 'a_franchise', name: '加盟帝国', cond: function (S) { return S.biz && S.biz.fr && S.biz.fr.stores.length >= 5; } },
    { id: 'a_ipo', name: '敲钟', cond: function (S) { return S.ipo && S.ipo.status === 'listed'; } },
    { id: 'a_rival_buy', name: '吞并对手', cond: function (S) { return (S.stats.acquired || 0) >= 1; } },
    { id: 'a_last_man', name: '笑到最后', cond: function (S) { return S.biz && S.biz.rivals && S.biz.rivals.some(function (r) { return r.fate === 'bankrupt'; }); } },
    { id: 'a_team5', name: '金牌团队', cond: function (S) { return S.biz && S.biz.shops.some(function (sh) { return sh.employees.filter(function (e) { return e.skill >= 4; }).length >= 2; }); } },
    { id: 'a_roll', name: '换月老手', cond: function (S) { return (S.stats.rolls || 0) >= 3; } },
    { id: 'a_carry', name: '吃息达人', cond: function (S) { return S.market && U.keys(S.market.posFx || {}).some(function (k) { return (S.market.posFx[k].swap || 0) >= 100; }); } }
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
    ACHIEVEMENTS.forEach(function (a) {
          if (!S.achievements[a.id] && a.cond(S)) {
            S.achievements[a.id] = S.day;
            BT.Log.add('🎖️ 成就解锁：' + a.name, 'good');
            BT.Bus.emit('achievement', a);
          }
        });
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
    var todayNet = (S.todayIncome || 0) - (S.todayExpense || 0);
    S.bestDayIncome = Math.max(S.bestDayIncome || 0, S.todayIncome || 0);
  };

  Q.chainInfo = function (S) { Q.init(S); return S.questChain < CHAIN.length ? CHAIN[S.questChain] : null; };
  Q.allAchievements = function () { return ACHIEVEMENTS; };
})();
