'use client';

import { useEffect } from 'react';

export default function ProfileDetailsRedirect() {
  useEffect(() => {
    window.location.replace('/profiles?tab=record');
  }, []);
  return null;
}
