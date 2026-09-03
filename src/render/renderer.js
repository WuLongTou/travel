// 宇宙大爆炸模拟 · 渲染域主模块
// createCosmosRenderer：场景/渲染器/后处理/镜头/主循环。
// 目录梳理：纹理、配色、星空、全屏叠加层已拆到同级模块（textures/colors/sky/overlays）。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { smoothstep } from '../core/utils.js';
import { makeGlowTexture, makeRingTexture } from './textures.js';
import { levelColor, levelColorTinted, levelCoreScale, levelSolidScale } from './colors.js';
import { createCosmicSky, createStarfield, createNebulae } from './sky.js';
import { createWormholeOverlay } from './overlays.js';
import { createExplosionFx } from './explosion.js';
import { createParticles } from './particles.js';
import { createTrail } from './trail.js';
import { createStructures } from './structures.js';
import { createProbeFx } from './probe-fx.js';
import { createCameraFollow } from './camera-follow.js';

export function createCosmosRenderer(canvas, sim) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // 曝光收敛到 1.05：之前 1.25 会把大面积点云/星云整体提亮，宇宙显得
  // "发灰发亮"；真实宇宙是黑的，只有天体本身亮
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000); // 纯黑：宇宙环境无环境光
  const camera = new THREE.PerspectiveCamera(58, 1, 0.04, 10000);
  camera.position.set(0, 2.4, 9);

  // ---- 后处理辉光（UnrealBloom）：真实宇宙的"发光"质感 ----
  // 阈值 0.62、强度 0.45：只有恒星/黑洞/小球等真亮天体触发柔光；
  // 阈值太低时大面积点云会叠加成雾，宇宙显得又亮又蓝
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.45,   // strength 强度
    0.50,   // radius 半径
    0.62,   // threshold 阈值
  );
  composer.addPass(bloomPass);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.7;
  controls.maxDistance = Infinity;   // 无限距离：摄像机可飞到宇宙任意角落
  controls.screenSpacePanning = true;
  controls.rotateSpeed = 0.9;
  controls.panSpeed = 1.8;           // 加快平移，远距离也能快速移动到目标
  controls.zoomSpeed = 1.8;          // 加快缩放，快速靠近/拉远
  controls.minPolarAngle = 0.04;
  controls.maxPolarAngle = Math.PI - 0.04;
  // 旋转(左键) / 平移(右键/中键) 交给 OrbitControls（本就无限）。
  // **滚轮不交给 OrbitControls 的 dolly**：原生 dolly 是"朝 target 靠近"，
  // target 被双击聚焦拉到小球附近后（minDistance=0.7）滚轮就基本不动；
  // 而且它不沿画面中心，无法"走到更前方"。自由模式下滚轮由下方自定义
  // 监听接管为"沿视线方向推进"（第三人称游戏手感，见 setFollowEnabled 旁）。
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = false;
  controls.zoomToCursor = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  controls.target.set(0, 0, 3);
  // 阻止页面滚动/手势抢走画布滚轮与拖拽
  canvas.style.touchAction = 'none';

  // ---- 自由视角 · 滚轮 = 沿视线方向自由推进/后退（第三人称游戏手感）----
  // 每格移动"当前相机距 target 距离"的一小段（约 0.08%/px，滚 100px ≈ 8%），
  // 近处精细、远处快速穿行。camera 与 target **一起**移动（旋转中心跟随，
  // 距离不变）→ 不受 minDistance / maxDistance 任何限制，可以一直前进到
  // 宇宙任何角落。跟拍模式（controls.enabled=false）下滚轮不介入。
  const _wheelFwd = new THREE.Vector3();
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.follow || !controls.enabled || e.deltaY === 0) return;
    const dist = Math.max(0.001, camera.position.distanceTo(controls.target));
    _wheelFwd.subVectors(controls.target, camera.position);
    if (_wheelFwd.lengthSq() < 1e-8) {
      // camera 与 target 重合的极端情况：退回相机自身前向
      camera.getWorldDirection(_wheelFwd);
    } else {
      _wheelFwd.normalize();
    }
    const move = dist * 0.0008 * (-e.deltaY);
    camera.position.addScaledVector(_wheelFwd, move);
    controls.target.addScaledVector(_wheelFwd, move);
    // 手动推进打断双击聚焦的 target 飞行（聚焦目标已不是小球）
    focusActive = false;
  }, { passive: false });

  // 自由视角 · 双击聚焦小球：双击画布后观察目标平滑飞向小球并持续跟随
  // （小球在动，只飞向快照点会丢目标），之后可用滚轮推进/拉远打断跟随
  // 继续自由观察（解决"远距离无法自主靠近"）。
  const focusTarget = new THREE.Vector3();
  let focusActive = false;
  canvas.addEventListener('dblclick', () => {
    if (state.follow) return; // 仅在自由视角下生效
    focusActive = true;
  });

  const cosmicSky = createCosmicSky();
  scene.add(cosmicSky);

  // ---------- 程序纹理（星空圆点星 / 星云 / 天体 / 大爆炸共用） ----------
  const glowTex = makeGlowTexture();
  const ringTex = makeRingTexture();
  const starfield = createStarfield(glowTex);
  scene.add(starfield);

  // 天体结构 + 成员点云子系统（已提取到 render/structures.js）
  const structures = createStructures(scene, sim, glowTex, ringTex, camera);
  // 远星云层：跟随相机，给"真实宇宙"补上色深与纵深
  const nebulae = createNebulae(glowTex);
  scene.add(nebulae);
  // 大爆炸特效子系统（已提取到 render/explosion.js，工厂返回 update + flashOverlay）
  const explosion = createExplosionFx(scene, glowTex);

  // 虫洞特效叠加层
  const wormholeOverlay = createWormholeOverlay();
  let lastWormhole = 0; // 记录已处理的虫洞触发次数

  // 启动快进（显示层）：开局这段真实秒数内用高倍率把宇宙推进到已成形。
  // 参数放在 sim.config 里，便于调参与测试（测试可置 0 排除干扰）。

  const state = {
    // timeScale **只是显示层的缩放系数**（详见 render() 中的物理量/显示量说明），
    // 不参与引力与任何受力计算，物理子步长与轨道结果都不随之改变。
    // 默认 0.42：物理巡航速度约 17 单位/秒 → 空旷航段观感约 7 单位/秒，
    // 足够体现"航行"；接近系统时由 envScale（见 render()）自动慢放到
    // ~0.15 倍率（观感 ~2.5 单位/秒），穿越恒星系仍从容可读。
    // 注意 main.js 的滑杆会在启动时再次同步，HTML 里的 value 才是真正生效值。
    time: 0, timeScale: 0.42, musicIntensity: 1, follow: true,
    physAcc: 0,
    // 环境倍率 envScale（航行节奏自适应，2026-09-03）：接近天体系统时
    // 自动慢放、空旷航行时全速。与用户滑杆相乘，只改显示快慢。
    envScale: 1,
    // 上帝视角镜头（全部连续量，无模式机）：
    camAzimuth: -Math.PI / 2,  // 恒定世界方位角（初始化后不改，不跟随小球旋转）
    camDist: 55,  // 当前距离（向 wantDist 速率限幅逼近；CAM_CRUISE_DIST 已移 render/camera-follow.js）
    // 轨道中心（平滑后的视点基准）：influencer 切换时不能瞬移
    orbitCenter: new THREE.Vector3(),
    _focusInit: false,
    // 连续上下文权重 w：0=跟小球，1=钉在轨道中心看整圈轨迹
    // （双时间常数平滑：进入 2.5s、退出 6s，取代旧的滞回锁存）
    orbitFactor: 0,
    // 平滑速度向量（视点前向偏置用，~1.6s 时间常数）
    velSmooth: new THREE.Vector3(),
    // 上一帧小球显示位置（检测虫洞/重生的大尺度瞬移，触发镜头刚体平移）
    _lastProbePos: new THREE.Vector3(),
    // 瞬移后的一次性全景距离抬升信号（camera-follow 消费后清零）
    panoramaDist: 0,
    // 实际生效的镜头平移量 [x, y]（已含钳制与高速收回）
    camPanApplied: [0, 0],
  };

  // 镜头跟拍子系统（已提取到 render/camera-follow.js）
  const cameraFollow = createCameraFollow(state, controls, camera, sim);

  // 粒子子系统（已提取到 render/particles.js，工厂返回 update）
  const particles = createParticles(scene, sim, state);
  // 轨迹子系统（已提取到 render/trail.js，工厂返回 pushTrail/syncTrail/clearTrail）
  const trail = createTrail(scene, sim, camera);

  // 小球视觉 + 死亡特效子系统（已提取到 render/probe-fx.js）
  const probeFx = createProbeFx(scene, sim, glowTex, ringTex, trail, camera);


  function resize(w, h) {
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const zeroAudio = () => ({ bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 });




  function render(dtReal, audio) {
    // ==================================================================
    // 物理量 vs 显示量 —— 两者的换算**只发生在下面这一行**
    //
    //   显示量（真实秒）：dtReal、state.time、镜头插值、HUD 刷新
    //   物理量（物理秒）：pr.pos / pr.vel / pr.gravAccel、sim.time、
    //                    sim.step(PHYS_DT) 内部的引力与积分
    //
    //   state.timeScale 是**仅用于显示的缩放系数**：
    //     物理时间增量 = 真实帧时间 × timeScale
    //   它决定"每过去 1 真实秒，screen 上的物体走多少物理距离"，
    //   也就是屏幕上的移动快慢。调小 = 慢放，调大 = 快进。
    //
    //   它**不参与**任何受力计算：sim.step() 里的引力、加速度、积分
    //   一律使用物理子步长 PHYS_DT（恒定 0.02），与 timeScale 无关，
    //   因此轨道形状、加速度、轨道结果都不随该系数改变 —— 改变的只是
    //   沿轨道推进的快慢。
    // ==================================================================
    state.time += dtReal;
    // ---- 环境倍率（航行节奏自适应，2026-09-03）----
    // 空旷航段全速推进（滑杆值 ×1），接近天体系统时自动慢放（×0.35）——
    // 解决"开局太慢"与"穿越系统要慢"的矛盾：物理层零改动，只缩放
    // 每真实秒的物理时间增量。near 由最近系统距离/detailRadius 的
    // 连续函数给出（1.1R 内满档、2.4R 外归零），双时间常数平滑
    // （减速 2.5s、恢复 1.6s），无任何切换点。
    {
      const pr0 = sim.probe;
      let envTarget = 1;
      if (pr0.nearestSystem >= 0 && pr0.nearestDist < Infinity && sim.seeds[pr0.nearestSystem]) {
        const ns = sim.seeds[pr0.nearestSystem];
        const R = Math.max(1, sim._detailRadius(ns) || sim._systemRadius(ns));
        const ratio = pr0.nearestDist / R;
        const near = 1 - smoothstep(1.1, 2.4, ratio);
        envTarget = 1 - 0.65 * near;
      }
      const envTau = envTarget < state.envScale ? 2.5 : 1.6;
      state.envScale += (envTarget - state.envScale) * Math.min(1, dtReal / envTau);
    }
    // 启动快进（乘性指数回落，2026-09-03 重做）：开局以 bootFastForwardScale
    // 倍（默认 6×）推进——大爆炸窗口（1.2 物理秒）在约半秒真实时间内演完，
    // 喷流粒子 160~320 的初速以 ~2.5 物理秒/真实秒 的屏幕节奏掠过视野，
    // "超光速暴胀"的冲击一眼可见；随后按指数曲线（tau = wall×0.18 ≈ 2.5s）
    // 无缝回落到环境倍率节奏。乘性形式让倍率始终随用户滑杆同步缩放。
    const bootTau = Math.max(0.5, sim.config.bootFastForwardWall * 0.18);
    const bootMul = 1 + Math.max(0, sim.config.bootFastForwardScale - 1) * Math.exp(-state.time / bootTau);
    const scale = state.timeScale * state.envScale * bootMul;
    state.physAcc += dtReal * scale;
    const PHYS_DT = 0.02;
    let guard = 0;
    while (state.physAcc >= PHYS_DT && guard < 8) {
      sim.step(PHYS_DT);
      state.physAcc -= PHYS_DT;
      guard++;
    }
    if (state.physAcc > PHYS_DT * 12) state.physAcc = PHYS_DT * 12;

    // 固定物理步长与显示帧率不同步会让人看到小球“一颤一颤”：
    // 在相邻两个物理步之间按剩余相位 alpha 插值出显示位置，保证运动平滑连续。
    const pr = sim.probe;
    const alpha = Math.min(1, state.physAcc / PHYS_DT);
    const px = pr.prevPos[0] + (pr.pos[0] - pr.prevPos[0]) * alpha;
    const py = pr.prevPos[1] + (pr.pos[1] - pr.prevPos[1]) * alpha;
    const pz = pr.prevPos[2] + (pr.pos[2] - pr.prevPos[2]) * alpha;

    // 大尺度瞬移检测与镜头刚体平移（含轨迹清空）在 camera-follow 内处理
    const audioLevels = audio && typeof audio.getLevels === 'function' ? audio.getLevels() : zeroAudio();
    const beat = Math.min(1, audioLevels.beat * state.musicIntensity);
    const energy = Math.min(1, audioLevels.energy * state.musicIntensity);
    const pulse = 1 + beat * 0.22 + energy * 0.10;

    particles.update(dtReal, audioLevels);
    // 大爆炸特效按**显示时间**推进：早期物理慢放（观赏倍率）不该把
    // 爆炸动画也拖长——爆炸就是一瞬间，与倍率无关
    explosion.update(state.time);
    structures.updateStructures(dtReal, audioLevels, pulse);
    // 先画远景成员点云（未发现的成员），再由 detail 点云叠加已发现的成员
    structures.updatePreviewClouds();
    structures.updateDetailVisuals(alpha);
    probeFx.update(dtReal, state, alpha);


    cameraFollow.update([px, py, pz], pr, alpha, dtReal, beat, trail);
    // 自由视角：OrbitControls 接管，双击聚焦（target 持续跟随小球）
    if (!state.follow) {
      controls.enabled = true;
      if (focusActive) {
        // 目标点每帧更新为小球当前显示位置——聚焦是"跟随"而非"飞向
        // 快照点"，小球一直在动，旧实现飞到快照就停、小球随后飞出画面。
        // 滚轮推进/拉远会打断（wheel 监听里 focusActive = false），
        // 用户之后可用滚轮自由接近。
        focusTarget.set(px, py, pz);
        controls.target.lerp(focusTarget, Math.min(1, dtReal * 5.0));
      }
      controls.update();
    }
    // 虫洞特效：probe.wormholeTimer > 0 时驱动全屏叠加层
    if (pr.wormholeTimer > 0) {
      const whDur = pr.wormholeDuration || 1.4;
      const elapsed = whDur - pr.wormholeTimer;
      wormholeOverlay.mat.uniforms.uProgress.value = Math.min(1, elapsed / whDur);
    } else {
      wormholeOverlay.mat.uniforms.uProgress.value = 0;
    }

    // 无限星空跟随相机：任何位置周围都是宇宙星空，不存在“跑出宇宙”。
    cosmicSky.position.copy(camera.position);
    starfield.position.copy(camera.position);
    nebulae.position.copy(camera.position);

    // 轨迹缎带在镜头定位后重建（始终朝向相机）
    trail.syncTrailRibbon();

    // 先渲染主场景（含辉光后处理），再叠加全屏爆炸闪光层与虫洞特效。
    // 降级时**不硬关 bloom**（硬关会让亮星/小球瞬间变暗——环境光"时亮
    // 时暗"的元凶之一），而是平滑降低强度：tier0 0.45 → tier1 0.30 →
    // tier2 0.18。背景（scene.background + cosmicSky）始终是恒定深黑，
    // 不随帧率/时间波动（FPS 自适应降级，见 §3.1）。
    bloomPass.enabled = true;
    bloomPass.strength = sim.config.qualityTier >= 2 ? 0.18 : sim.config.qualityTier === 1 ? 0.30 : 0.45;
    renderer.autoClear = true;
    composer.render();
    if (explosion.flashOverlay.mat.uniforms.uAlpha.value > 0.002) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(explosion.flashOverlay.scene, explosion.flashOverlay.camera);
    }
    if (wormholeOverlay.mat.uniforms.uProgress.value > 0.001) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(wormholeOverlay.scene, wormholeOverlay.camera);
    }
    renderer.autoClear = true;
  }

  return {
    render, resize, state, camera, scene, controls,
    setFollowEnabled(v) {
      if (state.follow && !v) {
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        controls.target.copy(camera.position).addScaledVector(fwd, 12);
        controls.update();
        controls.enabled = true;
        // 退出跟拍时把 FOV 收回基准，交给 OrbitControls 的滚轮控制
        camera.fov = 58;
        camera.updateProjectionMatrix();
      }
      // 切回跟拍时吸收当前相机方位角（2026-09-02 修复）：
      // 跟拍模式用 state.camAzimuth 恒定方位，若保持模块常量 -π/2，
      // 用户在自由模式任意旋转后切回跟拍，画面会"啪"地跳回东北视角。
      // 相机球坐标 camera = target - (sin az, ·, cos az)·horizM，
      // 反推 az = atan2(target.x - camera.x, target.z - camera.z)。
      if (v && !state.follow) {
        const dx = controls.target.x - camera.position.x;
        const dz = controls.target.z - camera.position.z;
        if (Math.hypot(dx, dz) > 1e-4) {
          state.camAzimuth = Math.atan2(dx, dz);
        }
      }
      state.follow = v;
      if (v) controls.enabled = false;
    },
    dispose() {
      controls.dispose();
      composer.dispose();
      bloomPass.dispose();
      renderer.dispose();
    },
  };
}


