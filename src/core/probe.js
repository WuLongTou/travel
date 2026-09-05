// 飞船：两种飞行模式（游戏向）
//   cruise   巡航（默认）：WASD + Space/C 六向推进 + 阻尼（飞行辅助），
//            Q/E 横滚；X 刹车（强阻尼悬停）；Shift 加力。
//            真实宇宙无法以此速度旅行，HUD 明示教学快进。
//   ballistic 引力模式：无推力阻尼，仅受当前层引力源作用，
//            以实时子步进积分——把时间调快即可看到开普勒轨道；
//            WASD 提供小推力作变轨机动。切入时自动获得圆轨道速度。
// autoVoyage（旅行者号自由航行）护栏：ballistic 下生效——
//   防坠：近天体时速度渐转向切向（弹弓近掠，绝不着陆）；
//   防困死：深入捕获半径束缚超 8s 后顺行加速逃逸，继续远航。
// 引力源由 world.gravity 声明：{ GM(世界单位³/真实秒²), minR(碰撞半径), name }
// 无 gravity 声明的层中 ballistic 退化为惯性直线飞行。
import { clamp } from '../util/math.js';

export class Probe {
  constructor() {
    this.pos = [0, 0, 0]; // 世界坐标（当前层单位）
    this.vel = [0, 0, 0]; // 世界单位 / 真实秒
    this.yaw = 0; // 朝向（绕 Y），0 = -Z 方向
    this.pitch = 0;
    this.roll = 0; // 横滚（绕前向轴，Q/E 控制；层切换时回正）
    this.thrustOn = false;
    this.mode = 'cruise'; // 'cruise' | 'ballistic'
    this.world = null; // 当前 world 描述（见 schema）
    this.trail = [];
    this._spawn = [0, 0, 0];
    this.dominantWell = null; // 当前主导引力井（最近）
    this.captureState = null; // { well, name, since(性能时钟秒) } 完全捕获检测
    this.autoVoyage = false; // 旅行者号自由航行护栏开关（ballistic 下生效）
    this._voyBound = null; // 深井束缚起始时刻（防困死逃逸计时）
  }

  bindWorld(world, spawn) {
    this.world = world;
    this._spawn = spawn ? spawn.slice() : [0, 0, 0];
    this.pos = this._spawn.slice();
    this.vel = [0, 0, 0];
    this.roll = 0; // 跨层时机翼回正
    this.trail.length = 0;
    this._voyBound = null;
    // 朝向由 Navigator.enter 的 lookTowards 设定（看向该层兴趣中心）
  }

  // 当前生效的引力井列表：world.gravityWells 优先（可含动态井 ref:entity），
  // 否则包装 world.gravity 为单一静态井
  _wells() {
    const w = this.world;
    if (w.gravityWells) return w.gravityWells;
    if (w.gravity) return [{ center: w.gravity.center, GM: w.gravity.GM, minR: w.gravity.minR, name: w.gravity.name }];
    return [];
  }

  // 切换到轨道飞行：以当前点绕最近引力井的圆轨道速度作为初速（切向、沿视线侧）
  enterBallistic() {
    this.mode = 'ballistic';
    const wells = this._wells();
    if (!wells.length) return; // 无引力层：惯性直线
    // 最近井
    let best = null, bestR = Infinity;
    for (const well of wells) {
      const c = well.ref ? well.ref.pos : well.center;
      const r = Math.hypot(this.pos[0]-c[0], this.pos[1]-c[1], this.pos[2]-c[2]) || 1;
      if (r < bestR) { bestR = r; best = { c, GM: well.GM }; }
    }
    const v = Math.sqrt(best.GM / bestR); // 圆轨道速度
    const cur = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    if (cur > 0.02) {
      // 玩家已有速度（巡航减速贴近/全速飞掠）：保留——切入姿态决定
      // 被行星捕获还是被甩出，构成玩法
    } else {
      // 几乎静止：注入圆轨道速度（切向、沿视线侧）
      const dx = this.pos[0]-best.c[0], dy = this.pos[1]-best.c[1], dz = this.pos[2]-best.c[2];
      let tx = dz, ty = 0, tz = -dx;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const f = this.forward();
      if (tx * f[0] + ty * f[1] + tz * f[2] < 0) { tx = -tx; ty = -ty; tz = -tz; }
      this.vel = [tx * v, ty * v, tz * v];
    }
    this.captureState = null;
  }

