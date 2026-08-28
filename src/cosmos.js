// 宇宙大爆炸动态模拟
// 阶段 1：奇点爆发，物质以极高速度向四面八方喷射（清晰的爆炸闪光 + 冲击波 + 径向流线）。
// 阶段 2：暗物质晕逐个启动，粒子被引力俘获并螺旋下落。
// 阶段 3：从小到大依次形成行星 → 恒星 → 星团 → 星系 → 超星系团 → 超大质量黑洞。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- 模拟参数 ----------
const G = 16;
const EPS2 = 0.16;
const N_PARTICLES = 820;
const N_CLOUD_PARTICLES = 600;   // 远方的原初气体云粒子，分布在暗物质晕周围
const N_EJECTA_PARTICLES = N_PARTICLES - N_CLOUD_PARTICLES; // 从奇点喷出的可见高速喷流
const GRAVITY_START = 1.15;
const GRAVITY_FULL = 5.6;
const BASE_SPEED = 8.0;

// 暴胀：第一瞬间物质被推到很远，之后才在远方形成原子和宇宙网。
const SEED_R_MIN = 180;
const SEED_R_MAX = 900;
const EJECTA_SPEED_MIN = 90;
const EJECTA_SPEED_MAX = 190;
const PROBE_INITIAL_SPEED = 24;  // 小球只携带暴胀结束后的惯性速度

// 为了让航线上天体的引力拉扯足够明显，只增强小球感受到的引力强度；
// 不会改变物质粒子的物理。
const PROBE_GRAVITY_MULT = 2.0;

// 结构形成节奏：只有小球真正接近某个暗物质晕时，该晕才会被唤醒；
// 同一时间最多只允许一个系统在形成，避免“几秒内冒出一堆天体”。
// 唤醒半径要足够大、形成时间要足够短，保证小球在很远就能“看见”结构成形，
// 而不是贴近时才突然生成一个。
const SEED_AWAKEN_RADIUS = 220;
const FORMATION_SPACING = 1.5;

// 航线前沿动态生成：宇宙很空，所以每次只生成一个远处的「大系统」，
// 靠它巨大的引力范围（光年级）慢慢把小球拉过去，而不是贴脸生成。
// 引力影响半径会随形成进度不断扩张，所以小球很早就能被偏转。
const FRONTIER_INTERVAL = 5.5;
const FRONTIER_DIST_MIN = 220;
const FRONTIER_DIST_MAX = 420;
// 多级 LOD：随距离阶梯式把大系统的内部细节真实化
const LOD_FAR = 1.0;        // 远景（光晕/盘面）
const LOD_MID = 0.7;        // 进入 R*0.7 出现旋臂亮点
const LOD_NEAR = 0.4;       // 进入 R*0.4 出现大量恒星 / 中心核
const LOD_INNER = 0.18;     // 进入 R*0.18 出现行星 / 尘埃
// 虫洞参数已实例化为 sim.config（可经 UI 滑杆实时调整），默认值见构造函数

const CLASS_DEFS = [
  { key: 'small',  name: '小质量晕', count: 24, durBase: 3, durSpan: 1, massMin: 0.13, massMax: 0.24 },
  { key: 'medium', name: '中等质量晕', count: 18, durBase: 4.5, durSpan: 1.5, massMin: 0.32, massMax: 0.60 },
  { key: 'large',  name: '大质量晕', count: 12, durBase: 6, durSpan: 2, massMin: 0.85, massMax: 1.55 },
  { key: 'giant',  name: '巨质量晕', count: 8,  durBase: 7.5, durSpan: 2.5, massMin: 2.30, massMax: 3.80 },
];

// 主角小球是一艘没有预定航线的自由探测器：只受引力和气体阻尼影响。
const PROBE_DRAG = 0.4;           // 进入天体系统后的星际气体阻尼（越接近系统越慢，像“抵达”）
const PROBE_IGM_DRAG = 0.004;     // 星系际介质极微弱阻尼，防止无限加速后飞离可视宇宙
const PROBE_RESPAWN_SPEED = 30.0; // 重生时从系统边缘获得的初始速度（足够逃出大系统的引力场）
const PROBE_MAX_SPEED = 34;       // 速度上限：引力弹弓加速有界，保证形成节奏与跟拍节奏不被甩开

function randomUnit(scale = 1) {
  const z = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(phi) * r * scale, z * scale, Math.sin(phi) * r * scale];
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

// 每个暗物质晕的等级由其“形成进度”决定。不同质量等级的晕启动时间不同：
// 小质量最先形成行星，中等质量形成恒星/星团，大质量形成星系，巨质量最后坍缩成黑洞。
export function levelForSeed(seed) {
  const g = seed.growth || 0;
  if (g <= 0.01) return 'void';
  if (seed.klass === 'nebula') return 'dust';
  if (seed.klass === 'small') {
    if (g < 0.42) return 'dust';
    return 'planet';
  }
  if (seed.klass === 'medium') {
    if (g < 0.34) return 'dust';
    if (g < 0.72) return 'star';
    return 'cluster';
  }
  if (seed.klass === 'large') {
    if (g < 0.30) return 'dust';
    if (g < 0.58) return 'cluster';
    if (g < 0.88) return 'galaxy';
    return 'supercluster';
  }
  // giant
  if (g < 0.28) return 'dust';
  if (g < 0.52) return 'cluster';
  if (g < 0.78) return 'galaxy';
  return 'blackhole';
}

export const LEVEL_LABELS = {
  void: '原初暗晕',
  dust: '星尘云',
  planet: '行星',
  star: '恒星',
  cluster: '星团',
  galaxy: '星系',
  supercluster: '超星系团',
  blackhole: '黑洞',
};

// 死亡文案：不同天体类型的死法不同，事件提示与特效（见渲染层 DEATH_FX）同步区分
const DEATH_VERBS = {
  atmosphere: (label) => `🔥 小球坠入【${label}】大气，烧蚀解体`,
  vaporize: (label) => `☀️ 小球被【${label}】吞没汽化`,
  tidal: (label) => `🕳️ 小球被【${label}】潮汐撕碎`,
  generic: (label) => `🛟 小球被【${label}】完全捕获`,
};

const EVENT_LEVELS = ['planet', 'star', 'cluster', 'galaxy', 'supercluster', 'blackhole'];
const EVENT_MESSAGES = {
  planet: '🪐 第一代行星凝聚成形',
  star: '☀️ 原恒星点燃，恒星诞生',
  cluster: '✨ 恒星成团，星团出现',
  galaxy: '🌌 旋涡星系开始形成',
  supercluster: '🫧 星系聚成超星系团',
  blackhole: '🕳️ 超大质量黑洞形成，吸积盘点亮',
};

export class CosmicSimulation {
  constructor(initialConfig = {}) {
    this.time = 0;
    this.events = [];
    // 运行时可调配置（UI 滑杆直通）：
    //   wormholeDist     虫洞跃迁距离（世界单位）
    //   wormholeDuration 虫洞动画时长（秒）
    //   wormholeWindow   判定"持续捕获"的时间窗口（秒），窗口内被同一系统再次捕获即触发虫洞
    //   maxDetailSystems 同时持有内部细节的系统数上限
    //   maxDetailBodies  全部活跃系统的细节天体总数上限
    //   qualityTier      降级档位 0/1/2（由 main.js 的 FPS 看门狗维护；0=全质量）
    //   autoQuality      低帧率自动降级开关
    // 初始条件（仅构造时生效，"🎲 重开宇宙"后应用）：
    //   filamentStrength    纤维凝聚强度：越高越多暗物质晕贴小球航向分布（默认 1）
    //   velocityDispersion  速度弥散：物质初速的随机散布倍率，1=自然爆炸（默认 1）
    //   massBias            质量函数偏置：-1 偏小质量、+1 偏大质量（默认 0）
    this.config = {
      wormholeDist: 480, wormholeDuration: 1.4, wormholeWindow: 8,
      maxDetailSystems: 3, maxDetailBodies: 500,
      qualityTier: 0, autoQuality: true,
      filamentStrength: 1, velocityDispersion: 1, massBias: 0,
      ...initialConfig,
    };
    this.seenLevels = new Set();
    this.seenMilestones = new Set();
    this.particles = [];
    this.seeds = [];
    // 自动日志：周期性状态快照（事件本身已在 this.events，导出时合并）
    this.ticks = [];
    this.lastTickTime = 0;
    // 二级系统首次提示
    this.seenSubSystem = false;
    // 死亡序列：非空表示小球正在经历死亡演出（物理冻结）
    this._deathPending = null;
    this.probe = {
      pos: [0, 0, 0],
      // 上一物理步的位置：渲染层在两物理步之间插值，消除固定步长造成的“一颤一颤”
      prevPos: [0, 0, 0],
      vel: [0, 0, 0],
      // 上一渲染帧的速度：渲染层据此估算加速度，被引力急拉时锁住镜头航向
      prevVel: [0, 0, 0],
      phase: 'bigbang',
      phaseTime: 0,
      nearestSystem: -1,
      nearestDist: Infinity,
      generation: 1,
      respawns: 0,
      respawnFlash: 0,
      label: '随大爆炸喷出',
      // 智能镜头聚焦：对小球施加强引力、需要与小球同框的天体系统
      influencer: -1,
      influenceStrength: 0,
      // 重生宽限期：重生后数秒内不会被再次捕获，保证能飞出系统继续航行
      respawnGrace: 0,
      // 持续捕获检测：上次重生所在的系统 id 与时间；用于触发虫洞跃迁
      lastCaptureSeed: -1,
      lastCaptureTime: -Infinity,
      // 虫洞跃迁状态：剩余动画时间（秒），>0 时屏幕出现虫洞特效
      wormholeTimer: 0,
      wormholeFrom: [0, 0, 0],
      wormholeTo: [0, 0, 0],
      wormholeDuration: 1.4,
      // 死亡方式：atmosphere 大气烧蚀 / vaporize 恒星汽化 / tidal 潮汐撕碎 /
      // wormhole 虫洞逃逸（不播死亡特效）/ generic 兜底。渲染层据此选特效。
      deathType: 'generic',
      // 被捕获的位置：死亡特效（烧蚀/汽化/潮汐涟漪）播放点
      deathPos: [0, 0, 0],
      // ---- 绕行检测：判定小球在"自由航行"还是"绕着某天体互动" ----
      // orbitAngleAcc：相对 influencer 连线方向角的衰减累计（指数窗 ~1.4s），
      // 直线飞掠时几乎不增长，绕弧线时持续增长；
      // orbitTangent：相对速度的切向占比（绕行时高，直线冲时低）；
      // straightTime：连续近似直线飞行时长（退出交互的判据）；
      // interactCooldown：退出交互后的冷却，杜绝 cruise↔interact 来回跳。
      orbitAngleAcc: 0,
      orbitTangent: 0,
      straightTime: 0,
      interactCooldown: 0,
      _orbitSeed: -1,
      _orbitDirPrev: [1, 0, 0],
      // 死亡序列状态：true = 正在坠入/汽化/被撕碎（物理冻结，渲染层播死亡演出），
      // 结束后才真正重生（渲染层据此做潮汐拉伸/汽化收缩等小球演出）
      dying: false,
      // 死亡序列的剩余时长/总时长/杀手天体位置（渲染层驱动小球演出用）
      dyingT: 0,
      dyingDur: 1,
      deathKillerPos: [0, 0, 0],
    };
    this.activeDetails = [];
    this.lastSeedAwakenTime = -100;
    this.lastFrontierTime = -100;
    this.gravityStrength = 0;
    this._init();
  }

  _init() {
    const cfg = this.config;
    // 先确定小球的初始喷射方向。部分暗物质晕会分布在这个方向附近，
    // 形成一条自然的高密度纤维结构，因此小球有机会一路遇到各类天体；
    // 但它没有目标清单，是否相遇完全由引力和惯性决定。
    const probeDir = randomUnit();
    // 所有物质都诞生于同一奇点附近，但初始速度很大。
    // velocityDispersion 缩放随机散布（保持平均速度不变）：0.3=整齐膨胀，2=剧烈湍流
    const disp = cfg.velocityDispersion;
    for (let i = 0; i < N_PARTICLES; i++) {
      const dir = randomUnit();
      const r = 0.015 + Math.pow(Math.random(), 1.4) * 0.30;
      const speed = BASE_SPEED * (1 + (0.82 + Math.random() * 0.62 - 1) * disp);
      const tan = randomUnit(1);
      // 切向只占很小比例，保证视觉上是“爆炸式径向飞散”
      const tv = (0.20 + Math.random() * 0.35) * disp;
      this.particles.push({
        pos: [dir[0] * r, dir[1] * r, dir[2] * r],
        vel: [
          dir[0] * speed + tan[0] * tv,
          dir[1] * speed + tan[1] * tv,
          dir[2] * speed + tan[2] * tv,
        ],
        mass: 0.0015 + Math.random() * 0.003,
        seed: -1,
        bound: false,
        capture: 0,
        bindAmt: 0,
        orbit: null,
        orbitPos: null,
        orbitVel: [0, 0, 0],
      });
    }

    // 暗物质晕（未来天体的引力种子），同样被大爆炸高速抛出。
    // massBias 在小质量与巨质量之间搬运数量份额（-1..1），中档数量不变。
    const countFor = (def) => {
      const b = cfg.massBias;
      const f = def.key === 'small' ? 1 - b * 0.5 : def.key === 'giant' ? 1 + b : 1;
      return Math.max(2, Math.round(def.count * f));
    };
    let idx = 0;
    for (const def of CLASS_DEFS) {
      const count = countFor(def);
      for (let k = 0; k < count; k++) {
        let dir = randomUnit();
        // 宇宙纤维结构：越大/越远的系统越可能贴近小球航向附近。
        // 这不是目标航线，只是提高自然相遇概率；相遇后仍完全由物理决定。
        // filamentStrength 整体缩放贴附概率：0=完全均匀各向同性，2=强纤维
        let biasProb = 0.55;
        let scatterScale = 0.12;
        if (def.key === 'small') { biasProb = 0.65; scatterScale = 0.09; }
        else if (def.key === 'medium') { biasProb = 0.80; scatterScale = 0.06; }
        else if (def.key === 'large') { biasProb = 0.88; scatterScale = 0.035; }
        else { biasProb = 0.92; scatterScale = 0.025; }
        biasProb = Math.min(0.98, biasProb * cfg.filamentStrength);
        if (Math.random() < biasProb) {
          const scatter = randomUnit(1);
          const bx = probeDir[0] + scatter[0] * scatterScale;
          const by = probeDir[1] + scatter[1] * scatterScale;
          const bz = probeDir[2] + scatter[2] * scatterScale;
          const bl = Math.hypot(bx, by, bz) || 1;
          dir = [bx / bl, by / bl, bz / bl];
        }
        // 暴胀已经把暗物质晕推到很远的地方；奇点附近是空的。
        // 不同类型沿径向分带：小质量晕最近，巨质量黑洞种子最远，
        // 小球航行时才会由近到远、由小到大逐步遇到。
        const t = count > 1 ? k / (count - 1) : 0;
        let r;
        if (def.key === 'small') r = 180 + t * 1800 + Math.random() * 80;
        else if (def.key === 'medium') r = 380 + t * 2800 + Math.random() * 150;
        else if (def.key === 'large') r = 650 + t * 3800 + Math.random() * 250;
        else r = 1000 + t * 4500 + Math.random() * 300;
        const speed = BASE_SPEED * (0.62 + Math.random() * 0.30) + Math.min(24, r * 0.004);
        const axis = randomUnit();
        const u0 = Math.abs(axis[0]) < 0.85 ? [1, 0, 0] : [0, 1, 0];
        const dot = u0[0] * axis[0] + u0[1] * axis[1] + u0[2] * axis[2];
        const u = [
          u0[0] - axis[0] * dot,
          u0[1] - axis[1] * dot,
          u0[2] - axis[2] * dot,
        ];
        const ul = Math.hypot(u[0], u[1], u[2]) || 1;
        u[0] /= ul; u[1] /= ul; u[2] /= ul;
        const v = [
          axis[1] * u[2] - axis[2] * u[1],
          axis[2] * u[0] - axis[0] * u[2],
          axis[0] * u[1] - axis[1] * u[0],
        ];
        this.seeds.push({
          idx: idx++,
          klass: def.key,
          dir,
          pos: [dir[0] * r, dir[1] * r, dir[2] * r],
          vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
          mass: def.massMin + Math.random() * (def.massMax - def.massMin),
          birth: Infinity,
          duration: def.durBase + Math.random() * def.durSpan,
          growth: 0,
          awakened: false,
          level: 'void',
          axis, u, v,
          members: [],
          lastVisit: -Infinity,
          spinSign: Math.random() < 0.5 ? -1 : 1,
        });
      }
    }


    // 暴胀后的物质分布：
    // - 大部分普通物质已经成为远方暗物质晕周围的原初气体云；
    // - 少部分仍表现为从奇点喷出的高速可见喷流；
    // 因此奇点附近不会凭空出现恒星/星团/星系/黑洞。
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (i < N_CLOUD_PARTICLES) {
        const s = this.seeds[Math.floor(Math.random() * this.seeds.length)];
        const off = randomUnit(0.5 + Math.random() * 4.5);
        p.pos = [s.pos[0] + off[0], s.pos[1] + off[1], s.pos[2] + off[2]];
        p.vel = [
          s.vel[0] + (Math.random() - 0.5) * 1.6,
          s.vel[1] + (Math.random() - 0.5) * 1.6,
          s.vel[2] + (Math.random() - 0.5) * 1.6,
        ];
      } else {
        const dir = randomUnit();
        const r = 0.02 + Math.random() * 0.25;
        const sp = EJECTA_SPEED_MIN + Math.random() * (EJECTA_SPEED_MAX - EJECTA_SPEED_MIN);
        p.pos = [dir[0] * r, dir[1] * r, dir[2] * r];
        p.vel = [dir[0] * sp, dir[1] * sp, dir[2] * sp];
      }
    }

