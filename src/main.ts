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
import { SoundFX } from './core/audio.js';
import { Probe } from './core/probe.js';
import { SimClock } from './core/clock.js';
import { Navigator } from './core/navigator.js';
import { UI } from './ui/controller.js';
import { LAYER_CHAIN } from './content/worlds.js';
import { WORLD_BY_ID } from './content/schema.js';
// 世界模块（副作用自注册）
import './content/world-solar.js';
import './content/world-stellar.js';
import './content/world-galaxy.js';
import './content/world-local.js';
import './content/world-super.js';
import './content/world-cosmos.js';
import { formatKm, lightTravelText, unitRulerText, C_KM_S } from './util/units.js';
import type { Entity, GameWorld, LayerId, Vec3 } from './types.js';
import type { GamepadState } from './core/input.js';
import type { GravityWell } from './types.js';
import { ChaseCam, VIEW_NAMES } from './render/camera.js';
import { FreeCam } from './render/freecam.js';
import { updateLabelFades } from './render/labels.js';
import { TrailRibbon } from './render/trail.js';
import { makeShip, updateShipFlame } from './render/ship.js';
import { SpaceEvents } from './render/events.js';

// 时间倍率阶梯（[ ] 键步进切换）。真实物理口径下飞船速度远低于光速，
// 从行星际到宇宙网的航行节奏全部由时间倍率承担（AUTO 自动管理，见 autoWarpTick）：
// 太阳系用天/年级档位，星系/宇宙网尺度需要亿年/千亿年级档位
const TIME_RATES = [1, 60, 3600, 21600, 86400, 604800, 2629800, 31557600, 315576000, 3155760000, 31557600000,
  3.15576e11, 3.15576e13, 3.15576e15, 3.15576e17, 3.15576e18];
const TIME_RATE_LABELS = ['实时', '1分/秒', '1时/秒', '6时/秒', '1天/秒', '1周/秒', '1月/秒', '1年/秒', '10年/秒', '100年/秒', '千年/秒',
  '万年/秒', '百万年/秒', '亿年/秒', '百亿年/秒', '千亿年/秒'];
// 手动接管的时间倍率上限：高倍率下按住推进键会在一帧内获得超光速 Δv
//（数值爆炸触发回滚），手动机动只需近景精度，钳到「1时/秒」档；
// 松手后 autoWarpTick 按配速公式自动恢复高倍率，跨层航行不受影响
const MANUAL_MAX_RATE = 3600;

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

// 飞船 3D 模型
const ship = makeShip();
engine.scene.add(ship);
const _m4 = new THREE.Matrix4();
const _ndc = new THREE.Vector3();

const input = new Input(canvas);
const sfx = new SoundFX();
// 用户设置（音量/震屏）：localStorage 持久化，缺失用默认值
const SETTINGS_KEY = 'universe-roam-settings';
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      volume: Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 0.5,
      shake: s.shake !== false,
    };
  } catch { return { volume: 0.5, shake: true }; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 忽略 */ }
}
const settings = loadSettings();
sfx.volume = settings.volume;
// 音频需用户手势后才能启动：任意按键/点击时初始化或恢复（标题画面的
// 「开始航行」是标准入口——真实点击手势，音频随之解锁）
window.addEventListener('keydown', () => sfx.ensure());
window.addEventListener('mousedown', () => sfx.ensure());
const freeCam = new FreeCam(engine.camera);
let curTimeIdx = 0;

// 控制模式状态机
const MODE_AUTO = 'auto'; // 全自动飞行（默认）
const MODE_MANUAL = 'manual'; // 人工干预（按住飞行键期间）
const MODE_GOD = 'god'; // 上帝视角（相机脱离飞船，飞船继续自动飞）
let controlMode = MODE_AUTO;

let curWorld: GameWorld | null = null;
let selected: Entity | null = null; // 当前选中的目标天体
let rendMode = false; // 交会模式滞回：2.5 泊距进入、3.5 泊距退出（防边界抖动）
let navDbg: Record<string, unknown> | null = null; // 自动导航诊断快照（__universe.dbg 暴露，无头验证用）
let hoveredId: string | null = null;
let warpMode = 'auto'; // 自动时间倍率：'auto'（按 ETA 自选档）| 'user'（用户 [ ] 接管）
let prevManual = false; // 上一帧是否人工干预（进入干预的边沿用于钳制倍率）
let missionIdx = 0; // 当前主线任务下标（MISSIONS 线性推进）
const discovered = new Set<string>(); // 已泊入发现的天体（收集玩法，localStorage 持久化）
const PROGRESS_KEY = 'universe-roam-progress';
// 启动时恢复进度（任务下标 + 发现列表）；格式变更/损坏则静默用默认值
try {
  const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
  if (saved && Number.isInteger(saved.missionIdx) && saved.missionIdx >= 0 && saved.missionIdx <= MISSIONS.length) {
    missionIdx = saved.missionIdx;
  }
  if (saved && Array.isArray(saved.discovered)) saved.discovered.forEach((id: string) => discovered.add(id));
} catch { /* 隐私模式等存储不可用：忽略，进度仅会话内有效 */ }
function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ missionIdx, discovered: [...discovered] }));
  } catch { /* 存储不可用：忽略 */ }
}
let prevParked = false; // 上一帧是否处于伴飞/悬停泊车态（边沿触发泊车音与新发现）
let prevCrashTime = 0; // 最近一次撞毁时间戳（边沿触发撞毁音效与红闪）
let crashShakeT = 0; // 撞毁震屏剩余时长（秒，随时间衰减的随机相机偏移）
let prevM = false; // M 键上一帧状态（静音切换边沿）
let slingWellId: string | null = null; // 引力弹弓计速：当前主导井实体 id
let slingVEntry = 0; // 入井速度（km/s）
let slingVPeak = 0; // 井内速度峰值（km/s）
let everLeft = false; // 是否曾离开太阳系层（「回到家园」任务判定用）
let edgeHintShown = false; // 层界浮升提示每层只提示一次（换层重置）

function clearSelection(): void {
  selected = null;
  ui.hideInfo();
}

