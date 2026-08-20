# MVU 2.0 runtime source map

This document records the current controlled-host static compatibility
evidence paired with the test-channel candidate. It is not a real
SillyTavern/Tauri run and is not evidence for the twelve-turn acceptance gate.

## Prompt-ready host evidence

- The paired IZUMI preset now places `mvu-auto-doctor-profile-context-separation-v6`
  exactly once in the enabled `prompt_order`, before the natural profile receipt
  contract while leaving the V5 terminal receipt gate last. A prompt object that
  exists only in `prompts` is not treated as active production evidence.

- Controlled host: TavernHelper `4.8.19`.
- Relative resource: `extensions/TavernHelper/dist/index.js.map`.
- Source-map SHA-256: `7989FC1B3A47978526D63FD63C9DCB5ED68B534523BD24C223FF0B82C7A1D961`.
- Source-map source: `../src/function/event.ts`: event 222 is
  `CHAT_DELETED`, 225 is `GENERATE_AFTER_COMBINE_PROMPTS`, and 230 is
  `CHAT_COMPLETION_PROMPT_READY`.
- The production binding also feature-detects `GROUP_CHAT_DELETED` when the
  host exposes it; it does not invent a fallback event name or assume that an
  unadvertised host will emit it.
- Typed payloads: `CHAT_DELETED(chat_file_name: string)` and, when advertised,
  `GROUP_CHAT_DELETED(chat_file_name: string)`,
  `CHAT_COMPLETION_PROMPT_READY({ chat: SendingMessage[]; dryRun: boolean })`,
  and `GENERATE_AFTER_COMBINE_PROMPTS({ prompt: string; dryRun: boolean })`.
- Source-map source: `../src/function/generate/generateRaw.ts` lines 540–542
  obtains `chatCompletion.getChat()`, synchronously emits
  `CHAT_COMPLETION_PROMPT_READY`, and returns the prompt.

The production handler is synchronous at the event boundary. It sanitizes an
outgoing payload copy, leaves `context.chat` and stored `message.mes` intact,
and only performs a flat replacement when assistant-source ownership is
provable. Ambiguous or unsupported payloads are diagnostic failures, not
claimed filtering. Real host event triggering was not run in this task.

The two host subscription boundaries are explicit production helpers:
`bindActorProfilePromptSanitizationEvents(context, types)` registers both
prompt-ready events and preserves social cleanup → profile sanitation →
continuity inspection order; `bindDoctorChatDeletionEvents(context, types)`
registers `CHAT_DELETED` and an advertised `GROUP_CHAT_DELETED`. Both helper
bodies are included in `doctorRuntimeCriticalFingerprint()` so removing an
event subscription or changing its strict payload handling changes the
candidate fingerprint.

## Ownership and call chain

- Preset: supplies the natural Chinese `<人物档案更新>` output contract and
  the single `<content>` → hidden receipt → options/UpdateVariable order. It
  does not write MVU technical fields.
- Accepted-final Doctor: reads the fresh raw assistant message, exact
  SourceRef, extracts/validates the dedicated block, and performs the existing
  MVU CAS/readback. The resulting semantic `profileRef` points to the durable
  MVU profile; semantic profiles are never copied into legacy `profileV6`.
- MVU: owns current variables and the complete semantic profile content.
  P3/P4 receive bounded, read-only ephemeral projections. Runtime location,
  injury, condition and resources are `mvu_runtime` only when a user-configured
  ActorId JSON-Pointer rule proves the field; otherwise they are
  `unknown/unbound`. The default `actorRuntimeBindings` is `{}`. There is no
  default hard-coded root and no Doctor-owned runtime mirror/writer.
- Database: owns its own tables and independent fill/readback. Doctor does
  not write the database or treat its rows as profile authority.
- Doctor/P3: owns actor receipts, continuity, faction and environment lanes,
  pressure admission, bounded resolved history, and CAS/readback of its own
  namespace. Actor attempts remain distinct from world-adjudicated results.
- Doctor/P4: owns the next-turn lease/consume/readback and injects only
  current relevant or observable consequences plus bounded related profiles.
- `CHAT_DELETED` and an advertised `GROUP_CHAT_DELETED` are Doctor-owned cleanup
  only: exact Doctor queue/session,
  owner, timer, read shadow, lease, repair/diagnostic/UI cache and hashed
  per-chat localStorage keys. It never clears chat metadata, MVU, database,
  IndexedDB, external files, or another extension's settings.
