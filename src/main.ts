// 主入口：宇宙航行 · 真实物理太空飞行器模拟
// 装配：渲染引擎 → 世界管理 → 尺度导航 → 动力学飞船 → UI 响应 → 主循环
// 三种控制模式（MODE_*）：
//   - AUTO（默认）：飞船全自动飞行（点选天体自动导向泊车；无目标引力井内自动入轨巡航），
//     鼠标只管环视/缩放/时间，随时按飞行键接管
//   - GOD（G 键切换）：上帝视角——相机脱离飞船自由浏览（WASD 移动/Space·C 或 Q/E 升降/
//     鼠标转向/滚轮调速/Shift 加速），飞船在背景中继续全自动飞行，再按 G 返回飞船
//   - MANUAL：按下飞行操控键期间人工干预飞船轨迹，松手自动回 AUTO
// 视角与时间：V 切换追尾/座舱/环绕 · Z 视角复位 · [ ] 时间倍率 · \ 时钟暂停 ·
// Esc 暂停菜单（继续/设置/回标题） · R 安全轨道重部署
import './style.css';
import * as THREE from 'three';
import { CosmicEngine } from './render/engine.js';
import { Input } from './core/input.js';
import { MISSIONS, MOON_IDS } from './core/missions.js';
import { CODEX_LAYER_ORDER, codexProgress, getLayer, registerLayerEntities } from './core/codex.js';
import { SoundFX } from './core/audio.js';
import { Probe } from './core/probe.js';
import { SimClock } from './core/clock.js';
import { Navigator } from './core/navigator.js';
import { UI } from './ui/controller.js';
import { LAYER_CHAIN } from './content/worlds.js';
import { WORLD_BY_ID } from './content/schema.js';
import { shipRadiusUnits } from './content/physics.js';
import { UiStateMachine } from './core/game-state.js';
import { Autopilot } from './core/autopilot.js';
import { TimeWarpController } from './core/time-warp.js';
import { ObjectPicker } from './render/picker.js';
import { TourController } from './core/tour.js';
import { MissionManager } from './core/mission-manager.js';
import { presentHud } from './ui/hud-presenter.js';
import { SettingsManager } from './core/settings.js';
// 世界模块（副作用自注册）
import './content/world-solar.js';
import './content/world-stellar.js';
import './content/world-galaxy.js';
import './content/world-local.js';
import './content/world-super.js';
import './content/world-cosmos.js';
import { unitRulerText } from './util/units.js';
import type { Entity, GameWorld, LayerId, Vec3 } from './types.js';
import type { GamepadState } from './core/input.js';
import { ChaseCam, VIEW_NAMES } from './render/camera.js';
import { FreeCam } from './render/freecam.js';
import { updateLabelFades } from './render/labels.js';
import { TrailRibbon } from './render/trail.js';
import { makeShip, makeShipMarker, syncShipPose, updateDynamicNearPlane, updateShipFlame } from './render/ship.js';
import { DustFlow } from './render/dust.js';
import { SpaceEvents } from './render/events.js';

// 全局调试挂载点类型
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 无头验证入口，形状见赋值处
    __universe: Record<string, any>;
  }
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const engine = new CosmicEngine(canvas);
const probe = new Probe();
const clock = new SimClock();
const nav = new Navigator(engine, probe, clock);
const chaseCam = new ChaseCam(engine.camera, probe);
engine.chaseCam = chaseCam;
const trailRibbon = new TrailRibbon(engine.scene);
// 深空环境事件（流星雨/彗星群，纯视觉氛围；首次彗星群 toast 提示）
const spaceEvents = new SpaceEvents(engine.scene, (t) => toastMsg(t));

// 飞船 3D 模型（真实尺度渲染）+ 亚像素标记 + 星尘流（速度感）
const ship = makeShip();
engine.scene.add(ship);
const shipMarker = makeShipMarker();
engine.scene.add(shipMarker);
const dust = new DustFlow();
engine.scene.add(dust.lines);

const input = new Input(canvas);
const sfx = new SoundFX();
// 用户设置（音量/震屏/画质）：localStorage 持久化与响应式联动
const settingsMgr = new SettingsManager(typeof localStorage !== 'undefined' ? localStorage : null, {
  onVolumeChange: (v) => { sfx.setVolume(v); },
  onQualityChange: (q) => { engine.setQuality(q); },
});
settingsMgr.applyInitial();
const settings = settingsMgr.settings;
// 音频需用户手势后才能启动：任意按键/点击时初始化或恢复（标题画面的
// 「开始航行」是标准入口——真实点击手势，音频随之解锁）
window.addEventListener('keydown', () => sfx.ensure());
window.addEventListener('mousedown', () => sfx.ensure());
const freeCam = new FreeCam(engine.camera);
const autopilot = new Autopilot();
const timeWarp = new TimeWarpController();
const picker = new ObjectPicker();

// 控制模式状态机
const MODE_AUTO = 'auto'; // 全自动飞行（默认）
const MODE_MANUAL = 'manual'; // 人工干预（按住飞行键期间）
const MODE_GOD = 'god'; // 上帝视角（相机脱离飞船，飞船继续自动飞）
let controlMode = MODE_AUTO;

let curWorld: GameWorld | null = null;
let selected: Entity | null = null; // 当前选中的目标天体
let navDbg: Record<string, unknown> | null = null; // 自动导航诊断快照（__universe.dbg 暴露，无头验证用）
let hoveredId: string | null = null;
const missionManager = new MissionManager(localStorage, {
  onMissionDone: (title) => {
    toastMsg(`✅ 任务完成：${title}`);
    sfx.chime();
  },
  onAllMissionsDone: () => {
    setTimeout(showVictoryScreen, 1400);
  },
  onNewDiscovery: (name, count) => {
    ui.setDiscoveries(count);
    ui.pingCrosshair();
    toastMsg(`🛰 新发现：${name}`);
  },
  onDock: () => {
    sfx.dock();
  },
  onMissionUpdate: (info) => {
    ui.setMission(info);
  },
  onDiscoveriesCountChange: (count) => {
    ui.setDiscoveries(count);
  },
});

