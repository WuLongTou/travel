// 相机控制：跟拍（第三人称，跟随探测球）+ 自由观察轨道模式 + 层切换转场
import * as THREE from 'three';

export class ChaseCam {
  constructor(camera, probe) {
    this.camera = camera;
    this.probe = probe;
    this.followDist = 2.2; // 世界单位（每层 scale 不同，由 world 给定）
    this.mode = 'chase'; // 'chase' | 'orbit' | 'fixed'
    this._target = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._smoothPos = new THREE.Vector3(); // 平滑相机位置
    this._inited = false;
  }

  setDist(d) { this.followDist = d; }

  // 更新：mode chase = 跟拍（相机在探测球后上方，朝向与探测球一致）
  update(dtReal) {
    const p = this.probe;
    const px = p.pos[0], py = p.pos[1], pz = p.pos[2];
    if (this.mode === 'chase') {
      // 眼 = 探测球 - 前向*followDist（第三人称身后）
      const f = p.forward();
      const eye = [px - f[0]*this.followDist, py - f[1]*this.followDist + this.followDist*0.35, pz - f[2]*this.followDist];
      if (!this._inited) {
        this.camera.position.set(eye[0], eye[1], eye[2]);
        this._inited = true;
      } else {
        // 平滑跟随（防抖动）
        const k = Math.min(1, dtReal * 10);
        this.camera.position.x += (eye[0]-this.camera.position.x)*k;
        this.camera.position.y += (eye[1]-this.camera.position.y)*k;
        this.camera.position.z += (eye[2]-this.camera.position.z)*k;
      }
      // 看向探测球
      this._look.set(px, py, pz);
      this.camera.lookAt(this._look);
      return;
    }
    if (this.mode === 'orbit') {
      // 绕一个目标旋转（给选择对象用，暂未启用）
      return;
    }
  }

  // 直接定位（层切换/下潜后的镜头重置）
  snapTo(eye, look) {
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this._look.set(look[0], look[1], look[2]);
    this.camera.lookAt(this._look);
    this._inited = true;
  }
}