- No authoritative host chat-ID enumeration was available to this candidate;
  automatic orphan GC is therefore disabled. The UI offers a preview and
  explicit confirmation for cleaning non-current Doctor UI fold preferences
  and temporary caches; this does not prove that the corresponding chat is
  deleted or orphaned. Only a proved positional string from
  `CHAT_DELETED`/`GROUP_CHAT_DELETED` supplies a deletion target; object,
  numeric, empty, ambiguous or unmatched payloads are no-ops. Disposal itself
  is exact-key/owner matched and idempotent, so the event handler does not
  pre-scan for a particular cache type and cannot miss a newly added Doctor
  owner. `CHAT_CHANGED` clears the memory-only selector cache because it has no
  authoritative cross-chat reuse bound.
- Newly resolved continuity threads are compacted by comparing prior and next
  state. Process details are folded into bounded detail/archive records;
  durable effects, rumors, triggers, source origin/closure evidence,
  actorRefs/locations and the resolved tombstone rollup remain. When the
  bounded resolved detail limit is exceeded, older resolved detail is folded
  rather than silently sliced away. P4 projects only currently relevant
  canonical-world consequences, never the complete resolved archive. A
  resolved row retained in `threads` is also terminal on the
  `enforceContinuityPolicy` model-candidate path: it cannot be downgraded to
  active, advancing, dormant or manifested. Archive IDs, rollup IDs and the
  `tombstoneThroughTurn` fallback use the same reopen-blocking 判定 as
  `mergeMarkerRecords`; a rejected reopen cannot create a new `advanced` tick.
  A genuinely new event created after the tombstone remains admissible.

## Storage inventory

| Storage | Owner and lifecycle | Disposal/retention |
| --- | --- | --- |
| `chatMetadata[mvu_auto_doctor]` | Host chat metadata plus Doctor durable namespace | Removed only by the host chat lifecycle; Doctor disposal does not clear it, MVU variables, or database rows. |
| Per-chat hashed Doctor fold keys in `localStorage` | Doctor-owned UI fold/temporary cache | Exact matching key is removed by matching chat scope; manual non-current cleanup is not orphan proof and requires confirmation. |
| Global floating page/position and extension settings | User/extension preference | Never cleared by `CHAT_DELETED` or cache cleanup. |
| Doctor memory maps/timers/controllers/P4 leases/repair and UI owners | Doctor-owned with exact chat/scope owner | Matching owner is invalidated and removed; late writes fail closed. |
| IndexedDB/external files | No Doctor-owned namespace found in this candidate (0 items) | No guessing or deletion. |

Diagnostics and repairJournal keep bounded fixed-code projections; checkpoints
keep bounded undo/readback records. Resolved detail is compacted on newly
resolved transitions and then rolled into bounded durable-effect/rumor/trigger
tombstone data. Active and dormant threads remain retained, and archived IDs
cannot reopen through a late marker.

## Configurable runtime binding

The adapter accepts a reusable by-ActorId root plus relative JSON-Pointer
field rules. Pointers support Unicode keys and JSON Pointer escaping (`~0`,
`~1`), reject prototype-pollution segments, arrays out of range and wildcard
guessing, and never match by character name. Dynamic new ActorIds use the same
configured rule; no per-person hand-written path is required. A binding
diagnostic records only a rule ID and path digest. If no rule is configured or
the path is absent, the UI says `未绑定 MVU 实时运行态` and the fields remain
unbound; the profile/actor gate does not fall back to legacy location/resources
as current authority.

## Fingerprint pairing

The runtime fingerprint includes the actual sanitizer, source/relevance/budget,
scope disposal, operational-state, semantic profile authority, P3 structural
isolation, P4 producer selection, surface exact-target hydrate guard and world
compression helper bodies, together with the preset contract and the paired
candidate preset's real SHA-256. It does not claim that a host has selected or
executed the paired preset.

## Validation boundary

This candidate may be checked with direct Node tests and syntax/JSON checks.
No real external model, database, browser, SillyTavern/Tauri host, build,
or twelve-turn acceptance run is performed in this task. Those remain the
user's installation test and the separate real acceptance gate.
