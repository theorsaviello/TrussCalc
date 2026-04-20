/* ──────────────────────────────────────────────
   TRUSSCALC — app.js
   ────────────────────────────────────────────── */

// ═══════════════════════════════════════════════════════════════════
// CANVAS COLOR CONSTANTS  (CSS vars não funcionam no canvas 2D)
// ═══════════════════════════════════════════════════════════════════
const CLR = {
  bg:       '#060d1a',
  panel:    '#0b1728',
  border:   '#1a3355',
  accent:   '#00cfff',
  accent2:  '#0088cc',
  tension:  '#00e676',
  compress: '#ff4545',
  zero:     '#78909c',
  force:    '#ffd740',
  support:  '#ff9800',
  warn:     '#ff5252',
  muted:    '#4d7fa8',
  white:    '#e8f4ff',
  grid:     '#112240',
  axis:     '#1a4a80',
  nodeBg:   '#0d2035',
  nodeSel:  '#00cfff',
  nodeErr:  '#ff5252',
  text:     '#cce8f4',
};

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const S = {
  nodes:    [],   // {id, x, y}
  members:  [],   // {id, a, b}
  supports: [],   // {id, node, type: 'pin'|'roller_h'|'roller_v'}
  forces:   [],   // {id, node, fx, fy}

  mode:          'node',
  pendingMember: null,
  supportType:   'pin',
  results:       null,
  crossings:     [],

  originX: 0, originY: 0,
  scale: 70,
  panning: false,
  panSX: 0, panSY: 0, panOX: 0, panOY: 0,
  snapGrid: true,
  idCounter: 0,
  _mouseCanvas: null,
};

function nextId() { return ++S.idCounter; }

// ═══════════════════════════════════════════════════════════════════
// COORDINATE TRANSFORMS
// ═══════════════════════════════════════════════════════════════════
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function worldToCanvas(wx, wy) {
  return [
    (wx - S.originX) * S.scale + canvas.width  / 2,
   -((wy - S.originY) * S.scale) + canvas.height / 2
  ];
}
function canvasToWorld(cx, cy) {
  return [
    (cx - canvas.width  / 2) / S.scale + S.originX,
   -((cy - canvas.height / 2) / S.scale) + S.originY
  ];
}
function snapToGrid(wx, wy) {
  if (!S.snapGrid) return [wx, wy];
  return [Math.round(wx), Math.round(wy)];
}
function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  canvas.width  = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  render();
}

// ═══════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawMembers();
  drawSupports();
  drawForces();
  drawNodes();
  if (S.pendingMember !== null) drawPendingMember();
}

function drawGrid() {
  const W = canvas.width, H = canvas.height;
  const minPx = 40;
  let worldStep = 1;
  while (worldStep * S.scale < minPx) worldStep *= 2;
  while (worldStep * S.scale > minPx * 5) worldStep /= 2;

  const [wx0] = canvasToWorld(0, 0);
  const [wx1] = canvasToWorld(W, 0);
  const [,wy0] = canvasToWorld(0, H);
  const [,wy1] = canvasToWorld(0, 0);

  const startX = Math.floor(wx0 / worldStep) * worldStep;
  const startY = Math.floor(wy0 / worldStep) * worldStep;

  // Vertical grid lines
  for (let wx = startX; wx <= wx1 + worldStep; wx += worldStep) {
    const [cx] = worldToCanvas(wx, 0);
    const isAxis = Math.abs(wx) < 1e-9;
    ctx.strokeStyle = isAxis ? CLR.axis : CLR.grid;
    ctx.lineWidth   = isAxis ? 1.2 : 0.5;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    if (!isAxis) {
      const [,cy0] = worldToCanvas(0, 0);
      const ly = Math.min(Math.max(cy0 + 4, 2), H - 14);
      ctx.font = '10px JetBrains Mono'; ctx.fillStyle = CLR.axis;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(fmtCoord(wx), cx, ly);
    }
  }
  // Horizontal grid lines
  for (let wy = startY; wy <= wy1 + worldStep; wy += worldStep) {
    const [,cy] = worldToCanvas(0, wy);
    const isAxis = Math.abs(wy) < 1e-9;
    ctx.strokeStyle = isAxis ? CLR.axis : CLR.grid;
    ctx.lineWidth   = isAxis ? 1.2 : 0.5;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    if (!isAxis) {
      const [cx0] = worldToCanvas(0, 0);
      const lx = Math.min(Math.max(cx0 - 4, 22), W - 4);
      ctx.font = '10px JetBrains Mono'; ctx.fillStyle = CLR.axis;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtCoord(wy), lx, cy);
    }
  }
}

function memberStrokeColor(idx) {
  if (!S.results || !S.results.memberForces) return CLR.accent2;
  const f = S.results.memberForces[idx];
  if (Math.abs(f) < 1e-6) return CLR.zero;
  return f > 0 ? CLR.tension : CLR.compress;
}