    this._assignMembers(true);

    // 主角小球独立诞生于奇点附近，只携带大爆炸赋予的初始动量。
    // 之后不锁定任何目标：引力、惯性和阻尼会决定它遇到什么。
    this.probe.pos = [probeDir[0] * 0.04, probeDir[1] * 0.04, probeDir[2] * 0.04];
    this.probe.prevPos = this.probe.pos.slice();
    const probeSpeed = PROBE_INITIAL_SPEED * (0.90 + Math.random() * 0.20);
    this.probe.vel = [probeDir[0] * probeSpeed, probeDir[1] * probeSpeed, probeDir[2] * probeSpeed];
  }

  _nearestSeed(pos) {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < this.seeds.length; j++) {
      const s = this.seeds[j];
      const dx = s.pos[0] - pos[0];
      const dy = s.pos[1] - pos[1];
      const dz = s.pos[2] - pos[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD) { bestD = d2; best = j; }
    }
    return best;
  }

  _assignMembers(force = false) {
    if (!force && Math.random() > 0.35) return;
    for (const s of this.seeds) s.members.length = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.bound) {
        if (p.seed >= 0) this.seeds[p.seed].members.push(i);
      } else {
        const b = this._nearestSeed(p.pos);
        p.seed = b;
        if (b >= 0) this.seeds[b].members.push(i);
      }
    }
  }



  _systemRadius(s) {
    if (s.level === 'blackhole') return 12 + s.mass * 1.4;
    if (s.level === 'supercluster') return 18 + s.mass * 2.2;
    if (s.level === 'galaxy') return 12 + s.mass * 1.5;
    if (s.level === 'cluster') return 8 + s.mass * 1.1;
    if (s.level === 'star') return 3.0 + s.mass * 0.5;
    if (s.level === 'planet') return 1.6 + s.mass * 0.4;
    if (s.level === 'dust' || s.level === 'void') return 7 + s.mass * 2.0;
    return 1.6;
  }

  // 捕获半径：只有"单天体"（星尘云/行星/恒星）才有捕获范围
  // 星团/星系/超星系团/黑洞都是多体集合，捕获由其内部成员负责
  _captureRadius(s) {
    if (s.level === 'void' || s.level === 'dust') return 0;
    if (s.level === 'star') return 0.20 + s.mass * 0.06;
    if (s.level === 'planet') return 0.09 + s.mass * 0.04;
    // cluster / galaxy / supercluster / blackhole: 集合，由内部成员捕获
    return 0;
  }

  _detailRadius(s) {
    if (s.level === 'supercluster') return 42;
    if (s.level === 'blackhole') return 30;
    if (s.level === 'galaxy') return 30;
    if (s.level === 'cluster') return 20;
    if (s.level === 'star') return 9;
    if (s.level === 'dust') return 18;
    if (s.level === 'planet') return 5;
    if (s.level === 'void') return 16;
    return 0;
  }

  _updateSeedFormation(s) {
    if (!s.awakened) return;
    // 小球靠近时形成加速：保证小球“路过”时系统已大致成形，而不是刚起步。
    // 远处时以 s.duration 为节奏，缓慢平滑地成形。
    const d = Math.hypot(
      s.pos[0] - this.probe.pos[0],
      s.pos[1] - this.probe.pos[1],
      s.pos[2] - this.probe.pos[2],
    );
    const nearBoost = d < 150 ? 1 + (1 - d / 150) * 1.5 : 1;
    const raw = clamp01(((this.time - s.birth) * nearBoost) / s.duration);
    s.growth = raw * raw * (3 - 2 * raw);
    s.level = levelForSeed(s);
  }

  // 唤醒候选：小球速度比形成速度快，若同一时间只允许一个系统形成，
  // 多数种子会在门控期间被甩在身后，导致“沿途看不到天体”。
  // 因此允许最多三个系统并行形成（间隔很短），并且总是唤醒离小球最近的种子，
  // 保证被唤醒的是小球真正会路过的系统。
  _tryAwakenSeed() {
    let best = null;
    let bestD = SEED_AWAKEN_RADIUS;
    for (const s of this.seeds) {
      if (s.awakened) continue;
      const d = Math.hypot(
        s.pos[0] - this.probe.pos[0],
        s.pos[1] - this.probe.pos[1],
        s.pos[2] - this.probe.pos[2],
      );
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return;
    const formingCount = this.seeds.reduce((n, o) => n + (o.awakened && o.growth < 1 ? 1 : 0), 0);
    if (formingCount >= 3 || this.time - this.lastSeedAwakenTime < FORMATION_SPACING) return;
    best.awakened = true;
    best.birth = this.time;
    this.lastSeedAwakenTime = this.time;
  }

  _generateFrontierSeed() {
    if (this.time - this.lastFrontierTime < FRONTIER_INTERVAL) return;
    const pr = this.probe;
    // 回收远处仍然休眠的旧种子作为新结构；不需要过滤已绑定粒子（那是粒子的内部成员）。
    const candidates = this.seeds.filter((s) =>
      !s.awakened && !s.detail
      && Math.hypot(s.pos[0] - pr.pos[0], s.pos[1] - pr.pos[1], s.pos[2] - pr.pos[2]) > 350,
    );
    if (!candidates.length) return;
    // 选最远的休眠种子回收
    let s = candidates[0];
    let bestD = -1;
    for (const c of candidates) {
      const d = Math.hypot(c.pos[0] - pr.pos[0], c.pos[1] - pr.pos[1], c.pos[2] - pr.pos[2]);
      if (d > bestD) { bestD = d; s = c; }
    }

    // 宇宙很空：航线上一次只补一个「远处大系统」。小质量天体让初始暗物质晕自带，
    // 这里只补能在远距离就吸住小球的大结构，所以类型偏中 / 大 / 巨。
    const roll = Math.random();
    let klass;
    let def;
    if (roll < 0.45) {
      // 较常见的远景星系
      klass = 'large';
      def = CLASS_DEFS.find((d) => d.key === 'large');
    } else if (roll < 0.80) {
      klass = 'medium';
      def = CLASS_DEFS.find((d) => d.key === 'medium');
    } else if (roll < 0.95) {
      // 罕见：超大质量黑洞
      klass = 'giant';
      def = CLASS_DEFS.find((d) => d.key === 'giant');
    } else {
      // 偶尔给点变化：远处的星云 / 行星种子
      klass = 'nebula';
      def = { key: 'nebula', massMin: 0.25, massMax: 0.85, durBase: 3.5, durSpan: 1.5 };
    }

    // 放在小球前方远处的位置，散乱角也放宽一点让它不全在正前方
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    let dir;
    if (sp > 2) {
      const scatter = randomUnit(1);
      const bx = pr.vel[0] / sp + scatter[0] * 0.28;
      const by = pr.vel[1] / sp + scatter[1] * 0.28;
      const bz = pr.vel[2] / sp + scatter[2] * 0.28;
      const bl = Math.hypot(bx, by, bz) || 1;
      dir = [bx / bl, by / bl, bz / bl];
    } else {
      dir = randomUnit();
    }
    const dist = FRONTIER_DIST_MIN + Math.random() * (FRONTIER_DIST_MAX - FRONTIER_DIST_MIN);
    const pos = [
      pr.pos[0] + dir[0] * dist,
      pr.pos[1] + dir[1] * dist,
      pr.pos[2] + dir[2] * dist,
    ];

    // 重置为休眠暗物质晕。
    s.klass = klass;
    s.dir = dir;
    s.pos = pos;
    s.vel = [
      pr.vel[0] * 0.35 + (Math.random() - 0.5) * 1.2,
      pr.vel[1] * 0.35 + (Math.random() - 0.5) * 1.2,
      pr.vel[2] * 0.35 + (Math.random() - 0.5) * 1.2,
    ];
    s.mass = def.massMin + Math.random() * (def.massMax - def.massMin);
    s.duration = def.durBase + Math.random() * def.durSpan;
    s.birth = Infinity;
    s.awakened = false;
    s.growth = 0;
    s.level = 'void';
    // 引力影响范围要够大：这样即使系统离得很远也会把小球拉过去
    s.influenceRadius = 6.0 + s.mass * 1.6;
    s.captureRate = 0.20 + s.mass * 0.10;
    // 解除旧气体云的临时归属，之后 `_assignMembers` 会重新分配。
    for (const i of s.members) {
      if (this.particles[i] && !this.particles[i].bound) this.particles[i].seed = -1;
    }
    s.members.length = 0;
    s.lastVisit = -Infinity;
    s.axis = randomUnit();
    const u0 = Math.abs(s.axis[0]) < 0.85 ? [1, 0, 0] : [0, 1, 0];
    const dot = u0[0] * s.axis[0] + u0[1] * s.axis[1] + u0[2] * s.axis[2];
    s.u = [
      u0[0] - s.axis[0] * dot,
      u0[1] - s.axis[1] * dot,
      u0[2] - s.axis[2] * dot,
    ];
    const ul = Math.hypot(s.u[0], s.u[1], s.u[2]) || 1;
    s.u[0] /= ul; s.u[1] /= ul; s.u[2] /= ul;
    s.v = [
      s.axis[1] * s.u[2] - s.axis[2] * s.u[1],
      s.axis[2] * s.u[0] - s.axis[0] * s.u[2],
      s.axis[0] * s.u[1] - s.axis[1] * s.u[0],
    ];
    s.spinSign = Math.random() < 0.5 ? -1 : 1;
    const classLabels = { nebula: '星云', small: '行星', medium: '恒星/星团', large: '星系', giant: '黑洞' };
    this.events.push({ time: this.time, text: `🔭 远方探测到${classLabels[klass]}结构（引力范围 ${s.influenceRadius.toFixed(0)}）` });
    this.lastFrontierTime = this.time;
  }



  _seededRandom(seedInt) {
    let a = (seedInt + 1) * 2654435761 >>> 0;
    return () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  }

  _ensureDetailSystem(s) {
    const r = this._detailRadius(s);
    if (r <= 0 || s.detail) return;
    // 把系统里所有可能用到的"多级 LOD" 都生成，但用各 body 上的 lod 字段标记出现等级
    const rng = this._seededRandom(s.idx * 7919 + 17);
    const bodies = [];
    const TAU = Math.PI * 2;
    const addOrbitBody = (type, mass, radius, orbitRadius, orbitHeight, orbitSpeed, angle, colorSeed, lod) => {
      bodies.push({
        type, mass, radius, colorSeed, lod, // 出现 LOD：0=mid, 1=near, 2=inner
        pos: [0, 0, 0],
        orbit: { radius: orbitRadius, height: orbitHeight, speed: orbitSpeed, angle },
        prevAngle: angle,
        parent: s.idx,
      });
    };
    const baseSpeed = 0.25 + s.mass * 0.12;

    if (s.level === 'void' || s.level === 'dust') {
      // 星云：远景就能看到大量气体尘埃，进入内圈才出现少量亮星
      const count = 90 + Math.floor(rng() * 60);
      for (let i = 0; i < count; i++) {
        const isStar = rng() < 0.12;
        const orbitR = 0.4 + rng() * r * 0.55;
        const height = (rng() - 0.5) * orbitR * 0.85;
        addOrbitBody(
          isStar ? 'star' : 'gas',
          isStar ? 0.004 + rng() * 0.012 : 0.0008 + rng() * 0.004,
          isStar ? 0.02 + rng() * 0.03 : 0.012 + rng() * 0.018,
          orbitR, height,
          (0.04 + rng() * 0.08) * baseSpeed / Math.sqrt(0.3 + orbitR),
          rng() * TAU, rng(),
          isStar ? 1 : 0,
        );
      }
    } else if (s.level === 'cluster') {
      // 星团：先有 30 颗进入 mid；再补 60 颗进入 near
      const count = 30 + Math.floor(rng() * 15);
      for (let i = 0; i < count; i++) {
        const orbitR = 0.8 + rng() * r * 0.42;
        const height = (rng() - 0.5) * orbitR * 0.65;
        addOrbitBody(
          'star', 0.015 + rng() * 0.08, 0.035 + rng() * 0.06,
          orbitR, height,
          (0.18 + rng() * 0.25) * baseSpeed / Math.sqrt(0.5 + orbitR),
          rng() * TAU, rng(), 0,
        );
      }
      const count2 = 45 + Math.floor(rng() * 25);
      for (let i = 0; i < count2; i++) {
        const orbitR = 0.6 + rng() * r * 0.45;
        const height = (rng() - 0.5) * orbitR * 0.6;
        addOrbitBody(
          'star', 0.012 + rng() * 0.06, 0.030 + rng() * 0.05,
          orbitR, height,
          (0.20 + rng() * 0.25) * baseSpeed / Math.sqrt(0.5 + orbitR),
          rng() * TAU, rng(), 1,
        );
      }
    } else if (s.level === 'star') {
      // 恒星系统：mid 出现 1~2 颗内行星；near 出现更多行星与卫星
      const count = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        const orbitR = 1.4 + rng() * r * 0.45;
        addOrbitBody(
          'planet', 0.004 + rng() * 0.012, 0.030 + rng() * 0.03,
          orbitR, (rng() - 0.5) * orbitR * 0.25,
          (0.30 + rng() * 0.25) * baseSpeed / Math.sqrt(0.6 + orbitR),
          rng() * TAU, rng(), 0,
        );
      }
      const count2 = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < count2; i++) {
        const orbitR = 1.0 + rng() * r * 0.55;
        addOrbitBody(
          rng() < 0.3 ? 'gas' : 'planet',
          rng() < 0.3 ? 0.0008 + rng() * 0.003 : 0.003 + rng() * 0.01,
          rng() < 0.3 ? 0.012 + rng() * 0.015 : 0.025 + rng() * 0.025,
          orbitR, (rng() - 0.5) * orbitR * 0.3,
          (0.32 + rng() * 0.25) * baseSpeed / Math.sqrt(0.6 + orbitR),
          rng() * TAU, rng(), 1,
        );
      }
    } else if (s.level === 'planet') {
      // 行星：远景 0 颗（行星本身就是球），靠近才出现 0~3 颗卫星
      const count = Math.floor(rng() * 3);
      for (let i = 0; i < count; i++) {
        const orbitR = 0.5 + rng() * r * 0.45;
        addOrbitBody(
          'planet', 0.001 + rng() * 0.004, 0.012 + rng() * 0.012,
          orbitR, (rng() - 0.5) * orbitR * 0.4,
          (0.35 + rng() * 0.3) * baseSpeed / Math.sqrt(0.5 + orbitR),
          rng() * TAU, rng(), 1,
        );
      }
    } else if (s.level === 'galaxy') {
      // ---- 多级 LOD：星系是体现「逐步真实化」的关键 ----
      // LOD=0 (mid): 3 条旋臂上的 35 个亮点 + 中心黑洞（构成第一眼印象）
      // LOD=1 (near): 再补 80 颗恒星
      // LOD=2 (inner): 35 颗行星 + 尘埃云 / 卫星
      bodies.push({
        type: 'blackhole', mass: 0.45 + s.mass * 0.25, radius: 0.32 + s.mass * 0.06,
        colorSeed: 0, pos: s.pos.slice(), orbit: null, parent: s.idx, lod: 0,
      });
      // mid
      const midCount = 30 + Math.floor(rng() * 12);
      for (let i = 0; i < midCount; i++) {
        const arm = i % 3;
        const t = Math.pow(rng(), 0.55);
        const orbitR = 1.2 + t * r * 0.5;
        const angle = arm * (TAU / 3) + t * 4.2 + (rng() - 0.5) * 0.45;
        const height = (rng() - 0.5) * orbitR * 0.11;
        addOrbitBody(
          'star', 0.020 + rng() * 0.08, 0.045 + rng() * 0.06,
          orbitR, height,
          (0.22 + rng() * 0.30) * baseSpeed / Math.sqrt(0.6 + orbitR),
          angle, rng(), 0,
        );
      }
      // near
      const nearCount = 80 + Math.floor(rng() * 30);
      for (let i = 0; i < nearCount; i++) {
        const arm = i % 3;
        const t = Math.pow(rng(), 0.55);
        const orbitR = 0.9 + t * r * 0.5;
        const angle = arm * (TAU / 3) + t * 4.2 + (rng() - 0.5) * 0.5;
        const height = (rng() - 0.5) * orbitR * 0.13;
        const isPlanet = rng() < 0.18;
        addOrbitBody(
          isPlanet ? 'planet' : 'star',
          isPlanet ? 0.002 + rng() * 0.008 : 0.012 + rng() * 0.06,
          isPlanet ? 0.016 + rng() * 0.02 : 0.030 + rng() * 0.055,
          orbitR, height,
          (0.22 + rng() * 0.30) * baseSpeed / Math.sqrt(0.6 + orbitR),
          angle, rng(), 1,
        );
      }
      // inner
      const innerCount = 40 + Math.floor(rng() * 25);
      for (let i = 0; i < innerCount; i++) {
        const orbitR = 0.6 + Math.pow(rng(), 0.65) * r * 0.45;
        const angle = rng() * TAU;
        const height = (rng() - 0.5) * orbitR * 0.18;
        const isGas = rng() < 0.3;
        addOrbitBody(
          isGas ? 'gas' : 'planet',
          isGas ? 0.0006 + rng() * 0.003 : 0.0015 + rng() * 0.006,
          isGas ? 0.010 + rng() * 0.015 : 0.014 + rng() * 0.018,
          orbitR, height,
          (0.20 + rng() * 0.30) * baseSpeed / Math.sqrt(0.5 + orbitR),
          angle, rng(), 2,
        );
      }
    } else if (s.level === 'supercluster') {
      // ---- 超星系团：mid 出现 6 个星系核；near 给每个星系补恒星；inner 给尘埃 ----
      const nodes = [];
      for (let n = 0; n < 6; n++) {
        const nodeR = 2.6 + rng() * r * 0.40;
        const nodeAngle = n * (TAU / 6) + rng() * 0.5;
        const nodeHeight = (rng() - 0.5) * nodeR * 0.3;
        const nodeMass = 0.20 + rng() * 0.45;
        nodes.push({ radius: nodeR, angle: nodeAngle, height: nodeHeight, mass: nodeMass });
        bodies.push({
          type: 'galaxy', mass: nodeMass, radius: 0.30 + rng() * 0.18,
          colorSeed: rng(), pos: [0, 0, 0],
          orbit: { radius: nodeR, height: nodeHeight, speed: (0.15 + rng() * 0.15) * baseSpeed, angle: nodeAngle },
          parent: s.idx, lod: 0,
        });
      }
      // 给每个星系节点 20 颗近景恒星
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        for (let i = 0; i < 20; i++) {
          const orbitR = node.radius * 0.35 + (rng() * node.radius * 0.45);
          const angle = node.angle + (rng() - 0.5) * 0.65;
          addOrbitBody(
            'star', 0.015 + rng() * 0.05, 0.035 + rng() * 0.04,
            orbitR, node.height + (rng() - 0.5) * 1.0,
            (0.20 + rng() * 0.30) * baseSpeed / Math.sqrt(0.6 + orbitR),
            angle, rng(), 1,
          );
        }
      }
      // 内层：每个星系节点下补尘埃 + 行星
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        const innerCount = 12 + Math.floor(rng() * 8);
        for (let i = 0; i < innerCount; i++) {
          const orbitR = node.radius * 0.3 + rng() * node.radius * 0.4;
          const angle = node.angle + (rng() - 0.5) * 0.8;
          addOrbitBody(
            rng() < 0.4 ? 'gas' : 'planet',
            rng() < 0.4 ? 0.0006 + rng() * 0.003 : 0.0015 + rng() * 0.006,
            rng() < 0.4 ? 0.010 + rng() * 0.015 : 0.014 + rng() * 0.02,
            orbitR, node.height + (rng() - 0.5) * 1.4,
            (0.20 + rng() * 0.30) * baseSpeed / Math.sqrt(0.5 + orbitR),
            angle, rng(), 2,
          );
        }
      }
    } else if (s.level === 'blackhole') {
      // 黑洞：mid 16 颗近距恒星；near 30 颗；inner 18 颗行星尘埃
      const midCount = 16 + Math.floor(rng() * 8);
      for (let i = 0; i < midCount; i++) {
        const orbitR = 2.0 + Math.pow(rng(), 0.7) * r * 0.3;
        const angle = rng() * TAU;
        const height = (rng() - 0.5) * orbitR * 0.18;
        addOrbitBody(
          'star', 0.020 + rng() * 0.07, 0.030 + rng() * 0.05,
          orbitR, height,
          (0.35 + rng() * 0.40) * (0.30 + s.mass * 0.12) / Math.sqrt(0.5 + orbitR),
          angle, rng(), 0,
        );
      }
      const nearCount = 30 + Math.floor(rng() * 14);
      for (let i = 0; i < nearCount; i++) {
        const orbitR = 1.4 + Math.pow(rng(), 0.7) * r * 0.4;
        const angle = rng() * TAU;
        const height = (rng() - 0.5) * orbitR * 0.18;
        addOrbitBody(
          'star', 0.015 + rng() * 0.06, 0.028 + rng() * 0.05,
          orbitR, height,
          (0.35 + rng() * 0.40) * (0.30 + s.mass * 0.12) / Math.sqrt(0.5 + orbitR),
          angle, rng(), 1,
        );
      }
      const innerCount = 18 + Math.floor(rng() * 10);
      for (let i = 0; i < innerCount; i++) {
        const orbitR = 1.0 + Math.pow(rng(), 0.7) * r * 0.32;
        const angle = rng() * TAU;
        const height = (rng() - 0.5) * orbitR * 0.18;
        addOrbitBody(
          rng() < 0.4 ? 'gas' : 'planet',
          rng() < 0.4 ? 0.0006 + rng() * 0.003 : 0.002 + rng() * 0.008,
          rng() < 0.4 ? 0.010 + rng() * 0.015 : 0.018 + rng() * 0.02,
          orbitR, height,
          (0.35 + rng() * 0.40) * (0.30 + s.mass * 0.12) / Math.sqrt(0.5 + orbitR),
          angle, rng(), 2,
        );
      }
    }
    s.detail = { bodies, radius: r, lodReached: 0, lodLerp: 0 };
  }

  // 根据小球到系统的距离决定当前已「真实化」到的 LOD 等级
  // LOD=0: 远景光晕, LOD=1: mid, LOD=2: near, LOD=3: inner
  _detailLODFor(s) {
    if (!s.detail) return -1;
    const pr = this.probe;
    const d = Math.hypot(pr.pos[0] - s.pos[0], pr.pos[1] - s.pos[1], pr.pos[2] - s.pos[2]);
    const r = s.detail.radius;
    if (d > r * LOD_FAR * 1.4) return 0;       // 太远不算 LOD
    if (d > r * LOD_MID) return 0;            // 远景
    if (d > r * LOD_NEAR) return 1;           // mid
    if (d > r * LOD_INNER) return 2;          // near
    return 3;                                  // inner
  }

  _updateDetailBodies(s, dt) {
    const lod = s.detail.lodReached;
    const lerp = s.detail.lodLerp;
    for (const b of s.detail.bodies) {
      // LOD 控制：b.lod 越大越靠后；当 lerp < b.lod+1 时该 body 还没"出现"
      if (lerp + 0.001 < b.lod) {
        // 还没到该 LOD：用大尺度噪声放在中心隐藏，避免粒子被一次性看到
        b.pos[0] = s.pos[0] + (Math.random() - 0.5) * 0.001;
        b.pos[1] = s.pos[1] + (Math.random() - 0.5) * 0.001;
        b.pos[2] = s.pos[2] + (Math.random() - 0.5) * 0.001;
        b._hidden = true;
        continue;
      }
      b._hidden = false;
      if (!b.orbit) {
        b.pos[0] = s.pos[0]; b.pos[1] = s.pos[1]; b.pos[2] = s.pos[2];
        continue;
      }
      // 渲染插值用：推进前保存本步轨道角
      b.prevAngle = b.orbit.angle;
      b.orbit.angle += b.orbit.speed * dt;
      const c = Math.cos(b.orbit.angle), sn = Math.sin(b.orbit.angle);
      b.pos[0] = s.pos[0] + s.u[0] * c * b.orbit.radius + s.v[0] * sn * b.orbit.radius + s.axis[0] * b.orbit.height;
      b.pos[1] = s.pos[1] + s.u[1] * c * b.orbit.radius + s.v[1] * sn * b.orbit.radius + s.axis[1] * b.orbit.height;
      b.pos[2] = s.pos[2] + s.u[2] * c * b.orbit.radius + s.v[2] * sn * b.orbit.radius + s.axis[2] * b.orbit.height;
      // 二级系统：行星/卫星绕恒星本身运动（母星是移动目标，用其本步位置）
      if (b.children) {
        for (const ch of b.children) {
          ch.prevAngle = ch.orbit.angle;
          ch.orbit.angle += ch.orbit.speed * dt;
          const cc = Math.cos(ch.orbit.angle), cs = Math.sin(ch.orbit.angle);
          ch.pos[0] = b.pos[0] + s.u[0] * cc * ch.orbit.radius + s.v[0] * cs * ch.orbit.radius + s.axis[0] * ch.orbit.height;
          ch.pos[1] = b.pos[1] + s.u[1] * cc * ch.orbit.radius + s.v[1] * cs * ch.orbit.radius + s.axis[1] * ch.orbit.height;
          ch.pos[2] = b.pos[2] + s.u[2] * cc * ch.orbit.radius + s.v[2] * cs * ch.orbit.radius + s.axis[2] * ch.orbit.height;
        }
      }
    }
  }

  // ---- 二级系统（§9.2/9.8）：靠近集合系统内的某颗恒星时，
  // 为它生成行星/卫星。恒星（type 'star'）半径小，触发半径用其
  // 半径的固定倍数，保证"贴近了才看清它带着一串行星"。----
  _updateSubSystems(s) {
    if (this.config.qualityTier >= 1) return; // 降级时不新增二级系统
    const pr = this.probe;
    for (const b of s.detail.bodies) {
      if (b.type !== 'star' || b.children || b._hidden || !b.orbit) continue;
      const d = Math.hypot(pr.pos[0] - b.pos[0], pr.pos[1] - b.pos[1], pr.pos[2] - b.pos[2]);
      const trigger = Math.max(2.0, b.radius * 55);
      if (d < trigger) {
        this._generateStarChildren(s, b);
        if (!this.seenSubSystem) {
          this.seenSubSystem = true;
          this.events.push({ time: this.time, text: '🪐 小球贴近一颗恒星，它的行星系统在眼前显现' });
        }
      }
    }
  }

  _generateStarChildren(s, b) {
    const rng = this._seededRandom((s.idx * 131 + b.orbit.angle * 1000 | 0) + 7919);
    const baseSpeed = 0.25 + s.mass * 0.12;
    const TAU = Math.PI * 2;
    const children = [];
    const n = 2 + Math.floor(rng() * 3); // 2~4 颗
    for (let i = 0; i < n; i++) {
      const isGas = rng() < 0.25;
      const orbitR = 0.35 + rng() * 1.1;
      children.push({
        type: isGas ? 'gas' : 'planet',
        mass: isGas ? 0.0006 + rng() * 0.002 : 0.002 + rng() * 0.007,
        radius: isGas ? 0.010 + rng() * 0.010 : 0.018 + rng() * 0.016,
        colorSeed: rng(),
        lod: 0,
        pos: [b.pos[0], b.pos[1], b.pos[2]],
        orbit: {
          radius: orbitR,
          height: (rng() - 0.5) * orbitR * 0.3,
          speed: (0.55 + rng() * 0.35) * baseSpeed / Math.sqrt(0.3 + orbitR),
          angle: rng() * TAU,
        },
        prevAngle: 0,
        parent: s.idx,
        parentBody: b, // 渲染层需要母星显示位置
      });
    }
    b.children = children;
  }

  // ---- 死亡序列（§9.3）：捕获后先播一段"坠入/汽化/被撕碎"演出，
  // 物理冻结、杀手引用实时取 pos（绕行天体也在动），结束后才重生 ----
  static DEATH_DUR = { atmosphere: 1.1, vaporize: 0.7, tidal: 1.3, generic: 0.8 };

  _beginDeath(killer, label, captureSeedIdx, deathType, launchR) {
    if (this._deathPending) return; // 已在死亡演出中
    const pr = this.probe;
    pr.deathType = deathType;
    pr.deathPos = [pr.pos[0], pr.pos[1], pr.pos[2]];
    pr.dying = true;
    const dur = CosmicSimulation.DEATH_DUR[deathType] || 0.8;
    pr.dyingT = dur;
    pr.dyingDur = dur;
    this._deathPending = {
      killer, label, captureSeedIdx, deathType, launchR,
      t: dur,
      stopDist: (killer.radius || 0.2) * 0.25,
      tang: randomUnit(1), // 潮汐撕碎的螺旋切向
    };
  }

  _updateDeath(dt) {
    const dp = this._deathPending;
    const pr = this.probe;
    dp.t -= dt;
    pr.dyingT = Math.max(0, dp.t);
    const kp = dp.killer.pos;
    pr.deathKillerPos = [kp[0], kp[1], kp[2]];
    // 插值连续：本步移动前同步 prevPos
    pr.prevPos[0] = pr.pos[0]; pr.prevPos[1] = pr.pos[1]; pr.prevPos[2] = pr.pos[2];
    // 朝杀手天体下沉（捕获得点距离本就很近，下沉是小幅收尾动作）
    const rx = kp[0] - pr.pos[0], ry = kp[1] - pr.pos[1], rz = kp[2] - pr.pos[2];
    const d = Math.max(1e-4, Math.hypot(rx, ry, rz));
    const ux = rx / d, uy = ry / d, uz = rz / d;
    const sink = Math.min(1.5 * dt, Math.max(0, d - dp.stopDist));
    pr.pos[0] += ux * sink; pr.pos[1] += uy * sink; pr.pos[2] += uz * sink;
    if (dp.deathType === 'tidal' && d > dp.stopDist * 2) {
      // 潮汐撕碎：叠加切向螺旋漂移，坠入轨迹是盘旋而非直线
      pr.pos[0] += dp.tang[0] * 0.8 * dt;
      pr.pos[1] += dp.tang[1] * 0.8 * dt;
      pr.pos[2] += dp.tang[2] * 0.8 * dt;
    }
    if (dp.t <= 0) {
      pr.dying = false;
      this._deathPending = null;
      this._respawnFrom(dp.killer.pos, dp.launchR, dp.label, dp.captureSeedIdx, dp.deathType);
    }
  }

  _manageDetails(dt) {
    this.activeDetails.length = 0;
    const pr = this.probe;
    const cfg = this.config;
    // ---- 性能预算（§9.5）----
    // tier>=2：主动收缩——把最远的细节系统卸载到上限一半，体数预算立即减半
    if (cfg.qualityTier >= 2) {
      const withDetail = this.seeds.filter((s) => s.detail);
      const cap = Math.max(1, Math.floor(cfg.maxDetailSystems / 2));
      if (withDetail.length > cap) {
        withDetail.sort((a, b) => {
          const db = Math.hypot(b.pos[0] - pr.pos[0], b.pos[1] - pr.pos[1], b.pos[2] - pr.pos[2]);
          const da = Math.hypot(a.pos[0] - pr.pos[0], a.pos[1] - pr.pos[1], a.pos[2] - pr.pos[2]);
          return db - da; // 最远的先卸载
        });
        for (let i = 0; i < withDetail.length - cap; i++) withDetail[i].detail = null;
      }
    }
    let systemsWithDetail = 0;
    let totalBodies = 0;
    for (const s of this.seeds) {
      const r = this._detailRadius(s);
      if (r <= 0) continue;
      const d = Math.hypot(pr.pos[0] - s.pos[0], pr.pos[1] - s.pos[1], pr.pos[2] - s.pos[2]);
      // 远到一定程度不加载；接近到 1.4R 时一次创建多级 LOD 内部天体
      if (!s.detail && d < r * 1.4) {
        const overBudget = cfg.qualityTier >= 1
          || systemsWithDetail >= cfg.maxDetailSystems
          || totalBodies >= cfg.maxDetailBodies;
        if (overBudget) {
          // tier>=1 是持续状态不提示；预算上限触发时提示一次（每系统一次）
          if (cfg.qualityTier < 1 && !s.budgetNotified) {
            s.budgetNotified = true;
            this.events.push({ time: this.time, text: `⚙️ 已达细节预算上限（${cfg.maxDetailSystems} 系统 / ${cfg.maxDetailBodies} 天体），远处系统保持远景表示` });
          }
          continue;
        }
        this._ensureDetailSystem(s);
      }
      if (s.detail) {
        // 离开太远就释放；卸载后下次再次接近会重新创建并按 LOD 渐进显示
        if (d > r * 2.4) {
          s.detail = null;
          s.budgetNotified = false;
          continue;
        }
        // 渐进 LOD：当前距离对应的 LOD 等级 >= lodReached 时立即升级（一次性），
        // 否则 lodLerp 平滑插值（让"凝聚过程"在视觉上能感受到）
        const target = this._detailLODFor(s);
        // tier>=1：冻结 LOD 升级（不再增加天体数量），已有的继续展示
        if (cfg.qualityTier < 1 && target > s.detail.lodReached) s.detail.lodReached = target;
        const lerpRate = Math.min(1, dt * 1.6);
        s.detail.lodLerp += (s.detail.lodReached - s.detail.lodLerp) * lerpRate;
        this._updateDetailBodies(s, dt);
        this._updateSubSystems(s);
        this.activeDetails.push(s);
        systemsWithDetail += 1;
        totalBodies += s.detail.bodies.length;
      }
    }
    // 在小球前方动态补充新的休眠系统，让航线可以无限延伸。
    this._generateFrontierSeed();
  }

  _respawnFrom(center, launchR, label, captureSeedIdx = -1, deathType = 'generic') {
    const pr = this.probe;
    // ---- 持续捕获检测：若短时间内反复被同一系统捕获，改用虫洞跃迁逃逸 ----
    if (
      captureSeedIdx >= 0
      && captureSeedIdx === pr.lastCaptureSeed
      && this.time - pr.lastCaptureTime < this.config.wormholeWindow
    ) {
      this._wormholeEscape(captureSeedIdx, label);
      return;
    }
    pr.lastCaptureSeed = captureSeedIdx;
    pr.lastCaptureTime = this.time;

    pr.generation += 1;
    pr.respawns += 1;
    pr.respawnFlash = 1;
    pr.respawnGrace = 6; // 重生后 6 秒内不再捕获，保证能飞出系统继续航行
    // 记录死亡方式与位置（渲染层在generation变化时播放对应特效）
    pr.deathType = deathType;
    pr.deathPos = [pr.pos[0], pr.pos[1], pr.pos[2]];
    const rx = pr.pos[0] - center[0];
    const ry = pr.pos[1] - center[1];
    const rz = pr.pos[2] - center[2];
    const rl = Math.max(1e-4, Math.hypot(rx, ry, rz));
    let dx = rx / rl, dy = ry / rl, dz = rz / rl;
    // 加一点随机切向分量，重生后的轨迹不是简单直线。
    const tan = randomUnit(1);
    let ex = dx + tan[0] * 0.45, ey = dy + tan[1] * 0.45, ez = dz + tan[2] * 0.45;
    const el = Math.max(1e-4, Math.hypot(ex, ey, ez));
    ex /= el; ey /= el; ez /= el;
    pr.pos = [
      center[0] + ex * launchR,
      center[1] + ey * launchR,
      center[2] + ez * launchR,
    ];
    // 重生是瞬移：prevPos 同步到新位置，避免插值从旧捕获点拉出一条拖影
    pr.prevPos = pr.pos.slice();
    pr.vel = [ex * PROBE_RESPAWN_SPEED, ey * PROBE_RESPAWN_SPEED, ez * PROBE_RESPAWN_SPEED];
    pr.label = `自${label}系统重生航行`;
    const verb = DEATH_VERBS[deathType] || DEATH_VERBS.generic;
    this.events.push({ time: this.time, text: `${verb(label)}，已在边缘重生第${pr.generation}代并继续航行` });
  }

  // 虫洞跃迁：被持续捕获时不再重生到系统边缘，而是动画跳跃到远方一个新位置继续航行
  _wormholeEscape(captureSeedIdx, label) {
    const pr = this.probe;
    const seed = this.seeds[captureSeedIdx];
    const from = [pr.pos[0], pr.pos[1], pr.pos[2]];
    // 选一个与小球速度方向不同（避免再次被吸回来）的远方位置
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    let dir;
    if (sp > 0.5) {
      const scatter = randomUnit(1);
      const bx = -pr.vel[0] / sp + scatter[0] * 0.5;
      const by = -pr.vel[1] / sp + scatter[1] * 0.5;
      const bz = -pr.vel[2] / sp + scatter[2] * 0.5;
      const bl = Math.hypot(bx, by, bz) || 1;
      dir = [bx / bl, by / bl, bz / bl];
    } else {
      dir = randomUnit();
    }
    const dist = this.config.wormholeDist;
    const to = [
      pr.pos[0] + dir[0] * dist,
      pr.pos[1] + dir[1] * dist,
      pr.pos[2] + dir[2] * dist,
    ];
    pr.wormholeFrom = from;
    pr.wormholeTo = to;
    pr.wormholeTimer = this.config.wormholeDuration;
    pr.wormholeDuration = this.config.wormholeDuration;
    // 物理上把小球瞬移到 to 处，避免在动画中继续被强引力拉回
    pr.pos = to.slice();
    pr.prevPos = to.slice();
    // 给一个新航向
    const tan = randomUnit(1);
    let vx = dir[0] + tan[0] * 0.3, vy = dir[1] + tan[1] * 0.3, vz = dir[2] + tan[2] * 0.3;
    const vl = Math.max(1e-4, Math.hypot(vx, vy, vz));
    vx /= vl; vy /= vl; vz /= vl;
    pr.vel = [vx * PROBE_RESPAWN_SPEED, vy * PROBE_RESPAWN_SPEED, vz * PROBE_RESPAWN_SPEED];
    pr.respawnGrace = 6;
    pr.respawnFlash = 1;
    pr.label = `经虫洞跃迁逃出【${label}】`;
    pr.lastCaptureSeed = -1; // 成功逃逸，重置捕获记忆
    pr.lastCaptureTime = -Infinity;
    this.events.push({ time: this.time, text: `🌀 小球被【${label}】持续捕获，触发虫洞跃迁逃逸` });
  }

  _updateProbe(dt) {
    const pr = this.probe;
    // 积分前保存本步起点，供渲染层做帧间插值（消除固定步长抖动）
    pr.prevPos[0] = pr.pos[0];
    pr.prevPos[1] = pr.pos[1];
    pr.prevPos[2] = pr.pos[2];
    pr.phaseTime += dt;
    pr.respawnFlash = Math.max(0, pr.respawnFlash - dt * 0.9);
    pr.respawnGrace = Math.max(0, pr.respawnGrace - dt);
    pr.wormholeTimer = Math.max(0, pr.wormholeTimer - dt);
    const gs = this.gravityStrength;

    // 用子步长积分，近距离强引力下也保持稳定。
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let n = 0; n < steps; n++) {
      let ax = 0, ay = 0, az = 0;
      if (gs > 0.001) {
        for (const s of this.seeds) {
          const dx = s.pos[0] - pr.pos[0];
          const dy = s.pos[1] - pr.pos[1];
          const dz = s.pos[2] - pr.pos[2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < 1e-6) continue;
          const f = G * PROBE_GRAVITY_MULT * s.mass / Math.pow(r2 + EPS2, 0.95) * gs;
          ax += f * dx; ay += f * dy; az += f * dz;
        }
      }
      for (const s of this.activeDetails) {
        for (const b of s.detail.bodies) {
          const dx = b.pos[0] - pr.pos[0];
          const dy = b.pos[1] - pr.pos[1];
          const dz = b.pos[2] - pr.pos[2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < 1e-6) continue;
          const f = G * PROBE_GRAVITY_MULT * b.mass / Math.pow(r2 + 0.12, 0.95);
          ax += f * dx; ay += f * dy; az += f * dz;
          // 二级系统的行星/卫星质量小，但贴近时仍有可感知的引力
          if (b.children) {
            for (const ch of b.children) {
              const cx = ch.pos[0] - pr.pos[0];
              const cy = ch.pos[1] - pr.pos[1];
              const cz = ch.pos[2] - pr.pos[2];
              const cr2 = cx * cx + cy * cy + cz * cz;
              if (cr2 < 1e-6) continue;
              const cf = G * PROBE_GRAVITY_MULT * ch.mass / Math.pow(cr2 + 0.12, 0.95);
              ax += cf * cx; ay += cf * cy; az += cf * cz;
            }
          }
        }
      }
      pr.vel[0] += ax * h; pr.vel[1] += ay * h; pr.vel[2] += az * h;

      // 进入系统内部后，星际气体造成轻微阻尼；黑洞附近阻尼随距离增强。
      let drag = 0;
      for (const s of this.seeds) {
        const R = this._systemRadius(s);
        const dx = s.pos[0] - pr.pos[0];
        const dy = s.pos[1] - pr.pos[1];
        const dz = s.pos[2] - pr.pos[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < R) {
          let k = PROBE_DRAG * (1 - d / R);
          if (s.level === 'blackhole') {
            const cap = this._captureRadius(s);
            if (d < cap * 4) k += (1 - d / (cap * 4)) * 0.8;
          }
          drag = Math.max(drag, k);
        }
      }
      if (drag > 0) {
        const f = Math.max(0, 1 - drag * h);
        pr.vel[0] *= f; pr.vel[1] *= f; pr.vel[2] *= f;
      }
      if (this.time > 2.2) {
        const igm = Math.max(0, 1 - PROBE_IGM_DRAG * h);
        pr.vel[0] *= igm; pr.vel[1] *= igm; pr.vel[2] *= igm;
      }
      // 引力弹弓加速有界：超过上限后等比例截断，保持航行节奏与跟拍稳定
      const spd = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (spd > PROBE_MAX_SPEED) {
        const f = PROBE_MAX_SPEED / spd;
        pr.vel[0] *= f; pr.vel[1] *= f; pr.vel[2] *= f;
      }
      pr.pos[0] += pr.vel[0] * h;
      pr.pos[1] += pr.vel[1] * h;
      pr.pos[2] += pr.vel[2] * h;
    }

    // 找出对小球施加最强引力的天体系统，供智能镜头聚焦（同时显示小球与它）。
    // 影响力 = 该源对小球造成的加速度大小，越近/质量越大越强。
    let bestInf = -1, bestStr = 0;
    if (gs > 0.001) {
      for (const s of this.seeds) {
        const dx = s.pos[0] - pr.pos[0];
        const dy = s.pos[1] - pr.pos[1];
        const dz = s.pos[2] - pr.pos[2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1e-6) continue;
        const d = Math.sqrt(r2);
        const f = G * PROBE_GRAVITY_MULT * s.mass / Math.pow(r2 + EPS2, 0.95) * gs;
        const strength = f * d;
        if (strength > bestStr) { bestStr = strength; bestInf = s.idx; }
      }
    }
    pr.influencer = bestInf;
    pr.influenceStrength = bestStr;

    // ---- 绕行检测：自由航行 = 没有绕任何一个天体运动 ----
    // 每步累计"相对 influencer 连线方向转过的角度"（指数衰减窗），
    // 并计算相对速度的切向占比：
    //   直线飞掠 → 方向角几乎不转、切向占比低 → free flight；
    //   被束缚绕行 → 方向角持续累计、切向占比高 → 与天体互动。
    // 只依赖运动学量，不依赖被修改过的引力公式量纲，稳健且可调。
    pr.interactCooldown = Math.max(0, pr.interactCooldown - dt);
    if (pr.influencer >= 0) {
      const s = this.seeds[pr.influencer];
      const rx = pr.pos[0] - s.pos[0];
      const ry = pr.pos[1] - s.pos[1];
      const rz = pr.pos[2] - s.pos[2];
      const rl = Math.max(1e-6, Math.hypot(rx, ry, rz));
      const nx = rx / rl, ny = ry / rl, nz = rz / rl;
      if (pr.influencer !== pr._orbitSeed) {
        // 目标系统切换：清空累计，从当前方向重新开始观测
        pr._orbitSeed = pr.influencer;
        pr.orbitAngleAcc = 0;
        pr.straightTime = 0;
        pr._orbitDirPrev = [nx, ny, nz];
      }
      const prev = pr._orbitDirPrev;
      const dot = Math.min(1, Math.max(-1, prev[0] * nx + prev[1] * ny + prev[2] * nz));
      const dTheta = Math.acos(dot);
      pr.orbitAngleAcc = pr.orbitAngleAcc * Math.exp(-dt / 1.4) + dTheta;
      const vs = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (vs > 1e-4) {
        const vr = pr.vel[0] * nx + pr.vel[1] * ny + pr.vel[2] * nz;
        const vt = Math.sqrt(Math.max(0, vs * vs - vr * vr));
        pr.orbitTangent = vt / vs;
      }
      pr._orbitDirPrev = [nx, ny, nz];
      if (pr.orbitAngleAcc < 0.6 && pr.orbitTangent < 0.35) {
        pr.straightTime += dt;
      } else {
        pr.straightTime = 0;
      }
    } else {
      pr._orbitSeed = -1;
      pr.orbitAngleAcc = 0;
      pr.orbitTangent = 0;
      pr.straightTime = 0;
    }

    // 捕获检测：落到天体核心/事件视界就重生，不做任何预定弹射。
    // 注意：星团/星系/超星系团本身是"集合"，不会作为整体捕获小球；
    // 小球只会被这些集合中的单个成员（恒星/行星/黑洞）持久捕获。
    const mature = this.time > GRAVITY_START + 0.5;
    let nearest = -1;
    let nearestD = Infinity;
    for (const s of this.seeds) {
      const dx = s.pos[0] - pr.pos[0];
      const dy = s.pos[1] - pr.pos[1];
      const dz = s.pos[2] - pr.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < nearestD) { nearestD = d; nearest = s.idx; }
      // 只有"非集合"类（星尘 / 行星 / 恒星）作为整体才能捕获小球
      // 星团 / 星系 / 超星系团 / 黑洞 都是集合 / 多体，靠内部成员捕获
      const cap = this._captureRadius(s);
      if (mature && pr.respawnGrace <= 0 && d < cap && (s.level === 'dust' || s.level === 'void' || s.level === 'planet' || s.level === 'star')) {
        // 进入死亡序列：恒星整体捕获 = 汽化；星尘/行星 = 大气烧蚀
        this._beginDeath(s, LEVEL_LABELS[s.level] || '天体', s.idx, s.level === 'star' ? 'vaporize' : 'atmosphere', Math.max(this._systemRadius(s) * 1.1, cap * 4));
        return;
      }
    }
    for (const s of this.activeDetails) {
      for (const b of s.detail.bodies) {
        const bodiesToCheck = b.children ? [b, ...b.children] : [b];
        for (const body of bodiesToCheck) {
          const dx = body.pos[0] - pr.pos[0];
          const dy = body.pos[1] - pr.pos[1];
          const dz = body.pos[2] - pr.pos[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const hitR = body.radius + 0.18;
          if (pr.respawnGrace <= 0 && d < hitR) {
            const parent = this.seeds[body.parent];
            const isChild = body !== b;
            const typeLabel = body.type === 'star' ? '恒星' : body.type === 'planet' ? (isChild ? '卫星' : '行星') : body.type === 'galaxy' ? '星系核' : body.type === 'gas' ? '星云气体' : '黑洞';
            const label = `${LEVEL_LABELS[parent.level] || '天体'}·${typeLabel}`;
            // 二级行星/卫星 = 大气烧蚀；星系核/黑洞成员 = 潮汐撕碎；恒星 = 汽化
            const deathType = (body.type === 'blackhole' || body.type === 'galaxy') ? 'tidal' : body.type === 'star' ? 'vaporize' : 'atmosphere';
            this._beginDeath(body, label, s.idx, deathType, Math.max(1.6, body.radius * 7));
            return;
          }
        }
      }
    }

    // 标签只反映真实物理状态：自由惯性飞行 / 接近某系统 / 深入某系统。
    if (this.time < GRAVITY_START + 0.6) {
      pr.label = '随大爆炸惯性飞行';
    } else {
      pr.nearestSystem = nearest;
      pr.nearestDist = nearestD;
      const ns = this.seeds[nearest];
      const R = ns ? this._systemRadius(ns) : 1;
      if (ns && nearestD < R * 0.55) pr.label = `深入${LEVEL_LABELS[ns.level] || '天体'}系统`;
      else if (ns && nearestD < R * 1.4) pr.label = `接近${LEVEL_LABELS[ns.level] || '天体'}系统`;
      else pr.label = '自由惯性航行';
    }
    if (pr.phase !== 'free') pr.phase = 'free';
  }


  get heat() {
    return Math.max(0, 1 - this.gravityStrength);
  }

  get era() {
    const t = this.time;
    if (t < 0.35) return '奇点 · 暴胀';
    if (t < 1.6) return '超光速膨胀';
    if (t < 8.0) return '原子形成 · 黑暗时代';
    if (t < 22.0) return '宇宙网成形';
    // 进入结构演化阶段后，根据当前已出现的最高级天体命名时代。
    if (this.seeds.some((s) => s.level === 'blackhole')) return '超大质量黑洞时代';
    if (this.seeds.some((s) => s.level === 'supercluster')) return '星系团与超星系团';
    if (this.seeds.some((s) => s.level === 'galaxy')) return '星系形成时代';
    if (this.seeds.some((s) => s.level === 'cluster')) return '恒星与星团时代';
    if (this.seeds.some((s) => s.level === 'star')) return '恒星时代';
    if (this.seeds.some((s) => s.level === 'planet')) return '行星时代';
    return '原子形成 · 黑暗时代';
  }

  _recordEvents() {
    for (const s of this.seeds) {
      if (EVENT_LEVELS.includes(s.level) && !this.seenLevels.has(s.level)) {
        this.seenLevels.add(s.level);
        this.events.push({ time: this.time, text: EVENT_MESSAGES[s.level] });
      }
    }
    const milestones = [
      { time: 8, text: '⚛️ 高温等离子体冷却，原子开始形成' },
      { time: 22, text: '🕸️ 暗物质晕连接成宇宙网' },
    ];
    for (const m of milestones) {
      if (this.time >= m.time && !this.seenMilestones.has(m.time)) {
        this.seenMilestones.add(m.time);
        this.events.push({ time: this.time, text: m.text });
      }
    }
  }

  step(dt) {
    this.time += dt;
    this.gravityStrength = smoothstep(GRAVITY_START, GRAVITY_FULL, this.time);
    const gs = this.gravityStrength;

    // 暗物质晕继续向外飞行；结构形成后轻微减速，让后期尺度不会跑得太夸张。
    const seedDrag = gs > 0.02 ? 0.020 : 0;
    for (const s of this.seeds) {
      s.pos[0] += s.vel[0] * dt;
      s.pos[1] += s.vel[1] * dt;
      s.pos[2] += s.vel[2] * dt;
      if (seedDrag > 0) {
        const f = Math.max(0, 1 - seedDrag * dt);
        s.vel[0] *= f; s.vel[1] *= f; s.vel[2] *= f;
      }
      this._updateSeedFormation(s);
      // 影响半径随形成进度扩大：巨质量晕最终能把很大范围的物质拉向自己。
      // 引力影响范围对大质量晕要足够大（光年级），这样小球在远处就会被偏转
      s.influenceRadius = 4.5 + s.growth * (12.0 + s.mass * 6.0) + s.mass * 1.4;
      s.captureRate = 0.20 + s.growth * 0.55 + s.mass * 0.10;
    }
    this._tryAwakenSeed();

    // 更新普通物质
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const oldPos = p.pos.slice();

      // 自由飞行 + 种子引力。早期 gs=0，物质完全不受阻挡地高速喷射。
      let ax = 0, ay = 0, az = 0;
      if (gs > 0.001) {
        for (let j = 0; j < this.seeds.length; j++) {
          const s = this.seeds[j];
          const dx = s.pos[0] - p.pos[0];
          const dy = s.pos[1] - p.pos[1];
          const dz = s.pos[2] - p.pos[2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < 1e-6) continue;
          const f = G * s.mass / Math.pow(r2 + EPS2, 1.5) * gs;
          ax += f * dx; ay += f * dy; az += f * dz;
        }
      }
      p.vel[0] += ax * dt; p.vel[1] += ay * dt; p.vel[2] += az * dt;

      // 靠近未来天体的粒子会受到气体阻尼，帮助它们被俘获。
      if (gs > 0.08 && p.seed >= 0) {
        const s = this.seeds[p.seed];
        const d = Math.hypot(s.pos[0] - p.pos[0], s.pos[1] - p.pos[1], s.pos[2] - p.pos[2]);
        if (d < 3.0) {
          const damp = Math.max(0, 1 - 0.30 * dt * (1 - d / 3.0) * gs);
          p.vel[0] *= damp; p.vel[1] *= damp; p.vel[2] *= damp;
        }
      }
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;

      // ---- 俘获 / 轨道化：粒子被拉进暗物质晕，逐渐螺旋下落 ----
      if (!p.bound) {
        if (gs > 0.03) {
          const b = this._nearestSeed(p.pos);
          p.seed = b;
          if (b >= 0) {
            const s = this.seeds[b];
            const d = Math.hypot(s.pos[0] - p.pos[0], s.pos[1] - p.pos[1], s.pos[2] - p.pos[2]);
            const reach = s.influenceRadius * 3.2 + 1.4;
            const near = clamp01(1 - d / reach);
            // 越近俘获得越快；远处也被缓慢拉入，保证结构形成过程持续推进。
            p.capture += dt * s.captureRate * (0.10 + 0.95 * near + 0.12 * gs);
            if (p.capture >= 0.55) {
              p.bound = true;
              p.bindAmt = 0.55;
              const rx = p.pos[0] - s.pos[0];
              const ry = p.pos[1] - s.pos[1];
              const rz = p.pos[2] - s.pos[2];
              const relLen = Math.max(1e-4, Math.hypot(rx, ry, rz));
              const radialMax = 2.5 + s.influenceRadius * 0.75;
              const h = rx * s.axis[0] + ry * s.axis[1] + rz * s.axis[2];
              const radX = rx - s.axis[0] * h;
              const radY = ry - s.axis[1] * h;
              const radZ = rz - s.axis[2] * h;
              const proj = Math.max(0.15, Math.hypot(radX, radY, radZ));
              const angle = Math.atan2(radX * s.v[0] + radY * s.v[1] + radZ * s.v[2], radX * s.u[0] + radY * s.u[1] + radZ * s.u[2]);
              p.orbit = {
                angle,
                radius: Math.min(relLen, radialMax),
                height: Math.max(-radialMax * 0.5, Math.min(radialMax * 0.5, h)),
                sign: s.spinSign,
                speed: 0.35 + Math.random() * 0.35,
              };
            }
          }
        }
      } else {
        p.bindAmt = Math.min(1, p.bindAmt + dt * 0.55);
        p.capture = p.bindAmt;
        const s = this.seeds[p.seed];
        const o = p.orbit;
        if (o && s) {
          const coreR = s.level === 'blackhole'
            ? 1.05 + s.mass * 0.28
            : 0.10 + s.mass * 0.055;
          o.angle += o.sign * o.speed * dt * (0.65 + s.mass * 0.22);
          const spiral = (0.10 + s.mass * 0.075) * dt;
          let nextR = o.radius - spiral;
          if (nextR < coreR) nextR = Math.min(coreR, o.radius + spiral);
          o.radius = nextR;
          o.height *= Math.max(0, 1 - 0.20 * dt);
          const c = Math.cos(o.angle), sn = Math.sin(o.angle);
          const tx = s.u[0] * c + s.v[0] * sn;
          const ty = s.u[1] * c + s.v[1] * sn;
          const tz = s.u[2] * c + s.v[2] * sn;
          const ox = s.pos[0] + tx * o.radius + s.axis[0] * o.height;
          const oy = s.pos[1] + ty * o.radius + s.axis[1] * o.height;
          const oz = s.pos[2] + tz * o.radius + s.axis[2] * o.height;
          if (p.orbitPos) {
            const inv = dt > 1e-6 ? 1 / dt : 0;
            p.orbitVel[0] = (ox - p.orbitPos[0]) * inv;
            p.orbitVel[1] = (oy - p.orbitPos[1]) * inv;
            p.orbitVel[2] = (oz - p.orbitPos[2]) * inv;
          }
          p.orbitPos = [ox, oy, oz];
          const b = easeInOut(p.bindAmt);
          p.pos[0] = oldPos[0] + (ox - oldPos[0]) * b;
          p.pos[1] = oldPos[1] + (oy - oldPos[1]) * b;
          p.pos[2] = oldPos[2] + (oz - oldPos[2]) * b;
          p.vel[0] = p.vel[0] + (p.orbitVel[0] - p.vel[0]) * b;
          p.vel[1] = p.vel[1] + (p.orbitVel[1] - p.vel[1]) * b;
          p.vel[2] = p.vel[2] + (p.orbitVel[2] - p.vel[2]) * b;
        }
      }
    }

    // 结构统计（等级本身由 time/class 驱动，members 用于亮度/尺寸微调）
    if (gs > 0.05 && Math.random() < dt * 1.4) this._assignMembers();
    this._recordEvents();

    // 靠近大系统时才实时生成内部细节，远离后卸载。
    this._manageDetails(dt);
    // 死亡序列期间物理冻结，只播演出；结束后在 _updateDeath 内重生
    if (this._deathPending) this._updateDeath(dt);
    else this._updateProbe(dt);

    // 自动日志：每 30s 记录一条宇宙状态快照（供导出回放，不进 toast 队列）
    if (this.time - this.lastTickTime >= 30) {
      this.lastTickTime = this.time;
      const pr = this.probe;
      this.ticks.push({
        t: +this.time.toFixed(1),
        era: this.era,
        gen: pr.generation,
        speed: +Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]).toFixed(1),
        pos: pr.pos.map((v) => +v.toFixed(1)),
        formed: this.seeds.reduce((n, s) => n + (s.detail ? 1 : 0), 0),
        detailBodies: this.activeDetails.reduce((n, s) => n + s.detail.bodies.length, 0),
      });
    }
  }
}

