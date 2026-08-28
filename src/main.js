// 入口：宇宙大爆炸叙事 + 渲染 + 音频引擎 + 控制面板
import { CosmicSimulation, createCosmosRenderer, LEVEL_LABELS } from './cosmos.js';
import { AudioEngine } from './audio.js';
import './style.css';

const canvas = document.getElementById('scene');
const sim = new CosmicSimulation();
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
  hudCam: document.getElementById('hud-cam'),
  hudNear: document.getElementById('hud-near'),
  hudCosmos: document.getElementById('hud-cosmos'),
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
  el.hudCosmos.textContent = `已成形系统 ${formed} · 细节体 ${sim.activeDetails.length}`;
}

function renderFrame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  renderer.render(dt, audio);
  const label = `${sim.time.toFixed(1)}s · ${sim.era} · ${sim.probe.label}`;
  if (el.status.textContent !== label) setStatus(label);
  hudTimer += dt;
  if (hudTimer >= 0.25) { hudTimer = 0; updateHud(); }
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
{
  const origRender = renderer.render.bind(renderer);
  renderer.render = (...a) => { window.__frames++; return origRender(...a); };
}
