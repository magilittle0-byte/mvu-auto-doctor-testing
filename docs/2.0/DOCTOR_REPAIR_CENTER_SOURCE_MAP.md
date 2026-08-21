# Doctor repair center source map

适用候选：`2.0.0-rc.39`。rc.38 真实失败码 `profile_source_anchor_missing` 现在先走零模型本地修复：只有精确 accepted `<content>` 确实逐字包含同票自然姓名时，才把缺失/不匹配锚点收敛为姓名；否则仍保留固定码、零写入和单人物恢复 owner。`full_adult` 任一生理字段缺失继续属于完整度失败，不会被绿色卡或 readback-ready 掩盖；配套 V8 优先要求正文模型在主回复回执内一次写齐，单人物模型只作为持久恢复材料成功后的后备。

人物正常路径仍先本地解析 accepted-final 回执且零人物模型。若精确 V4 回执证明格式、完整度或绑定缺项且初次事务零写入，P1 复用同一个单人物 repair adapter 按 sealed failedActorTargets 顺序自动补齐；每个 ActorId 独立完成 MVU 写入/readback 后才移除该 owner，后续人物失败不会回滚前面已验证人物。显式 Registry projection owner 仍必须携带封存的结构化 evidence，不能借普通补档回执绕过。

The repair center is a thin manual orchestrator. It does not own MVU, ActorLedger,
continuity, model queues, or a second durable state machine.

| Module | Existing production owner reused | Adapter boundary |
|---|---|---|
| Variable | `runVariableSafeRepair` and the existing variable repair plan, undo evidence, CAS/readback, and variable bug capsule | The unified adapter passes the frozen accepted target and continuation guard into this entrypoint. Exact pending automatic work is joined first; an unsuccessful join may start exactly one manual attempt only while the full target/scope/foreground guard remains current. Outcome handling, variable-capsule persistence, journal precondition, and final UI all repeat that guard. It accepts `completed` only when the variable audit reports readback (or a verified no-change) and never invokes P1/P3. |
| Profile | `enqueueActorProfiles(... force, expectedTarget)` and the existing SourceRef ticket/retry receipt plus pending-to-final readback | `atomic_readback` is success, `no_candidates` is verified no-change, every other terminal remains failed. No direct ActorLedger write is added. |
| World | `enqueueContinuity(... force, manualRecovery, expectedTarget)` and existing prepared/committed recovery | Only explicit `applied` plus durable readback is success. `duplicate`, `busy`, pending, stale, and validation failure remain failed/busy outcomes; the adapter never upgrades an in-memory completed-key cache to durable no-change. No direct continuity write is added. |

`buildDoctorRepairPlan` and `executeDoctorRepairPlan` are new stateless glue. They
freeze one current accepted target, block during the existing foreground/P4/
accepted-final/management critical section, continue
independent modules after an ordinary module failure, and stop the remaining
actions only when chat, SourceRef, scope, or foreground guards change.

The three single-module buttons remain explicit forced repairs. `repair-all`
first projects current-target health without writing authority: variable uses
an exact-target `needs_update` capsule or the latest exact-target terminal
variable diagnostic; profile uses the hydrated current-SourceRef retry/not-
completed diagnostic, exact-target capsule, or exact-target terminal diagnostic;
world uses a matching prepared/manual checkpoint, exact-target capsule, or the
latest exact-target terminal world diagnostic. Model diagnostics receive the
strict target digest when the production model/final diagnostic record is
created; it is never synthesized later from the current index. The variable
queue also appends a privacy-safe `variable_final` record after `runTarget`
settles, so commit, durable readback, rollback, and frontend-sync failures are
newer than a successful transport/parse record. Verified applied/no-change
supersedes an older failure; stale, cancellation, disabled, duplicate, and
foreground preemption are cancellation-class records and are not selected for
automatic repair-all. The final receipt is emitted only while its captured chat
and operation epoch are still current and explicitly carries the captured
chat's hashed scope. A late result after chat replacement or invalidation
therefore creates no diagnostic and does not schedule persistence in the new
chat. The variable final recorder applies the same full terminal-evidence guard
before even appending to the in-memory diagnostic list, so swipe, generation,
content, scope, or epoch drift is zero-record as well as zero durable-write.
Index-only model
diagnostics and global status colors are not health authority. Only the
resulting unhealthy module list is enqueued. An empty list
returns `doctor.repair.no_faults_detected` with zero model calls, zero writes,
and no journal capsule, so a health check does not spend model quota.

The profile health projection receives the same already-frozen read-only target
from the repair-center selector. It does not call the legacy mutating
`captureTarget` path while deciding whether `repair-all` has work, so a healthy
profile cannot secretly create a message id or queue a host save. Other legacy
diagnostic callers retain their existing default capture behavior.

