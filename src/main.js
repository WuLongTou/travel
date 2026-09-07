// 主入口：宇宙航行 · 飞行器模拟
// 装配：引擎（渲染）→ 世界工厂注册 → 导航 → 飞船 → UI → 输入 → 主循环
// 操作（游戏标准）：点击锁定鼠标转向 · W/S 前后 · A/D 左右 · Space/C 上下 ·
// Q/E 横滚 · Shift 加力 · X 刹车 · V 切换视角 · H 自动驾驶/自由航行 ·
// G 引力模式 · [ ] 时间倍率 · \ 暂停 · 滚轮变焦
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

// 时间倍率档位阶梯（键盘 [ ] 步进切换）
const TIME_RATES = [1, 86400, 2592000, 31557600, 315576000, 31557600000];
const TIME_RATE_LABELS = ['实时', '1天/秒', '1月/秒', '1年/秒', '10年/秒', '千年/秒'];

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
let curTimeIdx = 0; // 当前倍率阶梯索引
const ui = new UI(engine, {
  onNav: (wid) => nav.enter(wid),
  onDiveTo: (entity) => nav.diveInto(entity),
  onInfoClose: () => {},
});

let curWorld = null;
let selected = null; // 当前信息卡对象
let hoveredId = null;
let auto = null; // 自动驾驶：null | { kind:'goto', target } | { kind:'voyage', poi, poiT }

nav.onWorldChanged = (world, idx) => {
  const keepVoyage = !!auto && auto.kind === 'voyage'; // 自由航行跨层持续
  curWorld = world;
  engine.loadWorld(world, world.group, []);
  ui.setCrumb(idx);
  ui.setScaleHud(`${world.title} · 1单位≈${unitRulerText(world.unitName)}`);
  selected = null;
  auto = null;
  ui.hideInfo();
  // 刷新滚轮缩放边界
  chaseCam.setDist(chaseCam.followDist);
  trailRibbon.reset();
  // 自由航行跨层续航：新层注入绕主导井的圆轨道速度，继续探索
  if (keepVoyage) {
    probe.autoVoyage = true;
    auto = { kind: 'voyage', poi: null, poiT: 0 };
    probe.enterBallistic();
    if (clock.rate !== 1) { clock.setRate(1); curTimeIdx = 0; }
    for (let i = 0; i < 2 && chaseCam.mode !== 'orbit'; i++) chaseCam.cycleView();
  }
};

// 每帧：更新飞船（飞行/转向/时间）
let lastFrame = performance.now();
let frame = 0;
let prevG = false; // G 键边沿检测
let prevR = false; // R 键边沿检测
let prevV = false; // V 键边沿检测
let prevH = false; // H 键边沿检测
let prevBracketL = false; // [ 键边沿检测
let prevBracketR = false; // ] 键边沿检测
let prevBackslash = false; // \ 键边沿检测

// 自动驾驶接合
function engageAuto() {
  if (probe.mode === 'cruise' && selected) {
    auto = { kind: 'goto', target: selected };
    for (let i = 0; i < 2 && chaseCam.mode !== 'orbit'; i++) chaseCam.cycleView();
    const seeD = ((selected.pickRadius || 0.1) * 4 + 3) * 1.6;
    chaseCam.setDist(Math.min(chaseCam.followDist, seeD));
  } else {
    // 自由航行：切入引力模式
    if (probe.mode !== 'ballistic') {
      probe.enterBallistic();
      if (clock.rate !== 1) { clock.setRate(1); curTimeIdx = 0; }
    }
    probe.autoVoyage = true;
    auto = { kind: 'voyage', poi: null, poiT: 0 };
    for (let i = 0; i < 2 && chaseCam.mode !== 'orbit'; i++) chaseCam.cycleView();
  }
}
function disengageAuto() {
  if (auto && auto.kind === 'voyage') probe.autoVoyage = false;
  auto = null;
}

