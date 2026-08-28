// 音频引擎：Web Audio 频谱分析 + 节拍检测 + 合成示例音轨
// 提供 getLevels() -> { bass, mid, treble, beat, energy }，均为 0..1

const BPM = 140;
const BEAT = 60 / BPM; // 秒/拍
const LOOP_BARS = 8;
const LOOP_LEN = LOOP_BARS * 4 * BEAT; // 8 小节

// 生成一段电子乐循环（A 小调：Am F C G）
// 离线渲染成 AudioBuffer，之后循环播放
function synthesizeLoop(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(LOOP_LEN * sr);
  const buffer = ctx.createBuffer(2, len, sr);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);

  const chords = [
    [220.0, 261.63, 329.63],   // Am
    [174.61, 220.0, 261.63],   // F
    [130.81, 196.0, 261.63],   // C (C3 G3 C4)
    [196.0, 246.94, 293.66],   // G
  ];
  const rootFreq = [220.0, 174.61, 130.81, 196.0];

  const nChords = chords.length;
  const secPerChord = LOOP_LEN / nChords;

  function write(sampleIndex, v) {
    const i = Math.floor(sampleIndex);
    if (i >= 0 && i < len) {
      L[i] += v;
      R[i] += v * 0.9;
    }
  }

  for (let t = 0; t < LOOP_LEN; t += 1 / 200) { // 5ms 步长
    const s = t * sr;
    const chordIdx = Math.floor(t / secPerChord) % nChords;
    const chord = chords[chordIdx];
    const root = rootFreq[chordIdx];

    // --- kick：正弦扫频，每拍 ---
    const beatStart = t - (t % BEAT);
    const beatPhase = t - beatStart;
    if (beatPhase < 0.25) {
      const env = Math.exp(-beatPhase * 9);
      const f = 150 * Math.exp(-beatPhase * 7) + 45;
      write(s, Math.sin(2 * Math.PI * f * beatPhase) * env * 0.5);
      // hihat
      const n = Math.sin((beatPhase * 9000) * Math.PI * 2) * (1 - beatPhase * 30);
      if (beatPhase < 0.08) write(s, n * 0.12 * (1 - beatPhase * 12));
    }
    // 反拍 hihat（off-beat）
    const offPhase = t - ((t % BEAT) + BEAT / 2);
    if (offPhase > 0 && offPhase < 0.06) {
      const n = Math.sin(((t % BEAT) * 2 * 12000) * Math.PI) * (1 - offPhase * 20);
      write(s, n * 0.06);
    }

    // --- bass：锯齿波跟随根音，每拍跳一次 ---
    const saw = 2 * ((t * root) % 1) - 1;
    const bassEnv = Math.exp(-(t % BEAT) * 3.2);
    write(s, saw * bassEnv * 0.16);

    // --- pad：和弦长音（带轻微颤音）---
    const padEnv = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / secPerChord);
    for (const f of chord) {
      const vib = 1 + 0.002 * Math.sin(t * 6.28);
      write(s, Math.sin(2 * Math.PI * f * vib * t) * padEnv * 0.05);
      write(s, Math.sin(2 * Math.PI * f * 2.003 * t) * padEnv * 0.02);
    }

    // --- arp：16 分音符方波琶音 ---
    const step = BEAT / 4;
    const stepIdx = Math.floor(t / step);
    const arpNote = chord[stepIdx % 3] * (stepIdx % 8 < 4 ? 1 : 2);
    const stepPhase = t - stepIdx * step;
    if (stepPhase < 0.18) {
      const square = Math.sin(2 * Math.PI * arpNote * t) > 0 ? 1 : -1;
      write(s, square * 0.045 * Math.exp(-stepPhase * 16));
    }
  }

  // 归一化防削波
  let peak = 0;
  for (let i = 0; i < len; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  if (peak > 0.9) {
    const g = 0.9 / peak;
    for (let i = 0; i < len; i++) { L[i] *= g; R[i] *= g; }
  }
  return buffer;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.gain = null;
    this.playing = false;
    this.mode = 'none'; // 'synth' | 'file' | 'mic'
    this.buffer = null;
    this.stream = null;

    // 频谱数据
    this.freqs = new Uint8Array(512);
    // 节拍检测状态
    this.bassHist = [];
    this.lastBeatTime = -1;
  }

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.78;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.9;
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // 播放合成示例音轨
  async playSynth() {
    const ctx = this.ensureCtx();
    this.stopAll();
    if (!this.buffer) this.buffer = synthesizeLoop(ctx);
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.source.connect(this.analyser);
    this.source.start();
    this.playing = true;
    this.mode = 'synth';
  }

  // 播放上传的音频文件
  async playFile(file) {
    const ctx = this.ensureCtx();
    this.stopAll();
    const data = await file.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(data);
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.source.connect(this.analyser);
    this.source.start();
    this.playing = true;
    this.mode = 'file';
  }

  // 麦克风输入
  async playMic() {
    const ctx = this.ensureCtx();
    this.stopAll();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.source = ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    this.playing = true;
    this.mode = 'mic';
  }

  stopAll() {
    if (this.source) {
      try { this.source.stop(); } catch { /* 已停止 */ }
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.playing = false;
  }

  pause() {
    if (this.ctx) this.ctx.suspend();
    this.playing = false;
  }

  resume() {
    if (this.ctx) this.ctx.resume();
    this.playing = true;
  }

  destroy() {
    this.stopAll();
    if (this.ctx) this.ctx.close();
  }

  // 归一化频段能量
  getLevels() {
    if (!this.analyser || !this.playing) {
      return { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 };
    }
    this.analyser.getByteFrequencyData(this.freqs);
    const n = this.freqs.length; // 512，覆盖 0 ~ 24kHz（Nyquist）
    const nyq = this.ctx.sampleRate / 2;
    function band(lo, hi) {
      let sum = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
        const f = (i / n) * nyq;
        if (f >= lo && f < hi) { sum += this.freqs[i]; cnt++; }
      }
      return cnt ? sum / cnt / 255 : 0;
    }
    const bass = band.call(this, 20, 240);
    const mid = band.call(this, 240, 2400);
    const treble = band.call(this, 2400, 9000);
    const energy = (bass * 0.5 + mid * 0.3 + treble * 0.2);

    // 节拍检测：bass 能量超过滑动均值 1.35 倍且距上次 ≥ 250ms
    this.bassHist.push(bass);
    if (this.bassHist.length > 24) this.bassHist.shift();
    const avg = this.bassHist.reduce((s, v) => s + v, 0) / this.bassHist.length;
    const now = this.ctx.currentTime;
    let beat = 0;
    if (bass > avg * 1.35 && bass > 0.12 && now - this.lastBeatTime > 0.25) {
      this.lastBeatTime = now;
      beat = Math.min(1, (bass - avg * 1.35) * 6);
    }
    return { bass, mid, treble, beat, energy };
  }
}
