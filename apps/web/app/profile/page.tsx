'use client';

import { useEffect } from 'react';

export default function ProfileRedirect() {
  useEffect(() => {
    window.location.replace('/settings/identity');
  }, []);
  return null;
}
