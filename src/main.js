// 入口：宇宙大爆炸叙事 + 渲染 + 音频引擎 + 控制面板
import { CosmicSimulation, createCosmosRenderer, LEVEL_LABELS } from './cosmos.js';
import { AudioEngine } from './audio.js';
import './style.css';

// 初始条件从 localStorage 恢复（"🎲 重开宇宙"reload 后仍生效）
const INIT_CFG_KEY = 'cosmos-init-config';
let savedInitConfig = {};
try { savedInitConfig = JSON.parse(localStorage.getItem(INIT_CFG_KEY) || '{}') || {}; } catch { savedInitConfig = {}; }

const canvas = document.getElementById('scene');
const sim = new CosmicSimulation(savedInitConfig);
const renderer = createCosmosRenderer(canvas, sim);
const audio = new AudioEngine();

// ---------- 控制面板 ----------
const el = {
  playBtn: document.getElementById('btn-play'),
  fileInput: document.getElementById('file-input'),
  micBtn: document.getElementById('btn-mic'),
  timeScale: document.getElementById('time-scale'),
  timeScaleVal: document.getElementById('time-scale-val'),
  intensity: document.getElementById('intensity'),
  intensityVal: document.getElementById('intensity-val'),
  followBtn: document.getElementById('btn-follow'),
  status: document.getElementById('status'),
  eventToast: document.getElementById('event-toast'),
  hudProbe: document.getElementById('hud-probe'),
  hudGrav: document.getElementById('hud-grav'),
  hudOrbit: document.getElementById('hud-orbit'),
  hudCam: document.getElementById('hud-cam'),
  hudNear: document.getElementById('hud-near'),
  hudCosmos: document.getElementById('hud-cosmos'),
  eventPanel: document.getElementById('event-panel'),
  eventList: document.getElementById('event-list'),
  eventLogBtn: document.getElementById('btn-event-log'),
  exportLogBtn: document.getElementById('btn-export-log'),
};

function setStatus(text) {
  el.status.textContent = text;
}

el.playBtn.addEventListener('click', async () => {
  // 麦克风模式没有暂停恢复，点击直接重开
  if (audio.mode === 'mic' && !audio.playing) {
    try {
      await audio.playMic();
      el.playBtn.textContent = '⏸ 暂停';
      setStatus('麦克风输入中');
    } catch (e) {
      setStatus('麦克风不可用：' + e.message);
    }
    return;
  }
  // 已播放中 → 暂停
  if (audio.playing) {
    audio.pause();
    el.playBtn.textContent = '▶ 继续';
    setStatus('已暂停');
    return;
  }
  // 有缓冲（示例/文件）→ 恢复
  if (audio.mode !== 'none' && audio.buffer) {
    audio.resume();
    el.playBtn.textContent = '⏸ 暂停';
    setStatus('继续播放');
    return;
  }
  // 首次：启动合成示例音轨
  try {
    await audio.playSynth();
    el.playBtn.textContent = '⏸ 暂停';
    setStatus('播放示例音乐 · 合成循环');
  } catch (e) {
    setStatus('音频启动失败：' + e.message);
  }
});

document.getElementById('btn-file').addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files[0];
  if (!file) return;
  try {
    await audio.playFile(file);
    el.playBtn.textContent = '⏸ 暂停';
    setStatus(`播放：${file.name}`);
  } catch (e) {
    setStatus('无法解码该音频文件');
  }
});

el.micBtn.addEventListener('click', async () => {
  try {
    await audio.playMic();
    el.playBtn.textContent = '⏸ 暂停(麦克风)';
    setStatus('麦克风输入中');
  } catch (e) {
    setStatus('麦克风不可用：' + e.message);
  }
});

// 时间流速
function syncTimeScale() {
  renderer.state.timeScale = parseFloat(el.timeScale.value);
  el.timeScaleVal.textContent = renderer.state.timeScale.toFixed(2) + '×';
}
el.timeScale.addEventListener('input', syncTimeScale);
syncTimeScale();

// 音乐强度
function syncIntensity() {
  renderer.state.musicIntensity = parseFloat(el.intensity.value);
  el.intensityVal.textContent = renderer.state.musicIntensity.toFixed(1) + '×';
}
el.intensity.addEventListener('input', syncIntensity);
syncIntensity();

