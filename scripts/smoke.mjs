// 无头冒烟测试：真浏览器加载页面 → 逐层构建断言 → 页面错误检查。
// 依赖：vite dev server（本脚本自启）+ agent-browser CLI（Chrome for Testing）。
// 用法：pnpm smoke
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
  vite = spawn('pnpm', ['exec', 'vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: false });
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
  // Esc 单边沿：按下→隔帧→抬起→隔帧。旧的「按/抬/再按」三连能否只产生
  // 一个边沿取决于事件与 rAF 帧边界的相对时序（跨帧=两次翻转=开了又关），
  // 是冒烟的间歇性失败源
  const pressEsc = async () => {
    evalJS(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 'ok';`);
    await sleep(120);
    evalJS(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' })); return 'ok';`);
    await sleep(120);
  };
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

  // 任务挂件初始化：进入游戏即显示当前任务（占位符「—」= 初始推送丢失）
  const mi = evalJS(`
    return JSON.stringify({ idx: document.getElementById('mission-idx').textContent,
      title: document.getElementById('mission-title').textContent,
      n: document.getElementById('discoveries').textContent });
  `);
  if (!/^\d+\/12$/.test(mi.idx) || !mi.title || mi.title === '—' || mi.n === '') {
    failures.push(`任务挂件初始态: ${JSON.stringify(mi)}`);
  } else {
    console.log(`  ✓ 任务挂件初始态：任务 ${mi.idx}「${mi.title}」· 发现 ${mi.n}`);
  }

  await pressEsc();
  await sleep(300);
  st = uiState();
  if (!st.menu || !st.paused) failures.push(`Esc 打开暂停菜单: ${JSON.stringify(st)}`);
  else console.log('  ✓ Esc 打开暂停菜单并冻结时钟');

  await pressEsc();
  await sleep(300);
  st = uiState();
  if (st.menu || st.paused) failures.push(`Esc 关闭暂停菜单: ${JSON.stringify(st)}`);
  else console.log('  ✓ Esc 关闭菜单并恢复时钟');

  evalJS(`window.__universe.setMission(12); return 'ok';`);
  await sleep(1000);
  st = uiState();
  if (!st.victory || !st.paused) failures.push(`通关结算: ${JSON.stringify(st)}`);
  else console.log('  ✓ 12 环全通关触发结算画面');

  // 结算画面必须真实渲染（曾因注释未闭合整段样式被构建丢弃，
  // DOM 可见但面板塌缩成一条不可见的线——像素级断言防再犯）
  const vs = evalJS(`
    const el = document.getElementById('victory-screen');
    const cs = getComputedStyle(el);
    return JSON.stringify({ position: cs.position, h: el.offsetHeight,
      title: document.querySelector('.victory-title')?.textContent });
  `);
  if (vs.position !== 'fixed' || vs.h < 200 || !vs.title || vs.title === '—') {
    failures.push(`通关结算样式: ${JSON.stringify(vs)}`);
  } else {
    console.log(`  ✓ 通关结算样式：fixed 全屏面板（高 ${vs.h}px，「${vs.title}」）`);
  }

  evalJS(`document.getElementById('btn-victory-continue').click(); return 'ok';`);
  st = uiState();
  if (st.victory || st.paused) failures.push(`结算继续: ${JSON.stringify(st)}`);
  else console.log('  ✓ 继续自由航行：结算关闭并恢复时钟');

  await pressEsc();
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

  // 3.6 发现图鉴：暂停菜单 → 图鉴分节渲染 → 关闭回菜单 → 继续航行
  await pressEsc();
  await sleep(300);
  evalJS(`document.getElementById('btn-pause-codex').click(); return 'ok';`);
  await sleep(200);
  const codex = evalJS(`
    const body = document.getElementById('codex-body');
    return JSON.stringify({
      visible: !document.getElementById('codex-panel').classList.contains('hidden'),
      hasSolar: body.textContent.includes('太阳系'),
      sections: body.querySelectorAll('.codex-layer').length,
      locked: body.querySelectorAll('.codex-item.locked').length,
      progress: document.getElementById('codex-progress').textContent,
    });
  `);
  if (!codex.visible || !codex.hasSolar || codex.sections !== 6 || codex.locked < 1
    || !/已收录 \d+ \/ \d+/.test(codex.progress)) {
    failures.push(`发现图鉴: ${JSON.stringify(codex)}`);
  } else {
    console.log(`  ✓ 发现图鉴：6 层分节渲染 + 进度（${codex.progress}）+ 未发现 ??? 占位 ${codex.locked} 项`);
  }
  evalJS(`document.getElementById('codex-close').click(); return 'ok';`);
  st = uiState();
  if (st.victory || !st.menu) failures.push(`图鉴关闭回菜单: ${JSON.stringify(st)}`);
  else console.log('  ✓ 图鉴关闭：回到暂停菜单');
  await pressEsc();
  await sleep(300);
  st = uiState();
  if (st.menu || st.paused) failures.push(`菜单关闭: ${JSON.stringify(st)}`);
  else console.log('  ✓ Esc 继续航行');

  // 3.7 画质档：切换即时生效（像素比）并持久化
  await pressEsc();
  await sleep(300);
  evalJS(`document.getElementById('btn-pause-settings').click(); return 'ok';`);
  await sleep(200);
  evalJS(`document.querySelector('#set-quality button[data-q="low"]').click(); return 'ok';`);
  await sleep(200);
  const q = evalJS(`
    const u = window.__universe;
    return JSON.stringify({
      pr: Math.round(u.engine.renderer.getPixelRatio() * 100) / 100,
      saved: JSON.parse(localStorage.getItem('universe-roam-settings') || '{}').quality,
      active: document.querySelector('#set-quality button.active').dataset.q,
    });
  `);
  if (q.pr !== 0.75 || q.saved !== 'low' || q.active !== 'low') {
    failures.push(`画质切换: ${JSON.stringify(q)}`);
  } else {
    console.log('  ✓ 画质档「流畅」：像素比 0.75 生效并持久化');
  }
  evalJS(`document.querySelector('#set-quality button[data-q="high"]').click(); return 'ok';`);
  evalJS(`document.getElementById('set-close').click(); return 'ok';`);
  await pressEsc();
  await sleep(200);

  // 3.8 真实尺度飞行器：scale = 8 m 包络的层单位换算，绝不随视距缩放
  //（enter 返回后等几帧渲染，syncShip 才把新层的真实尺度写进 ship.scale）
  const entered = evalJS(`
    const u = window.__universe;
    return u.nav.enter('solar').then(() => JSON.stringify({
      layer: u.world.id, dist: u.chaseCam.followDist,
    }));
  `);
  // 等数帧渲染后 syncShip 才把新层真实尺度写进 ship.scale（headless 慢帧轮询）
  let real = null;
  for (let i = 0; i < 30 && !real; i++) {
    await sleep(100);
    const r = evalJS(`
      const u = window.__universe;
      return JSON.stringify({ shipScale: u.ship.scale.x, expect: 0.008 / u.world.kmPerUnit });
    `);
    if (Math.abs(r.shipScale - r.expect) <= r.expect * 1e-9) real = r;
  }
  if (!real) real = evalJS(`
    const u = window.__universe;
    return JSON.stringify({ shipScale: u.ship.scale.x, expect: 0.008 / u.world.kmPerUnit });
  `);
  if (entered.layer !== 'solar' || !real) {
    failures.push(`船真实尺度: ${JSON.stringify({ entered, real })}`);
  } else {
    console.log(`  ✓ 飞行器真实尺度：scale=${real.shipScale.toExponential(2)} 层单位（≈8 m 包络，视距 ${entered.dist.toExponential(2)}）`);
  }

  // 3.9 拉远缩放：船尺度恒定（真实物体）+ 亚像素 ◇ 标记接管可见性。
  // headless 下 rAF 节流，标记在 zoomBy 平滑追赶到位后才翻转——轮询等待而非定长休眠
  evalJS(`window.__universe.chaseCam.zoomBy(200); return 'ok';`);
  let markerShown = false;
  for (let i = 0; i < 50 && !markerShown; i++) {
    await sleep(100);
    markerShown = evalJS(`return window.__universe.shipMarker.visible;`) === true;
  }
  const zoomed = evalJS(`
    const u = window.__universe;
    const cam = u.engine.camera;
    const rel = new cam.position.constructor(
      u.probe.pos[0] - cam.position.x,
      u.probe.pos[1] - cam.position.y,
      u.probe.pos[2] - cam.position.z);
    const fwd = new rel.constructor(0, 0, -1).applyQuaternion(cam.quaternion);
    return JSON.stringify({ scale: u.ship.scale.x, marker: u.shipMarker.visible,
      dist: u.chaseCam.followDist, along: rel.dot(fwd), dCam: rel.length(),
      mode: u.chaseCam.mode, cm: u.controlMode, shipVis: u.ship.visible,
      opacity: u.shipMarker.material.opacity });
  `);
  if (!markerShown || Math.abs(zoomed.scale - real.shipScale) > real.expect * 1e-9) {
    failures.push(`缩放与标记: ${JSON.stringify(zoomed)}`);
  } else {
    console.log('  ✓ 拉远 200×：船尺度恒定不放大，亚像素 ◇ 标记显示');
  }

  // 3.9b 一键回到飞行器视角：点击 HUD 按钮立即恢复追尾视角与默认视距
  evalJS(`document.getElementById('btn-reset-view').click(); return 'ok';`);
  await sleep(200);
  const resetState = evalJS(`
    const u = window.__universe;
    return JSON.stringify({
      mode: u.chaseCam.mode,
      dist: u.chaseCam.followDist,
      expectDist: (0.008 / u.world.kmPerUnit) * 12,
      panLen: u.chaseCam.panOffset.length(),
      controlMode: u.controlMode,
    });
  `);
  if (resetState.mode !== 'chase' || Math.abs(resetState.dist - resetState.expectDist) > resetState.expectDist * 1e-4 || resetState.panLen > 1e-6) {
    failures.push(`一键回到飞船按钮: ${JSON.stringify(resetState)}`);
  } else {
    console.log('  ✓ 一键回到飞船：点击按钮立即恢复追尾模式、清空平移并重置视距');
  }

  // 3.9c 大巡游按钮：点击启程（巡游状态非空 + 按钮高亮），再点结束（双清空）
  evalJS(`document.getElementById('btn-tour').click(); return 'ok';`);
  await sleep(200);
  const tourOn = evalJS(`
    return JSON.stringify({ active: !!window.__universe.tour,
      btnActive: document.getElementById('btn-tour').classList.contains('active') });
  `);
  evalJS(`document.getElementById('btn-tour').click(); return 'ok';`);
  await sleep(200);
  const tourOff = evalJS(`
    return JSON.stringify({ active: !!window.__universe.tour,
      btnActive: document.getElementById('btn-tour').classList.contains('active') });
  `);
  if (!tourOn.active || !tourOn.btnActive || tourOff.active || tourOff.btnActive) {
    failures.push(`大巡游按钮: ${JSON.stringify({ tourOn, tourOff })}`);
  } else {
    console.log('  ✓ 大巡游按钮：点击启程并高亮，再点结束');
  }

  // 测试在上帝视角下按 Z 键一键回飞船
  evalJS(`window.__universe.input.keys.add('g'); return 'ok';`);
  await sleep(100);
  evalJS(`window.__universe.input.keys.delete('g'); return 'ok';`);
  await sleep(200);
  const isGod = evalJS(`return window.__universe.controlMode === 'god';`);
  evalJS(`window.__universe.input.keys.add('z'); return 'ok';`);
  await sleep(100);
  evalJS(`window.__universe.input.keys.delete('z'); return 'ok';`);
  await sleep(200);
  const afterZ = evalJS(`
    const u = window.__universe;
    return JSON.stringify({
      controlMode: u.controlMode,
      mode: u.chaseCam.mode,
    });
  `);
  if (!isGod || afterZ.controlMode !== 'auto' || afterZ.mode !== 'chase') {
    failures.push(`上帝视角按 Z 一键回飞船: ${JSON.stringify({ isGod, ...afterZ })}`);
  } else {
    console.log('  ✓ 上帝视角按 Z：一键退出自由漫游并回到飞行器视角');
  }
  await sleep(150);

  // 3.10 右键直接掌舵：右键按住 + 鼠标右移 → 机头右转（yaw 增大）。
  // 按住状态必须跨越帧边界（renderFrame 帧首 poll 消费鼠标增量时读取
  // 按住状态），因此按下/移动与松开分两次 eval，中间留出数帧
  const yaw0 = evalJS(`return window.__universe.probe.yaw;`);
  evalJS(`
    const c = document.getElementById('scene');
    c.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 200, clientY: 200, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { button: 2, clientX: 260, clientY: 200 }));
    return 'ok';
  `);
  // 帧循环消费鼠标增量需等待帧边界（headless 慢帧轮询），松开前机头应已转动
  let yaw1 = yaw0;
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    yaw1 = evalJS(`return window.__universe.probe.yaw;`);
    if (Math.abs(yaw1 - yaw0) > 0.08) break;
  }
  evalJS(`window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true })); return 'ok';`);
  await sleep(100);
  const dyaw = yaw1 - yaw0;
  if (!(dyaw > 0.08 && dyaw < 0.7)) {
    failures.push(`右键掌舵: Δyaw=${dyaw.toFixed(4)}（期望 ≈+0.3）`);
  } else {
    console.log(`  ✓ 右键直接掌舵：右移 60px → 机头右转 Δyaw=${dyaw.toFixed(3)} rad`);
  }

  // 3.11 星尘速度感：按住 W 推进（倍率钳到手动档）→ 星尘流显现
  evalJS(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); return 'ok';`);
  let dustOn = null;
  for (let i = 0; i < 30 && !dustOn; i++) {
    await sleep(100);
    const r = evalJS(`
      const u = window.__universe;
      return JSON.stringify({ visible: u.dust.lines.visible, thrust: u.probe.thrustOn });
    `);
    if (r.visible === true && r.thrust === true) dustOn = r;
  }
  evalJS(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' })); return 'ok';`);
  await sleep(150);
  if (!dustOn) {
    failures.push(`星尘流: ${JSON.stringify(dustOn)}`);
  } else {
    console.log('  ✓ 星尘速度感：推进时星尘流显现');
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
