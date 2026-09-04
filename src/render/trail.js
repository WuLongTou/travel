// 探测球轨迹缎带：渲染 probe.trail 采样点为渐隐光线（航行感知）
// 透明度沿轨迹渐变：越旧越淡；层切换时 reset。
import * as THREE from 'three';

export class TrailRibbon {
  constructor(scene, color = '#7fe8ff', maxPoints = 240) {
    this.maxPoints = maxPoints;
    this.color = new THREE.Color(color);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(maxPoints * 4), 4);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    // three 支持 4 分量 color（顶点 alpha），配合 transparent 生效
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
    });
    this.line = new THREE.Line(geo, mat);
    this.line.frustumCulled = false;
    this.count = 0;
    scene.add(this.line);
  }

  reset() {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }

  // 每帧从 probe.trail 同步（probe 内部按移动距离采样，上限 500 点）
  update(probe) {
    const trail = probe.trail;
    const n = Math.min(trail.length, this.maxPoints);
    if (n < 2) { this.line.geometry.setDrawRange(0, 0); return; }
    // trail 尾部 = 当前位置：取最近 n 点
    const start = trail.length - n;
    for (let i = 0; i < n; i++) {
      const p = trail[start + i];
      this.posAttr.setXYZ(i, p[0], p[1], p[2]);
      // 旧→新 = 0 → 1；alpha 从 0.02 渐到 0.55
      const t = i / (n - 1);
      this.colAttr.setXYZW(i, this.color.r, this.color.g, this.color.b, 0.02 + t * 0.53);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, n);
  }
}
