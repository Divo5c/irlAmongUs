/**
 * Interactive street picking for the map editor screen.
 *
 * Draws OSM candidates (dim = selectable, blue = selected) and the working
 * map nodes/corridors; supports panning (drag), pinch/wheel zoom and tap
 * selection with a generous touch tolerance of 30 px.
 */
'use strict';

class MapEditor {
  constructor(canvas, { onSelectionChanged } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelectionChanged = onSelectionChanged ?? null;

    this.anchor = null; // {lat, lon}
    this.candidates = [];
    this.selected = new Set();
    this.working = { version: 0, nodes: [], corridors: [] };

    this.zoom = 1; // meters per screen px inverted: pxPerMeter
    this.pxPerMeter = 3;
    this.offset = { x: 0, y: 0 }; // world coords at canvas center

    this._pointer = null;
    this._pointers = new Map();
    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._resize();
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this._dpr = dpr;
    this.render();
  }

  setAnchor(lat, lon) {
    this.anchor = { lat, lon };
  }

  setCandidates(candidates) {
    this.candidates = candidates;
    this.selected.clear();
    this._fitBoundsToContent();
  }

  setWorking(working) {
    this.working = working;
    this.render();
  }

  getSelectedCandidates() {
    return this.candidates.filter((c) => this.selected.has(c.id));
  }

  clearWorking() {
    this.working = { version: 0, nodes: [], corridors: [] };
    this.render();
  }

  zoomBy(factor) {
    this.pxPerMeter = Math.min(60, Math.max(0.5, this.pxPerMeter * factor));
    this.render();
  }

  _centerWorld() {
    return this.offset;
  }

  _fitBoundsToContent() {
    const pts = [];
    for (const c of this.candidates) {
      for (const p of c.points) pts.push(p);
    }
    if (!pts.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const rect = this.canvas.getBoundingClientRect();
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const pxPerMeter = Math.min(
      (rect.width - 40) / spanX,
      (rect.height - 40) / spanY,
    );
    this.pxPerMeter = Math.min(60, Math.max(0.5, pxPerMeter || 3));
    this.offset = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    this.render();
  }

  _worldFromScreen(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const center = this._centerWorld();
    return [
      center.x + (px - cx) / this.pxPerMeter,
      center.y + (py - cy) / this.pxPerMeter,
    ];
  }

  _onPointerDown(event) {
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._pointers.size === 2) this._pinchStart = this._pinchDistance();
  }

  _pinchDistance() {
    const [a, b] = [...this._pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _onPointerMove(event) {
    const record = this._pointers.get(event.pointerId);
    if (!record) return;
    const prev = { ...record };
    record.x = event.clientX;
    record.y = event.clientY;

    if (this._pointers.size === 2) {
      const before = this._pinchStart ?? this._pinchDistance();
      const after = this._pinchDistance();
      if (before > 0) this.zoomBy(after / before);
      this._pinchStart = after;
      this.render();
      return;
    }

    if (this._pointers.size === 1) {
      const rect = this.canvas.getBoundingClientRect();
      const dx = (record.x - prev.x) / this.pxPerMeter;
      const dy = (record.y - prev.y) / this.pxPerMeter;
      this.offset.x -= dx;
      this.offset.y -= dy;
      this._panned = true;
      this.render();
      void rect;
    }
  }

  _onPointerUp(event) {
    const wasTap = this._pointers.has(event.pointerId) && !this._pannedDown(event);
    const pos = this._pointers.get(event.pointerId);
    this._pointers.delete(event.pointerId);
    if (this._pointers.size < 2) this._pinchStart = null;
    if (this._pointers.size === 0) this._panned = false;
    if (!wasTap || !pos) return;
    const rect = this.canvas.getBoundingClientRect();
    this._handleTap(event.clientX - rect.left, event.clientY - rect.top);
  }

  _pannedDown() {
    return this._panned === true;
  }

  _onWheel(event) {
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2);
  }

  /** Toggle the closest street candidate within the tap tolerance. */
  _handleTap(px, py) {
    const [wx, wy] = this._worldFromScreen(px, py);
    const toleranceScreenPx = 30;
    let best = null;
    let bestDist = Infinity;
    for (const candidate of this.candidates) {
      const dist = candidate.points.reduce((acc, [cx, cy]) => {
        const d = Math.hypot(cx - wx, cy - wy) * this.pxPerMeter;
        return Math.min(acc, d);
      }, Infinity);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    if (!best || bestDist > toleranceScreenPx) return;
    if (this.selected.has(best.id)) this.selected.delete(best.id);
    else this.selected.add(best.id);
    this.render();
    this.onSelectionChanged?.(this.selected.size);
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this._dpr ?? 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    if (!this.anchor) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const center = this._centerWorld();
    const ppm = this.pxPerMeter;
    const toScreen = (x, y) => [
      cx + (x - center.x) * ppm,
      cy + (y - center.y) * ppm,
    ];

    // Working map (already built game geometry) — gray.
    ctx.lineWidth = Math.max(1.5, 5 * ppm);
    ctx.strokeStyle = '#4b5563';
    ctx.beginPath();
    for (const corridor of this.working.corridors) {
      const a = this.working.nodes.find((n) => n.id === corridor.a);
      const b = this.working.nodes.find((n) => n.id === corridor.b);
      if (!a || !b) continue;
      const [ax, ay] = toScreen(a.x, a.y);
      const [bx, by] = toScreen(b.x, b.y);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    // OSM candidates — dim red, selected bright blue.
    for (const candidate of this.candidates) {
      const active = this.selected.has(candidate.id);
      ctx.strokeStyle = active ? '#58a6ff' : '#5f2a33';
      ctx.lineWidth = active ? Math.max(3, 6 * ppm) : 2;
      ctx.beginPath();
      let first = true;
      for (const [x, y] of candidate.points) {
        const [sx, sy] = toScreen(x, y);
        if (first) { ctx.moveTo(sx, sy); first = false; }
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      if (active || ppm > 2.2) {
        const mid = candidate.points[Math.floor(candidate.points.length / 2)];
        const [mx, my] = toScreen(mid[0], mid[1]);
        ctx.fillStyle = active ? '#9ecfff' : '#8b949e';
        ctx.font = 'bold 11px system-ui';
        ctx.fillText(candidate.name, mx + 4, my - 4);
      }
    }
  }
}

window.MapEditor = MapEditor;
