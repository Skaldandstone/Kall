'use client';

import { useEffect } from 'react';

export default function GrowthRedirect() {
  useEffect(() => {
    window.location.replace('/profiles?tab=growth');
  }, []);
  return null;
}
