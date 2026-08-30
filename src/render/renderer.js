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
  // 远星云层：跟随相机，给"真实宇宙"补上色深与纵深
  const nebulae = createNebulae(glowTex);
  scene.add(nebulae);
  // 大爆炸特效子系统（已提取到 render/explosion.js，工厂返回 update + flashOverlay）
  const explosion = createExplosionFx(scene, glowTex);


  // ---------- 天体结构（每个暗物质晕一组） ----------
  const seedGroups = [];
  for (const s of sim.seeds) {
    const group = new THREE.Group();
    group.position.set(s.pos[0], s.pos[1], s.pos[2]);
    const m4 = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
      new THREE.Vector3(s.v[0], s.v[1], s.v[2]),
      new THREE.Vector3(s.axis[0], s.axis[1], s.axis[2]),
    );
    group.quaternion.setFromRotationMatrix(m4);

    // 每个天体的确定性色调偏移（宇宙多样性）：同类系统颜色各异。
    // 黑洞吸积盘偏暖、星系偏蓝紫——偏移幅度克制，不破坏类型辨识度。
    group.hueShift = (hash01(s.idx * 3 + 1) - 0.5) * 0.14;
    group.satShift = (hash01(s.idx * 5 + 7) - 0.5) * 0.16;
    group.lightShift = (hash01(s.idx * 7 + 13) - 0.5) * 0.10;

    const solid = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    solid.renderOrder = 5;
    group.add(solid);

    const core = makeSprite(glowTex, 0x8f9bb8);
    core.renderOrder = 6;
    group.add(core);

    const halo = makeSprite(glowTex, 0x6c8cff);
    halo.renderOrder = 3;
    group.add(halo);

    const disk = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1.55, 96),
      new THREE.MeshBasicMaterial({
        color: 0x6c8cff, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    disk.renderOrder = 4;
    group.add(disk);

    // 吸积盘：扁平的等离子体盘（shader 而非贴图）。内缘白热、外缘红冷
    // （真实温度梯度），并带多普勒增亮——盘绕黑洞旋转，一侧物质朝观察者
    // 接近而更亮、另一侧远离而更暗。几何在赤道面，随黑洞自转旋转。
    const accretionDisk = new THREE.Mesh(
      new THREE.RingGeometry(2.0, 6.0, 128),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uInner: { value: 2.0 },
          uOuter: { value: 6.0 },
        },
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vPos;
          uniform float uInner;
          uniform float uOuter;
          void main() {
            vec2 p = vPos.xy;
            float r = length(p);
            float ang = atan(p.y, p.x);
            // 盘边缘软化
            float innerEdge = smoothstep(uInner, uInner * 1.06, r);
            float outerEdge = 1.0 - smoothstep(uOuter * 0.80, uOuter, r);
            float edge = innerEdge * outerEdge;
            // 温度梯度：内缘(白热) → 外缘(橙红暗)
            float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
            // 多普勒增亮：朝观察者转动的一侧更亮
            float doppler = 0.58 + 0.42 * sin(ang);
            float brightness = mix(1.0, 0.10, t) * doppler;
            vec3 hot = vec3(1.0, 0.90, 0.78);
            vec3 cool = vec3(1.0, 0.42, 0.12);
            vec3 col = mix(hot, cool, t) * brightness;
            float a = edge * (0.2 + 0.8 * clamp(brightness, 0.0, 1.0));
            if (a < 0.012) discard;
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
    );
    accretionDisk.renderOrder = 7;
    group.add(accretionDisk);

    // 光子环（爱因斯坦环）：引力透镜把背景光弯成的一圈细亮环，紧贴
    // 事件视界外侧——黑洞最标志性的视觉特征，也是"引力透镜"的直观呈现。
    const photonRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.022, 16, 160),
      new THREE.MeshBasicMaterial({
        color: 0xfff4e6, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    photonRing.renderOrder = 8;
    group.add(photonRing);

    // 相对论喷流：粒子流而非实心圆锥（真实 AGN 喷流是一束等离子体）。
    // 粒子沿自转轴分布、径向缓慢张开；**长度有限**——亮度在远端按
    // (1-t)^1.6 自然衰减到零，喷流在末端消散，而非无限延伸。
    const JET_N = 56;
    const jetPosArr = new Float32Array(JET_N * 3);
    const jetColArr = new Float32Array(JET_N * 3);
    for (let i = 0; i < JET_N; i++) {
      const t = Math.pow(Math.random(), 1.5);          // 偏向喷口，远处稀疏
      const z = 0.5 + t * 2.2;                        // 沿 +Z 轴向外（有限长度）
      const spread = 0.05 + t * 0.42;                 // 缓慢张开的准直束
      const a = Math.random() * Math.PI * 2;
      const rr = spread * Math.sqrt(Math.random());
      jetPosArr[i * 3] = Math.cos(a) * rr;
      jetPosArr[i * 3 + 1] = Math.sin(a) * rr;
      jetPosArr[i * 3 + 2] = z;
      // 远端自然消散：亮度随 (1-t) 衰减到零，喷流尽头不是硬截断而是淡出
      const fade = Math.pow(1 - t, 1.6) * (0.7 + Math.random() * 0.5);
      jetColArr[i * 3] = 0.78 * fade;
      jetColArr[i * 3 + 1] = 0.86 * fade;
      jetColArr[i * 3 + 2] = 1.0 * fade;
    }
    const jetGeo = new THREE.BufferGeometry();
    jetGeo.setAttribute('position', new THREE.BufferAttribute(jetPosArr, 3));
    jetGeo.setAttribute('color', new THREE.BufferAttribute(jetColArr, 3));
    const jetMat = new THREE.PointsMaterial({
      size: 0.34, sizeAttenuation: true, vertexColors: true,
      color: 0xc6d8ff, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const jetA = new THREE.Points(jetGeo, jetMat);
    jetA.renderOrder = 9;
    const jetB = new THREE.Points(jetGeo, jetMat);
    jetB.rotation.z = Math.PI; // 镜像到 -Z：喷流成对（自转轴两极）
    jetB.renderOrder = 9;
    group.add(jetA, jetB);

    // 超星系团的伴星系亮核
    const nodes = [];
    for (let n = 0; n < 6; n++) {
      const nd = makeSprite(glowTex, 0x8e6bff);
      const a = (n / 6) * Math.PI * 2;
      const rr = 2.3 + (n % 3) * 0.95;
      nd.position.set(Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 0);
      nd.scale.setScalar(0.25);
      nd.renderOrder = 6;
      group.add(nd);
      nodes.push(nd);
    }

    seedGroups.push({
      group, solid, core, halo, disk, accretionDisk, photonRing, jetA, jetB, nodes,
      coreScale: 0.5, diskAmt: 0, bhAmt: 0, nodeAmt: 0, diskAngle: Math.random() * Math.PI * 2,
      level: 'void',
    });
    scene.add(group);
  }

  // ---------- 流式细节：只有小球接近大系统时才创建内部星体 ----------
  const detailVisuals = new Map();

  // ---- 远景成员点云（§5.2 渐进发现的远景表达）----
  // 集合系统成熟后不再被渲染成"一个发光天体"：把确定性成员布局画成一团
  // 小光点，远处看到的就是"很多个天体"组成的星系 / 星团形状。
  // 小球靠近后成员被逐个发现：发现完成的成员由 detail 点云接管渲染，
  // 预览点随 revealT 淡出。两者共用同一位置，所以是无缝升级，不是重影。
  const PREVIEW_CULL = 1500; // 超出这个距离直接不画（远景已不可辨）
  const previewVisuals = new Map(); // s.idx -> { points, geo, mat, pos, size, base, layoutId }
  function updatePreviewClouds() {
    for (const s of sim.seeds) {
      let v = previewVisuals.get(s.idx);
      const eligible = COLLECTION_LEVELS.has(s.level) && s.growth > 0.55;
      const layout = eligible ? sim._memberLayout(s) : null;
      if (!layout) {
        if (v) v.points.visible = false;
        continue;
      }
      if (!v || v.layoutId !== s._layoutId) {
        if (v) { scene.remove(v.points); v.geo.dispose(); v.mat.dispose(); }
        const n = layout.length;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const base = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const m = layout[i];
          const tint = m.colorSeed;
          // 结构层越靠内越小越暗：远处也能读出"旋臂 / 核球"的层次
          const layer = 1 - (m.tier || 0) * 0.22;
          if (m.type === 'star') {
            // 与近景一致的光温三段：蓝白(年轻) / 黄白 / 橙红(老年)，暗化版
            if (tint < 0.28) {
              col[i * 3] = 0.62; col[i * 3 + 1] = 0.76; col[i * 3 + 2] = 1.0;
            } else if (tint < 0.68) {
              col[i * 3] = 0.95; col[i * 3 + 1] = 0.82; col[i * 3 + 2] = 0.58;
            } else {
              col[i * 3] = 0.95; col[i * 3 + 1] = 0.55; col[i * 3 + 2] = 0.33;
            }
            base[i] = (0.10 + tint * 0.10) * layer;
          } else if (m.type === 'blackhole' || m.type === 'galaxy') {
            col[i * 3] = 0.62; col[i * 3 + 1] = 0.70; col[i * 3 + 2] = 1.0;
            base[i] = 0.16 * layer;
          } else if (m.type === 'asteroid') {
            // 小行星：暗岩石色，远读为一条淡淡的带
            col[i * 3] = 0.46 + tint * 0.10; col[i * 3 + 1] = 0.41 + tint * 0.08; col[i * 3 + 2] = 0.36 + tint * 0.06;
            base[i] = 0.035 * layer;
          } else {
            col[i * 3] = 0.50 + tint * 0.25; col[i * 3 + 1] = 0.35 + tint * 0.25; col[i * 3 + 2] = 0.85 + tint * 0.15;
            base[i] = (0.05 + tint * 0.04) * layer;
          }
        }
        const size = new Float32Array(base);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        // 与细节点云同款着色器，但带最小像素钳制与远距离补偿：
        // 极远处每个成员仍是可感知的光点，上百个成员融成"星系光雾"
        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
          uniforms: { uFade: { value: 1 }, uMinPx: { value: 1.15 }, uBoost: { value: 0 } },
          vertexShader: `
            attribute float aSize;
            uniform float uMinPx;
            uniform float uBoost;
            varying vec3 vColor;
            void main() {
              vColor = color;
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              float px = aSize * (620.0 / max(1.0, -mv.z));
              gl_PointSize = max(uMinPx * (1.0 + uBoost * 1.8), px * (1.0 + uBoost * 2.2));
              gl_Position = projectionMatrix * mv;
            }
          `,
          fragmentShader: `
            uniform float uFade;
            uniform float uBoost;
            varying vec3 vColor;
            void main() {
              float d = length(gl_PointCoord - 0.5) * 2.0;
              float a = (1.0 - smoothstep(0.08, 1.0, d)) * (0.55 + 0.45 * uBoost) * uFade;
              if (a < 0.01) discard;
              gl_FragColor = vec4(vColor * 0.85, a);
            }
          `,
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.renderOrder = 4;
        scene.add(points);
        v = { points, geo, mat, pos, size, base, layoutId: s._layoutId };
        previewVisuals.set(s.idx, v);
      }
      // ---- 每帧写入世界坐标（points 本体留在原点）----
      const n = Math.min(layout.length, v.size.length);
      const pos = v.pos, size = v.size, base = v.base;
      const det = s.detail;
      if (det) {
        // detail 已激活：直接取真实 body 的位置（同步轨道 / 动力学偏移），
        // 已发现的成员随 revealT 淡出，把画面交给 detail 点云
        const nb = Math.min(n, det.bodies.length);
        for (let i = 0; i < nb; i++) {
          const b = det.bodies[i];
          pos[i * 3] = b.pos[0]; pos[i * 3 + 1] = b.pos[1]; pos[i * 3 + 2] = b.pos[2];
          size[i] = b.revealed ? base[i] * (1 - clamp01(b.revealT)) : base[i];
        }
      } else {
        // 无 detail：静态布局 + 与 detail 同公式的自转
        //（angle = 布局起始角 + layoutSpin × speed），交接瞬间不跳变；
        // 椭圆轨道同样经 orbitPolar 求真近点角与半径
        const spin = s._layoutSpin || 0;
        for (let i = 0; i < n; i++) {
          const m = layout[i];
          if (m.orbit) {
            const ang = m.orbit.angle + spin * m.orbit.speed;
            const pol = orbitPolar(m.orbit, ang);
            const c = Math.cos(pol[0]), sn = Math.sin(pol[0]);
            const rEff = pol[1];
            pos[i * 3] = s.pos[0] + s.u[0] * c * rEff + s.v[0] * sn * rEff + s.axis[0] * m.orbit.height;
            pos[i * 3 + 1] = s.pos[1] + s.u[1] * c * rEff + s.v[1] * sn * rEff + s.axis[1] * m.orbit.height;
            pos[i * 3 + 2] = s.pos[2] + s.u[2] * c * rEff + s.v[2] * sn * rEff + s.axis[2] * m.orbit.height;
          } else {
            pos[i * 3] = s.pos[0]; pos[i * 3 + 1] = s.pos[1]; pos[i * 3 + 2] = s.pos[2];
          }
          size[i] = base[i];
        }
      }
      v.geo.attributes.position.needsUpdate = true;
      v.geo.attributes.aSize.needsUpdate = true;
      // ---- 三段式表达（真实的层级连续体，用户明确要求）----
      //   远（cd > ~4.5×dr）：星系是"一个"天体——成员点云整体淡出，
      //     只剩 halo/core 光斑（极远处分辨不出旋臂与星点，就是一团光）
      //   中（1.4×dr < cd < 4.5×dr）：光斑随小球接近而退场，成员点云
      //     浮现——看到的是"一群恒星"，"星系"这个整体已经看不见了
      //   近（cd < 1.4×dr）：只剩身边的天体，航线经过谁、谁才显形
      // uBoost 只服务中段（远处点云反正要淡出，不再需要远距补偿）
      const dr = sim._detailRadius(s) || sim._systemRadius(s);
      const cd = Math.hypot(
        camera.position.x - s.pos[0],
        camera.position.y - s.pos[1],
        camera.position.z - s.pos[2],
      );
      const farFade = 1 - smoothstep(dr * 3.2, dr * 4.5, cd);
      v.mat.uniforms.uBoost.value = clamp01((cd - dr * 1.5) / (dr * 2.5)) * farFade;
      v.mat.uniforms.uFade.value = smoothstep(0.5, 0.7, s.growth) * farFade;
      v.points.visible = v.mat.uniforms.uFade.value > 0.01 && cd < PREVIEW_CULL;
    }
  }

  function updateDetailVisuals(alpha) {
    for (const s of sim.seeds) {
      let v = detailVisuals.get(s.idx);
      if (s.detail) {
        const bodies = s.detail.bodies;
        if (!v) {
          // 预留二级系统槽位：靠近恒星后生成的行星/卫星与行星环粒子
          // 追加写入同一点云（环粒子较多，槽位给足）
          const CHILD_CAP = 340; // 子星系恒星 + 行星环/二级行星的槽位预算
          const cap = bodies.length + CHILD_CAP;
          const geo = new THREE.BufferGeometry();
          const pos = new Float32Array(cap * 3);
          const col = new Float32Array(cap * 3);
          const size = new Float32Array(cap);
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
          geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
          const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
            vertexShader: `
              attribute float aSize;
              varying vec3 vColor;
              void main() {
                vColor = color;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (620.0 / max(1.0, -mv.z));
                gl_Position = projectionMatrix * mv;
              }
            `,
            fragmentShader: `
              varying vec3 vColor;
              void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                float a = (1.0 - smoothstep(0.08, 1.0, d)) * 0.9;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vColor, a);
              }
            `,
          });
          const points = new THREE.Points(geo, mat);
          points.frustumCulled = false;
          points.renderOrder = 5;
          scene.add(points);
          v = { points, geo, mat, pos, col, size };
          detailVisuals.set(s.idx, v);
        }
        const pos = v.pos, col = v.col, size = v.size;
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];
          // 未发现的天体真正不可见：发现是逐个、由小球行进驱动的
          if (b._hidden) {
            size[i] = 0;
            continue;
          }
          // 发现出场：天体停在它真实的轨道位置上原地淡入——
          // 远景成员点云早已把它画在那里，所以"发现"是看清，不是凭空出现
          // （revealT 由 sim 侧按天体推进，与全系统距离无关）
          const fadeIn = clamp01(b.revealT ?? 1);
          const ease = easeInOut(fadeIn);
          if (b.orbit) {
            // 在相邻两个物理步之间插值轨道角（平近点角），让绕行天体平滑运动；
            // 椭圆轨道经 orbitPolar 求真近点角与半径（对 θ 插值天然连续）
            const ang = b.prevAngle + (b.orbit.angle - b.prevAngle) * alpha;
            const pol = orbitPolar(b.orbit, ang);
            const c = Math.cos(pol[0]), sn = Math.sin(pol[0]);
            const rEff = pol[1];
            // 动力学微扰偏移（§9.7）与 sim 侧保持一致；叠加出场半径系数
            const bx = (b.boff ? b.boff[0] : 0), by = (b.boff ? b.boff[1] : 0), bz = (b.boff ? b.boff[2] : 0);
            pos[i * 3] = s.pos[0] + s.u[0] * c * rEff + s.v[0] * sn * rEff + s.axis[0] * b.orbit.height + bx;
            pos[i * 3 + 1] = s.pos[1] + s.u[1] * c * rEff + s.v[1] * sn * rEff + s.axis[1] * b.orbit.height + by;
            pos[i * 3 + 2] = s.pos[2] + s.u[2] * c * rEff + s.v[2] * sn * rEff + s.axis[2] * b.orbit.height + bz;
          } else {
            pos[i * 3] = b.pos[0]; pos[i * 3 + 1] = b.pos[1]; pos[i * 3 + 2] = b.pos[2];
          }
          const tint = b.colorSeed;
          if (b.type === 'gas') {
            col[i * 3] = 0.50 + tint * 0.25;
            col[i * 3 + 1] = 0.35 + tint * 0.25;
            col[i * 3 + 2] = 0.85 + tint * 0.15;
            size[i] = 0.10 + tint * 0.08;
          } else if (b.type === 'star') {
            // 恒星光温分层：蓝白 → 黄白 → 橙红，"满天星"的层次感
            if (tint < 0.28) {
              col[i * 3] = 0.72; col[i * 3 + 1] = 0.84; col[i * 3 + 2] = 1.0;
            } else if (tint < 0.68) {
              col[i * 3] = 1.0; col[i * 3 + 1] = 0.88; col[i * 3 + 2] = 0.62;
            } else {
              col[i * 3] = 1.0; col[i * 3 + 1] = 0.58; col[i * 3 + 2] = 0.34;
            }
            size[i] = 0.24 + tint * 0.30;
          } else if (b.type === 'planet') {
            col[i * 3] = 0.55 + tint * 0.2;
            col[i * 3 + 1] = 0.72 + tint * 0.2;
            col[i * 3 + 2] = 0.95;
            size[i] = 0.15;
          } else if (b.type === 'asteroid') {
            // 小行星：暗岩石色小点，成带分布
            col[i * 3] = 0.56 + tint * 0.12;
            col[i * 3 + 1] = 0.50 + tint * 0.10;
            col[i * 3 + 2] = 0.44 + tint * 0.08;
            size[i] = 0.055 + tint * 0.035;
          } else if (b.type === 'galaxy') {
            col[i * 3] = 0.62; col[i * 3 + 1] = 0.70; col[i * 3 + 2] = 1.0;
            size[i] = 0.62;
          } else {
            col[i * 3] = 1.0; col[i * 3 + 1] = 0.55; col[i * 3 + 2] = 0.22;
            size[i] = 0.26;
          }
          // ---- 月相光照（真实感）----
          // 行星 / 星云自身不发光，靠系统中心的恒星照亮。点云 Sprite 无法表现
          // 球面明暗，但可以用**相位**调制整体亮度：被照亮的一面朝向观察者时
          // 亮（满相）、背向时暗（新相）—— 这正是我们看月球时看到的真实效果。
          // 恒星 / 星系核 / 黑洞是自发光体，不参与。
          if (b.type === 'planet' || b.type === 'gas') {
            // 行星是实心不发光体，相位明暗很明显（像看月亮）；星云气体是漫射
            // 发光的尘埃云，方向性弱得多 —— 所以用更浅的调制，避免整片星云
            // 忽明忽暗显得假。
            const shallow = b.type === 'gas';
            const bxp = pos[i * 3], byp = pos[i * 3 + 1], bzp = pos[i * 3 + 2];
            // 指向光源（系统中心的恒星）
            let lx = s.pos[0] - bxp, ly = s.pos[1] - byp, lz = s.pos[2] - bzp;
            const ll = Math.hypot(lx, ly, lz) || 1;
            lx /= ll; ly /= ll; lz /= ll;
            // 指向观察者
            let vx = camera.position.x - bxp, vy = camera.position.y - byp, vz = camera.position.z - bzp;
            const vl = Math.hypot(vx, vy, vz) || 1;
            vx /= vl; vy /= vl; vz /= vl;
            const phase = 0.5 + 0.5 * (lx * vx + ly * vy + lz * vz); // 1=满相 0=新相
            // 行星：0.16~1.0（明暗对比强）；星云：0.62~1.0（只轻轻起伏）
            const lit = shallow ? 0.62 + 0.38 * phase : 0.16 + 0.84 * phase;
            col[i * 3] *= lit;
            col[i * 3 + 1] *= lit;
            col[i * 3 + 2] *= lit;
          }
          // 加色混合下颜色乘 fadeIn 即为透明度：出场时从核心亮起
          col[i * 3] *= fadeIn;
          col[i * 3 + 1] *= fadeIn;
          col[i * 3 + 2] *= fadeIn;
          size[i] *= 0.25 + 0.75 * ease;
          // 降级档位 2：细节点整体缩小，降低 overdraw
          if (sim.config.qualityTier >= 2) size[i] *= 0.8;
        }
        // ---- 二级系统与行星环：追加到预留槽位 ----
        // 显示位置 = 母体显示位置 + 自身轨道偏转（角度同样插值，椭圆同公式）
        const cap = size.length;
        let slot = bodies.length;
        for (const b of bodies) {
          if (!b.children) continue;
          const pb = b;
          // 母体显示位置：与主循环一致（椭圆轨道 + 动力学偏移 boff）
          const paM = pb.prevAngle + (pb.orbit.angle - pb.prevAngle) * alpha;
          const ppol = orbitPolar(pb.orbit, paM);
          const pcd = Math.cos(ppol[0]), psn = Math.sin(ppol[0]);
          const prEff = ppol[1];
          const pbx = (pb.boff ? pb.boff[0] : 0), pby = (pb.boff ? pb.boff[1] : 0), pbz = (pb.boff ? pb.boff[2] : 0);
          const sx = s.pos[0] + s.u[0] * pcd * prEff + s.v[0] * psn * prEff + s.axis[0] * pb.orbit.height + pbx;
          const sy = s.pos[1] + s.u[1] * pcd * prEff + s.v[1] * psn * prEff + s.axis[1] * pb.orbit.height + pby;
          const sz = s.pos[2] + s.u[2] * pcd * prEff + s.v[2] * psn * prEff + s.axis[2] * pb.orbit.height + pbz;
          // 母体的显形进度：环粒子随母行星一起淡入（星环不能先于行星出现）
          const pReveal = clamp01(pb.revealT ?? 1);
          for (const ch of b.children) {
            if (slot >= cap) break;
            const caM = ch.prevAngle + (ch.orbit.angle - ch.prevAngle) * alpha;
            const cpol = orbitPolar(ch.orbit, caM);
            const ccd = Math.cos(cpol[0]), csn = Math.sin(cpol[0]);
            const crEff = cpol[1];
            const cx = sx + s.u[0] * ccd * crEff + s.v[0] * csn * crEff + s.axis[0] * ch.orbit.height;
            const cy = sy + s.u[1] * ccd * crEff + s.v[1] * csn * crEff + s.axis[1] * ch.orbit.height;
            const cz = sz + s.u[2] * ccd * crEff + s.v[2] * csn * crEff + s.axis[2] * ch.orbit.height;
            const tint = ch.colorSeed;
            if (ch.type === 'ring') {
              // 行星环粒子：冰质淡灰蓝
              pos[slot * 3] = cx; pos[slot * 3 + 1] = cy; pos[slot * 3 + 2] = cz;
              col[slot * 3] = (0.72 + tint * 0.14) * pReveal;
              col[slot * 3 + 1] = (0.76 + tint * 0.12) * pReveal;
              col[slot * 3 + 2] = (0.84 + tint * 0.10) * pReveal;
              size[slot] = (0.045 + tint * 0.03) * pReveal;
            } else {
              pos[slot * 3] = cx; pos[slot * 3 + 1] = cy; pos[slot * 3 + 2] = cz;
              if (ch.type === 'gas') {
                col[slot * 3] = 0.50 + tint * 0.25;
                col[slot * 3 + 1] = 0.35 + tint * 0.25;
                col[slot * 3 + 2] = 0.85 + tint * 0.15;
                size[slot] = 0.10 + tint * 0.08;
              } else if (ch.type === 'star') {
                // 子星系恒星（超星系团星系核）：光温三段，与主点云一致
                if (tint < 0.28) {
                  col[slot * 3] = 0.62; col[slot * 3 + 1] = 0.78; col[slot * 3 + 2] = 1.0;
                } else if (tint < 0.68) {
                  col[slot * 3] = 1.0; col[slot * 3 + 1] = 0.88; col[slot * 3 + 2] = 0.62;
                } else {
                  col[slot * 3] = 1.0; col[slot * 3 + 1] = 0.58; col[slot * 3 + 2] = 0.34;
                }
                size[slot] = 0.16 + tint * 0.16;
              } else {
                col[slot * 3] = 0.55 + tint * 0.2;
                col[slot * 3 + 1] = 0.72 + tint * 0.2;
                col[slot * 3 + 2] = 0.95;
                size[slot] = 0.10;
              }
            }
            if (sim.config.qualityTier >= 2) size[slot] *= 0.8;
            slot++;
            // 二级行星自己的粒子环（最后一级嵌套）
            if (ch.children) {
              for (const rg of ch.children) {
                if (slot >= cap) break;
                const raM = rg.prevAngle + (rg.orbit.angle - rg.prevAngle) * alpha;
                const rpol = orbitPolar(rg.orbit, raM);
                const rcd = Math.cos(rpol[0]), rsn = Math.sin(rpol[0]);
                const rrEff = rpol[1];
                pos[slot * 3] = cx + s.u[0] * rcd * rrEff + s.v[0] * rsn * rrEff + s.axis[0] * rg.orbit.height;
                pos[slot * 3 + 1] = cy + s.u[1] * rcd * rrEff + s.v[1] * rsn * rrEff + s.axis[1] * rg.orbit.height;
                pos[slot * 3 + 2] = cz + s.u[2] * rcd * rrEff + s.v[2] * rsn * rrEff + s.axis[2] * rg.orbit.height;
                const rtint = rg.colorSeed;
                col[slot * 3] = (0.72 + rtint * 0.14) * pReveal;
                col[slot * 3 + 1] = (0.76 + rtint * 0.12) * pReveal;
                col[slot * 3 + 2] = (0.84 + rtint * 0.10) * pReveal;
                size[slot] = (0.04 + rtint * 0.025) * pReveal;
                if (sim.config.qualityTier >= 2) size[slot] *= 0.8;
                slot++;
              }
            }
          }
        }
        // 未用槽位尺寸清零（children 生成后不会消失，通常无需清理，防御旧数据）
        for (let i = slot; i < cap; i++) size[i] = 0;
        v.geo.attributes.position.needsUpdate = true;
        v.geo.attributes.color.needsUpdate = true;
        v.geo.attributes.aSize.needsUpdate = true;
        v.points.visible = true;
      } else if (v) {
        scene.remove(v.points);
        v.geo.dispose();
        v.mat.dispose();
        detailVisuals.delete(s.idx);
      }
    }
  }

  // 主角小球：克制的能量球——淡白核心 + 轻微青蓝边缘 + 弱镜面高光。
  // 能看到即可，不做过曝高光，配 bloom 也保持低调。
  const probeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 40, 32),
    new THREE.ShaderMaterial({
      depthTest: false,
      uniforms: {
        uCore: { value: new THREE.Color(0xd6e4ff) },
        uRim: { value: new THREE.Color(0x5a8fd0) },
        uSpec: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vN; varying vec3 vV;
        uniform vec3 uCore; uniform vec3 uRim; uniform vec3 uSpec;
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(vV);
          // 菲涅尔边缘：中心淡白，向边缘轻微过渡为青蓝
          float fresnel = pow(1.0 - abs(dot(n, v)), 1.6);
          // 弱镜面高光：只给一点点立体感，不抢眼
          vec3 L = normalize(vec3(0.35, 1.0, 0.6));
          vec3 R = reflect(-L, n);
          float spec = pow(max(0.0, dot(R, v)), 42.0);
          vec3 col = mix(uCore, uRim, fresnel);
          col += uSpec * spec * 0.25;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  probeMesh.renderOrder = 100;
  scene.add(probeMesh);

  // 光冕（菲涅尔）：边缘泛蓝白光，给小球"体积光"的质感；作为小球子节点，
  // 死亡演出（潮汐拉伸/汽化收缩）时自动同步缩放。
  const probeCorona = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 32, 24),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vN; varying vec3 vV;
        uniform float uIntensity;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          vec3 col = mix(vec3(0.42, 0.72, 1.0), vec3(1.0, 1.0, 1.0), rim);
          float a = rim * uIntensity;
          if (a < 0.012) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      uniforms: { uIntensity: { value: 0.5 } },
    }),
  );
  probeCorona.renderOrder = 99;
  probeMesh.add(probeCorona);

  // 光晕：远处仍是可辨认的亮光点，近处不压过天体
  const probeGlow = makeSprite(glowTex, 0xffffff);
  probeGlow.scale.setScalar(1.0);
  probeGlow.material.opacity = 0.7;
  probeGlow.renderOrder = 15;
  scene.add(probeGlow);

  const probeHalo = makeSprite(glowTex, 0x5aa7ff);
  probeHalo.scale.setScalar(1.7);
  probeHalo.material.opacity = 0.22;
  probeHalo.renderOrder = 14;
  scene.add(probeHalo);

  const respawnSprite = makeSprite(ringTex, 0x8ef0ff);
  respawnSprite.visible = false;
  respawnSprite.renderOrder = 22;
  scene.add(respawnSprite);
  let lastProbeGeneration = sim.probe.generation;

  // ---- 引擎尾焰（§10 推进器）：推进器开启时显示的"光锥" ----
  // 圆锥（粗端在球侧、细端远端）朝速度反方向延伸；shader 让远端自然
  // 衰减归零，开启推进时由 render 接管位置/朝向/长度。
  // 半径与长度故意比直觉大：cone 自身的可见面积小（远端渐细 + 衰减
  // 渐弱），加上 bloom 阈值 0.30，只有"够粗"才能在远景里看出方向。
  const probeTrailGeo = new THREE.ConeGeometry(0.7, 1.0, 24, 1, true);
  // 把底端（粗端）从 +Y/2 平移到原点，模型坐标系下底端 = (0,0,0)、顶端 = (0,1,0)
  probeTrailGeo.translate(0, 0.5, 0);
  const probeTrailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying float vT;
      void main() {
        vT = position.y; // 0 = 球侧、1 = 远端
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vT;
      uniform vec3 uColor;
      void main() {
        // 远端衰减 + 整体足够亮以触发 bloom 边缘
        float a = pow(1.0 - vT, 1.4) * 0.95;
        if (a < 0.01) discard;
        // 近端偏白热、远端偏青蓝 → 真实喷气温度梯度
        vec3 col = mix(vec3(1.0, 0.95, 0.88), uColor, vT);
        gl_FragColor = vec4(col, a);
      }
    `,
    uniforms: { uColor: { value: new THREE.Color(0x7ab8ff) } },
  });
  const probeTrail = new THREE.Mesh(probeTrailGeo, probeTrailMat);
  probeTrail.renderOrder = 16;
  probeTrail.visible = false;
  probeTrail.frustumCulled = false;
  scene.add(probeTrail);
  // 推进器状态切换时给一个微妙的"开关灯"过渡：靠 opacity 抖动一下
  let probeTrailOnAt = -1; // 上次开启时间（用于"刚开启"的瞬时增亮）

  // ---- 差异化死亡特效（§9.3 碰撞与吸积）----
  // 小球死法不同，特效不同：
  //   atmosphere 行星/星尘大气烧蚀：暖橙单环，慢扩散
  //   vaporize   恒星吞没汽化：白炽强闪，快扩散短寿命
  //   tidal      黑洞/星系核潮汐撕碎：蓝白三重涟漪（延迟回声），最长寿命
  //   wormhole   虫洞逃逸：全屏虫洞叠加层已足够，不播死亡特效
  //   generic    兜底 = 原蓝色重生环
  const DEATH_FX = {
    atmosphere: { ring: 0xff8a4a, launch: 0xffb36b, halo: 0xffc9a0, expand: 6.5, life: 1.6, rings: 1, glow: 0.5 },
    vaporize: { ring: 0xfff3c4, launch: 0xffffff, halo: 0xfff3c4, expand: 12, life: 0.8, rings: 1, glow: 0.9 },
    tidal: { ring: 0xa8d4ff, launch: 0x9fd0ff, halo: 0xbfe0ff, expand: 8.5, life: 1.9, rings: 3, glow: 0.7 },
    generic: { ring: 0x8ef0ff, launch: 0x8ef0ff, halo: 0x9ff0ff, expand: 9, life: 1.1, rings: 1, glow: 0.5 },
  };
  // 死亡点特效池：3 道涟漪环 + 1 个中心炽光，按需激活
  const deathRings = [0, 1, 2].map(() => {
    const sprite = makeSprite(ringTex, 0xffffff);
    sprite.visible = false;
    sprite.renderOrder = 23;
    scene.add(sprite);
    return { sprite, active: false, age: 0, life: 1, expand: 9 };
  });
  const deathGlow = makeSprite(glowTex, 0xffffff);
  deathGlow.visible = false;
  deathGlow.renderOrder = 23;
  scene.add(deathGlow);
  let deathGlowAge = -1; // <0 表示未激活

  // 在死亡位置生成对应类型的特效
  function spawnDeathFx(pos, fx) {
    deathRings.forEach((r, i) => {
      r.active = i < fx.rings;
      // 潮汐撕碎的第 2/3 道涟漪延迟出现，形成"撕碎回声"
      r.age = -i * 0.24;
      r.life = fx.life;
      r.expand = fx.expand;
      r.sprite.position.set(pos[0], pos[1], pos[2]);
      r.sprite.material.color.setHex(fx.ring);
      r.sprite.material.rotation = Math.random() * Math.PI;
      r.sprite.visible = false;
    });
    deathGlowAge = 0;
    deathGlow.position.set(pos[0], pos[1], pos[2]);
    deathGlow.material.color.setHex(fx.ring);
  }

  function updateDeathFx(dt) {
    for (const r of deathRings) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age < 0) continue; // 延迟未到
      if (r.age >= r.life) { r.active = false; r.sprite.visible = false; continue; }
      const k = r.age / r.life;
      r.sprite.visible = true;
      r.sprite.scale.setScalar(1.4 + k * r.expand * 3);
      r.sprite.material.opacity = (1 - k) * 0.85;
    }
    if (deathGlowAge >= 0) {
      const life = 0.55;
      deathGlowAge += dt;
      if (deathGlowAge >= life) { deathGlowAge = -1; deathGlow.visible = false; }
      else {
        const k = deathGlowAge / life;
        deathGlow.visible = true;
        deathGlow.scale.setScalar(1.5 + k * 6);
        deathGlow.material.opacity = (1 - k) * 0.8;
      }
    }
  }

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

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();
  const _deathDir = new THREE.Vector3();
  const _trailDir = new THREE.Vector3();
  const _trailQuat = new THREE.Quaternion();
  const _X_AXIS = new THREE.Vector3(1, 0, 0);
  const _Y_AXIS = new THREE.Vector3(0, 1, 0);

  function resize(w, h) {
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // 轨迹采样节流：不必每帧一个点（60fps 下 750 点只有 12 秒），
  // 固定按时间采样，保留时长 = trailLength × TRAIL_SAMPLE 秒。
  const TRAIL_SAMPLE = 0.045;
  let trailClock = 0;

  // 速率 → 颜色：慢=冷青蓝，快=暖橙金。配合加色混合，越暗越透明，
  // 于是"淡出"直接靠把颜色乘向黑色实现。

  const zeroAudio = () => ({ bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 });



  function updateStructures(dtReal, audioLevels, pulse) {
    const k = Math.min(1, dtReal * 2.8);
    for (let i = 0; i < sim.seeds.length; i++) {
      const s = sim.seeds[i];
      const g = seedGroups[i];
      const lv = s.level;
      g.group.position.set(s.pos[0], s.pos[1], s.pos[2]);
      // 集合类系统（星团/星系/超星系团/尘埃云）成形后，远景的"单个发光天体"
      // 表达让位于成员点云：视觉从"一个天体"切换成"一群天体"。
      // 盘面/光晕仍随小球接近（detailR*1.15 → detailR*0.7）淡出，
      // 那是星系轮廓的底雾，只在贴身时散去。
      const pd = Math.hypot(
        sim.probe.pos[0] - s.pos[0],
        sim.probe.pos[1] - s.pos[1],
        sim.probe.pos[2] - s.pos[2],
      );
      const detailR = sim._detailRadius(s) || sim._systemRadius(s);
      const isCollection = lv === 'cluster' || lv === 'galaxy' || lv === 'supercluster'
        || lv === 'dust' || lv === 'void';
      // 集合系统成形后（成员点云接管）分档让位：
      //  - 实心球彻底退出——它最像"一个天体"
      //  - 中心亮斑只留一点核球辉光，免得点云中心显得空
      //  - 盘面（圆环贴图）彻底退场——星系轮廓必须由真实成员粒子构成，
      //    不允许"一张贴图模拟多天体"（用户明确要求）；形成过程中盘面
      //    仍可用作原星系盘的过渡表达
      //  - 光晕只保留远处未分辨星系应有的"一小团光"，贴身即散
      //  - 超星系团伴星系核的光点淡出，交给点云里的 6 个星系核成员
      // 让位随 growth 平滑推进（0.6→0.85），与成员点云的淡入区间
      // （growth 0.5→0.7）错开，中间不会出现"两边都不可见"的空窗。
      const cloudMix = isCollection ? smoothstep(0.6, 0.85, s.growth) : 0;
      const solidFade = 1 - cloudMix;
      const coreFade = isCollection ? 1 - cloudMix * 0.85 : 1;
      const nearFade = isCollection
        ? smoothstep(detailR * 0.7, detailR * 1.15, pd)
        : 1;
      const mistFade = (1 - cloudMix * 0.45) * nearFade;
      const diskFade = 1 - cloudMix;                 // 盘面贴图成形后彻底退场
      const haloDim = 1 - 0.55 * cloudMix;           // 光晕压成远处的一小团核光
      const nodeDim = 1 - 0.85 * cloudMix;           // 伴星系核光点让位给成员点云
      const m4 = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
        new THREE.Vector3(s.v[0], s.v[1], s.v[2]),
        new THREE.Vector3(s.axis[0], s.axis[1], s.axis[2]),
      );
      g.group.quaternion.setFromRotationMatrix(m4);

      if (lv !== g.level) {
        g.level = lv;
        g.solid.material.color.copy(levelColorTinted(lv, g));
        if (lv === 'blackhole') g.solid.material.color.setRGB(0, 0, 0);
      }
      const targetCore = levelCoreScale(lv, s);
      g.coreScale += (targetCore - g.coreScale) * k;
      g.core.scale.setScalar(Math.max(0.001, g.coreScale * pulse));
      g.core.material.color.copy(levelColorTinted(lv, g));
      // 核球辉光也要乘 nearFade：此前只压到 15% 却不随接近退场，
      // 小球深入星系后中心还挂着一个大光球——"星系整体"本该消失
      // （三段式：近处只剩单个天体，任何整体表达都必须退干净）
      g.core.material.opacity = coreFade * nearFade;
      g.core.visible = lv !== 'blackhole' && g.core.material.opacity > 0.02;

      const targetSolid = levelSolidScale(lv, s);
      const bhScale = 1.65 + s.mass * 0.34; // 黑洞视界/吸积盘/光子环共用的尺度基准
      // 黑洞视界黑球用 bhScale（与吸积盘/光子环同一基准），其余天体用 targetSolid
      g.solid.scale.setScalar(lv === 'blackhole' ? bhScale : targetSolid * pulse);
      // 集合类系统成形后远景实心球退出（成员点云接管）；黑洞视界黑球保留
      g.solid.visible = lv !== 'void' && targetSolid > 0.01 && solidFade > 0.05;
      if (lv === 'blackhole') {
        g.solid.material.color.setRGB(0, 0, 0);
      } else {
        g.solid.material.color.copy(levelColorTinted(lv, g));
        g.solid.material.color.offsetHSL(0, -0.05, 0.15);
      }

      const isDisk = lv === 'galaxy' || lv === 'supercluster';
      const isBH = lv === 'blackhole';
      const targetDisk = isDisk ? 1 : 0;
      g.diskAmt += (targetDisk - g.diskAmt) * k;
      g.bhAmt += ((isBH ? 1 : 0) - g.bhAmt) * k;
      g.nodeAmt += ((lv === 'supercluster' ? 1 : 0) - g.nodeAmt) * k;

      // 旋涡星系盘（原星系阶段的过渡表达；成形后由成员粒子接管，退场）
      // 尺寸与本体尺度成比例：星系 detailR 115、超星系团 100
      const diskBase = lv === 'supercluster' ? 44 + s.mass * 5 : 30 + s.mass * 4;
      g.disk.scale.setScalar(Math.max(0.001, diskBase * (0.22 + 0.78 * g.diskAmt) * pulse));
      g.disk.material.opacity = (0.14 + 0.46 * g.diskAmt * (0.8 + audioLevels.bass * 0.3)) * mistFade * diskFade;
      g.disk.material.color.copy(levelColorTinted(lv, g));
      g.disk.visible = g.diskAmt > 0.01 && diskFade > 0.02 && mistFade > 0.02;

      // 黑洞：事件视界(黑球) + 吸积盘 + 光子环 + 喷流
      g.accretionDisk.scale.setScalar(Math.max(0.001, bhScale * (0.4 + 0.6 * g.bhAmt)));
      g.accretionDisk.visible = g.bhAmt > 0.01;
      g.photonRing.scale.setScalar(Math.max(0.001, bhScale * (0.4 + 0.6 * g.bhAmt)));
      g.photonRing.material.opacity = 0.9 * g.bhAmt;
      g.photonRing.visible = g.bhAmt > 0.01;
      const jetScale = bhScale * (0.55 + 0.18 * Math.sin(sim.time * 6 + i * 1.7) + audioLevels.beat * 0.25) * g.bhAmt;
      g.jetA.scale.setScalar(Math.max(0.001, jetScale));
      g.jetB.scale.setScalar(Math.max(0.001, jetScale));
      g.jetA.position.z = bhScale * 0.82;
      g.jetB.position.z = -bhScale * 0.82;
      g.jetA.material.opacity = 0.4 * g.bhAmt;
      g.jetB.material.opacity = 0.4 * g.bhAmt;
      g.jetA.visible = g.jetB.visible = g.bhAmt > 0.01;

      // 光晕：休眠/形成中的种子也要清晰可见（航线上亮起的光点），
      // 大结构（星系）的光晕随结构成形淡入。黑洞**没有**光晕——
      // 它本身是黑的，周围只有吸积盘与光子环的细光，不能加夸张辉光。
      let haloTarget, haloFade;
      if (lv === 'galaxy') { haloTarget = 22 + s.mass * 4; haloFade = g.diskAmt; }
      else if (lv === 'supercluster') { haloTarget = 30 + s.mass * 5; haloFade = g.diskAmt; }
      else if (lv === 'blackhole') { haloTarget = 0; haloFade = 0; }
      else if (lv === 'cluster') { haloTarget = 3.2 + s.mass * 0.8; haloFade = 0.55; }
      else if (lv === 'star') { haloTarget = 1.7 + s.mass * 0.5; haloFade = 0.5; }
      else if (lv === 'planet') { haloTarget = 1.3 + s.mass * 0.4; haloFade = 0.4; }
      else { haloTarget = 2.4 + s.mass * 0.6; haloFade = 0.9; } // void / dust
      g.halo.scale.setScalar(Math.max(0.001, haloTarget * pulse * (0.5 + 0.5 * Math.max(g.diskAmt, g.bhAmt))));
      g.halo.material.color.copy(levelColorTinted(lv, g));
      // 星系/超星系团成形后光晕压暗：远处仍是一小团可辨识的光（真实：
      // 未分辨的远方星系就是一个光斑），但不再是"贴图底雾"
      g.halo.material.opacity = 0.30 * haloFade * mistFade
        * (lv === 'galaxy' || lv === 'supercluster' ? haloDim : 1);
      g.halo.visible = g.halo.material.opacity > 0.01;

      // 超星系团伴星系核（成形后由点云里的 6 个星系核成员接管）
      for (let n = 0; n < g.nodes.length; n++) {
        g.nodes[n].scale.setScalar((0.28 + (n % 3) * 0.12) * g.nodeAmt * pulse);
        g.nodes[n].material.opacity = 0.7 * g.nodeAmt * mistFade * nodeDim;
        g.nodes[n].visible = g.nodeAmt > 0.01 && nodeDim > 0.02 && mistFade > 0.02;
      }

      // 旋转动画：星系盘与黑洞吸积盘持续旋转
      const spinBase = lv === 'blackhole' ? 2.2 : lv === 'galaxy' ? 0.85 : lv === 'supercluster' ? 0.5 : 0.25;
      g.diskAngle += dtReal * spinBase * (0.75 + audioLevels.bass * 0.8);
      g.disk.rotation.z = g.diskAngle;
      // 吸积盘随黑洞自转（多普勒亮斑跟着盘转）；光子环对称，不随盘旋转
      g.accretionDisk.rotation.z = g.diskAngle * 0.55;
      g.photonRing.rotation.z = 0;
    }
  }

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
    updateStructures(dtReal, audioLevels, pulse);
    // 先画远景成员点云（未发现的成员），再由 detail 点云叠加已发现的成员
    updatePreviewClouds();
    updateDetailVisuals(alpha);

    // 死亡序列起点：立即播死亡特效，并标记本次死亡已播（重生时不再重复）
    if (pr.dying && !state._prevDying) {
      state._deathFx = DEATH_FX[pr.deathType] || DEATH_FX.generic;
      if (pr.deathType !== 'wormhole') {
        spawnDeathFx(pr.deathPos, state._deathFx);
        state._fxSpawnedForDeath = true;
      }
    }
    state._prevDying = pr.dying;
    if (pr.generation !== lastProbeGeneration) {
      lastProbeGeneration = pr.generation;
      trail.clearTrail();
      // 重生后速度方向突变：平滑速度直接重置为新方向（前向偏置不拖泥带水），
      // 但**方位角不跟着转**（用户要求任何时候都不得跟随小球旋转）。
      const pv0 = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (pv0 > 0.02) {
        state.velSmooth.set(pr.vel[0], pr.vel[1], pr.vel[2]);
      }
      // 死亡方式驱动的特效与配色（虫洞逃逸不播死亡特效）；
      // 死亡序列起点已播过则不重复
      state._deathFx = DEATH_FX[pr.deathType] || DEATH_FX.generic;
      if (pr.deathType !== 'wormhole' && !state._fxSpawnedForDeath) spawnDeathFx(pr.deathPos, state._deathFx);
      state._fxSpawnedForDeath = false;
    }
    probeMesh.position.set(px, py, pz);
    probeGlow.position.copy(probeMesh.position);
    probeHalo.position.copy(probeMesh.position);
    // ---- 引擎尾焰：推进器开启且有实际输入时显示 ----
    // 朝向 = 速度反方向（"推力把球往前推，火焰从发动机往后喷"），
    // 长度随速率自适应（0.6~4.5 单位）。朝向上用 +Y 转到 -velDir：
    //   q.setFromUnitVectors(Y, -velDir) 等价于"模型 +Y 指远端、底端在球侧"。
    {
      const tv = sim.thrust;
      const thrustActive = sim.config.thrustEnabled && (tv[0] !== 0 || tv[1] !== 0 || tv[2] !== 0);
      if (thrustActive) {
        probeTrail.visible = true;
        // probeTrail 加在 scene 而非 probeMesh 子节点（避免被缩放/旋转的死亡演出
        // 污染），所以每帧自己同步到 probe 位置
        probeTrail.position.set(px, py, pz);
        const spd = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
        _trailDir.set(pr.vel[0], pr.vel[1], pr.vel[2]);
        if (_trailDir.lengthSq() > 1e-4) {
          _trailDir.divideScalar(spd);
          _trailDir.negate(); // 朝速度反方向
          _trailQuat.setFromUnitVectors(_Y_AXIS, _trailDir);
          probeTrail.quaternion.copy(_trailQuat);
        }
        // 长度：随速度从 0.8 拉到 6.0，再被推力大小稍微加强
        const len = Math.min(6.0, 0.8 + spd * 0.22 + sim.config.thrustMag * 0.05);
        probeTrail.scale.set(1, len, 1);
        // 刚开启的一帧用更深一点的"点火热"（短暂强闪）
        if (probeTrailOnAt < 0) probeTrailOnAt = sim.time;
        const justOn = Math.max(0, 1 - (sim.time - probeTrailOnAt) / 0.25);
        probeTrail.material.uniforms.uColor.value.setRGB(
          0.63 + justOn * 0.37, 0.83 + justOn * 0.17, 1.0,
        );
      } else {
        probeTrail.visible = false;
        probeTrailOnAt = -1;
      }
    }
    // 小球光晕：远处仍是一颗可辨认的亮星，近处保持清晰但不炸白。
    // 小球光晕：能看到即可，收敛到克制——远处是可辨的光点，近处不过曝
    const camDist = camera.position.distanceTo(probeMesh.position);
    const glowScale = 1.6 * Math.max(0.5, Math.min(2.2, 15 / Math.max(camDist, 4)));
    probeGlow.scale.setScalar(glowScale);
    probeHalo.scale.setScalar(glowScale * 1.4);
    // ---- 死亡演出：潮汐拉伸（意大利面化）/ 汽化收缩 / 烧蚀压缩 + 配色跟随 ----
    if (pr.dying) {
      const k = 1 - Math.max(0, pr.dyingT) / Math.max(1e-4, pr.dyingDur);
      if (pr.deathType === 'tidal') {
        const kp = pr.deathKillerPos;
        _deathDir.set(kp[0] - px, kp[1] - py, kp[2] - pz);
        if (_deathDir.lengthSq() > 1e-8) {
          _deathDir.normalize();
          probeMesh.quaternion.setFromUnitVectors(_X_AXIS, _deathDir);
        }
        probeMesh.scale.set(1 + 3.5 * k, Math.max(0.12, 1 - 0.8 * k), Math.max(0.12, 1 - 0.8 * k));
        probeGlow.scale.setScalar(glowScale * (1 + 1.2 * k));
      } else if (pr.deathType === 'vaporize') {
        probeMesh.scale.setScalar(Math.max(0.06, 1 - k));
        probeGlow.scale.setScalar(glowScale * (1 + 2.5 * k));
      } else {
        probeMesh.scale.setScalar(1 - 0.3 * k);
      }
    } else {
      probeMesh.scale.setScalar(1);
    }
    // 重生高亮/死亡期间配色跟随死亡方式：汽化偏白、烧蚀偏暖橙、潮汐偏蓝白
    const deathFx = state._deathFx || DEATH_FX.generic;
    const highlight = pr.dying || pr.respawnFlash > 0.05;
    probeGlow.material.color.setHex(highlight ? deathFx.halo : 0xffffff);
    probeHalo.material.color.setHex(highlight ? deathFx.halo : 0x5aa7ff);

    if (pr.respawnFlash > 0.01) {
      respawnSprite.visible = true;
      respawnSprite.position.copy(probeMesh.position);
      respawnSprite.scale.setScalar(1.6 + (1 - pr.respawnFlash) * 9);
      respawnSprite.material.opacity = Math.min(1, pr.respawnFlash * 1.1);
      respawnSprite.material.color.setHex(deathFx.launch);
    } else {
      respawnSprite.visible = false;
    }
    updateDeathFx(dtReal);
    // 轨迹按固定时间采样（不是每帧），并在采样点记录当时的速率用于着色。
    // 注意 pv 定义在镜头分支块内、此处不可见，所以现算一次
    trailClock += dtReal;
    if (trailClock >= TRAIL_SAMPLE) {
      trailClock = 0;
      const pvNow = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      trail.pushTrail(px, py, pz, pvNow);
    }

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
        //    自适应窗口：从最新采样点往回扩，直到包围半径达到 fitCap
        //    （再大也框不全，不值得继续扩）或窗口上限（~44s）。
        //    慢速航行 → 窗口长、纳入更多轨迹；快速航行 → 窗口短、只保最近弧段。
        //    包围半径围绕视点算（视点已含绕行偏移，绕圈时半径≈轨道半径）。
        const sinHalf = Math.sin(fovRad * 0.5);
        const fitCap = zoomBase * 1.20;
        const maxTrailN = Math.min(trailCount, Math.floor(44 / TRAIL_SAMPLE));
        let trailR2 = 0;
        for (let k = 0; k < maxTrailN; k++) {
          const i3 = (trailCount - 1 - k) * 3;
          const dx = trailPos[i3] - fX;
          const dy = trailPos[i3 + 1] - fY;
          const dz = trailPos[i3 + 2] - fZ;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > trailR2) trailR2 = d2;
          if (trailR2 >= fitCap * fitCap) break;
        }
        if (trailR2 > fitCap * fitCap) trailR2 = fitCap * fitCap;
        wantDist = Math.max(wantDist, (Math.sqrt(trailR2) * 1.12) / sinHalf);
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


