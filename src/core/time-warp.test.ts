import { describe, expect, it } from 'vitest';
import { MANUAL_MAX_RATE, TIME_RATES, TimeWarpController } from './time-warp.js';

describe('TimeWarpController', () => {
  it('初始化为 auto 模式', () => {
    const tw = new TimeWarpController();
    expect(tw.mode).toBe('auto');
    expect(tw.currentIdx).toBe(0);
    expect(tw.currentLabel).toBe('实时');
  });

  it('stepUp 和 stepDown 在边界内步进并转为 user 模式', () => {
    const tw = new TimeWarpController();
    const mockClock = { rate: 1, setRate: (r: number) => { mockClock.rate = r; }, paused: true };

    tw.stepUp(mockClock);
    expect(tw.mode).toBe('user');
    expect(tw.currentIdx).toBe(1);
    expect(mockClock.rate).toBe(TIME_RATES[1]);
    expect(mockClock.paused).toBe(false);

    tw.stepDown(mockClock);
    expect(tw.currentIdx).toBe(0);
    expect(mockClock.rate).toBe(TIME_RATES[0]);

    // 下界保护
    tw.stepDown(mockClock);
    expect(tw.currentIdx).toBe(0);

    // 恢复自动
    tw.resetToAuto();
    expect(tw.mode).toBe('auto');
  });

  it('clampForManual: 高倍率时钳制至 MANUAL_MAX_RATE，低倍率时不干预', () => {
    const tw = new TimeWarpController();
    const mockClock = { rate: 86400, setRate: (r: number) => { mockClock.rate = r; } };

    const msg = tw.clampForManual(mockClock);
    expect(msg).toBeTruthy();
    expect(mockClock.rate).toBe(MANUAL_MAX_RATE);

    const noMsg = tw.clampForManual(mockClock);
    expect(noMsg).toBeNull();
  });

  it('autoTick: 无目标时按主导井开普勒周期配速', () => {
    const tw = new TimeWarpController();
    const mockClock = { paused: false, rate: 1, setRate: (r: number) => { mockClock.rate = r; } };

    tw.autoTick({
      selected: null,
      probePos: [1, 0, 0],
      probeSpeedWorldPerS: 0.1,
      dominantWell: { GM: 1, center: [0, 0, 0] },
      lastParkDist: 0,
      worldRadius: 100,
      timeScaleMax: 3.15576e18,
    }, mockClock);

    // r=1, GM=1 -> vCirc=1 -> target = 1 / (1 * 60) = 1/60 < 1 -> clamp to 1
    expect(mockClock.rate).toBe(1);
  });

  it('autoTick: 有目标且接近中按 ETA 配速', () => {
    const tw = new TimeWarpController();
    const mockClock = { paused: false, rate: 1, setRate: (r: number) => { mockClock.rate = r; } };

    tw.autoTick({
      selected: { pos: [100, 0, 0] },
      probePos: [0, 0, 0],
      probeSpeedWorldPerS: 0.01,
      dominantWell: null,
      lastParkDist: 0,
      worldRadius: 1000,
      timeScaleMax: 3.15576e18,
    }, mockClock);

    // d=100, v=0.01 -> target = 100 / (0.01 * 8) = 1250
    // 位移包线约束后 rate 会选择匹配档位
    expect(mockClock.rate).toBeGreaterThan(1);
  });
});
