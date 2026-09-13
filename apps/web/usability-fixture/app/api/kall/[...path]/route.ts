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
  if (path === '/me/resume-studio') return NextResponse.json({ resumes: resumes.map((resume) => ({ ...resume, version: 1 })) });
  if (path === '/me/career-profiles/functional-areas') return NextResponse.json({ areas: [{ name: 'Quality Engineering', related_roles: ['Quality Engineer', 'QA Director'] }] });
  if (path === '/me/career-profiles') return NextResponse.json({ profiles: [{
    id: 1, name: 'Quality Engineering', target_titles: ['Director of Quality Engineering'],
    industries: ['Software'], functional_areas: ['Quality Engineering'], include_keywords: ['Release quality'], exclude_keywords: ['intern'],
    countries: ['United States'], states_regions: ['Washington'], work_types: ['remote'], employment_types: ['full_time'],
    minimum_base: 150000, target_base: 175000, stretch_base: 200000, minimum_total_comp: null, target_total_comp: null,
    target_bonus_percent: 10, travel_max_percent: 10, relocation_preference: 'none', equity_preference: 'nice_to_have',
    default_resume_id: 1, default_resume_name: 'Quality engineering resume', is_active: true, match_count: 3, best_match_score: 86, completeness: { score: 85 },
  }] });
  // Tailoring work is named by the job it was built for -- the picker on
  // both resume tabs reads this rather than asking for a proposal id.
  if (path === '/tailoring/proposals') return NextResponse.json([
    { id: 31, status: 'finalized', job_title: 'Director of Quality Engineering', company: 'Northstar Robotics', job_url: 'https://jobs.lever.co/northstar/1', change_count: 3, pending_count: 0, has_document: false, created_at: '2026-08-30T15:00:00Z', finalized_at: '2026-08-30T16:00:00Z' },
    { id: 32, status: 'review_required', job_title: 'QA Director', company: 'Acme', job_url: 'https://boards.greenhouse.io/acme/2', change_count: 2, pending_count: 2, has_document: false, created_at: '2026-08-29T15:00:00Z', finalized_at: null },
  ]);
  if (path === '/tailoring/proposals/32') return NextResponse.json({
    proposal: { id: 32, status: 'review_required', unsupported_requirements: ['Five years of medical-device experience'] },
    changes: [{ id: 91, section: 'summary', original_text: 'Quality leader.', proposed_text: 'Quality leader who owns release readiness across software delivery.', edited_text: null, reason: 'Align the opening summary with this posting.', evidence: [{ type: 'employment', id: 4, text: 'Led quality engineering at Northstar.' }], status: 'pending' }],
  });
  // A rendered layout sample. The gallery falls back to its schematic when
  // this is unavailable, so a 501 here would hide the real state under audit.
  if (/^\/tailoring\/\d+\/previews\/[a-z]+\.png$/.test(path)) {
    return new NextResponse(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ), { headers: { 'Content-Type': 'image/png' } });
  }
  if (path === '/search/suppressed' || path === '/submissions') return NextResponse.json([]);
  if (path === '/me/applications') return NextResponse.json({ stages: [{ items: [{ id: 41, stage: 'review', company: 'Northstar Robotics', role: 'Director of Quality Engineering', location: 'Remote', match_score: 86 }] }] });
  if (path === '/applications/41/review') return NextResponse.json({ review: { status: 'needs_review', readiness_issues: ['Confirm your documents and answers.'] }, questions: [{ id: 7, prompt: 'Describe your quality leadership experience.', category: 'Experience', sensitive: false, required: true }], answers: [{ id: 9, question_id: 7, value: 'I lead quality engineering teams and build reliable release practices.', status: 'suggested' }] });
  if (path.startsWith('/discovery/ats-search/')) return NextResponse.json({
    intent: '("Quality Engineering" OR "QA Director") ("Software") -"intern"',
    queries: [
      { provider: 'Lever', domain: 'jobs.lever.co', query: 'site:jobs.lever.co ("Quality Engineering" OR "QA Director") ("Software") -"intern"' },
      { provider: 'Greenhouse', domain: 'boards.greenhouse.io', query: 'site:boards.greenhouse.io ("Quality Engineering" OR "QA Director") ("Software") -"intern"' },
    ],
  });
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
  if (path.startsWith('/discovery/search-results/')) return NextResponse.json({
    enabled: true, sites_searched: 2, sites_failed: 0,
    results: [
      { title: 'Director of Quality Engineering', url: 'https://jobs.lever.co/northstar/1', snippet: 'Lead quality strategy across the org.', provider: 'Lever', domain: 'jobs.lever.co' },
      { title: 'QA Director', url: 'https://boards.greenhouse.io/acme/2', snippet: 'Own release quality end to end.', provider: 'Greenhouse', domain: 'boards.greenhouse.io' },
    ],
  });
  return NextResponse.json({ detail: 'This mutation is not implemented by the local fixture.' }, { status: 501 });
}
