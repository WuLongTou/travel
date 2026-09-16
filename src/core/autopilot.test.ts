import { describe, expect, it } from 'vitest';
import { Autopilot } from './autopilot.js';
import type { Entity, GravityWell } from '../types.js';

describe('Autopilot', () => {
  it('无目标时在引力井内维持自由巡航', () => {
    const ap = new Autopilot();
    const dominantWell: GravityWell = {
      name: '太阳',
      GM: 1.0,
      center: [0, 0, 0],
    };

    const res = ap.update({
      probePos: [1, 0, 0],
      probeVel: [0, 1, 0], // 圆轨道速度 sqrt(GM/r) = 1
      probeForward: [0, 1, 0],
      probeSpeedWorldPerS: 1,
      probeFwdSpeed: 1,
      probeWells: [dominantWell],
      probeDominantWell: dominantWell,
      selected: null,
      worldEntities: [],
      maxSp: 5,
      acc: 1.2,
      dtSim: 0.016,
      clockRate: 1,
    });

    expect(res.flightStatus).toContain('轨道巡航');
    expect(res.forwardThrust).toBe(false);
  });

  it('选定目标时进入巡航拦截，计算正确转向与推力', () => {
    const ap = new Autopilot();
    const target: Entity = {
      id: 'mars',
      name: '火星',
      type: 'planet',
      pos: [10, 0, 0],
      vel: [0, 0, 0],
      radius: 0.1,
      pickRadius: 0.2,
    };

    const res = ap.update({
      probePos: [0, 0, 0],
      probeVel: [0, 0, 0],
      probeForward: [0, 1, 0],
      probeSpeedWorldPerS: 0,
      probeFwdSpeed: 0,
      probeWells: [],
      probeDominantWell: null,
      selected: target,
      worldEntities: [target],
      maxSp: 5,
      acc: 1.2,
      dtSim: 0.016,
      clockRate: 1,
    });

    expect(res.flightStatus).toContain('自动导向 · 火星');
    expect(res.forwardThrust).toBe(true);
    expect(res.steerDir).toBeTruthy();
    // 转向目标指向火星方向 (+x)
    expect(res.steerDir![0]).toBeGreaterThan(0);
  });

  it('向强引力井高速俯冲时触发安全拉起', () => {
    const ap = new Autopilot();
    const well: GravityWell = {
      name: '黑洞',
      GM: 100.0,
      center: [0, 0, 0],
      minR: 1.0,
    };

    const target: Entity = {
      id: 'target',
      name: '目标',
      type: 'moon',
      pos: [0, 0, 0],
      radius: 0.1,
      pickRadius: 0.2,
    };

    // 位于 r=2 处，以高速 -10 向井心俯冲
    const res = ap.update({
      probePos: [2, 0, 0],
      probeVel: [-10, 0, 0],
      probeForward: [-1, 0, 0],
      probeSpeedWorldPerS: 10,
      probeFwdSpeed: 10,
      probeWells: [well],
      probeDominantWell: well,
      selected: target,
      worldEntities: [target],
      maxSp: 15,
      acc: 1.2,
      dtSim: 0.016,
      clockRate: 1,
    });

    expect(res.flightStatus).toContain('防井坠毁 · 拉起');
    expect(res.forwardThrust).toBe(true);
    // 拉起方向远离井心 (+x)
    expect(res.steerDir![0]).toBeGreaterThan(0);
  });
});
