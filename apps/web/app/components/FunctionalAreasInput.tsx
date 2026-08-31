'use client';

import { useEffect, useId, useState } from 'react';

export default function FunctionalAreasInput({ defaultValue = '', className }: { defaultValue?: string; className?: string }) {
  const id = useId();
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
    <label>
      Functional areas
      <input className={className} name="functional_areas" defaultValue={defaultValue} list={`${id}-options`}
        placeholder="Quality Engineering, Product Management" aria-describedby={`${id}-help`} />
      <datalist id={`${id}-options`}>{areas.map((area) => <option value={area} key={area} />)}</datalist>
      <small id={`${id}-help`}>Separate areas with commas. Related roles broaden your search and can add up to 10 match points. Missing an area never excludes a job.</small>
    </label>
  );
}
