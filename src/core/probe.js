// 飞行器动力学模型：严格遵循真实宇宙万有引力与开普勒轨道动力学
// 真实牛顿万有引力定律：a = GM/r²
// 推进动力学：当有输入时产生推力加速度；无输入时纯引力滑行与开普勒轨道运动
// 真实碰撞判定：接触天体表面（光球层或地表）即触发碰撞损毁并在安全轨道重置部署
import { clamp } from '../util/math.js';

export class Probe {
  constructor() {
    this.pos = [0, 0, 0]; // 世界坐标（当前宇宙尺度单位）
    this.vel = [0, 0, 0]; // 世界单位 / 真实秒
    this.yaw = 0; // 朝向（绕 Y），0 = -Z 方向
    this.pitch = 0;
    this.roll = 0; // 横滚（绕前向轴，Q/E 控制）
    this.thrustOn = false;
    this.world = null;
    this.trail = [];
    this._spawn = [0, 0, 0];
    this.dominantWell = null; // 当前最近的主导引力天体
    this.crashEvent = null;   // 最近碰撞损毁事件：{ name, time }
    this.lastCrashTime = 0;
  }

  bindWorld(world, spawn) {
    this.world = world;
    this._spawn = spawn ? spawn.slice() : [0, 0, 0];
    this.pos = this._spawn.slice();
    this.vel = [0, 0, 0];
    this.roll = 0;
    this.trail.length = 0;
    this.dominantWell = null;
    this.crashEvent = null;

    // 出生时自动注入稳定的切向初速度（当地第一宇宙速度）+ 母体公转速度，
    // 防止静止垂直坠入引力中心；在地球边出生即真实携带地球 29.8 km/s 公转
    const wells = this._wells();
    if (wells.length) {
      let best = null, bestR = Infinity;
      for (const w of wells) {
        const c = w.ref ? w.ref.pos : w.center;
        const r = Math.hypot(this.pos[0] - c[0], this.pos[1] - c[1], this.pos[2] - c[2]) || 1;
        if (r < bestR) { bestR = r; best = { c, GM: w.GM, ref: w.ref }; }
      }
      if (best && best.GM > 0) {
        // 圆轨道速度 v = sqrt(GM / r)；真实口径下深层井的圆速度可能超出
        // 飞船性能上限（星系团近旁 400+ km/s > 300），clamp 后成为椭圆
        // 轨道近/远心点——物理合法且初始速度不失控
        const vmax = (this.world.maxSpeedWorldPerS || Infinity) * 0.9;
        const v = Math.min(Math.sqrt(best.GM / bestR), vmax);
        const dx = this.pos[0] - best.c[0], dy = this.pos[1] - best.c[1], dz = this.pos[2] - best.c[2];
        let tx = dz, ty = 0, tz = -dx;
        const tl = Math.hypot(tx, ty, tz) || 1;
        const host = best.ref && best.ref.vel ? best.ref.vel : [0, 0, 0];
        this.vel = [tx / tl * v + host[0], ty / tl * v + host[1], tz / tl * v + host[2]];
        const sp = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
        if (sp > 1e-4) {
          this.yaw = Math.atan2(-this.vel[0], -this.vel[2]);
          this.pitch = Math.asin(clamp(this.vel[1] / sp, -1, 1));
        }
      }
    }
  }

  // 当前生效的天体引力源列表
  _wells() {
    const w = this.world;
    if (!w) return [];
    if (w.gravityWells) return w.gravityWells;
    if (w.gravity) return [{ center: w.gravity.center, GM: w.gravity.GM, minR: w.gravity.minR, name: w.gravity.name }];
    return [];
  }

