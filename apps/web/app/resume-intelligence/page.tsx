'use client';

import { useEffect } from 'react';

export default function ResumeIntelligenceRedirect() {
  useEffect(() => {
    window.location.replace('/resumes?tab=intelligence');
  }, []);
  return null;
}