function drawMembers() {
  S.members.forEach((m, idx) => {
    const na = S.nodes[m.a], nb = S.nodes[m.b];
    if (!na || !nb) return;
    const [x1, y1] = worldToCanvas(na.x, na.y);
    const [x2, y2] = worldToCanvas(nb.x, nb.y);
    const isCrossing = S.crossings.some(c => c.includes(idx));

    // Shadow for visibility
    ctx.shadowColor = isCrossing ? 'rgba(255,82,82,.5)' : 'rgba(0,0,0,.6)';
    ctx.shadowBlur  = 4;
    ctx.lineWidth   = 3.5;
    ctx.strokeStyle = isCrossing ? CLR.warn : memberStrokeColor(idx);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.shadowBlur = 0;

    // Label
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (S.results && S.results.memberForces) {
      const f = S.results.memberForces[idx];
      const abs = Math.abs(f);
      const lbl = abs < 1e-6 ? '0' : fmtForce(abs);
      const col = memberStrokeColor(idx);
      ctx.font = 'bold 11px JetBrains Mono';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      // Dark outline
      ctx.strokeStyle = CLR.bg; ctx.lineWidth = 3;
      ctx.strokeText(lbl, mx, my - 5);
      ctx.fillStyle = col;
      ctx.fillText(lbl, mx, my - 5);
    } else {
      ctx.font = '10px JetBrains Mono'; ctx.fillStyle = CLR.muted;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('b' + (idx + 1), mx, my);
    }
  });
}

function drawPendingMember() {
  const na = S.nodes[S.pendingMember];
  if (!na || !S._mouseCanvas) return;
  const [x1, y1] = worldToCanvas(na.x, na.y);
  const [mx, my] = S._mouseCanvas;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,207,255,.45)';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(mx, my); ctx.stroke();
  ctx.setLineDash([]);
}

// ── Supports ──────────────────────────────────────────────────────
function drawSupportSymbol(cx, cy, type) {
  const sz = 14;
  ctx.save();
  ctx.translate(cx, cy);

  if (type === 'pin') {
    // Triangle
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-sz, sz * 1.4); ctx.lineTo(sz, sz * 1.4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,152,0,.18)'; ctx.strokeStyle = CLR.support; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    // Base line
    ctx.beginPath(); ctx.moveTo(-sz - 3, sz * 1.4); ctx.lineTo(sz + 3, sz * 1.4);
    ctx.strokeStyle = CLR.support; ctx.lineWidth = 1.5; ctx.stroke();
    // Hatch
    ctx.strokeStyle = 'rgba(255,152,0,.35)'; ctx.lineWidth = 1;
    for (let i = -sz; i <= sz; i += 5) {
      ctx.beginPath();
      ctx.moveTo(-sz + i, sz * 1.4); ctx.lineTo(-sz + i - 5, sz * 1.4 + 7);
      ctx.stroke();
    }
  }
  else if (type === 'roller_h') {
    // Triangle
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-sz, sz * 1.4); ctx.lineTo(sz, sz * 1.4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,152,0,.18)'; ctx.strokeStyle = CLR.support; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    // Roller circles
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.arc(i * sz * 0.65, sz * 1.4 + 5.5, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,152,0,.25)'; ctx.strokeStyle = CLR.support; ctx.lineWidth = 1.2;
      ctx.fill(); ctx.stroke();
    }
    // Ground line
    ctx.beginPath(); ctx.moveTo(-sz - 3, sz * 1.4 + 10); ctx.lineTo(sz + 3, sz * 1.4 + 10);
    ctx.strokeStyle = 'rgba(255,152,0,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  else if (type === 'roller_v') {
    // Rotated triangle (wall on the right → support pointing left)
    ctx.rotate(-Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-sz, sz * 1.4); ctx.lineTo(sz, sz * 1.4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,152,0,.18)'; ctx.strokeStyle = CLR.support; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.arc(i * sz * 0.65, sz * 1.4 + 5.5, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,152,0,.25)'; ctx.strokeStyle = CLR.support; ctx.lineWidth = 1.2;
      ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-sz - 3, sz * 1.4 + 10); ctx.lineTo(sz + 3, sz * 1.4 + 10);
    ctx.strokeStyle = 'rgba(255,152,0,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
  }

  ctx.restore();
}

function drawSupports() {
  S.supports.forEach(s => {
    const n = S.nodes[s.node];
    if (!n) return;
    const [cx, cy] = worldToCanvas(n.x, n.y);
    drawSupportSymbol(cx, cy, s.type);
  });
}

// ── Forces ────────────────────────────────────────────────────────
function drawArrow(x1, y1, x2, y2, color, lw, headLen) {
  lw = lw || 2; headLen = headLen || 10;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 3;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - 0.38), y2 - headLen * Math.sin(angle - 0.38));
  ctx.lineTo(x2 - headLen * Math.cos(angle + 0.38), y2 - headLen * Math.sin(angle + 0.38));
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
}

