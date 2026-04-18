// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const S = {
  nodes:    [],   // {id, x, y}
  members:  [],   // {id, a, b}  (node indices)
  supports: [],   // {id, node, type: 'pin'|'roller_h'|'roller_v'}
  forces:   [],   // {id, node, fx, fy}

  mode:           'node',
  pendingMember:  null,   // first node selected for member
  supportType:    'pin',
  results:        null,
  crossings:      [],

  // canvas view
  originX: 0, originY: 0,  // world coords at canvas center
  scale:   70,              // px per unit
  panning: false,
  panSX: 0, panSY: 0, panOX: 0, panOY: 0,
  snapGrid: true,
  idCounter: 0,
};

function nextId() { return ++S.idCounter; }

// ═══════════════════════════════════════════════════════════════════
// COORDINATE TRANSFORMS
// ═══════════════════════════════════════════════════════════════════
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function worldToCanvas(wx, wy) {
  const cx = (wx - S.originX) * S.scale + canvas.width  / 2;
  const cy = -(wy - S.originY) * S.scale + canvas.height / 2;
  return [cx, cy];
}

function canvasToWorld(cx, cy) {
  const wx = (cx - canvas.width  / 2) / S.scale + S.originX;
  const wy = -((cy - canvas.height / 2) / S.scale) + S.originY;
  return [wx, wy];
}

function snapToGrid(wx, wy) {
  if (!S.snapGrid) return [wx, wy];
  const step = 1;
  return [Math.round(wx / step) * step, Math.round(wy / step) * step];
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
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawGrid(W, H);
  drawMembers();
  drawSupports();
  drawForces();
  drawNodes();
  if (S.pendingMember !== null) drawPendingMember();
}

function drawGrid(W, H) {
  const minStep = 30;
  let step = S.scale;
  while (step < minStep) step *= 2;
  while (step > minStep * 5) step /= 2;

  const [wx0, wy0] = canvasToWorld(0, H);
  const [wx1, wy1] = canvasToWorld(W, 0);

  ctx.lineWidth = .5;

  const startX = Math.floor(wx0 / (step / S.scale)) * (step / S.scale);
  const startY = Math.floor(wy0 / (step / S.scale)) * (step / S.scale);
  const worldStep = step / S.scale;

  for (let wx = startX; wx <= wx1 + worldStep; wx += worldStep) {
    const [cx] = worldToCanvas(wx, 0);
    const isAxis = Math.abs(wx) < 0.001;
    ctx.strokeStyle = isAxis ? 'rgba(0,207,255,.25)' : 'rgba(26,51,85,.9)';
    ctx.lineWidth = isAxis ? 1 : .5;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
    ctx.stroke();
  }
  for (let wy = startY; wy <= wy1 + worldStep; wy += worldStep) {
    const [, cy] = worldToCanvas(0, wy);
    const isAxis = Math.abs(wy) < 0.001;
    ctx.strokeStyle = isAxis ? 'rgba(0,207,255,.25)' : 'rgba(26,51,85,.9)';
    ctx.lineWidth = isAxis ? 1 : .5;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
    ctx.stroke();
  }

  // Axis labels near axis
  ctx.fillStyle = 'rgba(0,207,255,.35)';
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let wx = startX; wx <= wx1 + worldStep; wx += worldStep) {
    if (Math.abs(wx) < 0.001) continue;
    const [cx] = worldToCanvas(wx, 0);
    const [, cy0] = worldToCanvas(0, 0);
    const labelY = Math.min(Math.max(cy0 + 4, 2), H - 14);
    ctx.fillText(fmtCoord(wx), cx, labelY);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let wy = startY; wy <= wy1 + worldStep; wy += worldStep) {
    if (Math.abs(wy) < 0.001) continue;
    const [, cy] = worldToCanvas(0, wy);
    const [cx0] = worldToCanvas(0, 0);
    const labelX = Math.min(Math.max(cx0 - 4, 24), W - 2);
    ctx.fillText(fmtCoord(wy), labelX, cy);
  }
}

function fmtCoord(v) {
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1).replace(/\.0$/, '');
}

function memberColor(idx) {
  if (!S.results || !S.results.memberForces) return 'rgba(0,136,204,.7)';
  const f = S.results.memberForces[idx];
  const eps = 1e-6;
  if (Math.abs(f) < eps) return 'var(--zero)';
  return f > 0 ? 'var(--tension)' : 'var(--compress)';
}

function drawMembers() {
  S.members.forEach((m, idx) => {
    const na = S.nodes[m.a], nb = S.nodes[m.b];
    if (!na || !nb) return;
    const [x1, y1] = worldToCanvas(na.x, na.y);
    const [x2, y2] = worldToCanvas(nb.x, nb.y);

    const isCrossing = S.crossings.some(c => c.includes(idx));

    ctx.lineWidth = 3;
    ctx.strokeStyle = isCrossing ? 'var(--warn)' : memberColor(idx);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    // Label
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (S.results && S.results.memberForces) {
      const f = S.results.memberForces[idx];
      const eps = 1e-6;
      const label = Math.abs(f) < eps ? '0' : fmtForce(Math.abs(f));
      ctx.font = 'bold 11px JetBrains Mono';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(label, mx, my - 4);
      ctx.fillStyle = memberColor(idx);
      ctx.fillText(label, mx, my - 4);
    } else {
      ctx.font = '10px JetBrains Mono';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,207,255,.5)';
      ctx.fillText('b' + (idx + 1), mx, my);
    }
  });
}

