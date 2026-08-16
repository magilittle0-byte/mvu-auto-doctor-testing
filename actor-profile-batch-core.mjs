import { fingerprint } from './core.mjs';
import {
    ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION,
    ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES,
    actorProfileBaselineDigest,
    actorProfileCompletionGroupPlan,
    buildActorProfileModuleGroupMessages,
    materializeActorProfileBaseline,
    parseActorProfileModuleGroupOutput,
    recoverActorProfileDiscoveryNameFromEvidence,
    validateActorProfileDiscoveryAnchor,
    validateActorProfileInsertCandidate,
} from './actor-profile-v6-core.mjs';
import {
    actorProfileCommitMatchesLedger,
    actorProfilePendingWriteSetDigest,
    actorProfileTransactionId,
    finalizeActorProfileBaselinesInLedger,
    normalizeActorLedger,
    replaceActorProfileBaselineInLedger,
    sealActorProfilePendingTransactionInLedger,
} from './actor-ledger-core.mjs';

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value, limit = 500) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function candidateActorId(candidate) {
    return cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120);
}

function candidateName(candidate) {
    return cleanText(candidate?.actorRef?.name || candidate?.name, 160);
}

function actorProfileWorkingSection(candidate, moduleKey, text) {
    return {
        text,
        ...(moduleKey === 'physiology'
            && candidate?.completionMode === 'full_adult'
            ? { contractVersion: ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION }
            : {}),
    };
}

function failureFor(candidate, reason, extras = {}) {
    return {
        actorId: candidateActorId(candidate),
        name: candidateName(candidate),
        reason,
        missingFields: [],
        ...extras,
    };
}

const SAFE_IDENTITY_RETRY_GUIDANCE = Object.freeze({
    'actor_profile.discovery_coverage_unit_missing': '\u8be5\u88f8 route \u65e0\u6cd5\u7ed1\u5b9a\u5230\u5df2\u53d1\u9001\u6b63\u6587\u4e2d\u7684\u72ec\u7acb\u9010\u5b57\u51fa\u73b0\uff1b\u53ea\u5728\u5fc5\u8981\u65f6\u8865 unit=\u5df2\u7ed9CU-id\uff0c\u4e0d\u5f97\u56de\u663e digest \u6216\u7a7a unit\u3002',
    'actor_profile.discovery_coverage_unit_duplicate': '\u5220\u9664\u65e7 coverage wrapper\uff0c\u53ea\u8fd4\u56de\u53bb\u91cd\u540e\u7684\u88f8 profile-target\uff1b\u4e0d\u5f97\u56de\u663e digest \u6216\u7a7a unit\u3002',
    'actor_profile.discovery_coverage_unit_unknown': '\u5220\u9664\u81ea\u521b unit\uff1b\u88f8 route \u53ef\u7701\u7565 unit\uff0c\u5fc5\u987b\u663e\u5f0f\u65f6\u53ea\u80fd\u7528\u8f93\u5165\u5df2\u7ed9 CU-id\u3002',
    'actor_profile.discovery_coverage_digest_mismatch': '\u5220\u9664\u65e7 coverage wrapper \u4e0e digest \u56de\u663e\uff0c\u6539\u4e3a\u88f8 profile-target\uff1b\u672c\u5730\u4f1a\u4f7f\u7528\u5df2\u53d1\u9001\u5b8c\u6574 plan \u6821\u9a8c\u3002',
    'actor_profile.discovery_coverage_disposition_invalid': '\u4e8c\u9009\u4e00\uff1a\u8f93\u51fa\u4e00\u4e2a\u6216\u591a\u4e2a\u88f8 profile-target\uff0c\u6216\u6574\u4e2a\u54cd\u5e94\u53ea\u8f93\u51fa <no-new/>\uff1b\u4e0d\u5f97\u6df7\u7528\u3002',
    'actor_profile.discovery_coverage_extra_content': '\u8fd4\u56de\u4e00\u4e2a\u6216\u591a\u4e2a\u88f8 profile-target\uff1b\u82e5\u786e\u5b9e\u65e0\u4eba\uff0c\u6574\u4e2a\u54cd\u5e94\u53ea\u8fd4\u56de <no-new/>\uff0c\u4e0d\u5f97\u7528\u81ea\u7531\u6587\u672c\u8868\u793a\u7a7a\u7ed3\u679c\u3002',
    'actor_profile.discovery_name_not_in_coverage_unit': '\u5220\u9664\u8be5\u5355\u5143\u4e2d\u7684\u8de8\u5355\u5143\u6216\u675c\u64b0\u884c\u952e\uff1b\u4ec5\u4ece\u5f53\u524d coverage unit \u6587\u672c\u9010\u5b57\u590d\u5236\u7a33\u5b9a\u4eba\u7269\u884c\u952e\u3002',
    'actor_profile.discovery_name_not_in_narrative': '\u5220\u9664\u8be5\u675c\u64b0\u884c\u952e\u5019\u9009\uff1b\u4e0d\u8981\u6539\u5199\u3001\u7f29\u5199\u6216\u65b0\u53d6\u540d\uff0c\u53ea\u80fd\u4ece\u201c\u5df2\u63a5\u53d7\u6b63\u6587\u201d\u4e2d\u9010\u5b57\u590d\u5236\u5176\u4ed6\u660e\u786e\u51fa\u573a\u7684\u7a33\u5b9a\u4eba\u7269\u6807\u8bc6\u4f5c\u4e3a actor="new" \u7684 name\uff1b\u53ef\u4ee5\u662f\u771f\u540d\u3001\u7f16\u53f7\u79f0\u8c13\u6216\u6b63\u6587\u4e2d\u53ef\u6307\u5411\u4e00\u4eba\u7684\u7a33\u5b9a\u63cf\u8ff0\u6027\u79f0\u8c13\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_candidate.identity_missing_or_short': '\u5220\u9664\u8be5\u5019\u9009\uff1b\u53ea\u91cd\u53d1\u6b63\u6587\u4e2d\u9010\u5b57\u660e\u786e\u3001\u4e0d\u5c11\u4e8e\u4e24\u4e2a\u5b57\u7b26\u7684\u7a33\u5b9a\u4eba\u7269\u884c\u952e\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_candidate.identity_system': '\u5220\u9664\u7cfb\u7edf\u3001\u65c1\u767d\u3001\u73af\u5883\u6216\u6e38\u620f\u63d0\u793a\u5019\u9009\uff1b\u53ea\u91cd\u53d1\u6b63\u6587\u4e2d\u5176\u4ed6\u660e\u786e\u51fa\u573a\u7684\u7a33\u5b9a\u4eba\u7269\u884c\u952e\uff08\u53ef\u4e3a\u59d3\u540d\u3001\u4ee3\u53f7\u3001\u7f16\u53f7\u3001\u804c\u4e1a\u6216\u63cf\u8ff0\u6027\u79f0\u8c13\uff09\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_candidate.identity_group': '\u5220\u9664\u7ec4\u7ec7\u3001\u56e2\u4f53\u6216\u7fa4\u4f53\u540d\u79f0\u5019\u9009\uff1b\u53ea\u91cd\u53d1\u6b63\u6587\u4e2d\u5176\u4ed6\u9010\u5b57\u7a33\u5b9a\u3001\u53ef\u6307\u5411\u4e00\u4eba\u7684\u4eba\u7269\u884c\u952e\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_candidate.identity_excluded': '\u5220\u9664\u8be5\u53d7\u4fdd\u62a4\u8eab\u4efd\u5019\u9009\uff0c\u7edd\u4e0d\u5c06\u5176\u8f93\u51fa\u4e3a new\uff1b\u7ee7\u7eed\u67e5\u627e\u6b63\u6587\u4e2d\u5176\u4ed6\u660e\u786e\u65b0\u4eba\u7269\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_candidate.identity_internal_id': '\u5220\u9664 ActorRef\u3001\u5185\u90e8 ID \u6216\u8def\u7531\u6807\u8bc6\u5019\u9009\uff1b\u53ea\u91cd\u53d1\u6b63\u6587\u4e2d\u9010\u5b57\u51fa\u73b0\u7684\u7a33\u5b9a\u4eba\u7269\u884c\u952e\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_candidate.identity_registry_conflict': '\u5220\u9664\u5df2\u767b\u8bb0\u4eba\u7269\u3001\u522b\u540d\u6216\u4e0e Registry \u51b2\u7a81\u7684\u5019\u9009\uff1b\u53ea\u91cd\u53d1\u5176\u4ed6\u672a\u767b\u8bb0\u65b0\u4eba\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_candidate.identity_quarantined': '\u5220\u9664\u88ab\u672c\u5730\u8eab\u4efd\u9694\u79bb\u7684\u5019\u9009\uff1b\u53ea\u91cd\u53d1\u5176\u4ed6\u80fd\u901a\u8fc7\u8eab\u4efd\u9884\u68c0\u7684\u660e\u786e\u65b0\u4eba\uff0c\u5e76\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba\u3002',
    'actor_profile.identity_reveal_actor_ref_unknown': '\u5220\u9664\u81ea\u521b\u6216\u8fc7\u671f ActorId\uff1b\u82e5\u6b63\u6587\u660e\u786e\u63ed\u793a\u65e7\u4eba\u7269\u7684\u65b0\u884c\u952e\uff0c\u53ea\u80fd\u4f7f\u7528\u5df2\u767b\u8bb0\u7d22\u5f15\u4e2d\u8be5\u4eba\u7684\u7cbe\u786e actorId\u3002',
    'actor_profile.identity_reveal_name_not_in_coverage_unit': '\u65b0\u884c\u952e\u5fc5\u987b\u662f\u5f53\u524d coverage unit \u7684\u8fde\u7eed\u9010\u5b57\u5b50\u4e32\uff1b\u4e0d\u5f97\u4ece\u4e16\u754c\u4e66\u3001\u7968\u636e\u6216\u5176\u4ed6\u5355\u5143\u590d\u5236\u3002',
    'actor_profile.identity_reveal_evidence_invalid': '\u5728 profile-target \u5185\u8865\u4e00\u4e2a <identity-evidence>\uff1a\u53ea\u9010\u5b57\u590d\u5236\u540c\u65f6\u5305\u542b\u8be5\u4eba\u5df2\u767b\u8bb0\u884c\u952e/\u522b\u540d\u4e0e\u65b0\u884c\u952e\u7684\u6700\u77ed\u6b63\u6587\u539f\u53e5\u7247\u6bb5\uff1b\u4e0d\u5f97\u590d\u5236\u6574\u4e2a coverage unit\u3002',
    'actor_profile.identity_reveal_actor_ambiguous': '\u8bc1\u636e\u7247\u6bb5\u540c\u65f6\u6307\u5411\u591a\u4e2a\u5df2\u767b\u8bb0\u4eba\u7269\uff0c\u6216\u6ca1\u6709\u9010\u5b57\u51fa\u73b0\u8be5 actorId \u7684\u5df2\u767b\u8bb0\u884c\u952e/\u522b\u540d\uff1b\u5220\u9664\u8be5\u5408\u5e76\u8def\u7531\uff0c\u4e0d\u5f97\u731c\u6d4b ActorId\u3002',
    'actor_profile.identity_reveal_unchanged': '\u5df2\u767b\u8bb0\u59d3\u540d\u6216\u522b\u540d\u6ca1\u6709\u53d1\u751f\u63ed\u793a\u65f6\u4e0d\u8981\u8f93\u51fa profile-target\uff1b\u8be5 coverage unit \u6539\u4e3a <no-new/>\u3002',
    'actor_profile.identity_reveal_conflict': '\u65b0\u884c\u952e\u5df2\u5c5e\u4e8e\u53e6\u4e00 ActorRef\uff0c\u4e0d\u5f97\u6a21\u7cca\u5408\u5e76\u6216\u590d\u5236\u6863\u6848\uff1b\u4fdd\u7559\u51b2\u7a81\u4f9b\u672c\u5730\u6062\u590d\u3002',
});

const SAFE_PROFILE_RETRY_CODES = new Set([
    'actor_profile.format_unrecoverable',
    'actor_profile.module_target_duplicate',
    'actor_profile.module_target_missing',
    'actor_profile.module_unexpected',
    'actor_profile.module_duplicate',
    'actor_profile.module_content_incomplete',
    'actor_profile.physiology_coverage_incomplete',
    'actor_profile.module_missing',
    'actor_profile.discovery_name_not_in_narrative',
    'actor_profile.discovery_duplicate',
    'actor_profile.actor_ref_mismatch',
]);

