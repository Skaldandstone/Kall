'use client';

import { useEffect } from 'react';

export default function DocumentsRedirect() {
  useEffect(() => {
    window.location.replace('/resumes?tab=generate');
  }, []);
  return null;
}
