import { buildSnapshot, contentHash, type RuleLibrary } from './rulepacks';
import type { ProofDocument, ProofStep, RuleBinding, RuleDef, RulePack, RuleSnapshot } from './types';

/** conclusion 槽固定绑定到步骤自身的命题。 */
export const STATEMENT_BINDING = '__statement__';
const now = () => new Date().toISOString();

export interface SlotIssue {
  slotId: string;
  message: string;
}

export interface BindingValidation {
  issues: SlotIssue[];
  /** 冲突包不能混用：同一证明内只能引用互相兼容的规则包。 */
  conflict: string | null;
}

export function isPremiseAxiom(step: ProofStep): boolean {
  // 显式前提是证明的公理起点，不要求引用规则包。
  return step.type === 'premise' && step.rule === '前提' && !step.binding;
}

export function usedPackIds(document: ProofDocument): string[] {
  const ids = new Set<string>();
  document.steps.forEach((step) => {
    const packId = step.binding?.snapshot?.packId;
    if (packId) ids.add(packId);
  });
  return [...ids];
}

export function conflictMessage(library: RuleLibrary, packId: string, document: ProofDocument): string | null {
  const active = usedPackIds(document).filter((id) => id !== packId);
  const pack = library.get(packId);
  if (!pack) return null;
  for (const id of active) {
    const other = library.get(id);
    if (pack.conflictsWith.includes(id) || other?.conflictsWith.includes(packId)) {
      return `「${pack.name}」与本文已引用的「${other?.name ?? id}」是冲突规则包，不能在同一证明中混用。`;
    }
  }
  return null;
}

/** 按规则名称在库中查找，生成旧证明兼容所需的待确认绑定。匹配唯一时自动预填槽位。 */
export function resolveLegacyBinding(
  library: RuleLibrary,
  step: ProofStep,
  ruleName: string,
): RuleBinding {
  const matches = library.findRuleByName(ruleName);
  const unique = matches.length === 1 ? matches[0] : undefined;
  const snapshot = unique ? buildSnapshot(unique.pack, unique.rule) : null;
  const binding: RuleBinding = {
    slots: {},
    status: 'pending',
    snapshot,
    legacyRuleName: ruleName,
    updatedAt: now(),
  };
  if (unique) prefillSlots(binding, unique.rule, step);
  return binding;
}

export function createBinding(library: RuleLibrary, packId: string, ruleId: string, step: ProofStep): RuleBinding | null {
  const found = library.findRule(packId, ruleId);
  if (!found) return null;
  const binding: RuleBinding = {
    slots: {},
    status: 'pending',
    snapshot: buildSnapshot(found.pack, found.rule),
    updatedAt: now(),
  };
  prefillSlots(binding, found.rule, step);
  return binding;
}

function prefillSlots(binding: RuleBinding, rule: RuleDef, step: ProofStep): void {
  rule.slots.forEach((slot) => {
    if (slot.kind === 'conclusion') {
      binding.slots[slot.id] = STATEMENT_BINDING;
    } else if (slot.kind === 'premise') {
      const candidate = step.references.find((id) => id !== step.id);
      if (candidate) binding.slots[slot.id] = candidate;
    }
  });
}

/** 规则包更新后核对文档：快照内容与包内当前规则不一致的步骤立即失效，原绑定保留。 */
export function reconcileDocument(library: RuleLibrary, document: ProofDocument): number {
  let affected = 0;
  document.steps.forEach((step) => {
    const binding = step.binding;
    if (!binding || !binding.snapshot) return;
    const found = library.findRule(binding.snapshot.packId, binding.snapshot.ruleId);
    if (!found) return; // 包被移除：保留快照作为来源凭证，检查器另行提示。
    const stale = contentHash(found.rule) !== binding.snapshot.contentHash
      || found.pack.version !== binding.snapshot.packVersion;
    if (stale && binding.status !== 'stale') {
      binding.status = 'stale';
      binding.updatedAt = now();
      affected += 1;
    }
  });
  return affected;
}

/** 逐条确认：以当前规则内容重新固定引用；槽位不完整时仍保持待确认。 */
export function confirmBinding(library: RuleLibrary, step: ProofStep): RuleBinding | null {
  const binding = step.binding;
  if (!binding?.snapshot) return null;
  const found = library.findRule(binding.snapshot.packId, binding.snapshot.ruleId);
  if (!found) return null;
  binding.snapshot = buildSnapshot(found.pack, found.rule);
  binding.legacyRuleName = undefined;
  binding.status = requiredSlotsComplete(found.rule, binding) ? 'confirmed' : 'pending';
  binding.updatedAt = now();
  return binding;
}

