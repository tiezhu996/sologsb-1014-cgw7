import { redraw } from 'mithril';
import type {
  EffectiveBindingStatus,
  ProofCheck,
  ProofDocument,
  ProofStep,
  ProofVersion,
  RuleBinding,
  RuleContent,
  RuleDefinition,
  RulePackage,
  RuleSlot,
} from './types';

const STORAGE_KEY = 'sologsb-1014-proof-workspace-v1';
const PACKAGE_KEY = 'sologsb-1014-rule-packages-v1';
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T>(value: T): T => structuredClone(value);

const slot = (id: string, label: string): RuleSlot => ({ id, label });

export const contentOf = (rule: RuleDefinition): RuleContent =>
  clone({
    statement: rule.statement,
    premiseSlots: rule.premiseSlots,
    conclusionSlots: rule.conclusionSlots,
    symbols: rule.symbols,
  });

/** 规则内容的指纹：名称、陈述、槽位与符号环境任一变化都会改变。 */
export const ruleContentKey = (name: string, content: RuleContent): string =>
  JSON.stringify([name, content.statement, content.premiseSlots, content.conclusionSlots, content.symbols]);

export const ruleKey = (rule: RuleDefinition): string => ruleContentKey(rule.name, rule);
export const bindingKey = (binding: RuleBinding): string => ruleContentKey(binding.ruleName, binding.snapshot);

export const BUILTIN_PACKAGES: RulePackage[] = [
  {
    id: 'pkg-core',
    name: '基础结构',
    version: '1.0',
    builtin: true,
    conflictsWith: [],
    importedAt: '',
    rules: [
      { id: 'rule-premise', name: '前提', statement: '直接引入的假设，无需推导。', premiseSlots: [], conclusionSlots: [slot('claim', '前提命题')], symbols: {} },
      { id: 'rule-goal', name: '结论', statement: '由支撑步骤得到最终目标。', premiseSlots: [slot('support', '支撑推导')], conclusionSlots: [slot('claim', '结论命题')], symbols: {} },
    ],
  },
  {
    id: 'pkg-algebra',
    name: '初等代数公理',
    version: '1.0',
    builtin: true,
    conflictsWith: [],
    importedAt: '',
    rules: [
      { id: 'rule-expand', name: '定义展开', statement: '按定义把记号展开为基本形式。', premiseSlots: [slot('definition', '定义式')], conclusionSlots: [slot('expanded', '展开式')], symbols: {} },
      { id: 'rule-substitute', name: '代入', statement: '把等式的一边代入另一表达式。', premiseSlots: [slot('equation', '等式'), slot('target', '目标式')], conclusionSlots: [slot('result', '代入结果')], symbols: {} },
      { id: 'rule-rewrite', name: '等式变形', statement: '等式两边施以相同运算。', premiseSlots: [slot('source', '原等式')], conclusionSlots: [slot('derived', '变形结果')], symbols: {} },
      { id: 'rule-distribute', name: '分配律', statement: '$a(b+c)=ab+ac$', premiseSlots: [slot('product', '乘积式')], conclusionSlots: [slot('sum', '展开和')], symbols: { a: '任意项', b: '任意项', c: '任意项' } },
      { id: 'rule-combine', name: '同类项合并', statement: '合并同类项并化简系数。', premiseSlots: [slot('sum', '和式')], conclusionSlots: [slot('merged', '合并结果')], symbols: {} },
    ],
  },
  {
    id: 'pkg-methods-classic',
    name: '经典证明方法',
    version: '1.0',
    builtin: true,
    conflictsWith: ['pkg-methods-intuitionistic'],
    importedAt: '',
    rules: [
      { id: 'rule-induction', name: '数学归纳', statement: '由基例与归纳步骤得到全称结论。', premiseSlots: [slot('base', '基例'), slot('inductive', '归纳步骤')], conclusionSlots: [slot('forall', '全称结论')], symbols: { P: '关于正整数的命题', n: '正整数', k: '正整数' } },
      { id: 'rule-contradiction', name: '反证法', statement: '假设否定成立并导出矛盾。', premiseSlots: [slot('contradiction', '矛盾式')], conclusionSlots: [slot('negation', '否定成立')], symbols: {} },
      { id: 'rule-construction', name: '构造法', statement: '给出具体构造以证明存在性。', premiseSlots: [slot('construction', '构造对象')], conclusionSlots: [slot('exists', '存在性结论')], symbols: {} },
    ],
  },
];

