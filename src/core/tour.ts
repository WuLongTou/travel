import type { Entity, Vec3 } from '../types.js';

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const TOUR_DWELL_S = 12;
const TOUR_ARRIVE_S = 1.2;

export interface TourState {
  stops: Entity[];
  idx: number;
  phase: 'enroute' | 'dwell';
  dwellLeft: number;
  nearS: number;
}

export interface TourCallbacks {
  /** 选中某个实体作为目标 */
  onSelectEntity: (e: Entity) => void;
  /** 显示 toast 消息 */
  onToast: (text: string) => void;
}

export class TourController {
  private _state: TourState | null = null;
  private callbacks: TourCallbacks;

  constructor(callbacks: TourCallbacks) {
    this.callbacks = callbacks;
  }

  get active(): boolean {
    return this._state !== null;
  }

  get state(): TourState | null {
    return this._state;
  }

  get currentStop(): Entity | null {
    if (!this._state) return null;
    return this._state.stops[this._state.idx] || null;
  }

  toggle(world: { tourStops?: string[]; entities: Entity[] }): void {
    if (this._state) {
      this.stop('巡游结束');
      return;
    }
    this.start(world);
  }

  start(world: { tourStops?: string[]; entities: Entity[] }): void {
    const stops = (world.tourStops || [])
      .map((id: string) => world.entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e);
    if (stops.length < 2) {
      this.callbacks.onToast('此尺度层没有巡游路线');
      return;
    }
    this._state = { stops, idx: 0, phase: 'enroute', dwellLeft: 0, nearS: 0 };
    this.callbacks.onSelectEntity(stops[0]);
  }

  stop(msg?: string): void {
    if (!this._state) return;
    this._state = null;
    if (msg) this.callbacks.onToast(msg);
  }

  private nextStop(): void {
    if (!this._state) return;
    this._state.idx = (this._state.idx + 1) % this._state.stops.length;
    this._state.phase = 'enroute';
    this._state.nearS = 0;
    this.callbacks.onSelectEntity(this._state.stops[this._state.idx]);
  }

  update(dtReal: number, probePos: Vec3, selected: Entity | null, lastParkDist: number, worldEntities: Entity[]): void {
    if (!this._state || !selected) return;
    const s = this._state;

    // 站点实体失效（异常清理）→ 跳下一站
    if (!worldEntities.includes(selected)) { this.nextStop(); return; }

    if (s.phase === 'enroute') {
      const d = dist3(probePos, selected.pos);
      if (lastParkDist > 0 && d <= lastParkDist * 1.5) {
        s.nearS += dtReal;
        if (s.nearS >= TOUR_ARRIVE_S) {
          s.phase = 'dwell';
          s.dwellLeft = TOUR_DWELL_S;
        }
      } else {
        s.nearS = 0;
      }
    } else {
      s.dwellLeft -= dtReal;
      if (s.dwellLeft <= 0) {
        this.nextStop();
      }
    }
  }

  formatStatus(): string {
    if (!this._state) return '';
    const s = this._state;
    if (s.phase === 'enroute') {
      return `大巡游 ${s.idx + 1}/${s.stops.length}`;
    }
    return `大巡游 ${s.idx + 1}/${s.stops.length} · 停留 ${Math.ceil(s.dwellLeft)}s`;
  }
}
