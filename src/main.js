// 入口：宇宙大爆炸叙事 + 渲染 + 音频引擎 + 控制面板
import * as THREE from 'three';
import { CosmicSimulation, createCosmosRenderer, LEVEL_LABELS } from './cosmos.js';
import { AudioEngine } from './audio.js';
import './style.css';

// 面板已精简（2026-09-03）：物理/镜头/性能参数全部使用 sim.config 的
// 内置默认值，不再暴露 UI——观感上真正需要用户手调的只有"航行节奏"
// 与"音乐强度"两项，其余交给自动机制（环境倍率自动慢放、FPS 自动降级）。
const canvas = document.getElementById('scene');
const sim = new CosmicSimulation();
const renderer = (() => { try { return createCosmosRenderer(canvas, sim); } catch (e) { document.body.insertAdjacentHTML('beforeend', '<pre style="position:fixed;top:0;left:0;z-index:99999;color:#fff;background:#a00;font-size:13px;padding:10px;max-height:80vh;overflow:auto">' + (e.stack || e.message) + '</pre>'); throw e; } })();
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

// 控制面板折叠：默认收起，只显示标题栏，点按展开/收起，避免遮挡宇宙
const panelEl = document.getElementById('panel');
const panelToggle = document.getElementById('panel-toggle');
panelToggle.addEventListener('click', () => {
  panelEl.classList.toggle('open');
});

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

// 时间流速（航行节奏基准倍率；接近系统时的自动慢放由渲染层 envScale 完成）
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

// ---------- 事件日志面板开关与导出 ----------
el.eventLogBtn.addEventListener('click', () => {
  const open = el.eventPanel.classList.toggle('open');
  el.eventLogBtn.textContent = open ? '📜 关闭日志' : '📜 日志';
  if (open) renderEventList();
});
el.exportLogBtn.addEventListener('click', exportLog);

// ---------- 重开宇宙：重新随机生成一个全新宇宙 ----------
document.getElementById('btn-regen').addEventListener('click', () => location.reload());

// FPS 看门狗：EMA 帧率连续偏低则升档降级（0→1→2），恢复良好再缓慢降档。
// 档位在 <40 判低、>45 判好（判好需持续 10s 才降档），40~45 为稳持带，
// 避免临界帧率来回跳。
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

// 轨迹跟拍开关：开 = 固定广角自动跟拍；关 = 自由观察
el.followBtn.addEventListener('click', () => {
  const next = !renderer.state.follow;
  renderer.setFollowEnabled(next);
  el.followBtn.textContent = next ? '🎥 跟拍：开' : '🎥 跟拍：关';
});

// ---------- 推进器（玩家键盘操控） ----------
// 键位 = WASD / QE（FPS 风格）+ 方向键 + Space/Shift 同义。键按下时
// 维持在该集合里，window blur 时清空避免"卡键"。Space 默认会滚动页面，
// 所以 keydown 里 preventDefault。
// 推力大小固定为 sim.config.thrustMag 默认值 8（面板已精简，不再暴露滑杆）。
el.thrustBtn = document.getElementById('btn-thrust');

