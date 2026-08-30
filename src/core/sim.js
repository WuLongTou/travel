// 宇宙大爆炸模拟 · 物理域（模拟域）
// CosmicSimulation：宇宙演化主循环、种子/粒子状态机、小球物理、
// 捕获/重生/虫洞、渐进发现、成员布局与子星系（目录梳理第三步：
// 从 src/cosmos.js 拆出，渲染域见 src/render/renderer.js）。
import {
  DYN_G, EPS2, N_PARTICLES, N_CLOUD_PARTICLES, N_EJECTA_PARTICLES,
  GRAVITY_START, GRAVITY_FULL, BASE_SPEED,
  SEED_R_MIN, SEED_R_MAX, EJECTA_SPEED_MIN, EJECTA_SPEED_MAX,
  PROBE_INITIAL_SPEED, PROBE_BIGBANG_SPEED, BIG_BANG_WALL, PROBE_GRAVITY_MULT,
  SEED_AWAKEN_RADIUS, FORMATION_SPACING,
  FRONTIER_INTERVAL, FRONTIER_DIST_MIN, FRONTIER_DIST_MAX,
  REVEAL_RADIUS, REVEAL_SCALE, DISCOVERY_PER_STEP, COLLECTION_LEVELS,
  CLASS_DEFS, PROBE_DRAG_LEGACY, PROBE_IGM_DRAG, PROBE_RESPAWN_SPEED, PROBE_MAX_SPEED,
} from './config.js';
import { randomUnit, clamp01, smoothstep, easeInOut, orbitPolar, hash01 } from './utils.js';

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
  // giant：绝大多数是巨椭圆星系——超大质量晕不必然坍缩成黑洞。
  // 只有少数（确定性 willCollapse 标志）最终坍缩成超大质量黑洞，
  // 符合真实宇宙中"活跃黑洞（吸积盘点亮）极其罕见"的稀疏分布。
  if (g < 0.28) return 'dust';
  if (g < 0.52) return 'cluster';
  if (g < 0.78) return 'galaxy';
  return seed.willCollapse ? 'blackhole' : 'galaxy';
}

