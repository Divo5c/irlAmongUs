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
    this.rooms = [];
    this.roomMode = false;
    this.draftPts = [];
    this.onRoomDraft = null;

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

  setRooms(rooms = []) {
    this.rooms = rooms;
    this.render();
  }

  /** Toggles the room-drawing mode; reset any pending draft. */
  setRoomMode(active) {
    this.roomMode = !!active;
    this.draftPts = this.roomMode ? this.draftPts : [];
    this.render();
  }

  undoRoomPoint() {
    this.draftPts.pop();
    this.render();
  }

  /** Finishes the draft permanently (called from the room-name form). */
  commitRoom(name, type) {
    if (this.draftPts.length < 3) return null;
    const room = {
      id: `room-${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`,
      name: String(name || 'Raum').trim(),
      type,
      polygon: this.draftPts.map(([x, y]) => ({ x, y })),
    };
    this.rooms = [...this.rooms, room];
    this.draftPts = [];
    this.roomMode = false;
    this.render();
    return room;
  }

  discardRoom() {
    this.draftPts = [];
    this.roomMode = false;
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
    this._downAt = { x: event.clientX, y: event.clientY };
    this._moved = false;
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
      this._moved = true;
      this.render();
      return;
    }

    if (this._pointers.size === 1) {
      const rect = this.canvas.getBoundingClientRect();
      const dx = (record.x - prev.x) / this.pxPerMeter;
      const dy = (record.y - prev.y) / this.pxPerMeter;
      this.offset.x -= dx;
      this.offset.y -= dy;
      this._moved = true;
      this.render();
      void rect;
    }
  }

  _onPointerUp(event) {
    // A tap is a press-release without meaningful movement (finger jitter
    // of a few pixels must still count as a tap, otherwise deselect died).
    const start = this._downAt;
    const pos = this._pointers.get(event.pointerId);
    const isTap =
      start && pos && Math.hypot(pos.x - start.x, pos.y - start.y) < 10;
    this._pointers.delete(event.pointerId);
    this._downAt = null;
    if (this._pointers.size < 2) this._pinchStart = null;
    if (!isTap || !pos) return;
    const rect = this.canvas.getBoundingClientRect();
    this._handleTap(event.clientX - rect.left, event.clientY - rect.top);
  }

  _onWheel(event) {
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2);
  }

  /** Toggle the closest street candidate within the tap tolerance. */
  _handleTap(px, py) {
    const [wx, wy] = this._worldFromScreen(px, py);
    // Room mode: taps collect polygon points; tapping near the first point
    // closes the shape (needs at least 3 points).
    if (this.roomMode) {
      if (this.draftPts.length >= 3) {
        const first = this.draftPts[0];
        const closeTolerance = 26 / this.pxPerMeter;
        if (Math.hypot(first[0] - wx, first[1] - wy) < closeTolerance) {
          this.roomMode = false;
          this.onRoomDraft?.(this.draftPts.map(([x, y]) => ({ x, y })));
          this.render();
          return;
        }
      }
      this.draftPts.push([wx, wy]);
      this.render();
      return;
    }
    const toleranceScreenPx = 30 / this.pxPerMeter; // meters around the tap
    let best = null;
    let bestDist = Infinity;
    for (const candidate of this.candidates) {
      // Distance to every SEGMENT (not just vertices), so long straight
      // streets are also pickable in the middle.
      const pts = candidate.points;
      let dist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / len2));
        const d = Math.hypot(ax + t * dx - wx, ay + t * dy - wy);
        if (d < dist) dist = d;
      }
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
      if (active) {
        const mid = candidate.points[Math.floor(candidate.points.length / 2)];
        const [mx, my] = toScreen(mid[0], mid[1]);
        const label = isNumericName(candidate.name) ? '' : candidate.name;
        ctx.fillStyle = '#9ecfff';
        ctx.font = 'bold 12px system-ui';
        // Outline keeps labels readable over street lines.
        ctx.strokeStyle = 'rgba(13, 17, 23, 0.85)';
        ctx.lineWidth = 3;
        if (label) {
          ctx.strokeText(label, mx + 4, my - 4);
          ctx.fillText(label, mx + 4, my - 4);
        }
      } else if (!isNumericName(candidate.name) && ppm > 2.4) {
        const mid = candidate.points[Math.floor(candidate.points.length / 2)];
        const [mx, my] = toScreen(mid[0], mid[1]);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.font = '11px system-ui';
        ctx.strokeStyle = 'rgba(13, 17, 23, 0.85)';
        ctx.lineWidth = 3;
        ctx.strokeText(candidate.name, mx + 4, my - 4);
        ctx.fillText(candidate.name, mx + 4, my - 4);
      }
    }

    // Rooms (committed) — translucent amber with centroid label.
    for (const room of this.rooms) {
      if (room.polygon?.length < 3) continue;
      ctx.beginPath();
      room.polygon.forEach((pt, i) => {
        const [sx, sy] = toScreen(pt.x, pt.y);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 209, 102, 0.12)';
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length;
      const cy = room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length;
      const [rx, ry] = toScreen(cx, cy);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(13, 17, 23, 0.85)';
      ctx.lineWidth = 3;
      if (room.name) {
        ctx.strokeText(room.name, rx, ry);
        ctx.fillText(room.name, rx, ry);
      }
      ctx.textAlign = 'left';
    }

    // Room draft — dotted white polygon with closing hint on first point.
    if (this.roomMode && this.draftPts.length) {
      ctx.beginPath();
      this.draftPts.forEach((pt, i) => {
        const [sx, sy] = toScreen(pt[0], pt[1]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = '#e6edf3';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const pt of this.draftPts) {
        const [sx, sy] = toScreen(pt[0], pt[1]);
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#e6edf3';
        ctx.fill();
      }
      if (this.draftPts.length >= 3) {
        const [fx, fy] = toScreen(...this.draftPts[0]);
        ctx.beginPath();
        ctx.arc(fx, fy, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}

window.MapEditor = MapEditor;

/** Unnamed OSM ways fall back to their numeric id — never render that. */
function isNumericName(name) {
  return /^-?\d+$/.test(String(name).trim());
}