function drawPendingMember() {
  const na = S.nodes[S.pendingMember];
  if (!na) return;
  const [x1, y1] = worldToCanvas(na.x, na.y);
  const [mx, my] = S._mouseCanvas || [x1, y1];
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,207,255,.4)';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(mx, my); ctx.stroke();
  ctx.setLineDash([]);
}

function drawSupport(sx, sy, type, reactionX, reactionY) {
  const sz = 14;
  ctx.save();

  if (type === 'pin') {
    // Triangle pointing down
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - sz, sy + sz * 1.3);
    ctx.lineTo(sx + sz, sy + sz * 1.3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,152,0,.15)';
    ctx.strokeStyle = 'var(--support)';
    ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    // Hatch below
    for (let i = -sz; i <= sz; i += 5) {
      ctx.beginPath();
      ctx.moveTo(sx - sz + i, sy + sz * 1.3);
      ctx.lineTo(sx - sz + i - 5, sy + sz * 1.3 + 7);
      ctx.strokeStyle = 'rgba(255,152,0,.4)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // Fixed line
    ctx.beginPath();
    ctx.moveTo(sx - sz - 3, sy + sz * 1.3);
    ctx.lineTo(sx + sz + 3, sy + sz * 1.3);
    ctx.strokeStyle = 'var(--support)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  else if (type === 'roller_h') {
    // Triangle + circles below (free in x, fixed in y)
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - sz, sy + sz * 1.3);
    ctx.lineTo(sx + sz, sy + sz * 1.3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,152,0,.15)';
    ctx.strokeStyle = 'var(--support)';
    ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    // Rollers
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(sx + i * sz * 0.7, sy + sz * 1.3 + 5, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,152,0,.25)';
      ctx.strokeStyle = 'var(--support)'; ctx.lineWidth = 1;
      ctx.fill(); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(sx - sz - 3, sy + sz * 1.3 + 10);
    ctx.lineTo(sx + sz + 3, sy + sz * 1.3 + 10);
    ctx.strokeStyle = 'rgba(255,152,0,.4)'; ctx.lineWidth = 1; ctx.stroke();
  }
  else if (type === 'roller_v') {
    // Sideways triangle + circles to the right (free in y, fixed in x)
    ctx.translate(sx, sy);
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-sz, sz * 1.3);
    ctx.lineTo(sz, sz * 1.3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,152,0,.15)';
    ctx.strokeStyle = 'var(--support)';
    ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(i * sz * 0.7, sz * 1.3 + 5, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,152,0,.25)';
      ctx.strokeStyle = 'var(--support)'; ctx.lineWidth = 1;
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();

  // Reaction arrows
  if (S.results && S.results.reactionForces) {
    const rf = S.results.reactionForces;
    const nodeIdx = S.supports.find(s => {
      const [scx, scy] = worldToCanvas(S.nodes[s.node].x, S.nodes[s.node].y);
      return Math.abs(scx - sx) < 1 && Math.abs(scy - sy) < 1;
    });
    // drawn in drawNodes via separate call, skip here
  }
}

function drawSupports() {
  S.supports.forEach(s => {
    const n = S.nodes[s.node];
    if (!n) return;
    const [cx, cy] = worldToCanvas(n.x, n.y);
    drawSupport(cx, cy, s.type);
  });
}

function drawArrow(x1, y1, x2, y2, color, lw = 2, headLen = 10) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - 0.35), y2 - headLen * Math.sin(angle - 0.35));
  ctx.lineTo(x2 - headLen * Math.cos(angle + 0.35), y2 - headLen * Math.sin(angle + 0.35));
  ctx.closePath(); ctx.fill();
}

