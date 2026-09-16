import type { Entity, GravityWell, Vec3 } from '../types.js';

// ── 辅助工具 ──────────────────────────────────────────────
function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ── 输入/输出接口 ─────────────────────────────────────────

export interface AutopilotContext {
  // 探测器状态
  probePos: Vec3;
  probeVel: Vec3;
  probeForward: Vec3;
  probeSpeedWorldPerS: number;
  probeFwdSpeed: number;
  probeWells: GravityWell[];
  probeDominantWell: GravityWell | null;

  // 目标
  selected: Entity | null;
  worldEntities: Entity[];

  // 世界参数
  maxSp: number;
  acc: number;

  // 时间
  dtSim: number;
  clockRate: number;
}

export interface AutopilotResult {
  /** 期望转向方向（世界坐标），null = 不转向 */
  steerDir: Vec3 | null;
  /** 转向角速度倍率基数 */
  steerMaxTurn: number;
  /** 是否前向推力 */
  forwardThrust: boolean;
  /** 推力缩放系数 (0-1) */
  thrustScale: number;
  /** 是否执行制动 */
  brake: boolean;
  /** 飞行状态文本（HUD 展示） */
  flightStatus: string;
  /** 导航调试快照 */
  navDbg: Record<string, unknown> | null;
  /** 泊距（供巡游到站判定复用） */
  lastParkDist: number;
  /** 交会模式滞回状态 */
  rendMode: boolean;
}

// ── Autopilot ─────────────────────────────────────────────

export class Autopilot {
  /** 交会模式滞回：2.5 泊距进入、3.5 泊距退出（防边界抖动） */
  rendMode = false;

  /** 自动转向速率按模拟时间轴对齐：高倍率下转向需同步提速 */
  private autoTurn(base: number, clockRate: number): number {
    return base * Math.max(1, clockRate / 60);
  }