// 选中目标（统一入口）：信息卡 + 跟拍视距随目标真实半径缩放 + 恢复自动倍率
function selectEntity(e: Entity): void {
  selected = e;
  rendMode = false; // 新目标从巡航拦截重新开始
  ui.showInfo(e);
  warpMode = 'auto';
  if (curWorld && e.pickRadius > 0) {
    const base = curWorld.shipViewDist || 0.35;
    chaseCam.followDist = Math.min(
      Math.max(e.pickRadius * 14, base * 0.3),
      Math.max(curWorld.worldRadius * 0.02, base * 0.3),
    );
  }
}

// ==========================================================
// 大巡游模式（T 键）：按各层预设站点自动串联巡游——
// 到站泊车伴飞 → 停留观赏 → 下一站，循环往复；任何手动飞行干预
// 或用户改选目标即终止巡游（观察类操作与上帝视角不受影响）
// ==========================================================
const TOUR_DWELL_S = 12; // 每站停留时长（真实秒）
const TOUR_ARRIVE_S = 1.2; // 进入泊位圈持续该时长判定到站
interface TourState { stops: Entity[]; idx: number; phase: 'enroute' | 'dwell'; dwellLeft: number; nearS: number }
let tour: TourState | null = null; // 大巡游状态
let lastParkDist = 0; // 自动导航最近一帧计算的泊距（到站判定基准）
function toastMsg(text: string, secs = 4): void {
  ui.toast(text, secs);
}

function startTour(): void {
  if (tour) { stopTour('巡游结束'); return; }
  const stops = (curWorld?.tourStops || [])
    .map((id: string) => curWorld!.entities.find((e) => e.id === id))
    .filter((e): e is Entity => !!e);
  if (stops.length < 2) { toastMsg('此尺度层没有巡游路线'); return; }
  tour = { stops, idx: 0, phase: 'enroute', dwellLeft: 0, nearS: 0 };
  selectEntity(stops[0]);
}

function stopTour(msg?: string): void {
  if (!tour) return;
  tour = null;
  if (msg) toastMsg(msg);
}

function tourNextStop(): void {
  if (!tour) return;
  tour.idx = (tour.idx + 1) % tour.stops.length;
  tour.phase = 'enroute';
  tour.nearS = 0;
  selectEntity(tour.stops[tour.idx]);
}

// 每帧推进巡游状态机（仅在 AUTO 自动分支调用；到站判定复用自动导航泊距）
function updateTour(dtReal: number): void {
  if (!tour || !selected || !curWorld) return;
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

// 设置面板：音量滑条/震屏开关实时生效并持久化；O 键或标题画面⚙打开
function openSettings() {
  ui.showSettings({
    volume: Math.round(settings.volume * 100),
    shake: settings.shake,
    onVolume: (v) => { settings.volume = v / 100; sfx.setVolume(settings.volume); saveSettings(); },
    onShake: (on) => { settings.shake = on; saveSettings(); },
    onClose: () => ui.hideSettings(),
  });
}
// 标题画面：有存档显示继续/重开；按钮点击（真实手势）同时解锁音频。
// 「开始航行」「继续航行」只是收起画面——游戏在背后以吸引模式运行；
// 「重新开始」清空进度并重载页面。存档概览读取抽成函数，游戏中
// 「回到标题」（暂停菜单）复用同一入口刷新进度
function titleProgressSnapshot() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
    const idx = saved && Number.isInteger(saved.missionIdx) ? saved.missionIdx : 0;
    const disc = saved && Array.isArray(saved.discovered) ? saved.discovered.length : 0;
    return {
      hasProgress: idx > 0,
      progressText: idx > 0 ? `任务进度 ${idx}/12 · 已发现 ${disc} 个天体` : '',
    };
  } catch { return { hasProgress: false, progressText: '' }; }
}
ui.setupTitleScreen({
  onStart: () => sfx.ensure(),
  onContinue: () => sfx.ensure(),
  onReset: () => {
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* 忽略 */ }
    location.reload();
  },
  onOpenSettings: () => openSettings(),
});
ui.showTitleScreen(titleProgressSnapshot());

// ==========================================================
// 覆盖层状态机：暂停菜单（Esc/手柄 Start）+ 通关结算 + 标题画面
// 打开即冻结时钟（记录此前暂停态，关闭时恢复）；打开期间所有游戏
// 按键统一失效（renderFrame 每帧 keys.clear，Esc 在清理前单独消费）
// ==========================================================
let pauseMenuOpen = false;
let victoryOpen = false;
let pausedBeforeOverlay = false; // 覆盖层打开前的时钟暂停态（关闭恢复，保留 \ 键暂停语义）
let flightSeconds = 0; // 本次航行累计墙上秒（暂停/覆盖层不计；通关结算展示）
let prevEsc = false; // Esc 键上一帧状态（开关边沿）
let menuFocusIdx = 0; // 手柄 dpad 焦点位置（暂停菜单按钮下标）
let prevGpUp = false, prevGpDown = false, prevGpConfirm = false, prevGpBack = false;

// 标题/暂停菜单/结算任一可见即视为覆盖层态（游戏冻结、输入隔离）
function overlayActive() {
  return pauseMenuOpen || victoryOpen
    || !ui.el['title-screen'].classList.contains('hidden');
}

