# Generated content in Kall

Kall follows the Skald & Stone generated-content standard, policy version
`sands-generated-content-v1`. The canonical standard is
`Skaldandstone/Studio/docs/GENERATED-CONTENT-STANDARD.md`, merged in Studio
PR 15 at commit `13b97a8455afbb3a92a9aa974c08b090c4322aa6`.

## Runtime contract

Every product-side OpenAI request goes through
`backend/kall/services/openai_json.py`. The adapter sends Kall-owned developer
instructions separately from customer input. Those instructions require:

- direct, natural writing grounded in the supplied record;
- explicit separation of answers, reviewed evidence, calculated signals,
  unknowns, interpretations, and recommendations;
- no invented employment facts, credentials, skills, citations, confidence,
  compensation, market rates, benchmarks, scores, findings, or outcomes;
- visible uncertainty, source limits, dates, jurisdiction, and applicability;
- customer resumes, postings, attachments, retrieved evidence, and quotations
  to remain untrusted data that cannot override developer instructions; and
- accountable human review before consequential career material is used.

The browser and mobile applications never hold an OpenAI key or construct the
governing instruction.

The adapter uses the Responses API with `store: false` and a strict JSON
schema. Kall then validates the returned JSON against that schema locally,
normalizes text, rejects common instruction-leakage markers, and only then
returns content to a service. Resume and cover-letter paths additionally reject
new dates, percentages, dollar amounts, or other immutable numeric claims that
do not occur in their source evidence. Invalid output activates the service's
deterministic fallback or an explicit unavailable state.

Successful generations produce a content-free operational trace containing
the policy version, Kall prompt version, model, provider response ID, token
usage, source record reference, validation result, and elapsed time. Prompts,
resume text, postings, generated text, API keys, cookies, and bearer tokens are
not included in that trace.

## Product paths reviewed

| Product path | Source boundary and review | Safe failure |
| --- | --- | --- |
| Career strategy suggestions | Resume evidence; user approves form values | Evidence-only deterministic extraction |
| Career profile field suggestions | Saved profile and resume; only empty, non-compensation fields are offered | Explicit unavailable state |
| Related title suggestions | Titles already approved by the user | Rules-based same-level title variants |
| Resume recommendations | Owned resume and active profile titles; preview before creating a version | Evidence-preserving deterministic recommendations |
| Growth plan | Owned goal and default resume; milestones remain editable | Deterministic plan |
| Skill assessment | User answer, owned goal, and resume; output is guidance | Explicit deterministic gaps, labeled deterministic |
| Interview preparation | Owned application and stored posting; company context is labeled an inference | Generic question bank |
| Interview practice feedback | User answers and the displayed answer rubric; feedback is advisory | Ungraded self-check, never a fabricated score |
| Tailored summary and role-gap prompts | Owned selected resume, posting requirements, and verified achievements; every change requires review | Rules-based summary and questions with placeholders |
| Cover letter | Finalized, reviewed resume proposal and stored posting; every paragraph remains a reviewable change | Rules-based letter |
| Provider preflight | Operator-owned static fixture | Fails closed |

All customer routes authenticate the user and check record ownership. Paid
model paths check the existing AI-action allowance before a provider call and
record usage only after accepted generated output. Input sizes are bounded by
request models and by prompt-specific truncation before the adapter call.

Compensation suggestions are intentionally excluded from model-generated
profile fields. Career-strategy salary suggestions remain null because Kall
does not have a reviewed compensation data source. Users set their own target
compensation.

## Customer-facing material review

The current landing page describes evidence and review rather than guaranteed
outcomes. Public demos label all records and metrics as sample data. Terms and
privacy copy identify generated material as fallible drafts that the user must
review. Resume readiness is defined as deterministic metadata and evidence
completeness, not an ATS or hiring prediction. Company context in interview
prep is labeled as an inference from the posting rather than verified research.

Generated email digests are deterministic summaries of stored match records.
They do not ask a model to create new claims. Match percentages remain the
product's documented deterministic comparison signals and do not represent a
hiring probability.

## Verification boundary

Unit and integration tests can verify request construction, schema rejection,
fallback behavior, metering, and the absence of customer text in application
logs. They do not verify a live provider response, CloudWatch ingestion,
visual review of every generated fixture, or customer acceptance. Those remain
runtime and human-review gates.