// 种子定型：天体在宇宙初始化时就已是最终形态（"本来就在那里"），
// 小球靠近只是"发现"细节（§5.2 渐进发现），而不是"路过才生成"。
// 由 klass + willCollapse 确定性决定最终等级，不再随 growth 演化。
function finalLevelFor(klass, willCollapse) {
  if (klass === 'small') return 'planet';
  if (klass === 'medium') return Math.random() < 0.65 ? 'star' : 'cluster';
  if (klass === 'large') return Math.random() < 0.78 ? 'galaxy' : 'supercluster';
  if (klass === 'giant') return willCollapse ? 'blackhole' : 'galaxy';
  if (klass === 'nebula') return 'dust';
  return 'void';
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
// 发现制文案：天体本来就在那里，小球首次接近（生成 detail）才"发现"
const EVENT_MESSAGES = {
  planet: '🪐 发现一颗行星',
  star: '☀️ 发现一颗恒星',
  cluster: '✨ 发现球状星团',
  galaxy: '🌌 发现旋涡星系',
  supercluster: '🫧 发现超星系团',
  blackhole: '🕳️ 发现超大质量黑洞，吸积盘点亮',
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
    //   systemDynamics      集合系统动力学：恒星间相互引力微扰（默认开）
    this.config = {
      wormholeDist: 800, wormholeDuration: 1.4, wormholeWindow: 8,
      // 虫洞跃迁后的安全余量：目标点距任何天体的最小距离。若不足则
      // 自动改选更空旷方向/拉长距离，直到满足——避免"瞬移后依然落入
      // 附近天体捕获范围"的死循环（真正逃逸）。
      wormholeSafeMargin: 200,
      maxDetailSystems: 3, maxDetailBodies: 1000,
      qualityTier: 0, autoQuality: true,
      // 引力与天体（UI 滑杆实时可调，范围在 main.js 侧钳制以防数值发散）
      gravityG: 16,        // 引力常数（原模块常量 G）
      bodyMassScale: 1,    // 天体质量全局倍率
      bodyRadiusScale: 1,  // 天体半径全局倍率（影响碰撞判定与视觉大小）
      trailLength: 750,    // 轨迹保留点数
      // 天体间引力（万有引力，2026-08-30 新增）：种子（天体系统）之间
      // 的 N-body 软化引力。0 = 关闭；默认 400：近距离（<100 单位）大
      // 系统开始有可感知的相互偏转，远场仍以 Hubble 流为主不坍缩；
      // 调大（如 2000+）可观察到两个星系明显的相对接近/绕行。
      seedGravity: 400,
      // 启动快进（显示层）：开局 bootFastForwardWall 真实秒内用 bootFastForwardScale
      // 推进，避免宇宙演化被观赏倍率一起拖慢。置 0 可关闭。
      // 倍率从 1.5 降到 0.5：开局小球不再狂飙，但仍以约 10 倍观赏倍率
      // 推进结构形成（形成需 3~7.5 物理秒，0.5×下 6~15 真实秒即可成形）。
      bootFastForwardWall: 15,
      bootFastForwardScale: 0.5,
      camZoom: 40,         // 第三人称镜头距离（缩放）
      camPanX: 0,          // 镜头平移偏移（世界单位，受限）
      camPanY: 0,
      filamentStrength: 1, velocityDispersion: 1, massBias: 0,
      // 集合系统动力学（§9.7）：恒星间相互引力微扰，叠加在分析轨道上
      systemDynamics: true,
      // 玩家推进器（§10，默认关闭）：开启后 WASD/方向键按摄像机视角
      // 推力。thrustMag 是加速度大小（与引力 G 同量级，玩家足以改变
      // 航向、抵近系统或逃逸引力井，但不会"超人化"甩开物理节奏）。
      thrustEnabled: false, thrustMag: 8,
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
    // 玩家推进器（每帧由 main.js 按"摄像机方向 × 键位 × thrustMag"重算）。
    // 物理积分器把它当加速度直接叠加，与引力加速并列。
    this.thrust = [0, 0, 0];
    this.probe = {
      pos: [0, 0, 0],
      // 上一物理步的位置：渲染层在两物理步之间插值，消除固定步长造成的“一颤一颤”
      prevPos: [0, 0, 0],
      vel: [0, 0, 0],
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
      // 当前所受的总引力加速度向量（最近一个积分子步），HUD 与状态判定用
      gravAccel: [0, 0, 0],
      // 引力状态（每物理步重算）：
      //   speed 速率 / nearDist 与最近天体距离 / accel 引力加速度大小
      //   vEsc 逃逸速度 / kappa = speed / vEsc  / state 文字状态
      gravInfo: { speed: 0, nearDist: Infinity, accel: 0, vEsc: 0, kappa: 0, state: '自由航行' },
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
        // 天体在初始化时就已定型：宇宙大爆炸已经把物质抛到远方，
        // 远方早已凝聚成完整结构，小球靠近只是"发现"细节（§5.2）。
        const willCollapse = def.key === 'giant' && hash01(idx * 13 + 101) < 0.35;
        // 暴涨：暴胀瞬间暗物质晕以超光速沿径向飞散（inflate），
        // 之后随时间指数衰减（step 里 exp(-1.5t)），最终只剩末速度
        // vel 的漂移——"暴涨→减速→结构静止"。这使宇宙整体呈现
        // 初期超光速膨胀、后期放缓的物理特征（用户要求）。
        // 速度取 30~55：足以体现暴涨（位移 ~20-35 单位），又不会把
        // 种子推出小球的航线（实测 60-140 会让 30s 内接近的系统骤降）。
        const inflateSpeed = 30 + Math.random() * 25;
        this.seeds.push({
          idx: idx++,
          klass: def.key,
          dir,
          pos: [dir[0] * r, dir[1] * r, dir[2] * r],
          vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
          inflate: [dir[0] * inflateSpeed, dir[1] * inflateSpeed, dir[2] * inflateSpeed],
          mass: def.massMin + Math.random() * (def.massMax - def.massMin),
          birth: 0,
          duration: def.durBase + Math.random() * def.durSpan,
          growth: 1,
          awakened: true,
          level: finalLevelFor(def.key, willCollapse),
          axis, u, v,
          members: [],
          lastVisit: -Infinity,
          spinSign: Math.random() < 0.5 ? -1 : 1,
          // 只有少数巨质量晕确定性坍缩成黑洞（活跃黑洞极罕见）
          willCollapse,
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
        p.isEjecta = true; // 暴胀减速标记：爆炸窗口内高速→快速衰减（超光速后放缓）
      }
    }

    this._assignMembers(true);

    // 主角小球独立诞生于奇点附近，只携带大爆炸赋予的初始动量。
    // 之后不锁定任何目标：引力、惯性和阻尼会决定它遇到什么。
    this.probe.pos = [probeDir[0] * 0.04, probeDir[1] * 0.04, probeDir[2] * 0.04];
    this.probe.prevPos = this.probe.pos.slice();
    // 暴胀瞬间以超光速喷出（PROBE_BIGBANG_SPEED），爆炸窗口内由
    // _updateProbe 减速到巡航 PROBE_INITIAL_SPEED——"前快后慢"。
    const probeSpeed = PROBE_BIGBANG_SPEED * (0.90 + Math.random() * 0.20);
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

  // 到最近天体系统的距离（虫洞逃逸安全校验用）
  _distanceToNearestSeed(x, y, z) {
    let best = Infinity;
    for (const s of this.seeds) {
      const dx = s.pos[0] - x, dy = s.pos[1] - y, dz = s.pos[2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  // ---- 天体间万有引力（N-body 软化解算）----
  // 每对种子按 a = seedGravity × m_other / r² 互相吸引（方向指向对方），
  // 积分到 s.vel。性质：
  //   · 软化（SOFT=50²）：种子半径 30~50，近距离不产生奇点
  //   · 速度有界（90/s）：引力加速有界，极端情况不失控
  //   · 远场弱：默认 400 时 r>200 的加速度 <0.01/s²，Hubble 流（30~55/s）
  //     仍主导——不会全局坍缩；近距离（<100）大系统才互相可见地偏转
  _applySeedGravity(dt) {
    const G = this.config.seedGravity;
    if (G <= 0 || this.seeds.length < 2) return;
    const SOFT = 2500; // 50²
    for (let i = 0; i < this.seeds.length; i++) {
      const s1 = this.seeds[i];
      let ax = 0, ay = 0, az = 0;
      for (let j = 0; j < this.seeds.length; j++) {
        if (j === i) continue;
        const s2 = this.seeds[j];
        const dx = s2.pos[0] - s1.pos[0];
        const dy = s2.pos[1] - s1.pos[1];
        const dz = s2.pos[2] - s1.pos[2];
        const r2 = dx * dx + dy * dy + dz * dz + SOFT;
        const r = Math.sqrt(r2);
        const f = G * s2.mass / (r2 * r);
        ax += f * dx; ay += f * dy; az += f * dz;
      }
      s1.vel[0] += ax * dt;
      s1.vel[1] += ay * dt;
      s1.vel[2] += az * dt;
      const sp = Math.hypot(s1.vel[0], s1.vel[1], s1.vel[2]);
      if (sp > 90) {
        const k = 90 / sp;
        s1.vel[0] *= k; s1.vel[1] *= k; s1.vel[2] *= k;
      }
    }
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



  // 系统本体半径（影响相机绕行窗口、捕获与远景表达），与 detailRadius 同阶梯：
  // 集合系统的尺度远大于其成员——星系是庞然大物，恒星之间隔着"星际距离"。
  _systemRadius(s) {
    if (s.level === 'blackhole') return 13 + s.mass * 1.5;
    if (s.level === 'supercluster') return 34 + s.mass * 4.5;
    if (s.level === 'galaxy') return 30 + s.mass * 5.0;
    if (s.level === 'cluster') return 11 + s.mass * 1.4;
    if (s.level === 'star') return 3.2 + s.mass * 0.5;
    if (s.level === 'planet') return 1.6 + s.mass * 0.4;
    if (s.level === 'dust' || s.level === 'void') return 9 + s.mass * 2.4;
    return 1.6;
  }

  // 捕获半径：只有"单天体"（星尘云/行星/恒星）才有捕获范围
  // 星团/星系/超星系团/黑洞都是多体集合，捕获由其内部成员负责
  _captureRadius(s) {
    // 半径倍率（UI 可调）直接缩放捕获范围：调大更容易撞上天体
    const rs = this.config.bodyRadiusScale || 1;
    if (s.level === 'void' || s.level === 'dust') return 0;
    if (s.level === 'star') return (0.20 + s.mass * 0.06) * rs;
    if (s.level === 'planet') return (0.09 + s.mass * 0.04) * rs;
    // cluster / galaxy / supercluster / blackhole: 集合，由内部成员捕获
    return 0;
  }

  // 细节半径 = "系统本体尺度"的层级阶梯（尊重宇宙尺度常识）：
  //   行星系 5 < 恒星系 14 < 星云 26 < 星团 30（球状星团本来就密集）
  //   < 黑洞系统 36（核球恒星紧密绕行）< 超星系团 100 < 星系 115。
  // 星系是庞然大物：直径 130+，穿越要 ~80 屏幕秒；恒星平均间距 ~5 单位，
  // 是恒星显示尺寸的 10~30 倍——"星际距离"。星团/黑洞保持致密，
  // 与星系的稀疏形成层级对比（真实宇宙正是如此）。
  _detailRadius(s) {
    if (s.level === 'supercluster') return 100;
    if (s.level === 'galaxy') return 115;
    if (s.level === 'blackhole') return 36;
    if (s.level === 'cluster') return 30;
    if (s.level === 'star') return 14;
    if (s.level === 'dust') return 26;
    if (s.level === 'planet') return 5;
    if (s.level === 'void') return 22;
    return 0;
  }

  _updateSeedFormation(s) {
    // 天体已定型：宇宙初始化时结构就已存在（§3），小球靠近只是"发现"
    // 细节。growth 恒为 1，level 保持最终形态——不再有"路过才生成"的
    // 演化动画。引力随 gravityStrength 平滑生效（开场叙事保留）。
    s.growth = 1;
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
    // 投放即定型：新结构在远处就已完整存在，小球靠近只是"发现"
    s.birth = 0;
    s.awakened = true;
    s.growth = 1;
    s.willCollapse = klass === 'giant' ? Math.random() < 0.35 : false;
    s.level = finalLevelFor(klass, s.willCollapse);
    s._layout = null;      // 布局随新身份重新生成
    s.budgetNotified = false;
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

  // ---- 确定性成员布局（§5.2 渐进发现）----
  // 一个系统的全部成员（类型/轨道/相位）由 seed.idx 决定，与发现过程无关：
  // 远景成员点云与真实 detail body 共用同一份布局，接管时位置天然连续。
  // tier = 结构层（0 外圈 / 1 中圈 / 2 内圈），只影响远景点云的尺寸与亮度
  // 层次——成员何时"被看清"完全由小球的行进决定，与 tier 无关。
  _memberLayout(s) {
    if (s._layout) return s._layout;
    const r = this._detailRadius(s);
    if (r <= 0) return null;
    s._layoutId = (this._layoutSeq = (this._layoutSeq || 0) + 1);
    const rng = this._seededRandom(s.idx * 7919 + 17);
    const layout = [];
    const TAU = Math.PI * 2;
    // 轨道要素：e = 离心率（0 = 圆），argp = 近点角（椭圆朝向）。
    // 角度统一存平近点角，推进仍线性（与远景 spin 公式一致），见 orbitPolar。
    const addOrbitBody = (type, mass, radius, orbitRadius, orbitHeight, orbitSpeed, angle, colorSeed, tier, e, argp) => {
      layout.push({
        type, mass, radius, colorSeed, tier,
        orbit: { radius: orbitRadius, height: orbitHeight, speed: orbitSpeed, angle, e: e || 0, argp: argp || 0 },
      });
    };
    const baseSpeed = 0.25 + s.mass * 0.12;
    // 性能降级时按档位缩减成员数量（布局只建一次，通常在全质量时生成）
    const density = this.config.qualityTier >= 2 ? 0.55 : this.config.qualityTier >= 1 ? 0.75 : 1;
    const scaleCount = (n) => Math.max(8, Math.floor(n * density));

    if (s.level === 'void' || s.level === 'dust') {
      // 星云：绝大多数是气体尘埃（tier 0），少量亮星埋在内圈（tier 1）
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
      // 星团：tier 0 三十余颗外圈恒星 + tier 1 四五十颗内圈恒星，球状分布
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
      // ---- 恒星系统：单星 / 双星 / 三星 + 小行星带 + 彗星 ----
      // 种子本身是主星（实体星）；伴星是绕主星的成员天体，靠近才被发现——
      // "飞近才发现这颗恒星旁边还有一颗"正是渐进发现的用武之地。
      // 行星全部排在伴星轨道外侧绕系统公转（环双星轨道，真实双星布局）。
      const roll = rng();
      const nComp = roll < 0.35 ? 1 : roll < 0.45 ? 2 : 0; // 35% 双星 / 10% 三星
      let compMaxR = 0;
      for (let c = 0; c < nComp; c++) {
        const compR = 0.7 + rng() * (c === 0 ? 0.5 : 0.9);
        compMaxR = Math.max(compMaxR, compR);
        addOrbitBody(
          'star', 0.02 + rng() * 0.05, 0.030 + rng() * 0.035,
          compR, (rng() - 0.5) * compR * 0.08,
          (0.30 + rng() * 0.20) * baseSpeed / Math.sqrt(0.4 + compR),
          rng() * TAU + c * Math.PI, 0.35 + rng() * 0.5,
          1, rng() * 0.12,
        );
      }
      // 行星：无伴星时贴近分布；有伴星时整体推到伴星轨道外（> 2.2 倍分离距），
      // 轨道带少量离心率（0~0.16）——真实行星轨道没有正圆
      const innerBase = compMaxR > 0 ? compMaxR * 2.2 + 0.3 : 1.4;
      const count = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        const orbitR = innerBase + rng() * r * 0.4;
        addOrbitBody(
          'planet', 0.004 + rng() * 0.012, 0.030 + rng() * 0.03,
          orbitR, (rng() - 0.5) * orbitR * 0.2,
          (0.30 + rng() * 0.25) * baseSpeed / Math.sqrt(0.6 + orbitR),
          rng() * TAU, rng(), 0, rng() * 0.16,
        );
      }
      const count2 = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < count2; i++) {
        const isGas = rng() < 0.3;
        const orbitR = innerBase + 0.4 + rng() * r * 0.5;
        addOrbitBody(
          isGas ? 'gas' : 'planet',
          isGas ? 0.0008 + rng() * 0.003 : 0.003 + rng() * 0.01,
          isGas ? 0.012 + rng() * 0.015 : 0.025 + rng() * 0.025,
          orbitR, (rng() - 0.5) * orbitR * 0.25,
          (0.32 + rng() * 0.25) * baseSpeed / Math.sqrt(0.6 + orbitR),
          rng() * TAU, rng(), 1, rng() * 0.16,
        );
      }
      // 小行星带：两条行星轨道之间的暗带（70~110 个微小成员），
      // 远景点云里读作一条淡淡的环带，靠近后逐个显形
      const beltCount = scaleCount(70 + Math.floor(rng() * 40));
      const beltR = innerBase + 0.15 + rng() * r * 0.22;
      for (let i = 0; i < beltCount; i++) {
        const orbitR = beltR + (rng() + rng() - 1) * 0.5;
        addOrbitBody(
          'asteroid', 0.0002 + rng() * 0.0006, 0.008 + rng() * 0.006,
          orbitR, (rng() - 0.5) * orbitR * 0.06,
          (0.30 + rng() * 0.20) * baseSpeed / Math.sqrt(0.6 + orbitR),
          rng() * TAU, rng(), 1, rng() * 0.12,
        );
      }
      // 彗星 1~2 颗：高离心率（0.45~0.65）长轨道——近日疾驰、远日缓行
      const nComet = 1 + (rng() < 0.5 ? 1 : 0);
      for (let i = 0; i < nComet; i++) {
        const orbitR = r * (0.35 + rng() * 0.3);
        addOrbitBody(
          'gas', 0.0006 + rng() * 0.0015, 0.012 + rng() * 0.012,
          orbitR, (rng() - 0.5) * orbitR * 0.5,
          (0.16 + rng() * 0.10) * baseSpeed / Math.sqrt(0.6 + orbitR),
          rng() * TAU, rng(), 0, 0.45 + rng() * 0.2,
        );
      }
      // 大行星挂行星环的标记：_ensureDetailSystem 展开成绕行星的粒子环
      let ringBudget = 1 + (rng() < 0.4 ? 1 : 0);
      for (const m of layout) {
        if (ringBudget <= 0) break;
        if (m.type === 'planet' && m.radius > 0.042 && m.orbit && rng() < 0.75) {
          m.ring = {
            inner: 4.5 + rng() * 1.0,   // 相对行星半径的倍数
            outer: 6.5 + rng() * 1.5,
            count: Math.max(14, Math.floor((36 + Math.floor(rng() * 22)) * density)),
          };
          ringBudget--;
        }
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
      // ---- 星系：真实结构分层的粒子群体（彻底取代盘面贴图 + 光晕底雾）----
      // 形态由 seed 确定性派生：旋涡 ~55% / 棒旋 ~25% / 椭圆 ~20%。
      //   旋涡/棒旋 = 核球(老年暖星) + 对数螺旋臂(年轻蓝星+气体+尘埃)
      //               + 盘面场星 + 稀疏银晕；棒旋另有中央直棒、臂从棒端起旋
      //   椭圆     = r^2.2 集中的三维球状分布、老年暖星、约 1/4 逆行轨道
      // 自转用温和的较差自转（ω ∝ r^-0.85，近似平坦旋转曲线）：
      // 内侧略快外侧略慢，有真实星系的剪切感，又不会把旋臂快速缠死。
      // 恒星颜色按光温分布：蓝白(年轻) → 黄白 → 橙红(老年)，由 colorSeed 段位决定。
      const morph = rng();
      const isElliptical = morph >= 0.80;
      const isBarred = !isElliptical && morph >= 0.55;
      layout.push({
        type: 'blackhole', mass: 0.45 + s.mass * 0.25, radius: 0.32 + s.mass * 0.06,
        colorSeed: 0, orbit: null, tier: 0,
      });
      const diskR = r * 0.55;
      const galOmega = (orbitR) => (0.14 + rng() * 0.08) * baseSpeed / Math.pow(0.6 + orbitR, 0.85);
      if (isElliptical) {
        // 椭圆星系：无旋臂无盘，三维球状、向心集中，老年恒星为主
        const count = scaleCount(300 + Math.floor(rng() * 70));
        for (let i = 0; i < count; i++) {
          const orbitR = 0.6 + Math.pow(rng(), 2.2) * diskR;
          const retro = rng() < 0.25 ? -1 : 1; // 慢速随机取向，含逆行
          addOrbitBody(
            'star', 0.010 + rng() * 0.05, 0.028 + rng() * 0.045,
            orbitR, (rng() - 0.5) * orbitR * (1.4 + rng() * 0.6),
            retro * (0.10 + rng() * 0.08) * baseSpeed / Math.sqrt(0.6 + orbitR),
            rng() * TAU, 0.55 + rng() * 0.45, rng() < 0.3 ? 2 : 1, rng() * 0.08,
          );
        }
        const gasN = scaleCount(22);
        for (let i = 0; i < gasN; i++) {
          const orbitR = 0.5 + Math.pow(rng(), 2) * diskR * 0.7;
          addOrbitBody(
            'gas', 0.0006 + rng() * 0.002, 0.010 + rng() * 0.012,
            orbitR, (rng() - 0.5) * orbitR * 1.2,
            (rng() < 0.25 ? -1 : 1) * (0.08 + rng() * 0.06) * baseSpeed / Math.sqrt(0.6 + orbitR),
            rng() * TAU, rng(), 2, rng() * 0.08,
          );
        }
      } else {
        // 核球：球状密集、老年暖色恒星（tint ≥ 0.68 → 橙红段）。
        // 核球是星系里唯一"密集"的区域——与旋臂的稀疏形成对比
        const bulgeN = scaleCount(70 + Math.floor(rng() * 25));
        for (let i = 0; i < bulgeN; i++) {
          const orbitR = 0.5 + Math.pow(rng(), 1.8) * diskR * 0.28;
          addOrbitBody(
            'star', 0.012 + rng() * 0.05, 0.030 + rng() * 0.045,
            orbitR, (rng() - 0.5) * orbitR * (0.9 + rng() * 0.5),
            galOmega(orbitR) * 1.15,
            rng() * TAU, 0.68 + rng() * 0.32, 1, rng() * 0.06,
          );
        }
        const armCount = 2 + (rng() < 0.5 ? 1 : 0);
        const rMin = isBarred ? diskR * 0.24 : diskR * 0.10;
        const barAng = rng() * TAU;
        const pitch = 0.30 + rng() * 0.10; // 对数螺距：r = rMin·e^(pitch·θ)
        if (isBarred) {
          // 中央直棒：恒星沿一条直线密集分布，旋臂从棒两端生长
          const barN = scaleCount(40 + Math.floor(rng() * 16));
          for (let i = 0; i < barN; i++) {
            const t = rng();
            const orbitR = rMin * (0.25 + t * 0.75);
            const side = rng() < 0.5 ? 0 : Math.PI;
            addOrbitBody(
              'star', 0.012 + rng() * 0.05, 0.028 + rng() * 0.04,
              orbitR, (rng() - 0.5) * orbitR * 0.18,
              galOmega(orbitR),
              barAng + side + (rng() - 0.5) * 0.28, 0.30 + rng() * 0.55, 1, rng() * 0.06,
            );
          }
        }
        // 旋臂：对数螺旋 r = rMin·e^(pitch·θ)，臂上蓝白年轻星 + 气体云 + 尘埃。
        // 散布宽度按角度收窄（盘半径放大后若保持原角度，臂的绝对宽度会失真）。
        // 稀疏是主题：盘面恒星的平均间距是恒星尺寸的 ~15 倍，臂间是大片真空；
        // 臂的可读性靠气体云（更大更亮）撑起，而不是靠堆恒星
        const armN = scaleCount(120 + Math.floor(rng() * 40));
        for (let i = 0; i < armN; i++) {
          const arm = i % armCount;
          const t = Math.pow(rng(), 0.7);
          const orbitR = rMin + t * (diskR - rMin);
          const wind = Math.log(orbitR / rMin) / pitch;
          const scatter = (rng() + rng() - 1) * (0.06 + 0.10 * (1 - t));
          const angle = barAng + arm * (TAU / armCount) + wind + scatter;
          const kind = rng();
          if (kind < 0.30) {
            addOrbitBody(
              'gas', 0.0006 + rng() * 0.0024, 0.010 + rng() * 0.014,
              orbitR, (rng() - 0.5) * orbitR * 0.10,
              galOmega(orbitR), angle, rng(), 2, rng() * 0.05,
            );
          } else {
            // 臂上年轻星偏蓝白（tint 低段），部分混入黄白/橙红
            addOrbitBody(
              'star', 0.012 + rng() * 0.06, 0.030 + rng() * 0.05,
              orbitR, (rng() - 0.5) * orbitR * 0.09,
              galOmega(orbitR), angle, rng() * (kind < 0.72 ? 0.34 : 1), kind < 0.72 ? 0 : 1, rng() * 0.05,
            );
          }
        }
        // 盘面场星：指数式径向分布，填充臂间空隙（刻意稀疏）
        const fieldN = scaleCount(55 + Math.floor(rng() * 20));
        for (let i = 0; i < fieldN; i++) {
          const orbitR = rMin * 0.6 + Math.pow(rng(), 1.4) * (diskR - rMin * 0.6);
          addOrbitBody(
            'star', 0.008 + rng() * 0.04, 0.024 + rng() * 0.035,
            orbitR, (rng() - 0.5) * orbitR * 0.12,
            galOmega(orbitR), rng() * TAU, rng(), 1, rng() * 0.05,
          );
        }
        // 银晕：稀疏球状老年星，盘外一圈微光
        const haloN = scaleCount(30 + Math.floor(rng() * 14));
        for (let i = 0; i < haloN; i++) {
          const orbitR = diskR * (0.5 + rng() * 0.9);
          addOrbitBody(
            'star', 0.008 + rng() * 0.03, 0.022 + rng() * 0.03,
            orbitR, (rng() - 0.5) * orbitR * 1.5,
            galOmega(orbitR) * 0.7, rng() * TAU, 0.68 + rng() * 0.32, 2, rng() * 0.1,
          );
        }
      }
    } else if (s.level === 'supercluster') {
      // ---- 超星系团：6 个星系核在"星系际距离"上相互绕行 ----
      // 层级最丰富的一档：星系核之间隔着几十单位（星系际空间），
      // 每个核自带一圈矮星系规模的恒星云与尘埃，先看清某个核，再逐个看清成员。
      // 星系核本身展开成"子星系"（children）：核球 + 对数螺旋旋臂 + 场星 +
      // 气体云，靠近某个核时看到的是**一个真星系**（有自己的旋涡与较差
      // 自转），而不是一个光点——超星系团里的"星系"不再是整体。
      const nodes = [];
      // 子星系生成器：围绕星系核的矮星系（核球 + 双螺旋旋臂 + 场星 + 气体）。
      // 恒星数量刻意多于"可读"下限——矮星系虽然稀疏，但 20 颗以下时
      // 旋臂形态在屏幕上不可辨，只会读成"几个散点"；30 颗左右 + 气体云
      // 撑起螺旋轮廓，靠近时能读出"这是一个小星系"。
      const makeSubGalaxy = (node) => {
        const kids = [];
        const subR = Math.max(0.9, node.radius * 5.0); // 子星系盘半径（矮星系尺度）
        const subOmega = (oR) => (0.16 + rng() * 0.08) * baseSpeed / Math.pow(0.4 + oR, 0.85);
        const mkStar = (type, oR, tilt, tint, fixedAng) => {
          const ang = fixedAng !== undefined ? fixedAng : rng() * TAU;
          kids.push({
            type,
            mass: type === 'gas' ? 0.0008 + rng() * 0.002 : 0.010 + rng() * 0.045,
            radius: type === 'gas' ? 0.010 + rng() * 0.012 : 0.024 + rng() * 0.036,
            colorSeed: tint,
            pos: [0, 0, 0],
            orbit: {
              radius: oR, height: (rng() - 0.5) * oR * tilt,
              speed: subOmega(oR), angle: ang, e: rng() * 0.06, argp: rng() * TAU,
            },
            prevAngle: ang,
            revealed: true, revealT: 1, _hidden: false,
          });
        };
        // 核球：4~6 颗老年暖星，密集三维（厚）
        const bulgeN = 4 + Math.floor(rng() * 3);
        for (let i = 0; i < bulgeN; i++) {
          mkStar('star', subR * (0.06 + Math.pow(rng(), 1.6) * 0.24), 0.5, 0.65 + rng() * 0.35);
        }
        // 双对数螺旋旋臂：年轻蓝白星 + 气体云（薄盘，稀疏——矮星系更稀疏）
        const armN = 14 + Math.floor(rng() * 5);
        const pitch = 0.36 + rng() * 0.08;
        const rMin = subR * 0.18;
        for (let i = 0; i < armN; i++) {
          const arm = i % 2;
          const t = Math.pow(rng(), 0.7);
          const oR = rMin + t * (subR - rMin);
          const wind = Math.log(oR / rMin) / pitch;
          const ang = arm * Math.PI + wind + (rng() + rng() - 1) * (0.10 + 0.18 * (1 - t));
          if (rng() < 0.30) {
            // 气体云：更大更亮，撑起旋臂轮廓（同主星系策略）
            mkStar('gas', oR, 0.10, rng(), ang);
          } else {
            // 臂上年轻星偏蓝白（tint 低段），部分混入黄白/橙红
            mkStar('star', oR, 0.10, rng() < 0.72 ? rng() * 0.34 : 0.55 + rng() * 0.45, ang);
          }
        }
        // 场星：稀疏填充盘面
        const fieldN = 6 + Math.floor(rng() * 4);
        for (let i = 0; i < fieldN; i++) {
          mkStar('star', subR * (0.15 + Math.pow(rng(), 1.3) * 0.85), 0.18, rng());
        }
        // 星际尘埃云：子星系盘内的暗尘埃（近景可读为淡淡的尘带）
        const dustN = 6 + Math.floor(rng() * 4);
        for (let i = 0; i < dustN; i++) {
          mkStar('gas', subR * (0.12 + Math.pow(rng(), 1.2) * 0.88), 0.22, 0.5 + rng() * 0.4);
        }
        return kids;
      };
      for (let n = 0; n < 6; n++) {
        const nodeR = r * (0.10 + rng() * 0.45);
        const nodeAngle = n * (TAU / 6) + rng() * 0.5;
        const nodeHeight = (rng() - 0.5) * nodeR * 0.3;
        const nodeMass = 0.20 + rng() * 0.45;
        const node = { radius: 0.30 + rng() * 0.18, angle: nodeAngle, height: nodeHeight, mass: nodeMass };
        nodes.push(node);
        layout.push({
          type: 'galaxy', mass: nodeMass, radius: node.radius,
          colorSeed: rng(),
          orbit: { radius: nodeR, height: nodeHeight, speed: (0.15 + rng() * 0.15) * baseSpeed, angle: nodeAngle, e: 0, argp: 0 },
          tier: 0,
          children: makeSubGalaxy(node),
        });
      }
      // 给每个星系节点一批外层恒星云（远景可读的成员点云，比子星系盘
      // 稍大——这是"星系际空间里稀疏的星场"，不是贴着星系核的点）。
      // 轨道半径按 node.radius 的 1.2~3.5 倍（≈0.4~1.7 单位），与子星系
      // 盘（0.9~2.4 单位）重叠但更外，构成银晕/外层星场。
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        for (let i = 0; i < 24; i++) {
          const orbitR = node.radius * (1.2 + rng() * 2.3);
          const angle = node.angle + (rng() - 0.5) * 0.65;
          addOrbitBody(
            'star', 0.015 + rng() * 0.05, 0.035 + rng() * 0.04,
            orbitR, node.height + (rng() - 0.5) * orbitR * 0.4,
            (0.20 + rng() * 0.30) * baseSpeed / Math.sqrt(0.6 + orbitR),
            angle, rng(), 1, rng() * 0.08,
          );
        }
      }
      // 星际尘埃云：绕星系核的大尺度尘带（与子星系盘同区域，暗色气体）
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        const innerCount = 10 + Math.floor(rng() * 6);
        for (let i = 0; i < innerCount; i++) {
          const orbitR = node.radius * (1.0 + rng() * 2.2);
          const angle = node.angle + (rng() - 0.5) * 0.8;
          addOrbitBody(
            rng() < 0.5 ? 'gas' : 'planet',
            rng() < 0.5 ? 0.0006 + rng() * 0.003 : 0.0015 + rng() * 0.006,
            rng() < 0.5 ? 0.010 + rng() * 0.015 : 0.014 + rng() * 0.02,
            orbitR, node.height + (rng() - 0.5) * orbitR * 0.35,
            (0.20 + rng() * 0.30) * baseSpeed / Math.sqrt(0.5 + orbitR),
            angle, rng(), 2, rng() * 0.08,
          );
        }
      }
    } else if (s.level === 'blackhole') {
      // 黑洞系统：中心黑洞（事件视界）+ 三档核球恒星/行星尘埃。
      // 中心黑洞是致密引力源，小球进入事件视界即被潮汐撕碎（tidal）。
      layout.push({
        type: 'blackhole', mass: 0.45 + s.mass * 0.25, radius: 0.32 + s.mass * 0.06,
        colorSeed: 0, orbit: null, tier: 0,
      });
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
    s._layout = layout;
    return layout;
  }

  // 从确定性布局构建真实 detail body：初始全部"未发现"（隐藏、无引力、不可捕获），
  // 由 _manageDetails 按小球与每个成员的接近程度逐个揭示
  _ensureDetailSystem(s) {
    const r = this._detailRadius(s);
    if (r <= 0 || s.detail) return;
    const layout = this._memberLayout(s);
    if (!layout) return;
    // 轨道相位与远景成员点云连续：点云从布局起就按 _layoutSpin 自转，
    // detail 激活时接着同一相位继续走，交接瞬间不会跳变
    const spin = s._layoutSpin || 0;
    const bodies = layout.map((m) => {
      const a0 = m.orbit ? m.orbit.angle + spin * m.orbit.speed : 0;
      const b = {
        type: m.type, mass: m.mass, radius: m.radius, colorSeed: m.colorSeed,
        ring: m.ring || null,
        pos: m.orbit ? [0, 0, 0] : s.pos.slice(),
        orbit: m.orbit ? { ...m.orbit, angle: a0 } : null,
        prevAngle: a0,
        parent: s.idx,
        // 渐进发现状态：初始全部"未发现"——由 _revealMembers 逐个揭示
        revealed: false,
        revealT: 0,
        _hidden: true,
      };
      // 子星系（超星系团星系核的 children）：布局里的子成员转成真实二级
      // 成员。随母星系核一起显形（渲染用 pReveal = 母体 revealT），所以
      // 直接 revealed=true；物理/渲染的 children 循环对它们与行星环一视同仁。
      if (m.children) {
        b.children = m.children.map((c) => ({
          type: c.type, mass: c.mass, radius: c.radius, colorSeed: c.colorSeed,
          pos: [0, 0, 0],
          orbit: { ...c.orbit },
          prevAngle: c.orbit.angle,
          parent: s.idx,
          revealed: true, revealT: 1, _hidden: false,
        }));
      }
      return b;
    });
    // ---- 质量守恒：成员质量归一化到系统质量 ----
    // 星团/星系/超星系团**不是单个天体**，其引力场应由成员分布产生。
    // 但成员质量是按各自范围独立生成的，与 s.mass 并不守恒（实测 cluster
    // 的成员总和可达 s.mass 的 10.9 倍，galaxy 约 0.7 倍），不处理的话
    // 展开 detail 的瞬间引力会成倍跳变。这里把成员质量整体缩放到
    // Σ = s.mass，使"远场质点"与"近场成员"描述同一个总质量。
    // 子星系 children 也是该系统的引力质量来源之一，一并计入归一。
    let massSum = 0;
    for (const b of bodies) {
      massSum += b.mass || 0;
      if (b.children) for (const c of b.children) massSum += c.mass || 0;
    }
    if (massSum > 1e-6 && s.mass > 1e-6) {
      const k = s.mass / massSum;
      for (const b of bodies) {
        b.mass = (b.mass || 0) * k;
        if (b.children) for (const c of b.children) c.mass = (c.mass || 0) * k;
      }
      massSum = s.mass;
    }
    s.detail = {
      bodies,
      radius: r,
      discovered: false,
      foundCount: 0,
      revealScale: REVEAL_SCALE(r),
      massSum,
    };
    // 布局标记了 ring 的大行星：展开成环绕它运动的粒子环（土星式）。
    // 复用 children 机制（位置每步跟随母行星），标记 deco = 纯装饰粒子，
    // 不参与碰撞与揭示（跟随母行星的 revealT 淡入淡出）。
    for (const b of bodies) {
      if (b.ring && b.orbit) this._attachRing(s, b);
    }
  }

  // 为一颗行星生成粒子环（也可用于二级行星，见 _generateStarChildren）。
  // 环半径是行星半径的数倍——行星点本身画得比碰撞半径大，环也按显示尺度走。
  _attachRing(s, b) {
    const rrng = this._seededRandom(((s.idx * 977 + Math.floor(b.orbit.radius * 8191)) | 0) + 4211);
    const baseSpeed = 0.25 + s.mass * 0.12;
    const TAU = Math.PI * 2;
    const ring = [];
    for (let i = 0; i < b.ring.count; i++) {
      const rr = (b.ring.inner + rrng() * (b.ring.outer - b.ring.inner)) * b.radius;
      ring.push({
        type: 'ring', mass: 0.00004, radius: 0.006 + rrng() * 0.006,
        colorSeed: rrng(),
        pos: [b.pos[0], b.pos[1], b.pos[2]],
        orbit: {
          radius: rr,
          height: (rrng() - 0.5) * b.radius * 0.5,
          speed: (0.45 + rrng() * 0.25) * baseSpeed / Math.sqrt(0.2 + rr),
          angle: rrng() * TAU, e: 0, argp: 0,
        },
        prevAngle: 0,
        parent: s.idx,
        parentBody: b,
        revealed: true,
        revealT: 1,
        _hidden: false,
        deco: true, // 装饰粒子：无碰撞（引力质量也小到可忽略）
      });
    }
    b.children = (b.children || []).concat(ring);
  }

  // ---- 渐进发现（§5.2）----
  // 决定哪些成员从"远景光点"升级为真实天体：只有小球真正靠近到
  // REVEAL_RADIUS 内才被发现，且每个物理步最多揭示 DISCOVERY_PER_STEP
  // 个（由近及远）。观感即是——掠过系统时只看见满天远景光点，
  // 越往里走越多成员变成有引力、可碰撞、能长出二级系统的真实天体。
  _revealMembers(s, pr) {
    const cand = this._revealBuf || (this._revealBuf = []);
    cand.length = 0;
    const scale = s.detail.revealScale || 1;
    for (const b of s.detail.bodies) {
      if (b.revealed) continue;
      const rr = (REVEAL_RADIUS[b.type] || 5) * scale;
      const dx = b.pos[0] - pr.pos[0], dy = b.pos[1] - pr.pos[1], dz = b.pos[2] - pr.pos[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr) cand.push([d2, b]);
    }
    if (!cand.length) return;
    cand.sort((a, b) => a[0] - b[0]); // 最近的先被看清
    const n = Math.min(cand.length, DISCOVERY_PER_STEP);
    for (let i = 0; i < n; i++) {
      const b = cand[i][1];
      b.revealed = true;
      b.revealT = 0;
    }
    s.detail.foundCount += n;
    // 事件只对真正的多天体集合播报：恒星/行星系统成员太少，逐个播报是噪音
    if (!COLLECTION_LEVELS.has(s.level)) return;
    const label = LEVEL_LABELS[s.level] || '天体';
    if (!s.detail.discovered) {
      s.detail.discovered = true;
      this.events.push({ time: this.time, text: `🔍 靠近【${label}】，最近的成员率先显形` });
    }
    if (s.detail.foundCount >= s.detail.bodies.length) {
      this.events.push({ time: this.time, text: `✨ 【${label}】${s.detail.bodies.length} 个成员已全部显形` });
    }
  }

  // 推进集合系统全体成员的轨道与动力学。
  // 注意：可见性由渐进发现（§5.2）决定，与小球到系统的距离无关——
  // 未发现的成员照样在轨道上运动，远景成员点云据此把它们画在真实位置。
  _updateDetailBodies(s, dt) {
    const dynOn = this.config.systemDynamics && this.config.qualityTier < 1;
    // ---- 集合系统动力学（§9.7）：恒星间相互引力的软化微扰 ----
    // 力以 20Hz 互算（O(n²) 只对恒星），积分为有界速度漂移 bv，
    // 叠加在分析轨道上（boff 偏移）。构造上不可能逃逸/瓦解，
    // 但相对运动是真实的 N-body 力（星团互绕、旋臂扰动、核球响应）。
    const dynBodies = dynOn ? [] : null;
    for (const b of s.detail.bodies) {
      // 渐进发现（§5）：未发现的天体保持隐藏（无引力/不可捕获），
      // 但轨道照常推进——远景预览与揭示动画基于真实位置
      b._hidden = !b.revealed;
      if (b.revealed && b.revealT < 1) b.revealT = Math.min(1, b.revealT + dt * 1.6);
      if (!b.orbit) {
        b.pos[0] = s.pos[0]; b.pos[1] = s.pos[1]; b.pos[2] = s.pos[2];
        continue;
      }
      // 渲染插值用：推进前保存本步轨道角（平近点角，线性推进）
      b.prevAngle = b.orbit.angle;
      b.orbit.angle += b.orbit.speed * dt;
      // 椭圆轨道：平近点角 → 真近点角 + 半径（e=0 时退化为圆，见 orbitPolar）
      const pol = orbitPolar(b.orbit, b.orbit.angle);
      const c = Math.cos(pol[0]), sn = Math.sin(pol[0]);
      const rEff = pol[1];
      b.pos[0] = s.pos[0] + s.u[0] * c * rEff + s.v[0] * sn * rEff + s.axis[0] * b.orbit.height;
      b.pos[1] = s.pos[1] + s.u[1] * c * rEff + s.v[1] * sn * rEff + s.axis[1] * b.orbit.height;
      b.pos[2] = s.pos[2] + s.u[2] * c * rEff + s.v[2] * sn * rEff + s.axis[2] * b.orbit.height;
      // 动力学偏移叠加（恒星才参与互算；行星/尘埃保持纯轨道）
      if (dynBodies && b.mass >= 0.01) {
        if (!b.bv) { b.bv = [0, 0, 0]; b.boff = [0, 0, 0]; }
        b.pos[0] += b.boff[0]; b.pos[1] += b.boff[1]; b.pos[2] += b.boff[2];
        dynBodies.push(b);
      }
      // 二级系统：行星/卫星/环粒子绕母天体运动（母体是移动目标，用其本步位置）
      if (b.children) {
        for (const ch of b.children) {
          ch.prevAngle = ch.orbit.angle;
          ch.orbit.angle += ch.orbit.speed * dt;
          const cpol = orbitPolar(ch.orbit, ch.orbit.angle);
          const cc = Math.cos(cpol[0]), cs = Math.sin(cpol[0]);
          const crEff = cpol[1];
          ch.pos[0] = b.pos[0] + s.u[0] * cc * crEff + s.v[0] * cs * crEff + s.axis[0] * ch.orbit.height;
          ch.pos[1] = b.pos[1] + s.u[1] * cc * crEff + s.v[1] * cs * crEff + s.axis[1] * ch.orbit.height;
          ch.pos[2] = b.pos[2] + s.u[2] * cc * crEff + s.v[2] * cs * crEff + s.axis[2] * ch.orbit.height;
          // 二级行星的粒子环（只再深入这一层）
          if (ch.children) {
            for (const rg of ch.children) {
              rg.prevAngle = rg.orbit.angle;
              rg.orbit.angle += rg.orbit.speed * dt;
              const rpol = orbitPolar(rg.orbit, rg.orbit.angle);
              const rc = Math.cos(rpol[0]), rs = Math.sin(rpol[0]);
              const rrEff = rpol[1];
              rg.pos[0] = ch.pos[0] + s.u[0] * rc * rrEff + s.v[0] * rs * rrEff + s.axis[0] * rg.orbit.height;
              rg.pos[1] = ch.pos[1] + s.u[1] * rc * rrEff + s.v[1] * rs * rrEff + s.axis[1] * rg.orbit.height;
              rg.pos[2] = ch.pos[2] + s.u[2] * rc * rrEff + s.v[2] * rs * rrEff + s.axis[2] * rg.orbit.height;
            }
          }
        }
      }
    }
    if (dynBodies && dynBodies.length > 1) {
      s.detail.dynTimer = (s.detail.dynTimer || 0) + dt;
      const recompute = s.detail.dynTimer >= 0.05; // 20Hz 互算
      if (recompute) s.detail.dynTimer = 0;
      const damp = Math.exp(-dt * 0.5);
      for (const b of dynBodies) {
        if (recompute) {
          let ax = 0, ay = 0, az = 0;
          for (const o of dynBodies) {
            if (o === b) continue;
            const dx = o.pos[0] - b.pos[0], dy = o.pos[1] - b.pos[1], dz = o.pos[2] - b.pos[2];
            const r2 = dx * dx + dy * dy + dz * dz + 0.5; // 软化
            const f = DYN_G * o.mass / (r2 * Math.sqrt(r2));
            ax += f * dx; ay += f * dy; az += f * dz;
          }
          b.bv[0] = (b.bv[0] + ax * 0.05) * damp;
          b.bv[1] = (b.bv[1] + ay * 0.05) * damp;
          b.bv[2] = (b.bv[2] + az * 0.05) * damp;
          // 有界：漂移速度封顶，构造上杜绝逃逸
          const sp = Math.hypot(b.bv[0], b.bv[1], b.bv[2]);
          if (sp > 0.5) { const k = 0.5 / sp; b.bv[0] *= k; b.bv[1] *= k; b.bv[2] *= k; }
        }
        // 弱弹簧锚定：boff 缓慢回落（约 14s 半衰期），长时间驻留也不"融化"
        const anchor = Math.exp(-dt * 0.05);
        b.boff[0] = (b.boff[0] + b.bv[0] * dt) * anchor;
        b.boff[1] = (b.boff[1] + b.bv[1] * dt) * anchor;
        b.boff[2] = (b.boff[2] + b.bv[2] * dt) * anchor;
        b.pos[0] += b.bv[0] * dt; b.pos[1] += b.bv[1] * dt; b.pos[2] += b.bv[2] * dt;
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
        pos: [b.pos[0], b.pos[1], b.pos[2]],
        orbit: {
          radius: orbitR,
          height: (rng() - 0.5) * orbitR * 0.3,
          speed: (0.55 + rng() * 0.35) * baseSpeed / Math.sqrt(0.3 + orbitR),
          angle: rng() * TAU,
          e: rng() * 0.15,   // 二级行星轨道同样带少量离心率
          argp: rng() * TAU,
        },
        prevAngle: 0,
        parent: s.idx,
        parentBody: b, // 渲染层需要母星显示位置
        // 二级行星只在已发现的恒星上生成，直接就是显形状态
        revealed: true,
        revealT: 1,
        _hidden: false,
      });
    }
    // 较大的二级行星可带粒子环（土星式），复用同一 _attachRing
    for (const ch of children) {
      if (ch.type === 'planet' && ch.radius > 0.028 && rng() < 0.5) {
        ch.ring = {
          inner: 4.5 + rng() * 1.0,
          outer: 6.5 + rng() * 1.5,
          count: 30 + Math.floor(rng() * 18),
        };
        this._attachRing(s, ch);
        break; // 每颗恒星至多一颗环行星
      }
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
      // 远景成员点云的自转相位：与 detail 成员共用
      // "布局起始角 + spin × speed" 的公式，交接瞬间位置不跳变
      s._layoutSpin = (s._layoutSpin || 0) + dt;
      const d = Math.hypot(pr.pos[0] - s.pos[0], pr.pos[1] - s.pos[1], pr.pos[2] - s.pos[2]);
      // 接近到 1.4R 才创建真实 detail 天体；更远处由远景成员点云表达
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
        // 离开太远就释放；下次接近重新创建（已发现记忆随之重置，
        // 远景成员点云接管"它依然是一群天体"的表达）
        if (d > r * 2.4) {
          s.detail = null;
          s.budgetNotified = false;
          continue;
        }
        this._updateDetailBodies(s, dt);
        // 渐进发现：小球靠近哪个成员，哪个成员才从远景光点升级为真实天体
        this._revealMembers(s, pr);
        this._updateSubSystems(s);
        this.activeDetails.push(s);
        systemsWithDetail += 1;
        totalBodies += s.detail.bodies.length;
      }
    }
    // 在小球前方动态补充新的休眠系统，让航线可以无限延伸。
    this._generateFrontierSeed();
  }

  // 手动重置小球（引力实验用）：给定速率与方向（方位角 az / 仰角 el，弧度），
  // 重新放置小球并赋予速度矢量，便于反复观察同一初始条件下的引力作用。
  // 位置会自动退到最近天体的安全距离外，避免一重置就撞上去。
  resetProbe({ speed = PROBE_RESPAWN_SPEED, az = 0, el = 0 } = {}) {
    const pr = this.probe;
    const sp = Math.max(0, speed);
    const ce = Math.cos(el);
    const se = Math.sin(el);
    const dir = [Math.sin(az) * ce, se, Math.cos(az) * ce];
    // 位置：沿"远离最近天体"的方向退到 2.5R 外（R = 系统半径）
    let px = pr.pos[0], py = pr.pos[1], pz = pr.pos[2];
    if (pr.influencer >= 0) {
      const s = this.seeds[pr.influencer];
      const dx = px - s.pos[0], dy = py - s.pos[1], dz = pz - s.pos[2];
      const dl = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const k = (this._systemRadius(s) * 2.5) / dl;
      px = s.pos[0] + dx * k; py = s.pos[1] + dy * k; pz = s.pos[2] + dz * k;
    }
    pr.pos = [px, py, pz];
    // 瞬移：prevPos 同步，避免插值从旧位置拉出一条拖影
    pr.prevPos = pr.pos.slice();
    pr.vel = [dir[0] * sp, dir[1] * sp, dir[2] * sp];
    // 清掉死亡 / 绕行 / 捕获状态
    pr.dying = false;
    pr.dyingT = 0;
    this._deathPending = null;
    pr.orbitAngleAcc = 0;
    pr.straightTime = 0;
    pr.respawnFlash = 1;
    pr.respawnGrace = 3;
    // generation 变化会让渲染层清空轨迹
    pr.generation += 1;
    pr.label = '引力实验 · 手动重置';
    this.events.push({
      time: this.time,
      text: `↺ 手动重置：速率 ${sp.toFixed(1)}，方向 az=${((az * 180) / Math.PI).toFixed(0)}° el=${((el * 180) / Math.PI).toFixed(0)}°`,
    });
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
    // ---- 安全目标点选择（2026-08-30 重做）----
    // 旧实现只沿"速度反方向+随机散射"跳固定 wormholeDist，可能落进
    // 附近另一个天体的捕获范围 → "瞬移后依然被捕获"循环。现在：
    //   1) 采样最多 8 个候选方向（含速度反方向，避免被吸回来）
    //   2) 对每个方向评估"跳 dist 后距最近天体的距离"
    //   3) 优先选"距最近天体 ≥ wormholeSafeMargin"的方向；都不满足则
    //      沿当前最空旷方向把距离翻倍重试（×1~×4），直到安全或到上限
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    const candidates = [];
    if (sp > 0.5) candidates.push([-pr.vel[0] / sp, -pr.vel[1] / sp, -pr.vel[2] / sp]);
    while (candidates.length < 8) candidates.push(randomUnit(1));
    const baseDist = this.config.wormholeDist;
    const safe = this.config.wormholeSafeMargin;
    let bestDir = candidates[0];
    let bestDist = baseDist;
    let bestClear = -Infinity;
    for (let attempt = 0; attempt < 4; attempt++) {
      const dist = baseDist * (attempt + 1);
      let ok = null;
      for (const d of candidates) {
        const tx = pr.pos[0] + d[0] * dist;
        const ty = pr.pos[1] + d[1] * dist;
        const tz = pr.pos[2] + d[2] * dist;
        const nearest = this._distanceToNearestSeed(tx, ty, tz);
        if (nearest >= safe) { ok = { d, dist, nearest }; break; }
        if (nearest > bestClear) { bestClear = nearest; bestDir = d; bestDist = dist; }
      }
      if (ok) { bestDir = ok.d; bestDist = ok.dist; break; }
    }
    const to = [
      pr.pos[0] + bestDir[0] * bestDist,
      pr.pos[1] + bestDir[1] * bestDist,
      pr.pos[2] + bestDir[2] * bestDist,
    ];
    const nearestAtTo = this._distanceToNearestSeed(to[0], to[1], to[2]);
    pr.wormholeFrom = from;
    pr.wormholeTo = to;
    pr.wormholeTimer = this.config.wormholeDuration;
    pr.wormholeDuration = this.config.wormholeDuration;
    // 物理上把小球瞬移到 to 处，避免在动画中继续被强引力拉回
    pr.pos = to.slice();
    pr.prevPos = to.slice();
    // 给一个新航向
    const tan = randomUnit(1);
    let vx = bestDir[0] + tan[0] * 0.3, vy = bestDir[1] + tan[1] * 0.3, vz = bestDir[2] + tan[2] * 0.3;
    const vl = Math.max(1e-4, Math.hypot(vx, vy, vz));
    vx /= vl; vy /= vl; vz /= vl;
    pr.vel = [vx * PROBE_RESPAWN_SPEED, vy * PROBE_RESPAWN_SPEED, vz * PROBE_RESPAWN_SPEED];
    pr.respawnGrace = 6;
    pr.respawnFlash = 1;
    pr.label = `经虫洞跃迁逃出【${label}】`;
    pr.lastCaptureSeed = -1; // 成功逃逸，重置捕获记忆
    pr.lastCaptureTime = -Infinity;
    this.events.push({ time: this.time, text: `🌀 小球被【${label}】持续捕获，经虫洞跃迁 ${bestDist.toFixed(0)} 单位（距最近天体 ${nearestAtTo.toFixed(0)}）真正逃逸` });
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
    // 引力常数与天体质量倍率运行时可调（UI 滑杆），取值已在 UI 侧钳制
    const gG = this.config.gravityG;
    const mS = this.config.bodyMassScale;

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
          // ---- 质点质量按系统类型区分（修正过的建模）----
          // 单天体系统（星尘/行星/恒星）：种子就是那颗天体本身，质点**永不退场**。
          //   此前一律按 detailRadius 平滑退场，导致小球飞向恒星时贴身引力归零
          //   （剩下的行星成员质量太小），看起来像"引力算错了"——单天体没有
          //   "质量展开给成员"这回事。
          // 集合系统（星团/星系/超星系团/黑洞）：远场仍由质点承担（多极展开
          //   单极项），进入系统后**保留 0.45 的底数**平滑退到 0.45×mass——
          //   成员里"已发现"的只是一小部分，且几百个质点也代表不了
          //   10^11 颗恒星 + 暗物质晕的连续引力场：星系内部的引力不该
          //   凭空消失（未分辨质量就是连续分量）。总有效质量始终 ≤ s.mass，
          //   与成员引力不重复计入。
          let seedMass = s.mass;
          if (s.detail && s.detail.radius > 0 && COLLECTION_LEVELS.has(s.level)) {
            const wIn = smoothstep(s.detail.radius * 0.6, s.detail.radius * 1.4, Math.sqrt(r2));
            seedMass = s.mass * (0.45 + 0.55 * wIn);
          }
          if (seedMass < 1e-6) continue;
          const f = gG * PROBE_GRAVITY_MULT * (seedMass * mS) / Math.pow(r2 + EPS2, 0.95) * gs;
          ax += f * dx; ay += f * dy; az += f * dz;
        }
      }
      for (const s of this.activeDetails) {
        // 成员的引力按"进入深度"平滑登场，与上面中心质点的退场互补：
        // 远处全靠质点（等价多极展开的单极项），靠近后成员分布登场；
        // 质点保留的 0.45 底数代表未分辨的连续质量，两边总效应 ≤ s.mass。
        // 这样展开 detail 不会造成引力跳变。
        let memberW = 1;
        if (s.detail && s.detail.radius > 0) {
          const dd = Math.hypot(s.pos[0] - pr.pos[0], s.pos[1] - pr.pos[1], s.pos[2] - pr.pos[2]);
          memberW = 1 - smoothstep(s.detail.radius * 0.6, s.detail.radius * 1.4, dd);
        }
        if (memberW <= 0.001) continue;
        for (const b of s.detail.bodies) {
          // 未发现的天体不产生引力——它们还没"进入小球的宇宙"
          if (b._hidden) continue;
          const dx = b.pos[0] - pr.pos[0];
          const dy = b.pos[1] - pr.pos[1];
          const dz = b.pos[2] - pr.pos[2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < 1e-6) continue;
          const f = gG * PROBE_GRAVITY_MULT * (b.mass * mS) * memberW / Math.pow(r2 + 0.12, 0.95);
          ax += f * dx; ay += f * dy; az += f * dz;
          // 二级系统的行星/卫星质量小，但贴近时仍有可感知的引力
          if (b.children) {
            for (const ch of b.children) {
              const cx = ch.pos[0] - pr.pos[0];
              const cy = ch.pos[1] - pr.pos[1];
              const cz = ch.pos[2] - pr.pos[2];
              const cr2 = cx * cx + cy * cy + cz * cz;
              if (cr2 < 1e-6) continue;
              const cf = gG * PROBE_GRAVITY_MULT * (ch.mass * mS) * memberW / Math.pow(cr2 + 0.12, 0.95);
              ax += cf * cx; ay += cf * cy; az += cf * cz;
            }
          }
        }
      }
      // 记录本子步的总引力加速度（供 HUD 显示"当前所受引力大小"与状态判定）
      pr.gravAccel[0] = ax; pr.gravAccel[1] = ay; pr.gravAccel[2] = az;
      pr.vel[0] += ax * h; pr.vel[1] += ay * h; pr.vel[2] += az * h;
      // 注意：这里**不做**任何"限速 / 巡航速度"处理。
      // 速度大小由引力与介质阻尼自然决定（终端速度约 33 单位/秒）。
      // 想让屏幕上走得慢，请在显示层调 state.timeScale（见 render() 中的
      // state.physAcc 累积），不要动这里的物理量 —— 改动会破坏轨道结果。

      // ---- 进入系统后的星际气体阻尼（速度-尺度协调，2026-08-30 重做）----
      // 原实现范围 = systemRadius（恒星系仅 3.4、行星系仅 1.7）——小球
      // 30/s 巡航穿过恒星系只花 0.9s、行星系 0.3s，伴星/行星/小行星带
      // 根本来不及看清（实测小球速度是成员轨道速度的 17~60 倍）。
      // 现在：范围扩到 detailRadius（"可分辨细节"的边缘就开始减速），
      // 强度按层级分级 + 深度平方（边缘弱、核心强）：
      //   小型单天体（行星/恒星/星尘）3.0/s —— 贴近时降到可观察速度
      //   中型集合（星团/黑洞）        1.6/s
      //   大型集合（星系/超星系团）    1.0/s —— 宏观结构保持穿越节奏
      let drag = 0;
      for (const s of this.seeds) {
        const R = Math.max(this._systemRadius(s), (this._detailRadius(s) || 0) * 0.75);
        const dx = s.pos[0] - pr.pos[0];
        const dy = s.pos[1] - pr.pos[1];
        const dz = s.pos[2] - pr.pos[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < R) {
          const depth = 1 - d / R;
          const coeff = (s.level === 'planet' || s.level === 'star' || s.level === 'dust' || s.level === 'void') ? 2.2
            : (s.level === 'cluster' || s.level === 'blackhole') ? 0.9
            : 0.45;
          let k = coeff * depth;
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
      // ---- 巡航恢复（游戏化）----
      // 被系统阻尼减速后（离开系统时可能只有 6~10/s），空旷区以
      // 0.1/s 向巡航 PROBE_INITIAL_SPEED 松弛——避免"8/s 爬行 50 秒"
      // 的无聊空旷航段（相当于飞船的巡航引擎维持航速，纯速度维持、
      // 不产生方向改变；在系统阻尼区内不生效，不影响捕获判定）。
      if (this.time > BIG_BANG_WALL && drag <= 0) {
        const sp2 = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
        if (sp2 < PROBE_INITIAL_SPEED && sp2 > 1e-3) {
          const k = Math.min(1, h * 0.1);
          const ux = pr.vel[0] / sp2, uy = pr.vel[1] / sp2, uz = pr.vel[2] / sp2;
          pr.vel[0] += (ux * PROBE_INITIAL_SPEED - pr.vel[0]) * k;
          pr.vel[1] += (uy * PROBE_INITIAL_SPEED - pr.vel[1]) * k;
          pr.vel[2] += (uz * PROBE_INITIAL_SPEED - pr.vel[2]) * k;
        }
      }
      // 玩家推进器：与介质阻尼并列，但不被它吃（玩家推力要能"对抗"系统阻尼）。
      // 关闭时 this.thrust 恒为 0，相当于这行不存在。
      if (this.config.thrustEnabled) {
        pr.vel[0] += this.thrust[0] * h;
        pr.vel[1] += this.thrust[1] * h;
        pr.vel[2] += this.thrust[2] * h;
      }
      // 引力弹弓加速有界：超过上限后等比例截断，保持航行节奏与跟拍稳定。
      // 大爆炸瞬间（BIG_BANG_WALL 内）豁免——小球以超光速喷出后由下方
      // 减速项拉回巡航速度，不能被这里的截断直接拍成 PROBE_MAX_SPEED
      // （那样"超光速飞散"的视觉瞬间就没了）。
      const spd = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (spd > PROBE_MAX_SPEED && this.time > BIG_BANG_WALL) {
        const f = PROBE_MAX_SPEED / spd;
        pr.vel[0] *= f; pr.vel[1] *= f; pr.vel[2] *= f;
      }
      // 暴胀减速：爆炸窗口内速度向巡航 PROBE_INITIAL_SPEED 松弛。
      // 只改大小、不改方向——爆炸径向喷出的轨迹保持直线，模拟
      // "暴胀后物质快速减速"（前快后慢）。窗口结束后由引力接管。
      if (this.time < BIG_BANG_WALL && spd > PROBE_INITIAL_SPEED) {
        const k = Math.min(1, h * 1.0);
        const ux = pr.vel[0] / spd, uy = pr.vel[1] / spd, uz = pr.vel[2] / spd;
        pr.vel[0] += (ux * PROBE_INITIAL_SPEED - pr.vel[0]) * k;
        pr.vel[1] += (uy * PROBE_INITIAL_SPEED - pr.vel[1]) * k;
        pr.vel[2] += (uz * PROBE_INITIAL_SPEED - pr.vel[2]) * k;
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
        const f = gG * PROBE_GRAVITY_MULT * (s.mass * mS) / Math.pow(r2 + EPS2, 0.95) * gs;
        const strength = f * d;
        if (strength > bestStr) { bestStr = strength; bestInf = s.idx; }
      }
    }
    pr.influencer = bestInf;
    pr.influenceStrength = bestStr;

    // ---- 引力状态（要求 5：速率 / 最近天体距离 / 引力大小 + 临界状态）----
    // 用"当前速率 vs 逃逸速度"的比值 kappa 判定被捕获还是被甩出：
    //   逃逸速度 vEsc = sqrt(2·a·r)，a 是当前引力加速度、r 是到天体的距离
    //   （点质量下 a·r = μ/r，于是 vEsc = sqrt(2μ/r)，与解析式一致）。
    //   kappa < 0.85 束缚、0.85~1.0 临界、≥1.0 逃逸。
    // 再结合切向占比区分"环绕轨道"与"径向坠落"。
    {
      const gi = pr.gravInfo;
      const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      const acc = Math.hypot(pr.gravAccel[0], pr.gravAccel[1], pr.gravAccel[2]);
      let nd = Infinity;
      if (pr.influencer >= 0) {
        const s = this.seeds[pr.influencer];
        nd = Math.hypot(pr.pos[0] - s.pos[0], pr.pos[1] - s.pos[1], pr.pos[2] - s.pos[2]);
      }
      const vEsc = acc > 1e-6 && nd < Infinity ? Math.sqrt(2 * acc * Math.max(nd, 1e-3)) : 0;
      const kappa = vEsc > 1e-6 ? sp / vEsc : 0;
      let st = '自由航行';
      if (pr.influencer >= 0 && acc > 0.02) {
        if (kappa >= 1.0) st = '逃逸甩出';
        else if (kappa >= 0.85) st = '临界';
        else if ((pr.orbitTangent || 0) > 0.5) st = '环绕轨道';
        else st = '坠落接近';
      }
      gi.speed = sp;
      gi.nearDist = nd;
      gi.accel = acc;
      gi.vEsc = vEsc;
      gi.kappa = kappa;
      gi.state = st;
    }

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
      // 集合类（星团 / 星系 / 超星系团 / 黑洞）**没有**整体碰撞体：
      // 它们不是单个天体，内部绝大部分是空的，小球从旋臂之间穿过去是物理
      // 上正确的行为，只有撞上具体成员（恒星 / 行星 / 黑洞）才应判定捕获。
      // （曾经加过"核心半径兜底"来防视觉穿透，那等于把星系当成实心球，
      //  属于建模错误，已移除。）
    }
    for (const s of this.activeDetails) {
      for (const b of s.detail.bodies) {
        // 未发现的天体不可捕获——发现（接近）本身就是交互的前提
        if (b._hidden) continue;
        // 母天体 + 二级成员一起检测；deco 装饰粒子（行星环）没有碰撞体——
        // 环是稀疏冰粒，穿过去是物理正确的行为
        const bodiesToCheck = b.children
          ? [b, ...b.children.filter((ch) => !ch.deco)]
          : [b];
        for (const body of bodiesToCheck) {
          const dx = body.pos[0] - pr.pos[0];
          const dy = body.pos[1] - pr.pos[1];
          const dz = body.pos[2] - pr.pos[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const hitR = body.radius + 0.18;
          if (pr.respawnGrace <= 0 && d < hitR) {
            const parent = this.seeds[body.parent];
            const isChild = body !== b;
            const typeLabel = body.type === 'star' ? '恒星'
              : body.type === 'planet' ? (isChild ? '卫星' : '行星')
              : body.type === 'galaxy' ? '星系核'
              : body.type === 'gas' ? '星云气体'
              : body.type === 'asteroid' ? '小行星'
              : '黑洞';
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
    // 暴胀减速：暴涨速度（inflate）按 exp(-1.5·time) 指数衰减——
    // 初期超光速飞散（暴涨），约 2s 后衰减到末速度漂移（前快后慢）。
    // 这是"宇宙整体超光速膨胀后放缓"的物理体现。
    const inflateDecay = Math.exp(-this.time * 1.5);
    for (const s of this.seeds) {
      // 位置 = 末速度漂移 + 衰减中的暴涨速度（frontier 补种无 inflate，按 0）
      const ix = s.inflate ? s.inflate[0] * inflateDecay : 0;
      const iy = s.inflate ? s.inflate[1] * inflateDecay : 0;
      const iz = s.inflate ? s.inflate[2] * inflateDecay : 0;
      s.pos[0] += (s.vel[0] + ix) * dt;
      s.pos[1] += (s.vel[1] + iy) * dt;
      s.pos[2] += (s.vel[2] + iz) * dt;
      if (seedDrag > 0) {
        const f = Math.max(0, 1 - seedDrag * dt);
        s.vel[0] *= f; s.vel[1] *= f; s.vel[2] *= f;
      }
      this._updateSeedFormation(s);
      // 影响半径：巨质量晕能把很大范围的物质拉向自己（光年级），
      // 小球在远处就会被偏转
      s.influenceRadius = 4.5 + s.growth * (12.0 + s.mass * 6.0) + s.mass * 1.4;
      // 超大质量黑洞的引力范围更广（真实 SMBH 引力井极深、影响光年尺度）
      if (s.level === 'blackhole') s.influenceRadius *= 1.6;
      s.captureRate = 0.20 + s.growth * 0.55 + s.mass * 0.10;
    }
    // ---- 天体间万有引力（N-body 软化，2026-08-30 新增）----
    // 种子（天体系统）之间按万有引力相互吸引——近距离大系统产生
    // 可感知的相对接近/偏转，符合真实宇宙的引力相互作用。O(n²) 每步
    // 3249 对，廉价；强度由 config.seedGravity 控制（0 关闭）。
    this._applySeedGravity(dt);

    // 更新普通物质
    // 引力常数与天体质量倍率（UI 可调，取值已在 UI 侧钳制）
    const pGG = this.config.gravityG;
    const pMS = this.config.bodyMassScale;
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
          const f = pGG * (s.mass * pMS) / Math.pow(r2 + EPS2, 1.5) * gs;
          ax += f * dx; ay += f * dy; az += f * dz;
        }
      }
      p.vel[0] += ax * dt; p.vel[1] += ay * dt; p.vel[2] += az * dt;

      // 暴胀减速：EJECTA 粒子初速超光速（160~320），爆炸窗口内快速衰减
      // （超高速扩张 → 逐渐放缓），避免喷飞太远破坏结构形成。
      if (p.isEjecta && this.time < BIG_BANG_WALL) {
        const f = Math.max(0.10, 1 - dt * 1.4);
        p.vel[0] *= f; p.vel[1] *= f; p.vel[2] *= f;
      }

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
