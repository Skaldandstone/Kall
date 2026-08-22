'use client';

import { useEffect } from 'react';

export default function IntelligenceRedirect() {
  useEffect(() => {
    window.location.replace('/profiles?tab=achievements');
  }, []);
  return null;
}
