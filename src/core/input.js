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

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    // 飞船动作语义：每帧由 main 计算
    this.actions = { fwd: false, bwd: false, left: false, right: false, up: false, down: false, boost: false };
    this.steer = { dx: 0, dy: 0 }; // 每帧累计的视角转向（像素）
    this.pan = { dx: 0, dy: 0 };   // 每帧累计的视角平移位移（像素）
    this.buttons = new Set();      // 按下的鼠标键集合 (0: 左键, 1: 中键, 2: 右键)
    this.mouseDown = false;
    this.mouse = { x: 0, y: 0 };
    this.dragged = false; // 左键按住期间拖拽是否超过点击阈值（抑制松手误拾取）
    this._dragDist = 0;
    this.pointerLocked = false;
    this.onLockChange = null; // UI 提示回调
    const kd = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if ([' ', 'w', 'a', 's', 'd', 'q', 'e', 'c', 'g', 'r', 'x', 'v', 'z', 't', 'm', 'o',
        'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'f',
        '[', ']', '\\', 'tab', 'backspace'].includes(k)) {
        e.preventDefault();
        this.keys.add(k);
      }
    };
    const ku = (e) => this.keys.delete(e.key.toLowerCase());
    const blur = () => { this.keys.clear(); this.buttons.clear(); this.mouseDown = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);

    // 禁用右键菜单以支持右键自由平移拖拽
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const md = (e) => {
      this.buttons.add(e.button);
      // 每次按下刷新拖拽起点并重置拖拽标记：指针锁定期间 mouse 不更新，
      // 不刷新会让解锁后/首次拖拽的第一帧位移从陈旧起点累计成巨量跳变
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 0) {
        this.dragged = false;
        this._dragDist = 0;
        // 未锁定时：首次左键点击请求指针锁定（游戏惯例）；锁定状态下左键仅用于拾取
        if (!this.pointerLocked && canvas.requestPointerLock) {
          const pr = canvas.requestPointerLock();
          if (pr && pr.catch) pr.catch(() => {});
        }
        this.mouseDown = true;
      }
    };
    const mm = (e) => {
      const isPan = this.buttons.has(2) || this.buttons.has(1); // 按住右键或中键即为平移
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
        } else if (this.mouseDown) {
          this.steer.dx += dx;
          this.steer.dy += dy;
          // 累计左键拖拽距离：超过 5px 判定为拖拽环视而非点击（松手时
          // click 事件据此抑制天体拾取，防止拖拽看风景误锁目标）
          this._dragDist += Math.hypot(dx, dy);
          if (this._dragDist > 5) this.dragged = true;
        }
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      }
    };
    const mu = (e) => {
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
    this._clear = () => { this.steer.dx = 0; this.steer.dy = 0; this.pan.dx = 0; this.pan.dy = 0; };
  }

  // 每帧开头调用：从 keys 合成动作，并消费 steer 和 pan
  poll() {
    const a = this.actions;
    a.fwd = this.keys.has('w') || this.keys.has('arrowup');
    a.bwd = this.keys.has('s') || this.keys.has('arrowdown');
    a.left = this.keys.has('a') || this.keys.has('arrowleft');
    a.right = this.keys.has('d') || this.keys.has('arrowright');
    // 上浮/下沉：Space 上、C 下（Q/E 让位给横滚；Shift 只做加力，不再复用为下沉）
    a.up = this.keys.has(' ');
    a.down = this.keys.has('c');
    a.boost = this.keys.has('shift');
    a.rollL = this.keys.has('q');
    a.rollR = this.keys.has('e');
    const sd = this.steer.dx, sdy = this.steer.dy;
    const pd = this.pan.dx, pdy = this.pan.dy;
    this.steer.dx = 0; this.steer.dy = 0;
    this.pan.dx = 0; this.pan.dy = 0;
    return { steerX: sd, steerY: sdy, panX: pd, panY: pdy };
  }

  // 严格仅对「飞行操控类」操作判断用户是否正在进行人工干预
  isFlightIntervening() {
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
  hasThrustInput() {
    return this.keys.has('w') || this.keys.has('s') || this.keys.has('a') || this.keys.has('d') ||
           this.keys.has('arrowup') || this.keys.has('arrowdown') || this.keys.has('arrowleft') || this.keys.has('arrowright') ||
           this.keys.has(' ') || this.keys.has('c') || this.keys.has('x');
  }

  // 手柄轮询（标准映射，含 18% 摇杆死区）：
  //   左摇杆=六向推进平移 · RT=加力 · LT=上升 · LB=下降 · RB=反推刹车
  //   右摇杆=环视 · Y=切换视角 · Start=暂停
  // 无手柄返回 null。dtReal 供右摇杆折算成像素增量（与鼠标环视同管线）。
  pollGamepad(dtReal) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && (pads[0] || [...pads].find((p) => p && p.connected));
    if (!pad) return null;
    const dz = (v) => (Math.abs(v) > 0.18 ? v : 0);
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
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
    };
  }
}
