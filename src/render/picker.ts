import * as THREE from 'three';
import type { Entity, Vec3 } from '../types.js';

export class ObjectPicker {
  hoveredId: string | null = null;
  private _ndc = new THREE.Vector3();

  /** 射线与球体相交距离计算 */
  private rayDist(o: Vec3, dir: Vec3, c: Vec3, r: number): number {
    const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
    const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t = -b - sq;
    return t >= 0 ? t : -b + sq >= 0 ? -b + sq : -1;
  }

  /** 屏幕 NDC 坐标转世界空间射线 */
  cameraRay(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number): { o: Vec3; d: Vec3 } {
    this._ndc.set(ndcX, ndcY, 0.5).unproject(camera);
    const o = camera.position;
    const dx = this._ndc.x - o.x, dy = this._ndc.y - o.y, dz = this._ndc.z - o.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { o: [o.x, o.y, o.z], d: [dx / l, dy / l, dz / l] };
  }

  /** 计算拾取最大距离 */
  pickMaxDist(camera: THREE.PerspectiveCamera, probePos: Vec3, followDist: number): number {
    const cp = camera.position;
    const dCam = Math.hypot(cp.x - probePos[0], cp.y - probePos[1], cp.z - probePos[2]);
    return Math.max(dCam + followDist * 4, 1000);
  }

  /** 在实体列表中做射线拾取 */
  pick(rayOrigin: Vec3, rayDir: Vec3, entities: Entity[], maxDist: number): Entity | null {
    let best = null;
    let bestD = maxDist;
    for (const e of entities) {
      if (!e.pickRadius || e.selectable === false) continue;
      // 真实尺度点选：远处天体角直径过小，按 ~0.5° 视角下限放大可点选半径
      //（泊车/碰撞/引力仍用实体真实半径，仅拾取口径放大）
      const dCam = Math.hypot(e.pos[0] - rayOrigin[0], e.pos[1] - rayOrigin[1], e.pos[2] - rayOrigin[2]);
      const rEff = Math.max(e.pickRadius, dCam * 0.0087);
      const d = this.rayDist(rayOrigin, rayDir, e.pos, rEff);
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** 更新准星悬停状态（用屏幕中心射线） */
  updateHover(camera: THREE.PerspectiveCamera, entities: Entity[], probePos: Vec3, followDist: number): void {
    const { o, d } = this.cameraRay(camera, 0, 0);
    const hit = this.pick(o, d, entities, this.pickMaxDist(camera, probePos, followDist));
    this.hoveredId = hit ? hit.id : null;
  }
}
