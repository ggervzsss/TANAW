## Database Schema And Migration Policy

TANAW is currently in a pre-production stage. There is no production or
user data that must be preserved yet.

### Current Pre-Production Policy

Until the user explicitly states that TANAW has entered a data-preservation
or production stage:

- Treat PostgreSQL and desktop SQLite development databases as disposable.
- Do not create incremental database migrations solely to preserve development
  data.
- Do not add data backfills, legacy-schema compatibility logic, or upgrade paths
  for disposable development databases.
- Prefer the clean final schema required by the current codebase rather than
  transitional schema designs.
- Existing development databases may be reset and recreated when schemas change.

For PostgreSQL:

- Keep Alembic available as TANAW's database migration infrastructure.
- Keep the current canonical initial baseline as the authoritative fresh
  PostgreSQL schema.
- While this pre-production policy remains active, update the canonical baseline
  directly when PostgreSQL schema changes are required.
- Do not create `0002`, `0003`, or later incremental migrations unless the user
  explicitly changes this policy.

For desktop SQLite:

- Keep SQLite migration infrastructure available and migration-ready.
- The current SQLite schema is the canonical initial migration baseline.
- While this pre-production policy remains active, update that baseline directly
  when SQLite schema changes are required.
- Do not create `002`, `003`, or later SQLite migration revisions unless the
  user explicitly changes this policy.
- Development SQLite databases may be recreated rather than migrated while this
  policy is active.

The presence of migration infrastructure does not mean migration history is
currently frozen or that incremental migrations should automatically be
created.

### Future Data-Preservation Policy

Do not infer that TANAW has entered this stage. The user must explicitly state
that existing database data now needs to be preserved.

Once that transition is explicitly declared:

- Freeze all existing PostgreSQL and SQLite migration baselines and previously
  applied migration revisions.
- Never rewrite an already released or applied migration.
- Create new ordered migrations for subsequent schema changes.
- Preserve existing database contents.
- Add data transformations, backfills, and compatibility handling when genuinely
  required by a migration.
- Test upgrades from supported existing database revisions to the new revision.

Until that explicit transition occurs, continue following the pre-production
policy above.