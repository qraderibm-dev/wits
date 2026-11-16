W.register({
  id: 'stroop',
  name: 'Colour clash',
  tests: 'Focus',
  how: 'A colour word appears, printed in a different colour. On a cream card, tap the colour of the ink and ignore what the word says. On a yellow card the rule flips: tap what the word says. The answer buttons move every time and are printed in misleading colours too. You have 45 seconds. Each right answer is a point and each wrong answer takes one away.',
  unit: 'points',
  better: 'high',
  versusNote: '45 seconds. The most points wins.',
  versusSecs: 45,

  // 22 points = 100, 2.5 index points per point.
  index: e => W.clamp(Math.round(100 + (e.score - 22) * 2.5), 60, 160),
  summary: e => `You scored ${e.score} points in 45 seconds, with ${e.right} right and ${e.wrong} wrong.`,

  start(ctx) {
    const MS = 45000;
    const COLOURS = [['Red', '#c23b2a'], ['Green', '#2c8a4b'], ['Blue', '#2a5fc4'], ['Purple', '#7b3fae']];
    let right = 0, wrong = 0, ink = -1, word = -1, answer = -1, byWord = false;
    const t0 = performance.now();

    ctx.stage.innerHTML = `<div class="center-stage">
      <div class="word-card"></div>
      <div class="answers"></div>
    </div>`;
    const card = ctx.stage.querySelector('.word-card');
    const answers = ctx.stage.querySelector('.answers');
    const score = () => Math.max(0, right - wrong);
    const stats = () => ctx.stats(score(), 'points',
      Math.max(0, Math.ceil((MS - (performance.now() - t0)) / 1000)), 'seconds');

    function next() {
      let w, k;
      // About one card in three flips the rule: answer with the word, not the ink.
      byWord = ctx.rng() < 0.3;
      do {
        w = Math.floor(ctx.rng() * 4);
        // Mostly clashing pairs, with the odd matching one to keep you honest.
        k = !byWord && ctx.rng() < 0.12 ? w : (w + 1 + Math.floor(ctx.rng() * 3)) % 4;
      } while (w === word && k === ink);
      word = w; ink = k;
      answer = byWord ? w : k;
      card.textContent = COLOURS[w][0];
      card.style.color = COLOURS[k][1];
      card.classList.toggle('by-word', byWord);
      ctx.hint(byWord ? 'Yellow card: tap what the word says' : 'Cream card: tap the ink colour', byWord ? 'good' : '');

      // Buttons change places every card, each printed in a colour that is not its own.
      const shift = 1 + Math.floor(ctx.rng() * 3);
      answers.innerHTML = W.shuffle([0, 1, 2, 3], ctx.rng).map(i =>
        `<button data-i="${i}" style="color:${COLOURS[(i + shift) % 4][1]}">${COLOURS[i][0]}</button>`).join('');
    }

    W.tap(ctx, answers, e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (+btn.dataset.i === answer) {
        right++;
      } else {
        wrong++;
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
      }
      ctx.progress(`${score()} points`);
      stats();
      next();
    });

    ctx.timebar(MS);
    ctx.every(250, stats);
    ctx.after(MS, () => ctx.end({ score: score(), right, wrong }));
    stats();
    next();
  }
});