/** 可供导入的示例包：演示同名规则、互斥包与包更新。 */
export const SAMPLE_PACKAGES: RulePackage[] = [
  {
    id: 'pkg-algebra-extended',
    name: '代数恒等式扩展',
    version: '1.0',
    builtin: false,
    conflictsWith: [],
    importedAt: '',
    rules: [
      { id: 'rule-distribute-ext', name: '分配律', statement: '$(a+b)(c+d)=ac+ad+bc+bd$', premiseSlots: [slot('left', '左因式'), slot('right', '右因式')], conclusionSlots: [slot('sum', '展开和')], symbols: { a: '任意项', b: '任意项', c: '任意项', d: '任意项' } },
      { id: 'rule-square-diff', name: '平方差公式', statement: '$a^2-b^2=(a+b)(a-b)$', premiseSlots: [slot('difference', '平方差式')], conclusionSlots: [slot('factored', '因式分解结果')], symbols: { a: '任意项', b: '任意项' } },
      { id: 'rule-square-sum', name: '完全平方公式', statement: '$(a+b)^2=a^2+2ab+b^2$', premiseSlots: [slot('square', '平方式')], conclusionSlots: [slot('expanded', '展开式')], symbols: { a: '任意项', b: '任意项' } },
    ],
  },
  {
    id: 'pkg-methods-intuitionistic',
    name: '直觉主义证明方法',
    version: '1.0',
    builtin: false,
    conflictsWith: ['pkg-methods-classic'],
    importedAt: '',
    rules: [
      { id: 'rule-induction-int', name: '数学归纳', statement: '直觉主义数学归纳（可构造版本）。', premiseSlots: [slot('base', '基例'), slot('inductive', '归纳步骤')], conclusionSlots: [slot('forall', '全称结论')], symbols: { P: '可构造命题', n: '自然数', k: '自然数' } },
      { id: 'rule-construction-int', name: '构造法', statement: '构造即证明。', premiseSlots: [slot('construction', '构造对象')], conclusionSlots: [slot('exists', '存在性结论')], symbols: {} },
    ],
  },
  {
    id: 'pkg-algebra',
    name: '初等代数公理',
    version: '1.1',
    builtin: false,
    conflictsWith: [],
    importedAt: '',
    rules: [
      { id: 'rule-expand', name: '定义展开', statement: '按定义把记号展开为基本形式。', premiseSlots: [slot('definition', '定义式')], conclusionSlots: [slot('expanded', '展开式')], symbols: {} },
      { id: 'rule-substitute', name: '代入', statement: '把等式的一边代入另一表达式。', premiseSlots: [slot('equation', '等式'), slot('target', '目标式')], conclusionSlots: [slot('result', '代入结果')], symbols: {} },
      { id: 'rule-rewrite', name: '等式变形', statement: '等式两边施以相同运算。', premiseSlots: [slot('source', '原等式')], conclusionSlots: [slot('derived', '变形结果')], symbols: {} },
      { id: 'rule-distribute', name: '分配律', statement: '$a(b+c)=ab+ac$（v1.1：拆分为左右两个前提槽）', premiseSlots: [slot('factor', '公因式'), slot('terms', '和式')], conclusionSlots: [slot('sum', '展开和')], symbols: { a: '任意项', b: '任意项', c: '任意项' } },
      { id: 'rule-combine', name: '同类项合并', statement: '合并同类项并化简系数。', premiseSlots: [slot('sum', '和式')], conclusionSlots: [slot('merged', '合并结果')], symbols: {} },
    ],
  },
];

export function packagesConflict(a: RulePackage, b: RulePackage): boolean {
  return (
    a.conflictsWith.includes(b.id) ||
    a.conflictsWith.includes(b.name) ||
    b.conflictsWith.includes(a.id) ||
    b.conflictsWith.includes(a.name)
  );
}

function createBindingFor(pkg: RulePackage, rule: RuleDefinition, stepId: string, references: string[], status: RuleBinding['status'] = 'ok'): RuleBinding {
  const slots: Record<string, string> = {};
  rule.conclusionSlots.forEach((item) => {
    slots[item.id] = stepId;
  });
  rule.premiseSlots.forEach((item, index) => {
    const reference = references[index];
    if (reference) slots[item.id] = reference;
  });
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    packageVersion: pkg.version,
    ruleId: rule.id,
    ruleName: rule.name,
    status,
    snapshot: contentOf(rule),
    slots,
  };
}

