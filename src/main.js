// 主入口：宇宙漫游 · 教育向可交互宇宙
// 装配：引擎（渲染）→ 世界工厂注册 → 导航 → 探测球 → UI → 输入 → 主循环
import './style.css';
import { CosmicEngine } from './render/engine.js';
import { Input } from './core/input.js';
import { Probe } from './core/probe.js';
import { SimClock } from './core/clock.js';
import { Navigator } from './core/navigator.js';
import { UI } from './ui/controller.js';
import { WORLD_DEFS, WORLD_BY_ID } from './content/schema.js';
import { worldFactories } from './content/worlds.js';
// 世界模块（import 副作用注册工厂）
import './content/world-solar.js';
import './content/world-stellar.js';
import './content/world-galaxy.js';
import './content/world-local.js';
import './content/world-super.js';
import './content/world-cosmos.js';
import { formatKm, lightTravelText, unitRulerText, C_KM_S } from './util/units.js';
import { ChaseCam } from './render/camera.js';
import { updateLabelFades } from './render/labels.js';
import { TrailRibbon } from './render/trail.js';
import { makeSphere, makeGlowSprite } from './render/bodies.js';
import { rockyTexture } from './render/textures.js';

const canvas = document.getElementById('scene');
const engine = new CosmicEngine(canvas);
const probe = new Probe();
const clock = new SimClock();
const nav = new Navigator(engine, probe, clock);
const chaseCam = new ChaseCam(engine.camera, probe);
engine.chaseCam = chaseCam;
const trailRibbon = new TrailRibbon(engine.scene);
// 陨石本体（可视）：巡航/轨道飞行时都跟随探测球，跟拍视角下可见自己
const meteorMesh = makeSphere({
  radius: 1, color: '#9a8f80', roughness: 1,
  // 微自发光：夜面朝向相机时仍可辨认（与行星同策略）
  emissive: '#9a8f80', emissiveIntensity: 0.35,
  map: rockyTexture({ base: '#8d7f70', dark: '#5c5045', light: '#b3a595', craterCount: 34, seed: 61, size: 256 }),
});
engine.scene.add(meteorMesh);
const meteorGlow = makeGlowSprite(2.6, '#c9b8a0', 0.4);
meteorMesh.add(meteorGlow);

const input = new Input(canvas);
const ui = new UI(engine, {
  onNav: (wid) => nav.enter(wid),
  onRate: (r) => { clock.setRate(r); clock.paused = false; ui.setCurrentRate(r); },
  onPause: () => { clock.paused = !clock.paused; },
  onDive: () => { if (nav.diveCandidate) nav.diveInto(nav.diveCandidate); },
  onDiveTo: (entity) => nav.diveInto(entity),
  onInfoClose: () => { ui.hideDiveHint(); },
  onWheelZoom: (dir) => { if (dir < 0) nav.zoomIn(); else nav.zoomOut(); },
});

let curWorld = null;
let selected = null; // 当前信息卡对象
let hoveredId = null;

nav.onWorldChanged = (world, idx) => {
  curWorld = world;
  engine.loadWorld(world, world.group, []);
  // 面包屑 = 完整尺度阶梯（当前高亮）
  ui.setCrumb(idx);
  // ruler：1 世界单位的真实换算（unitRulerText 避免同单位自指）
  ui.setRuler(`${unitRulerText(world.unitName)} · 当前尺度：${world.title}`);
  ui.hideDiveHint();
  selected = null;
  ui.hideInfo();
  ui.setCurrentRate(clock.rate);
  ui.setTimeState({ clockLabel: clock.timeLabel(), paused: clock.paused });
  // 键位提示同步刷新
  ui.setDockHelp(curWorld.hint || '点击画面锁定鼠标转向 · WASD 飞行 · G 轨道飞行 · 滚轮缩放 · F 下潜');
  // 轨迹缎带重建 + 层介绍导览
  trailRibbon.reset();
  ui.showIntro(world);
};

// 每帧：更新探测球（飞行/转向/时间）
let lastFrame = performance.now();
let frame = 0;
let wheelAcc = 0;
let prevG = false; // G 键边沿检测
let prevR = false; // R 键边沿检测

function simulate(dtReal) {
  if (!curWorld || !curWorld.update) return;
  const dtSim = clock.paused ? 0 : dtReal * clock.rate;
  curWorld.update(dtSim, clock, probe, dtReal);
}

