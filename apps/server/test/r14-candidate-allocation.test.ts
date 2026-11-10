import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateCandidateVisibility, selectSharedSuites, type CandidateNode } from '../../../scripts/analysis/candidate-allocation.js';

const seed = 'synthetic-r14-local-key';
const nodes = (count: number, groupSize = 1, kind: CandidateNode['kind'] = 'sensitive', prefix = kind): CandidateNode[] => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-node-${index}`, kind, groupId: `${prefix}-group-${Math.floor(index / groupSize)}`, stratum: `stratum-${index % 2}`, qualityRank: count - index, regressionRank: count - index }));
const reverse = <T>(items: T[]) => [...items].reverse();

test('row budgets, opaque strata and whole groups yield twenty percent without counting aliases', () => {
  const source = nodes(100, 2), aliases = source.slice(0, 30).map(item => ({ ...item, id: 'alias-' + item.id, weight: 0 as const }));
  const result = allocateCandidateVisibility({ nodes: [...source, ...aliases], seed });
  assert.equal(result.counts.sensitive.total, 100); assert.equal(result.counts.sensitive.holdout, 20);
  assert.equal(result.totals.aliasNodes, 30); assert.equal(result.totals.total, 100);
  assert.equal(result.counts.sensitive.strata['stratum-0']!.holdout, 10);
  assert.equal(result.counts.sensitive.strata['stratum-1']!.holdout, 10);
  for (const alias of aliases) assert.equal(result.visibilityById[alias.id], result.visibilityById[alias.id.replace(/^alias-/, '')]);
  for (const group of result.groups) assert.equal(new Set(group.memberIds.map(id => result.visibilityById[id])).size, 1);
  assert.equal(result.counts.sensitive.targetRowsAttainableIgnoringCrossKindConstraints, true);
  assert.equal(result.optimisation.globallyOptimal, false);
});

test('giant indivisible family reports unreachable row budget instead of splitting or forcing quota', () => {
  const source = nodes(100, 100), result = allocateCandidateVisibility({ nodes: source, seed });
  assert.equal(result.counts.sensitive.roundedTargetHoldoutRows, 20);
  assert.equal(result.counts.sensitive.holdout, 0);
  assert.equal(result.counts.sensitive.actualHoldoutFraction, 0);
  assert.equal(result.counts.sensitive.deviationPercentagePoints, -20);
  assert.equal(result.counts.sensitive.targetRowsAttainableIgnoringCrossKindConstraints, false);
  assert.deepEqual(result.counts.sensitive.nearestAttainableRowsIgnoringCrossKindConstraints, [0]);
  assert.ok(result.counts.sensitive.explanations.includes('ROW_TARGET_UNREACHABLE_WITH_WHOLE_GROUPS'));
  assert.equal(result.groups.length, 1);
});

test('global components keep cross-library nodes on one side even when the row targets couple', () => {
  const a = nodes(50, 1, 'sensitive'), b = nodes(50, 1, 'injection');
  for (let index = 0; index < 10; index++) { a[index]!.groupId = 'cross-' + index; b[index]!.groupId = 'cross-' + index; }
  const result = allocateCandidateVisibility({ nodes: [...a, ...b], seed });
  for (let index = 0; index < 10; index++) assert.equal(result.visibilityById[a[index]!.id], result.visibilityById[b[index]!.id]);
  assert.ok(result.counts.sensitive.explanations.includes('CROSS_LIBRARY_GROUPS_COUPLE_TARGETS'));
  assert.ok(result.counts.injection.explanations.includes('CROSS_LIBRARY_GROUPS_COUPLE_TARGETS'));
  assert.equal(result.counts.sensitive.holdout, 10); assert.equal(result.counts.injection.holdout, 10);
});

test('exposure forces entire groups shared; blocked overrides exposure and remains unclassified', () => {
  const source = nodes(30, 3), constraints = [
    { groupId: source[0]!.groupId, forcedShared: true, reasonCodes: ['EXPOSED_ALIAS'] },
    { groupId: source[3]!.groupId, blocked: true, forcedShared: true, reasonCodes: ['ZIP_REJECTED', 'EXPOSED_MEMBER'] },
  ], result = allocateCandidateVisibility({ nodes: source, groups: constraints, seed });
  assert.equal(result.counts.sensitive.forcedSharedRows, 3); assert.equal(result.counts.sensitive.blockedRows, 3);
  assert.equal(result.counts.sensitive.unclassified, 3);
  for (const item of source.slice(0, 3)) assert.equal(result.visibilityById[item.id], 'shared');
  for (const item of source.slice(3, 6)) assert.equal(result.visibilityById[item.id], 'unclassified');
  assert.ok(result.groups.find(group => group.groupId === source[3]!.groupId)!.reasonCodes.includes('BLOCKED_OVERRIDES_FORCED_SHARED'));
});

test('allocation and suite selection reproduce across input/constraint order without modifying inputs', () => {
  const source = [...nodes(111, 3), ...nodes(81, 3, 'skills')], constraints = [{ groupId: source[0]!.groupId, forcedShared: true }, { groupId: source[6]!.groupId, blocked: true }], before = structuredClone(source);
  const a = allocateCandidateVisibility({ nodes: source, groups: constraints, seed }), b = allocateCandidateVisibility({ nodes: reverse(source), groups: reverse(constraints), seed });
  assert.deepEqual(a, b);
  const suiteA = selectSharedSuites({ nodes: source, visibilityById: a.visibilityById, seed }), suiteB = selectSharedSuites({ nodes: reverse(source), visibilityById: b.visibilityById, seed });
  assert.deepEqual(suiteA, suiteB); assert.deepEqual(source, before);
  assert.deepEqual(JSON.parse(JSON.stringify(a.visibilityById)), { ...a.visibilityById });
});

test('gold and regression use full-population row targets, select shared only, and may overlap', () => {
  const source = nodes(100), visibilityById = Object.fromEntries(source.map((node, index) => [node.id, index < 80 ? 'shared' as const : 'holdout' as const]));
  const selected = selectSharedSuites({ nodes: source, visibilityById, seed });
  assert.equal(selected.goldIds.length, 10); assert.equal(selected.regressionIds.length, 20); assert.equal(selected.overlapIds.length, 10);
  assert.equal(selected.counts.sensitive.strata['stratum-0']!.gold, 5); assert.equal(selected.counts.sensitive.strata['stratum-1']!.gold, 5);
  assert.ok(selected.goldIds.every(id => selected.regressionIds.includes(id)));
  assert.ok([...selected.goldIds, ...selected.regressionIds].every(id => visibilityById[id] === 'shared'));
  assert.equal(selected.semantics.targetDenominator, 'all-counted-rows');
  assert.equal(selected.semantics.independentlyReviewed, false);
  assert.equal(selected.counts.sensitive.overlap, 10);
});

test('suite scarcity is explicit and does not turn blocked, hidden, alias or ineligible rows into gold', () => {
  const source = nodes(100), aliases = source.slice(0, 10).map(node => ({ ...node, id: 'alias-' + node.id, weight: 0 as const })), visibilityById = Object.fromEntries([...source, ...aliases].map((node, index) => [node.id, index < 3 ? 'shared' as const : index < 50 ? 'unclassified' as const : 'holdout' as const]));
  source[0]!.eligibleGold = false;
  const result = selectSharedSuites({ nodes: [...source, ...aliases], visibilityById, seed });
  assert.equal(result.goldIds.length, 2); assert.equal(result.regressionIds.length, 3);
  assert.equal(result.counts.sensitive.total, 100); assert.equal(result.counts.sensitive.goldShortfall, 8); assert.equal(result.counts.sensitive.regressionShortfall, 17);
  assert.ok(!result.goldIds.includes(source[0]!.id)); assert.ok(result.goldIds.every(id => !id.startsWith('alias-')));
});

test('plain mapping handles prototype-like opaque identifiers and validates context', () => {
  const source: CandidateNode[] = [{ id: '__proto__', groupId: 'constructor', kind: 'drift', stratum: 'toString' }];
  const result = allocateCandidateVisibility({ nodes: source, seed });
  assert.ok(Object.hasOwn(result.visibilityById, '__proto__')); assert.ok(Object.hasOwn(result.counts.drift.strata, 'toString'));
  assert.throws(() => allocateCandidateVisibility({ nodes: [...source, ...source], seed }), /duplicate/);
  assert.throws(() => allocateCandidateVisibility({ nodes: source, seed: '' }), /nonempty/);
  assert.throws(() => allocateCandidateVisibility({ nodes: source, seed, holdoutFraction: 1.1 }), /fraction/);
  assert.throws(() => allocateCandidateVisibility({ nodes: source, seed, groups: [{ groupId: 'missing', blocked: true }] }), /missing group/);
  assert.throws(() => selectSharedSuites({ nodes: source, seed, visibilityById: {} }), /explicit visibility/);
});

test('zero and full holdout targets remain bounded by hard group constraints', () => {
  const source = nodes(20, 2);
  const zero = allocateCandidateVisibility({ nodes: source, seed, holdoutFraction: 0 });
  assert.equal(zero.counts.sensitive.shared, 20); assert.equal(zero.counts.sensitive.holdout, 0);
  const full = allocateCandidateVisibility({ nodes: source, seed, holdoutFraction: 1, groups: [{ groupId: source[0]!.groupId, forcedShared: true }] });
  assert.equal(full.counts.sensitive.holdout, 18); assert.equal(full.counts.sensitive.shared, 2);
  assert.ok(full.counts.sensitive.explanations.includes('ROW_TARGET_UNREACHABLE_WITH_WHOLE_GROUPS'));
});

test('coarse class margins remain balanced despite many tiny fine strata and indivisible pairs', () => {
  const source = nodes(200, 2, 'drift').map((node, index) => ({ ...node, balanceClass: index < 100 ? 'benign' : 'attack', stratum: index < 100 ? 'broad-benign' : 'attack-detail-' + Math.floor(index / 2) }));
  const result = allocateCandidateVisibility({ nodes: source, seed });
  assert.equal(result.counts.drift.holdout, 40);
  assert.equal(result.counts.drift.classes.benign!.holdout, 20); assert.equal(result.counts.drift.classes.attack!.holdout, 20);
  for (const group of result.groups) assert.equal(new Set(group.memberIds.map(id => result.visibilityById[id])).size, 1);
  const repeated = allocateCandidateVisibility({ nodes: reverse(source), seed }); assert.deepEqual(result, repeated);
});

test('coarse class suite quotas preserve rare negative controls before fine-stratum rounding', () => {
  const source = nodes(2000).map((node, index) => ({ ...node, balanceClass: index < 1993 ? 'sensitive_present' : 'sensitive_absent', stratum: 'detail-' + Math.floor(index / 7) }));
  const visibilityById = Object.fromEntries(source.map(node => [node.id, 'shared' as const]));
  const result = selectSharedSuites({ nodes: source, visibilityById, seed });
  assert.equal(result.goldIds.length, 200); assert.equal(result.regressionIds.length, 400);
  assert.equal(result.counts.sensitive.classes.sensitive_present!.gold, 199); assert.equal(result.counts.sensitive.classes.sensitive_absent!.gold, 1);
  assert.equal(result.counts.sensitive.classes.sensitive_present!.regression, 399); assert.equal(result.counts.sensitive.classes.sensitive_absent!.regression, 1);
});

test('drift suite class quotas follow 798/921 population even with asymmetric fine categories', () => {
  const source = nodes(1719, 1, 'drift').map((node, index) => ({ ...node, balanceClass: index < 798 ? 'benign' : 'attack', stratum: index < 798 ? 'benign-case-' + Math.floor(index / 3) : 'attack-case-' + Math.floor(index / 47) }));
  const visibilityById = Object.fromEntries(source.map(node => [node.id, 'shared' as const]));
  const result = selectSharedSuites({ nodes: source, visibilityById, seed });
  assert.equal(result.counts.drift.classes.benign!.gold, 80); assert.equal(result.counts.drift.classes.attack!.gold, 92);
  assert.equal(result.counts.drift.classes.benign!.regression, 160); assert.equal(result.counts.drift.classes.attack!.regression, 184);
  assert.deepEqual(result, selectSharedSuites({ nodes: reverse(source), visibilityById, seed }));
});

test('missing eligible coarse class is an explicit shortage rather than replacement by another class', () => {
  const source = nodes(100).map((node, index) => ({ ...node, balanceClass: index < 50 ? 'benign' : 'attack' }));
  const visibilityById = Object.fromEntries(source.map((node, index) => [node.id, index < 50 ? 'shared' as const : 'holdout' as const]));
  const result = selectSharedSuites({ nodes: source, visibilityById, seed });
  assert.equal(result.goldIds.length, 5); assert.equal(result.regressionIds.length, 10);
  assert.equal(result.counts.sensitive.classes.attack!.goldShortfall, 5); assert.equal(result.counts.sensitive.classes.attack!.regressionShortfall, 10);
  assert.equal(result.counts.sensitive.classes.benign!.gold, 5); assert.equal(result.counts.sensitive.classes.benign!.regression, 10);
  assert.equal(result.semantics.crossClassShortfallRedistributed, false);
});
