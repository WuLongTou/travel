// CosmicSimulation 的 universe 方法组（目录梳理：mixin 装配，方法体未改动）。
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

export const universeMethods = {
  _assignMembers(force = false) {
    if (!force && Math.random() > 0.35) return;
    for (const s of this.seeds) s.members.length = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.bound) {
        if (p.seed >= 0) this.seeds[p.seed].members.push(i);
      } else {
        const b = this._nearestSeed(p.pos);
        p.seed = b;
        if (b >= 0) this.seeds[b].members.push(i);
      }
    }
  },

  _updateSeedFormation(s) {
    // 天体已定型：宇宙初始化时结构就已存在（§3），小球靠近只是"发现"
    // 细节。growth 恒为 1，level 保持最终形态——不再有"路过才生成"的
    // 演化动画。引力随 gravityStrength 平滑生效（开场叙事保留）。
    s.growth = 1;
  },

  // （_tryAwakenSeed 已删除：详情系统由 _manageDetails 按"接近 1.4R"
  //  直接创建/卸载，唤醒门控是旧形成动画体系的遗留，无人调用。）

  // ---- "下一站"保险（2026-09-03 新增）----
  // 小球在大尺度结构的合引力牵引下，航向持续弯曲（20 秒可转 10°+，
  // 实测侧向加速度 ~0.2-0.4/s²——真实物理：纤维/走廊结构的整体引力
  // 在拉它）。沿"当前速度方向"投放的目标到达时全部偏出，一次偏转就
  // 制造上百秒的遭遇空窗。因此保险机制建立在**预测航迹**上：
  //   _predictProbePath 用当前引力场前瞻积分小球未来 20s 的轨迹
  //   （种子位置随已知速度线性外推——种子准静止、无加速，外推准确）；
  //   _hasNextWaypoint 沿预测轨迹逐点检查是否有种子落在可遭遇半径
  //   （1.4×detailR）内；没有则把保险目标**直接投放在预测轨迹上**
  //   （~250 单位处，完全静止），航线怎么弯它都在路上——叙事上即
  //   "宇宙网纤维上总连着下一个节点"。
  _predictProbePath(horizon = 20, dt = 1.0) {
    const pr = this.probe;
    const pos = [pr.pos[0], pr.pos[1], pr.pos[2]];
    const vel = [pr.vel[0], pr.vel[1], pr.vel[2]];
    const gG = this.config.gravityG;
    const mS = this.config.bodyMassScale;
    const gs = this.gravityStrength;
    const path = [[pos[0], pos[1], pos[2], 0]];
    const steps = Math.round(horizon / dt);
    for (let i = 1; i <= steps; i++) {
      const t = i * dt;
      let ax = 0, ay = 0, az = 0;
      if (gs > 0.001) {
        for (const s of this.seeds) {
          // 种子随已知速度线性外推（准静止，无加速）
          const sx = s.pos[0] + s.vel[0] * t;
          const sy = s.pos[1] + s.vel[1] * t;
          const sz = s.pos[2] + s.vel[2] * t;
          const dx = sx - pos[0];
          const dy = sy - pos[1];
          const dz = sz - pos[2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < 1e-6) continue;
          // 衰减律与 _updateProbe 一致（gravityParamsFor 统一取参：
          // 集合系统延展 1/r、单天体点质量）
          const gp = gravityParamsFor(s.level);
          const f = gG * PROBE_GRAVITY_MULT * (s.mass * gp.mult * mS) / Math.pow(r2 + gp.soft2, gp.invExp) * gs;
          ax += f * dx; ay += f * dy; az += f * dz;
        }
      }
      vel[0] += ax * dt; vel[1] += ay * dt; vel[2] += az * dt;
      pos[0] += vel[0] * dt; pos[1] += vel[1] * dt; pos[2] += vel[2] * dt;
      path.push([pos[0], pos[1], pos[2], t]);
    }
    return path;
  },

  // 缓存的预测路径（每秒重算一次——路径检查每步都要用，前瞻积分
  // 20 步 × 57 种子不宜逐帧全价重算）
  _waypointPathCache() {
    if (!this._wpCache || this.time - this._wpCache.time > 1) {
      this._wpCache = { time: this.time, path: this._predictProbePath() };
    }
    return this._wpCache.path;
  },

  _hasNextWaypoint() {
    const pr = this.probe;
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    if (sp < 2) return true; // 低速（系统内机动）不判航线
    const path = this._waypointPathCache();
    for (const p of path) {
      const t = p[3];
      if (t < 3) continue; // 贴身段不算"下一站"
      for (const s of this.seeds) {
        const sx = s.pos[0] + s.vel[0] * t;
        const sy = s.pos[1] + s.vel[1] * t;
        const sz = s.pos[2] + s.vel[2] * t;
        const dx = sx - p[0], dy = sy - p[1], dz = sz - p[2];
        const reach = Math.max(10, (this._detailRadius(s) || 5) * 1.4);
        if (dx * dx + dy * dy + dz * dz < reach * reach) return true;
      }
    }
    return false;
  },

  _generateFrontierSeed() {
    const pr = this.probe;
    // 重生喘息期（2026-09-03）：刚重生的数秒内不投放——否则新目标
    // 恰好落在重生路径正前方，小球以重生速度一头撞进下一个系统，
    // 形成"死亡→重生→立刻又死"的连环。喘息 5 秒后恢复投放。
    if (pr.respawnGrace > 5) return;
    // 有"下一站"时按 FRONTIER_INTERVAL 节流投放（多样性与远景）；
    // 没有（航线被偏转后前方空窗）则立即触发一次"保险投放"。
    const needWaypoint = !this._hasNextWaypoint();
    if (!needWaypoint && this.time - this.lastFrontierTime < FRONTIER_INTERVAL) return;
    // 回收"已被甩在身后/已远离"的休眠种子作为新结构；不需要过滤已绑定
    // 粒子（那是粒子的内部成员）。
    // 2026-09-02 修复两个导致"动态生成从未工作"的根因：
    //   ① 旧候选要求 !s.awakened，但初始种子与 frontier 投放的种子全部
    //      awakened=true（sim.js:263 / 本文件:179）→ 候选池恒为空，
    //      _generateFrontierSeed 实际从未投放过任何新结构——遭遇全靠
    //      初始 57 个种子，越飞越空。去掉该条件（种子只要无活跃细节、
    //      距离够远就允许被回收重投）。
    //   ② 回收距离阈值 350 → 250，并加"在小球身后"方向判断：走廊档
    //      种子投在 60~220 单位，小球掠过它们后它们留在 100~300 区间，
    //      旧阈值让它们永远进不了回收池，槽位被"历史遗迹"占满后生成
    //      停摆；同时避免误回收"前方尚未谋面"的结构（点积 < 0 = 已
    //      被小球甩在身后）。
    const pvx = pr.vel[0], pvy = pr.vel[1], pvz = pr.vel[2];
    const pvl = Math.hypot(pvx, pvy, pvz) || 1;
    const candidates = this.seeds.filter((s) => {
      if (s.detail) return false;
      const dx = s.pos[0] - pr.pos[0];
      const dy = s.pos[1] - pr.pos[1];
      const dz = s.pos[2] - pr.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d <= 250) return false;
      // 必须在小球速度方向的"身后"（点积为负），避免回收前方未谋面的结构
      return (dx * pvx + dy * pvy + dz * pvz) / (d * pvl) < 0;
    });
    if (!candidates.length) return;
    // 选最远的休眠种子回收
    let s = candidates[0];
    let bestD = -1;
    for (const c of candidates) {
      const d = Math.hypot(c.pos[0] - pr.pos[0], c.pos[1] - pr.pos[1], c.pos[2] - pr.pos[2]);
      if (d > bestD) { bestD = d; s = c; }
    }

    // ---- 类型：三景深加权（2026-09-03 重排，配合镜头观赏性整改）----
    // 近景遭遇（走廊档，会被航线经过）：small 38% + medium 30%——
    // 恒星系/行星这些能被看清、能发生引力交互的近景是主内容；
    // 中景地标（可读结构 250~720）：nebula 8% + large 4%——星云的
    // 彩色云体、星系的旋臂轮廓在小球几百单位外依然可读，是画面
    // 中景的层次（此前中景真空：星云仅 2%、星系 900+ 太远）；
    // 远景地标（光点/光斑）：large 14% + giant 4%。
    // "下一站"保险投放以 medium 为主（可遭遇半径 19.6~42），混入 25%
    // 的 small（行星系用更近的路径点，短程预测残差小于其可遭遇半径）。
    let klass;
    let def;
    let midScene = false; // 中景档标记（距离分级用）
    if (needWaypoint) {
      if (Math.random() < 0.25) {
        klass = 'small';
        def = CLASS_DEFS.find((d) => d.key === 'small');
      } else {
        klass = 'medium';
        def = CLASS_DEFS.find((d) => d.key === 'medium');
      }
    } else {
      const roll = Math.random();
      if (roll < 0.38) {
        klass = 'small';
        def = CLASS_DEFS.find((d) => d.key === 'small');
      } else if (roll < 0.68) {
        klass = 'medium';
        def = CLASS_DEFS.find((d) => d.key === 'medium');
      } else if (roll < 0.76) {
        // 中景星云：可读的彩色云体
        klass = 'nebula';
        def = { key: 'nebula', massMin: 0.25, massMax: 0.85, durBase: 3.5, durSpan: 1.5 };
        midScene = true;
      } else if (roll < 0.80) {
        // 中景星系：旋臂轮廓可读
        klass = 'large';
        def = CLASS_DEFS.find((d) => d.key === 'large');
        midScene = true;
      } else if (roll < 0.94) {
        // 远景星系：光斑地标
        klass = 'large';
        def = CLASS_DEFS.find((d) => d.key === 'large');
      } else if (roll < 0.98) {
        // 罕见：超大质量黑洞
        klass = 'giant';
        def = CLASS_DEFS.find((d) => d.key === 'giant');
      } else {
        // 远处星云点缀
        klass = 'nebula';
        def = { key: 'nebula', massMin: 0.25, massMax: 0.85, durBase: 3.5, durSpan: 1.5 };
      }
    }
    // ---- 投放距离/散乱角按天体尺度分级（2026-09-03 真实比例版）----
    // 核心原则：系统间距与系统尺度成比例——星系（detailR 115、直径 230）
    // 的投放距离必须 ≥ 数倍直径（真实宇宙里星系间距是直径的 10~30 倍，
    // 银河系到仙女座 25 倍），小天体按"可遭遇半径 ≈ 距离 × 散乱角 <
    // detailR × 1.4"反推——散乱角要小到让走廊档投放真正被航线经过：
    //   · small（行星，detailR 5，可遭遇 7）：100~240 + 0.045 → 偏差 4.5~11
    //   · medium（恒星/星团，14~30）：160~320 + 0.06 → 偏差 9.6~19 < 19.6
    //   · nebula（星云，26）：200~380 + 0.08
    //   · large（星系，115）：900~1600 —— 4~7 倍星系直径，远景地标
    //   · giant（黑洞/巨星系）：1000~1800 —— 极罕见，极空旷处
    // 广域档（35%）保持 0.9 大散乱角：远景地标与纵深，不指望遭遇。
    const distRange = klass === 'small' ? [100, 240]
      : klass === 'medium' ? [160, 320]
      : klass === 'nebula' ? (midScene ? [260, 440] : [200, 380])
      : klass === 'large' ? (midScene ? [480, 720] : [900, 1600])
      : [1000, 1800];
    const laneScatter = klass === 'small' ? 0.045
      : klass === 'medium' ? 0.06
      : 0.12;

    // ---- 投放方向：两档（航线走廊 + 广域散布）----
    //   · 走廊档（65%）：散乱角收紧到"横向偏差 < 可遭遇半径"，投在
    //     会被航线经过的位置（保险档不走这里——落点直接取预测航迹）
    //   · 广域档（35%）：散乱角 0.9，作为远景地标与纵深（不指望遭遇）
    const corridor = Math.random() < 0.65;
    const scatterAmt = corridor ? laneScatter : 0.9;
    // 放在小球前方远处的位置。投放点必须通过隔离校验（距所有现有种子
    // ≥ 双方隔离半径之和，§ISOLATION_RADII）——常规投放 8 次重试，
    // 都不满足就放弃（下个 FRONTIER_INTERVAL 再试）；保险投放 12 次、
    // 距离逐次推远（150+30k，近场邻居挡住走廊时拉远即可挣脱隔离
    // 约束），极端拥挤时同样放弃、下一步重试（小球在前进，几何在变）。
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    let dir = randomUnit();
    let pos = null;
    const willCollapse = klass === 'giant' ? Math.random() < 0.35 : false;
    const newLevel = finalLevelFor(klass, willCollapse);
    // ---- 掠过偏移（2026-09-03）：目标不落在航线正中 ----
    // 落在正中意味着小球每次都穿过系统核心——恒星/行星都在核心附近的
    // 轨道上，穿越核心=高概率撞上具体成员，形成连续死亡。真实宇宙里
    // 航线几乎总是"掠过"：恒星的碰撞截面只占恒星系的极小部分。把落点
    // 横向偏移 detailR×(0.9~1.8)——小球从系统边缘掠过（引力弯曲 +
    // 渐进发现边缘成员），部分进入 1.4R 触发细节、部分仅引力交互。
    // 大结构（detailR ≥ 50，星系/超星系团）不偏移：穿越星系看旋臂
    // 本来就是内容，且其成员不整体捕获。
    const detailRNew = this._detailRadius({ level: newLevel }) || 5;
    const grazeOffset = detailRNew < 50 ? detailRNew * (0.55 + Math.random() * 0.95) : 0;
    const addGraze = (base, anchorDir) => {
      if (grazeOffset <= 0) return base;
      // 垂直于锚方向的随机横向偏移
      const n = randomUnit(1);
      const dot = n[0] * anchorDir[0] + n[1] * anchorDir[1] + n[2] * anchorDir[2];
      let ox = n[0] - anchorDir[0] * dot;
      let oy = n[1] - anchorDir[1] * dot;
      let oz = n[2] - anchorDir[2] * dot;
      const ol = Math.hypot(ox, oy, oz);
      if (ol < 1e-4) return base;
      return [
        base[0] + ox / ol * grazeOffset,
        base[1] + oy / ol * grazeOffset,
        base[2] + oz / ol * grazeOffset,
      ];
    };
    const velDir = sp > 1e-3 ? [pr.vel[0] / sp, pr.vel[1] / sp, pr.vel[2] / sp] : [1, 0, 0];
    const attempts = needWaypoint ? 10 : 8;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (needWaypoint) {
        // 保险档：落点直接取**预测航迹**上的路径点（再加掠过偏移）——
        // 航线怎么弯它都在路上；隔离被挡时逐步取更远的路径点。
        // medium 用 t≈8~17s（距离 ~200-440），small 用更近的 t≈5~14s。
        // 投放后的目标完全静止（vel=0，见下），预测即落点。
        const path = this._waypointPathCache();
        const baseIdx = klass === 'small' ? 5 : 8;
        const pi = Math.min(path.length - 1, baseIdx + attempt);
        const cand = addGraze([path[pi][0], path[pi][1], path[pi][2]], velDir);
        if (this._isPositionIsolated(cand, newLevel, s.idx)) { pos = cand; break; }
        continue;
      }
      if (sp > 2) {
        // 常规档：沿当前航向 + 散乱角（走廊档收紧到可遭遇半径内）
        const scatter = randomUnit(1);
        const bx = pr.vel[0] / sp + scatter[0] * scatterAmt;
        const by = pr.vel[1] / sp + scatter[1] * scatterAmt;
        const bz = pr.vel[2] / sp + scatter[2] * scatterAmt;
        const bl = Math.hypot(bx, by, bz) || 1;
        dir = [bx / bl, by / bl, bz / bl];
      } else {
        dir = randomUnit();
      }
      const dist = (distRange[0] + Math.random() * (distRange[1] - distRange[0]))
        * (corridor ? 1 : 1.6);
      const base = [
        pr.pos[0] + dir[0] * dist,
        pr.pos[1] + dir[1] * dist,
        pr.pos[2] + dir[2] * dist,
      ];
      const cand = corridor ? addGraze(base, dir) : base;
      if (this._isPositionIsolated(cand, newLevel, s.idx)) { pos = cand; break; }
    }
    if (!pos) return; // 附近已拥挤：不硬塞，下一步/下个投放窗口再试

    // 重置为休眠暗物质晕。本动速度与初始种子同档：准静止（见 sim._init）；
    // 保险档目标完全静止（vel=0）——预测航迹的落点就是它此后的位置，
    // 不会因自身漂移再次错开。
    s.klass = klass;
    s.dir = dir;
    s.pos = pos;
    s.vel = needWaypoint
      ? [0, 0, 0]
      : [
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2,
      ];
    s.mass = def.massMin + Math.random() * (def.massMax - def.massMin);
    s.duration = def.durBase + Math.random() * def.durSpan;
    // 投放即定型：新结构在远处就已完整存在，小球靠近只是"发现"
    s.birth = 0;
    s.awakened = true;
    s.growth = 1;
    s.willCollapse = willCollapse;
    s.level = newLevel;
    s._layout = null;      // 布局随新身份重新生成
    s.budgetNotified = false;
    // 引力影响范围要够大：这样即使系统离得很远也会把小球拉过去
    s.influenceRadius = 6.0 + s.mass * 1.6;
    s.captureRate = 0.20 + s.mass * 0.10;
    // 解除旧气体云的临时归属，之后 `_assignMembers` 会重新分配。
    for (const i of s.members) {
      if (this.particles[i] && !this.particles[i].bound) this.particles[i].seed = -1;
    }
    s.members.length = 0;
    s.lastVisit = -Infinity;
    s.axis = randomUnit();
    const u0 = Math.abs(s.axis[0]) < 0.85 ? [1, 0, 0] : [0, 1, 0];
    const dot = u0[0] * s.axis[0] + u0[1] * s.axis[1] + u0[2] * s.axis[2];
    s.u = [
      u0[0] - s.axis[0] * dot,
      u0[1] - s.axis[1] * dot,
      u0[2] - s.axis[2] * dot,
    ];
    const ul = Math.hypot(s.u[0], s.u[1], s.u[2]) || 1;
    s.u[0] /= ul; s.u[1] /= ul; s.u[2] /= ul;
    s.v = [
      s.axis[1] * s.u[2] - s.axis[2] * s.u[1],
      s.axis[2] * s.u[0] - s.axis[0] * s.u[2],
      s.axis[0] * s.u[1] - s.axis[1] * s.u[0],
    ];
    s.spinSign = Math.random() < 0.5 ? -1 : 1;
    // 事件降噪（2026-09-02）：frontier 现在每 2.5 物理秒投放一次，
    // 若每次播报会把事件日志刷成流水账。只播报罕见大结构（星系/黑洞/
    // 星云），且全局节流（ANNOUNCE_GAP 物理秒内最多一条），避免
    // toast 排队刷屏。行星/恒星/星团是航线常态，静默投放。
    const ANNOUNCE_GAP = 12; // 物理秒：600s 内最多 ~50 条，且天然稀疏
    if ((klass === 'large' || klass === 'giant' || klass === 'nebula')
      && this.time - (this._lastFrontierAnnounce || -Infinity) >= ANNOUNCE_GAP) {
      this._lastFrontierAnnounce = this.time;
      const classLabels = { nebula: '星云', small: '行星', medium: '恒星/星团', large: '星系', giant: '黑洞' };
      this.events.push({ time: this.time, text: `🔭 远方探测到${classLabels[klass]}结构` });
    }
    this.lastFrontierTime = this.time;
  },

  _seededRandom(seedInt) {
    let a = (seedInt + 1) * 2654435761 >>> 0;
    return () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  }
};