// Transport packets are bounded by ActorRef, not by the total actor set. Every
// ActorRef x module row remains in the same
// transaction-local working clone and the batch is persisted only after all
// chunks validate. This mirrors TavernDB's targetSheetKeys batching shape.
export const ACTOR_PROFILE_GROUP_TRANSPORT_ROWS = 6;

export function actorProfileModuleGroupChunks(group, rowLimit = ACTOR_PROFILE_GROUP_TRANSPORT_ROWS) {
    if (group?.key === 'identity_bootstrap') return [group];
    const actorById = new Map();
    for (const rows of Object.values(group?.targets || {})) {
        for (const candidate of rows || []) {
            const actorId = candidateActorId(candidate);
            if (actorId && !actorById.has(actorId)) actorById.set(actorId, candidate);
        }
    }
    const actorIds = [...actorById.keys()];
    if (!actorIds.length) return [group];
    const limit = Math.max(1, Math.floor(Number(rowLimit) || ACTOR_PROFILE_GROUP_TRANSPORT_ROWS));
    const chunks = [];
    for (let start = 0; start < actorIds.length; start += limit) {
        const wanted = new Set(actorIds.slice(start, start + limit));
        const targets = Object.fromEntries((group?.modules || []).map((moduleKey) => [
            moduleKey,
            (group?.targets?.[moduleKey] || [])
                .filter((candidate) => wanted.has(candidateActorId(candidate))),
        ]));
        chunks.push({
            ...group,
            targets,
            targetCount: Object.values(targets).reduce((sum, rows) => sum + rows.length, 0),
            transportChunk: { index: chunks.length, actorCount: wanted.size },
        });
    }
    return chunks.filter((chunk) => chunk.targetCount > 0);
}

export function actorProfileGroupFailureDiagnostic(group, attempt, parsed, failures = []) {
    if (!Array.isArray(failures) || !failures.length) return null;
    const failureCodes = [...new Set(failures
        .map((entry) => cleanText(entry?.reason, 120))
        .filter((code) => /^actor_profile\.[a-z0-9_.-]+$/u.test(code)))].slice(0, 8);
    const missingModules = [...new Set(failures.flatMap((entry) => [
        cleanText(entry?.moduleKey, 80),
        ...(entry?.missingFields || []).map((path) => cleanText(path, 160).split('.').at(-1)),
    ]).filter((moduleKey) => /^[a-z][a-zA-Z0-9]*$/u.test(moduleKey)))].slice(0, 7);
    return {
        groupKey: group?.key || '',
        moduleKeys: clone(group?.modules || []),
        targetCount: Math.max(0, Number(group?.targetCount) || 0),
        attempt: Math.max(0, Number(attempt) || 0),
        transportChunk: null,
        status: 'semantic_failed',
        parsedRowCount: Math.max(0, Number(parsed?.entries?.length) || 0),
        failureCodes,
        missingModules,
    };
}

export function actorProfileResolverPromotionClosure({
    discoveries = [],
    resolvedPromotionEntries = [],
    resolvedCandidates = [],
} = {}) {
    const resolvedCandidateById = new Map(resolvedCandidates.map((candidate) => [
        candidateActorId(candidate),
        candidate,
    ]));
    const discoveryCompletionByName = new Map(discoveries.map((entry) => [
        cleanText(entry?.candidateRef?.name, 160),
        entry,
    ]).filter(([name]) => name));
    return resolvedPromotionEntries.map((entry) => {
        const actorId = cleanText(entry?.actorRef?.actorId, 120);
        const promotionName = cleanText(
            entry?.actorRef?.name
                || entry?.actorRef?.displayName
                || entry?.candidate?.actorRef?.name
                || entry?.candidate?.candidateRef?.name,
            160,
        );
        return {
            actorId,
            candidateId: cleanText(entry?.candidateId, 120),
            context: resolvedCandidateById.get(actorId) || null,
            profileCandidate: clone(
                discoveryCompletionByName.get(promotionName)?.candidate || entry?.candidate,
            ),
            repairs: clone(entry?.repairs || []),
        };
    });
}

export function actorProfileFinalCandidateClosure({
    selected = [],
    resolvedCandidates = [],
    resolvedPromotionEntries = [],
    identityReveals = [],
    acceptedById = new Map(),
    failureById = new Map(),
    discoveryFailures = [],
} = {}) {
    const candidateById = new Map();
    const selectedActorIds = new Set(selected.map(candidateActorId).filter(Boolean));
    const resolvedMappedActorIds = new Set([
        ...resolvedPromotionEntries.map((entry) => cleanText(entry?.actorRef?.actorId, 120)),
        ...identityReveals.map((entry) => cleanText(entry?.actorId, 120)),
    ].filter(Boolean));
    for (const candidate of selected) {
        const actorId = candidateActorId(candidate);
        if (actorId) candidateById.set(actorId, candidate);
    }
    const resolutionFailures = [];
    for (const candidate of resolvedCandidates) {
        const actorId = candidateActorId(candidate);
        if (!actorId) continue;
        if (selectedActorIds.has(actorId) || resolvedMappedActorIds.has(actorId)) {
            candidateById.set(actorId, candidate);
        } else {
            resolutionFailures.push(failureFor(
                candidate,
                'actor_profile.discovery_promotion_mapping_missing',
            ));
        }
    }
    const allCandidates = [...candidateById.values()];
    const attributedFailureActorIds = new Set([
        ...failureById.keys(),
        ...discoveryFailures.map((failure) => cleanText(failure?.actorId, 120)),
        ...resolutionFailures.map((failure) => cleanText(failure?.actorId, 120)),
    ].filter(Boolean));
    const groupRowFailures = allCandidates
        .filter((candidate) => (
            !acceptedById.has(candidateActorId(candidate))
            && !attributedFailureActorIds.has(candidateActorId(candidate))
        ))
        .map((candidate) => failureFor(candidate, 'actor_profile.group_row_missing'));
    return { allCandidates, resolutionFailures, groupRowFailures };
}

export function actorProfileDiscoverySourceOrder(discoveries = [], acceptedNarrative = '') {
    const narrative = String(acceptedNarrative || '');
    const rows = (Array.isArray(discoveries) ? discoveries : []).map((entry, index) => ({
        entry,
        index,
        name: cleanText(entry?.name, 160),
        sourceAnchor: String(entry?.sourceAnchor || '').slice(0, 1200),
        sourceUnitOffset: Number.isInteger(entry?.sourceUnitOffset)
            ? entry.sourceUnitOffset : NaN,
    }));
    const occurrences = (name, start = 0, end = narrative.length) => {
        const offsets = [];
        if (!name) return offsets;
        let from = Math.max(0, start);
        const limit = Math.min(narrative.length, end);
        while (from <= limit - name.length) {
            const offset = narrative.indexOf(name, from);
            if (offset < 0 || offset + name.length > limit) break;
            offsets.push(offset);
            from = offset + Math.max(1, name.length);
        }
        return offsets;
    };
    const unitStartsFor = (row) => {
        const hasExplicitUnitOffset = Number.isInteger(row.sourceUnitOffset)
            && row.sourceUnitOffset >= 0;
        if (hasExplicitUnitOffset) {
            return narrative.slice(
                row.sourceUnitOffset,
                row.sourceUnitOffset + row.sourceAnchor.length,
            ) === row.sourceAnchor ? [row.sourceUnitOffset] : [];
        }
        const starts = [];
        let from = 0;
        while (row.sourceAnchor && from <= narrative.length - row.sourceAnchor.length) {
            const offset = narrative.indexOf(row.sourceAnchor, from);
            if (offset < 0) break;
            starts.push(offset);
            from = offset + Math.max(1, row.sourceAnchor.length);
        }
        return starts.length === 1 ? starts : [];
    };
    const rowOccurrences = new Map(rows.map((row) => [row.index,
        unitStartsFor(row).flatMap((unitStart) => occurrences(
            row.name,
            unitStart,
            unitStart + row.sourceAnchor.length,
        ).map((offset) => ({
            name: row.name,
            offset,
            end: offset + row.name.length,
            unitStart,
        }))),
    ]));
    const spans = [...rowOccurrences.values()].flat();
    const ordered = [];
    const failures = [];
    for (const row of rows) {
        const anchor = validateActorProfileDiscoveryAnchor({
            name: row.name,
            sourceAnchor: row.sourceAnchor,
            sourceUnitOffset: Number.isInteger(row.sourceUnitOffset)
                ? row.sourceUnitOffset : undefined,
        }, narrative);
        if (!anchor.ok) {
            failures.push({
                name: row.name,
                reason: anchor.reason || 'actor_profile.discovery_anchor_invalid',
                retryable: false,
            });
            continue;
        }
        const independentOccurrence = (rowOccurrences.get(row.index) || []).find((occurrence) => {
            return !spans.some((span) => (
                span.name !== row.name
                && span.name.length > row.name.length
                && span.unitStart === occurrence.unitStart
                && span.offset <= occurrence.offset
                && span.end >= occurrence.end
            ));
        });
        if (!Number.isInteger(independentOccurrence?.offset)) {
            failures.push({
                name: row.name,
                reason: 'actor_profile.discovery_source_offset_ambiguous',
                retryable: false,
            });
            continue;
        }
        const sourceAnchor = row.sourceAnchor;
        const sourceOrdinal = Number.isInteger(row.entry?.sourceOrdinal)
            && row.entry.sourceOrdinal >= 0
            ? row.entry.sourceOrdinal : row.index;
        ordered.push({
            entry: {
                ...row.entry,
                sourceAnchor,
                sourceUnitOffset: independentOccurrence.unitStart,
                sourceOffset: independentOccurrence.offset,
                sourceOrdinal,
            },
            anchor: {
                ...anchor,
                offset: independentOccurrence.offset,
                sourceAnchor,
                sourceUnitOffset: independentOccurrence.unitStart,
            },
            sourceEnd: independentOccurrence.end,
            inputIndex: row.index,
            sourceOrdinal,
        });
    }
    ordered.sort((left, right) => (
        left.anchor.offset - right.anchor.offset
        || left.sourceOrdinal - right.sourceOrdinal
        || left.sourceEnd - right.sourceEnd
        || left.inputIndex - right.inputIndex
    ));
    return { ordered, failures };
}

export function actorProfileBatchSemanticFingerprint(overrides = {}) {
    return `actor-profile-batch:${fingerprint(JSON.stringify({
        identityRetryGuidance: SAFE_IDENTITY_RETRY_GUIDANCE,
        profileRetryCodes: [...SAFE_PROFILE_RETRY_CODES].sort(),
        transportRows: ACTOR_PROFILE_GROUP_TRANSPORT_ROWS,
        groupChunks: String(actorProfileModuleGroupChunks),
        discoverySourceOrder: String(
            overrides?.discoverySourceOrder || actorProfileDiscoverySourceOrder,
        ),
        discoveryNameRecovery: String(recoverActorProfileDiscoveryNameFromEvidence),
        ...(overrides || {}),
        transaction: String(
            overrides?.transaction || completeActorProfileBatchTransaction,
        ),
        groupFailureDiagnostic: String(
            overrides?.groupFailureDiagnostic || actorProfileGroupFailureDiagnostic,
        ),
        resolverPromotionClosure: String(
            overrides?.resolverPromotionClosure || actorProfileResolverPromotionClosure,
        ),
        finalCandidateClosure: String(
            overrides?.finalCandidateClosure || actorProfileFinalCandidateClosure,
        ),
        workingSection: String(
            overrides?.workingSection || actorProfileWorkingSection,
        ),
        recoveryProgress: String(normalizeActorProfileRecoveryProgress),
        legacyDuplicateOffsetRecoveryMigration: String(
            overrides?.legacyDuplicateOffsetRecoveryMigration
                || migrateActorProfileLegacyDuplicateOffsetRecoveryProgress,
        ),
        manualIdentityRetryCodes: [...SAFE_MANUAL_IDENTITY_RETRY_CODES].sort(),
        manualIdentityRetryProgress: String(
            overrides?.manualIdentityRetryProgress
                || prepareActorProfileManualIdentityRetryProgress,
        ),
        recoveryDigest: String(actorProfileRecoveryProgressDigest),
    }))}`;
}

