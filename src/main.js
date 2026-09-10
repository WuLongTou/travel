// 主入口：宇宙航行 · 真实物理太空飞行器模拟
// 装配：渲染引擎 → 世界管理 → 尺度导航 → 动力学飞船 → UI 响应 → 主循环
// 操作逻辑（按「操作分类体系」判定，见 core/input.js 的 OP_CATEGORIES）：
//   - 飞行操控（唯一构成人工干预）：WASD 前后左右 · Space/C 升降 · Q/E 横滚 · Shift 加力 · X 反推刹车
//   - 全自动航行：无「飞行操控类」操作时自动接管（选定目标则自动导引飞向目标并泊车，无目标则顺行自由巡航）
//   - 视角与时间（绝不判定为干预）：V 切换追尾/座舱/环绕 · 鼠标环视/右键平移/滚轮缩放 ·
//     Z 视角复位 · [ ] 时间倍率 · \ 暂停 · R 安全轨道重部署
import './style.css';
import * as THREE from 'three';
import { CosmicEngine } from './render/engine.js';
import { Input } from './core/input.js';
import { Probe } from './core/probe.js';
import { SimClock } from './core/clock.js';
import { Navigator } from './core/navigator.js';
import { UI } from './ui/controller.js';
import { worldFactories } from './content/worlds.js';
// 世界模块（副作用自注册）
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

// 时间倍率阶梯（[ ] 键步进切换）
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

// 飞船 3D 模型
const ship = makeShip();
engine.scene.add(ship);
const _m4 = new THREE.Matrix4();
const _ndc = new THREE.Vector3();

const input = new Input(canvas);
let curTimeIdx = 0;

let curWorld = null;
let selected = null; // 当前选中的目标天体
let hoveredId = null;

const ui = new UI(engine, {
  onNav: (wid) => nav.enter(wid),
  onDiveTo: (entity) => nav.diveInto(entity),
  onInfoClose: () => { selected = null; },
});

nav.onWorldChanged = (world, idx) => {
  curWorld = world;
  engine.loadWorld(world, world.group, []);
  ui.setCrumb(idx);
  ui.setScaleHud(`${world.title} · 1单位≈${unitRulerText(world.unitName)}`);
  selected = null;
  ui.hideInfo();

  // 确保相机跟拍视距符合飞船比例，防止宏观视距导致视野飞出太阳系
  const safeShipDist = world.shipViewDist || 0.35;
  chaseCam.followDist = safeShipDist;
  chaseCam.resetPan();
  trailRibbon.reset();
};

let lastFrame = performance.now();
let prevR = false;
let prevV = false;
let prevBracketL = false;
let prevBracketR = false;
let prevBackslash = false;

// 有限角速度平滑转向给定三维方向向量
function steerTowardsDir(dir, dtReal, maxTurn = 1.2) {
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

function steerTowards(tpos, dtReal, maxTurn = 1.2) {
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
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t = -b - sq;
  return t >= 0 ? t : -b + sq >= 0 ? -b + sq : -1;
}

function dist3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

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
  return Math.max(dCam + chaseCam.followDist * 4, 1000);
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
  // 当视距被放大时限制最大飞船尺寸，避免遮挡深空背景
  const maxShipScale = curWorld ? Math.max(curWorld.worldRadius * 0.03, 15) : 15;
  const s = Math.min(Math.max(chaseCam.followDist * 0.05, 1e-4), maxShipScale);
  ship.scale.setScalar(s);
}