let prevCrashTime = 0; // 最近一次撞毁时间戳（边沿触发撞毁音效与红闪）
let crashShakeT = 0; // 撞毁震屏剩余时长（秒，随时间衰减的随机相机偏移）
let prevM = false; // M 键上一帧状态（静音切换边沿）
let edgeHintShown = false; // 层界浮升提示每层只提示一次（换层重置）

function clearSelection(): void {
  selected = null;
  ui.hideInfo();
}

// 层教学横幅文案：附上「较上一层 ×N」的尺度跨度（中文万/亿纪法），
// 把「六层宇宙 = 同一宇宙连续放大」的体感在每次跃迁时敲实
function formatFold(n: number): string {
  if (n >= 1e8) return `${+(n / 1e8).toFixed(1)} 亿`;
  if (n >= 1e4) return `${+(n / 1e4).toFixed(1)} 万`;
  return `${Math.round(n).toLocaleString('zh-CN')}`;
}
function layerIntroText(world: GameWorld, prevKmPerUnit: number): string {
  const fold = prevKmPerUnit > 0 ? world.kmPerUnit / prevKmPerUnit : 0;
  const foldText = fold > 1 ? ` · 尺度较上一层 ×${formatFold(fold)}` : '';
  return (world.intro ?? '') + foldText;
}

// 选中目标（统一入口）：信息卡 + 跟拍视距随目标真实半径缩放 + 恢复自动倍率
function selectEntity(e: Entity): void {
  selected = e;
  autopilot.rendMode = false; // 新目标从巡航拦截重新开始
  ui.showInfo(e);
  timeWarp.resetToAuto();
  if (curWorld && e.pickRadius > 0) {
    // 跟拍视距按目标真实半径派生（14×目标半径），下限 8×船半径——
    // 船本身不再参与放大，真尺度下船在行星旁就是一粒尘埃
    const shipR = shipRadiusUnits(curWorld.kmPerUnit);
    chaseCam.followDist = Math.min(
      Math.max(e.pickRadius * 14, shipR * 8),
      Math.max(curWorld.worldRadius * 0.02, shipR * 8),
    );
  }
}

// ==========================================================
// 大巡游模式（T 键）：按各层预设站点自动串联巡游
// ==========================================================
let lastParkDist = 0; // 自动导航最近一帧计算的泊距（到站判定基准）
function toastMsg(text: string, secs = 4): void {
  ui.toast(text, secs);
}

const tourCtrl = new TourController({
  onSelectEntity: (e) => selectEntity(e),
  onToast: (text) => toastMsg(text),
});

function enterGodMode(): void {
  if (controlMode === MODE_GOD) return;
  controlMode = MODE_GOD;
  // 从当前相机位置无缝接管；按当前跟拍距离校准移动速度尺度
  freeCam.enter(Math.max(chaseCam.followDist, curWorld ? curWorld.worldRadius * 0.01 : 0.1));
}

function exitGodMode(): void {
  if (controlMode !== MODE_GOD) return;
  controlMode = MODE_AUTO;
  freeCam.exit();
  // 相机回到飞船追尾位置
  chaseCam.resetPan();
  chaseCam.resetPan(); // _inited 私有：复位经公共接口完成
}

const ui = new UI(engine.renderer, {
  onNav: (wid) => { void nav.enter(wid as LayerId); },
  onDiveTo: (entity) => nav.diveInto(entity),
  onInfoClose: () => { selected = null; },
});
// 手柄连接/断开提示（轮询在 renderFrame 中每帧进行）
window.addEventListener('gamepadconnected', () => toastMsg('🎮 手柄已连接', 3));
window.addEventListener('gamepaddisconnected', () => {
  toastMsg('🎮 手柄已断开', 3);
  prevGpView = false; prevGpPause = false;
});

// 设置面板：音量滑条/震屏开关/画质档实时生效并持久化；O 键或标题画面⚙打开
function openSettings() {
  ui.showSettings({
    volume: Math.round(settings.volume * 100),
    shake: settings.shake,
    quality: settings.quality,
    onVolume: (v) => { settingsMgr.setVolume(v / 100); },
    onShake: (on) => { settingsMgr.setShake(on); },
    onQuality: (q) => { settingsMgr.setQuality(q); },
    onClose: () => ui.hideSettings(),
  });
}
// 标题画面：有存档显示继续/重开；按钮点击（真实手势）同时解锁音频。
// 「开始航行」「继续航行」只是收起画面——游戏在背后以吸引模式运行；
// 「重新开始」清空进度并重载页面。存档概览读取抽成函数，游戏中
// 「回到标题」（暂停菜单）复用同一入口刷新进度
function titleProgressSnapshot() {
  return missionManager.getProgressSnapshot();
}
const uiState = new UiStateMachine({
  clock,
  onEnter: (state) => {
    if (state === 'title') {
      ui.showTitleScreen(titleProgressSnapshot());
    }
  },
});

function overlayActive() {
  return uiState.overlayActive;
}

ui.setupTitleScreen({
  onStart: () => { sfx.ensure(); uiState.start(); },
  onContinue: () => { sfx.ensure(); uiState.start(); },
  onReset: () => {
    missionManager.reset();
    location.reload();
  },
  onOpenSettings: () => openSettings(),
});
ui.showTitleScreen(titleProgressSnapshot());