function drawForces() {
  const maxF = Math.max(...S.forces.map(f => Math.hypot(f.fx, f.fy)), 1);
  const baseLen = Math.min(S.scale * 0.9, 55);

  S.forces.forEach(f => {
    const n = S.nodes[f.node];
    if (!n) return;
    const [cx, cy] = worldToCanvas(n.x, n.y);
    const mag = Math.hypot(f.fx, f.fy);
    if (mag < 1e-12) return;
    const len = Math.max(28, baseLen * (mag / maxF));
    const ux = f.fx / mag, uy = -f.fy / mag;
    drawArrow(cx - ux * len, cy - uy * len, cx, cy, CLR.force, 2.5, 10);
    ctx.font = 'bold 11px JetBrains Mono'; ctx.fillStyle = CLR.force;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lx = cx - ux * (len / 2 + 2), ly = cy - uy * (len / 2 + 2);
    ctx.strokeStyle = CLR.bg; ctx.lineWidth = 2.5;
    ctx.strokeText(fmtForce(mag), lx + uy * 11, ly + ux * 11);
    ctx.fillText(fmtForce(mag), lx + uy * 11, ly + ux * 11);
  });

  // Reaction arrows after analysis
  if (S.results && S.results.reactionForces) {
    const rf = S.results.reactionForces;
    const maxR = Math.max(...Object.values(rf).flatMap(v => [Math.abs(v.x), Math.abs(v.y)]), 1);
    const rscale = Math.min(S.scale * 0.9, 55);

    S.supports.forEach(s => {
      const n = S.nodes[s.node];
      if (!n) return;
      const [cx, cy] = worldToCanvas(n.x, n.y);
      const r = rf[s.node] || {x: 0, y: 0};

      if (Math.abs(r.x) > 1e-6) {
        const len = Math.max(22, rscale * Math.abs(r.x) / maxR);
        const ex = cx + (r.x > 0 ? -1 : 1) * len;
        drawArrow(ex, cy, cx, cy, 'rgba(255,152,0,.9)', 2, 9);
        ctx.font = 'bold 10px JetBrains Mono'; ctx.fillStyle = CLR.support;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.strokeStyle = CLR.bg; ctx.lineWidth = 2;
        ctx.strokeText(fmtForce(Math.abs(r.x)), (ex + cx) / 2, cy - 5);
        ctx.fillText(fmtForce(Math.abs(r.x)), (ex + cx) / 2, cy - 5);
      }
      if (Math.abs(r.y) > 1e-6) {
        const len = Math.max(22, rscale * Math.abs(r.y) / maxR);
        const ey = cy + (r.y > 0 ? 1 : -1) * len;
        drawArrow(cx, ey, cx, cy, 'rgba(255,152,0,.9)', 2, 9);
        ctx.font = 'bold 10px JetBrains Mono'; ctx.fillStyle = CLR.support;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = CLR.bg; ctx.lineWidth = 2;
        ctx.strokeText(fmtForce(Math.abs(r.y)), cx + 7, (ey + cy) / 2);
        ctx.fillText(fmtForce(Math.abs(r.y)), cx + 7, (ey + cy) / 2);
      }
    });
  }
}

// ── Nodes ─────────────────────────────────────────────────────────
function drawNodes() {
  const diagNodes = new Set();
  if (S.results && S.results.diagIssues) {
    S.results.diagIssues.filter(d => d.level === 'error').forEach(d =>
      d.nodes && d.nodes.forEach(i => diagNodes.add(i)));
  }

  S.nodes.forEach((n, idx) => {
    const [cx, cy] = worldToCanvas(n.x, n.y);
    const isSel = S.pendingMember === idx;
    const isErr = diagNodes.has(idx);
    const r = isSel ? 9 : 7;

    // Glow ring
    if (isSel) {
      ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,207,255,.12)'; ctx.fill();
    }
    if (isErr) {
      ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,82,82,.1)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,82,82,.55)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    }

    // Node circle — bright fill so it's visible after analysis
    ctx.shadowColor = isSel ? 'rgba(0,207,255,.6)' : 'rgba(0,0,0,.5)';
    ctx.shadowBlur  = isSel ? 8 : 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle   = isSel ? CLR.accent : isErr ? 'rgba(255,82,82,.25)' : CLR.nodeBg;
    ctx.strokeStyle = isSel ? '#fff' : isErr ? CLR.nodeErr : CLR.accent;
    ctx.lineWidth   = isSel ? 2.5 : 2;
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Number inside
    ctx.font = `bold ${r > 7 ? 11 : 10}px Rajdhani`;
    ctx.fillStyle = isSel ? '#001a2e' : isErr ? CLR.nodeErr : CLR.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(idx + 1, cx, cy + 0.5);

    // Coord label
    ctx.font = '9px JetBrains Mono';
    ctx.fillStyle = 'rgba(0,207,255,.55)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`(${fmtCoord(n.x)},${fmtCoord(n.y)})`, cx + 10, cy - 4);
  });
}

// ═══════════════════════════════════════════════════════════════════
// CROSSING DETECTION
// ═══════════════════════════════════════════════════════════════════
function segmentsProperlyIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-12) return false;
  const dx = p3.x - p1.x, dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  const eps = 1e-6;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

function checkCrossings() {
  S.crossings = [];
  for (let i = 0; i < S.members.length; i++) {
    for (let j = i + 1; j < S.members.length; j++) {
      const mi = S.members[i], mj = S.members[j];
      if (mi.a === mj.a || mi.a === mj.b || mi.b === mj.a || mi.b === mj.b) continue;
      const ns = S.nodes;
      if (segmentsProperlyIntersect(ns[mi.a], ns[mi.b], ns[mj.a], ns[mj.b]))
        S.crossings.push([i, j]);
    }
  }
  const el = document.getElementById('crossing-warning');
  if (S.crossings.length > 0) {
    el.textContent = `⚠ Cruzamento: ${S.crossings.map(([a, b]) => `b${a+1}×b${b+1}`).join(', ')}`;
    el.classList.add('visible');
  } else {
    el.classList.remove('visible');
  }
}

// ═══════════════════════════════════════════════════════════════════
// STRUCTURAL DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════
function buildAdj() {
  const adj = S.nodes.map(() => new Set());
  S.members.forEach(m => { adj[m.a].add(m.b); adj[m.b].add(m.a); });
  return adj;
}

