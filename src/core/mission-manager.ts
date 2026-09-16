// 任务推进与天体发现管理器
// 纯逻辑——封装任务链推进判定、天体收集去重、引力弹弓测速与 localStorage 持久化
import { MISSIONS, MOON_IDS } from './missions.js';
import type { Entity, LayerId, Vec3 } from '../types.js';

export const PROGRESS_KEY = 'universe-roam-progress';

export interface MissionManagerCallbacks {
  /** 任务单环完成 */
  onMissionDone?: (title: string) => void;
  /** 全任务通关 */
  onAllMissionsDone?: () => void;
  /** 发现新天体 */
  onNewDiscovery?: (entityName: string, totalCount: number) => void;
  /** 泊入成功音效 */
  onDock?: () => void;
  /** UI 任务 HUD 刷新 */
  onMissionUpdate?: (info: { idx: number; total: number; title: string; desc: string } | null) => void;
  /** UI 发现数刷新 */
  onDiscoveriesCountChange?: (count: number) => void;
}

export interface MissionTickContext {
  layerId: LayerId;
  layerIdx: number;
  selected: Entity | null;
  navBranch: string | null;
  probePos: Vec3;
  probeSpeedKmS: number;
  dominantWellRefId: string | null;
  sunPos: Vec3 | null;
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export class MissionManager {
  missionIdx = 0;
  readonly discovered = new Set<string>();
  everLeft = false;

  // 引力弹弓计速：入场速度与峰值速度
  slingWellId: string | null = null;
  slingVEntry = 0;
  slingVPeak = 0;

  // 泊车边沿状态
  private prevParked = false;

  private storage: Storage | null;
  private callbacks: MissionManagerCallbacks;

  constructor(storage?: Storage, callbacks?: MissionManagerCallbacks) {
    this.storage = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.callbacks = callbacks || {};
    this.load();
  }

  /** 从持久化存储读取任务与发现进度 */
  load(): void {
    if (!this.storage) return;
    try {
      const saved = JSON.parse(this.storage.getItem(PROGRESS_KEY) || 'null');
      if (saved && Number.isInteger(saved.missionIdx) && saved.missionIdx >= 0 && saved.missionIdx <= MISSIONS.length) {
        this.missionIdx = saved.missionIdx;
      }
      if (saved && Array.isArray(saved.discovered)) {
        this.discovered.clear();
        saved.discovered.forEach((id: string) => this.discovered.add(id));
      }
    } catch {
      // 存储不可用或损坏时忽略
    }
  }

  /** 保存当前进度到持久化存储 */
  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(PROGRESS_KEY, JSON.stringify({
        missionIdx: this.missionIdx,
        discovered: [...this.discovered],
      }));
    } catch {
      // 存储不可用时忽略
    }
  }

  /** 清空存档进度 */
  reset(): void {
    this.missionIdx = 0;
    this.discovered.clear();
    this.everLeft = false;
    if (this.storage) {
      try { this.storage.removeItem(PROGRESS_KEY); } catch { /* 忽略 */ }
    }
    this.callbacks.onDiscoveriesCountChange?.(0);
    this.syncMissionHud();
  }

  /** 标题画面进度快照信息 */
  getProgressSnapshot(): { hasProgress: boolean; progressText: string } {
    return {
      hasProgress: this.missionIdx > 0,
      progressText: this.missionIdx > 0 ? `任务进度 ${this.missionIdx}/${MISSIONS.length} · 已发现 ${this.discovered.size} 个天体` : '',
    };
  }

  /** 尺度层切换通知 */
  onLayerChanged(layerIdx: number): void {
    if (layerIdx >= 1) this.everLeft = true;
  }

  /** 泊位边沿检测：新发现收集与弹弓基准重置 */
  handleParkedEdge(isParked: boolean, selected: Entity | null): void {
    if (isParked && !this.prevParked && selected) {
      // 弹弓基线重置：以泊入时的匹配速度为起点
      this.slingVEntry = this.slingVPeak;
      if (!this.discovered.has(selected.id)) {
        this.discovered.add(selected.id);
        this.callbacks.onDiscoveriesCountChange?.(this.discovered.size);
        this.callbacks.onNewDiscovery?.(selected.name, this.discovered.size);
        this.save();
      }
      this.callbacks.onDock?.();
    }
    this.prevParked = isParked;
  }

  /** 每帧心跳：更新弹弓计速、推进任务链 */
  tick(ctx: MissionTickContext): void {
    // 1. 引力弹弓计速
    const wid = ctx.dominantWellRefId;
    if (wid !== this.slingWellId) {
      this.slingWellId = wid;
      this.slingVEntry = ctx.probeSpeedKmS;
      this.slingVPeak = this.slingVEntry;
    } else if (wid) {
      this.slingVPeak = Math.max(this.slingVPeak, ctx.probeSpeedKmS);
    }

    // 2. 任务链推进判定
    if (this.missionIdx < MISSIONS.length) {
      const mission = MISSIONS[this.missionIdx];
      const mCtx = {
        layer: ctx.layerId,
        idx: ctx.layerIdx,
        selectedId: ctx.selected ? ctx.selected.id : null,
        selType: ctx.selected ? ctx.selected.type : null,
        branch: ctx.navBranch,
        distToSel: ctx.selected ? dist3(ctx.probePos, ctx.selected.pos) : Infinity,
        distToSun: ctx.sunPos ? dist3(ctx.probePos, ctx.sunPos) : Infinity,
        rFromCenter: Math.hypot(ctx.probePos[0], ctx.probePos[1], ctx.probePos[2]),
        everLeft: this.everLeft,
        wellId: wid,
        wellSpeedGain: this.slingWellId ? Math.max(0, this.slingVPeak - this.slingVEntry) : 0,
        targetRadius: ctx.selected ? ctx.selected.pickRadius : 0,
        moonsDiscovered: [...this.discovered].filter((id) => MOON_IDS.has(id)).length,
      };

      if (mission.done(mCtx)) {
        const title = mission.title;
        this.missionIdx++;
        this.save();
        this.callbacks.onMissionDone?.(title);
        if (this.missionIdx === MISSIONS.length) {
          this.callbacks.onAllMissionsDone?.();
        }
        this.syncMissionHud();
      }
    }
  }

  /** 同步任务 HUD 挂件显示 */
  syncMissionHud(): void {
    if (this.missionIdx < MISSIONS.length) {
      const cur = MISSIONS[this.missionIdx];
      this.callbacks.onMissionUpdate?.({
        idx: this.missionIdx + 1,
        total: MISSIONS.length,
        title: cur.title,
        desc: cur.desc,
      });
    } else {
      this.callbacks.onMissionUpdate?.(null);
    }
  }

  /** 外部调试/测试接口：强制设置任务进度 */
  setMission(i: number): boolean {
    if (Number.isInteger(i) && i >= 0 && i <= MISSIONS.length) {
      const was = this.missionIdx;
      this.missionIdx = i;
      this.save();
      this.syncMissionHud();
      if (i === MISSIONS.length && was < MISSIONS.length) {
        this.callbacks.onAllMissionsDone?.();
      }
      return true;
    }
    return false;
  }
}