// ==========================================================
// 覆盖层状态机：暂停菜单（Esc/手柄 Start）+ 通关结算 + 标题画面
// 由 UiStateMachine 统一管理时钟冻结/恢复与状态转换
// ==========================================================
let flightSeconds = 0; // 本次航行累计墙上秒（暂停/覆盖层不计；通关结算展示）
let prevEsc = false; // Esc 键上一帧状态（开关边沿）
let menuFocusIdx = 0; // 手柄 dpad 焦点位置（暂停菜单按钮下标）
let prevGpUp = false, prevGpDown = false, prevGpConfirm = false, prevGpBack = false;
let prevManual = false; // 上一帧是否人工干预（进入干预的边沿用于钳制倍率）

// 发现图鉴打开：按层序组装渲染数据（已发现显名 / 未发现 ？？？）
function openCodex() {
  const layers = CODEX_LAYER_ORDER.map((id) => {
    const snap = getLayer(id);
    let items: { name: string; found: boolean }[] = [];
    let f = 0, total = 0;
    if (snap) {
      items = [...snap.entries].map(([eid, name]) => ({ name, found: missionManager.discovered.has(eid) }));
      f = items.filter((it) => it.found).length;
      total = snap.total;
    }
    return {
      name: WORLD_BY_ID[id]?.name ?? id,
      found: f, total,
      items,
      explored: !!snap,
    };
  });
  const prog = codexProgress(missionManager.discovered);
  ui.showCodex(layers, `已收录 ${prog.found} / ${prog.total}`);
}

function openPauseMenu() {
  if (!uiState.openPauseMenu()) return;
  if (document.pointerLockElement) document.exitPointerLock();
  input.keys.clear();
  menuFocusIdx = 0;
  // 统计行：任务进度 / 发现 / 航程（打开瞬间快照）
  const mm = String(Math.floor(flightSeconds / 60)).padStart(2, '0');
  const ss = String(Math.floor(flightSeconds % 60)).padStart(2, '0');
  ui.setPauseStats(`任务 <b>${missionManager.missionIdx}/${MISSIONS.length}</b> · 已发现 <b>${missionManager.discovered.size}</b> · 航程 <b>${mm}:${ss}</b>`);
  ui.showPauseMenu();
}
function closePauseMenu() {
  if (!uiState.resume()) return;
  ui.hidePauseMenu();
}
// 回到标题：恢复时钟（吸引模式在背景继续跑），刷新存档概览并显示标题层
function backToTitle() {
  if (uiState.current === 'pause-menu') {
    uiState.resume();
    ui.hidePauseMenu();
  }
  uiState.backToTitle();
  // onEnter 回调已调用 ui.showTitleScreen
}
// 通关结算：一次性庆典（存档恢复到满环不重弹）
function showVictoryScreen() {
  if (!uiState.showVictory()) return;
  if (document.pointerLockElement) document.exitPointerLock();
  input.keys.clear();
  const moons = [...missionManager.discovered].filter((id) => MOON_IDS.has(id)).length;
  const mm = String(Math.floor(flightSeconds / 60)).padStart(2, '0');
  const ss = String(Math.floor(flightSeconds % 60)).padStart(2, '0');
  ui.showVictory([
    ['任务链', `${MISSIONS.length} / ${MISSIONS.length}`],
    ['发现天体', `${missionManager.discovered.size}`],
    ['卫星巡礼', `${moons} / ${MOON_IDS.size}`],
    ['航行时长', `${mm}:${ss}`],
  ] as [string, string][]);
  sfx.victory();
}
function closeVictory() {
  if (!uiState.dismissVictory()) return;
  ui.hideVictory();
}
ui.setupPauseMenu({
  onResume: () => closePauseMenu(),
  onCodex: () => openCodex(),
  onSettings: () => openSettings(),
  onTitle: () => backToTitle(),
});
ui.setupVictory(() => closeVictory());
// 手柄覆盖层导航：dpad 上下移动焦点、A 确认、B 返回（主机菜单惯例）
function gamepadMenuNav(gp: GamepadState): void {
  if (uiState.current === 'victory') {
    if (gp.confirm && !prevGpConfirm) closeVictory();
  } else if (uiState.current === 'pause-menu') {
    const btns = ui.pauseMenuButtons();
    if (gp.dpadUp && !prevGpUp) {
      menuFocusIdx = (menuFocusIdx + btns.length - 1) % btns.length;
      btns[menuFocusIdx].focus();
    }
    if (gp.dpadDown && !prevGpDown) {
      menuFocusIdx = (menuFocusIdx + 1) % btns.length;
      btns[menuFocusIdx].focus();
    }
    if (gp.confirm && !prevGpConfirm) btns[menuFocusIdx].click();
    if (gp.back && !prevGpBack) closePauseMenu();
  }
  prevGpUp = gp.dpadUp; prevGpDown = gp.dpadDown;
  prevGpConfirm = gp.confirm; prevGpBack = gp.back;
}

// 跃迁前清理指向旧世界实体的目标锁定（防止自动飞控追逐幽灵目标）
let prevLayerKmPerUnit = 0; // 上一层 1 单位 = ? km（层间尺度跨度展示用）
nav.onBeforeWorldChange = (world) => {
  prevLayerKmPerUnit = world.kmPerUnit;
  tourCtrl.stop(); // 巡游路线按层定义，跨层即失效
  clearSelection();
  if (controlMode === MODE_GOD) exitGodMode();
  ui.fadeOut(); // 标准场景过渡：黑场遮住世界重建，落点后淡入
};

