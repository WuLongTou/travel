// 键盘/鼠标输入状态（探测球与 UI 共用）
// 视角：Pointer Lock 惯例——点击画面锁定指针，移动鼠标即转向（无需按住），
// ESC 释放；未锁定时保留「按住拖拽」兼容操作。
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    // 探测球动作语义：每帧由 main 计算
    this.actions = { fwd: false, bwd: false, left: false, right: false, up: false, down: false, dive: false, boost: false };
    this.steer = { dx: 0, dy: 0 }; // 每帧累计的视角转向（像素）
    this.mouseDown = false;
    this.mouse = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.onLockChange = null; // UI 提示回调
    const kd = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if ([' ', 'w', 'a', 's', 'd', 'q', 'e', 'g', 'r', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'f'].includes(k)) {
        e.preventDefault();
        this.keys.add(k);
      }
    };
    const ku = (e) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    const md = () => {
      // 未锁定时：首次点击请求指针锁定（游戏惯例）；锁定状态下 mousedown 仅用于拾取
      if (!this.pointerLocked && canvas.requestPointerLock) {
        // 新版 Chrome 返回 Promise，拒绝时（如 headless/权限）静默降级为拖拽
        const pr = canvas.requestPointerLock();
        if (pr && pr.catch) pr.catch(() => {});
      }
      this.mouseDown = true;
    };
    const mm = (e) => {
      if (this.pointerLocked) {
        // 锁定态：移动即转向（无需按住）
        this.steer.dx += e.movementX || 0;
        this.steer.dy += e.movementY || 0;
      } else if (this.mouseDown) {
        this.steer.dx += e.clientX - this.mouse.x;
        this.steer.dy += e.clientY - this.mouse.y;
      }
      if (!this.pointerLocked) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
    };
    const mu = () => { this.mouseDown = false; };
    const plc = () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    };
    canvas.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    document.addEventListener('pointerlockchange', plc);
    this._clear = () => { this.steer.dx = 0; this.steer.dy = 0; };
  }

  // 每帧开头调用：从 keys 合成动作，并消费 steer
  poll() {
    const a = this.actions;
    a.fwd = this.keys.has('w') || this.keys.has('arrowup');
    a.bwd = this.keys.has('s') || this.keys.has('arrowdown');
    a.left = this.keys.has('a') || this.keys.has('arrowleft');
    a.right = this.keys.has('d') || this.keys.has('arrowright');
    a.up = this.keys.has('q') || this.keys.has(' ');
    a.down = this.keys.has('e') || this.keys.has('shift');
    a.dive = this.keys.has('f');
    a.boost = this.keys.has('shift'); // 视世界而定（boost 与 down 冲突，由 main 决定）
    const sd = this.steer.dx, sdy = this.steer.dy;
    this.steer.dx = 0; this.steer.dy = 0;
    return { steerX: sd, steerY: sdy };
  }
}