function drawForces() {
  const scale = Math.min(S.scale * 0.8, 50);
  const maxF = Math.max(...S.forces.map(f => Math.hypot(f.fx, f.fy)), 1);

  S.forces.forEach(f => {
    const n = S.nodes[f.node];
    if (!n) return;
    const [cx, cy] = worldToCanvas(n.x, n.y);
    const mag = Math.hypot(f.fx, f.fy);
    if (mag < 1e-12) return;
    const ratio = mag / maxF;
    const arrowLen = Math.max(30, scale * ratio);
    const ux = f.fx / mag, uy = -f.fy / mag;
    // Draw from tip toward node
    drawArrow(cx - ux * arrowLen, cy - uy * arrowLen, cx, cy, 'var(--force-clr)', 2, 9);

    // Label
    ctx.font = 'bold 10px JetBrains Mono';
    ctx.fillStyle = 'var(--force-clr)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lx = cx - ux * (arrowLen / 2);
    const ly = cy - uy * (arrowLen / 2);
    ctx.fillText(fmtForce(mag), lx + uy * 10, ly + ux * 10);
  });

  // Reaction force arrows
  if (S.results && S.results.reactionForces) {
    const rf = S.results.reactionForces;
    S.supports.forEach(s => {
      const n = S.nodes[s.node];
      if (!n) return;
      const [cx, cy] = worldToCanvas(n.x, n.y);
      const r = rf[s.node] || {x: 0, y: 0};
      const magX = Math.abs(r.x), magY = Math.abs(r.y);
      const maxR = Math.max(...Object.values(rf).map(v => Math.max(Math.abs(v.x), Math.abs(v.y))), 1);
      const rscale = Math.max(30, scale);

      if (magX > 1e-6) {
        const len = Math.max(20, rscale * magX / maxR);
        const sx = cx + (r.x > 0 ? -1 : 1) * len, sy = cy;
        drawArrow(sx, sy, cx, cy, 'rgba(255,152,0,.8)', 2, 8);
        ctx.font = '9px JetBrains Mono';
        ctx.fillStyle = 'var(--support)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(fmtForce(magX), (sx + cx) / 2, cy - 6);
      }
      if (magY > 1e-6) {
        const len = Math.max(20, rscale * magY / maxR);
        const ey = cy + (r.y > 0 ? 1 : -1) * len, ex = cx;
        drawArrow(cx, ey, cx, cy, 'rgba(255,152,0,.8)', 2, 8);
        ctx.font = '9px JetBrains Mono';
        ctx.fillStyle = 'var(--support)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(fmtForce(magY), cx + 6, (ey + cy) / 2);
      }
    });
  }
}

function drawNodes() {
  // Collect highlighted nodes from diagnostics
  const diagNodes = new Set();
  if (S.results && S.results.diagIssues) {
    S.results.diagIssues.forEach(d => d.nodes && d.nodes.forEach(i => diagNodes.add(i)));
  }

  S.nodes.forEach((n, idx) => {
    const [cx, cy] = worldToCanvas(n.x, n.y);
    const isSelected = S.pendingMember === idx;
    const isProblem  = diagNodes.has(idx);
    const r = isSelected ? 9 : 7;

    if (isSelected) {
      ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,207,255,.12)'; ctx.fill();
    }
    if (isProblem) {
      ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,82,82,.12)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,82,82,.6)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
    }

    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? 'var(--accent)' : isProblem ? 'rgba(255,82,82,.2)' : 'var(--panel)';
    ctx.strokeStyle = isSelected ? '#fff' : isProblem ? 'var(--warn)' : 'var(--accent)';
    ctx.lineWidth = isSelected ? 2 : 1.5;
    ctx.fill(); ctx.stroke();

    ctx.font = 'bold 10px Rajdhani';
    ctx.fillStyle = isSelected ? '#001a2e' : isProblem ? 'var(--warn)' : 'var(--accent)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(idx + 1, cx, cy);

    ctx.font = '9px JetBrains Mono';
    ctx.fillStyle = 'rgba(0,207,255,.55)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`(${fmtCoord(n.x)},${fmtCoord(n.y)})`, cx + 9, cy - 4);
  });
}

// ═══════════════════════════════════════════════════════════════════
// GEOMETRY – CROSSING DETECTION
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
      // Skip if they share a node
      if (mi.a === mj.a || mi.a === mj.b || mi.b === mj.a || mi.b === mj.b) continue;
      const ni = S.nodes, p1 = ni[mi.a], p2 = ni[mi.b], p3 = ni[mj.a], p4 = ni[mj.b];
      if (p1 && p2 && p3 && p4 && segmentsProperlyIntersect(p1, p2, p3, p4)) {
        S.crossings.push([i, j]);
      }
    }
  }
  const warn = document.getElementById('crossing-warning');
  if (S.crossings.length > 0) {
    const pairs = S.crossings.map(([a, b]) => `b${a+1}×b${b+1}`).join(', ');
    warn.textContent = `⚠ Cruzamento detectado: ${pairs}`;
    warn.classList.add('visible');
  } else {
    warn.classList.remove('visible');
  }
}

// ═══════════════════════════════════════════════════════════════════
// TRUSS SOLVER – Method of Joints
// ═══════════════════════════════════════════════════════════════════
function gaussianElim(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let p = 0; p < n; p++) {
    let maxIdx = p;
    for (let i = p + 1; i < n; i++)
      if (Math.abs(M[i][p]) > Math.abs(M[maxIdx][p])) maxIdx = i;
    [M[p], M[maxIdx]] = [M[maxIdx], M[p]];
    const pv = M[p][p];
    if (Math.abs(pv) < 1e-10) return { sol: null, singularRow: p };
    for (let i = 0; i < n; i++) {
      if (i === p) continue;
      const f = M[i][p] / pv;
      for (let k = p; k <= n; k++) M[i][k] -= f * M[p][k];
    }
  }
  return { sol: M.map((row, i) => row[n] / row[i]), singularRow: -1 };
}

// ─── Structural Diagnostics ───────────────────────────────────────
function buildAdjacency(ns, ms) {
  const adj = Array.from({length: ns.length}, () => new Set());
  ms.forEach(m => { adj[m.a].add(m.b); adj[m.b].add(m.a); });
  return adj;
}