function openPauseMenu() {
  if (pauseMenuOpen || victoryOpen) return;
  pauseMenuOpen = true;
  pausedBeforeOverlay = clock.paused;
  clock.paused = true;
  if (document.pointerLockElement) document.exitPointerLock(); // 释放鼠标点菜单
  input.keys.clear();
  menuFocusIdx = 0;
  ui.showPauseMenu();
}
function closePauseMenu() {
  if (!pauseMenuOpen) return;
  pauseMenuOpen = false;
  ui.hidePauseMenu();
  clock.paused = pausedBeforeOverlay;
}
// 回到标题：恢复时钟（吸引模式在背景继续跑），刷新存档概览并显示标题层
function backToTitle() {
  closePauseMenu();
  ui.showTitleScreen(titleProgressSnapshot());
}
// 通关结算：一次性庆典（存档恢复到满环不重弹）
function showVictoryScreen() {
  if (victoryOpen || pauseMenuOpen) return;
  victoryOpen = true;
  pausedBeforeOverlay = clock.paused;
  clock.paused = true;
  if (document.pointerLockElement) document.exitPointerLock();
  input.keys.clear();
  const moons = [...discovered].filter((id) => MOON_IDS.has(id)).length;
  const mm = String(Math.floor(flightSeconds / 60)).padStart(2, '0');
  const ss = String(Math.floor(flightSeconds % 60)).padStart(2, '0');
  ui.showVictory([
    ['任务链', `${MISSIONS.length} / ${MISSIONS.length}`],
    ['发现天体', `${discovered.size}`],
    ['卫星巡礼', `${moons} / ${MOON_IDS.size}`],
    ['航行时长', `${mm}:${ss}`],
  ] as [string, string][]);
  sfx.victory();
}
function closeVictory() {
  if (!victoryOpen) return;
  victoryOpen = false;
  ui.hideVictory();
  clock.paused = pausedBeforeOverlay;
}
ui.setupPauseMenu({
  onResume: () => closePauseMenu(),
  onSettings: () => openSettings(),
  onTitle: () => backToTitle(),
});
ui.setupVictory(() => closeVictory());
// 手柄覆盖层导航：dpad 上下移动焦点、A 确认、B 返回（主机菜单惯例）
function gamepadMenuNav(gp: GamepadState): void {
  if (victoryOpen) {
    if (gp.confirm && !prevGpConfirm) closeVictory();
  } else if (pauseMenuOpen) {
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
nav.onBeforeWorldChange = () => {
  stopTour(); // 巡游路线按层定义，跨层即失效
  clearSelection();
  if (controlMode === MODE_GOD) exitGodMode();
  ui.fadeOut(); // 标准场景过渡：黑场遮住世界重建，落点后淡入
};

nav.onWorldChanged = (world, idx) => {
  curWorld = world;
  warpMode = 'auto'; // 换层恢复自动时间倍率
  edgeHintShown = false; // 新层重新允许层界提示
  engine.loadWorld(world, world.group, []);
  ui.setCrumb(idx);
  ui.setScaleHud(`${world.title} · 1单位≈${unitRulerText(world.unitName)}`);
  ui.showLayerIntro(world.intro ?? ''); // 层教学文案横幅（各层 build 时声明）
  ui.fadeIn(); // 转场淡入：世界就绪后从黑场回到画面
  sfx.warp(); // 跨层跃迁扫频
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

function steerTowards(tpos: Vec3, dtReal: number, maxTurn = 1.2): void {
  steerTowardsDir([tpos[0] - probe.pos[0], tpos[1] - probe.pos[1], tpos[2] - probe.pos[2]], dtReal, maxTurn);
}

// ============ 自动时间倍率：真实物理飞行的节奏引擎 ============
// 物理速度真实后（<光速），跨行星航行靠时间倍率承担节奏：
// - 朝目标接近中：按「剩余距离指数收敛、墙上时间常数 ≈8 秒」配速
//   （制动能量曲线 v∝√d 下全程 ≈8s×ln(d0/d泊位)≈1 分钟量级），到站
//   低倍率观赏；
// - 无目标伴飞/巡航：按主导井「1/60 轨道周期/墙上秒」配速；
// - 惯性层：实时；
// - 用户按 [ ] 手动设置后挂起（warpMode='user'），重选目标/换层恢复。
const WARP_ETA_S = 8;
function autoWarpTick(): void {
  if (warpMode !== 'auto' || clock.paused || !curWorld) return;
  let target = 0; // 哨兵：0 = 尚未确定（由选中目标 ETA 或井配速填充）
  if (selected && curWorld.entities.includes(selected)) {
    const d = dist3(probe.pos, selected.pos);
    const v = probe.speedWorldPerS();
    // 有目标统一按 ETA 配速（用总速度而非接近分量——转向/制动的瞬间
    // 接近分量过零，若交给井配速会形成高倍率背离腿的极限环）
    if (v > 1e-14) target = d / (v * WARP_ETA_S);
  }
  if (target === 0) {
    const well = probe.dominantWell;
    if (well && well.GM > 0) {
      const c = (well.ref ? well.ref.pos : well.center)!;
      const r = Math.hypot(probe.pos[0] - c[0], probe.pos[1] - c[1], probe.pos[2] - c[2]) || 1e-12;
      const vCirc = Math.sqrt(well.GM / r);
      target = r / (vCirc * 60); // 轨道周期 pacing：60 墙上秒看 1/60 圈
    } else {
      target = 1; // 无井层：实时
    }
  }
  // 泊位邻域收尾配速：伴飞/悬停段按「到目标 ETA≈2.5 墙上秒」自适应降档
  //（下限 60×），保证近景观赏与推力微调精度。原实现是绝对 1时/秒——
  // 泊距按拾取半径计算，星际层泊距 ~2.8 ly、3 倍邻域罩住近 1/4 层，
  // 把跨光年接近钉死在万年尺度，自动导航实质不可用；ETA 配速任意尺度
  // 自适应：远处不限制速、近处随剩余距离平滑收敛
  if (lastParkDist > 0 && selected) {
    const dSel = dist3(probe.pos, selected.pos);
    const vNow = probe.speedWorldPerS();
    if (dSel < lastParkDist * 3 && vNow > 1e-14) {
      target = Math.min(target, Math.max(60, dSel / (vNow * 2.5)));
    }
  }
  // 物理硬包线：接近中速度/视线角波动会让 ETA 公式瞬时爆表，必须约束
  // 单帧位移 ≤2% 剩余距离（防瞬移越过目标）——帧内 Δv=acc×dtSim 是
  // 高倍率快进的连续物理推演而非推力瞬跳（矢量制导 τ 已自适应帧长），
  // 不再另设 Δv 包线（绝对值上限会把星系/宇宙网层的配速钳死不可玩）
  if (selected) {
    const dSel = dist3(probe.pos, selected.pos);
    const vNow = probe.speedWorldPerS();
    if (vNow > 1e-14) target = Math.min(target, dSel * 0.02 / (vNow * 0.016));
  }
  // 连续倍率（不吸附档位）：ETA 恒定 ≈25 墙上秒，制动曲线全程平滑变速；
  // curTimeIdx 同步到最近档位供 [ ] 步进起点
  // 普适位移包线：每墙秒位移 ≤5% 层半径。无目标的井配速 r/(vCirc×60)
  // 对径向逃离存在正反馈（r 涨→rate 涨→位移涨→r 更快涨），船会在数十
  // 墙秒内指数式飞出层触发连环浮升——包线只切断失控，正常泊车配速
  //（远低于此）不受影响
  if (curWorld.worldRadius > 0) {
    const vCap = probe.speedWorldPerS();
    if (vCap > 1e-14) target = Math.min(target, curWorld.worldRadius * 0.05 / (vCap * 0.016));
  }
  // 层级上限：timeScaleMax 是每层的合理倍率顶（navigator 换层同款钳制）
  // ——真实 GM 的远场井 vCirc≈0，井配速公式会给出无界倍率，必须兜住
  const rate = Math.min(Math.max(target, 1), curWorld.timeScaleMax || TIME_RATES[TIME_RATES.length - 1]);
  let best = 0;
  for (let i = 0; i < TIME_RATES.length; i++) {
    if (Math.abs(TIME_RATES[i] - rate) < Math.abs(TIME_RATES[best] - rate)) best = i;
  }
  curTimeIdx = best;
  if (Math.abs(clock.rate - rate) > rate * 0.02) clock.setRate(rate);
}

function simulate(dtReal: number, dtSim: number): void {
  if (!curWorld || !curWorld.update) return;
  curWorld.update(dtSim, clock, probe, dtReal);
}

function pickObject(rayOrigin: Vec3, rayDir: Vec3, maxDist: number): Entity | null {
  if (!curWorld) return null;
  let best = null; let bestD = maxDist;
  for (const e of curWorld.entities) {
    if (!e.pickRadius || e.selectable === false) continue;
    // 真实尺度点选：远处天体角直径过小，按 ~0.5° 视角下限放大可点选半径
    //（泊车/碰撞/引力仍用实体真实半径，仅拾取口径放大）
    const dCam = Math.hypot(e.pos[0] - rayOrigin[0], e.pos[1] - rayOrigin[1], e.pos[2] - rayOrigin[2]);
    const rEff = Math.max(e.pickRadius, dCam * 0.0087);
    const d = rayDist(rayOrigin, rayDir, e.pos, rEff);
    if (d >= 0 && d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function rayDist(o: Vec3, dir: Vec3, c: Vec3, r: number): number {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t = -b - sq;
  return t >= 0 ? t : -b + sq >= 0 ? -b + sq : -1;
}

function dist3(a: Vec3, b: Vec3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

function cameraRay(ndcX: number, ndcY: number): { o: Vec3; d: Vec3 } {
  _ndc.set(ndcX, ndcY, 0.5).unproject(engine.camera);
  const o = engine.camera.position;
  const dx = _ndc.x - o.x, dy = _ndc.y - o.y, dz = _ndc.z - o.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  return { o: [o.x, o.y, o.z], d: [dx / l, dy / l, dz / l] };
}

function pickMaxDist(): number {
  const cp = engine.camera.position;
  const dCam = Math.hypot(cp.x - probe.pos[0], cp.y - probe.pos[1], cp.z - probe.pos[2]);
  return Math.max(dCam + chaseCam.followDist * 4, 1000);
}

function updateHover(): void {
  if (!curWorld) return;
  const { o, d } = cameraRay(0, 0);
  const hit = pickObject(o, d, pickMaxDist());
  hoveredId = hit ? hit.id : null;
  const cross = document.getElementById('crosshair');
  if (cross) cross.classList.toggle('lock', !!hit);
}

// 飞船位姿同步
function syncShip(): void {
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

function renderFrame(now: number): void {
  const dtReal = Math.min(0.05, (now - lastFrame) / 1000);
  // 模拟时间增量：飞船位置动力学（引力+推进）与天体运动共用同一口径，
  // 时间倍率承担航行节奏（物理始终真实，倍率只放大时间流速）
  const dtSim = clock.paused ? 0 : dtReal * clock.rate;
  if (!clock.paused) flightSeconds += dtReal; // 航程墙上时（暂停/覆盖层不计）
  lastFrame = now;
  const steer = input.poll();
  const a = input.actions;
  // 手柄合并：摇杆/扳机与键盘同管线（有任一输入即构成人工干预）；
  // 覆盖层（标题/暂停菜单/结算）打开时手柄只用于菜单导航与 Start 开关
  let gpBrake = false, gpThrust = false;
  const gp = input.pollGamepad(dtReal);
  if (gp) {
    if (gp.pause && !prevGpPause && !victoryOpen) {
      if (pauseMenuOpen) closePauseMenu();
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
    else if (victoryOpen) closeVictory();
    else if (!overlayActive()) openPauseMenu();
    else if (pauseMenuOpen) closePauseMenu();
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
    if (curTimeIdx > 0) {
      curTimeIdx--;
      clock.setRate(TIME_RATES[curTimeIdx]);
      clock.paused = false;
      warpMode = 'user';
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
      warpMode = 'user';
    }
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
    if (isIntervening && !prevManual && clock.rate > MANUAL_MAX_RATE) {
      clock.setRate(MANUAL_MAX_RATE);
      let best = 0;
      for (let i = 0; i < TIME_RATES.length; i++) {
        if (Math.abs(TIME_RATES[i] - MANUAL_MAX_RATE) < Math.abs(TIME_RATES[best] - MANUAL_MAX_RATE)) best = i;
      }
      curTimeIdx = best;
      toastMsg(`手动接管 · 倍率暂降至 ${TIME_RATE_LABELS[curTimeIdx]}（松手恢复自动）`);
    }
    prevManual = isIntervening;

    let autoFwdThrust = false;
    // 自动飞控的转向速率按模拟时间轴对齐：推力沿机头方向在模拟时间轴上
    // 积分，高倍率下若转向仍按真实秒进行，机头方向会严重滞后于制导指令
    //（推力画圈不接近），因此自动转向速率随倍率同步提速；手动分支不受影响
    const autoTurn = (base: number) => base * Math.max(1, clock.rate / 60);
    let autoThrustScale = 1.0;
    let autoBrake = false;
    let flightStatus = '';

    if (isIntervening) {
      // 玩家主动进行「飞行操控类」干预：手动接管即终止大巡游。
      // 目标锁定在手动飞行期间保持——玩家手动贴近日标后松手，自动导航
      // 从当前位置无缝接手（低轨信使等贴身挑战依赖此语义）；取消锁定
      // 用信息卡关闭按钮
      stopTour('手动接管 · 巡游结束');

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
          const offYaw = chaseCam.orbitYaw, offPitch = chaseCam.orbitPitch;
          if (offYaw !== 0 || offPitch !== 0) {
            // 相机相对转向（操纵杆模式）：环视偏移 = 转动速率指令——
            // 鼠标右移（yaw 偏移为负）→ 右转、下拉（pitch 偏移为正）→ 低头。
            // 偏移随 recenter 指数回零，转速同步衰减归停，总转角有界。
            // 此前实现有两个坑：直接导向 camDir 会与「相机锚定机尾」形成
            // 正反馈棘轮（按住 W 一路俯冲到俯仰极限）；把偏移当绝对目标
            // 航向则会被机头以最大角速度追吃，0.3 rad 偏移转出 ~2.9 rad
            const TURN_GAIN = 2.0; // 满偏移 1 rad ≈ 2 rad/s 转速
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
            const c = (w.ref ? w.ref.pos : w.center)!;
            const r = dist3(targetPos, c) || 1e-6;
            gOther = Math.max(gOther, w.GM / (r * r));
          }
          const maxOrbitD = Math.sqrt(ownWell.GM / (2 * gOther));
          safeParkDistance = Math.max(targetRadius * 1.8, Math.min(safeParkDistance, maxOrbitD));
          // 引力超出推力的天体（如太阳）：泊位外推到 g≈0.6×推力半径——
          // 深处引力数倍于推力，圆化速度高、径向扰动猛，伴飞无法稳定
          safeParkDistance = Math.max(safeParkDistance, Math.sqrt(ownWell.GM / (acc * 0.6)));
        }
        lastParkDist = safeParkDistance; // 供大巡游到站判定复用

        // 最强井（按引力加速度而非井心距离——行星泊位处最近的是行星井，
        // 最强的可能是太阳井），供安全包线与驻点方案使用
        let well: GravityWell | null = null;
        let wellC: Vec3 | null = null;
        let wellG = 0;
        for (const w of wells) {
          const c = (w.ref ? w.ref.pos : w.center)!;
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

        // 目标本体方向单位向量（接近剖面/伴飞/斥力均相对目标本体——
        // 拦截前置由「期望速度 = 目标速度矢量 + 接近剖面」的矢量合成天然
        // 提供，无需几何前置点：前置点方案在近场会把期望方向掰离目标方向，
        // 船被持续往侧向推形成绕转动量，误差方向随之旋转、推力修正互相抵消）
        const rlx = (targetPos[0] - probe.pos[0]) / dToTarget;
        const rly = (targetPos[1] - probe.pos[1]) / dToTarget;
        const rlz = (targetPos[2] - probe.pos[2]) / dToTarget;

        // 引力井安全包线（最高优先级）：向最强井俯冲时无条件全推力反井心拉起。
        // 触发按制动需求距离判定——当前向井速度需要的停止距离一旦吃掉井面余量，
        // 立即拉起（固定半径要么太晚要么误伤正常伴飞）
        let guardPull = false;
        let gwr = Infinity, vWell = 0, safeR = 0.4;
        if (well && wellC && well.GM > 0) {
          safeR = well.minR || 0.4;
          gwr = dist3(probe.pos, wellC) || 1e-6;
          vWell = ((probe.pos[0] - wellC[0]) * probe.vel[0] + (probe.pos[1] - wellC[1]) * probe.vel[1] + (probe.pos[2] - wellC[2]) * probe.vel[2]) / gwr;
          const vIn = Math.max(0, -vWell);
          // 真实推力口径：远离井心方向的制动能力 = 推力（井引力超出推力时
          // 只剩推力的一半裕量可谈），绝不用绝对常数下限——任何尺度都成立
          const aBrake = Math.max(acc * 0.5, acc - wellG);
          const need = vIn * vIn / (2 * aBrake);
          if (gwr - safeR < need + safeR * 0.5) {
            steerTowardsDir([(probe.pos[0] - wellC[0]) / gwr, (probe.pos[1] - wellC[1]) / gwr, (probe.pos[2] - wellC[2]) / gwr], dtReal, autoTurn(2.2));
            autoFwdThrust = true;
            autoThrustScale = 1.0;
            flightStatus = `防井坠毁 · 拉起 (${well.name})`;
            guardPull = true;
          }
        }

        if (!guardPull) {
          // 泊位/悬停区判定：交会模式滞回（2.5 泊距进入、3.5 泊距退出）——
          // 若按单一阈值硬切换，船在边界振荡时近场/巡航制导反复互换，
          // 期望速度矢量随之摆动，推力方向翻转成抖振
          if (station) rendMode = false;
          else if (!rendMode && dToTarget <= safeParkDistance * 2.5) rendMode = true;
          else if (rendMode && dToTarget > safeParkDistance * 3.5) rendMode = false;
          const inParkZone = station ? dToTarget <= safeParkDistance * 2 : rendMode;
          if (inParkZone) {
            // 抵达泊位/驻位区：伴飞/悬停（各分支独占转向权，防坠的反向转向
            // 若与对准转向叠加会互相抵消，机头永远调不离目标）
            if (station) {
              // 驻点悬停伴飞（第三方井主导区的背井驻点接应）：与交会/巡航段
              // 同一「期望速度矢量 + 引力前馈」结构。教学尺度遗留的全速阻尼
              //（vel×0.8 直接当加速度、pd 线性 PD）在真实尺度（vel~1e-7、
              // acc~4e-12）会饱和成反向全推，机头 180° 背逃，必须按加速度量纲合成
              const TAU = Math.max(9, 3 * dtSim);
              const px = station[0] - probe.pos[0], py = station[1] - probe.pos[1], pz = station[2] - probe.pos[2];
              const pd = Math.hypot(px, py, pz) || 1e-9;
              // 期望速度：朝驻点的 √ 制动剖面；贴近目标转斥退（防穿越天体）
              const vAppSt = dToTarget < safeParkDistance * 1.2
                ? -maxSp * 0.2
                : Math.min(Math.sqrt(2 * acc * 0.5 * pd), maxSp * 0.5);
              let ax = (px / pd * vAppSt - probe.vel[0]) / TAU;
              let ay = (py / pd * vAppSt - probe.vel[1]) / TAU;
              let az = (pz / pd * vAppSt - probe.vel[2]) / TAU;
              const wx = probe.pos[0] - wellC![0], wy = probe.pos[1] - wellC![1], wz = probe.pos[2] - wellC![2];
              const wr = Math.hypot(wx, wy, wz) || 1e-9;
              const gFeed = Math.min(well!.GM / (wr * wr), acc);
              ax += wx / wr * gFeed; ay += wy / wr * gFeed; az += wz / wr * gFeed;
              const aMag = Math.hypot(ax, ay, az);
              navDbg = { branch: 'station', rendMode, d: dToTarget, vApp: vAppSt, aMag: aMag / acc, rate: clock.rate };
              // 不设推力死区：scale=aMag/acc 连续自适应（远层自动微推、
              // 近层饱和），帧内 Δv 由 τ=3dtSim 保证 ≤误差/3，任何死区
              // 阈值在跨尺度环境都会误伤某个层的工作点
              if (aMag > 0) {
                steerTowardsDir([ax, ay, az], dtReal, autoTurn(2.2));
                autoFwdThrust = true;
                autoThrustScale = Math.min(1.0, aMag / acc);
                flightStatus = vAppSt < 0 ? `伴飞防坠 · 退避 ${selected.name}` : `安全伴飞 · 悬停 ${selected.name}`;
              } else {
                steerTowards(targetPos, dtReal, autoTurn(1.4));
                flightStatus = `安全伴飞 · ${selected.name}`;
              }
            } else {
              // ===== 交会末段：目标参考系相对速度制导（轨道交会标准做法）=====
              // 惯性系刹车/退避会把与目标公转匹配的切向速度一并刹掉——刹完即被
              // 目标甩开、追上再刹，形成「恒距尾随」共振极限环。改为直接控制
              // 相对速度：期望值 = 径向接近剖面（√制动能量，随距离归零）+ 切向
              // 分量（自身井引力超出悬停推力时取当地圆轨道速度，改为入轨伴飞），
              // 推进指令 = (vRelDes − vRel)/τ + 引力前馈（悬停段全额抵消下坠、
              // 圆轨道段按向心需求自然归零）。稳态即速度匹配伴飞，闭环无极限环。
              const vT = selected.vel || [0, 0, 0];
              const vCx = probe.vel[0] - vT[0], vCy = probe.vel[1] - vT[1], vCz = probe.vel[2] - vT[2];
              // 径向期望：制动能量剖面（半推力保守裕量），泊距内归零；
              // 真实半径 1.3 倍内转强斥退（防坠地板）
              let vApp = Math.min(
                Math.sqrt(2 * acc * 0.5 * Math.max(0, dToTarget - safeParkDistance)),
                maxSp * 0.8,
              );
              if (dToTarget < targetRadius * 1.3) vApp = -maxSp * 0.2;
              // 悬停可行性：自身井引力 ≤0.6 推力才悬停得住（地球泊位 ≈0.9×、
              // 火星 ≈0.2×、太阳 ≈4×——太阳旁只能入轨伴飞，无法驻停）
              const gOwn = ownWell && ownWell.GM > 0 ? ownWell.GM / (dToTarget * dToTarget) : 0;
              const canHover = gOwn <= acc * 0.6;
              // 切向期望沿当前相对角动量的轨道面方向（正对目标时以黄道面兜底）
              let hx = rly * vCz - rlz * vCy, hy = rlz * vCx - rlx * vCz, hz = rlx * vCy - rly * vCx;
              const hl = Math.hypot(hx, hy, hz);
              if (hl < 1e-12) { hx = 0; hy = 1; hz = 0; } else { hx /= hl; hy /= hl; hz /= hl; }
              let ttx = hy * rlz - hz * rly, tty = hz * rlx - hx * rlz, ttz = hx * rly - hy * rlx;
              const ttl = Math.hypot(ttx, tty, ttz) || 1;
              ttx /= ttl; tty /= ttl; ttz /= ttl;
              const vTanDes = canHover || gOwn <= 0 ? 0
                : Math.sqrt(ownWell!.GM / Math.max(dToTarget, targetRadius));
              // 加速度指令：相对速度误差 / τ（模拟时间轴收敛时标，近场自动倍率
              // ~10²-10³× 下每帧模拟秒数与 τ 同量级，τ 取大防欠采样震荡）
              const vTanNow = vCx * ttx + vCy * tty + vCz * ttz;
              const ff = Math.max(0, gOwn - vTanNow * vTanNow / Math.max(dToTarget, 1e-9));
              const TAU = Math.max(9, 3 * dtSim);
              const ax = (rlx * vApp + ttx * vTanDes - vCx) / TAU + rlx * ff;
              const ay = (rly * vApp + tty * vTanDes - vCy) / TAU + rly * ff;
              const az = (rlz * vApp + ttz * vTanDes - vCz) / TAU + rlz * ff;
              const aMag = Math.hypot(ax, ay, az);
              navDbg = { branch: 'rendezvous', rendMode, d: dToTarget, park: safeParkDistance,
                vApp: vApp, vRel: Math.hypot(vCx, vCy, vCz), vRad: vCx * rlx + vCy * rly + vCz * rlz,
                vTanDes, ff, aMag: aMag / acc, rate: clock.rate };
              // 不设推力死区（同驻点段注释）
              if (aMag > 0) {
                // 推力沿模拟时间轴积分而转向按真实秒进行，高倍率下转向必须
                // 同步提速，否则机头永远滞后于制导指令方向
                steerTowardsDir([ax, ay, az], dtReal, autoTurn(2.2));
                autoFwdThrust = true;
                autoThrustScale = Math.min(1.0, aMag / acc);
                flightStatus = vApp < 0 ? `伴飞防坠 · 退避 ${selected.name}`
                  : dToTarget > safeParkDistance * 1.1 ? `交会接近 · ${selected.name}`
                  : `安全伴飞 · ${selected.name}`;
              } else {
                steerTowards(targetPos, dtReal, autoTurn(1.4));
                flightStatus = `安全伴飞 · ${selected.name}`;
              }
            }
          } else {
            // ===== 巡航拦截：期望速度 = 目标速度矢量 + 朝目标的接近剖面 =====
            // 「vTarget + r̂×vApp」的矢量合成天然包含拦截前置（船自动飞向
            // 交会点）。接近剖面 √(2×½acc×剩余距离) 到泊位归零（半推力制动
            // 裕量，与交会段 vApp 同式，交会圈边界期望速度无跳变），上限
            // maxSp×0.8。控制律与交会段同构：aCmd=(vDes−vel)/τ + 引力前馈，
            // τ 随 dtSim 自适应（每帧最多消除 1/3 误差，离散收敛不抖振）
            const vAppC = Math.min(
              Math.sqrt(Math.max(0, 2 * acc * 0.5 * (dToTarget - safeParkDistance))),
              maxSp * 0.8,
            );
            const vT = selected.vel || [0, 0, 0];
            const TAU = Math.max(9, 3 * dtSim);
            let ax = (vT[0] + rlx * vAppC - probe.vel[0]) / TAU;
            let ay = (vT[1] + rly * vAppC - probe.vel[1]) / TAU;
            let az = (vT[2] + rlz * vAppC - probe.vel[2]) / TAU;
            if (well && wellC && well.GM > 0 && well !== ownWell) {
              // 最强非目标井引力前馈：抑制恒定外力造成的稳态跟踪偏差
              const gFeed = Math.min(wellG, acc);
              ax += (probe.pos[0] - wellC[0]) / gwr * gFeed;
              ay += (probe.pos[1] - wellC[1]) / gwr * gFeed;
              az += (probe.pos[2] - wellC[2]) / gwr * gFeed;
            }
            const aMag = Math.hypot(ax, ay, az);
            navDbg = { branch: 'cruise', rendMode, d: dToTarget, park: safeParkDistance,
              vDes: vAppC, aMag: aMag / acc, rate: clock.rate };
            // 不设推力死区（同交会/驻点段注释：跨尺度下任何阈值都会误伤）
            if (aMag > 0) {
              steerTowardsDir([ax, ay, az], dtReal, autoTurn(2.2));
              autoFwdThrust = true;
              autoThrustScale = Math.min(1.0, aMag / acc);
            }
            flightStatus = `自动导向 · ${selected.name}`;
          }
        }
      } else {
        // 【自由全自动航行】：引力井内自动维持稳定轨道巡航，无井则惯性直线
        const well = probe.dominantWell;
        if (well && well.GM > 0) {
          const c = (well.ref ? well.ref.pos : well.center)!;
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
            // 差额限幅：帧内 Δv 不超过到巡航速度的差额（防极端倍率一帧超调）
            autoThrustScale = Math.min(1.0, Math.max(0.15, (cruiseSpeed - fwdSpeed) / (maxSp * 0.25)),
              Math.max(0, cruiseSpeed - fwdSpeed) / (acc * Math.max(dtSim, 1e-9)));
            flightStatus = '全自动航行 · 巡航推进 (保持航向)';
          } else {
            flightStatus = '全自动航行 · 惯性巡航 (保持航向)';
          }
        }
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

      // 自动时间倍率：真实物理速度的节奏引擎（详见 autoWarpTick）
      autoWarpTick();
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
      syncShip();
      updateShipFlame(ship, probe.thrustOn ? 1 : 0, isBoosting);
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
    if (nav.idx >= 1) everLeft = true;

    // 引力弹弓计速：进入新主导井记录入场速度，井内持续更新速度峰值——
    // 「井内峰值增速」即挑战判定口径（自动巡航入井后只减速，永远不触发）
    {
      const wid = probe.dominantWell && probe.dominantWell.ref ? probe.dominantWell.ref.id : null;
      if (wid !== slingWellId) {
        slingWellId = wid;
        slingVEntry = probe.speedKmS();
        slingVPeak = slingVEntry;
      } else if (wid) {
        slingVPeak = Math.max(slingVPeak, probe.speedKmS());
      }
    }

    // 任务链推进：条件满足即完成并 toast；全部完成转自由航行态
    if (missionIdx < MISSIONS.length) {
      const sun = curWorld.entities.find((e) => e.id === 'sun');
      const ctx = {
        layer: curWorld.id, idx: nav.idx,
        selectedId: selected ? selected.id : null,
        selType: selected ? selected.type : null,
        branch: (navDbg?.branch as string) ?? null,
        distToSel: selected ? dist3(probe.pos, selected.pos) : Infinity,
        distToSun: sun ? dist3(probe.pos, sun.pos) : Infinity,
        rFromCenter: Math.hypot(probe.pos[0], probe.pos[1], probe.pos[2]),
        everLeft,
        wellId: probe.dominantWell && probe.dominantWell.ref ? probe.dominantWell.ref.id : null,
        wellSpeedGain: slingWellId ? Math.max(0, slingVPeak - slingVEntry) : 0,
        targetRadius: selected ? selected.pickRadius : 0,
        moonsDiscovered: [...discovered].filter((id) => MOON_IDS.has(id)).length,
      };
      if (MISSIONS[missionIdx].done(ctx)) {
        toastMsg(`✅ 任务完成：${MISSIONS[missionIdx].title}`);
        sfx.chime();
        missionIdx++;
        saveProgress();
        if (missionIdx === MISSIONS.length) {
          // 全通关：让末环完成 toast 先被看到，再进结算庆典
          setTimeout(showVictoryScreen, 1400);
        }
      }
    }
    if (missionIdx < MISSIONS.length) {
      ui.setMission({ idx: missionIdx + 1, total: MISSIONS.length,
        title: MISSIONS[missionIdx].title, desc: MISSIONS[missionIdx].desc });
    } else {
      ui.setMission(null);
    }
    // 启动恢复后挂件与计数需要一次初始化
    ui.setDiscoveries(discovered.size);

    // 天体自转公转动力学推进
    clock.advance(dtReal);
    simulate(dtReal, dtSim);

    // 准星与拾取更新
    updateHover();

    // ==========================================
    // HUD 真实天文物理仪表盘
    // ==========================================
    const spKmS = probe.speedKmS();
    const cfrac = spKmS / C_KM_S;
    // 速度自适应单位：亚 km/s 的近景机动用 m/s 表达，避免显示「0 km/s」
    const spText = spKmS >= C_KM_S
      ? '≈' + cfrac.toFixed(2) + ' c'
      : spKmS >= 1
        ? Math.max(spKmS, 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' km/s'
        : Math.max(spKmS * 1000, 0).toFixed(spKmS * 1000 >= 100 ? 0 : 2) + ' m/s';

    let distText = '无目标（点击天体锁定）';
    const showEnt = selected || (hoveredId && curWorld.entities.find((e) => e.id === hoveredId));
    if (showEnt) {
      const dkm = dist3(probe.pos, showEnt.pos) * curWorld.kmPerUnit;
      distText = `${showEnt.name} · ${formatKm(dkm)} · 光 ${lightTravelText(dkm)}`;
      // 锁定的目标可下潜时提示 F 快捷键（与信息卡「进入…」按钮同效）
      if (selected === showEnt && showEnt.dive) distText += ' · F 下潜进入';
    }

    const viewName = controlMode === MODE_GOD ? '上帝视角' : (VIEW_NAMES[chaseCam.mode] || '');
    const godSpeed = controlMode === MODE_GOD ? ` · 移速 ${freeCam.speed.toPrecision(2)} u/s` : '';
    let modeText = `${flightStatus} · ${viewName}${godSpeed}`;

    // 真实开普勒轨道能量判定与引力状态
    if (probe.dominantWell) {
      const well = probe.dominantWell;
      const c = (well.ref ? well.ref.pos : well.center)!;
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

    // 大巡游进度前缀（系统提示已拆分到独立 toast 元素）
    if (tour) {
      const dwell = tour.phase === 'dwell' ? ` · 停留 ${Math.ceil(tour.dwellLeft)}s` : '';
      modeText = `大巡游 ${tour.idx + 1}/${tour.stops.length}${dwell} · ${modeText}`;
    }
    // 轨道行：主导井 + 束缚/逃逸能量态独立展示
    let orbitText = '—';
    if (probe.dominantWell) {
      const well = probe.dominantWell;
      const c = (well.ref ? well.ref.pos : well.center)!;
      const r = Math.hypot(probe.pos[0] - c[0], probe.pos[1] - c[1], probe.pos[2] - c[2]) || 1;
      const speedSq = probe.vel[0] ** 2 + probe.vel[1] ** 2 + probe.vel[2] ** 2;
      orbitText = `${well.name} · ${speedSq / 2 - well.GM / r < 0 ? '束缚' : '逃逸'}轨道`;
    }

    // 泊车边沿：进圈一次性的泊车音 + 新发现收集（同一目标只记一次）
    const parked = navDbg ? (navDbg.branch === 'rendezvous' || navDbg.branch === 'station') : false;
    if (parked && !prevParked && selected) {
      // 弹弓基线重置：以泊入时的匹配速度为起点，此后井内加速才算「增速」
      slingVEntry = probe.speedKmS();
      slingVPeak = slingVEntry;
      if (!discovered.has(selected.id)) {
        discovered.add(selected.id);
        ui.setDiscoveries(discovered.size);
        ui.pingCrosshair(); // 准星扩散脉冲：收集反馈
        toastMsg(`🛰 新发现：${selected.name}`);
        saveProgress();
      }
      sfx.dock();
    }
    prevParked = parked;

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

    ui.setHud({ speedText: spText, distText, modeText, orbitText });
    let rateLabel = clock.paused
      ? '已暂停'
      : (warpMode === 'auto' ? clock.rateLabel() : (TIME_RATE_LABELS[curTimeIdx] || `×${clock.rate}`));
    if (!clock.paused) rateLabel += warpMode === 'auto' ? ' · 自动' : ' · 手动';
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
  engine.render(dtReal);
}

// 点击天体拾取目标（左键拖拽环视后的松手不算点击——拖拽超过 5px 即抑制，
// 防止「拖一圈看风景」误锁目标触发自动泊车）
canvas.addEventListener('click', (ev) => {
  if (input.dragged) { input.dragged = false; return; }
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
window.__universe = { engine, probe, clock, nav, ui, input, chaseCam, ship, sfx, discovered, MISSIONS, events: spaceEvents,
  get crashShake() { return crashShakeT; },
  get world() { return nav.world; },
  get selected() { return selected; },
  get tour() { return tour; },
  get dbg() { return navDbg; },
  get controlMode() { return controlMode; },
  get pauseMenuOpen() { return pauseMenuOpen; },
  get victoryOpen() { return victoryOpen; },
  get flightSeconds() { return flightSeconds; },
  select(id: string): boolean {
    const e = nav.world?.entities.find((x) => x.id === id);
    if (e) selectEntity(e);
    return !!e;
  },
  // 测试用：直接设置任务进度（后期任务的无头验证入口）；设到满环即
  // 触发通关结算（与真实通关同一庆典路径）
  setMission(i: number): boolean {
    if (Number.isInteger(i) && i >= 0 && i <= MISSIONS.length) {
      const was = missionIdx;
      missionIdx = i;
      saveProgress();
      if (i === MISSIONS.length && was < MISSIONS.length) setTimeout(showVictoryScreen, 200);
      return true;
    }
    return false;
  },
  openPauseMenu,
  closePauseMenu,
  showVictoryScreen,
  closeVictory,
  startTour,
  stopTour,
};

boot();
