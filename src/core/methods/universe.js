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
import { levelForSeed, finalLevelFor, LEVEL_LABELS, DEATH_VERBS, EVENT_LEVELS, EVENT_MESSAGES } from '../sim-shared.js';

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

  _generateFrontierSeed() {
    if (this.time - this.lastFrontierTime < FRONTIER_INTERVAL) return;
    const pr = this.probe;
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

    // ---- 类型：全档位加权（2026-09-02：不再只补大系统）----
    // 旧实现只补 medium/large/giant/nebula——航线上几乎没有小天体，而
    // 恒星系（detailR 14）、行星（detailR 5）这些真正能被看清、能发生
    // 引力交互的"近景"，全靠初始 24 个 small + 18 个 medium 匀给整条
    // 航线，越飞越空。现在按权重补全部档位：small 占多数（体量小、细节
    // 预算便宜、掠过频繁），large/giant 稀少（它们更适合留在远处当远景
    // 地标；且细节成员动辄数百，投太近会瞬间撑满 maxDetailBodies 预算）。
    const roll = Math.random();
    let klass;
    let def;
    if (roll < 0.40) {
      klass = 'small';
      def = CLASS_DEFS.find((d) => d.key === 'small');
    } else if (roll < 0.72) {
      klass = 'medium';
      def = CLASS_DEFS.find((d) => d.key === 'medium');
    } else if (roll < 0.92) {
      // 较常见的远景星系
      klass = 'large';
      def = CLASS_DEFS.find((d) => d.key === 'large');
    } else if (roll < 0.98) {
      // 罕见：超大质量黑洞
      klass = 'giant';
      def = CLASS_DEFS.find((d) => d.key === 'giant');
    } else {
      // 偶尔给点变化：远处的星云 / 行星种子
      klass = 'nebula';
      def = { key: 'nebula', massMin: 0.25, massMax: 0.85, durBase: 3.5, durSpan: 1.5 };
    }
    // ---- 投放距离/散乱角按天体尺度分级（2026-09-02 第二版）----
    // 第一版（统一 150~380 × scale）实测平均遭遇间隔仍 ~320 真实秒：
    // 散乱角 0.18 在 265 单位距离上的横向偏差 ≈ 48 单位，远大于行星
    // （detailR 5）/恒星系（14）/星团（30）的可遭遇半径，走廊档的
    // 小天体依然大多擦肩而过。现在按"可遭遇半径 ≈ 距离 × 散乱角"反推：
    //   · small（行星，detailR 5）：90~160 + 0.07 → 偏差 6~11，真正被经过
    //     （53~94 真实秒一次；下限 60→90：太近会让"刚重生就撞上"，2026-09-02）
    //   · medium（恒星/星团，14~30）：100~220 + 0.10 → 偏差 10~22
    //   · large（星系，115）：350~600 + 0.18 → 偏差 63~108 < 115，可读形态
    //   · giant（黑洞/巨星系）：450~750 + 0.18（体积大，远看才读得出形态）
    //   · nebula（星云，26）：150~300 + 0.10
    // 广域档（40%）保持 0.9 大散乱角：远景地标与纵深，不指望遭遇。
    const distRange = klass === 'small' ? [90, 160]
      : klass === 'medium' ? [100, 220]
      : klass === 'nebula' ? [150, 300]
      : klass === 'large' ? [350, 600]
      : [450, 750];
    const laneScatter = klass === 'small' ? 0.07
      : klass === 'medium' ? 0.10
      : 0.18;

    // ---- 投放方向：两档（航线走廊 + 广域散布）----
    // 旧实现统一用 0.28 的散乱角：在数百单位的投放距离上，横向偏移高达
    // 80~150 单位，远大于天体的可遭遇半径（恒星系 detailR 14、行星 5），
    // 绝大多数新结构只是"擦肩而过"——这才是宇宙显得空的直接原因。
    //   · 走廊档（60%）：散乱角按天体分级（见上），投在会被经过的航线上
    //   · 广域档（40%）：散乱角 0.9，作为远景地标与纵深（不指望遭遇）
    const corridor = Math.random() < 0.6;
    const scatterAmt = corridor ? laneScatter : 0.9;
    // 放在小球前方远处的位置，散乱角也放宽一点让它不全在正前方
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    let dir;
    if (sp > 2) {
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
    const pos = [
      pr.pos[0] + dir[0] * dist,
      pr.pos[1] + dir[1] * dist,
      pr.pos[2] + dir[2] * dist,
    ];

    // 重置为休眠暗物质晕。
    s.klass = klass;
    s.dir = dir;
    s.pos = pos;
    s.vel = [
      pr.vel[0] * 0.35 + (Math.random() - 0.5) * 1.2,
      pr.vel[1] * 0.35 + (Math.random() - 0.5) * 1.2,
      pr.vel[2] * 0.35 + (Math.random() - 0.5) * 1.2,
    ];
    s.mass = def.massMin + Math.random() * (def.massMax - def.massMin);
    s.duration = def.durBase + Math.random() * def.durSpan;
    // 投放即定型：新结构在远处就已完整存在，小球靠近只是"发现"
    s.birth = 0;
    s.awakened = true;
    s.growth = 1;
    s.willCollapse = klass === 'giant' ? Math.random() < 0.35 : false;
    s.level = finalLevelFor(klass, s.willCollapse);
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
      this.events.push({ time: this.time, text: `🔭 远方探测到${classLabels[klass]}结构（引力范围 ${s.influenceRadius.toFixed(0)}）` });
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
