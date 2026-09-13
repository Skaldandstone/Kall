'use client';

import { useEffect, useState } from 'react';
import ChipsInput from './ChipsInput';

/**
 * Functional areas as removable chips, suggested from the known set.
 *
 * This was a comma-separated text box, which on a phone means typing every
 * area and its separators into a single line you cannot see the start of
 * once the keyboard is up -- and a stray comma or a missing one silently
 * changed what got stored.
 */
export default function FunctionalAreasInput({ defaultValue = '', className }: { defaultValue?: string; className?: string }) {
  const [areas, setAreas] = useState<string[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/kall/me/career-profiles/functional-areas', { signal: abort.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setAreas(data.areas.map((area: { name: string }) => area.name)); })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  return (
    <ChipsInput
      name="functional_areas"
      label="Functional areas"
      className={className}
      placeholder="Quality Engineering, Product Management"
      defaultValue={defaultValue.split(',').map((item) => item.trim()).filter(Boolean)}
      suggestions={areas}
      helpText="Related roles broaden your search and can add up to 10 match points. Missing an area never excludes a job."
    />
  );
}
