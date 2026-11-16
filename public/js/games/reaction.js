W.register({
  id: 'reaction',
  name: 'Reaction',
  tests: 'Reaction speed',
  how: 'Wait for the pad to turn yellow, then react as fast as you can: tap or click the pad, or press the spacebar or Enter. You get five tries and your score is the average. Reacting before it turns yellow does not count.',
  unit: 'ms',
  better: 'low',
  versusNote: 'Five tries. The fastest average wins.',
  versusSecs: 90,

  // 270 ms = 100, one point for every 3 ms.
  index: e => W.clamp(Math.round(100 + (270 - e.score) / 3), 60, 160),
  summary: e => `Your average was ${e.score} ms over five tries, and your fastest was ${e.fastest} ms.`,

  start(ctx) {
    const TRIES = 5;
    const times = [];
    let state = 'idle', t0 = 0, timer = 0;

    const pad = document.createElement('button');
    ctx.stage.appendChild(pad);
    const set = (cls, big, small) => {
      pad.className = 'pad ' + cls;
      pad.innerHTML = `<strong>${big}</strong><span>${small || ''}</span>`;
    };
    const stats = () => ctx.stats(times.length, `of ${TRIES} tries`,
      times.length ? times[times.length - 1] : '', times.length ? 'ms last' : '');

    function arm() {
      state = 'wait';
      set('', 'Wait', 'Tap, click or press space when it turns yellow');
      timer = ctx.after(1500 + ctx.rng() * 3000, () => {
        state = 'go';
        set('go-now', 'Tap', '');
        t0 = performance.now();
      });
    }

    function press() {
      const now = performance.now();
      if (state === 'wait') {
        ctx.cancel(timer);
        state = 'early';
        set('early', 'Too soon', 'Tap or press space to try again');
      } else if (state === 'go') {
        const ms = Math.round(now - t0);
        times.push(ms);
        stats();
        ctx.progress(`${times.length} of ${TRIES}`, times.length / TRIES);
        if (times.length === TRIES) {
          const avg = Math.round(times.reduce((a, b) => a + b, 0) / TRIES);
          return ctx.end({ score: avg, fastest: Math.min(...times) });
        }
        state = 'shown';
        set('', `${ms} ms`, 'Tap or press space for the next one');
      } else {
        arm();
      }
    }
    // Mouse, touch, spacebar and Enter all count.
    ctx.on(pad, 'pointerdown', e => { e.preventDefault(); press(); });
    ctx.on(pad, 'click', e => e.preventDefault());
    ctx.on(document, 'keydown', e => {
      if (e.code !== 'Space' && e.key !== 'Enter') return;
      e.preventDefault();
      if (!e.repeat) press();
    });

    ctx.hint('React the moment the pad turns yellow');
    stats();
    set('', 'Tap or press space', 'Then wait for yellow');
  }
});
