// 程序化音效引擎（WebAudio 合成，零外部资源，与项目"程序化无素材"约定一致）：
//   - 引擎推进噪声（随油门/加力变化，低通滤波轰鸣）
//   - 任务完成琶音 / 泊车双音 / 撞毁爆响 / 跃迁扫频
// 浏览器自动播放策略：AudioContext 必须在用户手势后创建/恢复——main 在
// 首次 keydown/mousedown 时调用 ensure()。M 键随时静音。
export class SoundFX {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  volume = 0.5;         // 主音量 0..1（设置面板滑条持久化）
  private _engineGain: GainNode | null = null;   // 引擎噪声增益节点（供外部读电平）
  private _engineFilter: BiquadFilterNode | null = null;
  private _engineLevel = 0;     // 当前平滑油门 0..1
  private _ambGain: GainNode | null = null;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  // 首次用户手势后初始化；已存在则恢复挂起状态
  ensure(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this._buildEngine();
      this._buildAmbient();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 环境氛围垫底：双失谐正弦低音 + 慢速 LFO 呼吸滤波——太空的"空"
  // 用一条极低音量的持续声床表达（随 master 静音）
  private _buildAmbient(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this._ambGain = this.ctx.createGain();
    this._ambGain.gain.value = 0;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.05; // 20 秒一个呼吸周期
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(f.frequency);
    lfo.start(t);
    for (const freq of [55, 55.7]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const og = this.ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og).connect(f);
      osc.start(t);
    }
    f.connect(this._ambGain).connect(this.master);
    this._ambGain.gain.setTargetAtTime(0.05, t, 3); // 3 秒淡入
  }

  // 循环白噪声源 + 低通滤波 = 推进器轰鸣；电平由 setEngine 平滑驱动
  private _buildEngine(): void {
    if (!this.ctx || !this.master) return;
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this._engineFilter = this.ctx.createBiquadFilter();
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = 200;
    this._engineGain = this.ctx.createGain();
    this._engineGain.gain.value = 0;
    src.connect(this._engineFilter).connect(this._engineGain).connect(this.master);
    src.start();
  }

  // 油门 0..1（0=滑行静音），boost 时滤波抬频+增益加大，speedFrac
  // （当前速度/本层极速 0..1）再叠一层随速度升高的频率感
  setEngine(level: number, boost: boolean, speedFrac = 0): void {
    if (!this.ctx || !this._engineGain || !this._engineFilter) return;
    const t = this.ctx.currentTime;
    this._engineLevel += (level - this._engineLevel) * 0.15; // 平滑防咔哒
    this._engineGain.gain.setTargetAtTime(this._engineLevel * (boost ? 0.34 : 0.2), t, 0.08);
    this._engineFilter.frequency.setTargetAtTime(
      160 + this._engineLevel * (boost ? 420 : 160) + speedFrac * 260, t, 0.1);
  }

  // 单音（频率/时长/类型/峰值）：各提示音的积木
  private _tone(freq: number, dur: number, { type = 'sine', peak = 0.22, delay = 0 }: { type?: OscillatorType; peak?: number; delay?: number } = {}): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  chime(): void {  // 任务完成：上行三连音
    this._tone(784, 0.18, { peak: 0.16 });
    this._tone(988, 0.18, { peak: 0.16, delay: 0.09 });
    this._tone(1318, 0.34, { peak: 0.18, delay: 0.18 });
  }

  victory(): void {  // 通关凯旋：五音上行琶音收在大和弦长音（比任务 chime 更隆重）
    const seq = [523, 659, 784, 1046];
    seq.forEach((f, i) => this._tone(f, 0.22, { peak: 0.17, delay: i * 0.13 }));
    this._tone(1568, 0.9, { peak: 0.18, delay: seq.length * 0.13 });
  }

  dock(): void {  // 泊车/新发现：温暖双音
    this._tone(523, 0.22, { type: 'triangle', peak: 0.15 });
    this._tone(659, 0.3, { type: 'triangle', peak: 0.15, delay: 0.11 });
  }

  crash(): void { // 撞毁：噪声爆响 + 低频轰
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    this._tone(55, 0.7, { type: 'sine', peak: 0.4 });
  }

  warp(): void {  // 跃迁扫频：带通噪声 0.6s
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.6;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(220, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }
}