nav.onWorldChanged = (world, idx) => {
  curWorld = world;
  registerLayerEntities(world.id, world.entities); // 图鉴收录本层可发现天体
  missionManager.onLayerChanged(idx); // 换层通知（记录是否离开太阳系）
  timeWarp.resetToAuto(); // 换层恢复自动时间倍率
  edgeHintShown = false; // 新层重新允许层界提示
  engine.loadWorld(world, world.group, []);
  ui.setCrumb(idx);
  ui.setScaleHud(`${world.title} · 1单位≈${unitRulerText(world.unitName)}`);
  ui.showLayerIntro(layerIntroText(world, prevLayerKmPerUnit)); // 层教学 + 层间尺度跨度
  ui.fadeIn(); // 转场淡入：世界就绪后从黑场回到画面
  sfx.warp(); // 跨层跃迁扫频
  selected = null;
  ui.hideInfo();

  // 跟拍视距与滚轮范围已由 navigator.enter 按「船真实半径」派生设置
  // （含 dive.at/dive.dist 精选视距），此处只复位观察偏置
  chaseCam.resetPan();
  trailRibbon.reset();
};

let lastFrame = performance.now();
// 帧率上限 60fps：模拟（自适应子步积分）+ 渲染（bloom 多 pass）每帧
// 成本固定，120/144Hz 高刷屏全速渲染纯属 GPU 浪费。阈值留 1ms 抖动
// 容差——60Hz 屏帧间隔 16.7±0.3ms，无容差会误跳近半数帧跌到 30fps。
// 被跳过的 tick 不更新 lastFrame，dtReal 按真实间隔累计，模拟节奏不变
const FRAME_MIN_MS = 1000 / 60 - 1;
let renderedFrames = 0; // 实际渲染帧计数（帧率上限验证/性能调试）
let prevR = false;
let prevV = false;
let prevBracketL = false;
let prevBracketR = false;
let prevBackslash = false;
let prevG = false;
let prevT = false;
let prevF = false;
let prevO = false; // O 键上一帧状态（设置面板开/关边沿）
let prevGpView = false; // 手柄 Y 键上一帧状态（切换视角边沿）
let prevGpPause = false; // 手柄 Start 键上一帧状态（暂停边沿）

