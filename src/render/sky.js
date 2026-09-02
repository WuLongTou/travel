// 渲染域：无限星空背景、银河带方向采样、星场与远星云
import * as THREE from 'three';
import { randomUnit } from '../core/utils.js';
import { COLLECTION_LEVELS } from '../core/config.js';

export function createCosmicSky() {
  // 无限星空背景：这是一个始终跟随相机的单位天球，
  // 不是包裹宇宙的有限椭球/球壳，因此小球无论飞多远都不会“跑出宇宙”。
  const geo = new THREE.SphereGeometry(1, 48, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform float uTime;
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      void main() {
        vec3 dir = normalize(vDir);
        // 银河带：只提高带内**星点**的密度与亮度（真实银河就是密集星场），
        // 不加任何弥漫底色——宇宙背景是纯黑的，没有"环境光"
        float band = exp(-pow((dir.y * 0.75 + dir.z * 0.35), 2.0) * 9.0);
        vec3 base = vec3(0.0);
        // 离散星点：把方向切成小格，每格随机出现一颗星。
        // 银河带内格子出星概率更高（阈值放宽），读作一条密星带
        vec3 cell = floor(dir * 220.0);
        float h = hash(cell);
        float star = smoothstep(0.9975 - band * 0.0028, 1.0, h);
        vec3 starColor = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.95, 0.85), hash(cell + 7.0));
        base += starColor * star * (0.35 + hash(cell + 11.0) * 0.55) * (0.7 + band * 0.3);
        // 少量彩色亮星
        float bright = smoothstep(0.9997, 1.0, hash(cell + 3.0));
        base += vec3(1.0, 0.85, 0.7) * bright * 0.5;
        gl_FragColor = vec4(base, 1.0);
      }
    `,
    // （uTime 已移除：shader 未使用，纯死代码）
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

// 银河带法线（星空里那条恒星密集的带）：给个倾角，别正对坐标轴
export const GALAXY_NORMAL = (() => {
  const n = [0.34, 0.88, -0.32];
  const l = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / l, n[1] / l, n[2] / l];
})();

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

export function createStarfield() {
  // 真实夜空的星等分布是幂律：暗星压倒性多数，亮星极少。
  // 恒星颜色按真实黑体色温分布（O/B/A 偏蓝 → G 黄白 → K/M 橙红），
  // 而不是"几乎全白"。分三层：暗星海 + 中亮 + 少量亮星（形成层次）。
  const group = new THREE.Group();
  // sizeAttenuation: false —— 星点以**固定像素尺寸**渲染。背景星空在
  // "无穷远"（天球），角尺寸本就该恒定；此前用 sizeAttenuation:true +
  // 半径 900~4500，多数星点被衰减成亚像素（闪烁的微光），中央视野
  // 几乎没有可读星点（2026-09-03 修复，配合镜头框距的观赏性整改）。
  const layers = [
    { n: 7000, size: 1.3, lo: 0.035, hi: 0.30, pow: 2.3, op: 0.95 },
    { n: 900, size: 2.1, lo: 0.28, hi: 0.62, pow: 2.6, op: 1.0 },
    { n: 130, size: 3.6, lo: 0.60, hi: 0.98, pow: 2.9, op: 1.0 },
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
      // 约 45% 的恒星聚在银河带上，其余全天均匀
      const dir = Math.random() < 0.45 ? sampleGalaxyDirection() : randomUnit(1);
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
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
  }
  return group;
}

// 远星云：极少量、极暗的彩色气体云，跟随相机（无限宇宙感）。
// 宇宙空间整体应该是黑暗的——星云只是偶尔点缀的色斑，不能成为"背景光"。
// 数量 18→9（保持）；透明度 2026-09-03 自 0.035~0.08 回调到 0.055~0.105：
// 配合固定像素星点，天幕要有可读的层次（星等层次 + 偶尔的色斑纵深），
// 但依然是"黑暗宇宙里偶尔的点缀"，不是背景光。
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
      blending: THREE.AdditiveBlending, opacity: 0.055 + Math.random() * 0.05,
    }));
    // 散布在天球上，距离很远（远于恒星层，营造纵深）
    const dir = randomUnit(1);
    const r = 4000 + Math.random() * 2400;
    sprite.position.set(dir[0] * r, dir[1] * r, dir[2] * r);
    // 巨大且形态多样：长宽比随机（细长→浑圆），尺寸数百~上千世界单位
    const w = 240 + Math.random() * 640;
    const h = w * (0.35 + Math.random() * 0.85);
    sprite.scale.set(w, h, 1);
    sprite.material.rotation = Math.random() * Math.PI;
    sprite.renderOrder = -90; // 在恒星层之后、宇宙天球之前
    group.add(sprite);
  }
  return group;
}

// 全屏爆炸闪光 / 冲击波 / 径向射线叠加层
