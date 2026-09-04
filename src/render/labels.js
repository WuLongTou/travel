// 文本 Sprite 标签：名称标注（跟随对象，面向相机）
import * as THREE from 'three';

const _canvas = document.createElement('canvas');
const _ctx = _canvas.getContext('2d');

const LABEL_BG = 'rgba(6,12,22,0.55)';
const LABEL_BORDER = 'rgba(140,170,220,0.35)';
const LABEL_FONT = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

export function makeTextSprite(text, { color = '#dbe7ff', size = 160, sub = '' } = {}) {
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
  return sprite;
}

// 文字尺寸换算：给出文字世界高度，返回 [宽, 高]
export function labelScaleFor(sprite, worldHeight) {
  const tex = sprite.material.map;
  if (!tex) return [worldHeight * 3, worldHeight];
  const aspect = tex.image.width / tex.image.height;
  return [worldHeight * aspect, worldHeight];
}