// ---------- 虫洞参数（直通 sim.config，即时生效） ----------
el.whDist = document.getElementById('wormhole-dist');
el.whDistVal = document.getElementById('wormhole-dist-val');
el.whDur = document.getElementById('wormhole-duration');
el.whDurVal = document.getElementById('wormhole-duration-val');
el.whWin = document.getElementById('wormhole-window');
el.whWinVal = document.getElementById('wormhole-window-val');

function syncWormholeConfig() {
  sim.config.wormholeDist = parseFloat(el.whDist.value);
  sim.config.wormholeDuration = parseFloat(el.whDur.value);
  sim.config.wormholeWindow = parseFloat(el.whWin.value);
  el.whDistVal.textContent = sim.config.wormholeDist.toFixed(0);
  el.whDurVal.textContent = sim.config.wormholeDuration.toFixed(1) + 's';
  el.whWinVal.textContent = sim.config.wormholeWindow.toFixed(0) + 's';
}
el.whDist.addEventListener('input', syncWormholeConfig);
el.whDur.addEventListener('input', syncWormholeConfig);
el.whWin.addEventListener('input', syncWormholeConfig);
syncWormholeConfig();

// ---------- 事件日志面板开关与导出 ----------
el.eventLogBtn.addEventListener('click', () => {
  const open = el.eventPanel.classList.toggle('open');
  el.eventLogBtn.textContent = open ? '📜 关闭日志' : '📜 事件日志';
  if (open) renderEventList();
});
el.exportLogBtn.addEventListener('click', exportLog);

// ---------- 性能预算（§9.5）：上限滑杆 + FPS 自适应降级 ----------
el.perfSystems = document.getElementById('perf-systems');
el.perfSystemsVal = document.getElementById('perf-systems-val');
el.perfBodies = document.getElementById('perf-bodies');
el.perfBodiesVal = document.getElementById('perf-bodies-val');
el.autoQualityBtn = document.getElementById('btn-auto-quality');

function syncPerfConfig() {
  sim.config.maxDetailSystems = parseInt(el.perfSystems.value, 10);
  sim.config.maxDetailBodies = parseInt(el.perfBodies.value, 10);
  el.perfSystemsVal.textContent = String(sim.config.maxDetailSystems);
  el.perfBodiesVal.textContent = String(sim.config.maxDetailBodies);
}
el.perfSystems.addEventListener('input', syncPerfConfig);
el.perfBodies.addEventListener('input', syncPerfConfig);
syncPerfConfig();

el.autoQualityBtn.addEventListener('click', () => {
  sim.config.autoQuality = !sim.config.autoQuality;
  if (!sim.config.autoQuality) sim.config.qualityTier = 0; // 关闭时恢复全质量
  el.autoQualityBtn.textContent = sim.config.autoQuality ? '⚙ 自动降级：开' : '⚙ 自动降级：关';
});

// ---------- 初始条件（§9.6）：改完滑杆 → 🎲 重开宇宙应用 ----------
el.initFilament = document.getElementById('init-filament');
el.initFilamentVal = document.getElementById('init-filament-val');
el.initDisp = document.getElementById('init-disp');
el.initDispVal = document.getElementById('init-disp-val');
el.initBias = document.getElementById('init-bias');
el.initBiasVal = document.getElementById('init-bias-val');
el.regenBtn = document.getElementById('btn-regen');

function syncInitConfig() {
  sim.config.filamentStrength = parseFloat(el.initFilament.value);
  sim.config.velocityDispersion = parseFloat(el.initDisp.value);
  sim.config.massBias = parseFloat(el.initBias.value);
  el.initFilamentVal.textContent = sim.config.filamentStrength.toFixed(1) + '×';
  el.initDispVal.textContent = sim.config.velocityDispersion.toFixed(2) + '×';
  el.initBiasVal.textContent = (sim.config.massBias > 0 ? '+' : '') + sim.config.massBias.toFixed(1);
  localStorage.setItem(INIT_CFG_KEY, JSON.stringify({
    filamentStrength: sim.config.filamentStrength,
    velocityDispersion: sim.config.velocityDispersion,
    massBias: sim.config.massBias,
  }));
}
// 先把持久化值回填滑杆再同步：sim 构造时已注入 localStorage 的初始条件，
// 若直接用滑杆 HTML 默认值同步，会把持久化配置冲掉
el.initFilament.value = String(sim.config.filamentStrength);
el.initDisp.value = String(sim.config.velocityDispersion);
el.initBias.value = String(sim.config.massBias);
el.initFilament.addEventListener('input', syncInitConfig);
el.initDisp.addEventListener('input', syncInitConfig);
el.initBias.addEventListener('input', syncInitConfig);
syncInitConfig();

