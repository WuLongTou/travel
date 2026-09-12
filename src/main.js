// 主入口：宇宙航行 · 真实物理太空飞行器模拟
// 装配：渲染引擎 → 世界管理 → 尺度导航 → 动力学飞船 → UI 响应 → 主循环
// 三种控制模式（MODE_*）：
//   - AUTO（默认）：飞船全自动飞行（点选天体自动导向泊车；无目标引力井内自动入轨巡航），
//     鼠标只管环视/缩放/时间，随时按飞行键接管
//   - GOD（G 键切换）：上帝视角——相机脱离飞船自由浏览（WASD 移动/Space·C 或 Q/E 升降/
//     鼠标转向/滚轮调速/Shift 加速），飞船在背景中继续全自动飞行，再按 G 返回飞船
//   - MANUAL：按下飞行操控键期间人工干预飞船轨迹，松手自动回 AUTO
// 视角与时间：V 切换追尾/座舱/环绕 · Z 视角复位 · [ ] 时间倍率 · \ 暂停 · R 安全轨道重部署
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
import { FreeCam } from './render/freecam.js';
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
const freeCam = new FreeCam(engine.camera);
let curTimeIdx = 0;

// 控制模式状态机
const MODE_AUTO = 'auto'; // 全自动飞行（默认）
const MODE_MANUAL = 'manual'; // 人工干预（按住飞行键期间）
const MODE_GOD = 'god'; // 上帝视角（相机脱离飞船，飞船继续自动飞）
let controlMode = MODE_AUTO;

let curWorld = null;
let selected = null; // 当前选中的目标天体
let hoveredId = null;

function clearSelection() {
  selected = null;
  ui.hideInfo();
}

// ==========================================================
// 大巡游模式（T 键）：按各层预设站点自动串联巡游——
// 到站泊车伴飞 → 停留观赏 → 下一站，循环往复；任何手动飞行干预
// 或用户改选目标即终止巡游（观察类操作与上帝视角不受影响）
// ==========================================================
const TOUR_DWELL_S = 12; // 每站停留时长（真实秒）
const TOUR_ARRIVE_S = 1.2; // 进入泊位圈持续该时长判定到站
let tour = null; // { stops, idx, phase: 'enroute'|'dwell', dwellLeft, nearS }
let lastParkDist = 0; // 自动导航最近一帧计算的泊距（到站判定基准）
let toastText = '';
let toastUntil = 0;

function toastMsg(text, secs = 4) {
  toastText = text;
  toastUntil = performance.now() / 1000 + secs;
}

function startTour() {
  if (tour) { stopTour('巡游结束'); return; }
  const stops = (curWorld?.tourStops || [])
    .map((id) => curWorld.entities.find((e) => e.id === id))
    .filter(Boolean);
  if (stops.length < 2) { toastMsg('此尺度层没有巡游路线'); return; }
  tour = { stops, idx: 0, phase: 'enroute', dwellLeft: 0, nearS: 0 };
  selected = stops[0];
  ui.showInfo(selected);
  toastMsg(`大巡游启程 · 共 ${stops.length} 站`);
}

function stopTour(msg) {
  if (!tour) return;
  tour = null;
  if (msg) toastMsg(msg);
}

function tourNextStop() {
  tour.idx = (tour.idx + 1) % tour.stops.length;
  tour.phase = 'enroute';
  tour.nearS = 0;
  selected = tour.stops[tour.idx];
  ui.showInfo(selected);
}

// 每帧推进巡游状态机（仅在 AUTO 自动分支调用；到站判定复用自动导航泊距）
function updateTour(dtReal) {
  if (!tour || !selected) return;
  // 站点实体失效（异常清理）→ 跳下一站
  if (!curWorld.entities.includes(selected)) { tourNextStop(); return; }
  if (tour.phase === 'enroute') {
    const d = dist3(probe.pos, selected.pos);
    if (lastParkDist > 0 && d <= lastParkDist * 1.5) {
      tour.nearS += dtReal;
      if (tour.nearS >= TOUR_ARRIVE_S) { tour.phase = 'dwell'; tour.dwellLeft = TOUR_DWELL_S; }
    } else {
      tour.nearS = 0;
    }
  } else {
    tour.dwellLeft -= dtReal;
    if (tour.dwellLeft <= 0) tourNextStop();
  }
}

function enterGodMode() {
  if (controlMode === MODE_GOD) return;
  controlMode = MODE_GOD;
  // 从当前相机位置无缝接管；按当前跟拍距离校准移动速度尺度
  freeCam.enter(Math.max(chaseCam.followDist, curWorld ? curWorld.worldRadius * 0.01 : 0.1));
}

