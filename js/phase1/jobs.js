/* ==========================================================================
 * 文件：js/phase1/jobs.js
 * 作用：第一阶段 —— 临时工与技能学习系统
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.CFG, U = BT.U, Eco = BT.Eco;
  var Jobs = BT.Jobs = {};

  /* ========================================================================
   * 一、临时工
   * ===================================================================== */
  Jobs.available = function (S) {
    return C.TEMP_JOBS.filter(function (j) {
      if (j.region !== S.region) return false;
      if (j.need && j.need.skill) {
        var lv = (S.skills && S.skills[j.need.skill]) || 0;
        if (lv < j.need.lv) return false;
      }
      return true;
    });
  };

  /** 今日已完成次数（兼容旧存档里的 true 值） */
  Jobs.doneCount = function (S, jobId) {
    var v = S.jobsDoneToday && S.jobsDoneToday[jobId];
    return v === true ? 1 : (v || 0);
  };

  Jobs.canDo = function (S, job) {
    if (S.hour + job.hours > C.DAY_END_H + 2) return { ok: false, msg: '时间不够了，赶紧回家睡觉吧' };
    if (S.stamina < job.stamina * 0.3) return { ok: false, msg: '体力太低，先休息一下' };
    if (Jobs.doneCount(S, job.id) >= C.JOB_DAILY_LIMIT) return { ok: false, msg: '今天这份工作已经做满 ' + C.JOB_DAILY_LIMIT + ' 次了' };
    return { ok: true };
  };

  Jobs.do = function (S, jobId) {
    var job = C.TEMP_JOBS.filter(function (j) { return j.id === jobId; })[0];
    if (!job) return { ok: false, msg: '工作不存在' };
    var chk = Jobs.canDo(S, job); if (!chk.ok) return chk;

    var fatigue = Eco.fatiguePenalty(S);
    var carryLv = (S.skills && S.skills.carry) || 0;
    var bonus = (S.events && S.events.bonusJob) ? 1.25 : 1;
    var skillMul = 1 + carryLv * 0.06;
    var n = Jobs.doneCount(S, jobId);
    var repeatMul = C.JOB_REPEAT_MUL[Math.min(n, C.JOB_REPEAT_MUL.length - 1)];
    var pay = Math.round(job.pay * fatigue * skillMul * bonus * repeatMul);

    Eco.spend(S, { stamina: job.stamina, energy: job.energy, hours: job.hours });
    Eco.earn(S, pay, job.name);
    S.jobsDoneToday[jobId] = n + 1;
    if (BT.Quests && BT.Quests.notify) BT.Quests.notify(S, 'job', { jobId: jobId });
    return { ok: true, msg: '完成「' + job.name + '」，获得 ' + U.money(pay) };
  };

  /* ========================================================================
   * 二、技能学习
   * ===================================================================== */
  Jobs.skillLevel = function (S, id) { return (S.skills && S.skills[id]) || 0; };

  Jobs.canLearn = function (S, skillId) {
    var sk = C.skillMap[skillId]; if (!sk) return { ok: false, msg: '技能不存在' };
    if (S.region !== sk.region) return { ok: false, msg: '需要在' + C.regionMap[sk.region].name + '学习' };
    var lv = Jobs.skillLevel(S, skillId);
    if (lv >= 5) return { ok: false, msg: '已经是满级了' };
    var cost = C.skillCost(sk.costBase, lv);
    var time = C.skillTime(sk.timeBase, lv);
    if (S.cash < cost) return { ok: false, msg: '学费不够（需要 ' + U.money(cost) + '）' };
    if (S.energy < 15) return { ok: false, msg: '精力不足，学不进去了' };
    if (S.hour + time > C.DAY_END_H + 2) return { ok: false, msg: '时间不够了' };
    return { ok: true, cost: cost, time: time };
  };

  Jobs.learn = function (S, skillId) {
    var chk = Jobs.canLearn(S, skillId); if (!chk.ok) return chk;
    var sk = C.skillMap[skillId];
    Eco.pay(S, chk.cost, '学习「' + sk.name + '」');
    Eco.spend(S, { energy: 15 + chk.time * 2, hours: chk.time });
    S.skills[skillId] = Jobs.skillLevel(S, skillId) + 1;
    BT.Log.add('📚 ' + sk.icon + ' ' + sk.name + ' 升级到 Lv.' + S.skills[skillId] + '！', 'good');
    if (BT.Quests && BT.Quests.notify) BT.Quests.notify(S, 'skill', { skillId: skillId });
    return { ok: true, msg: '学习成功，' + sk.name + ' → Lv.' + S.skills[skillId] };
  };
})();