// 有限角速度平滑转向给定三维方向向量
function steerTowardsDir(dir: Vec3, dtReal: number, maxTurn = 1.2): void {
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

function simulate(dtReal: number, dtSim: number): void {
  if (!curWorld || !curWorld.update) return;
  curWorld.update(dtSim, clock, probe, dtReal);
}

function renderFrame(now: number): void {
  const elapsed = now - lastFrame;
  if (elapsed < FRAME_MIN_MS) return; // 帧率上限：未到 60fps 间隔，跳过本 tick
  const dtReal = Math.min(0.05, elapsed / 1000);
  // 模拟时间增量：飞船位置动力学（引力+推进）与天体运动共用同一口径，
  // 时间倍率承担航行节奏（物理始终真实，倍率只放大时间流速）
  const dtSim = clock.paused ? 0 : dtReal * clock.rate;
  if (!clock.paused) flightSeconds += dtReal; // 航程墙上时（暂停/覆盖层不计）
  lastFrame = now;
  renderedFrames++;
  const steer = input.poll();
  const a = input.actions;
  // 手柄合并：摇杆/扳机与键盘同管线（有任一输入即构成人工干预）；
  // 覆盖层（标题/暂停菜单/结算）打开时手柄只用于菜单导航与 Start 开关
  let gpBrake = false, gpThrust = false;
  const gp = input.pollGamepad(dtReal);
  if (gp) {
    if (gp.pause && !prevGpPause && uiState.current !== 'victory') {
      if (uiState.current === 'pause-menu') closePauseMenu();
      else openPauseMenu();
    }
    prevGpPause = gp.pause;
    if (overlayActive()) {
      gamepadMenuNav(gp);
    } else {
      a.fwd = a.fwd || gp.fwd; a.bwd = a.bwd || gp.bwd;
      a.left = a.left || gp.left; a.right = a.right || gp.right;
      a.up = a.up || gp.up; a.down = a.down || gp.down;
      a.boost = a.boost || gp.boost;
      gpBrake = gp.brake;
      gpThrust = gp.fwd || gp.bwd || gp.left || gp.right || gp.up || gp.down || gp.brake;
      if (gp.viewX || gp.viewY) {
        steer.steerX += gp.viewX;
        steer.steerY += gp.viewY;
      }
      if (gp.viewCycle && !prevGpView && chaseCam.mode !== 'orbit' && controlMode !== MODE_GOD) {
        chaseCam.cycleView();
      }
      prevGpView = gp.viewCycle;
    }
  }

  // Esc 键（边沿）：设置面板开着先关面板；结算画面 Esc=继续自由航行；
  // 游戏中开关暂停菜单；标题画面下无操作。必须位于下方 keys.clear 之前
  const escDown = input.keys.has('escape');
  if (escDown && !prevEsc) {
    if (!ui.el['settings-panel'].classList.contains('hidden')) ui.hideSettings();
    else if (uiState.current === 'victory') closeVictory();
    else if (!overlayActive()) openPauseMenu();
    else if (uiState.current === 'pause-menu') closePauseMenu();
  }
  prevEsc = escDown;

  // 覆盖层打开期间冻结所有游戏按键：一处清理统一隔离飞行/视角/时间/
  // 系统键（冻结语义），Esc 边沿已在上方消费
  if (overlayActive()) input.keys.clear();

  // R 键：主动在安全轨道重置部署
  const rDown = input.keys.has('r');
  if (rDown && !prevR && curWorld) {
    probe.respawn();
  }
  prevR = rDown;

  // V 键（边沿触发）：循环切换视角（追尾 chase ⇄ 座舱 cockpit ⇄ 环绕 orbit）。
  // 上帝视角下不响应——此时追逐相机处于休眠状态，误切会导致返回飞船后视角莫名改变
  const vDown = input.keys.has('v');
  if (vDown && !prevV && curWorld && controlMode !== MODE_GOD) {
    chaseCam.cycleView();
  }
  prevV = vDown;

  // F 键（边沿触发）：下潜进入当前选中/准星目标的子系统层（跨层旅行快捷键，
  // 与信息卡「进入…」按钮同效）
  const fDown = input.keys.has('f');
  if (fDown && !prevF && curWorld) {
    const target = selected || (hoveredId && curWorld.entities.find((e) => e.id === hoveredId));
    if (target && target.dive) nav.diveInto(target);
    else if (target) toastMsg('该天体没有可进入的内层世界');
  }
  prevF = fDown;

  // M 键（边沿触发）：静音开关
  const mDown = input.keys.has('m');
  if (mDown && !prevM) {
    toastMsg(sfx.toggleMute() ? '🔇 已静音' : '🔊 声音开启', 2);
  }
  prevM = mDown;

  // O 键（边沿触发）：设置面板开/关
  const oDown = input.keys.has('o');
  if (oDown && !prevO) {
    if (ui.el['settings-panel'].classList.contains('hidden')) openSettings();
    else ui.hideSettings();
  }
  prevO = oDown;

  // [ 键：时间减速步进（用户手动设置后自动倍率挂起，重选目标/换层恢复）
  const blDown = input.keys.has('[');
  if (blDown && !prevBracketL) {
    timeWarp.stepDown(clock);
  }
  prevBracketL = blDown;

  // ] 键：时间加速步进
  const brDown = input.keys.has(']');
  if (brDown && !prevBracketR) {
    timeWarp.stepUp(clock);
  }
  prevBracketR = brDown;

  // \ 键：暂停/继续
  const bsDown = input.keys.has('\\');
  if (bsDown && !prevBackslash) {
    clock.paused = !clock.paused;
    toastMsg(clock.paused ? '⏸ 已暂停（\\ 继续）' : '▶ 继续航行', 2.5);
  }
  prevBackslash = bsDown;

  if (curWorld) {
    // 帧初状态快照：极端瞬态（深井高速穿越/倍率尖峰）下积分可能产生非有限
    // 值，一旦进入相机/渲染管线整页崩黑——帧末校验失败即回滚快照
    const posSnap = probe.pos.slice();
    const velSnap = probe.vel.slice();
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
      tourCtrl.toggle(curWorld);
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

      // 右键按住 = 直接掌舵：鼠标增量不经环视相机、直接转机头（灵敏度与
      // 方向约定与环视一致：右移=右转、下拉=低头），松开回环视——巡航看
      // 风景不受干扰、想开船按住右键即可。座舱模式机头由 W 导向准星，
      // 覆盖层（标题/暂停）打开时不掌舵
      if (input.steerHold && !overlayActive() && chaseCam.mode !== 'cockpit') {
        if (steer.steerX !== 0 || steer.steerY !== 0) {
          probe.steer(-steer.steerX * 0.005, -steer.steerY * 0.005, 0);
        }
      } else if (steer.steerX !== 0 || steer.steerY !== 0) {
        // 鼠标移动自由旋转观察视角（全向环视，100% 不干扰飞船的机头航向与全自动航行）
        chaseCam.orbitBy(steer.steerX, steer.steerY);
      }
    }

    // ==========================================================
    // 统一飞行控制系统（严格仅根据「飞行操控类」操作判断人工干预）
    // 观察视角调整（鼠标环视/平移/缩放/切视角）、时间流速调整（加速/减速/暂停）、系统复位等 100% 不算干预
    // ==========================================================
    // 上帝视角下飞行键用于移动相机，绝不干预飞船
    const isIntervening = controlMode !== MODE_GOD && (input.isFlightIntervening() || gpThrust);
    const rollIn = (input.keys.has('q') ? 1 : 0) - (input.keys.has('e') ? 1 : 0);
    const manualThrustKeys = a.fwd || a.bwd || a.left || a.right || a.up || a.down;
    const isBraking = input.keys.has('x') || gpBrake;
    // 上帝视角下 Shift 加速只作用于相机移动，绝不让背景中的飞船尾焰呈现加力
    const isBoosting = controlMode !== MODE_GOD && a.boost && manualThrustKeys;
    const maxSp = curWorld.maxSpeedWorldPerS || 5.0;
    const acc = curWorld.thrustAccWorldPerS2 || 1.2; // 推进加速度（各分支共用）
    controlMode = isIntervening ? MODE_MANUAL : (controlMode === MODE_MANUAL ? MODE_AUTO : controlMode);

    // 进入人工干预的边沿：把倍率钳到手动可控档（见 MANUAL_MAX_RATE 注释），
    // 避免宇宙层巡航的千亿年/秒倍率被带进手动机动——一帧 Δv 即超光速
    if (isIntervening && !prevManual) {
      const msg = timeWarp.clampForManual(clock);
      if (msg) toastMsg(`手动接管 · 倍率暂降至 ${timeWarp.currentLabel}（松手恢复自动）`);
    }
    prevManual = isIntervening;

    let autoFwdThrust = false;
    let autoThrustScale = 1.0;
    let autoBrake = false;
    let flightStatus = '';

    if (isIntervening) {
      // 玩家主动进行「飞行操控类」干预：手动接管即终止大巡游。
      // 目标锁定在手动飞行期间保持——玩家手动贴近日标后松手，自动导航
      // 从当前位置无缝接手（低轨信使等贴身挑战依赖此语义）；取消锁定
      // 用信息卡关闭按钮
      tourCtrl.stop('手动接管 · 巡游结束');

      // Q/E 机身横滚
      if (rollIn !== 0) {
        probe.steer(0, 0, rollIn * 1.6 * dtReal);
      }

      if (isBraking) {
        // 玩家主动反推刹车（模拟时间：倍率下制动同样物理一致）
        probe.brake(dtSim);
        probe.thrustOn = true;
        flightStatus = '手动干预 · 反推制动';
      } else if (manualThrustKeys) {
        // 玩家手动按键推进：完全按玩家意愿飞行；按 W 前进时附加转向——
        //   座舱：机头导向观察视线（准星即航向）；
        //   追尾：相机相对转向（见下方注释）
        probe.thrustOn = true;
        const boostScale = isBoosting ? 2.5 : 1.0;
        if (a.fwd && chaseCam.mode === 'cockpit') {
          const camDir = new THREE.Vector3();
          engine.camera.getWorldDirection(camDir);
          steerTowardsDir([camDir.x, camDir.y, camDir.z], dtReal, 3.2);
        } else if (a.fwd && chaseCam.mode === 'chase') {
          const offYaw = Math.abs(chaseCam.orbitYaw) < 0.02 ? 0 : chaseCam.orbitYaw;
          const offPitch = Math.abs(chaseCam.orbitPitch) < 0.02 ? 0 : chaseCam.orbitPitch;
          if (offYaw !== 0 || offPitch !== 0) {
            // 相机相对转向（操纵杆模式）：环视偏移 = 转动速率指令——
            // 鼠标右移（yaw 偏移为负）→ 右转、下拉（pitch 偏移为正）→ 低头。
            // 偏移随 recenter 指数回零，转速同步衰减归停，总转角有界。
            // 此前实现有两个坑：直接导向 camDir 会与「相机锚定机尾」形成
            // 正反馈棘轮（按住 W 一路俯冲到俯仰极限）；把偏移当绝对目标
            // 航向则会被机头以最大角速度追吃，0.3 rad 偏移转出 ~2.9 rad
            const TURN_GAIN = 3.0; // 满偏移 1 rad ≈ 3 rad/s 转速（0.02 rad 死区防微动漂移）
            probe.steer(-offYaw * TURN_GAIN * dtReal, -offPitch * TURN_GAIN * dtReal, 0);
            chaseCam.recenter(dtReal);
          }
        }
        probe.step(dtReal, a, boostScale, dtSim);
        flightStatus = isBoosting ? '手动干预 · 加力推进' : '手动干预 · 推进机动';
      } else {
        // 纯姿态控制（如仅按 Q/E 滚转机翼）
        probe.thrustOn = false;
        probe.step(dtReal, { fwd: false, bwd: false, left: false, right: false, up: false, down: false }, 0, dtSim);
        flightStatus = '手动干预 · 姿态滚转';
      }
    } else {
      // 全自动航行（AUTO；上帝视角下飞船同样在此分支自动飞行）
      tourCtrl.update(dtReal, probe.pos, selected, lastParkDist, curWorld.entities);

      // 机翼平缓回正
      if (chaseCam.mode !== 'orbit') {
        probe.steer(0, 0, -probe.roll * Math.min(1, dtReal * 0.8));
      }

      // 目标有效性守卫：锁定实体必须仍属于当前世界（防跨层幽灵目标）
      if (selected && !curWorld.entities.includes(selected)) {
        clearSelection();
      }

      const f = probe.forward();
      const fwdSpeed = probe.vel[0] * f[0] + probe.vel[1] * f[1] + probe.vel[2] * f[2];
      const apRes = autopilot.update({
        probePos: probe.pos,
        probeVel: probe.vel,
        probeForward: f,
        probeSpeedWorldPerS: probe.speedWorldPerS(),
        probeFwdSpeed: fwdSpeed,
        probeWells: probe._wells(),
        probeDominantWell: probe.dominantWell,
        selected,
        worldEntities: curWorld.entities,
        maxSp,
        acc,
        dtSim,
        clockRate: clock.rate,
      });

      lastParkDist = apRes.lastParkDist;
      navDbg = apRes.navDbg;
      flightStatus = apRes.flightStatus;
      autoFwdThrust = apRes.forwardThrust;
      autoThrustScale = apRes.thrustScale;
      autoBrake = apRes.brake;

      if (apRes.steerDir) {
        steerTowardsDir(apRes.steerDir, dtReal, apRes.steerMaxTurn);
      }

      // 执行自动飞控推力或引力积分
      if (autoBrake) {
        probe.brake(dtSim);
        probe.thrustOn = true;
        probe.step(dtReal, { fwd: false, bwd: false, left: false, right: false, up: false, down: false }, 0, dtSim);
      } else if (autoFwdThrust) {
        probe.thrustOn = true;
        probe.step(dtReal, { fwd: true, bwd: false, left: false, right: false, up: false, down: false }, autoThrustScale, dtSim);
      } else {
        probe.thrustOn = false;
        probe.step(dtReal, { fwd: false, bwd: false, left: false, right: false, up: false, down: false }, 0, dtSim);
      }

      // 自动时间倍率：真实物理速度的节奏引擎
      timeWarp.autoTick({
        selected,
        probePos: probe.pos,
        probeSpeedWorldPerS: probe.speedWorldPerS(),
        dominantWell: probe.dominantWell,
        lastParkDist,
        worldRadius: curWorld.worldRadius,
        timeScaleMax: curWorld.timeScaleMax || 3.15576e18,
      }, clock);
    }

    // 数值守卫：手动/自动两条物理路径任一产生 NaN/Inf 时回滚本帧状态并
    // 停推（推力指令残留会把 NaN 重新引入），防止污染相机与渲染管线
    if (!Number.isFinite(probe.pos[0] + probe.pos[1] + probe.pos[2] +
      probe.vel[0] + probe.vel[1] + probe.vel[2])) {
      probe.pos = posSnap.slice() as Vec3;
      probe.vel = velSnap.slice() as Vec3;
      probe.thrustOn = false;
      toastMsg('数值异常 · 已回滚本帧状态');
    }

    // 飞船模型可见性与位姿同步（上帝视角下无论休眠视角是哪种都保持可见）
    ship.visible = controlMode === MODE_GOD || chaseCam.mode !== 'cockpit';
    if (ship.visible) {
      syncShipPose(ship, shipMarker, {
        probePos: probe.pos,
        probeForward: probe.forward(),
        probeRight: probe.right(),
        probeUp: probe.up(),
        kmPerUnit: curWorld?.kmPerUnit ?? 0,
        cam: engine.camera,
        viewportHeight: canvas.clientHeight,
        chaseCamMode: chaseCam.mode,
      });
      updateShipFlame(ship, probe.thrustOn ? 1 : 0, isBoosting);
    } else {
      shipMarker.visible = false; // 座舱视角：船体与标记一并隐藏
    }

    // 星尘流：真实宇宙的速度感来源（上帝视角相机速度口径不同，隐藏）
    if (controlMode === MODE_GOD || !curWorld) {
      dust.lines.visible = false;
    } else {
      dust.update(
        [engine.camera.position.x, engine.camera.position.y, engine.camera.position.z],
        probe.vel, dtSim, clock.rate,
        chaseCam.followDist * 40, curWorld.worldRadius * 0.5,
      );
    }
    // 座舱框：仅飞船座舱视角显示（上帝视角下休眠座舱不显示）
    ui.setCockpitFrame(controlMode !== MODE_GOD && chaseCam.mode === 'cockpit');

    // 自动 LOD 尺度跃迁检测
    nav.checkAutoTransition(dtReal);

    // 层界提示：飞船越过层半径 60% 后提示继续向外将浮升上一层（每层一次，
    // 换层重置）——六层宇宙（太阳系→星际→银河系→本星系群→宇宙网→可观测
    // 宇宙）靠「飞出层界自动浮升 / 飞近天体自动下潜」穿越，不给提示玩家
    // 容易一直困在太阳系里不知道往哪飞
    if (!edgeHintShown && nav.idx < LAYER_CHAIN.length - 1) {
      const rCenter = Math.hypot(probe.pos[0], probe.pos[1], probe.pos[2]);
      if (rCenter > curWorld.worldRadius * 0.6 && rCenter < curWorld.worldRadius * 0.85) {
        const nextId = LAYER_CHAIN[nav.idx + 1];
        edgeHintShown = true;
        toastMsg(`接近层界 · 继续向外将浮升至「${WORLD_BY_ID[nextId].name}」`, 6);
      }
    }
    // 任务链与引力弹弓测速推进
    const sun = curWorld.entities.find((e) => e.id === 'sun');
    missionManager.tick({
      layerId: curWorld.id,
      layerIdx: nav.idx,
      selected,
      navBranch: (navDbg?.branch as string) ?? null,
      probePos: probe.pos,
      probeSpeedKmS: probe.speedKmS(),
      dominantWellRefId: probe.dominantWell && probe.dominantWell.ref ? probe.dominantWell.ref.id : null,
      sunPos: sun ? sun.pos : null,
    });

    // 天体自转公转动力学推进
    clock.advance(dtReal);
    simulate(dtReal, dtSim);

    // 准星与拾取更新
    picker.updateHover(engine.camera, curWorld.entities, probe.pos, chaseCam.followDist);
    hoveredId = picker.hoveredId;
    const cross = document.getElementById('crosshair');
    if (cross) cross.classList.toggle('lock', !!hoveredId);

    // ==========================================
    // HUD 真实天文物理仪表盘
    // ==========================================
    const viewName = controlMode === MODE_GOD ? '上帝视角' : (VIEW_NAMES[chaseCam.mode] || '');
    const godSpeed = controlMode === MODE_GOD ? ` · 移速 ${freeCam.speed.toPrecision(2)} u/s` : '';
    const nowSec = performance.now() / 1000;
    const hudData = presentHud({
      probePos: probe.pos,
      probeVel: probe.vel,
      speedKmS: probe.speedKmS(),
      dominantWell: probe.dominantWell,
      selected,
      hoveredEntity: hoveredId ? curWorld.entities.find((e) => e.id === hoveredId) ?? null : null,
      kmPerUnit: curWorld.kmPerUnit,
      flightStatus,
      viewName,
      godSpeed,
      crashEventName: probe.crashEvent?.name ?? null,
      isRecentlyCrashed: !!probe.crashEvent && nowSec - probe.lastCrashTime < 4.0,
      tourStatusPrefix: tourCtrl.active ? tourCtrl.formatStatus() : '',
    });
    ui.setHud(hudData);

    // 泊车边沿：进圈一次性的泊车音 + 新发现收集（同一目标只记一次）
    const parked = navDbg ? (navDbg.branch === 'rendezvous' || navDbg.branch === 'station') : false;
    missionManager.handleParkedEdge(parked, selected);

    // 撞毁边沿：爆响 + 红闪 + 震屏
    if (probe.lastCrashTime !== prevCrashTime) {
      prevCrashTime = probe.lastCrashTime;
      if (probe.lastCrashTime > 0) {
        sfx.crash();
        crashShakeT = 0.6;
        document.body.classList.add('danger');
        setTimeout(() => document.body.classList.remove('danger'), 700);
      }
    }


    // 深空环境事件：太阳系层调度流星雨/彗星群，尺度随跟拍距离
    spaceEvents.update(
      dtReal,
      engine.camera.position,
      Math.max(chaseCam.followDist * 12, curWorld.viewDist * 0.05),
      curWorld.id === 'solar',
    );

    // 引擎音随推力/加力平滑变化，并叠一层随速度升高的频率感
    // （撞毁后 probe 已 thrustOn=false 自然静音）
    sfx.setEngine(
      probe.thrustOn && !clock.paused ? (isBoosting ? 1 : 0.55) : 0,
      isBoosting,
      curWorld.maxSpeedWorldPerS > 0
        ? Math.min(1, probe.speedWorldPerS() / curWorld.maxSpeedWorldPerS)
        : 0,
    );

    let rateLabel = clock.paused
      ? '已暂停'
      : (timeWarp.mode === 'auto' ? clock.rateLabel() : (timeWarp.currentLabel || `×${clock.rate}`));
    if (!clock.paused) rateLabel += timeWarp.mode === 'auto' ? ' · 自动' : ' · 手动';
    ui.setTimeHud({ clockLabel: clock.timeLabel(), rateLabel });
  }

  // 上帝视角下相机由 FreeCam 全权控制，跳过追尾相机更新
  if (controlMode !== MODE_GOD) {
    chaseCam.update(dtReal, a.boost && probe.thrustOn);
  }
  // 撞毁震屏：随机偏移随剩余时间衰减，幅度按跟拍距离缩放（层尺度无关）
  if (crashShakeT > 0) {
    crashShakeT = Math.max(0, crashShakeT - dtReal);
    if (!settings.shake) return;
    const s = crashShakeT * chaseCam.followDist * 0.12;
    engine.camera.position.x += (Math.random() - 0.5) * s;
    engine.camera.position.y += (Math.random() - 0.5) * s;
    engine.camera.position.z += (Math.random() - 0.5) * s;
  }
  trailRibbon.update(probe);

  if (curWorld) {
    updateLabelFades(curWorld.group, engine.camera, curWorld.labelFadeDist || curWorld.viewDist * 1.6);
  }

  // 动态近裁剪面：真实尺度船 + 贴身视距要求 near 随视距缩放
  updateDynamicNearPlane(engine.camera, controlMode, chaseCam.mode, chaseCam.followDist, curWorld);
  engine.render(dtReal);
}

