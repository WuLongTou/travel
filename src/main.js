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
      // 仅当存在实际推进/刹车输入时才解除目标锁定（纯 Q/E 横滚保持锁定）
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
        const safeParkDistance = targetRadius * 3.5 + Math.min(chaseCam.followDist * 0.5, 2.0);

        steerTowards(targetPos, dtReal, 1.4);

        if (dToTarget <= safeParkDistance) {
          // 抵达目标安全泊车区：自动反推减速入轨停泊
          // 滞环：速度阈值与重新加速阈值分离，避免泊位附近加减速抖振
          if (currentSpeed > maxSp * 0.06) {
            autoBrake = true;
            flightStatus = `抵达泊位 · 制动伴飞 ${selected.name}`;
          } else if (dToTarget > safeParkDistance * 0.9) {
            // 目标公转逐渐远离：微推跟住，保持伴飞
            autoFwdThrust = true;
            autoThrustScale = 0.12;
            flightStatus = `安全伴飞 · 跟随 ${selected.name}`;
          } else {
            flightStatus = `安全伴飞 · ${selected.name}`;
          }
        } else {
          // 巡航飞向目标：根据距离与限速智能匹配油门（含逼近速度约束，防过冲）
          const approachSpeed = Math.sqrt(Math.max(0, 2 * (curWorld.thrustAccWorldPerS2 || 1.2) * (dToTarget - safeParkDistance))) * 0.9;
          const desiredSpeed = Math.min(maxSp * 0.8, Math.max(0.15 * maxSp, approachSpeed));
          if (fwdSpeed < desiredSpeed) {
            autoFwdThrust = true;
            autoThrustScale = Math.min(1.0, (desiredSpeed - fwdSpeed) / (maxSp * 0.3));
          } else if (fwdSpeed > desiredSpeed * 1.15) {
            autoBrake = true;
          }
          flightStatus = `自动导向 · ${selected.name}`;
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
  select(id) {
    const e = nav.world?.entities.find((x) => x.id === id);
    if (e) { selected = e; ui.showInfo(e); }
    return !!e;
  }
};

boot();
