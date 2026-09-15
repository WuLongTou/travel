// 星尘流：围绕相机的粒子盒，按飞船速度连续流动——真实宇宙模拟的速度感来源。
// 真实尺度下星体遥远（跨层航行时画面近乎静止），太空模拟的标准解法是
// 在相机周围撒一层「星尘」，掠过速度与航向实时反映运动状态。
//
// 实现口径：
//   - 粒子存世界坐标（float64 累积），每帧按 vel·dtSim 平流后对相机位置
//     周期 wrap（mod 盒边长）——wrap 的周期性保证任意时间倍率下视觉正确：
//     一帧跨 k 个盒与跨 1 个盒渲染等价；
//   - 盒边长 L = clamp(视速×0.7, minBox, maxBox)：视速（世界单位/真实秒）
//     = |vel|×时间倍率，使粒子穿过率稳定在 ~1.4 盒/秒的舒适节奏；
//   - 每粒子一段尾迹线（朝速度反方向拉伸 L×6%），加色淡青，静止时隐藏。
import * as THREE from 'three';
import type { Vec3 } from '../types.js';

const STRETCH = 0.06; // 尾迹长度 = 盒边长比例

export class DustFlow {
  lines: THREE.LineSegments;
  private n: number;
  private pts: Float64Array; // 世界坐标累积（n*3）
  private attr: THREE.BufferAttribute;

  constructor(n = 240) {
    this.n = n;
    this.pts = new Float64Array(n * 3);
    this.attr = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.attr);
    const mat = new THREE.LineBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false; // 粒子盒每帧重算，包围球不更新会被误裁
    this.lines.visible = false;
  }

  // 每帧调用：cam=相机世界位置，vel=飞船速度（世界单位/模拟秒），
  // dtSim=本帧模拟时长，rate=时间倍率（视速=|vel|×rate），minBox/maxBox
  // 按「视距×40 ~ worldRadius×0.5」由 main 传入
  update(cam: Vec3, vel: Vec3, dtSim: number, rate: number, minBox: number, maxBox: number): void {
    const mat = this.lines.material as THREE.LineBasicMaterial;
    const visSpeed = Math.hypot(vel[0], vel[1], vel[2]) * Math.abs(rate); // 世界单位/真实秒
    if (visSpeed <= 0 || dtSim <= 0) {
      this.lines.visible = false;
      return;
    }
    const L = Math.min(Math.max(visSpeed * 0.7, minBox), maxBox);
    const dx = vel[0] * dtSim, dy = vel[1] * dtSim, dz = vel[2] * dtSim;
    // 单位速度向量（尾迹方向），速度为 0 时上分支已返回
    const inv = 1 / (Math.hypot(vel[0], vel[1], vel[2]) || 1);
    const ux = vel[0] * inv, uy = vel[1] * inv, uz = vel[2] * inv;
    const tail = L * STRETCH;
    const a = this.attr.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      // 平流 + 相对相机周期 wrap（k 盒与 1 盒渲染等价）
      let rx = this.pts[j] + dx - cam[0];
      let ry = this.pts[j + 1] + dy - cam[1];
      let rz = this.pts[j + 2] + dz - cam[2];
      rx -= L * Math.round(rx / L);
      ry -= L * Math.round(ry / L);
      rz -= L * Math.round(rz / L);
      this.pts[j] = cam[0] + rx;
      this.pts[j + 1] = cam[1] + ry;
      this.pts[j + 2] = cam[2] + rz;
      // 头在前、尾朝速度反方向
      a[i * 6] = this.pts[j];
      a[i * 6 + 1] = this.pts[j + 1];
      a[i * 6 + 2] = this.pts[j + 2];
      a[i * 6 + 3] = this.pts[j] - ux * tail;
      a[i * 6 + 4] = this.pts[j + 1] - uy * tail;
      a[i * 6 + 5] = this.pts[j + 2] - uz * tail;
    }
    this.attr.needsUpdate = true;
    // 穿盒速率归一透明度：~0.4 盒/秒起步渐显，2 盒/秒全亮
    mat.opacity = Math.min(0.85, visSpeed / L / 2.5);
    this.lines.visible = true;
  }
}
