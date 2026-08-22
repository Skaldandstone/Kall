'use client';

import { useEffect } from 'react';

export default function SubmissionsRedirect() {
  useEffect(() => {
    window.location.replace('/applications');
  }, []);
  return null;
}
