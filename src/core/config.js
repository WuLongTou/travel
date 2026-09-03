// 宇宙大爆炸模拟 · 顶层常量与默认配置
// 从 src/cosmos.js 顶层抽离（目录梳理第一步）：纯数据常量集中管理，
// 逻辑/函数（randomUnit、orbitPolar 等）仍在 cosmos.js。改动行为时
// 先查这里，再查 docs/SIMULATION.md（单一真源）。

// ---------- 模拟参数 ----------
// 引力常数已改为运行时可调（sim.config.gravityG，UI 滑杆直通），
// 默认值 16 与原来的常量一致，保证行为不变。
export const EPS2 = 0.16;
export const N_PARTICLES = 820;
export const N_CLOUD_PARTICLES = 600;   // 远方的原初气体云粒子，分布在暗物质晕周围
export const N_EJECTA_PARTICLES = N_PARTICLES - N_CLOUD_PARTICLES; // 从奇点喷出的可见高速喷流
export const GRAVITY_START = 1.15;
export const GRAVITY_FULL = 5.6;
export const BASE_SPEED = 8.0;

// 小球巡航物理速度体系（2026-09-01 调低，2026-09-03 再调上限）：
// 巡航 17 / 上限 21 / 重生 20。之前 24/34/30 配合启动快进期的 0.5×
// 倍率，屏幕速度常在 12+ 单位/秒，穿越恒星系只要一两秒，根本来不及
// 看清与天体的交互。降速后引力弯曲更明显（同样的引力有更多时间起
// 作用）、穿越节奏更从容。

// 暴胀：第一瞬间物质被推到很远，之后才在远方形成原子和宇宙网。
export const SEED_R_MIN = 180;
export const SEED_R_MAX = 900;
// 大爆炸强度：初始喷射速度显著提高（"嗖"地超光速扩张的视觉冲击）。
// 爆炸窗口（BIG_BANG_WALL 秒）内，小球与 EJECTA 粒子从初速快速减速到
// 巡航速度——"前快后慢"的暴胀后减速，不是匀速直线。
export const EJECTA_SPEED_MIN = 160;
export const EJECTA_SPEED_MAX = 320;
export const PROBE_INITIAL_SPEED = 17;  // 小球只携带暴胀结束后的惯性速度（巡航速度）
export const PROBE_BIGBANG_SPEED = 110; // 暴胀瞬间的初始速度（超光速视觉），爆炸窗口内减速
export const BIG_BANG_WALL = 1.2;       // 爆炸窗口：小球超光速豁免 MAX_SPEED + 减速期

// 为了让航线上天体的引力拉扯足够明显，只增强小球感受到的引力强度；
// 不会改变物质粒子的物理。
// 2026-09-03 自 2.0 上调：实测 600s 内 14 次遭遇有 9 次偏转 <5°（屏幕
// 上即"直接飞过去"）——行星掠过仅 3~4°、恒星 7~10°，跟拍镜头下不可读。
// 3.0 配合限速下调（26→21，穿越窗口拉长 ~24%），近景偏转增益 ≈2.3 倍：
// 恒星掠过 16~23°、行星 7~9°，引力弯曲成为可读的画面事件。
export const PROBE_GRAVITY_MULT = 3.0;

// 结构形成节奏：只有小球真正接近某个暗物质晕时，该晕才会被唤醒；
// 同一时间最多只允许一个系统在形成，避免"几秒内冒出一堆天体"。
// 唤醒半径要足够大、形成时间要足够短，保证小球在很远就能"看见"结构成形，
// 而不是贴近时才突然生成一个。
export const SEED_AWAKEN_RADIUS = 220;
export const FORMATION_SPACING = 1.5;