function pickObject(rayOrigin, rayDir, maxDist) {
  if (!curWorld) return null;
  let best = null; let bestD = maxDist;
  for (const e of curWorld.entities) {
    if (!e.pickRadius || e.selectable === false) continue;
    const d = rayDist(rayOrigin, rayDir, e.pos, e.pickRadius);
    if (d >= 0 && d < bestD) { bestD = d; best = e; }
  }
  return best;
}
function rayDist(o, dir, c, r) {
  const ox = o[0]-c[0], oy = o[1]-c[1], oz = o[2]-c[2];
  const b = ox*dir[0]+oy*dir[1]+oz*dir[2];
  const cc = ox*ox+oy*oy+oz*oz - r*r;
  const disc = b*b - cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t = -b - sq;
  return t >= 0 ? t : -b + sq >= 0 ? -b + sq : -1;
}
function dist3(a, b) { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }

// 鼠标拾取 → 信息卡
function updatePick() {
  if (!curWorld) return;
  const o = probe.pos;
  const fwd = probe.forward();
  const camDist = chaseCam.followDist;
  const hit = pickObject(o, fwd, camDist * 1.6);
  if (hit) {
    hoveredId = hit.id;
    if (!selected && !ui.el.infocard.classList.contains('hidden')) return;
  } else {
    hoveredId = null;
  }
  // 点击（由 main 的 mouse click 事件驱动，见 boot）
}

