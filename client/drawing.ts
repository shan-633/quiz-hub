import type { DrawingPage } from '../shared/model';
export function drawPage(canvas: HTMLCanvasElement, page: DrawingPage, grid = true) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(canvas.width / page.width, 0, 0, canvas.height / page.height, 0, 0);
  ctx.clearRect(0, 0, page.width, page.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width, page.height);
  if (grid) {
    ctx.strokeStyle = '#eaf0ec';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let x = 0; x < page.width; x += 28) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, page.height);
    }
    for (let y = 0; y < page.height; y += 28) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of page.strokes) {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1],
        b = stroke.points[i];
      ctx.lineWidth = stroke.width * (0.45 + 0.55 * b.p);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}
export async function drawingBlob(page: DrawingPage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1500;
  canvas.height = Math.round((1500 * page.height) / page.width);
  drawPage(canvas, page, false);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('手写预览生成失败'))),
      'image/png',
    ),
  );
}
