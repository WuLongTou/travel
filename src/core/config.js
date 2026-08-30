// 宇宙大爆炸模拟 · 顶层常量与默认配置
// 从 src/cosmos.js 顶层抽离（目录梳理第一步）：纯数据常量集中管理，
// 逻辑/函数（randomUnit、orbitPolar 等）仍在 cosmos.js。改动行为时
// 先查这里，再查 docs/SIMULATION.md（单一真源）。

// ---------- 模拟参数 ----------
// 引力常数已改为运行时可调（sim.config.gravityG，UI 滑杆直通），
// 默认值 16 与原来的常量一致，保证行为不变。
// 集合系统动力学（§9.7）微扰强度：恒星间相互引力的等效常数。
// 偏小刻意为之——微扰只让相对运动"活起来"，不破坏分析轨道的形态。
export const DYN_G = 1.4;
export const EPS2 = 0.16;
export const N_PARTICLES = 820;
export const N_CLOUD_PARTICLES = 600;   // 远方的原初气体云粒子，分布在暗物质晕周围
export const N_EJECTA_PARTICLES = N_PARTICLES - N_CLOUD_PARTICLES; // 从奇点喷出的可见高速喷流
export const GRAVITY_START = 1.15;
export const GRAVITY_FULL = 5.6;
export const BASE_SPEED = 8.0;

// 暴胀：第一瞬间物质被推到很远，之后才在远方形成原子和宇宙网。
export const SEED_R_MIN = 180;
export const SEED_R_MAX = 900;
// 大爆炸强度：初始喷射速度显著提高（"嗖"地超光速扩张的视觉冲击）。
// 爆炸窗口（BIG_BANG_WALL 秒）内，小球与 EJECTA 粒子从初速快速减速到
// 巡航速度——"前快后慢"的暴胀后减速，不是匀速直线。
export const EJECTA_SPEED_MIN = 160;
export const EJECTA_SPEED_MAX = 320;
export const PROBE_INITIAL_SPEED = 24;  // 小球只携带暴胀结束后的惯性速度
export const PROBE_BIGBANG_SPEED = 110; // 暴胀瞬间的初始速度（超光速视觉），爆炸窗口内减速
export const BIG_BANG_WALL = 1.2;       // 爆炸窗口：小球超光速豁免 MAX_SPEED + 减速期

// 为了让航线上天体的引力拉扯足够明显，只增强小球感受到的引力强度；
// 不会改变物质粒子的物理。
export const PROBE_GRAVITY_MULT = 2.0;

// 结构形成节奏：只有小球真正接近某个暗物质晕时，该晕才会被唤醒；
// 同一时间最多只允许一个系统在形成，避免"几秒内冒出一堆天体"。
// 唤醒半径要足够大、形成时间要足够短，保证小球在很远就能"看见"结构成形，
// 而不是贴近时才突然生成一个。
export const SEED_AWAKEN_RADIUS = 220;
export const FORMATION_SPACING = 1.5;

// 航线前沿动态生成：宇宙很空，所以每次只生成一个远处的「大系统」，
// 靠它巨大的引力范围（光年级）慢慢把小球拉过去，而不是贴脸生成。
// 投放间距保持星系直径（130+）的 2.3~4.3 倍——尊重"星系际空间极其空旷"
// 的常识（真实本星系群间距是银河系直径的 ~25 倍），又不至于让航程无聊。
export const FRONTIER_INTERVAL = 5.5;
export const FRONTIER_DIST_MIN = 300;
export const FRONTIER_DIST_MAX = 560;
// ---- 渐进发现（§5.2）----
// 集合系统（星团/星系/超星系团/黑洞系统）的成员从远景阶段就以"成员点云"
// 的形式存在：远处看到的就已经是"一群天体"，而不是一个渲染成星系的单个天体。
// 小球真正靠近某个成员到下面这个距离内，该成员才升级为真实天体
// （有引力 / 可碰撞 / 能长出二级系统 / 由真实点云接管渲染）。
// 基准阈值是绝对世界距离——"看清一颗恒星"不随宿主系统的尺度变化；
// 越亮越大的天体越早被注意到。
export const REVEAL_RADIUS = {
  blackhole: 24,  // 中心黑洞：吸积盘极亮且引力异常，最早被"看见"
  galaxy: 20,     // 超星系团内的星系核
  star: 10,
  planet: 5,
  gas: 4,
  asteroid: 3,   // 小行星带成员：又小又暗，几乎贴脸才被看清
};
// 再按系统尺度放大一次。线性外推会让星系（detailR 115）的发现半径
// 爆到 4 倍——恒星在 40 单位外就被"看清"，稀疏感荡然无存。
// 改用平方根：大系统只温和放大，星系里的恒星仍要贴近才被发现。
export const REVEAL_SCALE = (detailR) => 0.6 + 0.9 * Math.sqrt(detailR / 30);
// 每个物理步（50Hz）最多揭示的成员数：高速穿越时也不会一帧全开，
// 保证"由近及远、逐个显形"的节奏
export const DISCOVERY_PER_STEP = 2;
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
// 进入天体系统后的星际气体阻尼已按层级重做（见 _updateProbe）：
// 范围扩到 detailRadius、强度分层（行星/恒星 2.2、星团/黑洞 0.9、
// 星系/超星系团 0.45）+ 深度线性。此常量不再使用。
export const PROBE_DRAG_LEGACY = 0.4;
export const PROBE_IGM_DRAG = 0.004;     // 星系际介质极微弱阻尼，防止无限加速后飞离可视宇宙
// 重生 / 手动重置时从系统边缘获得的初始速度（物理量，不改）。
// 屏幕上的快慢由显示层的 state.timeScale 决定，与这里无关。
export const PROBE_RESPAWN_SPEED = 30.0;
export const PROBE_MAX_SPEED = 34;       // 速度上限：引力弹弓加速有界，保证形成节奏与跟拍节奏不被甩开
