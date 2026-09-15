// 宇宙导航：6 个尺度层 = 同一宇宙的不同缩放级别（从小到大）
//   index 0=solar … 5=cosmos
//   zoomIn  (下潜：进入更小尺度)   index-1
//   zoomOut (浮升：退到更大尺度)   index+1
// 自动 LOD 跃迁：基于飞船与可下潜实体的距离自动触发尺度切换
import { worldFactories, LAYER_CHAIN, CHAIN_INDEX } from '../content/worlds.js';
import { shipRadiusUnits, chaseDistFor } from '../content/physics.js';
import type { CosmicEngine } from '../render/engine.js';
import type { Probe } from './probe.js';
import type { SimClock } from './clock.js';
import type { Entity, GameWorld, LayerId, Vec3 } from '../types.js';

export interface EnterOpts {
  spawn?: Vec3;
  escapeDir?: Vec3;
  approachDir?: Vec3;
  keepAnchor?: boolean;
  lookAt?: Vec3;
  dist?: number;
}

interface LayerAnchor { pos: Vec3; dist: number }

export class Navigator {
  engine: CosmicEngine;
  probe: Probe;
  clock: SimClock;
  world: GameWorld | null = null;
  idx = 0; // 当前层在 CHAIN 中的位置（0=solar…5=cosmos）
  anchors: Partial<Record<LayerId, LayerAnchor>> = {};
  diveCandidate: Entity | null = null;
  onWorldChanged: ((world: GameWorld, idx: number) => void) | null = null;
  onBeforeWorldChange: ((world: GameWorld) => void) | null = null; // 跃迁前回调：调用方清理指向旧世界的状态（如目标锁定）
  private _busy = false;
  // 自动跃迁冷却：避免在边界处反复跳转
  private _autoCooldown = 0;

  constructor(engine: CosmicEngine, probe: Probe, clock: SimClock) {
    this.engine = engine;
    this.probe = probe;
    this.clock = clock;
  }

  get worldId(): LayerId | null { return this.world ? this.world.id : null; }

  async enter(worldId: LayerId, opts: EnterOpts = {}): Promise<void> {
    const idx = CHAIN_INDEX[worldId];
    if (idx === undefined) throw new Error('未注册世界: ' + worldId);
    if (this.world) {
      this.anchors[this.world.id] = { pos: this.probe.pos.slice() as Vec3, dist: this.engine.chaseCam!.followDist };
      if (this.onBeforeWorldChange) this.onBeforeWorldChange(this.world);
    }
    const factory = worldFactories[worldId];
    if (!factory) throw new Error('世界工厂未就绪: ' + worldId);
    const world = await factory();
    const prevAnchor = this.anchors[worldId];
    let spawn: Vec3 = (opts.spawn || world.spawn || [0, 0, 0]).slice() as Vec3;
    if (opts.escapeDir) {
      // 从微观子系统冲出：在母系统中心天体外围沿逃逸矢量方向出现，继续向外航行。
      // 最小间距下限按层半径缩放（≤30% 半径）：固定的 1.5 下限对小半径层是
      // 灾难——本星系群层（半径 1.2 Mpc）会被顶到 1.5 Mpc，越过 85% 浮升
      // 阈值，浮升进来 2 秒后立即被弹射到更上层，该层永远无法飞入
      const r = Math.max(world.worldRadius * 0.08, Math.min(1.5, world.worldRadius * 0.3));
      spawn = [opts.escapeDir[0] * r, opts.escapeDir[1] * r, opts.escapeDir[2] * r] as Vec3;
    } else if (opts.approachDir && !opts.spawn) {
      // 从宏观系统深入微观：从子系统外边缘沿逼近方向切入（显式指定
      // spawn 时以精选落点优先，不用边缘切入公式覆盖）
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
        spawn = [spawn[0] + dx * push, spawn[1] + dy * push, spawn[2] + dz * push] as Vec3;
      }
    }

    // 跟拍视距与缩放范围全部按「船真实半径」派生（每层 1 单位 = kmPerUnit km）：
    //   默认 12×船半径（6 船长）；滚轮下限 1.2×（贴脸）、上限 1.4×层半径
    const shipR = shipRadiusUnits(world.kmPerUnit);
    const defaultShipDist = chaseDistFor(world.kmPerUnit);
    const dist = (opts.keepAnchor && prevAnchor) ? prevAnchor.dist : (opts.dist || defaultShipDist);
    this.probe.bindWorld(world, spawn);
    this.world = world;
    this.idx = idx;
    this.engine.chaseCam!.setDist(dist, shipR * 1.2, world.worldRadius * 1.4);

