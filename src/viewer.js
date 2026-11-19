import { identity, matrixToQuaternion, multiplyQuaternion, multiplyVector, normalizeQuaternion, quaternionToMatrix } from './math.js';

export const DEFAULT_PALETTE = {
  axes: ['#ff7c82', '#66d9a4', '#71b5ff'], grid: '#263c46', gridMajor: '#426069', link: '#94adb6',
  halo: '#11242d', labelBackground: '#10232ded',
  Robot: { point: '#89ebce', border: '#426b60', text: '#a3f1d9' },
  Camera: { point: '#ffcb80', border: '#6c5a3e', text: '#ffcf91' },
};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const length = Math.hypot(...v); return v.map((x) => x / length); };

export function sceneFrames(scene) {
  return [
    { name: scene.source, ...identity(), fixed: true },
    { name: scene.target, ...scene.pose, fixed: false },
  ];
}

function initialOrientation() {
  const back = unit([5, -7, 5]);
  const right = unit(cross([0, 0, 1], back));
  return matrixToQuaternion([right, cross(back, right), back]);
}

function rotationBetween(a, b) {
  const dot = a.reduce((sum, x, index) => sum + x * b[index], 0);
  if (dot < -0.999999) return [...unit(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), 0];
  return normalizeQuaternion([...cross(a, b), 1 + dot]);
}

