// UI 覆盖层状态机：title → playing ⇄ pause-menu / victory
// 纯逻辑无 DOM：视图切换与输入隔离经回调注入（ui/controller + main 装配），
// 状态转换与「时钟暂停态恢复」语义集中在此，可被 Vitest 直接单测。
//
// 暂停语义：进入 pause-menu / victory 时记录时钟暂停态并强制冻结，
// 离开时恢复原状（保留 \ 键手动暂停跨菜单存续）；回到 title 同样恢复
// （标题画面下游戏以吸引模式在背景继续跑）。

export type UiState = 'title' | 'playing' | 'pause-menu' | 'victory';

/** 合法转换表：from → 允许的 to 集合 */
const TRANSITIONS: Record<UiState, Partial<Record<UiState, string>>> = {
  title: { playing: 'start' },
  playing: { 'pause-menu': 'openPauseMenu', victory: 'showVictory', title: 'backToTitle' },
  'pause-menu': { playing: 'resume', title: 'backToTitle' },
  victory: { playing: 'dismissVictory' },
};

export interface UiStateMachineOptions {
  /** 最小时钟接口（SimClock 结构子集） */
  clock: { paused: boolean };
  /** 进入某状态后回调（视图显隐/输入隔离等副作用） */
  onEnter?: (state: UiState) => void;
  /** 离开某状态前回调 */
  onExit?: (state: UiState) => void;
}

export class UiStateMachine {
  private state: UiState = 'title';
  private pausedBefore = false;
  private readonly opts: UiStateMachineOptions;

  constructor(opts: UiStateMachineOptions) {
    this.opts = opts;
    this.opts.onEnter?.(this.state);
  }

  get current(): UiState {
    return this.state;
  }

  /** 覆盖层是否激活（非 playing 即冻结语义：按键隔离由 main 依据此值执行） */
  get overlayActive(): boolean {
    return this.state !== 'playing';
  }

  /** 通用转换入口：非法转换返回 false（幂等守卫，调用方无需预检） */
  transition(to: UiState): boolean {
    const action = TRANSITIONS[this.state][to];
    if (!action) return false;
    const from = this.state;
    this.suspendIfNeeded(from, to);
    this.opts.onExit?.(from);
    this.state = to;
    this.opts.onEnter?.(to);
    return true;
  }

  start(): boolean {
    return this.transition('playing');
  }

  openPauseMenu(): boolean {
    return this.transition('pause-menu');
  }

  resume(): boolean {
    return this.transition('playing');
  }

  backToTitle(): boolean {
    return this.transition('title');
  }

  showVictory(): boolean {
    return this.transition('victory');
  }

  dismissVictory(): boolean {
    return this.transition('playing');
  }

  // 进入冻结态（暂停菜单/结算）前记录时钟暂停态并冻结；
  // 离开冻结态（回 playing 或 title——标题画面下吸引模式继续跑）时恢复
  private static readonly FREEZE_STATES: readonly UiState[] = ['pause-menu', 'victory'];

  private suspendIfNeeded(from: UiState, to: UiState): void {
    const freeze = UiStateMachine.FREEZE_STATES;
    if (!freeze.includes(from) && freeze.includes(to)) {
      this.pausedBefore = this.opts.clock.paused;
      this.opts.clock.paused = true;
    } else if (freeze.includes(from) && !freeze.includes(to)) {
      this.opts.clock.paused = this.pausedBefore;
    }
  }
}
