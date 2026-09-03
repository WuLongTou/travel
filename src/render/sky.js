// 渲染域：无限星空背景、银河带方向采样、星场与远星云
// 2026-09-04 真实宇宙视觉整改：用户指出"如果一个飞船在一个星系中能看到
// 另一个星系吗"——答案是绝对可以（从地球肉眼能看到 M31 仙女座）。本轮从
// "飞船在星系中"的真实视角重新设计环境：
//   1. 银河带弥漫光晕：地球夜空银河（银盘恒星累积亮度）是最强结构，必须可见
//   2. 远景星系可见层：作为"宇宙里有邻居星系"的视觉证据（仙女座/麦哲伦云类）
//   3. 星点尺寸再压缩：6 等星（肉眼极限）= 0.5 px，亚像素为主
//   4. 银河带密度增强：带内恒星密度应该是带外的几倍
import * as THREE from 'three';
import { randomUnit } from '../core/utils.js';
import { COLLECTION_LEVELS } from '../core/config.js';

// 银河带法线（星空里那条恒星密集的带）：给个倾角，别正对坐标轴
export const GALAXY_NORMAL = (() => {
  const n = [0.34, 0.88, -0.32];
  const l = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / l, n[1] / l, n[2] / l];
})();

// 银心方向（银河带里最亮的那一点）：与 GALAXY_NORMAL 大体一致，但偏角让它
// 落在银盘面内——远处看银河，肉眼最亮的就是银心方向。
export const GALAXY_CENTER = (() => {
  // 银河带法线基础上偏移到盘面内一点（让"银心方向"在盘面上）
  const n = [0.42, 0.78, -0.46];
  const l = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / l, n[1] / l, n[2] / l];
})();

