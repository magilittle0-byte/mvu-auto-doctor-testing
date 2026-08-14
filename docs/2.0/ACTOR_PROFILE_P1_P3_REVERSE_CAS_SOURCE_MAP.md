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

## Shared-field ownership and crossing rules

| Shared field / projection | Writer | Other side may accept | Must still reject |
|---|---|---|---|
| `actorLedger.actorRegistry`, identity/quarantine/migrations, `profileV6`, `pendingProfile` | P1 | P3 may fresh-read a profile-only evolution after freezing the original scheduled ActorId set; newly ready rows never join the current schedule | deletion of an old ActorId, or any simultaneous action/world projection change |
| actor world state, scheduling clocks, `actionAttempts`, backlog and `actionReceipts` | P3 | P1 may fresh-read a world-only evolution whose actor set, Registry, identity, profile and pending profile are unchanged | identity/profile/actor-set/scope drift; a reveal waits for the existing same-target settlement |
| `continuity` and `continuityCheckpoint` | P3 only | P1 preserves them through selected-field namespace writes | any unexpected digest/revision change in a P3 prepared/commit transition |
| `nextTurnInjection` inside continuity | P3 produces, P4 consumes exactly once | P1 never writes or clears it | foreign ownership, target mismatch, or unverified prepared/committed state |

P1 identity resolution now fresh-reads after its model transports. Pure P3
world evolution becomes the resolution base and its fresh ActorLedger revision
becomes the pending CAS baseline. An identity reveal is first formed against
the original S0 identity, then replayed through the existing bounded world-only
rebase. If the revealed ActorId has a current pending ATT, P1 joins the already
running continuity chain once and retries that local rebase without another
model call.

P3 freezes pending attempts or scheduled ActorIds from its original profile
gate before accepting any concurrent P1 evolution. After worldbook acquisition
it may replace the read-only ledger with a strictly profile-only fresh copy;
new actors remain unscheduled. A frozen row still in P1 pending state joins the
existing profile chain once before prompt construction. Phase1 and Phase2
actor-only CAS losers likewise join that existing chain before their one local
fresh-read/rebase retry. Conversely, a P1 pending/final CAS loser joins the
existing continuity chain before its single world-only replay. There is no
third model call, recursive queue, or unbounded retry.

The interleaving matrix is symmetric: P1-first and P3-first writes, fast or
slow identity, parallel core rows completing in any order, `field_state_mismatch`
or `stale_namespace_revision`, and pending-to-final / prepared-to-committed
double writes all converge through one loser-waits-for-winner replay. Target,
scope, actor world authority, same-target ATT/receipt, identity, profile, and
durable readback mismatches remain fail-closed; refresh/cancel invalidates the
current guards before a retry can write.

## Administrative writes and accepted-final hand-off

Manual profile edits use the same ActorLedger selected-field CAS/readback path
and freeze chat, operation epoch, scope, and ActorId at invocation. They never
rebind a queued edit to the current chat. Clear and checkpoint restore acquire
one management token, close the already-running P1/P3 chains, then write only
explicit selected fields with durable readback. New P1/P3 enqueue attempts are
rejected at both entry and chain attachment while that token is held.

Restore treats checkpoints as sparse payloads: a missing ActorLedger,
continuity, or world-pressure domain preserves the live domain. Only a restored
domain invalidates its dependent transaction material. ActorLedger rollback
also invalidates the P3 package because ATT authority depends on that ledger;
runtime-only restore leaves P1/P3/P4 state, recovery receipts, caches, and
in-memory ticket batches unchanged.

Accepted-final dispatch has the opposite exclusion boundary. Its queue key is
the frozen chat/generation/epoch/serial tuple: duplicate delivery joins the same
promise, while a newer generation waits behind the previous dispatch and then
re-runs every current chat, epoch, scope, P4, and accepted-source guard. The
management token is blocked from P4 consumption through actual P1/P3/variable
launch, including the post-consume scope-read gap. A stale old chat therefore
cannot cancel, drop, or absorb the next chat's accepted-final dispatch.
If a new allowed foreground STARTED arrives inside the prior ENDED reply's
500 ms acceptance window (or while its acceptance promise is still resolving),
the lifecycle clears that old timer and drains the old generation's same keyed
hand-off through module launch barriers before advancing the generation epoch.
Durable P4 settlement continues independently; the already-attached P3 queue
awaits that exact P4 promise before it may execute or write continuity, so the
consume proof and Phase1 CAS cannot race. The narrow flush alone may ignore the host `generating`
marker; all chat, source, identity, scope, epoch, and P4 authority guards remain
mandatory, and the later timer cannot dispatch the generation a second time.
