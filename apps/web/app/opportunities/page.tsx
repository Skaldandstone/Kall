'use client';

import { useEffect } from 'react';

export default function OpportunitiesRedirect() {
  useEffect(() => {
    window.location.replace('/search?tab=discovery');
  }, []);
  return null;
}
