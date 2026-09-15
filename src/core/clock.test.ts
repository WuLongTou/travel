// SimClock 单测：倍率钳制、暂停、时间标签（Vitest）
import { describe, it, expect } from 'vitest';
import { SimClock } from './clock.js';

describe('SimClock.advance', () => {
  it('实时下模拟增量 = 真实增量', () => {
    const c = new SimClock();
    expect(c.advance(0.016)).toBeCloseTo(0.016, 6);
    expect(c.t).toBeCloseTo(0.016, 6);
  });
  it('倍率放大模拟时间', () => {
    const c = new SimClock();
    c.setRate(86400); // 1 天/秒
    expect(c.advance(1)).toBeCloseTo(86400, 4);
  });
  it('暂停时零增量且不累积', () => {
    const c = new SimClock();
    c.setRate(3600);
    c.paused = true;
    expect(c.advance(1)).toBe(0);
    expect(c.t).toBe(0);
  });
});

describe('SimClock.setRate', () => {
  it('下限钳到 0', () => {
    const c = new SimClock();
    c.setRate(-5);
    expect(c.rate).toBe(0);
  });
  it('上限钳到千亿年/秒档', () => {
    const c = new SimClock();
    c.setRate(1e30);
    expect(c.rate).toBe(3.15576e18);
  });
});

describe('SimClock 标签', () => {
  it('实时与暂停', () => {
    const c = new SimClock();
    expect(c.rateLabel()).toBe('实时');
    c.paused = true;
    expect(c.rateLabel()).toBe('已暂停');
  });
  it('时间自适应单位（秒→分→时→天；100 年内保持天数口径）', () => {
    const c = new SimClock();
    expect(c.timeLabel()).toBe('0 秒');
    c.t = 150;
    expect(c.timeLabel()).toBe('2.5 分钟');
    c.t = 365.25 * 86400 * 3;
    expect(c.timeLabel()).toBe('1095.8 天');
  });
  it('高倍率转年表达', () => {
    const c = new SimClock();
    c.setRate(31557600 * 100);
    expect(c.rateLabel()).toContain('100 年');
  });
});
