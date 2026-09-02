import type { ReactNode } from 'react';

/**
 * Renders a fact from app/lib/legal.ts, or a loud gap if nobody has supplied it.
 *
 * The gap is deliberately ugly. A legal page is the one place where an
 * unnoticed blank is expensive, and the whole point of keeping these facts in
 * one module is that an unfilled one is impossible to read past.
 */
export function LegalValue({
  value,
  label,
  render,
}: {
  value: string | number | string[] | null;
  /** What is missing, in the words the person filling it in would use. */
  label: string;
  /** Optional formatter for a set value, e.g. wrapping an email in a mailto. */
  render?: (value: string | number | string[]) => ReactNode;
}) {
  if (value === null) {
    return (
      <mark
        style={{ background: '#fde68a', color: '#1c1917', padding: '0 6px', fontWeight: 600 }}
        data-legal-fact-missing={label}
      >
        [{label} not set - see docs/LEGAL.md]
      </mark>
    );
  }
  if (render) return <>{render(value)}</>;
  if (Array.isArray(value)) {
    return (
      <>
        {value.map((line, index) => (
          <span key={line} style={{ display: 'block' }}>
            {line}
            {index === value.length - 1 ? '' : ''}
          </span>
        ))}
      </>
    );
  }
  return <>{value}</>;
}

/** An email fact, rendered as a working mailto when it is set. */
export function LegalEmail({ value, label }: { value: string | null; label: string }) {
  return (
    <LegalValue
      value={value}
      label={label}
      render={(email) => <a href={`mailto:${String(email)}`}>{String(email)}</a>}
    />
  );
}
