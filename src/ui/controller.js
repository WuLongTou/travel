// UI 控制器：精简游戏 HUD（顶栏面包屑 / 飞行仪表 / 信息卡 / 操控提示）
import { WORLD_DEFS } from '../content/schema.js';

export class UI {
  constructor(engine, callbacks) {
    this.cb = callbacks || {};
    this.el = {};
    const ids = ['crumb','infocard','info-title','info-sub',
      'info-facts','info-text','info-actions','info-close','info-schematic',
      'hud-speed','hud-dist','hud-clock','hud-mode','hud-rate','hud-scale',
      'fade','loading','controls-hint'];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this._bindInfoClose();
    this._setupHintToggle();
  }

  _bindInfoClose() {
    this.el['info-close'].addEventListener('click', () => this.hideInfo());
  }

  // 操控提示：首次进入 8 秒后淡出，Tab 键可重新显示
  _setupHintToggle() {
    const hint = this.el['controls-hint'];
    if (!hint) return;
    this._hintTimer = setTimeout(() => { hint.classList.add('fade-out'); }, 8000);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (hint.classList.contains('fade-out')) {
          hint.classList.remove('fade-out');
          clearTimeout(this._hintTimer);
          this._hintTimer = setTimeout(() => { hint.classList.add('fade-out'); }, 6000);
        } else {
          hint.classList.add('fade-out');
        }
      }
    });
  }

  // ---- 顶栏 ----
  setCrumb(curIdx) {
    const c = this.el['crumb'];
    c.innerHTML = '';
    WORLD_DEFS.forEach((w, i) => {
      if (i > 0) {
        const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '›';
        c.appendChild(sep);
      }
      const item = document.createElement(i === curIdx ? 'b' : 'a');
      item.textContent = w.short;
      item.style.textDecoration = 'none';
      item.style.color = 'inherit';
      if (i !== curIdx) {
        item.style.cursor = 'pointer';
        item.style.opacity = '0.55';
        item.addEventListener('click', (e) => { e.preventDefault(); this.cb.onNav && this.cb.onNav(w.id); });
        item.addEventListener('mouseenter', () => { item.style.opacity = '1'; });
        item.addEventListener('mouseleave', () => { item.style.opacity = '0.55'; });
      }
      c.appendChild(item);
    });
  }

  // ---- HUD 飞行仪表 ----
  setHud({ speedText, distText, modeText }) {
    if (this.el['hud-speed']) this.el['hud-speed'].textContent = speedText;
    if (this.el['hud-dist']) this.el['hud-dist'].textContent = distText;
    if (this.el['hud-mode'] && modeText !== undefined) this.el['hud-mode'].textContent = modeText;
  }
  setTimeHud({ clockLabel, rateLabel }) {
    if (this.el['hud-clock']) this.el['hud-clock'].textContent = clockLabel;
    if (this.el['hud-rate']) this.el['hud-rate'].textContent = rateLabel;
  }
  setScaleHud(text) {
    if (this.el['hud-scale']) this.el['hud-scale'].textContent = text;
  }

  // ---- 信息卡 ----
  showInfo(entity) {
    const d = entity;
    if (!d || !d.info) return;
    const info = d.info;
    this.el['info-title'].textContent = d.name + (d.en ? ` · ${d.en}` : '');
    this.el['info-sub'].textContent = info.sub || '';
    const facts = this.el['info-facts'];
    facts.innerHTML = '';
    for (const [k, v] of (info.facts || [])) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      row.appendChild(dt); row.appendChild(dd);
      facts.appendChild(row);
    }
    const txt = this.el['info-text'];
    txt.textContent = info.text || '';
    this.el['info-schematic'].classList.toggle('hidden', !d.schematic);
    // 操作区
    const acts = this.el['info-actions'];
    acts.innerHTML = '';
    if (d.dive) {
      const b = document.createElement('button');
      b.textContent = `进入${d.dive.targetName || d.dive.toWorld}`;
      b.addEventListener('click', () => this.cb.onDiveTo && this.cb.onDiveTo(d));
      acts.appendChild(b);
    }
    this.el['infocard'].classList.remove('hidden');
  }
  hideInfo() {
    this.el['infocard'].classList.add('hidden');
    if (this.cb.onInfoClose) this.cb.onInfoClose();
  }

  // ---- 转场 ----
  fadeOut(done) {
    const el = this.el['fade'];
    el.classList.remove('hidden');
    // 强制重排后再添加 show 类触发 transition
    el.offsetHeight;
    el.classList.add('show');
    setTimeout(done, 300);
  }
  fadeIn() {
    const el = this.el['fade'];
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 350);
  }
  showLoading(text) { this.el['loading'].textContent = text; this.el['loading'].classList.remove('hidden'); }
  hideLoading() { this.el['loading'].classList.add('hidden'); }
}
