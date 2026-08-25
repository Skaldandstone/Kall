/**
 * The Kall "Stave" mark: a bold chevron crossed by a hairline brass stave that
 * overruns it top and bottom -- the vertical line a runestone inscription is
 * carved along.
 *
 * Inlined rather than an <img> so the chevron inherits currentColor and tracks
 * the surrounding text. Butt caps and mitre joins are load-bearing: rounding
 * either breaks the carved construction the whole identity is built on.
 *
 * Below 24px use `small`, which thickens both strokes -- the hairline stave
 * disappears entirely at favicon sizes otherwise.
 */
export default function KallMark({ size = 26, small = false }: { size?: number; small?: boolean }) {
  const stave = small ? { x: 6.6, width: 3 } : { x: 7.1, width: 2.2 };
  const chevron = small ? 'M25.6 5.4 L13.6 16 L25.6 26.6' : 'M25.6 5.4 L13.2 16 L25.6 26.6';
  const strokeWidth = small ? 5.4 : 4.8;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <rect x={stave.x} y="1.6" width={stave.width} height="28.8" fill="var(--accent)" />
      <path
        d={chevron}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
