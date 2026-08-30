// 宇宙大爆炸模拟 · 渲染域主模块
// createCosmosRenderer：场景/渲染器/后处理/镜头/主循环。
// 目录梳理：纹理、配色、星空、全屏叠加层已拆到同级模块（textures/colors/sky/overlays）。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { randomUnit, clamp01, smoothstep, easeInOut, orbitPolar, hash01 } from '../core/utils.js';
import { COLLECTION_LEVELS } from '../core/config.js';
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
  renderer.toneMappingExposure = 1.25;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020409);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.04, 10000);
  camera.position.set(0, 2.4, 9);

  // ---- 后处理辉光（UnrealBloom）：真实宇宙的"发光"质感 ----
  // 阈值调低、强度温和：让恒星/星云/小球/轨迹都带上柔光，而不是只有高光爆白。
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55,   // strength 强度（之前 0.85 太强，把 820 粒子点云 + 1640 条流线的
            //   additive 光晕扩散成白雾；0.55 保留恒星/黑洞/小球的发光质感）
    0.55,   // radius 半径
    0.55,   // threshold 阈值（之前 0.30 太低，粒子/流线的中亮度也触发 bloom
            //   导致远景叠加成雾；0.55 只让恒星/黑洞/小球等真亮天体触发）
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

  // 自由视角 · 双击聚焦小球：双击画布把观察目标平滑飞向小球，
  // 之后可用滚轮继续靠近仔细观察（解决"远距离无法自主靠近"）。
  const focusTarget = new THREE.Vector3();
  let focusActive = false;
  canvas.addEventListener('dblclick', () => {
    if (state.follow) return; // 仅在自由视角下生效
    focusTarget.set(sim.probe.pos[0], sim.probe.pos[1], sim.probe.pos[2]);
    focusActive = true;
  });

  const cosmicSky = createCosmicSky();
  scene.add(cosmicSky);
  const starfield = createStarfield();
  scene.add(starfield);


  // ---------- 大爆炸专用精灵 ----------
  const glowTex = makeGlowTexture();
  const ringTex = makeRingTexture();
  function makeSprite(map, color) {
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map, color, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, depthTest: false,
    }));
  }

  // 天体结构 + 成员点云子系统（已提取到 render/structures.js）
  const structures = createStructures(scene, sim, glowTex, ringTex, camera);
  // 远星云层：跟随相机，给"真实宇宙"补上色深与纵深
  const nebulae = createNebulae(glowTex);
  scene.add(nebulae);
  // 大爆炸特效子系统（已提取到 render/explosion.js，工厂返回 update + flashOverlay）
  const explosion = createExplosionFx(scene, glowTex);


  // ---------- 天体结构（每个暗物质晕一组） ----------


  // ---- 运动轨迹（发光渐细缎带）----
  // 用相机朝向的三角带(ribbon)替代 1px 细线：带宽随"旧→新"从尾到头渐宽、
  // 亮度渐亮，配合加色混合与 bloom 辉光，呈现"彗尾/光迹"的质感。
  // 缎带始终正对相机，轨迹的弯曲、绕圈走向一览无余。

  // 虫洞特效叠加层
  const wormholeOverlay = createWormholeOverlay();
  let lastWormhole = 0; // 记录已处理的虫洞触发次数

  // 巡航镜头（cruise）常量：轨道视角，远远看轨迹 + 镜头稳定
  // 启动快进（显示层）：开局这段真实秒数内用高倍率把宇宙推进到已成形。
  // 参数放在 sim.config 里，便于调参与测试（测试可置 0 排除干扰）。

  // 上帝视角：镜头拉远、俯角抬高，且方位角恒定（不跟随小球旋转）

  const state = {
    // timeScale **只是显示层的缩放系数**（详见 render() 中的物理量/显示量说明），
    // 不参与引力与任何受力计算，物理子步长与轨道结果都不随之改变。
    // 默认 0.05：物理终端速度约 33 单位/秒 → 观感约 1.65 单位/秒，
    // 穿过直径 60 的星系约 36 秒，从容看清旋臂与成员。
    // 注意 main.js 的滑杆会在启动时再次同步，HTML 里的 value 才是真正生效值。
    time: 0, timeScale: 0.05, musicIntensity: 1, follow: true,
    physAcc: 0,
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

  // 轨迹采样节流：不必每帧一个点（60fps 下 750 点只有 12 秒），

  // 速率 → 颜色：慢=冷青蓝，快=暖橙金。配合加色混合，越暗越透明，
  // 于是"淡出"直接靠把颜色乘向黑色实现。

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
    // 启动快进：开局用高倍率把宇宙推进到"结构已成形"，再回落到观赏倍率慢速航行。
    // 若全程都用观赏倍率(0.08)，宇宙演化也会被拖慢 12.5 倍 —— 光是等引力拉满
    // (GRAVITY_FULL=5.6 物理秒) 就要 70 秒真实时间，开场会很无聊。
    // 两个阶段用的都是**同一个显示层系数机制**（只换算物理时间增量），
    // 不触碰任何物理公式与子步长。
    const bootWall = sim.config.bootFastForwardWall;
    const bootScale = sim.config.bootFastForwardScale;
    const booting = state.time < bootWall && bootScale > state.timeScale;
    const scale = booting ? bootScale : state.timeScale;
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

    // 大尺度瞬移检测（虫洞跃迁/重生把小球瞬移到远方）：跟拍模式下把镜头
    // **整体刚体平移**同样的位移量——纯平移不改变任何朝向（正是"不旋转、
    // 不翻转"的要求），星空背景跟随相机，视觉上只有前景天体瞬间切换；
    // 平滑轨道中心一起搬，避免它以限速慢慢滑行 480 单位拖动视点。
    // 同时清空轨迹，避免一根跨越几百单位的"跃迁直线"污染轨迹框距。

    const audioLevels = audio && typeof audio.getLevels === 'function' ? audio.getLevels() : zeroAudio();
    const beat = Math.min(1, audioLevels.beat * state.musicIntensity);
    const energy = Math.min(1, audioLevels.energy * state.musicIntensity);
    const pulse = 1 + beat * 0.22 + energy * 0.10;

    particles.update(dtReal, audioLevels);
    explosion.update(sim.time);
    structures.updateStructures(dtReal, audioLevels, pulse);
    // 先画远景成员点云（未发现的成员），再由 detail 点云叠加已发现的成员
    structures.updatePreviewClouds();
    structures.updateDetailVisuals(alpha);
    probeFx.update(dtReal, state, alpha);


    cameraFollow.update([px, py, pz], pr, alpha, dtReal, beat);
    // 自由视角：OrbitControls 接管，双击聚焦（target 平滑飞向小球）
    if (!state.follow) {
      controls.enabled = true;
      if (focusActive) {
        controls.target.lerp(focusTarget, Math.min(1, dtReal * 5.0));
        if (controls.target.distanceTo(focusTarget) < 1.0) focusActive = false;
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

    // 速度感 FOV：速度越快视野略放大，制造"冲刺"的张力；节拍再叠加轻微呼吸。
    // 仅在跟拍模式下生效；自由观察时由 OrbitControls 的滚轮控制远近。

    // 轨迹缎带在镜头定位后重建（始终朝向相机）
    trail.syncTrailRibbon();

    // 先渲染主场景（含辉光后处理），再叠加全屏爆炸闪光层与虫洞特效。
    // 降级时**不硬关 bloom**（硬关会让亮星/小球瞬间变暗——环境光"时亮
    // 时暗"的元凶之一），而是平滑降低强度：tier0 0.85 → tier1 0.5 →
    // tier2 0.28。背景（scene.background + cosmicSky）始终是恒定深黑，
    // 不随帧率/时间波动（FPS 自适应降级，见 §3.1）。
    bloomPass.enabled = true;
    bloomPass.strength = sim.config.qualityTier >= 2 ? 0.20 : sim.config.qualityTier === 1 ? 0.35 : 0.55;
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
    stars: [], ripples: [],
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


