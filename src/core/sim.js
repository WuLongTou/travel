// 宇宙大爆炸模拟 · 物理域（模拟域）
// CosmicSimulation：宇宙演化主循环、种子/粒子状态机、小球物理、
// 捕获/重生/虫洞、渐进发现、成员布局与子星系（目录梳理第三步：
// 从 src/cosmos.js 拆出，渲染域见 src/render/renderer.js）。
import {
  EPS2, N_PARTICLES, N_CLOUD_PARTICLES, N_EJECTA_PARTICLES,
  GRAVITY_START, GRAVITY_FULL, BASE_SPEED,
  SEED_R_MIN, SEED_R_MAX, EJECTA_SPEED_MIN, EJECTA_SPEED_MAX,
  PROBE_INITIAL_SPEED, PROBE_BIGBANG_SPEED, BIG_BANG_WALL, PROBE_GRAVITY_MULT,
  SEED_AWAKEN_RADIUS, FORMATION_SPACING,
  FRONTIER_INTERVAL,
  REVEAL_RADIUS, REVEAL_SCALE, DISCOVERY_PER_STEP, COLLECTION_LEVELS,
  CLASS_DEFS, PROBE_DRAG_LEGACY, PROBE_IGM_DRAG, PROBE_RESPAWN_SPEED, PROBE_MAX_SPEED,
} from './config.js';
import { randomUnit, clamp01, smoothstep, easeInOut, orbitPolar, hash01 } from './utils.js';
import { levelForSeed, finalLevelFor, LEVEL_LABELS, DEATH_VERBS, EVENT_LEVELS, EVENT_MESSAGES } from './sim-shared.js';

