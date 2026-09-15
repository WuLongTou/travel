// 探测器模型：旅行者式深空探测器（程序化组装，无外部资源）
// 机头朝 -Z（与 Probe yaw=0 的前向一致）；整体长度约 1.8 个单位，
// 调用方按追踪距离等比缩放。附带主引擎尾焰（随推力量级缩放）与引擎辉光。
//
// 结构（真实探测器惯例）：
//   - 六边形主结构（金色隔热箔）
//   - 朝前的高增益抛物面天线（碟面朝 -Z，通信/造型双担当）
//   - 碟面中央馈源桅杆
//   - 尾部 RTG 桁架杆 + 翼片散热体
//   - 两侧细杆天线（后掠）
import * as THREE from 'three';
import { makeGlowSprite } from './bodies.js';

export function makeShip() {
  const ship = new THREE.Group();

  const foilMat = new THREE.MeshStandardMaterial({ color: 0xc9a24b, roughness: 0.35, metalness: 0.85 }); // 金箔
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xd8dee8, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3342, roughness: 0.6, metalness: 0.6 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.5, metalness: 0.7 });

  // 主结构：六边形扁柱（金箔包覆）
  const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.3, 6), foilMat);
  bus.rotation.x = Math.PI / 2; // 柱轴对齐 Z
  ship.add(bus);

  // 设备带：主结构背面的深色设备盒
  const boxes = [
    [0.1, 0.08, 0.1, 0.1, -0.06, 0.18],
    [-0.11, 0.05, 0.09, -0.09, 0.07, 0.17],
    [0.02, -0.12, 0.08, 0.05, 0.1, 0.16],
  ];
  for (const [w, h, d, x, y, z] of boxes) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w * 2, h * 2, d * 2), darkMat);
    box.position.set(x, y, z);
    ship.add(box);
  }

  // 高增益天线：浅球冠碟面，开口朝 -Z（前方）
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 28, 12, 0, Math.PI * 2, 0, 0.6),
    dishMat,
  );
  dish.rotation.x = -Math.PI / 2; // 球冠极轴对齐 Z，凹面朝 -Z
  dish.position.set(0, 0, -0.42);
  ship.add(dish);

  // 碟体：碟面背面的浅锥托盘——侧后方看也有碟形轮廓，避免边缘一条线
  const saucer = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.14, 28), dishMat);
  saucer.rotation.x = -Math.PI / 2; // 锥尖朝 -Z
  saucer.position.set(0, 0, -0.34);
  ship.add(saucer);

  // 碟面背筋（中心毂）
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 12), darkMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 0, -0.3);
  ship.add(hub);

  // 馈源桅杆：从毂向 -Z 伸出，末端馈源体
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8), mastMat);
  mast.rotation.x = Math.PI / 2;
  mast.position.set(0, 0, -0.62);
  ship.add(mast);
  const feed = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 8), foilMat);
  feed.rotation.x = -Math.PI / 2; // 锥尖朝 -Z
  feed.position.set(0, 0, -0.88);
  ship.add(feed);

  // RTG 桁架：向 +Z（尾部）伸出的细长杆，末端散热翼体
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 8), mastMat);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0, 0.6);
  ship.add(boom);
  const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 8), darkMat);
  rtg.rotation.x = Math.PI / 2;
  rtg.position.set(0, 0, 1.02);
  ship.add(rtg);
  for (const a of [0, Math.PI / 3, Math.PI * 2 / 3]) { // RTG 散热翼片
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.16, 0.18), darkMat);
    fin.position.set(0, 0, 1.02);
    fin.rotation.z = a;
    rtg.add(fin);
  }

  // 两侧后掠细杆天线（磁强计桁架的示意）
  for (const side of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.66, 6), mastMat);
    ant.position.set(side * 0.24, 0.02, 0.36);
    ant.rotation.set(Math.PI / 2 - 0.5, 0, side * -0.35);
    ship.add(ant);
  }

  // 主引擎：尾部中央小喷口（+Z），TCM 修正/推进时点火
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.038, 0.09, 12), darkMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0, 0.18);
  ship.add(nozzle);

  // 引擎尾焰：加色锥体（+Z 喷射），main 按推力缩放 visible/scale
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.5, 12), flameMat);
  flame.rotation.x = Math.PI / 2; // 锥尖朝 +Z（向后喷）
  flame.position.set(0, 0, 0.45);
  ship.add(flame);

  // 引擎辉光（billboard，随尾焰联动）
  const glow = makeGlowSprite(0.5, '#55bbff', 0.45);
  glow.position.set(0, 0, 0.38);
  ship.add(glow);

  ship.userData.flame = flame;
  ship.userData.glow = glow;
  return ship;
}

// 按推力量级更新尾焰：throttle 0..1（0 = 滑行，隐藏）；boost 时拉长增亮
export function updateShipFlame(ship: THREE.Object3D, throttle: number, boost: boolean): void {
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
  const gs = 0.35 + s * 0.55;
  glow.scale.set(gs, gs, 1);
}
