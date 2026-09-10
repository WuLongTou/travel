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
    this.actions = { fwd: false, bwd: false, left: false, right: false, up: false, down: false, dive: false, boost: false };
    this.steer = { dx: 0, dy: 0 }; // 每帧累计的视角转向（像素）
    this.pan = { dx: 0, dy: 0 };   // 每帧累计的视角平移位移（像素）
    this.buttons = new Set();      // 按下的鼠标键集合 (0: 左键, 1: 中键, 2: 右键)
    this.mouseDown = false;
    this.mouse = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.onLockChange = null; // UI 提示回调
    const kd = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if ([' ', 'w', 'a', 's', 'd', 'q', 'e', 'c', 'g', 'r', 'x', 'v', 'h', 'z',
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
      if (e.button === 0) {
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
    a.dive = this.keys.has('f');
    a.boost = this.keys.has('shift');
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
}
