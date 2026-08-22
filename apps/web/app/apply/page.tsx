'use client';

import { useEffect } from 'react';

export default function ApplyRedirect() {
  useEffect(() => {
    window.location.replace(`/applications/new${window.location.search}`);
  }, []);
  return null;
}
