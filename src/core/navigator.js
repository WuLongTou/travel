// 宇宙导航：6 个尺度层 = 同一宇宙的不同缩放级别（从小到大）
//   index 0=solar … 5=cosmos
//   zoomIn  (下潜：进入更小尺度)   index-1
//   zoomOut (浮升：退到更大尺度)   index+1
// 每层按自身 unit 建模，「进入」都从该层默认观测位开始（教学视角）。
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
    this.engine.chaseCam.snapTo(
      [spawn[0], spawn[1], spawn[2]],
      [lookAt[0], lookAt[1], lookAt[2]],
    );
    this.clock.rate = Math.min(this.clock.rate, world.timeScaleMax || Infinity);
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

  async _guard(fn) {
    if (this._busy) return;
    this._busy = true;
    try { await fn(); } finally { this._busy = false; }
  }
}