export function effectiveBindingStatus(step: ProofStep, packages: RulePackage[]): EffectiveBindingStatus {
  const binding = step.binding;
  if (!binding) return 'unbound';
  const pkg = packages.find((item) => item.id === binding.packageId);
  const rule = pkg?.rules.find((item) => item.id === binding.ruleId);
  if (!pkg || !rule) return 'orphan';
  if (binding.status === 'pending') return 'pending';
  return ruleKey(rule) === bindingKey(binding) ? 'ok' : 'stale';
}

/** 旧证明兼容：为缺少绑定的步骤按规则名称生成待确认映射。 */
export function migrateDocuments(documents: ProofDocument[], packages: RulePackage[]): boolean {
  let changed = false;
  const findByName = (name: string): { pkg: RulePackage; rule: RuleDefinition } | undefined => {
    const ordered = [...packages].sort((a, b) => Number(b.builtin) - Number(a.builtin));
    for (const pkg of ordered) {
      const rule = pkg.rules.find((item) => item.name === name);
      if (rule) return { pkg, rule };
    }
    return undefined;
  };
  documents.forEach((document) => {
    document.steps.forEach((step) => {
      if (step.binding) return;
      const hit = findByName(step.rule);
      if (!hit) return;
      step.binding = createBindingFor(hit.pkg, hit.rule, step.id, step.references, 'pending');
      changed = true;
    });
  });
  return changed;
}

export function parseRulePackage(text: string): RulePackage | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`;
  }
  const fail = (message: string) => `规则包格式不正确：${message}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('内容必须是 JSON 对象');
  const data = raw as Record<string, unknown>;
  if (typeof data.id !== 'string' || !data.id.trim()) return fail('缺少包 id');
  if (typeof data.name !== 'string' || !data.name.trim()) return fail('缺少包名称');
  if (typeof data.version !== 'string' || !data.version.trim()) return fail('缺少版本号 version');
  if (!Array.isArray(data.rules) || data.rules.length === 0) return fail('rules 必须是非空数组');
  const conflictsWith = Array.isArray(data.conflictsWith) ? data.conflictsWith.filter((item): item is string => typeof item === 'string') : [];
  const rules: RuleDefinition[] = [];
  const readSlots = (value: unknown, label: string): RuleSlot[] | string => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return `${label} 必须是数组`;
    const slots: RuleSlot[] = [];
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== 'object') return `${label} 第 ${index + 1} 项必须是对象`;
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== 'string' || !entry.id.trim()) return `${label} 第 ${index + 1} 项缺少 id`;
      slots.push({ id: entry.id, label: typeof entry.label === 'string' && entry.label.trim() ? entry.label : entry.id });
    }
    return slots;
  };
  for (const [index, item] of data.rules.entries()) {
    if (!item || typeof item !== 'object') return fail(`第 ${index + 1} 条规则必须是对象`);
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id.trim()) return fail(`第 ${index + 1} 条规则缺少 id`);
    if (typeof entry.name !== 'string' || !entry.name.trim()) return fail(`第 ${index + 1} 条规则缺少名称`);
    const premiseSlots = readSlots(entry.premiseSlots, `规则「${entry.name}」的 premiseSlots`);
    if (typeof premiseSlots === 'string') return fail(premiseSlots);
    const conclusionSlots = readSlots(entry.conclusionSlots, `规则「${entry.name}」的 conclusionSlots`);
    if (typeof conclusionSlots === 'string') return fail(conclusionSlots);
    const symbols: Record<string, string> = {};
    if (entry.symbols !== undefined) {
      if (!entry.symbols || typeof entry.symbols !== 'object' || Array.isArray(entry.symbols)) return fail(`规则「${entry.name}」的 symbols 必须是对象`);
      Object.entries(entry.symbols as Record<string, unknown>).forEach(([key, value]) => {
        symbols[key] = typeof value === 'string' ? value : String(value);
      });
    }
    rules.push({
      id: entry.id,
      name: entry.name,
      statement: typeof entry.statement === 'string' ? entry.statement : '',
      premiseSlots,
      conclusionSlots,
      symbols,
    });
  }
  return {
    id: data.id.trim(),
    name: data.name.trim(),
    version: data.version.trim(),
    builtin: false,
    conflictsWith,
    rules,
    importedAt: new Date().toISOString(),
  };
}

