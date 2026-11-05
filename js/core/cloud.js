/* ==========================================================================
 * 文件：js/core/cloud.js
 * 作用：云存档客户端 —— 调用 /api/save（见 functions/api/save.js），用存档码 + 密码在设备间同步。
 *       存档码会记在本机；密码只有勾选「记住密码」才保存在本机。
 * ========================================================================== */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var Cloud = BT.Cloud = {};
  var K_CODE = 'bt_cloud_code', K_PASS = 'bt_cloud_pass', K_LAST = 'bt_cloud_last';
  Cloud.endpoint = 'api/save';
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return ''; } }
  Cloud.saved = function () { return { code: ls(K_CODE), pass: ls(K_PASS), last: ls(K_LAST) }; };
  Cloud.remember = function (code, pass, keepPass) { ls(K_CODE, code); ls(K_PASS, keepPass ? pass : null); };
  Cloud.newCode = function () { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
  function post(body) {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve({ ok: false, msg: '云存档需要通过网址打开游戏（双击本地文件打开时不可用）' });
    return fetch(Cloud.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, msg: r.status === 404 ? '服务器上没有云存档接口（functions/api/save.js 没有部署）' : '服务器返回异常（' + r.status + '）' }; }); })
      .catch(function () { return { ok: false, msg: '连不上服务器，检查一下网络' }; });
  }
  Cloud.upload = function (code, pass) {
    var S = BT.S; if (!S) return Promise.resolve({ ok: false, msg: '没有进行中的游戏' });
    return post({ action: 'save', code: code, pass: pass, data: BT.exportSave(), meta: { day: S.day, net: BT.netWorth(S), phase: S.phase } })
      .then(function (r) { if (r.ok) ls(K_LAST, String(Date.now())); return r; });
  };
  Cloud.download = function (code, pass) {
    return post({ action: 'load', code: code, pass: pass }).then(function (r) {
      if (!r.ok) return r;
      var res = BT.importSave(r.data);
      return res.ok ? { ok: true, msg: '已从云端读取：' + res.msg.replace('导入成功：', '') } : res;
    });
  };
  Cloud.info = function (code, pass) { return post({ action: 'info', code: code, pass: pass }); };
})();