Current health is an exact-target, per-module event projection rather than a
permanent OR of all historical failures. It compares the newest capsule
`createdAt` with the newest durable terminal diagnostic `at`: a later verified
success suppresses an older `needs_update` capsule without deleting history,
while a still-later terminal failure selects the module again. Current hydrated
profile retry/not-completed authority and active world reserved/prepared/manual
checkpoint authority remain immediate failures. Thus a successful repair-all
does not spend quota again merely because its earlier failure capsule is still
available for diagnostics.

Repair-center target discovery is mechanically read-only. It accepts an
already persisted Doctor/swipe/host message id, a continuation identity hint,
or the host's legacy `send_date`; it never calls the message-id migration/save
path. If none exists, the button returns `doctor.repair.target_unavailable`.
Consequently the no-fault `repair-all` path performs zero namespace writes and
zero host chat saves. Explicit module repair may still use the existing normal
target-migration entrypoint once actual repair work has been requested.
Before freezing that read-only target, the button resolves the host's current
worldbook selector scope and passes the resolved scope into capture. This
prevents a cold page's first click from capturing the fallback selector cache,
then cancelling itself when the same click hydrates the real selector list.
Chat changes during this read-only resolution return target-unavailable, and
any later target/scope change renders a visible cancelled state instead of
leaving the repair center displayed as busy.

Every request freezes one hashed target identity over chat, message, index,
swipe, generation serial/id/type, accepted-content fingerprint, and sovereignty
scope digest. The same digest is used by the plan, in-memory request key,
capsule/history selector, and journal persistence precondition; raw chat,
message, generation, and content identifiers are not stored in the capsule.
The live current-scope digest is re-read across awaits, so a card/worldbook scope
change cancels the old repair before any capsule write.

The center adds only in-memory request/module maps and a serial promise chain.
Repeated clicks with the same target digest and requested module join the same
promise; different requests serialize. `repair-all` publishes owner-bound slots
for every module in its actual health plan before execution, so a simultaneous
single-module click joins that verified module result instead of spending a
second model call or write. Slots disappear when that request finishes, so a
later explicit click remains a new intentional retry. Module adapters reuse the existing owners:
current automatic variable work joins `runChain`, current P1 joins
`actorProfileChain`, and P3 uses `afterPending: true` to join
`continuityChain`. A verified joined success is reused; only an unsuccessful
world join may fall through exactly once to the existing manual-recovery
entrypoint, and only while the full target/scope/foreground guard is still
current. A click made with no pending P3 performs one manual attempt and never
auto-retries its own failure. No durable queue or
parallel state machine is introduced.

A request that is only waiting on the center's serial queue does not yet publish
module slots and is not claimed as covered. Slots are created only after the
request passes its fresh target/foreground checks and `repair-all` has built the
actual unhealthy-module plan. This keeps queued requests serialized without
misrepresenting work that has not started.

Cancellation, chat replacement, and operation invalidation advance an in-memory
queue generation, detach the request chain, and resolve/delete old owner-bound
module slots. A new request can therefore start immediately without waiting for
an uncooperative old provider. Every old task still carries the frozen target
and epoch guard; owner comparisons prevent an old `finally` from deleting a new
request with the same module key, and stale work performs no capsule, status, or
authority write. P3 uses the same owner-bound rule: its pending registry is a
target-keyed owner map, exact joins await that owner's task, and explicit user,
chat, swipe, generation, or management invalidation detaches the old continuity
tail. A replacement manual world repair can start even if the old host request
never acknowledges abort; an old `finally` can delete only its own owner.
The queued P3 task rechecks epoch, chat, and exact map owner immediately after
its accepted-final start barrier and again after any prior-target recovery
await. A detached task therefore returns `world_task_owner_changed` before a
fresh capture/model call and cannot append a terminal receipt or overwrite the
replacement owner's UI. The same owner gate runs again after the asynchronous
terminal-diagnostic receipt in both normal and exception paths; only the still-
owning task may then mark the target completed or update/render continuity UI.
Foreground narrative preemption does not call this detach path and therefore
keeps the existing recovery chain. Continuity owners and Doctor-center request/
module slots are included in the shared cancel-button and idle checks. A busy
center invalidated by the user switches to a fixed cancelled UI state without
writing an operation record.

Each attempted module produces a separate privacy-safe capsule in the existing
`repairJournal`: runtime fingerprint, hashed chat scope, module, fixed outcome
code, target index, duration, model-call/write counts, zero-write, and readback
boolean. Narrative, names, prompts, model output, credentials, and profile/world
contents are never copied. Capsule persistence reuses `writeRepairJournal` and
its selected-field durable readback; a chat switch means zero journal write and
zero status/log write into the new chat. The existing repair-journal compactor
keeps variable-only and unified Doctor capsules under one 25-entry bug-capsule
limit, separate from the five operational undo records.