function makeStep(id: string, type: ProofStep['type'], statement: string, packageId: string, ruleId: string, references: string[], extra: Partial<ProofStep> = {}, bindingStatus: RuleBinding['status'] = 'ok'): ProofStep {
  const pkg = BUILTIN_PACKAGES.find((item) => item.id === packageId);
  const rule = pkg?.rules.find((item) => item.id === ruleId);
  const step: ProofStep = {
    id,
    type,
    statement,
    rule: rule?.name ?? '',
    references,
    note: '',
    counterexample: '',
    alternative: '',
    ...extra,
  };
  if (pkg && rule) step.binding = createBindingFor(pkg, rule, id, references, bindingStatus);
  return step;
}

function sampleSteps(): ProofStep[] {
  return [
    makeStep('s1', 'premise', '$a,b$ 是实数', 'pkg-core', 'rule-premise', [], { note: '采用实数域中的交换律与分配律。' }),
    makeStep('s2', 'derivation', '$(a+b)^2=(a+b)(a+b)$', 'pkg-algebra', 'rule-expand', ['s1'], { note: '把平方写成两个相同因式之积。' }),
    makeStep('s3', 'derivation', '$(a+b)(a+b)=a^2+ab+ba+b^2$', 'pkg-algebra', 'rule-distribute', ['s2'], { alternative: '也可先展开后半部分。' }),
    makeStep('s4', 'derivation', '$a^2+ab+ba+b^2=a^2+2ab+b^2$', 'pkg-algebra', 'rule-combine', ['s3'], { note: '由实数的交换律，$ab=ba$。' }),
    makeStep('s5', 'goal', '$(a+b)^2=a^2+2ab+b^2$', 'pkg-core', 'rule-goal', ['s4'], { note: '目标已由步骤 1 至 4 逐项推出。' }),
  ];
}

function issueSteps(): ProofStep[] {
  return [
    makeStep('i1', 'premise', '$n$ 是正整数', 'pkg-core', 'rule-premise', [], {}, 'pending'),
    makeStep('i2', 'derivation', '$P(1)$ 成立', 'pkg-core', 'rule-premise', ['i1'], { note: '归纳基例。' }, 'pending'),
    makeStep('i3', 'derivation', '若 $P(k)$ 成立，则 $P(k+1)$ 也成立', 'pkg-methods-classic', 'rule-induction', ['i2', 'missing-step'], { note: '这里故意保留一个失效引用，用于演示检查。' }, 'pending'),
    makeStep('i4', 'goal', '$P(n)$ 对所有正整数 $n$ 成立', 'pkg-core', 'rule-goal', ['i3'], { note: '尚未补齐归纳假设。' }, 'pending'),
  ];
}

function initialDocuments(): ProofDocument[] {
  const now = new Date().toISOString();
  return [
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
}

function loadDocuments(): ProofDocument[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialDocuments();
    const parsed = JSON.parse(raw) as ProofDocument[];
    return Array.isArray(parsed) && parsed.length ? parsed : initialDocuments();
  } catch {
    return initialDocuments();
  }
}

function loadPackages(): RulePackage[] {
  let saved: RulePackage[] = [];
  try {
    const raw = localStorage.getItem(PACKAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RulePackage[];
      if (Array.isArray(parsed)) saved = parsed;
    }
  } catch {
    saved = [];
  }
  const registry = [...saved];
  // 内置包按代码版本补种；注册表中已有同 id 条目（含用户更新过的）则保留注册表内容。
  [...BUILTIN_PACKAGES].reverse().forEach((builtin) => {
    if (!registry.some((item) => item.id === builtin.id)) registry.unshift(clone(builtin));
  });
  return registry;
}

export class ProofStore {
  documents = loadDocuments();
  packages = loadPackages();
  activeId = this.documents[0]?.id ?? '';
  selectedStepId = this.documents[0]?.steps[0]?.id ?? '';
  compareVersionId = '';
  dragStepId = '';
  expandedPackageId = '';
  lastInput: HTMLTextAreaElement | HTMLInputElement | null = null;
  undoStack: ProofDocument[][] = [];
  redoStack: ProofDocument[][] = [];
  toast = '';

  constructor() {
    if (migrateDocuments(this.documents, this.packages)) this.save();
  }

