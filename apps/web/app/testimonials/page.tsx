'use client';

import { useEffect } from 'react';

export default function TestimonialsRedirect() {
  useEffect(() => {
    window.location.replace('/profiles?tab=references');
  }, []);
  return null;
}
