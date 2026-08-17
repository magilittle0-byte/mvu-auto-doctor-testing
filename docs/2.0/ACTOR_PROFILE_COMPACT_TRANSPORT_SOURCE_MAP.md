# Actor profile compact transport source map

This note supplements `ACTOR_PROFILE_BATCH_P1_SOURCE_MAP.md` with the exact
production sources inspected for the compact target-row change.

| Actual source inspected | Classification | Reuse and boundary |
|---|---|---|
| TavernDB `shujuku-spv8.4-index.test-fixture.js`: `prepareAIInput_ACU(messages, updateMode, targetSheetKeys, options)` and its `workingTableData` projection | **T/A** | **T:** select requested sheet keys, carry current rows once, apply validated responses to a working copy, then commit as one unit. **A:** Doctor maps a sheet key to `{ActorRef,moduleKey}`. The production adapter sends one ActorRef per transport packet; the six-row helper default remains only a compatibility boundary. This is not an actor cap: every packet updates only the same transaction-local `profileById`; no packet is durable before the complete batch passes pending/final readback. TavernDB SQL/CRUD is not copied. |
| TavernDB unified fill path: `collectGroupFillResponse_ACU`, `applyUnifiedGroupFillResponses_ACU`, `runTableUpdateCommit_ACU`, and retry-time working snapshot | **T/A** | **T:** preserve valid cells in the working snapshot, request only failed cells, and commit the validated working copy once. **A:** Doctor rebuilds the next group from `workingCandidates()` so retry targets are exactly missing ActorRef x module cells. A failed chunk leaves the complete Doctor batch at S0; there is no partial profile persistence. |
| npc_tracker `scripts/gate.js`: compact registered-name list plus four recent messages, no per-character dossier | **T/A** | **T:** a routing gate must not receive every full dossier. **A:** identity discovery receives only accepted coverage units plus registered/excluded indexes. Doctor retains stronger literal-unit, SourceRef, Registry-conflict and complete-coverage proof checks; it does not copy npc_tracker's name-only trust boundary. |
| npc_tracker `scripts/profile.js`: `buildProfilePayload` sends one character's current profile, then validated deltas are applied; `scripts/registry.js` rejects an existing exact registry key | **T/A** | **T:** send the current row rather than duplicate historical objects; enforce exact Registry conflict; validate before local apply. **A:** Doctor sends requested current narrative modules, relevant confirmed/locks, and one normalized ticket. It deliberately does not reuse npc_tracker's per-character durable delta writes, because Doctor requires one multi-actor atomic pending/final receipt. |
| Doctor `actorProfilePromptContext`, `actorProfileCompletionGroupPlan`, `profileById` working clone, SourceRef/CAS/readback | **T** | Existing helpers remain the only authority normalizer, scheduler, transaction clone and durability path. The compact projector removes duplicate `profileV6`, raw ticket, `identityContext` and all-module `workingModules`; it does not introduce a second profile schema, parser, store, barrier, queue or checkpoint. |
| Compact row projector and bounded ActorRef transport waves | **X (minimum missing host glue)** | TavernDB does not expose a Doctor ActorRef/narrative-module transport. Production partitions packets deterministically at exactly one ActorRef each; the helper's six-row default is compatibility/test behavior, not the production route. Only when every configured fast route is direct does Doctor freeze the currently healthy slots, deduplicate them by real `modelConnectionKey`, and explicitly bind each packet in a wave to one distinct slot/key. Host, mixed routes, or a no-healthy-route fallback stay at concurrency one; the scheduler also serializes duplicate presets that share the same real connection key. A transport/cancel/stale result settles the current wave but stops every later wave. There is no actor total limit. All validated packets remain in the same working clone and only the complete set enters the existing pending -> final CAS/readback, so persistence stays atomic. Doctor requests `maxTokens: 0`, so the selected-connection configuration remains the sole output ceiling. It adds no prompt-size threshold, output-token budget, total timeout, or actor limit. |

The accepted narrative is sent in full only to the one route-only identity
request. Later fill requests contain exact ActorRef/displayName, requested
missing/refresh fields, bounded literal narrative fragments around that row,
bounded relevant authority, module-relevant confirmed/locks, and at most one
normalized creation ticket. They do not resend the whole accepted narrative,
42K authority envelope, unrelated dossiers, commit proofs, or persistence
history. `full_adult` follows identity -> one `character_core` row-fill group;
its six core modules and physiology can share the same actor row/request.
Successful cells remain transaction-local and a retry asks only for missing
ActorRef x field cells.

Adult physiology now uses six explicit `<field key="...">` fragments inside
the existing `physiology` module. The model no longer writes six verbatim
coverage copies after a prose dossier. The local parser mechanically accepts
the declared tags, bracket tags, or explicitly labelled lines, validates all
six distinct required keys, and composes the existing natural-Chinese module.
It never infers a field from medical keywords or creates a second schema/store.
Legacy `physiology-coverage` responses remain read-compatible only.

Identity coverage remains one complete accepted-narrative input. The local partition was reduced from
approximately 900 characters to at most 420 characters at mechanical
punctuation boundaries; concatenating all unit texts exactly reconstructs the
accepted narrative. This changes no identity classifier and performs no
keyword NER. The normal response is now only a short natural Chinese list:
`新人物：正文逐字行键`, `身份揭示：ActorId｜新行键｜最短原句`, or the whole response
`没有新人物`. The model is not asked to emit XML, JSON, functions, variables,
unit ids, digests, or empty-unit echoes. The script normalizes those bounded
surface forms into its private route representation and binds each route to the
earliest independent literal occurrence, skipping occurrences covered by a
longer route name; registered identity reveals instead bind their complete
literal evidence span. It then derives the coverage proof from the complete local plan already
sent in that same call. Complete legacy id/digest wrappers remain read-only
compatible; partial wrappers, unknown explicit units, route-plus-empty and
free-text empty claims fail closed. Supported `profile_target` / `no_new`
spelling drift is normalized mechanically; any remaining target/empty
control-like residue fails closed instead of being ignored as prose, so a
malformed peer cannot disappear from flat or legacy output. When the first
identity response contains no locally retainable route and ends in a bounded
format/identity failure, production may send that same complete input exactly
once more with only privacy-safe failure codes and the same natural Chinese
`新人物/身份揭示/没有新人物` output contract. A locally parsed row rejected solely
because its label is the bare vague term `人物` is also non-retainable and gets
that one precise resend; protected identities, Registry conflicts, and ambiguous
nested row keys do not become resend permission. A second invalid response is
terminal and atomic, and an empty resend cannot erase a failed candidate claim.
The existing terminal CAS/readback receipt stays unchanged.