/** Find quadrilateral panels with no diagonal (internal mechanisms). */
function findRectPanels(ns, ms) {
  const adj = buildAdjacency(ns, ms);
  const hasEdge = (a, b) => adj[a].has(b);
  const panels = [], seen = new Set();

  for (let a = 0; a < ns.length; a++) {
    for (let b = a + 1; b < ns.length; b++) {
      if (hasEdge(a, b)) continue; // adjacent → skip
      const common = [...adj[a]].filter(x => adj[b].has(x));
      for (let i = 0; i < common.length; i++) {
        for (let j = i + 1; j < common.length; j++) {
          const c = common[i], d = common[j];
          if (!hasEdge(c, d)) {  // quadrilateral a-c-b-d-a, no diagonals
            const key = [a, b, c, d].sort((x,y) => x-y).join('-');
            if (!seen.has(key)) {
              seen.add(key);
              panels.push([a, c, b, d]);
            }
          }
        }
      }
    }
  }
  return panels;
}

/** Check for nodes connected by only collinear members (no transverse resistance). */
function findCollinearNodes(ns, ms, sups) {
  const supNodes = new Set(sups.map(s => s.node));
  const adj = buildAdjacency(ns, ms);
  const problems = [];
  ns.forEach((n, i) => {
    if (supNodes.has(i)) return;
    const nbrs = [...adj[i]];
    if (nbrs.length < 2) return;
    // Compute angles of all connected members
    const angles = nbrs.map(j => {
      const dx = ns[j].x - n.x, dy = ns[j].y - n.y;
      return Math.atan2(dy, dx);
    });
    // Check if all angles are collinear (parallel or anti-parallel)
    const a0 = angles[0];
    const allCollinear = angles.every(a => {
      const diff = Math.abs(a - a0) % Math.PI;
      return diff < 0.001 || Math.abs(diff - Math.PI) < 0.001;
    });
    if (allCollinear) problems.push(i);
  });
  return problems;
}

/** Full diagnostic: returns array of {level, msg, nodes} */
function diagnoseStructure() {
  const {nodes: ns, members: ms, supports: sups} = S;
  const issues = [];
  const adj = buildAdjacency(ns, ms);

  // 1. Isolated nodes
  ns.forEach((n, i) => {
    if (adj[i].size === 0) issues.push({level:'error', msg:`Nó N${i+1} não está conectado a nenhuma barra.`, nodes:[i]});
  });

  // 2. Rectangular panels without diagonal
  const panels = findRectPanels(ns, ms);
  panels.forEach(p => {
    const labels = p.map(i => `N${i+1}`).join('–');
    issues.push({
      level: 'error',
      msg: `Painel retangular sem diagonal: ${labels}. Adicione uma barra diagonal neste painel.`,
      nodes: p
    });
  });

  // 3. Collinear-only nodes (can't resist transverse forces)
  const collinear = findCollinearNodes(ns, ms, sups);
  collinear.forEach(i => {
    issues.push({
      level: 'warning',
      msg: `Nó N${i+1}: todas as barras conectadas são colineares (nó não resiste a forças transversais).`,
      nodes: [i]
    });
  });

  // 4. Support count check
  const r = sups.reduce((acc, s) => acc + (s.type === 'pin' ? 2 : 1), 0);
  if (r < 3) issues.push({level:'warning', msg:`Vínculos insuficientes (${r} reações). Uma treliça plana precisa de no mínimo 3 componentes de reação.`, nodes:[]});

  // 5. Two pins at same height (Rx indeterminate warning)
  const pins = sups.filter(s => s.type === 'pin');
  if (pins.length >= 2) {
    const ys = pins.map(s => ns[s.node].y);
    const allSameY = ys.every(y => Math.abs(y - ys[0]) < 0.001);
    if (allSameY) issues.push({level:'warning', msg:'Dois pinos na mesma altura: as reações horizontais são indeterminadas. Considere substituir um pino por um rolete.', nodes: pins.map(s => s.node)});
  }

  return issues;
}

