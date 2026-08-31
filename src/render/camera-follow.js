// 渲染域：镜头跟拍子系统
// 目录梳理阶段 3：从 createCosmosRenderer 巨型闭包提取。
// 工厂 createCameraFollow(state, controls, camera, sim) 封装：
//   - 大尺度瞬移检测（虫洞跃迁/重生把小球瞬移远方时，把相机和视点整体平移）
//   - 智能镜头第一阶段（t<2.3s：留在奇点附近看大爆炸）
//   - 轨迹优先的连续上帝视角（方位角/俯角恒定 + 极慢漂移 + 距离限幅）
//   - 速度感 FOV（跟拍时随速度放大视野）
// update(pos, pr, alpha, dtReal, beat) 每帧调用；state.follow=false 时直接 return。
import * as THREE from 'three';
import { smoothstep } from '../core/utils.js';

const CAM_PITCH = 0.60;          // 固定俯角 ≈34°，略抬高让轨迹走向更清晰
const CAM_CRUISE_DIST = 55;      // 自由航行时的基准距离（更远，展现宇宙宏大与轨迹全貌）
// 距离绝对上限：星系直径 130+，绕行半径 ~60 时需要 ~150 才能框住轨迹，
// 上限必须覆盖"绕行大系统"的场景（防异常失真把镜头甩飞）
const CAM_MAX_DIST = 320;
const CAM_DIST_RATE = 0.10;      // 距离最大相对变化率 /s，消除"呼吸"（收紧自 0.35）
// 极缓慢的镜头漂移（观赏性）：方位角恒定会让画面像张静止的照片，
// 叠加一个幅度极小、周期很长的正弦，让画面"活着"但不干扰观察。
// 幅度 1.7° / 周期约 5 分钟，远小于跟随速度方向造成的旋转，不会晕。
const CAM_DRIFT_AZ = 0.030;      // 方位角漂移幅度（弧度，≈1.7°）
const CAM_DRIFT_AZ_W = 0.021;    // 方位角漂移角频率（周期 ≈300s）
const CAM_DRIFT_EL = 0.012;      // 俯角漂移幅度（弧度，≈0.7°）
const CAM_DRIFT_EL_W = 0.013;    // 俯角漂移角频率（周期 ≈480s）