export function requiredSlotsComplete(rule: RuleDef, binding: RuleBinding): boolean {
  return rule.slots
    .filter((slot) => slot.required)
    .every((slot) => Boolean(binding.slots[slot.id]));
}

export function validateBinding(binding: RuleBinding, step: ProofStep, document: ProofDocument): SlotIssue[] {
  const rule = binding.snapshot?.rule;
  if (!rule) return [{ slotId: '__source__', message: '待确认映射未解析到规则来源，请在检查器中选择同名规则所属的规则包。' }];
  const ids = new Set(document.steps.map((item) => item.id));
  const issues: SlotIssue[] = [];
  rule.slots.forEach((slot) => {
    const value = binding.slots[slot.id];
    if (slot.kind === 'premise') {
      if (slot.required && !value) issues.push({ slotId: slot.id, message: `前提槽「${slot.label}」尚未绑定步骤。` });
      else if (value && !ids.has(value)) issues.push({ slotId: slot.id, message: `前提槽「${slot.label}」绑定的步骤已不存在。` });
      else if (value && value === step.id) issues.push({ slotId: slot.id, message: `前提槽「${slot.label}」不能绑定本步骤自身。` });
    } else if (slot.kind === 'conclusion') {
      if (value !== STATEMENT_BINDING) issues.push({ slotId: slot.id, message: '结论槽必须绑定本步命题。' });
      else if (!step.statement.trim()) issues.push({ slotId: slot.id, message: '本步命题为空，结论槽无内容。' });
    } else if (slot.required && !value) {
      issues.push({ slotId: slot.id, message: `符号环境「${slot.label}」未映射到符号表。` });
    } else if (value && !Object.prototype.hasOwnProperty.call(document.symbols, value)) {
      issues.push({ slotId: slot.id, message: `符号「${value}」不在文档符号表中，请先登记。` });
    }
  });
  return issues;
}

export function bindingIssues(document: ProofDocument): Map<string, SlotIssue[]> {
  const map = new Map<string, SlotIssue[]>();
  document.steps.forEach((step) => {
    if (isPremiseAxiom(step)) return;
    const binding = step.binding;
    if (!binding) {
      map.set(step.id, [{ slotId: '__binding__', message: '该步骤只有规则名称，尚未绑定规则包。' }]);
      return;
    }
    const issues = validateBinding(binding, step, document);
    if (issues.length) map.set(step.id, issues);
  });
  return map;
}

/** 导出前置条件：存在未确认（待确认/待复核）绑定时不允许导出。 */
export function exportBlockers(document: ProofDocument): ProofStep[] {
  return document.steps.filter((step) => {
    if (isPremiseAxiom(step)) return false;
    const status = step.binding?.status;
    return status === 'pending' || status === 'stale' || !step.binding || !step.binding.snapshot;
  });
}

export function snapshotDiff(snapshot: RuleSnapshot, current: RuleDef | undefined): { field: string; frozen: string; latest: string }[] {
  const rows: { field: string; frozen: string; latest: string }[] = [];
  if (!current) {
    rows.push({ field: '规则', frozen: snapshot.ruleName, latest: '规则已从包中移除' });
    return rows;
  }
  if (snapshot.rule.description !== current.description) rows.push({ field: '规则说明', frozen: snapshot.rule.description, latest: current.description });
  const frozenSlots = snapshot.rule.slots.map((slot) => `${slot.label}(${slot.kind})`).join('、') || '无';
  const latestSlots = current.slots.map((slot) => `${slot.label}(${slot.kind})`).join('、') || '无';
  if (frozenSlots !== latestSlots) rows.push({ field: '槽位', frozen: frozenSlots, latest: latestSlots });
  const frozenSymbols = snapshot.rule.symbols.map((sym) => sym.token).join('、') || '无';
  const latestSymbols = current.symbols.map((sym) => sym.token).join('、') || '无';
  if (frozenSymbols !== latestSymbols) rows.push({ field: '符号环境', frozen: frozenSymbols, latest: latestSymbols });
  return rows;
}

export function statusLabel(status: RuleBinding['status'] | undefined): string {
  if (status === 'confirmed') return '已确认';
  if (status === 'stale') return '待复核';
  return '待确认';
}

export function packConflictPairs(library: RuleLibrary, packs: RulePack[]): string {
  const names: string[] = [];
  packs.forEach((pack) => {
    pack.conflictsWith.forEach((otherId) => {
      const other = library.get(otherId);
      if (other && packs.some((item) => item.id === otherId)) {
        names.push(`${pack.name} ↔ ${other.name}`);
      }
    });
  });
  return [...new Set(names)].join('；');
}
