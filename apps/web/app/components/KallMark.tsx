/**
 * The Kall "Bindrune" mark: a heavy chevron whose vertex overruns the brass
 * stave and crosses it, the way two runes are bound into a single carved
 * glyph. The crossing is the idea -- pull the vertex back inside the stave and
 * it collapses into an ordinary bracket-and-bar.
 *
 * Inlined rather than an <img> so the chevron inherits currentColor and tracks
 * the surrounding text.
 *
 * One construction at every size, deliberately. The previous mark needed a
 * second, thickened variant below 24px because its 2.2px stave fell under a
 * device pixel and vanished; the geometry here was tuned against rasterised
 * output at 16px until a single set of weights held on both grounds. Two
 * numbers carry that and should not be nudged casually: the stave at 3.6 is
 * what keeps brass visible at favicon size, and the vertex at 6.8 is as far
 * left as the overrun can go before the crossing closes into a dark knot.
 *
 * Butt caps and mitre joins are load-bearing: rounding either breaks the
 * carved construction the identity is built on.
 */
export default function KallMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <rect x="9.2" y="1.6" width="3.6" height="28.8" fill="var(--accent)" />
      <path
        d="M26.2 4.6 L6.8 16 L26.2 27.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
