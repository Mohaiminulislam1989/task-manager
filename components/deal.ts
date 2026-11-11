// Card "deal" entrance: cards fly in one after another from a single deck point and land in their columns,
// like the deal at the start of a game of solitaire. Runs when the board opens and when a team is opened,
// never on the board's automatic refreshes, and not at all when the device asks for reduced motion.

const DUR = 420;          // flight time of one card, ms
const STEP = 45;          // gap between cards, ms
const MAX_SPREAD = 700;   // the last card starts at most this late, so big boards still finish in about a second

export function deal(root: HTMLElement | null, from?: { x: number; y: number }) {
  if (!root || typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  // only cards on screen; the rest just appear
  const cards = [...root.querySelectorAll<HTMLElement>('.card')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
  });
  if (!cards.length) return;
  const box = root.getBoundingClientRect();
  const deck = from ?? { x: box.left + 24, y: box.top + 24 };
  const step = Math.min(STEP, MAX_SPREAD / cards.length);
  // columns clip their content; let cards fly in from outside, then restore
  root.classList.add('dealing');
  let left = cards.length;
  cards.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dx = deck.x - (r.left + r.width / 2), dy = deck.y - (r.top + r.height / 2);
    const tilt = ((i * 37) % 13) - 6; // a little irregular, like real cards
    const a = el.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(.9)`, opacity: 0 },
      { opacity: 1, offset: 0.12 },
      { transform: 'none', opacity: 1 },
    ], { duration: DUR, delay: i * step, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' });
    const done = () => { if (--left === 0) root.classList.remove('dealing'); };
    a.onfinish = done; a.oncancel = done;
  });
}
