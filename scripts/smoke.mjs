// 无头冒烟测试：真浏览器加载页面 → 逐层构建断言 → 页面错误检查。
// 依赖：vite dev server（本脚本自启）+ agent-browser CLI（Chrome for Testing）。
// 用法：npm run smoke
import { spawn, execFileSync } from 'node:child_process';

const PORT = 5178;
const URL = `http://localhost:${PORT}/`;
const SESSION = `smoke-${process.pid}`;
const LAYERS = ['solar', 'stellar', 'galaxy', 'local', 'super', 'cosmos'];

let vite;
const failures = [];

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
}

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return; } catch { /* retry */ }
    if (Date.now() > deadline) throw new Error(`等待超时: ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  // 1. 起 dev server
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: false });
  await waitFor(async () => {
    const r = await fetch(URL);
    return r.ok;
  }, 20000, 'vite dev server');

  // 2. 打开页面（独立 session，避免污染其他浏览器任务）
  run('agent-browser', ['open', URL, '--session', SESSION]);
  run('agent-browser', ['wait', '--load', 'networkidle', '--session', SESSION]);
  await new Promise((r) => setTimeout(r, 1500));

  // 3. 逐层进入并断言
  for (const id of LAYERS) {
    const out = run('agent-browser', ['eval', `(() => {
      const u = window.__universe;
      if (!u) return JSON.stringify({ err: 'window.__universe 未挂载' });
      return u.nav.enter('${id}').then(() => {
        const w = u.world;
        const probeOk = Array.isArray(u.probe.pos) && u.probe.pos.every(Number.isFinite);
        let updateOk = true;
        try { w.update && w.update(0.016, u.clock, u.probe, 0.016); } catch (e) { updateOk = false; }
        return JSON.stringify({
          id: w.id, entities: w.entities.length, children: w.group.children.length,
          probeOk, updateOk,
        });
      });
    })()`, '--session', SESSION]);
    let r;
    try { r = JSON.parse(JSON.parse(out)); } catch { failures.push(`${id}: eval 输出不可解析: ${out.slice(0, 200)}`); continue; }
    if (r.err) { failures.push(`${id}: ${r.err}`); continue; }
    const problems = [];
    if (r.id !== id) problems.push(`world.id=${r.id}`);
    if (r.entities < 1) problems.push('无实体');
    if (r.children < 1) problems.push('场景组为空');
    if (!r.probeOk) problems.push('探测球位置非法');
    if (!r.updateOk) problems.push('update 抛错');
    if (problems.length) failures.push(`${id}: ${problems.join(', ')}`);
    else console.log(`  ✓ ${id}: ${r.entities} 实体, ${r.children} 场景对象`);
  }

  // 4. 页面错误检查
  const errs = run('agent-browser', ['errors', '--session', SESSION]).trim();
  if (errs && !/0 errors|no errors/i.test(errs)) {
    failures.push(`页面错误: ${errs.slice(0, 500)}`);
  }

  // 5. 汇总
  if (failures.length) {
    console.error('\n冒烟失败:');
    for (const f of failures) console.error('  ✗ ' + f);
    process.exitCode = 1;
  } else {
    console.log(`\n冒烟通过: ${LAYERS.length} 层全部构建正常，无页面错误`);
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  try { run('agent-browser', ['close', '--all']); } catch { /* 已关闭 */ }
  if (vite) vite.kill('SIGTERM');
});
