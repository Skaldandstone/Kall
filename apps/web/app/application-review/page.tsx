'use client';

import { useEffect } from 'react';

export default function ApplicationReviewRedirect() {
  useEffect(() => {
    window.location.replace('/applications');
  }, []);
  return null;
}
