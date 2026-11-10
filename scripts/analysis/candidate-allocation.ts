import { createHmac } from 'node:crypto';

export const CANDIDATE_KINDS = ['sensitive', 'injection', 'skills', 'drift'] as const;
export type CandidateKind = typeof CANDIDATE_KINDS[number];
export type CandidateVisibility = 'shared' | 'holdout' | 'unclassified';
/** All identifiers/strata are opaque analysis tokens, never source text or sensitive values. */
export interface CandidateNode {
  id: string; kind: CandidateKind; groupId: string; stratum: string;
  /** Aliases participate in the graph but never inflate the current four-library row budget. */
  weight?: 0 | 1;
  /** Independent coarse margin; fine strata alone can distort major-class proportions through rounding. */
  balanceClass?: string;
  /** Higher ranks are preferred within a stratum. These are candidates, not approval evidence. */
  qualityRank?: number; regressionRank?: number;
  eligibleGold?: boolean; eligibleRegression?: boolean;
}
export interface CandidateGroupConstraint {
  groupId: string; forcedShared?: boolean; blocked?: boolean; reasonCodes?: string[];
}
export interface CandidateAllocationInput {
  nodes: CandidateNode[]; groups?: CandidateGroupConstraint[]; seed: string | Uint8Array;
  holdoutFraction?: number;
}
export interface CandidateStratumCounts { total: number; shared: number; holdout: number; unclassified: number }
export interface CandidateKindCounts extends CandidateStratumCounts {
  targetHoldoutRows: number; roundedTargetHoldoutRows: number;
  actualHoldoutFraction: number | null; deviationPercentagePoints: number | null;
  eligibleHoldoutRows: number; eligibleHoldoutGroups: number; largestEligibleGroup: number;
  forcedSharedRows: number; blockedRows: number;
  /** Necessary per-library check only: it does not prove joint feasibility across libraries. */
  targetRowsAttainableIgnoringCrossKindConstraints: boolean;
  nearestAttainableRowsIgnoringCrossKindConstraints: number[];
  missingHoldoutStrata: string[]; explanations: string[];
  strata: Record<string, CandidateStratumCounts>;
  classes: Record<string, CandidateStratumCounts & { targetHoldoutRows: number }>;
}
export interface AllocatedCandidateGroup {
  groupId: string; visibility: CandidateVisibility; memberIds: string[]; countedRows: number;
  forcedShared: boolean; blocked: boolean; reasonCodes: string[];
}
export interface CandidateAllocation {
  visibilityById: Record<string, CandidateVisibility>;
  groups: AllocatedCandidateGroup[];
  counts: Record<CandidateKind, CandidateKindCounts>;
  totals: CandidateStratumCounts & { aliasNodes: number; groupCount: number };
  optimisation: { method: 'deterministic-greedy-local-search'; globallyOptimal: false; score: number; flips: number; stoppedAtIterationLimit: boolean };
}

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const zero = (): CandidateStratumCounts => ({ total: 0, shared: 0, holdout: 0, unclassified: 0 });
const weight = (node: CandidateNode) => node.weight ?? 1;
const balanceClass = (node: CandidateNode) => node.balanceClass ?? '__all__';
const token = (seed: string | Uint8Array, scope: string, id: string) => createHmac('sha256', seed).update(JSON.stringify([scope, id])).digest('hex');
function fraction(value: number | undefined, fallback: number) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1) throw new Error('Candidate fraction must be between zero and one.');
  return result;
}
function validate(nodes: CandidateNode[], seed: string | Uint8Array) {
  if (!(typeof seed === 'string' ? seed.length : seed.byteLength)) throw new Error('A nonempty local deterministic seed is required.');
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.id || !node.groupId || !node.stratum || !CANDIDATE_KINDS.includes(node.kind) || ids.has(node.id) || node.balanceClass !== undefined && (typeof node.balanceClass !== 'string' || !node.balanceClass) || node.weight !== undefined && node.weight !== 0 && node.weight !== 1 || node.qualityRank !== undefined && !Number.isFinite(node.qualityRank) || node.regressionRank !== undefined && !Number.isFinite(node.regressionRank)) throw new Error('Invalid or duplicate opaque candidate node.');
    ids.add(node.id);
  }
}
interface Group {
  id: string; nodes: CandidateNode[]; forcedShared: boolean; blocked: boolean; reasons: string[];
  vector: Map<string, number>; kindRows: Map<CandidateKind, number>; visibility: CandidateVisibility; tie: string;
}
interface Dimension { target: number; denominator: number; importance: number }
const totalDimension = (kind: CandidateKind) => JSON.stringify([kind]);
const stratumDimension = (node: CandidateNode) => JSON.stringify([node.kind, node.stratum]);
const classDimension = (node: CandidateNode) => JSON.stringify([node.kind, 'balance-class', balanceClass(node)]);

