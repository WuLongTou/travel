// 渲染原语：程序化纹理（2D canvas → three）
// 所有贴图用固定 seed 随机数，保证每次构建外观一致。
import * as THREE from 'three';
import { mulberry32 } from '../util/math.js';

// 柔光点（sprite/points 用）
export function glowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 气态巨行星：水平条纹 + 湍流扰动 + 可选风暴斑（木星大红斑式）
export function gasGiantTexture({ base = '#e0b88e', bands = ['#c89868', '#e8d0a8', '#b08858'], bandCount = 12, spot = null, seed = 1, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = mulberry32(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // 条纹：每条带柔和明暗过渡
  for (let i = 0; i < bandCount; i++) {
    const y0 = (i / bandCount) * size;
    const hgt = size / bandCount;
    const gd = g.createLinearGradient(0, y0, 0, y0 + hgt);
    const col = bands[i % bands.length];
    gd.addColorStop(0, col);
    gd.addColorStop(0.5, base);
    gd.addColorStop(1, col);
    g.fillStyle = gd;
    g.fillRect(0, y0, size, hgt + 1);
  }
  // 湍流：沿条纹方向的拉伸色斑（行星大气流动感）
  for (let i = 0; i < 260; i++) {
    const x = rng() * size, y = rng() * size;
    const w = 8 + rng() * 42, h = 2 + rng() * 5;
    g.fillStyle = rng() < 0.5 ? 'rgba(255,245,225,0.10)' : 'rgba(90,60,35,0.10)';
    g.beginPath();
    g.ellipse(x, y, w, h, 0, 0, 7);
    g.fill();
  }
  // 风暴斑（大红斑式：南半球椭圆漩涡）
  if (spot) {
    const sx = size * (spot.x ?? 0.3), sy = size * (spot.y ?? 0.62);
    const rx = size * (spot.rx ?? 0.07), ry = rx * 0.6;
    const grd = g.createRadialGradient(sx, sy, rx * 0.2, sx, sy, rx);
    grd.addColorStop(0, spot.color || '#c25a3a');
    grd.addColorStop(0.7, spot.color || '#c25a3a');
    grd.addColorStop(1, 'rgba(194,90,58,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(sx, sy, rx, ry, 0, 0, 7);
    g.fill();
    g.strokeStyle = 'rgba(255,230,200,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(sx, sy, rx * 0.8, ry * 0.8, 0, 0, 7);
    g.stroke();
  }
  return toTexture(c);
}

// 岩石行星：斑驳底色 + 明暗噪声 + 陨石坑（暗环+亮心）
export function rockyTexture({ base = '#b5a396', dark = '#7a6a5c', light = '#d8ccc0', craterCount = 26, seed = 2, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = mulberry32(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // 大块明暗斑（地质分区）
  for (let i = 0; i < 46; i++) {
    const x = rng() * size, y = rng() * size, r = 14 + rng() * 60;
    g.fillStyle = rng() < 0.5 ? hexA(dark, 0.16) : hexA(light, 0.14);
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  }
  // 陨石坑：暗环 + 偏移亮心（俯视光照感）
  for (let i = 0; i < craterCount; i++) {
    const x = rng() * size, y = rng() * size, r = 2 + rng() * 9;
    g.strokeStyle = hexA(dark, 0.5);
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.stroke();
    g.fillStyle = hexA(light, 0.32);
    g.beginPath();
    g.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, 7);
    g.fill();
  }
  return toTexture(c);
}

// 地球：蓝色海洋 + 绿棕大陆 + 极地冰盖 + 云（高斯团块）
export function earthTexture({ seed = 42, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = mulberry32(seed);
  g.fillStyle = '#2e6bb8';
  g.fillRect(0, 0, size, size);
  // 海洋深浅
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(30,80,150,0.25)' : 'rgba(80,150,210,0.18)';
    g.beginPath();
    g.arc(rng() * size, rng() * size, 20 + rng() * 70, 0, 7);
    g.fill();
  }
  // 大陆：聚集的绿/棕斑块（几大"陆块"中心撒椭圆形）
  const continents = 6;
  for (let k = 0; k < continents; k++) {
    const cx = rng() * size, cy = size * (0.18 + rng() * 0.64);
    for (let i = 0; i < 60; i++) {
      const a = rng() * Math.PI * 2, d = Math.pow(rng(), 0.6) * size * 0.09;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
      g.fillStyle = rng() < 0.62 ? 'rgba(66,122,66,0.85)' : 'rgba(150,124,72,0.8)';
      g.beginPath();
      g.ellipse(x, y, 5 + rng() * 16, 4 + rng() * 11, a, 0, 7);
      g.fill();
    }
  }
  // 极地冰盖
  const capN = g.createLinearGradient(0, 0, 0, size * 0.14);
  capN.addColorStop(0, 'rgba(240,248,255,0.95)');
  capN.addColorStop(1, 'rgba(240,248,255,0)');
  g.fillStyle = capN;
  g.fillRect(0, 0, size, size * 0.14);
  const capS = g.createLinearGradient(0, size * 0.86, 0, size);
  capS.addColorStop(0, 'rgba(240,248,255,0)');
  capS.addColorStop(1, 'rgba(240,248,255,0.95)');
  g.fillStyle = capS;
  g.fillRect(0, size * 0.86, size, size * 0.14);
  // 云：白色柔团
  for (let i = 0; i < 70; i++) {
    const x = rng() * size, y = rng() * size;
    const w = 10 + rng() * 30;
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.ellipse(x, y, w, w * 0.35, 0, 0, 7);
    g.fill();
  }
  return toTexture(c);
}

// 金星：浓硫酸云层（柔和黄白漩涡）
export function venusTexture({ seed = 5, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = mulberry32(seed);
  g.fillStyle = '#e3c896';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 130; i++) {
    const x = rng() * size, y = rng() * size;
    g.fillStyle = rng() < 0.5 ? 'rgba(245,230,190,0.22)' : 'rgba(190,150,90,0.18)';
    g.beginPath();
    g.ellipse(x, y, 20 + rng() * 60, 6 + rng() * 14, (rng() - 0.5) * 0.8, 0, 7);
    g.fill();
  }
  return toTexture(c);
}

// 天王星/海王星：冰巨行星（近乎均匀的淡色 + 极浅纬向带）
export function iceGiantTexture({ base = '#9ad9dc', band = 'rgba(255,255,255,0.14)', seed = 9, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = mulberry32(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 8; i++) {
    const y0 = rng() * size;
    g.fillStyle = band;
    g.fillRect(0, y0, size, size * 0.05);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.ellipse(rng() * size, rng() * size, 15 + rng() * 40, 5 + rng() * 10, 0, 0, 7);
    g.fill();
  }
  return toTexture(c);
}

// 太阳：米粒组织颗粒 + 亮暗斑（emissiveMap 用，暖橙底）
export function sunTexture({ seed = 7, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = mulberry32(seed);
  g.fillStyle = '#ffc86e';
  g.fillRect(0, 0, size, size);
  // 米粒组织：密集小颗粒（对流层观感）
  for (let i = 0; i < 2600; i++) {
    const x = rng() * size, y = rng() * size, r = 1.5 + rng() * 4;
    g.fillStyle = rng() < 0.55 ? 'rgba(255,235,170,0.5)' : 'rgba(215,130,50,0.4)';
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  }
  // 少量暗斑（太阳黑子，避免过大失真）
  for (let i = 0; i < 5; i++) {
    const x = rng() * size, y = size * (0.3 + rng() * 0.4), r = 3 + rng() * 6;
    g.fillStyle = 'rgba(120,60,20,0.55)';
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  }
  return toTexture(c);
}

// 亮星光晕（带衍射芒）：径向柔光 + 十字四芒（望远镜观星的亮星特征）
export function spikeGlowTexture(size = 128) {
  const [c, g] = makeCanvas(size);
  const R = size / 2;
  // 底层：径向柔光（与 glowTexture 同分布）
  const grad = g.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // 四芒：细长渐变（中央亮、尖端透明），水平+垂直
  for (const rot of [0, Math.PI / 2]) {
    g.save();
    g.translate(R, R);
    g.rotate(rot);
    const lg = g.createLinearGradient(-R, 0, R, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(-R, -size * 0.022, size, size * 0.044);
    g.restore();
  }
  return toTexture(c);
}

// 行星环贴图：同心条纹（RingGeometry 的 UV 为平面映射，条纹须画成同心圆）
// f0 = innerR/outerR 与几何一致；卡西尼缝为一条透明环缝
export function ringTexture({ color = '#d9cbb0', dark = '#b0a080', innerOverOuter = 0.625, seed = 11, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = mulberry32(seed);
  const R = size / 2;
  g.clearRect(0, 0, size, size);
  const N = 44;
  for (let i = 0; i < N; i++) {
    const f = innerOverOuter + ((i + 0.5) / N) * (1 - innerOverOuter);
    const bright = 0.72 + rng() * 0.28;
    g.strokeStyle = hexA(rng() < 0.6 ? color : dark, bright);
    g.lineWidth = ((1 - innerOverOuter) * R / N) * (0.7 + rng() * 0.5);
    g.beginPath();
    g.arc(R, R, f * R, 0, 7);
    g.stroke();
  }
  // 卡西尼缝（约外径 88% 处的透明环缝）+ 内外缘羽化
  g.globalCompositeOperation = 'destination-out';
  g.lineWidth = (1 - innerOverOuter) * R * 0.07;
  g.strokeStyle = 'rgba(0,0,0,0.9)';
  g.beginPath();
  g.arc(R, R, 0.875 * R, 0, 7);
  g.stroke();
  for (const [f0, f1] of [[innerOverOuter, innerOverOuter + 0.04], [0.965, 1.0]]) {
    g.lineWidth = (f1 - f0) * R * 2;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.arc(R, R, ((f0 + f1) / 2) * R, 0, 7);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  return toTexture(c);
}

// '#rrggbb' + alpha → rgba() 串
function hexA(hex, a) {
  const s = hex.replace('#', '');
  const r = parseInt(s.slice(0, 2), 16), gc = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r},${gc},${b},${a})`;
}
