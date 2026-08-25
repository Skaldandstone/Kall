import AppNav from '../components/AppNav';

const primaryActions = [
  ['Search for a job', 'Find open roles and see how well you match right now.', '/search'],
  ['Create a profile', 'Set your target roles, locations and compensation.', '/profiles'],
] as const;

const setupItems = [
  ['Complete identity', 'Add websites, portfolios and contact preferences.', '/settings/identity'],
  ['Upload resumes', 'Build your Resume Studio and tag each version.', '/resumes'],
  ['Review privacy', 'Choose which fields can tailor, autofill or stay private.', '/privacy'],
] as const;

export default function Dashboard() {
  return (
    <main className="shell">
      <AppNav />
      <section className="hero">
        <span className="pill">Your workspace</span>
        <h1>Make your next move clear.</h1>
        <p>Jump straight into a job search, or set up a new career profile.</p>
      </section>
      <div className="two">
        {primaryActions.map(([title, description, href]) => (
          <a
            className="card"
            href={href}
            key={title}
            style={{ display: 'block', textDecoration: 'none', borderColor: 'var(--accent)' }}
          >
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="muted">Open →</span>
          </a>
        ))}
      </div>
      <p className="muted" style={{ margin: '40px 0 12px' }}>Finish setting up</p>
      <div className="grid">
        {setupItems.map(([title, description, href]) => (
          <a className="card" href={href} key={title} style={{ display: 'block', textDecoration: 'none' }}>
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="muted">Open →</span>
          </a>
        ))}
      </div>
    </main>
  );
}
