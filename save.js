/* ==========================================================================
 * 文件：functions/api/save.js（Cloudflare Pages Functions，自动部署成 /api/save 接口）
 * 作用：云存档 —— 用「存档码 + 密码」在 Cloudflare KV 里保存 / 读取存档，iPad 和电脑互通。
 * 配置（只需一次）：Cloudflare 控制台 → Workers & Pages → KV → 新建命名空间（例如 bt-saves）
 *        → 你的 Pages 项目 → 设置 → 函数 / Bindings → 添加 KV 绑定，变量名填 BT_SAVES → 重新部署。
 * 接口：POST /api/save  body: { action: 'save' | 'load' | 'info', code, pass, data?, meta? }
 *   - 存档码：6~12 位大写字母或数字；密码：4~32 个字符。服务端只存密码的 SHA-256 摘要。
 *   - 第一次 save 时创建；以后 save / load 都要密码正确。单个存档最大 2MB。
 * ========================================================================== */
const MAX = 2 * 1024 * 1024;
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ ok: false, msg: '只支持 POST' }, 405);
  const kv = env && env.BT_SAVES;
  if (!kv) return json({ ok: false, code: 'NO_KV', msg: '云存档还没配置：请在 Cloudflare Pages 项目里绑定 KV（变量名 BT_SAVES）后重新部署' }, 501);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, msg: '请求格式错误' }, 400); }
  const code = String(body.code || '').toUpperCase(), pass = String(body.pass || '');
  if (!/^[A-Z0-9]{6,12}$/.test(code)) return json({ ok: false, msg: '存档码要 6~12 位字母或数字' }, 400);
  if (pass.length < 4 || pass.length > 32) return json({ ok: false, msg: '密码要 4~32 个字符' }, 400);
  const key = 'save:' + code, hash = await sha256(code + ':' + pass + ':business-tycoon');
  const raw = await kv.get(key), rec = raw ? JSON.parse(raw) : null;
  if (rec && rec.hash !== hash) return json({ ok: false, code: 'BAD_PASS', msg: '密码不对（这个存档码已经被使用）' }, 403);
  if (body.action === 'save') {
    const data = String(body.data || '');
    if (!data.startsWith('BT3:')) return json({ ok: false, msg: '存档内容无效' }, 400);
    if (data.length > MAX) return json({ ok: false, msg: '存档太大（超过 2MB）' }, 413);
    const meta = body.meta && typeof body.meta === 'object' ? { day: Number(body.meta.day) || 0, net: Number(body.meta.net) || 0, phase: Number(body.meta.phase) || 1 } : {};
    const now = Date.now();
    await kv.put(key, JSON.stringify({ hash, data, meta, updatedAt: now, createdAt: rec ? rec.createdAt : now }));
    return json({ ok: true, msg: rec ? '云存档已更新' : '云存档已创建', updatedAt: now, created: !rec });
  }
  if (!rec) return json({ ok: false, code: 'NOT_FOUND', msg: '云端没有这个存档码' }, 404);
  if (body.action === 'info') return json({ ok: true, meta: rec.meta || {}, updatedAt: rec.updatedAt });
  if (body.action === 'load') return json({ ok: true, data: rec.data, meta: rec.meta || {}, updatedAt: rec.updatedAt });
  return json({ ok: false, msg: '未知操作' }, 400);
}
