// 文本 Sprite 标签：名称标注（跟随对象，面向相机）
import * as THREE from 'three';

const _canvas = document.createElement('canvas');
const _ctx = _canvas.getContext('2d');

const LABEL_BG = 'rgba(6,12,22,0.78)'; // 深底框保证在亮星光晕上仍可读
const LABEL_BORDER = 'rgba(140,170,220,0.35)';
const LABEL_FONT = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

export function makeTextSprite(text, { color = '#dbe7ff', size = 160, sub = '', priority = 0 } = {}) {
  const pad = 10;
  _ctx.font = '600 13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  let w = _ctx.measureText(text).width;
  if (sub) w = Math.max(w, _ctx.measureText(sub).width);
  const width = Math.ceil(w) + pad * 2;
  const lineH = sub ? 30 : 20;
  const height = lineH + (sub ? 8 : 6);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, width * 2); // *2 抗锯齿
  canvas.height = Math.max(8, height * 2);
  const c = canvas.getContext('2d');
  c.scale(2, 2);
  // 背景胶囊
  const r = height / 2;
  c.beginPath();
  c.roundRect(0, 0, width, height, r);
  c.fillStyle = LABEL_BG;
  c.fill();
  c.strokeStyle = LABEL_BORDER;
  c.lineWidth = 1;
  c.stroke();
  // 文字
  c.fillStyle = color;
  c.font = '600 13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, width / 2, sub ? 12 : height / 2 + 1);
  if (sub) {
    c.fillStyle = 'rgba(200,215,240,0.75)';
    c.font = '10px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    c.fillText(sub, width / 2, 25);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  // 世界尺寸由用户设置 sprite.scale（约 size*aspect）
  sprite.userData.isLabel = true;
  sprite.userData.priority = priority;
  return sprite;
}

// 文字尺寸换算：给出文字世界高度，返回 [宽, 高]
export function labelScaleFor(sprite, worldHeight) {
  const tex = sprite.material.map;
  if (!tex) return [worldHeight * 3, worldHeight];
  const aspect = tex.image.width / tex.image.height;
  return [worldHeight * aspect, worldHeight];
}

// 标签距离淡出 + 屏幕空间避让：每帧按「标签到相机距离」调整透明度，
// 并做贪心矩形避让——近处标签优先占位，与之重叠的远处标签隐藏。
// fadeDist 内保持全亮，超出后线性衰减到 floor（教育场景保留 0.35 可辨认性）。
const _v = new THREE.Vector3();
export function updateLabelFades(group, camera, fadeDist, floor = 0.35) {
  const H = window.innerHeight || 800;
  const W = window.innerWidth || 1200;
  const focal = H / (2 * Math.tan(((camera.fov || 60) * Math.PI) / 360));
  const items = [];
  group.traverse((o) => {
    if (!o.userData || !o.userData.isLabel) return;
    o.getWorldPosition(_v);
    const d = _v.distanceTo(camera.position);
    const t = d / Math.max(fadeDist, 1e-6);
    const op = Math.max(floor, Math.min(1, 1.25 - t));
    if (op <= 0.02) { o.visible = false; return; }
    const p = _v.clone().project(camera);
    if (p.z > 1) { o.visible = false; return; } // 在相机身后
    const cx = (p.x * 0.5 + 0.5) * W;
    const cy = (-p.y * 0.5 + 0.5) * H;
    const ph = Math.max(10, (o.scale.y / Math.max(d, 1e-6)) * focal); // 屏幕像素高
    const pw = ph * (o.scale.x / Math.max(o.scale.y, 1e-6));
    items.push({ o, d, op, rect: [cx - pw / 2, cy - ph / 2 - 6, cx + pw / 2, cy + ph / 2 + 6] });
  });
  // 重要级高的标签优先占位，同级近者优先
  items.sort((a, b) =>
    (b.o.userData.priority || 0) - (a.o.userData.priority || 0) || a.d - b.d);
  const taken = [];
  for (const it of items) {
    const clash = taken.some((r) =>
      it.rect[0] < r[2] && it.rect[2] > r[0] && it.rect[1] < r[3] && it.rect[3] > r[1]);
    if (clash) { it.o.visible = false; continue; }
    taken.push(it.rect);
    it.o.material.opacity = it.op;
    it.o.visible = true;
  }
}
