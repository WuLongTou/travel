// 探测球：两种飞行模式（教育向）
//   cruise   巡航（默认）：WASD 推进 + 阻尼，演示倍率速度，用于尺度漫游；
//            真实宇宙无法以此速度旅行，HUD 明示教学快进。
//   ballistic 轨道飞行（陨石）：无推力阻尼，仅受当前层引力源作用，
//            以 dtSim（模拟时间）积分——把时间调快即可看到开普勒轨道；
//            WASD 提供小推力作变轨机动。切入时自动获得圆轨道速度。
// 引力源由 world.gravity 声明：{ GM(世界单位³/真实秒²), minR(碰撞半径), name }
// 无 gravity 声明的层中 ballistic 退化为惯性直线飞行。
import { clamp } from '../util/math.js';

export class Probe {
  constructor() {
    this.pos = [0, 0, 0]; // 世界坐标（当前层单位）
    this.vel = [0, 0, 0]; // 世界单位 / 真实秒
    this.yaw = 0; // 朝向（绕 Y），0 = -Z 方向
    this.pitch = 0;
    this.thrustOn = false;
    this.mode = 'cruise'; // 'cruise' | 'ballistic'
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

  // 切换到轨道飞行：以当前点绕引力中心的圆轨道速度作为初速（切向、沿视线侧）
  enterBallistic() {
    const g = this.world && this.world.gravity;
    this.mode = 'ballistic';
    if (!g) return; // 无引力层：惯性直线
    const dx = this.pos[0] - g.center[0], dy = this.pos[1] - g.center[1], dz = this.pos[2] - g.center[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    const v = Math.sqrt(g.GM / r); // 圆轨道速度
    // 切向方向 = r̂ × ŷ（保持在黄道面附近，直观可读）
    let tx = dz / r, ty = 0, tz = -dx / r;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // 若切向与视线反向（可能与 chase 相机打架），翻转使初速大致沿前进方向
    const f = this.forward();
    if (tx * f[0] + ty * f[1] + tz * f[2] < 0) { tx = -tx; ty = -ty; tz = -tz; }
    this.vel = [tx * v, ty * v, tz * v];
  }

  exitBallistic() {
    this.mode = 'cruise';
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

  // dtSim = 模拟时间秒（ballistic 用：时间倍速下轨道运动可见）；dtReal 为真实秒
  step(dtReal, keys, thrustScale = 1, dtSim = 0) {
    const w = this.world;
    const maxSp = w.maxSpeedWorldPerS;
    const acc = w.thrustAccWorldPerS2; // 加速度（世界单位/真实秒²）
    let ax = 0, ay = 0, az = 0;

    if (this.mode === 'ballistic') {
      // 轨道飞行：引力 + 小推力变轨，无阻尼；以模拟时间积分
      const g = w.gravity;
      if (g) {
        const dx = g.center[0] - this.pos[0], dy = g.center[1] - this.pos[1], dz = g.center[2] - this.pos[2];
        const r = Math.hypot(dx, dy, dz) || 1;
        const a = g.GM / (r * r); // |a| = GM/r²
        ax = dx / r * a; ay = dy / r * a; az = dz / r * a;
      }
      // WASD 变轨机动（推力较小，用于抬/降轨道）
      if (this.thrustOn) {
        const f = this.forward(), r3 = this.right(), u = this.up();
        const kf = (keys.fwd ? 1 : 0) - (keys.bwd ? 1 : 0);
        const ks = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        const ku = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
        const m = acc * 0.25 * thrustScale;
        ax += (f[0] * kf + r3[0] * ks + u[0] * ku) * m;
        ay += (f[1] * kf + r3[1] * ks + u[1] * ku) * m;
        az += (f[2] * kf + r3[2] * ks + u[2] * ku) * m;
      }
      // 子步进积分：单步 ≤ STEP_MAX 模拟秒，保证高倍速下轨道不漂移
      const STEP_MAX = 400;
      let remain = Math.min(dtSim, 2.7e6); // 单帧上限（≈1月）
      do {
        const h = Math.min(STEP_MAX, remain);
        this.vel[0] += ax * h;
        this.vel[1] += ay * h;
        this.vel[2] += az * h;
        this.pos[0] += this.vel[0] * h;
        this.pos[1] += this.vel[1] * h;
        this.pos[2] += this.vel[2] * h;
        remain -= h;
      } while (remain > 0);
      // 引力体碰撞防护：撞上核心时非弹性弹开（防穿透，教学兜底）
      if (g) {
        const dx = this.pos[0] - g.center[0], dy = this.pos[1] - g.center[1], dz = this.pos[2] - g.center[2];
        const r = Math.hypot(dx, dy, dz) || 1;
        const minR = g.minR || 0.5;
        if (r < minR) {
          const k = minR / r;
          this.pos[0] = g.center[0] + dx * k;
          this.pos[1] = g.center[1] + dy * k;
          this.pos[2] = g.center[2] + dz * k;
          const vr = (this.vel[0] * dx + this.vel[1] * dy + this.vel[2] * dz) / r;
          if (vr < 0) {
            this.vel[0] -= dx / r * vr * 1.45; // 径向速度反转 ×0.45
            this.vel[1] -= dy / r * vr * 1.45;
            this.vel[2] -= dz / r * vr * 1.45;
          }
        }
      }
      this._pushTrail(maxSp);
      return;
    }

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
    this._pushTrail(maxSp);
  }

  // 轨迹采样（按移动距离；巡航用速度比例，轨道飞行用绝对间距保证连续）
  _pushTrail(maxSp) {
    const sp = this.speedWorldPerS();
    const minGap = this.mode === 'ballistic' ? Math.max(sp * 6, 1e-3) : maxSp * 0.08;
    if (!this.trail.length || Math.hypot(this.trail[this.trail.length-1][0]-this.pos[0],
        this.trail[this.trail.length-1][1]-this.pos[1], this.trail[this.trail.length-1][2]-this.pos[2]) > minGap) {
      this.trail.push([...this.pos]);
      if (this.trail.length > 500) this.trail.shift();
    }
  }

  speedWorldPerS() { return Math.hypot(this.vel[0], this.vel[1], this.vel[2]); }
  // 换算真实 km/s（可超光速，仅供 HUD“演示倍率”展示）
  speedKmS() { return this.speedWorldPerS() * this.world.kmPerUnit; }
}