// 点击天体拾取目标（左键拖拽环视后的松手不算点击——拖拽超过 5px 即抑制，
// 防止「拖一圈看风景」误锁目标触发自动泊车）
canvas.addEventListener('click', (ev) => {
  if (input.dragged) { input.dragged = false; return; }
  if (!curWorld) return;
  let hit: Entity | null;
  const maxDist = picker.pickMaxDist(engine.camera, probe.pos, chaseCam.followDist);
  if (input.pointerLocked) {
    const { o, d } = picker.cameraRay(engine.camera, 0, 0);
    hit = picker.pick(o, d, curWorld.entities, maxDist);
  } else {
    const rect = canvas.getBoundingClientRect();
    const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const { o, d } = picker.cameraRay(engine.camera, nx, ny);
    hit = picker.pick(o, d, curWorld.entities, maxDist);
  }
  if (hit) {
    // 用户点击其他天体 = 改选目标，终止大巡游（点击巡游当前站目标不受影响）
    if (tourCtrl.active && hit !== selected) tourCtrl.stop('已改选目标 · 巡游结束');
    selectEntity(hit);
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
    const err = e as Error;
    console.error(err);
    document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;z-index:99999;color:#fff;background:#a00;font-size:12px;padding:10px;max-width:90vw;overflow:auto">${err.stack || err.message}</pre>`);
  }
  ui.hideLoading();
  const loop = (now: number): void => { renderFrame(now); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

// （窗口 resize 由 engine 构造函数内注册的监听统一处理）

// 全局调试挂载
window.__universe = { engine, probe, clock, nav, ui, input, chaseCam, ship, shipMarker, dust, sfx, MISSIONS, events: spaceEvents,
  missionManager,
  get discovered() { return missionManager.discovered; },
  get crashShake() { return crashShakeT; },
  get renderedFrames() { return renderedFrames; },
  get world() { return nav.world; },
  get selected() { return selected; },
  get tour() { return tourCtrl.state; },
  get dbg() { return navDbg; },
  get controlMode() { return controlMode; },
  get pauseMenuOpen() { return uiState.current === 'pause-menu'; },
  get victoryOpen() { return uiState.current === 'victory'; },
  get flightSeconds() { return flightSeconds; },
  select(id: string): boolean {
    const e = nav.world?.entities.find((x) => x.id === id);
    if (e) selectEntity(e);
    return !!e;
  },
  // 测试用：直接设置任务进度（后期任务的无头验证入口）；设到满环即
  // 触发通关结算（与真实通关同一庆典路径）
  setMission(i: number): boolean {
    const was = missionManager.missionIdx;
    const ok = missionManager.setMission(i);
    if (ok && i === MISSIONS.length && was < MISSIONS.length) {
      setTimeout(showVictoryScreen, 200);
    }
    return ok;
  },
  openPauseMenu,
  closePauseMenu,
  showVictoryScreen,
  closeVictory,
  startTour(world?: { tourStops?: string[]; entities: Entity[] }): void {
    if (curWorld) tourCtrl.start(world || curWorld);
  },
  stopTour(msg?: string): void {
    tourCtrl.stop(msg);
  },
};

boot();
