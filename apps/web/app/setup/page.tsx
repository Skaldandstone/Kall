'use client';

import { useEffect } from 'react';

export default function SetupRedirect() {
  useEffect(() => {
    window.location.replace('/profiles');
  }, []);
  return null;
}
