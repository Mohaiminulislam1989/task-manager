// Card entrance animations. Run when the board opens and when a team or lane is opened, never on the
// board's automatic refreshes, and not at all when the device asks for reduced motion.
// Every animation stays inside the card's own column: the column clips it, and cards start from within it.
// The chosen animation is saved per device (account menu > Card animation).

export const ANIMS = [
  { id: 'deal', name: 'Deal' }, { id: 'cascade', name: 'Cascade' }, { id: 'fade', name: 'Fade' },
  { id: 'flip', name: 'Flip' }, { id: 'pop', name: 'Pop' }, { id: 'none', name: 'None' },
] as const;
export type AnimId = typeof ANIMS[number]['id'];
const KEY = 'lb-anim';

export function getAnim(): AnimId {
  try { const v = localStorage.getItem(KEY); if (ANIMS.some(a => a.id === v)) return v as AnimId; } catch {}
  return 'deal';
}
export function setAnim(id: AnimId) { try { localStorage.setItem(KEY, id); } catch {} }

const STEP = 45;          // gap between cards, ms
const MAX_SPREAD = 700;   // the last card starts at most this late, so big boards still finish in about a second

type Plan = { kf: Keyframe[]; duration: number; easing: string };

function plan(anim: AnimId, el: HTMLElement, colTop: number, i: number): Plan {
  const r = el.getBoundingClientRect();
  switch (anim) {
    case 'deal': {
      // dealt from the top slot of its own column, sliding down into place
      const dy = colTop - r.top, dx = ((i * 7) % 11) - 5, tilt = ((i * 37) % 13) - 6;
      return { kf: [{ transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(.9)`, opacity: 0 }, { opacity: 1, offset: 0.12 }, { transform: 'none', opacity: 1 }],
        duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)' };
    }
    case 'cascade': {
      // falls in from the column's top edge and bounces once
      const dy = colTop - r.bottom - 8;
      return { kf: [{ transform: `translateY(${dy}px)`, easing: 'cubic-bezier(.45,0,.9,.6)' }, { transform: 'translateY(6px)', offset: 0.7, easing: 'ease-out' },
        { transform: 'translateY(-3px)', offset: 0.85 }, { transform: 'none' }], duration: 560, easing: 'linear' };
    }
    case 'fade': return { kf: [{ transform: 'translateY(14px)', opacity: 0 }, { transform: 'none', opacity: 1 }], duration: 320, easing: 'ease-out' };
    case 'flip': return { kf: [{ transform: 'perspective(600px) rotateY(90deg)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'perspective(600px) rotateY(0)', opacity: 1 }], duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)' };
    case 'pop': return { kf: [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], duration: 360, easing: 'ease-out' };
    default: return { kf: [], duration: 0, easing: 'linear' };
  }
}

export function deal(root: HTMLElement | null, anim: AnimId = getAnim()) {
  if (!root || anim === 'none' || typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  // cards on screen, with their column; dealt row by row across the columns, like a solitaire layout
  const items: { el: HTMLElement; row: number; x: number; colTop: number }[] = [];
  root.querySelectorAll<HTMLElement>('.col-body').forEach(col => {
    const cr = col.getBoundingClientRect();
    if (cr.right <= 0 || cr.left >= vw) return;
    [...col.querySelectorAll<HTMLElement>(':scope > .card')].forEach((el, row) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.bottom > 0 && r.top < vh) items.push({ el, row, x: cr.left, colTop: cr.top + 4 });
    });
  });
  if (!items.length) return;
  items.sort((a, z) => a.row - z.row || a.x - z.x);
  const step = Math.min(STEP, MAX_SPREAD / items.length);
  items.forEach(({ el, colTop }, i) => {
    const p = plan(anim, el, colTop, i);
    el.animate(p.kf, { duration: p.duration, delay: i * step, easing: p.easing, fill: 'backwards' });
  });
}
