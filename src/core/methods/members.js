// CosmicSimulation 的 members 方法组（目录梳理：mixin 装配，方法体未改动）。
// 通过 Object.assign 挂到 prototype，方法内仍以 this 访问实例状态。
import {
  EPS2, N_PARTICLES, N_CLOUD_PARTICLES, N_EJECTA_PARTICLES,
  GRAVITY_START, GRAVITY_FULL, BASE_SPEED,
  SEED_R_MIN, SEED_R_MAX, EJECTA_SPEED_MIN, EJECTA_SPEED_MAX,
  PROBE_INITIAL_SPEED, PROBE_BIGBANG_SPEED, BIG_BANG_WALL, PROBE_GRAVITY_MULT,
  SEED_AWAKEN_RADIUS, FORMATION_SPACING,
  FRONTIER_INTERVAL,
  REVEAL_RADIUS, REVEAL_SCALE, DISCOVERY_PER_STEP, COLLECTION_LEVELS,
  CLASS_DEFS, PROBE_DRAG_LEGACY, PROBE_IGM_DRAG, PROBE_RESPAWN_SPEED, PROBE_MAX_SPEED,
} from '../config.js';
import { randomUnit, clamp01, smoothstep, easeInOut, orbitPolar, hash01 } from '../utils.js';
import { levelForSeed, finalLevelFor, LEVEL_LABELS, DEATH_VERBS, EVENT_LEVELS, EVENT_MESSAGES } from '../sim-shared.js';

export const membersMethods = {
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
      // 星云：弥散的气体尘埃云铺开到系统大半半径（0.72r——星云在真实
      // 宇宙就是跨数十光年的弥散结构，不是一团密集粒子），少量亮星埋在内圈
      const count = 90 + Math.floor(rng() * 60);
      for (let i = 0; i < count; i++) {
        const isStar = rng() < 0.12;
        const orbitR = 0.4 + rng() * r * 0.72;
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
      // 星团：球状分布——外圈拉到 0.52r 弥散、内圈适度收拢（0.40r）。
      // 球状星团核心密度确实高于外围（真实如此：palomar 15 半数恒星在
      // 核心半径内），但整体仍是"数十颗星散布在几十单位里"，
      // 每颗恒星之间隔着明显的星间距，不是一团密集粒子。
      const count = 30 + Math.floor(rng() * 15);
      for (let i = 0; i < count; i++) {
        const orbitR = 0.8 + rng() * r * 0.52;
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
        const orbitR = 0.6 + rng() * r * 0.40;
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
      // 轨道带少量离心率（0~0.16）——真实行星轨道没有正圆，且行星间隔
      // 拉开（0.55r/0.68r——真实行星系统的轨道间距是 AU 级，水星到海王星
      // 跨 30 AU，内紧外松不是挤成一团）
      const innerBase = compMaxR > 0 ? compMaxR * 2.2 + 0.3 : 1.4;
      const count = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        const orbitR = innerBase + rng() * r * 0.55;
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
        const orbitR = innerBase + 0.4 + rng() * r * 0.68;
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
      // 盘半径（2026-09-03 自 0.42 恢复拉开到 0.58）：成员铺满系统大半
      // 半径——星系是"数百颗恒星隔着星际距离组成的庞大结构"，不是
      // 挤在中心的一团粒子。同样的成员数铺在 1.9 倍面积上，恒星间距
      // ×1.38，穿越时大部分空间是空的（真实星系正是如此：恒星占星系
      // 体积的比例可忽略）。
      const diskR = r * 0.58;
      const galOmega = (orbitR) => (0.14 + rng() * 0.08) * baseSpeed / Math.pow(0.6 + orbitR, 0.85);
      if (isElliptical) {
        // 椭圆星系：无旋臂无盘，三维球状、向心集中，老年恒星为主
        const count = scaleCount(420 + Math.floor(rng() * 80));
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
        const gasN = scaleCount(30);
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
        const bulgeN = scaleCount(110 + Math.floor(rng() * 30));
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
          const barN = scaleCount(55 + Math.floor(rng() * 16));
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
        const armN = scaleCount(200 + Math.floor(rng() * 50));
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
        const fieldN = scaleCount(90 + Math.floor(rng() * 25));
        for (let i = 0; i < fieldN; i++) {
          const orbitR = rMin * 0.6 + Math.pow(rng(), 1.4) * (diskR - rMin * 0.6);
          addOrbitBody(
            'star', 0.008 + rng() * 0.04, 0.024 + rng() * 0.035,
            orbitR, (rng() - 0.5) * orbitR * 0.12,
            galOmega(orbitR), rng() * TAU, rng(), 1, rng() * 0.05,
          );
        }
        // 银晕：稀疏球状老年星，盘外一圈微光
        const haloN = scaleCount(45 + Math.floor(rng() * 16));
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
      // 轨道半径按 node.radius 的 2.2~5.0 倍（2026-09-03 自 1.2~3.5 拉开：
      // 银晕恒星本就该散在星系盘外围的广袤空间里，贴核分布会读成
      // "一坨密集团"），与子星系盘（0.9~2.4 单位）外缘衔接构成银晕。
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        for (let i = 0; i < 24; i++) {
          const orbitR = node.radius * (2.2 + rng() * 2.8);
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
          const orbitR = node.radius * (1.8 + rng() * 3.0);
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
      // 核球恒星轨道拉开到 r 的 0.5~0.6（2026-09-03）：真实 SMBH 的
      // S 星群轨道周期以十年计、相互间隔远大于恒星半径——几十颗恒星
      // 散布在黑洞周围十几单位内，每颗之间隔着清晰间距，而不是
      // 挤成一团"粒子云"。
      layout.push({
        type: 'blackhole', mass: 0.45 + s.mass * 0.25, radius: 0.32 + s.mass * 0.06,
        colorSeed: 0, orbit: null, tier: 0,
      });
      const midCount = 16 + Math.floor(rng() * 8);
      for (let i = 0; i < midCount; i++) {
        const orbitR = 2.0 + Math.pow(rng(), 0.7) * r * 0.52;
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
        const orbitR = 1.4 + Math.pow(rng(), 0.7) * r * 0.60;
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
        const orbitR = 1.0 + Math.pow(rng(), 0.7) * r * 0.46;
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
  },

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
  },

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
  },

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
    // "全部显形"只播报一次（2026-09-02 修复）：foundCount 达满后继续
    // 调用本函数会重复推事件——旧版遭遇少没暴露，frontier 系统变密后
    // 实测刷出 1013 条。加 _allRevealed 去重标志。
    if (!s.detail._allRevealed && s.detail.foundCount >= s.detail.bodies.length) {
      s.detail._allRevealed = true;
      this.events.push({ time: this.time, text: `✨ 【${label}】${s.detail.bodies.length} 个成员已全部显形` });
    }
  },

  // 推进集合系统全体成员的轨道。
  // 成员走**纯解析开普勒轨道**（圆/椭圆 + 近快远慢），不做任何 N-body
  // 微扰叠加——之前的"恒星间相互引力微扰"（§9.7，bv/boff 漂移）会让
  // 恒星围绕轨道抖动漂移，看起来杂乱且不物理（真实星系在可观测的
  // 时间尺度上就是平滑轨道的集合体）。轨道运动平滑、确定、可复现。
  // 可见性由渐进发现（§5.2）决定，与小球到系统的距离无关——
  // 未发现的成员照样在轨道上运动，远景成员点云据此把它们画在真实位置。
  _updateDetailBodies(s, dt) {
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
  },

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
  },

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
};
