// 星空背景：分层恒星点云 +（可选）银河带 +（可选）CMB 壳
// 跟随相机平移（无界星空），由 world.ambient 配置。
import * as THREE from 'three';
import { mulberry32 } from '../util/math.js';
import { tempToHex } from '../util/units.js';

// 生成一颗恒星点云：count 个点，spread 半径（世界单位），
// colorFn(rng) -> hex。固定尺寸衰减关（点即星点）。
// 分布 = 远距离球壳（0.9–1.0 × spread）：星点永远是"远方天球"，
// 不会散布到世界内容（太阳/星系）附近形成颗粒噪声。
export function starCloud(count, spread, colorFn = () => '#ffffff', size = 1.6) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rng = mulberry32((Math.random() * 1e9) | 0);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const z = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - z * z));
    const r = spread * (0.9 + rng() * 0.1);
    positions[i*3] = Math.cos(phi) * rr * r;
    positions[i*3+1] = z * r;
    positions[i*3+2] = Math.sin(phi) * rr * r;
    c.set(colorFn(rng));
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.75, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// 银河带（盘状星云背景，扁椭球点云 + 低亮度弥漫光）
// 真实银河 = 盘面恒星密集 + 银心鼓包；视觉上应是一条约 60° 斜跨天空的
// 弥漫光带：点要密、小、暗（单点过亮会被 Bloom 放大成绒球）。
export function milkyWayBand(thickness = 0.12) {
  const group = new THREE.Group();
  const count = 26000;
  const positions = new Float32Array(count*3);
  const colors = new Float32Array(count*3);
  const rng = mulberry32(42);
  const c = new THREE.Color();
  const rMax = 1;
  for (let i = 0; i < count; i++) {
    // 半径分布：核球密集 + 盘
    const r = Math.pow(rng(), 0.5) * rMax;
    const th = rng()*Math.PI*2;
    let y;
    if (r < 0.18) y = (rng()*2-1)*0.05; // 核球略厚
    else y = (rng()*2-1)*thickness*(1-r); // 盘薄
    positions[i*3] = Math.cos(th)*r;
    positions[i*3+1] = y;
    positions[i*3+2] = Math.sin(th)*r;
    // 颜色：核球暖白，盘偏蓝白，整体压暗（避开 Bloom 发光阈值）
    const bright = 0.25 + rng()*0.3;
    if (r < 0.18) c.set('#ffe6c4').multiplyScalar(bright*1.15);
    else if (rng() < 0.75) c.set('#dde6ff').multiplyScalar(bright);
    else c.set('#ffd9b0').multiplyScalar(bright*0.85);
    colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 1.1, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  group.add(pts);
  // 缩放为世界大尺度（跟随相机外很远）
  const S = 6000;
  group.scale.set(S, S, S);
  group.frustumCulled = false;
  return group;
}

// CMB 壳：遥远各向同性“火墙”球面点云（宇宙微波背景的视觉近似）
export function cmbShell(radius, count = 22000, opts = {}) {
  const { size = 3, opacity = 0.28 } = opts;
  const positions = new Float32Array(count*3);
  const colors = new Float32Array(count*3);
  const rng = mulberry32(7);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const z = rng()*2-1;
    const phi = rng()*Math.PI*2;
    const rr = Math.sqrt(Math.max(0, 1-z*z));
    positions[i*3] = Math.cos(phi)*rr*radius;
    positions[i*3+1] = z*radius;
    positions[i*3+2] = Math.sin(phi)*rr*radius;
    const f = 0.55 + rng()*0.45;
    c.set('#e8a97f').multiplyScalar(f);
    colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// 生成并组装背景组（按 ambient 配置：starCount/starSpread/starSize/milkyWay）
export function buildAmbient(ambient, camera) {
  const group = new THREE.Group();
  group.position.copy(camera.position);
  // 主星空（球壳状分布，跟随相机）；count=0 合法（如 cosmos 层自带全部）
  const starPts = starCloud(ambient.starCount ?? 9000, ambient.starSpread ?? 4000,
    (rng) => tempToHex(2800 + Math.pow(rng(), 2.2) * 30000), ambient.starSize ?? 1.5);
  group.add(starPts);
  if (ambient.milkyWay) {
    const mw = milkyWayBand(ambient.milkyWayThickness || 0.1);
    // 真实银道面相对黄道倾斜 ~60°：避免与行星轨道面重合的假象
    mw.rotation.z = 1.05;
    mw.rotation.x = 0.35;
    group.add(mw);
  }
  if (ambient.cmb) {
    group.add(cmbShell(ambient.cmbRadius || 2.2e6, 20000));
  }
  return group;
}
