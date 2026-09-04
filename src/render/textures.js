// 渲染原语：程序化纹理（2D canvas → three）
import * as THREE from 'three';

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

// 行星/恒星基础贴图：色斑球面（后续可替换为 shader 球）
export function bodyTexture(size = 256, base = '#8a9bb8', bands = ['#5a6d8a', '#a8b8cf', '#44526e'], bandCount = 6) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // 水平带（类木行星条纹）
  const n = bands.length;
  for (let i = 0; i < bandCount; i++) {
    const y0 = (i / bandCount) * size;
    const hgt = size / bandCount;
    const gd = g.createLinearGradient(0, y0, 0, y0 + hgt);
    gd.addColorStop(0, bands[i % n]);
    gd.addColorStop(0.5, bands[(i + 1) % n]);
    gd.addColorStop(1, bands[i % n]);
    g.fillStyle = gd;
    g.fillRect(0, y0, size, hgt + 1);
  }
  // 扰动噪斑
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 2 + Math.random() * 14;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