/** Group boundaries and constraints are hard; row/category budgets are soft and never split a group. */
export function allocateCandidateVisibility(input: CandidateAllocationInput): CandidateAllocation {
  validate(input.nodes, input.seed);
  const desired = fraction(input.holdoutFraction, .2), constraints = new Map<string, CandidateGroupConstraint>();
  for (const item of input.groups ?? []) {
    if (!item.groupId || constraints.has(item.groupId)) throw new Error('Invalid or duplicate candidate group constraint.');
    constraints.set(item.groupId, item);
  }
  const groupsById = new Map<string, Group>(), totalsByKind = new Map<CandidateKind, number>(), stratumTotals = new Map<string, number>(), classTotals = new Map<string, number>();
  for (const node of [...input.nodes].sort((a, b) => cmp(a.id, b.id))) {
    let group = groupsById.get(node.groupId);
    if (!group) {
      const rule = constraints.get(node.groupId);
      group = { id: node.groupId, nodes: [], forcedShared: !!rule?.forcedShared, blocked: !!rule?.blocked, reasons: [...new Set(rule?.reasonCodes ?? [])].sort(cmp), vector: new Map(), kindRows: new Map(), visibility: rule?.blocked ? 'unclassified' : 'shared', tie: token(input.seed, 'holdout-group', node.groupId) };
      if (group.blocked && group.forcedShared) group.reasons.push('BLOCKED_OVERRIDES_FORCED_SHARED');
      groupsById.set(node.groupId, group);
    }
    group.nodes.push(node);
    if (!weight(node)) continue;
    for (const dimension of [totalDimension(node.kind), stratumDimension(node), classDimension(node)]) group.vector.set(dimension, (group.vector.get(dimension) ?? 0) + 1);
    group.kindRows.set(node.kind, (group.kindRows.get(node.kind) ?? 0) + 1);
    totalsByKind.set(node.kind, (totalsByKind.get(node.kind) ?? 0) + 1);
    const dimension = stratumDimension(node); stratumTotals.set(dimension, (stratumTotals.get(dimension) ?? 0) + 1);
    const coarse = classDimension(node); classTotals.set(coarse, (classTotals.get(coarse) ?? 0) + 1);
  }
  for (const groupId of constraints.keys()) if (!groupsById.has(groupId)) throw new Error('A candidate constraint refers to a missing group.');
  const groups = [...groupsById.values()].sort((a, b) => cmp(a.tie, b.tie) || cmp(a.id, b.id)), dimensions = new Map<string, Dimension>();
  for (const kind of CANDIDATE_KINDS) {
    const count = totalsByKind.get(kind) ?? 0;
    if (count) dimensions.set(totalDimension(kind), { target: count * desired, denominator: Math.max(1, count * desired), importance: 1 });
  }
  for (const [id, count] of [...stratumTotals].sort(([a], [b]) => cmp(a, b))) {
    const [kind] = JSON.parse(id) as [CandidateKind, string];
    dimensions.set(id, { target: count * desired, denominator: Math.max(1, count * desired), importance: .25 * count / totalsByKind.get(kind)! });
  }
  for (const [id, count] of [...classTotals].sort(([a], [b]) => cmp(a, b))) {
    const [kind] = JSON.parse(id) as [CandidateKind, string, string];
    dimensions.set(id, { target: count * desired, denominator: Math.max(1, count * desired), importance: 4 * count / totalsByKind.get(kind)! });
  }
  const actual = new Map<string, number>(), eligible = groups.filter(group => !group.blocked && !group.forcedShared && group.vector.size > 0);
  const dimensionScore = (value: number, dimension: Dimension) => dimension.importance * ((value - dimension.target) / dimension.denominator) ** 2;
  let score = [...dimensions.values()].reduce((sum, item) => sum + dimensionScore(0, item), 0), flips = 0;
  // Strict score improvement precludes oscillation. The finite cap is reported, never hidden as optimality.
  const iterationLimit = Math.max(1, Math.min(20_000, eligible.length * 4));
  for (; flips < iterationLimit; flips++) {
    let best: Group | undefined, bestDelta = -1e-12;
    for (const group of eligible) {
      const sign = group.visibility === 'holdout' ? -1 : 1;
      let delta = 0;
      for (const [id, count] of group.vector) {
        const dimension = dimensions.get(id)!, current = actual.get(id) ?? 0;
        delta += dimensionScore(current + sign * count, dimension) - dimensionScore(current, dimension);
      }
      if (delta < bestDelta - 1e-12) { best = group; bestDelta = delta; }
    }
    if (!best) break;
    const sign = best.visibility === 'holdout' ? -1 : 1;
    for (const [id, count] of best.vector) actual.set(id, (actual.get(id) ?? 0) + sign * count);
    best.visibility = sign === 1 ? 'holdout' : 'shared'; score += bestDelta;
  }
  const visibilityById = dictionary<CandidateVisibility>(), counts = dictionary<CandidateKindCounts>() as Record<CandidateKind, CandidateKindCounts>, totals = { ...zero(), aliasNodes: 0, groupCount: groups.length };
  for (const kind of CANDIDATE_KINDS) {
    const total = totalsByKind.get(kind) ?? 0, target = total * desired;
    counts[kind] = { ...zero(), total, targetHoldoutRows: target, roundedTargetHoldoutRows: Math.round(target), actualHoldoutFraction: total ? 0 : null, deviationPercentagePoints: total ? -desired * 100 : null, eligibleHoldoutRows: 0, eligibleHoldoutGroups: 0, largestEligibleGroup: 0, forcedSharedRows: 0, blockedRows: 0, targetRowsAttainableIgnoringCrossKindConstraints: false, nearestAttainableRowsIgnoringCrossKindConstraints: [], missingHoldoutStrata: [], explanations: [], strata: dictionary<CandidateStratumCounts>(), classes: dictionary<CandidateStratumCounts & { targetHoldoutRows: number }>() };
  }
  for (const group of groups) for (const node of group.nodes) {
    visibilityById[node.id] = group.visibility;
    if (!weight(node)) { totals.aliasNodes++; continue; }
    const report = counts[node.kind], stratum = report.strata[node.stratum] ?? (report.strata[node.stratum] = zero());
    report[group.visibility]++; stratum.total++; stratum[group.visibility]++; totals.total++; totals[group.visibility]++;
    const coarse = report.classes[balanceClass(node)] ?? (report.classes[balanceClass(node)] = { ...zero(), targetHoldoutRows: 0 });
    coarse.total++; coarse.targetHoldoutRows += desired; coarse[group.visibility]++;
    if (group.blocked) report.blockedRows++; else if (group.forcedShared) report.forcedSharedRows++;
  }
  for (const kind of CANDIDATE_KINDS) {
    const report = counts[kind], kindGroups = eligible.filter(group => group.kindRows.has(kind));
    for (const item of Object.values(report.classes)) item.targetHoldoutRows = item.total * desired;
    report.eligibleHoldoutGroups = kindGroups.length;
    report.eligibleHoldoutRows = kindGroups.reduce((sum, group) => sum + group.kindRows.get(kind)!, 0);
    report.largestEligibleGroup = kindGroups.reduce((largest, group) => Math.max(largest, group.kindRows.get(kind)!), 0);
    report.actualHoldoutFraction = report.total ? report.holdout / report.total : null;
    report.deviationPercentagePoints = report.total ? (report.holdout / report.total - desired) * 100 : null;
    // Bitset subset-sum detects impossible row counts without assuming groups have equal size.
    let reachable = 1n;
    for (const group of kindGroups) reachable |= reachable << BigInt(group.kindRows.get(kind)!);
    const target = report.roundedTargetHoldoutRows, attainable = (value: number) => value >= 0 && value <= report.eligibleHoldoutRows && !!(reachable >> BigInt(value) & 1n);
    report.targetRowsAttainableIgnoringCrossKindConstraints = attainable(target);
    for (let distance = 0; distance <= Math.max(target, report.eligibleHoldoutRows - target); distance++) {
      const near = [...new Set([target - distance, target + distance])].filter(attainable);
      if (near.length) { report.nearestAttainableRowsIgnoringCrossKindConstraints = near; break; }
    }
    report.missingHoldoutStrata = desired > 0 ? Object.keys(report.strata).filter(id => !report.strata[id]!.holdout).sort(cmp) : [];
    if (!report.total) report.explanations.push('NO_COUNTED_ROWS');
    if (report.blockedRows) report.explanations.push('BLOCKED_GROUPS_REMAIN_UNCLASSIFIED');
    if (report.forcedSharedRows) report.explanations.push('FORCED_SHARED_GROUPS_EXCLUDED_FROM_HOLDOUT');
    if (!kindGroups.length && report.total && desired > 0) report.explanations.push('NO_ELIGIBLE_HOLDOUT_GROUPS');
    if (!report.targetRowsAttainableIgnoringCrossKindConstraints) report.explanations.push('ROW_TARGET_UNREACHABLE_WITH_WHOLE_GROUPS');
    if (kindGroups.some(group => group.kindRows.size > 1)) report.explanations.push('CROSS_LIBRARY_GROUPS_COUPLE_TARGETS');
    if (report.holdout !== report.roundedTargetHoldoutRows) report.explanations.push('ACTUAL_COUNT_DIFFERS_FROM_ROUNDED_TARGET');
    if (report.missingHoldoutStrata.length) report.explanations.push('SOME_STRATA_HAVE_NO_HOLDOUT_CANDIDATE');
    if (desired > 0 && Object.values(report.classes).some(item => !item.holdout)) report.explanations.push('SOME_CLASSES_HAVE_NO_HOLDOUT_CANDIDATE');
    if (flips === iterationLimit) report.explanations.push('LOCAL_SEARCH_ITERATION_LIMIT');
  }
  return { visibilityById, groups: groups.map(group => ({ groupId: group.id, visibility: group.visibility, memberIds: group.nodes.map(node => node.id), countedRows: group.nodes.reduce((sum, node) => sum + weight(node), 0), forcedShared: group.forcedShared, blocked: group.blocked, reasonCodes: group.reasons })), counts, totals, optimisation: { method: 'deterministic-greedy-local-search', globallyOptimal: false, score: Math.max(0, score), flips, stoppedAtIterationLimit: flips === iterationLimit } };
}

