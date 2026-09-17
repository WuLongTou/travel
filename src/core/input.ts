// 手柄快照（pollGamepad 返回值）
export interface GamepadState {
  fwd: boolean; bwd: boolean; left: boolean; right: boolean;
  up: boolean; down: boolean; boost: boolean; brake: boolean;
  viewX: number; viewY: number;
  viewCycle: boolean; pause: boolean;
  dpadUp: boolean; dpadDown: boolean; confirm: boolean; back: boolean;
}

// =================================================================
// 操作分类体系（Operation Categories）
// 只有 FLIGHT_CONTROL 类别下的操作才被判定为用户正在对飞行器进行人工干预；
// CAMERA_VIEW、TIME_FLOW、SYSTEM 类别绝不判定为干预，不影响全自动航行。
// =================================================================
export const OP_CATEGORIES = {
  FLIGHT_CONTROL: 'flight_control', // 飞行操控类（推进、平移、升降、滚转、反推制动）-> 属于人工干预
  CAMERA_VIEW: 'camera_view',       // 观察视角类（鼠标环视、平移、缩放、重置、模式切换）-> 非干预
  TIME_FLOW: 'time_flow',           // 时间流速类（加速、减速、暂停继续）-> 非干预
  SYSTEM: 'system',                 // 系统辅助类（安全轨道重置、天体拾取）-> 非干预
};

// 飞行操控键集（严格仅此类按键触发飞行人工干预）
export const FLIGHT_CONTROL_KEYS = new Set([
  'w', 's', 'a', 'd',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  ' ', 'c',          // 垂直升降（Space 上浮 / C 下沉）
  'q', 'e',          // 机身横滚（Q 左滚 / E 右滚）
  'x',               // 反推制动刹车
  'shift',           // 加力推进
]);

export interface ShipActions {
  fwd: boolean; bwd: boolean; left: boolean; right: boolean;
  up: boolean; down: boolean; boost: boolean; rollL: boolean; rollR: boolean;
}

export class Input {
  canvas: HTMLCanvasElement;
  keys = new Set<string>();
  // 飞船动作语义：每帧由 main 计算
  actions: ShipActions = { fwd: false, bwd: false, left: false, right: false, up: false, down: false, boost: false, rollL: false, rollR: false };
  steer = { dx: 0, dy: 0 }; // 每帧累计的视角转向（像素）
  pan = { dx: 0, dy: 0 };   // 每帧累计的视角平移位移（像素）
  buttons = new Set<number>(); // 按下的鼠标键集合 (0: 左键, 1: 中键, 2: 右键)
  // 右键按住 = 直接掌舵：鼠标增量不经环视相机、直接转机头（松开回环视）。
  // 掌舵属飞行操控类操作（构成人工干预），由 isFlightIntervening 计入
  get steerHold(): boolean { return this.buttons.has(2); }
  mouseDown = false;
  mouse = { x: 0, y: 0 };
  dragged = false; // 左键按住期间拖拽是否超过点击阈值（抑制松手误拾取）
  private _dragDist = 0;
  pointerLocked = false;
  onLockChange: ((locked: boolean) => void) | null = null; // UI 提示回调