  get current(): ProofDocument {
    return this.documents.find((item) => item.id === this.activeId) ?? this.documents[0];
  }

  get selectedStep(): ProofStep | undefined {
    return this.current?.steps.find((step) => step.id === this.selectedStepId);
  }

  get checks(): ProofCheck[] {
    if (!this.current) return [];
    return validate(this.current, this.packages);
  }

  /** 绑定未得到确认（待复核 / 待确认 / 来源缺失 / 未绑定）的步骤。 */
  get unconfirmedSteps(): ProofStep[] {
    if (!this.current) return [];
    return this.current.steps.filter((step) => effectiveBindingStatus(step, this.packages) !== 'ok');
  }

  get canExport(): boolean {
    return this.unconfirmedSteps.length === 0;
  }

  save(): void {
    this.current.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
    localStorage.setItem(PACKAGE_KEY, JSON.stringify(this.packages));
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
    const stepId = uid('step');
    const document: ProofDocument = {
      id,
      title: '未命名证明',
      author: '本地用户',
      goal: '$A=B$',
      symbols: { A: '待定义对象', B: '待定义对象' },
      steps: [makeStep(stepId, 'premise', '在这里输入前提', 'pkg-core', 'rule-premise', [])],
      versions: [],
      updatedAt: new Date().toISOString(),
    };
    this.undoStack.push(clone(this.documents));
    this.documents.unshift(document);
    this.activeId = id;
    this.selectedStepId = stepId;
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

  addStep(type: ProofStep['type'] = 'derivation'): void {
    const id = uid('step');
    const references = this.selectedStepId && type !== 'premise' ? [this.selectedStepId] : [];
    const [packageId, ruleId] = type === 'goal' ? ['pkg-core', 'rule-goal'] : type === 'premise' ? ['pkg-core', 'rule-premise'] : ['pkg-algebra', 'rule-rewrite'];
    const step = makeStep(id, type, type === 'goal' ? '$A=B$' : '输入新的推导式', packageId, ruleId, references);
    this.update((document) => {
      const selectedIndex = document.steps.findIndex((item) => item.id === this.selectedStepId);
      document.steps.splice(type === 'goal' ? document.steps.length : selectedIndex + 1, 0, step);
    });
    this.selectedStepId = step.id;
  }

  removeStep(id: string): void {
    this.update((document) => {
      document.steps = document.steps.filter((step) => step.id !== id);
      document.steps.forEach((step) => {
        step.references = step.references.filter((reference) => reference !== id);
        if (step.binding) {
          Object.keys(step.binding.slots).forEach((slotId) => {
            if (step.binding!.slots[slotId] === id) delete step.binding!.slots[slotId];
          });
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

  /** 把步骤绑定到规则包中的规则；冲突包不能在同一证明中混用。 */
  bindRule(stepId: string, packageId: string, ruleId: string): void {
    const pkg = this.packages.find((item) => item.id === packageId);
    const rule = pkg?.rules.find((item) => item.id === ruleId);
    if (!pkg || !rule || !this.current) return;
    const clash = this.packages.find(
      (other) =>
        other.id !== pkg.id &&
        packagesConflict(pkg, other) &&
        this.current.steps.some((step) => step.id !== stepId && step.binding?.packageId === other.id),
    );
    if (clash) {
      this.notify(`规则包冲突：「${pkg.name}」与「${clash.name}」不能在同一证明中混用`);
      return;
    }
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      if (!step) return;
      step.binding = createBindingFor(pkg, rule, step.id, step.references);
      step.rule = rule.name;
    });
  }

  assignSlot(stepId: string, slotId: string, targetStepId: string): void {
    this.update((document) => {
      const step = document.steps.find((item) => item.id === stepId);
      if (!step?.binding) return;
      if (targetStepId) step.binding.slots[slotId] = targetStepId;
      else delete step.binding.slots[slotId];
    });
  }

  /** 逐条确认：把绑定对齐到规则包当前内容并标记为有效。 */
  confirmBinding(stepId: string): void {
    const step = this.current?.steps.find((item) => item.id === stepId);
    if (!step?.binding) return;
    const pkg = this.packages.find((item) => item.id === step.binding!.packageId);
    const rule = pkg?.rules.find((item) => item.id === step.binding!.ruleId);
    if (!pkg || !rule) {
      this.notify('来源规则包或规则缺失，请重新绑定');
      return;
    }
    this.update((document) => {
      const target = document.steps.find((item) => item.id === stepId);
      if (!target?.binding) return;
      target.binding.snapshot = contentOf(rule);
      target.binding.packageName = pkg.name;
      target.binding.packageVersion = pkg.version;
      target.binding.ruleName = rule.name;
      target.binding.status = 'ok';
      target.rule = rule.name;
    });
    this.notify(`已确认：${rule.name} · ${pkg.name} v${pkg.version}`);
  }

  installPackage(pkg: RulePackage): string {
    const existing = this.packages.find((item) => item.id === pkg.id);
    let affected = 0;
    this.documents.forEach((document) => {
      document.steps.forEach((step) => {
        const binding = step.binding;
        if (!binding || binding.packageId !== pkg.id) return;
        const rule = pkg.rules.find((item) => item.id === binding.ruleId);
        if (!rule || ruleKey(rule) !== bindingKey(binding)) affected += 1;
      });
    });
    const entry: RulePackage = {
      ...clone(pkg),
      builtin: (existing?.builtin ?? false) || pkg.builtin,
      importedAt: new Date().toISOString(),
    };
    if (existing) this.packages[this.packages.indexOf(existing)] = entry;
    else this.packages.push(entry);
    this.save();
    const message = existing
      ? `已更新「${entry.name}」至 v${entry.version}，${affected} 个步骤被标记为待复核`
      : `已导入「${entry.name}」（${entry.rules.length} 条规则）`;
    this.notify(message);
    return message;
  }

  importPackageText(text: string): { ok: boolean; message: string } {
    const parsed = parseRulePackage(text);
    if (typeof parsed === 'string') return { ok: false, message: parsed };
    return { ok: true, message: this.installPackage(parsed) };
  }

  installSample(packageId: string): string {
    const sample = SAMPLE_PACKAGES.find((item) => item.id === packageId);
    if (!sample) return '未找到示例规则包';
    return this.installPackage(sample);
  }

  removePackage(id: string): void {
    const pkg = this.packages.find((item) => item.id === id);
    if (!pkg) return;
    if (pkg.builtin) {
      this.notify('内置规则包不能移除');
      return;
    }
    if (this.documents.some((document) => document.steps.some((step) => step.binding?.packageId === id))) {
      this.notify(`「${pkg.name}」仍被证明引用，不能移除`);
      return;
    }
    this.packages = this.packages.filter((item) => item.id !== id);
    if (this.expandedPackageId === id) this.expandedPackageId = '';
    this.save();
    this.notify(`已移除规则包「${pkg.name}」`);
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
    }, 2200);
  }
}

function stripLatexCommands(text: string): string {
  return text.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}_^]/g, ' ');
}