// 初始条件只在构造时消费，改完必须重开宇宙。松手后让「重开宇宙」按钮呼吸，
// 明确告诉用户下一步点哪里（静态角标见 index.html 的 <em> 提示）。
// 注意：不能借用 #status —— 主循环每帧都会把它改写成"时间·纪元·小球状态"。
function markRegenPending() {
  el.regenBtn.classList.add('pending');
}
el.initFilament.addEventListener('change', markRegenPending);
el.initDisp.addEventListener('change', markRegenPending);
el.initBias.addEventListener('change', markRegenPending);

el.regenBtn.addEventListener('click', () => location.reload());

// ---------- 引力实验参数（实时直通 sim.config，立即生效） ----------
el.gravG = document.getElementById('grav-g');
el.gravGVal = document.getElementById('grav-g-val');
el.massScale = document.getElementById('mass-scale');
el.massScaleVal = document.getElementById('mass-scale-val');
el.radiusScale = document.getElementById('radius-scale');
el.radiusScaleVal = document.getElementById('radius-scale-val');
el.trailLen = document.getElementById('trail-len');
el.trailLenVal = document.getElementById('trail-len-val');
el.camZoom = document.getElementById('cam-zoom');
el.camZoomVal = document.getElementById('cam-zoom-val');
el.camPanX = document.getElementById('cam-panx');
el.camPanXVal = document.getElementById('cam-panx-val');
el.camPanY = document.getElementById('cam-pany');
el.camPanYVal = document.getElementById('cam-pany-val');
el.probeSpeed = document.getElementById('probe-speed');
el.probeSpeedVal = document.getElementById('probe-speed-val');
el.probeAz = document.getElementById('probe-az');
el.probeAzVal = document.getElementById('probe-az-val');
el.probeEl = document.getElementById('probe-el');
el.probeElVal = document.getElementById('probe-el-val');
el.resetProbeBtn = document.getElementById('btn-reset-probe');
el.resetParamsBtn = document.getElementById('btn-reset-params');

// 取值范围已在 HTML 的 min/max 上钳制，这里只做一次兜底，防止极端值把积分打爆
const GRAV_DEFAULTS = {
  gravityG: 16, bodyMassScale: 1, bodyRadiusScale: 1,
  trailLength: 750, camZoom: 34, camPanX: 0, camPanY: 0,
};
const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

function syncGravConfig() {
  const c = sim.config;
  c.gravityG = clampNum(el.gravG.value, 4, 40, GRAV_DEFAULTS.gravityG);
  c.bodyMassScale = clampNum(el.massScale.value, 0.25, 3, GRAV_DEFAULTS.bodyMassScale);
  c.bodyRadiusScale = clampNum(el.radiusScale.value, 0.5, 2, GRAV_DEFAULTS.bodyRadiusScale);
  c.trailLength = Math.round(clampNum(el.trailLen.value, 100, 3000, GRAV_DEFAULTS.trailLength));
  c.camZoom = clampNum(el.camZoom.value, 10, 80, GRAV_DEFAULTS.camZoom);
  c.camPanX = clampNum(el.camPanX.value, -30, 30, GRAV_DEFAULTS.camPanX);
  c.camPanY = clampNum(el.camPanY.value, -30, 30, GRAV_DEFAULTS.camPanY);
  el.gravGVal.textContent = c.gravityG.toFixed(1);
  el.massScaleVal.textContent = c.bodyMassScale.toFixed(2) + '×';
  el.radiusScaleVal.textContent = c.bodyRadiusScale.toFixed(2) + '×';
  const secs = (c.trailLength * 0.045).toFixed(1);
  el.trailLenVal.textContent = `${c.trailLength} 点 / ${secs}s`;
  el.camZoomVal.textContent = c.camZoom.toFixed(0);
  el.camPanXVal.textContent = c.camPanX.toFixed(0);
  el.camPanYVal.textContent = c.camPanY.toFixed(0);
}
[el.gravG, el.massScale, el.radiusScale, el.trailLen,
  el.camZoom, el.camPanX, el.camPanY].forEach((n) => {
  n.addEventListener('input', syncGravConfig);
});
syncGravConfig();

