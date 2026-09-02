// CosmicSimulation 的 query 方法组（目录梳理：mixin 装配，方法体未改动）。
// 通过 Object.assign 挂到 prototype，方法内仍以 this 访问实例状态。
import {
  EPS2, N_PARTICLES, N_CLOUD_PARTICLES, N_EJECTA_PARTICLES,
  GRAVITY_START, GRAVITY_FULL, BASE_SPEED,
  SEED_R_MIN, SEED_R_MAX, EJECTA_SPEED_MIN, EJECTA_SPEED_MAX,
  PROBE_INITIAL_SPEED, PROBE_BIGBANG_SPEED, BIG_BANG_WALL, PROBE_GRAVITY_MULT,
  SEED_AWAKEN_RADIUS, FORMATION_SPACING,
  FRONTIER_INTERVAL, ISOLATION_RADII,
  REVEAL_RADIUS, REVEAL_SCALE, DISCOVERY_PER_STEP, COLLECTION_LEVELS,
  CLASS_DEFS, PROBE_DRAG_LEGACY, PROBE_IGM_DRAG, PROBE_RESPAWN_SPEED, PROBE_MAX_SPEED,
} from '../config.js';
import { randomUnit, clamp01, smoothstep, easeInOut, orbitPolar, hash01 } from '../utils.js';
import { levelForSeed, finalLevelFor, LEVEL_LABELS, DEATH_VERBS, EVENT_LEVELS, EVENT_MESSAGES } from '../sim-shared.js';

export const queryMethods = {
  _nearestSeed(pos) {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < this.seeds.length; j++) {
      const s = this.seeds[j];
      const dx = s.pos[0] - pos[0];
      const dy = s.pos[1] - pos[1];
      const dz = s.pos[2] - pos[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD) { bestD = d2; best = j; }
    }
    return best;
  },

  // 到最近天体系统的距离（虫洞逃逸安全校验用）
  _distanceToNearestSeed(x, y, z) {
    return this._nearestSeedInfo(x, y, z).dist;
  },

  // 最近种子的完整信息（距离 + 种子对象）——虫洞落点选"最空旷方向"、
  // 出射方向背离最近天体时都需要知道"最近的是谁"
  _nearestSeedInfo(x, y, z) {
    let best = null, bestD = Infinity;
    for (const s of this.seeds) {
      const dx = s.pos[0] - x, dy = s.pos[1] - y, dz = s.pos[2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD) { bestD = d2; best = s; }
    }
    return { seed: best, dist: bestD === Infinity ? Infinity : Math.sqrt(bestD) };
  },

  // 系统隔离半径（§ISOLATION_RADII）：任意两个系统中心的间距下限。
  // 与天体尺度（detailRadius）成比例——星系级 480（≈4 倍星系直径的
  // 单侧距离），行星系 45。用于初始分布与 frontier 投放的最小间距
  // 拒绝采样，保证"系统之间隔着大片空旷"，而不是扎堆。
  _isolationRadius(s) {
    return ISOLATION_RADII[s.level] || 60;
  },

  // 位置是否满足隔离约束：距所有现有种子 ≥ 双方隔离半径之和
  // （excludeIdx 用于种子"搬家"时排除它自己）
  _isPositionIsolated(pos, level, excludeIdx = -1) {
    const iso = ISOLATION_RADII[level] || 60;
    for (const s of this.seeds) {
      if (s.idx === excludeIdx) continue;
      const dx = s.pos[0] - pos[0], dy = s.pos[1] - pos[1], dz = s.pos[2] - pos[2];
      const need = iso + (ISOLATION_RADII[s.level] || 60);
      if (dx * dx + dy * dy + dz * dz < need * need) return false;
    }
    return true;
  },

  // 系统本体半径（影响相机绕行窗口、捕获与远景表达），与 detailRadius 同阶梯：
  // 集合系统的尺度远大于其成员——星系是庞然大物，恒星之间隔着"星际距离"。
  _systemRadius(s) {
    if (s.level === 'blackhole') return 13 + s.mass * 1.5;
    if (s.level === 'supercluster') return 34 + s.mass * 4.5;
    if (s.level === 'galaxy') return 30 + s.mass * 5.0;
    if (s.level === 'cluster') return 11 + s.mass * 1.4;
    if (s.level === 'star') return 3.2 + s.mass * 0.5;
    if (s.level === 'planet') return 1.6 + s.mass * 0.4;
    if (s.level === 'dust' || s.level === 'void') return 9 + s.mass * 2.4;
    return 1.6;
  },

  // 捕获半径：只有"单天体"（星尘云/行星/恒星）才有捕获范围
  // 星团/星系/超星系团/黑洞都是多体集合，捕获由其内部成员负责
  _captureRadius(s) {
    // 半径倍率（UI 可调）直接缩放捕获范围：调大更容易撞上天体
    const rs = this.config.bodyRadiusScale || 1;
    if (s.level === 'void' || s.level === 'dust') return 0;
    if (s.level === 'star') return (0.20 + s.mass * 0.06) * rs;
    if (s.level === 'planet') return (0.09 + s.mass * 0.04) * rs;
    // cluster / galaxy / supercluster / blackhole: 集合，由内部成员捕获
    return 0;
  },

  // 细节半径 = "系统本体尺度"的层级阶梯（尊重宇宙尺度常识）：
  //   行星系 5 < 恒星系 14 < 星云 26 < 星团 30（球状星团本来就密集）
  //   < 黑洞系统 36（核球恒星紧密绕行）< 超星系团 100 < 星系 115。
  // 星系是庞然大物：直径 130+，穿越要 ~80 屏幕秒；恒星平均间距 ~5 单位，
  // 是恒星显示尺寸的 10~30 倍——"星际距离"。星团/黑洞保持致密，
  // 与星系的稀疏形成层级对比（真实宇宙正是如此）。
  _detailRadius(s) {
    if (s.level === 'supercluster') return 100;
    if (s.level === 'galaxy') return 115;
    if (s.level === 'blackhole') return 36;
    if (s.level === 'cluster') return 30;
    if (s.level === 'star') return 14;
    if (s.level === 'dust') return 26;
    if (s.level === 'planet') return 5;
    if (s.level === 'void') return 22;
    return 0;
  }
};
