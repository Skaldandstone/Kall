const modules = [
  {
    title: 'Career identity',
    body: 'A private, reusable record of your experience, achievements, preferences, and professional goals.',
    href: '/demo/career-identity',
  },
  {
    title: 'Opportunity intelligence',
    body: 'Understand why a role fits, where the gaps are, and which experience best supports your candidacy.',
    href: '/demo/opportunity-intelligence',
  },
  {
    title: 'Resume Studio',
    body: 'Keep multiple resumes organized and prepare role-specific versions without losing your source history.',
    href: '/demo/resume-studio',
  },
  {
    title: 'Application preparation',
    body: 'Review every answer and document before Kall assists with a supported application workflow.',
    href: '/demo/application-preparation',
  },
  {
    title: 'Career memory',
    body: 'Capture accomplishments as they happen so your professional story stays current over time.',
    href: '/demo/career-memory',
  },
  {
    title: 'Across devices',
    body: 'Continue the same career workflow on the web, desktop, and mobile without relearning the product.',
    href: '/demo/across-devices',
  },
];

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Kall home">
          Kall
        </a>
        <nav aria-label="Primary navigation" className="marketing-nav">
          <a href="#product-demos">Explore demos</a>
          <a href="/login">Log in</a>
          <a className="button" href="/register">
            Create account
          </a>
        </nav>
      </header>

      <section className="hero">
        <span className="eyebrow">The Career Operating System</span>
        <h1>Build your life&apos;s work.</h1>
        <p>
          Kall brings your professional identity, opportunities, documents,
          applications, and career memory into one calm, private workspace.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <a className="button" href="/register">
            Create your Kall profile
          </a>
          <a className="button secondary" href="/demo/opportunity-intelligence">
            Explore a product demo
          </a>
        </div>
      </section>

      <section id="product-demos" aria-labelledby="platform-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Built around the individual</span>
            <h2 id="platform-heading" style={{ marginTop: 14 }}>
              More than a job search.
            </h2>
          </div>
          <p>
            Explore sample module experiences without creating an account. Live opportunities and personal workspaces remain private to signed-in users.
          </p>
        </div>

        <div className="grid">
          {modules.map((module) => (
            <a
              className="card"
              href={module.href}
              key={module.title}
              style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}
              aria-label={`Explore the ${module.title} demo`}
            >
              <span className="pill">Explore demo</span>
              <h2 style={{ marginTop: 14 }}>{module.title}</h2>
              <p>{module.body}</p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