export function validate(document: ProofDocument, packages: RulePackage[]): ProofCheck[] {
  const checks: ProofCheck[] = [];
  const ids = new Set(document.steps.map((step) => step.id));
  const symbolKeys = new Set(Object.keys(document.symbols));
  const ignored = new Set(['a', 'A', 'b', 'B', 'n', 'k', 'P', 'Q', 'R', 'x', 'y', 'to', 'text', 'frac', 'sqrt']);

  document.steps.forEach((step, index) => {
    // 绑定规则的符号环境并入该步骤的可用符号
    const envSymbols = step.binding ? Object.keys(step.binding.snapshot.symbols) : [];
    const allowed = new Set([...symbolKeys, ...envSymbols]);
    const tokens = stripLatexCommands(step.statement).match(/\b[A-Za-z][A-Za-z0-9']*\b/g) ?? [];
    const unknown = [...new Set(tokens.filter((token) => !allowed.has(token) && !ignored.has(token)))];
    if (unknown.length) {
      checks.push({ id: `symbol-${step.id}`, severity: 'warning', title: '发现未定义符号', detail: `步骤 ${index + 1} 使用了：${unknown.join('、')}`, stepId: step.id });
    }

    step.references.forEach((reference) => {
      if (!ids.has(reference)) {
        checks.push({ id: `missing-${step.id}-${reference}`, severity: 'error', title: '引用步骤不存在', detail: `步骤 ${index + 1} 引用了已删除的步骤 ${reference}`, stepId: step.id });
      }
    });

    const status = effectiveBindingStatus(step, packages);
    if (status === 'unbound') {
      checks.push({ id: `binding-unbound-${step.id}`, severity: 'error', title: '步骤未绑定规则包', detail: `步骤 ${index + 1} 只记录了规则名「${step.rule}」，请在检查器中绑定规则包中的规则。`, stepId: step.id });
      return;
    }
    const binding = step.binding!;
    const pkg = packages.find((item) => item.id === binding.packageId);
    const rule = pkg?.rules.find((item) => item.id === binding.ruleId);

    if (status === 'orphan') {
      checks.push({ id: `binding-orphan-${step.id}`, severity: 'error', title: '规则来源缺失', detail: `步骤 ${index + 1} 绑定的「${binding.ruleName} · ${binding.packageName} v${binding.packageVersion}」已找不到来源，请重新绑定。`, stepId: step.id });
    } else if (status === 'stale') {
      checks.push({ id: `binding-stale-${step.id}`, severity: 'error', title: '规则包已更新，步骤待复核', detail: `步骤 ${index + 1} 的「${binding.ruleName}」绑定于「${binding.packageName} v${binding.packageVersion}」，与当前 v${pkg!.version} 内容不一致；原绑定保留，请逐条确认。`, stepId: step.id });
    } else if (status === 'pending') {
      checks.push({ id: `binding-pending-${step.id}`, severity: 'warning', title: '规则映射待确认', detail: `步骤 ${index + 1} 由旧规则名「${binding.ruleName}」自动映射到「${binding.packageName}」，请核对来源与槽位后确认。`, stepId: step.id });
    }

    const content: RuleContent = rule ?? binding.snapshot;
    content.premiseSlots.forEach((slotItem) => {
      const target = binding.slots[slotItem.id];
      if (!target) {
        checks.push({ id: `slot-empty-${step.id}-${slotItem.id}`, severity: 'error', title: '前提槽未绑定', detail: `步骤 ${index + 1} 的前提槽「${slotItem.label}」尚未绑定依据步骤。`, stepId: step.id });
      } else if (!ids.has(target)) {
        checks.push({ id: `slot-dangling-${step.id}-${slotItem.id}`, severity: 'error', title: '槽位指向已删除步骤', detail: `步骤 ${index + 1} 的前提槽「${slotItem.label}」指向不存在的步骤 ${target}。`, stepId: step.id });
      } else if (!step.references.includes(target)) {
        checks.push({ id: `slot-ref-${step.id}-${slotItem.id}`, severity: 'warning', title: '槽位依据未列入引用', detail: `步骤 ${index + 1} 的前提槽「${slotItem.label}」绑定了步骤，但未勾选为引用步骤。`, stepId: step.id });
      }
    });
    content.conclusionSlots.forEach((slotItem) => {
      if (binding.slots[slotItem.id] !== step.id) {
        checks.push({ id: `slot-conclusion-${step.id}-${slotItem.id}`, severity: 'error', title: '结论槽未绑定本步骤', detail: `步骤 ${index + 1} 的结论槽「${slotItem.label}」必须绑定到本步骤。`, stepId: step.id });
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

  const usedPackageIds = [...new Set(document.steps.map((step) => step.binding?.packageId).filter((id): id is string => Boolean(id)))];
  const usedPackages = packages.filter((pkg) => usedPackageIds.includes(pkg.id));
  usedPackages.forEach((a, i) => {
    usedPackages.slice(i + 1).forEach((b) => {
      if (packagesConflict(a, b)) {
        checks.push({ id: `pkg-conflict-${a.id}-${b.id}`, severity: 'error', title: '规则包冲突', detail: `「${a.name}」与「${b.name}」声明互斥，不能在同一证明中混用。` });
      }
    });
  });

  const goalStep = document.steps.find((step) => step.type === 'goal' && step.rule === '结论');
  if (!goalStep) {
    checks.push({ id: 'goal-missing', severity: 'error', title: '目标未被证明', detail: '请添加“结论”类型的最终步骤。' });
  } else if (goalStep.references.length === 0) {
    checks.push({ id: 'goal-unlinked', severity: 'warning', title: '结论尚无推导支撑', detail: '最终步骤没有引用任何前置步骤。', stepId: goalStep.id });
  }

  if (!checks.some((check) => check.severity === 'error')) {
    checks.push({ id: 'proof-ok', severity: 'info', title: '结构检查通过', detail: '未发现缺失引用、循环引用或未证明目标。' });
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
