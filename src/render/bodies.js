// 渲染原语：程序化星球（含大气/环），真实数据的可视化近似
import * as THREE from 'three';
import { bodyTexture, glowTexture } from './textures.js';

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
// opts: { radiusKm, textureSeed(可选), color, emissive(恒星), ring?, atmosphere? }
export function makeSphere(opts) {
  const { radius, color = '#8fa3bd', emissive = '#000000', emissiveIntensity = 0, roughness = 0.9, metalness = 0.0 } = opts;
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
  });
  if (emissive) {
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = emissiveIntensity;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// 行星环（土星式平面环带）
export function makeRing(innerKm, outerKm, color = 'rgba(200,190,170,0.85)') {
  // three RingGeometry 需要世界半径；用透明贴图渐晕（稍后统一调整透明度）
  const geo = new THREE.RingGeometry(innerKm, outerKm, 96, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
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