const PROFILE_BATCH_FAILURE_CATEGORIES = new Set([
    'scope_stale',
    'target_stale',
    'foreground_preempted',
    'cancelled',
    'http',
    'timeout',
    'empty',
    'protocol',
    'transport',
]);

const PROFILE_RECOVERY_MODULE_KEYS = Object.freeze([
    'person',
    'personality',
    'history',
    'relationshipsMotives',
    'currentState',
    'knowledgeCapabilitiesResources',
    'physiology',
]);

const SAFE_MANUAL_IDENTITY_RETRY_CODES = new Set([
    'actor_profile.discovery_source_offset_ambiguous',
    'actor_profile.group_row_missing',
    'actor_profile.format_unrecoverable',
    'actor_profile.identity_bootstrap_already_attempted',
    'actor_candidate.identity_missing_or_short',
]);

export function normalizeActorProfileRecoveryProgress(value) {
    if (!value || typeof value !== 'object') return null;
    const rows = [];
    const seen = new Set();
    for (const raw of Array.isArray(value.rows) ? value.rows : []) {
        const actorId = cleanText(raw?.actorId, 120);
        const name = cleanText(raw?.name, 160);
        const sourceAnchor = String(raw?.sourceAnchor || '').slice(0, 1200);
        const discovery = raw?.discovery === true;
        if (!actorId || !name || (discovery && !sourceAnchor)) continue;
        const key = `${actorId}\u0000${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const modules = {};
        for (const moduleKey of PROFILE_RECOVERY_MODULE_KEYS) {
            const text = String(raw?.modules?.[moduleKey] || '').trim().slice(0, 16000);
            if (text) modules[moduleKey] = text;
        }
        rows.push({
            actorId,
            name,
            discovery,
            sourceAnchor: discovery ? sourceAnchor : '',
            ...(discovery && cleanText(raw?.coverageUnitId, 80)
                ? { coverageUnitId: cleanText(raw.coverageUnitId, 80) } : {}),
            ...(discovery && Number.isInteger(raw?.sourceUnitOffset)
                && raw.sourceUnitOffset >= 0
                ? { sourceUnitOffset: raw.sourceUnitOffset } : {}),
            ...(discovery && Number.isInteger(raw?.sourceOffset)
                && raw.sourceOffset >= 0
                ? { sourceOffset: raw.sourceOffset } : {}),
            ...(discovery && Number.isInteger(raw?.sourceOrdinal)
                && raw.sourceOrdinal >= 0
                ? { sourceOrdinal: raw.sourceOrdinal } : {}),
            modules,
            ...(raw?.identityReveal && typeof raw.identityReveal === 'object'
                ? { identityReveal: clone(raw.identityReveal) } : {}),
        });
    }
    const manualIdentityRetryCount = Math.min(
        1,
        Math.max(0, Math.floor(Number(value.manualIdentityRetryCount) || 0)),
    );
    const identityLocked = value.identityLocked === true;
    const identityAttempted = identityLocked || value.identityAttempted === true;
    if (
        !identityAttempted
        && manualIdentityRetryCount === 0
        && !rows.some((row) => Object.keys(row.modules).length > 0)
    ) {
        return null;
    }
    return {
        version: 1,
        identityAttempted,
        identityLocked,
        manualIdentityRetryCount,
        rows: rows.sort((left, right) => left.actorId.localeCompare(right.actorId)),
        verifiedFieldCount: rows.reduce(
            (sum, row) => sum + Object.keys(row.modules).length,
            0,
        ),
    };
}

export function migrateActorProfileLegacyDuplicateOffsetRecoveryProgress(
    value,
    failureCodes = [],
) {
    const progress = normalizeActorProfileRecoveryProgress(value);
    if (!progress) return null;
    const isLegacyDuplicateOffsetLock = (
        progress.identityLocked === true
        && progress.identityAttempted === true
        && progress.rows.length === 0
        && progress.verifiedFieldCount === 0
        && Array.isArray(failureCodes)
        && failureCodes.includes('actor_profile.discovery_source_offset_duplicate')
    );
    return isLegacyDuplicateOffsetLock
        ? { ...progress, identityLocked: false, identityAttempted: false }
        : progress;
}

export function prepareActorProfileManualIdentityRetryProgress(
    value,
    failureCodes = [],
) {
    const progress = normalizeActorProfileRecoveryProgress(value);
    if (!progress) return null;
    const retryableFailure = Array.isArray(failureCodes)
        && failureCodes.some((code) => SAFE_MANUAL_IDENTITY_RETRY_CODES.has(String(code || '')));
    const canRetry = (
        retryableFailure
        && progress.identityAttempted === true
        && progress.identityLocked === false
        && progress.manualIdentityRetryCount < 1
        && progress.rows.length === 0
        && progress.verifiedFieldCount === 0
    );
    return canRetry
        ? {
            ...progress,
            identityAttempted: false,
            identityLocked: false,
            manualIdentityRetryCount: progress.manualIdentityRetryCount + 1,
        }
        : progress;
}

export function actorProfileRecoveryProgressDigest(value, sourceDigest = '') {
    const normalized = normalizeActorProfileRecoveryProgress(value);
    if (!normalized) return '';
    return `profile-recovery-progress:${fingerprint(JSON.stringify({
        sourceDigest: cleanText(sourceDigest, 240),
        progress: normalized,
    }))}`;
}

const PROFILE_BATCH_LENGTH_BUCKETS = new Set([
    'empty',
    'tiny',
    'small',
    'medium',
    'large',
    'oversize',
]);

function profileBatchRouteDiagnostic(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.requestKind && value.requestKind !== 'actor_profile_batch') return null;
    const channel = value.channel === 'fast' ? 'fast'
        : value.channel === 'strict' ? 'strict' : '';
    const requestKind = value.requestKind === 'actor_profile_batch'
        ? 'actor_profile_batch'
        : '';
    if (!channel && !requestKind) return null;
    const diagnostic = {
        channel,
        slot: Math.max(0, Math.floor(Number(value.slot) || 0)),
        model: cleanText(value.model, 120),
        failover: value.failover === true,
        jsonMode: value.jsonMode === true,
        requestStarted: value.requestStarted === true,
        inputLengthBucket: PROFILE_BATCH_LENGTH_BUCKETS.has(value.inputLengthBucket)
            ? value.inputLengthBucket
            : 'empty',
        httpStatus: Math.max(0, Math.floor(Number(value.httpStatus) || 0)),
        failureKind: PROFILE_BATCH_FAILURE_CATEGORIES.has(value.failureKind)
            ? value.failureKind
            : 'transport',
    };
    const groupKey = cleanText(value.groupKey, 80);
    const moduleKeys = Array.isArray(value.moduleKeys)
        ? value.moduleKeys.map((entry) => cleanText(entry, 80)).filter(Boolean).slice(0, 7)
        : [];
    if (groupKey) diagnostic.groupKey = groupKey;
    if (moduleKeys.length) diagnostic.moduleKeys = moduleKeys;
    return diagnostic;
}

function profileBatchRequestFailure(error) {
    const requested = String(error?.profileBatchFailureCategory || error?.failureKind || '');
    const category = PROFILE_BATCH_FAILURE_CATEGORIES.has(requested)
        ? requested
        : error?.name === 'AbortError'
            ? 'cancelled'
            : Number(error?.status) > 0
                ? 'http'
                : 'transport';
    return {
        category,
        routeDiagnostic: profileBatchRouteDiagnostic(error?.routeDiagnostic),
    };
}

function persistenceFailureReason(reason) {
    if (reason === 'host_save_readback_unsupported') {
        return 'actor_profile.readback_unsupported';
    }
    if (reason === 'host_save_readback_mismatch') {
        return 'actor_profile.readback_mismatch';
    }
    if ([
        'chat_context_changed',
        'chat_context_changed_after_save',
        'write_precondition_failed',
        'field_state_mismatch',
        'stale_namespace_revision',
        'actor_profile.target_stale',
    ].includes(reason)) return 'actor_profile.target_stale';
    return 'actor_profile.commit_rejected';
}

export async function completeActorProfileBatchTransaction({
    ledger,
    persistenceBaseLedger = ledger,
    candidates = [],
    evidenceText = '',
    customPrompt = '',
    turn = 0,
    target = {},
    semanticRetry = true,
    transportActorLimit = ACTOR_PROFILE_GROUP_TRANSPORT_ROWS,
    transportConcurrency = 1,
    transportRouteSlots = [],
    allowDiscovery = false,
    discoveryContext = null,
    recoveryProgress = null,
    requestBatch,
    preflightDiscoveries,
    resolveDiscoveries,
    persistPendingBatch,
    persistFinalizedBatch,
    isTargetCurrent = () => true,
} = {}) {
    const startedAt = Date.now();
    let latestRecoveryProgress = normalizeActorProfileRecoveryProgress(recoveryProgress);
    const supplied = (Array.isArray(candidates) ? candidates : [])
        .filter((candidate) => candidateActorId(candidate) && candidateName(candidate));
    const candidateCounts = new Map();
    for (const candidate of supplied) {
        const actorId = candidateActorId(candidate);
        candidateCounts.set(actorId, (candidateCounts.get(actorId) || 0) + 1);
    }
    const duplicateInputIds = new Set([...candidateCounts]
        .filter(([, count]) => count > 1)
        .map(([actorId]) => actorId));
    const inputFailures = [...duplicateInputIds].map((actorId) => failureFor(
        supplied.find((candidate) => candidateActorId(candidate) === actorId),
        'actor_profile.input_actor_ref_duplicate',
    ));
    const selected = supplied.filter((candidate) => !duplicateInputIds.has(
        candidateActorId(candidate),
    ));
    // Candidate preparation may create in-memory scaffolds. Atomic persistence
    // always starts from the pre-preparation ledger so a rejected actor remains
    // byte-for-byte untouched while successful peers commit together.
    const originalLedger = normalizeActorLedger(persistenceBaseLedger, {
        chatId: persistenceBaseLedger?.chatId || ledger?.chatId,
    });
    const base = {
        ledger: originalLedger,
        candidates: supplied,
        accepted: [],
        rejected: [],
        failures: inputFailures,
        persistenceMeta: null,
        modelCalls: 0,
        persistenceStatus: 'not_completed',
        readbackVerified: false,
        batchMeta: null,
        batchFormatReplacementAttempted: false,
        recoveryProgress: clone(latestRecoveryProgress),
        timings: { totalMs: 0, modelMs: 0, parseMs: 0, persistMs: 0 },
    };
    if (!selected.length && !allowDiscovery) return base;
    if (
        typeof requestBatch !== 'function'
        || (allowDiscovery && typeof preflightDiscoveries !== 'function')
        || typeof resolveDiscoveries !== 'function'
        || typeof persistPendingBatch !== 'function'
        || typeof persistFinalizedBatch !== 'function'
    ) {
        return {
            ...base,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.batch_adapter_unavailable',
            ))],
        };
    }
    const current = async () => {
        try {
            return await Promise.resolve(isTargetCurrent()) === true;
        } catch {
            return false;
        }
    };
    if (!await current()) {
        return {
            ...base,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.target_stale',
            ))],
        };
    }

    const acceptedById = new Map();
    const failureById = new Map();
    const rejected = [];
    let modelCalls = 0;
    let modelMs = 0;
    let parseMs = 0;
    let persistMs = 0;
    const collect = async (
        subset,
        validationFeedback,
        attempt,
        discoveryRetryTargets = [],
        forceDiscoveryRetry = false,
    ) => {
        const attemptDiscoveryContext = attempt === 0
            ? {
                ...(discoveryContext || {}),
                discoveryEnabled: allowDiscovery === true,
            }
            : {
                ...(discoveryContext || {}),
                discoveryEnabled: discoveryRetryTargets.length > 0 || forceDiscoveryRetry,
                discoveryRetryOnly: discoveryRetryTargets.length > 0,
            };
        const profileById = new Map(subset.map((candidate) => [candidateActorId(candidate), {
            candidate,
            sections: clone(candidate?.previousProfile?.narrativeSections || {}),
        }]));
        const completedModulesByActor = new Map();
        const discoveries = new Map();
        const identityReveals = new Map();
        const groupDiagnostics = [];
        let identityLocked = latestRecoveryProgress?.identityLocked === true;
        const manualIdentityRetryCount = Math.min(
            1,
            Math.max(0, Number(latestRecoveryProgress?.manualIdentityRetryCount) || 0),
        );
        let identityAttempted = identityLocked
            || latestRecoveryProgress?.identityAttempted === true;
        const recoveredRows = new Map((latestRecoveryProgress?.rows || []).map((row) => [
            candidateActorId(row), row,
        ]));
        for (const [actorId, row] of recoveredRows) {
            if (row.discovery !== true) {
                const currentRow = profileById.get(actorId);
                if (!currentRow) continue;
                if (row.identityReveal) {
                    const previousName = candidateName(currentRow.candidate);
                    currentRow.candidate = {
                        ...currentRow.candidate,
                        actorRef: { actorId, name: row.name },
                        actorId,
                        name: row.name,
                        identity: {
                            ...clone(currentRow.candidate?.identity || {}),
                            aliases: [...new Set([
                                ...(currentRow.candidate?.identity?.aliases || []),
                                previousName,
                            ].filter((value) => value && value !== row.name))],
                        },
                        refreshProfileModules: [...ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES],
                        __identityReveal: clone(row.identityReveal),
                    };
                    identityReveals.set(actorId, clone(row.identityReveal));
                } else if (candidateName(currentRow.candidate) !== row.name) {
                    continue;
                }
                for (const [moduleKey, text] of Object.entries(row.modules || {})) {
                    currentRow.sections[moduleKey] = actorProfileWorkingSection(
                        currentRow.candidate,
                        moduleKey,
                        text,
                    );
                    if (!completedModulesByActor.has(actorId)) {
                        completedModulesByActor.set(actorId, new Set());
                    }
                    completedModulesByActor.get(actorId).add(moduleKey);
                }
                continue;
            }
            const anchor = validateActorProfileDiscoveryAnchor({
                name: row.name,
                sourceAnchor: row.sourceAnchor,
                sourceOffset: row.sourceOffset,
                sourceUnitOffset: row.sourceUnitOffset,
            }, String(attemptDiscoveryContext?.acceptedNarrative || ''));
            if (!anchor.ok) continue;
            const completionMode = attemptDiscoveryContext?.completionMode
                || subset[0]?.completionMode || 'full';
            const candidate = {
                actorRef: { actorId, name: row.name },
                name: row.name,
                completionMode,
                previousProfile: {
                    narrativeSections: Object.fromEntries(Object.entries(row.modules || {})
                        .map(([moduleKey, text]) => [
                            moduleKey,
                            actorProfileWorkingSection(
                                { completionMode },
                                moduleKey,
                                text,
                            ),
                        ])),
                },
                characterCreationTicket: null,
                __discoveryKey: `${row.name}\u0000${row.sourceAnchor}`,
                __sourceOffset: anchor.offset,
                __sourceOrdinal: Number.isInteger(row.sourceOrdinal)
                    ? row.sourceOrdinal : 0,
                __coverageUnitId: cleanText(row.coverageUnitId, 80),
                __sourceUnitOffset: Number.isInteger(row.sourceUnitOffset)
                    ? row.sourceUnitOffset : undefined,
            };
            profileById.set(actorId, {
                candidate,
                sections: clone(candidate.previousProfile.narrativeSections),
            });
            discoveries.set(candidate.__discoveryKey, {
                name: row.name,
                sourceAnchor: row.sourceAnchor,
                coverageUnitId: cleanText(row.coverageUnitId, 80),
                sourceUnitOffset: Number.isInteger(row.sourceUnitOffset)
                    ? row.sourceUnitOffset : undefined,
                sourceOffset: anchor.offset,
                sourceOrdinal: Number.isInteger(row.sourceOrdinal)
                    ? row.sourceOrdinal : 0,
                sections: clone(row.modules || {}),
            });
            completedModulesByActor.set(actorId, new Set(Object.keys(row.modules || {})));
        }
        const captureRecoveryProgress = () => {
            const rows = [];
            for (const { candidate, sections } of profileById.values()) {
                const actorId = candidateActorId(candidate);
                const completed = completedModulesByActor.get(actorId) || new Set();
                const modules = {};
                for (const moduleKey of completed) {
                    const text = String(sections?.[moduleKey]?.text ?? sections?.[moduleKey] ?? '').trim();
                    if (text) modules[moduleKey] = text;
                }
                const discoveryKey = String(candidate?.__discoveryKey || '');
                const sourceAnchor = discoveryKey.includes('\u0000')
                    ? discoveryKey.slice(discoveryKey.indexOf('\u0000') + 1)
                    : '';
                if (!identityLocked && !Object.keys(modules).length) continue;
                rows.push({
                    actorId,
                    name: candidateName(candidate),
                    discovery: Boolean(sourceAnchor),
                    sourceAnchor,
                    ...(sourceAnchor && candidate?.__coverageUnitId
                        ? { coverageUnitId: candidate.__coverageUnitId } : {}),
                    ...(sourceAnchor && Number.isInteger(candidate?.__sourceUnitOffset)
                        ? { sourceUnitOffset: candidate.__sourceUnitOffset } : {}),
                    ...(sourceAnchor && Number.isInteger(candidate?.__sourceOffset)
                        ? { sourceOffset: candidate.__sourceOffset } : {}),
                    ...(sourceAnchor && Number.isInteger(candidate?.__sourceOrdinal)
                        ? { sourceOrdinal: candidate.__sourceOrdinal } : {}),
                    modules,
                    ...(candidate?.__identityReveal
                        ? { identityReveal: clone(candidate.__identityReveal) } : {}),
                });
            }
            latestRecoveryProgress = normalizeActorProfileRecoveryProgress({
                version: 1,
                identityAttempted,
                identityLocked,
                manualIdentityRetryCount,
                rows,
            });
            return clone(latestRecoveryProgress);
        };
        const callGroup = async (group, groupAttempt = 0, groupFeedback = validationFeedback) => {
            // A retry may reuse successful sibling groups only inside this
            // transaction. Revalidate the accepted source before every call;
            // the existing Phase1 writer later enforces the exact fresh base
            // revision/digest CAS before any cached group can become durable.
            if (!await current()) return { stale: true };
            const buildMessages = (chunk) => buildActorProfileModuleGroupMessages(chunk, {
                evidenceText, customPrompt, validationFeedback: groupFeedback,
                discoveryContext: attemptDiscoveryContext,
            });
            const chunks = actorProfileModuleGroupChunks(group, transportActorLimit);
            const aggregate = {
                entries: [], failures: [], explicitEmpty: false,
                formatUnrecoverable: false, coverageProof: null,
            };
            const executeChunk = async (
                chunk,
                chunkIndex,
                routeSlotIndex = null,
                occupiedRouteSlotIndices = [],
            ) => {
                const messages = buildMessages(chunk);
                let output;
                const requestStartedAt = Date.now();
                try {
                    const groupCandidates = [...new Map(Object.values(chunk.targets || {})
                        .flat()
                        .map((candidate) => [candidateActorId(candidate), candidate])).values()];
                    output = await requestBatch({
                        candidates: clone(groupCandidates), messages, attempt: groupAttempt,
                        groupKey: chunk.key, moduleKeys: clone(chunk.modules),
                        fieldCount: Math.max(0, Number(chunk.targetCount) || 0),
                        transportChunk: clone(chunk.transportChunk || null),
                        routeSlotIndex,
                        occupiedRouteSlotIndices: clone(occupiedRouteSlotIndices),
                    });
                    modelCalls += 1;
                } catch (error) {
                    const failure = profileBatchRequestFailure(error);
                    if (failure.routeDiagnostic?.requestStarted === true) modelCalls += 1;
                    return {
                        chunk,
                        chunkIndex,
                        modelDurationMs: Math.max(0, Date.now() - requestStartedAt),
                        requestFailure: failure,
                        diagnostic: {
                            groupKey: chunk.key,
                            attempt: groupAttempt,
                            transportChunk: clone(chunk.transportChunk || null),
                            status: 'transport_failed',
                            routeDiagnostic: failure.routeDiagnostic,
                        },
                    };
                }
                const modelFinishedAt = Date.now();
                const modelDurationMs = Math.max(0, modelFinishedAt - requestStartedAt);
                if (!await current()) return {
                    chunk,
                    chunkIndex,
                    stale: true,
                    modelDurationMs,
                };
                const parseStartedAt = Date.now();
                const parsed = parseActorProfileModuleGroupOutput(output, chunk, {
                    acceptedNarrative: attemptDiscoveryContext?.acceptedNarrative || '',
                    registeredActorIndex: attemptDiscoveryContext?.registeredActorIndex || [],
                });
                parseMs += Date.now() - parseStartedAt;
                const parsedFailureCodes = [...new Set((parsed.failures || [])
                    .map((entry) => cleanText(entry?.reason, 120))
                    .filter((code) => /^actor_profile\.[a-z0-9_.-]+$/u.test(code)))].slice(0, 8);
                const parsedMissingModules = [...new Set((parsed.failures || []).flatMap((entry) => [
                    cleanText(entry?.moduleKey, 80),
                    ...(entry?.missingFields || []).map((path) => cleanText(path, 160).split('.').at(-1)),
                ]).filter((moduleKey) => /^[a-z][a-zA-Z0-9]*$/u.test(moduleKey)))].slice(0, 7);
                const routeRepairCodes = [...new Set((parsed.routeRepairs || [])
                    .map((code) => cleanText(code, 120))
                    .filter((code) => /^actor_profile\.route_[a-z0-9_.-]+$/u.test(code)))].slice(0, 4);
                return {
                    chunk,
                    chunkIndex,
                    modelDurationMs,
                    parsed,
                    diagnostic: {
                        groupKey: chunk.key,
                        moduleKeys: clone(chunk.modules),
                        targetCount: chunk.targetCount,
                        attempt: groupAttempt,
                        transportChunk: clone(chunk.transportChunk || null),
                        status: parsed.formatUnrecoverable
                            ? 'format_failed'
                            : parsedFailureCodes.length ? 'semantic_failed' : 'parsed',
                        parsedRowCount: Math.max(0, Number(parsed.entries?.length) || 0),
                        failureCodes: parsedFailureCodes,
                        missingModules: parsedMissingModules,
                        routeRepairCount: Math.max(0, Number(parsed.routeRepairs?.length) || 0),
                        routeRepairCodes,
                    },
                };
            };
            // Each post-identity ActorRef is one transport row. Independent
            // direct routes may run these rows concurrently; host generateRaw
            // remains serialized by its shared background scheduler key. The
            // existing transaction-local clone and pending -> final CAS still
            // make persistence all-or-nothing across every row.
            const boundedConcurrency = Math.min(
                chunks.length,
                Math.max(1, Math.floor(Number(transportConcurrency) || 1)),
            );
            const frozenRouteSlots = (Array.isArray(transportRouteSlots)
                ? transportRouteSlots : [])
                .map((value) => Math.max(0, Math.floor(Number(value) || 0)))
                .slice(0, boundedConcurrency);
            const chunkResults = [];
            let stopLaunching = false;
            for (let start = 0; start < chunks.length && !stopLaunching; start += boundedConcurrency) {
                const wave = chunks.slice(start, start + boundedConcurrency);
                const occupiedRouteSlotIndices = frozenRouteSlots.slice(0, wave.length);
                const settled = await Promise.allSettled(wave.map((chunk, offset) => (
                    executeChunk(
                        chunk,
                        start + offset,
                        frozenRouteSlots[offset] ?? null,
                        occupiedRouteSlotIndices,
                    )
                )));
                for (let offset = 0; offset < settled.length; offset += 1) {
                    const chunkIndex = start + offset;
                    const result = settled[offset];
                    const normalized = result.status === 'fulfilled'
                        ? result.value
                        : {
                            chunk: chunks[chunkIndex],
                            chunkIndex,
                            modelDurationMs: 0,
                            requestFailure: profileBatchRequestFailure(result.reason),
                            diagnostic: {
                                groupKey: chunks[chunkIndex]?.key || group.key,
                                attempt: groupAttempt,
                                transportChunk: clone(chunks[chunkIndex]?.transportChunk || null),
                                status: 'transport_failed',
                                routeDiagnostic: profileBatchRouteDiagnostic(result.reason?.routeDiagnostic),
                            },
                        };
                    chunkResults[chunkIndex] = normalized;
                    if (normalized?.stale || normalized?.requestFailure) stopLaunching = true;
                }
                modelMs += Math.max(0, ...chunkResults
                    .slice(start, start + settled.length)
                    .filter(Boolean)
                    .map((entry) => Math.max(0, Number(entry.modelDurationMs) || 0)));
            }
            for (const chunkResult of chunkResults.filter(Boolean)) {
                const { chunk, parsed } = chunkResult;
                if (chunkResult.diagnostic) groupDiagnostics.push(chunkResult.diagnostic);
                if (chunkResult.stale) return { stale: true };
                if (chunkResult.requestFailure) continue;
                // TavernDB keeps validated cells in its transaction-local
                // workingTableData even when a later transport chunk fails.
                // Mirror that exact boundary here: only exact ActorRef x
                // scheduled-module cells without a local parse/semantic
                // failure enter the recovery working clone. Nothing is
                // durable until the existing pending -> final readbacks.
                if (chunk.key !== 'identity_bootstrap' && !parsed.formatUnrecoverable) {
                    const globalFailure = (parsed.failures || []).some((failureEntry) => (
                        !cleanText(failureEntry?.actorId, 120)
                    ));
                    if (!globalFailure) {
                        for (const entry of parsed.entries || []) {
                            const actorId = cleanText(entry?.actorId, 120);
                            const row = profileById.get(actorId);
                            if (!row || (entry.name
                                && cleanText(entry.name, 160) !== candidateName(row.candidate))) {
                                continue;
                            }
                            for (const moduleKey of chunk.modules || []) {
                                const scheduled = (chunk.targets?.[moduleKey] || [])
                                    .some((candidate) => candidateActorId(candidate) === actorId);
                                const failed = (parsed.failures || []).some((failureEntry) => (
                                    cleanText(failureEntry?.actorId, 120) === actorId
                                    && (
                                        !cleanText(failureEntry?.moduleKey, 80)
                                        || cleanText(failureEntry?.moduleKey, 80) === moduleKey
                                    )
                                ));
                                const text = String(entry?.modules?.[moduleKey] || '').trim();
                                if (!scheduled || failed || !text) continue;
                                row.sections[moduleKey] = actorProfileWorkingSection(
                                    row.candidate,
                                    moduleKey,
                                    text,
                                );
                                if (!completedModulesByActor.has(actorId)) {
                                    completedModulesByActor.set(actorId, new Set());
                                }
                                completedModulesByActor.get(actorId).add(moduleKey);
                            }
                        }
                        captureRecoveryProgress();
                    }
                }
                if (chunks.length === 1) return parsed;
                aggregate.entries.push(...(parsed.entries || []));
                aggregate.failures.push(...(parsed.failures || []));
                if (parsed.formatUnrecoverable) {
                    for (const rows of Object.values(chunk.targets || {})) {
                        for (const candidate of rows || []) {
                            aggregate.failures.push(failureFor(
                                candidate,
                                'actor_profile.format_unrecoverable',
                                { groupKey: chunk.key },
                            ));
                        }
                    }
                }
            }
            const requestFailure = chunkResults.find((entry) => entry.requestFailure)?.requestFailure;
            if (requestFailure) {
                return { requestFailure, recoveryProgress: captureRecoveryProgress() };
            }
            return aggregate;
        };
        const prepareGroupApply = (group, parsed) => {
            const failures = (parsed.failures || []).map((entry) => ({
                ...entry,
                groupKey: group.key,
            }));
            const sectionUpdates = [];
            const discoveryUpdates = [];
            const identityRevealUpdates = [];
            const scheduledByActor = new Map();
            for (const [moduleKey, targets] of Object.entries(group.targets || {})) {
                for (const targetCandidate of targets) {
                    const actorId = candidateActorId(targetCandidate);
                    if (!scheduledByActor.has(actorId)) scheduledByActor.set(actorId, new Set());
                    scheduledByActor.get(actorId).add(moduleKey);
                }
            }
            for (const entry of parsed.entries || []) {
                if (entry.actorId === 'new') {
                    if (group.key !== 'identity_bootstrap') {
                        failures.push({ actorId: '', name: entry.name, reason: 'actor_profile.discovery_outside_bootstrap' });
                        continue;
                    }
                    const rawName = cleanText(entry.name, 160);
                    const name = recoverActorProfileDiscoveryNameFromEvidence(
                        rawName,
                        String(entry.sourceAnchor || '').slice(0, 1200),
                    ) || rawName;
                    if (!name) continue;
                    const narrative = String(attemptDiscoveryContext?.acceptedNarrative || '');
                    const offset = narrative.indexOf(name);
                    const parserSourceAnchor = String(entry.sourceAnchor || '').slice(0, 1200);
                    const sourceAnchor = parserSourceAnchor || (offset >= 0
                        ? narrative.slice(Math.max(0, offset - 80), Math.min(narrative.length, offset + name.length + 120)).trim()
                        : '');
                    const key = `${name}\u0000${sourceAnchor}`;
                    if (discoveries.has(key)) {
                        failures.push({ name, reason: 'actor_profile.discovery_duplicate' });
                        continue;
                    }
                    discoveryUpdates.push({ key, value: {
                        name,
                        sourceAnchor,
                        coverageUnitId: cleanText(entry.coverageUnitId, 80),
                        sourceUnitOffset: Number.isInteger(entry.sourceUnitOffset)
                            && entry.sourceUnitOffset >= 0
                            ? entry.sourceUnitOffset : undefined,
                        sections: clone(entry.modules),
                        ...(name !== rawName
                            ? { repairs: ['actor_profile.discovery_name_from_explicit_evidence'] }
                            : {}),
                    } });
                    continue;
                }
                if (group.key === 'identity_bootstrap' && !group.modules.length) {
                    if (entry.identityReveal !== true) continue;
                    const actorId = cleanText(entry.actorId, 120);
                    const sourceCandidate = (attemptDiscoveryContext?.registeredProfileCandidates || [])
                        .find((candidate) => candidateActorId(candidate) === actorId);
                    if (!sourceCandidate) {
                        failures.push({
                            actorId,
                            name: entry.name,
                            reason: 'actor_profile.identity_reveal_actor_ref_unknown',
                            groupKey: group.key,
                        });
                        continue;
                    }
                    const previousName = candidateName(sourceCandidate);
                    const nextName = cleanText(entry.name, 160);
                    const revealCandidate = {
                        ...clone(sourceCandidate),
                        actorRef: { actorId, name: nextName },
                        actorId,
                        name: nextName,
                        identity: {
                            ...clone(sourceCandidate.identity || {}),
                            aliases: [...new Set([
                                ...(sourceCandidate.identity?.aliases || []),
                                previousName,
                            ].filter((value) => value && value !== nextName))],
                        },
                        refreshProfileModules: [...ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES],
                        __identityReveal: {
                            actorId,
                            previousName,
                            revealedName: nextName,
                            coverageUnitId: cleanText(entry.coverageUnitId, 80),
                            sourceAnchor: String(entry.sourceAnchor || '').slice(0, 1200),
                            evidenceSpan: String(entry.evidenceSpan || '').trim().slice(0, 240),
                        },
                    };
                    profileById.set(actorId, {
                        candidate: revealCandidate,
                        sections: clone(sourceCandidate?.previousProfile?.narrativeSections || {}),
                    });
                    identityRevealUpdates.push({
                        key: actorId,
                        value: clone(revealCandidate.__identityReveal),
                    });
                    continue;
                }
                const row = profileById.get(cleanText(entry.actorId, 120));
                const scheduledModules = scheduledByActor.get(cleanText(entry.actorId, 120));
                if (!row || !scheduledModules || (entry.name && cleanText(entry.name, 160) !== candidateName(row.candidate))) {
                    failures.push({ actorId: entry.actorId, name: entry.name, reason: 'actor_profile.actor_ref_mismatch', groupKey: group.key });
                    continue;
                }
                const unexpectedModule = Object.keys(entry.modules || {}).find((key) => !scheduledModules.has(key));
                if (unexpectedModule) {
                    failures.push({ actorId: entry.actorId, name: entry.name, reason: 'actor_profile.module_unexpected', moduleKey: unexpectedModule, groupKey: group.key });
                    continue;
                }
                sectionUpdates.push({ row, modules: clone(entry.modules) });
            }
            for (const [moduleKey, targets] of Object.entries(group.targets || {})) {
                for (const targetCandidate of targets) {
                    const actorId = candidateActorId(targetCandidate);
                    const update = sectionUpdates.find((entry) => candidateActorId(entry.row.candidate) === actorId);
                    if (!cleanText(update?.modules?.[moduleKey], 4000)) {
                        failures.push(failureFor(targetCandidate, 'actor_profile.module_missing', { groupKey: group.key, moduleKey, missingFields: [`narrativeSections.${moduleKey}`] }));
                    }
                }
            }
            return { failures, sectionUpdates, discoveryUpdates, identityRevealUpdates };
        };
        const commitGroupApply = (preparedApply) => {
            for (const update of preparedApply.sectionUpdates) {
                for (const [moduleKey, text] of Object.entries(update.modules || {})) {
                    update.row.sections[moduleKey] = actorProfileWorkingSection(
                        update.row.candidate,
                        moduleKey,
                        text,
                    );
                }
                const actorId = candidateActorId(update.row.candidate);
                if (!completedModulesByActor.has(actorId)) completedModulesByActor.set(actorId, new Set());
                for (const moduleKey of Object.keys(update.modules || {})) {
                    completedModulesByActor.get(actorId).add(moduleKey);
                }
            }
            for (const update of preparedApply.discoveryUpdates) discoveries.set(update.key, update.value);
            for (const update of preparedApply.identityRevealUpdates || []) {
                identityReveals.set(update.key, update.value);
            }
        };
        const workingCandidates = () => [...profileById.values()].map(({ candidate, sections }) => {
            const actorId = candidateActorId(candidate);
            const completed = completedModulesByActor.get(actorId) || new Set();
            return {
                ...candidate,
                refreshProfileModules: Array.isArray(candidate?.refreshProfileModules)
                    ? candidate.refreshProfileModules.filter((moduleKey) => !completed.has(moduleKey))
                    : candidate?.refreshProfileModules,
                previousProfile: {
                    ...(candidate?.previousProfile || {}),
                    profileFormat: 'narrative-v1',
                    narrativeSections: clone(sections),
                },
            };
        });
        const retryFeedbackFor = (preparedApply, parsed, group = null) => {
            const structuredByKey = new Map();
            for (const entry of [
                ...(preparedApply?.failures || []),
                ...(parsed?.failures || []),
            ]) {
                const key = [entry?.reason, entry?.actorId, entry?.moduleKey, entry?.groupKey]
                    .map((value) => cleanText(value, 160)).join('|');
                if (!structuredByKey.has(key)) structuredByKey.set(key, entry);
            }
            const structured = [...structuredByKey.values()];
            if (parsed?.formatUnrecoverable === true && !(parsed?.failures || []).length) {
                structured.push({
                    reason: 'actor_profile.format_unrecoverable',
                    groupKey: group?.key || '',
                });
            }
            return structured.map((entry) => {
                const rawCode = cleanText(entry?.reason, 160);
                const identityAction = SAFE_IDENTITY_RETRY_GUIDANCE[rawCode] || '';
                const code = identityAction || SAFE_PROFILE_RETRY_CODES.has(rawCode)
                    ? rawCode
                    : 'actor_profile.module_invalid';
                const safeToken = (value, limit = 120) => {
                    const token = cleanText(value, limit);
                    return /^[a-z0-9_.:-]+$/iu.test(token) ? token : '';
                };
                const missingFields = (Array.isArray(entry?.missingFields)
                    ? entry.missingFields : [])
                    .map((value) => safeToken(value))
                    .filter(Boolean)
                    .slice(0, 8);
                return JSON.stringify({
                    code,
                    action: identityAction
                        ? `${identityAction}必须仍按原 coverage unit 全集逐项作答；某个 unit 没有合格人物时在该 unit 内输出 <no-new/>，不得输出裸的“无人物档案”。`
                        : '\u6309\u5f53\u524d\u8def\u7531\u534f\u8bae\u4ec5\u91cd\u53d1\u672c\u7ec4\u5931\u8d25\u5185\u5bb9\uff0c\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u8f93\u51fa\uff0c\u4e0d\u8981\u6dfb\u52a0\u89e3\u91ca\u3002',
                    actorId: safeToken(entry?.actorId),
                    moduleKey: safeToken(entry?.moduleKey, 80),
                    groupKey: safeToken(entry?.groupKey || group?.key, 80),
                    missingFields,
                });
            });
        };
        const preflightIdentityDiscoveries = async (preparedApply, group, groupAttempt) => {
            const safePreflightReason = (value) => {
                const code = cleanText(value, 160);
                return /^(?:actor_candidate\.identity_[a-z0-9_.-]+|actor_profile\.(?:discovery|identity)_[a-z0-9_.-]+)$/u
                    .test(code)
                    ? code
                    : 'actor_profile.discovery_preflight_failed';
            };
            if ((preparedApply?.failures || []).length) return {
                stale: false,
                failures: [],
                allDiscoveriesDeterministicallyInvalid: false,
                validCandidateCount: 0,
            };
            const discoveryOrder = actorProfileDiscoverySourceOrder(
                (preparedApply?.discoveryUpdates || []).map(({ value }) => value),
                String(attemptDiscoveryContext?.acceptedNarrative || ''),
            );
            if (discoveryOrder.failures.length) return {
                stale: false,
                failures: discoveryOrder.failures.map((entry) => ({
                    ...entry,
                    reason: safePreflightReason(entry.reason),
                    groupKey: group.key,
                    moduleKey: 'person',
                    missingFields: [],
                })),
                allDiscoveriesDeterministicallyInvalid: false,
                validCandidateCount: 0,
            };
            const discoveryRows = discoveryOrder.ordered.map(({ entry }) => ({
                candidateRef: {
                    name: cleanText(entry?.name, 160),
                    sourceAnchor: String(entry?.sourceAnchor || '').slice(0, 1200),
                    sourceOffset: entry.sourceOffset,
                    sourceOrdinal: entry.sourceOrdinal,
                    coverageUnitId: cleanText(entry.coverageUnitId, 80),
                    sourceUnitOffset: entry.sourceUnitOffset,
                },
                profileFormat: 'narrative-v1',
            }));
            const identityRevealRows = (preparedApply?.identityRevealUpdates || [])
                .map(({ value }) => clone(value));
            if (!discoveryRows.length && !identityRevealRows.length) return {
                stale: false,
                failures: [],
                allDiscoveriesDeterministicallyInvalid: false,
                validCandidateCount: 0,
            };
            if (!await current()) return { stale: true, failures: [] };
            let result;
            try {
                result = await preflightDiscoveries({
                    discoveries: clone(discoveryRows),
                    identityReveals: clone(identityRevealRows),
                    groupKey: group.key,
                    attempt: groupAttempt,
                });
            } catch (error) {
                result = {
                    ok: false,
                    failures: [{
                        reason: safePreflightReason(error?.message || error),
                    }],
                };
            }
            if (!await current()) return { stale: true, failures: [] };
            const failures = (Array.isArray(result?.failures) ? result.failures : [])
                .map((entry) => ({
                    ...entry,
                    name: cleanText(entry?.name || entry?.candidateRef?.name, 160),
                    reason: safePreflightReason(entry?.reason),
                    groupKey: group.key,
                    moduleKey: 'person',
                    missingFields: Array.isArray(entry?.missingFields)
                        ? clone(entry.missingFields) : [],
                }));
            if (result?.ok !== true && !failures.length) failures.push({
                reason: safePreflightReason(result?.reason),
                groupKey: group.key,
                moduleKey: 'person',
                missingFields: [],
            });
            if (failures.length) groupDiagnostics.push({
                groupKey: group.key,
                moduleKeys: clone(group.modules),
                targetCount: group.targetCount,
                attempt: groupAttempt,
                status: 'identity_preflight_failed',
            });
            return {
                stale: false,
                failures,
                allDiscoveriesDeterministicallyInvalid:
                    result?.allDiscoveriesDeterministicallyInvalid === true,
                validCandidateCount: Math.max(0, Number(result?.validCandidateCount) || 0),
            };
        };
        let plan = actorProfileCompletionGroupPlan(subset, {
            allowDiscovery: attemptDiscoveryContext?.discoveryEnabled !== false,
            acceptedNarrative: attemptDiscoveryContext?.acceptedNarrative || '',
        });
        const identity = plan.find((group) => group.key === 'identity_bootstrap');
        if (identity && !identityLocked) {
            if (identityAttempted) {
                return {
                    entries: [], discoveries: [], identityReveals: [],
                    unresolved: [{
                        actorId: '',
                        reason: 'actor_profile.identity_bootstrap_already_attempted',
                        groupKey: identity.key,
                        retryable: false,
                    }],
                    failures: [{
                        actorId: '',
                        reason: 'actor_profile.identity_bootstrap_already_attempted',
                        groupKey: identity.key,
                        retryable: false,
                    }],
                    unexpected: [], explicitEmpty: false,
                    batchMeta: { moduleGroups: groupDiagnostics },
                    recoveryProgress: captureRecoveryProgress(),
                };
            }
            const parsed = await callGroup(identity, 0);
            if (parsed.stale) return parsed;
            if (parsed.requestFailure) {
                if (
                    parsed.requestFailure.routeDiagnostic?.requestStarted === true
                    && parsed.requestFailure.failureKind !== 'foreground_preempted'
                ) {
                    identityAttempted = true;
                    parsed.recoveryProgress = captureRecoveryProgress();
                }
                return parsed;
            }
            identityAttempted = true;
            const preparedApply = prepareGroupApply(identity, parsed);
            const preflight = parsed.formatUnrecoverable
                ? { stale: false, failures: [] }
                : await preflightIdentityDiscoveries(preparedApply, identity, 0);
            if (preflight.stale) return { stale: true };
            preparedApply.failures.push(...preflight.failures);
            if (parsed.explicitEmpty && profileById.size === 0 && !preparedApply.failures.length) {
                return {
                    entries: [], discoveries: [], identityReveals: [], unresolved: [], failures: [], unexpected: [],
                    explicitEmpty: true,
                    coverageProof: clone(parsed.coverageProof),
                    batchMeta: { moduleGroups: groupDiagnostics, protocol: 'module-groups-v1' },
                };
            }
            if (parsed.formatUnrecoverable || preparedApply.failures.length) {
                captureRecoveryProgress();
                const terminalFailures = parsed.formatUnrecoverable && !preparedApply.failures.length
                    ? [{ actorId: '', reason: 'actor_profile.format_unrecoverable', groupKey: identity.key }]
                    : preparedApply.failures;
                return { entries: [], discoveries: [], identityReveals: [], unresolved: terminalFailures.map((entry) => ({ ...entry, retryable: false })), failures: terminalFailures.map((entry) => ({ ...entry, retryable: false })), unexpected: [], explicitEmpty: false, batchMeta: { moduleGroups: groupDiagnostics } };
            }
            commitGroupApply(preparedApply);
            identityLocked = true;
            captureRecoveryProgress();
        }
        const acceptedNarrative = String(attemptDiscoveryContext?.acceptedNarrative || '');
        const discoveryOrder = actorProfileDiscoverySourceOrder(
            [...discoveries.values()],
            acceptedNarrative,
        );
        const orderedDiscoveries = discoveryOrder.ordered;
        const discoveryOrderFailures = discoveryOrder.failures;
        if (discoveryOrderFailures.length) {
            return {
                entries: [], discoveries: [], identityReveals: [], unresolved: discoveryOrderFailures,
                failures: discoveryOrderFailures, unexpected: [], explicitEmpty: false,
                batchMeta: { moduleGroups: groupDiagnostics, protocol: 'module-groups-v1' },
            };
        }
        const recoveredDiscoveryByKey = new Map([...profileById.values()]
            .map(({ candidate }) => [String(candidate?.__discoveryKey || ''), candidate])
            .filter(([key]) => key));
        const discoveryCandidates = orderedDiscoveries.map(({ entry, anchor, inputIndex }, index) => {
            const discoveryKey = `${entry.name}\u0000${entry.sourceAnchor}`;
            const recovered = recoveredDiscoveryByKey.get(discoveryKey);
            if (recovered) return {
                ...recovered,
                characterCreationTicket: clone(
                    attemptDiscoveryContext?.characterCreationTickets?.[index]
                    ?? recovered.characterCreationTicket
                    ?? null,
                ),
                __discoveryKey: discoveryKey,
                __sourceOffset: anchor.offset,
                __sourceOrdinal: Number.isInteger(entry.sourceOrdinal)
                    ? entry.sourceOrdinal : inputIndex,
                __coverageUnitId: cleanText(entry.coverageUnitId, 80),
                __sourceUnitOffset: Number.isInteger(entry.sourceUnitOffset)
                    ? entry.sourceUnitOffset : anchor.sourceUnitOffset,
            };
            const completionMode = attemptDiscoveryContext?.completionMode
                || subset[0]?.completionMode || 'full';
            return {
                actorRef: { actorId: `DISC-${fingerprint(entry.name).slice(0, 16)}`, name: entry.name },
                name: entry.name,
                completionMode,
                previousProfile: {
                    narrativeSections: Object.fromEntries(Object.entries(entry.sections)
                        .map(([moduleKey, text]) => [
                            moduleKey,
                            actorProfileWorkingSection(
                                { completionMode },
                                moduleKey,
                                text,
                            ),
                        ])),
                },
                characterCreationTicket: clone(attemptDiscoveryContext?.characterCreationTickets?.[index] || null),
                __discoveryKey: discoveryKey,
                __sourceOffset: anchor.offset,
                __sourceOrdinal: Number.isInteger(entry.sourceOrdinal)
                    ? entry.sourceOrdinal : inputIndex,
                __coverageUnitId: cleanText(entry.coverageUnitId, 80),
                __sourceUnitOffset: Number.isInteger(entry.sourceUnitOffset)
                    ? entry.sourceUnitOffset : anchor.sourceUnitOffset,
            };
        });
        for (const candidate of discoveryCandidates) profileById.set(candidateActorId(candidate), { candidate, sections: clone(candidate.previousProfile.narrativeSections) });
        plan = actorProfileCompletionGroupPlan(workingCandidates(), { allowDiscovery: false })
            .filter((group) => group.key !== 'identity_bootstrap');
        const results = [];
        for (const scheduledGroup of plan) {
            let group = actorProfileCompletionGroupPlan(workingCandidates(), { allowDiscovery: false })
                .find((entry) => entry.key === scheduledGroup.key);
            if (!group) continue;
            let parsed = await callGroup(group, 0);
            if (parsed.stale || parsed.requestFailure) {
                results.push({ group, parsed, preparedApply: null });
                break;
            }
            let preparedApply = prepareGroupApply(group, parsed);
            const initialFailureDiagnostic = actorProfileGroupFailureDiagnostic(
                group,
                0,
                parsed,
                preparedApply.failures,
            );
            if (initialFailureDiagnostic) groupDiagnostics.push(initialFailureDiagnostic);
            if ((parsed.formatUnrecoverable || preparedApply.failures.length) && semanticRetry) {
                const firstFailures = clone(preparedApply.failures);
                const firstFormatFailure = parsed.formatUnrecoverable === true;
                if (!firstFormatFailure) commitGroupApply({
                    sectionUpdates: preparedApply.sectionUpdates,
                    discoveryUpdates: [],
                });
                const missingOnlyGroup = actorProfileCompletionGroupPlan(workingCandidates(), { allowDiscovery: false })
                    .find((entry) => entry.key === scheduledGroup.key);
                const retryModules = (missingOnlyGroup?.modules || [])
                    .filter((moduleKey) => (missingOnlyGroup?.targets?.[moduleKey] || []).length > 0);
                const retryGroup = missingOnlyGroup
                    ? {
                        ...missingOnlyGroup,
                        modules: retryModules,
                        targets: Object.fromEntries(retryModules.map((moduleKey) => [
                            moduleKey,
                            missingOnlyGroup.targets[moduleKey],
                        ])),
                    }
                    : group;
                parsed = await callGroup(retryGroup, 1, retryFeedbackFor(preparedApply, parsed, group));
                group = retryGroup;
                if (!parsed.stale && !parsed.requestFailure) {
                    preparedApply = prepareGroupApply(retryGroup, parsed);
                    const retryFailureDiagnostic = actorProfileGroupFailureDiagnostic(
                        retryGroup,
                        1,
                        parsed,
                        preparedApply.failures,
                    );
                    if (retryFailureDiagnostic) groupDiagnostics.push(retryFailureDiagnostic);
                    if (parsed.formatUnrecoverable || preparedApply.failures.length) {
                        preparedApply.failures = [
                            ...firstFailures,
                            ...preparedApply.failures,
                            ...(parsed.formatUnrecoverable && !preparedApply.failures.length
                                ? [{ actorId: '', reason: 'actor_profile.format_unrecoverable', groupKey: retryGroup.key }]
                                : []),
                        ];
                    }
                }
            }
            results.push({ group, parsed, preparedApply });
            if (parsed.stale || parsed.requestFailure || parsed.formatUnrecoverable || preparedApply?.failures.length) break;
            commitGroupApply(preparedApply);
            captureRecoveryProgress();
        }
        const terminal = results.find(({ parsed, preparedApply }) => parsed.stale || parsed.requestFailure || parsed.formatUnrecoverable || preparedApply?.failures.length);
        if (terminal?.parsed?.stale) return { stale: true };
        if (terminal?.parsed?.requestFailure) return {
            requestFailure: terminal.parsed.requestFailure,
            recoveryProgress: captureRecoveryProgress(),
        };
        const failures = results.flatMap(({ preparedApply }) => preparedApply?.failures || []).map((entry) => ({ ...entry, retryable: false }));
        if (terminal) {
            return {
                entries: [],
                discoveries: [],
                identityReveals: [],
                unresolved: failures.filter((entry) => !entry.actorId),
                failures: failures.filter((entry) => entry.actorId),
                unexpected: [],
                explicitEmpty: false,
                batchMeta: { moduleGroups: groupDiagnostics, protocol: 'module-groups-v1' },
            };
        }
        const entries = [];
        const discoveryRows = [];
        for (const { candidate, sections } of profileById.values()) {
            const profileCandidate = {
                profileFormat: 'narrative-v1',
                actorRef: clone(candidate.actorRef),
                narrativeSections: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, { text: value?.text ?? value }])),
                sources: {},
            };
            const validation = validateActorProfileInsertCandidate(profileCandidate, candidate);
            if (!validation.ok) {
                failures.push(failureFor(candidate, validation.errorCode, { missingFields: validation.missingFields, retryable: false }));
            } else if (candidate.__discoveryKey) {
                const [name, sourceAnchor] = candidate.__discoveryKey.split('\u0000');
                discoveryRows.push({
                    candidateRef: {
                        name,
                        sourceAnchor,
                        sourceOffset: candidate.__sourceOffset,
                        sourceOrdinal: candidate.__sourceOrdinal,
                        coverageUnitId: candidate.__coverageUnitId,
                        sourceUnitOffset: candidate.__sourceUnitOffset,
                    },
                    candidate: validation.candidate,
                    repairs: [],
                    resolutions: [],
                });
            } else entries.push({ actorId: candidateActorId(candidate), name: candidateName(candidate), candidate: validation.candidate, repairs: [], resolutions: [] });
        }
        return { entries, discoveries: discoveryRows, identityReveals: [...identityReveals.values()].map(clone), unresolved: failures.filter((entry) => !entry.actorId), failures: failures.filter((entry) => entry.actorId), unexpected: [], explicitEmpty: false, batchMeta: { moduleGroups: groupDiagnostics, protocol: 'module-groups-v1' } };
    };

    let batchMeta = null;
    let batchFormatReplacementAttempted = false;
    const withBatchMeta = (result) => ({
        ...result,
        batchMeta: clone(batchMeta),
        batchFormatReplacementAttempted,
        recoveryProgress: clone(latestRecoveryProgress),
        timings: {
            totalMs: Math.max(0, Date.now() - startedAt),
            modelMs: Math.max(0, modelMs),
            parseMs: Math.max(0, parseMs),
            persistMs: Math.max(0, persistMs),
        },
    });
    try {
    let first = await collect(selected, [], 0);
    if (first?.recoveryProgress) latestRecoveryProgress = normalizeActorProfileRecoveryProgress(
        first.recoveryProgress,
    );
    base.recoveryProgress = clone(latestRecoveryProgress);
    if (first.requestFailure) {
        return withBatchMeta({
            ...base,
            modelCalls,
            failures: [
                ...inputFailures,
                ...(selected.length ? selected.map((candidate) => failureFor(
                    candidate,
                    `actor_profile.${first.requestFailure.category}`,
                    { routeDiagnostic: first.requestFailure.routeDiagnostic },
                )) : [{
                    reason: `actor_profile.${first.requestFailure.category}`,
                    routeDiagnostic: first.requestFailure.routeDiagnostic,
                }]),
            ],
        });
    }
    if (first.stale) {
        return withBatchMeta({
            ...base,
            modelCalls,
            failures: [
                ...inputFailures,
                ...(selected.length ? selected.map((candidate) => failureFor(
                    candidate,
                    'actor_profile.target_stale',
                )) : [{ reason: 'actor_profile.target_stale' }]),
            ],
        });
    }
    batchMeta = clone(first.batchMeta || null);
    base.batchMeta = clone(batchMeta);
    const needsDiscoveryFormatReplacement = allowDiscovery === true
        && selected.length === 0
        && batchMeta?.emptyOutput !== true
        && batchMeta?.explicitEmpty !== true
        && batchMeta?.formatUnrecoverable === true;
    if (needsDiscoveryFormatReplacement) {
        batchFormatReplacementAttempted = true;
        base.batchFormatReplacementAttempted = true;
        const replacement = await collect([], [], 1, [], true);
        if (replacement.requestFailure) {
            return withBatchMeta({
                ...base,
                modelCalls,
                failures: [{
                    reason: `actor_profile.${replacement.requestFailure.category}`,
                    routeDiagnostic: replacement.requestFailure.routeDiagnostic,
                }],
            });
        }
        if (replacement.stale) {
            return withBatchMeta({
                ...base,
                modelCalls,
                failures: [{ reason: 'actor_profile.target_stale' }],
            });
        }
        batchMeta = clone(replacement.batchMeta || null);
        base.batchMeta = clone(batchMeta);
        if (
            batchMeta?.formatUnrecoverable === true
            || batchMeta?.parsedRowCount === 0
        ) {
            return withBatchMeta({
                ...base,
                modelCalls,
                failures: [{ reason: 'actor_profile.format_unrecoverable' }],
            });
        }
        first = replacement;
    }
    for (const entry of first.entries || []) acceptedById.set(entry.actorId, entry);
    for (const failure of first.failures || []) failureById.set(failure.actorId, failure);
    rejected.push(...(first.unexpected || []));
    let discoveries = [...(first.discoveries || [])];
    const identityReveals = [...(first.identityReveals || [])];
    let unresolved = [...(first.unresolved || [])];
    const explicitEmpty = first.explicitEmpty === true;
    const coverageProof = clone(first.coverageProof || null);
    const retryCandidates = semanticRetry && !batchFormatReplacementAttempted
        ? selected.filter((candidate) => (
            failureById.get(candidateActorId(candidate))?.retryable
        ))
        : [];
    const retryDiscoveryTargets = semanticRetry && !batchFormatReplacementAttempted
        ? unresolved
            .filter((entry) => (
                entry.retryable === true
                && entry.candidateRef?.name
                && entry.candidateRef?.sourceAnchor
            ))
            .map((entry) => clone(entry.candidateRef))
        : [];
    if (retryCandidates.length || retryDiscoveryTargets.length) {
        const feedback = retryCandidates.map((candidate) => {
            const failure = failureById.get(candidateActorId(candidate));
            const detail = failure?.missingFields?.length
                ? failure.missingFields.join(',')
                : failure?.reason || 'actor_profile.missing_candidate';
            return `${candidateActorId(candidate)}:${detail}`;
        });
        feedback.push(...unresolved.map((entry) => (
            `${entry.candidateRef?.name || 'candidateRef'}:${entry.reason}`
        )));
        const retry = await collect(
            retryCandidates,
            feedback,
            1,
            retryDiscoveryTargets,
        );
        if (retry?.recoveryProgress) {
            latestRecoveryProgress = normalizeActorProfileRecoveryProgress(
                retry.recoveryProgress,
            );
            base.recoveryProgress = clone(latestRecoveryProgress);
        }
        if (retry.stale) {
            for (const candidate of retryCandidates) {
                failureById.set(candidateActorId(candidate), failureFor(
                    candidate,
                    'actor_profile.target_stale',
                ));
            }
            unresolved = unresolved.map((entry) => ({
                ...entry,
                reason: 'actor_profile.target_stale',
                retryable: false,
            }));
        } else if (retry.requestFailure) {
            for (const candidate of retryCandidates) {
                failureById.set(candidateActorId(candidate), failureFor(
                    candidate,
                    `actor_profile.${retry.requestFailure.category}`,
                    { routeDiagnostic: retry.requestFailure.routeDiagnostic },
                ));
            }
            unresolved = unresolved.map((entry) => ({
                ...entry,
                reason: `actor_profile.${retry.requestFailure.category}`,
                routeDiagnostic: retry.requestFailure.routeDiagnostic,
                retryable: false,
            }));
        } else {
            for (const entry of retry.entries || []) {
                acceptedById.set(entry.actorId, entry);
                failureById.delete(entry.actorId);
            }
            for (const failure of retry.failures || []) {
                failureById.set(failure.actorId, failure);
            }
            rejected.push(...(retry.unexpected || []));
            const retriedKeys = new Set(retryDiscoveryTargets.map((entry) => (
                `${entry.name}\u0000${entry.sourceAnchor}`
            )));
            const retryByKey = new Map();
            for (const entry of retry.discoveries || []) {
                const key = `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}`;
                if (retriedKeys.has(key)) retryByKey.set(key, entry);
                else rejected.push({
                    candidateRef: clone(entry.candidateRef),
                    reason: 'actor_profile.discovery_retry_unexpected',
                });
            }
            discoveries = discoveries.filter((entry) => !retriedKeys.has(
                `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}`,
            ));
            discoveries.push(...retryByKey.values());
            const untouchedUnresolved = unresolved.filter((entry) => !retriedKeys.has(
                `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}`,
            ));
            const retryUnresolved = [...(retry.unresolved || [])];
            for (const targetRef of retryDiscoveryTargets) {
                const key = `${targetRef.name}\u0000${targetRef.sourceAnchor}`;
                if (
                    retryByKey.has(key)
                    || retryUnresolved.some((entry) => (
                        `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}` === key
                    ))
                ) continue;
                retryUnresolved.push({
                    candidateRef: clone(targetRef),
                    reason: 'actor_profile.discovery_retry_missing',
                    missingFields: [],
                    retryable: false,
                });
            }
            unresolved = [...untouchedUnresolved, ...retryUnresolved];
        }
    }

    if (!await current()) {
        return withBatchMeta({
            ...base,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.target_stale',
            ))],
        });
    }

    let resolved;
    try {
        resolved = await resolveDiscoveries({
            discoveries: clone(discoveries),
            identityReveals: clone(identityReveals),
            unresolved: clone(unresolved),
            unexpected: clone(rejected),
            explicitEmpty,
        });
    } catch (error) {
        resolved = {
            ok: false,
            ledger: originalLedger,
            reason: cleanText(error?.message || error, 240) || 'actor_profile.discovery_failed',
        };
    }
    const resolvedLedger = normalizeActorLedger(
        resolved?.ledger || originalLedger,
        { chatId: originalLedger.chatId },
    );
    rejected.push(...(resolved?.rejected || []));
    const discoveryFailures = [
        ...unresolved,
        ...(resolved?.failures || []),
    ];
    if (resolved?.ok !== true) {
        return withBatchMeta({
            ...base,
            ledger: originalLedger,
            modelCalls,
            rejected,
            failures: [
                ...inputFailures,
                ...selected
                    .map((candidate) => failureById.get(candidateActorId(candidate)))
                    .filter(Boolean),
                ...discoveryFailures,
                { reason: resolved?.reason || 'actor_profile.discovery_failed' },
            ],
            explicitEmpty,
            registry: clone(resolved?.registry || null),
        });
    }

    const resolvedCandidates = Array.isArray(resolved.candidates)
        ? resolved.candidates
        : [];
    const resolvedPromotionEntries = Array.isArray(resolved.entries) ? resolved.entries : [];
    const promotedDiscoveryNames = new Set(resolvedPromotionEntries.map((entry) => (
        cleanText(entry?.candidate?.candidateRef?.name, 160)
        || cleanText(entry?.candidateRef?.name, 160)
        || cleanText(entry?.candidate?.actorRef?.name, 160)
        || cleanText(entry?.actorRef?.name, 160)
    )).filter(Boolean));
    for (const discovery of discoveries) {
        const discoveryName = cleanText(discovery?.candidateRef?.name, 160);
        const explicitlyAccounted = [...(resolved?.rejected || []), ...(resolved?.failures || [])]
            .some((entry) => cleanText(entry?.candidateRef?.name || entry?.name, 160) === discoveryName);
        if (discoveryName && !promotedDiscoveryNames.has(discoveryName) && !explicitlyAccounted) {
            discoveryFailures.push({
                candidateRef: clone(discovery.candidateRef),
                reason: 'actor_profile.discovery_promotion_mapping_missing',
            });
        }
    }
    // Profile modules were completed under the transaction-local DISC id.
    // Registry resolution owns the final ActorId, so close that identity
    // transition explicitly by row key before validating the final row.
    const promotionClosures = actorProfileResolverPromotionClosure({
        discoveries,
        resolvedPromotionEntries,
        resolvedCandidates,
    });
    for (const closure of promotionClosures) {
        const {
            actorId, candidateId, context, profileCandidate, repairs,
        } = closure;
        if (!actorId || !context || !profileCandidate) {
            discoveryFailures.push({
                candidateId,
                reason: 'actor_profile.discovery_promotion_mapping_missing',
            });
            continue;
        }
        profileCandidate.actorRef = clone(context.actorRef);
        delete profileCandidate.candidateRef;
        const validation = validateActorProfileInsertCandidate(profileCandidate, context);
        if (!validation.ok) {
            discoveryFailures.push({
                actorId,
                name: candidateName(context),
                reason: validation.errorCode || 'actor_profile.schema_incomplete',
                missingFields: validation.missingFields || [],
            });
            continue;
        }
        acceptedById.set(actorId, {
            actorId,
            name: candidateName(context),
            candidate: validation.candidate,
            repairs,
            resolutions: validation.resolutions || [],
        });
    }

    // Resolution owns the transaction-local row identity.  In particular, an
    // explicit reveal keeps the ActorId but replaces the old display label and
    // refresh plan; retaining the pre-resolution row here would immediately
    // turn the valid reveal into a false target_stale failure.
    const candidateClosure = actorProfileFinalCandidateClosure({
        selected,
        resolvedCandidates,
        resolvedPromotionEntries,
        identityReveals,
        acceptedById,
        failureById,
        discoveryFailures,
    });
    discoveryFailures.push(...candidateClosure.resolutionFailures);
    const { allCandidates } = candidateClosure;
    if (!allCandidates.length) {
        return withBatchMeta({
            ...base,
            ledger: originalLedger,
            candidates: [],
            modelCalls,
            rejected,
            failures: [...inputFailures, ...discoveryFailures],
            persistenceStatus: explicitEmpty
                && !rejected.length
                && !discoveryFailures.length
                && coverageProof
                ? 'no_candidates'
                : 'not_completed',
            explicitEmpty,
            coverageProof,
            registry: clone(resolved.registry || null),
        });
    }

    // This is one database-style group insert: discovery rows, existing rows
    // and their complete profiles either enter the pending transaction as a
    // whole or remain entirely in the S0 snapshot.  In particular, do not
    // turn a successfully parsed peer into a durable Registry/profile while a
    // sibling is unresolved, rejected, malformed, or identity-quarantined.
    const groupFailuresBeforePersist = [
        ...inputFailures,
        ...discoveryFailures,
        ...rejected,
        ...allCandidates
            .map((candidate) => failureById.get(candidateActorId(candidate)))
            .filter(Boolean),
        ...candidateClosure.groupRowFailures,
    ];
    if (groupFailuresBeforePersist.length) {
        return withBatchMeta({
            ...base,
            ledger: originalLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: groupFailuresBeforePersist,
            explicitEmpty,
            registry: clone(resolved.registry || null),
        });
    }

    let workingLedger = clone(resolvedLedger);
    const prepared = [];
    for (const candidate of allCandidates) {
        const actorId = candidateActorId(candidate);
        const completion = acceptedById.get(actorId);
        if (!completion) continue;
        const actor = workingLedger.actors.find((entry) => entry.id === actorId);
        if (!actor || actor.name !== candidateName(candidate)) {
            failureById.set(actorId, failureFor(candidate, 'actor_profile.target_stale'));
            acceptedById.delete(actorId);
            continue;
        }
        const baseline = materializeActorProfileBaseline(
            actor.profileV6,
            completion.candidate,
            { turn, completionMode: candidate.completionMode },
        );
        const digest = actorProfileBaselineDigest(baseline);
        const commitId = `PBI-${fingerprint(JSON.stringify([
            target.chatId,
            target.messageId,
            target.swipeId,
            target.generationId,
            actorId,
            digest,
        ])).slice(0, 24)}`;
        const expectedCommit = {
            actorRef: { actorId, name: candidateName(candidate) },
            schemaVersion: baseline.version,
            commitId,
            digest,
            profileDigest: digest,
            sourceRef: clone(target.sourceRef || null),
            scopeDigest: cleanText(target.sourceRef?.scopeDigest, 180),
            locks: clone(actor.profileV6?.locks || {}),
            manualOverrides: clone(actor.profileV6?.manualOverrides || {}),
        };
        const replaced = replaceActorProfileBaselineInLedger(
            workingLedger,
            expectedCommit.actorRef,
            baseline,
            {
                ...expectedCommit,
                sourceRef: clone(target.sourceRef || null),
                committedTurn: turn,
                readbackVerified: false,
                phase: 'pending',
            },
        );
        if (!replaced.committed) {
            failureById.set(actorId, failureFor(
                candidate,
                replaced.reason || 'actor_profile.commit_rejected',
            ));
            acceptedById.delete(actorId);
            continue;
        }
        workingLedger = replaced.ledger;
        prepared.push({
            actorId,
            name: candidateName(candidate),
            commitId,
            digest,
            expectedCommit: { ...expectedCommit, profileDigest: digest, phase: 'pending' },
            repairs: completion.repairs || [],
            resolutions: completion.resolutions || [],
        });
    }
    if (prepared.length !== allCandidates.length) {
        return withBatchMeta({
            ...base,
            ledger: originalLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        });
    }
    if (!await current()) {
        return withBatchMeta({
            ...base,
            ledger: originalLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates.map((candidate) => failureFor(
                candidate,
                'actor_profile.target_stale',
            ))],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        });
    }

    const preparedFieldRevision = Math.max(
        0,
        Number(resolved?.snapshot?.fieldRevision) || 0,
    );
    const expectedCommits = prepared.map((entry) => clone(entry.expectedCommit));
    const transactionId = actorProfileTransactionId({
        chatId: target.chatId,
        sourceRef: target.sourceRef,
        preparedFieldRevision,
        expectedCommits,
    });
    const sealed = sealActorProfilePendingTransactionInLedger(workingLedger, expectedCommits, {
        transactionId,
        preparedFieldRevision,
    });
    if (!sealed.sealed) {
        for (const entry of prepared) {
            failureById.set(entry.actorId, failureFor(entry, sealed.reason || 'actor_profile.pending_transaction_mismatch'));
        }
        return withBatchMeta({
            ...base,
            ledger: originalLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        });
    }
    workingLedger = sealed.ledger;
    const { preparedLedgerDigest, writeSetDigest } = sealed;
    let pendingPersisted;
    const pendingPersistStartedAt = Date.now();
    try {
        pendingPersisted = await persistPendingBatch({
            ledger: workingLedger,
            persistenceBaseLedger: clone(resolved.persistenceBaseLedger || null),
            expectedCommits,
            expectedState: clone(resolved.snapshot || null),
            preparedLedgerDigest,
            preparedFieldRevision,
            transactionId,
            writeSetDigest,
        });
    } catch (error) {
        pendingPersisted = {
            ok: false,
            reason: cleanText(error?.message || error, 200) || 'host_save_rejected',
        };
    } finally {
        persistMs += Date.now() - pendingPersistStartedAt;
    }
    const pendingLedger = pendingPersisted?.ok === true
        ? normalizeActorLedger(pendingPersisted.ledger, { chatId: originalLedger.chatId })
        : null;
    const pendingReadbackOk = pendingLedger
        && expectedCommits.every((expected) => actorProfileCommitMatchesLedger(
            pendingLedger,
            {
                ...expected,
                transactionId,
                writeSetDigest,
                preparedLedgerDigest,
                preparedFieldRevision,
                phase: 'pending',
            },
        ).ok)
        && actorProfilePendingWriteSetDigest(pendingLedger, expectedCommits, {
            preparedFieldRevision,
            transactionId,
            writeSetDigest,
        }) === preparedLedgerDigest;
    if (!pendingPersisted?.ok || !pendingReadbackOk) {
        const reason = persistenceFailureReason(
            pendingPersisted?.reason || 'host_save_readback_mismatch',
        );
        for (const entry of prepared) {
            failureById.set(entry.actorId, failureFor(entry, reason));
        }
        return withBatchMeta({
            ...base,
            ledger: originalLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        });
    }

    const finalized = finalizeActorProfileBaselinesInLedger(
        pendingLedger,
        expectedCommits,
        { preparedLedgerDigest, preparedFieldRevision, transactionId, writeSetDigest },
    );
    if (!finalized.finalized) {
        return withBatchMeta({
            ...base,
            ledger: pendingLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [
                ...inputFailures,
                ...discoveryFailures,
                ...prepared.map((entry) => failureFor(
                    entry,
                    finalized.reason || 'actor_profile.finalize_rejected',
                )),
            ],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        });
    }

    let finalPersisted;
    const finalPersistStartedAt = Date.now();
    try {
        finalPersisted = await persistFinalizedBatch({
            ledger: finalized.ledger,
            readShadowLedger: pendingLedger,
            expectedCommits: expectedCommits.map((expected) => ({
                ...expected,
                phase: 'final',
            })),
            expectedState: clone(pendingPersisted.snapshot || null),
            preparedLedgerDigest,
            preparedFieldRevision,
            transactionId,
            writeSetDigest,
        });
    } catch (error) {
        finalPersisted = {
            ok: false,
            reason: cleanText(error?.message || error, 200) || 'host_save_rejected',
        };
    } finally {
        persistMs += Date.now() - finalPersistStartedAt;
    }
    const persistedLedger = finalPersisted?.ok === true
        ? normalizeActorLedger(finalPersisted.ledger, { chatId: originalLedger.chatId })
        : null;
    const finalReadbackOk = persistedLedger && expectedCommits.every((expected) => (
        actorProfileCommitMatchesLedger(
            persistedLedger,
            {
                ...expected,
                transactionId,
                writeSetDigest,
                preparedLedgerDigest,
                preparedFieldRevision,
                phase: 'final',
            },
        ).ok
    ));
    if (!finalPersisted?.ok || !finalReadbackOk) {
        const reason = persistenceFailureReason(
            finalPersisted?.reason || 'host_save_readback_mismatch',
        );
        for (const entry of prepared) {
            failureById.set(entry.actorId, failureFor(entry, reason));
        }
        return withBatchMeta({
            ...base,
            ledger: pendingLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        });
    }
    return {
        ledger: persistedLedger,
        candidates: allCandidates,
        accepted: prepared.map(({ expectedCommit: _expectedCommit, ...entry }) => entry),
        rejected,
        failures: [...inputFailures, ...allCandidates
            .map((candidate) => failureById.get(candidateActorId(candidate)))
            .filter(Boolean), ...discoveryFailures],
        persistenceMeta: clone(finalPersisted.persistenceMeta || null),
        modelCalls,
        persistenceStatus: 'atomic_readback',
        readbackVerified: true,
        explicitEmpty,
        registry: clone(resolved.registry || null),
        batchMeta: clone(batchMeta),
        batchFormatReplacementAttempted,
        recoveryProgress: null,
        timings: {
            totalMs: Math.max(0, Date.now() - startedAt),
            modelMs: Math.max(0, modelMs),
            parseMs: Math.max(0, parseMs),
            persistMs: Math.max(0, persistMs),
        },
    };
    } finally {
        // No proof cache or cross-request identity state is retained.  Every
        // retry rechecks the accepted narrative inside this same transaction.
    }
}