// ---------- 纹理与颜色 ----------
function makeGlowTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRingTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(0.58, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.70, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function levelColor(level) {
  const colors = {
    void: 0x6f82b4,
    dust: 0xa9b8da,
    planet: 0xaaccff,
    star: 0xffdfa8,
    cluster: 0x9fb4ff,
    galaxy: 0x6c8cff,
    supercluster: 0x8e6bff,
    blackhole: 0xff9a3c,
  };
  return new THREE.Color(colors[level] ?? 0x8f9bb8);
}

function levelCoreScale(level, seed) {
  const m = seed.mass;
  switch (level) {
    case 'void': return 0.85 + m * 0.20;
    case 'dust': return 0.75 + m * 0.20;
    case 'planet': return 0.70 + m * 0.30;
    case 'star': return 2.00 + m * 0.70;
    case 'cluster': return 3.30 + m * 0.70;
    case 'galaxy': return 5.60 + m * 1.00;
    case 'supercluster': return 8.20 + m * 1.30;
    case 'blackhole': return 0;
    default: return 0.7;
  }
}

function levelSolidScale(level, seed) {
  const m = seed.mass;
  switch (level) {
    case 'void': return 0.04;
    case 'dust': return 0.06;
    case 'planet': return 0.16 + m * 0.12;
    case 'star': return 0.30 + m * 0.12;
    case 'cluster': return 0.36 + m * 0.10;
    case 'galaxy': return 0.45 + m * 0.10;
    case 'supercluster': return 0.55 + m * 0.11;
    case 'blackhole': return 0.90 + m * 0.24;
    default: return 0.06;
  }
}

function createCosmicSky() {
  // 无限星空背景：这是一个始终跟随相机的单位天球，
  // 不是包裹宇宙的有限椭球/球壳，因此小球无论飞多远都不会“跑出宇宙”。
  const geo = new THREE.SphereGeometry(1, 48, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform float uTime;
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      void main() {
        vec3 dir = normalize(vDir);
        vec3 p = dir * 2.7;
        float n = sin(p.x * 1.7) * sin(p.y * 2.3 + 1.2) * sin(p.z * 1.9 + 2.4);
        n += 0.5 * sin(p.x * 3.1 + p.y * 1.3) * cos(p.z * 2.7 + p.y * 2.2);
        n = n * 0.5 + 0.5;
        float band = exp(-pow((dir.y * 0.75 + dir.z * 0.35), 2.0) * 9.0);
        vec3 base = vec3(0.010, 0.016, 0.034);
        base += vec3(0.035, 0.055, 0.115) * band;
        base += vec3(0.020, 0.014, 0.055) * n;
        // 离散星点：把方向切成小格，每格随机出现一颗星
        vec3 cell = floor(dir * 220.0);
        float h = hash(cell);
        float star = smoothstep(0.9975, 1.0, h);
        vec3 starColor = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.95, 0.85), hash(cell + 7.0));
        base += starColor * star * (0.5 + hash(cell + 11.0) * 0.7);
        // 少量彩色亮星
        float bright = smoothstep(0.9997, 1.0, hash(cell + 3.0));
        base += vec3(1.0, 0.85, 0.7) * bright * 0.6;
        gl_FragColor = vec4(base, 1.0);
      }
    `,
    uniforms: { uTime: { value: 0 } },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

function createStarfield() {
  const N = 3800;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const p = randomUnit(900 + Math.random() * 3600);
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
    const b = 0.28 + Math.random() * 0.72;
    const tint = Math.random();
    if (tint < 0.12) {
      col[i * 3] = 1.0; col[i * 3 + 1] = 0.72; col[i * 3 + 2] = 0.52;
    } else if (tint < 0.24) {
      col[i * 3] = 0.55; col[i * 3 + 1] = 0.72; col[i * 3 + 2] = 1.0;
    } else {
      col[i * 3] = b;
      col[i * 3 + 1] = b * (0.86 + Math.random() * 0.14);
      col[i * 3 + 2] = b;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.15, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// 全屏爆炸闪光 / 冲击波 / 径向射线叠加层
function createFlashOverlay() {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uAlpha;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        vec2 dir = r > 0.0001 ? p / r : vec2(1.0, 0.0);

        // 奇点白闪：前 0.4 秒整屏过曝
        float flash = exp(-uTime * 9.0) * 1.35;
        // 高速膨胀的冲击波环
        float shockR = uTime * 1.25;
        float ring = exp(-pow((r - shockR) * 7.5, 2.0)) * exp(-uTime * 1.25);
        // 放射状能量射线
        float ang = atan(p.y, p.x);
        float rays = pow(max(0.0, abs(sin(ang * 16.0 + uTime * 3.0))), 26.0);
        rays *= exp(-uTime * 1.05) * 0.55 * (1.0 - smoothstep(0.15, 1.25, r));
        // 中心余晖
        float core = exp(-r * r * 18.0) * exp(-uTime * 2.6) * 0.9;

        // 色散：冲击波边缘红蓝略微分离，更像高温等离子体
        float ca = ring * 0.20 + core * 0.12;
        vec3 col = vec3(0.0);
        col += vec3(1.10, 0.98, 0.88) * flash;
        col += vec3(1.00, 0.72, 0.42) * ring;
        col += vec3(0.65, 0.78, 1.00) * rays;
        col += vec3(1.00, 0.92, 0.72) * core;
        col.r += ca * (0.6 + dir.x * 0.4);
        col.b += ca * (0.6 - dir.x * 0.4);

        float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0) * uAlpha;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, camera, mat, quad };
}

// 虫洞跃迁的全屏叠加层：屏幕中心出现一个旋转的能量环，逐渐扩张然后消失
function createWormholeOverlay() {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDur: { value: 1.4 },
      uProgress: { value: 0 }, // 0..1
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uDur;
      uniform float uProgress;
      void main() {
        if (uProgress <= 0.0 || uProgress >= 1.0) { gl_FragColor = vec4(0.0); return; }
        vec2 p = vUv * 2.0 - 1.0;
        // 拉伸感：让圆环在水平方向上略微椭圆
        p.x *= 1.0;
        float r = length(p);
        // 环半径随时间 0 → 1 增长
        float ringR = mix(0.05, 0.95, uProgress);
        // 环厚度也随时间拉宽
        float ringW = mix(0.05, 0.20, uProgress);
        float ring = exp(-pow((r - ringR) / ringW, 2.0));
        // 旋转条纹
        float ang = atan(p.y, p.x);
        float spiral = 0.5 + 0.5 * sin(ang * 6.0 + uProgress * 18.0);
        ring *= 0.55 + 0.45 * spiral;
        // 进入时整屏白闪（0.0~0.15）
        float flash = exp(-pow((uProgress - 0.0) * 6.0, 2.0)) * 0.55;
        // 中心向外扩张的能量波
        float wave = smoothstep(0.0, 1.0, 1.0 - abs(r - ringR) * 4.0) * (1.0 - uProgress);
        vec3 col = vec3(0.0);
        col += vec3(0.45, 0.75, 1.0) * ring * 0.85;
        col += vec3(1.0, 0.92, 0.78) * ring * 0.45 * spiral;
        col += vec3(1.0) * flash;
        col += vec3(0.5, 0.7, 1.0) * wave * 0.4;
        // 离开时（0.85~1.0）整屏轻微蓝色过曝
        col += vec3(0.55, 0.75, 1.0) * smoothstep(0.85, 1.0, uProgress) * 0.25;
        float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, camera, mat, quad };
}

export function createCosmosRenderer(canvas, sim) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020409);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.04, 10000);
  camera.position.set(0, 2.4, 9);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.7;
  controls.maxDistance = 8000;
  controls.screenSpacePanning = true;
  controls.rotateSpeed = 0.7;
  controls.panSpeed = 1.0;
  controls.zoomSpeed = 1.0;
  controls.minPolarAngle = 0.04;
  controls.maxPolarAngle = Math.PI - 0.04;
  // 明确启用三种交互：旋转(左键) / 平移(右键/中键) / 缩放(滚轮)
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.zoomToCursor = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  controls.target.set(0, 0, 3);
  // 阻止页面滚动/手势抢走画布滚轮与拖拽
  canvas.style.touchAction = 'none';
  canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

  const cosmicSky = createCosmicSky();
  scene.add(cosmicSky);
  const starfield = createStarfield();
  scene.add(starfield);

  // ---------- 普通物质粒子 ----------
  const pN = sim.particles.length;
  const pPos = new Float32Array(pN * 3);
  const pCol = new Float32Array(pN * 3);
  const pSize = new Float32Array(pN);
  for (let i = 0; i < pN; i++) {
    pCol[i * 3] = 0.9;
    pCol[i * 3 + 1] = 0.75;
    pCol[i * 3 + 2] = 0.55;
    pSize[i] = 0.055;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (360.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.08, 1.0, d)) * 0.92;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
  });
  const particlePoints = new THREE.Points(pGeo, pMat);
  particlePoints.frustumCulled = false;
  scene.add(particlePoints);

  // ---------- 径向速度流线：让“爆炸喷射”一眼可见 ----------
  const lineN = pN * 2;
  const linePos = new Float32Array(lineN * 3);
  const lineCol = new Float32Array(lineN * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const streakLines = new THREE.LineSegments(lineGeo, lineMat);
  streakLines.frustumCulled = false;
  scene.add(streakLines);

  // ---------- 大爆炸专用精灵 ----------
  const glowTex = makeGlowTexture();
  const ringTex = makeRingTexture();
  function makeSprite(map, color) {
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map, color, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, depthTest: false,
    }));
  }
  const flashSprite = makeSprite(glowTex, 0xffffff);
  flashSprite.position.set(0, 0, 0);
  flashSprite.scale.setScalar(1.2);
  flashSprite.renderOrder = 20;
  scene.add(flashSprite);

  const coreSprite = makeSprite(glowTex, 0xffe6b0);
  coreSprite.position.set(0, 0, 0);
  coreSprite.scale.setScalar(1.0);
  coreSprite.renderOrder = 19;
  scene.add(coreSprite);

  const shockSprite = makeSprite(ringTex, 0xffb36b);
  shockSprite.position.set(0, 0, 0);
  shockSprite.scale.setScalar(1.0);
  shockSprite.renderOrder = 21;
  scene.add(shockSprite);

  const afterglowSprite = makeSprite(glowTex, 0x7fa8ff);
  afterglowSprite.position.set(0, 0, 0);
  afterglowSprite.scale.setScalar(2.0);
  afterglowSprite.renderOrder = 10;
  scene.add(afterglowSprite);

  // 中心火球（从内部看也有体积感）
  const fireball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffe3b0, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  fireball.position.set(0, 0, 0);
  fireball.renderOrder = 18;
  scene.add(fireball);

  // ---------- 天体结构（每个暗物质晕一组） ----------
  const seedGroups = [];
  for (const s of sim.seeds) {
    const group = new THREE.Group();
    group.position.set(s.pos[0], s.pos[1], s.pos[2]);
    const m4 = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
      new THREE.Vector3(s.v[0], s.v[1], s.v[2]),
      new THREE.Vector3(s.axis[0], s.axis[1], s.axis[2]),
    );
    group.quaternion.setFromRotationMatrix(m4);

    const solid = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    solid.renderOrder = 5;
    group.add(solid);

    const core = makeSprite(glowTex, 0x8f9bb8);
    core.renderOrder = 6;
    group.add(core);

    const halo = makeSprite(glowTex, 0x6c8cff);
    halo.renderOrder = 3;
    group.add(halo);

    const disk = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1.55, 96),
      new THREE.MeshBasicMaterial({
        color: 0x6c8cff, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    disk.renderOrder = 4;
    group.add(disk);

    const hotDisk = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.78, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffb066, transparent: true, opacity: 0.65,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    hotDisk.renderOrder = 7;
    group.add(hotDisk);

    const photonRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.88, 0.035, 16, 80),
      new THREE.MeshBasicMaterial({
        color: 0xffe8d0, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    photonRing.renderOrder = 8;
    group.add(photonRing);

    const jetMat = new THREE.MeshBasicMaterial({
      color: 0xaec6ff, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const jetGeo = new THREE.ConeGeometry(0.16, 1.8, 20, 1, true);
    const jetA = new THREE.Mesh(jetGeo, jetMat);
    jetA.position.set(0, 0, 1.35);
    jetA.renderOrder = 9;
    const jetB = new THREE.Mesh(jetGeo, jetMat);
    jetB.position.set(0, 0, -1.35);
    jetB.rotation.z = Math.PI;
    jetB.renderOrder = 9;
    group.add(jetA, jetB);

    // 超星系团的伴星系亮核
    const nodes = [];
    for (let n = 0; n < 6; n++) {
      const nd = makeSprite(glowTex, 0x8e6bff);
      const a = (n / 6) * Math.PI * 2;
      const rr = 2.3 + (n % 3) * 0.95;
      nd.position.set(Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 0);
      nd.scale.setScalar(0.25);
      nd.renderOrder = 6;
      group.add(nd);
      nodes.push(nd);
    }

    seedGroups.push({
      group, solid, core, halo, disk, hotDisk, photonRing, jetA, jetB, nodes,
      coreScale: 0.5, diskAmt: 0, bhAmt: 0, nodeAmt: 0, diskAngle: Math.random() * Math.PI * 2,
      level: 'void',
    });
    scene.add(group);
  }

  // ---------- 流式细节：只有小球接近大系统时才创建内部星体 ----------
  const detailVisuals = new Map();
  function updateDetailVisuals(alpha) {
    for (const s of sim.seeds) {
      let v = detailVisuals.get(s.idx);
      if (s.detail) {
        const bodies = s.detail.bodies;
        if (!v) {
          // 预留二级系统槽位：靠近恒星后生成的行星/卫星追加写入同一点云
          const CHILD_CAP = 64;
          const cap = bodies.length + CHILD_CAP;
          const geo = new THREE.BufferGeometry();
          const pos = new Float32Array(cap * 3);
          const col = new Float32Array(cap * 3);
          const size = new Float32Array(cap);
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
          geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
          const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
            vertexShader: `
              attribute float aSize;
              varying vec3 vColor;
              void main() {
                vColor = color;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (620.0 / max(1.0, -mv.z));
                gl_Position = projectionMatrix * mv;
              }
            `,
            fragmentShader: `
              varying vec3 vColor;
              void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                float a = (1.0 - smoothstep(0.08, 1.0, d)) * 0.9;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vColor, a);
              }
            `,
          });
          const points = new THREE.Points(geo, mat);
          points.frustumCulled = false;
          points.renderOrder = 5;
          scene.add(points);
          v = { points, geo, mat, pos, col, size };
          detailVisuals.set(s.idx, v);
        }
        const pos = v.pos, col = v.col, size = v.size;
        const lerpLod = s.detail.lodLerp;
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];
          // LOD 未解锁的天体真正不可见（此前会被渲染在静止轨道位置上，
          // 破坏"靠近才展开"的节奏）
          if (b._hidden) {
            size[i] = 0;
            continue;
          }
          // LOD 出场动画：每层天体随 lodLerp 从系统核心沿轨道旋出并淡入，
          // 靠近时的观感是"星系在眼前展开成无数独立天体"
          const fadeIn = b.lod === 0 ? clamp01(lerpLod * 2.5) : clamp01(lerpLod - b.lod);
          const ease = easeInOut(fadeIn);
          if (b.orbit) {
            // 在相邻两个物理步之间插值轨道角，让绕行天体也平滑运动；
            // 轨道半径乘展开系数——出场时从内圈旋到最终轨道
            const rEff = b.orbit.radius * (0.3 + 0.7 * ease);
            const ang = b.prevAngle + (b.orbit.angle - b.prevAngle) * alpha;
            const c = Math.cos(ang), sn = Math.sin(ang);
            pos[i * 3] = s.pos[0] + s.u[0] * c * rEff + s.v[0] * sn * rEff + s.axis[0] * b.orbit.height;
            pos[i * 3 + 1] = s.pos[1] + s.u[1] * c * rEff + s.v[1] * sn * rEff + s.axis[1] * b.orbit.height;
            pos[i * 3 + 2] = s.pos[2] + s.u[2] * c * rEff + s.v[2] * sn * rEff + s.axis[2] * b.orbit.height;
          } else {
            pos[i * 3] = b.pos[0]; pos[i * 3 + 1] = b.pos[1]; pos[i * 3 + 2] = b.pos[2];
          }
          const tint = b.colorSeed;
          if (b.type === 'gas') {
            col[i * 3] = 0.50 + tint * 0.25;
            col[i * 3 + 1] = 0.35 + tint * 0.25;
            col[i * 3 + 2] = 0.85 + tint * 0.15;
            size[i] = 0.10 + tint * 0.08;
          } else if (b.type === 'star') {
            // 恒星光温分层：蓝白 → 黄白 → 橙红，"满天星"的层次感
            if (tint < 0.28) {
              col[i * 3] = 0.72; col[i * 3 + 1] = 0.84; col[i * 3 + 2] = 1.0;
            } else if (tint < 0.68) {
              col[i * 3] = 1.0; col[i * 3 + 1] = 0.88; col[i * 3 + 2] = 0.62;
            } else {
              col[i * 3] = 1.0; col[i * 3 + 1] = 0.58; col[i * 3 + 2] = 0.34;
            }
            size[i] = 0.24 + tint * 0.30;
          } else if (b.type === 'planet') {
            col[i * 3] = 0.55 + tint * 0.2;
            col[i * 3 + 1] = 0.72 + tint * 0.2;
            col[i * 3 + 2] = 0.95;
            size[i] = 0.15;
          } else if (b.type === 'galaxy') {
            col[i * 3] = 0.62; col[i * 3 + 1] = 0.70; col[i * 3 + 2] = 1.0;
            size[i] = 0.62;
          } else {
            col[i * 3] = 1.0; col[i * 3 + 1] = 0.55; col[i * 3 + 2] = 0.22;
            size[i] = 0.26;
          }
          // 加色混合下颜色乘 fadeIn 即为透明度：出场时从核心亮起
          col[i * 3] *= fadeIn;
          col[i * 3 + 1] *= fadeIn;
          col[i * 3 + 2] *= fadeIn;
          size[i] *= 0.25 + 0.75 * ease;
          // 降级档位 2：细节点整体缩小，降低 overdraw
          if (sim.config.qualityTier >= 2) size[i] *= 0.8;
        }
        // ---- 二级系统：恒星子行星/卫星追加到预留槽位 ----
        // 显示位置 = 母星显示位置 + 自身轨道偏转（角度同样插值）
        const cap = size.length;
        let slot = bodies.length;
        for (const b of bodies) {
          if (!b.children) continue;
          const pb = b;
          const pa = pb.prevAngle + (pb.orbit.angle - pb.prevAngle) * alpha;
          const pcd = Math.cos(pa), psn = Math.sin(pa);
          const sx = s.pos[0] + s.u[0] * pcd * pb.orbit.radius + s.v[0] * psn * pb.orbit.radius + s.axis[0] * pb.orbit.height;
          const sy = s.pos[1] + s.u[1] * pcd * pb.orbit.radius + s.v[1] * psn * pb.orbit.radius + s.axis[1] * pb.orbit.height;
          const sz = s.pos[2] + s.u[2] * pcd * pb.orbit.radius + s.v[2] * psn * pb.orbit.radius + s.axis[2] * pb.orbit.height;
          for (const ch of b.children) {
            if (slot >= cap) break;
            const ca = ch.prevAngle + (ch.orbit.angle - ch.prevAngle) * alpha;
            const ccd = Math.cos(ca), csn = Math.sin(ca);
            pos[slot * 3] = sx + s.u[0] * ccd * ch.orbit.radius + s.v[0] * csn * ch.orbit.radius + s.axis[0] * ch.orbit.height;
            pos[slot * 3 + 1] = sy + s.u[1] * ccd * ch.orbit.radius + s.v[1] * csn * ch.orbit.radius + s.axis[1] * ch.orbit.height;
            pos[slot * 3 + 2] = sz + s.u[2] * ccd * ch.orbit.radius + s.v[2] * csn * ch.orbit.radius + s.axis[2] * ch.orbit.height;
            const tint = ch.colorSeed;
            if (ch.type === 'gas') {
              col[slot * 3] = 0.50 + tint * 0.25;
              col[slot * 3 + 1] = 0.35 + tint * 0.25;
              col[slot * 3 + 2] = 0.85 + tint * 0.15;
              size[slot] = 0.10 + tint * 0.08;
            } else {
              col[slot * 3] = 0.55 + tint * 0.2;
              col[slot * 3 + 1] = 0.72 + tint * 0.2;
              col[slot * 3 + 2] = 0.95;
              size[slot] = 0.10;
            }
            if (sim.config.qualityTier >= 2) size[slot] *= 0.8;
            slot++;
          }
        }
        // 未用槽位尺寸清零（children 生成后不会消失，通常无需清理，防御旧数据）
        for (let i = slot; i < cap; i++) size[i] = 0;
        v.geo.attributes.position.needsUpdate = true;
        v.geo.attributes.color.needsUpdate = true;
        v.geo.attributes.aSize.needsUpdate = true;
        v.points.visible = true;
      } else if (v) {
        scene.remove(v.points);
        v.geo.dispose();
        v.mat.dispose();
        detailVisuals.delete(s.idx);
      }
    }
  }

  // 主角小球：白色实心球 + 大尺寸光晕，确保在宇宙中永远清晰可见
  const probeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  probeMesh.renderOrder = 100;
  scene.add(probeMesh);

  // 内层亮环（白色实心外层光晕 + 浅蓝光晕）
  // 光晕尺度收敛：靠近多天体系统时主角不能喧宾夺主——
  // "展开成星系"的观感要求点云天体在画面上比小球光晕更醒目
  const probeGlow = makeSprite(glowTex, 0xffffff);
  probeGlow.scale.setScalar(1.55);
  probeGlow.renderOrder = 15;
  scene.add(probeGlow);

  const probeHalo = makeSprite(glowTex, 0x9fc8ff);
  probeHalo.scale.setScalar(2.7);
  probeHalo.material.opacity = 0.42;
  probeHalo.renderOrder = 14;
  scene.add(probeHalo);

  const respawnSprite = makeSprite(ringTex, 0x8ef0ff);
  respawnSprite.visible = false;
  respawnSprite.renderOrder = 22;
  scene.add(respawnSprite);
  let lastProbeGeneration = sim.probe.generation;

  // ---- 差异化死亡特效（§9.3 碰撞与吸积）----
  // 小球死法不同，特效不同：
  //   atmosphere 行星/星尘大气烧蚀：暖橙单环，慢扩散
  //   vaporize   恒星吞没汽化：白炽强闪，快扩散短寿命
  //   tidal      黑洞/星系核潮汐撕碎：蓝白三重涟漪（延迟回声），最长寿命
  //   wormhole   虫洞逃逸：全屏虫洞叠加层已足够，不播死亡特效
  //   generic    兜底 = 原蓝色重生环
  const DEATH_FX = {
    atmosphere: { ring: 0xff8a4a, launch: 0xffb36b, halo: 0xffc9a0, expand: 6.5, life: 1.6, rings: 1, glow: 0.5 },
    vaporize: { ring: 0xfff3c4, launch: 0xffffff, halo: 0xfff3c4, expand: 12, life: 0.8, rings: 1, glow: 0.9 },
    tidal: { ring: 0xa8d4ff, launch: 0x9fd0ff, halo: 0xbfe0ff, expand: 8.5, life: 1.9, rings: 3, glow: 0.7 },
    generic: { ring: 0x8ef0ff, launch: 0x8ef0ff, halo: 0x9ff0ff, expand: 9, life: 1.1, rings: 1, glow: 0.5 },
  };
  // 死亡点特效池：3 道涟漪环 + 1 个中心炽光，按需激活
  const deathRings = [0, 1, 2].map(() => {
    const sprite = makeSprite(ringTex, 0xffffff);
    sprite.visible = false;
    sprite.renderOrder = 23;
    scene.add(sprite);
    return { sprite, active: false, age: 0, life: 1, expand: 9 };
  });
  const deathGlow = makeSprite(glowTex, 0xffffff);
  deathGlow.visible = false;
  deathGlow.renderOrder = 23;
  scene.add(deathGlow);
  let deathGlowAge = -1; // <0 表示未激活

  // 在死亡位置生成对应类型的特效
  function spawnDeathFx(pos, fx) {
    deathRings.forEach((r, i) => {
      r.active = i < fx.rings;
      // 潮汐撕碎的第 2/3 道涟漪延迟出现，形成"撕碎回声"
      r.age = -i * 0.24;
      r.life = fx.life;
      r.expand = fx.expand;
      r.sprite.position.set(pos[0], pos[1], pos[2]);
      r.sprite.material.color.setHex(fx.ring);
      r.sprite.material.rotation = Math.random() * Math.PI;
      r.sprite.visible = false;
    });
    deathGlowAge = 0;
    deathGlow.position.set(pos[0], pos[1], pos[2]);
    deathGlow.material.color.setHex(fx.ring);
  }

  function updateDeathFx(dt) {
    for (const r of deathRings) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age < 0) continue; // 延迟未到
      if (r.age >= r.life) { r.active = false; r.sprite.visible = false; continue; }
      const k = r.age / r.life;
      r.sprite.visible = true;
      r.sprite.scale.setScalar(1.4 + k * r.expand * 3);
      r.sprite.material.opacity = (1 - k) * 0.85;
    }
    if (deathGlowAge >= 0) {
      const life = 0.55;
      deathGlowAge += dt;
      if (deathGlowAge >= life) { deathGlowAge = -1; deathGlow.visible = false; }
      else {
        const k = deathGlowAge / life;
        deathGlow.visible = true;
        deathGlow.scale.setScalar(1.5 + k * 6);
        deathGlow.material.opacity = (1 - k) * 0.8;
      }
    }
  }

  const TRAIL_N = 750;
  const trailPos = new Float32Array(TRAIL_N * 3);
  const trailCol = new Float32Array(TRAIL_N * 4);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 4));
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const trail = new THREE.Line(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);
  let trailCount = 0;

  const flashOverlay = createFlashOverlay();
  // 虫洞特效叠加层
  const wormholeOverlay = createWormholeOverlay();
  let lastWormhole = 0; // 记录已处理的虫洞触发次数

  const state = {
    time: 0, timeScale: 0.8, musicIntensity: 1, follow: true,
    physAcc: 0,
    dirSmooth: new THREE.Vector3(-1, 0, 0).normalize(),
    // 智能镜头三种模式：
    //   'cruise'  跟拍小球（自由航行）
    //   'interact' 交互锁定（拉远框选小球 + 影响力系统）
    //   'detail'  细节框选（框选小球 + 最近一个 detail body）
    // 不同模式有不同的 followDist / 目标 / 视野比例
    mode: 'cruise',
    modeLerp: 0,   // 0=完全 cruise, 1=完全 interact/detail；用于平滑过渡
    detailAnchor: [0, 0, 0], // detail 模式的框选对象
    // 模式持续时间：超时后回落到 cruise，避免镜头长期卡在大视角
    modeHold: 0,
  };

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();
  const _deathDir = new THREE.Vector3();
  const _X_AXIS = new THREE.Vector3(1, 0, 0);

  function resize(w, h) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function pushTrail(x, y, z) {
    if (trailCount === TRAIL_N) {
      trailPos.copyWithin(0, 3);
      trailCol.copyWithin(0, 4);
      trailCount--;
    }
    const i3 = trailCount * 3;
    trailPos[i3] = x; trailPos[i3 + 1] = y; trailPos[i3 + 2] = z;
    trailCol[trailCount * 4] = 0.9;
    trailCol[trailCount * 4 + 1] = 0.9;
    trailCol[trailCount * 4 + 2] = 1;
    trailCol[trailCount * 4 + 3] = 0.85;
    trailCount++;
    for (let i = 0; i < trailCount; i++) {
      const t = trailCount > 1 ? i / (trailCount - 1) : 1;
      trailCol[i * 4 + 3] = t * t * 0.8;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    trailGeo.setDrawRange(0, trailCount);
  }

  const zeroAudio = () => ({ bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 });

  function updateParticles(dtReal, audioLevels) {
    const pp = pGeo.attributes.position.array;
    const pc = pGeo.attributes.color.array;
    const ps = pGeo.attributes.aSize.array;
    const heat = Math.max(0, 1 - sim.gravityStrength);
    const earlyGlow = Math.exp(-sim.time * 1.8);

    for (let i = 0; i < pN; i++) {
      const p = sim.particles[i];
      pp[i * 3] = p.pos[0]; pp[i * 3 + 1] = p.pos[1]; pp[i * 3 + 2] = p.pos[2];
      let cr, cg, cb, size;
      if (p.seed >= 0) {
        const seed = sim.seeds[p.seed];
        const c = levelColor(seed.level);
        cr = c.r; cg = c.g; cb = c.b;
        const lv = seed.level;
        if (lv === 'void' || lv === 'dust') {
          size = 0.035 + heat * 0.05 + earlyGlow * 0.05;
        } else if (lv === 'planet') {
          size = 0.025 + seed.mass * 0.02;
        } else if (lv === 'star' || lv === 'cluster') {
          size = 0.040 + seed.mass * 0.02;
        } else if (lv === 'galaxy' || lv === 'supercluster') {
          size = 0.030 + seed.mass * 0.012;
        } else {
          size = 0.035;
          cr = 1.0; cg = 0.62; cb = 0.25;
        }
      } else {
        cr = 0.95; cg = 0.72; cb = 0.5;
        size = 0.055;
      }
      const mix = Math.min(1, heat * 1.35 + earlyGlow * 0.35);
      pc[i * 3] = cr * (1 - mix) + 0.98 * mix;
      pc[i * 3 + 1] = cg * (1 - mix) + 0.78 * mix;
      pc[i * 3 + 2] = cb * (1 - mix) + 0.55 * mix;
      ps[i] = size * (0.9 + audioLevels.beat * state.musicIntensity * 0.25);
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;

    // 径向流线：速度越快线越长、越亮
    const lp = lineGeo.attributes.position.array;
    const lc = lineGeo.attributes.color.array;
    for (let i = 0; i < pN; i++) {
      const p = sim.particles[i];
      const vx = p.vel[0], vy = p.vel[1], vz = p.vel[2];
      const sp = Math.hypot(vx, vy, vz);
      const len = Math.min(3.2, 0.08 + sp * 0.16 + heat * 0.35);
      const inv = sp > 1e-5 ? len / sp : 0;
      const i6 = i * 6;
      lp[i6] = p.pos[0] - vx * inv;
      lp[i6 + 1] = p.pos[1] - vy * inv;
      lp[i6 + 2] = p.pos[2] - vz * inv;
      lp[i6 + 3] = p.pos[0];
      lp[i6 + 4] = p.pos[1];
      lp[i6 + 5] = p.pos[2];
      let a = 0.10;
      if (sim.time < 1.2) a = 0.22 + heat * 0.45;
      else if (sim.time < 4.5) a = 0.10 + heat * 0.30;
      else if (p.bound && sp > 0.5) a = 0.12;
      const tw = 0.85 + Math.sin(sim.time * 3 + i) * 0.15;
      lc[i6] = 1.0 * tw;
      lc[i6 + 1] = (0.72 + heat * 0.25) * tw;
      lc[i6 + 2] = (0.45 + heat * 0.42) * tw;
      const j6 = i6 + 3;
      lc[j6] = lc[i6] * a;
      lc[j6 + 1] = lc[i6 + 1] * a;
      lc[j6 + 2] = lc[i6 + 2] * a;
    }
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;
  }

  function updateExplosion() {
    const t = sim.time;
    // 白热奇点闪光
    const flashA = Math.exp(-t * 7.5);
    flashSprite.scale.setScalar(0.9 + t * 30 + (1 - flashA) * 2);
    flashSprite.material.opacity = Math.min(1, 0.35 + flashA);
    flashSprite.visible = flashA > 0.004;

    // 中心火球：急速膨胀并冷却变淡
    const coreA = Math.exp(-t * 2.4);
    coreSprite.scale.setScalar(1.1 + t * 8.5);
    coreSprite.material.opacity = Math.min(1, 0.25 + coreA * 0.9);
    coreSprite.visible = coreA > 0.004;
    fireball.scale.setScalar(Math.max(0.001, 0.28 + t * 2.3));
    fireball.material.opacity = Math.max(0, 0.85 * coreA);
    fireball.visible = coreA > 0.006;

    // 球形冲击波
    const shockA = Math.exp(-t * 1.55);
    shockSprite.scale.setScalar(Math.max(0.001, 0.35 + t * 14.5));
    shockSprite.material.opacity = Math.min(1, 0.2 + shockA * 0.85);
    shockSprite.visible = shockA > 0.004;

    // 冷却后的蓝色余晖星云
    const afterA = Math.exp(-t * 0.42);
    afterglowSprite.scale.setScalar(2.2 + t * 6.5);
    afterglowSprite.material.opacity = Math.min(0.32, 0.08 + afterA * 0.20);
    afterglowSprite.visible = afterA > 0.006;

    flashOverlay.mat.uniforms.uTime.value = t;
    flashOverlay.mat.uniforms.uAlpha.value = t < 5.0 ? 1 : Math.max(0, 1 - (t - 5) * 2);
  }

  function updateStructures(dtReal, audioLevels, pulse) {
    const k = Math.min(1, dtReal * 2.8);
    for (let i = 0; i < sim.seeds.length; i++) {
      const s = sim.seeds[i];
      const g = seedGroups[i];
      const lv = s.level;
      g.group.position.set(s.pos[0], s.pos[1], s.pos[2]);
      // 小球贴近后，集合类系统（星团/星系/超星系团/尘埃云）的远景表示
      // 让位于内部点云：视觉从"一个发光天体"切换成"无数天体组成的星系"。
      // 淡出区间与 LOD0 出现阈值（detailR*0.7）衔接，避免视觉空窗。
      const pd = Math.hypot(
        sim.probe.pos[0] - s.pos[0],
        sim.probe.pos[1] - s.pos[1],
        sim.probe.pos[2] - s.pos[2],
      );
      const detailR = sim._detailRadius(s) || sim._systemRadius(s);
      const isCollection = lv === 'cluster' || lv === 'galaxy' || lv === 'supercluster'
        || lv === 'dust' || lv === 'void';
      // 核心光斑/实心球在 detail 点云创建（1.4R）前后就让位，
      // "一个发光天体"的观感随点云出场平滑交接给"无数天体"
      const coreFade = isCollection ? smoothstep(detailR * 1.0, detailR * 1.5, pd) : 1;
      const nearFade = isCollection
        ? smoothstep(detailR * 0.7, detailR * 1.15, pd)
        : 1;
      const m4 = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
        new THREE.Vector3(s.v[0], s.v[1], s.v[2]),
        new THREE.Vector3(s.axis[0], s.axis[1], s.axis[2]),
      );
      g.group.quaternion.setFromRotationMatrix(m4);

      if (lv !== g.level) {
        g.level = lv;
        g.solid.material.color.copy(levelColor(lv));
        if (lv === 'blackhole') g.solid.material.color.setRGB(0, 0, 0);
      }
      const targetCore = levelCoreScale(lv, s);
      g.coreScale += (targetCore - g.coreScale) * k;
      g.core.scale.setScalar(Math.max(0.001, g.coreScale * pulse));
      g.core.material.color.copy(levelColor(lv));
      g.core.material.opacity = coreFade;
      g.core.visible = lv !== 'blackhole' && coreFade > 0.02;

      const targetSolid = levelSolidScale(lv, s);
      g.solid.scale.setScalar(targetSolid * pulse);
      // 集合类系统的远景实心球近距隐藏（点云接管）；黑洞视界黑球保留
      g.solid.visible = lv !== 'void' && targetSolid > 0.01 && coreFade > 0.05;
      if (lv === 'blackhole') {
        g.solid.material.color.setRGB(0, 0, 0);
      } else {
        g.solid.material.color.copy(levelColor(lv));
        g.solid.material.color.offsetHSL(0, -0.05, 0.15);
      }

      const isDisk = lv === 'galaxy' || lv === 'supercluster';
      const isBH = lv === 'blackhole';
      const targetDisk = isDisk ? 1 : 0;
      g.diskAmt += (targetDisk - g.diskAmt) * k;
      g.bhAmt += ((isBH ? 1 : 0) - g.bhAmt) * k;
      g.nodeAmt += ((lv === 'supercluster' ? 1 : 0) - g.nodeAmt) * k;

      // 旋涡星系盘（越晚期的大结构越大，保证在全局视角也清晰可见）
      const diskBase = lv === 'supercluster' ? 3.8 + s.mass * 1.1 : 2.6 + s.mass * 0.85;
      g.disk.scale.setScalar(Math.max(0.001, diskBase * (0.22 + 0.78 * g.diskAmt) * pulse));
      g.disk.material.opacity = (0.14 + 0.46 * g.diskAmt * (0.8 + audioLevels.bass * 0.3)) * nearFade;
      g.disk.material.color.copy(levelColor(lv));
      g.disk.visible = g.diskAmt > 0.01 && nearFade > 0.02;

      // 黑洞内盘 / 光子环 / 喷流
      const bhScale = 1.65 + s.mass * 0.34;
      g.hotDisk.scale.setScalar(Math.max(0.001, bhScale * (0.25 + 0.75 * g.bhAmt) * pulse));
      g.hotDisk.material.opacity = 0.65 * g.bhAmt * (0.85 + audioLevels.energy * 0.3);
      g.hotDisk.visible = g.bhAmt > 0.01;
      g.photonRing.scale.setScalar(Math.max(0.001, bhScale * (0.25 + 0.75 * g.bhAmt)));
      g.photonRing.material.opacity = 0.95 * g.bhAmt;
      g.photonRing.visible = g.bhAmt > 0.01;
      const jetScale = bhScale * (0.55 + 0.18 * Math.sin(sim.time * 6 + i * 1.7) + audioLevels.beat * 0.25) * g.bhAmt;
      g.jetA.scale.setScalar(Math.max(0.001, jetScale));
      g.jetB.scale.setScalar(Math.max(0.001, jetScale));
      g.jetA.position.z = bhScale * 0.82;
      g.jetB.position.z = -bhScale * 0.82;
      g.jetA.material.opacity = 0.5 * g.bhAmt;
      g.jetB.material.opacity = 0.5 * g.bhAmt;
      g.jetA.visible = g.jetB.visible = g.bhAmt > 0.01;

      // 光晕：休眠/形成中的种子也要清晰可见（航线上亮起的光点），
      // 大结构（星系/黑洞）的光晕随结构成形淡入。
      let haloTarget, haloFade;
      if (lv === 'galaxy') { haloTarget = 5.5 + s.mass * 1.2; haloFade = g.diskAmt; }
      else if (lv === 'supercluster') { haloTarget = 9.0 + s.mass * 1.7; haloFade = g.diskAmt; }
      else if (lv === 'blackhole') { haloTarget = 2.6 + s.mass * 0.5; haloFade = g.bhAmt; }
      else if (lv === 'cluster') { haloTarget = 2.2 + s.mass * 0.6; haloFade = 0.55; }
      else if (lv === 'star') { haloTarget = 1.7 + s.mass * 0.5; haloFade = 0.5; }
      else if (lv === 'planet') { haloTarget = 1.3 + s.mass * 0.4; haloFade = 0.4; }
      else { haloTarget = 2.0 + s.mass * 0.55; haloFade = 0.9; } // void / dust
      g.halo.scale.setScalar(Math.max(0.001, haloTarget * pulse * (0.5 + 0.5 * Math.max(g.diskAmt, g.bhAmt))));
      g.halo.material.color.copy(levelColor(lv));
      g.halo.material.opacity = 0.30 * haloFade * nearFade;
      g.halo.visible = g.halo.material.opacity > 0.01;

      // 超星系团伴星系（近看由点云的 6 个星系核接管）
      for (let n = 0; n < g.nodes.length; n++) {
        g.nodes[n].scale.setScalar((0.28 + (n % 3) * 0.12) * g.nodeAmt * pulse);
        g.nodes[n].material.opacity = 0.7 * g.nodeAmt * nearFade;
        g.nodes[n].visible = g.nodeAmt > 0.01 && nearFade > 0.02;
      }

      // 旋转动画：星系盘与黑洞吸积盘持续旋转
      const spinBase = lv === 'blackhole' ? 2.2 : lv === 'galaxy' ? 0.85 : lv === 'supercluster' ? 0.5 : 0.25;
      g.diskAngle += dtReal * spinBase * (0.75 + audioLevels.bass * 0.8);
      g.disk.rotation.z = g.diskAngle;
      g.hotDisk.rotation.z = -g.diskAngle * (lv === 'blackhole' ? 1.6 : 1.0);
      g.photonRing.rotation.z = g.diskAngle * 0.35;
    }
  }

  function render(dtReal, audio) {
    state.time += dtReal;
    state.physAcc += dtReal * state.timeScale;
    const PHYS_DT = 0.02;
    let guard = 0;
    while (state.physAcc >= PHYS_DT && guard < 8) {
      sim.step(PHYS_DT);
      state.physAcc -= PHYS_DT;
      guard++;
    }
    if (state.physAcc > PHYS_DT * 12) state.physAcc = PHYS_DT * 12;

    // 固定物理步长与显示帧率不同步会让人看到小球“一颤一颤”：
    // 在相邻两个物理步之间按剩余相位 alpha 插值出显示位置，保证运动平滑连续。
    const pr = sim.probe;
    const alpha = Math.min(1, state.physAcc / PHYS_DT);
    const px = pr.prevPos[0] + (pr.pos[0] - pr.prevPos[0]) * alpha;
    const py = pr.prevPos[1] + (pr.pos[1] - pr.prevPos[1]) * alpha;
    const pz = pr.prevPos[2] + (pr.pos[2] - pr.prevPos[2]) * alpha;

    const audioLevels = audio && typeof audio.getLevels === 'function' ? audio.getLevels() : zeroAudio();
    const beat = Math.min(1, audioLevels.beat * state.musicIntensity);
    const energy = Math.min(1, audioLevels.energy * state.musicIntensity);
    const pulse = 1 + beat * 0.22 + energy * 0.10;

    updateParticles(dtReal, audioLevels);
    updateExplosion();
    updateStructures(dtReal, audioLevels, pulse);
    updateDetailVisuals(alpha);

    // 死亡序列起点：立即播死亡特效，并标记本次死亡已播（重生时不再重复）
    if (pr.dying && !state._prevDying) {
      state._deathFx = DEATH_FX[pr.deathType] || DEATH_FX.generic;
      if (pr.deathType !== 'wormhole') {
        spawnDeathFx(pr.deathPos, state._deathFx);
        state._fxSpawnedForDeath = true;
      }
    }
    state._prevDying = pr.dying;
    if (pr.generation !== lastProbeGeneration) {
      lastProbeGeneration = pr.generation;
      trailCount = 0;
      trailGeo.setDrawRange(0, 0);
      // 重生后速度方向突变：立即把平滑方向对准新航向，避免镜头甩偏
      const pv0 = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (pv0 > 0.02) state.dirSmooth.set(pr.vel[0] / pv0, pr.vel[1] / pv0, pr.vel[2] / pv0);
      // 死亡方式驱动的特效与配色（虫洞逃逸不播死亡特效）；
      // 死亡序列起点已播过则不重复
      state._deathFx = DEATH_FX[pr.deathType] || DEATH_FX.generic;
      if (pr.deathType !== 'wormhole' && !state._fxSpawnedForDeath) spawnDeathFx(pr.deathPos, state._deathFx);
      state._fxSpawnedForDeath = false;
    }
    probeMesh.position.set(px, py, pz);
    probeGlow.position.copy(probeMesh.position);
    probeHalo.position.copy(probeMesh.position);
    // probe glow 始终在屏幕上看起来是个明显的光点；远时更大、近时稍小。
    // 基准收敛：靠近多天体系统时主角不能喧宾夺主——
    // "展开成星系"的观感要求点云天体在画面上比小球光晕更醒目
    const camDist = camera.position.distanceTo(probeMesh.position);
    const glowScale = 2.1 * Math.max(0.55, Math.min(2.2, 16 / Math.max(camDist, 4)));
    probeGlow.scale.setScalar(glowScale);
    probeHalo.scale.setScalar(glowScale * 1.4);
    // ---- 死亡演出：潮汐拉伸（意大利面化）/ 汽化收缩 / 烧蚀压缩 + 配色跟随 ----
    if (pr.dying) {
      const k = 1 - Math.max(0, pr.dyingT) / Math.max(1e-4, pr.dyingDur);
      if (pr.deathType === 'tidal') {
        const kp = pr.deathKillerPos;
        _deathDir.set(kp[0] - px, kp[1] - py, kp[2] - pz);
        if (_deathDir.lengthSq() > 1e-8) {
          _deathDir.normalize();
          probeMesh.quaternion.setFromUnitVectors(_X_AXIS, _deathDir);
        }
        probeMesh.scale.set(1 + 3.5 * k, Math.max(0.12, 1 - 0.8 * k), Math.max(0.12, 1 - 0.8 * k));
        probeGlow.scale.setScalar(glowScale * (1 + 1.2 * k));
      } else if (pr.deathType === 'vaporize') {
        probeMesh.scale.setScalar(Math.max(0.06, 1 - k));
        probeGlow.scale.setScalar(glowScale * (1 + 2.5 * k));
      } else {
        probeMesh.scale.setScalar(1 - 0.3 * k);
      }
    } else {
      probeMesh.scale.setScalar(1);
    }
    // 重生高亮/死亡期间配色跟随死亡方式：汽化偏白、烧蚀偏暖橙、潮汐偏蓝白
    const deathFx = state._deathFx || DEATH_FX.generic;
    const highlight = pr.dying || pr.respawnFlash > 0.05;
    probeGlow.material.color.setHex(highlight ? deathFx.halo : 0xffffff);
    probeHalo.material.color.setHex(highlight ? deathFx.halo : 0x9fc8ff);

    if (pr.respawnFlash > 0.01) {
      respawnSprite.visible = true;
      respawnSprite.position.copy(probeMesh.position);
      respawnSprite.scale.setScalar(1.6 + (1 - pr.respawnFlash) * 9);
      respawnSprite.material.opacity = Math.min(1, pr.respawnFlash * 1.1);
      respawnSprite.material.color.setHex(deathFx.launch);
    } else {
      respawnSprite.visible = false;
    }
    updateDeathFx(dtReal);
    pushTrail(px, py, pz);

    // 虫洞特效：probe.wormholeTimer > 0 时驱动全屏叠加层
    if (pr.wormholeTimer > 0) {
      const whDur = pr.wormholeDuration || 1.4;
      const elapsed = whDur - pr.wormholeTimer;
      wormholeOverlay.mat.uniforms.uProgress.value = Math.min(1, elapsed / whDur);
    } else {
      wormholeOverlay.mat.uniforms.uProgress.value = 0;
    }

    if (state.follow) {
      controls.enabled = false;
      if (sim.time < 2.3) {
        // 智能镜头第一阶段：暴胀刚刚结束，宇宙还很空。
        // 镜头留在奇点附近，完整看到火球、冲击波和高速喷流。
        const ovAng = sim.time * 0.10;
        const overviewDist = 13 + sim.time * 9;
        _v2.set(
          Math.cos(ovAng) * overviewDist * 0.72,
          overviewDist * 0.50,
          Math.sin(ovAng) * overviewDist * 0.72,
        );
        _v3.set(0, 0, 0);
        const shake = Math.exp(-sim.time * 2.0) * 0.22;
        if (shake > 0.002) {
          _v2.x += Math.sin(sim.time * 83) * shake;
          _v2.y += Math.cos(sim.time * 77) * shake;
        }
        camera.position.lerp(_v2, Math.min(1, dtReal * 2.0));
        controls.target.lerp(_v3, Math.min(1, dtReal * 2.4));
        camera.lookAt(controls.target);
      } else {
        // 智能镜头第二阶段：跟拍小球，根据状态切换模式
        const pv = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
        // ---- 决定当前镜头模式（必须在更新 dirSmooth 之前算） ----
        // 优先级：detail > interact > cruise
        // interact/detail 的进入条件更宽：只要小球进入了"某系统的强引力范围"，
        // 镜头立刻切到上帝视角，避免在引力拉扯时跟拍视角甩来甩去。
        let mode = 'cruise';
        let anchorX = 0, anchorY = 0, anchorZ = 0;
        let aabbRadius = 0;
        if (sim.activeDetails.length > 0) {
          let bestB = null;
          let bestD = Infinity;
          for (const s of sim.activeDetails) {
            for (const b of s.detail.bodies) {
              if (b._hidden) continue;
              const d = Math.hypot(b.pos[0] - px, b.pos[1] - py, b.pos[2] - pz);
              if (d < bestD) { bestD = d; bestB = b; }
            }
          }
          // 离小球最近的 detail body：切 detail 模式让用户看清"它在与什么交互"。
          // 同样带滞回：进入 0.6R，维持放宽到 0.85R，避免在成员密集的系统
          // 内部因最近距离抖动而 detail↔cruise 闪跳。
          if (bestB) {
            const parentR = sim._systemRadius(sim.seeds[bestB.parent]);
            const inDetail = state.mode === 'detail' && state._detailBody === bestB;
            if (bestD < (inDetail ? parentR * 0.85 : parentR * 0.6)) {
              mode = 'detail';
              state._detailBody = bestB;
              anchorX = bestB.pos[0];
              anchorY = bestB.pos[1];
              anchorZ = bestB.pos[2];
              aabbRadius = Math.max(2, bestD * 0.9 + bestB.radius * 1.2);
            }
          }
        }
        if (mode === 'cruise' && pr.influencer >= 0) {
          const s = sim.seeds[pr.influencer];
          const sd = Math.hypot(px - s.pos[0], py - s.pos[1], pz - s.pos[2]);
          const R = sim._systemRadius(s);
          // 交互判定（带滞回）：自由航行 = 没有绕任何一个天体运动，
          // 且离天体还有较远距离。只有真正深入系统本体、并确实在绕行
          // （方向角持续累计）或被极强束缚（黑洞贴脸）时才切上帝视角；
          // 远距离的引力偏转 / 直线穿越不再误触发。
          // 进入阈值 0.9R 与维持阈值 1.9R 构成滞回带，
          // 退出后 interactCooldown 冷却 4s，杜绝 cruise↔interact 来回跳。
          if (state.mode === 'interact' && pr.influencer === state._interactSeed) {
            // 维持：阈值放宽，且未恢复持续直线飞行
            if (sd < R * 1.9 && pr.straightTime < 2.5) {
              mode = 'interact';
            }
          } else if (
            pr.interactCooldown <= 0
            && sd < R * 0.9
            && (pr.orbitAngleAcc > 2.0 || pr.influenceStrength > 0.9)
          ) {
            mode = 'interact';
          }
          if (mode === 'interact') {
            state._interactSeed = pr.influencer;
            anchorX = s.pos[0]; anchorY = s.pos[1]; anchorZ = s.pos[2];
            aabbRadius = Math.max(3, sd * 0.55 + R * 0.9);
          }
        }
        // 持续计数：每次进入 interact/detail 就重置 modeHold，超时后回到 cruise
        if (mode === state.mode) {
          // 模式稳定后倒计时；只有持续满足条件才让交互模式自然结束
          if (mode !== 'cruise') {
            state.modeHold = Math.max(0, state.modeHold - dtReal);
            if (state.modeHold <= 0) {
              mode = 'cruise';
              state._holdExpired = true; // modeHold 到期不是条件退出，不设冷却
            }
          }
        } else {
          state._modeTransitions = (state._modeTransitions || 0) + 1;
          state._lastTransition = `${state.mode}->${mode}@t=${sim.time.toFixed(1)}`;
          // 从 interact 因条件不满足而退出时启动冷却：小球刚离开系统时
          // 绕行判据可能短暂抖动，冷却期内不再进入，镜头稳定回到跟拍
          if (state.mode === 'interact' && mode === 'cruise' && !state._holdExpired) {
            pr.interactCooldown = 4.0;
          }
          state._holdExpired = false;
          state.mode = mode;
          state.modeHold = (mode === 'cruise') ? 0 : 6.0; // 交互模式至少持续 6s
        }
        // 模式混合：cruise↔interact/detail 平滑过渡
        // 独立于 modeHold：进入交互模式时 0.5 秒内 ml 升到 1
        const targetLerp = (mode === 'cruise') ? 0 : 1;
        const lerpRate = (mode === 'cruise') ? 1.0 : 4.0; // 进入快，退出更慢
        state.modeLerp += (targetLerp - state.modeLerp) * Math.min(1, dtReal * lerpRate);
        const ml = state.modeLerp;
        const mlVisible = ml; // 视觉过渡用的混合量

        // ---- dirSmooth 只在 cruise 模式下更新 ----
        // 关键修复：引力拉扯下速度方向会一帧大角度反转，让镜头甩来甩去。
        // 这里采用三重防护：
        //   1) lerp 上限 0.06/帧（极慢收敛），让 dirSmooth 反映"惯性航向"而非"瞬时速度"
        //   2) xz 平面优先：保证 cruise 模式镜头不出现 y 轴急剧旋转
        //   3) 若小球加速度大于阈值（被引力急拉），暂停更新 dirSmooth，让镜头保持当前角度
        if (mode === 'cruise' && pv > 0.02) {
          // 计算小球加速度大小：影响剧烈时（dv/帧 > 0.5）就锁住 dirSmooth
          const ax = pr.vel[0] - pr.prevVel[0];
          const ay = pr.vel[1] - pr.prevVel[1];
          const az = pr.vel[2] - pr.prevVel[2];
          const accelMag = Math.hypot(ax, ay, az) / Math.max(dtReal, 1e-4);
          if (accelMag < 0.6) {
            const txv = pr.vel[0] / pv;
            const tyv = pr.vel[1] / pv;
            const tzv = pr.vel[2] / pv;
            // 角度偏差大时缓慢收敛（避免重生/急转后甩）
            const dot = Math.min(1, Math.max(-1, state.dirSmooth.x * txv + state.dirSmooth.y * tyv + state.dirSmooth.z * tzv));
            const k = Math.min(0.06, dtReal * (0.6 + (1 - dot) * 1.2));
            state.dirSmooth.x += (txv - state.dirSmooth.x) * k;
            state.dirSmooth.y += (tyv - state.dirSmooth.y) * k;
            state.dirSmooth.z += (tzv - state.dirSmooth.z) * k;
            // 归一化；若 xz 投影过小，强制 y 分量为 0 避免垂直翻转
            const dl = Math.hypot(state.dirSmooth.x, state.dirSmooth.y, state.dirSmooth.z) || 1;
            state.dirSmooth.x /= dl; state.dirSmooth.y /= dl; state.dirSmooth.z /= dl;
          }
        }
        // 记录上一物理步速度，下一帧用于判断加速度
        pr.prevVel = [pr.vel[0], pr.vel[1], pr.vel[2]];
        _v1.set(px, py, pz);
        const tsBoost = Math.max(0.3, Math.sqrt(state.timeScale));

        // ---- 计算镜头目标位置 / 视点 ----
        // 关键修复：target 和 camera 位置都按当前 mode 计算，不按 ml 阈值分支。
        // 之前用 ml<0.01 切换 cruise/interact 公式，导致 mode 切回 cruise 但 ml 还是
        // 高位时，target 已被 lerp 拉回 probe，但 camera 还停在 (probe+anchor)/2 视点
        // 的"上帝视角"位置，造成 probe 偏离屏幕中央。
        // 视点：cruise = probe；interact/detail = (probe + anchor) / 2
        let targetX, targetY, targetZ;
        if (mode === 'cruise') {
          targetX = px; targetY = py; targetZ = pz;
        } else {
          targetX = (px + anchorX) * 0.5;
          targetY = (py + anchorY) * 0.5;
          targetZ = (pz + anchorZ) * 0.5;
        }
        // ml 用来平滑 target 的过渡（避免 mode 切换时 target 跳变）
        const finalTgtX = px + (targetX - px) * ml;
        const finalTgtY = py + (targetY - py) * ml;
        const finalTgtZ = pz + (targetZ - pz) * ml;
        _v3.set(finalTgtX, finalTgtY, finalTgtZ);

        // 镜头距离：根据 AABB 半径自动算出能框下所有对象的距离
        const fovRad = (camera.fov * Math.PI) / 180;
        const distForFrame = (aabbRadius * 1.65) / Math.max(0.05, Math.sin(fovRad * 0.5));
        const cruiseDist = 16;
        const targetDist = Math.max(
          cruiseDist * (1 - ml) + (distForFrame > cruiseDist ? distForFrame : cruiseDist) * ml,
          12,
        );

        // ---- 镜头位置（按 mode 计算） ----
        let cruiseX, cruiseY, cruiseZ;
        let interactX, interactY, interactZ;

        // cruise 位置：沿 dirSmooth 反方向退 + 抬高。
        // dirSmooth 的 xz 投影过小时（y 轴运动），保留当前 camera 相对 probe 的角度。
        const dxs = state.dirSmooth.x;
        const dzs = state.dirSmooth.z;
        const dlen2 = dxs * dxs + dzs * dzs;
        if (dlen2 > 1e-3) {
          const ilen = 1 / Math.sqrt(dlen2);
          cruiseX = px + dxs * ilen * (-targetDist);
          cruiseZ = pz + dzs * ilen * (-targetDist);
        } else {
          const offX = camera.position.x - px;
          const offZ = camera.position.z - pz;
          const offLen = Math.hypot(offX, offZ) || 1;
          cruiseX = px + (offX / offLen) * (-targetDist);
          cruiseZ = pz + (offZ / offLen) * (-targetDist);
        }
        cruiseY = py + 3.0;

        // interact/detail 位置：视点(target)反 anchor 方向拉远，俯视
        let dx, dy, dz;
        if (mode === 'interact' || mode === 'detail') {
          dx = targetX - anchorX;
          dy = targetY - anchorY;
          dz = targetZ - anchorZ;
        } else {
          dx = targetX - px;
          dy = targetY - py;
          dz = targetZ - pz;
        }
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        const rightLen = Math.hypot(dx, dz) || 1;
        const nx = dx / rightLen, nz = dz / rightLen;
        interactX = targetX + nx * (-targetDist * 0.85);
        interactY = targetY + targetDist * 0.35;
        interactZ = targetZ + nz * (-targetDist * 0.85);

        // 混合两个位置（用 ml 而不是 mlVisible 阈值，避免 ml=0 时跳变）
        const camX = cruiseX * (1 - ml) + interactX * ml;
        const camY = cruiseY * (1 - ml) + interactY * ml;
        const camZ = cruiseZ * (1 - ml) + interactZ * ml;
        _v2.set(camX, camY, camZ);

        // 平滑插值（位置/视点都做 0.10/帧 上限；引力拉扯下保证镜头不甩）
        const posK = Math.min(0.10, dtReal * (2.2 + pv * 0.10) * tsBoost);
        const tgtK = Math.min(0.12, dtReal * (3.2 + pv * 0.10) * tsBoost);
        camera.position.lerp(_v2, posK);
        controls.target.lerp(_v3, tgtK);
        camera.lookAt(controls.target);
      }
    } else {
      controls.enabled = true;
      controls.update();
    }

    // 无限星空跟随相机：任何位置周围都是宇宙星空，不存在“跑出宇宙”。
    cosmicSky.position.copy(camera.position);
    starfield.position.copy(camera.position);

    // 先渲染主场景，再叠加全屏爆炸闪光层与虫洞特效
    renderer.autoClear = true;
    renderer.render(scene, camera);
    if (flashOverlay.mat.uniforms.uAlpha.value > 0.002) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(flashOverlay.scene, flashOverlay.camera);
    }
    if (wormholeOverlay.mat.uniforms.uProgress.value > 0.001) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(wormholeOverlay.scene, wormholeOverlay.camera);
    }
    renderer.autoClear = true;
  }

  return {
    render, resize, state, camera, scene, controls,
    stars: [], ripples: [],
    setFollowEnabled(v) {
      if (state.follow && !v) {
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        controls.target.copy(camera.position).addScaledVector(fwd, 12);
        controls.update();
        controls.enabled = true;
      }
      state.follow = v;
      if (v) controls.enabled = false;
    },
    dispose() {
      controls.dispose();
      renderer.dispose();
    },
  };
}
