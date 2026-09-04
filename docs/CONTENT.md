# 内容数据 · 来源与示意清单

原则：**不编造数据**。真实数值进 `src/content/data/`；为可读性做的视觉放大
一律标 `schematic`，并在信息卡中说明。

## 数据文件与来源

| 文件 | 内容 | 来源 |
|---|---|---|
| `data/solar.js` | 太阳参数、八大行星（半长轴/半径/公转周期/自转/质量/卫星数）、主要卫星、小行星带与柯伊伯带范围 | IAU/NASA 常用标准值（`SOURCE_NOTE`） |
| `data/stars.js` | ≤25 ly 近邻恒星目录：RA/Dec(J2000)、距离、光谱型、色温、质量、视星等 | Yale Bright Star Catalog / Hipparcos / SIMBAD 标准值 |
| `data/local-group.js` | 本星系群成员：距银河距离(Mpc)、RA/Dec 方向、盘径(kpc) | Wikipedia "Local Group" / NASA / NED；多数距离来自 Karachentsev et al. 2002/2013 |
| `data/super-structures.js` | 室女团、天炉团、后发团、长蛇团等星系团：距离(Mpc)、RA/Dec | Wikipedia / NASA / NED 标准公开数据 |
| `data/cosmos.js` | CMB 信息卡数据、可观测宇宙半径（46.5 Gly ≈ 14.2 Gpc） | Planck/NASA 标准值 |

坐标换算：RA/Dec + 距离 → 笛卡尔（`raDecDistToXYZ` / `direction3d`），
银河系为本星系群坐标原点；太阳为恒星坐标原点。

## 示意（schematic）清单

| 位置 | 示意内容 | 真实约束 |
|---|---|---|
| solar 行星球体尺寸 | 对数教学缩放（真实半径 ~1e-5 AU 不可见） | 大小顺序、轨道半径、周期严格真实 |
| solar 标签朝向 | 卫星随机方位摆放 | 卫星轨道半径真实 |
| galaxy 层星系形态 | 程序化棒旋点云（seed 固定） | 半径 15 kpc、太阳位于 0.55 盘半径（≈8.2 kpc）、棒旋结构按真实形态 |
| local 层星系盘可视半径 | 放大到 0.055–0.075 Mpc（真实 ~0.02 Mpc 不可见） | 距离、方位真实；M31>银河>M33 大小关系真实 |
| super 层宇宙网丝 | 节点间连丝为示意拓扑 | 节点（星系团）方位、距离真实 |
| cosmos 层宇宙网与 CMB 壳 | 网状拓扑示意、红移色示意 | 可观测半径 14.2 Gpc；CMB=边界的物理含义 |

## 待核实（不阻塞教学展示）

- 行星信息卡部分描述文字为通用天文常识，未逐项复核数值来源。
- 恒星 `desc` 中"约 X 亿年"年龄类数据精度为量级级。
- 深空目标（M87 等）黑洞影像年份等事实性描述来源为 EHT 公开新闻稿。
