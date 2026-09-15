// 上帝视角自由相机：完全脱离飞船的观察者模式
//   - WASD 前后左右平移（相机局部系），Space/C 或 Q/E 垂直升降
//   - 鼠标移动转向（偏航/俯仰），滚轮调节飞行速度档位
//   - Shift 加速移动
//   - 进入时从当前相机位姿无缝接管，退出时由调用方恢复追尾
import * as THREE from 'three';

export interface FreeCamKeys { fwd: boolean; bwd: boolean; left: boolean; right: boolean; up: boolean; down: boolean; boost: boolean }

export class FreeCam {
  camera: THREE.PerspectiveCamera;
  active = false;
  // 相机局部位姿（世界坐标）
  pos = new THREE.Vector3();
  yaw = 0;   // 绕世界 Y
  pitch = 0; // 俯仰
  // 移动速度（世界单位/秒），滚轮指数调节
  speed = 1.0;
  private _speedRef = 1.0; // 进入时按场景尺度校准的参考速度

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  // 进入上帝视角：接管当前相机位姿；refDist 用于按当前场景尺度校准移动速度
  enter(refDist = 1): void {
    this.active = true;
    this.pos.copy(this.camera.position);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    // 速度基准：约为当前观察尺度的 0.5 倍/秒，滚轮在此基础上 ±10 档
    this._speedRef = Math.max(refDist * 0.5, 1e-4);
    this.speed = this._speedRef;
  }

  exit(): void {
    this.active = false;
  }

  // 鼠标转向（像素增量）
  lookBy(dxPx: number, dyPx: number): void {
    this.yaw -= dxPx * 0.003;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dyPx * 0.003, -1.56, 1.56);
  }

  // 滚轮调速（指数档位）
  adjustSpeed(factor: number): void {
    this.speed = THREE.MathUtils.clamp(this.speed * factor, this._speedRef * 0.02, this._speedRef * 100);
  }

  // 每帧更新：keys = {fwd,bwd,left,right,up,down,boost}
  update(dtReal: number, keys: FreeCamKeys): void {
    if (!this.active) return;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwd = new THREE.Vector3(-sy * cp, sp, -cy * cp);
    const right = new THREE.Vector3(cy, 0, -sy);
    const up = new THREE.Vector3(0, 1, 0);

    const move = new THREE.Vector3();
    if (keys.fwd) move.add(fwd);
    if (keys.bwd) move.sub(fwd);
    if (keys.right) move.add(right);
    if (keys.left) move.sub(right);
    if (keys.up) move.add(up);
    if (keys.down) move.sub(up);
    if (move.lengthSq() > 0) {
      move.normalize();
      const v = this.speed * (keys.boost ? 4 : 1);
      this.pos.addScaledVector(move, v * dtReal);
    }

    this.camera.position.copy(this.pos);
    const look = this.pos.clone().add(fwd);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(look);
  }
}