// 对外转发（cosmos.js 聚合入口 re-export 用，外部 import 路径不变）
export { levelForSeed, finalLevelFor, LEVEL_LABELS } from './sim-shared.js';
import { queryMethods } from './methods/query.js';
import { gravityMethods } from './methods/gravity.js';
import { universeMethods } from './methods/universe.js';
import { membersMethods } from './methods/members.js';
import { probeMethods } from './methods/probe.js';
import { detailsMethods } from './methods/details.js';

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
      // 天体间引力（万有引力）：种子（天体系统）之间的 N-body 软化引力。
      // 0 = 关闭；默认 180：真实宇宙里星系间的相对运动在可观测尺度上
      // 几乎不可感知，只在极近距离（<100 单位）才有轻微偏转——保持
      // 宇宙整体的平静与稳定，天体不漂移、不聚团。
      seedGravity: 180,
      // 启动快进（显示层）：开局以 bootFastForwardScale 倍（6×）推进、
      // 按乘性指数曲线平滑回落（时间常数 = wall×0.18 ≈ 2.5s，见
      // renderer.js）——大爆炸的暴胀以真实的屏幕节奏掠过视野（"超大
      // 能量释放"的观感来源），随后无缝回到环境倍率节奏。置 1 可关闭。
      bootFastForwardWall: 14,
      bootFastForwardScale: 6,
      camZoom: 55,         // 第三人称镜头基准距离（面板已精简，固定为跟拍子系统的巡航值）
      camPanX: 0,          // 镜头平移偏移（世界单位，受限）
      camPanY: 0,
      filamentStrength: 1, velocityDispersion: 1, massBias: 0,
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
        // 散布半径收紧（2026-09-01）：旧值（0.09/0.06/0.035/0.025）下小球与
        // 沿线天体的典型垂直偏差 ≈15~20 单位，多数相遇成了远距离掠过，
        // 看不清引力交互。收紧后典型最近距离进入 5~12 单位——恒星系
        // （detailR 14）会真正被穿过、行星（detailR 5）能贴身掠过。
        // 2026-09-02：贴附概率下调（0.72/0.84/0.90/0.92 → 0.58/0.66/0.72/0.75）。
        // 旧值下 72%~92% 的种子都压在同一条 probeDir 射线附近，每次"重开
        // 宇宙"遇到的是同一束天体、同一条走廊——宇宙看起来是"一条线"而不是
        // "一片空间"，重复感很强。现在约 1/4~1/2 的种子改为全天散布：它们
        // 大多很远，作为远景星系提供纵深与"宇宙很大"的观感；留在射线上的
        // 那部分仍然保持收紧后的散布半径（0.055~0.022），保证航线上依旧
        // 有 5~12 单位的贴身遭遇可看。
        if (def.key === 'small') { biasProb = 0.58; scatterScale = 0.055; }
        else if (def.key === 'medium') { biasProb = 0.66; scatterScale = 0.040; }
        else if (def.key === 'large') { biasProb = 0.72; scatterScale = 0.030; }
        else { biasProb = 0.75; scatterScale = 0.022; }
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
        let rBase;
        if (def.key === 'small') rBase = 180 + t * 1800;
        else if (def.key === 'medium') rBase = 380 + t * 2800;
        else if (def.key === 'large') rBase = 650 + t * 3800;
        else rBase = 1000 + t * 4500;
        // 天体在初始化时就已定型：宇宙大爆炸已经把物质抛到远方，
        // 远方早已凝聚成完整结构，小球靠近只是"发现"细节（§5.2）。
        // 等级提前确定，供下面的隔离校验取隔离半径。
        const willCollapse = def.key === 'giant' && hash01(idx * 13 + 101) < 0.35;
        const level = finalLevelFor(def.key, willCollapse);
        // 最小间距拒绝采样（§ISOLATION_RADII，2026-09-03）：候选位置距
        // 所有已放置种子 ≥ 双方隔离半径之和才接受——从结构上保证初始
        // 宇宙里任何两个系统都不挤在一起（"系统之间隔着大片空旷"）。
        // 纤维方向拥挤时逐步放宽：先加大径向抖动，10 次后脱离纤维、
        // 全天各向同性重采（一条射线的容量有限，多出的种子自然溢出
        // 到整个天球）；30 次后兜底接受最后一个候选，保证必然终止。
        let r = rBase + Math.random() * 80;
        for (let attempt = 0; attempt < 30; attempt++) {
          r = rBase + Math.random() * (80 + attempt * 60);
          if (attempt >= 10) dir = randomUnit();
          const cand = [dir[0] * r, dir[1] * r, dir[2] * r];
          if (this._isPositionIsolated(cand, level)) break;
        }
        // 结构准静止（2026-09-03）：暴胀后暗物质晕只保留极缓慢的本动
        // 漂移——真实宇宙里星系相对哈勃流的本动速度只占很小比例，
        // 可观测尺度上结构是稳定的。旧值 5~9.6/s 会让种子在百秒内
        // 漂移 400+ 单位，把初始最小间距（§ISOLATION_RADII）完全打穿，
        // 系统彼此漂进漂出，"扎堆"观感回归。暴胀的位移由 inflate 项
        // 独立承担（前 2 秒把物质推到远方），与这里的本动无关。
        const speed = 0.4 + Math.random() * 0.8;
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
          level,
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























  // ---- 死亡序列（§9.3）：捕获后先播一段"坠入/汽化/被撕碎"演出，
  // 物理冻结、杀手引用实时取 pos（绕行天体也在动），结束后才重生 ----
  static DEATH_DUR = { atmosphere: 1.1, vaporize: 0.7, tidal: 1.3, generic: 0.8 };









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
    // 2026-09-02 降频到 5Hz：默认 seedGravity=180 下远场（>100 单位）
    // 加速度 < 0.01/s²，对种子运动几乎无影响；每物理步重算纯属浪费。
    // 每 0.2s 算一次、按 0.2s 积分，视觉行为不变。
    this._seedGravTimer = (this._seedGravTimer || 0) + dt;
    if (this._seedGravTimer >= 0.2) {
      this._seedGravTimer = 0;
      this._applySeedGravity(0.2);
    }

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
    // 2026-09-02 降频：members 数组只被 frontier 回收时读取（解绑粒子），
    // 无需每帧 35% 概率重算 O(N·S)。改为每 2 物理秒一次。
    this._membersTimer = (this._membersTimer || 0) + dt;
    if (gs > 0.05 && this._membersTimer >= 2) {
      this._membersTimer = 0;
      this._assignMembers();
    }
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

// 方法组 mixin 装配（目录梳理）：各组方法定义在 core/methods/*.js，
// 通过 prototype 挂载——方法体内仍以 this 访问实例状态，逻辑零改动。
Object.assign(
  CosmicSimulation.prototype,
  queryMethods,
  gravityMethods,
  universeMethods,
  membersMethods,
  probeMethods,
  detailsMethods,
);