    // 相机与飞船航向：
    // 若向外逃逸，航向继续向外；若向内切入，航向朝向系统中心
    let lookAt: Vec3 = (opts.lookAt || world.spawnLookAt || [0, 0, 0]) as Vec3;
    if (opts.escapeDir) {
      lookAt = [spawn[0] + opts.escapeDir[0] * 5, spawn[1] + opts.escapeDir[1] * 5, spawn[2] + opts.escapeDir[2] * 5] as Vec3;
    } else if (opts.approachDir) {
      lookAt = [0, 0, 0]; // 看向中心
    }
    this.probe.lookTowards(lookAt);
    const f = this.probe.forward(), u = this.probe.up();
    const eye: Vec3 = [
      spawn[0] - f[0] * dist + u[0] * dist * 0.35,
      spawn[1] - f[1] * dist + u[1] * dist * 0.35,
      spawn[2] - f[2] * dist + u[2] * dist * 0.35,
    ];
    this.engine.chaseCam!.snapTo(eye, spawn);
    // 换层首帧防护：dtSim 在帧首已按上一层倍率算出，autoWarpTick 本帧末
    // 才按新层重配速——先把倍率钳到安全包线（同时不超过本层上限）：
    //   1) 轨道采样：首帧模拟时长 ≤ 局部轨道时标 τ 的 1/20（否则一帧内
    //      积分几十圈，数值误差泵入能量把飞船甩出数 AU）
    //   2) 位移包线：首帧位移 ≤ 0.5% 层半径
    const v0 = this.probe.speedWorldPerS();
    let cap = world.timeScaleMax || Infinity;
    let tau = Infinity;
    for (const w of this.probe._wells()) {
      if (w.GM <= 0) continue;
      const c = (w.ref ? w.ref.pos : w.center)!;
      const dxc = spawn[0] - c[0], dyc = spawn[1] - c[1], dzc = spawn[2] - c[2];
      const r = Math.hypot(dxc, dyc, dzc) || 1e-12;
      tau = Math.min(tau, Math.sqrt(r * r * r / w.GM));
    }
    if (Number.isFinite(tau)) cap = Math.min(cap, tau * 3.125); // τ×0.05 ÷ 0.016s 帧长
    if (v0 > 1e-15 && world.worldRadius > 0) {
      cap = Math.min(cap, world.worldRadius * 0.005 / (v0 * 0.016));
    }
    this.clock.rate = Math.min(this.clock.rate, cap);
    // 跃迁后设置 2 秒冷却
    this._autoCooldown = 2.0;
    if (this.onWorldChanged) this.onWorldChanged(world, idx);
  }

  // 放大一档（到更小尺度）：默认到目标层默认观测位
  async zoomIn(): Promise<void> {
    if (this.idx <= 0) return;
    const target = LAYER_CHAIN[this.idx - 1];
    await this._guard(() => this.enter(target));
  }
  // 缩小一档（浮升到更大尺度）：保持飞船逃逸方向的物理连续性
  async zoomOut(): Promise<void> {
    if (this.idx >= LAYER_CHAIN.length - 1) return;
    const target = LAYER_CHAIN[this.idx + 1];
    const p = this.probe.pos;
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    const escapeDir: Vec3 = [p[0] / l, p[1] / l, p[2] / l];
    await this._guard(() => this.enter(target, { escapeDir }));
  }

  // 下潜到目标实体（进入更微观的子系统）：落到 dive.at 精选的层内落点，
  // 航向朝该层兴趣中心（world.spawnLookAt 兜底）。不传 approachDir/lookAt
  // ——边缘切入公式会覆盖 dive.at（历史后果：银河系层出生在银心黑洞引力
  // 半径内即坠毁、太阳系层落在海王星轨道外），lookAt=dive.at 则退化为
  // 「看自己」（yaw/pitch 归零）
  async diveInto(entity: Entity): Promise<void> {
    const dive = entity.dive;
    if (!dive) return;
    const target = dive.toWorld;
    await this._guard(() => this.enter(target, {
      spawn: dive.at,
      dist: dive.dist || 0.35,
    }));
  }

  // 自动 LOD 跃迁检测（每帧由 main 调用）
  // 返回 true 表示已触发跃迁，调用方应跳过本帧剩余逻辑
  checkAutoTransition(dtReal: number): boolean {
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

  private async _guard(fn: () => Promise<void>): Promise<void> {
    if (this._busy) return;
    this._busy = true;
    try { await fn(); } finally { this._busy = false; }
  }
}
