// 主入口：宇宙航行 · 游戏式太空飞行
// 装配：引擎（渲染）→ 世界工厂注册 → 导航 → 飞船 → UI → 输入 → 主循环
// 操作（游戏标准）：点击锁定鼠标转向 · W/S 前后 · A/D 左右 · Space/C 上下 ·
// Q/E 横滚 · Shift 加力 · X 刹车 · V 切换视角 · H 自动驾驶/自由航行 ·
// G 引力模式 · F 下潜 · 滚轮变焦
import './style.css';
import * as THREE from 'three';
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
import { ChaseCam, VIEW_NAMES } from './render/camera.js';
import { updateLabelFades } from './render/labels.js';
import { TrailRibbon } from './render/trail.js';
import { makeShip, updateShipFlame } from './render/ship.js';

const HELP_CRUISE = '点击锁定鼠标转向 · <kbd>W</kbd><kbd>S</kbd>前后 <kbd>A</kbd><kbd>D</kbd>左右 <kbd>Space</kbd>/<kbd>C</kbd>上下 · <kbd>Q</kbd><kbd>E</kbd>横滚 · <kbd>Shift</kbd>加力 <kbd>X</kbd>刹车 · <kbd>V</kbd>视角 <kbd>H</kbd>自动驾驶 <kbd>G</kbd>引力模式 <kbd>F</kbd>下潜 · 滚轮变焦';
const HELP_BALLISTIC = '引力模式：低速贴近天体切入可被捕获 · WASD 变轨 · <kbd>G</kbd>返回巡航 · <kbd>R</kbd>挣脱捕获 · <kbd>V</kbd>视角';
const HELP_VOYAGE = '自由航行（旅行者号）：引力滑行探索 · 天体使轨道偏折 · <kbd>H</kbd>/<kbd>X</kbd>退出 · 手动键微调轨道';
const helpAuto = (name) => `自动驾驶：正在飞往<b style="color:#ffd27f">${name}</b> · 切环绕视角旁观 · <kbd>H</kbd>/<kbd>X</kbd>退出 · 手动推进可临时接管`;

const canvas = document.getElementById('scene');
const engine = new CosmicEngine(canvas);
const probe = new Probe();
const clock = new SimClock();
const nav = new Navigator(engine, probe, clock);
const chaseCam = new ChaseCam(engine.camera, probe);
engine.chaseCam = chaseCam;
const trailRibbon = new TrailRibbon(engine.scene);
// 飞船本体：追踪/环绕视角可见，座舱视角隐藏（第一人称）
const ship = makeShip();
engine.scene.add(ship);
const _m4 = new THREE.Matrix4();
const _ndc = new THREE.Vector3();

const input = new Input(canvas);
const ui = new UI(engine, {
  onNav: (wid) => nav.enter(wid),
  onRate: (r) => { clock.setRate(r); clock.paused = false; ui.setCurrentRate(r); },
  onPause: () => { clock.paused = !clock.paused; },
  onDive: () => { if (nav.diveCandidate) nav.diveInto(nav.diveCandidate); },
  onDiveTo: (entity) => nav.diveInto(entity),
  onInfoClose: () => { ui.hideDiveHint(); },
});

let curWorld = null;
let selected = null; // 当前信息卡对象
let hoveredId = null;
let auto = null; // 自动驾驶：null | { kind:'goto', target } | { kind:'voyage', poi, poiT }
//   goto   寻的飞往选中目标（巡航物理，抵达断开）
//   voyage 旅行者式自由航行（引力滑行，自主探索，跨层持续）

nav.onWorldChanged = (world, idx) => {
  const keepVoyage = !!auto && auto.kind === 'voyage'; // 自由航行跨层持续
  curWorld = world;
  engine.loadWorld(world, world.group, []);
  // 面包屑 = 完整尺度阶梯（当前高亮）
  ui.setCrumb(idx);
  // ruler：1 世界单位的真实换算（unitRulerText 避免同单位自指）
  ui.setRuler(`${unitRulerText(world.unitName)} · 当前尺度：${world.title}`);
  ui.hideDiveHint();
  selected = null;
  auto = null; // 跨层重置（寻的目标只在当前层有效）
  ui.hideInfo();
  ui.setCurrentRate(clock.rate);
  ui.setTimeState({ clockLabel: clock.timeLabel(), paused: clock.paused });
  // 键位提示同步刷新（刷新滚轮缩放边界）
  chaseCam.setDist(chaseCam.followDist);
  ui.setDockHelp(probe.mode === 'ballistic' ? HELP_BALLISTIC : (curWorld.hint || HELP_CRUISE));
  // 轨迹缎带重建 + 层介绍导览
  trailRibbon.reset();
  ui.showIntro(world);
  // 自由航行跨层续航：新层注入绕主导井的圆轨道速度，继续探索
  if (keepVoyage) {
    probe.autoVoyage = true;
    auto = { kind: 'voyage', poi: null, poiT: 0 };
    probe.enterBallistic();
    if (clock.rate !== 1) { clock.setRate(1); ui.setCurrentRate(1); }
    for (let i = 0; i < 2 && chaseCam.mode !== 'orbit'; i++) chaseCam.cycleView();
    ui.setDockHelp(HELP_VOYAGE);
  }
};

