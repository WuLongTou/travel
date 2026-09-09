// 键盘/鼠标输入状态（飞船与 UI 共用）
// 游戏式视角：点击画面锁定指针（Pointer Lock），移动鼠标即转向（俯仰/偏航），
// ESC 释放；未锁定时保留「按住拖拽」兼容操作。
// 游戏标准键位：W/S 前进/后退 · A/D 左右平移 · Space/C 上浮/下沉 ·
// Q/E 左右横滚 · Shift 加力 · X 刹车 · V 切换视角 · G 引力模式 ·
// H 自动驾驶（选中目标寻的；无目标=旅行者式自由航行） · F 下潜
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
}
