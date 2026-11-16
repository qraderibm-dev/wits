// Shared helpers. Everything hangs off one global, W, so the site also works
// when opened straight from a file (no build step, no modules).
(() => {
  const W = window.W = {
    games: [],
    byId: {},
    // Leave empty when the site and the room server share one address.
    server: window.WITS_SERVER || ''
  };

  /*
    A game is an object:
      id, name, tests, how          text shown on the site
      unit, decimals                how a score reads ("7 numbers", "243 ms")
      better: 'high' | 'low'        which direction wins
      modes: [{id, name, desc}]     optional solo variants
      versusNote, versusSecs        rules line and time limit when racing
      index(entry)                  score on the site's own scale, 100 = typical
      summary(entry)                one sentence for the result screen
      start(ctx)                    builds the game in ctx.stage; may return
                                    { partial() } to give a result when the
                                    player ends the game early
  */
  W.register = g => {
    g.fmt = s => `${Number(s).toFixed(g.decimals || 0)} ${g.unit}`;
    W.games.push(g);
    W.byId[g.id] = g;
  };

  W.store = {
    get(k) { try { return localStorage.getItem('wits.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('wits.' + k, v); } catch {} }
  };

  W.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  W.esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Seeded random numbers, so everyone in a room gets the same layout.
  W.rng = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  W.shuffle = (arr, rnd) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Rough guide only: informal bands on the site's own scale.
  W.band = idx => idx >= 130 ? 'exceptional' : idx >= 115 ? 'very strong'
    : idx >= 105 ? 'strong' : idx >= 92 ? 'about typical' : 'still warming up';

  // ---- history: one entry per finished solo game ----
  W.history = () => {
    try { const h = JSON.parse(W.store.get('history')); return Array.isArray(h) ? h : []; }
    catch { return []; }
  };
  W.saveHistory = h => W.store.set('history', JSON.stringify(h.slice(-500)));
  W.record = (game, mode, result) => {
    const entry = Object.assign({ t: Date.now(), game: game.id, mode: mode || '' }, result);
    entry.index = game.index(entry);
    const h = W.history();
    h.push(entry);
    W.saveHistory(h);
    return entry;
  };
  W.better = (game, a, b) => game.better === 'low' ? a < b : a > b;
  W.best = (game, entries) =>
    entries.reduce((top, e) => !top || W.better(game, e.score, top.score) ? e : top, null);

  // Bring over games saved by the first, Vanish-only version of the site.
  (function migrate() {
    if (W.store.get('migrated')) return;
    W.store.set('migrated', '1');
    let old;
    try { old = JSON.parse(localStorage.getItem('vanish.history')); } catch { return; }
    if (!Array.isArray(old)) return;
    const h = W.history();
    old.forEach(e => {
      if (!e || !e.rounds) return;
      const acc = e.wins / e.rounds;
      h.push({
        t: e.t, game: 'vanish', mode: e.mode || 'classic', score: e.peak, wins: e.wins, rounds: e.rounds,
        index: e.peak ? W.clamp(Math.round(100 + (e.peak - 6) * 8 + (acc - 0.7) * 20), 60, 160) : 60
      });
    });
    W.saveHistory(h.sort((a, b) => a.t - b.t));
  })();

  // ---- a grid of cards, used by Vanish and Trail ----
  W.board = ctx => {
    const GAP = 8, MAX_CELL = 104;
    const wrap = document.createElement('div');
    wrap.className = 'board-wrap';
    const el = document.createElement('div');
    el.className = 'board';
    wrap.appendChild(el);
    ctx.stage.appendChild(wrap);

    const b = { el, cols: 8, rows: 5 };
    b.size = () => {
      const r = wrap.getBoundingClientRect();
      const w = r.width - 32, h = r.height - 28;
      const s = Math.max(28, Math.floor(Math.min(
        (w - GAP * (b.cols - 1)) / b.cols, (h - GAP * (b.rows - 1)) / b.rows, MAX_CELL)));
      el.style.setProperty('--cell', s + 'px');
      el.style.gridTemplateColumns = `repeat(${b.cols}, ${s}px)`;
      el.style.gridTemplateRows = `repeat(${b.rows}, ${s}px)`;
    };
    // Wide screens get 8 x 5, tall screens 5 x 8.
    b.layout = () => {
      const portrait = window.innerHeight > window.innerWidth;
      b.cols = portrait ? 5 : 8;
      b.rows = portrait ? 8 : 5;
      b.size();
      return b.cols * b.rows;
    };
    b.clear = () => { el.innerHTML = ''; };
    b.add = (label, cell) => {
      const t = document.createElement('button');
      t.className = 'tile';
      t.setAttribute('aria-label', 'Card');
      t.innerHTML = `<span class="inner"><span class="face">${W.esc(label)}</span><span class="back"></span></span>`;
      t.style.gridColumn = (cell % b.cols) + 1;
      t.style.gridRow = Math.floor(cell / b.cols) + 1;
      el.appendChild(t);
      return t;
    };
    b.onTap = fn => W.tap(ctx, el, e => {
      const t = e.target.closest('.tile');
      if (t) fn(t);
    });
    ctx.on(window, 'resize', b.size);
    b.layout();
    return b;
  };

  // Fire on press (fast for mouse and touch) and on keyboard activation.
  W.tap = (ctx, el, fn) => {
    ctx.on(el, 'pointerdown', e => { e.preventDefault(); fn(e); });
    ctx.on(el, 'click', e => { if (e.detail === 0) fn(e); });
  };
})();
