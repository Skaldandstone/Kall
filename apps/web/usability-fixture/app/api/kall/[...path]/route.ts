import { NextRequest, NextResponse } from 'next/server';

const profiles = [
  { id: 1, name: 'Quality Engineering', default_resume_id: 1 },
  { id: 2, name: 'Engineering Leadership', default_resume_id: 2 },
];
const resumes = [{ id: 1, name: 'Quality engineering resume', is_default: true }, { id: 2, name: 'Leadership resume' }];
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api/kall', '');
  if (path === '/me') return NextResponse.json({ full_name: 'Jordan Avery', email: 'jordan@example.test' });
  if (path === '/me/professional-profiles') return NextResponse.json(profiles);
  if (path === '/me/resumes') return NextResponse.json(resumes);
  if (path === '/search/suppressed' || path === '/submissions') return NextResponse.json([]);
  if (path === '/me/applications') return NextResponse.json({ stages: [{ items: [{ id: 41, stage: 'review', company: 'Northstar Robotics', role: 'Director of Quality Engineering', location: 'Remote', match_score: 86 }] }] });
  if (path === '/applications/41/review') return NextResponse.json({ review: { status: 'needs_review', readiness_issues: ['Confirm your documents and answers.'] }, questions: [{ id: 7, prompt: 'Describe your quality leadership experience.', category: 'Experience', sensitive: false, required: true }], answers: [{ id: 9, question_id: 7, value: 'I lead quality engineering teams and build reliable release practices.', status: 'suggested' }] });
  if (path.startsWith('/discovery/ats-search/')) return NextResponse.json({ queries: [{ query: '(site:jobs.lever.co OR site:boards.greenhouse.io) ("Quality Engineering" OR "QA Director") ("Software") -"intern"' }] });
  if (path === '/me/morning-brief') return NextResponse.json({
    generated_at: '2026-08-30T15:00:00Z', user: { preferred_name: 'Jordan' },
    focus: { kind: 'opportunity', title: 'Review your strongest match', detail: 'Northstar Robotics is looking for experience you have already documented.', href: '/applications/new?job=17&profile=1&title=Director%20of%20Quality%20Engineering' },
    opportunities: [{ job_id: 17, company: 'Northstar Robotics', title: 'Director of Quality Engineering', location: 'Remote', score: 86, recommendation: 'review', strengths: ['Quality leadership', 'Software delivery'], gaps: ['Review travel expectations'] }],
    career_health: { score: 76, dimensions: [{ label: 'Career profile', score: 85, explanation: 'Your current direction and evidence are saved.' }, { label: 'Resume readiness', score: 70, explanation: 'Review your most recent leadership examples.' }] },
    applications: { total: 3, active: 2, by_status: { review: 2 } }, resumes: { total: 2, default_resume_id: 1 },
  });
  return NextResponse.json({ detail: `No local fixture for ${path}. Override this request in your test.` }, { status: 501 });
}

// Fixture POST handlers only return synthetic results. They never import or forward to the backend.
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api/kall', '');
  if (path === '/applications/prepare-options') return NextResponse.json({ id: 41, status: 'review', unanswered_questions: ['Review your leadership examples'], sensitive_fields_present: true });
  if (path === '/applications/41/review') return NextResponse.json({ status: 'needs_review' });
  return NextResponse.json({ detail: 'This mutation is not implemented by the local fixture.' }, { status: 501 });
}