export function createCosmicSky() {
  // 无限星空背景：这是一个始终跟随相机的单位天球，
  // 不是包裹宇宙的有限椭球/球壳，因此小球无论飞多远都不会"跑出宇宙"。
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uGalaxyNormal: { value: new THREE.Vector3(GALAXY_NORMAL[0], GALAXY_NORMAL[1], GALAXY_NORMAL[2]) },
      uGalaxyCenter: { value: new THREE.Vector3(GALAXY_CENTER[0], GALAXY_CENTER[1], GALAXY_CENTER[2]) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uGalaxyNormal;
      uniform vec3 uGalaxyCenter;
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      void main() {
        vec3 dir = normalize(vDir);
        vec3 base = vec3(0.0);

        // === 银河带弥漫光晕（2026-09-04 真实宇宙视觉整改）===
        // 真实参考：地球看银河——银盘方向无数不可分辨恒星累积成的"牛奶路"，
        // 沿 GALAXY_NORMAL 形成约 5°~30° 宽的亮带，是肉眼可见的最强结构。
        // 表面亮度约 22 等/平方角秒（极暗但持续分布）。
        // 渲染：按方向与 GALAXY_NORMAL 的 cos² 衰减得到沿银盘的亮带；银心
        //   方向 (uGalaxyCenter) 进一步增强（盘上最亮的核球方向）。
        // 强度（disc*0.18 + bulge*0.40，指数从 5.5 调到 2.5）：实测
        // disc 的指数 5.5 让 disc=1 的有效角度只有 ±25°——银河带太窄。
        // 调到 2.5 让 disc=1 的角度扩到 ±40°，肉眼能看到一条明确的亮带。
        float disc = exp(-pow(dot(dir, uGalaxyNormal), 2.0) * 2.5);
        float bulge = exp(-pow(dot(dir, uGalaxyCenter), 2.0) * 12.0);
        // 银盘颜色：偏暖黄白（真实银河带是暖色调）
        vec3 milkyColor = vec3(0.55, 0.50, 0.42);
        float milky = disc * (0.18 + 0.40 * bulge);
        base += milkyColor * milky;

        // === 离散星点（带内密度增强）===
        // 银河带内格子出星概率更高（带内阈值大幅放宽），读作一条密星带。
        // 银河带 → 把方向切成小格，每格随机出现一颗星。
        // 离带密度（默认 0.35~0.90 → 提升到 0.55~1.10）：此前星空整体偏暗，
        // 截图分析 92% 像素 <32 灰度——肉眼看不到明确的"星等层次"。将
        // 离带星点亮度区间抬到 0.55~1.10，配合银河带更密的星点（带内 6×）
        // 形成"满星密带 + 散落恒星"双层视觉。
        float bandFactor = exp(-pow(dot(dir, uGalaxyNormal), 2.0) * 9.0);
        vec3 cell = floor(dir * 240.0);
        float h = hash(cell);
        // 带内出星概率比带外高 6×（从 0.0028 加到 0.0170）
        float star = smoothstep(0.9975 - bandFactor * 0.0170, 1.0, h);
        vec3 starColor = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.95, 0.85), hash(cell + 7.0));
        base += starColor * star * (0.55 + hash(cell + 11.0) * 0.55) * (0.7 + bandFactor * 0.5);

        // 少量彩色亮星（带内略多）
        float bright = smoothstep(0.9995 - bandFactor * 0.0015, 1.0, hash(cell + 3.0));
        base += vec3(1.0, 0.85, 0.7) * bright * (0.5 + bandFactor * 0.3);

        gl_FragColor = vec4(base, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

// 沿银河带盘面采样：把随机方向压向垂直于 GALAXY_NORMAL 的平面，
// 再在法向加一点厚度。纯均匀球面分布是"没有银河"的，看起来很假。
export function sampleGalaxyDirection() {
  const d = randomUnit(1);
  const dot = d[0] * GALAXY_NORMAL[0] + d[1] * GALAXY_NORMAL[1] + d[2] * GALAXY_NORMAL[2];
  let vx = d[0] - GALAXY_NORMAL[0] * dot;
  let vy = d[1] - GALAXY_NORMAL[1] * dot;
  let vz = d[2] - GALAXY_NORMAL[2] * dot;
  const l = Math.hypot(vx, vy, vz) || 1;
  vx /= l; vy /= l; vz /= l;
  // 盘的厚度：越靠近银盘越密（用 |·|^3 让厚度方向快速衰减）
  const h = (Math.random() - 0.5);
  const th = Math.sign(h) * Math.pow(Math.abs(h), 1.7) * 0.30;
  return [vx + GALAXY_NORMAL[0] * th, vy + GALAXY_NORMAL[1] * th, vz + GALAXY_NORMAL[2] * th];
}

export function createStarfield(glowTex) {
  // 真实夜空的星等分布是幂律：暗星压倒性多数，亮星极少。
  // 恒星颜色按真实黑体色温分布（O/B/A 偏蓝 → G 黄白 → K/M 橙红），
  // 而不是"几乎全白"。分三层：暗星海 + 中亮 + 少量亮星（形成层次）。
  //
  // 2026-09-04 第二轮真实化整改：从"飞船在星系中"的视角，星点是银河系
  // 内的恒星——它们与飞船的距离从几光年到几千光年不等，**视角上以亚像素
  // 为主**。6 等星（肉眼极限）角直径约 0.02°，视场 1080p 下约 0.5 px。
  //   - 暗星层（绝大多数，肉眼不可见）：数量 9000→12000，尺寸 0.55→0.42
  //     px（多数亚像素），亮度上限 0.16→0.10，幂律 3.0→3.5（更陡）
  //   - 中等层：尺寸 1.05→0.85 px（接近 6 等星极限），亮度上限 0.50→0.42
  //   - 亮星层：尺寸 1.55→1.30 px（接近 4 等星视觉光晕），亮度上限 0.82→0.70
  //     （避免 bloom 把亮星拉爆成"鼓胀"圆斑）
  // 总星点数 9550→12550——更多星点但更小，配合 bloom 提供"星等密度感"。
  // 配合下方"远景星系可见层"（M31 类光斑）一起构成真实夜空的全貌。
  const group = new THREE.Group();
  // sizeAttenuation: false —— 星点以**固定像素尺寸**渲染。背景星空在
  // "无穷远"（天球），角尺寸本就该恒定。
  const layers = [
    { n: 12000, size: 0.42, lo: 0.010, hi: 0.10, pow: 3.5, op: 0.85 },
    { n: 600,   size: 0.85, lo: 0.18,  hi: 0.42, pow: 2.8, op: 1.00 },
    { n: 50,    size: 1.30, lo: 0.50,  hi: 0.70, pow: 2.9, op: 1.00 },
  ];
  // 黑体色温 → 近似的 RGB（由蓝到白到橙红）
  function blackbody(t, out) {
    // t ∈ 0..1：0 = 最热(O, 蓝白)，1 = 最冷(M, 橙红)
    const r = 0.55 + 0.45 * t;
    const g = 0.60 + 0.25 * t;
    const b = 1.00 - 0.55 * t;
    out[0] = r; out[1] = g; out[2] = b;
  }
  const _bb = [0, 0, 0];
  for (const L of layers) {
    const pos = new Float32Array(L.n * 3);
    const col = new Float32Array(L.n * 3);
    for (let i = 0; i < L.n; i++) {
      // 约 65% 的恒星聚在银河带上（更密集——真实银河带是肉眼可见的最亮结构）
      const dir = Math.random() < 0.65 ? sampleGalaxyDirection() : randomUnit(1);
      const r = 900 + Math.random() * 3600;
      pos[i * 3] = dir[0] * r;
      pos[i * 3 + 1] = dir[1] * r;
      pos[i * 3 + 2] = dir[2] * r;
      // 幂律星等：pow>1 让亮度集中在暗端
      const b = L.lo + Math.pow(Math.random(), L.pow) * (L.hi - L.lo);
      // 色温在蓝白(0.1)~橙红(0.9)之间，随亮度略偏：亮星偏蓝白，暗星偏暖
      const t = 0.1 + Math.random() * 0.8;
      blackbody(t, _bb);
      col[i * 3] = b * _bb[0];
      col[i * 3 + 1] = b * _bb[1];
      col[i * 3 + 2] = b * _bb[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: L.size, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: L.op, depthWrite: false,
      blending: THREE.AdditiveBlending,
      // 圆点星：径向渐变贴图（Additive 下黑色边缘自然消隐，无需 alphaTest）
      map: glowTex || undefined,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
  }
  return group;
}

// 远星云：极少量、极暗的彩色气体云，跟随相机（无限宇宙感）。
// 宇宙空间整体应该是黑暗的——星云只是偶尔点缀的色斑，不能成为"背景光"。
// 2026-09-04 第二轮真实化：单个星云尺度 240~880 → 140~520——原值在摄像机
// 近距时（detailR 115 的星系核附近）会盖掉大半个画面，造成"星云
// 糊脸"的假象。星云本质是几十光年尺度的稀薄气体，从地球夜空角度
// 看只是个色斑；尺寸缩到约 1/2 后仍保留色斑纵深感、且不抢镜。
export function createNebulae(glowTex) {
  const group = new THREE.Group();
  const palette = [
    0x2a3f7a, 0x4a2a6a, 0x1e5a6a, 0x6a3a2a, 0x35406a, 0x5a2a4a,
    0x2a5a4a, 0x6a2a5a, 0x3a4a7a,
  ];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: palette[i % palette.length],
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, opacity: 0.040 + Math.random() * 0.045,
    }));
    // 散布在天球上，距离很远（远于恒星层，营造纵深）
    const dir = randomUnit(1);
    const r = 4000 + Math.random() * 2400;
    sprite.position.set(dir[0] * r, dir[1] * r, dir[2] * r);
    // 形态多样：长宽比随机（细长→浑圆），尺寸数百~上千世界单位
    const w = 140 + Math.random() * 380;
    const h = w * (0.35 + Math.random() * 0.85);
    sprite.scale.set(w, h, 1);
    sprite.material.rotation = Math.random() * Math.PI;
    sprite.renderOrder = -90; // 在恒星层之后、宇宙天球之前
    group.add(sprite);
  }
  return group;
}

