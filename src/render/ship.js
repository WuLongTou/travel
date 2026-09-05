// 飞船模型：低多边形街机飞船（程序化组装，无外部资源）
// 机头朝 -Z（与 Probe yaw=0 的前向一致）；整体长度约 2 个单位，
// 调用方按追踪距离等比缩放。附带引擎尾焰（随推力量级缩放）与引擎辉光。
import * as THREE from 'three';
import { makeGlowSprite } from './bodies.js';

export function makeShip() {
  const ship = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8fa3bd, roughness: 0.45, metalness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3342, roughness: 0.6, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fd8ff, roughness: 0.15, metalness: 0.2,
    emissive: 0x2a6a9f, emissiveIntensity: 0.7,
  });

  // 主机身：拉长的八面体（机头 -Z）
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 8), hullMat);
  body.rotation.x = -Math.PI / 2; // 锥尖朝 -Z
  ship.add(body);

  // 座舱：半埋入机身的玻璃罩
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), glassMat);
  canopy.scale.set(1, 0.6, 1.6);
  canopy.position.set(0, 0.12, -0.15);
  ship.add(canopy);

  // 双翼：薄盒 + 翼尖灯（左红右绿，航空惯例）
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.42), darkMat);
    wing.position.set(side * 0.5, -0.02, 0.32);
    wing.rotation.y = side * -0.18; // 轻微后掠
    ship.add(wing);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff4444 : 0x44ff77 }),
    );
    tip.position.set(side * 0.92, -0.02, 0.42);
    ship.add(tip);
  }

  // 尾翼：垂直安定面
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.34), darkMat);
  tail.position.set(0, 0.22, 0.42);
  ship.add(tail);

  // 双引擎涵道
  for (const side of [-1, 1]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.34, 12), darkMat);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(side * 0.28, -0.03, 0.48);
    ship.add(eng);
  }

  // 引擎尾焰：加色锥体（+Z 喷射），main 按推力缩放 visible/scale
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 12), flameMat);
  flame.rotation.x = Math.PI / 2; // 锥尖朝 +Z（向后喷）
  flame.position.set(0, -0.03, 0.95);
  ship.add(flame);

  // 引擎辉光（billboard，随尾焰联动）
  const glow = makeGlowSprite(0.9, '#55bbff', 0.5);
  glow.position.set(0, -0.03, 0.7);
  ship.add(glow);

  ship.userData.flame = flame;
  ship.userData.glow = glow;
  return ship;
}

// 按推力量级更新尾焰：throttle 0..1（0 = 滑行，隐藏）；boost 时拉长增亮
export function updateShipFlame(ship, throttle, boost) {
  const flame = ship.userData.flame, glow = ship.userData.glow;
  if (!flame) return;
  const on = throttle > 0.01;
  flame.visible = on;
  glow.visible = on;
  if (!on) return;
  const s = throttle * (boost ? 1.5 : 1);
  // 锥体长度在本地 Y 轴（旋转到世界 +Z）：拉伸 Y 即拉长尾焰
  flame.scale.set(1, 0.4 + s * 1.1, 1);
  flame.material.opacity = 0.45 + Math.min(0.5, s * 0.4);
  const gs = 0.5 + s * 0.7;
  glow.scale.set(gs, gs, 1);
}
