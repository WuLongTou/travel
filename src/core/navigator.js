// 宇宙导航：6 个尺度层 = 同一宇宙的不同缩放级别（从小到大）
//   index 0=solar … 5=cosmos
//   zoomIn  (下潜：进入更小尺度)   index-1
//   zoomOut (浮升：退到更大尺度)   index+1
// 自动 LOD 跃迁：基于飞船与可下潜实体的距离自动触发尺度切换
import { worldFactories, LAYER_CHAIN, CHAIN_INDEX } from '../content/worlds.js';

export class Navigator {
  constructor(engine, probe, clock) {
    this.engine = engine;
    this.probe = probe;
    this.clock = clock;
    this.world = null;
    this.idx = 0; // 当前层在 CHAIN 中的位置（0=solar…5=cosmos）
    this.anchors = {};
    this.diveCandidate = null;
    this.onWorldChanged = null;
    this.onBeforeWorldChange = null; // 跃迁前回调：调用方清理指向旧世界的状态（如目标锁定）
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
      if (this.onBeforeWorldChange) this.onBeforeWorldChange(this.world);
    }
    const world = await worldFactories[worldId]();
    const prevAnchor = this.anchors[worldId];
    let spawn = opts.spawn || world.spawn;
    if (opts.escapeDir) {
      // 从微观子系统冲出：在母系统中心天体外围沿逃逸矢量方向出现，继续向外航行。
      // 最小间距下限按层半径缩放（≤30% 半径）：固定的 1.5 下限对小半径层是
      // 灾难——本星系群层（半径 1.2 Mpc）会被顶到 1.5 Mpc，越过 85% 浮升
      // 阈值，浮升进来 2 秒后立即被弹射到更上层，该层永远无法飞入
      const r = Math.max(world.worldRadius * 0.08, Math.min(1.5, world.worldRadius * 0.3));
      spawn = [opts.escapeDir[0] * r, opts.escapeDir[1] * r, opts.escapeDir[2] * r];
    } else if (opts.approachDir) {
      // 从宏观系统深入微观：从子系统外边缘沿逼近方向切入
      const r = world.worldRadius * 0.55;
      spawn = [opts.approachDir[0] * r, opts.approachDir[1] * r, opts.approachDir[2] * r];
    } else if (opts.keepAnchor && prevAnchor) {
      spawn = prevAnchor.pos;
    }

    // 落点防下潜圈（所有进入方式统一兜底）：落点若落在某可下潜实体的
    // 自动下潜触发圈内（reach×0.4），2 秒冷却一过立即被拽入下一层，
    // 形成换层弹跳——沿「实体→落点」方向推出到触发圈外
    for (const e of world.entities) {
      if (!e.dive) continue;
      const reach = (e.dive.reach ?? (e.pickRadius * 2.2)) * 0.4;
      const dx = spawn[0] - e.pos[0], dy = spawn[1] - e.pos[1], dz = spawn[2] - e.pos[2];
      const d = Math.hypot(dx, dy, dz) || 1e-9;
      if (d < reach) {
        const push = (reach * 1.3 - d) / d;
        spawn = [spawn[0] + dx * push, spawn[1] + dy * push, spawn[2] + dz * push];
      }
    }

    const defaultShipDist = world.shipViewDist || 0.35;
    const dist = (opts.keepAnchor && prevAnchor) ? prevAnchor.dist : (opts.dist || defaultShipDist);
    this.probe.bindWorld(world, spawn);
    this.world = world;
    this.idx = idx;
    this.engine.chaseCam.followDist = dist;

    // 相机与飞船航向：
    // 若向外逃逸，航向继续向外；若向内切入，航向朝向系统中心
    let lookAt = opts.lookAt || world.spawnLookAt || [0, 0, 0];
    if (opts.escapeDir) {
      lookAt = [spawn[0] + opts.escapeDir[0] * 5, spawn[1] + opts.escapeDir[1] * 5, spawn[2] + opts.escapeDir[2] * 5];
    } else if (opts.approachDir) {
      lookAt = [0, 0, 0]; // 看向中心
    }
    this.probe.lookTowards(lookAt);
    const f = this.probe.forward(), u = this.probe.up();
    const eye = [
      spawn[0] - f[0] * dist + u[0] * dist * 0.35,
      spawn[1] - f[1] * dist + u[1] * dist * 0.35,
      spawn[2] - f[2] * dist + u[2] * dist * 0.35,
    ];
    this.engine.chaseCam.snapTo(eye, spawn);
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
  // 缩小一档（浮升到更大尺度）：保持飞船逃逸方向的物理连续性
  async zoomOut() {
    if (this.idx >= LAYER_CHAIN.length - 1) return;
    const target = LAYER_CHAIN[this.idx + 1];
    const p = this.probe.pos;
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    const escapeDir = [p[0] / l, p[1] / l, p[2] / l];
    await this._guard(() => this.enter(target, { escapeDir }));
  }

  // 下潜到目标实体（进入更微观的子系统）：按逼近方向自然切入子世界边缘
  async diveInto(entity) {
    const dive = entity.dive;
    if (!dive) return;
    const target = dive.toWorld;
    // 计算逼近实体的相对方位向量
    const p = this.probe.pos;
    const dx = p[0] - entity.pos[0], dy = p[1] - entity.pos[1], dz = p[2] - entity.pos[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const approachDir = [dx / dl, dy / dl, dz / dl];
    await this._guard(() => this.enter(target, {
      approachDir,
      spawn: dive.at,
      dist: dive.dist || 0.35,
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

    return false;
  }

  async _guard(fn) {
    if (this._busy) return;
    this._busy = true;
    try { await fn(); } finally { this._busy = false; }
  }
}
