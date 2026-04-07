// ── Tron grid background ──────────────────────────────────────
(function initGrid() {
  const canvas = document.getElementById('grid-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  function draw() {
    ctx.clearRect(0,0,W,H);
    const sp = 48;
    ctx.strokeStyle = 'rgba(0,200,220,0.07)';
    ctx.lineWidth = 1;
    for (let x=0;x<W;x+=sp){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for (let y=0;y<H;y+=sp){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    const g = ctx.createRadialGradient(W/2,H,0,W/2,H,H*0.85);
    g.addColorStop(0,'rgba(0,240,255,0.06)');
    g.addColorStop(0.5,'rgba(0,100,130,0.03)');
    g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }
  window.addEventListener('resize',()=>{resize();draw();});
  resize(); draw();
})();

// ── Constants ─────────────────────────────────────────────────
const GRID  = 8;
const SHIPS = [
  { name: 'Carrier',    size: 4 },
  { name: 'Battleship', size: 3 },
  { name: 'Cruiser',    size: 3 },
  { name: 'Destroyer',  size: 2 },
  { name: 'Submarine',  size: 2 }
];

// ── Game state ────────────────────────────────────────────────
let playerBoard    = [];
let playerShips    = [];
let aiShips        = [];
let aiHitsOnPlayer = [];
let aiMissOnPlayer = [];
let aiSunkOnPlayer = [];
let playerHitsOnAi = [];
let playerMissOnAi = [];
let playerSunkOnAi = [];
let selectedShip   = null;
let orientation    = 'H';
let placedShips    = [];
let playerTurn     = true;
let gameActive     = false;

// ── Explosion particles ───────────────────────────────────────
function spawnExplosion(cellEl, color = '#ff6600') {
  const rect      = cellEl.getBoundingClientRect();
  const cx        = rect.left + rect.width  / 2;
  const cy        = rect.top  + rect.height / 2;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:999;overflow:hidden;`;
  document.body.appendChild(container);

  const count = 18;
  const particles = [];

  for (let i = 0; i < count; i++) {
    const p   = document.createElement('div');
    const ang = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.5;
    const spd = 60 + Math.random() * 90;
    const sz  = 3 + Math.random() * 5;
    const col = Math.random() < 0.5 ? color : '#ffffff';
    p.style.cssText = `
      position:absolute;
      width:${sz}px;height:${sz}px;
      border-radius:${Math.random()<0.5?'50%':'2px'};
      background:${col};
      box-shadow:0 0 6px ${col};
      left:${cx}px;top:${cy}px;
      transform:translate(-50%,-50%);
      pointer-events:none;
    `;
    container.appendChild(p);
    particles.push({ el: p, ang, spd, x: cx, y: cy, life: 1, sz });
  }

  // Central flash
  const flash = document.createElement('div');
  flash.style.cssText = `
    position:absolute;left:${cx}px;top:${cy}px;
    width:4px;height:4px;border-radius:50%;
    background:white;box-shadow:0 0 20px 10px ${color},0 0 40px 20px ${color}88;
    transform:translate(-50%,-50%);pointer-events:none;
  `;
  container.appendChild(flash);

  let frame = 0;
  function animate() {
    frame++;
    const t = frame / 30;
    particles.forEach(p => {
      p.life = Math.max(0, 1 - t * 1.2);
      p.x += Math.cos(p.ang) * p.spd * 0.06;
      p.y += Math.sin(p.ang) * p.spd * 0.06 + t * 2;
      p.el.style.left      = p.x + 'px';
      p.el.style.top       = p.y + 'px';
      p.el.style.opacity   = p.life;
      p.el.style.transform = `translate(-50%,-50%) scale(${p.life})`;
    });
    flash.style.opacity   = Math.max(0, 1 - t * 3);
    flash.style.transform = `translate(-50%,-50%) scale(${1 + t * 4})`;

    if (t < 1) requestAnimationFrame(animate);
    else container.remove();
  }
  requestAnimationFrame(animate);
}

// ── Init ──────────────────────────────────────────────────────
async function initGame() {
  playerBoard    = Array(GRID).fill(null).map(() => Array(GRID).fill('empty'));
  aiHitsOnPlayer = []; aiMissOnPlayer = []; aiSunkOnPlayer = [];
  playerHitsOnAi = []; playerMissOnAi = []; playerSunkOnAi = [];
  playerShips    = [];
  placedShips    = [];
  selectedShip   = null;
  orientation    = 'H';
  playerTurn     = true;
  gameActive     = false;

  const res  = await fetch('/api/new-game', { method: 'POST' });
  const data = await res.json();
  aiShips    = data.aiShips;

  renderPlacementGrid();
  renderShipList();
  // Auto-select first ship
  autoSelectNextShip();
  document.getElementById('btn-start').disabled = true;
  document.getElementById('phase-placement').style.display = 'block';
  document.getElementById('phase-battle').style.display    = 'none';
}

// ── Auto-select next unplaced ship ────────────────────────────
function autoSelectNextShip() {
  const nextIdx = SHIPS.findIndex((_, i) => !placedShips.includes(i));
  if (nextIdx !== -1) {
    selectedShip = nextIdx;
    renderShipList();
  }
}

// ── Ship list ─────────────────────────────────────────────────
function renderShipList() {
  const el = document.getElementById('ship-list');
  el.innerHTML = '';
  SHIPS.forEach((ship, idx) => {
    const div    = document.createElement('div');
    const placed = placedShips.includes(idx);
    div.className = 'ship-item'
      + (placed ? ' placed' : '')
      + (selectedShip === idx && !placed ? ' selected' : '');
    div.innerHTML = `<span>${ship.name}</span>
      <span class="ship-size-dots">${Array(ship.size).fill('<span class="ship-dot"></span>').join('')}</span>`;
    if (!placed) div.onclick = () => selectShip(idx);
    el.appendChild(div);
  });
}

function selectShip(idx) {
  selectedShip = idx;
  renderShipList();
}

function setOrientation(o) {
  orientation = o;
  document.getElementById('btn-h').classList.toggle('active', o==='H');
  document.getElementById('btn-v').classList.toggle('active', o==='V');
}

// ── Placement grid ────────────────────────────────────────────
function renderPlacementGrid() {
  const el = document.getElementById('placement-grid');
  el.innerHTML = '';
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const cell    = document.createElement('div');
      cell.className = 'cell' + (playerBoard[r][c]==='ship' ? ' ship' : ' placeable');
      cell.dataset.r = r; cell.dataset.c = c;
      cell.onclick       = () => placeShipAt(r, c);
      cell.onmouseenter  = () => hoverPlacement(r, c, true);
      cell.onmouseleave  = () => hoverPlacement(r, c, false);
      el.appendChild(cell);
    }
  }
}

function getCells(r, c, size, orient) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(orient==='V' ? [r+i, c] : [r, c+i]);
  }
  return cells;
}

function isValidPlacement(cells) {
  return cells.every(([r,c]) => r>=0 && r<GRID && c>=0 && c<GRID && playerBoard[r][c] !== 'ship');
}

function hoverPlacement(r, c, entering) {
  if (selectedShip === null || placedShips.includes(selectedShip)) return;
  const ship  = SHIPS[selectedShip];
  const cells = getCells(r, c, ship.size, orientation);
  const valid = isValidPlacement(cells);

  document.querySelectorAll('#placement-grid .cell').forEach(el => {
    el.classList.remove('hover-valid','hover-invalid');
  });
  if (!entering) return;

  cells.forEach(([cr,cc]) => {
    if (cr<0||cr>=GRID||cc<0||cc>=GRID) return;
    const el = document.querySelectorAll('#placement-grid .cell')[cr*GRID+cc];
    if (el) el.classList.add(valid ? 'hover-valid' : 'hover-invalid');
  });
}

function placeShipAt(r, c) {
  if (selectedShip === null || placedShips.includes(selectedShip)) return;
  const ship  = SHIPS[selectedShip];
  const cells = getCells(r, c, ship.size, orientation);
  if (!isValidPlacement(cells)) return;

  cells.forEach(([cr,cc]) => { playerBoard[cr][cc] = 'ship'; });
  playerShips.push({ name: ship.name, size: ship.size, cells, hits: 0, sunk: false });
  placedShips.push(selectedShip);
  selectedShip = null;

  renderShipList();
  renderPlacementGrid();

  if (placedShips.length === SHIPS.length) {
    document.getElementById('btn-start').disabled = false;
  } else {
    // Auto-select next unplaced ship
    autoSelectNextShip();
  }
}

function randomPlacement() {
  playerBoard  = Array(GRID).fill(null).map(() => Array(GRID).fill('empty'));
  playerShips  = [];
  placedShips  = [];
  selectedShip = null;

  SHIPS.forEach((ship, idx) => {
    let placed = false, attempts = 0;
    while (!placed && attempts < 500) {
      attempts++;
      const orient = Math.random()<0.5 ? 'H' : 'V';
      const r = Math.floor(Math.random()*GRID);
      const c = Math.floor(Math.random()*GRID);
      const cells = getCells(r, c, ship.size, orient);
      if (isValidPlacement(cells)) {
        cells.forEach(([cr,cc]) => { playerBoard[cr][cc] = 'ship'; });
        playerShips.push({ name: ship.name, size: ship.size, cells, hits: 0, sunk: false });
        placedShips.push(idx);
        placed = true;
      }
    }
  });

  renderShipList();
  renderPlacementGrid();
  document.getElementById('btn-start').disabled = false;
}

// ── Start battle ──────────────────────────────────────────────
function startBattle() {
  if (placedShips.length < SHIPS.length) return;
  gameActive = true;
  document.getElementById('phase-placement').style.display = 'none';
  document.getElementById('phase-battle').style.display    = 'block';
  renderBattleGrids();
  setStatus('YOUR TURN — FIRE AT ENEMY WATERS');
}

// ── Render battle grids ───────────────────────────────────────
function renderBattleGrids() {
  renderPlayerGrid();
  renderAiGrid();
  updateShipCounters();
}

function renderPlayerGrid() {
  const el = document.getElementById('player-grid');
  el.innerHTML = '';
  for (let r=0; r<GRID; r++) {
    for (let c=0; c<GRID; c++) {
      const cell   = document.createElement('div');
      const isHit  = aiHitsOnPlayer.some(([hr,hc])=>hr===r&&hc===c);
      const isMiss = aiMissOnPlayer.some(([mr,mc])=>mr===r&&mc===c);
      const isSunk = aiSunkOnPlayer.some(([sr,sc])=>sr===r&&sc===c);
      let cls = 'cell';
      if      (isSunk)                   { cls += ' my-sunk'; cell.textContent = '✕'; }
      else if (isHit)                    { cls += ' my-hit';  cell.textContent = '✕'; }
      else if (isMiss)                   { cls += ' my-miss'; cell.textContent = '·'; }
      else if (playerBoard[r][c]==='ship') cls += ' my-ship';
      cell.className = cls;
      el.appendChild(cell);
    }
  }
}

function renderAiGrid() {
  const el = document.getElementById('ai-grid');
  el.innerHTML = '';
  for (let r=0; r<GRID; r++) {
    for (let c=0; c<GRID; c++) {
      const cell   = document.createElement('div');
      const isHit  = playerHitsOnAi.some(([hr,hc])=>hr===r&&hc===c);
      const isMiss = playerMissOnAi.some(([mr,mc])=>mr===r&&mc===c);
      const isSunk = playerSunkOnAi.some(([sr,sc])=>sr===r&&sc===c);
      let cls = 'cell';
      if      (isSunk)  { cls += ' sunk'; cell.textContent = '✕'; }
      else if (isHit)   { cls += ' hit';  cell.textContent = '✕'; }
      else if (isMiss)  { cls += ' miss'; cell.textContent = '·'; }
      else if (playerTurn && gameActive) cls += ' fireable';
      cell.className = cls;
      if (playerTurn && gameActive && !isHit && !isMiss && !isSunk) {
        cell.onclick = () => playerFire(r, c, cell);
      }
      el.appendChild(cell);
    }
  }
}

function updateShipCounters() {
  const pAlive = playerShips.filter(s=>!s.sunk).length;
  const aAlive = aiShips.filter(s=>!s.sunk).length;
  document.getElementById('player-ships-left').textContent = `SHIPS REMAINING: ${pAlive}/${SHIPS.length}`;
  document.getElementById('ai-ships-left').textContent     = `SHIPS REMAINING: ${aAlive}/${SHIPS.length}`;
}

// ── Player fires ──────────────────────────────────────────────
function playerFire(r, c, cellEl) {
  if (!playerTurn || !gameActive) return;
  const already = [...playerHitsOnAi,...playerMissOnAi,...playerSunkOnAi];
  if (already.some(([fr,fc])=>fr===r&&fc===c)) return;

  playerTurn = false;

  let hitShip = null;
  for (const ship of aiShips) {
    if (ship.cells.some(([sr,sc])=>sr===r&&sc===c)) { hitShip = ship; break; }
  }

  if (hitShip) {
    hitShip.hits++;
    playerHitsOnAi.push([r,c]);

    // 💥 Explosion on hit
    spawnExplosion(cellEl, '#ff6600');

    if (hitShip.hits >= hitShip.size) {
      hitShip.sunk = true;
      hitShip.cells.forEach(([sr,sc]) => {
        playerHitsOnAi = playerHitsOnAi.filter(([hr,hc])=>!(hr===sr&&hc===sc));
        playerSunkOnAi.push([sr,sc]);
      });
      setStatus(`DIRECT HIT — ${hitShip.name.toUpperCase()} DESTROYED!`, 'hit-ai');
    } else {
      setStatus('DIRECT HIT!', 'hit-ai');
    }
  } else {
    playerMissOnAi.push([r,c]);
    setStatus('MISS — SPLASH IN SECTOR ' + String.fromCharCode(65+c) + (r+1));
  }

  renderBattleGrids();

  if (aiShips.every(s=>s.sunk)) {
    setStatus('MISSION COMPLETE — ALL ENEMY SHIPS DESTROYED!', 'win');
    gameActive = false;
    return;
  }

  setTimeout(aiFire, 900);
}

// ── AI fires ──────────────────────────────────────────────────
async function aiFire() {
  if (!gameActive) return;
  setStatus('GPT-4o IS CALCULATING FIRING SOLUTION...', 'thinking');

  try {
    const res = await fetch('/api/ai-fire', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hits:      aiHitsOnPlayer,
        misses:    aiMissOnPlayer,
        sunkCells: aiSunkOnPlayer
      })
    });

    const { row, col } = await res.json();
    const hitShip = playerShips.find(s => s.cells.some(([r,c])=>r===row&&c===col));

    if (hitShip) {
      hitShip.hits++;
      aiHitsOnPlayer.push([row,col]);

      // 💥 Explosion on player grid hit
      renderBattleGrids();
      const cells = document.querySelectorAll('#player-grid .cell');
      const idx   = row * GRID + col;
      if (cells[idx]) spawnExplosion(cells[idx], '#ff3c3c');

      if (hitShip.hits >= hitShip.size) {
        hitShip.sunk = true;
        hitShip.cells.forEach(([r,c]) => {
          aiHitsOnPlayer = aiHitsOnPlayer.filter(([hr,hc])=>!(hr===r&&hc===c));
          aiSunkOnPlayer.push([r,c]);
        });
        setStatus(`GPT-4o DESTROYED YOUR ${hitShip.name.toUpperCase()}!`, 'hit-me');
      } else {
        setStatus(`GPT-4o HITS YOUR ${hitShip.name.toUpperCase()}!`, 'hit-me');
      }
    } else {
      aiMissOnPlayer.push([row,col]);
      setStatus('GPT-4o MISSED — YOUR TURN');
    }

    renderBattleGrids();

    if (playerShips.every(s=>s.sunk)) {
      setStatus('GAME OVER — GPT-4o HAS SUNK YOUR ENTIRE FLEET', 'lose');
      gameActive = false;
      return;
    }

    playerTurn = true;
    setStatus('YOUR TURN — FIRE AT ENEMY WATERS');
    renderBattleGrids();

  } catch (err) {
    console.error('AI fire error:', err);
    playerTurn = true;
    setStatus('YOUR TURN — FIRE AT ENEMY WATERS');
  }
}

// ── Status ────────────────────────────────────────────────────
function setStatus(msg, cls='') {
  document.getElementById('status-bar').className  = 'status-bar ' + cls;
  document.getElementById('status-text').textContent = msg;
}

// ── New game ──────────────────────────────────────────────────
function newGame() { initGame(); }

// ── Boot ──────────────────────────────────────────────────────
initGame();