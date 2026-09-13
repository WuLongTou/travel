// 游戏式相机：追踪 / 座舱 / 环绕三视角（V 键循环切换）
//   chase   追踪（第三人称默认）：真追尾——相机锚在机尾后上方并随飞船
//           航向转动（orbitYaw/Pitch 是相对机尾的偏移角），飞船转向时
//           相机跟着绕到新机尾；加力时 FOV 拉宽营造速度感；滚轮缩放距离。
//   cockpit 座舱（第一人称）：眼位在船头、朝向与飞船一致（准星即航向），
//           鼠标 = 舱内转头环顾。
//   orbit   环绕观察：以飞船为球心、世界系固定方位自由环绕（鼠标增量转角、
//           滚轮距离），不随飞船航向转——只看不转，适合纯观察。
//   三视角的鼠标方向统一遵循游戏常识：鼠标右移 = 视线向右，鼠标下移 = 视线向下。
import * as THREE from 'three';

export const VIEW_MODES = ['chase', 'cockpit', 'orbit'];
export const VIEW_NAMES = { chase: '追踪', cockpit: '座舱', orbit: '环绕' };

export class ChaseCam {
  constructor(camera, probe) {
    this.camera = camera;
    this.probe = probe;
    this.followDist = 2.2; // 世界单位（每层 scale 不同，由 world 给定）
    this.minDist = 1e-4; // 放开缩放下限（微米级特写，支持无限缩放）
    this.maxDist = 5e6;  // 放开缩放上限（宇宙尺度宏观视野）
    this.mode = 'chase'; // 'chase' | 'cockpit' | 'orbit'
    // 环绕视角的自由转角（只影响观察，不影响飞船）
    this.orbitYaw = 0;
    this.orbitPitch = 0.35;
    // 视角中心相对于飞船的三维空间自由位移偏置（支持无限位移探索）
    this.panOffset = new THREE.Vector3(0, 0, 0);
    this._look = new THREE.Vector3();
    this._inited = false;
    this._baseFov = camera.fov || 60;
    this.userInteracted = false;
    this._lastInteractTime = 0;
  }

  setDist(d) {
    this.followDist = d;
    this.minDist = 1e-4;
    this.maxDist = 5e6;
  }

  // 重置视角位移与朝向回飞船正后方
  resetPan() {
    this.panOffset.set(0, 0, 0);
    this.orbitYaw = 0;
    this.orbitPitch = 0.25;
  }

  // 环视偏移指数回正（时间常数 ≈0.45s）：追尾视角按 W 转向时由 main 调用，
  // 偏移作为转向指令消耗掉——转向到位后相机稳定停在新机尾正后方
  recenter(dtReal) {
    const k = 1 - Math.exp(-dtReal * 2.2);
    this.orbitYaw -= this.orbitYaw * k;
    this.orbitPitch -= this.orbitPitch * k;
  }

  cycleView() {
    const i = VIEW_MODES.indexOf(this.mode);
    this.mode = VIEW_MODES[(i + 1) % VIEW_MODES.length];
    if (this.mode === 'cockpit') {
      this.orbitYaw = 0;
      this.orbitPitch = 0;
    } else {
      this.orbitYaw = 0;
      this.orbitPitch = 0.25;
    }
    this._inited = false;
    return this.mode;
  }

  // 滚轮：追踪/环绕距离缩放（游戏第三人称惯例）；座舱视角忽略
  zoomBy(factor) {
    if (this.mode === 'cockpit') return;
    this.followDist = THREE.MathUtils.clamp(this.followDist * factor, this.minDist, this.maxDist);
    this.userInteracted = true;
    this._lastInteractTime = performance.now();
  }

  // 鼠标移动控制观察视角（偏航角与俯仰角，全向自由环顾，不干扰飞船航行）
  orbitBy(dxPx, dyPx) {
    this.orbitYaw -= dxPx * 0.005;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dyPx * 0.005, -1.56, 1.56);
    this.userInteracted = true;
    this._lastInteractTime = performance.now();
  }

  // 视角在相机屏幕空间中的自由三维平移（Pan/无限位移）
  panBy(dxPx, dyPx) {
    if (this.mode === 'cockpit') return;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    const factor = Math.max(this.followDist, 0.01) * 0.0016;
    this.panOffset.addScaledVector(right, -dxPx * factor);
    this.panOffset.addScaledVector(up, dyPx * factor);
    this.userInteracted = true;
    this._lastInteractTime = performance.now();
  }

  update(dtReal, boost = false) {
    const p = this.probe;
    const px = p.pos[0], py = p.pos[1], pz = p.pos[2];
    const k = Math.min(1, dtReal * 12); // 平滑跟随系数

    if (this.mode === 'cockpit') {
      // 座舱视角：眼位在船头，支持驾驶员在舱内 360° 自由转头环顾窗外星空。
      // 符号约定与 chase/orbit 一致：orbitYaw 正 = 向右看、orbitPitch 正 =
      // 向下看（鼠标右移时 orbitBy 令 yaw 减小，故此处 right 分量取负号），
      // 机头航向本身不被扰动
      const f = p.forward(), r = p.right(), u = p.up();
      const eye = [px + f[0] * 0.02, py + f[1] * 0.02, pz + f[2] * 0.02];
      this.camera.position.set(eye[0], eye[1], eye[2]);

      const cy = Math.cos(this.orbitYaw), sy = Math.sin(this.orbitYaw);
      const cp = Math.cos(this.orbitPitch), sp = Math.sin(this.orbitPitch);
      const lx = f[0] * cy * cp - r[0] * sy * cp - u[0] * sp;
      const ly = f[1] * cy * cp - r[1] * sy * cp - u[1] * sp;
      const lz = f[2] * cy * cp - r[2] * sy * cp - u[2] * sp;

      this._look.set(eye[0] + lx, eye[1] + ly, eye[2] + lz);
      this.camera.up.set(u[0], u[1], u[2]);
      this.camera.lookAt(this._look);
      this._kickFov(dtReal, boost);
      this._inited = true;
      return;
    }

    // 观察中心基准（飞船当前坐标 + 自由平移偏置）
    const cx = px + this.panOffset.x;
    const cy = py + this.panOffset.y;
    const cz = pz + this.panOffset.z;

    // 球面偏移角：
    //   chase 真追尾——基准 = 机尾反方向（机尾方向球坐标恰为 (p.yaw, -p.pitch)），
    //   叠加鼠标偏移后相机始终锚在机尾后上方，飞船转向时相机随之绕到新机尾；
    //   orbit 世界系环绕——基准 = 世界 -Z 方向，方位固定，适合纯观察
    let effYaw, effPitch;
    if (this.mode === 'chase') {
      effYaw = p.yaw + this.orbitYaw;
      effPitch = THREE.MathUtils.clamp(-p.pitch + this.orbitPitch, -1.56, 1.56);
    } else {
      effYaw = this.orbitYaw;
      effPitch = THREE.MathUtils.clamp(this.orbitPitch, -1.56, 1.56);
    }
    const cyaw = Math.cos(effYaw), syaw = Math.sin(effYaw);
    const cpitch = Math.cos(effPitch), spitch = Math.sin(effPitch);
    const eye = [
      cx + syaw * cpitch * this.followDist,
      cy + spitch * this.followDist,
      cz + cyaw * cpitch * this.followDist
    ];
    this._smoothTo(eye, k);
    this._look.set(cx, cy, cz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._look);
    this._kickFov(dtReal, boost && this.mode === 'chase');
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