// 有限角速度转向给定方向
function steerTowardsDir(dir, dtReal, maxTurn) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const desYaw = Math.atan2(-dir[0], -dir[2]);
  const desPitch = Math.asin(Math.max(-1, Math.min(1, dir[1] / l)));
  let dYaw = desYaw - probe.yaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  const m = maxTurn * dtReal;
  probe.yaw += Math.max(-m, Math.min(m, dYaw));
  const dPitch = desPitch - probe.pitch;
  probe.pitch += Math.max(-m, Math.min(m, dPitch));
}
function steerTowards(tpos, dtReal, maxTurn = 1.0) {
  steerTowardsDir([tpos[0] - probe.pos[0], tpos[1] - probe.pos[1], tpos[2] - probe.pos[2]], dtReal, maxTurn);
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

function updateHover() {
  if (!curWorld) return;
  const { o, d } = cameraRay(0, 0);
  const hit = pickObject(o, d, pickMaxDist());
  hoveredId = hit ? hit.id : null;
  const cross = document.getElementById('crosshair');
  if (cross) cross.classList.toggle('lock', !!hit);
}

// 飞船位姿同步
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

  // G 键（边沿触发）：巡航 ⇄ 引力模式
  const gDown = input.keys.has('g');
  if (gDown && !prevG && curWorld) {
    disengageAuto();
    if (probe.mode === 'ballistic') {
      probe.exitBallistic();
    } else {
      probe.enterBallistic();
      if (clock.rate !== 1) { clock.setRate(1); curTimeIdx = 0; }
    }
  }
  prevG = gDown;

  // R 键：被引力完全捕获后重生
  const rDown = input.keys.has('r');
  if (rDown && !prevR && probe.mode === 'ballistic' && curWorld) {
    disengageAuto();
    probe.respawn();
  }
  prevR = rDown;

  // V 键（边沿触发）：追踪 ⇄ 座舱 ⇄ 环绕
  const vDown = input.keys.has('v');
  if (vDown && !prevV && curWorld) {
    chaseCam.cycleView();
  }
  prevV = vDown;

  // H 键（边沿触发）：自动驾驶 开/关
  const hDown = input.keys.has('h');
  if (hDown && !prevH && curWorld) {
    if (auto) {
      disengageAuto();
      if (probe.mode === 'ballistic') probe.exitBallistic();
    } else engageAuto();
  }
  prevH = hDown;

  // [ 键：时间减速
  const blDown = input.keys.has('[');
  if (blDown && !prevBracketL) {
    if (curTimeIdx > 0) {
      curTimeIdx--;
      clock.setRate(TIME_RATES[curTimeIdx]);
      clock.paused = false;
    }
  }
  prevBracketL = blDown;

  // ] 键：时间加速
  const brDown = input.keys.has(']');
  if (brDown && !prevBracketR) {
    if (curTimeIdx < TIME_RATES.length - 1) {
      curTimeIdx++;
      clock.setRate(TIME_RATES[curTimeIdx]);
      clock.paused = false;
    }
  }
  prevBracketR = brDown;

  // \ 键：暂停/恢复
  const bsDown = input.keys.has('\\');
  if (bsDown && !prevBackslash) {
    clock.paused = !clock.paused;
  }
  prevBackslash = bsDown;

  if (curWorld) {
    // 转向
    const SENS = 0.0042;
    if (chaseCam.mode === 'orbit') {
      chaseCam.orbitBy(steer.steerX, steer.steerY);
    } else {
      probe.steer(steer.steerX * SENS, -steer.steerY * SENS);
    }
    // Q/E 横滚
    const rollIn = (input.keys.has('q') ? 1 : 0) - (input.keys.has('e') ? 1 : 0);
    if (rollIn !== 0 && chaseCam.mode !== 'orbit') probe.steer(0, 0, rollIn * 1.6 * dtReal);

    // 自动驾驶：无手动推进时自动飞行；X 彻底退出
    if (input.keys.has('x') && auto) disengageAuto();
    const thrustKeys = a.fwd || a.bwd || a.left || a.right || a.up || a.down;
    let autoThrust = false;
    let autoThrustScale = 1;
    let autoBrake = false;
    if (auto && !thrustKeys) {
      const maxSp = curWorld.maxSpeedWorldPerS;
      const f = probe.forward();
      const fwdSpd = probe.vel[0] * f[0] + probe.vel[1] * f[1] + probe.vel[2] * f[2];
      if (rollIn === 0) probe.steer(0, 0, -probe.roll * Math.min(1, dtReal * 0.8));
      if (auto.kind === 'goto' && probe.mode === 'cruise') {
        const t = auto.target;
        const d = dist3(probe.pos, t.pos);
        const stopD = (t.pickRadius || 0.1) * 4 + Math.min(chaseCam.followDist * 0.5, 3);
        if (d < stopD && fwdSpd < maxSp * 0.03) {
          selected = null;
          disengageAuto();
        } else {
          steerTowards(t.pos, dtReal);
          const desired = Math.max(0, Math.min(0.4 * maxSp, (d - stopD) * 0.8));
          if (fwdSpd < desired) autoThrust = true;
          else if (fwdSpd > desired * 1.3 + maxSp * 0.01) autoBrake = true;
        }
      } else if (auto.kind === 'voyage' && probe.mode === 'ballistic') {
        // 旅行者式自由航行
        if (chaseCam.mode === 'orbit') chaseCam.orbitBy(dtReal * 8, 0);
        const sp = probe.speedWorldPerS();
        if (sp > 1e-4) {
          steerTowardsDir([probe.vel[0] / sp, probe.vel[1] / sp, probe.vel[2] / sp], dtReal, 1.5);
        }
        // 兴趣点随机抽取
        auto.poiT -= dtReal;
        const near = auto.poi ? dist3(probe.pos, auto.poi.pos) : Infinity;
        const arrived = auto.poi ? near < (auto.poi.pickRadius || 0.1) * 8 : false;
        if (auto.poiT <= 0 || arrived) {
          const cands = curWorld.entities.filter((e) => (e.pickRadius || 0) > 0 && e !== auto.poi);
          auto.poi = cands.length ? cands[(Math.random() * cands.length) | 0] : null;
          auto.poiT = 24;
        }
        if (auto.poi) {
          const ga = probe.gravAccel();
          const gal = Math.hypot(ga[0], ga[1], ga[2]);
          if (gal < curWorld.thrustAccWorldPerS2 * 0.5) {
            const tx = auto.poi.pos[0] - probe.pos[0], ty = auto.poi.pos[1] - probe.pos[1], tz = auto.poi.pos[2] - probe.pos[2];
            const tl = Math.hypot(tx, ty, tz) || 1;
            const vx = sp > 1e-4 ? probe.vel[0] / sp : f[0];
            const vy = sp > 1e-4 ? probe.vel[1] / sp : f[1];
            const vz = sp > 1e-4 ? probe.vel[2] / sp : f[2];
            const ux = tx / tl, uy = ty / tl, uz = tz / tl;
            const dot = vx * ux + vy * uy + vz * uz;
            const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (ang > 0.02) { autoThrust = true; autoThrustScale = 0.1; }
            if (ang > 1e-3 && sp > 1e-4) {
              const turn = Math.min(0.12 * dtReal, ang);
              let ax = vy * uz - vz * uy, ay = vz * ux - vx * uz, az = vx * uy - vy * ux;
              const al = Math.hypot(ax, ay, az);
              if (al > 1e-6) {
                ax /= al; ay /= al; az /= al;
                const c = Math.cos(turn), s = Math.sin(turn);
                const kd = vx * ax + vy * ay + vz * az;
                const rx = ay * vz - az * vy, ry = az * vx - ax * vz, rz = ax * vy - ay * vx;
                probe.vel[0] = (vx * c + rx * s + ax * kd * (1 - c)) * sp;
                probe.vel[1] = (vy * c + ry * s + ay * kd * (1 - c)) * sp;
                probe.vel[2] = (vz * c + rz * s + az * kd * (1 - c)) * sp;
              }
            }
          }
        }
      }
    }
    probe.thrustOn = thrustKeys || autoThrust;
    const boost = a.boost;
    const braking = input.keys.has('x') && probe.mode === 'cruise';
    const dtSim = clock.paused ? 0 : dtReal * clock.rate;
    const dtPhys = probe.mode === 'ballistic' ? dtReal : dtSim;
    const noKeys = { fwd: false, bwd: false, left: false, right: false, up: false, down: false };
    if (braking || autoBrake) {
      probe.brake(dtReal);
      probe.step(dtReal, noKeys, 0, dtPhys);
    } else if (thrustKeys) probe.step(dtReal, a, boost ? 3 : 1, dtPhys);
    else if (autoThrust) probe.step(dtReal, { ...noKeys, fwd: true }, autoThrustScale, dtPhys);
    else probe.step(dtReal, a, 0, dtPhys);

    // 飞船可见性与位姿同步
    ship.visible = chaseCam.mode !== 'cockpit';
    if (ship.visible) {
      syncShip();
      updateShipFlame(ship, (thrustKeys || autoThrust) ? 1 : 0, boost && thrustKeys);
    }

    // 自动 LOD 跃迁检测（替代手动 F 键下潜）
    nav.checkAutoTransition(dtReal);

    // 模拟钟
    clock.advance(dtReal);
    simulate(dtReal);

    // 准星悬停
    updateHover();

    // HUD
    const spKmS = probe.speedKmS();
    const cfrac = spKmS / C_KM_S;
    const demoTag = probe.mode === 'ballistic' && cfrac >= 1 ? ' · 演示' : '';
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
    const autoTag = auto && auto.kind === 'goto' ? ` → ${auto.target.name}` : '';
    let modeText = `${probe.mode === 'ballistic' ? '引力' : '巡航'} · ${viewName}${braking ? ' · 制动' : ''}${boost && thrustKeys ? ' · 加力' : ''}${autoTag}`;
    if (probe.mode === 'ballistic') {
      if (auto && auto.kind === 'voyage') {
        modeText = `自由航行 · ${viewName}`;
      } else if (probe.dominantWell) {
        const c = probe.dominantWell.ref ? probe.dominantWell.ref.pos : probe.dominantWell.center;
        const r = Math.hypot(probe.pos[0]-c[0], probe.pos[1]-c[1], probe.pos[2]-c[2]) || 1;
        const E = (probe.vel[0]**2 + probe.vel[1]**2 + probe.vel[2]**2) / 2 - probe.dominantWell.GM / r;
        modeText = `引力 · ${viewName} · ${probe.dominantWell.name} · ${E < 0 ? '束缚' : '逃逸'}`;
      }
      // 引力捕获警告（在 HUD 中显示，不再依赖 dock-help）
      if (probe.captureState && performance.now() / 1000 - probe.captureState.since > 1.2) {
        modeText = `⚠ ${probe.captureState.name} 捕获 · R 脱离`;
      }
    }
    ui.setHud({ speedText: spText, distText, modeText });
    // 时间 HUD
    const rateLabel = clock.paused ? '已暂停' : TIME_RATE_LABELS[curTimeIdx] || `×${clock.rate}`;
    ui.setTimeHud({ clockLabel: clock.timeLabel(), rateLabel });
  }

  chaseCam.update(dtReal, input.actions.boost && probe.thrustOn);
  trailRibbon.update(probe);
  if (curWorld) {
    updateLabelFades(curWorld.group, engine.camera, curWorld.labelFadeDist || curWorld.viewDist * 1.6);
  }
  engine.render(dtReal);
}

// 点击 → 选中信息卡
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

// 滚轮：追踪/环绕距离变焦
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  chaseCam.zoomBy(ev.deltaY > 0 ? 1.12 : 0.89);
}, { passive: false });

async function boot() {
  ui.showLoading('载入宇宙…');
  try {
    await nav.enter('solar');
    // 载入即启航：默认进入旅行者式自由航行
    engageAuto();
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