// 每帧：更新飞船（飞行/转向/时间）
let lastFrame = performance.now();
let frame = 0;
let prevG = false; // G 键边沿检测
let prevR = false; // R 键边沿检测
let prevV = false; // V 键边沿检测
let prevH = false; // H 键边沿检测

// 自动驾驶接合：选中了目标 → 寻的飞往（goto，巡航物理）；
// 否则 → 旅行者式自由航行（voyage，引力滑行自主探索）
function engageAuto() {
  if (probe.mode === 'cruise' && selected) {
    auto = { kind: 'goto', target: selected };
    // 接合即进环绕视角旁观（最多转两档必达 orbit，用户可再按 V 切回）
    for (let i = 0; i < 2 && chaseCam.mode !== 'orbit'; i++) chaseCam.cycleView();
    // 旁观镜头：按目标尺寸收紧跟拍距离，抵达时飞船与目标同框
    // （只收不放：用户已拉近则保留）
    const seeD = ((selected.pickRadius || 0.1) * 4 + 3) * 1.6;
    chaseCam.setDist(Math.min(chaseCam.followDist, seeD));
    ui.setDockHelp(helpAuto(selected.name));
  } else {
    // 自由航行：切入引力模式（静止时自动获得圆轨道速度），时间回实时
    if (probe.mode !== 'ballistic') {
      probe.enterBallistic();
      if (clock.rate !== 1) { clock.setRate(1); ui.setCurrentRate(1); }
    }
    probe.autoVoyage = true;
    auto = { kind: 'voyage', poi: null, poiT: 0 };
    for (let i = 0; i < 2 && chaseCam.mode !== 'orbit'; i++) chaseCam.cycleView();
    ui.setDockHelp(HELP_VOYAGE);
  }
}
function disengageAuto(msg) {
  if (auto && auto.kind === 'voyage') probe.autoVoyage = false;
  auto = null;
  if (msg) ui.setDockHelp(msg);
}
const autoHelp = () => (auto.kind === 'voyage' ? HELP_VOYAGE : helpAuto(auto.target?.name));

