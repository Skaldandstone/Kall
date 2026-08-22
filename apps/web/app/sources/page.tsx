'use client';

import { useEffect } from 'react';

export default function SourcesRedirect() {
  useEffect(() => {
    window.location.replace('/search?tab=sources');
  }, []);
  return null;
}