function findRectPanels() {
  const adj = buildAdj();
  const hasEdge = (a, b) => adj[a].has(b);
  const panels = [], seen = new Set();
  for (let a = 0; a < S.nodes.length; a++) {
    for (const c of adj[a]) {
      for (const b of adj[c]) {
        if (b <= a) continue;
        if (hasEdge(a, b)) continue; // already connected directly
        for (const d of adj[b]) {
          if (!adj[a].has(d)) continue;
          if (d === c) continue;
          if (!hasEdge(c, d)) { // quadrilateral a-c-b-d without diagonals
            const key = [a, b, c, d].sort((x,y)=>x-y).join('-');
            if (!seen.has(key)) { seen.add(key); panels.push([a, c, b, d]); }
          }
        }
      }
    }
  }
  return panels;
}

function diagnoseStructure() {
  const { nodes: ns, members: ms, supports: sups } = S;
  const issues = [];
  const adj = buildAdj();

  // 1. Isolated nodes
  ns.forEach((n, i) => {
    if (adj[i].size === 0)
      issues.push({ level:'error', msg:`Nó N${i+1} não está conectado a nenhuma barra.`, nodes:[i] });
  });

  // 2. Rectangular panels without diagonal
  findRectPanels().forEach(p => {
    issues.push({
      level: 'error',
      msg: `Painel sem diagonal entre N${p[0]+1}–N${p[1]+1}–N${p[2]+1}–N${p[3]+1}. Adicione uma barra diagonal neste painel.`,
      nodes: p
    });
  });

  // 3. Support-geometry compatibility
  const pins     = sups.filter(s => s.type === 'pin');
  const rollerVs = sups.filter(s => s.type === 'roller_v');

  // Two pins = hyperstatic (but that's caught by count)
  // roller_v at same height as pin = potentially singular
  pins.forEach(pin => {
    rollerVs.forEach(rv => {
      const np = ns[pin.node], nr = ns[rv.node];
      if (!np || !nr) return;
      if (Math.abs(np.y - nr.y) < 0.01) {
        issues.push({
          level: 'warning',
          msg: `Pino (N${pin.node+1}) e Rolete Vertical (N${rv.node+1}) estão na mesma altura (y=${fmtCoord(np.y)}). `
             + `O rolete vertical reage apenas horizontalmente — sem braço de momento vertical, o sistema pode ser singular. `
             + `Troque o rolete vertical por um Rolete Horizontal (Ry) ou posicione-o em altura diferente.`,
          nodes: [pin.node, rv.node]
        });
      }
    });
  });

  // 4. Collinear-only free nodes
  const supSet = new Set(sups.map(s => s.node));
  ns.forEach((n, i) => {
    if (supSet.has(i)) return;
    const nbrs = [...adj[i]];
    if (nbrs.length < 2) return;
    const a0 = Math.atan2(ns[nbrs[0]].y - n.y, ns[nbrs[0]].x - n.x);
    const allCollinear = nbrs.every(j => {
      const a = Math.atan2(ns[j].y - n.y, ns[j].x - n.x);
      const d = Math.abs(a - a0) % Math.PI;
      return d < 0.002 || Math.abs(d - Math.PI) < 0.002;
    });
    if (allCollinear)
      issues.push({
        level: 'warning',
        msg: `Nó N${i+1}: todas as barras estão alinhadas (colineares). O nó não resiste a cargas transversais.`,
        nodes: [i]
      });
  });

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// SOLVER — Method of Joints (Gaussian Elimination)
// ═══════════════════════════════════════════════════════════════════
function gaussianElim(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let singularRow = -1;
  for (let p = 0; p < n; p++) {
    let maxIdx = p;
    for (let i = p + 1; i < n; i++)
      if (Math.abs(M[i][p]) > Math.abs(M[maxIdx][p])) maxIdx = i;
    [M[p], M[maxIdx]] = [M[maxIdx], M[p]];
    if (Math.abs(M[p][p]) < 1e-10) { singularRow = p; return { sol: null, singularRow }; }
    const pv = M[p][p];
    for (let i = 0; i < n; i++) {
      if (i === p) continue;
      const f = M[i][p] / pv;
      for (let k = p; k <= n; k++) M[i][k] -= f * M[p][k];
    }
  }
  return { sol: M.map((row, i) => row[n] / row[i]), singularRow: -1 };
}

function solveTruss() {
  const { nodes: ns, members: ms, supports: sups, forces: fs } = S;
  const n = ns.length, m = ms.length;

  if (n < 2) return { error: 'São necessários pelo menos 2 nós.' };
  if (m < 1) return { error: 'São necessária pelo menos 1 barra.' };
  if (sups.length < 1) return { error: 'Nenhum vínculo definido.' };

  const diagIssues = diagnoseStructure();

  // Build reactions
  const reactions = [];
  sups.forEach(s => {
    if (s.type === 'pin')           { reactions.push({node: s.node, dir:'x'}); reactions.push({node: s.node, dir:'y'}); }
    else if (s.type === 'roller_h') reactions.push({node: s.node, dir:'y'});
    else if (s.type === 'roller_v') reactions.push({node: s.node, dir:'x'});
  });

  const r = reactions.length;
  const totalUnk = m + r;
  const totalEq  = 2 * n;

  if (totalUnk !== totalEq) {
    const diff = totalUnk - totalEq;
    if (diff > 0) {
      return {
        error: `Treliça hiperestática (grau ${diff}): ${totalUnk} incógnitas para ${totalEq} equações. `
             + `Remova ${diff} barra(s) ou reação(ões).`,
        diagIssues
      };
    }
    return {
      error: `Treliça instável (${-diff} grau(s) de liberdade): ${totalUnk} incógnitas para ${totalEq} equações. `
           + `Adicione ${-diff} barra(s) ou vínculo(s). Lembre: 2n = m + r (n=nós, m=barras, r=reações totais).`,
      diagIssues
    };
  }

  // Build system Ax = b
  const A = Array.from({length: totalEq}, () => new Array(totalUnk).fill(0));
  const b = new Array(totalEq).fill(0);

  ms.forEach((mem, j) => {
    const na = ns[mem.a], nb = ns[mem.b];
    const dx = nb.x - na.x, dy = nb.y - na.y, L = Math.hypot(dx, dy);
    if (L < 1e-12) return;
    const cx = dx / L, cy = dy / L;
    A[2 * mem.a    ][j] += cx;  A[2 * mem.a + 1][j] += cy;
    A[2 * mem.b    ][j] -= cx;  A[2 * mem.b + 1][j] -= cy;
  });

  reactions.forEach((rx, ri) => {
    const eq = rx.dir === 'x' ? 2 * rx.node : 2 * rx.node + 1;
    A[eq][m + ri] = 1;
  });

  const fMap = {};
  fs.forEach(f => {
    if (!fMap[f.node]) fMap[f.node] = {fx: 0, fy: 0};
    fMap[f.node].fx += f.fx; fMap[f.node].fy += f.fy;
  });
  for (let i = 0; i < n; i++) {
    const ap = fMap[i] || {fx: 0, fy: 0};
    b[2*i] = -ap.fx; b[2*i+1] = -ap.fy;
  }

  const {sol, singularRow} = gaussianElim(A, b);
  if (!sol) {
    // Build informative message
    let errMsg = 'Sistema singular — a geometria é instável para esta configuração de vínculos.';
    const errIssues = diagIssues.filter(d => d.level === 'error');
    const warnIssues = diagIssues.filter(d => d.level === 'warning');

    // Try to give the most specific cause
    if (errIssues.length > 0) {
      errMsg = errIssues[0].msg;
    } else if (warnIssues.length > 0) {
      // warning is likely the cause
      errMsg = warnIssues[0].msg;
      // remove it from warnings so it shows as main error
      diagIssues.splice(diagIssues.indexOf(warnIssues[0]), 1);
    } else if (singularRow >= 0) {
      const nodeIdx = Math.floor(singularRow / 2);
      const dir = singularRow % 2 === 0 ? 'horizontal' : 'vertical';
      errMsg += ` (Equilíbrio ${dir} do nó N${nodeIdx+1} não pode ser satisfeito — verifique a topologia das barras e o tipo de vínculo.)`;
    }
    return { error: errMsg, diagIssues };
  }

  const memberForces = sol.slice(0, m);
  const reactionForces = {};
  reactions.forEach((rx, ri) => {
    if (!reactionForces[rx.node]) reactionForces[rx.node] = {x: 0, y: 0};
    reactionForces[rx.node][rx.dir] = sol[m + ri];
  });

  return { memberForces, reactionForces, diagIssues };
}

// ═══════════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════
function fmtCoord(v) {
  if (Number.isInteger(v)) return String(v);
  return parseFloat(v.toFixed(2)).toString();
}
function fmtForce(v) {
  const a = Math.abs(v);
  if (a >= 10000) return (v/1000).toFixed(2) + 'k';
  if (a >= 1000)  return (v/1000).toFixed(3) + 'k';
  if (a >= 100)   return v.toFixed(1);
  if (a >= 10)    return v.toFixed(2);
  return v.toFixed(3);
}
function fmtVal(v) {
  return Math.abs(v) < 1e-6 ? '0' : fmtForce(v);
}

// ═══════════════════════════════════════════════════════════════════
// UI — SIDEBAR
// ═══════════════════════════════════════════════════════════════════
function updateSidebar() {
  const el = document.getElementById('sidebar-content');
  let h = '';

  if (S.mode === 'node') {
    h += `
    <div class="sb-section">
      <div class="sb-title">Adicionar Nó</div>
      <div class="sb-hint"><b>Clique no canvas</b> para posicionar, ou insira as coordenadas:</div>
      <div style="height:8px"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">X</label><input class="form-input" id="ni-x" type="number" step="1" placeholder="0"></div>
        <div class="form-group"><label class="form-label">Y</label><input class="form-input" id="ni-y" type="number" step="1" placeholder="0"></div>
      </div>
      <button class="btn-add" id="btn-add-node">+ ADICIONAR NÓ</button>
    </div>
    <div class="sb-section">
      <div class="sb-title">Nós (${S.nodes.length})</div>
      <div class="item-list">
        ${S.nodes.length === 0 ? '<div class="sb-empty">Nenhum nó definido</div>' :
          S.nodes.map((n, i) => `
          <div class="list-item">
            <span class="list-item-label">N${i+1}</span>
            <span class="list-item-info">(${fmtCoord(n.x)}, ${fmtCoord(n.y)})</span>
            <button class="list-item-del" onclick="removeNode(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  else if (S.mode === 'member') {
    const hint = S.pendingMember !== null
      ? `Nó <b>N${S.pendingMember+1}</b> selecionado — clique no segundo nó.`
      : '<b>Clique em dois nós</b> para criar uma barra. Esc cancela.';
    h += `
    <div class="sb-section">
      <div class="sb-title">Adicionar Barra</div>
      <div class="sb-hint">${hint}</div>
    </div>
    <div class="sb-section">
      <div class="sb-title">Barras (${S.members.length})</div>
      <div class="item-list">
        ${S.members.length === 0 ? '<div class="sb-empty">Nenhuma barra definida</div>' :
          S.members.map((m, i) => `
          <div class="list-item">
            <span class="list-item-label">b${i+1}</span>
            <span class="list-item-info">N${m.a+1} → N${m.b+1}</span>
            <button class="list-item-del" onclick="removeMember(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  else if (S.mode === 'support') {
    h += `
    <div class="sb-section">
      <div class="sb-title">Tipo de Vínculo</div>
      <div class="support-type-group">
        <button class="support-type-btn ${S.supportType==='pin'?'active':''}" onclick="setSupportType('pin')">
          <span class="support-icon">▽</span>
          <span><b>Pino</b><span class="support-desc">Rx + Ry (2 reações)</span></span>
        </button>
        <button class="support-type-btn ${S.supportType==='roller_h'?'active':''}" onclick="setSupportType('roller_h')">
          <span class="support-icon">○</span>
          <span><b>Rolete Horizontal</b><span class="support-desc">Ry apenas — sup. vertical</span></span>
        </button>
        <button class="support-type-btn ${S.supportType==='roller_v'?'active':''}" onclick="setSupportType('roller_v')">
          <span class="support-icon">◁</span>
          <span><b>Rolete Vertical</b><span class="support-desc">Rx apenas — sup. horizontal</span></span>
        </button>
      </div>
      <div class="sb-hint" style="font-size:11px">
        Para treliça plana típica: use <b>Pino</b> + <b>Rolete Horizontal</b>.<br>
        Rolete Vertical é para apoios em parede.
      </div>
    </div>
    <div class="sb-section">
      <div class="sb-title">Vínculos (${S.supports.length})</div>
      <div class="item-list">
        ${S.supports.length === 0 ? '<div class="sb-empty">Nenhum vínculo definido</div>' :
          S.supports.map((s, i) => `
          <div class="list-item">
            <span class="list-item-label">N${s.node+1}</span>
            <span class="list-item-info">${s.type==='pin'?'Pino':s.type==='roller_h'?'Rol. H.':'Rol. V.'}</span>
            <button class="list-item-del" onclick="removeSupport(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  else if (S.mode === 'force') {
    h += `
    <div class="sb-section">
      <div class="sb-title">Aplicar Força</div>
      <div class="sb-hint">Selecione o nó e informe as componentes da força (kN, N, etc.):</div>
      <div style="height:8px"></div>
      <div class="form-group">
        <label class="form-label">Nó de aplicação</label>
        <select class="form-input" id="force-node">
          <option value="">— selecione —</option>
          ${S.nodes.map((n, i) => `<option value="${i}">N${i+1}  (${fmtCoord(n.x)}, ${fmtCoord(n.y)})</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fx (→+)</label><input class="form-input" id="fi-fx" type="number" step="1" placeholder="0"></div>
        <div class="form-group"><label class="form-label">Fy (↑+)</label><input class="form-input" id="fi-fy" type="number" step="1" placeholder="0"></div>
      </div>
      <button class="btn-add" id="btn-add-force">+ ADICIONAR FORÇA</button>
    </div>
    <div class="sb-section">
      <div class="sb-title">Forças (${S.forces.length})</div>
      <div class="item-list">
        ${S.forces.length === 0 ? '<div class="sb-empty">Nenhuma força definida</div>' :
          S.forces.map((f, i) => `
          <div class="list-item">
            <span class="list-item-label">N${f.node+1}</span>
            <span class="list-item-info">Fx=${fmtVal(f.fx)} Fy=${fmtVal(f.fy)}</span>
            <button class="list-item-del" onclick="removeForce(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  el.innerHTML = h;
  bindSidebarEvents();
  updateStatusBar();
}

function bindSidebarEvents() {
  document.getElementById('btn-add-node')?.addEventListener('click', () => {
    const x = parseFloat(document.getElementById('ni-x').value) || 0;
    const y = parseFloat(document.getElementById('ni-y').value) || 0;
    addNode(x, y);
  });
  document.getElementById('btn-add-force')?.addEventListener('click', () => {
    const ni = document.getElementById('force-node').value;
    if (ni === '') { alert('Selecione um nó.'); return; }
    const fx = parseFloat(document.getElementById('fi-fx').value) || 0;
    const fy = parseFloat(document.getElementById('fi-fy').value) || 0;
    if (fx === 0 && fy === 0) { alert('A força não pode ser zero.'); return; }
    addForce(parseInt(ni), fx, fy);
  });
}

function updateStatusBar() {
  const n = S.nodes.length, m = S.members.length;
  const r = S.supports.reduce((a, s) => a + (s.type === 'pin' ? 2 : 1), 0);
  const eq = 2 * n, unk = m + r, diff = unk - eq;

  document.getElementById('stat-nodes').textContent   = `N: ${n}`;
  document.getElementById('stat-members').textContent = `b: ${m}`;
  const pill = document.getElementById('stat-det');
  if (n === 0) { pill.textContent = '—'; pill.className = 'stat-pill neutral'; return; }
  if (diff === 0) { pill.textContent = 'Isostática ✓'; pill.className = 'stat-pill ok'; }
  else if (diff > 0) { pill.textContent = `Hiperestat. +${diff}`; pill.className = 'stat-pill warn'; }
  else { pill.textContent = `Instável ${diff}`; pill.className = 'stat-pill warn'; }
}

// ═══════════════════════════════════════════════════════════════════
// RESULTS DISPLAY
// ═══════════════════════════════════════════════════════════════════
function diagHTML(issues) {
  if (!issues || issues.length === 0) return '';
  return issues.map(d => {
    const cls = d.level === 'error' ? 'error' : 'warning';
    const icon = d.level === 'error' ? '⛔' : '⚠';
    return `<div class="diag-block ${cls}">${icon} ${d.msg}</div>`;
  }).join('');
}

function showResults(res) {
  const panel = document.getElementById('results-panel');
  const body  = document.getElementById('results-body');
  const stxt  = document.getElementById('results-status');
  panel.classList.add('visible');

  if (res.error) {
    stxt.textContent = '';
    body.innerHTML = `
      <div class="results-error-wrapper">
        <div class="diag-block error">⛔ ${res.error}</div>
        ${diagHTML((res.diagIssues || []).filter(d => d.level !== 'error' || d.msg !== res.error))}
        <div class="diag-block info">
          <b>Guia rápido:</b><br>
          • Treliça plana simples: <b>Pino</b> + <b>Rolete Horizontal</b> nos apoios de base<br>
          • Painel sem diagonal → adicione uma barra diagonal cortando o retângulo<br>
          • Verifique: <b>2n = m + r</b> &nbsp;(n=nós, m=barras, r=reações totais)
        </div>
      </div>`;
    return;
  }

  stxt.textContent = `${S.members.length} barras · ${S.supports.length} vínculos`;

  const eps = 1e-6;

  // Member table
  let mHtml = `<table class="res-table">
    <thead><tr><th>Barra</th><th>Nós</th><th>Força</th><th>Estado</th></tr></thead><tbody>`;
  res.memberForces.forEach((f, i) => {
    const mm = S.members[i];
    const abs = Math.abs(f);
    let cls, badge;
    if (abs < eps) { cls = 'zero'; badge = '<span class="badge badge-Z">ZERO</span>'; }
    else if (f > 0){ cls = 'pos';  badge = '<span class="badge badge-T">TRAÇÃO</span>'; }
    else            { cls = 'neg'; badge = '<span class="badge badge-C">COMPRESSÃO</span>'; }
    mHtml += `<tr>
      <td style="color:#00cfff">b${i+1}</td>
      <td style="color:#4d7fa8">N${mm.a+1}–N${mm.b+1}</td>
      <td class="res-val ${cls}">${abs < eps ? '0' : fmtForce(f)}</td>
      <td>${badge}</td>
    </tr>`;
  });
  mHtml += '</tbody></table>';

  const zeros = res.memberForces.map((f,i) => Math.abs(f)<eps ? i : -1).filter(i=>i>=0);
  if (zeros.length > 0) {
    mHtml += `<div class="diag-block" style="background:rgba(120,144,156,.1);border:1px solid rgba(120,144,156,.3);color:#78909c;margin-top:6px">
      ⚪ Força zero: ${zeros.map(i=>'b'+(i+1)).join(', ')}
    </div>`;
  }

  // Reaction table
  let rHtml = `<table class="res-table">
    <thead><tr><th>Tipo</th><th>Nó</th><th>Rx</th><th>Ry</th></tr></thead><tbody>`;
  S.supports.forEach(s => {
    const rf = res.reactionForces[s.node] || {x:0, y:0};
    const tx = Math.abs(rf.x)<eps?'zero':rf.x>0?'pos':'neg';
    const ty = Math.abs(rf.y)<eps?'zero':rf.y>0?'pos':'neg';
    const lbl = s.type==='pin' ? 'Pino' : s.type==='roller_h' ? 'Rol.H' : 'Rol.V';
    rHtml += `<tr>
      <td style="color:#ff9800">${lbl}</td>
      <td style="color:#00cfff">N${s.node+1}</td>
      <td class="res-val ${tx}">${fmtVal(rf.x)}</td>
      <td class="res-val ${ty}">${fmtVal(rf.y)}</td>
    </tr>`;
  });
  rHtml += '</tbody></table>';

  // Equilibrium check
  let sFx = 0, sFy = 0;
  S.forces.forEach(f => { sFx += f.fx; sFy += f.fy; });
  Object.values(res.reactionForces).forEach(r => { sFx += r.x; sFy += r.y; });
  const ok = Math.abs(sFx) < 1e-6 && Math.abs(sFy) < 1e-6;
  const eqBlock = `<div class="diag-block ${ok?'ok':'error'}" style="margin-top:8px">
    ${ok ? '✓ Equilíbrio global verificado' : `⚠ Equilíbrio não verificado (ΣFx=${fmtVal(sFx)}, ΣFy=${fmtVal(sFy)})`}
  </div>`;

  const warnings = (res.diagIssues || []).filter(d => d.level === 'warning');

  body.innerHTML = `
    <div class="results-col">
      <div class="results-section-title">Forças nas Barras</div>
      ${mHtml}
    </div>
    <div class="results-col">
      <div class="results-section-title">Reações nos Vínculos</div>
      ${rHtml}
      ${eqBlock}
      ${diagHTML(warnings)}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// DATA MANIPULATION
// ═══════════════════════════════════════════════════════════════════
function addNode(x, y) {
  if (S.nodes.find(n => Math.abs(n.x-x)<0.01 && Math.abs(n.y-y)<0.01)) return;
  S.nodes.push({id: nextId(), x, y});
  invalidate();
}
function removeNode(idx) {
  S.nodes.splice(idx, 1);
  S.members = S.members.filter(m => m.a!==idx && m.b!==idx)
    .map(m => ({...m, a: m.a>idx?m.a-1:m.a, b: m.b>idx?m.b-1:m.b}));
  S.supports = S.supports.filter(s => s.node!==idx)
    .map(s => ({...s, node: s.node>idx?s.node-1:s.node}));
  S.forces = S.forces.filter(f => f.node!==idx)
    .map(f => ({...f, node: f.node>idx?f.node-1:f.node}));
  if (S.pendingMember === idx) S.pendingMember = null;
  else if (S.pendingMember > idx) S.pendingMember--;
  invalidate();
}
function addMember(a, b) {
  if (a === b) return;
  if (S.members.find(m => (m.a===a&&m.b===b)||(m.a===b&&m.b===a))) return;
  const na = S.nodes[a], nb = S.nodes[b];
  if (!na || !nb || Math.hypot(nb.x-na.x, nb.y-na.y) < 1e-12) return;
  S.members.push({id: nextId(), a, b});
  invalidate();
}
function removeMember(idx) { S.members.splice(idx, 1); invalidate(); }
function addSupport(nodeIdx, type) {
  const dup = S.supports.find(s => s.node === nodeIdx);
  if (dup) dup.type = type; else S.supports.push({id: nextId(), node: nodeIdx, type});
  invalidate();
}
function removeSupport(idx) { S.supports.splice(idx, 1); invalidate(); }
function addForce(nodeIdx, fx, fy) { S.forces.push({id: nextId(), node: nodeIdx, fx, fy}); invalidate(); }
function removeForce(idx) { S.forces.splice(idx, 1); invalidate(); }
function setSupportType(t) { S.supportType = t; updateSidebar(); }

function invalidate() {
  S.results = null;
  checkCrossings();
  updateSidebar();
  render();
}

function clearAll() {
  if (!confirm('Limpar toda a estrutura?')) return;
  Object.assign(S, {nodes:[], members:[], supports:[], forces:[],
    pendingMember: null, results: null, crossings: []});
  document.getElementById('results-panel').classList.remove('visible');
  document.getElementById('crossing-warning').classList.remove('visible');
  updateSidebar();
  render();
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS INTERACTION
// ═══════════════════════════════════════════════════════════════════
function getNodeNear(wx, wy, tol) {
  tol = tol || 0.5;
  let best = -1, bestD = tol;
  S.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x-wx, n.y-wy);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    S.panning = true;
    S.panSX = e.clientX; S.panSY = e.clientY;
    S.panOX = S.originX; S.panOY = S.originY;
    canvas.style.cursor = 'grabbing'; return;
  }
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const [wx, wy] = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const [sx, sy] = snapToGrid(wx, wy);

  if (S.mode === 'node') {
    addNode(sx, sy);
  }
  else if (S.mode === 'member') {
    const ni = getNodeNear(wx, wy);
    if (ni < 0) return;
    if (S.pendingMember === null) {
      S.pendingMember = ni; updateSidebar(); render();
    } else {
      addMember(S.pendingMember, ni);
      S.pendingMember = null;
    }
  }
  else if (S.mode === 'support') {
    const ni = getNodeNear(wx, wy);
    if (ni >= 0) addSupport(ni, S.supportType);
  }
  else if (S.mode === 'force') {
    const ni = getNodeNear(wx, wy);
    if (ni >= 0) {
      const sel = document.getElementById('force-node');
      if (sel) sel.value = ni;
    }
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;

  if (S.panning) {
    const dx = (e.clientX - S.panSX) / S.scale;
    const dy = (e.clientY - S.panSY) / S.scale;
    S.originX = S.panOX - dx; S.originY = S.panOY + dy;
    render(); return;
  }

  const [wx, wy] = canvasToWorld(cx, cy);
  const [sx, sy] = snapToGrid(wx, wy);
  const coord = document.getElementById('coord-display');
  if (coord) coord.textContent = `x: ${sx.toFixed(0)} | y: ${sy.toFixed(0)}`;

  S._mouseCanvas = [cx, cy];
  if (S.pendingMember !== null) render();
});

canvas.addEventListener('mouseup', () => {
  if (S.panning) { S.panning = false; canvas.style.cursor = 'crosshair'; }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const [wx0, wy0] = canvasToWorld(mx, my);
  S.scale = Math.min(Math.max(S.scale * (e.deltaY < 0 ? 1.12 : 0.89), 12), 500);
  const [cx, cy] = worldToCanvas(wx0, wy0);
  S.originX += (cx - mx) / S.scale;
  S.originY -= (cy - my) / S.scale;
  render();
}, {passive: false});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.pendingMember !== null) {
    S.pendingMember = null; updateSidebar(); render();
  }
});

// ═══════════════════════════════════════════════════════════════════
// TOOLBAR BUTTONS
// ═══════════════════════════════════════════════════════════════════
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    S.mode = btn.dataset.mode;
    S.pendingMember = null;
    document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSidebar(); render();
  });
});

document.getElementById('btn-analyze').addEventListener('click', () => {
  if (S.crossings.length > 0) {
    alert('Existem barras se cruzando. Corrija antes de analisar.'); return;
  }
  S.results = solveTruss();
  showResults(S.results);
  render();
});

document.getElementById('btn-clear').addEventListener('click', clearAll);

document.getElementById('results-close').addEventListener('click', () => {
  document.getElementById('results-panel').classList.remove('visible');
  render();
});

document.getElementById('btn-zoom-in' ).addEventListener('click', () => { S.scale = Math.min(S.scale*1.25,500); render(); });
document.getElementById('btn-zoom-out').addEventListener('click', () => { S.scale = Math.max(S.scale*0.8, 12); render(); });
document.getElementById('btn-reset-view').addEventListener('click', () => { S.originX=0; S.originY=0; S.scale=70; render(); });
document.getElementById('snap-grid').addEventListener('change', e => { S.snapGrid = e.target.checked; });

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateSidebar();