export interface SuiteSelectionInput {
  nodes: CandidateNode[]; visibilityById: Record<string, CandidateVisibility>; seed: string | Uint8Array;
  goldFraction?: number; regressionFraction?: number;
}
export interface SuiteKindCounts {
  total: number; shared: number; targetGold: number; targetRegression: number; gold: number; regression: number; overlap: number;
  goldShortfall: number; regressionShortfall: number;
  strata: Record<string, { total: number; shared: number; gold: number; regression: number; overlap: number }>;
  classes: Record<string, { total: number; shared: number; eligibleGold: number; eligibleRegression: number; targetGold: number; targetRegression: number; gold: number; regression: number; overlap: number; goldShortfall: number; regressionShortfall: number }>;
}
export interface SharedSuiteSelection {
  goldIds: string[]; regressionIds: string[]; overlapIds: string[];
  counts: Record<CandidateKind, SuiteKindCounts>;
  semantics: { targetDenominator: 'all-counted-rows'; candidatePool: 'shared-only'; overlapAllowed: true; independentlyReviewed: false; coarseClassFirst: true; crossClassShortfallRedistributed: false };
}

/** Independent, stratified per-row shortlists inside shared; not a second holdout experiment or review approval. */
export function selectSharedSuites(input: SuiteSelectionInput): SharedSuiteSelection {
  validate(input.nodes, input.seed);
  const goldFraction = fraction(input.goldFraction, .1), regressionFraction = fraction(input.regressionFraction, .2), counted = [...input.nodes].filter(node => weight(node)).sort((a, b) => cmp(a.id, b.id));
  for (const node of input.nodes) if (!Object.hasOwn(input.visibilityById, node.id) || !['shared', 'holdout', 'unclassified'].includes(input.visibilityById[node.id]!)) throw new Error('Every candidate needs an explicit visibility before suite selection.');
  const gold = new Set<string>(), regression = new Set<string>(), reports = dictionary<SuiteKindCounts>() as Record<CandidateKind, SuiteKindCounts>;
  for (const kind of CANDIDATE_KINDS) {
    const nodes = counted.filter(node => node.kind === kind), shared = nodes.filter(node => input.visibilityById[node.id] === 'shared');
    const allClasses = new Map<string, CandidateNode[]>();
    for (const node of nodes) { const group = allClasses.get(balanceClass(node)) ?? []; group.push(node); allClasses.set(balanceClass(node), group); }
    const classes = dictionary<SuiteKindCounts['classes'][string]>();
    for (const [id, members] of [...allClasses].sort(([a], [b]) => cmp(a, b))) classes[id] = { total: members.length, shared: members.filter(node => input.visibilityById[node.id] === 'shared').length, eligibleGold: 0, eligibleRegression: 0, targetGold: 0, targetRegression: 0, gold: 0, regression: 0, overlap: 0, goldShortfall: 0, regressionShortfall: 0 };
    const pick = (suite: 'gold' | 'regression', ratio: number, output: Set<string>) => {
      const rank = (node: CandidateNode) => suite === 'gold' ? node.qualityRank ?? 0 : node.regressionRank ?? 0;
      const coarse = [...allClasses].sort(([a], [b]) => cmp(token(input.seed, suite + '-class', a), token(input.seed, suite + '-class', b)) || cmp(a, b)).map(([id, members]) => ({ id, members, ideal: members.length * ratio, quota: Math.floor(members.length * ratio) }));
      const target = Math.round(nodes.length * ratio), initial = coarse.reduce((sum, group) => sum + group.quota, 0);
      // Hamilton/largest-remainder allocation is computed BEFORE capacity constraints. Missing
      // members of one class cannot be silently replaced with another class to fill the headline count.
      const remainders = [...coarse].sort((a, b) => (b.ideal - b.quota) - (a.ideal - a.quota) || cmp(token(input.seed, suite + '-class', a.id), token(input.seed, suite + '-class', b.id)) || cmp(a.id, b.id));
      for (let index = 0; index < target - initial; index++) remainders[index]!.quota++;
      for (const group of coarse) {
        const report = classes[group.id]!, pool = group.members.filter(node => input.visibilityById[node.id] === 'shared' && (suite === 'gold' ? node.eligibleGold !== false : node.eligibleRegression !== false)), actualTarget = Math.min(group.quota, pool.length), byStratum = new Map<string, CandidateNode[]>(), classStrata = new Map<string, number>();
        if (suite === 'gold') { report.targetGold = group.quota; report.eligibleGold = pool.length; report.goldShortfall = group.quota - actualTarget; }
        else { report.targetRegression = group.quota; report.eligibleRegression = pool.length; report.regressionShortfall = group.quota - actualTarget; }
        for (const node of group.members) classStrata.set(node.stratum, (classStrata.get(node.stratum) ?? 0) + 1);
        for (const node of pool) { const list = byStratum.get(node.stratum) ?? []; list.push(node); byStratum.set(node.stratum, list); }
        const queues = [...byStratum].sort(([a], [b]) => cmp(token(input.seed, suite + '-stratum', a), token(input.seed, suite + '-stratum', b)) || cmp(a, b)).map(([stratum, list]) => ({ stratum, ideal: classStrata.get(stratum)! / group.members.length * group.quota, selected: 0, nodes: list.sort((a, b) => rank(b) - rank(a) || cmp(token(input.seed, suite + '-node', a.id), token(input.seed, suite + '-node', b.id)) || cmp(a.id, b.id)) }));
        // Fine strata remain soft coverage inside the class. Only this class's eligible pool can fill its quota.
        for (let index = 0; index < actualTarget; index++) {
          let best: typeof queues[number] | undefined, deficit = -Infinity;
          for (const queue of queues) if (queue.selected < queue.nodes.length) {
            const next = queue.ideal - queue.selected;
            if (next > deficit + 1e-12) { best = queue; deficit = next; }
          }
          if (!best) break;
          output.add(best.nodes[best.selected++]!.id);
        }
      }
    };
    pick('gold', goldFraction, gold); pick('regression', regressionFraction, regression);
    const strata = dictionary<{ total: number; shared: number; gold: number; regression: number; overlap: number }>();
    for (const node of nodes) {
      const entry = strata[node.stratum] ?? (strata[node.stratum] = { total: 0, shared: 0, gold: 0, regression: 0, overlap: 0 });
      entry.total++; if (input.visibilityById[node.id] === 'shared') entry.shared++; if (gold.has(node.id)) entry.gold++; if (regression.has(node.id)) entry.regression++; if (gold.has(node.id) && regression.has(node.id)) entry.overlap++;
      const coarse = classes[balanceClass(node)]!; if (gold.has(node.id)) coarse.gold++; if (regression.has(node.id)) coarse.regression++; if (gold.has(node.id) && regression.has(node.id)) coarse.overlap++;
    }
    const chosenGold = nodes.filter(node => gold.has(node.id)).length, chosenRegression = nodes.filter(node => regression.has(node.id)).length;
    reports[kind] = { total: nodes.length, shared: shared.length, targetGold: Math.round(nodes.length * goldFraction), targetRegression: Math.round(nodes.length * regressionFraction), gold: chosenGold, regression: chosenRegression, overlap: nodes.filter(node => gold.has(node.id) && regression.has(node.id)).length, goldShortfall: Math.max(0, Math.round(nodes.length * goldFraction) - chosenGold), regressionShortfall: Math.max(0, Math.round(nodes.length * regressionFraction) - chosenRegression), strata, classes };
  }
  return { goldIds: [...gold].sort(cmp), regressionIds: [...regression].sort(cmp), overlapIds: [...gold].filter(id => regression.has(id)).sort(cmp), counts: reports, semantics: { targetDenominator: 'all-counted-rows', candidatePool: 'shared-only', overlapAllowed: true, independentlyReviewed: false, coarseClassFirst: true, crossClassShortfallRedistributed: false } };
}