  /**
   * 全自动飞控决策：输入物理快照，输出推力/转向指令
   * 不直接操作 probe，由调用方执行 steer + step
   */
  update(ctx: AutopilotContext): AutopilotResult {
    const {
      probePos, probeVel, probeSpeedWorldPerS: currentSpeed, probeFwdSpeed: fwdSpeed,
      probeWells: wells, probeDominantWell,
      selected, worldEntities,
      maxSp, acc,
      dtSim, clockRate,
    } = ctx;

    let steerDir: Vec3 | null = null;
    let steerMaxTurn = 1.4;
    let forwardThrust = false;
    let thrustScale = 1.0;
    let brake = false;
    let flightStatus = '';
    let navDbg: Record<string, unknown> | null = null;
    let lastParkDist = 0;

    // 目标有效性守卫：锁定实体必须仍属于当前世界
    const validSelected = selected && worldEntities.includes(selected) ? selected : null;

    if (validSelected) {
      // ====== 自动导航模式：已锁定目标天体 ======
      const targetPos = validSelected.pos;
      const dToTarget = dist3(probePos, targetPos);
      const targetRadius = validSelected.pickRadius || 0.2;

      // 泊车物理：泊距必须落在目标自身引力占优范围内
      const ownWell = wells.find((w) => w.ref === validSelected ||
        (!w.ref && w.center && dist3(w.center, targetPos) <= targetRadius * 1.5));

      let safeParkDistance = targetRadius * 3.5;
      if (ownWell && ownWell.GM > 0) {
        let gOther = 0;
        for (const w of wells) {
          if (w === ownWell) continue;
          const c = (w.ref ? w.ref.pos : w.center)!;
          const r = dist3(targetPos, c) || 1e-6;
          gOther = Math.max(gOther, w.GM / (r * r));
        }
        const maxOrbitD = Math.sqrt(ownWell.GM / (2 * gOther));
        safeParkDistance = Math.max(targetRadius * 1.8, Math.min(safeParkDistance, maxOrbitD));
        // 引力超出推力的天体：泊位外推到 g≈0.6×推力半径
        safeParkDistance = Math.max(safeParkDistance, Math.sqrt(ownWell.GM / (acc * 0.6)));
      }
      lastParkDist = safeParkDistance;

      // 最强井（按引力加速度排序）
      let well: GravityWell | null = null;
      let wellC: Vec3 | null = null;
      let wellG = 0;
      for (const w of wells) {
        const c = (w.ref ? w.ref.pos : w.center)!;
        const r = dist3(probePos, c) || 1e-6;
        const g = w.GM / (r * r);
        if (g > wellG) { wellG = g; well = w; wellC = c; }
      }
      const inTargetWell = !!(ownWell && well === ownWell);

      // 驻点置于占优边界外侧
      const bandMid = safeParkDistance * 1.3;
      let station: Vec3 | null = null;
      if (!inTargetWell && wellC) {
        const sx = targetPos[0] - wellC[0], sy = targetPos[1] - wellC[1], sz = targetPos[2] - wellC[2];
        const sl = Math.hypot(sx, sy, sz) || 1;
        station = [
          targetPos[0] + sx / sl * bandMid,
          targetPos[1] + sy / sl * bandMid,
          targetPos[2] + sz / sl * bandMid,
        ];
      }

      // 目标本体方向单位向量
      const rlx = (targetPos[0] - probePos[0]) / dToTarget;
      const rly = (targetPos[1] - probePos[1]) / dToTarget;
      const rlz = (targetPos[2] - probePos[2]) / dToTarget;

      // 引力井安全包线（最高优先级）
      let guardPull = false;
      if (well && wellC && well.GM > 0) {
        const safeR = well.minR || 0.4;
        const gwr = dist3(probePos, wellC) || 1e-6;
        const vWell = ((probePos[0] - wellC[0]) * probeVel[0] + (probePos[1] - wellC[1]) * probeVel[1] + (probePos[2] - wellC[2]) * probeVel[2]) / gwr;
        const vIn = Math.max(0, -vWell);
        const aBrake = Math.max(acc * 0.5, acc - wellG);
        const need = vIn * vIn / (2 * aBrake);
        if (gwr - safeR < need + safeR * 0.5) {
          steerDir = [(probePos[0] - wellC[0]) / gwr, (probePos[1] - wellC[1]) / gwr, (probePos[2] - wellC[2]) / gwr];
          steerMaxTurn = this.autoTurn(2.2, clockRate);
          forwardThrust = true;
          thrustScale = 1.0;
          flightStatus = `防井坠毁 · 拉起 (${well.name})`;
          guardPull = true;
        }
      }

      if (!guardPull) {
        // 泊位/悬停区判定（滞回）
        if (station) this.rendMode = false;
        else if (!this.rendMode && dToTarget <= safeParkDistance * 2.5) this.rendMode = true;
        else if (this.rendMode && dToTarget > safeParkDistance * 3.5) this.rendMode = false;
        const inParkZone = station ? dToTarget <= safeParkDistance * 2 : this.rendMode;

        if (inParkZone) {
          if (station) {
            // 驻点悬停伴飞
            const TAU = Math.max(9, 3 * dtSim);
            const px = station[0] - probePos[0], py = station[1] - probePos[1], pz = station[2] - probePos[2];
            const pd = Math.hypot(px, py, pz) || 1e-9;
            const vAppSt = dToTarget < safeParkDistance * 1.2
              ? -maxSp * 0.2
              : Math.min(Math.sqrt(2 * acc * 0.5 * pd), maxSp * 0.5);
            let ax = (px / pd * vAppSt - probeVel[0]) / TAU;
            let ay = (py / pd * vAppSt - probeVel[1]) / TAU;
            let az = (pz / pd * vAppSt - probeVel[2]) / TAU;
            const wx = probePos[0] - wellC![0], wy = probePos[1] - wellC![1], wz = probePos[2] - wellC![2];
            const wr = Math.hypot(wx, wy, wz) || 1e-9;
            const gFeed = Math.min(well!.GM / (wr * wr), acc);
            ax += wx / wr * gFeed; ay += wy / wr * gFeed; az += wz / wr * gFeed;
            const aMag = Math.hypot(ax, ay, az);
            navDbg = { branch: 'station', rendMode: this.rendMode, d: dToTarget, vApp: vAppSt, aMag: aMag / acc, rate: clockRate };
            if (aMag > 0) {
              steerDir = [ax, ay, az];
              steerMaxTurn = this.autoTurn(2.2, clockRate);
              forwardThrust = true;
              thrustScale = Math.min(1.0, aMag / acc);
              flightStatus = vAppSt < 0 ? `伴飞防坠 · 退避 ${validSelected.name}` : `安全伴飞 · 悬停 ${validSelected.name}`;
            } else {
              steerDir = [targetPos[0] - probePos[0], targetPos[1] - probePos[1], targetPos[2] - probePos[2]];
              steerMaxTurn = this.autoTurn(1.4, clockRate);
              flightStatus = `安全伴飞 · ${validSelected.name}`;
            }
          } else {
            // 交会末段：目标参考系相对速度制导
            const vT = validSelected.vel || [0, 0, 0];
            const vCx = probeVel[0] - vT[0], vCy = probeVel[1] - vT[1], vCz = probeVel[2] - vT[2];
            let vApp = Math.min(
              Math.sqrt(2 * acc * 0.5 * Math.max(0, dToTarget - safeParkDistance)),
              maxSp * 0.8,
            );
            if (dToTarget < targetRadius * 1.3) vApp = -maxSp * 0.2;
            const gOwn = ownWell && ownWell.GM > 0 ? ownWell.GM / (dToTarget * dToTarget) : 0;
            const canHover = gOwn <= acc * 0.6;
            // 切向期望沿当前相对角动量的轨道面方向
            let hx = rly * vCz - rlz * vCy, hy = rlz * vCx - rlx * vCz, hz = rlx * vCy - rly * vCx;
            const hl = Math.hypot(hx, hy, hz);
            if (hl < 1e-12) { hx = 0; hy = 1; hz = 0; } else { hx /= hl; hy /= hl; hz /= hl; }
            let ttx = hy * rlz - hz * rly, tty = hz * rlx - hx * rlz, ttz = hx * rly - hy * rlx;
            const ttl = Math.hypot(ttx, tty, ttz) || 1;
            ttx /= ttl; tty /= ttl; ttz /= ttl;
            const vTanDes = canHover || gOwn <= 0 ? 0
              : Math.sqrt(ownWell!.GM / Math.max(dToTarget, targetRadius));
            const vTanNow = vCx * ttx + vCy * tty + vCz * ttz;
            const ff = Math.max(0, gOwn - vTanNow * vTanNow / Math.max(dToTarget, 1e-9));
            const TAU = Math.max(9, 3 * dtSim);
            const ax = (rlx * vApp + ttx * vTanDes - vCx) / TAU + rlx * ff;
            const ay = (rly * vApp + tty * vTanDes - vCy) / TAU + rly * ff;
            const az = (rlz * vApp + ttz * vTanDes - vCz) / TAU + rlz * ff;
            const aMag = Math.hypot(ax, ay, az);
            navDbg = {
              branch: 'rendezvous', rendMode: this.rendMode, d: dToTarget, park: safeParkDistance,
              vApp, vRel: Math.hypot(vCx, vCy, vCz), vRad: vCx * rlx + vCy * rly + vCz * rlz,
              vTanDes, ff, aMag: aMag / acc, rate: clockRate,
            };
            if (aMag > 0) {
              steerDir = [ax, ay, az];
              steerMaxTurn = this.autoTurn(2.2, clockRate);
              forwardThrust = true;
              thrustScale = Math.min(1.0, aMag / acc);
              flightStatus = vApp < 0 ? `伴飞防坠 · 退避 ${validSelected.name}`
                : dToTarget > safeParkDistance * 1.1 ? `交会接近 · ${validSelected.name}`
                : `安全伴飞 · ${validSelected.name}`;
            } else {
              steerDir = [targetPos[0] - probePos[0], targetPos[1] - probePos[1], targetPos[2] - probePos[2]];
              steerMaxTurn = this.autoTurn(1.4, clockRate);
              flightStatus = `安全伴飞 · ${validSelected.name}`;
            }
          }
        } else {
          // 巡航拦截：期望速度 = 目标速度矢量 + 朝目标的接近剖面
          const vAppC = Math.min(
            Math.sqrt(Math.max(0, 2 * acc * 0.5 * (dToTarget - safeParkDistance))),
            maxSp * 0.8,
          );
          const vT = validSelected.vel || [0, 0, 0];
          const TAU = Math.max(9, 3 * dtSim);
          let ax = (vT[0] + rlx * vAppC - probeVel[0]) / TAU;
          let ay = (vT[1] + rly * vAppC - probeVel[1]) / TAU;
          let az = (vT[2] + rlz * vAppC - probeVel[2]) / TAU;
          if (well && wellC && well.GM > 0 && well !== ownWell) {
            const gwr = dist3(probePos, wellC) || 1e-6;
            const gFeed = Math.min(wellG, acc);
            ax += (probePos[0] - wellC[0]) / gwr * gFeed;
            ay += (probePos[1] - wellC[1]) / gwr * gFeed;
            az += (probePos[2] - wellC[2]) / gwr * gFeed;
          }
          const aMag = Math.hypot(ax, ay, az);
          navDbg = {
            branch: 'cruise', rendMode: this.rendMode, d: dToTarget, park: safeParkDistance,
            vDes: vAppC, aMag: aMag / acc, rate: clockRate,
          };
          if (aMag > 0) {
            steerDir = [ax, ay, az];
            steerMaxTurn = this.autoTurn(2.2, clockRate);
            forwardThrust = true;
            thrustScale = Math.min(1.0, aMag / acc);
          }
          flightStatus = `自动导向 · ${validSelected.name}`;
        }
      }
    } else {
      // ====== 自由全自动航行 ======
      if (probeDominantWell && probeDominantWell.GM > 0) {
        const well = probeDominantWell;
        const c = (well.ref ? well.ref.pos : well.center)!;
        const dx = probePos[0] - c[0], dy = probePos[1] - c[1], dz = probePos[2] - c[2];
        const r = Math.hypot(dx, dy, dz) || 1;
        const vCirc = Math.sqrt(well.GM / r);
        const radialSpeed = (probeVel[0] * dx + probeVel[1] * dy + probeVel[2] * dz) / r;

        if (currentSpeed < 0.02 * maxSp && Math.abs(radialSpeed) < 0.02 * maxSp) {
          flightStatus = `全自动接管 · 空间停泊 (${well.name}引力井)`;
        } else if (currentSpeed > vCirc * 1.6) {
          flightStatus = `全自动航行 · 引力滑行 (${well.name})`;
        } else if (currentSpeed < vCirc * 0.7 && radialSpeed < 0) {
          forwardThrust = true;
          thrustScale = Math.min(0.6, (vCirc - currentSpeed) / (maxSp * 0.2) + 0.1);
          flightStatus = `全自动航行 · 轨道保持 (${well.name})`;
        } else {
          flightStatus = `全自动航行 · 轨道巡航 (${well.name})`;
        }
      } else if (currentSpeed < 0.02 * maxSp) {
        flightStatus = '全自动接管 · 空间停泊';
      } else {
        const cruiseSpeed = maxSp * 0.35;
        if (fwdSpeed < cruiseSpeed * 0.6) {
          forwardThrust = true;
          thrustScale = Math.min(1.0, Math.max(0.15, (cruiseSpeed - fwdSpeed) / (maxSp * 0.25)),
            Math.max(0, cruiseSpeed - fwdSpeed) / (acc * Math.max(dtSim, 1e-9)));
          flightStatus = '全自动航行 · 巡航推进 (保持航向)';
        } else {
          flightStatus = '全自动航行 · 惯性巡航 (保持航向)';
        }
      }
    }

    return {
      steerDir,
      steerMaxTurn,
      forwardThrust,
      thrustScale,
      brake,
      flightStatus,
      navDbg,
      lastParkDist,
      rendMode: this.rendMode,
    };
  }
}