// 初速矢量（只在点「重置小球」时读取）
function syncProbeLaunch() {
  el.probeSpeedVal.textContent = parseFloat(el.probeSpeed.value).toFixed(1);
  el.probeAzVal.textContent = parseFloat(el.probeAz.value).toFixed(0) + '°';
  el.probeElVal.textContent = parseFloat(el.probeEl.value).toFixed(0) + '°';
}
[el.probeSpeed, el.probeAz, el.probeEl].forEach((n) => {
  n.addEventListener('input', syncProbeLaunch);
});
syncProbeLaunch();

el.resetProbeBtn.addEventListener('click', () => {
  sim.resetProbe({
    speed: clampNum(el.probeSpeed.value, 0, 60, 30),
    az: (clampNum(el.probeAz.value, -180, 180, 0) * Math.PI) / 180,
    el: (clampNum(el.probeEl.value, -80, 80, 0) * Math.PI) / 180,
  });
});

el.resetParamsBtn.addEventListener('click', () => {
  el.gravG.value = String(GRAV_DEFAULTS.gravityG);
  el.massScale.value = String(GRAV_DEFAULTS.bodyMassScale);
  el.radiusScale.value = String(GRAV_DEFAULTS.bodyRadiusScale);
  el.trailLen.value = String(GRAV_DEFAULTS.trailLength);
  el.camZoom.value = String(GRAV_DEFAULTS.camZoom);
  el.camPanX.value = String(GRAV_DEFAULTS.camPanX);
  el.camPanY.value = String(GRAV_DEFAULTS.camPanY);
  syncGravConfig();
});

// FPS 看门狗：EMA 帧率连续偏低则升档降级（0→1→2），恢复良好再缓慢降档。
// 档位只在 <40 判低、>50 判好，40~50 为稳持带，避免临界帧率来回跳。
// tier 含义（sim._manageDetails 消费）：
//   1 = 冻结 LOD 升级、停止创建新细节系统（存量保留）
//   2 = 再把最远的细节系统卸载到上限一半，点尺寸缩小
let fpsEma = 60;
let perfCheckTimer = 0;
let goodFpsTimer = 0;
function watchPerformance(dt) {
  const fps = 1 / Math.max(dt, 1e-4);
  fpsEma += (fps - fpsEma) * 0.05;
  window.__fpsEma = Math.round(fpsEma);
  perfCheckTimer += dt;
  if (perfCheckTimer < 5) return;
  perfCheckTimer = 0;
  if (!sim.config.autoQuality) return;
  const tier = sim.config.qualityTier;
  if (fpsEma < 40 && tier < 2) {
    sim.config.qualityTier = tier + 1;
    goodFpsTimer = 0;
    sim.events.push({ time: sim.time, text: `⚙️ 帧率偏低（${fpsEma.toFixed(0)} FPS），自动降级到档位 ${sim.config.qualityTier}` });
  } else if (fpsEma > 45 && tier > 0) {
    goodFpsTimer += 5;
    if (goodFpsTimer >= 10) {
      sim.config.qualityTier = tier - 1; // 逐档恢复，避免来回跳
      goodFpsTimer = 0;
      sim.events.push({ time: sim.time, text: `⚙️ 帧率恢复（${fpsEma.toFixed(0)} FPS），质量回到档位 ${sim.config.qualityTier}` });
    }
  } else {
    goodFpsTimer = 0;
  }
}

