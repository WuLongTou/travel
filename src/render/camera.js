// 游戏式相机：追踪 / 座舱 / 环绕三视角（V 键循环切换）
//   chase   追踪（第三人称默认）：飞船后上方跟拍，相机随横滚小幅倾斜，
//           加力时 FOV 拉宽营造速度感；滚轮缩放跟拍距离。
//   cockpit 座舱（第一人称）：眼位在船头、朝向与飞船一致（准星即航向）。
//   orbit   环绕观察：以飞船为目标自由环绕（鼠标增量转角、滚轮距离），
//           只看不转——不改变飞船航向。
import * as THREE from 'three';

export const VIEW_MODES = ['chase', 'cockpit', 'orbit'];
export const VIEW_NAMES = { chase: '追踪', cockpit: '座舱', orbit: '环绕' };

export class ChaseCam {
  constructor(camera, probe) {
    this.camera = camera;
    this.probe = probe;
    this.followDist = 2.2; // 世界单位（每层 scale 不同，由 world 给定）
    this.minDist = 0.2; // 滚轮缩放下限（相对系数由 main 按层折算）
    this.maxDist = 30;
    this.mode = 'chase'; // 'chase' | 'cockpit' | 'orbit'
    // 环绕视角的自由转角（只影响观察，不影响飞船）
    this.orbitYaw = 0;
    this.orbitPitch = 0.35;
    this._look = new THREE.Vector3();
    this._inited = false;
    this._baseFov = camera.fov || 60;
  }

  setDist(d) {
    this.followDist = d;
    this.minDist = d * 0.15;
    this.maxDist = d * 8;
  }

  cycleView() {
    const i = VIEW_MODES.indexOf(this.mode);
    this.mode = VIEW_MODES[(i + 1) % VIEW_MODES.length];
    // 切到环绕时从当前追踪方位起步，避免跳变
    if (this.mode === 'orbit') { this.orbitYaw = 0; this.orbitPitch = 0.35; }
    this._inited = false;
    return this.mode;
  }

  // 滚轮：追踪/环绕距离缩放（游戏第三人称惯例）；座舱视角忽略
  zoomBy(factor) {
    if (this.mode === 'cockpit') return;
    this.followDist = THREE.MathUtils.clamp(this.followDist * factor, this.minDist, this.maxDist);
  }

  // 环绕视角：鼠标增量只转观察角
  orbitBy(dxPx, dyPx) {
    this.orbitYaw -= dxPx * 0.005;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dyPx * 0.005, -1.4, 1.4);
  }

  update(dtReal, boost = false) {
    const p = this.probe;
    const px = p.pos[0], py = p.pos[1], pz = p.pos[2];
    const k = Math.min(1, dtReal * 10); // 跟随平滑系数
    if (this.mode === 'cockpit') {
      // 眼位 = 船头，朝向 = 飞船前向（含横滚）
      const f = p.forward(), u = p.up();
      const eye = [px + f[0] * 0.02, py + f[1] * 0.02, pz + f[2] * 0.02];
      this.camera.position.set(eye[0], eye[1], eye[2]);
      this._look.set(px + f[0], py + f[1], pz + f[2]);
      this.camera.up.set(u[0], u[1], u[2]);
      this.camera.lookAt(this._look);
      this._kickFov(dtReal, boost);
      this._inited = true;
      return;
    }
    if (this.mode === 'orbit') {
      // 以飞船为球心、orbitYaw/Pitch 为球坐标观察
      const cy = Math.cos(this.orbitYaw), sy = Math.sin(this.orbitYaw);
      const cp = Math.cos(this.orbitPitch), sp = Math.sin(this.orbitPitch);
      const eye = [px + sy * cp * this.followDist, py + sp * this.followDist, pz + cy * cp * this.followDist];
      this._smoothTo(eye, k);
      this._look.set(px, py, pz);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this._look);
      this._kickFov(dtReal, false);
      return;
    }
    // chase：眼 = 飞船 - 前向*followDist + 上*followDist*0.35
    const f = p.forward(), u = p.up();
    const eye = [
      px - f[0] * this.followDist + u[0] * this.followDist * 0.35,
      py - f[1] * this.followDist + u[1] * this.followDist * 0.35,
      pz - f[2] * this.followDist + u[2] * this.followDist * 0.35,
    ];
    this._smoothTo(eye, k);
    this._look.set(px, py, pz);
    // 相机上向量 = 世界上向量与飞船上向量取半：有压杆倾斜感又不晕
    // （roll=90° 时地平线倾斜约 45°，俯仰极限附近仍稳定）
    const hx = u[0], hy = u[1] + 1, hz = u[2];
    const hl = Math.hypot(hx, hy, hz) || 1;
    this.camera.up.set(hx / hl, hy / hl, hz / hl);
    this.camera.lookAt(this._look);
    this._kickFov(dtReal, boost);
  }

  _smoothTo(eye, k) {
    if (!this._inited) {
      this.camera.position.set(eye[0], eye[1], eye[2]);
      this._inited = true;
    } else {
      this.camera.position.x += (eye[0] - this.camera.position.x) * k;
      this.camera.position.y += (eye[1] - this.camera.position.y) * k;
      this.camera.position.z += (eye[2] - this.camera.position.z) * k;
    }
  }

  // 加力 FOV kick：60 → 72 平滑过渡
  _kickFov(dtReal, boost) {
    const target = boost ? this._baseFov + 12 : this._baseFov;
    const cur = this.camera.fov;
    const next = cur + (target - cur) * Math.min(1, dtReal * 5);
    if (Math.abs(next - cur) > 0.01) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  // 直接定位（层切换/下潜后的镜头重置）
  snapTo(eye, look) {
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this._look.set(look[0], look[1], look[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._look);
    this.camera.fov = this._baseFov;
    this.camera.updateProjectionMatrix();
    this._inited = true;
  }
}
