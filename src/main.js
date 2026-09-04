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

const canvas = document.getElementById('scene');
const engine = new CosmicEngine(canvas);
const probe = new Probe();
const clock = new SimClock();
const nav = new Navigator(engine, probe, clock);
const chaseCam = new ChaseCam(engine.camera, probe);
engine.chaseCam = chaseCam;
const trailRibbon = new TrailRibbon(engine.scene);

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
  ui.setDockHelp(curWorld.hint || 'WASD 飞行 · 鼠标拖拽转向 · 滚轮缩放 · F 下潜 · 空格 暂停');
  // 轨迹缎带重建 + 层介绍导览
  trailRibbon.reset();
  ui.showIntro(world);
};

// 每帧：更新探测球（飞行/转向/时间）
let lastFrame = performance.now();
let frame = 0;
let wheelAcc = 0;

function simulate(dtReal) {
  if (!curWorld || !curWorld.update) return;
  const dtSim = clock.paused ? 0 : dtReal * clock.rate;
  curWorld.update(dtSim, clock, probe);
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

  if (curWorld) {
    // 转向（鼠标拖拽）
    probe.steer(steer.steerX * 0.0045, steer.steerY * 0.0045);
    // 飞行（只有推进键按下时才加速；Shift = 增推）
    const thrustKeys = a.fwd || a.bwd || a.left || a.right || a.up || a.down;
    probe.thrustOn = thrustKeys;
    const boost = input.keys.has('shift');
    if (thrustKeys) probe.step(dtReal, a, boost ? 3 : 1);
    else probe.step(dtReal, a, 0); // 仍应用阻尼/惯性

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
    const spText = spKmS < C_KM_S
      ? Math.max(spKmS, 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' km/s'
      : '≈' + cfrac.toFixed(1) + ' c';
    let distText = '—';
    if (hoveredId) {
      const h = curWorld.entities.find((e) => e.id === hoveredId);
      if (h) {
        const dkm = dist3(probe.pos, h.pos) * curWorld.kmPerUnit;
        distText = `${h.name} · ${formatKm(dkm)} · 光 ${lightTravelText(dkm)}`;
      }
    }
    ui.setHud({ speedText: spText, distText });
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
