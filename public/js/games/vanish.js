W.register({
  id: 'vanish',
  name: 'Vanish',
  tests: 'Visual memory',
  how: 'Remember where each number is. When the cards flip over, tap them from lowest to highest. Get it right and you get one more card. Miss and you lose one. Play as long as you like, then end the game to see your score.',
  modes: [
    { id: 'classic', name: 'Classic', desc: 'Cards flip when you tap 1' },
    { id: 'timed', name: 'Timed', desc: 'Cards flip after 5 seconds' }
  ],
  unit: 'numbers',
  better: 'high',
  versusNote: '90 seconds. The highest count cleared wins.',
  versusSecs: 90,

  // 6 numbers cleared = 100, 8 points per number, a few points for accuracy.
  index(e) {
    if (!e.score) return 60;
    const acc = e.rounds ? e.wins / e.rounds : 0.7;
    return W.clamp(Math.round(100 + (e.score - 6) * 8 + (acc - 0.7) * 20), 60, 160);
  },
  summary(e) {
    return e.score
      ? `You cleared up to ${e.score} numbers and got ${e.wins} of ${e.rounds} rounds right.`
      : `You played ${e.rounds} ${e.rounds === 1 ? 'round' : 'rounds'} without clearing one.`;
  },

  start(ctx) {
    const START = 2, SHOW_MS = 5000, RACE_MS = 90000;
    const timed = !ctx.versus && ctx.mode === 'timed';
    const b = W.board(ctx);
    let count = START, next = 1, hidden = false, locked = true, timer = 0;
    let peak = 0, rounds = 0, wins = 0;

    const result = () => ({ score: peak, wins, rounds });
    const stats = () => ctx.stats(count, 'numbers', peak, 'cleared');

    function round() {
      const total = b.layout();
      count = Math.min(count, total);
      const cells = W.shuffle(Array.from({ length: total }, (_, i) => i), ctx.rng);
      b.clear();
      b.el.classList.remove('hide');
      for (let n = 1; n <= count; n++) b.add(n, cells[n - 1]).dataset.n = n;
      next = 1; hidden = false; locked = false;
      stats();
      if (timed) {
        ctx.timebar(SHOW_MS);
        ctx.hint('Remember where they are');
        timer = ctx.after(SHOW_MS, hide);
      } else {
        ctx.hint('Tap 1 when you’re ready');
      }
    }

    function hide() {
      if (hidden) return;
      hidden = true;
      ctx.cancel(timer);
      b.el.classList.add('hide');
      if (timed) ctx.timebar(0);
      if (!locked) ctx.hint('Now tap them lowest to highest');
    }

    b.onTap(tile => {
      if (locked || tile.classList.contains('done')) return;
      if (+tile.dataset.n === next) {
        tile.classList.add('done');
        next++;
        if (next <= count) return hide();
        locked = true;
        ctx.cancel(timer);
        if (timed) ctx.timebar(0);
        rounds++; wins++;
        peak = Math.max(peak, count);
        ctx.progress(`${peak} cleared`);
        count++;
        ctx.hint(`Correct. Next up, ${count} numbers.`, 'good');
        ctx.stats(count - 1, 'numbers', peak, 'cleared');
        timer = ctx.after(900, round);
        return;
      }
      // Wrong card: show where everything was, then drop back one.
      locked = true;
      ctx.cancel(timer);
      hidden = true;
      if (timed) ctx.timebar(0);
      b.el.classList.remove('hide');
      tile.classList.add('wrong');
      rounds++;
      count = Math.max(START, count - 1);
      ctx.hint(`Not that one. Back to ${count} numbers.`, 'bad');
      timer = ctx.after(1500, round);
    });

    if (ctx.versus) {
      ctx.timebar(RACE_MS);
      ctx.after(RACE_MS, () => ctx.end(result()));
    }
    round();
    return { partial: () => rounds ? result() : null };
  }
});
