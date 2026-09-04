// 程序化星系点云（教育视觉：银河系级）
// 参数化螺旋星系：核球 + 盘 + 对数旋臂（可开）+ 银晕。
// 返回 { points, group }；缩放尺寸由调用方按层 kmPerUnit 折算。
import * as THREE from 'three';
import { mulberry32 } from '../util/math.js';
import { tempToHex } from '../util/units.js';

// opts:
//  rCore 核球半径 / rDisk 盘半径 / arms 旋臂数 / armWinding 缠绕度
//  countStars 恒星总数 / scale(整体世界半径=1 归一化) / armFraction 臂上星占比
//  flatten 盘扁平度(0..1) / tilt 倾斜角 / rotation 自转角 / seed
export function buildGalaxy(opts) {
  const {
    rCore = 0.18, rDisk = 1.0, arms = 2, armWinding = 2.4,
    countStars = 42000, armFraction = 0.62, flatten = 0.045,
    tilt = 0, seed = 11,
  } = opts;
  const rng = mulberry32(seed);
  const positions = new Float32Array(countStars * 3);
  const colors = new Float32Array(countStars * 3);
  const c = new THREE.Color();
  const discColor = (r, isArm) => {
    // 核球暖黄白，盘蓝白偏暖，臂上年轻星更蓝
    if (r < rCore * 1.6) return '#ffe6c8';
    if (isArm && rng() < 0.6) return '#cfe0ff';
    const t = 4600 + rng() * 3500; // 盘星温带
    return tempToHex(t);
  };
  for (let i = 0; i < countStars; i++) {
    const inArm = rng() < armFraction;
    let r, th;
    if (inArm && arms > 0) {
      // 沿对数螺臂 ± 高斯散布
      r = Math.pow(rng(), 0.65) * rDisk;
      // 每根臂的基线角度
      const base = (Math.floor(rng() * arms) / arms) * Math.PI * 2;
      const armAng = base + armWinding * Math.log(1 + r * 2.2);
      const scatter = 0.16 + r * 0.2;
      th = armAng + (rng() - 0.5) * scatter;
      // 中心附近无臂
      if (r < rCore * 0.7) { th = rng() * Math.PI * 2; }
    } else {
      // 盘场星（指数盘）
      r = Math.pow(rng(), 0.85) * rDisk;
      th = rng() * Math.PI * 2;
    }
    // 垂直分布：核球厚、盘薄
    const isBulge = r < rCore;
    const y = (rng() * 2 - 1) * (isBulge ? flatten * 2.6 : flatten * (1 - r * 0.5));
    positions[i * 3] = Math.cos(th) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(th) * r;
    const col = discColor(r, inArm);
    c.set(col);
    // 亮度按距中心衰减 + 随机
    const lum = (r < rCore * 0.5 ? 1.0 : 0.45 + 0.55 * (1 - r / rDisk)) * (0.5 + rng() * 0.5);
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
  // 整体变换：倾斜 + 旋转（绕 Y）
  const group = new THREE.Group();
  group.add(points);
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

// 星系间的“远距光晕”（极大尺度、小亮度）
export function buildGalaxyBlob(color = '#cfd8ff', opacity = 0.55) {
  // 供本星系群/超星系团层的远距星系岛使用
  return buildStarSwarm(3500, 1, { color, seed: 31, flatten: 0.35, size: 1.2 });
}