  // ---- 触屏 ----
  // 粗指针（手机/平板）或无精确指针的触屏设备；触屏本有 fine 指针，
  // 判为桌面（键鼠照常，不显示虚拟控件）。URL 带 ?touch 可在任何设备
  // 强制触屏模式（自动化测试 / 桌面预览虚拟控件布局）
  readonly isTouch: boolean =
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('touch')) ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
    (navigator.maxTouchPoints > 0 && !(typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches));
  // 双指捏合缩放回调（factor = 上次指距/当前指距，>1 拉远、<1 拉近，
  // 与滚轮 deltaY 的拉远方向约定一致）；上帝视角由 main 转为移速档调节
  onPinchZoom: ((factor: number) => void) | null = null;
  // 虚拟按住按钮状态（右下按钮写入，语义 = Shift 加力 / X 刹车）
  holds = { boost: false, brake: false };
  // 虚拟摇杆向量，归一化 [-1,1]（屏幕上方 = 前进）
  private joy = { x: 0, y: 0 };
  // canvas 上的活动手指（单指=环视，双指=捏合）
  private touchPts = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private touchDragDist = 0;

  // 摇杆死区：actions 是布尔语义，按比例阈值合成为四向
  private static readonly JOY_DEAD = 0.35;

  /** 虚拟摇杆写入（ui/touch.ts 摇杆拖动调用；回中传 0,0） */
  setJoystick(x: number, y: number): void {
    this.joy.x = Math.max(-1, Math.min(1, x));
    this.joy.y = Math.max(-1, Math.min(1, y));
  }

  private joyActive(): boolean {
    return this.joy.x < -Input.JOY_DEAD || this.joy.x > Input.JOY_DEAD
      || this.joy.y < -Input.JOY_DEAD || this.joy.y > Input.JOY_DEAD;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const kd = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if ([' ', 'w', 'a', 's', 'd', 'q', 'e', 'c', 'g', 'r', 'x', 'v', 'z', 't', 'm', 'o',
        'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'f',
        '[', ']', '\\', 'tab', 'backspace', 'escape'].includes(k)) {
        e.preventDefault();
        this.keys.add(k);
      }
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => {
      this.keys.clear();
      this.buttons.clear();
      this.mouseDown = false;
      // 触屏虚拟控件同样随失焦释放（按住加力时切后台，回来不该还在推进）
      this.holds.boost = false;
      this.holds.brake = false;
      this.setJoystick(0, 0);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);

    // 禁用右键菜单以支持右键自由平移拖拽
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const md = (e: MouseEvent) => {
      this.buttons.add(e.button);
      // 每次按下刷新拖拽起点并重置拖拽标记：指针锁定期间 mouse 不更新，
      // 不刷新会让解锁后/首次拖拽的第一帧位移从陈旧起点累计成巨量跳变
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 0) {
        this.dragged = false;
        this._dragDist = 0;
        // 未锁定时：首次左键点击请求指针锁定（游戏惯例）；锁定状态下左键仅用于拾取。
        // 触屏无指针锁定概念，跳过（tap 合成的 mousedown 会走到这里）
        if (!this.isTouch && !this.pointerLocked && canvas.requestPointerLock) {
          const pr = canvas.requestPointerLock();
          if (pr && pr.catch) pr.catch(() => {});
        }
        this.mouseDown = true;
      }
    };
    const mm = (e: MouseEvent) => {
      const isPan = this.buttons.has(1); // 中键按住=平移视角（右键让位给直接掌舵）
      if (this.pointerLocked) {
        if (isPan) {
          this.pan.dx += e.movementX || 0;
          this.pan.dy += e.movementY || 0;
        } else {
          this.steer.dx += e.movementX || 0;
          this.steer.dy += e.movementY || 0;
        }
      } else {
        const dx = e.clientX - this.mouse.x;
        const dy = e.clientY - this.mouse.y;
        if (isPan) {
          this.pan.dx += dx;
          this.pan.dy += dy;
        } else if (this.mouseDown || this.steerHold) {
          this.steer.dx += dx;
          this.steer.dy += dy;
          // 累计左键拖拽距离：超过 5px 判定为拖拽环视而非点击（松手时
          // click 事件据此抑制天体拾取，防止拖拽看风景误锁目标）
          if (this.mouseDown) {
            this._dragDist += Math.hypot(dx, dy);
            if (this._dragDist > 5) this.dragged = true;
          }
        }
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      }
    };
    const mu = (e: MouseEvent) => {
      this.buttons.delete(e.button);
      if (e.button === 0) this.mouseDown = false;
    };
    const plc = () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    };
    canvas.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    document.addEventListener('pointerlockchange', plc);

    // ---- 触屏手势 ----
    // 单指拖动=环视（与鼠标左键拖拽同管线、同非干预语义）；双指捏合=缩放；
    // 纯 tap 不拦截也不置 dragged，让浏览器合成 click 走天体拾取。
    // touchmove preventDefault 抑制页面滚动与合成 mousemove（canvas 的
    // touch-action:none 是 CSS 侧双保险）
    const touchList = (e: TouchEvent) => Array.from(e.changedTouches);
    const pinchCurrent = (): number => {
      const pts = [...this.touchPts.values()];
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };
    const ts = (e: TouchEvent) => {
      for (const t of touchList(e)) {
        this.touchPts.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (this.touchPts.size === 1) {
        // 新单指：重置拖拽计数（拖超阈值置 dragged 抑制松手合成 click 误拾取）
        this.touchDragDist = 0;
        this.dragged = false;
      } else if (this.touchPts.size >= 2) {
        // 进入捏合：终止环视并抑制松手误拾取；以当前两指间距重新基准化
        //（覆盖 3 指→抬 1 指回到捏合等边界，避免用陈旧间距算出巨幅因子）
        this.dragged = true;
        this.pinchDist = pinchCurrent();
      }
    };
    const tm = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of touchList(e)) {
        const p = this.touchPts.get(t.identifier);
        if (!p) continue;
        if (this.touchPts.size === 1) {
          const dx = t.clientX - p.x;
          const dy = t.clientY - p.y;
          this.steer.dx += dx;
          this.steer.dy += dy;
          this.touchDragDist += Math.hypot(dx, dy);
          if (this.touchDragDist > 5) this.dragged = true;
        }
        p.x = t.clientX;
        p.y = t.clientY;
      }
      if (this.touchPts.size === 2) {
        const d = pinchCurrent();
        if (this.pinchDist > 0 && d > 0) {
          // 单次事件限幅，避免抬指/落指瞬间距离突变造成视距跳变
          this.onPinchZoom?.(Math.min(1.15, Math.max(0.87, this.pinchDist / d)));
        }
        this.pinchDist = d;
      }
    };
    const te = (e: TouchEvent) => {
      for (const t of touchList(e)) this.touchPts.delete(t.identifier);
      // 回到两指：重新基准化捏合间距；不足两指：清除捏合状态
      if (this.touchPts.size === 2) this.pinchDist = pinchCurrent();
      else if (this.touchPts.size < 2) this.pinchDist = 0;
    };
    canvas.addEventListener('touchstart', ts, { passive: true });
    canvas.addEventListener('touchmove', tm, { passive: false });
    canvas.addEventListener('touchend', te);
    canvas.addEventListener('touchcancel', te);
  }


  // 每帧开头调用：从 keys + 触屏虚拟控件合成动作，并消费 steer 和 pan
  poll(): { steerX: number; steerY: number; panX: number; panY: number } {
    const a = this.actions;
    const J = Input.JOY_DEAD;
    a.fwd = this.keys.has('w') || this.keys.has('arrowup') || this.joy.y < -J;
    a.bwd = this.keys.has('s') || this.keys.has('arrowdown') || this.joy.y > J;
    a.left = this.keys.has('a') || this.keys.has('arrowleft') || this.joy.x < -J;
    a.right = this.keys.has('d') || this.keys.has('arrowright') || this.joy.x > J;
    // 上浮/下沉：Space 上、C 下（Q/E 让位给横滚；Shift 只做加力，不再复用为下沉）
    a.up = this.keys.has(' ');
    a.down = this.keys.has('c');
    a.boost = this.keys.has('shift') || this.holds.boost;
    a.rollL = this.keys.has('q');
    a.rollR = this.keys.has('e');
    const sd = this.steer.dx, sdy = this.steer.dy;
    const pd = this.pan.dx, pdy = this.pan.dy;
    this.steer.dx = 0; this.steer.dy = 0;
    this.pan.dx = 0; this.pan.dy = 0;
    return { steerX: sd, steerY: sdy, panX: pd, panY: pdy };
  }

  // 严格仅对「飞行操控类」操作判断用户是否正在进行人工干预
  isFlightIntervening(): boolean {
    if (this.steerHold) return true; // 右键直接掌舵=飞行干预
    // 触屏：摇杆推进（=WASD 语义）与刹车按钮（=X 语义）构成干预；
    // 加力按钮单独按住不算（与 Shift 单独按住同规则：仅改推力不改变航线，
    // 摇杆推进 + 加力会经由摇杆判定为干预）
    if (this.joyActive() || this.holds.brake) return true;
    for (const key of FLIGHT_CONTROL_KEYS) {
      if (this.keys.has(key)) {
        // 单独按 Shift 且未按下任何方向或平移键时，不判定为飞行干预
        if (key === 'shift') {
          const hasThrust = this.keys.has('w') || this.keys.has('s') || this.keys.has('a') || this.keys.has('d') ||
                            this.keys.has('arrowup') || this.keys.has('arrowdown') || this.keys.has('arrowleft') || this.keys.has('arrowright') ||
                            this.keys.has(' ') || this.keys.has('c');
          if (!hasThrust) continue;
        }
        return true;
      }
    }
    return false;
  }

  // 是否存在「实际改变运动状态」的推进/刹车输入（纯横滚 Q/E 不算——用于决定是否解除目标锁定）
  hasThrustInput(): boolean {
    return this.keys.has('w') || this.keys.has('s') || this.keys.has('a') || this.keys.has('d') ||
           this.keys.has('arrowup') || this.keys.has('arrowdown') || this.keys.has('arrowleft') || this.keys.has('arrowright') ||
           this.keys.has(' ') || this.keys.has('c') || this.keys.has('x') ||
           this.joyActive() || this.holds.brake;
  }

  // 手柄轮询（标准映射，含 18% 摇杆死区）：
  //   左摇杆=六向推进平移 · RT=加力 · LT=上升 · LB=下降 · RB=反推刹车
  //   右摇杆=环视 · Y=切换视角 · Start=暂停菜单
  //   覆盖层（暂停菜单/结算）打开时：dpad 上下=移动焦点 · A=确认 · B=返回
  // 无手柄返回 null。dtReal 供右摇杆折算成像素增量（与鼠标环视同管线）。
  pollGamepad(dtReal: number): GamepadState | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && (pads[0] || [...pads].find((p) => p && p.connected)) || null;
    if (!pad) return null;
    const dz = (v: number) => (Math.abs(v) > 0.18 ? v : 0);
    const btn = (i: number) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const ax = pad.axes || [];
    const lx = dz(ax[0] || 0), ly = dz(ax[1] || 0);
    const rx = dz(ax[2] || 0), ry = dz(ax[3] || 0);
    const GAIN = 420; // 满杆 ≈ 420 px/s，与鼠标环视灵敏度同量级
    return {
      fwd: ly < 0, bwd: ly > 0,
      left: lx < 0, right: lx > 0,
      up: btn(6), down: btn(4), boost: btn(7), brake: btn(5),
      viewX: rx * GAIN * dtReal, viewY: ry * GAIN * dtReal,
      viewCycle: btn(3), pause: btn(9),
      dpadUp: btn(12), dpadDown: btn(13), confirm: btn(0), back: btn(1),
    };
  }
}
