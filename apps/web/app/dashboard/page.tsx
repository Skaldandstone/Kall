import AppNav from '../components/AppNav';
import flow from '../components/CurrentFlow.module.css';

const primaryActions = [
  ['Search open roles', 'Use your criteria now, with or without a saved career direction.', '/search'],
  ['Set a career direction', 'Save the roles, locations, work preferences, and compensation you want Kall to use.', '/profiles'],
] as const;

const setupItems = [
  ['Add identity and links', 'Record the contact details, websites, and summary Kall may use.', '/settings/identity'],
  ['Add a source resume', 'Upload the resume Kall should preserve before proposing changes.', '/resumes'],
  ['Set field privacy', 'Choose which facts may support tailoring, autofill, or sharing.', '/privacy'],
] as const;

export default function Dashboard() {
  return (
    <main className={`shell ${flow.shell}`}>
      <AppNav />
      <section className="hero">
        <span className="pill">Start here</span>
        <h1>What are you deciding today?</h1>
        <p>Search immediately, or save a career direction so Kall can compare roles against the criteria that matter to you.</p>
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
      <p className="muted" style={{ margin: '40px 0 12px' }}>Complete your foundation</p>
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
