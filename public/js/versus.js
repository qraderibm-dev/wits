// Rooms: everyone joins with a code, the host picks a game, all play at once.
// Talks to server.js. The room state arrives as a full snapshot on every change.
W.versus = (() => {
  const esc = W.esc;
  const $ = id => document.getElementById(id);
  const NO_SERVER = 'Playing with friends needs the game server, and it can’t be reached from here.';

  let code = '', pid = '', myN = 0;
  let es = null, snap = null, offset = 0;
  let launched = 0, finished = 0, inGame = false, ticker = 0, error = '';
  let myResult = null;   // what I scored this round, shown while the others finish

  async function post(path, body) {
    let res;
    try {
      res = await fetch(W.server + '/api/rooms' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    } catch { throw new Error(NO_SERVER); }
    const data = await res.json().catch(() => null);
    if (!data) throw new Error(NO_SERVER);
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }
  const send = (path, body) => post(`/${code}/${path}`, Object.assign({ pid }, body)).catch(() => {});

  const remember = () => { try { sessionStorage.setItem('wits.room', JSON.stringify({ code, pid, myN })); } catch {} };
  const forget = () => { try { sessionStorage.removeItem('wits.room'); } catch {} };

  // ---------- joining ----------
  function open(prefill) {
    // Pick the room back up after a page reload.
    if (!code) {
      try {
        const saved = JSON.parse(sessionStorage.getItem('wits.room'));
        if (saved && saved.code && (!prefill || prefill.toUpperCase() === saved.code)) {
          ({ code, pid, myN } = saved);
          W.show('versus');
          $('versus').innerHTML = '<div class="col"><p>Rejoining your room.</p></div>';
          return connect();
        }
      } catch {}
    }
    if (code) { W.show('versus'); return render(); }
    entry(prefill);
  }

  function entry(prefill) {
    $('versus').innerHTML = `<div class="col">
      <button class="link" data-act="home">All games</button>
      <h1 class="gtitle">Play with friends</h1>
      <p>Everyone joins the same room on their own phone or laptop. The host picks a game, you all play at the same time, and the best score wins the round.</p>
      <label class="field">Your name<input id="vname" maxlength="16" autocomplete="off" value="${esc(W.store.get('name') || '')}"></label>
      <button class="go" data-act="create">Create a room</button>
      <div class="or">Or join a room someone else created</div>
      <label class="field">Room code<input id="vcode" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(prefill || '')}"></label>
      <button class="go quiet" data-act="join">Join room</button>
      <p class="error" id="verr" role="alert">${esc(error)}</p>
    </div>`;
    error = '';
    W.show('versus');
  }

  async function enter(join) {
    const name = $('vname').value.trim();
    const wanted = $('vcode').value.trim().toUpperCase();
    const fail = msg => { $('verr').textContent = msg; };
    if (!name) return fail('Enter your name first.');
    if (join && wanted.length !== 4) return fail('Enter the 4-letter room code.');
    W.store.set('name', name);
    try {
      const r = join ? await post(`/${wanted}/join`, { name }) : await post('', { name });
      code = r.code; pid = r.pid; myN = r.n;
      launched = finished = 0;
      remember();
      connect();
    } catch (e) { fail(e.message); }
  }

  function connect() {
    if (es) es.close();
    es = new EventSource(`${W.server}/api/rooms/${code}/events?pid=${pid}`);
    es.onmessage = e => {
      snap = JSON.parse(e.data);
      offset = snap.now - Date.now();
      onSnap();
    };
    es.addEventListener('gone', rejoin);
    keepAwake();
  }

  // The server no longer knows us (we were away too long). If the room is
  // still there, quietly take a seat again under the same name.
  let rejoining = false;
  async function rejoin() {
    if (es) es.close();
    const name = W.store.get('name');
    if (rejoining || !name || !code) return drop('That room has closed.');
    rejoining = true;
    try {
      const r = await post(`/${code}/join`, { name });
      pid = r.pid; myN = r.n;
      remember();
      connect();
    } catch (e) {
      drop(/No room/.test(e.message) ? 'That room has closed.' : e.message);
    }
    rejoining = false;
  }

  // Phones freeze the page in the background. Reconnect the moment we are back.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!code) return;
    keepAwake();
    if ((es && es.readyState === 2) || Date.now() - hiddenAt > 4000) connect();
  });
  window.addEventListener('online', () => { if (code) connect(); });

  // Stop the screen dimming and locking while in a room, where the browser allows it.
  let wake = null;
  async function keepAwake() {
    try {
      if (!code || !navigator.wakeLock || (wake && !wake.released)) return;
      wake = await navigator.wakeLock.request('screen');
    } catch {}
  }

  function drop(message) {
    if (es) es.close();
    es = null; snap = null; code = pid = ''; myN = 0;
    clearInterval(ticker); ticker = 0;
    if (wake) { wake.release().catch(() => {}); wake = null; }
    forget();
    if (inGame) { W.abortPlay(); inGame = false; }
    error = message || '';
    if (message) entry(); else W.home();
  }

  // ---------- reacting to the room ----------
  const me = () => snap.players.find(p => p.n === myN) || {};
  const nameOf = n => { const p = snap.players.find(x => x.n === n); return p ? p.name : 'Someone'; };

  function onSnap() {
    if (snap.state === 'playing') {
      if (launched !== snap.round && !me().done && !ticker) ticker = setInterval(tick, 100);
    } else if (inGame) {
      // The round was closed while we were still playing.
      W.abortPlay();
      inGame = false;
    }
    if (inGame) rivals(); else { W.show('versus'); render(); }
  }

  function tick() {
    if (!snap || snap.state !== 'playing' || launched === snap.round) {
      clearInterval(ticker); ticker = 0;
      return;
    }
    const left = snap.startAt - (Date.now() + offset);
    if (left <= 0) {
      clearInterval(ticker); ticker = 0;
      launch();
    } else if ($('vcount')) {
      $('vcount').textContent = Math.ceil(left / 1000);
    }
  }

  function launch() {
    const game = W.byId[snap.game], round = snap.round;
    if (!game) return;
    launched = round;
    inGame = true;
    W.play(game, {
      versus: true,
      seed: snap.seed,
      onProgress: (label, pct) => send('progress', { round, label, pct })
    }, result => {
      inGame = false;
      finished = round;
      myResult = result;
      send('progress', { round, done: true, dnf: !result, score: result ? result.score : null });
      W.show('versus');
      render();
    });
    rivals();
  }

  function rivals() {
    const game = W.byId[snap.game];
    $('rivals').innerHTML = snap.players.filter(p => p.n !== myN).map(p => {
      const now = p.dnf ? 'out' : p.done ? 'finished, ' + game.fmt(p.score) : (p.label || 'playing');
      const bar = !p.done && p.pct != null ? `<span class="track"><i style="width:${Math.round(p.pct * 100)}%"></i></span>` : '';
      return `<span class="rival ${p.done && !p.dnf ? 'fin' : ''}">${esc(p.name)}<b>${esc(now)}</b>${bar}</span>`;
    }).join('');
  }

  // ---------- screens ----------
  function render() {
    if (!snap) return;
    const host = snap.host === myN;
    const game = W.byId[snap.game];
    let html = '';

    if (snap.state === 'lobby') {
      const enough = snap.players.length > 1;
      html = `<button class="link" data-act="leave">Leave room</button>
        <h2 style="margin-top:18px">Room code</h2>
        <div class="code">${esc(snap.code)}</div>
        <p>Friends open this site, tap Play with friends and enter the code. Or send them the invite link.</p>
        <button class="link" data-act="copy">Copy invite link</button>
        <h3>Players</h3>
        <ol class="rows">${snap.players.map(p => `<li>
          <span class="grow strong">${esc(p.name)}${p.n === myN ? ' (you)' : ''}</span>
          <span>${p.n === snap.host ? 'host' : ''}${p.on ? '' : ' away, may come back'}</span>
          <span class="num">${p.wins} ${p.wins === 1 ? 'win' : 'wins'}</span></li>`).join('')}</ol>` +
        (host
          ? `<h3>${enough ? 'Pick a game to start the round' : 'Waiting for at least one more player'}</h3>
             <div class="modes stack">${W.games.map(g => `<button data-pick="${g.id}" ${enough ? '' : 'disabled'}>
               <strong>${esc(g.name)}</strong>${esc(g.versusNote)}</button>`).join('')}</div>`
          : `<p>Waiting for ${esc(nameOf(snap.host))} to pick a game.</p>`);
    }

    if (snap.state === 'playing' && game) {
      const waiting = me().done || finished === snap.round;
      if (!waiting) {
        html = `<h2>${esc(game.name)}</h2>
          <p>${esc(game.versusNote)} Starting in</p><div class="code count" id="vcount">3</div>
          <ol class="rows">${snap.players.map(p => `<li><span class="grow strong">${esc(p.name)}${p.n === myN ? ' (you)' : ''}</span>
            <span>${p.on ? 'ready' : 'away'}</span></li>`).join('')}</ol>`;
      } else {
        const mine = myResult && finished === snap.round ? myResult.score : me().score;
        const done = snap.players.filter(p => p.done).length;
        const still = snap.players.length - done;
        html = `<h2>${esc(game.name)}</h2>` +
          (typeof mine === 'number'
            ? `<div class="index"><b>${esc(Number(mine).toFixed(game.decimals || 0))}</b>${esc(game.unit)}, your result</div>`
            : '<p>You left this round without a score.</p>') +
          `<p>${still
            ? `<strong>${still}</strong> still playing. Watch them below. The round closes in <strong id="vleft">${left()}</strong> at the latest.`
            : 'Everyone is done. Working out the winner.'}</p>` +
          board(game);
      }
    }

    if (snap.state === 'results' && game) {
      const w = snap.winners;
      const title = !w.length ? 'Nobody finished'
        : w.length > 1 ? 'It’s a tie'
        : w[0] === myN ? 'You win' : `${nameOf(w[0])} wins`;
      html = `<h2>${esc(title)}</h2>
        <p>${esc(game.name)}. ${esc(game.versusNote)}</p>
        ${board(game)}
        ${host ? `<button class="go" data-pick="${game.id}">Play ${esc(game.name)} again</button>
                  <button class="go quiet" style="margin-top:14px" data-act="lobby">Pick another game</button>`
               : `<p>Waiting for ${esc(nameOf(snap.host))} to start the next round.</p>`}
        <button class="link center" data-act="leave">Leave room</button>`;
    }

    $('versus').innerHTML = `<div class="col">${html}</div>`;
  }

  // Time until the server closes the round, as m:ss.
  function left() {
    const s = Math.max(0, Math.ceil((snap.endsAt - (Date.now() + offset)) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  setInterval(() => { if (snap && $('vleft')) $('vleft').textContent = left(); }, 500);

  // Scoreboard: finished players best-first, then everyone else.
  function board(game) {
    const fin = snap.players.filter(p => p.done && !p.dnf && typeof p.score === 'number')
      .sort((a, b) => game.better === 'low' ? a.score - b.score : b.score - a.score);
    const rest = snap.players.filter(p => !fin.includes(p));
    const over = snap.state === 'results';
    const row = p => {
      const place = fin.indexOf(p) + 1;
      const live = !p.done;
      const now = p.dnf ? 'did not finish' : p.done ? game.fmt(p.score) : (p.label || 'just started');
      // While the round is on, the current leader is highlighted; afterwards, the winner.
      const top = over ? snap.winners.includes(p.n) : place === 1;
      return `<li class="${top ? 'win' : ''} ${live ? 'live' : ''}" style="--pct:${live && p.pct != null ? Math.round(p.pct * 100) : 0}%">
        <span class="place">${place || (live ? '<i class="dot"></i>' : '')}</span>
        <span class="grow strong">${esc(p.name)}${p.n === myN ? ' (you)' : ''}</span>
        <span class="${live ? '' : 'strong'}">${live ? 'playing, ' : ''}${esc(now)}</span>
        ${over ? `<span class="num">${p.wins} ${p.wins === 1 ? 'win' : 'wins'}</span>` : ''}</li>`;
    };
    return `<ol class="rows race">${fin.concat(rest).map(row).join('')}</ol>`;
  }

  // ---------- buttons ----------
  $('versus').addEventListener('click', async e => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const g = W.byId[pick.dataset.pick];
      return send('start', { game: g.id, better: g.better, secs: g.versusSecs });
    }
    const act = (e.target.closest('[data-act]') || {}).dataset;
    if (!act) return;
    if (act.act === 'home') W.home();
    if (act.act === 'create') enter(false);
    if (act.act === 'join') enter(true);
    if (act.act === 'lobby') send('lobby');
    if (act.act === 'leave') { await send('leave'); drop(); }
    if (act.act === 'copy') {
      const link = `${location.origin}${location.pathname}?room=${code}`;
      const btn = e.target.closest('[data-act]');
      try { await navigator.clipboard.writeText(link); btn.textContent = 'Invite link copied'; }
      catch { prompt('Copy this invite link', link); }
    }
  });
  $('versus').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    enter(e.target.id === 'vcode');
  });

  return { open };
})();