  exitBallistic() {
    this.mode = 'cruise';
    this.captureState = null;
    this.autoVoyage = false;
    this._voyBound = null;
  }

  // 被"完全捕获"后的继续航行：沿层出生方向，在引力系统边缘重新出发
  respawn() {
    const wells = this._wells();
    let c = [0, 0, 0], minR = 0.5;
    if (wells.length) {
      let bestR = Infinity;
      for (const well of wells) {
        const cc = well.ref ? well.ref.pos : well.center;
        const r = Math.hypot(this.pos[0]-cc[0], this.pos[1]-cc[1], this.pos[2]-cc[2]) || 1;
        if (r < bestR) { bestR = r; c = cc; minR = well.minR || 0.5; }
      }
    }
    const dx = this._spawn[0]-c[0], dy = this._spawn[1]-c[1], dz = this._spawn[2]-c[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const edge = clamp(dl, minR * 40, (this.world.worldRadius || 50) * 0.7);
    this.pos = [c[0] + dx/dl*edge, c[1] + dy/dl*edge, c[2] + dz/dl*edge];
    this.vel = [0, 0, 0];
    this.mode = 'cruise';
    this.trail.length = 0;
    this.captureState = null;
    this.autoVoyage = false;
    this._voyBound = null;
  }

  // 转动朝向使其看向目标点（层进入时用，保证构图稳定不依赖上一层朝向）
  lookTowards(target) {
    const dx = target[0] - this.pos[0], dy = target[1] - this.pos[1], dz = target[2] - this.pos[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    this.pitch = Math.asin(dy / l);
    this.yaw = Math.atan2(-dx, -dz);
    this.roll = 0;
  }

  // 前向/右/上（yaw/pitch 球坐标；与引擎 chase 相机约定一致：初始朝 -Z）
  // 右/上额外绕前向轴旋转 roll（横滚），平飞时 roll=0 与旧行为一致
  forward() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [-sy * cp, sp, -cy * cp];
  }
  right() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // 零横滚基向量：水平右 + 由 r×f 得到的基上
    const rx = cy, ry = 0, rz = -sy;
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const c = Math.cos(this.roll), s = Math.sin(this.roll);
    return [rx * c + ux * s, ry * c + uy * s, rz * c + uz * s];
  }
  up() {
    const f = this.forward(), r = this.right();
    return [r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0]];
  }

  // 相对航向推动：dYaw/dPitch（弧度，鼠标）+ dRoll（弧度，Q/E 横滚）
  steer(dYaw, dPitch, dRoll = 0) {
    this.yaw -= dYaw;
    this.pitch = clamp(this.pitch + dPitch, -Math.PI/2 + 0.02, Math.PI/2 - 0.02);
    this.roll += dRoll;
    // 横滚收敛到 [-π, π]，避免长期累积溢出
    if (this.roll > Math.PI) this.roll -= Math.PI * 2;
    else if (this.roll < -Math.PI) this.roll += Math.PI * 2;
  }

  // 紧急刹车：强阻尼把速度杀到接近 0（X 键，巡航模式）
  brake(dtReal) {
    const k = Math.max(0, 1 - 4.0 * dtReal);
    this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k;
    if (this.speedWorldPerS() < (this.world?.maxSpeedWorldPerS || 1) * 0.002) {
      this.vel = [0, 0, 0];
    }
  }

  // dtPhys = 轨道飞行模式的物理时标（实时秒——引力井全部为演示校准 GM，
  // 与时间倍速解耦：轨道运动实时可玩，行星公转由各 world 自己用 dtSim 驱动）
  step(dtReal, keys, thrustScale = 1, dtPhys = 0) {
    const w = this.world;
    const maxSp = w.maxSpeedWorldPerS;
    const acc = w.thrustAccWorldPerS2; // 加速度（世界单位/真实秒²）
    let ax = 0, ay = 0, az = 0;

    if (this.mode === 'ballistic') {
      // 轨道飞行：多引力井（太阳+行星等，动态井随天体运动）+ 小推力变轨，
      // 无阻尼，以模拟时间子步进积分——时间倍速下可观看开普勒轨道
      const wells = this._wells();
      // WASD 变轨机动（推力较小，用于抬/降轨道）
      let mx = 0, my = 0, mz = 0;
      if (this.thrustOn) {
        const f = this.forward(), r3 = this.right(), u = this.up();
        const kf = (keys.fwd ? 1 : 0) - (keys.bwd ? 1 : 0);
        const ks = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        const ku = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
        const m = acc * 0.25 * thrustScale;
        mx = (f[0] * kf + r3[0] * ks + u[0] * ku) * m;
        my = (f[1] * kf + r3[1] * ks + u[1] * ku) * m;
        mz = (f[2] * kf + r3[2] * ks + u[2] * ku) * m;
      }
      // 子步进积分：单步 ≤ STEP_MAX，加速度在每子步内按当前井位置重算
      // （动态井跟随行星公转）
      const STEP_MAX = 0.008; // 8ms 物理子步（近行星轨道周期 ~1s，保证精度）
      let remain = Math.min(dtPhys, 0.25);
      do {
        const h = Math.min(STEP_MAX, remain);
        let ax = mx, ay = my, az = mz;
        for (const well of wells) {
          const c = well.ref ? well.ref.pos : well.center;
          const dx = c[0] - this.pos[0], dy = c[1] - this.pos[1], dz = c[2] - this.pos[2];
          const r = Math.hypot(dx, dy, dz) || 1;
          const a = well.GM / (r * r);
          ax += dx / r * a; ay += dy / r * a; az += dz / r * a;
        }
        this.vel[0] += ax * h;
        this.vel[1] += ay * h;
        this.vel[2] += az * h;
        this.pos[0] += this.vel[0] * h;
        this.pos[1] += this.vel[1] * h;
        this.pos[2] += this.vel[2] * h;
        // 引力体接触：常规模式软着陆（钳在表面、径向速度清零）；
        // 自由航行则是防坠护栏——速度渐转向切向，弹弓近掠绝不着陆
        for (const well of wells) {
          const c = well.ref ? well.ref.pos : well.center;
          const minR = well.minR || 0.3;
          const dx = this.pos[0] - c[0], dy = this.pos[1] - c[1], dz = this.pos[2] - c[2];
          const r = Math.hypot(dx, dy, dz) || 1;
          if (this.autoVoyage && r < minR * 1.8) {
            const rx = dx / r, ry = dy / r, rz = dz / r;
            const vr = this.vel[0] * rx + this.vel[1] * ry + this.vel[2] * rz;
            let tx = this.vel[0] - rx * vr, ty = this.vel[1] - ry * vr, tz = this.vel[2] - rz * vr;
            let tl = Math.hypot(tx, ty, tz);
            if (tl < 1e-6) { tx = -rz; ty = 0; tz = rx; tl = Math.hypot(tx, ty, tz) || 1; } // 正对心坠落：任取切向
            const sp = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
            // 越贴近偏折越强；k 封顶按子步长——1 秒内完成甩摆
            const k = Math.min(1, (minR * 1.8 - r) / (minR * 0.8)) * Math.min(1, 6 * h);
            this.vel[0] = this.vel[0] * (1 - k) + tx / tl * sp * k;
            this.vel[1] = this.vel[1] * (1 - k) + ty / tl * sp * k;
            this.vel[2] = this.vel[2] * (1 - k) + tz / tl * sp * k;
            if (r < minR * 1.05) {
              const kk = (minR * 1.05) / r;
              this.pos[0] = c[0] + dx * kk;
              this.pos[1] = c[1] + dy * kk;
              this.pos[2] = c[2] + dz * kk;
              if (vr < 0) {
                this.vel[0] -= rx * vr;
                this.vel[1] -= ry * vr;
                this.vel[2] -= rz * vr;
              }
            }
          } else if (r < minR) {
            const k = minR / r;
            this.pos[0] = c[0] + dx * k;
            this.pos[1] = c[1] + dy * k;
            this.pos[2] = c[2] + dz * k;
            const vr = (this.vel[0] * dx + this.vel[1] * dy + this.vel[2] * dz) / r;
            if (vr < 0) {
              this.vel[0] -= dx / r * vr;
              this.vel[1] -= dy / r * vr;
              this.vel[2] -= dz / r * vr;
            }
          }
        }
        remain -= h;
      } while (remain > 0);
      // 捕获检测：主导井（最近）的比能量 E = v²/2 - GM/r < 0（束缚）
      // 且已深入其捕获半径 → 标记"完全捕获"，由 UI 提示按 R 重生
      this.dominantWell = null;
      let bestR = Infinity, best = null;
      for (const well of wells) {
        const c = well.ref ? well.ref.pos : well.center;
        const r = Math.hypot(this.pos[0]-c[0], this.pos[1]-c[1], this.pos[2]-c[2]) || 1;
        if (r < bestR) { bestR = r; best = { well, r, c }; }
      }
      if (best) {
        this.dominantWell = best.well;
        const E = (this.vel[0]**2 + this.vel[1]**2 + this.vel[2]**2) / 2 - best.well.GM / best.r;
        const capR = best.well.capR ?? (best.well.minR || 0.3) * 5;
        // 捕获判定：贴在井表面（着陆停泊）或束缚轨道深入捕获半径
        // （自由航行不判捕获——护栏自主逃逸，无需玩家 R 重生）
        const landed = best.r < (best.well.minR || 0.3) * 1.02;
        const trapped = !this.autoVoyage && (landed || (E < 0 && best.r < capR));
        const now = performance.now() / 1000;
        if (trapped) {
          if (!this.captureState) this.captureState = { name: best.well.name, since: now };
          this._lastTrapped = now; // 记录最近一次处于捕获态（解除滞后用）
        } else if (this.captureState && now - (this._lastTrapped ?? 0) > 3) {
          this.captureState = null; // 持续 3 秒脱离才解除（防瞬时波动闪烁）
        }
        // 自由航行防困死：深入捕获半径且束缚轨道超 8s → 顺行加速（TCM），
        // 达逃逸能量或飞出捕获半径即停——绕行星欣赏片刻后继续远航
        if (this.autoVoyage) {
          if (E < 0 && best.r < capR) {
            if (!this._voyBound) this._voyBound = now;
            if (now - this._voyBound > 8) {
              const sp = this.speedWorldPerS() || 1e-6;
              const burn = (this.world.thrustAccWorldPerS2 || 1) * 0.3 * Math.min(dtPhys, 0.25);
              this.vel[0] += this.vel[0] / sp * burn;
              this.vel[1] += this.vel[1] / sp * burn;
              this.vel[2] += this.vel[2] / sp * burn;
            }
          } else {
            this._voyBound = null;
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

  // 轨迹采样（按移动距离；巡航用速度比例，轨道飞行用绝对间距保证连续；
  // 低速时按层速上限给下限，防止船尾堆点成线团）
  _pushTrail(maxSp) {
    const sp = this.speedWorldPerS();
    const minGap = this.mode === 'ballistic' ? Math.max(sp * 6, maxSp * 0.04) : maxSp * 0.08;
    if (!this.trail.length || Math.hypot(this.trail[this.trail.length-1][0]-this.pos[0],
        this.trail[this.trail.length-1][1]-this.pos[1], this.trail[this.trail.length-1][2]-this.pos[2]) > minGap) {
      this.trail.push([...this.pos]);
      if (this.trail.length > 500) this.trail.shift();
    }
  }

  speedWorldPerS() { return Math.hypot(this.vel[0], this.vel[1], this.vel[2]); }
  // 当前点所有引力井的合成加速度（世界单位/真实秒²）——自由航行 TCM 判据用
  gravAccel() {
    let ax = 0, ay = 0, az = 0;
    for (const well of this._wells()) {
      const c = well.ref ? well.ref.pos : well.center;
      const dx = c[0] - this.pos[0], dy = c[1] - this.pos[1], dz = c[2] - this.pos[2];
      const r = Math.hypot(dx, dy, dz) || 1;
      const a = well.GM / (r * r);
      ax += dx / r * a; ay += dy / r * a; az += dz / r * a;
    }
    return [ax, ay, az];
  }
  // 换算真实 km/s（可超光速，仅供 HUD“演示倍率”展示）
  speedKmS() { return this.speedWorldPerS() * this.world.kmPerUnit; }
}