  // 碰撞损毁后，在引力天体外侧安全稳定圆轨道重新部署
  respawn(targetWell = null) {
    const well = targetWell || this.dominantWell || (this._wells()[0]);
    if (!well) {
      this.pos = this._spawn.slice();
      this.vel = [0, 0, 0];
      return;
    }
    const c = well.ref ? well.ref.pos : well.center;
    const minR = well.minR || 0.45;
    // 部署半径取两者较大：3 倍天体半径的安全轨道 / 引力可被推力对抗的
    // 最低轨道（g ≤ 0.5×推力）——真实 GM 下深井内引力远超推力（太阳
    // 3 倍半径处为推力 50 倍），部署在那里推力无法改出轨道，必然复坠
    const safeR = Math.max(
      minR * 3.0,
      this.world?.thrustAccWorldPerS2 > 0 ? Math.sqrt(well.GM / (this.world.thrustAccWorldPerS2 * 0.5)) : 0,
    );
    const dx = this.pos[0] - c[0], dy = this.pos[1] - c[1], dz = this.pos[2] - c[2];
    let dl = Math.hypot(dx, dy, dz) || 1;
    let nx = dx / dl, ny = dy / dl, nz = dz / dl;
    if (dl < 1e-4) { nx = 1; ny = 0; nz = 0; }
    this.pos = [c[0] + nx * safeR, c[1] + ny * safeR, c[2] + nz * safeR];

    // 赋予稳定的开普勒圆轨道切向速度 v = sqrt(GM / r)，并叠加母体公转速度
    const v = Math.sqrt(well.GM / safeR);
    let tx = nz, ty = 0, tz = -nx;
    let tl = Math.hypot(tx, ty, tz) || 1;
    const host = well.ref && well.ref.vel ? well.ref.vel : [0, 0, 0];
    this.vel = [tx / tl * v + host[0], ty / tl * v + host[1], tz / tl * v + host[2]];
    const sp = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    if (sp > 1e-4) {
      this.yaw = Math.atan2(-this.vel[0], -this.vel[2]);
      this.pitch = Math.asin(clamp(this.vel[1] / sp, -1, 1));
    }
    this.trail.length = 0;
  }

  // 朝向目标点
  lookTowards(target) {
    const dx = target[0] - this.pos[0], dy = target[1] - this.pos[1], dz = target[2] - this.pos[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    this.pitch = Math.asin(clamp(dy / l, -1, 1));
    this.yaw = Math.atan2(-dx, -dz);
    this.roll = 0;
  }

  // 飞船前向向量（机头方向，初始朝向 -Z）
  forward() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [-sy * cp, sp, -cy * cp];
  }

