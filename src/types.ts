export type StepType = 'premise' | 'derivation' | 'goal';
export type CheckSeverity = 'error' | 'warning' | 'info';

/** 槽位种类：前提槽引用某个前置步骤，结论槽对应本步命题，符号槽对应文档符号表。 */
export type SlotKind = 'premise' | 'conclusion' | 'symbol';

export interface RuleSlot {
  id: string;
  kind: SlotKind;
  label: string;
  required: boolean;
  /** premise 槽的提示语；conclusion 槽通常固定为“本步命题”。 */
  hint?: string;
}

export interface RuleSymbol {
  /** 规则内部使用的符号记号，如 a、b、n。 */
  token: string;
  label: string;
}

export interface RuleDef {
  id: string;
  name: string;
  description: string;
  slots: RuleSlot[];
  symbols: RuleSymbol[];
}

export interface RulePack {
  id: string;
  name: string;
  version: string;
  description: string;
  /** 与本包不能在同一证明中混用的其他规则包 id。 */
  conflictsWith: string[];
  rules: RuleDef[];
  builtin?: boolean;
}

/** 引用时固定下来的规则内容，规则包之后更新也不改变历史依据。 */
export interface RuleSnapshot {
  packId: string;
  packName: string;
  packVersion: string;
  ruleId: string;
  ruleName: string;
  rule: RuleDef;
  contentHash: string;
}

export type BindingStatus = 'pending' | 'confirmed' | 'stale';

export interface RuleBinding {
  /** 槽位 id -> 前提槽绑定步骤 id；conclusion 槽固定 __statement__；symbol 槽绑定符号表键名。 */
  slots: Record<string, string>;
  status: BindingStatus;
  /** 引用成立时固定的规则内容；旧证明的兼容映射可能尚未解析出快照。 */
  snapshot: RuleSnapshot | null;
  /** 兼容旧证明：仅有规则名称、尚未解析到规则包时保留的名称。 */
  legacyRuleName?: string;
  updatedAt: string;
}

export interface ProofStep {
  id: string;
  type: StepType;
  statement: string;
  rule: string;
  references: string[];
  note: string;
  counterexample: string;
  alternative: string;
  /** 对规则包中某条规则的具名引用（含槽位绑定与内容快照）；旧数据可能为空。 */
  binding?: RuleBinding;
}

export interface ProofVersion {
  id: string;
  name: string;
  createdAt: string;
  steps: ProofStep[];
  goal: string;
}

export interface ProofDocument {
  id: string;
  title: string;
  author: string;
  goal: string;
  symbols: Record<string, string>;
  steps: ProofStep[];
  versions: ProofVersion[];
  updatedAt: string;
}

export interface ProofCheck {
  id: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
  stepId?: string;
}

export interface ProofDiff {
  kind: 'same' | 'added' | 'removed' | 'changed';
  label: string;
  before: string;
  after: string;
}
