// CosmicSimulation 的 probe 方法组（目录梳理：mixin 装配，方法体未改动）。
// 通过 Object.assign 挂到 prototype，方法内仍以 this 访问实例状态。
import {
  EPS2, N_PARTICLES, N_CLOUD_PARTICLES, N_EJECTA_PARTICLES,
  GRAVITY_START, GRAVITY_FULL, BASE_SPEED,
  SEED_R_MIN, SEED_R_MAX, EJECTA_SPEED_MIN, EJECTA_SPEED_MAX,
  PROBE_INITIAL_SPEED, PROBE_BIGBANG_SPEED, BIG_BANG_WALL, PROBE_GRAVITY_MULT,
  SEED_AWAKEN_RADIUS, FORMATION_SPACING,
  FRONTIER_INTERVAL,
  REVEAL_RADIUS, REVEAL_SCALE, DISCOVERY_PER_STEP, COLLECTION_LEVELS,
  CLASS_DEFS, PROBE_DRAG_LEGACY, PROBE_IGM_DRAG, PROBE_RESPAWN_SPEED, PROBE_MAX_SPEED,
} from '../config.js';
import { randomUnit, clamp01, smoothstep, easeInOut, orbitPolar, hash01 } from '../utils.js';
import { levelForSeed, finalLevelFor, LEVEL_LABELS, DEATH_VERBS, EVENT_LEVELS, EVENT_MESSAGES, gravityParamsFor } from '../sim-shared.js';