  // 飞船右向向量（含机身横滚）
  right() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const rx = cy, ry = 0, rz = -sy;
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const c = Math.cos(this.roll), s = Math.sin(this.roll);
    return [rx * c + ux * s, ry * c + uy * s, rz * c + uz * s];
  }

  // 飞船顶向上向量
  up() {
    const f = this.forward(), r = this.right();
    return [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  }

  // 姿态微调
  steer(dYaw, dPitch, dRoll = 0) {
    this.yaw -= dYaw;
    this.pitch = clamp(this.pitch + dPitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    this.roll += dRoll;
    if (this.roll > Math.PI) this.roll -= Math.PI * 2;
    else if (this.roll < -Math.PI) this.roll += Math.PI * 2;
  }

  // 反推减速刹车
  brake(dtReal) {
    const sp = this.speedWorldPerS();
    if (sp < 1e-4) { this.vel = [0, 0, 0]; return; }
    const brakeAcc = (this.world?.thrustAccWorldPerS2 || 1.5) * 2.0;
    const dec = brakeAcc * dtReal;
    const newSp = Math.max(0, sp - dec);
    const factor = newSp / sp;
    this.vel[0] *= factor;
    this.vel[1] *= factor;
    this.vel[2] *= factor;
  }

  // 动力学主循环：严格遵循牛顿引力场积分 + 推力加速度
  step(dtReal, keys, thrustScale = 1, dtPhys = 0) {
    const w = this.world;
    if (!w) return;
    const acc = w.thrustAccWorldPerS2 || 1.2;
    const wells = this._wells();

    // 1. 用户按键操控产生的引擎推力加速度
    let tx = 0, ty = 0, tz = 0;
    if (this.thrustOn) {
      const f = this.forward(), r = this.right(), u = this.up();
      const kf = (keys.fwd ? 1 : 0) - (keys.bwd ? 1 : 0);
      const ks = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const ku = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      const m = acc * thrustScale;
      tx = (f[0] * kf + r[0] * ks + u[0] * ku) * m;
      ty = (f[1] * kf + r[1] * ks + u[1] * ku) * m;
      tz = (f[2] * kf + r[2] * ks + u[2] * ku) * m;
    }

    // 2. 真实时间尺度自适应子步积分：步长随最强井的开普勒时标缩放
    //（约 1/20 轨道周期，近日点/近行星自动细化），保证真实 GM 口径下
    // 从实时到千年/秒 的全部时间倍率都有稳定轨道积分；子步预算兜底
    const SUB_BUDGET = 900;
    let remain = Math.max(0, dtPhys > 0 ? dtPhys : dtReal);
    let crashedWell = null;
    let steps = 0;

    do {
      // 最强井开普勒时标 τ = √(r³/GM)（局部轨道周期特征时间）
      let tau = Infinity;
      for (const well of wells) {
        if (well.GM <= 0) continue;
        const c = well.ref ? well.ref.pos : well.center;
        const dx = c[0] - this.pos[0], dy = c[1] - this.pos[1], dz = c[2] - this.pos[2];
        const r = Math.hypot(dx, dy, dz) || 1e-9;
        tau = Math.min(tau, Math.sqrt(r * r * r / well.GM));
      }
      // 步长 = 1/20 局部轨道时标（20 步/圈，半隐式欧拉精度足够）；0.5s 下限
      // 防极深井步长过小耗尽预算。无井（tau=∞）时整帧一步。不设绝对值上限：
      // 星系/宇宙网层轨道时标巨大（~1e16 s），硬 cap 会让高倍率下时间打折
      const h = Math.min(remain, Math.max(tau * 0.05, 0.5));

      // 万有引力合力加速度计算：a = sum(GM / r^2 * r_hat)
      let gx = 0, gy = 0, gz = 0;
      for (const well of wells) {
        const c = well.ref ? well.ref.pos : well.center;
        const dx = c[0] - this.pos[0], dy = c[1] - this.pos[1], dz = c[2] - this.pos[2];
        const r = Math.hypot(dx, dy, dz) || 1e-9;
        const a = well.GM / (r * r);
        gx += (dx / r) * a;
        gy += (dy / r) * a;
        gz += (dz / r) * a;

        // 真实表面物理碰撞判定：接触到光球层或星体地表
        const minR = well.minR || 0.4;
        if (r <= minR) {
          crashedWell = well;
        }
      }

      // 速度与位置更新（半隐式欧拉：辛积分器，长期能量稳定）
      this.vel[0] += (gx + tx) * h;
      this.vel[1] += (gy + ty) * h;
      this.vel[2] += (gz + tz) * h;
      this.pos[0] += this.vel[0] * h;
      this.pos[1] += this.vel[1] * h;
      this.pos[2] += this.vel[2] * h;

      if (crashedWell) break;
      remain -= h;
      steps++;
    } while (remain > 0 && steps < SUB_BUDGET);

    // 3. 真实碰撞事件响应：若撞毁则记录警报并在安全轨道重置部署
    if (crashedWell) {
      const now = performance.now() / 1000;
      this.crashEvent = { name: crashedWell.name, time: now };
      this.lastCrashTime = now;
      this.respawn(crashedWell);
    }

    // 4. 计算当前主导引力井及比机械能（用于 HUD 轨道显示）
    this.dominantWell = null;
    let bestR = Infinity, best = null;
    for (const well of wells) {
      const c = well.ref ? well.ref.pos : well.center;
      const r = Math.hypot(this.pos[0] - c[0], this.pos[1] - c[1], this.pos[2] - c[2]) || 1;
      if (r < bestR) { bestR = r; best = { well, r, c }; }
    }
    if (best) {
      this.dominantWell = best.well;
    }

    this._pushTrail(w.maxSpeedWorldPerS || 5);
  }

  // 尾迹采样
  _pushTrail(maxSp) {
    const p = this.pos;
    const last = this.trail[this.trail.length - 1];
    const dMin = Math.max(maxSp * 0.02, 1e-8); // 真实尺度：随层速度缩放采样间距
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) >= dMin) {
      this.trail.push([p[0], p[1], p[2]]);
      if (this.trail.length > 500) this.trail.shift();
    }
  }

  speedWorldPerS() {
    return Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
  }

  speedKmS() {
    return this.speedWorldPerS() * (this.world ? this.world.kmPerUnit : 1);
  }
}