// 远景星系可见层（2026-09-04 真实宇宙视觉整改）：
// 用户提出"飞船在星系中能看到另一个星系吗"——答案是绝对可以。从地球
// 肉眼可见的最亮河外星系是 M31 仙女座（视直径 ~3°，亮度 4 等），还有
// 麦哲伦云等。本子层在场景里放置 12 个远景星系（仙女座类 + 远景星系），
// 作为"宇宙里有邻居星系"的视觉证据——当你穿越银河时，背景始终能看到
// 几个邻居星系的模糊光斑，覆盖全天区。
//
// 数量选择：地球肉眼可见的河外星系只有 3 个（太少了，画面稀疏），但
// 飞船在宇宙中航行，邻近星系都应该可见。本作取 12 个——分布在全天区，
// 任何朝向都能看到 4~5 个，让"宇宙中有邻居星系"的视觉感受始终存在。
//
// 实现：用 Sprite 椭圆缩放表现星系盘面，position 跟随相机保持恒定方向
// （不参与 sim 物理，不影响引力或演化）。每个星系大小按其视直径换算
// 世界单位。
//
// 视直径→世界单位换算：相机 fov 58°，1° 对应世界距离 = dist × tan(1°)
// ≈ dist × 0.01745（远场近似）。Sprite 始终面向相机，scale 直接是世界宽度。
export function createDistantGalaxies(glowTex) {
  const group = new THREE.Group();
  // 12 个远景星系的方向：分散在天球，避免与银盘重叠
  // 格式: [方向(x,y,z), 距离, 视直径°, 颜色, 椭圆比]
  const galaxies = [
    // 仙女座类（M31 同款，3° 视直径，肉眼可见）—— 2 个
    [ 0.55,  0.35,  0.75, 14000, 3.0, 0xb0a8d8, 2.5],
    [-0.65,  0.45,  0.62, 16000, 2.5, 0xc8b6b0, 2.2],
    // M33 类型（1.5°~1.8° 视直径）—— 2 个
    [ 0.78, -0.42,  0.46, 18500, 1.6, 0xa8b0c8, 2.8],
    [-0.42, -0.65,  0.62, 17500, 1.8, 0xc8c0a8, 2.4],
    // 麦哲伦云类（小且不规则——圆形光斑，0.9°~1.0° 视直径）—— 2 个
    [ 0.32,  0.78, -0.55, 22000, 1.0, 0xd0b0a0, 1.0],
    [-0.78,  0.22, -0.60, 20000, 0.9, 0xc8a0a8, 1.0],
    // 中等距离星系（0.6°~0.8°）—— 4 个，分布全天
    [ 0.42,  0.62, -0.65, 24000, 0.7, 0xb8a8c8, 1.4],
    [-0.45,  0.78,  0.43, 26000, 0.6, 0xa8b8d0, 1.2],
    [ 0.65, -0.22,  0.72, 25000, 0.8, 0xc8b8a0, 1.5],
    [-0.32, -0.85, -0.42, 23000, 0.7, 0xd0a8b8, 1.3],
    // 远景小星系（0.4°~0.5°，更暗，需要望远镜才看得见，但有渲染必要）—— 2 个
    [ 0.82,  0.18, -0.55, 32000, 0.5, 0xa0a0c8, 1.0],
    [-0.68, -0.32,  0.65, 30000, 0.4, 0xb8a8b8, 1.0],
  ];
  for (const g of galaxies) {
    const [dx, dy, dz, dist, deg, colorHex, ratio] = g;
    const l = Math.hypot(dx, dy, dz);
    const nx = dx / l, ny = dy / l, nz = dz / l;
    // 准确换算：1° 对应 dist * tan(1°) ≈ dist * 0.01745 世界单位
    const worldPerDeg = dist * 0.01745;
    const w = worldPerDeg * deg;
    const h = w / ratio;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: colorHex,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
      // 大星系更亮（surface brightness 接近真实——M31 比麦哲伦云亮）
      opacity: 0.10 + (deg / 3.0) * 0.10,
      rotation: Math.random() * Math.PI,
    }));
    sprite.position.set(nx * dist, ny * dist, nz * dist);
    sprite.scale.set(w, h, 1);
    // 渲染顺序：宇宙天球 > 远星云 > 恒星层 > 远景星系 > sim 系统
    sprite.renderOrder = -80;
    group.add(sprite);
  }
  return group;
}