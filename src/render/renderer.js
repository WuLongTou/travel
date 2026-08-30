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
  const CAM_PITCH = 0.60;          // 固定俯角 ≈34°，略抬高让轨迹走向更清晰
  const CAM_CRUISE_DIST = 55;      // 自由航行时的基准距离（更远，展现宇宙宏大与轨迹全貌）
  // 距离绝对上限：星系直径 130+，绕行半径 ~60 时需要 ~150 才能框住轨迹，
  // 上限必须覆盖"绕行大系统"的场景（防异常失真把镜头甩飞）
  const CAM_MAX_DIST = 320;
  const CAM_DIST_RATE = 0.10;      // 距离最大相对变化率 /s，消除"呼吸"（收紧自 0.35）
  // 极缓慢的镜头漂移（观赏性）：方位角恒定会让画面像张静止的照片，
  // 叠加一个幅度极小、周期很长的正弦，让画面"活着"但不干扰观察。
  // 幅度 1.7° / 周期约 5 分钟，远小于跟随速度方向造成的旋转，不会晕。
  const CAM_DRIFT_AZ = 0.030;      // 方位角漂移幅度（弧度，≈1.7°）
  const CAM_DRIFT_AZ_W = 0.021;    // 方位角漂移角频率（周期 ≈300s）
  const CAM_DRIFT_EL = 0.012;      // 俯角漂移幅度（弧度，≈0.7°）
  const CAM_DRIFT_EL_W = 0.013;    // 俯角漂移角频率（周期 ≈480s）

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
    camDist: CAM_CRUISE_DIST,  // 当前距离（向 wantDist 速率限幅逼近）
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

  // 粒子子系统（已提取到 render/particles.js，工厂返回 update）
  const particles = createParticles(scene, sim, state);
  // 轨迹子系统（已提取到 render/trail.js，工厂返回 pushTrail/syncTrail/clearTrail）
  const trail = createTrail(scene, sim, camera);

  // 小球视觉 + 死亡特效子系统（已提取到 render/probe-fx.js）
  const probeFx = createProbeFx(scene, sim, glowTex, ringTex, trail, camera);

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();

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
    {
      const jx = px - state._lastProbePos.x;
      const jy = py - state._lastProbePos.y;
      const jz = pz - state._lastProbePos.z;
      if (jx * jx + jy * jy + jz * jz > 100 * 100) {
        if (state.follow && state._focusInit) {
          controls.target.x += jx;
          controls.target.y += jy;
          controls.target.z += jz;
          state.orbitCenter.x += jx;
          state.orbitCenter.y += jy;
          state.orbitCenter.z += jz;
          trail.clearTrail();
        }
      }
      state._lastProbePos.set(px, py, pz);
    }

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

    // 虫洞特效：probe.wormholeTimer > 0 时驱动全屏叠加层
    if (pr.wormholeTimer > 0) {
      const whDur = pr.wormholeDuration || 1.4;
      const elapsed = whDur - pr.wormholeTimer;
      wormholeOverlay.mat.uniforms.uProgress.value = Math.min(1, elapsed / whDur);
    } else {
      wormholeOverlay.mat.uniforms.uProgress.value = 0;
    }

    if (state.follow) {
      controls.enabled = false;
      if (sim.time < 2.3) {
        // 智能镜头第一阶段：暴胀刚刚结束，宇宙还很空。
        // 镜头留在奇点附近，完整看到火球、冲击波和高速喷流。
        const ovAng = sim.time * 0.10;
        const overviewDist = 13 + sim.time * 9;
        _v2.set(
          Math.cos(ovAng) * overviewDist * 0.72,
          overviewDist * 0.50,
          Math.sin(ovAng) * overviewDist * 0.72,
        );
        _v3.set(0, 0, 0);
        const shake = Math.exp(-sim.time * 2.0) * 0.22;
        if (shake > 0.002) {
          _v2.x += Math.sin(sim.time * 83) * shake;
          _v2.y += Math.cos(sim.time * 77) * shake;
        }
        camera.position.lerp(_v2, Math.min(1, dtReal * 2.0));
        controls.target.lerp(_v3, Math.min(1, dtReal * 2.4));
        camera.lookAt(controls.target);
      } else {
        // ---- 轨迹优先的连续上帝视角（唯一自动镜头）----
        // 用户要求（按优先级）：
        //  ① 重点是看航行轨迹，不是看小球——自由飞行时也要把最近一段轨迹
        //    框进画面，而不是把视角锁死在小球周围那一小块；
        //  ② 镜头不得因小球/天体的运动产生旋转、翻转、突然位移：
        //     方位角/俯角恒定（仅极缓慢漂移）、无滚转、距离与视点全部
        //     连续变化且带速率限幅；
        //  ③ 没有模式机、没有滞回锁存——所有量都是连续函数，
        //     结构上不存在"切换瞬跳"这种事（旧实现的 cruise/interact/detail
        //     三模式与 orbitLock 锁存已全部移除）。
        const pv = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);

        // ==============================================================
        // 连续上帝视角的实现要点（历史教训都踩过）：
        //   ① 方位角是恒定标量（+极缓慢正弦漂移），任何速度方向绑定都会
        //      绕圈/翻面，绝对禁止；
        //   ② 视点/距离全部由连续函数给出，速率限幅，没有模式切换；
        //   ③ 相机位置永远 = 视点 + 球坐标偏移，距离恒等于 dist，
        //      结构上不可能贴脸、不可能翻转，up 恒为 +Y 无滚转；
        //   ④ 轨道尺度用真实天体距离，视点基准用平滑中心（见下）。
        // ==============================================================
        // --- 绕行天体（轨道中心）与轨道尺度 ---
        // 注意区分两个用途：
        //   · 轨道尺度（seedDist / sysR）必须用**真实天体距离**——用平滑中心算会在
        //     主导天体切换期间失真成"两天体间距"，把镜头拉到 100+（实测 107）。
        //   · 视点基准才用**平滑后的中心**，避免 influencer 切换那一帧视点瞬移
        //     （瞬移会让 lookAt 方向剧变，实测正是 500+°/s 甩镜的来源）。
        let sdX = px, sdY = py, sdZ = pz, seedDist = 0, sysR = 0;
        if (pr.influencer >= 0) {
          const s = sim.seeds[pr.influencer];
          sdX = s.pos[0]; sdY = s.pos[1]; sdZ = s.pos[2];
          seedDist = Math.hypot(px - sdX, py - sdY, pz - sdZ);
          sysR = sim._systemRadius(s);
        }
        _v4.set(sdX, sdY, sdZ);
        if (!state._focusInit) {
          state.orbitCenter.copy(_v4);
          state._focusInit = true;
        } else {
          // 限速逼近：速度与镜头距离成比例 → 朝向角速度有界
          const maxSpeed = Math.max(6, state.camDist * 0.5) * dtReal;
          const ddx = _v4.x - state.orbitCenter.x;
          const ddy = _v4.y - state.orbitCenter.y;
          const ddz = _v4.z - state.orbitCenter.z;
          const ddl = Math.hypot(ddx, ddy, ddz);
          if (ddl > 1e-6) {
            const kk = Math.min(1, maxSpeed / ddl);
            state.orbitCenter.x += ddx * kk;
            state.orbitCenter.y += ddy * kk;
            state.orbitCenter.z += ddz * kk;
          }
        }
        const cX = state.orbitCenter.x;
        const cY = state.orbitCenter.y;
        const cZ = state.orbitCenter.z;

        // ---- 连续上下文权重 w（取代旧的 orbitLock 滞回锁存）----
        // 三个信号与旧实现相同：
        //   ① orbitTangent（切向速度占比）：圆轨道 ≈1，对慢速大圈同样灵敏；
        //   ② orbitAngleAcc：对快速小圈灵敏；
        //   ③ 距离窗口（1.8R~3.6R）：只有贴近该系统才算，远处直线飞行不误判。
        // 不再做"去噪→阈值→锁存"的三级处理——那是二值状态机的必然复杂度，
        // 连续量用双时间常数平滑即可：进入 2.5s、退出 6s（时间常数本身就
        // 承担了去噪，比旧的 0.8s 噪声窗慢得多）。滞回锁存想解决的
        // "半跟随中间态"问题是锁存特有的病，连续量天然不存在。
        const nearFactor = sysR > 0 ? 1 - smoothstep(sysR * 1.8, sysR * 3.6, seedDist) : 0;
        const tangentFactor = smoothstep(0.35, 0.70, pr.orbitTangent || 0);
        const angleFactor = smoothstep(0.25, 1.20, pr.orbitAngleAcc || 0);
        const orbitRaw = pr.influencer >= 0 ? Math.max(tangentFactor, angleFactor) * nearFactor : 0;
        const orbitTau = orbitRaw > state.orbitFactor ? 2.5 : 6.0;
        state.orbitFactor += (orbitRaw - state.orbitFactor) * Math.min(1, dtReal / orbitTau);
        const w = state.orbitFactor;

        // --- 方位角：恒定，永不跟随小球旋转 ---
        // 这是用户明确要求：**任何时候都不跟随小球旋转**。
        // 若让方位角追速度方向，镜头会一直待在小球正后方，画面里小球永远
        // "朝前飞"，观感上就成了直线运行，反而看不出它在转弯、被引力拉偏。
        // 方位角固定后，小球转向时是背景星空与天体在画面里滑动，
        // 轨迹的弯曲、绕圈的走向都一目了然。
        // （camAzimuth 因此只在初始化时定一次，之后不再改动）
        const tsBoost = Math.max(0.3, Math.sqrt(state.timeScale));

        // --- 平滑速度向量（视点前向偏置用）---
        // 直接用瞬时速度会让视点跟着小球的每一次引力抖动晃；
        // 用 ~1.6s 时间常数的指数平滑，急转弯时视点也只是缓慢地往前挪。
        if (pv > 0.02) {
          _v1.set(pr.vel[0], pr.vel[1], pr.vel[2]);
          state.velSmooth.lerp(_v1, Math.min(1, dtReal / 1.6));
        } else {
          state.velSmooth.multiplyScalar(Math.max(0, 1 - dtReal / 1.2));
        }
        const vsLen = state.velSmooth.length();

        // ---- 视点：小球 → 系统中心的连续加权 + 前向偏置 ----
        // 直线飞行时 w≈0 → 视点在小球后方；绕行时 w→1 → 视点几乎钉在轨道中心，
        // 镜头不动，整条轨迹圆留在画面里。用的是**平滑后的中心** cX/cY/cZ。
        // 前向偏置：沿平滑速度方向前移 1.25s 的行程（上限 32% 距离）——
        // 小球被推到画面后侧，轨迹在身前铺开（重点看轨迹与宇宙，不盯小球）。
        const orbitPull = w * 0.9;
        let fX = px + (cX - px) * orbitPull;
        let fY = py + (cY - py) * orbitPull;
        let fZ = pz + (cZ - pz) * orbitPull;
        const biasCap = state.camDist * 0.32;
        const biasK = vsLen > 1e-4 ? Math.min(1, biasCap / (vsLen * 1.25)) : 0;
        fX += state.velSmooth.x * 1.25 * biasK;
        fY += state.velSmooth.y * 1.25 * biasK;
        fZ += state.velSmooth.z * 1.25 * biasK;

        // ---- 距离：三层取最大，全部连续 ----
        const fovRad = (camera.fov * Math.PI) / 180;
        // ① 滑杆基准距离
        const zoomBase = Math.max(6, sim.config.camZoom || CAM_CRUISE_DIST);
        let wantDist = zoomBase;
        // ② 绕行时按轨道半径拉远（×2.4 覆盖直径并留边距），随 w 连续混合
        if (seedDist > 0) {
          const orbitDist = seedDist * 2.4 + sysR * 0.8;
          wantDist = Math.max(zoomBase, orbitDist * w + zoomBase * (1 - w));
        }
        // ③ 轨迹感知框距：让最近一段轨迹始终完整入画。
        //    （trail 提取后 trailCount/trailPos 已封装到 render/trail.js；
        //     后续需要时由 trail 子系统提供 getBounds() 替代此内联计算。）
        // 绝对上限：主导天体切换等异常时刻 seedDist 可能瞬时失真，
        // 不封顶会把镜头拉到 100+，位置剧变 → 朝向剧变
        wantDist = Math.min(wantDist, CAM_MAX_DIST);
        // 速率限幅：距离每秒相对变化不超过 CAM_DIST_RATE，消除"呼吸"
        const maxDDelta = Math.max(state.camDist, 1) * CAM_DIST_RATE * dtReal;
        state.camDist += Math.max(-maxDDelta, Math.min(maxDDelta, wantDist - state.camDist));

        // 全局方位角：初始化后恒定不变（不跟随小球旋转，见上文）
        // 方位角 = 恒定基准 + 极缓慢漂移（漂移只影响显示，与物理无关）
        const az = state.camAzimuth + CAM_DRIFT_AZ * Math.sin(state.time * CAM_DRIFT_AZ_W);
        const pitch = CAM_PITCH + CAM_DRIFT_EL * Math.sin(state.time * CAM_DRIFT_EL_W);

        // ---- 相机位置：统一球坐标 (方位角, 俯角, 距离)，无除法无分支 ----
        // 相机挂在视点上，与视点距离恒为 dist：结构上不可能贴脸、不可能翻转；
        // 方位角与俯角恒定，距离变化只改变远近不改变朝向。
        const dist = state.camDist;
        const horizM = dist * Math.cos(pitch);

        // ---- 视点 = f + 屏幕空间平移偏移 ----
        // 平移沿相机右方向 / 上方向，小球随之偏离画面中心。两重保护确保
        // 高速运动时不丢失小球：
        //   ① 偏移上限与距离成比例（≤35% dist），物理上推不出画面；
        //   ② 速率 >25 后按速率线性收回，>65 时完全回到跟踪中心。
        const recover = 1 - Math.min(1, Math.max(0, (pv - 25) / 40));
        const panLim = dist * 0.35;
        const panX = Math.max(-panLim, Math.min(panLim, (sim.config.camPanX || 0) * recover));
        const panY = Math.max(-panLim, Math.min(panLim, (sim.config.camPanY || 0) * recover));
        // 暴露实际生效的平移量（含钳制与高速收回），便于验证与调试
        state.camPanApplied[0] = panX;
        state.camPanApplied[1] = panY;
        // right = (-cos az, 0, sin az) ；up = right × forward
        const rx = -Math.cos(az);
        const rz = Math.sin(az);
        const ux = Math.sin(az) * Math.sin(pitch);
        const uy = Math.cos(pitch);
        const uz = Math.cos(az) * Math.sin(pitch);
        _v3.set(
          fX + rx * panX + ux * panY,
          fY + uy * panY,
          fZ + rz * panX + uz * panY,
        );

        // 先平滑视点，再由"视点 + 球坐标偏移"推出相机位置。
        // 关键：不能让相机位置与视点各自独立 lerp —— 视点快速移动时（主导天体
        // 切换、小球急转）相机追不上，两者会挤到一起（实测 camDist 缩到 4.1），
        // 此时极小的位移就能让 lookAt 方向爆炸（实测 1036°/s）。
        // 相机挂在视点上后，两者距离恒为 dist，结构上不可能贴脸。
        const tgtK = Math.min(0.12, dtReal * (3.2 + pv * 0.10) * tsBoost);
        controls.target.lerp(_v3, tgtK);
        // 相机位置直接由"视点 + 球面偏移"给出，不再对位置做 lerp：
        // 位置 lerp 会滞后（视点移动越快滞后越大），实测距离一度失控到 139
        // （而距离上限是 90），距离失控时 lookAt 对微小位移极度敏感。
        // 这里距离恒等于 dist，视点/方位角/距离三者本身都已平滑，运动仍然连续。
        camera.position.set(
          controls.target.x - Math.sin(az) * horizM,
          controls.target.y + dist * Math.sin(pitch),
          controls.target.z - Math.cos(az) * horizM,
        );
        camera.lookAt(controls.target);
      }
    } else {
      controls.enabled = true;
      // 双击聚焦：观察目标平滑飞向小球，飞近后停止（用户可继续滚轮靠近）
      if (focusActive) {
        controls.target.lerp(focusTarget, Math.min(1, dtReal * 5.0));
        if (controls.target.distanceTo(focusTarget) < 1.0) focusActive = false;
      }
      controls.update();
    }

    // 无限星空跟随相机：任何位置周围都是宇宙星空，不存在“跑出宇宙”。
    cosmicSky.position.copy(camera.position);
    starfield.position.copy(camera.position);
    nebulae.position.copy(camera.position);

    // 速度感 FOV：速度越快视野略放大，制造"冲刺"的张力；节拍再叠加轻微呼吸。
    // 仅在跟拍模式下生效；自由观察时由 OrbitControls 的滚轮控制远近。
    if (state.follow) {
      const pvFov = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      const targetFov = 58 + Math.min(16, pvFov * 0.5) + beat * 1.5;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dtReal * 3.0);
      camera.updateProjectionMatrix();
    }

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


