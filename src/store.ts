import { redraw } from 'mithril';
import { RuleLibrary, type ImportResult } from './rulepacks';
import {
  conflictMessage,
  confirmBinding,
  createBinding,
  exportBlockers,
  isPremiseAxiom,
  reconcileDocument,
  requiredSlotsComplete,
  resolveLegacyBinding,
  usedPackIds,
  validateBinding,
} from './rulebindings';
import type { ProofCheck, ProofDocument, ProofStep, ProofVersion, RuleBinding } from './types';

const STORAGE_KEY = 'sologsb-1014-proof-workspace-v1';
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T>(value: T): T => structuredClone(value);

/** 旧版本固定规则下拉项；新数据通过规则包引用规则。 */
export const RULES = ['前提', '定义展开', '代入', '等式变形', '分配律', '同类项合并', '交换律', '数学归纳', '反证法', '构造法', '结论'];

export const ruleLibrary = new RuleLibrary();

/** 前提槽绑定变化时，同步维护步骤间引用关系（删除步骤等旧逻辑仍读取 references）。 */
function syncReferences(step: ProofStep): void {
  const rule = step.binding?.snapshot?.rule;
  if (!rule) return;
  const ids: string[] = [];
  rule.slots.forEach((slot) => {
    if (slot.kind === 'premise') {
      const value = step.binding?.slots[slot.id];
      if (value && value !== step.id && !ids.includes(value)) ids.push(value);
    }
  });
  step.references = ids;
}

function sampleSteps(): ProofStep[] {
  return [
    { id: 's1', type: 'premise', statement: '$a,b$ 是实数', rule: '前提', references: [], note: '采用实数域中的交换律与分配律。', counterexample: '', alternative: '' },
    { id: 's2', type: 'derivation', statement: '$(a+b)^2=(a+b)(a+b)$', rule: '定义展开', references: ['s1'], note: '把平方写成两个相同因式之积。', counterexample: '', alternative: '' },
    { id: 's3', type: 'derivation', statement: '$(a+b)(a+b)=a^2+ab+ba+b^2$', rule: '分配律', references: ['s2'], note: '', counterexample: '', alternative: '也可先展开后半部分。' },
    { id: 's4', type: 'derivation', statement: '$a^2+ab+ba+b^2=a^2+2ab+b^2$', rule: '同类项合并', references: ['s3'], note: '由实数的交换律，$ab=ba$。', counterexample: '', alternative: '' },
    { id: 's5', type: 'goal', statement: '$(a+b)^2=a^2+2ab+b^2$', rule: '结论', references: ['s4'], note: '目标已由步骤 1 至 4 逐项推出。', counterexample: '', alternative: '' },
  ];
}

function issueSteps(): ProofStep[] {
  return [
    { id: 'i1', type: 'premise', statement: '$n$ 是正整数', rule: '前提', references: [], note: '', counterexample: '', alternative: '' },
    { id: 'i2', type: 'derivation', statement: '$P(1)$ 成立', rule: '前提', references: ['i1'], note: '归纳基例。', counterexample: '', alternative: '' },
    { id: 'i3', type: 'derivation', statement: '若 $P(k)$ 成立，则 $P(k+1)$ 也成立', rule: '数学归纳', references: ['missing-step'], note: '这里故意保留一个失效引用，用于演示检查。', counterexample: '', alternative: '' },
    { id: 'i4', type: 'goal', statement: '$P(n)$ 对所有正整数 $n$ 成立', rule: '结论', references: ['i3'], note: '尚未补齐归纳假设。', counterexample: '', alternative: '' },
  ];
}

/** 旧证明缺绑定时按规则名称生成待确认映射；匹配唯一则固定来源并预填槽位。 */
function migrateLegacyBindings(documents: ProofDocument[]): void {
  documents.forEach((document) => {
    document.steps.forEach((step) => {
      if (step.binding || !step.rule) return;
      step.binding = resolveLegacyBinding(ruleLibrary, step, step.rule);
    });
  });
}

