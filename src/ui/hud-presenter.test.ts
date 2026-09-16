import { describe, expect, it } from 'vitest';
import {
  calculateOrbitState,
  formatSpeedText,
  formatTargetDistanceText,
  presentHud,
} from './hud-presenter.js';
import { C_KM_S } from '../util/units.js';
import type { Entity, GravityWell } from '../types.js';

describe('HudPresenter', () => {
  it('formatSpeedText: 自适应单位 m/s、km/s、c', () => {
    // 亚 km/s 显示为 m/s
    expect(formatSpeedText(0.05)).toBe('50.00 m/s');
    expect(formatSpeedText(0.5)).toBe('500 m/s');

    // 常规千米每秒
    expect(formatSpeedText(28.4)).toBe('28 km/s');

    // 相对论光速
    expect(formatSpeedText(C_KM_S * 1.5)).toBe('≈1.50 c');
  });

  it('formatTargetDistanceText: 目标距离、光行时间与下潜快捷键提示', () => {
    expect(formatTargetDistanceText([0, 0, 0], null, 1, false)).toBe('无目标（点击天体锁定）');

    const moon: Entity = {
      id: 'moon',
      name: '月球',
      type: 'moon',
      pos: [1, 0, 0],
      radius: 0.1,
      pickRadius: 0.2,
    };

    const text1 = formatTargetDistanceText([0, 0, 0], moon, 384400, false);
    expect(text1).toContain('月球');
    expect(text1).toContain('光');

    // 锁定的可下潜目标带有 F 提示
    const earth: Entity = {
      ...moon,
      id: 'earth',
      name: '地球',
      dive: { toWorld: 'solar' },
    };
    const text2 = formatTargetDistanceText([0, 0, 0], earth, 1000, true);
    expect(text2).toContain('· F 下潜进入');
  });

  it('calculateOrbitState: 依据比机械能正确判定束缚与逃逸轨道', () => {
    const well: GravityWell = {
      name: '太阳',
      GM: 100.0,
      center: [0, 0, 0],
    };

    // r=1, GM=100 -> 逃逸速度 v_esc = sqrt(2GM/r) = sqrt(200) ≈ 14.14
    // v = 10 < 14.14 -> 束缚轨道
    const bound = calculateOrbitState([1, 0, 0], [0, 10, 0], well);
    expect(bound?.orbitState).toBe('束缚轨道');
    expect(bound?.orbitText).toBe('太阳 · 束缚轨道');

    // v = 20 > 14.14 -> 逃逸轨道
    const escaped = calculateOrbitState([1, 0, 0], [0, 20, 0], well);
    expect(escaped?.orbitState).toBe('逃逸轨道');
    expect(escaped?.orbitText).toBe('太阳 · 逃逸轨道');
  });

  it('presentHud: 整体组装包含大巡游前缀与撞毁反馈覆盖', () => {
    const well: GravityWell = { name: '地球', GM: 10, center: [0, 0, 0] };
    const res = presentHud({
      probePos: [1, 0, 0],
      probeVel: [0, 1, 0],
      speedKmS: 15.0,
      dominantWell: well,
      selected: null,
      hoveredEntity: null,
      kmPerUnit: 1,
      flightStatus: '巡航航行',
      viewName: '追尾视角',
      godSpeed: '',
      crashEventName: null,
      isRecentlyCrashed: false,
      tourStatusPrefix: '大巡游 1/5',
    });

    expect(res.speedText).toBe('15 km/s');
    expect(res.distText).toBe('无目标（点击天体锁定）');
    expect(res.orbitText).toBe('地球 · 束缚轨道');
    expect(res.modeText).toContain('大巡游 1/5 · 巡航航行 · 地球 (束缚轨道) · 追尾视角');

    // 撞毁警报优先覆盖状态文案
    const crashRes = presentHud({
      probePos: [0, 0, 0],
      probeVel: [0, 0, 0],
      speedKmS: 0,
      dominantWell: null,
      selected: null,
      hoveredEntity: null,
      kmPerUnit: 1,
      flightStatus: '停泊',
      viewName: '追尾视角',
      godSpeed: '',
      crashEventName: '木星',
      isRecentlyCrashed: true,
      tourStatusPrefix: '',
    });
    expect(crashRes.modeText).toBe('⚠ 撞入 木星！已在安全轨道部署');
  });
});
