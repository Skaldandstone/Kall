'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import KallMark from './components/KallMark';

const modules = [
  {
    title: 'Professional record',
    body: 'Keep your roles, achievements, skills, credentials, references, and preferences in one record you control.',
    href: '/demo/career-identity',
  },
  {
    title: 'Role comparison',
    body: 'Compare a job with your saved experience, see the evidence behind the score, and review any gaps before you act.',
    href: '/demo/opportunity-intelligence',
  },
  {
    title: 'Resume versions',
    body: 'Preserve your source resumes, choose one for each career direction, and review every proposed change.',
    href: '/demo/resume-studio',
  },
  {
    title: 'Application review',
    body: 'Assemble the resume, cover letter, answers, and sensitive fields for your approval before anything is submitted.',
    href: '/demo/application-preparation',
  },
  {
    title: 'Career planning',
    body: 'Turn a target role into skill gaps, milestones, and learning steps you can review and update.',
    href: '/demo/career-memory',
  },
  {
    title: 'One continuous record',
    body: 'Review the same saved decisions and career facts on web, desktop, and mobile.',
    href: '/demo/across-devices',
  },
];

export default function Home() {
  // Someone already signed in who lands on the marketing page (a bookmark, a
  // typed URL, a browser restore) should go straight to their workspace rather
  // than be shown "Log in / Create account" as though they were a stranger.
  // Clerk knows this client-side, so there is no API round trip and no flash.
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn) window.location.replace('/dashboard');
  }, [isLoaded, isSignedIn]);

  // Only blank the page while a confirmed sign-in is being redirected. This
  // must not wait on isLoaded: the marketing page is public, and gating it on
  // Clerk means a slow or blocked Clerk script shows visitors nothing at all.
  if (isLoaded && isSignedIn) return null;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Kall home">
          <KallMark />
          Kall
        </a>
        <nav aria-label="Primary navigation" className="marketing-nav">
          <a href="#product-demos">See how it works</a>
          <a href="/sign-in">Log in</a>
          <a className="button" href="/alpha">
            Private alpha
          </a>
        </nav>
      </header>

      <section className="hero">
        <span className="eyebrow">Career decisions, grounded in your record</span>
        <h1>Know what you can do next.</h1>
        <p>
          Kall keeps the facts of your career in one place, shows how they support
          a role, and prepares the documents and questions you need to review before applying.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <a className="button" href="/alpha">
            Learn about the private alpha
          </a>
          <a className="button secondary" href="/demo/opportunity-intelligence">
            See a role comparison
          </a>
        </div>
      </section>

      <section id="product-demos" aria-labelledby="platform-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">A record you can use</span>
            <h2 id="platform-heading" style={{ marginTop: 14 }}>
              One source of truth for every career move.
            </h2>
          </div>
          <p>
            Open a sample to see what Kall records, compares, and prepares. Your opportunities and career data remain private to your account.
          </p>
        </div>

        <div className="grid">
          {modules.map((module) => (
            <a
              className="card"
              href={module.href}
              key={module.title}
              style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}
              aria-label={`View the ${module.title} example`}
            >
              <span className="pill">View example</span>
              <h2 style={{ marginTop: 14 }}>{module.title}</h2>
              <p>{module.body}</p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