function renderFrame(now) {
  const dtReal = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const steer = input.poll();
  const a = input.actions;

  // R 键：主动在安全轨道重置部署
  const rDown = input.keys.has('r');
  if (rDown && !prevR && curWorld) {
    probe.respawn();
  }
  prevR = rDown;

  // V 键（边沿触发）：循环切换视角（追尾 chase ⇄ 座舱 cockpit ⇄ 环绕 orbit）
  const vDown = input.keys.has('v');
  if (vDown && !prevV && curWorld) {
    chaseCam.cycleView();
  }
  prevV = vDown;

  // [ 键：时间减速步进
  const blDown = input.keys.has('[');
  if (blDown && !prevBracketL) {
    if (curTimeIdx > 0) {
      curTimeIdx--;
      clock.setRate(TIME_RATES[curTimeIdx]);
      clock.paused = false;
    }
  }
  prevBracketL = blDown;

  // ] 键：时间加速步进
  const brDown = input.keys.has(']');
  if (brDown && !prevBracketR) {
    if (curTimeIdx < TIME_RATES.length - 1) {
      curTimeIdx++;
      clock.setRate(TIME_RATES[curTimeIdx]);
      clock.paused = false;
    }
  }
  prevBracketR = brDown;

  // \ 键：暂停/继续
  const bsDown = input.keys.has('\\');
  if (bsDown && !prevBackslash) {
    clock.paused = !clock.paused;
  }
  prevBackslash = bsDown;

  if (curWorld) {
    // 鼠标右键/中键拖拽：屏幕平面的自由平移位移（Pan）
    if (steer.panX !== 0 || steer.panY !== 0) {
      chaseCam.panBy(steer.panX, steer.panY);
    }
    // Z / Backspace 键：复位观察焦点与观察视线回飞船正后方
    if (input.keys.has('z') || input.keys.has('backspace')) {
      chaseCam.resetPan();
    }

    // 鼠标移动自由旋转观察视角（全向环视，100% 不干扰飞船的机头航向与全自动航行）
    if (steer.steerX !== 0 || steer.steerY !== 0) {
      chaseCam.orbitBy(steer.steerX, steer.steerY);
    }

    // ==========================================================
    // 统一飞行控制系统（严格仅根据「飞行操控类」操作判断人工干预）
    // 观察视角调整（鼠标环视/平移/缩放/切视角）、时间流速调整（加速/减速/暂停）、系统复位等 100% 不算干预
    // ==========================================================
    const isIntervening = input.isFlightIntervening();
    const rollIn = (input.keys.has('q') ? 1 : 0) - (input.keys.has('e') ? 1 : 0);
    const manualThrustKeys = a.fwd || a.bwd || a.left || a.right || a.up || a.down;
    const isBraking = input.keys.has('x');
    const isBoosting = a.boost && manualThrustKeys;
    const maxSp = curWorld.maxSpeedWorldPerS || 5.0;

    let autoFwdThrust = false;
    let autoThrustScale = 1.0;
    let autoBrake = false;
    let flightStatus = '';

    if (isIntervening) {
      // 玩家主动进行「飞行操控类」干预：
      // 若此前有锁定的天体目标，即刻解除锁定，转为玩家自主控制状态
      if (selected) {
        selected = null;
        ui.hideInfo();
      }

      // Q/E 机身横滚
      if (rollIn !== 0) {
        probe.steer(0, 0, rollIn * 1.6 * dtReal);
      }

      if (isBraking) {
        // 玩家主动反推刹车
        probe.brake(dtReal);
        probe.thrustOn = true;
        flightStatus = '手动干预 · 反推制动';
      } else if (manualThrustKeys) {
        // 玩家手动按键推进：完全按玩家意愿飞行；按 W 前进时机头平滑导向当前观察视线
        probe.thrustOn = true;
        const boostScale = isBoosting ? 2.5 : 1.0;
        if (chaseCam.mode !== 'orbit' && a.fwd) {
          const camDir = new THREE.Vector3();
          engine.camera.getWorldDirection(camDir);
          steerTowardsDir([camDir.x, camDir.y, camDir.z], dtReal, 3.2);
        }
        probe.step(dtReal, a, boostScale, dtReal);
        flightStatus = isBoosting ? '手动干预 · 加力推进' : '手动干预 · 推进机动';
      } else {
        // 纯姿态控制（如仅按 Q/E 滚转机翼）
        probe.thrustOn = false;
        probe.step(dtReal, { fwd: false, bwd: false, left: false, right: false, up: false, down: false }, 0, dtReal);
        flightStatus = '手动干预 · 姿态滚转';
      }
    } else {
      // 绝非干预：玩家进行视角环视、平移、缩放、切视角、调时间流速，均由全自动航行接管
      const currentSpeed = probe.speedWorldPerS();
      const f = probe.forward();
      const fwdSpeed = probe.vel[0] * f[0] + probe.vel[1] * f[1] + probe.vel[2] * f[2];

      // 机翼平缓回正
      if (chaseCam.mode !== 'orbit') {
        probe.steer(0, 0, -probe.roll * Math.min(1, dtReal * 0.8));
      }

      if (selected) {
        // 【自动导航模式】：已锁定目标天体，自动平滑对准并导引航行前往
        const targetPos = selected.pos;
        const dToTarget = dist3(probe.pos, targetPos);
        const targetRadius = selected.pickRadius || 0.2;
        const safeParkDistance = targetRadius * 3.5 + Math.min(chaseCam.followDist * 0.5, 2.0);

        steerTowards(targetPos, dtReal, 1.4);

        if (dToTarget <= safeParkDistance) {
          // 抵达目标安全泊车区：自动反推减速入轨停泊
          if (currentSpeed > maxSp * 0.05) {
            autoBrake = true;
            flightStatus = `抵达泊位 · 制动伴飞 ${selected.name}`;
          } else {
            flightStatus = `安全伴飞 · ${selected.name}`;
          }
        } else {
          // 巡航飞向目标：根据距离与限速智能匹配油门
          const desiredSpeed = Math.min(maxSp * 0.8, Math.max(0.4 * maxSp, (dToTarget - safeParkDistance) * 0.5));
          if (fwdSpeed < desiredSpeed) {
            autoFwdThrust = true;
            autoThrustScale = Math.min(1.0, (desiredSpeed - fwdSpeed) / (maxSp * 0.3));
          } else if (fwdSpeed > desiredSpeed * 1.25) {
            autoBrake = true;
          }
          flightStatus = `自动导向 · ${selected.name}`;
        }
      } else {
        // 【自由全自动航行】：保持干预结束后的当前航向继续自动飞行
        if (currentSpeed < 0.05) {
          // 若玩家刚才将飞船彻底刹停至静止，保持在当前空间悬停停泊
          flightStatus = '全自动接管 · 空间停泊';
        } else {
          // 沿干预结束时的机头航向恒速巡航推进
          const cruiseSpeed = maxSp * 0.5;
          if (fwdSpeed < cruiseSpeed) {
            // 前向微推补偿，平稳加速至巡航速度，推力自然牵引速度矢量收敛对齐机头
            autoFwdThrust = true;
            autoThrustScale = Math.min(1.0, Math.max(0.15, (cruiseSpeed - fwdSpeed) / (maxSp * 0.25)));
            flightStatus = '全自动航行 · 巡航推进 (保持航向)';
          } else {
            // 已达巡航速度或以上，依靠惯性与真实引力自然航行
            flightStatus = '全自动航行 · 惯性巡航 (保持航向)';
          }
        }
      }

      // 执行自动飞控推力或引力积分
      if (autoBrake) {
        probe.brake(dtReal);
        probe.thrustOn = true;
        probe.step(dtReal, { fwd: false, bwd: false, left: false, right: false, up: false, down: false }, 0, dtReal);
      } else if (autoFwdThrust) {
        probe.thrustOn = true;
        probe.step(dtReal, { fwd: true, bwd: false, left: false, right: false, up: false, down: false }, autoThrustScale, dtReal);
      } else {
        probe.thrustOn = false;
        probe.step(dtReal, { fwd: false, bwd: false, left: false, right: false, up: false, down: false }, 0, dtReal);
      }
    }

    // 飞船模型可见性与位姿同步
    ship.visible = chaseCam.mode !== 'cockpit';
    if (ship.visible) {
      syncShip();
      updateShipFlame(ship, probe.thrustOn ? 1 : 0, isBoosting);
    }

    // 自动 LOD 尺度跃迁检测
    nav.checkAutoTransition(dtReal);

    // 天体自转公转动力学推进
    clock.advance(dtReal);
    simulate(dtReal);

    // 准星与拾取更新
    updateHover();

    // ==========================================
    // HUD 真实天文物理仪表盘
    // ==========================================
    const spKmS = probe.speedKmS();
    const cfrac = spKmS / C_KM_S;
    const spText = spKmS < C_KM_S
      ? Math.max(spKmS, 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' km/s'
      : '≈' + cfrac.toFixed(2) + ' c';

    let distText = '无目标（点击天体锁定）';
    const showEnt = selected || (hoveredId && curWorld.entities.find((e) => e.id === hoveredId));
    if (showEnt) {
      const dkm = dist3(probe.pos, showEnt.pos) * curWorld.kmPerUnit;
      distText = `${showEnt.name} · ${formatKm(dkm)} · 光 ${lightTravelText(dkm)}`;
    }

    const viewName = VIEW_NAMES[chaseCam.mode] || '';
    let modeText = `${flightStatus} · ${viewName}`;

    // 真实开普勒轨道能量判定与引力状态
    if (probe.dominantWell) {
      const well = probe.dominantWell;
      const c = well.ref ? well.ref.pos : well.center;
      const r = Math.hypot(probe.pos[0] - c[0], probe.pos[1] - c[1], probe.pos[2] - c[2]) || 1;
      const speedSq = probe.vel[0] ** 2 + probe.vel[1] ** 2 + probe.vel[2] ** 2;
      // 比机械能 E = v^2/2 - GM/r
      const energy = speedSq / 2 - well.GM / r;
      const orbitState = energy < 0 ? '束缚轨道' : '逃逸轨道';
      modeText = `${flightStatus} · ${well.name} (${orbitState}) · ${viewName}`;
    }

    // 真实物理碰撞损毁提示（发生撞击后高亮反馈）
    const nowSec = performance.now() / 1000;
    if (probe.crashEvent && nowSec - probe.lastCrashTime < 4.0) {
      modeText = `⚠ 撞入 ${probe.crashEvent.name}！已在安全轨道部署`;
    }

    ui.setHud({ speedText: spText, distText, modeText });
    const rateLabel = clock.paused ? '已暂停' : TIME_RATE_LABELS[curTimeIdx] || `×${clock.rate}`;
    ui.setTimeHud({ clockLabel: clock.timeLabel(), rateLabel });
  }

  chaseCam.update(dtReal, a.boost && probe.thrustOn);
  trailRibbon.update(probe);

  if (curWorld) {
    updateLabelFades(curWorld.group, engine.camera, curWorld.labelFadeDist || curWorld.viewDist * 1.6);
  }
  engine.render(dtReal);
}

// 点击天体拾取目标
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

// 滚轮：无限变焦缩放
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  chaseCam.zoomBy(ev.deltaY > 0 ? 1.12 : 0.89);
}, { passive: false });

// 双击画布：快速复位相机焦点回飞船中心
canvas.addEventListener('dblclick', () => {
  chaseCam.resetPan();
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

// 全局调试挂载
window.__universe = { engine, probe, clock, nav, ui, input, chaseCam, ship,
  get world() { return nav.world; },
  get selected() { return selected; },
  select(id) {
    const e = nav.world?.entities.find((x) => x.id === id);
    if (e) { selected = e; ui.showInfo(e); }
    return !!e;
  }
};

boot();