const thrustKeys = new Set();
window.addEventListener('keydown', (e) => {
  // 焦点在输入控件里时不响应
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if ([' ', 'w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
    e.preventDefault();
    thrustKeys.add(k);
  }
});
window.addEventListener('keyup', (e) => {
  thrustKeys.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => thrustKeys.clear());

el.thrustBtn.addEventListener('click', () => {
  sim.config.thrustEnabled = !sim.config.thrustEnabled;
  el.thrustBtn.textContent = sim.config.thrustEnabled ? '🚀 推进器：开' : '🚀 推进器：关';
  if (!sim.config.thrustEnabled) {
    // 关闭时立即清空推力，避免松手后还有余力
    sim.thrust[0] = 0; sim.thrust[1] = 0; sim.thrust[2] = 0;
    thrustKeys.clear();
  }
});

// 把"键位 × 摄像机方向"转成世界坐标推力。摄像机方向通过 OrbitControls
// 的 target/camera 反推：forward = (target - camera.position) 归一化，
// right = up × forward（up 是世界 Y），up = forward × right。
const _thrustFwd = new THREE.Vector3();
const _thrustRight = new THREE.Vector3();
const _thrustUp = new THREE.Vector3();
const _WORLD_UP = new THREE.Vector3(0, 1, 0);
function updateProbeThrust() {
  if (!sim.config.thrustEnabled) {
    if (sim.thrust[0] !== 0 || sim.thrust[1] !== 0 || sim.thrust[2] !== 0) {
      sim.thrust[0] = 0; sim.thrust[1] = 0; sim.thrust[2] = 0;
    }
    return;
  }
  // 计算 fwd / right / up
  _thrustFwd.copy(renderer.controls.target).sub(renderer.camera.position);
  // target 与 camera 重合时（极少见，但避免除零）保持上一次方向
  if (_thrustFwd.lengthSq() < 1e-6) return;
  _thrustFwd.normalize();
  _thrustRight.crossVectors(_WORLD_UP, _thrustFwd).normalize();
  // 防退化：right 与 fwd 共线时（看正上/正下）退化为世界 X
  if (_thrustRight.lengthSq() < 1e-6) _thrustRight.set(1, 0, 0);
  _thrustUp.crossVectors(_thrustFwd, _thrustRight).normalize();

  // 键位 → 输入向量（W/S=前后、A/D=左右、Q/E=下上、Space=上、Shift=下）
  // 注意 Q/E 的语义：习惯上 Q=上、E=下，但本项目沿用 "QE=下上" 让 Q/A
  // 都在左半区、D/E 在右半区，更符合左手 WASD + 右手 QE 的标准键位。
  const w = sim.config.thrustMag;
  let fx = 0, fy = 0, fz = 0;
  const fwd = (thrustKeys.has('w') || thrustKeys.has('arrowup')) ? 1
            : (thrustKeys.has('s') || thrustKeys.has('arrowdown')) ? -1 : 0;
  const strafe = (thrustKeys.has('d') || thrustKeys.has('arrowright')) ? 1
              : (thrustKeys.has('a') || thrustKeys.has('arrowleft')) ? -1 : 0;
  const vert = (thrustKeys.has('q') || thrustKeys.has(' ')) ? 1
            : (thrustKeys.has('e') || thrustKeys.has('shift')) ? -1 : 0;
  if (fwd) { fx += _thrustFwd.x * fwd * w; fy += _thrustFwd.y * fwd * w; fz += _thrustFwd.z * fwd * w; }
  if (strafe) { fx += _thrustRight.x * strafe * w; fy += _thrustRight.y * strafe * w; fz += _thrustRight.z * strafe * w; }
  if (vert) { fx += _thrustUp.x * vert * w; fy += _thrustUp.y * vert * w; fz += _thrustUp.z * vert * w; }
  sim.thrust[0] = fx; sim.thrust[1] = fy; sim.thrust[2] = fz;
}

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
let hudTimer = 0;
function updateHud() {
  const pr = sim.probe;
  const speed = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
  el.hudProbe.textContent = `第 ${pr.generation} 代 · 速率 ${speed.toFixed(1)}`;
  // 运动状态：自由航行 / 坠落接近 / 环绕轨道 / 临界 / 逃逸甩出
  const gi = pr.gravInfo;
  if (gi) {
    const kappaTxt = gi.accel > 0.02 ? ` · κ=${gi.kappa.toFixed(2)}` : '';
    el.hudGrav.textContent = gi.state + kappaTxt;
  }
  const ns = pr.nearestSystem >= 0 ? sim.seeds[pr.nearestSystem] : null;
  if (ns) {
    el.hudNear.textContent = `${LEVEL_LABELS[ns.level] || ns.level} · ${pr.nearestDist.toFixed(0)}`;
  } else {
    el.hudNear.textContent = '—';
  }
  const formed = sim.seeds.reduce((n, s) => n + (s.detail ? 1 : 0), 0);
  const tier = sim.config.qualityTier;
  el.hudCosmos.textContent = `成形 ${formed} · 细节体 ${sim.activeDetails.reduce((n, s) => n + s.detail.bodies.length, 0)}${tier > 0 ? ` · 降级${tier}` : ''}`;
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
  // 推进器：把"键位 × 摄像机方向"转成世界坐标推力写入 sim.thrust，
  // 物理积分会在每个子步里把它当加速度叠加到 probe.vel。
  updateProbeThrust();
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
window.__audio = audio;
window.__frames = 0;
window.__exportLog = buildLogJson;
{
  const origRender = renderer.render.bind(renderer);
  renderer.render = (...a) => { window.__frames++; return origRender(...a); };
}
