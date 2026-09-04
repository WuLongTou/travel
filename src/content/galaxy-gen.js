// 程序化星系点云（教育视觉：银河系级）
// 结构 = 中央棒 + 两条主对数旋臂（带次级碎臂）+ 指数盘 + 核球 + HII 恒星形成区。
// 返回 Group（内含恒星点云 + HII 亮点层）；整体缩放由调用方完成。
import * as THREE from 'three';
import { mulberry32 } from '../util/math.js';
import { tempToHex } from '../util/units.js';

// 高斯随机（Box-Muller）
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// opts:
//  rCore 核球半径(归一) / rDisk 盘半径(归一) / arms 主臂数 / pitch 旋臂缠绕（每 e^1 半径的弧度）
//  countStars 恒星总数 / armFraction 臂上星占比 / barLength 中央棒半长(归一)
//  flatten 盘扁平度(0..1) / tilt 倾斜角 / seed
export function buildGalaxy(opts) {
  const {
    rCore = 0.16, rDisk = 1.0, arms = 2, pitch = 3.1,
    countStars = 120000, armFraction = 0.55, barLength = 0.22,
    flatten = 0.045, tilt = 0, seed = 11,
  } = opts;
  const rng = mulberry32(seed);
  const positions = new Float32Array(countStars * 3);
  const colors = new Float32Array(countStars * 3);
  const c = new THREE.Color();

  // 对数螺旋臂：给定半径 r，返回第 k 条臂的角度
  const armAngle = (r, k) => (k / arms) * Math.PI * 2 + pitch * Math.log(Math.max(r, 1e-3) / rCore);

  for (let i = 0; i < countStars; i++) {
    let x, y, z, r;
    const mode = rng();
    if (mode < 0.10) {
      // 核球：3D 高斯椭球（略扁）
      r = Math.abs(gauss(rng)) * rCore * 0.55;
      const th = rng() * Math.PI * 2;
      x = Math.cos(th) * r * (1 + gauss(rng) * 0.2);
      z = Math.sin(th) * r * (1 + gauss(rng) * 0.2);
      y = gauss(rng) * rCore * flatten * 3.2;
      c.set('#ffd9a0');
    } else if (mode < 0.17 && barLength > 0) {
      // 中央棒：沿 x 轴的细长椭球（棒旋星系特征）
      const t = (rng() * 2 - 1) * barLength;
      x = t * 1.6;
      z = gauss(rng) * barLength * 0.16;
      y = gauss(rng) * barLength * 0.09;
      c.set('#ffd9a8');
    } else if (rng() < armFraction && arms > 0) {
      // 旋臂星：沿臂曲线 + 高斯横向散布（散布随半径增大）
      r = rCore * 0.75 + Math.pow(rng(), 0.72) * (rDisk - rCore * 0.75);
      const k = Math.floor(rng() * arms);
      // 30% 的臂星落入次级碎臂（角相位偏移 + 更散），制造真实的不均匀臂
      const spur = rng() < 0.3;
      const baseAng = armAngle(r, k) + (spur ? (rng() < 0.5 ? 0.5 : -0.5) * pitch * 0.22 : 0);
      const spread = (spur ? 0.10 : 0.055) + r * (spur ? 0.16 : 0.09);
      const ang = baseAng + gauss(rng) * spread / Math.max(r, 0.05);
      x = Math.cos(ang) * r;
      z = Math.sin(ang) * r;
      y = gauss(rng) * flatten * (1 - (r / rDisk) * 0.45) * (spur ? 1.4 : 1);
      // 臂上星更蓝（年轻恒星），~8% 极蓝亮星
      c.set(rng() < 0.08 ? '#aac8ff' : (rng() < 0.6 ? '#cfe0ff' : '#e8ecff'));
    } else {
      // 盘场星：指数盘（标长 ~ rDisk/3）
      r = -Math.log(1 - rng()) * (rDisk / 3);
      if (r > rDisk) r = rng() * rDisk;
      const th = rng() * Math.PI * 2;
      x = Math.cos(th) * r;
      z = Math.sin(th) * r;
      y = gauss(rng) * flatten * 1.5 * (1 - (r / rDisk) * 0.4);
      const t = 4300 + rng() * 4200;
      c.set(tempToHex(t));
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    // 亮度：核球/棒最亮，盘外缘衰减
    const rr = Math.hypot(x, z);
    const lum = (rr < rCore ? 1.0 : Math.max(0.32, 0.95 * (1 - rr / rDisk) + 0.25)) * (0.55 + rng() * 0.45);
    colors[i * 3] = c.r * lum; colors[i * 3 + 1] = c.g * lum; colors[i * 3 + 2] = c.b * lum;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.4, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.95, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const group = new THREE.Group();
  group.add(points);

  // HII 恒星形成区：沿主臂点缀的粉色亮斑（真实星系照片的显著特征）
  const hiiCount = Math.round(arms * 14);
  const hp = new Float32Array(hiiCount * 3);
  for (let i = 0; i < hiiCount; i++) {
    const r = rCore * 0.9 + Math.pow(rng(), 0.8) * (rDisk * 0.82 - rCore * 0.9);
    const k = Math.floor(rng() * arms);
    const ang = armAngle(r, k) + gauss(rng) * 0.03;
    hp[i * 3] = Math.cos(ang) * r;
    hp[i * 3 + 1] = gauss(rng) * flatten * 0.6;
    hp[i * 3 + 2] = Math.sin(ang) * r;
  }
  const hgeo = new THREE.BufferGeometry();
  hgeo.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  const hmat = new THREE.PointsMaterial({
    size: 5, sizeAttenuation: false, color: '#ff9fb0',
    transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const hii = new THREE.Points(hgeo, hmat);
  hii.frustumCulled = false;
  group.add(hii);

  if (tilt) group.rotation.z = tilt;
  return group;
}

// 球状星团/矮星系（松散椭球点云）
export function buildStarSwarm(count = 6000, radius = 1, opts = {}) {
  const rng = mulberry32(opts.seed || 5);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const flatten = opts.flatten || 1; // 1 = 球状
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // 中心密集的球分布（r^3 累积反演：r = u^(1/3)）
    const r = Math.pow(rng(), 1 / 3) * radius;
    const th = rng() * Math.PI * 2;
    const z = rng() * 2 - 1;
    const rr = Math.sqrt(Math.max(0, 1 - z * z));
    positions[i * 3] = Math.cos(th) * rr * r;
    positions[i * 3 + 1] = z * r * flatten;
    positions[i * 3 + 2] = Math.sin(th) * rr * r;
    // 老年星暖色为主
    c.set(opts.color || (rng() < 0.75 ? '#ffdfae' : '#f0c9ff'));
    const lum = 0.5 + rng() * 0.5;
    colors[i * 3] = c.r * lum; colors[i * 3 + 1] = c.g * lum; colors[i * 3 + 2] = c.b * lum;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: opts.size || 1.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// 宇宙网生成器：节点 + 节点连边撒点（丝）+ 节点团 + 巨洞稀疏背景
// nodes: [{ pos:[x,y,z], w(权重) }]；radius = 全域半径；返回 Points。
// 视觉对应真实宇宙网：星系沿暗物质丝状结构分布，节点处富集星系团。
export function buildCosmicWeb({ nodes, radius, count = 40000, seed = 3,
  color = '#b9c8ff', size = 1.4, opacity = 0.75, colorFn = null }) {
  const rng = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  const put = (i, x, y, z, lum = 1) => {
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    if (colorFn) c.set(colorFn(Math.hypot(x, y, z) / radius, rng));
    else c.set(color);
    colors[i * 3] = c.r * lum; colors[i * 3 + 1] = c.g * lum; colors[i * 3 + 2] = c.b * lum;
  };
  // 连边：所有节点对按权重×距离^0.5 抽取（近距离优先，符合真实丝的走向）
  const edges = [];
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const d = Math.hypot(
        nodes[a].pos[0] - nodes[b].pos[0],
        nodes[a].pos[1] - nodes[b].pos[1],
        nodes[a].pos[2] - nodes[b].pos[2],
      );
      if (d < radius * 1.1) edges.push({ a, b, d, w: (nodes[a].w + nodes[b].w) / (d + 1) });
    }
  }
  const totalW = edges.reduce((s, e) => s + e.w, 0);
  const pickEdge = () => {
    let t = rng() * totalW;
    for (const e of edges) { t -= e.w; if (t <= 0) return e; }
    return edges[edges.length - 1];
  };
  const nodeW = nodes.reduce((s, n) => s + n.w, 0);
  const pickNode = () => {
    let t = rng() * nodeW;
    for (const n of nodes) { t -= n.w; if (t <= 0) return n; }
    return nodes[nodes.length - 1];
  };
  const gauss2 = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  for (let i = 0; i < count; i++) {
    const mode = rng();
    if (mode < 0.58) {
      // 丝：沿节点对连线 + 横向高斯（粗丝 1.5% 边长）
      const e = pickEdge();
      const A = nodes[e.a].pos, B = nodes[e.b].pos;
      const t = rng();
      const w = e.d * 0.015;
      put(i,
        A[0] + (B[0] - A[0]) * t + gauss2() * w,
        A[1] + (B[1] - A[1]) * t + gauss2() * w,
        A[2] + (B[2] - A[2]) * t + gauss2() * w,
        0.5 + rng() * 0.35);
    } else if (mode < 0.85) {
      // 节点团：节点周围高斯富集（星系团/群）
      const n = pickNode();
      const r = n.w * 0.02 + Math.abs(gauss2()) * radius * 0.012;
      const th = rng() * Math.PI * 2, zz = rng() * 2 - 1;
      const rr = Math.sqrt(Math.max(0, 1 - zz * zz));
      put(i,
        n.pos[0] + Math.cos(th) * rr * r,
        n.pos[1] + zz * r,
        n.pos[2] + Math.sin(th) * rr * r,
        0.55 + rng() * 0.4);
    } else {
      // 巨洞：全域极稀疏均匀（大尺度均匀性）
      const u = rng() * 2 - 1, phi = rng() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - u * u));
      const R = radius * Math.cbrt(rng());
      put(i, Math.cos(phi) * rr * R, u * R, Math.sin(phi) * rr * R, 0.22 + rng() * 0.2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
