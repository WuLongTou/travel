// 渲染原语：程序化星球（含大气/环），真实数据的可视化近似
import * as THREE from 'three';
import { glowTexture, ringTexture } from './textures.js';

// 柔光晕 sprite：恒星/星系核心的辉光（billboard，永远面向相机）
// worldSize = 世界单位直径；中心亮核 + 指数衰减晕
export function makeGlowSprite(worldSize, color = '#ffffff', opacity = 1) {
  const tex = glowTexture(128);
  const mat = new THREE.SpriteMaterial({
    map: tex, color: new THREE.Color(color), transparent: true,
    opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(worldSize, worldSize, 1);
  return sprite;
}

// 生成一颗行星/恒星/月球：
// opts: { radius, color, emissive, emissiveIntensity, roughness, metalness,
//         map(颜色贴图), emissiveMap(自发光贴图,恒星) }
export function makeSphere(opts) {
  const { radius, color = '#8fa3bd', emissive = '#000000', emissiveIntensity = 0,
    roughness = 0.9, metalness = 0.0, map = null, emissiveMap = null } = opts;
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
  });
  if (map) mat.map = map;
  if (emissive) {
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = emissiveIntensity;
  }
  if (emissiveMap) mat.emissiveMap = emissiveMap;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// 行星环（土星式）：径向条纹渐晕贴图（卡西尼缝示意）+ 真实倾角由调用方设置
export function makeRing(innerWorld, outerWorld, color = '#d9cbb0') {
  const geo = new THREE.RingGeometry(innerWorld, outerWorld, 96, 1);
  // RingGeometry 的 UV 沿径向分布：把条纹贴图画成径向明暗 + 内外缘透明
  const mat = new THREE.MeshBasicMaterial({
    map: ringTexture(color),
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

// 轨道线（同心圆，颜色渐变由用户传入）
export function makeOrbitLine(radiusWorld, color = '#3d5575', segments = 256) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radiusWorld, 0, Math.sin(a) * radiusWorld));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.35 });
  const line = new THREE.Line(geo, mat);
  line.userData.isOrbit = true;
  return line;
}
