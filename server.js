require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Ships config (8x8) ────────────────────────────────────────
const SHIPS = [
  { name: 'Carrier',    size: 4 },
  { name: 'Battleship', size: 3 },
  { name: 'Cruiser',    size: 3 },
  { name: 'Destroyer',  size: 2 },
  { name: 'Submarine',  size: 2 }
];

const GRID = 8;

// ── Place ships randomly on an 8x8 grid ───────────────────────
function placeShipsRandom() {
  const grid  = Array(GRID).fill(null).map(() => Array(GRID).fill(0));
  const ships = [];

  for (const ship of SHIPS) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 500) {
      attempts++;
      const horizontal = Math.random() < 0.5;
      const row = Math.floor(Math.random() * GRID);
      const col = Math.floor(Math.random() * GRID);

      if (horizontal) {
        if (col + ship.size > GRID) continue;
        if ([...Array(ship.size)].some((_,i) => grid[row][col+i] !== 0)) continue;
        const cells = [];
        for (let i = 0; i < ship.size; i++) { grid[row][col+i] = 1; cells.push([row, col+i]); }
        ships.push({ name: ship.name, size: ship.size, cells, hits: 0, sunk: false });
        placed = true;
      } else {
        if (row + ship.size > GRID) continue;
        if ([...Array(ship.size)].some((_,i) => grid[row+i][col] !== 0)) continue;
        const cells = [];
        for (let i = 0; i < ship.size; i++) { grid[row+i][col] = 1; cells.push([row+i, col]); }
        ships.push({ name: ship.name, size: ship.size, cells, hits: 0, sunk: false });
        placed = true;
      }
    }
  }
  return { grid, ships };
}

// ── POST /api/new-game ────────────────────────────────────────
// Returns AI ship placement (hidden) and its grid size
app.post('/api/new-game', (req, res) => {
  const ai = placeShipsRandom();
  // Send back AI ships (server will track, client never sees positions)
  res.json({
    aiShips: ai.ships,
    gridSize: GRID,
    ships: SHIPS
  });
});

// ── POST /api/ai-fire ─────────────────────────────────────────
// GPT-4o decides where to fire on player's board
// Body: { hits: [[r,c],...], misses: [[r,c],...], sunkCells: [[r,c],...] }
app.post('/api/ai-fire', async (req, res) => {
  const { hits = [], misses = [], sunkCells = [] } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set in .env' });

  // Build a text representation of what AI knows
  const fired = [...hits, ...misses, ...sunkCells];

  // Build grid visualization for GPT
  let gridStr = '  0 1 2 3 4 5 6 7\n';
  for (let r = 0; r < GRID; r++) {
    let row = `${r} `;
    for (let c = 0; c < GRID; c++) {
      const isHit    = hits.some(([hr,hc])    => hr===r && hc===c);
      const isMiss   = misses.some(([mr,mc])   => mr===r && mc===c);
      const isSunk   = sunkCells.some(([sr,sc]) => sr===r && sc===c);
      if (isSunk)      row += 'X ';
      else if (isHit)  row += '* ';
      else if (isMiss) row += '. ';
      else             row += '? ';
    }
    gridStr += row.trim() + '\n';
  }

  const unfired = [];
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (!fired.some(([fr,fc]) => fr===r && fc===c))
        unfired.push([r,c]);

  const activeHits = hits.filter(([hr,hc]) =>
    !sunkCells.some(([sr,sc]) => sr===hr && sc===hc)
  );

  const prompt = `You are playing Battleship as the AI opponent on an 8x8 grid (rows 0-7, cols 0-7).

Your firing history on the opponent's board:
${gridStr}
Legend: ? = unfired, * = hit (ship not yet sunk), . = miss, X = sunk ship cell

Active (unsunk) hits so far: ${activeHits.length > 0 ? activeHits.map(([r,c])=>`(${r},${c})`).join(', ') : 'none'}

Strategy rules (follow in order):
1. If there are active hits (*), fire adjacent to them to sink the ship — try cells in line with existing hits first (same row or same column).
2. If no active hits, use a checkerboard pattern — prefer cells where (row+col) is even to maximize coverage.
3. Never fire at a cell already fired at.

Available cells to fire at: ${unfired.slice(0,40).map(([r,c])=>`(${r},${c})`).join(', ')}${unfired.length > 40 ? '...' : ''}

Reply with ONLY two integers separated by a comma: row,col
Example: 3,5
No explanation. Just the coordinates.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model:       'gpt-4o',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  10,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(502).json({ error: err.error?.message || 'OpenAI error' });
    }

    const data = await response.json();
    const raw  = data.choices[0].message.content.trim();
    const parts = raw.split(',').map(s => parseInt(s.trim(), 10));

    if (
      parts.length === 2 &&
      !isNaN(parts[0]) && !isNaN(parts[1]) &&
      parts[0] >= 0 && parts[0] < GRID &&
      parts[1] >= 0 && parts[1] < GRID &&
      !fired.some(([fr,fc]) => fr===parts[0] && fc===parts[1])
    ) {
      return res.json({ row: parts[0], col: parts[1] });
    }

    // Fallback: smart random from unfired cells
    // Prefer cells adjacent to active hits
    let target = null;
    if (activeHits.length > 0) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [hr,hc] of activeHits) {
        for (const [dr,dc] of dirs) {
          const nr = hr+dr, nc = hc+dc;
          if (nr>=0&&nr<GRID&&nc>=0&&nc<GRID&&!fired.some(([fr,fc])=>fr===nr&&fc===nc)) {
            target = [nr, nc];
            break;
          }
        }
        if (target) break;
      }
    }
    if (!target) {
      // Checkerboard fallback
      const checker = unfired.filter(([r,c]) => (r+c)%2===0);
      const pool = checker.length ? checker : unfired;
      target = pool[Math.floor(Math.random()*pool.length)];
    }

    return res.json({ row: target[0], col: target[1] });

  } catch (err) {
    console.error('AI fire error:', err.message);
    const checker = unfired.filter(([r,c]) => (r+c)%2===0);
    const pool = checker.length ? checker : unfired;
    const t = pool[Math.floor(Math.random()*pool.length)];
    return res.json({ row: t[0], col: t[1] });
  }
});

app.listen(PORT, () => {
  console.log(`✦ Battleship server running at http://localhost:${PORT}`);
});
