// CosmicSimulation 的 universe 方法组（目录梳理：mixin 装配，方法体未改动）。
// 通过 Object.assign 挂到 prototype，方法内仍以 this 访问实例状态。
import {
  DYN_G, EPS2, N_PARTICLES, N_CLOUD_PARTICLES, N_EJECTA_PARTICLES,
  GRAVITY_START, GRAVITY_FULL, BASE_SPEED,
  SEED_R_MIN, SEED_R_MAX, EJECTA_SPEED_MIN, EJECTA_SPEED_MAX,
  PROBE_INITIAL_SPEED, PROBE_BIGBANG_SPEED, BIG_BANG_WALL, PROBE_GRAVITY_MULT,
  SEED_AWAKEN_RADIUS, FORMATION_SPACING,
  FRONTIER_INTERVAL, FRONTIER_DIST_MIN, FRONTIER_DIST_MAX,
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

  // 唤醒候选：小球速度比形成速度快，若同一时间只允许一个系统形成，
  // 多数种子会在门控期间被甩在身后，导致“沿途看不到天体”。
  // 因此允许最多三个系统并行形成（间隔很短），并且总是唤醒离小球最近的种子，
  // 保证被唤醒的是小球真正会路过的系统。
  _tryAwakenSeed() {
    let best = null;
    let bestD = SEED_AWAKEN_RADIUS;
    for (const s of this.seeds) {
      if (s.awakened) continue;
      const d = Math.hypot(
        s.pos[0] - this.probe.pos[0],
        s.pos[1] - this.probe.pos[1],
        s.pos[2] - this.probe.pos[2],
      );
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return;
    const formingCount = this.seeds.reduce((n, o) => n + (o.awakened && o.growth < 1 ? 1 : 0), 0);
    if (formingCount >= 3 || this.time - this.lastSeedAwakenTime < FORMATION_SPACING) return;
    best.awakened = true;
    best.birth = this.time;
    this.lastSeedAwakenTime = this.time;
  },

  _generateFrontierSeed() {
    if (this.time - this.lastFrontierTime < FRONTIER_INTERVAL) return;
    const pr = this.probe;
    // 回收远处仍然休眠的旧种子作为新结构；不需要过滤已绑定粒子（那是粒子的内部成员）。
    const candidates = this.seeds.filter((s) =>
      !s.awakened && !s.detail
      && Math.hypot(s.pos[0] - pr.pos[0], s.pos[1] - pr.pos[1], s.pos[2] - pr.pos[2]) > 350,
    );
    if (!candidates.length) return;
    // 选最远的休眠种子回收
    let s = candidates[0];
    let bestD = -1;
    for (const c of candidates) {
      const d = Math.hypot(c.pos[0] - pr.pos[0], c.pos[1] - pr.pos[1], c.pos[2] - pr.pos[2]);
      if (d > bestD) { bestD = d; s = c; }
    }

    // 宇宙很空：航线上一次只补一个「远处大系统」。小质量天体让初始暗物质晕自带，
    // 这里只补能在远距离就吸住小球的大结构，所以类型偏中 / 大 / 巨。
    const roll = Math.random();
    let klass;
    let def;
    if (roll < 0.45) {
      // 较常见的远景星系
      klass = 'large';
      def = CLASS_DEFS.find((d) => d.key === 'large');
    } else if (roll < 0.80) {
      klass = 'medium';
      def = CLASS_DEFS.find((d) => d.key === 'medium');
    } else if (roll < 0.95) {
      // 罕见：超大质量黑洞
      klass = 'giant';
      def = CLASS_DEFS.find((d) => d.key === 'giant');
    } else {
      // 偶尔给点变化：远处的星云 / 行星种子
      klass = 'nebula';
      def = { key: 'nebula', massMin: 0.25, massMax: 0.85, durBase: 3.5, durSpan: 1.5 };
    }

    // 放在小球前方远处的位置，散乱角也放宽一点让它不全在正前方
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    let dir;
    if (sp > 2) {
      const scatter = randomUnit(1);
      const bx = pr.vel[0] / sp + scatter[0] * 0.28;
      const by = pr.vel[1] / sp + scatter[1] * 0.28;
      const bz = pr.vel[2] / sp + scatter[2] * 0.28;
      const bl = Math.hypot(bx, by, bz) || 1;
      dir = [bx / bl, by / bl, bz / bl];
    } else {
      dir = randomUnit();
    }
    const dist = FRONTIER_DIST_MIN + Math.random() * (FRONTIER_DIST_MAX - FRONTIER_DIST_MIN);
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
    const classLabels = { nebula: '星云', small: '行星', medium: '恒星/星团', large: '星系', giant: '黑洞' };
    this.events.push({ time: this.time, text: `🔭 远方探测到${classLabels[klass]}结构（引力范围 ${s.influenceRadius.toFixed(0)}）` });
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
