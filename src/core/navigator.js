// 宇宙导航：6 个尺度层 = 同一宇宙的不同缩放级别（从小到大）
//   index 0=solar … 5=cosmos
//   zoomIn  (下潜：进入更小尺度)   index-1
//   zoomOut (浮升：退到更大尺度)   index+1
// 自动 LOD 跃迁：基于飞船与可下潜实体的距离自动触发尺度切换
import { WORLD_DEFS, WORLD_BY_ID } from '../content/schema.js';
import { worldFactories, LAYER_CHAIN, CHAIN_INDEX } from '../content/worlds.js';

export class Navigator {
  constructor(engine, probe, clock) {
    this.engine = engine;
    this.probe = probe;
    this.clock = clock;
    this.world = null;
    this.idx = 0; // 当前层在 CHAIN 中的位置（0=solar…5=cosmos）
    // 每层记忆的观测点（离开时存，回来恢复）→ 让来回缩放保持熟悉视角
    this.anchors = {};
    this.diveCandidate = null;
    this.onWorldChanged = null;
    this._busy = false;
    // 自动跃迁冷却：避免在边界处反复跳转
    this._autoCooldown = 0;
  }

  get worldId() { return this.world ? this.world.id : null; }

  async enter(worldId, opts = {}) {
    const idx = CHAIN_INDEX[worldId];
    if (idx === undefined) throw new Error('未注册世界: ' + worldId);
    if (this.world) {
      this.anchors[this.world.id] = { pos: this.probe.pos.slice(), dist: this.engine.chaseCam.followDist };
    }
    const world = await worldFactories[worldId]();
    const prevAnchor = this.anchors[worldId];
    const useAnchor = opts.keepAnchor && prevAnchor;
    const spawn = useAnchor ? prevAnchor.pos : (opts.spawn || world.spawn);
    const dist = useAnchor ? prevAnchor.dist : (opts.dist || world.viewDist);
    this.probe.bindWorld(world, spawn);
    this.world = world;
    this.idx = idx;
    this.engine.chaseCam.followDist = dist;
    // 相机：从观测位看向「该层的兴趣中心」（多数世界 spawn 即兴趣点附近）
    const lookAt = opts.lookAt || world.spawnLookAt || spawn;
    // 探测球朝向必须同步看向兴趣中心：chase 相机每帧由探测球朝向推导，
    // 否则会沿用上一层离开时的朝向，进入构图随机
    this.probe.lookTowards(lookAt);
    this.engine.chaseCam.snapTo(
      [spawn[0], spawn[1], spawn[2]],
      [lookAt[0], lookAt[1], lookAt[2]],
    );
    this.clock.rate = Math.min(this.clock.rate, world.timeScaleMax || Infinity);
    // 跃迁后设置 2 秒冷却
    this._autoCooldown = 2.0;
    if (this.onWorldChanged) this.onWorldChanged(world, idx);
  }

  // 放大一档（到更小尺度）：默认到目标层默认观测位
  async zoomIn() {
    if (this.idx <= 0) return;
    const target = LAYER_CHAIN[this.idx - 1];
    await this._guard(() => this.enter(target));
  }
  // 缩小一档（到更大尺度）
  async zoomOut() {
    if (this.idx >= LAYER_CHAIN.length - 1) return;
    const target = LAYER_CHAIN[this.idx + 1];
    await this._guard(() => this.enter(target, { keepAnchor: true }));
  }
  // 下潜到目标实体（world 内声明的 dive.toWorld + dive.at）
  async diveInto(entity) {
    const dive = entity.dive;
    if (!dive) return;
    const target = dive.toWorld;
    await this._guard(() => this.enter(target, {
      spawn: dive.at,
      dist: dive.dist || this.engine.chaseCam.followDist,
      lookAt: dive.lookAt || dive.at,
    }));
  }

  // 自动 LOD 跃迁检测（每帧由 main 调用）
  // 返回 true 表示已触发跃迁，调用方应跳过本帧剩余逻辑
  checkAutoTransition(dtReal) {
    if (this._busy || !this.world) return false;
    // 冷却倒计时
    if (this._autoCooldown > 0) {
      this._autoCooldown -= dtReal;
      return false;
    }
    const world = this.world;
    const pos = this.probe.pos;

    // 1. 自动下潜：检查飞船是否足够接近某个可下潜实体
    let bestDive = null;
    let bestDist = Infinity;
    for (const e of world.entities) {
      if (!e.dive) continue;
      const dx = pos[0] - e.pos[0], dy = pos[1] - e.pos[1], dz = pos[2] - e.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = e.dive.reach ?? (e.pickRadius * 2.2);
      // 自动跃迁阈值：进入 reach 的 40% 范围内
      if (d < reach * 0.4 && d < bestDist) {
        bestDist = d;
        bestDive = e;
      }
    }
    if (bestDive) {
      this.diveCandidate = bestDive;
      this.diveInto(bestDive);
      return true;
    }

    // 2. 自动浮升：飞船远离世界中心超过 worldRadius 的 85%（跳过顶层 cosmos）
    if (this.idx < LAYER_CHAIN.length - 1) {
      const distFromCenter = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
      if (distFromCenter > world.worldRadius * 0.85) {
        this.zoomOut();
        return true;
      }
    }

    // 同时更新 diveCandidate（用于 HUD 提示）
    let best = null; let bestD = Infinity;
    for (const e of world.entities) {
      if (!e.dive) continue;
      const dx = pos[0] - e.pos[0], dy = pos[1] - e.pos[1], dz = pos[2] - e.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = e.dive.reach ?? (e.pickRadius * 2.2);
      if (d < reach && d < bestD) { bestD = d; best = e; }
    }
    this.diveCandidate = best;
    return false;
  }

  async _guard(fn) {
    if (this._busy) return;
    this._busy = true;
    try { await fn(); } finally { this._busy = false; }
  }
}