function exitGodMode() {
  if (controlMode !== MODE_GOD) return;
  controlMode = MODE_AUTO;
  freeCam.exit();
  // 相机回到飞船追尾位置
  chaseCam.resetPan();
  chaseCam._inited = false;
}

const ui = new UI(engine, {
  onNav: (wid) => nav.enter(wid),
  onDiveTo: (entity) => nav.diveInto(entity),
  onInfoClose: () => { selected = null; },
});

// 跃迁前清理指向旧世界实体的目标锁定（防止自动飞控追逐幽灵目标）
nav.onBeforeWorldChange = () => {
  stopTour(); // 巡游路线按层定义，跨层即失效
  clearSelection();
  if (controlMode === MODE_GOD) exitGodMode();
};

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
let prevG = false;
let prevT = false;

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
    // G 键（边沿触发）：上帝视角 ⇄ 返回飞船
    const gDown = input.keys.has('g');
    if (gDown && !prevG) {
      if (controlMode === MODE_GOD) exitGodMode();
      else enterGodMode();
    }
    prevG = gDown;

    // T 键（边沿触发）：大巡游 启程/结束（系统类操作，任何模式下均可）
    const tDown = input.keys.has('t');
    if (tDown && !prevT) {
      startTour();
    }
    prevT = tDown;

    if (controlMode === MODE_GOD) {
      // ===== 上帝视角：相机自由浏览，飞船在背景中继续全自动飞行 =====
      if (steer.steerX !== 0 || steer.steerY !== 0) {
        freeCam.lookBy(steer.steerX, steer.steerY);
      }
      // WASD 移动相机，Space/C 或 Q/E 升降，Shift 加速
      freeCam.update(dtReal, {
        fwd: a.fwd, bwd: a.bwd, left: a.left, right: a.right,
        up: a.up || a.rollL, down: a.down || a.rollR, boost: a.boost,
      });
    } else {
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
    }

    // ==========================================================
    // 统一飞行控制系统（严格仅根据「飞行操控类」操作判断人工干预）
    // 观察视角调整（鼠标环视/平移/缩放/切视角）、时间流速调整（加速/减速/暂停）、系统复位等 100% 不算干预
    // ==========================================================
    // 上帝视角下飞行键用于移动相机，绝不干预飞船
    const isIntervening = controlMode !== MODE_GOD && input.isFlightIntervening();
    const rollIn = (input.keys.has('q') ? 1 : 0) - (input.keys.has('e') ? 1 : 0);
    const manualThrustKeys = a.fwd || a.bwd || a.left || a.right || a.up || a.down;
    const isBraking = input.keys.has('x');
    // 上帝视角下 Shift 加速只作用于相机移动，绝不让背景中的飞船尾焰呈现加力
    const isBoosting = controlMode !== MODE_GOD && a.boost && manualThrustKeys;
    const maxSp = curWorld.maxSpeedWorldPerS || 5.0;
    controlMode = isIntervening ? MODE_MANUAL : (controlMode === MODE_MANUAL ? MODE_AUTO : controlMode);

    let autoFwdThrust = false;
    let autoThrustScale = 1.0;
    let autoBrake = false;
    let flightStatus = '';

    if (isIntervening) {
      // 玩家主动进行「飞行操控类」干预：
      // 手动接管即终止大巡游；仅当存在实际推进/刹车输入时才解除目标锁定
      // （纯 Q/E 横滚保持锁定）
      stopTour('手动接管 · 巡游结束');
      if (selected && input.hasThrustInput()) {
        clearSelection();
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
      // 全自动航行（AUTO；上帝视角下飞船同样在此分支自动飞行）
      updateTour(dtReal); // 大巡游状态机（到站/停留/下一站）
      const currentSpeed = probe.speedWorldPerS();
      const f = probe.forward();
      const fwdSpeed = probe.vel[0] * f[0] + probe.vel[1] * f[1] + probe.vel[2] * f[2];

      // 机翼平缓回正
      if (chaseCam.mode !== 'orbit') {
        probe.steer(0, 0, -probe.roll * Math.min(1, dtReal * 0.8));
      }

      // 目标有效性守卫：锁定实体必须仍属于当前世界（防跨层幽灵目标）
      if (selected && !curWorld.entities.includes(selected)) {
        clearSelection();
      }

      if (selected) {
        // 【自动导航模式】：已锁定目标天体，自动平滑对准并导引航行前往
        const targetPos = selected.pos;
        const dToTarget = dist3(probe.pos, targetPos);
        const targetRadius = selected.pickRadius || 0.2;

        // 泊车物理：泊距必须落在「目标自身引力占优」的范围内（g_own ≥ 2×最强
        // 第三方井，近似希尔球），泊位轨道才开普勒稳定——行星泊位若悬停在
        // 太阳井占优区，任何悬停控制器都要与太阳引力对抗，扰动必然积累成坠日
        const wells = probe._wells();
        const ownWell = wells.find((w) => w.ref === selected ||
          (!w.ref && w.center && dist3(w.center, targetPos) <= targetRadius * 1.5));
        let safeParkDistance = targetRadius * 3.5 + Math.min(chaseCam.followDist * 0.5, 2.0);
        if (ownWell && ownWell.GM > 0) {
          let gOther = 0;
          for (const w of wells) {
            if (w === ownWell) continue;
            const c = w.ref ? w.ref.pos : w.center;
            const r = dist3(targetPos, c) || 1e-6;
            gOther = Math.max(gOther, w.GM / (r * r));
          }
          const maxOrbitD = Math.sqrt(ownWell.GM / (2 * gOther));
          safeParkDistance = Math.max(targetRadius * 1.8, Math.min(safeParkDistance, maxOrbitD));
        }
        lastParkDist = safeParkDistance; // 供大巡游到站判定复用

        // 最强井（按引力加速度而非井心距离——行星泊位处最近的是行星井，
        // 最强的可能是太阳井），供安全包线与驻点方案使用
        let well = null, wellC = null, wellG = 0;
        for (const w of wells) {
          const c = w.ref ? w.ref.pos : w.center;
          const r = dist3(probe.pos, c) || 1e-6;
          const g = w.GM / (r * r);
          if (g > wellG) { wellG = g; well = w; wellC = c; }
        }
        const inTargetWell = !!(ownWell && well === ownWell);
        // 驻点置于占优边界外侧：船处在第三方井主导区（目标自身井不占优或无井）
        // 时，背井驻点悬停接应（PD 回归 + 引力抵消 + 全速度阻尼 + 目标斥力），
        // 防止向目标过冲后直坠第三方井；一旦进入目标自身井占优区，驻点消失，
        // 交由已验证的自由轨道防坠/伴飞路径
        const bandMid = safeParkDistance * 1.3;
        let station = null;
        if (!inTargetWell && wellC) {
          const sx = targetPos[0] - wellC[0], sy = targetPos[1] - wellC[1], sz = targetPos[2] - wellC[2];
          const sl = Math.hypot(sx, sy, sz) || 1;
          station = [
            targetPos[0] + sx / sl * bandMid,
            targetPos[1] + sy / sl * bandMid,
            targetPos[2] + sz / sl * bandMid,
          ];
        }

        // 导航基准点与沿基准点的接近速度（转向滞后时前向速度分量失真，油门判定
        // 必须用接近速度，防「追踪转向+向心推力」自锁成动力环绕极限环）
        const navPos = station || targetPos;
        const dNav = station ? dist3(probe.pos, navPos) : dToTarget;
        const nlx = (navPos[0] - probe.pos[0]) / dNav;
        const nly = (navPos[1] - probe.pos[1]) / dNav;
        const nlz = (navPos[2] - probe.pos[2]) / dNav;
        const vClose = probe.vel[0] * nlx + probe.vel[1] * nly + probe.vel[2] * nlz;
        const closingIn = vClose; // 坠向导航点的速度
        // 目标本体方向单位向量（伴飞/斥力仍相对目标）
        const rlx = (targetPos[0] - probe.pos[0]) / dToTarget;
        const rly = (targetPos[1] - probe.pos[1]) / dToTarget;
        const rlz = (targetPos[2] - probe.pos[2]) / dToTarget;

        // 引力井安全包线（最高优先级）：向最强井俯冲时无条件全推力反井心拉起。
        // 触发按制动需求距离判定——当前向井速度需要的停止距离一旦吃掉井面余量，
        // 立即拉起（固定半径要么太晚要么误伤正常伴飞）
        const acc = curWorld.thrustAccWorldPerS2 || 1.2;
        let guardPull = false;
        let gwr = Infinity, vWell = 0, safeR = 0.4;
        if (well && wellC && well.GM > 0) {
          safeR = well.minR || 0.4;
          gwr = dist3(probe.pos, wellC) || 1e-6;
          vWell = ((probe.pos[0] - wellC[0]) * probe.vel[0] + (probe.pos[1] - wellC[1]) * probe.vel[1] + (probe.pos[2] - wellC[2]) * probe.vel[2]) / gwr;
          const vIn = Math.max(0, -vWell);
          const aBrake = Math.max(0.15, acc - wellG);
          const need = vIn * vIn / (2 * aBrake);
          if (gwr - safeR < need + safeR * 0.5) {
            steerTowardsDir([(probe.pos[0] - wellC[0]) / gwr, (probe.pos[1] - wellC[1]) / gwr, (probe.pos[2] - wellC[2]) / gwr], dtReal, 2.2);
            autoFwdThrust = true;
            autoThrustScale = 1.0;
            flightStatus = `防井坠毁 · 拉起 (${well.name})`;
            guardPull = true;
          }
        }

        if (!guardPull) {
          // 泊位/悬停区判定：2 倍泊距圈（自身井目标在圈内做防坠/轨道收拢，
          // 圈外由带反井心分量的巡航接管——占优边界/固定大倍数圈都会让进场
          // 刹车或收拢刹车误伤合法的巡航/转移速度）；无自身井目标用驻点悬停圈
          const inParkZone = station ? dToTarget <= safeParkDistance * 2 : dNav <= safeParkDistance * 2;
          if (inParkZone) {
            // 抵达泊位/驻位区：伴飞/悬停（各分支独占转向权，防坠的反向转向
            // 若与对准转向叠加会互相抵消，机头永远调不离目标）
            if (!station && closingIn > 0.06 * maxSp && dToTarget > safeParkDistance * 0.55) {
              // 进场末段快速接近：反推刹车吸能。仅限泊位外半区——深处刹车会杀掉
              // 切向轨道动量，近心点逐圈降低形成衰变螺旋直至撞毁
              steerTowards(targetPos, dtReal, 1.4);
              autoBrake = true;
              flightStatus = `抵达泊位 · 制动伴飞 ${selected.name}`;
            } else if (station) {
              // 驻点悬停伴飞：驻点 PD 回归 + 全速度阻尼 + 反井心引力抵消 +
              // 目标斥力（防 PD 直线穿越目标天体）
              let ax = 0, ay = 0, az = 0;
              const px = station[0] - probe.pos[0], py = station[1] - probe.pos[1], pz = station[2] - probe.pos[2];
              const pd = Math.hypot(px, py, pz) || 1e-6;
              const pdPull = Math.min(pd, 1) * 0.8;
              ax += px / pd * pdPull; ay += py / pd * pdPull; az += pz / pd * pdPull;
              ax -= probe.vel[0] * 0.8; ay -= probe.vel[1] * 0.8; az -= probe.vel[2] * 0.8;
              const wx = probe.pos[0] - wellC[0], wy = probe.pos[1] - wellC[1], wz = probe.pos[2] - wellC[2];
              const wr = Math.hypot(wx, wy, wz) || 1e-6;
              const g = well.GM / (wr * wr);
              ax += wx / wr * g; ay += wy / wr * g; az += wz / wr * g;
              const rep = Math.max(0, safeParkDistance * 0.8 - dToTarget) * 3;
              ax += rlx * rep; ay += rly * rep; az += rlz * rep;
              const aMag = Math.hypot(ax, ay, az);
              if (aMag > acc * 0.03) {
                steerTowardsDir([ax, ay, az], dtReal, 1.4);
                autoFwdThrust = true;
                autoThrustScale = Math.min(1.0, aMag / acc);
                flightStatus = aMag > acc ? `伴飞防坠 · 退避 ${selected.name}` : `安全伴飞 · 悬停 ${selected.name}`;
              } else {
                steerTowards(targetPos, dtReal, 1.4);
                flightStatus = `安全伴飞 · ${selected.name}`;
              }
            } else if (closingIn > 0.02 * maxSp || (dToTarget < safeParkDistance * 0.55 && closingIn > -0.02 * maxSp)) {
              // 目标自身井内防坠退避：低速悬停会坠向天体，机头调离目标反向撑住
              // （若已明显远离则放行，交由跟随分支收回）
              steerTowardsDir([-rlx, -rly, -rlz], dtReal, 1.4);
              autoFwdThrust = true;
              autoThrustScale = Math.min(1.0, closingIn / (maxSp * 0.2) + 0.3);
              flightStatus = `伴飞防坠 · 退避 ${selected.name}`;
            } else if (ownWell && ownWell.GM > 0 && currentSpeed > 1.3 * Math.sqrt(ownWell.GM / Math.max(dToTarget, 1e-6))) {
              // 轨道收拢：偏心轨道远地点速度超过当地圆轨道速度 1.5 倍即泄速，
              // 逐圈压低远心点，把松散椭圆收拢进泊位圈（否则远地点漂出目标
              // 引力占优区后被第三方井甩回，近心点逐圈衰减直至撞毁）
              steerTowards(targetPos, dtReal, 1.4);
              autoBrake = true;
              flightStatus = `抵达泊位 · 制动伴飞 ${selected.name}`;
            } else if (dToTarget > safeParkDistance * 0.9) {
              // 目标公转逐渐远离：微推跟住，保持伴飞
              steerTowards(targetPos, dtReal, 1.4);
              autoFwdThrust = true;
              autoThrustScale = 0.12;
              flightStatus = `安全伴飞 · 跟随 ${selected.name}`;
            } else {
              steerTowards(targetPos, dtReal, 1.4);
              flightStatus = `安全伴飞 · ${selected.name}`;
            }
          } else {
            // 巡航飞向导航点：制动能量曲线约束总速度（防过冲/防极限环，系数 0.45
            // 保留一半以上制动裕量——向站区边缘的到达速度必须可被悬停 PD 吸收），
            // 并受主导井安全速度约束——向井一侧按到井面余量的制动能量限速，
            // 从源头杜绝以巡航速度向井俯冲（包线拉起只作异常兜底）。
            // 期望方向混入反井心分量（按最强井引力权重）——机头指向目标的纯追踪
            // 没有侧向分量抵消第三方引力拖拽，会形成绕目标的动力环绕极限环
            let ax = nlx, ay = nly, az = nlz;
            if (well && wellC && well.GM > 0 && well !== ownWell) {
              const gw = Math.min(1.2, wellG / acc) * 1.1;
              ax += (probe.pos[0] - wellC[0]) / gwr * gw;
              ay += (probe.pos[1] - wellC[1]) / gwr * gw;
              az += (probe.pos[2] - wellC[2]) / gwr * gw;
            }
            const al = Math.hypot(ax, ay, az) || 1;
            steerTowardsDir([ax / al, ay / al, az / al], dtReal, 1.4);
            const approachSpeed = Math.sqrt(Math.max(0, 2 * acc * (dNav - (station ? bandMid : safeParkDistance)))) * (station ? 0.35 : 0.45);
            const wellSafe = well && wellC && well.GM > 0
              ? Math.max(0.25, Math.sqrt(Math.max(0, 2 * acc * 0.8 * Math.max(0, gwr - safeR * 2.5))))
              : Infinity;
            const desiredSpeed = Math.min(maxSp * 0.8, Math.max(0.15 * maxSp, approachSpeed), wellSafe);
            if (vClose > desiredSpeed * 1.15 || currentSpeed > desiredSpeed ||
                (station && dToTarget < safeParkDistance * 0.8 && closingIn > 0.02 * maxSp)) {
              autoBrake = true;
            } else if (vClose < desiredSpeed) {
              autoFwdThrust = true;
              autoThrustScale = Math.min(1.0, (desiredSpeed - vClose) / (maxSp * 0.3));
            }
            flightStatus = `自动导向 · ${selected.name}`;
          }
        }
      } else {
        // 【自由全自动航行】：引力井内自动维持稳定轨道巡航，无井则惯性直线
        const well = probe.dominantWell;
        if (well && well.GM > 0) {
          const c = well.ref ? well.ref.pos : well.center;
          const dx = probe.pos[0] - c[0], dy = probe.pos[1] - c[1], dz = probe.pos[2] - c[2];
          const r = Math.hypot(dx, dy, dz) || 1;
          const vCirc = Math.sqrt(well.GM / r); // 当前高度圆轨道速度
          const radialSpeed = (probe.vel[0] * dx + probe.vel[1] * dy + probe.vel[2] * dz) / r;

          if (currentSpeed < 0.02 * maxSp && Math.abs(radialSpeed) < 0.02 * maxSp) {
            // 玩家主动刹停：保持空间停泊，不自动重启引擎
            flightStatus = `全自动接管 · 空间停泊 (${well.name}引力井)`;
          } else if (currentSpeed > vCirc * 1.6) {
            // 明显超速（趋于逃逸）：不再补推，交由引力自然弯转航道；HUD 如实显示
            flightStatus = `全自动航行 · 引力滑行 (${well.name})`;
          } else if (currentSpeed < vCirc * 0.7 && radialSpeed < 0) {
            // 低速且正在下坠：切向补推恢复轨道
            autoFwdThrust = true;
            autoThrustScale = Math.min(0.6, (vCirc - currentSpeed) / (maxSp * 0.2) + 0.1);
            flightStatus = `全自动航行 · 轨道保持 (${well.name})`;
          } else {
            flightStatus = `全自动航行 · 轨道巡航 (${well.name})`;
          }
        } else if (currentSpeed < 0.02 * maxSp) {
          // 无引力井且静止：保持停泊
          flightStatus = '全自动接管 · 空间停泊';
        } else {
          // 无引力井：沿当前航向惯性巡航，低速时轻微补推至巡游速度
          const cruiseSpeed = maxSp * 0.35;
          if (fwdSpeed < cruiseSpeed * 0.6) {
            autoFwdThrust = true;
            autoThrustScale = Math.min(1.0, Math.max(0.15, (cruiseSpeed - fwdSpeed) / (maxSp * 0.25)));
            flightStatus = '全自动航行 · 巡航推进 (保持航向)';
          } else {
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

    const viewName = controlMode === MODE_GOD ? '上帝视角' : (VIEW_NAMES[chaseCam.mode] || '');
    const godSpeed = controlMode === MODE_GOD ? ` · 移速 ${freeCam.speed.toPrecision(2)} u/s` : '';
    let modeText = `${flightStatus} · ${viewName}${godSpeed}`;

    // 真实开普勒轨道能量判定与引力状态
    if (probe.dominantWell) {
      const well = probe.dominantWell;
      const c = well.ref ? well.ref.pos : well.center;
      const r = Math.hypot(probe.pos[0] - c[0], probe.pos[1] - c[1], probe.pos[2] - c[2]) || 1;
      const speedSq = probe.vel[0] ** 2 + probe.vel[1] ** 2 + probe.vel[2] ** 2;
      // 比机械能 E = v^2/2 - GM/r
      const energy = speedSq / 2 - well.GM / r;
      const orbitState = energy < 0 ? '束缚轨道' : '逃逸轨道';
      modeText = `${flightStatus} · ${well.name} (${orbitState}) · ${viewName}${godSpeed}`;
    }

    // 真实物理碰撞损毁提示（发生撞击后高亮反馈）
    const nowSec = performance.now() / 1000;
    if (probe.crashEvent && nowSec - probe.lastCrashTime < 4.0) {
      modeText = `⚠ 撞入 ${probe.crashEvent.name}！已在安全轨道部署`;
    }

    // 大巡游进度前缀 + 系统提示（巡游启程/结束/无路线等）
    if (tour) {
      const dwell = tour.phase === 'dwell' ? ` · 停留 ${Math.ceil(tour.dwellLeft)}s` : '';
      modeText = `大巡游 ${tour.idx + 1}/${tour.stops.length}${dwell} · ${modeText}`;
    }
    if (nowSec < toastUntil) {
      modeText = `${toastText} · ${modeText}`;
    }

    ui.setHud({ speedText: spText, distText, modeText });
    const rateLabel = clock.paused ? '已暂停' : TIME_RATE_LABELS[curTimeIdx] || `×${clock.rate}`;
    ui.setTimeHud({ clockLabel: clock.timeLabel(), rateLabel });
  }

  // 上帝视角下相机由 FreeCam 全权控制，跳过追尾相机更新
  if (controlMode !== MODE_GOD) {
    chaseCam.update(dtReal, a.boost && probe.thrustOn);
  }
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
    // 用户点击其他天体 = 改选目标，终止大巡游（点击巡游当前站目标不受影响）
    if (tour && hit !== selected) stopTour('已改选目标 · 巡游结束');
    selected = hit;
    ui.showInfo(hit);
  }
});

// 滚轮：上帝视角调节相机移动速度档位；其余视角为跟拍距离缩放
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (controlMode === MODE_GOD) {
    freeCam.adjustSpeed(ev.deltaY > 0 ? 0.8 : 1.25);
  } else {
    chaseCam.zoomBy(ev.deltaY > 0 ? 1.12 : 0.89);
  }
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
  get tour() { return tour; },
  select(id) {
    const e = nav.world?.entities.find((x) => x.id === id);
    if (e) { selected = e; ui.showInfo(e); }
    return !!e;
  },
  startTour,
  stopTour,
};

boot();
