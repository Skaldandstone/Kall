# Isolated PostgreSQL validation, 2026-08-31

The installed PostgreSQL 17.11 binaries were used to initialize a **separate**
cluster under the integration worktree's ignored `.venv/pg-validation/data`.
It listened only on `127.0.0.1:55437`, used SCRAM password authentication and an
owner-only directory ACL. No installed Windows service, existing database,
cloud resource, deployment, Stripe object or sender was changed.

The initial command had a PowerShell argument-format error before initialization;
it was corrected without touching an existing data directory. The original
`postgresql-x64-17` service was left running throughout. The validation cluster
was stopped cleanly after the run; synthetic data is retained privately for
inspection. The starter helper's final port probe ran after shutdown because
Windows waited for descendant processes, so its empty-port error is not a
startup or test failure. Runtime probes had already verified loopback binding.

## Actual results

- Fresh Alembic upgrade through `20260831_0029` passed with PostgreSQL
  transactional DDL. Downgrade to `20260828_0027` and re-upgrade passed, preserving
  the paid user's plan, legacy customer ID, NULL/untrusted billing binding and
  weekday schedule. This exercises both new additive migrations on PostgreSQL.
- **90 PostgreSQL tests passed in 100.58 seconds.** Existing public billing,
  monitoring and notification contracts were reused with a fresh PostgreSQL
  schema per case. Two SQLite-owned concurrency tests were excluded from this
  imported set and replaced with actual eight-connection PostgreSQL races.
- Eight competing claimants produced one lease owner; an expired owner could
  not release its successor. Eight webhook workers committed one receipt and
  one entitlement update, with safe duplicate/busy outcomes and a later retry.
- The first run had 89 passes and one fixture failure: the ownership test used
  nonexistent user ID 999, rejected correctly by PostgreSQL's foreign key.
  It now creates a real second synthetic user. The original SQLite notification
  suite then passed all 14 cases, and the full PostgreSQL rerun passed.
- Sender-disabled controlled monitoring completed all three cycles against
  PostgreSQL: 10 mock requests per cycle, 0 feed errors, 0/0/100 events, and
  wall times **17.735 / 0.203 / 4.815 seconds**. Five profiles share ten boards,
  each starting with twenty postings. No external feed requests were made.

[Runtime report](postgres-validation.json) and
[controlled PostgreSQL benchmark](monitoring-benchmark-postgres.json) retain
the measurements. Private detailed JUnit output is in the ignored cluster
directory; it contains no real user data or provider credentials.

## Reproduction and boundaries

`scripts/validate_postgres.py` verifies the server's actual `data_directory`
before creating uniquely named validation databases. It refuses a different
cluster, uses its private password file without printing it, and never drops,
reconfigures or starts an existing service. It requires the explicitly prepared
local cluster and does not consume an arbitrary production database URL.
Run with the isolated environment from the continuation worktree:

```powershell
./.venv/Scripts/python.exe scripts/validate_postgres.py
```

The opt-in contracts live in `validation/postgres`, outside the default
`testpaths = ["tests"]`. `scripts/measure_monitoring.py` now permits a supplied
engine factory; its default temporary SQLite behavior remains unchanged.

This closes the local PostgreSQL migration/transaction evidence gap. It does
**not** verify RDS/network/TLS setup, a deployment artifact constrained to
0.25 vCPU/0.5 GB, cloud startup, realistic feed distribution, ten-minute target
latency or the complete $10/month ceiling. Docker was not found locally, and no
new Docker installation or cloud runtime was provisioned. Those pilot gates
remain open; monitoring and live delivery remain disabled.

Official references checked: [initdb](https://www.postgresql.org/docs/current/app-initdb.html)
and [pg_ctl](https://www.postgresql.org/docs/current/app-pg-ctl.html).
