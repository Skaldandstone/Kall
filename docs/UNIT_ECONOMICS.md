# What a user costs, and what a plan is worth

The $5 and $15 prices were chosen from a cost model that lived only in a chat
window. This is that model written down, recomputed against current prices,
so the next pricing decision starts from something checkable rather than from
memory.

**Every number below is per month and in USD.** Where a figure rests on an
assumption rather than a measurement, it says so. Nothing here is measured
from production yet -- there is no billing telemetry, which is the single
biggest thing that would improve this document.

## Fixed cost: about $59/month

This is what Kall costs with no users at all: ECS Fargate for the two
services, RDS, CloudFront, Route 53, Secrets Manager, ECR. It does not scale
with signups in any meaningful way until well past the first few thousand
accounts, which is why **the break-even is roughly five Premium subscribers**
and why conversion rate matters far more than per-user cost.

Clerk is free to 10,000 monthly active users. That is a cliff rather than a
slope: crossing it is a step change, not a gradual cost, and it is worth
knowing in advance which side of it a growth push lands on.

## Per-user cost is dominated by AI, and AI is cheap

The caps in `services/quota.py` bound the worst case exactly, which is the
point of having them. Taking each plan's ceiling as though a user hit it
every period:

| | Free | Plus | Premium |
| --- | --- | --- | --- |
| AI actions | 3/week (~13/mo) | 15/week (~65/mo) | 400/mo |
| Worst-case AI cost | ~$0.04 | ~$0.18 | ~$1.12 |
| Storage ceiling | 25 MB | 500 MB | 5 GB |
| Worst-case storage | ~$0.001 | ~$0.01 | ~$0.12 |
| **Worst case total** | **~$0.04** | **~$0.19** | **~$1.24** |
| Revenue | $0 | $5 | $15 |

**The assumption doing the work here** is roughly 8,000 input and 1,000 output
tokens per AI action -- a resume truncated to 30,000 characters plus a
structured JSON reply. At `gpt-5.6-luna` ($0.20 in / $1.20 out per million)
that is about $0.0028 an action. If the real average is double that, Premium's
worst case is still under $2.50 against $15.

Storage is S3 at $0.023/GB-month and is a rounding error at every tier. It is
in the product as an anti-abuse ceiling, not a revenue lever -- `quota.py`
says so directly.

**A note on the AI price.** This was computed with `gpt-5.1-mini` until
2026-08-26, when that model turned out to have been shut down on 2026-07-23
and to have been returning 404 into a silent `except` for a month. The margin
conclusion did not move -- luna is cheap and fixed costs dominate -- but the
episode is the reason `services/openai_json.py` now logs why a call failed.

## Why the margin is not the interesting number

At any plausible scale the gross margin is somewhere north of 90%, because a
paying user costs cents and pays dollars. That is true of most software and
it is not a finding.

The number that decides whether Kall works is **conversion**. Against ~$59 of
fixed cost, five Premium subscribers or twelve Plus subscribers cover the
infrastructure completely. Everything past that is close to pure contribution.
Free users cost about four cents each per month at their ceiling, so a large
free tier is affordable -- 1,000 free users is around $40/month, less than the
fixed cost of existing.

That is what the free tier's weekly cadence is buying: five applications a
week is enough to be genuinely useful and to come back for, which is a better
position to convert from than a monthly cap someone exhausts in three days and
resents for the rest of the month.

## What would change these numbers

- **Generated documents are not billed to anyone.** Tailored resumes and cover
  letters are Kall's output, and `stored_bytes` deliberately excludes them. They
  are real S3 objects that accumulate forever. There is no retention policy
  today; that is the clearest known gap in this model.
- **Portfolio work samples, if they are ever uploads rather than embeds.** The
  career page is public, so egress scales with viewers rather than with the
  account. This is why the plan is embeds.
- **Crossing 10,000 monthly active users** moves Clerk from free to a real line
  item.
- **Anything that makes an AI action bigger.** The per-action cost assumption is
  the softest input here; a feature that sends a full job description plus a
  full resume plus history would move it several-fold.