function initialDocuments(): ProofDocument[] {
  const now = new Date().toISOString();
  const docs: ProofDocument[] = [
    {
      id: 'doc-algebra',
      title: '完全平方公式证明',
      author: '数学组',
      goal: '$(a+b)^2=a^2+2ab+b^2$',
      symbols: { a: '实数', b: '实数', P: '关于正整数的命题', n: '正整数', k: '正整数' },
      steps: sampleSteps(),
      versions: [],
      updatedAt: now,
    },
    {
      id: 'doc-induction',
      title: '数学归纳法待核对稿',
      author: '学生工作区',
      goal: '$P(n)$ 对所有正整数 $n$ 成立',
      symbols: { P: '关于正整数的命题', n: '正整数', k: '正整数' },
      steps: issueSteps(),
      versions: [],
      updatedAt: now,
    },
  ];
  migrateLegacyBindings(docs);
  return docs;
}

function loadDocuments(): ProofDocument[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialDocuments();
    const parsed = JSON.parse(raw) as ProofDocument[];
    if (!Array.isArray(parsed) || !parsed.length) return initialDocuments();
    const before = JSON.stringify(parsed);
    migrateLegacyBindings(parsed);
    parsed.forEach((document) => reconcileDocument(ruleLibrary, document));
    // 迁移生成的待确认映射与来源必须在重开后保留：内容变化时立即落盘。
    if (JSON.stringify(parsed) !== before) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return initialDocuments();
  }
}

export class ProofStore {
  documents = loadDocuments();
  library = ruleLibrary;
  activeId = this.documents[0]?.id ?? '';
  selectedStepId = this.documents[0]?.steps[0]?.id ?? '';
  compareVersionId = '';
  dragStepId = '';
  lastInput: HTMLTextAreaElement | HTMLInputElement | null = null;
  undoStack: ProofDocument[][] = [];
  redoStack: ProofDocument[][] = [];
  toast = '';

  get current(): ProofDocument {
    return this.documents.find((item) => item.id === this.activeId) ?? this.documents[0];
  }

  get selectedStep(): ProofStep | undefined {
    return this.current?.steps.find((step) => step.id === this.selectedStepId);
  }

  get checks(): ProofCheck[] {
    return validate(this.current, this.library);
  }

  /** 存在未确认绑定或槽位问题时禁止导出。 */
  get exportBlocked(): ProofStep[] {
    const blockers = exportBlockers(this.current);
    return blockers.filter((step) => {
      if (step.binding?.status === 'confirmed') return validateBinding(step.binding, step, this.current).length > 0;
      return true;
    });
  }

  save(): void {
    this.current.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
  }