export class FrameViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('当前浏览器无法创建 Canvas 画布。');
    this.orientation = initialOrientation();
    this.zoom = 1;
    this.pan = [0, 0];
    this.pointers = new Map();
    this.width = 1;
    this.height = 1;
    this.scene = null;
    this.palette = DEFAULT_PALETTE;
    this.installControls();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width);
    this.height = Math.max(1, bounds.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.requestRender();
  }

  setScene(scene) {
    if (this.scene === scene) return;
    this.scene = scene;
    this.requestRender();
  }

  setPalette(palette) {
    this.palette = { ...DEFAULT_PALETTE, ...palette };
    this.requestRender();
  }

  fit() {
    this.zoom = 1;
    this.pan = [0, 0];
    this.requestRender();
  }

  reset() {
    this.orientation = initialOrientation();
    this.fit();
  }

  setView(view) {
    const rotations = {
      top: [0, 0, 0, 1],
      front: matrixToQuaternion([[1, 0, 0], [0, 0, 1], [0, -1, 0]]),
      side: matrixToQuaternion([[0, 1, 0], [0, 0, 1], [1, 0, 0]]),
    };
    this.orientation = rotations[view] || initialOrientation();
    this.fit();
  }

  spherePoint(point) {
    const radius = Math.min(this.width, this.height) * 0.43;
    const x = (point[0] - this.width / 2) / radius;
    const y = -(point[1] - this.height / 2) / radius;
    const squared = x * x + y * y;
    return squared <= 1 ? [x, y, Math.sqrt(1 - squared)] : unit([x, y, 0]);
  }

  beginGesture(pan = false) {
    const points = [...this.pointers.values()];
    if (!points.length) return;
    this.gesture = {
      points: points.map((point) => [...point]), pan, orientation: [...this.orientation],
      offset: [...this.pan], zoom: this.zoom,
    };
  }

  installControls() {
    const position = (event) => {
      const bounds = this.canvas.getBoundingClientRect();
      return [event.clientX - bounds.left, event.clientY - bounds.top];
    };
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, position(event));
      this.beginGesture(event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey);
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, position(event));
      const current = [...this.pointers.values()];
      const start = this.gesture;
      if (!start || start.points.length !== current.length) { this.beginGesture(); return; }
      if (current.length >= 2) {
        const middle = (points) => [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
        const before = middle(start.points);
        const after = middle(current);
        const distance = (points) => Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]);
        this.zoom = clamp(start.zoom * distance(current) / Math.max(1, distance(start.points)), 0.08, 80);
        this.pan = start.offset.map((value, index) => value + after[index] - before[index]);
      } else if (start.pan) {
        this.pan = start.offset.map((value, index) => value + current[0][index] - start.points[0][index]);
      } else {
        this.orientation = normalizeQuaternion(multiplyQuaternion(
          rotationBetween(this.spherePoint(start.points[0]), this.spherePoint(current[0])), start.orientation));
      }
      this.requestRender();
    });
    const release = (event) => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size) this.beginGesture();
      else { this.gesture = null; this.canvas.classList.remove('dragging'); }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('lostpointercapture', release);
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
      this.zoom = clamp(this.zoom * Math.exp(-delta * 0.0015), 0.08, 80);
      this.requestRender();
    }, { passive: false });
    this.canvas.addEventListener('keydown', (event) => {
      if (event.key === 'f' || event.key === 'F') this.fit();
      else if (event.key === 'r' || event.key === 'R') this.reset();
      else if (event.key === '+' || event.key === '=') this.zoom = clamp(this.zoom * 1.2, 0.08, 80);
      else if (event.key === '-') this.zoom = clamp(this.zoom / 1.2, 0.08, 80);
      else if (event.key.startsWith('Arrow')) {
        const angle = Math.PI / 36;
        const q = event.key === 'ArrowLeft' ? [0, Math.sin(-angle), 0, Math.cos(angle)]
          : event.key === 'ArrowRight' ? [0, Math.sin(angle), 0, Math.cos(angle)]
            : [Math.sin(event.key === 'ArrowUp' ? -angle : angle), 0, 0, Math.cos(angle)];
        this.orientation = normalizeQuaternion(multiplyQuaternion(q, this.orientation));
      } else return;
      event.preventDefault();
      this.requestRender();
    });
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.render(); });
  }

  render() {
    const ctx = this.ctx;
    const { width, height, palette } = this;
    const colors = palette.axes;
    ctx.clearRect(0, 0, width, height);
    if (!this.scene) return;
    const unitScale = Math.max(...this.scene.pose.translation.map(Math.abs)) || 1;
    const target = this.scene.pose.translation.map((value) => value / unitScale);
    const length = Math.hypot(...target);
    const axisLength = length < 1e-12 ? 0.78 : clamp(length * 0.42, 0.32, 0.7);
    const center = target.map((value) => value / 2);
    const rotation = quaternionToMatrix(this.orientation);
    const pixels = Math.min(width / 3.8, height / 3.5) * this.zoom;
    const project = (point) => {
      const camera = multiplyVector(rotation, point.map((value, index) => value - center[index]));
      return [width / 2 + this.pan[0] + camera[0] * pixels, height / 2 + this.pan[1] - camera[1] * pixels, camera[2]];
    };
    const line = (from, to, color, weight = 1, dashed = false) => {
      ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]);
      ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.setLineDash(dashed ? [5, 5] : []); ctx.stroke(); ctx.setLineDash([]);
    };
    const arrow = (from, to, color, dashed) => {
      line(from, to, color, 2.3, dashed);
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      ctx.beginPath(); ctx.moveTo(to[0], to[1]);
      ctx.lineTo(to[0] - 9 * Math.cos(angle - 0.4), to[1] - 9 * Math.sin(angle - 0.4));
      ctx.lineTo(to[0] - 9 * Math.cos(angle + 0.4), to[1] - 9 * Math.sin(angle + 0.4));
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    };
    // Orthographic projection keeps scale stable while orbiting. Grid units adapt to the input extent.
    ctx.save();
    for (let step = -8; step <= 8; step++) {
      const value = step / 3;
      line(project([value, -8 / 3, -0.025]), project([value, 8 / 3, -0.025]), step === 0 ? palette.gridMajor : palette.grid, step === 0 ? 1 : 0.65);
      line(project([-8 / 3, value, -0.025]), project([8 / 3, value, -0.025]), step === 0 ? palette.gridMajor : palette.grid, step === 0 ? 1 : 0.65);
    }
    const sourcePoint = project([0, 0, 0]);
    const targetPoint = project(target);
    if (length > 1e-12) line(sourcePoint, targetPoint, palette.link, 1.2, true);
    const frames = sceneFrames(this.scene).map((frame) => ({
      ...frame, position: frame.translation.map((value) => value / unitScale),
      size: axisLength * (frame.fixed ? 1 : 0.77),
    }));
    const segments = [];
    for (const frame of frames) {
      const matrix = quaternionToMatrix(frame.rotation);
      for (let axis = 0; axis < 3; axis++) {
        const tip = frame.position.map((value, index) => value + matrix[index][axis] * frame.size);
        const start = project(frame.position);
        const end = project(tip);
        segments.push({ start, end, axis, frame, depth: (start[2] + end[2]) / 2 });
      }
    }
    segments.sort((a, b) => a.depth - b.depth);
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const segment of segments) {
      arrow(segment.start, segment.end, colors[segment.axis], !segment.frame.fixed);
      const dx = segment.end[0] - segment.start[0];
      const dy = segment.end[1] - segment.start[1];
      const distance = Math.max(1, Math.hypot(dx, dy));
      const x = segment.end[0] + dx / distance * 16;
      const y = segment.end[1] + dy / distance * 16;
      const label = `${'XYZ'[segment.axis]}${segment.frame.fixed ? '' : '′'}`;
      ctx.strokeStyle = palette.halo; ctx.lineWidth = 5; ctx.strokeText(label, x, y);
      ctx.fillStyle = colors[segment.axis]; ctx.fillText(label, x, y);
    }
    const labelBoxes = [];
    for (const frame of frames) {
      const point = project(frame.position);
      const style = palette[frame.name] ?? DEFAULT_PALETTE.Robot;
      ctx.beginPath(); ctx.arc(point[0], point[1], frame.fixed ? 5 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = style.point; ctx.fill();
      const label = `${frame.name}${frame.fixed ? ' · 基准' : ''}`;
      ctx.font = '600 12px system-ui, sans-serif';
      const labelWidth = ctx.measureText(label).width + 22;
      const candidates = [
        [point[0] - labelWidth / 2, point[1] + (frame.fixed ? 23 : -44)],
        [point[0] - labelWidth - 18, point[1] - 13],
        [point[0] + 18, point[1] - 13],
        [point[0] - labelWidth / 2, point[1] + 40],
        [point[0] - labelWidth / 2, point[1] - 65],
      ].map(([x, y]) => [clamp(x, 8, Math.max(8, width - labelWidth - 8)), clamp(y, 12, Math.max(12, height - 36))]);
      const [x, y] = candidates.find(([x, y]) => !labelBoxes.some((box) =>
        x < box.x + box.width + 7 && x + labelWidth + 7 > box.x && y < box.y + 33 && y + 33 > box.y)) || candidates[0];
      labelBoxes.push({ x, y, width: labelWidth });
      ctx.fillStyle = palette.labelBackground; ctx.strokeStyle = style.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, labelWidth, 26, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = style.text;
      ctx.fillText(label, x + labelWidth / 2, y + 13);
    }
    ctx.restore();
    // A corner orientation triad remains readable at any zoom level.
    const origin = [width - 46, height - 47];
    for (let axis = 0; axis < 3; axis++) {
      const direction = rotation.map((row) => row[axis]);
      const tip = [origin[0] + direction[0] * 26, origin[1] - direction[1] * 26];
      line(origin, tip, colors[axis], 1.8);
      ctx.font = '10px ui-monospace, monospace'; ctx.fillStyle = colors[axis];
      ctx.fillText('xyz'[axis], tip[0] + direction[0] * 7, tip[1] - direction[1] * 7);
    }
  }
}
