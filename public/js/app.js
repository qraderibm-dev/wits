// Pages (home, game, result) and the play screen that every game runs inside.
(() => {
  const W = window.W, esc = W.esc;
  const $ = id => document.getElementById(id);
  const VIEWS = ['home', 'game', 'result', 'versus', 'play'];

  W.show = v => {
    VIEWS.forEach(x => { $(x).hidden = x !== v; });
    $(v).scrollTop = 0;
  };

  // ---------- play screen ----------
  let run = null;

  // Runs a game. onDone gets the result, or null if the player left early
  // with nothing to score.
  W.play = (game, opts, onDone) => {
    W.abortPlay();
    const timers = new Set(), listeners = [];
    const bar = $('bar'), hint = $('hint');
    const r = run = { alive: true };

    const ctx = {
      stage: $('stage'),
      rng: W.rng(opts.seed != null ? opts.seed : Math.floor(Math.random() * 4294967296)),
      versus: !!opts.versus,
      mode: opts.mode,
      after(ms, fn) {
        const id = setTimeout(() => { timers.delete(id); if (r.alive) fn(); }, ms);
        timers.add(id);
        return id;
      },
      every(ms, fn) {
        const id = setInterval(() => { if (r.alive) fn(); }, ms);
        timers.add(id);
        return id;
      },
      cancel(id) { clearTimeout(id); timers.delete(id); },
      on(target, type, fn, o) { target.addEventListener(type, fn, o); listeners.push([target, type, fn, o]); },
      hint(text, cls) { hint.textContent = text; hint.className = 'hint' + (cls ? ' ' + cls : ''); },
      stats(v1, l1, v2, l2) {
        $('stat1').innerHTML = l1 ? `<b>${esc(v1)}</b>${esc(l1)}` : '';
        $('stat2').innerHTML = l2 ? `<b>${esc(v2)}</b>${esc(l2)}` : '';
      },
      // A draining bar for anything on a clock. Pass 0 to hide it.
      timebar(ms) {
        bar.classList.remove('run');
        bar.classList.toggle('show', ms > 0);
        if (!ms) return;
        void bar.offsetWidth;
        bar.firstElementChild.style.animationDuration = ms + 'ms';
        bar.classList.add('run');
      },
      // label: short live status for the other players. pct: 0 to 1, if the game has a finish line.
      progress(label, pct) { if (opts.onProgress) opts.onProgress(label, pct); },
      end(result) { if (r.alive) finish(result); }
    };

    r.teardown = () => {
      r.alive = false;
      timers.forEach(id => { clearTimeout(id); clearInterval(id); });
      listeners.forEach(([t, type, fn, o]) => t.removeEventListener(type, fn, o));
      ctx.stage.innerHTML = '';
      ctx.timebar(0);
      ctx.hint('');
      ctx.stats();
      $('rivals').innerHTML = '';
    };
    function finish(result) {
      r.teardown();
      run = null;
      onDone(result);
    }
    r.quit = () => finish(r.inst.partial ? r.inst.partial() : null);

    ctx.stage.innerHTML = '';
    ctx.hint('');
    ctx.stats();
    W.show('play');
    r.inst = game.start(ctx) || {};
  };

  // Stop the current game without scoring it.
  W.abortPlay = () => {
    if (run) { run.teardown(); run = null; }
  };

  $('quit').addEventListener('click', () => { if (run) run.quit(); });
  document.addEventListener('contextmenu', e => {
    if (!e.target.closest('input')) e.preventDefault();
  });

  // ---------- home ----------
  const DEMO = '<div class="demo" aria-hidden="true">' + [1, 2, 3].map(n =>
    `<span class="tile"><span class="inner"><span class="face">${n}</span><span class="back"></span></span></span>`).join('') + '</div>';

  function home() {
    const hist = W.history();
    const rows = W.games.map(g => {
      const best = W.best(g, hist.filter(e => e.game === g.id));
      return `<li><button data-game="${g.id}">
        <span class="gname">${esc(g.name)}</span>
        <span class="gbest">${best ? 'Best ' + esc(g.fmt(best.score)) : 'Not played yet'}</span>
        <span class="gtests">${esc(g.tests)}</span>
      </button></li>`;
    }).join('');

    // Profile: the average of your best score in each game you have played.
    const tops = W.games.map(g => Math.max(0, ...hist.filter(e => e.game === g.id).map(e => e.index || 0))).filter(Boolean);
    const profile = tops.length
      ? `<p>Your profile is <strong>${Math.round(tops.reduce((a, b) => a + b, 0) / tops.length)}</strong>, the average of your best score in ` +
        `${tops.length} of ${W.games.length} games. 100 is about typical on this site’s own scale. It is a rough guide, not an IQ score.</p>`
      : '';

    $('home').innerHTML = `<div class="col">
      <h1>Wits</h1>
      ${DEMO}
      <p>Short games that each test one skill. Play alone and keep your scores, or open a room and race your friends.</p>
      <button class="go" data-act="friends">Play with friends</button>
      <ul class="games">${rows}</ul>
      ${profile}
    </div>`;
    W.show('home');
  }
  W.home = home;

  $('home').addEventListener('click', e => {
    const g = e.target.closest('[data-game]');
    if (g) return openGame(g.dataset.game);
    if (e.target.closest('[data-act="friends"]')) W.versus.open();
  });

  // ---------- game page ----------
  let cur = null, mode = '';

  function openGame(id) {
    cur = W.byId[id];
    mode = '';
    if (cur.modes) {
      const saved = W.store.get('mode.' + id);
      mode = cur.modes.some(m => m.id === saved) ? saved : cur.modes[0].id;
    }
    gamePage();
  }

  function gamePage() {
    const modes = cur.modes ? `<div class="modes">${cur.modes.map(m =>
      `<button data-mode="${m.id}" class="${m.id === mode ? 'on' : ''}" aria-pressed="${m.id === mode}">` +
      `<strong>${esc(m.name)}</strong>${esc(m.desc)}</button>`).join('')}</div>` : '';
    $('game').innerHTML = `<div class="col">
      <button class="link" data-act="home">All games</button>
      <h1 class="gtitle">${esc(cur.name)}</h1>
      <p>${esc(cur.how)}</p>
      ${modes}
      <button class="go" data-act="start">Start game</button>
      ${historyHtml()}
    </div>`;
    W.show('game');
  }

  const mine = () => W.history().filter(e => e.game === cur.id && (e.mode || '') === mode);

  function historyHtml() {
    const games = mine();
    if (!games.length) return '';
    const best = W.best(cur, games);
    const recent = games.slice(-10);
    const avg = recent.reduce((a, e) => a + e.score, 0) / recent.length;
    const last = games.slice(-24);
    const max = Math.max(...last.map(e => e.index));
    const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    return `<section class="history">
      <h2>Your history</h2>
      <div class="hstats">
        <span class="stat"><b>${best.score.toFixed(cur.decimals || 0)}</b>best</span>
        <span class="stat"><b>${avg.toFixed(Math.max(1, cur.decimals || 0))}</b>average</span>
        <span class="stat"><b>${games.length}</b>${games.length === 1 ? 'game' : 'games'}</span>
      </div>
      <p>Your best of ${esc(cur.fmt(best.score))} scores <strong>${best.index}</strong>, which rates as <strong>${W.band(best.index)}</strong>.
        100 is about typical on this site’s own scale. It is a rough guide, not an IQ score.</p>
      <div class="spark" aria-hidden="true">${last.map(e =>
        `<i class="${e === best ? 'top' : ''}" style="height:${Math.max(8, (e.index - 50) / (max - 50) * 100)}%"></i>`).join('')}</div>
      <p class="caption">Your last ${last.length} ${last.length === 1 ? 'game' : 'games'}, oldest on the left. Taller is better. The average covers the last ${recent.length}.</p>
      <ol class="rows">${games.slice(-8).reverse().map(e =>
        `<li><span class="grow">${fmt.format(new Date(e.t))}</span>` +
        `<span class="strong">${esc(cur.fmt(e.score))}</span><span class="num">${e.index}</span></li>`).join('')}</ol>
      <button class="link" data-act="clear">Clear this history</button>
    </section>`;
  }

  function startSolo() {
    const game = cur, m = mode;
    const prev = W.best(game, mine());
    W.play(game, { mode: m }, result => {
      if (!result) return gamePage();
      showResult(game, W.record(game, m, result), prev);
    });
  }

  $('game').addEventListener('click', e => {
    const m = e.target.closest('[data-mode]');
    if (m) {
      mode = m.dataset.mode;
      W.store.set('mode.' + cur.id, mode);
      return gamePage();
    }
    const act = (e.target.closest('[data-act]') || {}).dataset;
    if (!act) return;
    if (act.act === 'home') home();
    if (act.act === 'start') startSolo();
    if (act.act === 'clear' && confirm(`Delete your saved ${cur.name} games on this device?`)) {
      W.saveHistory(W.history().filter(x => !(x.game === cur.id && (x.mode || '') === mode)));
      gamePage();
    }
  });

  // ---------- result ----------
  function showResult(game, entry, prev) {
    const isBest = prev && W.better(game, entry.score, prev.score);
    const skill = game.tests.toLowerCase();
    $('result').innerHTML = `<div class="col">
      <h2>${isBest ? 'New best' : 'Game ended'}</h2>
      <div class="index"><b>${entry.index}</b>${esc(skill)} score</div>
      <p>${esc(game.summary(entry))} That rates as “${W.band(entry.index)}”.</p>
      <p class="small">100 is about typical on this site’s own scale. It scores ${esc(skill)} only. It is not a real IQ test.</p>
      <button class="go" data-act="again">Play again</button>
      <button class="link center" data-act="back">Back to ${esc(game.name)}</button>
    </div>`;
    W.show('result');
  }

  $('result').addEventListener('click', e => {
    const act = (e.target.closest('[data-act]') || {}).dataset;
    if (!act) return;
    if (act.act === 'again') startSolo();
    if (act.act === 'back') gamePage();
  });

  // ---------- go ----------
  const room = new URLSearchParams(location.search).get('room');
  if (room) W.versus.open(room); else home();
})();
