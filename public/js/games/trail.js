W.register({
  id: 'trail',
  name: 'Trail',
  tests: 'Attention switching',
  how: 'Sixteen cards hold the numbers 1 to 8 and the letters A to H. Tap them in the order 1, A, 2, B, 3, C and so on, as fast as you can. The clock starts straight away and every wrong tap adds 2 seconds.',
  unit: 'seconds',
  decimals: 1,
  better: 'low',
  versusNote: 'One board. The fastest time wins, with 2 seconds added per wrong tap.',
  versusSecs: 180,

  // 30 seconds = 100, 2.5 points per second.
  index: e => W.clamp(Math.round(100 + (30 - e.score) * 2.5), 60, 160),
  summary: e => `You finished in ${e.score.toFixed(1)} seconds, including ${e.errors} wrong ${e.errors === 1 ? 'tap' : 'taps'}.`,

  start(ctx) {
    const PAIRS = 8, PENALTY = 2;
    const labels = [];
    for (let i = 0; i < PAIRS; i++) labels.push(String(i + 1), String.fromCharCode(65 + i));

    const b = W.board(ctx);
    const total = b.layout();
    const cells = W.shuffle(Array.from({ length: total }, (_, i) => i), ctx.rng);
    labels.forEach((label, i) => { b.add(label, cells[i]).dataset.i = i; });

    let next = 0, errors = 0;
    const t0 = performance.now();
    const elapsed = () => (performance.now() - t0) / 1000 + errors * PENALTY;
    const stats = () => ctx.stats(elapsed().toFixed(1), 'seconds', next, `of ${labels.length}`);

    b.onTap(tile => {
      if (tile.classList.contains('done')) return;
      if (+tile.dataset.i === next) {
        tile.classList.add('done');
        next++;
        ctx.progress(`${next} of ${labels.length}`);
        if (next === labels.length) {
          return ctx.end({ score: Math.round(elapsed() * 10) / 10, errors });
        }
        ctx.hint(`Next is ${labels[next]}`);
      } else {
        errors++;
        tile.classList.remove('shake');
        void tile.offsetWidth;
        tile.classList.add('shake');
        ctx.hint(`Wrong card, 2 seconds added. Next is ${labels[next]}.`, 'bad');
      }
      stats();
    });

    ctx.every(100, stats);
    ctx.hint('Start with 1, then A');
    stats();
  }
});