// 智能镜头：先全局见证结构形成，黑洞时代自动跟拍；关闭后自由观察
el.followBtn.addEventListener('click', () => {
  const next = !renderer.state.follow;
  renderer.setFollowEnabled(next);
  el.followBtn.textContent = next ? '🎥 智能镜头：开' : '🎥 智能镜头：关';
});

// ---------- 主循环 ----------
// 渲染循环必须与显示器刷新同步：用 setInterval 固定间隔驱动时，
// 一旦单帧渲染耗时超过间隔，回调就会排队连发，帧与帧的间隔忽长忽短
// （例如 8ms / 50ms 交替），小球看起来就会“一颤一颤”。
// requestAnimationFrame 会跟随显示器刷新节奏回调；渲染太慢时自动丢帧、
// 保持均匀节奏，配合物理插值即可得到平滑连续的运动。
// 仅当 rAF 不可用或长时间一帧未触发（个别 headless 环境）时退回 setInterval。
let last = performance.now();
let rafId = 0;
let intervalId = 0;
let watchdogTimer = 0;
let rafLastFrame = 0; // 最近一次 rAF 帧的时间（看门狗用）
let loopMode = 'raf'; // 'raf' | 'interval'
let eventToastTimer = 0;
let eventToastShowing = false;
let eventQueue = [];
let lastEventIndex = 0;

function showNextEvent() {
  if (eventToastShowing || eventQueue.length === 0) return;
  eventToastShowing = true;
  el.eventToast.textContent = eventQueue.shift();
  el.eventToast.classList.add('show');
  clearTimeout(eventToastTimer);
  eventToastTimer = setTimeout(() => {
    el.eventToast.classList.remove('show');
    eventToastShowing = false;
    clearTimeout(eventToastTimer);
    eventToastTimer = setTimeout(showNextEvent, 450);
  }, 3000);
}

function showEvent(text) {
  eventQueue.push(text);
  showNextEvent();
}

// ---------- 航行信息面板 ----------
// 低频刷新（4Hz）：面板是给人读的，无需每帧重排 DOM
const CAM_LABELS = { cruise: '跟拍', interact: '交互框选', detail: '细节框选' };
let hudTimer = 0;
function updateHud() {
  const pr = sim.probe;
  const speed = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
  el.hudProbe.textContent = `第 ${pr.generation} 代 · 速度 ${speed.toFixed(1)}`;
  // 引力状态：加速度大小、速率/逃逸速度之比 κ、以及由此判定的状态
  const gi = pr.gravInfo;
  if (gi) {
    el.hudGrav.textContent =
      `a=${gi.accel.toFixed(2)} · κ=${gi.kappa.toFixed(2)} · ${gi.state}`;
    el.hudOrbit.textContent = Number.isFinite(gi.nearDist)
      ? `距 ${gi.nearDist.toFixed(1)} · v_esc ${gi.vEsc.toFixed(1)}`
      : '—';
  }
  el.hudCam.textContent = renderer.state.follow
    ? (CAM_LABELS[renderer.state.mode] || renderer.state.mode)
    : '自由观察';
  const ns = pr.nearestSystem >= 0 ? sim.seeds[pr.nearestSystem] : null;
  if (ns) {
    const stage = !ns.awakened ? '休眠'
      : ns.growth < 1 ? `形成中 ${Math.floor(ns.growth * 100)}%`
      : '已成形';
    el.hudNear.textContent = `${LEVEL_LABELS[ns.level] || ns.level} · ${pr.nearestDist.toFixed(0)} · ${stage}`;
  } else {
    el.hudNear.textContent = '—';
  }
  const formed = sim.seeds.reduce((n, s) => n + (s.detail ? 1 : 0), 0);
  const tier = sim.config.qualityTier;
  el.hudCosmos.textContent = `已成形系统 ${formed} · 细节体 ${sim.activeDetails.reduce((n, s) => n + s.detail.bodies.length, 0)}${tier > 0 ? ` · 降级${tier}` : ''}`;
}

