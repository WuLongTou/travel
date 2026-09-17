// 触屏虚拟控件：仅触屏设备装配（main 在 input.isTouch 时调用）。
// 左下虚拟摇杆 = 六向推进的平面四向（前/后/左/右）；右下加力/刹车为
// 按住生效、视角切换为点按；右上暂停按钮（触屏无键盘 Esc 的菜单入口）。
// 样式见 style.css「触屏虚拟控件」段（body.touch + .touch-controls）。
import type { Input } from '../core/input.js';

export interface TouchCallbacks {
  onPause: () => void;
  onViewCycle: () => void;
}

export function setupTouchControls(input: Input, cb: TouchCallbacks): void {
  const root = document.getElementById('touch-controls');
  if (!root) return;
  document.body.classList.add('touch');
  root.classList.remove('hidden'); // index.html 默认 hidden，桌面不闪现

  // ---- 虚拟摇杆：拖动写入 input.setJoystick，松手回中 ----
  const zone = root.querySelector<HTMLDivElement>('.joy-zone');
  const stick = root.querySelector<HTMLDivElement>('.joy-stick');
  if (zone && stick) {
    let joyId: number | null = null;
    const moveStick = (t: Touch): void => {
      const rect = zone.getBoundingClientRect();
      const max = rect.width / 2;
      let dx = (t.clientX - (rect.left + max)) / max;
      let dy = (t.clientY - (rect.top + rect.height / 2)) / max;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      input.setJoystick(dx, dy);
      stick.style.transform = `translate(${dx * max * 0.55}px, ${dy * max * 0.55}px)`;
    };
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (joyId !== null) return;
      const t = e.changedTouches[0];
      joyId = t.identifier;
      moveStick(t);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === joyId) moveStick(t);
      }
    }, { passive: false });
    const endJoy = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === joyId) {
          joyId = null;
          input.setJoystick(0, 0);
          stick.style.transform = '';
        }
      }
    };
    zone.addEventListener('touchend', endJoy);
    zone.addEventListener('touchcancel', endJoy);
  }

  // ---- 按住按钮：加力（Shift 语义）/ 刹车（X 语义）----
  const bindHold = (sel: string, action: 'boost' | 'brake') => {
    const el = root.querySelector<HTMLButtonElement>(sel);
    if (!el) return;
    const on = (e: Event) => {
      e.preventDefault();
      input.holds[action] = true;
      el.classList.add('active');
    };
    const off = () => {
      input.holds[action] = false;
      el.classList.remove('active');
    };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off);
    el.addEventListener('touchcancel', off);
    // 桌面也可用鼠标调试
    el.addEventListener('mousedown', on);
    window.addEventListener('mouseup', off);
  };
  bindHold('.btn-boost', 'boost');
  bindHold('.btn-brake', 'brake');

  // ---- 点按按钮：视角切换 / 暂停菜单（tap 合成 click 直接触发）----
  root.querySelector<HTMLButtonElement>('.btn-view')?.addEventListener('click', () => cb.onViewCycle());
  root.querySelector<HTMLButtonElement>('.btn-pause-touch')?.addEventListener('click', () => cb.onPause());
}
