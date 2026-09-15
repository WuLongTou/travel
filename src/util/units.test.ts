// units 纯函数单测：换算与格式化（Vitest）
import { describe, it, expect } from 'vitest';
import {
  C_KM_S, AU_KM, LY_KM,
  kmToLy, lyToKm, auToKm,
  formatKm, lightTravelText, unitRulerText, tempToHex, rgbHex, hexRgb,
} from './units.js';

describe('常量（IAU 定义值）', () => {
  it('光速为精确定义值', () => {
    expect(C_KM_S).toBe(299792.458);
  });
  it('AU 换算往返一致', () => {
    expect(auToKm(1)).toBe(AU_KM);
    expect(kmToLy(lyToKm(1))).toBeCloseTo(1, 12);
  });
});

describe('formatKm 自适应单位', () => {
  it('千米级', () => {
    expect(formatKm(384400)).toBe('384,400 km');
  });
  it('AU 级', () => {
    expect(formatKm(AU_KM)).toBe('1.00 AU');
  });
  it('光年级与千倍以上换档', () => {
    expect(formatKm(LY_KM)).toBe('1.00 光年');
    expect(formatKm(LY_KM * 1e3)).toContain('kpc');
    expect(formatKm(LY_KM * 1e6)).toContain('Mpc');
    expect(formatKm(LY_KM * 1e9)).toContain('Gpc');
  });
  it('非有限值兜底', () => {
    expect(formatKm(NaN)).toBe('—');
    expect(formatKm(Infinity)).toBe('—');
  });
});

describe('lightTravelText 光行时间', () => {
  it('月地距离约 1.3 秒', () => {
    expect(lightTravelText(384400)).toMatch(/^1\.3 秒$/);
  });
  it('跨尺度换档到年', () => {
    expect(lightTravelText(AU_KM)).toBe('8.3 分钟');
    expect(lightTravelText(LY_KM)).toBe('1.0 年');
  });
});

describe('unitRulerText 标尺', () => {
  it('已知单位有文案，未知单位为空', () => {
    expect(unitRulerText('AU')).toContain('1.50 亿 km');
    expect(unitRulerText('ly')).toContain('万亿 km');
    expect(unitRulerText('parsec')).toBe('');
  });
});

describe('颜色工具', () => {
  it('色温分段：6000K 基准白、太阳 5800K 略暖、红矮星偏橙', () => {
    expect(tempToHex(6000)).toBe('#ffffff');
    expect(tempToHex(5800)).toBe('#fffaf5');
    expect(tempToHex(3000)).toBe('#ffb366');
  });
  it('rgb/hex 往返', () => {
    expect(rgbHex(...(hexRgb('#7fb4ff') as [number, number, number]))).toBe('#7fb4ff');
  });
});
