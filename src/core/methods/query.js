// CosmicSimulation 的 query 方法组（目录梳理：mixin 装配，方法体未改动）。
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
    let best = Infinity;
    for (const s of this.seeds) {
      const dx = s.pos[0] - x, dy = s.pos[1] - y, dz = s.pos[2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
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
