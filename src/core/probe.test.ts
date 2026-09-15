// Probe 姿态与翻转单测：越顶翻转的 forward 连续性、滞回防抖、横滚回绕
// 翻转恒等式：越过极点 ε 时 (yaw+π, π/2−ε) 与「连续拉杆的理想 pitch=π/2+ε」
// 的 forward 逐分量恒等（[-sy·cp, sp, -cy·cp] 在两侧的解析延拓）
import { describe, it, expect } from 'vitest';
import { Probe } from './probe.js';

describe('Probe.steer 俯仰越顶翻转', () => {
  it('过顶翻转：yaw+π、pitch 反射为 π/2−ε，forward 与连续拉杆解析值恒等', () => {
    const p = new Probe();
    p.yaw = 0.7;
    p.pitch = Math.PI / 2 - 0.1;
    p.steer(0, 0.15, 0); // 越过顶点 ε=0.05
    expect(p.yaw).toBeCloseTo(0.7 + Math.PI, 6);
    expect(p.pitch).toBeCloseTo(Math.PI / 2 - 0.05, 6);
    const eps = 0.05;
    const f = p.forward();
    expect(f[0]).toBeCloseTo(Math.sin(0.7) * Math.sin(eps), 6);
    expect(f[1]).toBeCloseTo(Math.cos(eps), 6);
    expect(f[2]).toBeCloseTo(Math.cos(0.7) * Math.sin(eps), 6);
  });
  it('过底翻转同样与连续拉杆解析值恒等', () => {
    const p = new Probe();
    p.yaw = -1.1;
    p.pitch = -Math.PI / 2 + 0.1;
    p.steer(0, -0.15, 0); // 越过底点 ε=0.05
    expect(p.pitch).toBeCloseTo(-Math.PI / 2 + 0.05, 6);
    const eps = 0.05;
    const f = p.forward();
    expect(f[0]).toBeCloseTo(Math.sin(-1.1) * Math.sin(eps), 6);
    expect(f[1]).toBeCloseTo(-Math.cos(eps), 6);
    expect(f[2]).toBeCloseTo(Math.cos(-1.1) * Math.sin(eps), 6);
  });
  it('滞回：越界量 < 0.02 rad 时 clamp 在顶点下，不触发翻转', () => {
    const p = new Probe();
    p.pitch = Math.PI / 2 - 0.02; // clamp 上限
    p.yaw = 0.3;
    p.roll = 0.2;
    p.steer(0, 0.03, 0); // 越界 0.01 < 0.02 滞回
    expect(p.pitch).toBeCloseTo(Math.PI / 2 - 0.02, 6);
    expect(p.yaw).toBeCloseTo(0.3, 6); // yaw 未动
    expect(p.roll).toBeCloseTo(0.2, 6); // roll 未补偿
  });
  it('翻转后姿态基完全连续（forward/right/up 与连续拉杆理想基逐分量一致）', () => {
    const p = new Probe();
    p.yaw = 0.7;
    p.pitch = 0;
    p.steer(0, Math.PI / 2 + 0.1, 0); // 从 0 一路拉过顶点，ε=0.1
    const eps = 0.1, yw = 0.7;
    const fExp = [Math.sin(yw) * Math.sin(eps), Math.cos(eps), Math.cos(yw) * Math.sin(eps)];
    const rExp = [Math.cos(yw), 0, -Math.sin(yw)]; // roll=0 时 right=[cy,0,-sy]
    const uExp = [
      rExp[1] * fExp[2] - rExp[2] * fExp[1],
      rExp[2] * fExp[0] - rExp[0] * fExp[2],
      rExp[0] * fExp[1] - rExp[1] * fExp[0],
    ];
    const f = p.forward(), r = p.right(), u = p.up();
    for (let i = 0; i < 3; i++) {
      expect(f[i]).toBeCloseTo(fExp[i], 6);
      expect(r[i]).toBeCloseTo(rExp[i], 6);
      expect(u[i]).toBeCloseTo(uExp[i], 6);
    }
  });
});

describe('Probe.steer 常规姿态', () => {
  it('dYaw 正值使机头右转（yaw 减小）', () => {
    const p = new Probe();
    p.steer(-0.5, 0, 0);
    expect(p.yaw).toBeCloseTo(0.5, 6);
  });
  it('dRoll 累积并回绕到 [-π, π]', () => {
    const p = new Probe();
    p.steer(0, 0, 3 * Math.PI);
    expect(Math.abs(p.roll)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});