  update(mutator: (document: ProofDocument) => void): void {
    this.undoStack.push(clone(this.documents));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    mutator(this.current);
    this.save();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.documents));
    this.documents = previous;
    this.ensureSelection();
    this.save();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.documents));
    this.documents = next;
    this.ensureSelection();
    this.save();
  }

  selectDocument(id: string): void {
    this.activeId = id;
    this.compareVersionId = '';
    this.selectedStepId = this.current?.steps[0]?.id ?? '';
  }

  selectStep(id: string): void {
    this.selectedStepId = id;
  }

  ensureSelection(): void {
    if (!this.documents.some((item) => item.id === this.activeId)) this.activeId = this.documents[0]?.id ?? '';
    if (!this.current?.steps.some((step) => step.id === this.selectedStepId)) {
      this.selectedStepId = this.current?.steps[0]?.id ?? '';
    }
  }

  addDocument(): void {
    const id = uid('doc');
    const document: ProofDocument = {
      id,
      title: '未命名证明',
      author: '本地用户',
      goal: '$A=B$',
      symbols: { A: '待定义对象', B: '待定义对象' },
      steps: [],
      versions: [],
      updatedAt: new Date().toISOString(),
    };
    this.undoStack.push(clone(this.documents));
    this.documents.unshift(document);
    this.activeId = id;
    this.addStep('premise');
    this.save();
  }

  removeDocument(id: string): void {
    if (this.documents.length <= 1) {
      this.notify('至少保留一个证明文档');
      return;
    }
    this.undoStack.push(clone(this.documents));
    this.documents = this.documents.filter((item) => item.id !== id);
    this.ensureSelection();
    this.save();
  }

  /** 新步骤立即引用规则包中的规则（待确认），不再只存规则名称。 */
  private bindingFor(type: ProofStep['type']): RuleBinding | undefined {
    const ruleName = type === 'goal' ? '结论' : type === 'premise' ? '前提' : '等式变形';
    const match = this.library.findRuleByName(ruleName).find((item) => item.pack.id === 'pack-elementary-algebra')
      ?? this.library.findRuleByName(ruleName)[0];
    if (!match) return undefined;
    const placeholder: ProofStep = { id: '', type, statement: '', rule: ruleName, references: [], note: '', counterexample: '', alternative: '' };
    return createBinding(this.library, match.pack.id, match.rule.id, placeholder) ?? undefined;
  }

  addStep(type: ProofStep['type'] = 'derivation'): void {
    const step: ProofStep = {
      id: uid('step'),
      type,
      statement: type === 'goal' ? '$A=B$' : type === 'premise' ? '输入前提条件' : '输入新的推导式',
      rule: type === 'goal' ? '结论' : type === 'premise' ? '前提' : '等式变形',
      references: this.selectedStepId ? [this.selectedStepId] : [],
      note: '',
      counterexample: '',
      alternative: '',
      binding: this.bindingFor(type),
    };
    if (step.binding) {
      // 把预填的相对引用落到真实的当前选中步骤。
      const rule = step.binding.snapshot?.rule;
      rule?.slots.forEach((slot) => {
        if (slot.kind === 'premise' && this.selectedStepId) step.binding!.slots[slot.id] = this.selectedStepId;
      });
      syncReferences(step);
    }
    this.update((document) => {
      if (type === 'goal' || document.steps.length === 0) {
        document.steps.push(step);
        return;
      }
      const selectedIndex = document.steps.findIndex((item) => item.id === this.selectedStepId);
      document.steps.splice(selectedIndex < 0 ? document.steps.length : selectedIndex + 1, 0, step);
    });
    this.selectedStepId = step.id;
  }

  removeStep(id: string): void {
    this.update((document) => {
      document.steps = document.steps.filter((step) => step.id !== id);
      document.steps.forEach((step) => {
        step.references = step.references.filter((reference) => reference !== id);
        // 槽位绑定的依据被删除：清空绑定并退回待确认。
        if (step.binding) {
          let touched = false;
          Object.entries(step.binding.slots).forEach(([slotId, value]) => {
            if (value === id) {
              delete step.binding!.slots[slotId];
              touched = true;
            }
          });
          if (touched && step.binding.status === 'confirmed') step.binding.status = 'pending';
        }
      });
    });
    this.ensureSelection();
  }

  moveStep(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    this.update((document) => {
      const from = document.steps.findIndex((step) => step.id === sourceId);
      const to = document.steps.findIndex((step) => step.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = document.steps.splice(from, 1);
      document.steps.splice(to, 0, moved);
    });
  }

  updateStep(patch: Partial<ProofStep>): void {
    const id = this.selectedStepId;
    this.update((document) => {
      const step = document.steps.find((item) => item.id === id);
      if (step) Object.assign(step, patch);
    });
  }

  /** 为步骤选择规则包中的具体规则；冲突包不能混用。 */
  bindStep(stepId: string, packId: string, ruleId: string): void {
    const conflict = conflictMessage(this.library, packId, this.current);
    if (conflict) {
      this.notify(conflict);
      return;
    }
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      if (!step) return;
      const binding = createBinding(this.library, packId, ruleId, step);
      if (!binding) return;
      step.binding = binding;
      step.rule = binding.snapshot?.ruleName ?? step.rule;
      syncReferences(step);
    });
  }

  /** 旧证明的待确认映射：按用户选择的来源规则固定快照。 */
  resolveLegacy(stepId: string, packId: string, ruleId: string): void {
    this.bindStep(stepId, packId, ruleId);
  }

  updateSlot(stepId: string, slotId: string, value: string): void {
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      const binding = step?.binding;
      if (!step || !binding) return;
      if (value) binding.slots[slotId] = value;
      else delete binding.slots[slotId];
      if (binding.status === 'confirmed') binding.status = 'pending';
      syncReferences(step);
    });
  }

  /** 逐条确认引用：固定当前规则内容，槽位齐备才可标记已确认。 */
  confirmStep(stepId: string): void {
    let message = '';
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      if (!step?.binding?.snapshot) return;
      const updated = confirmBinding(this.library, step);
      if (!updated?.snapshot) {
        message = '规则来源已不在库中，无法确认';
        return;
      }
      const rule = updated.snapshot.rule;
      if (!requiredSlotsComplete(rule, updated)) message = '仍有必填槽位未绑定';
      syncReferences(step);
    });
    if (message) this.notify(message);
  }

  unbindStep(stepId: string): void {
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      if (!step) return;
      step.binding = undefined;
      step.references = [];
    });
  }

  /** 导入规则包：同 id 覆盖更新，引用旧内容的步骤立即失效、标记待复核。 */
  importRulePack(text: string): ImportResult {
    const result = this.library.importPack(text);
    if (result.ok) {
      let affected = 0;
      this.documents.forEach((document) => {
        affected += reconcileDocument(this.library, document);
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
      if (affected) this.notify(`规则包已更新，${affected} 个步骤标记为待复核`);
      redraw();
    }
    return result;
  }

  /** 演示规则包发布修订：受影响步骤立即失效，原绑定保留。 */
  bumpRulePack(packId: string): void {
    const pack = this.library.bumpPack(packId, '规则包发布修订');
    if (!pack) return;
    let affected = 0;
    this.documents.forEach((document) => {
      affected += reconcileDocument(this.library, document);
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
    this.notify(affected ? `「${pack.name}」已修订，${affected} 个步骤待复核` : `「${pack.name}」已修订，当前文档暂无引用步骤`);
  }

  createVersion(): void {
    this.update((document) => {
      const version: ProofVersion = {
        id: uid('version'),
        name: `版本 ${document.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        steps: clone(document.steps),
        goal: document.goal,
      };
      document.versions.unshift(version);
      this.compareVersionId = version.id;
    });
    this.notify('已保存当前证明快照');
  }

  notify(message: string): void {
    this.toast = message;
    window.setTimeout(() => {
      if (this.toast === message) {
        this.toast = '';
        redraw();
      }
    }, 2600);
  }
}

function stripLatexCommands(text: string): string {
  return text.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}_^]/g, ' ');
}

export function validate(document: ProofDocument, library: RuleLibrary): ProofCheck[] {
  const checks: ProofCheck[] = [];
  const ids = new Set(document.steps.map((step) => step.id));
  const symbolKeys = new Set(Object.keys(document.symbols));
  const ignored = new Set(['a', 'A', 'b', 'B', 'n', 'k', 'P', 'Q', 'R', 'x', 'y', 'z', 'l', 'to', 'text', 'frac', 'sqrt']);

  // 冲突包不能混用：同一证明内出现互斥规则包即报错。
  const activePackIds = usedPackIds(document);
  activePackIds.forEach((packId) => {
    const pack = library.get(packId);
    pack?.conflictsWith.forEach((otherId) => {
      const other = library.get(otherId);
      if (other && activePackIds.includes(otherId)) {
        const owner = document.steps.find((step) => step.binding?.snapshot?.packId === packId);
        checks.push({
          id: `conflict-${packId}-${otherId}`,
          severity: 'error',
          title: '混用了冲突规则包',
          detail: `「${pack.name}」与「${other.name}」互斥，不能出现在同一份证明中。`,
          stepId: owner?.id,
        });
      }
    });
  });

  document.steps.forEach((step, index) => {
    const tokens = stripLatexCommands(step.statement).match(/\b[A-Za-z][A-Za-z0-9']*\b/g) ?? [];
    const unknown = [...new Set(tokens.filter((token) => !symbolKeys.has(token) && !ignored.has(token)))];
    if (unknown.length) {
      checks.push({ id: `symbol-${step.id}`, severity: 'warning', title: '发现未定义符号', detail: `步骤 ${index + 1} 使用了：${unknown.join('、')}`, stepId: step.id });
    }

    step.references.forEach((reference) => {
      if (!ids.has(reference)) {
        checks.push({ id: `missing-${step.id}-${reference}`, severity: 'error', title: '引用步骤不存在', detail: `步骤 ${index + 1} 引用了已删除的步骤 ${reference}`, stepId: step.id });
      }
    });

    if (isPremiseAxiom(step)) return;

    // 规则包引用检查：没有绑定、没有来源快照、槽位未绑定或绑定失效都不能通过。
    const binding = step.binding;
    if (!binding) {
      checks.push({ id: `binding-none-${step.id}`, severity: 'error', title: '缺少规则包引用', detail: `步骤 ${index + 1} 只记录了规则名称「${step.rule}」，请在检查器中绑定规则与槽位。`, stepId: step.id });
      return;
    }
    if (!binding.snapshot) {
      checks.push({ id: `binding-source-${step.id}`, severity: 'error', title: '待确认映射未解析来源', detail: `步骤 ${index + 1} 的规则名称「${binding.legacyRuleName ?? step.rule}」在多个规则包中存在同名规则，请选择来源后再绑定槽位。`, stepId: step.id });
      return;
    }
    const slotIssues = validateBinding(binding, step, document);
    if (binding.status === 'stale') {
      checks.push({
        id: `binding-stale-${step.id}`,
        severity: 'error',
        title: '引用依据待复核',
        detail: `步骤 ${index + 1} 引用的「${binding.snapshot.ruleName}」所在规则包已更新（原 ${binding.snapshot.packVersion}），原绑定已保留，逐条确认后方可导出。`,
        stepId: step.id,
      });
    }
    slotIssues.forEach((issue) => {
      checks.push({ id: `slot-${step.id}-${issue.slotId}`, severity: 'error', title: '规则槽位未通过检查', detail: `步骤 ${index + 1}：${issue.message}`, stepId: step.id });
    });
    if (binding.status === 'pending' && !slotIssues.length) {
      checks.push({ id: `binding-pending-${step.id}`, severity: 'warning', title: '规则引用待确认', detail: `步骤 ${index + 1} 的槽位已绑定，确认「${binding.snapshot.ruleName}」依据后即可导出。`, stepId: step.id });
    }

    // 前提槽绑定的步骤应出现在本步之前。
    const currentIndex = index;
    const rule = binding.snapshot.rule;
    rule.slots.forEach((slot) => {
      if (slot.kind !== 'premise') return;
      const boundId = binding.slots[slot.id];
      const boundIndex = document.steps.findIndex((item) => item.id === boundId);
      if (boundIndex >= currentIndex) {
        checks.push({ id: `slot-order-${step.id}-${slot.id}`, severity: 'warning', title: '前提槽引用了后续步骤', detail: `步骤 ${index + 1} 的「${slot.label}」应绑定出现在它之前的步骤。`, stepId: step.id });
      }
    });
  });

  const graph = new Map(document.steps.map((step) => [step.id, step.references.filter((id) => ids.has(id))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleStep = new Set<string>();
  const visit = (id: string, path: string[]): boolean => {
    if (visiting.has(id)) {
      path.slice(path.indexOf(id)).forEach((item) => cycleStep.add(item));
      return true;
    }
    if (visited.has(id)) return false;
    visiting.add(id);
    const hasCycle = (graph.get(id) ?? []).some((next) => visit(next, [...path, id]));
    visiting.delete(id);
    visited.add(id);
    return hasCycle;
  };
  [...graph.keys()].forEach((id) => visit(id, []));
  if (cycleStep.size) {
    checks.push({ id: 'cycle', severity: 'error', title: '检测到循环引用', detail: '引用链形成闭环，请调整步骤关系。', stepId: [...cycleStep][0] });
  }

  const goalStep = document.steps.find((step) => step.type === 'goal' && step.rule === '结论');
  if (!goalStep) {
    checks.push({ id: 'goal-missing', severity: 'error', title: '目标未被证明', detail: '请添加“结论”类型的最终步骤。' });
  } else if (goalStep.references.length === 0) {
    checks.push({ id: 'goal-unlinked', severity: 'warning', title: '结论尚无推导支撑', detail: '最终步骤没有引用任何前置步骤。', stepId: goalStep.id });
  }

  if (!checks.some((check) => check.severity === 'error')) {
    checks.push({ id: 'proof-ok', severity: 'info', title: '结构检查通过', detail: '未发现缺失引用、循环引用、未证明目标或失效的规则引用。' });
  }
  return checks;
}

export function compareVersion(document: ProofDocument, version: ProofVersion) {
  const result = [];
  const size = Math.max(document.steps.length, version.steps.length);
  for (let index = 0; index < size; index += 1) {
    const before = version.steps[index]?.statement ?? '';
    const after = document.steps[index]?.statement ?? '';
    const kind = !before ? 'added' : !after ? 'removed' : before === after ? 'same' : 'changed';
    result.push({ kind, label: `步骤 ${index + 1}`, before, after } as const);
  }
  return result;
}

export function createId(prefix: string): string {
  return uid(prefix);
}
