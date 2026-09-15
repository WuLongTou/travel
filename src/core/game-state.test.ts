// UI 状态机单测：转换合法性 + 时钟暂停态恢复（Vitest）
import { describe, it, expect } from 'vitest';
import { UiStateMachine } from './game-state.js';

/** 构造带假时钟的状态机 + 事件记录 */
function make() {
  const clock = { paused: false };
  const events: string[] = [];
  const sm = new UiStateMachine({
    clock,
    onEnter: (s) => events.push(`enter:${s}`),
    onExit: (s) => events.push(`exit:${s}`),
  });
  return { sm, clock, events };
}

describe('初始态', () => {
  it('以 title 起始且覆盖层激活（标题即覆盖层）', () => {
    const { sm } = make();
    expect(sm.current).toBe('title');
    expect(sm.overlayActive).toBe(true);
  });
});

describe('title → playing', () => {
  it('start 解锁并恢复时钟', () => {
    const { sm, clock } = make();
    expect(sm.start()).toBe(true);
    expect(sm.current).toBe('playing');
    expect(sm.overlayActive).toBe(false);
    expect(clock.paused).toBe(false);
  });
  it('重复 start 非法', () => {
    const { sm } = make();
    sm.start();
    expect(sm.start()).toBe(false);
  });
});

describe('playing ⇄ pause-menu', () => {
  it('开菜单冻结时钟，继续恢复', () => {
    const { sm, clock } = make();
    sm.start();
    expect(sm.openPauseMenu()).toBe(true);
    expect(clock.paused).toBe(true);
    expect(sm.resume()).toBe(true);
    expect(clock.paused).toBe(false);
  });
  it('保留手动暂停：开菜单前已暂停的，继续后仍暂停', () => {
    const { sm, clock } = make();
    sm.start();
    clock.paused = true; // \ 键暂停
    sm.openPauseMenu();
    sm.resume();
    expect(clock.paused).toBe(true);
  });
  it('playing 直接 resume 非法', () => {
    const { sm } = make();
    sm.start();
    expect(sm.resume()).toBe(false);
  });
});

describe('pause-menu → title（回到标题）', () => {
  it('恢复时钟（吸引模式继续）并回到 title', () => {
    const { sm, clock } = make();
    sm.start();
    sm.openPauseMenu();
    expect(sm.backToTitle()).toBe(true);
    expect(sm.current).toBe('title');
    expect(clock.paused).toBe(false);
  });
  it('victory 下不能直接回标题', () => {
    const { sm } = make();
    sm.start();
    sm.showVictory();
    expect(sm.backToTitle()).toBe(false);
  });
});

describe('playing → victory → playing', () => {
  it('结算冻结、关闭恢复', () => {
    const { sm, clock } = make();
    sm.start();
    expect(sm.showVictory()).toBe(true);
    expect(clock.paused).toBe(true);
    expect(sm.dismissVictory()).toBe(true);
    expect(clock.paused).toBe(false);
  });
  it('victory 下禁止开菜单', () => {
    const { sm } = make();
    sm.start();
    sm.showVictory();
    expect(sm.openPauseMenu()).toBe(false);
  });
});

describe('回调时序', () => {
  it('exit 先于 enter', () => {
    const { sm, events } = make();
    sm.start();
    expect(events).toEqual(['enter:title', 'exit:title', 'enter:playing']);
  });
});
