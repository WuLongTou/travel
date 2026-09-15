// 全局领域类型：六层世界 / 实体 / 引力井 / 任务上下文
// 字段口径与 src/content/schema.js 顶部注释一致，从各 world 构建器
// 的实际用法反推；跨层不一致的字段一律可选（结构化类型按层收窄）。

/** 世界坐标三维向量（单位 = 所在层的 kmPerUnit 换算单位） */
export type Vec3 = [number, number, number];

/** 尺度层 id（LAYER_CHAIN 顺序 = 由内向外） */
export type LayerId = 'solar' | 'stellar' | 'galaxy' | 'local' | 'super' | 'cosmos';

/** 信息卡内容（点选天体展示） */
export interface EntityInfo {
  kind?: string;
  sub?: string;
  facts: [string, string][];
  text?: string;
  source?: string;
}

/** 可下潜目标：跳转到目标层的落点定义 */
export interface DiveTarget {
  toWorld: LayerId;
  at?: Vec3;
  targetName?: string;
  /** 触发半径（缺省 = pickRadius × 2.2，见 navigator.diveCheck） */
  reach?: number;
  /** 下潜后跟拍视距（缺省 0.35） */
  dist?: number;
}

/** 开普勒轨道参数（world-solar 用 keplerPos 驱动公转/速度） */
export interface OrbitParams {
  aAU: number;
  periodS: number;
  M0: number;
  e: number;
  peri: number;
}

/** 可交互/可下潜天体（各层附加字段可选） */
export interface Entity {
  id: string;
  name: string;
  en?: string;
  type: string;
  pos: Vec3;
  /** 点击检测半径（世界单位；泊车/碰撞/引力仍用真实半径） */
  pickRadius: number;
  /** 真实半径（世界单位；可与世界单位不同口径，如 galaxy 层） */
  radius?: number;
  /** 真实速度（世界单位/s；solar 层公转体携带，出生注入轨道速度用） */
  vel?: Vec3;
  /** 尺寸/位置非真实比例时标记，信息卡展示「示意」 */
  schematic?: boolean;
  selectable?: boolean;
  /** 太阳倍数质量（分层引力真实化：井 GM 按质量缩放） */
  mass?: number;
  info?: EntityInfo;
  dive?: DiveTarget;
  orbit?: OrbitParams;
  /** 渲染参数（颜色/温度/标签偏移等，各层自定义） */
  visual?: Record<string, unknown>;
  /** 渲染对象引用（引擎/构建器填充；带 position 的 three 对象） */
  mesh?: import('three').Object3D;
}

/** 引力井：ref 指向运动天体（井心跟随），否则用固定 center */
export interface GravityWell {
  ref?: Entity;
  center?: Vec3;
  GM: number;
  minR?: number;
  capR?: number;
  name: string;
}

/** 背景氛围装饰参数（各层自定义组合） */
export interface AmbientSpec {
  starCount?: number;
  starDensity?: number;
  starSpread?: number;
  starSize?: number;
  milkyWay?: boolean;
  milkyWayThickness?: number;
  cmb?: boolean;
  cmbRadius?: number;
}

/** 尺度层世界：独立坐标空间（1 世界单位 = kmPerUnit km） */
export interface GameWorld {
  id: LayerId;
  title: string;
  intro?: string;
  unitName: string;
  /** 1 世界单位 = ? km */
  kmPerUnit: number;
  /** 内容活动半径（世界单位；相机/层界/浮升判定用） */
  worldRadius: number;
  spawn?: Vec3;
  spawnLookAt?: Vec3;
  viewDist: number;
  /** 飞船第三人称跟拍视距 */
  shipViewDist?: number;
  labelFadeDist?: number;
  /** 探测球世界速度上限（= 300 km/s 按层单位换算） */
  maxSpeedWorldPerS: number;
  /** 推进加速度（世界单位/真实秒²） */
  thrustAccWorldPerS2: number;
  /** 本层时间倍率上限 */
  timeScaleMax?: number;
  /** 大巡游站点（实体 id，教学顺序） */
  tourStops?: string[];
  ambient?: AmbientSpec;
  gravityWells?: GravityWell[];
  /** cosmos 层单一中心井（其余层用 gravityWells） */
  gravity?: { center: Vec3; GM: number; minR: number; name: string };
  group: import('three').Group;
  entities: Entity[];
  update(dtSim: number, clock: { t: number }, probe: unknown, dtReal: number): void;
}

/** 顶层定义（顶栏面包屑） */
export interface WorldDef {
  id: LayerId;
  name: string;
  short: string;
  color: string;
}

/** 任务链上下文：main 每帧构建，missions 的 done(ctx) 谓词输入 */
export interface MissionCtx {
  layer: LayerId;
  idx: number;
  selectedId: string | null;
  selType: string | null;
  branch: string | null;
  distToSel: number;
  distToSun: number;
  rFromCenter: number;
  everLeft: boolean;
  wellId: string | null;
  wellSpeedGain: number;
  targetRadius: number;
  moonsDiscovered: number;
}

/** 主线任务定义 */
export interface Mission {
  id: string;
  title: string;
  desc: string;
  done(ctx: MissionCtx): boolean;
}