function solveTruss() {
  const { nodes: ns, members: ms, supports: sups, forces: fs } = S;
  const n = ns.length, m = ms.length;

  if (n < 2) return { error: 'São necessários pelo menos 2 nós.' };
  if (m < 1) return { error: 'São necessárias pelo menos 1 barra.' };
  if (sups.length < 1) return { error: 'Nenhum vínculo definido.' };

  // Run structural diagnostics first
  const diagIssues = diagnoseStructure();
  const errors = diagIssues.filter(d => d.level === 'error');
  const warnings = diagIssues.filter(d => d.level === 'warning');

  // Build reactions list
  const reactions = [];
  sups.forEach(s => {
    if (s.type === 'pin')           { reactions.push({node: s.node, dir: 'x'}); reactions.push({node: s.node, dir: 'y'}); }
    else if (s.type === 'roller_h') reactions.push({node: s.node, dir: 'y'});
    else if (s.type === 'roller_v') reactions.push({node: s.node, dir: 'x'});
  });

  const r = reactions.length;
  const totalUnk = m + r;
  const totalEq  = 2 * n;

  if (totalUnk !== totalEq) {
    const diff = totalUnk - totalEq;
    const base = diff > 0
      ? `Treliça hiperestática (grau ${diff}): ${totalUnk} incógnitas para ${totalEq} equações.`
      : `Treliça instável (${-diff} grau(s) de liberdade): apenas ${totalUnk} incógnitas para ${totalEq} equações.`;
    const hint = diff > 0
      ? 'Remova barras ou restrições, ou adicione nós.'
      : 'Adicione barras diagonais ou restrições de vínculo.';
    return { error: `${base} ${hint}`, diagIssues };
  }

  const A = Array.from({length: totalEq}, () => new Array(totalUnk).fill(0));
  const b = new Array(totalEq).fill(0);

  ms.forEach((mem, j) => {
    const na = ns[mem.a], nb = ns[mem.b];
    const dx = nb.x - na.x, dy = nb.y - na.y;
    const L = Math.hypot(dx, dy);
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
    b[2 * i] = -ap.fx; b[2 * i + 1] = -ap.fy;
  }

  const {sol, singularRow} = gaussianElim(A, b);
  if (!sol) {
    // Build a rich error using diagnostics
    let errMsg = 'Sistema singular – a treliça é um mecanismo (geometria instável).';
    if (errors.length > 0) {
      errMsg = errors.map(e => e.msg).join(' | ');
    } else if (singularRow >= 0) {
      const nodeIdx = Math.floor(singularRow / 2);
      const dir = singularRow % 2 === 0 ? 'horizontal' : 'vertical';
      errMsg += ` Problema detectado no equilíbrio ${dir} do nó N${nodeIdx+1}.`;
    }
    return { error: errMsg, diagIssues };
  }

  const memberForces = sol.slice(0, m);
  const reactionForces = {};
  reactions.forEach((rx, ri) => {
    if (!reactionForces[rx.node]) reactionForces[rx.node] = {x: 0, y: 0};
    reactionForces[rx.node][rx.dir] = sol[m + ri];
  });

  return { memberForces, reactionForces, diagIssues: warnings };
}

// ═══════════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════
function fmtForce(v) {
  const abs = Math.abs(v);
  if (abs >= 10000) return (v / 1000).toFixed(2) + 'k';
  if (abs >= 1000) return (v / 1000).toFixed(3) + 'k';
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10)  return v.toFixed(2);
  return v.toFixed(3);
}
function fmtVal(v) {
  if (Math.abs(v) < 1e-6) return '0';
  return fmtForce(v);
}

