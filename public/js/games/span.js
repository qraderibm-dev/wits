W.register({
  id: 'span',
  name: 'Number span',
  tests: 'Number memory',
  how: 'Digits appear one at a time. When they stop, type them back in the same order. Each time you get it right the string grows by one digit. The game ends on your second miss, and your score is the longest string you got right.',
  unit: 'digits',
  better: 'high',
  versusNote: 'Two misses and you are out. The longest string wins.',
  versusSecs: 300,

  // 7 digits = 100, ten points per digit.
  index: e => e.score ? W.clamp(Math.round(100 + (e.score - 7) * 10), 60, 160) : 60,
  summary: e => e.score
    ? `The longest string you got right was ${e.score} digits.`
    : 'You did not get a string right this time.',

  start(ctx) {
    const MISSES = 2;
    let len = 3, misses = 0, best = 0, seq = [], typed = '', entering = false;

    ctx.stage.innerHTML = `<div class="center-stage">
      <div class="word-card"></div>
      <div class="entry"></div>
      <div class="keys off">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="del" aria-label="Delete">←</button>
        <button data-k="0">0</button>
        <button data-k="ok" class="ok">OK</button>
      </div>
    </div>`;
    const card = ctx.stage.querySelector('.word-card');
    const entry = ctx.stage.querySelector('.entry');
    const keys = ctx.stage.querySelector('.keys');
    const stats = () => ctx.stats(len, 'digits', MISSES - misses, misses === MISSES - 1 ? 'miss left' : 'misses left');

    function show() {
      entering = false;
      keys.classList.add('off');
      typed = ''; entry.textContent = '';
      seq = [];
      while (seq.length < len) {
        const d = Math.floor(ctx.rng() * 10);
        if (d !== seq[seq.length - 1]) seq.push(d);
      }
      stats();
      ctx.hint('Watch the digits');
      card.textContent = '';
      let i = 0;
      (function step() {
        if (i === seq.length) {
          card.textContent = '?';
          entering = true;
          keys.classList.remove('off');
          ctx.hint(`Type the ${len} digits in order`);
          return;
        }
        card.textContent = seq[i++];
        ctx.after(750, () => { card.textContent = ''; ctx.after(250, step); });
      })();
    }

    function press(k) {
      if (!entering) return;
      if (k === 'del') typed = typed.slice(0, -1);
      else if (k === 'ok') { if (typed.length) return submit(); }
      else if (typed.length < len) typed += k;
      entry.textContent = typed;
    }

    function submit() {
      entering = false;
      keys.classList.add('off');
      if (typed === seq.join('')) {
        best = Math.max(best, len);
        ctx.progress(`${best} digits`);
        len++;
        card.textContent = '✓';
        ctx.hint(`Correct. Next up, ${len} digits.`, 'good');
        ctx.after(1100, show);
      } else {
        misses++;
        stats();
        card.textContent = '✗';
        entry.textContent = seq.join('');
        ctx.hint('Not quite. The digits are shown below.', 'bad');
        ctx.after(2200, misses >= MISSES ? () => ctx.end({ score: best }) : show);
      }
    }

    W.tap(ctx, keys, e => {
      const btn = e.target.closest('button');
      if (btn) press(btn.dataset.k);
    });
    ctx.on(document, 'keydown', e => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') { e.preventDefault(); press('ok'); }
    });

    ctx.after(600, show);
    stats();
    ctx.hint('Get ready');
  }
});
