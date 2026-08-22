'use client';

import { useEffect } from 'react';

export default function TailoringRedirect() {
  useEffect(() => {
    window.location.replace('/resumes?tab=tailoring');
  }, []);
  return null;
}
