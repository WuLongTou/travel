// CosmicSimulation 的 details 方法组（目录梳理：mixin 装配，方法体未改动）。
// 通过 Object.assign 挂到 prototype，方法内仍以 this 访问实例状态。
import {
  EPS2, N_PARTICLES, N_CLOUD_PARTICLES, N_EJECTA_PARTICLES,
  GRAVITY_START, GRAVITY_FULL, BASE_SPEED,
  SEED_R_MIN, SEED_R_MAX, EJECTA_SPEED_MIN, EJECTA_SPEED_MAX,
  PROBE_INITIAL_SPEED, PROBE_BIGBANG_SPEED, BIG_BANG_WALL, PROBE_GRAVITY_MULT,
  SEED_AWAKEN_RADIUS, FORMATION_SPACING,
  FRONTIER_INTERVAL,
  REVEAL_RADIUS, REVEAL_SCALE, DISCOVERY_PER_STEP, COLLECTION_LEVELS,
  CLASS_DEFS, PROBE_IGM_DRAG, PROBE_RESPAWN_SPEED, PROBE_MAX_SPEED,
} from '../config.js';
import { randomUnit, clamp01, smoothstep, easeInOut, orbitPolar, hash01 } from '../utils.js';
import { levelForSeed, finalLevelFor, LEVEL_LABELS, DEATH_VERBS, EVENT_LEVELS, EVENT_MESSAGES } from '../sim-shared.js';

export const detailsMethods = {
  _manageDetails(dt) {
    this.activeDetails.length = 0;
    const pr = this.probe;
    const cfg = this.config;
    // ---- 性能预算（§9.5）----
    // tier>=2：主动收缩——把最远的细节系统卸载到上限一半，体数预算立即减半
    // 预算提示全局去重（2026-09-02）：卸载/重建循环会让 budgetNotified
    // 反复重置，实测刷 56 条"已达预算上限"。整局只提示一次更符合直觉。
    if (cfg.qualityTier >= 2) {
      const withDetail = this.seeds.filter((s) => s.detail);
      const cap = Math.max(1, Math.floor(cfg.maxDetailSystems / 2));
      if (withDetail.length > cap) {
        withDetail.sort((a, b) => {
          const db = Math.hypot(b.pos[0] - pr.pos[0], b.pos[1] - pr.pos[1], b.pos[2] - pr.pos[2]);
          const da = Math.hypot(a.pos[0] - pr.pos[0], a.pos[1] - pr.pos[1], a.pos[2] - pr.pos[2]);
          return db - da; // 最远的先卸载
        });
        for (let i = 0; i < withDetail.length - cap; i++) withDetail[i].detail = null;
      }
    }
    let systemsWithDetail = 0;
    let totalBodies = 0;
    for (const s of this.seeds) {
      const r = this._detailRadius(s);
      if (r <= 0) continue;
      // 远景成员点云的自转相位：与 detail 成员共用
      // "布局起始角 + spin × speed" 的公式，交接瞬间位置不跳变
      s._layoutSpin = (s._layoutSpin || 0) + dt;
      const d = Math.hypot(pr.pos[0] - s.pos[0], pr.pos[1] - s.pos[1], pr.pos[2] - s.pos[2]);
      // 接近到 1.4R 才创建真实 detail 天体；更远处由远景成员点云表达
      if (!s.detail && d < r * 1.4) {
        // 预算检查（2026-09-02 修正）：此前在创建后才累计 totalBodies，
        // 一个 500 体的星系创建后，本循环后续的小系统还能继续创建，
        // 峰值实测 1781/1100，远超 maxDetailBodies=1000。现在创建前
        // 先按确定性布局预估本次占用（_memberLayout 是懒计算且与创建
        // 共享同一份布局，长度即创建后的 bodies 数），超了就直接保持
        // 远景表示，从根上防止超预算。
        const estBodies = s._layout ? s._layout.length : this._memberLayout(s)?.length || 0;
        const overBudget = cfg.qualityTier >= 1
          || systemsWithDetail >= cfg.maxDetailSystems
          || totalBodies + estBodies > cfg.maxDetailBodies;
        if (overBudget) {
          // tier>=1 是持续状态不提示；预算上限触发时整局提示一次
          if (cfg.qualityTier < 1 && !this._budgetNotified) {
            this._budgetNotified = true;
            this.events.push({ time: this.time, text: `⚙️ 已达细节预算上限（${cfg.maxDetailSystems} 系统 / ${cfg.maxDetailBodies} 天体），远处系统保持远景表示` });
          }
          continue;
        }
        this._ensureDetailSystem(s);
      }
      if (s.detail) {
        // 离开太远就释放；下次接近重新创建（已发现记忆随之重置，
        // 远景成员点云接管"它依然是一群天体"的表达）
        if (d > r * 2.4) {
          s.detail = null;
          continue;
        }
        this._updateDetailBodies(s, dt);
        // 渐进发现：小球靠近哪个成员，哪个成员才从远景光点升级为真实天体
        this._revealMembers(s, pr);
        this._updateSubSystems(s);
        this.activeDetails.push(s);
        systemsWithDetail += 1;
        totalBodies += s.detail.bodies.length;
      }
    }
    // ---- 硬上限收尾（2026-09-02）：任何时刻总细节体数不超过预算 ----
    // 创建前预估（见上）只能防止"单次创建超预算"，但多个已创建系统同时
    // 处于 <2.4R 活跃区时总和仍可能超（如两个 500 体星系 + 星团同时活跃）。
    // 这里按距离排序，把最远的系统整体卸载，直到总占用 ≤ 上限——
    // "近处的优先、远处的让位"，游戏式加载的直觉。
    if (totalBodies > cfg.maxDetailBodies && this.activeDetails.length > 1) {
      this.activeDetails.sort((a, b) => {
        const da = Math.hypot(a.pos[0] - pr.pos[0], a.pos[1] - pr.pos[1], a.pos[2] - pr.pos[2]);
        const db = Math.hypot(b.pos[0] - pr.pos[0], b.pos[1] - pr.pos[1], b.pos[2] - pr.pos[2]);
        return db - da; // 最远的排前面
      });
      let used = totalBodies;
      for (const s of this.activeDetails) {
        if (used <= cfg.maxDetailBodies) break;
        used -= s.detail.bodies.length;
        s.detail = null;
      }
      // 重建 activeDetails：被卸载的已从数组移除
      this.activeDetails = this.activeDetails.filter((s) => s.detail);
    }
    // 在小球前方动态补充新的休眠系统，让航线可以无限延伸。
    this._generateFrontierSeed();
  }
};
