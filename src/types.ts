export type StepType = 'premise' | 'derivation' | 'goal';
export type CheckSeverity = 'error' | 'warning' | 'info';

export interface RuleSlot {
  id: string;
  label: string;
}

/** 规则在某个时刻的内容（前提槽、结论槽、符号环境与规则陈述）。 */
export interface RuleContent {
  statement: string;
  premiseSlots: RuleSlot[];
  conclusionSlots: RuleSlot[];
  symbols: Record<string, string>;
}

export interface RuleDefinition extends RuleContent {
  id: string;
  name: string;
}

export interface RulePackage {
  id: string;
  name: string;
  version: string;
  builtin: boolean;
  /** 与本包互斥的规则包（按 id 或名称声明），不能在同一证明中混用。 */
  conflictsWith: string[];
  rules: RuleDefinition[];
  importedAt: string;
}

export type BindingStatus = 'ok' | 'pending';
/** 由绑定与当前规则包内容推导出的有效状态。 */
export type EffectiveBindingStatus = 'ok' | 'pending' | 'stale' | 'orphan' | 'unbound';

/** 步骤对规则包中某条规则的引用，固定了当时的规则内容。 */
export interface RuleBinding {
  packageId: string;
  packageName: string;
  packageVersion: string;
  ruleId: string;
  ruleName: string;
  status: BindingStatus;
  /** 绑定时刻的规则内容快照，包更新后用于比对与复核。 */
  snapshot: RuleContent;
  /** 槽位绑定：槽位 id → 步骤 id（结论槽固定指向本步骤）。 */
  slots: Record<string, string>;
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