export function createCameraFollow(state, controls, camera, sim) {
  // 复用缓存向量（每帧用完即弃，避免 GC）
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();

  // 距 100 单位的瞬移阈值（一次性跨过这个距离才视为虫洞/重生）
  const TELEPORT_THRESHOLD_SQ = 100 * 100;

  function update(pos, pr, alpha, dtReal, beat, trail) {
    const px = pos[0], py = pos[1], pz = pos[2];

    {
      const jx = px - state._lastProbePos.x;
      const jy = py - state._lastProbePos.y;
      const jz = pz - state._lastProbePos.z;
      if (jx * jx + jy * jy + jz * jz > 100 * 100) {
        if (state.follow && state._focusInit) {
          controls.target.x += jx;
          controls.target.y += jy;
          controls.target.z += jz;
          state.orbitCenter.x += jx;
          state.orbitCenter.y += jy;
          state.orbitCenter.z += jz;
          trail.clearTrail();
        }
      }
      state._lastProbePos.set(px, py, pz);
    }
    if (!state.follow) return;

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
        // ---- 轨迹优先的连续上帝视角（唯一自动镜头）----
        // 用户要求（按优先级）：
        //  ① 重点是看航行轨迹，不是看小球——自由飞行时也要把最近一段轨迹
        //    框进画面，而不是把视角锁死在小球周围那一小块；
        //  ② 镜头不得因小球/天体的运动产生旋转、翻转、突然位移：
        //     方位角/俯角恒定（仅极缓慢漂移）、无滚转、距离与视点全部
        //     连续变化且带速率限幅；
        //  ③ 没有模式机、没有滞回锁存——所有量都是连续函数，
        //     结构上不存在"切换瞬跳"这种事（旧实现的 cruise/interact/detail
        //     三模式与 orbitLock 锁存已全部移除）。
        const pv = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);

        // ==============================================================
        // 连续上帝视角的实现要点（历史教训都踩过）：
        //   ① 方位角是恒定标量（+极缓慢正弦漂移），任何速度方向绑定都会
        //      绕圈/翻面，绝对禁止；
        //   ② 视点/距离全部由连续函数给出，速率限幅，没有模式切换；
        //   ③ 相机位置永远 = 视点 + 球坐标偏移，距离恒等于 dist，
        //      结构上不可能贴脸、不可能翻转，up 恒为 +Y 无滚转；
        //   ④ 轨道尺度用真实天体距离，视点基准用平滑中心（见下）。
        // ==============================================================
        // --- 绕行天体（轨道中心）与轨道尺度 ---
        // 注意区分两个用途：
        //   · 轨道尺度（seedDist / sysR）必须用**真实天体距离**——用平滑中心算会在
        //     主导天体切换期间失真成"两天体间距"，把镜头拉到 100+（实测 107）。
        //   · 视点基准才用**平滑后的中心**，避免 influencer 切换那一帧视点瞬移
        //     （瞬移会让 lookAt 方向剧变，实测正是 500+°/s 甩镜的来源）。
        let sdX = px, sdY = py, sdZ = pz, seedDist = 0, sysR = 0;
        if (pr.influencer >= 0) {
          const s = sim.seeds[pr.influencer];
          sdX = s.pos[0]; sdY = s.pos[1]; sdZ = s.pos[2];
          seedDist = Math.hypot(px - sdX, py - sdY, pz - sdZ);
          sysR = sim._systemRadius(s);
        }
        _v4.set(sdX, sdY, sdZ);
        if (!state._focusInit) {
          state.orbitCenter.copy(_v4);
          state._focusInit = true;
        } else {
          // 限速逼近：速度与镜头距离成比例 → 朝向角速度有界
          const maxSpeed = Math.max(6, state.camDist * 0.5) * dtReal;
          const ddx = _v4.x - state.orbitCenter.x;
          const ddy = _v4.y - state.orbitCenter.y;
          const ddz = _v4.z - state.orbitCenter.z;
          const ddl = Math.hypot(ddx, ddy, ddz);
          if (ddl > 1e-6) {
            const kk = Math.min(1, maxSpeed / ddl);
            state.orbitCenter.x += ddx * kk;
            state.orbitCenter.y += ddy * kk;
            state.orbitCenter.z += ddz * kk;
          }
        }
        const cX = state.orbitCenter.x;
        const cY = state.orbitCenter.y;
        const cZ = state.orbitCenter.z;

        // ---- 连续上下文权重 w（取代旧的 orbitLock 滞回锁存）----
        // 三个信号与旧实现相同：
        //   ① orbitTangent（切向速度占比）：圆轨道 ≈1，对慢速大圈同样灵敏；
        //   ② orbitAngleAcc：对快速小圈灵敏；
        //   ③ 距离窗口（1.8R~3.6R）：只有贴近该系统才算，远处直线飞行不误判。
        // 不再做"去噪→阈值→锁存"的三级处理——那是二值状态机的必然复杂度，
        // 连续量用双时间常数平滑即可：进入 2.5s、退出 6s（时间常数本身就
        // 承担了去噪，比旧的 0.8s 噪声窗慢得多）。滞回锁存想解决的
        // "半跟随中间态"问题是锁存特有的病，连续量天然不存在。
        const nearFactor = sysR > 0 ? 1 - smoothstep(sysR * 1.8, sysR * 3.6, seedDist) : 0;
        const tangentFactor = smoothstep(0.35, 0.70, pr.orbitTangent || 0);
        const angleFactor = smoothstep(0.25, 1.20, pr.orbitAngleAcc || 0);
        const orbitRaw = pr.influencer >= 0 ? Math.max(tangentFactor, angleFactor) * nearFactor : 0;
        const orbitTau = orbitRaw > state.orbitFactor ? 2.5 : 6.0;
        state.orbitFactor += (orbitRaw - state.orbitFactor) * Math.min(1, dtReal / orbitTau);
        const w = state.orbitFactor;

        // --- 方位角：恒定，永不跟随小球旋转 ---
        // 这是用户明确要求：**任何时候都不跟随小球旋转**。
        // 若让方位角追速度方向，镜头会一直待在小球正后方，画面里小球永远
        // "朝前飞"，观感上就成了直线运行，反而看不出它在转弯、被引力拉偏。
        // 方位角固定后，小球转向时是背景星空与天体在画面里滑动，
        // 轨迹的弯曲、绕圈的走向都一目了然。
        // （camAzimuth 因此只在初始化时定一次，之后不再改动）
        const tsBoost = Math.max(0.3, Math.sqrt(state.timeScale));

        // --- 平滑速度向量（视点前向偏置用）---
        // 直接用瞬时速度会让视点跟着小球的每一次引力抖动晃；
        // 用 ~1.6s 时间常数的指数平滑，急转弯时视点也只是缓慢地往前挪。
        if (pv > 0.02) {
          _v1.set(pr.vel[0], pr.vel[1], pr.vel[2]);
          state.velSmooth.lerp(_v1, Math.min(1, dtReal / 1.6));
        } else {
          state.velSmooth.multiplyScalar(Math.max(0, 1 - dtReal / 1.2));
        }
        const vsLen = state.velSmooth.length();

        // ---- 视点：小球 → 系统中心的连续加权 + 前向偏置 ----
        // 直线飞行时 w≈0 → 视点在小球后方；绕行时 w→1 → 视点几乎钉在轨道中心，
        // 镜头不动，整条轨迹圆留在画面里。用的是**平滑后的中心** cX/cY/cZ。
        // 前向偏置：沿平滑速度方向前移 1.25s 的行程（上限 32% 距离）——
        // 小球被推到画面后侧，轨迹在身前铺开（重点看轨迹与宇宙，不盯小球）。
        const orbitPull = w * 0.9;
        let fX = px + (cX - px) * orbitPull;
        let fY = py + (cY - py) * orbitPull;
        let fZ = pz + (cZ - pz) * orbitPull;
        const biasCap = state.camDist * 0.32;
        const biasK = vsLen > 1e-4 ? Math.min(1, biasCap / (vsLen * 1.25)) : 0;
        fX += state.velSmooth.x * 1.25 * biasK;
        fY += state.velSmooth.y * 1.25 * biasK;
        fZ += state.velSmooth.z * 1.25 * biasK;

        // ---- 距离：三层取最大，全部连续 ----
        const fovRad = (camera.fov * Math.PI) / 180;
        // ① 滑杆基准距离
        const zoomBase = Math.max(6, sim.config.camZoom || CAM_CRUISE_DIST);
        let wantDist = zoomBase;
        // ② 绕行时按轨道半径拉远（×2.4 覆盖直径并留边距），随 w 连续混合
        if (seedDist > 0) {
          const orbitDist = seedDist * 2.4 + sysR * 0.8;
          wantDist = Math.max(zoomBase, orbitDist * w + zoomBase * (1 - w));
        }
        // ③ 轨迹感知框距：让最近一段轨迹始终完整入画。
        //    （trail 提取后 trailCount/trailPos 已封装到 render/trail.js；
        //     后续需要时由 trail 子系统提供 getBounds() 替代此内联计算。）
        // 绝对上限：主导天体切换等异常时刻 seedDist 可能瞬时失真，
        // 不封顶会把镜头拉到 100+，位置剧变 → 朝向剧变
        wantDist = Math.min(wantDist, CAM_MAX_DIST);
        // 速率限幅：距离每秒相对变化不超过 CAM_DIST_RATE，消除"呼吸"
        const maxDDelta = Math.max(state.camDist, 1) * CAM_DIST_RATE * dtReal;
        state.camDist += Math.max(-maxDDelta, Math.min(maxDDelta, wantDist - state.camDist));

        // 全局方位角：初始化后恒定不变（不跟随小球旋转，见上文）
        // 方位角 = 恒定基准 + 极缓慢漂移（漂移只影响显示，与物理无关）
        const az = state.camAzimuth + CAM_DRIFT_AZ * Math.sin(state.time * CAM_DRIFT_AZ_W);
        const pitch = CAM_PITCH + CAM_DRIFT_EL * Math.sin(state.time * CAM_DRIFT_EL_W);

        // ---- 相机位置：统一球坐标 (方位角, 俯角, 距离)，无除法无分支 ----
        // 相机挂在视点上，与视点距离恒为 dist：结构上不可能贴脸、不可能翻转；
        // 方位角与俯角恒定，距离变化只改变远近不改变朝向。
        const dist = state.camDist;
        const horizM = dist * Math.cos(pitch);

        // ---- 视点 = f + 屏幕空间平移偏移 ----
        // 平移沿相机右方向 / 上方向，小球随之偏离画面中心。两重保护确保
        // 高速运动时不丢失小球：
        //   ① 偏移上限与距离成比例（≤35% dist），物理上推不出画面；
        //   ② 速率 >25 后按速率线性收回，>65 时完全回到跟踪中心。
        const recover = 1 - Math.min(1, Math.max(0, (pv - 25) / 40));
        const panLim = dist * 0.35;
        const panX = Math.max(-panLim, Math.min(panLim, (sim.config.camPanX || 0) * recover));
        const panY = Math.max(-panLim, Math.min(panLim, (sim.config.camPanY || 0) * recover));
        // 暴露实际生效的平移量（含钳制与高速收回），便于验证与调试
        state.camPanApplied[0] = panX;
        state.camPanApplied[1] = panY;
        // right = (-cos az, 0, sin az) ；up = right × forward
        const rx = -Math.cos(az);
        const rz = Math.sin(az);
        const ux = Math.sin(az) * Math.sin(pitch);
        const uy = Math.cos(pitch);
        const uz = Math.cos(az) * Math.sin(pitch);
        _v3.set(
          fX + rx * panX + ux * panY,
          fY + uy * panY,
          fZ + rz * panX + uz * panY,
        );

        // 先平滑视点，再由"视点 + 球坐标偏移"推出相机位置。
        // 关键：不能让相机位置与视点各自独立 lerp —— 视点快速移动时（主导天体
        // 切换、小球急转）相机追不上，两者会挤到一起（实测 camDist 缩到 4.1），
        // 此时极小的位移就能让 lookAt 方向爆炸（实测 1036°/s）。
        // 相机挂在视点上后，两者距离恒为 dist，结构上不可能贴脸。
        const tgtK = Math.min(0.12, dtReal * (3.2 + pv * 0.10) * tsBoost);
        controls.target.lerp(_v3, tgtK);
        // 相机位置直接由"视点 + 球面偏移"给出，不再对位置做 lerp：
        // 位置 lerp 会滞后（视点移动越快滞后越大），实测距离一度失控到 139
        // （而距离上限是 90），距离失控时 lookAt 对微小位移极度敏感。
        // 这里距离恒等于 dist，视点/方位角/距离三者本身都已平滑，运动仍然连续。
        camera.position.set(
          controls.target.x - Math.sin(az) * horizM,
          controls.target.y + dist * Math.sin(pitch),
          controls.target.z - Math.cos(az) * horizM,
        );
        camera.lookAt(controls.target);
      }

      const pvFov = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      const targetFov = 58 + Math.min(16, pvFov * 0.5) + beat * 1.5;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dtReal * 3.0);
      camera.updateProjectionMatrix();
  }

  return { update };
}