// 有限角速度转向目标（自动寻的）：偏航/俯仰均 ≤ maxTurn rad/s
function steerTowards(tpos, dtReal, maxTurn = 1.0) {
  const dx = tpos[0] - probe.pos[0], dy = tpos[1] - probe.pos[1], dz = tpos[2] - probe.pos[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  const desYaw = Math.atan2(-dx, -dz);
  const desPitch = Math.asin(Math.max(-1, Math.min(1, dy / l)));
  let dYaw = desYaw - probe.yaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  const m = maxTurn * dtReal;
  probe.yaw += Math.max(-m, Math.min(m, dYaw));
  const dPitch = desPitch - probe.pitch;
  probe.pitch += Math.max(-m, Math.min(m, dPitch));
}

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

// 相机射线（游戏式准星拾取）：ndc 为屏幕归一化坐标（中心 = 0,0）
function cameraRay(ndcX, ndcY) {
  _ndc.set(ndcX, ndcY, 0.5).unproject(engine.camera);
  const o = engine.camera.position;
  const dx = _ndc.x - o.x, dy = _ndc.y - o.y, dz = _ndc.z - o.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  return { o: [o.x, o.y, o.z], d: [dx / l, dy / l, dz / l] };
}
function pickMaxDist() {
  const cp = engine.camera.position;
  const dCam = Math.hypot(cp.x - probe.pos[0], cp.y - probe.pos[1], cp.z - probe.pos[2]);
  return dCam + chaseCam.followDist * 4;
}

// 准星悬停：屏幕中心射线拾取（每帧）
function updateHover() {
  if (!curWorld) return;
  const { o, d } = cameraRay(0, 0);
  const hit = pickObject(o, d, pickMaxDist());
  hoveredId = hit ? hit.id : null;
  const cross = document.getElementById('crosshair');
  if (cross) cross.classList.toggle('lock', !!hit);
}

// 飞船位姿同步：位置 + yaw/pitch/roll 基向量（机头 -Z 对前向）
function syncShip() {
  ship.position.set(probe.pos[0], probe.pos[1], probe.pos[2]);
  const f = probe.forward(), r = probe.right(), u = probe.up();
  _m4.makeBasis(
    new THREE.Vector3(r[0], r[1], r[2]),
    new THREE.Vector3(u[0], u[1], u[2]),
    new THREE.Vector3(-f[0], -f[1], -f[2]),
  );
  ship.quaternion.setFromRotationMatrix(_m4);
  const s = Math.max(chaseCam.followDist * 0.05, 1e-4);
  ship.scale.setScalar(s);
}

function renderFrame(now) {
  const dtReal = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  frame++;
  const steer = input.poll();
  const a = input.actions;

  // G 键（边沿触发）：巡航 ⇄ 引力模式（切换模式断开自动驾驶）
  const gDown = input.keys.has('g');
  if (gDown && !prevG && curWorld) {
    disengageAuto();
    if (probe.mode === 'ballistic') {
      probe.exitBallistic();
      ui.setDockHelp(curWorld.hint || HELP_CRUISE);
    } else {
      probe.enterBallistic();
      // 轨道物理为实时：倍速会让行星狂奔而无法建立引力遭遇，回到实时
      if (clock.rate !== 1) { clock.setRate(1); ui.setCurrentRate(1); }
      ui.setDockHelp(HELP_BALLISTIC);
    }
  }
  prevG = gDown;

  // R 键：被引力完全捕获后，在系统边缘重生继续航行（手动恢复动作，断开自驾）
  const rDown = input.keys.has('r');
  if (rDown && !prevR && probe.mode === 'ballistic' && curWorld) {
    disengageAuto();
    probe.respawn();
    ui.setDockHelp('已脱离引力捕获，在系统边缘重新出发 · G 引力模式 · WASD 飞行');
  }
  prevR = rDown;

  // V 键（边沿触发）：追踪 ⇄ 座舱 ⇄ 环绕
  const vDown = input.keys.has('v');
  if (vDown && !prevV && curWorld) {
    const m = chaseCam.cycleView();
    ui.setDockHelp(auto ? autoHelp() : `视角：${VIEW_NAMES[m]} · V 切换（追踪/座舱/环绕）· 滚轮变焦`);
  }
  prevV = vDown;

  // H 键（边沿触发）：自动驾驶 开/关（选中目标=寻的，无目标=自由航行）
  const hDown = input.keys.has('h');
  if (hDown && !prevH && curWorld) {
    if (auto) {
      disengageAuto();
      if (probe.mode === 'ballistic') probe.exitBallistic();
      ui.setDockHelp(curWorld.hint || HELP_CRUISE);
    } else engageAuto();
  }
  prevH = hDown;

  if (curWorld) {
    // 转向：FPS 惯例——鼠标右偏航右转、上抬头（非反转）；
    // 环绕视角只转观察角，不改变航向
    const SENS = 0.0042;
    if (chaseCam.mode === 'orbit') {
      chaseCam.orbitBy(steer.steerX, steer.steerY);
    } else {
      probe.steer(steer.steerX * SENS, -steer.steerY * SENS);
    }
    // Q/E 横滚（~90°/秒）
    const rollIn = (input.keys.has('q') ? 1 : 0) - (input.keys.has('e') ? 1 : 0);
    if (rollIn !== 0 && chaseCam.mode !== 'orbit') probe.steer(0, 0, rollIn * 1.6 * dtReal);
    // 飞行（只有推进键按下时才加速；Shift = 加力；X = 刹车悬停）
    // 自动驾驶：无手动推进时自动飞行；手动键按下则本帧人工接管
    // （自动不断开，松开继续）；X 彻底退出自动
    if (input.keys.has('x') && auto) disengageAuto(probe.mode === 'ballistic' ? HELP_BALLISTIC : HELP_CRUISE);
    const thrustKeys = a.fwd || a.bwd || a.left || a.right || a.up || a.down;
    let autoThrust = false;
    let autoThrustScale = 1;
    let autoBrake = false;
    if (auto && !thrustKeys) {
      const maxSp = curWorld.maxSpeedWorldPerS;
      const f = probe.forward();
      const fwdSpd = probe.vel[0] * f[0] + probe.vel[1] * f[1] + probe.vel[2] * f[2];
      // 机翼缓回水平（旁观构图稳定），手动横滚暂停回正
      if (rollIn === 0) probe.steer(0, 0, -probe.roll * Math.min(1, dtReal * 0.8));
      if (auto.kind === 'goto' && probe.mode === 'cruise') {
        const t = auto.target;
        const d = dist3(probe.pos, t.pos);
        // 抵达半径：天体拾取半径 ×4 + 半个跟拍距离（旁观构图刚好框住目标），
        // 相机距离项封顶 3 世界单位——默认远视角下不会"隔老远就抵达"
        const stopD = (t.pickRadius || 0.1) * 4 + Math.min(chaseCam.followDist * 0.5, 3);
        if (d < stopD && fwdSpd < maxSp * 0.03) {
          selected = null; // 清除选中：再按 H 转入自由航行，而非重复寻的
          disengageAuto(`已抵达<b style="color:#ffd27f">${t.name}</b> · 手动接管，或按 <kbd>H</kbd> 转入自由航行`);
        } else {
          steerTowards(t.pos, dtReal);
          const desired = Math.max(0, Math.min(0.4 * maxSp, (d - stopD) * 0.8));
          if (fwdSpd < desired) autoThrust = true;
          else if (fwdSpd > desired * 1.3 + maxSp * 0.01) autoBrake = true;
        }
      } else if (auto.kind === 'voyage' && probe.mode === 'ballistic') {
        // 旅行者式自由航行：引力主导滑行，旁观镜头缓慢环绕（约 2.5 分钟一圈）
        if (chaseCam.mode === 'orbit') chaseCam.orbitBy(dtReal * 8, 0);
        // 兴趣点（POI）：随机拣选可拾取天体；到点/超时/无目标则换下一个——永续航行
        auto.poiT -= dtReal;
        const near = auto.poi ? dist3(probe.pos, auto.poi.pos) : Infinity;
        if (auto.poiT <= 0 || near < (auto.poi.pickRadius || 0.1) * 8) {
          const cands = curWorld.entities.filter((e) => (e.pickRadius || 0) > 0 && e !== auto.poi);
          auto.poi = cands.length ? cands[(Math.random() * cands.length) | 0] : null;
          auto.poiT = 24; // 每个 POI 至少逛 24s
        }
        if (auto.poi) {
          // 温和转向 POI（0.25 rad/s，天体附近的弯由引力甩出来）
          steerTowards(auto.poi.pos, dtReal, 0.25);
          // 深空航向修正（TCM，真·旅行者号的做法）：引力微弱且航向未对准
          // POI（或几乎静止）时朝前微推；天体附近完全交给引力
          const ga = probe.gravAccel();
          const gal = Math.hypot(ga[0], ga[1], ga[2]);
          const tx = auto.poi.pos[0] - probe.pos[0], ty = auto.poi.pos[1] - probe.pos[1], tz = auto.poi.pos[2] - probe.pos[2];
          const tl = Math.hypot(tx, ty, tz) || 1;
          const aligned = (f[0] * tx + f[1] * ty + f[2] * tz) / tl;
          autoThrust = gal < curWorld.thrustAccWorldPerS2 * 0.5 && (aligned < 0.995 || fwdSpd < 0.08);
          autoThrustScale = 0.15;
        }
      }
    }
    probe.thrustOn = thrustKeys || autoThrust;
    const boost = a.boost;
    const braking = input.keys.has('x') && probe.mode === 'cruise';
    const dtSim = clock.paused ? 0 : dtReal * clock.rate;
    // 引力模式物理用实时（dtReal，演示 GM），巡航用阻尼惯性
    const dtPhys = probe.mode === 'ballistic' ? dtReal : dtSim;
    const noKeys = { fwd: false, bwd: false, left: false, right: false, up: false, down: false };
    if (braking || autoBrake) {
      probe.brake(dtReal);
      probe.step(dtReal, noKeys, 0, dtPhys);
    } else if (thrustKeys) probe.step(dtReal, a, boost ? 3 : 1, dtPhys);
    else if (autoThrust) probe.step(dtReal, { ...noKeys, fwd: true }, autoThrustScale, dtPhys); // 自动推进（寻的全速/航行微推）
    else probe.step(dtReal, a, 0, dtPhys); // 仍应用阻尼/惯性
    // 飞船本体：座舱视角隐藏（第一人称看不见自己），尾焰随推力
    ship.visible = chaseCam.mode !== 'cockpit';
    if (ship.visible) {
      syncShip();
      updateShipFlame(ship, (thrustKeys || autoThrust) ? 1 : 0, boost && thrustKeys);
    }

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

    // 准星悬停
    updateHover();

    // HUD
    const spKmS = probe.speedKmS();
    const cfrac = spKmS / C_KM_S;
    // 引力模式用教学 GM（演示速度可超光速）：超光速时明示"演示速度"
    const demoTag = probe.mode === 'ballistic' && cfrac >= 1 ? ' · 演示速度' : '';
    const spText = spKmS < C_KM_S
      ? Math.max(spKmS, 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' km/s'
      : '≈' + cfrac.toFixed(1) + ' c' + demoTag;
    let distText = '—';
    const showEnt = selected || (hoveredId && curWorld.entities.find((e) => e.id === hoveredId));
    if (showEnt) {
      const dkm = dist3(probe.pos, showEnt.pos) * curWorld.kmPerUnit;
      distText = `${showEnt.name} · ${formatKm(dkm)} · 光 ${lightTravelText(dkm)}`;
    }
    const viewName = VIEW_NAMES[chaseCam.mode] || '';
    const autoTag = !auto ? '' : auto.kind === 'voyage' ? ' · 自由航行' : ` · 自动驾驶→${auto.target.name}`;
    let modeText = `${probe.mode === 'ballistic' ? '引力模式' : '巡航'} · ${viewName}${braking ? ' · 刹车' : ''}${boost && thrustKeys ? ' · 加力' : ''}${autoTag}`;
    if (probe.mode === 'ballistic') {
      const gname = probe.dominantWell ? probe.dominantWell.name
        : (curWorld.gravity ? curWorld.gravity.name : '无（惯性直线）');
      // 束缚/逃逸：比能量 E = v²/2 - GM/r 相对主导井
      if (probe.dominantWell) {
        const c = probe.dominantWell.ref ? probe.dominantWell.ref.pos : probe.dominantWell.center;
        const r = Math.hypot(probe.pos[0]-c[0], probe.pos[1]-c[1], probe.pos[2]-c[2]) || 1;
        const E = (probe.vel[0]**2 + probe.vel[1]**2 + probe.vel[2]**2) / 2 - probe.dominantWell.GM / r;
        modeText = `引力模式 · ${viewName} · ${probe.dominantWell.name} · ${E < 0 ? '束缚轨道' : '逃逸轨道'}`;
      } else {
        modeText = `引力模式 · ${viewName} · ${gname}`;
      }
      // 完全捕获提示（深入引力阱且束缚轨道持续 → 引导按 R 重生）；
      // 解除捕获后恢复常规提示（捕获时 probe.step 会清除 captureState）
      const helpEl = document.getElementById('dock-help');
      if (helpEl) {
        if (probe.captureState && performance.now() / 1000 - probe.captureState.since > 1.2) {
          helpEl.innerHTML = `<b style="color:#ffd27f">已被 ${probe.captureState.name} 的引力完全捕获</b> —— 按 R 在系统边缘重生继续航行`;
        } else if (!probe.captureState && helpEl.dataset.captured === '1') {
          helpEl.textContent = '引力模式：WASD 变轨 · G 返回巡航 · R 挣脱捕获';
        }
        helpEl.dataset.captured = probe.captureState ? '1' : '';
      }
    }
    ui.setHud({ speedText: spText, distText, modeText });
    ui.setTimeState({ clockLabel: clock.timeLabel(), paused: clock.paused });
  }

  chaseCam.update(dtReal, input.actions.boost && probe.thrustOn);
  trailRibbon.update(probe);
  // 标签距离淡出+屏幕避让：远景标签降透明度，重叠标签只保留最近者
  if (curWorld) {
    updateLabelFades(curWorld.group, engine.camera, curWorld.labelFadeDist || curWorld.viewDist * 1.6);
  }
  engine.render(dtReal);
}

// 点击 → 选中信息卡（游戏式：指针锁定时取准星目标，未锁定取光标射线目标）
canvas.addEventListener('click', (ev) => {
  if (!curWorld) return;
  let hit;
  if (input.pointerLocked) {
    const { o, d } = cameraRay(0, 0);
    hit = pickObject(o, d, pickMaxDist());
  } else {
    const rect = canvas.getBoundingClientRect();
    const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const { o, d } = cameraRay(nx, ny);
    hit = pickObject(o, d, pickMaxDist());
  }
  if (hit) {
    selected = hit;
    ui.showInfo(hit);
  }
});

// 滚轮：追踪/环绕距离变焦（游戏第三人称惯例）
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  chaseCam.zoomBy(ev.deltaY > 0 ? 1.12 : 0.89);
}, { passive: false });

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
window.__universe = { engine, probe, clock, nav, ui, input, chaseCam, ship,
  get world() { return nav.world; }, get auto() { return auto; },
  select(id) {
    const e = nav.world?.entities.find((x) => x.id === id);
    if (e) { selected = e; ui.showInfo(e); }
    return !!e;
  } };

boot();
