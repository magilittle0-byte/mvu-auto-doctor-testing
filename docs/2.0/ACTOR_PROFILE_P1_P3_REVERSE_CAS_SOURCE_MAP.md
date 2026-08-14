# P1/P3 reverse-CAS source map

This note covers only the 2026-08-14 reverse-writer adaptation between P1
actor profiles and P3 world continuity.

| Source | Class | Reuse and boundary |
|---|---|---|
| Existing namespace selected-field CAS, durable readback, ActorLedger digest, pending-to-final profile write-set | **T** | Registry, pending, final, and recovery final keep the same host writer and working ledger. No parallel store or barrier was added. |
| Existing P3 Phase-1 ATT/action receipt journal and continuity chain | **A** | If P3 wins only ActorLedger, P1 fresh-reads and replays its deterministic write-set once while retaining fresh ATT, receipts, and world fields. A same-target anonymous-name reveal waits only for the already-running P3 Phase 2 so strict ActorRef settlement remains valid. |
| Bounded actor-only CAS classifier and reveal projection | **X** | Minimal glue accepts only actor-ledger-only `field_state_mismatch` or `stale_namespace_revision`. It rejects scope, SourceRef, identity/profile, actor-set, or multi-field drift. Reveal replay is limited to name, aliases, bounded evidence, updatedTurn, one version increment, registry, and profile staging/final fields. |

The replay is local and bounded to one retry. It never repeats identity
bootstrap or a model call. A second CAS loss remains `not_completed` with the
existing recovery receipt, and no pending profile is exposed through the
public ActorLedger projection.