export const probeMethods = {
  _beginDeath(killer, label, captureSeedIdx, deathType, launchR) {
    if (this._deathPending) return; // 已在死亡演出中
    const pr = this.probe;
    pr.deathType = deathType;
    pr.deathPos = [pr.pos[0], pr.pos[1], pr.pos[2]];
    pr.dying = true;
    const dur = this.constructor.DEATH_DUR[deathType] || 0.8;
    pr.dyingT = dur;
    pr.dyingDur = dur;
    this._deathPending = {
      killer, label, captureSeedIdx, deathType, launchR,
      t: dur,
      stopDist: (killer.radius || 0.2) * 0.25,
      tang: randomUnit(1), // 潮汐撕碎的螺旋切向
    };
  },

  _updateDeath(dt) {
    const dp = this._deathPending;
    const pr = this.probe;
    dp.t -= dt;
    pr.dyingT = Math.max(0, dp.t);
    const kp = dp.killer.pos;
    pr.deathKillerPos = [kp[0], kp[1], kp[2]];
    // 插值连续：本步移动前同步 prevPos
    pr.prevPos[0] = pr.pos[0]; pr.prevPos[1] = pr.pos[1]; pr.prevPos[2] = pr.pos[2];
    // 朝杀手天体下沉（捕获得点距离本就很近，下沉是小幅收尾动作）
    const rx = kp[0] - pr.pos[0], ry = kp[1] - pr.pos[1], rz = kp[2] - pr.pos[2];
    const d = Math.max(1e-4, Math.hypot(rx, ry, rz));
    const ux = rx / d, uy = ry / d, uz = rz / d;
    const sink = Math.min(1.5 * dt, Math.max(0, d - dp.stopDist));
    pr.pos[0] += ux * sink; pr.pos[1] += uy * sink; pr.pos[2] += uz * sink;
    if (dp.deathType === 'tidal' && d > dp.stopDist * 2) {
      // 潮汐撕碎：叠加切向螺旋漂移，坠入轨迹是盘旋而非直线
      pr.pos[0] += dp.tang[0] * 0.8 * dt;
      pr.pos[1] += dp.tang[1] * 0.8 * dt;
      pr.pos[2] += dp.tang[2] * 0.8 * dt;
    }
    if (dp.t <= 0) {
      pr.dying = false;
      this._deathPending = null;
      this._respawnFrom(dp.killer.pos, dp.launchR, dp.label, dp.captureSeedIdx, dp.deathType);
    }
  },

  // 手动重置小球（引力实验用）：给定速率与方向（方位角 az / 仰角 el，弧度），
  // 重新放置小球并赋予速度矢量，便于反复观察同一初始条件下的引力作用。
  // 位置会自动退到最近天体的安全距离外，避免一重置就撞上去。
  resetProbe({ speed = PROBE_RESPAWN_SPEED, az = 0, el = 0 } = {}) {
    const pr = this.probe;
    const sp = Math.max(0, speed);
    const ce = Math.cos(el);
    const se = Math.sin(el);
    const dir = [Math.sin(az) * ce, se, Math.cos(az) * ce];
    // 位置：沿"远离最近天体"的方向退到 2.5R 外（R = 系统半径）
    let px = pr.pos[0], py = pr.pos[1], pz = pr.pos[2];
    if (pr.influencer >= 0) {
      const s = this.seeds[pr.influencer];
      const dx = px - s.pos[0], dy = py - s.pos[1], dz = pz - s.pos[2];
      const dl = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const k = (this._systemRadius(s) * 2.5) / dl;
      px = s.pos[0] + dx * k; py = s.pos[1] + dy * k; pz = s.pos[2] + dz * k;
    }
    pr.pos = [px, py, pz];
    // 瞬移：prevPos 同步，避免插值从旧位置拉出一条拖影
    pr.prevPos = pr.pos.slice();
    pr.vel = [dir[0] * sp, dir[1] * sp, dir[2] * sp];
    // 清掉死亡 / 绕行 / 捕获状态
    pr.dying = false;
    pr.dyingT = 0;
    this._deathPending = null;
    pr.orbitAngleAcc = 0;
    pr.straightTime = 0;
    pr.respawnFlash = 1;
    pr.respawnGrace = 3;
    // generation 变化会让渲染层清空轨迹
    pr.generation += 1;
    pr.label = '引力实验 · 手动重置';
    this.events.push({
      time: this.time,
      text: `↺ 手动重置：速率 ${sp.toFixed(1)}，方向 az=${((az * 180) / Math.PI).toFixed(0)}° el=${((el * 180) / Math.PI).toFixed(0)}°`,
    });
  },

  _respawnFrom(center, launchR, label, captureSeedIdx = -1, deathType = 'generic') {
    const pr = this.probe;
    // ---- 持续捕获检测：若短时间内反复被同一系统捕获，改用虫洞跃迁逃逸 ----
    if (
      captureSeedIdx >= 0
      && captureSeedIdx === pr.lastCaptureSeed
      && this.time - pr.lastCaptureTime < this.config.wormholeWindow
    ) {
      this._wormholeEscape(captureSeedIdx, label);
      return;
    }
    pr.lastCaptureSeed = captureSeedIdx;
    pr.lastCaptureTime = this.time;

    pr.generation += 1;
    pr.respawns += 1;
    pr.respawnFlash = 1;
    pr.respawnGrace = 10; // 重生后 10 秒内不再捕获（2026-09-02 6→10）：
    // frontier 近投 small 行星后航线更密，6 秒宽限不够飞出密集区，
    // 实测 600 物理秒重生 20 次（11 次大气烧蚀），频繁死亡打断航行节奏
    // ---- 重生位置必须在捕获系统的 detail 区之外（2026-09-03）----
    // 旧 launchR（systemRadius×1.1 或成员半径×7）仍在 detailRadius 内：
    // 黑洞系统的中心黑洞在 2~3 单位处的引力足以在宽限期内把小球拉回
    // 事件视界，形成"重生→再捕获→虫洞"的连环循环。统一抬到
    // max(systemR, detailR)×1.15 之外并以系统中心为基准：黑洞 36×1.15
    // ≈41 处引力加速度 ~0.02/s²，20/s 径向初速直接飞离，普通重生
    // 不再喂给黑洞第二次捕获，虫洞沦为真正的兜底。
    if (captureSeedIdx >= 0 && this.seeds[captureSeedIdx]) {
      const s = this.seeds[captureSeedIdx];
      center = s.pos;
      launchR = Math.max(launchR, this._systemRadius(s), this._detailRadius(s) || 0) * 1.15;
    }
    // 记录死亡方式与位置（渲染层在generation变化时播放对应特效）
    pr.deathType = deathType;
    pr.deathPos = [pr.pos[0], pr.pos[1], pr.pos[2]];
    const rx = pr.pos[0] - center[0];
    const ry = pr.pos[1] - center[1];
    const rz = pr.pos[2] - center[2];
    const rl = Math.max(1e-4, Math.hypot(rx, ry, rz));
    let dx = rx / rl, dy = ry / rl, dz = rz / rl;
    // 加一点随机切向分量，重生后的轨迹不是简单直线。
    const tan = randomUnit(1);
    let ex = dx + tan[0] * 0.45, ey = dy + tan[1] * 0.45, ez = dz + tan[2] * 0.45;
    const el = Math.max(1e-4, Math.hypot(ex, ey, ez));
    ex /= el; ey /= el; ez /= el;
    pr.pos = [
      center[0] + ex * launchR,
      center[1] + ey * launchR,
      center[2] + ez * launchR,
    ];
    // 重生是瞬移：prevPos 同步到新位置，避免插值从旧捕获点拉出一条拖影
    pr.prevPos = pr.pos.slice();
    pr.vel = [ex * PROBE_RESPAWN_SPEED, ey * PROBE_RESPAWN_SPEED, ez * PROBE_RESPAWN_SPEED];
    pr.label = `自${label}系统重生航行`;
    const verb = DEATH_VERBS[deathType] || DEATH_VERBS.generic;
    this.events.push({ time: this.time, text: `${verb(label)}，已在边缘重生第${pr.generation}代并继续航行` });
  },

  // 虫洞跃迁：被持续捕获时不再重生到系统边缘，而是动画跳跃到远方一个新位置继续航行。
  // 落点安全性是构造性（2026-09-03 重做，100% 保证不再被捕获）：
  //  ① 距所有种子 ≥ safe（safe ≥ 220 > 最大 detail 触发半径 161 与黑洞
  //     影响半径 ~76——落点不在任何系统的引力腹地内）。种子有限（57 个）
  //     而空间无界，距离逐档翻倍（×1,2,4,…,32，最远 ≈25600 单位），
  //     数学上必然存在满足条件的档位：循环必然终止、必然安全，
  //     不存在旧实现"4 次尝试失败后接受次优落点"的漏洞。
  //  ② 出射方向 = 背离落点处最近种子的径向向外（+少量随机切向）——
  //     出来后小球只会离最近的天体越来越远，不会被反向吸回。
  //  ③ respawnGrace（10 物理秒 × 20/s ≈ 200 单位航程）内不可捕获，
  //     宽限结束时距最近种子已 ≥ safe+200。
  // 三者叠加：虫洞后的小球在物理上不可能立即再次被捕获；此后若再次
  // 被捕获属于全新航段的正常事件（捕获记忆已重置，不构成循环）。
  _wormholeEscape(captureSeedIdx, label) {
    const pr = this.probe;
    const from = [pr.pos[0], pr.pos[1], pr.pos[2]];
    const baseDist = this.config.wormholeDist;
    const safe = Math.max(this.config.wormholeSafeMargin, 220);
    // 候选方向：速度反方向优先（远离来路），黄金角螺旋补齐 24 个近似
    // 均匀覆盖全球的方向——总有方向指向空旷区。
    const dirs = [];
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    if (sp > 0.5) dirs.push([-pr.vel[0] / sp, -pr.vel[1] / sp, -pr.vel[2] / sp]);
    const N = 24;
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; dirs.length < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * GOLDEN;
      dirs.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
    }
    // 距离翻倍扫描：每档取"距最近种子最远"的方向为该档最优；
    // 任一方向满足 safe 即刻接受。全程记录全局 fallback（防御兜底，
    // 数学上不可达——×32 档距最近种子必然 > safe）。
    let to = null, toClear = 0;
    let fallback = null, fallbackClear = -Infinity;
    for (let k = 0; k < 6 && !to; k++) {
      const dist = baseDist * Math.pow(2, k);
      for (const d of dirs) {
        const tx = pr.pos[0] + d[0] * dist;
        const ty = pr.pos[1] + d[1] * dist;
        const tz = pr.pos[2] + d[2] * dist;
        const clear = this._distanceToNearestSeed(tx, ty, tz);
        if (clear > fallbackClear) { fallbackClear = clear; fallback = [tx, ty, tz]; }
        if (clear >= safe) { to = [tx, ty, tz]; toClear = clear; break; }
      }
    }
    if (!to) { to = fallback; toClear = fallbackClear; }
    const jumpDist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    // 出射方向：背离落点处最近的种子（径向向外），叠加少量随机切向
    const near = this._nearestSeedInfo(to[0], to[1], to[2]);
    let ax = 1, ay = 0, az = 0;
    if (near.seed) {
      ax = to[0] - near.seed.pos[0];
      ay = to[1] - near.seed.pos[1];
      az = to[2] - near.seed.pos[2];
      const al = Math.max(1e-4, Math.hypot(ax, ay, az));
      ax /= al; ay /= al; az /= al;
    }
    const tan = randomUnit(1);
    let vx = ax + tan[0] * 0.25, vy = ay + tan[1] * 0.25, vz = az + tan[2] * 0.25;
    const vl = Math.max(1e-4, Math.hypot(vx, vy, vz));
    vx /= vl; vy /= vl; vz /= vl;

    pr.wormholeFrom = from;
    pr.wormholeTo = to;
    pr.wormholeTimer = this.config.wormholeDuration;
    pr.wormholeDuration = this.config.wormholeDuration;
    // 物理上把小球瞬移到 to 处，避免在动画中继续被强引力拉回
    pr.pos = to.slice();
    pr.prevPos = to.slice();
    pr.vel = [vx * PROBE_RESPAWN_SPEED, vy * PROBE_RESPAWN_SPEED, vz * PROBE_RESPAWN_SPEED];
    pr.respawnGrace = 10; // 与 _respawnFrom 一致（2026-09-02 6→10）
    pr.respawnFlash = 1;
    pr.label = `经虫洞跃迁逃出【${label}】`;
    pr.lastCaptureSeed = -1; // 成功逃逸，重置捕获记忆
    pr.lastCaptureTime = -Infinity;
    this.events.push({ time: this.time, text: `🌀 小球被【${label}】持续捕获，经虫洞跃迁 ${jumpDist.toFixed(0)} 单位（距最近天体 ${toClear.toFixed(0)}，出射方向背离该天体）真正逃逸` });
  },

  _updateProbe(dt) {
    const pr = this.probe;
    // 积分前保存本步起点，供渲染层做帧间插值（消除固定步长抖动）
    pr.prevPos[0] = pr.pos[0];
    pr.prevPos[1] = pr.pos[1];
    pr.prevPos[2] = pr.pos[2];
    pr.phaseTime += dt;
    pr.respawnFlash = Math.max(0, pr.respawnFlash - dt * 0.9);
    pr.respawnGrace = Math.max(0, pr.respawnGrace - dt);
    pr.wormholeTimer = Math.max(0, pr.wormholeTimer - dt);
    const gs = this.gravityStrength;
    // 引力常数与天体质量倍率运行时可调（UI 滑杆），取值已在 UI 侧钳制
    const gG = this.config.gravityG;
    const mS = this.config.bodyMassScale;

    // 用子步长积分，近距离强引力下也保持稳定。
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let n = 0; n < steps; n++) {
      let ax = 0, ay = 0, az = 0;
      if (gs > 0.001) {
        for (const s of this.seeds) {
          const dx = s.pos[0] - pr.pos[0];
          const dy = s.pos[1] - pr.pos[1];
          const dz = s.pos[2] - pr.pos[2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < 1e-6) continue;
          // ---- 质点质量与衰减律按系统类型区分（2026-09-03 引力重做）----
          // 单天体（星尘/行星/恒星）：点质量律 a ∝ 1/r^1.9（软化 EPS2），
          //   质点永不退场。
          // 集合系统（星团/星系/超星系团/星云/黑洞）：延展质量分布——
          //   真实星系（恒星盘 + 暗物质晕）的旋转曲线在盘尺度内平坦，
          //   对应 a ∝ 1/r（对数势），比点质量衰减慢——从 3~4 倍系统
          //   半径外就持续弯曲小球航线（旧点质量律在 r=200 处仅
          //   0.002/s²，"直接飞过去"毫无偏转）。参数标定见
          //   sim-shared.js 的 gravityParamsFor（三处公式统一取用）。
          //   进入系统后质点退到 0.45 底数（成员引力接管），总有效
          //   质量 ≤ s.mass。
          const gp = gravityParamsFor(s.level);
          let seedMass = s.mass * gp.mult;
          if (s.detail && s.detail.radius > 0 && COLLECTION_LEVELS.has(s.level)) {
            const wIn = smoothstep(s.detail.radius * 0.6, s.detail.radius * 1.4, Math.sqrt(r2));
            seedMass = s.mass * gp.mult * (0.45 + 0.55 * wIn);
          }
          if (seedMass < 1e-6) continue;
          const f = gG * PROBE_GRAVITY_MULT * (seedMass * mS) / Math.pow(r2 + gp.soft2, gp.invExp) * gs;
          ax += f * dx; ay += f * dy; az += f * dz;
        }
      }
      for (const s of this.activeDetails) {
        // 成员的引力按"进入深度"平滑登场，与上面中心质点的退场互补：
        // 远处全靠质点（等价多极展开的单极项），靠近后成员分布登场；
        // 质点保留的 0.45 底数代表未分辨的连续质量，两边总效应 ≤ s.mass。
        // 这样展开 detail 不会造成引力跳变。
        let memberW = 1;
        if (s.detail && s.detail.radius > 0) {
          const dd = Math.hypot(s.pos[0] - pr.pos[0], s.pos[1] - pr.pos[1], s.pos[2] - pr.pos[2]);
          memberW = 1 - smoothstep(s.detail.radius * 0.6, s.detail.radius * 1.4, dd);
        }
        if (memberW <= 0.001) continue;
        for (const b of s.detail.bodies) {
          // ---- 所有成员天体都产生引力（2026-09-03 修正）----
          // "发现"只是视觉/交互概念，恒星物理上就在那里——未发现的
          // 成员同样对小球施加引力（用户要求"所有天体都正常产生引力
          // 作用"）。成员质量已归一化到 s.mass（§5.4），全部计入也不
          // 超过系统总质量。碰撞捕获仍要求已发现（接近是交互前提）。
          const dx = b.pos[0] - pr.pos[0];
          const dy = b.pos[1] - pr.pos[1];
          const dz = b.pos[2] - pr.pos[2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < 1e-6) continue;
          const f = gG * PROBE_GRAVITY_MULT * (b.mass * mS) * memberW / Math.pow(r2 + 0.12, 0.95);
          ax += f * dx; ay += f * dy; az += f * dz;
          // 二级系统的行星/卫星质量小，但贴近时仍有可感知的引力
          if (b.children) {
            for (const ch of b.children) {
              const cx = ch.pos[0] - pr.pos[0];
              const cy = ch.pos[1] - pr.pos[1];
              const cz = ch.pos[2] - pr.pos[2];
              const cr2 = cx * cx + cy * cy + cz * cz;
              if (cr2 < 1e-6) continue;
              const cf = gG * PROBE_GRAVITY_MULT * (ch.mass * mS) * memberW / Math.pow(cr2 + 0.12, 0.95);
              ax += cf * cx; ay += cf * cy; az += cf * cz;
            }
          }
        }
      }
      // 记录本子步的总引力加速度（供 HUD 显示"当前所受引力大小"与状态判定）
      pr.gravAccel[0] = ax; pr.gravAccel[1] = ay; pr.gravAccel[2] = az;
      pr.vel[0] += ax * h; pr.vel[1] += ay * h; pr.vel[2] += az * h;
      // 注意：这里**不做**任何"限速 / 巡航速度"处理。
      // 速度大小由引力与介质阻尼自然决定（上限由下方 PROBE_MAX_SPEED 截断）。
      // 想让屏幕上走得慢，请在显示层调 state.timeScale（见 render() 中的
      // state.physAcc 累积），不要动这里的物理量 —— 改动会破坏轨道结果。

      // ---- 进入系统后的星际气体阻尼（速度-尺度协调，2026-08-30 重做）----
      // 原实现范围 = systemRadius（恒星系仅 3.4、行星系仅 1.7）——小球
      // 30/s 巡航穿过恒星系只花 0.9s、行星系 0.3s，伴星/行星/小行星带
      // 根本来不及看清（实测小球速度是成员轨道速度的 17~60 倍）。
      // 现在：范围扩到 detailRadius（"可分辨细节"的边缘就开始减速），
      // 强度按层级分级 + 深度线性（2026-09-03 引力重做配套再标定）：
      //   小型单天体（行星/恒星/星尘）2.2/s —— 贴近时降到可观察速度
      //   中型集合（星团/黑洞）        0.5/s
      //   大型集合（星系/超星系团）    0 —— 完全无阻尼！
      // 大系统阻尼必须为零：集合系统现在是延展 1/r 引力（对数势），
      // 任何非零阻尼都会持续抽走轨道能量——小球被渐进拉入 detailR×0.75
      // 阻尼圈、数圈减速后螺旋坠入星系核（实测 0.45 乃至 0.10 都会
      // 捕获连 400 外的掠过）。真实宇宙里星际介质对穿越探测器无阻尼，
      // 星系穿越是纯引力弹弓（能量守恒、出速=入速、轨迹弯曲）；
      // "穿越星系看清结构"由显示层 envScale 自动慢放承担（接近系统
      // 1.1R 内 ×0.35，2026-09-03 已实装）。
      let drag = 0;
      for (const s of this.seeds) {
        const R = Math.max(this._systemRadius(s), (this._detailRadius(s) || 0) * 0.75);
        const dx = s.pos[0] - pr.pos[0];
        const dy = s.pos[1] - pr.pos[1];
        const dz = s.pos[2] - pr.pos[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < R) {
          const depth = 1 - d / R;
          // 星云（dust/void）归中档：它们也是延展引力的集合系统，
          // 2.2 高阻尼 + 延展引力会把小球黏在云里数分钟（实测 141s）
          const coeff = (s.level === 'planet' || s.level === 'star') ? 2.2
            : (s.level === 'cluster' || s.level === 'blackhole' || s.level === 'dust' || s.level === 'void') ? 0.5
            : 0;
          let k = coeff * depth;
          if (s.level === 'blackhole') {
            const cap = this._captureRadius(s);
            if (d < cap * 4) k += (1 - d / (cap * 4)) * 0.8;
          }
          drag = Math.max(drag, k);
        }
      }
      if (drag > 0) {
        const f = Math.max(0, 1 - drag * h);
        pr.vel[0] *= f; pr.vel[1] *= f; pr.vel[2] *= f;
      }
      if (this.time > 2.2) {
        const igm = Math.max(0, 1 - PROBE_IGM_DRAG * h);
        pr.vel[0] *= igm; pr.vel[1] *= igm; pr.vel[2] *= igm;
      }
      // ---- 巡航恢复（游戏化）----
      // 被系统阻尼减速后（离开系统时可能只有 6~10/s），空旷区以
      // 0.3/s 向巡航 PROBE_INITIAL_SPEED 松弛——避免"8/s 爬行 50 秒"
      // 的无聊空旷航段（相当于飞船的巡航引擎维持航速，纯速度维持、
      // 不产生方向改变；在系统阻尼区内不生效，不影响捕获判定）。
      // 2026-09-03 自 0.1 上调：延展引力全程泵速 vs 恢复拉速互相拉锯，
      // 0.1 拉不回巡航——实测小球常态跑在 20~26 顶着限速，穿越窗口
      // 被压缩；0.3 让离开系统后 ~5s 内回到巡航节奏。
      if (this.time > BIG_BANG_WALL && drag <= 0) {
        const sp2 = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
        if (sp2 < PROBE_INITIAL_SPEED && sp2 > 1e-3) {
          const k = Math.min(1, h * 0.3);
          const ux = pr.vel[0] / sp2, uy = pr.vel[1] / sp2, uz = pr.vel[2] / sp2;
          pr.vel[0] += (ux * PROBE_INITIAL_SPEED - pr.vel[0]) * k;
          pr.vel[1] += (uy * PROBE_INITIAL_SPEED - pr.vel[1]) * k;
          pr.vel[2] += (uz * PROBE_INITIAL_SPEED - pr.vel[2]) * k;
        }
      }
      // 玩家推进器：与介质阻尼并列，但不被它吃（玩家推力要能"对抗"系统阻尼）。
      // 关闭时 this.thrust 恒为 0，相当于这行不存在。
      if (this.config.thrustEnabled) {
        pr.vel[0] += this.thrust[0] * h;
        pr.vel[1] += this.thrust[1] * h;
        pr.vel[2] += this.thrust[2] * h;
      }
      // 引力弹弓加速有界：超过上限后等比例截断，保持航行节奏与跟拍稳定。
      // 大爆炸瞬间（BIG_BANG_WALL 内）豁免——小球以超光速喷出后由下方
      // 减速项拉回巡航速度，不能被这里的截断直接拍成 PROBE_MAX_SPEED
      // （那样"超光速飞散"的视觉瞬间就没了）。
      const spd = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (spd > PROBE_MAX_SPEED && this.time > BIG_BANG_WALL) {
        const f = PROBE_MAX_SPEED / spd;
        pr.vel[0] *= f; pr.vel[1] *= f; pr.vel[2] *= f;
      }
      // 暴胀减速：爆炸窗口内速度向巡航 PROBE_INITIAL_SPEED 松弛。
      // 只改大小、不改方向——爆炸径向喷出的轨迹保持直线，模拟
      // "暴胀后物质快速减速"（前快后慢）。窗口结束后由引力接管。
      if (this.time < BIG_BANG_WALL && spd > PROBE_INITIAL_SPEED) {
        const k = Math.min(1, h * 1.0);
        const ux = pr.vel[0] / spd, uy = pr.vel[1] / spd, uz = pr.vel[2] / spd;
        pr.vel[0] += (ux * PROBE_INITIAL_SPEED - pr.vel[0]) * k;
        pr.vel[1] += (uy * PROBE_INITIAL_SPEED - pr.vel[1]) * k;
        pr.vel[2] += (uz * PROBE_INITIAL_SPEED - pr.vel[2]) * k;
      }
      pr.pos[0] += pr.vel[0] * h;
      pr.pos[1] += pr.vel[1] * h;
      pr.pos[2] += pr.vel[2] * h;
    }

    // 找出对小球施加最强引力的天体系统，供智能镜头聚焦（同时显示小球与它）。
    // 影响力 = 该源对小球造成的加速度大小，越近/质量越大越强。
    // 衰减律与引力积分保持一致（gravityParamsFor 统一取参）。
    let bestInf = -1, bestStr = 0;
    if (gs > 0.001) {
      for (const s of this.seeds) {
        const dx = s.pos[0] - pr.pos[0];
        const dy = s.pos[1] - pr.pos[1];
        const dz = s.pos[2] - pr.pos[2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1e-6) continue;
        const d = Math.sqrt(r2);
        const gp = gravityParamsFor(s.level);
        const f = gG * PROBE_GRAVITY_MULT * (s.mass * gp.mult * mS) / Math.pow(r2 + gp.soft2, gp.invExp) * gs;
        const strength = f * d;
        if (strength > bestStr) { bestStr = strength; bestInf = s.idx; }
      }
    }
    pr.influencer = bestInf;
    pr.influenceStrength = bestStr;

    // ---- 引力状态（要求 5：速率 / 最近天体距离 / 引力大小 + 临界状态）----
    // 用"当前速率 vs 逃逸速度"的比值 kappa 判定被捕获还是被甩出：
    //   逃逸速度 vEsc = sqrt(2·a·r)，a 是当前引力加速度、r 是到天体的距离
    //   （点质量下 a·r = μ/r，于是 vEsc = sqrt(2μ/r)，与解析式一致）。
    //   kappa < 0.85 束缚、0.85~1.0 临界、≥1.0 逃逸。
    // 再结合切向占比区分"环绕轨道"与"径向坠落"。
    {
      const gi = pr.gravInfo;
      const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      const acc = Math.hypot(pr.gravAccel[0], pr.gravAccel[1], pr.gravAccel[2]);
      let nd = Infinity;
      if (pr.influencer >= 0) {
        const s = this.seeds[pr.influencer];
        nd = Math.hypot(pr.pos[0] - s.pos[0], pr.pos[1] - s.pos[1], pr.pos[2] - s.pos[2]);
      }
      const vEsc = acc > 1e-6 && nd < Infinity ? Math.sqrt(2 * acc * Math.max(nd, 1e-3)) : 0;
      const kappa = vEsc > 1e-6 ? sp / vEsc : 0;
      let st = '自由航行';
      if (pr.influencer >= 0 && acc > 0.02) {
        if (kappa >= 1.0) st = '逃逸甩出';
        else if (kappa >= 0.85) st = '临界';
        else if ((pr.orbitTangent || 0) > 0.5) st = '环绕轨道';
        else st = '坠落接近';
      }
      gi.speed = sp;
      gi.nearDist = nd;
      gi.accel = acc;
      gi.vEsc = vEsc;
      gi.kappa = kappa;
      gi.state = st;
    }

    // ---- 绕行检测：自由航行 = 没有绕任何一个天体运动 ----
    // 每步累计"相对 influencer 连线方向转过的角度"（指数衰减窗），
    // 并计算相对速度的切向占比：
    //   直线飞掠 → 方向角几乎不转、切向占比低 → free flight；
    //   被束缚绕行 → 方向角持续累计、切向占比高 → 与天体互动。
    // 只依赖运动学量，不依赖被修改过的引力公式量纲，稳健且可调。
    pr.interactCooldown = Math.max(0, pr.interactCooldown - dt);
    if (pr.influencer >= 0) {
      const s = this.seeds[pr.influencer];
      const rx = pr.pos[0] - s.pos[0];
      const ry = pr.pos[1] - s.pos[1];
      const rz = pr.pos[2] - s.pos[2];
      const rl = Math.max(1e-6, Math.hypot(rx, ry, rz));
      const nx = rx / rl, ny = ry / rl, nz = rz / rl;
      if (pr.influencer !== pr._orbitSeed) {
        // 目标系统切换：清空累计，从当前方向重新开始观测
        pr._orbitSeed = pr.influencer;
        pr.orbitAngleAcc = 0;
        pr.straightTime = 0;
        pr._orbitDirPrev = [nx, ny, nz];
      }
      const prev = pr._orbitDirPrev;
      const dot = Math.min(1, Math.max(-1, prev[0] * nx + prev[1] * ny + prev[2] * nz));
      const dTheta = Math.acos(dot);
      pr.orbitAngleAcc = pr.orbitAngleAcc * Math.exp(-dt / 1.4) + dTheta;
      const vs = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (vs > 1e-4) {
        const vr = pr.vel[0] * nx + pr.vel[1] * ny + pr.vel[2] * nz;
        const vt = Math.sqrt(Math.max(0, vs * vs - vr * vr));
        pr.orbitTangent = vt / vs;
      }
      pr._orbitDirPrev = [nx, ny, nz];
      if (pr.orbitAngleAcc < 0.6 && pr.orbitTangent < 0.35) {
        pr.straightTime += dt;
      } else {
        pr.straightTime = 0;
      }
    } else {
      pr._orbitSeed = -1;
      pr.orbitAngleAcc = 0;
      pr.orbitTangent = 0;
      pr.straightTime = 0;
    }

    // 捕获检测：落到天体核心/事件视界就重生，不做任何预定弹射。
    // 注意：星团/星系/超星系团本身是"集合"，不会作为整体捕获小球；
    // 小球只会被这些集合中的单个成员（恒星/行星/黑洞）持久捕获。
    const mature = this.time > GRAVITY_START + 0.5;
    let nearest = -1;
    let nearestD = Infinity;
    for (const s of this.seeds) {
      const dx = s.pos[0] - pr.pos[0];
      const dy = s.pos[1] - pr.pos[1];
      const dz = s.pos[2] - pr.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < nearestD) { nearestD = d; nearest = s.idx; }
      // 只有"非集合"类（行星/恒星）作为整体才能捕获小球；
      // 星尘云/星团/星系/超星系团/黑洞都是集合或多体，捕获由内部成员负责
      const cap = this._captureRadius(s);
      if (mature && pr.respawnGrace <= 0 && d < cap && (s.level === 'planet' || s.level === 'star')) {
        // 进入死亡序列：恒星整体捕获 = 汽化；星尘/行星 = 大气烧蚀
        this._beginDeath(s, LEVEL_LABELS[s.level] || '天体', s.idx, s.level === 'star' ? 'vaporize' : 'atmosphere', Math.max(this._systemRadius(s) * 1.1, cap * 4));
        return;
      }
      // 集合类（星团 / 星系 / 超星系团 / 黑洞）**没有**整体碰撞体：
      // 它们不是单个天体，内部绝大部分是空的，小球从旋臂之间穿过去是物理
      // 上正确的行为，只有撞上具体成员（恒星 / 行星 / 黑洞）才应判定捕获。
      // （曾经加过"核心半径兜底"来防视觉穿透，那等于把星系当成实心球，
      //  属于建模错误，已移除。）
    }
    for (const s of this.activeDetails) {
      for (const b of s.detail.bodies) {
        // 未发现的天体不可捕获——发现（接近）本身就是交互的前提
        if (b._hidden) continue;
        // 星系核（超星系团的 galaxy 成员）本身是一个星系——多体集合，
        // 内部绝大部分是空的，穿过核区是物理正确的行为，不做碰撞捕获
        // （与"星团/星系不整体捕获"同一建模原则，§6.2）；它仍产生引力
        // 与渐进发现，只是没有实心碰撞体。
        if (b.type === 'galaxy') continue;
        // 母天体 + 二级成员一起检测；deco 装饰粒子（行星环）没有碰撞体——
        // 环是稀疏冰粒，穿过去是物理正确的行为
        const bodiesToCheck = b.children
          ? [b, ...b.children.filter((ch) => !ch.deco)]
          : [b];
        for (const body of bodiesToCheck) {
          const dx = body.pos[0] - pr.pos[0];
          const dy = body.pos[1] - pr.pos[1];
          const dz = body.pos[2] - pr.pos[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          // 碰撞半径 = 天体半径 + 小球半径（0.16，月亮级，与渲染一致）
          const hitR = body.radius + 0.16;
          if (pr.respawnGrace <= 0 && d < hitR) {
            const parent = this.seeds[body.parent];
            const isChild = body !== b;
            const typeLabel = body.type === 'star' ? '恒星'
              : body.type === 'planet' ? (isChild ? '卫星' : '行星')
              : body.type === 'galaxy' ? '星系核'
              : body.type === 'gas' ? '星云气体'
              : body.type === 'asteroid' ? '小行星'
              : '黑洞';
            const label = `${LEVEL_LABELS[parent.level] || '天体'}·${typeLabel}`;
            // 二级行星/卫星 = 大气烧蚀；星系核/黑洞成员 = 潮汐撕碎；恒星 = 汽化
            const deathType = (body.type === 'blackhole' || body.type === 'galaxy') ? 'tidal' : body.type === 'star' ? 'vaporize' : 'atmosphere';
            this._beginDeath(body, label, s.idx, deathType, Math.max(1.6, body.radius * 7));
            return;
          }
        }
      }
    }

    // 标签只反映真实物理状态：自由惯性飞行 / 接近某系统 / 深入某系统。
    if (this.time < GRAVITY_START + 0.6) {
      pr.label = '随大爆炸惯性飞行';
    } else {
      pr.nearestSystem = nearest;
      pr.nearestDist = nearestD;
      const ns = this.seeds[nearest];
      const R = ns ? this._systemRadius(ns) : 1;
      if (ns && nearestD < R * 0.55) pr.label = `深入${LEVEL_LABELS[ns.level] || '天体'}系统`;
      else if (ns && nearestD < R * 1.4) pr.label = `接近${LEVEL_LABELS[ns.level] || '天体'}系统`;
      else pr.label = '自由惯性航行';
    }
    if (pr.phase !== 'free') pr.phase = 'free';
  }
};
