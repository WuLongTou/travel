// 探测器轨迹缎带：渲染 probe.trail 采样点为渐隐光线（航行感知）
// 稳定性三件套：
//   1. Chaikin 切角平滑——采样折线的拐角圆滑化（预分配缓冲，逐帧零分配）
//   2. 末端接飞船当前实际位置——线永远贴住探测器，无滞后缺口
//   3. 关闭深度测试作为覆盖层绘制——轨迹不再被行星遮挡忽隐忽现
// 透明度沿轨迹渐变：越旧越淡；层切换时 reset。
import * as THREE from 'three';
import type { Vec3 } from '../types.js';


export class TrailRibbon {
  readonly maxPoints: number; // 采样点容量
  private bufA: Float32Array;
  private bufB: Float32Array;
  color: THREE.Color;
  posAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
  line: THREE.Line;
  count = 0;

  constructor(scene: THREE.Scene, color = '#7fe8ff', maxPoints = 240) {
    this.maxPoints = maxPoints;
    // 平滑后容量：Chaikin 一次把 n 点变 2(n-1)+2，预留 ×2
    this.bufA = new Float32Array((maxPoints + 1) * 3);
    this.bufB = new Float32Array((maxPoints + 1) * 6);
    this.color = new THREE.Color(color);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(maxPoints * 2 * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(maxPoints * 2 * 4), 4);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      depthTest: false, // 覆盖层：轨迹不被行星遮挡切割
    });
    this.line = new THREE.Line(geo, mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 5; // 场景内容之后绘制
    scene.add(this.line);
  }

  reset(): void {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }

  // 每帧从 probe.trail 同步（probe 内部按移动距离采样，上限 500 点）
  update(probe: { trail: Vec3[]; pos: Vec3 }): void {
    const trail = probe.trail;
    const n = Math.min(trail.length, this.maxPoints);
    if (n < 2) { this.line.geometry.setDrawRange(0, 0); return; }
    // 采样点 → bufA，末端补当前实际位置（线贴住飞船）
    const start = trail.length - n;
    for (let i = 0; i < n; i++) {
      const p = trail[start + i];
      this.bufA[i * 3] = p[0]; this.bufA[i * 3 + 1] = p[1]; this.bufA[i * 3 + 2] = p[2];
    }
    this.bufA[n * 3] = probe.pos[0];
    this.bufA[n * 3 + 1] = probe.pos[1];
    this.bufA[n * 3 + 2] = probe.pos[2];
    const an = n + 1;
    // Chaikin 切角平滑（一次）：折线拐角 → 圆滑，消除采样切角抖动
    // B[2i]   = 0.75A[i] + 0.25A[i+1]
    // B[2i+1] = 0.25A[i] + 0.75A[i+1]
    let bn = 0;
    for (let i = 0; i < an - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const a = this.bufA[i * 3 + k], b = this.bufA[(i + 1) * 3 + k];
        this.bufB[bn * 3 + k] = a * 0.75 + b * 0.25;
        this.bufB[(bn + 1) * 3 + k] = a * 0.25 + b * 0.75;
      }
      bn += 2;
    }
    // 写入顶点缓冲（旧→新 alpha 0.02 → 0.55）
    const total = Math.min(bn, this.maxPoints * 2);
    const skip = bn - total; // 点超容量时丢最旧的
    for (let i = 0; i < total; i++) {
      this.posAttr.setXYZ(i, this.bufB[(skip + i) * 3], this.bufB[(skip + i) * 3 + 1], this.bufB[(skip + i) * 3 + 2]);
      const t = i / (total - 1);
      this.colAttr.setXYZW(i, this.color.r, this.color.g, this.color.b, 0.02 + t * 0.53);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, total);
  }
}
