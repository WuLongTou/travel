// 渲染域：无限星空背景、银河带方向采样、星场与远星云
// 2026-09-04 第三轮真实宇宙整改：用户指出银河带弥漫亮带"太亮、没必要"
// ——移除 disc/bulge 弥漫光晕。本轮从"真实飞船视角"重定星空观感：
//   1. 银河带只由"带内星点更密"构成，无任何弥漫底色（宇宙背景纯黑）
//   2. 天球 shader 星点细化：格子 4.4px 大方块 → ~1.5px 真实角尺寸星点
//   3. 恒星颜色-星等联动：暗星偏橙红（M/K 型占银河系约 3/4）、亮星偏蓝白
//   4. 远景星系可见层保留（上一轮新增，作为"宇宙里有邻居星系"的证据）
import * as THREE from 'three';
import { randomUnit } from '../core/utils.js';
import { COLLECTION_LEVELS } from '../core/config.js';

// 银河带法线（星空里那条恒星密集的带）：给个倾角，别正对坐标轴
export const GALAXY_NORMAL = (() => {
  const n = [0.34, 0.88, -0.32];
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
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      void main() {
        vec3 dir = normalize(vDir);
        // 真实宇宙背景是纯黑的：银河带的可读结构只来自"带内恒星更密"，
        // 不加任何弥漫底色/环境光（2026-09-04 第三轮：上一轮的
        // disc/bulge 弥漫光晕把银盘方向抬到 80~150 灰度，过亮，已移除）。
        float bandFactor = exp(-pow(dot(dir, uGalaxyNormal), 2.0) * 9.0);
        vec3 base = vec3(0.0);
        // 离散星点：把方向切成小格，每格随机出现一颗星。
        // 格子角尺寸 1/720 rad ≈ 0.08°：1080p/58° 视场下约 1.5 CSS px
        // （与渲染 pixelRatio 无关——dpr 只增加物理像素密度），和 Points
        // 星层"暗星 0.42px / 亮星 1.30px"的真实角尺寸同量级。上一轮的
        // 240 格子是 4.4px 大方块且亮度 0.55~1.10（画面最亮元素），
        // 在带内 6× 密度下与弥漫光晕一起被读成"糊亮带"——本轮一并修正。
        vec3 cell = floor(dir * 720.0);
        float h = hash(cell);
        // 出星概率随格子数（∝频率²）重标定，全天星数守恒在 ~5000 颗
        // （真实夜空肉眼可见星的数量级）；带内出星概率仍比带外高 ~6×。
        float star = smoothstep(0.99972 - bandFactor * 0.00162, 1.0, h);
        vec3 starColor = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.95, 0.85), hash(cell + 7.0));
        base += starColor * star * (0.30 + hash(cell + 11.0) * 0.50) * (0.7 + bandFactor * 0.5);
        // 少量亮星：从已出星点中按幂律抽亮（pow(u,12) 连续分布，避免
        // 窄 smoothstep 阈值在高频格子下的 hash 精度问题）。
        float lift = pow(hash(cell + 3.0), 12.0);
        base += vec3(1.0, 0.85, 0.7) * star * lift * (0.5 + bandFactor * 0.3);

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
    { n: 12000, size: 0.42, lo: 0.010, hi: 0.10, pow: 3.5, op: 0.85, tilt: 0.60 },
    { n: 600,   size: 0.85, lo: 0.18,  hi: 0.42, pow: 2.8, op: 1.00, tilt: 1.00 },
    { n: 50,    size: 1.30, lo: 0.50,  hi: 0.70, pow: 2.9, op: 1.00, tilt: 2.20 },
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
      // 约 65% 的恒星聚在银河带上——真实银盘方向的恒星投影密度远高于带外，
      // 银河带的可读结构只来自密星带本身，不靠弥漫底色
      const dir = Math.random() < 0.65 ? sampleGalaxyDirection() : randomUnit(1);
      const r = 900 + Math.random() * 3600;
      pos[i * 3] = dir[0] * r;
      pos[i * 3 + 1] = dir[1] * r;
      pos[i * 3 + 2] = dir[2] * r;
      // 幂律星等：pow>1 让亮度集中在暗端
      const b = L.lo + Math.pow(Math.random(), L.pow) * (L.hi - L.lo);
      // 色温-星等联动（2026-09-04 第三轮真实化）：银河系约 3/4 恒星是
      // M/K 型红矮星（暗、红）；而肉眼亮星由 A/F 型主导（亮、蓝白）。
      // tilt<1 的幂律分布偏红端、>1 偏蓝端：暗星层 0.60（E[t]≈0.60，
      // 橙红为主）、中等层 1.00（均匀）、亮星层 2.20（E[t]≈0.37，蓝白为主）。
      const t = 0.1 + Math.pow(Math.random(), L.tilt) * 0.8;
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

// ---- 近邻星系层（2026-09-04 第三轮真实化整改）----
// 用户反馈："宇宙应该是全方位的，但截图里只有一圈"——根因是当前视野里
// 只有最靠近飞船的那一个天体系统（星系/超星系团）的 disk/halo 在画面里
// 显著，其他方向的星云/远景星系 sprite 都很暗、不构成视觉上可识别的
// "结构感"。
//
// 解决：在飞船周围半径 ~2500~4500 单位的全天球上放置 10 个"近邻星系
// 轮廓"——它们用真实的 3D 扁椭球（不是 sprite），跟随相机保持恒定方向，
// 每个有自己的倾角与盘面比例。从正面看是椭圆盘、从其他角度看是有厚度
// 的椭圆体——任意视角都有立体感（这是用户对"圈立体"的核心诉求）。
//
// 距离选择：~2500~4500 单位 = 视场 58° 下约 7°~12° 视直径——大到足以
// 在视野里形成可识别的"星系轮廓"，又远到不参与 sim 物理（与 detailR
// ~115 的真实星系隔离半径 480 错开两个数量级，不会被误判为 sim 系统）。
//
// 视觉上覆盖全天球（10 个大致均匀分布）——任何朝向都能看到至少 3~4 个
// 近邻星系轮廓 + 1 个当前最靠近的真实 sim 系统，"全方位有内容"的
// 立体感由此建立。
export function createNeighborGalaxies(glowTex) {
  const group = new THREE.Group();
  // 10 个近邻星系，分布全天球。格式: [方向(x,y,z), 距离, 视直径°,
  // 颜色, 椭圆比, 自旋角度(rad)]
  const neighbors = [
    [ 0.62, -0.18,  0.78, 3000, 6.5, 0x8fa0d8, 2.2, 0.4],
    [-0.55,  0.30, -0.78, 3400, 5.8, 0xa8b0d0, 2.5, -0.7],
    [ 0.18,  0.85,  0.48, 2800, 7.2, 0xc0a8c8, 1.8, 0.9],
    [-0.78,  0.42,  0.45, 3600, 5.0, 0xb8a8c0, 2.0, -0.3],
    [ 0.35, -0.78,  0.52, 3200, 6.0, 0x9cb0d8, 2.4, 1.2],
    [-0.42, -0.62, -0.66, 3800, 4.8, 0xb0a8d8, 1.9, -1.1],
    [ 0.85,  0.32, -0.42, 4100, 4.2, 0xa8b8c8, 2.1, 0.6],
    [-0.32,  0.72, -0.62, 3500, 5.5, 0xb8b0d0, 2.3, -0.5],
    [ 0.72, -0.48, -0.50, 4200, 4.5, 0xc0b0d0, 2.0, 1.4],
    [-0.85, -0.32,  0.42, 3900, 5.0, 0xb0c0d8, 2.4, -0.8],
  ];
  for (const n of neighbors) {
    const [dx, dy, dz, dist, deg, colorHex, ratio, spin] = n;
    const l = Math.hypot(dx, dy, dz);
    const nx = dx / l, ny = dy / l, nz = dz / l;
    // 视直径 → 世界单位。视场 58°，1° 对应 dist × tan(1°) ≈ dist × 0.01745
    const worldPerDeg = dist * 0.01745;
    const w = worldPerDeg * deg;
    const h = w / ratio;
    // 用真实扁椭球（SphereGeometry 缩成盘），不是 sprite——任意视角都有
    // 厚度感，避免"圈还是 2D"的问题
    const geo = new THREE.SphereGeometry(1, 64, 24);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 1 }, uColor: { value: new THREE.Color(colorHex) } },
      vertexShader: `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec3 vLocal;
        void main() {
          float r = length(vec2(vLocal.x, vLocal.z));
          // 径向亮带：中心最亮、外缘柔和衰减
          float radial = smoothstep(1.0, 0.50, r) * smoothstep(0.10, 0.40, r);
          // 厚度方向：赤道面附近最亮，y 方向（盘的厚度）渐暗——形成核球凸起感
          float thick = smoothstep(0.85, 0.20, abs(vLocal.y));
          float a = radial * thick * 0.55 * uOpacity;
          if (a < 0.012) discard;
          vec3 col = uColor * (0.6 + 0.5 * radial);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(w * 0.5, w * 0.5 * 0.20, h * 0.5); // 半径=1 的球缩到 w/2；y 是厚度（0.20 比例）
    mesh.position.set(nx * dist, ny * dist, nz * dist);
    // 倾角：每个星系自旋一定角度，避免"全部正面对相机"导致看上去还是 2D
    mesh.rotation.set(spin * 0.7, spin, spin * 0.4);
    mesh.renderOrder = -78; // 在远景星系 sprite 之后
    group.add(mesh);
  }
  return group;
}