// ═══════════════════════════════════════════════════════════════════
// UI – SIDEBAR
// ═══════════════════════════════════════════════════════════════════
function updateSidebar() {
  const el = document.getElementById('sidebar-content');
  let html = '';

  if (S.mode === 'node') {
    html += `
    <div class="sb-section">
      <div class="sb-title">Adicionar Nó</div>
      <div class="sb-hint"><b>Clique no canvas</b> para posicionar ou insira coordenadas:</div>
      <div style="height:8px"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">X</label><input class="form-input" id="node-x" type="number" step="0.5" placeholder="0"></div>
        <div class="form-group"><label class="form-label">Y</label><input class="form-input" id="node-y" type="number" step="0.5" placeholder="0"></div>
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
            <span style="font-size:10px;color:var(--muted)">(${fmtCoord(n.x)}, ${fmtCoord(n.y)})</span>
            <button class="list-item-del" onclick="removeNode(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  else if (S.mode === 'member') {
    const hint = S.pendingMember !== null
      ? `Nó <b>N${S.pendingMember+1}</b> selecionado. Clique no segundo nó.`
      : '<b>Clique em dois nós</b> sequencialmente para criar uma barra.';
    html += `
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
            <span style="font-size:10px;color:var(--muted)">N${m.a+1}–N${m.b+1}</span>
            <button class="list-item-del" onclick="removeMember(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  else if (S.mode === 'support') {
    html += `
    <div class="sb-section">
      <div class="sb-title">Tipo de Vínculo</div>
      <div class="support-type-group">
        <button class="support-type-btn ${S.supportType==='pin'?'active':''}" onclick="setSupportType('pin')">
          <span class="support-icon">▽</span> Pino (Rx + Ry)
        </button>
        <button class="support-type-btn ${S.supportType==='roller_h'?'active':''}" onclick="setSupportType('roller_h')">
          <span class="support-icon">◇</span> Rolete Horiz. (Ry)
        </button>
        <button class="support-type-btn ${S.supportType==='roller_v'?'active':''}" onclick="setSupportType('roller_v')">
          <span class="support-icon">◁</span> Rolete Vert. (Rx)
        </button>
      </div>
      <div class="sb-hint"><b>Clique em um nó</b> para aplicar o vínculo selecionado.</div>
    </div>
    <div class="sb-section">
      <div class="sb-title">Vínculos (${S.supports.length})</div>
      <div class="item-list">
        ${S.supports.length === 0 ? '<div class="sb-empty">Nenhum vínculo definido</div>' :
          S.supports.map((s, i) => `
          <div class="list-item">
            <span class="list-item-label">N${s.node+1}</span>
            <span style="font-size:10px;color:var(--muted)">${s.type==='pin'?'Pino':s.type==='roller_h'?'Rol.H':'Rol.V'}</span>
            <button class="list-item-del" onclick="removeSupport(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  else if (S.mode === 'force') {
    html += `
    <div class="sb-section">
      <div class="sb-title">Aplicar Força</div>
      <div class="sb-hint"><b>Selecione o nó</b> e informe as componentes:</div>
      <div style="height:8px"></div>
      <div class="form-group">
        <label class="form-label">Nó</label>
        <select class="form-input" id="force-node">
          <option value="">-- selecione --</option>
          ${S.nodes.map((n,i) => `<option value="${i}">N${i+1} (${fmtCoord(n.x)},${fmtCoord(n.y)})</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fx</label><input class="form-input" id="force-fx" type="number" step="1" placeholder="0"></div>
        <div class="form-group"><label class="form-label">Fy</label><input class="form-input" id="force-fy" type="number" step="1" placeholder="0"></div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:6px">+ direita / + cima</div>
      <button class="btn-add" id="btn-add-force">+ ADICIONAR FORÇA</button>
    </div>
    <div class="sb-section">
      <div class="sb-title">Forças (${S.forces.length})</div>
      <div class="item-list">
        ${S.forces.length === 0 ? '<div class="sb-empty">Nenhuma força definida</div>' :
          S.forces.map((f, i) => `
          <div class="list-item">
            <span class="list-item-label">N${f.node+1}</span>
            <span style="font-size:10px;color:var(--muted)">Fx=${fmtVal(f.fx)} Fy=${fmtVal(f.fy)}</span>
            <button class="list-item-del" onclick="removeForce(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  el.innerHTML = html;
  bindSidebarEvents();
  updateStatusBar();
}

function bindSidebarEvents() {
  document.getElementById('btn-add-node')?.addEventListener('click', () => {
    const x = parseFloat(document.getElementById('node-x').value) || 0;
    const y = parseFloat(document.getElementById('node-y').value) || 0;
    addNode(x, y);
  });
  document.getElementById('btn-add-force')?.addEventListener('click', () => {
    const nodeIdx = parseInt(document.getElementById('force-node').value);
    const fx = parseFloat(document.getElementById('force-fx').value) || 0;
    const fy = parseFloat(document.getElementById('force-fy').value) || 0;
    if (isNaN(nodeIdx)) { alert('Selecione um nó.'); return; }
    if (fx === 0 && fy === 0) { alert('A força não pode ser zero.'); return; }
    addForce(nodeIdx, fx, fy);
  });
}

function updateStatusBar() {
  const n = S.nodes.length, m = S.members.length;
  const sups = S.supports;
  const r = sups.reduce((acc, s) => acc + (s.type === 'pin' ? 2 : 1), 0);
  const totalUnk = m + r;
  const totalEq  = 2 * n;
  const diff = totalUnk - totalEq;

  document.getElementById('stat-nodes').textContent = `N: ${n}`;
  document.getElementById('stat-members').textContent = `b: ${m}`;

  const pill = document.getElementById('stat-det');
  if (n === 0) { pill.textContent = '—'; pill.className = 'stat-pill neutral'; return; }
  if (diff === 0) { pill.textContent = 'Isostática ✓'; pill.className = 'stat-pill ok'; }
  else if (diff > 0) { pill.textContent = `Hiperestática +${diff}`; pill.className = 'stat-pill warn'; }
  else { pill.textContent = `Instável ${diff}`; pill.className = 'stat-pill warn'; }
}

// ═══════════════════════════════════════════════════════════════════
// RESULTS DISPLAY
// ═══════════════════════════════════════════════════════════════════
function renderDiagIssues(issues) {
  if (!issues || issues.length === 0) return '';
  return issues.map(d => `
    <div style="margin-top:5px;padding:5px 8px;background:rgba(${d.level==='error'?'255,82,82':'255,215,64'},.08);
      border:1px solid rgba(${d.level==='error'?'255,82,82':'255,215,64'},.35);
      border-radius:3px;font-size:11px;color:${d.level==='error'?'var(--warn)':'#ffd740'}">
      ${d.level==='error'?'⛔':'⚠'} ${d.msg}
    </div>`).join('');
}

function showResults(res) {
  const panel = document.getElementById('results-panel');
  const body  = document.getElementById('results-body');
  const stxt  = document.getElementById('results-status-text');

  panel.classList.add('visible');

  if (res.error) {
    stxt.textContent = '';
    const diagHtml = renderDiagIssues(res.diagIssues);
    body.innerHTML = `<div style="padding:12px;max-width:800px">
      <div class="results-error">⛔ ${res.error}</div>
      ${diagHtml}
      <div style="margin-top:10px;padding:8px;background:rgba(0,207,255,.05);border:1px solid var(--border2);border-radius:4px;font-size:11px;color:var(--muted)">
        <b style="color:var(--accent)">Como corrigir:</b><br>
        • <b>Painel retangular</b> → adicione uma barra diagonal cortando o painel<br>
        • <b>Nó solto</b> → conecte o nó a pelo menos 2 barras em direções diferentes<br>
        • <b>Dois pinos</b> → substitua um pino por um <b>rolete horizontal</b> (libera Rx)<br>
        • <b>Instável</b> → verifique se a contagem 2n = m + r está correta (n=nós, m=barras, r=reações)
      </div>
    </div>`;
    return;
  }

  stxt.textContent = `${S.members.length} barras · ${S.supports.length} vínculos`;

  const eps = 1e-6;
  let membersHtml = `
    <table class="res-table">
      <thead><tr><th>Barra</th><th>Nós</th><th>Força</th><th>Estado</th></tr></thead>
      <tbody>`;
  res.memberForces.forEach((f, i) => {
    const m = S.members[i];
    const abs = Math.abs(f);
    let type, badge;
    if (abs < eps) { type = 'zero';   badge = '<span class="badge badge-Z">ZERO</span>'; }
    else if (f > 0) { type = 'pos';   badge = '<span class="badge badge-T">TRAÇÃO</span>'; }
    else              { type = 'neg'; badge = '<span class="badge badge-C">COMPRESSÃO</span>'; }
    membersHtml += `<tr>
      <td style="color:var(--accent)">b${i+1}</td>
      <td style="color:var(--muted)">N${m.a+1}–N${m.b+1}</td>
      <td class="res-val ${type}">${abs < eps ? '0' : (f > 0 ? '+' : '') + fmtForce(f)}</td>
      <td>${badge}</td>
    </tr>`;
  });
  membersHtml += '</tbody></table>';

  // Zero-force members warning
  const zeros = res.memberForces.map((f,i)=>Math.abs(f)<eps?i:-1).filter(i=>i>=0);
  if (zeros.length > 0) {
    membersHtml += `<div style="margin-top:6px;padding:5px 8px;background:rgba(96,125,139,.1);border:1px solid rgba(96,125,139,.3);border-radius:3px;font-size:11px;color:var(--zero)">
      ⚪ Barra(s) com força zero: ${zeros.map(i=>'b'+(i+1)).join(', ')}
    </div>`;
  }

  let reactionsHtml = `
    <table class="res-table">
      <thead><tr><th>Vínculo</th><th>Nó</th><th>Rx</th><th>Ry</th></tr></thead>
      <tbody>`;
  S.supports.forEach((s, i) => {
    const rf = res.reactionForces[s.node] || {x:0, y:0};
    const typeLabel = s.type === 'pin' ? 'Pino' : s.type === 'roller_h' ? 'Rol.H' : 'Rol.V';
    reactionsHtml += `<tr>
      <td style="color:var(--support)">${typeLabel}</td>
      <td style="color:var(--accent)">N${s.node+1}</td>
      <td class="res-val ${Math.abs(rf.x)<eps?'zero':rf.x>0?'pos':'neg'}">${fmtVal(rf.x)}</td>
      <td class="res-val ${Math.abs(rf.y)<eps?'zero':rf.y>0?'pos':'neg'}">${fmtVal(rf.y)}</td>
    </tr>`;
  });
  reactionsHtml += '</tbody></table>';

  // Global equilibrium check
  let sumFx = 0, sumFy = 0;
  S.forces.forEach(f => { sumFx += f.fx; sumFy += f.fy; });
  Object.values(res.reactionForces).forEach(r => { sumFx += r.x; sumFy += r.y; });
  const equil = Math.abs(sumFx) < 1e-6 && Math.abs(sumFy) < 1e-6;

  const warningsHtml = renderDiagIssues(res.diagIssues);

  body.innerHTML = `
    <div class="results-col">
      <div class="results-section-title">Forças nas Barras</div>
      ${membersHtml}
    </div>
    <div class="results-col">
      <div class="results-section-title">Reações nos Vínculos</div>
      ${reactionsHtml}
      <div style="margin-top:8px;padding:5px 8px;background:rgba(${equil?'0,230,118':'255,82,82'},.08);border:1px solid rgba(${equil?'0,230,118':'255,82,82'},.3);border-radius:3px;font-size:11px;color:${equil?'var(--tension)':'var(--compress)'}">
        ${equil ? '✓ Equilíbrio global verificado' : '⚠ Equilíbrio não verificado (checar dados)'}
      </div>
      ${warningsHtml}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// DATA MANIPULATION
// ═══════════════════════════════════════════════════════════════════
function addNode(x, y) {
  // Check duplicate
  const dup = S.nodes.find(n => Math.abs(n.x - x) < 0.01 && Math.abs(n.y - y) < 0.01);
  if (dup) { return; }
  S.nodes.push({id: nextId(), x, y});
  S.results = null;
  checkCrossings();
  updateSidebar();
  render();
}
function removeNode(idx) {
  S.nodes.splice(idx, 1);
  // Remove members referencing this node, update indices
  S.members = S.members.filter(m => m.a !== idx && m.b !== idx).map(m => ({
    ...m,
    a: m.a > idx ? m.a - 1 : m.a,
    b: m.b > idx ? m.b - 1 : m.b,
  }));
  S.supports = S.supports.filter(s => s.node !== idx).map(s => ({...s, node: s.node > idx ? s.node - 1 : s.node}));
  S.forces = S.forces.filter(f => f.node !== idx).map(f => ({...f, node: f.node > idx ? f.node - 1 : f.node}));
  if (S.pendingMember === idx) S.pendingMember = null;
  else if (S.pendingMember > idx) S.pendingMember--;
  S.results = null;
  checkCrossings();
  updateSidebar();
  render();
}
function addMember(a, b) {
  if (a === b) return;
  if (S.members.find(m => (m.a===a&&m.b===b)||(m.a===b&&m.b===a))) return;
  const na = S.nodes[a], nb = S.nodes[b];
  if (!na || !nb) return;
  if (Math.hypot(nb.x-na.x, nb.y-na.y) < 1e-12) return;
  S.members.push({id: nextId(), a, b});
  S.results = null;
  checkCrossings();
  updateSidebar();
  render();
}
function removeMember(idx) {
  S.members.splice(idx, 1);
  S.results = null;
  checkCrossings();
  updateSidebar();
  render();
}
function addSupport(nodeIdx, type) {
  const dup = S.supports.find(s => s.node === nodeIdx);
  if (dup) { dup.type = type; }
  else S.supports.push({id: nextId(), node: nodeIdx, type});
  S.results = null;
  updateSidebar();
  render();
}
function removeSupport(idx) {
  S.supports.splice(idx, 1);
  S.results = null;
  updateSidebar();
  render();
}
function addForce(nodeIdx, fx, fy) {
  S.forces.push({id: nextId(), node: nodeIdx, fx, fy});
  S.results = null;
  updateSidebar();
  render();
}
function removeForce(idx) {
  S.forces.splice(idx, 1);
  S.results = null;
  updateSidebar();
  render();
}
function setSupportType(t) { S.supportType = t; updateSidebar(); }

function clearAll() {
  if (!confirm('Limpar tudo?')) return;
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
function getNodeNear(wx, wy, tol = 0.4) {
  let best = -1, bestDist = tol;
  S.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    S.panning = true;
    S.panSX = e.clientX; S.panSY = e.clientY;
    S.panOX = S.originX; S.panOY = S.originY;
    canvas.style.cursor = 'grabbing';
    return;
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
      S.pendingMember = ni;
      updateSidebar();
      render();
    } else {
      addMember(S.pendingMember, ni);
      S.pendingMember = null;
      updateSidebar();
      render();
    }
  }
  else if (S.mode === 'support') {
    const ni = getNodeNear(wx, wy);
    if (ni >= 0) addSupport(ni, S.supportType);
  }
  else if (S.mode === 'force') {
    const ni = getNodeNear(wx, wy);
    if (ni < 0) return;
    document.getElementById('force-node').value = ni;
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;

  if (S.panning) {
    const dx = (e.clientX - S.panSX) / S.scale;
    const dy = (e.clientY - S.panSY) / S.scale;
    S.originX = S.panOX - dx;
    S.originY = S.panOY + dy;
    render();
    return;
  }

  const [wx, wy] = canvasToWorld(cx, cy);
  const [sx, sy] = snapToGrid(wx, wy);
  document.getElementById('coord-display').textContent =
    `x: ${sx.toFixed(2)} | y: ${sy.toFixed(2)}`;

  S._mouseCanvas = [cx, cy];
  if (S.pendingMember !== null) render();
});

canvas.addEventListener('mouseup', e => {
  if (S.panning) {
    S.panning = false;
    canvas.style.cursor = 'crosshair';
  }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const [wx0, wy0] = canvasToWorld(mx, my);
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  S.scale = Math.min(Math.max(S.scale * factor, 15), 400);
  // Keep mouse world coord fixed
  const [cx, cy] = worldToCanvas(wx0, wy0);
  S.originX += (cx - mx) / S.scale;
  S.originY -= (cy - my) / S.scale;
  render();
}, {passive: false});

// Keyboard: Escape cancels pending
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.pendingMember !== null) {
    S.pendingMember = null;
    updateSidebar();
    render();
  }
});

