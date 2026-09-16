import type { Vec3 } from '../types.js';

export const TIME_RATES = [
  1, 60, 3600, 21600, 86400, 604800, 2629800, 31557600, 315576000, 3155760000, 31557600000,
  3.15576e11, 3.15576e13, 3.15576e15, 3.15576e17, 3.15576e18
];
export const TIME_RATE_LABELS = [
  '实时', '1分/秒', '1时/秒', '6时/秒', '1天/秒', '1周/秒', '1月/秒', '1年/秒', '10年/秒', '100年/秒', '千年/秒',
  '万年/秒', '百万年/秒', '亿年/秒', '百亿年/秒', '千亿年/秒'
];
export const MANUAL_MAX_RATE = 3600;

const WARP_ETA_S = 8;

export interface TimeWarpContext {
  /** 当前选中目标 */
  selected: { pos: Vec3; vel?: Vec3 } | null;
  /** 探测器位置和速度 */
  probePos: Vec3;
  probeSpeedWorldPerS: number;
  /** 主导引力井 */
  dominantWell: { GM: number; center?: Vec3; ref?: { pos: Vec3 } } | null;
  /** 最近一帧计算的泊距 */
  lastParkDist: number;
  /** 世界参数 */
  worldRadius: number;
  timeScaleMax: number;
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function findBestRateIdx(rate: number): number {
  let best = 0;
  for (let i = 0; i < TIME_RATES.length; i++) {
    if (Math.abs(TIME_RATES[i] - rate) < Math.abs(TIME_RATES[best] - rate)) best = i;
  }
  return best;
}

export class TimeWarpController {
  mode: 'auto' | 'user' = 'auto';
  currentIdx = 0;

  /** 自动调速（每帧调用） */
  autoTick(ctx: TimeWarpContext, clock: { paused: boolean; rate: number; setRate(r: number): void }): void {
    if (this.mode !== 'auto' || clock.paused) return;

    let target = 0;

    if (ctx.selected) {
      const d = dist3(ctx.probePos, ctx.selected.pos);
      const v = ctx.probeSpeedWorldPerS;
      if (v > 1e-14) target = d / (v * WARP_ETA_S);
    }

    if (target === 0) {
      const well = ctx.dominantWell;
      if (well && well.GM > 0) {
        const c = (well.ref ? well.ref.pos : well.center)!;
        const r = Math.hypot(ctx.probePos[0] - c[0], ctx.probePos[1] - c[1], ctx.probePos[2] - c[2]) || 1e-12;
        const vCirc = Math.sqrt(well.GM / r);
        target = r / (vCirc * 60);
      } else {
        target = 1;
      }
    }

    if (ctx.lastParkDist > 0 && ctx.selected) {
      const dSel = dist3(ctx.probePos, ctx.selected.pos);
      const vNow = ctx.probeSpeedWorldPerS;
      if (dSel < ctx.lastParkDist * 3 && vNow > 1e-14) {
        target = Math.min(target, Math.max(60, dSel / (vNow * 2.5)));
      }
    }

    if (ctx.selected) {
      const dSel = dist3(ctx.probePos, ctx.selected.pos);
      const vNow = ctx.probeSpeedWorldPerS;
      if (vNow > 1e-14) target = Math.min(target, dSel * 0.02 / (vNow * 0.016));
    }

    if (ctx.worldRadius > 0) {
      const vCap = ctx.probeSpeedWorldPerS;
      if (vCap > 1e-14) target = Math.min(target, ctx.worldRadius * 0.05 / (vCap * 0.016));
    }

    const rate = Math.min(Math.max(target, 1), ctx.timeScaleMax || TIME_RATES[TIME_RATES.length - 1]);
    
    this.currentIdx = findBestRateIdx(rate);
    
    if (Math.abs(clock.rate - rate) > rate * 0.02) {
      clock.setRate(rate);
    }
  }

  /** [ 键减速步进 */
  stepDown(clock: { setRate(r: number): void; paused: boolean }): string | null {
    if (this.currentIdx > 0) {
      this.currentIdx--;
      clock.setRate(TIME_RATES[this.currentIdx]);
      clock.paused = false;
      this.mode = 'user';
    }
    return null;
  }

  /** ] 键加速步进 */
  stepUp(clock: { setRate(r: number): void; paused: boolean }): string | null {
    if (this.currentIdx < TIME_RATES.length - 1) {
      this.currentIdx++;
      clock.setRate(TIME_RATES[this.currentIdx]);
      clock.paused = false;
      this.mode = 'user';
    }
    return null;
  }

  /** 手动接管时钳制倍率，返回 toast 消息或 null */
  clampForManual(clock: { rate: number; setRate(r: number): void }): string | null {
    if (clock.rate > MANUAL_MAX_RATE) {
      clock.setRate(MANUAL_MAX_RATE);
      this.currentIdx = findBestRateIdx(MANUAL_MAX_RATE);
      return '⚠️ 手动机动上限限制（松手恢复）';
    }
    return null;
  }

  /** 恢复自动模式 */
  resetToAuto(): void {
    this.mode = 'auto';
  }

  /** 获取当前倍率标签 */
  get currentLabel(): string {
    return TIME_RATE_LABELS[this.currentIdx] || '';
  }

  /** 获取格式化的倍率显示 */
  formatRateLabel(clock: { paused: boolean; rate: number; rateLabel(): string }): string {
    if (clock.paused) return '暂停';
    return clock.rateLabel();
  }
}
