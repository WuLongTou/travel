// 真实尺度飞行器口径单测：船半径/视距在各层的换算
import { describe, it, expect } from 'vitest';
import { AU_KM, LY_KM } from '../util/units.js';
import { SHIP_RADIUS_KM, shipRadiusUnits, chaseDistFor, KPC_KM, MPC_KM, GPC_KM } from './physics.js';

describe('真实尺度飞行器口径', () => {
  it('船包络半径为 8 m（教学近似常量）', () => {
    expect(SHIP_RADIUS_KM).toBe(0.008);
  });
  it('船半径在太阳系层 ≈ 5.3e-11 AU（10 米级相对天文单位的真实比例）', () => {
    expect(shipRadiusUnits(AU_KM)).toBeCloseTo(0.008 / 1.495978707e8, 20);
    expect(shipRadiusUnits(AU_KM)).toBeLessThan(1e-10);
  });
  it('船半径在星际层为 1e-15 ly 量级、宇宙层为 1e-23 Gpc 量级', () => {
    expect(shipRadiusUnits(LY_KM)).toBeLessThan(1e-14);
    expect(shipRadiusUnits(GPC_KM)).toBeGreaterThan(0);
    expect(shipRadiusUnits(GPC_KM)).toBeLessThan(1e-22);
  });
  it('跟拍视距 = 12×船半径（6 船长，船约占屏高 1/3）', () => {
    expect(chaseDistFor(AU_KM)).toBeCloseTo(shipRadiusUnits(AU_KM) * 12, 20);
    expect(chaseDistFor(KPC_KM)).toBeCloseTo(shipRadiusUnits(KPC_KM) * 12, 20);
    expect(chaseDistFor(MPC_KM)).toBeCloseTo(shipRadiusUnits(MPC_KM) * 12, 20);
  });
  it('所有层船径均远小于 1 世界单位（真实物体的量级正确性）', () => {
    for (const u of [AU_KM, LY_KM, KPC_KM, MPC_KM, GPC_KM]) {
      expect(shipRadiusUnits(u)).toBeLessThan(1e-10);
    }
  });
});