// ═══════════════════════════════════════════════════════════════════
// TOOLBAR BUTTONS
// ═══════════════════════════════════════════════════════════════════
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    S.mode = mode;
    S.pendingMember = null;
    document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSidebar();
    render();
  });
});

document.getElementById('btn-analyze').addEventListener('click', () => {
  if (S.crossings.length > 0) {
    alert('Existem barras se cruzando. Corrija antes de analisar.');
    return;
  }
  S.results = solveTruss();
  showResults(S.results);
  render();
});

document.getElementById('btn-clear').addEventListener('click', clearAll);

document.getElementById('results-close').addEventListener('click', () => {
  document.getElementById('results-panel').classList.remove('visible');
});

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  S.scale = Math.min(S.scale * 1.25, 400); render();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  S.scale = Math.max(S.scale * 0.8, 15); render();
});
document.getElementById('btn-reset-view').addEventListener('click', () => {
  S.originX = 0; S.originY = 0; S.scale = 70; render();
});
document.getElementById('snap-grid').addEventListener('change', e => {
  S.snapGrid = e.target.checked;
});

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateSidebar();

// Demo: simple triangle truss
function loadDemo() {
  addNode(0, 0);
  addNode(4, 0);
  addNode(2, 2);
  addMember(0, 1);
  addMember(0, 2);
  addMember(1, 2);
  addSupport(0, 'pin');
  addSupport(1, 'roller_h');
  addForce(2, 0, -10);
}
// loadDemo(); // Uncomment to auto-load demo on open