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

  // 3.5 游戏标准 UI 流：暂停菜单（Esc）→ 通关结算 → 回到标题
  // 键盘事件三连（按下/抬起/再按下）构造一个完整边沿，由下一帧 renderFrame 消费
  const evalJS = (code) => {
    const out = run('agent-browser', ['eval', `(() => { ${code} })()`, '--session', SESSION]);
    // agent-browser stdout 是对返回值的 JSON 编码；返回值本身可能是
    // JSON.stringify 后的字符串（再解一层）或普通字符串（如 'ok'）
    let v = JSON.parse(out);
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* 普通字符串 */ } }
    return v;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pressEsc = () => evalJS(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return 'ok';
  `);
  const uiState = () => evalJS(`
    const vis = (id) => !document.getElementById(id).classList.contains('hidden');
    return JSON.stringify({ title: vis('title-screen'), menu: vis('pause-menu'),
      victory: vis('victory-screen'), paused: window.__universe.clock.paused });
  `);

  evalJS(`document.getElementById('btn-start').classList.contains('hidden')
    ? document.getElementById('btn-continue').click() : document.getElementById('btn-start').click();
    return 'ok';`);
  let st = uiState();
  if (st.title || st.menu || st.victory) failures.push(`进入游戏: 覆盖层未关闭 ${JSON.stringify(st)}`);
  else console.log('  ✓ 开始航行：进入游戏');

  pressEsc();
  await sleep(300);
  st = uiState();
  if (!st.menu || !st.paused) failures.push(`Esc 打开暂停菜单: ${JSON.stringify(st)}`);
  else console.log('  ✓ Esc 打开暂停菜单并冻结时钟');

  pressEsc();
  await sleep(300);
  st = uiState();
  if (st.menu || st.paused) failures.push(`Esc 关闭暂停菜单: ${JSON.stringify(st)}`);
  else console.log('  ✓ Esc 关闭菜单并恢复时钟');

  evalJS(`window.__universe.setMission(12); return 'ok';`);
  await sleep(1000);
  st = uiState();
  if (!st.victory || !st.paused) failures.push(`通关结算: ${JSON.stringify(st)}`);
  else console.log('  ✓ 12 环全通关触发结算画面');

  evalJS(`document.getElementById('btn-victory-continue').click(); return 'ok';`);
  st = uiState();
  if (st.victory || st.paused) failures.push(`结算继续: ${JSON.stringify(st)}`);
  else console.log('  ✓ 继续自由航行：结算关闭并恢复时钟');

  pressEsc();
  await sleep(300);
  evalJS(`document.getElementById('btn-pause-title').click(); return 'ok';`);
  await sleep(200);
  st = uiState();
  if (!st.title || st.menu || st.paused) failures.push(`回到标题: ${JSON.stringify(st)}`);
  else console.log('  ✓ 暂停菜单「回到标题」（吸引模式时钟恢复）');

  evalJS(`document.getElementById('btn-continue').click(); return 'ok';`);
  st = uiState();
  if (st.title) failures.push(`继续航行: ${JSON.stringify(st)}`);
  else console.log('  ✓ 标题「继续航行」：回到游戏');

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
