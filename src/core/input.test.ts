import { describe, expect, it } from 'vitest';

// Node 环境最小 DOM stub：Input 构造器要挂 window/document/canvas 监听
const noop = () => {};
(globalThis as unknown as { window: unknown }).window = { addEventListener: noop };
(globalThis as unknown as { document: unknown }).document = { addEventListener: noop };
(globalThis as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false });

import { Input } from './input.js';

function makeInput(): Input {
  const canvas = { addEventListener: noop } as unknown as HTMLCanvasElement;
  return new Input(canvas);
}

describe('Input 触屏虚拟控件', () => {
  it('摇杆向量按死区合成为四向推进（上方=前进）', () => {
    const input = makeInput();

    input.setJoystick(0, -1); // 推杆向上 = 前进
    let a = input.poll();
    expect(input.actions.fwd).toBe(true);
    expect(input.actions.bwd).toBe(false);
    void a;

    input.setJoystick(0.9, 0); // 推杆向右 = 右移
    input.poll();
    expect(input.actions.right).toBe(true);
    expect(input.actions.fwd).toBe(false);

    input.setJoystick(0.2, -0.2); // 死区内 = 全部松开
    input.poll();
    expect(input.actions.fwd).toBe(false);
    expect(input.actions.right).toBe(false);

    input.setJoystick(0, 0); // 回中
    input.poll();
    expect(input.actions.fwd || input.actions.bwd || input.actions.left || input.actions.right).toBe(false);
  });

  it('摇杆推进构成人工干预，回中解除；加力按钮单独按住不构成干预', () => {
    const input = makeInput();

    input.setJoystick(0, -0.8);
    expect(input.isFlightIntervening()).toBe(true);
    expect(input.hasThrustInput()).toBe(true);

    input.setJoystick(0, 0);
    expect(input.isFlightIntervening()).toBe(false);
    expect(input.hasThrustInput()).toBe(false);

    input.holds.boost = true;
    expect(input.isFlightIntervening()).toBe(false); // 与 Shift 单独按住同规则
    input.poll();
    expect(input.actions.boost).toBe(true); // 但推力加力生效

    input.holds.boost = false;
    input.holds.brake = true;
    expect(input.isFlightIntervening()).toBe(true); // 刹车 = X 键语义，构成干预
    expect(input.hasThrustInput()).toBe(true);
  });
});
