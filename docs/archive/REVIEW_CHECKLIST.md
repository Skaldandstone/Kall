# Review checklist

- Confirm backend CI passes.
- Confirm web production build passes.
- Confirm Alembic upgrade succeeds on a clean database.
- Confirm login lockout, logout, password reset, and email verification flows behave as expected.
- Confirm production configuration rejects weak secrets and SQLite.
