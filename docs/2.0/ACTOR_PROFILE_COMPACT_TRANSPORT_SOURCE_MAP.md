# Actor profile compact transport source map

This note supplements `ACTOR_PROFILE_BATCH_P1_SOURCE_MAP.md` with the exact
production sources inspected for the compact target-row change.

| Actual source inspected | Classification | Reuse and boundary |
|---|---|---|
| TavernDB `shujuku-spv8.4-index.test-fixture.js`: `prepareAIInput_ACU(messages, updateMode, targetSheetKeys, options)` and its `workingTableData` projection | **T/A** | **T:** select requested sheet keys, carry current rows once, apply validated responses to a working copy, then commit as one unit. **A:** Doctor maps a sheet key to `{ActorRef,moduleKey}` and sends at most six actor rows per transport chunk. This is not an actor cap: every chunk updates only the same transaction-local `profileById`; no chunk is durable before the complete batch passes pending/final readback. TavernDB SQL/CRUD is not copied. |
| TavernDB unified fill path: `collectGroupFillResponse`, `applyUnifiedGroupFillResponses`, and retry-time working snapshot | **T/A** | **T:** preserve valid cells in the working snapshot and request only failed cells. **A:** Doctor rebuilds the next group from `workingCandidates()` so retry targets are exactly missing actor x module cells. A failed chunk leaves the complete Doctor batch at S0; there is no partial profile persistence. |
| npc_tracker `scripts/gate.js`: compact registered-name list plus four recent messages, no per-character dossier | **T/A** | **T:** a routing gate must not receive every full dossier. **A:** identity discovery receives only accepted coverage units plus registered/excluded indexes. Doctor retains stronger literal-unit, SourceRef, Registry-conflict and complete-coverage proof checks; it does not copy npc_tracker's name-only trust boundary. |
| npc_tracker `scripts/profile.js`: `buildProfilePayload` sends one character's current profile, then validated deltas are applied; `scripts/registry.js` rejects an existing exact registry key | **T/A** | **T:** send the current row rather than duplicate historical objects; enforce exact Registry conflict; validate before local apply. **A:** Doctor sends requested current narrative modules, relevant confirmed/locks, and one normalized ticket. It deliberately does not reuse npc_tracker's per-character durable delta writes, because Doctor requires one multi-actor atomic pending/final receipt. |
| Doctor `actorProfilePromptContext`, `actorProfileCompletionGroupPlan`, `profileById` working clone, SourceRef/CAS/readback | **T** | Existing helpers remain the only authority normalizer, scheduler, transaction clone and durability path. The compact projector removes duplicate `profileV6`, raw ticket, `identityContext` and all-module `workingModules`; it does not introduce a second profile schema, parser, store, barrier, queue or checkpoint. |
| Compact row projector and six-row transport partition | **X (minimum missing host glue)** | TavernDB does not expose a Doctor ActorRef/narrative-module transport. New glue only partitions transport rows deterministically; all rows still run and commit atomically. Doctor requests `maxTokens: 0`, so the existing selected-connection configuration remains the sole output ceiling. It does not infer context capacity from character count or add a prompt-size threshold, output-token budget, total timeout, or actor limit. |

The accepted narrative and projected authority each occur once in a
group/chunk prompt. A long existing dossier is not resent wholesale: each row
contains exact ActorRef/displayName, only requested modules' current values,
module-relevant confirmed/locks, and at most one normalized creation ticket.
`full_adult` still follows identity -> character_core -> physiology_optional
inside one transaction. Successful core/physiology cells remain
transaction-local and a retry asks only for missing actor x module cells.

Identity coverage remains one model call. The local partition was reduced from
approximately 900 characters to at most 420 characters at mechanical
punctuation boundaries; concatenating all unit texts exactly reconstructs the
accepted narrative. This changes no identity classifier and performs no
keyword NER. A no-candidates result still requires the complete id/digest unit
proof and the existing terminal CAS/readback receipt.