function renderFrame(now) {
  const dtReal = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  frame++;
  const steer = input.poll();
  const a = input.actions;

  // G 键（边沿触发）：巡航 ⇄ 轨道飞行（陨石模式）
  const gDown = input.keys.has('g');
  if (gDown && !prevG && curWorld) {
    if (probe.mode === 'ballistic') {
      probe.exitBallistic();
      ui.setDockHelp(curWorld.hint || '点击画面锁定鼠标转向 · WASD 飞行 · G 轨道飞行 · 滚轮缩放 · F 下潜');
    } else {
      probe.enterBallistic();
      // 轨道物理为实时：倍速会让行星狂奔而无法建立引力遭遇，回到实时
      if (clock.rate !== 1) { clock.setRate(1); ui.setCurrentRate(1); }
      ui.setDockHelp('轨道飞行（陨石）：低速贴近行星切入可被捕获 · WASD 变轨 · G 返回巡航 · R 挣脱捕获');
    }
  }
  prevG = gDown;

  // R 键：被引力完全捕获后，在系统边缘重生继续航行
  const rDown = input.keys.has('r');
  if (rDown && !prevR && probe.mode === 'ballistic' && curWorld) {
    probe.respawn();
    ui.setDockHelp('已脱离引力捕获，在系统边缘重新出发 · G 轨道飞行 · WASD 飞行');
  }
  prevR = rDown;

  if (curWorld) {
    // 转向：Pointer Lock 时移动即转向，未锁定按住拖拽
    probe.steer(steer.steerX * 0.0045, steer.steerY * 0.0045);
    // 飞行（只有推进键按下时才加速；Shift = 增推）
    const thrustKeys = a.fwd || a.bwd || a.left || a.right || a.up || a.down;
    probe.thrustOn = thrustKeys;
    const boost = input.keys.has('shift');
    const dtSim = clock.paused ? 0 : dtReal * clock.rate;
    // 轨道飞行物理用实时（dtReal，演示 GM），巡航用阻尼惯性
    const dtPhys = probe.mode === 'ballistic' ? dtReal : dtSim;
    if (thrustKeys) probe.step(dtReal, a, boost ? 3 : 1, dtPhys);
    else probe.step(dtReal, a, 0, dtPhys); // 仍应用阻尼/惯性
    // 陨石本体：仅轨道飞行模式显示（巡航=自由观察者，无实体），
    // 避免观察时近处石块挡住目标
    meteorMesh.visible = probe.mode === 'ballistic';
    meteorMesh.position.set(probe.pos[0], probe.pos[1], probe.pos[2]);
    const meteorSize = Math.max(chaseCam.followDist * 0.055, 1e-4);
    // 三轴不等缩放：不规则"土豆形"更贴近真实小天体
    meteorMesh.scale.set(meteorSize, meteorSize * 0.76, meteorSize * 0.88);
    meteorMesh.children[0].scale.setScalar(2.6); // 相对父缩放：光晕直径 ≈ 2.6× 陨石半径
    meteorMesh.rotation.y += dtReal * 0.6;
    meteorMesh.rotation.x += dtReal * 0.23;

    // 下潜候选
    let best = null; let bestD = 1e18;
    for (const e of curWorld.entities) {
      if (!e.dive) continue;
      const d = dist3(probe.pos, e.pos);
      const reach = e.dive.reach ?? (e.pickRadius * 2.2);
      if (d < reach && d < bestD) { bestD = d; best = e; }
    }
    nav.diveCandidate = best;
    if (best && !selected) ui.showDiveHint(best);
    else ui.hideDiveHint();
    if (a.dive && best) nav.diveInto(best);

    // 模拟钟
    clock.advance(dtReal);
    simulate(dtReal);

    // HUD
    const spKmS = probe.speedKmS();
    const cfrac = spKmS / C_KM_S;
    // 轨道飞行用教学 GM（演示速度可超光速）：超光速时明示"演示速度"
    const demoTag = probe.mode === 'ballistic' && cfrac >= 1 ? ' · 演示速度' : '';
    const spText = spKmS < C_KM_S
      ? Math.max(spKmS, 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' km/s'
      : '≈' + cfrac.toFixed(1) + ' c' + demoTag;
    let distText = '—';
    if (hoveredId) {
      const h = curWorld.entities.find((e) => e.id === hoveredId);
      if (h) {
        const dkm = dist3(probe.pos, h.pos) * curWorld.kmPerUnit;
        distText = `${h.name} · ${formatKm(dkm)} · 光 ${lightTravelText(dkm)}`;
      }
    }
    let modeText = probe.mode === 'ballistic' ? '轨道飞行' : '巡航';
    if (probe.mode === 'ballistic') {
      const gname = probe.dominantWell ? probe.dominantWell.name
        : (curWorld.gravity ? curWorld.gravity.name : '无（惯性直线）');
      // 束缚/逃逸：比能量 E = v²/2 - GM/r 相对主导井
      if (probe.dominantWell) {
        const c = probe.dominantWell.ref ? probe.dominantWell.ref.pos : probe.dominantWell.center;
        const r = Math.hypot(probe.pos[0]-c[0], probe.pos[1]-c[1], probe.pos[2]-c[2]) || 1;
        const E = (probe.vel[0]**2 + probe.vel[1]**2 + probe.vel[2]**2) / 2 - probe.dominantWell.GM / r;
        modeText = `轨道飞行 · ${probe.dominantWell.name} · ${E < 0 ? '束缚轨道' : '逃逸轨道'}`;
      } else {
        modeText = `轨道飞行 · ${gname}`;
      }
      // 完全捕获提示（深入引力阱且束缚轨道持续 → 引导按 R 重生）；
      // 解除捕获后恢复常规提示（捕获时 probe.step 会清除 captureState）
      const helpEl = document.getElementById('dock-help');
      if (helpEl) {
        if (probe.captureState && performance.now() / 1000 - probe.captureState.since > 1.2) {
          helpEl.innerHTML = `<b style="color:#ffd27f">已被 ${probe.captureState.name} 的引力完全捕获</b> —— 按 R 在系统边缘重生继续航行`;
        } else if (!probe.captureState && helpEl.dataset.captured === '1') {
          helpEl.textContent = '点击画面锁定鼠标转向 · WASD 飞行 · G 轨道飞行 · 滚轮缩放 · F 下潜';
        }
        helpEl.dataset.captured = probe.captureState ? '1' : '';
      }
    }
    ui.setHud({ speedText: spText, distText, modeText });
    ui.setTimeState({ clockLabel: clock.timeLabel(), paused: clock.paused });
  }

  chaseCam.update(dtReal);
  trailRibbon.update(probe);
  // 标签距离淡出+屏幕避让：远景标签降透明度，重叠标签只保留最近者
  if (curWorld) {
    updateLabelFades(curWorld.group, engine.camera, curWorld.labelFadeDist || curWorld.viewDist * 1.6);
  }
  engine.render(dtReal);
}

// 点击 → 选中信息卡
canvas.addEventListener('click', (ev) => {
  if (!curWorld) return;
  const rect = canvas.getBoundingClientRect();
  // 用相机射线？简化：中心十字拾取不可点击屏幕位置时用光标射线
  // 此处用「屏幕中心→探测球朝向」的替代：点击主要选择视野中心对象。
  // 更好的实现：three raycaster。为免重依赖，用光标方向近似：
  // （教学场景对象少、pickRadius 大，鼠标与中心偏差小可容忍）
  const o = probe.pos;
  const fwd = probe.forward();
  const hit = pickObject(o, fwd, chaseCam.followDist * 1.6);
  if (hit) {
    selected = hit;
    ui.showInfo(hit);
  }
});

async function boot() {
  ui.showLoading('载入宇宙…');
  try {
    await nav.enter('solar');
  } catch (e) {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;z-index:99999;color:#fff;background:#a00;font-size:12px;padding:10px;max-width:90vw;overflow:auto">${e.stack || e.message}</pre>`);
  }
  ui.hideLoading();
  const loop = (now) => { renderFrame(now); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => engine._resize());

// 调试钩子
window.__universe = { engine, probe, clock, nav, ui, get world() { return nav.world; } };

boot();
