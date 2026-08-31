import { notFound } from 'next/navigation';
import KallMark from '../../components/KallMark';

const demos = {
  'career-identity': {
    eyebrow: 'Career identity demo',
    title: 'One professional record, shaped for every opportunity.',
    description: 'See how Kall can organize a reusable career profile without exposing private details.',
    metrics: [['12', 'verified achievements'], ['3', 'career profiles'], ['2', 'linked resumes']],
    sections: [
      ['Leadership profile', 'Director-level quality engineering leader focused on scalable automation, product risk, and high-performing teams.'],
      ['Target direction', 'Director of Quality Engineering · VP of Quality · Remote United States'],
      ['Evidence library', 'Reduced regression time by 62% · Built a 24-person quality organization · Introduced release-risk scoring'],
    ],
  },
  'opportunity-intelligence': {
    eyebrow: 'Opportunity intelligence demo',
    title: 'Understand the fit before deciding to apply.',
    description: 'Explore an example role comparison with explainable strengths, gaps, and resume guidance.',
    metrics: [['84%', 'overall match'], ['7', 'strong signals'], ['2', 'gaps to address']],
    sections: [
      ['Strong alignment', 'Quality strategy · Engineering leadership · Test automation · Executive communication'],
      ['Visible gaps', 'Fintech domain experience · Direct ownership of compliance audits'],
      ['Recommended action', 'Apply using the Quality Leadership resume and foreground regulated-release experience.'],
    ],
  },
  'resume-studio': {
    eyebrow: 'Resume Studio demo',
    title: 'Keep source resumes organized while tailoring deliberately.',
    description: 'Preview a version-aware resume workspace with readiness guidance and role associations.',
    metrics: [['91%', 'readiness'], ['4', 'resume versions'], ['6', 'target roles']],
    sections: [
      ['Quality Leadership — default', 'Best for Director and Senior Director quality-engineering roles. Updated 4 days ago.'],
      ['Technical Quality', 'Emphasizes automation architecture, CI/CD, observability, and engineering systems.'],
      ['Executive Profile', 'Condenses operating impact, organizational scale, and cross-functional leadership.'],
    ],
  },
  'application-preparation': {
    eyebrow: 'Application preparation demo',
    title: 'Review the complete application before anything is submitted.',
    description: 'See how Kall can assemble documents, answers, and unresolved questions into one controlled workflow.',
    metrics: [['8', 'answers prepared'], ['2', 'documents ready'], ['1', 'decision needed']],
    sections: [
      ['Prepared documents', 'Tailored resume · Role-specific cover letter'],
      ['Autofill review', 'Contact details · Work authorization · Location preferences · Compensation expectations'],
      ['Needs your decision', 'Confirm willingness to travel up to 20% before submission.'],
    ],
  },
  'career-memory': {
    eyebrow: 'Career memory demo',
    title: 'Capture important work while the details are still fresh.',
    description: 'Preview a private achievement timeline that can later support profiles, resumes, and interviews.',
    metrics: [['28', 'career moments'], ['16', 'verified'], ['5', 'ready for resume use']],
    sections: [
      ['Recent achievement', 'Created a release-health score that reduced late-cycle escalations across six product teams.'],
      ['Evidence attached', 'Dashboard snapshot · Leadership recognition · Before-and-after release metrics'],
      ['Suggested reuse', 'Resume achievement · Interview story · Leadership profile evidence'],
    ],
  },
  'across-devices': {
    eyebrow: 'Across devices demo',
    title: 'Continue the same career workflow wherever you are.',
    description: 'See a conceptual cross-device workspace with synchronized decisions and privacy controls.',
    metrics: [['3', 'device experiences'], ['1', 'shared workspace'], ['100%', 'user-controlled']],
    sections: [
      ['Web workspace', 'Deep profile editing, resume review, opportunity analysis, and application preparation.'],
      ['Mobile companion', 'Review matches, capture achievements, approve documents, and receive time-sensitive alerts.'],
      ['Desktop workflow', 'Focused document work, notifications, and supported application assistance.'],
    ],
  },
} as const;

type DemoKey = keyof typeof demos;

type DemoPageProps = {
  params: Promise<{ module: string }>;
};

export function generateStaticParams() {
  return Object.keys(demos).map((module) => ({ module }));
}

export default async function DemoPage({ params }: DemoPageProps) {
  const { module } = await params;
  const demo = demos[module as DemoKey];
  if (!demo) notFound();

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/"><KallMark />Kall</a>
        <nav aria-label="Demo navigation" className="marketing-nav"><a href="/sign-in">Log in</a><a className="button" href="/alpha">Private alpha</a></nav>
      </header>

      <section className="hero" style={{ paddingBottom: 40 }}>
        <span className="eyebrow">{demo.eyebrow}</span>
        <h1>{demo.title}</h1>
        <p>{demo.description}</p>
        <p className="notice" style={{ marginTop: 18 }}>This is sample data for product exploration. No account or personal information is used.</p>
      </section>

      <section className="grid" aria-label="Demo summary">
        {demo.metrics.map(([value, label]) => (
          <article className="card" key={label}><div className="metric"><strong>{value}</strong></div><p>{label}</p></article>
        ))}
      </section>

      <section className="stack" style={{ marginTop: 32 }}>
        {demo.sections.map(([title, body]) => (
          <article className="card" key={title}><span className="pill">Example</span><h2 style={{ marginTop: 14 }}>{title}</h2><p>{body}</p></article>
        ))}
      </section>

      <section className="card" style={{ marginTop: 32 }}>
        <h2>Build your own private workspace.</h2>
        <p>Create an account to replace this sample experience with your profiles, documents, opportunities, and decisions.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
          <a className="button" href="/alpha">Learn about the private alpha</a>
          <a className="button secondary" href="/">Explore other demos</a>
        </div>
      </section>
    </main>
  );
}
