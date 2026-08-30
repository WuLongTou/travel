// CosmicSimulation 的 gravity 方法组（目录梳理：mixin 装配，方法体未改动）。
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

export const gravityMethods = {
  // ---- 天体间万有引力（N-body 软化解算）----
  // 每对种子按 a = seedGravity × m_other / r² 互相吸引（方向指向对方），
  // 积分到 s.vel。性质：
  //   · 软化（SOFT=50²）：种子半径 30~50，近距离不产生奇点
  //   · 速度有界（90/s）：引力加速有界，极端情况不失控
  //   · 远场弱：默认 400 时 r>200 的加速度 <0.01/s²，Hubble 流（30~55/s）
  //     仍主导——不会全局坍缩；近距离（<100）大系统才互相可见地偏转
  _applySeedGravity(dt) {
    const G = this.config.seedGravity;
    if (G <= 0 || this.seeds.length < 2) return;
    const SOFT = 2500; // 50²
    for (let i = 0; i < this.seeds.length; i++) {
      const s1 = this.seeds[i];
      let ax = 0, ay = 0, az = 0;
      for (let j = 0; j < this.seeds.length; j++) {
        if (j === i) continue;
        const s2 = this.seeds[j];
        const dx = s2.pos[0] - s1.pos[0];
        const dy = s2.pos[1] - s1.pos[1];
        const dz = s2.pos[2] - s1.pos[2];
        const r2 = dx * dx + dy * dy + dz * dz + SOFT;
        const r = Math.sqrt(r2);
        const f = G * s2.mass / (r2 * r);
        ax += f * dx; ay += f * dy; az += f * dz;
      }
      s1.vel[0] += ax * dt;
      s1.vel[1] += ay * dt;
      s1.vel[2] += az * dt;
      const sp = Math.hypot(s1.vel[0], s1.vel[1], s1.vel[2]);
      if (sp > 90) {
        const k = 90 / sp;
        s1.vel[0] *= k; s1.vel[1] *= k; s1.vel[2] *= k;
      }
    }
  }
};
