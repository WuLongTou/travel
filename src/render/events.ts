// 深空环境事件（纯视觉氛围，零物理、零玩法影响）：
//   - 流星雨：以相机为中心的球壳上随机生成加色光痕，快速划过并淡出，
//     尺度随跟拍距离缩放（任意层一致）
//   - 彗星群：数颗带离子尾的彗星沿双曲线轨迹掠过内太阳系（仅太阳系层）
// 调度：随机间隔自动触发；暴露 debugSpawn 供无头验证。
import * as THREE from 'three';

const METEOR_POOL = 26;

interface Meteor {
  line: THREE.Line;
  life: number;
  ttl: number;
  vel: THREE.Vector3;
}
interface Comet {
  core: THREE.Sprite;
  tail: THREE.Line;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export class SpaceEvents {
  private toast: (text: string) => void;
  group = new THREE.Group();
  private meteors: Meteor[] = [];
  private comets: Comet[] = [];
  private showerT: number;
  private cometT: number;

  constructor(scene: THREE.Scene, toast: (text: string) => void = () => {}) {
    this.toast = toast;
    this.group.frustumCulled = false;
    scene.add(this.group);

    // 流星池：预分配线段（头亮尾淡），生命期随机
    for (let i = 0; i < METEOR_POOL; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineBasicMaterial({
        color: 0xcfe0ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.meteors.push({ line, life: 0, ttl: 1, vel: new THREE.Vector3() });
    }
    // 彗星池：辉光核 + 渐隐离子尾线
    this.showerT = 16 + Math.random() * 28;   // 首场流星雨 16-44 秒
    this.cometT = 70 + Math.random() * 100;   // 首次彗星群 70-170 秒
  }

  // 流星雨：一波激活大半流星池（相机球壳随机方位，尺度随跟拍距离）
  triggerMeteorShower(camPos: THREE.Vector3, scale: number): void {
    let spawned = 0;
    for (const m of this.meteors) {
      if (m.life > 0) continue;
      const z = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      const r = scale * (0.6 + Math.random() * 1.2);
      const pos = new THREE.Vector3(
        camPos.x + Math.cos(phi) * rr * r,
        camPos.y + z * r,
        camPos.z + Math.sin(phi) * rr * r,
      );
      // 速度：随机切向 + 轻微向心，划过相机视野
      const tang = new THREE.Vector3(-rr * Math.sin(phi), z * 0.4, rr * Math.cos(phi)).normalize();
      m.vel.copy(tang).multiplyScalar(scale * (0.35 + Math.random() * 0.5));
      m.ttl = 0.9 + Math.random() * 1.6;
      m.life = m.ttl;
      m.line.geometry.setFromPoints([pos, pos.clone().addScaledVector(m.vel, 0.12)]);
      (m.line.material as THREE.LineBasicMaterial).opacity = 0;
      m.line.visible = true;
      if (++spawned >= 18) break;
    }
  }

  // 彗星群：3 颗小彗星沿擦边双曲线掠过内太阳系
  triggerCometSwarm(): void {
    for (let i = 0; i < 3; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r0 = 4 + Math.random() * 3;
      const core = makeGlowCore(0.06);
      const tailGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const tailMat = new THREE.LineBasicMaterial({
        color: 0x9fd8ff, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const tail = new THREE.Line(tailGeo, tailMat);
      tail.frustumCulled = false;
      const c = {
        core, tail,
        pos: new THREE.Vector3(Math.cos(ang) * r0, (Math.random() - 0.5) * 0.6, Math.sin(ang) * r0),
        // 速度：大致切向掠过（近日距 ~0.3-1 AU），电影化速度 0.02-0.04 AU/s
        vel: new THREE.Vector3(-Math.sin(ang), (Math.random() - 0.5) * 0.15, Math.cos(ang))
          .normalize().multiplyScalar(0.02 + Math.random() * 0.02),
        life: 260,
      };
      core.position.copy(c.pos);
      this.group.add(core, tail);
      this.comets.push(c);
    }
  }

  // 每帧驱动：camPos 相机位置、scale 环境事件尺度（≈跟拍距离×12）、solar 是否太阳系层
  update(dt: number, camPos: THREE.Vector3, scale: number, solar: boolean): void {
    // 流星调度与演化
    this.showerT -= dt;
    if (this.showerT <= 0) {
      this.showerT = 45 + Math.random() * 45;
      this.triggerMeteorShower(camPos, scale);
    }
    for (const m of this.meteors) {
      if (m.life <= 0) continue;
      m.life -= dt;
      m.line.position.addScaledVector(m.vel, dt);
      (m.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, Math.min(0.85, (m.life / m.ttl) * 1.4));
      if (m.life <= 0) m.line.visible = false;
    }
    // 彗星：仅太阳系层调度与演化
    if (solar) {
      this.cometT -= dt;
      if (this.cometT <= 0) {
        this.cometT = 240 + Math.random() * 240;
        this.triggerCometSwarm();
        this.toast('☄️ 彗星群正在掠过内太阳系');
      }
    }
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.life -= dt;
      c.pos.addScaledVector(c.vel, dt);
      c.core.position.copy(c.pos);
      const r = c.pos.length();
      // 尾巴背向太阳（离子尾物理直觉）
      const back = c.pos.clone().normalize().multiplyScalar(0.18);
      c.tail.geometry.setFromPoints([c.pos.clone(), c.pos.clone().add(back)]);
      (c.tail.material as THREE.LineBasicMaterial).opacity = Math.max(0, Math.min(0.7, (r - 0.25) * 1.2));
      (c.core.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(0.9, (r - 0.2) * 1.5));
      if (c.life <= 0 || r > 12) {
        this.group.remove(c.core, c.tail);
        (c.core.material as THREE.SpriteMaterial).dispose();
        c.tail.geometry.dispose();
        (c.tail.material as THREE.LineBasicMaterial).dispose();
        this.comets.splice(i, 1);
      }
    }
  }
}

// 彗星辉光核（独立的柔和光点）
function makeGlowCore(size: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(200,230,255,0.7)');
  grad.addColorStop(1, 'rgba(160,210,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}