Variable and world terminal results additionally await a privacy-safe
`modelDiagnostics` receipt before their queue task settles. This selected-field
write uses the frozen full target/scope guard, CAS plus durable readback, and at
most one local fresh-merge retry; it never retries the model. Concurrent
diagnostics are preserved, and persistence failure is returned as
`terminalDiagnosticPersisted: false` rather than presented as durable evidence.
Ordinary per-call diagnostics retain their existing debounced save.
Terminal receipts use the exact chat/epoch/live-scope/read-only SourceRef and
content guard, but do not require the repair-button idle guard: variable and P1
can legitimately finish while accepted-final/P4 is still settling. Repair
execution and capsule persistence continue to require the stricter foreground-
idle guard. Any chat, swipe, generation, content, scope, or epoch drift still
causes zero terminal writes.

P1 now emits the same selected-field terminal receipt after its existing
recovery finalizer: only `atomic_readback` or `no_candidates` with profile
readback is success; a `not_completed` result is automatically repairable only
when the existing recovery receipt was saved. Stale/cancelled or recovery-
unavailable outcomes stay visible. An exact-target `recovery_unavailable`
terminal with no verified retry receipt remains a selected fault, but the
profile adapter returns the fixed
`doctor.repair.profile.recovery_unavailable` blocked result without calling P1,
the model, or ActorLedger. Thus `repair-all` cannot misreport the refreshed
state as healthy and cannot spend quota by blindly repeating identity discovery.
The queue's final exception path also awaits this durable
`recovery_unavailable` receipt before publishing its in-memory/UI failure; it
then rechecks the exact pending owner, chat, and epoch, exposes `canRetry=false`,
and returns whether the terminal receipt was actually persisted.

World terminal success uses the same gate as the repair adapter: `applied` plus
`readbackVerified === true`. An in-memory or unverified committed package is
recorded as `world.committed.readback_unverified`, remains selectable by
`repair-all`, and cannot supersede an older failure. The zero-model committed
recovery path performs a fresh durable readback of continuity, checkpoint, and
ActorLedger, then revalidates the exact current target/scope package and
settlement proof before returning verified success.

World `disabled`, `stale`, and `duplicate` terminal receipts are cancellation-
class evidence and never select automatic repair-all; `blocked` remains a real
fault. Thus turning the world module off produces a durable explanatory receipt
but zero repair-all actions, model calls, and authority writes.

That committed-package recovery allows unrelated profile/Registry evolution of
the whole ActorLedger after world commit, but only through the existing
`allowUnrelatedLedgerEvolution` option. Producer/source continuity, checkpoint
target, same-target ATT and receipt counts, action-authority digest, and
settlement results remain strict; ATT or receipt drift still fails closed. The
generic readback CAS compares only Doctor-owned `continuity` and
`continuityCheckpoint`; it reads the fresh persisted ActorLedger inside the
content validator, where the strict same-target package proof above decides
whether a concurrent profile-only evolution is safe.

Variable and unified Doctor capsules fresh-merge the existing `repairJournal`
by stable capsule id, then use selected-field CAS/readback with one local retry.
Undo records and independently arriving capsules are preserved. The older
general undo writer is unchanged and remains fail-closed on its own conflict;
no second journal or parallel recovery state machine is introduced.

`zeroWrite` is conservative for profile and world adapters: it is true only
when the owner explicitly reports it, or when a reliable numeric write count is
exactly zero. Failed, prepared, recovery, duplicate, or otherwise unknown
results are not inferred to be zero-write merely because they were not applied.
An unexpected adapter exception is likewise recorded with `zeroWrite: false`,
because it may have occurred after a model call or persistence attempt.

`doctorRepairCapsuleProjection` is the only unified history view. It exposes at
most 25 entries and only module, fixed status/outcome code, duration, model/write
counts, readback/zero-write booleans, runtime fingerprint, target index, and
hashed target digest plus created time. Chat change and initialization hydrate the plain-language center
summary from the current chat's projection or reset it when no capsule exists.
The same projection is re-sanitized by `createPrivacySafeDiagnosticProjection`;
chat id, narrative, names, prompts, and raw model output are not exported.

`doctorRepairCenterSemanticFingerprint()` is embedded in the runtime-critical
fingerprint. Its source covers the fixed module/success sets plus `safeCode`,
counter normalization, the strict readback success gate, health selection,
execution, capsule creation, and projection; changing an internal success rule
therefore changes the install/runtime fingerprint. The runtime-critical list
also binds the read-only identity chain, resolved sovereignty-scope capture,
ordinary and terminal diagnostic
recorders/merge/persistence, journal capsule merge/persistence, and conservative
zero-write classifier. It explicitly binds `stage3FieldState`, the
`createContinuityPendingOwnerMap` factory, and the runtime-called
`continuityPendingOwnerRegistryFingerprint()`. The latter reads the actual
pending registry and proves its `Map` constructor plus owner-identity
`get`/`set` round trip, so changing selected-field digest semantics or
regressing the live owner registry to an unowned `Set` changes the runtime
fingerprint; constructor and helper-body mutation tests prove both changes
alter the hash.

The original variable-only repair button remains available. The Doctor repair
center adds variable, profile, world, and repair-all actions in settings and the
floating tools panel. No P4 repair, database write, preset write, or third-party
script coupling is introduced.
