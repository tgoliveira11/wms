# ADR-0009: Prisma as the ORM/migration tool

**Status:** Accepted

## Context
Each service needs schema definition, type-safe queries, and a migration history against its own
PostgreSQL database (ADR-0004), without leaking persistence concerns into `domain/`/`application/`
(Dependency Inversion — repository interfaces live in `domain/repositories`, implementations in
`infrastructure/persistence`).

## Decision
Use **Prisma** per service: `schema.prisma` as the single source of truth for that service's
tables, `prisma migrate` for versioned migrations, and the generated Prisma Client wrapped behind
each service's repository implementations (`PrismaAttendanceRepository implements
IAttendanceRepository`) so `application/` never imports Prisma directly.

## Consequences
**Positive:** strong TypeScript types generated from the schema catch mismatches at compile
time; migration files are readable and reviewable diffs (good for both human and agentic
review); Prisma's `$transaction` API cleanly expresses the atomic writes required in TDR §7 (e.g.
request-approval + record-upsert + outbox-insert in one transaction).

**Negative:** Prisma's query API doesn't map perfectly onto every advanced Postgres feature (e.g.
the partial unique index in `attendance_requests` is expressed via a raw SQL migration snippet
rather than the Prisma schema DSL, since partial indexes aren't first-class in `schema.prisma`)
— accepted as a minor, well-contained exception, documented inline in the migration file.

## Alternatives Considered
- **TypeORM:** comparable feature set and also common with NestJS, but Prisma's generated types
  and migration diffing were judged clearer for a reviewer skimming the repo quickly.
- **Raw SQL / query builder (Kysely, knex):** maximal control over the partial-index case above,
  but loses the generated-types ergonomics that keep repository implementations short and
  reviewable; rejected as unnecessary overhead for this scope.