// 航线前沿动态生成：沿航线前方持续把远处的休眠种子回收成新结构，
// 形成"流式加载"的无限宇宙（旧的落在身后、新的出现在前方）。
// 间隔 3.5 物理秒一次（2026-09-03 自 2.5 放宽）：投放密度必须与
// 隔离约束（§ISOLATION_RADII）协调——投得太密时走廊里的新候选总与
// 刚投的邻居冲突，隔离校验反复失败反而降低实际投放量。
export const FRONTIER_INTERVAL = 3.5;
// ---- 系统隔离半径（真实宇宙的层级间距，2026-09-03 新增）----
// 任意两个天体系统中心的间距 ≥ 双方隔离半径之和。数值以 detailRadius
// 为基准放大 4~9 倍：星系（detailR 115、直径 230）的隔离半径 480，
// 两个星系至少隔 960 ≈ 4 倍星系直径——真实宇宙里银河系到仙女座是
// 25 倍直径，本作尺度下取 4 倍已能在画面上呈现"星系际空间极其空旷"。
// 初始分布与 frontier 投放共用这张表做最小间距拒绝采样，
// 从结构上消灭"几个系统挤成一团"的不真实观感。
export const ISOLATION_RADII = {
  planet: 45,
  star: 80,
  dust: 90,
  void: 80,
  cluster: 130,
  blackhole: 170,
  galaxy: 480,
  supercluster: 550,
};
// ---- 渐进发现（§5.2）----
// 集合系统（星团/星系/超星系团/黑洞系统）的成员从远景阶段就以"成员点云"
// 的形式存在：远处看到的就已经是"一群天体"，而不是一个渲染成星系的单个天体。
// 小球真正靠近某个成员到下面这个距离内，该成员才升级为真实天体
// （有引力 / 可碰撞 / 能长出二级系统 / 由真实点云接管渲染）。
// 基准阈值是绝对世界距离——"看清一颗恒星"不随宿主系统的尺度变化；
// 越亮越大的天体越早被注意到。
// 2026-09-03 整体上调 ~1.6 倍：实测典型掠过最近距离 0.9~1.3R（恒星系
// 即 13~18 单位）> 旧阈值（伴星 12.2 / 行星 6.1 / 气体 4.9 / 小行星
// 3.6，含 scale），几何上擦不到成员——官方 smoke 11 个被接近系统
// 7 个发现率为 0，穿越时没有任何显形事件。上调后 1.1R 掠过恒星系
// 可发现 3~8 个成员，"天体逐个显形"成为可见的交互信号。
export const REVEAL_RADIUS = {
  blackhole: 32,  // 中心黑洞：吸积盘极亮且引力异常，最早被"看见"
  galaxy: 28,     // 超星系团内的星系核
  star: 16,
  planet: 8,
  gas: 7,
  asteroid: 5,   // 小行星带成员：又小又暗，仍要贴脸才被看清
};
// 再按系统尺度放大一次。线性外推会让星系（detailR 115）的发现半径
// 爆到 4 倍——恒星在 40 单位外就被"看清"，稀疏感荡然无存。
// 改用平方根：大系统只温和放大，星系里的恒星仍要贴近才被发现。
export const REVEAL_SCALE = (detailR) => 0.6 + 0.9 * Math.sqrt(detailR / 30);
// 每个物理步（50Hz）最多揭示的成员数：高速穿越时也不会一帧全开，
// 保证"由近及远、逐个显形"的节奏（2026-09-03 自 2 上调：配合
// REVEAL_RADIUS 放大后候选变多，4/步仍保持渐进而非一帧全开）
export const DISCOVERY_PER_STEP = 4;
// 多天体集合档位：这些系统才走"成员陆续显形"的完整表达
// （远景成员点云 + 逐个发现 + 显形事件）。恒星/行星系统成员只有几个，
// 贴身即显形，不需要点云与事件播报。
export const COLLECTION_LEVELS = new Set(['cluster', 'galaxy', 'supercluster', 'dust', 'void', 'blackhole']);

export const CLASS_DEFS = [
  { key: 'small',  name: '小质量晕', count: 24, durBase: 3, durSpan: 1, massMin: 0.13, massMax: 0.24 },
  { key: 'medium', name: '中等质量晕', count: 18, durBase: 4.5, durSpan: 1.5, massMin: 0.32, massMax: 0.60 },
  { key: 'large',  name: '大质量晕', count: 12, durBase: 6, durSpan: 2, massMin: 0.85, massMax: 1.55 },
  { key: 'giant',  name: '巨质量晕', count: 3,  durBase: 7.5, durSpan: 2.5, massMin: 2.30, massMax: 3.80 },
];

// 主角小球是一艘没有预定航线的自由探测器：只受引力和气体阻尼影响。
// 进入天体系统后的星际气体阻尼按层级分级（见 _updateProbe）：
// 行星/恒星 2.2、星团/黑洞/星云 0.5、星系/超星系团 0（延展引力 +
// 任何非零阻尼 = 螺旋坠入星系核）+ 深度线性。此常量不再使用。
export const PROBE_DRAG_LEGACY = 0.4;
export const PROBE_IGM_DRAG = 0.004;     // 星系际介质极微弱阻尼，防止无限加速后飞离可视宇宙
// 重生 / 手动重置时从系统边缘获得的初始速度（物理量，不改）。
// 屏幕上的快慢由显示层的 state.timeScale 决定，与这里无关。
export const PROBE_RESPAWN_SPEED = 20.0;
// 2026-09-03 自 26 下调：57 个种子的延展引力合加速度处处非零（实测
// 0.4~1.5/s²），持续把小球泵到顶着上限跑，穿越窗口比设计巡航短
// 20~50%。21 与重生速度 20 匹配，引力弹弓仍可有界加速。
export const PROBE_MAX_SPEED = 21;       // 速度上限：引力弹弓加速有界，保证形成节奏与跟拍节奏不被甩开
