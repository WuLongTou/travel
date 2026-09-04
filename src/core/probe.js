// 探测球：自由巡航观察者（教育向——以演示倍率飞行，用于尺度漫游）
// 说明：真实宇宙中人类无法以可交互的速度穿越星系，因此本模拟给探测球
// 一个「演示倍率」的巡航速度（每层 = 能在 ~1 分钟内横跨该层尺度），
// 并在 HUD 与文档里明示这是教学快进，不是真实可达速度。
import { clamp } from '../util/math.js';

export class Probe {
  constructor() {
    this.pos = [0, 0, 0]; // 世界坐标（当前层单位）
    this.vel = [0, 0, 0]; // 世界单位 / 真实秒
    this.yaw = 0; // 朝向（绕 Y），0 = -Z 方向
    this.pitch = 0;
    this.thrustOn = false;
    this.world = null; // 当前 world 描述（见 schema）
    this.trail = [];
    this._spawn = [0, 0, 0];
  }

  bindWorld(world, spawn) {
    this.world = world;
    this._spawn = spawn ? spawn.slice() : [0, 0, 0];
    this.pos = this._spawn.slice();
    this.vel = [0, 0, 0];
    this.trail.length = 0;
    // 朝向由 Navigator.enter 的 lookTowards 设定（看向该层兴趣中心）
  }

  // 转动朝向使其看向目标点（层进入时用，保证构图稳定不依赖上一层朝向）
  lookTowards(target) {
    const dx = target[0] - this.pos[0], dy = target[1] - this.pos[1], dz = target[2] - this.pos[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    this.pitch = Math.asin(dy / l);
    this.yaw = Math.atan2(-dx, -dz);
  }

  // 前向/右/上（yaw/pitch 球坐标；与引擎 chase 相机约定一致：初始朝 -Z）
  forward() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [-sy * cp, sp, -cy * cp];
  }
  right() { return [Math.cos(this.yaw), 0, -Math.sin(this.yaw)]; }
  up() {
    const f = this.forward(), r = this.right();
    return [r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0]];
  }

  // 相对航向推动（世界轴）：dYaw/dPitch（弧度）
  steer(dYaw, dPitch) {
    this.yaw -= dYaw;
    this.pitch = clamp(this.pitch + dPitch, -Math.PI/2 + 0.02, Math.PI/2 - 0.02);
  }

  step(dtReal, keys, thrustScale = 1) {
    const w = this.world;
    const maxSp = w.maxSpeedWorldPerS;
    const acc = w.thrustAccWorldPerS2; // 加速度（世界单位/真实秒²）
    let ax = 0, ay = 0, az = 0;
    if (this.thrustOn) {
      const f = this.forward(), r = this.right(), u = this.up();
      const kf = (keys.fwd?1:0) - (keys.bwd?1:0);
      const ks = (keys.right?1:0) - (keys.left?1:0);
      const ku = (keys.up?1:0) - (keys.down?1:0);
      ax = f[0]*kf + r[0]*ks + u[0]*ku;
      ay = f[1]*kf + r[1]*ks + u[1]*ku;
      az = f[2]*kf + r[2]*ks + u[2]*ku;
      const al = Math.hypot(ax, ay, az) || 1;
      ax = ax/al*acc*thrustScale; ay = ay/al*acc*thrustScale; az = az/al*acc*thrustScale;
    }
    const damp = Math.max(0, 1 - (w.dragPerSec||0.15) * dtReal);
    this.vel[0] = this.vel[0]*damp + ax*dtReal;
    this.vel[1] = this.vel[1]*damp + ay*dtReal;
    this.vel[2] = this.vel[2]*damp + az*dtReal;
    const sp = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    if (sp > maxSp) { const k = maxSp/sp; this.vel[0]*=k; this.vel[1]*=k; this.vel[2]*=k; }
    this.pos[0] += this.vel[0]*dtReal;
    this.pos[1] += this.vel[1]*dtReal;
    this.pos[2] += this.vel[2]*dtReal;
    // 轨迹（演示渲染用）
    if (!this.trail.length || Math.hypot(this.trail[this.trail.length-1][0]-this.pos[0],
        this.trail[this.trail.length-1][1]-this.pos[1], this.trail[this.trail.length-1][2]-this.pos[2]) > maxSp*0.08) {
      this.trail.push([...this.pos]);
      if (this.trail.length > 500) this.trail.shift();
    }
  }

  speedWorldPerS() { return Math.hypot(this.vel[0], this.vel[1], this.vel[2]); }
  // 换算真实 km/s（可超光速，仅供 HUD“演示倍率”展示）
  speedKmS() { return this.speedWorldPerS() * this.world.kmPerUnit; }
}