// ---------- 事件日志面板（可回放时间线 + 导出） ----------
const EVENT_LIST_CAP = 80; // 面板最多渲染最近 80 条，完整内容走导出
// 里程碑/结局类事件在时间线里高亮
const MILESTONE_RE = /成形|诞生|出现|形成|点亮|撕碎|汽化|烧蚀|跃迁/;
function renderEventList() {
  if (el.eventList.dataset.n === String(sim.events.length)) return;
  el.eventList.dataset.n = String(sim.events.length);
  const items = sim.events.slice(-EVENT_LIST_CAP);
  el.eventList.innerHTML = items.map((e) => {
    const cls = MILESTONE_RE.test(e.text) ? ' class="ev-milestone"' : '';
    return `<div${cls}><span class="ev-t">${e.time.toFixed(1)}s</span>${e.text}</div>`;
  }).join('');
  el.eventList.scrollTop = el.eventList.scrollHeight;
}

// 完整日志：宇宙状态 + 全部事件 + 周期快照，JSON 一把导出（可回放时间线）
function buildLogJson() {
  const pr = sim.probe;
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    simTime: +sim.time.toFixed(1),
    era: sim.era,
    generation: pr.generation,
    respawns: pr.respawns,
    config: sim.config,
    probe: { pos: pr.pos.map((v) => +v.toFixed(1)), speed: +Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]).toFixed(1) },
    events: sim.events,
    ticks: sim.ticks,
  }, null, 2);
}

function exportLog() {
  const blob = new Blob([buildLogJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cosmos-log-${sim.time.toFixed(0)}s.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderFrame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  renderer.render(dt, audio);
  watchPerformance(dt);
  const label = `${sim.time.toFixed(1)}s · ${sim.era} · ${sim.probe.label}`;
  if (el.status.textContent !== label) setStatus(label);
  hudTimer += dt;
  if (hudTimer >= 0.25) {
    hudTimer = 0;
    updateHud();
    if (el.eventPanel.classList.contains('open')) renderEventList();
  }
  if (sim.events.length > lastEventIndex) {
    const fresh = sim.events.slice(lastEventIndex);
    lastEventIndex = sim.events.length;
    for (const ev of fresh) eventQueue.push(ev.text);
    showNextEvent();
  }
}

function step() {
  rafLastFrame = performance.now();
  // 先预约下一帧：即使本帧出错，循环也不会中断
  rafId = requestAnimationFrame(step);
  // 不用 rAF 回调的时间戳：它与 performance.now() 可能来自不同时钟
  // （headless/软件渲染下会回拨导致 dt 为负）。节奏交给 rAF，计时统一用 performance.now()。
  renderFrame(rafLastFrame);
}

// 看门狗：rAF 在 3 秒内一帧都没触发（个别 headless 环境不派发 rAF 帧），
// 永久退回 setInterval 驱动。后台标签页暂停 rAF 属正常行为，不触发。
function watchRaf() {
  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    if (loopMode !== 'raf') return;
    if (document.hidden) { watchRaf(); return; }
    if (performance.now() - rafLastFrame > 3000) {
      loopMode = 'interval';
      cancelAnimationFrame(rafId);
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => renderFrame(performance.now()), 16);
    } else {
      watchRaf();
    }
  }, 3000);
}

function startLoop() {
  last = performance.now();
  if (loopMode === 'raf' && typeof requestAnimationFrame === 'function') {
    cancelAnimationFrame(rafId);
    rafLastFrame = performance.now();
    rafId = requestAnimationFrame(step);
    watchRaf();
  } else {
    clearTimeout(watchdogTimer);
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => renderFrame(performance.now()), 16);
  }
  window.__loopMode = loopMode;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) startLoop();
});

startLoop();

// ---------- 尺寸 ----------
function resize() {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

setStatus('宇宙大爆炸 · 物质急速膨胀 · 主角的航行开始');
setTimeout(() => showEvent(el.eventToast.textContent), 400);

// 调试钩子（供浏览器自动化脚本验证渲染）
window.__sim = sim;
window.__renderer = renderer;
window.__camera = renderer.camera;
window.__scene = renderer.scene;
window.__controls = renderer.controls;
window.__stars = renderer.stars;
window.__ripples = renderer.ripples;
window.__audio = audio;
window.__frames = 0;
window.__exportLog = buildLogJson;
{
  const origRender = renderer.render.bind(renderer);
  renderer.render = (...a) => { window.__frames++; return origRender(...a); };
}
