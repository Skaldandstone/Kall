'use client';

import { useEffect } from 'react';

export default function JobsRedirect() {
  useEffect(() => {
    window.location.replace('/search?tab=discovery');
  }, []);
  return null;
}
