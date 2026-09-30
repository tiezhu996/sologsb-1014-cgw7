import type { RuleDef, RulePack, RuleSlot, RuleSnapshot, RuleSymbol } from './types';

const PACK_STORAGE_KEY = 'sologsb-1014-rule-packs-v1';

/** 简单稳定哈希：仅用于判断规则内容是否随包更新而变化。先按键名规范化，避免 JSON 键序导致误判。 */
export function contentHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

const premiseSlot = (id: string, label: string, hint: string, required = true): RuleSlot => ({ id, kind: 'premise', label, hint, required });
const conclusionSlot = (): RuleSlot => ({ id: 'conclusion', kind: 'conclusion', label: '本步命题', required: true, hint: '由当前步骤的命题自动填充' });
const symbolSlot = (token: string, label: string): RuleSlot => ({ id: `symbol:${token}`, kind: 'symbol', label, required: true, hint: token });
const symbol = (token: string, label: string): RuleSymbol => ({ token, label });

/** 符号环境同时声明为符号槽与符号说明：槽位供步骤绑定，说明供界面展示。 */
function withSymbolSlots(rule: Omit<RuleDef, 'slots'> & { slots: RuleSlot[] }, symbols: RuleSymbol[]): RuleDef {
  return { ...rule, slots: [...rule.slots, ...symbols.map((item) => symbolSlot(item.token, item.label))], symbols };
}

function packRules(): RuleDef[] {
  return [
    {
      id: 'axiom',
      name: '前提',
      description: '证明显式采用的前提条件或公理假设，作为推导链的起点。',
      slots: [conclusionSlot()],
      symbols: [],
    },
    withSymbolSlots({
      id: 'definition-expand',
      name: '定义展开',
      description: '把等式一侧按定义改写为等价形式，如把平方展开为两个相同因式之积。',
      slots: [premiseSlot('src', '被展开式', '选择含待展开定义的步骤'), conclusionSlot()],
      symbols: [symbol('x', '被定义的对象或表达式')],
    }, [symbol('x', '被定义的对象或表达式')]),
    withSymbolSlots({
      id: 'substitution',
      name: '代入',
      description: '将前提中的变量替换为具体对象或表达式，替换须处处一致。',
      slots: [premiseSlot('src', '代入前提', '选择包含变量的一般式'), conclusionSlot()],
      symbols: [symbol('x', '原变量'), symbol('y', '代入对象')],
    }, [symbol('x', '原变量'), symbol('y', '代入对象')]),
    withSymbolSlots({
      id: 'equation-transform',
      name: '等式变形',
      description: '在等式两边进行保持等价关系的恒等变形。',
      slots: [premiseSlot('src', '原等式', '选择待变形的等式'), conclusionSlot()],
      symbols: [symbol('x', '等式左侧'), symbol('y', '等式右侧')],
    }, [symbol('x', '等式左侧'), symbol('y', '等式右侧')]),
    withSymbolSlots({
      id: 'distributive',
      name: '分配律',
      description: '按 x(y+z)=xy+xz 展开乘积，必要时双向使用。',
      slots: [
        premiseSlot('left', '左因式', '给出左因子的步骤'),
        premiseSlot('right', '右因式（和式）', '给出和式的步骤'),
        conclusionSlot(),
      ],
      symbols: [symbol('x', '左因子'), symbol('y', '加数一'), symbol('z', '加数二')],
    }, [symbol('x', '左因子'), symbol('y', '加数一'), symbol('z', '加数二')]),
    withSymbolSlots({
      id: 'combine-like-terms',
      name: '同类项合并',
      description: '合并仅系数不同的同类项，合并前需确认运算律允许交换次序。',
      slots: [premiseSlot('src', '待合并式', '选择含同类项的展开式'), conclusionSlot()],
      symbols: [symbol('x', '同类项记号')],
    }, [symbol('x', '同类项记号')]),
    withSymbolSlots({
      id: 'commutativity',
      name: '交换律',
      description: '在允许交换的运算中调换两项次序。',
      slots: [premiseSlot('src', '原式', '选择使用交换律的步骤'), conclusionSlot()],
      symbols: [symbol('x', '项一'), symbol('y', '项二')],
    }, [symbol('x', '项一'), symbol('y', '项二')]),
    withSymbolSlots({
      id: 'induction',
      name: '数学归纳',
      description: '验证基例 P(1)，并在归纳假设 P(k) 下证明 P(k+1)，从而推出对所有正整数成立。',
      slots: [
        premiseSlot('base', '归纳基例', '证明 P(1) 成立的步骤'),
        premiseSlot('step', '归纳递推', '在 P(k) 假设下证明 P(k+1) 的步骤'),
        conclusionSlot(),
      ],
      symbols: [symbol('P', '关于正整数的命题'), symbol('n', '正整数'), symbol('k', '归纳变量')],
    }, [symbol('P', '关于正整数的命题'), symbol('n', '正整数'), symbol('k', '归纳变量')]),
    withSymbolSlots({
      id: 'contradiction',
      name: '反证法',
      description: '假设结论不成立并导出矛盾，从而肯定原结论。',
      slots: [premiseSlot('contra', '矛盾导出', '由否定假设导出矛盾的步骤'), conclusionSlot()],
      symbols: [symbol('A', '待证命题')],
    }, [symbol('A', '待证命题')]),
    withSymbolSlots({
      id: 'construction',
      name: '构造法',
      description: '显式构造满足条件的对象，并验证其满足全部要求。',
      slots: [premiseSlot('verify', '构造与验证', '给出构造并验证性质的步骤'), conclusionSlot()],
      symbols: [symbol('x', '被构造对象')],
    }, [symbol('x', '被构造对象')]),
    {
      id: 'conclusion',
      name: '结论',
      description: '由全部前置推导最终确认证明目标成立。',
      slots: [premiseSlot('support', '最终支撑', '直接推出目标的步骤'), conclusionSlot()],
      symbols: [],
    },
  ];
}

function builtinPacks(): RulePack[] {
  return [
    {
      id: 'pack-elementary-algebra',
      name: '初等代数规则包',
      version: '1.0',
      description: '面向等式变形与代数证明的常用推理规则，含定义展开、分配律、归纳法等。',
      conflictsWith: [],
      rules: packRules(),
      builtin: true,
    },
    {
      id: 'pack-euclidean-geometry',
      name: '欧氏几何公理包',
      version: '1.0',
      description: '基于欧几里得第五公设（平行公理）的平面几何推理规则。与非欧几何公理体系互斥。',
      conflictsWith: ['pack-hyperbolic-geometry'],
      builtin: true,
      rules: [
        {
          id: 'parallel-axiom',
          name: '平行公理',
          description: '过直线外一点，有且仅有一条直线与已知直线平行。由此可推出三角形内角和等于 180°。',
          slots: [conclusionSlot()],
          symbols: [symbol('l', '已知直线'), symbol('P', '直线外一点')],
        },
      ],
    },
    {
      id: 'pack-hyperbolic-geometry',
      name: '双曲几何公理包',
      version: '1.0',
      description: '否定平行公理唯一性的非欧几何体系：过直线外一点至少有两条平行线。与欧氏体系互斥。',
      conflictsWith: ['pack-euclidean-geometry'],
      builtin: true,
      rules: [
        {
          id: 'parallel-axiom',
          name: '平行公理',
          description: '过直线外一点至少存在两条直线与已知直线不相交；三角形内角和严格小于 180°。',
          slots: [conclusionSlot()],
          symbols: [symbol('l', '已知直线'), symbol('P', '直线外一点')],
        },
      ],
    },
  ];
}

export interface ImportResult {
  ok: boolean;
  message: string;
  pack?: RulePack;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanPack(value: unknown): RulePack | null {
  const record = asRecord(value);
  if (!record) return null;
  const { id, name, version, description } = record;
  if (typeof id !== 'string' || !id.trim()) return null;
  if (typeof name !== 'string' || !name.trim()) return null;
  const rulesRaw = Array.isArray(record.rules) ? record.rules : [];
  const rules: RuleDef[] = [];
  for (const raw of rulesRaw) {
    const item = asRecord(raw);
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') return null;
    const slotsRaw = Array.isArray(item.slots) ? item.slots : [];
    const slots: RuleSlot[] = [];
    for (const slotRaw of slotsRaw) {
      const slot = asRecord(slotRaw);
      if (!slot || typeof slot.id !== 'string' || !['premise', 'conclusion', 'symbol'].includes(String(slot.kind))) return null;
      slots.push({
        id: slot.id,
        kind: slot.kind as RuleSlot['kind'],
        label: String(slot.label ?? slot.id),
        required: slot.required !== false,
        hint: typeof slot.hint === 'string' ? slot.hint : undefined,
      });
    }
    const symbols: RuleSymbol[] = [];
    for (const symbolRaw of Array.isArray(item.symbols) ? item.symbols : []) {
      const sym = asRecord(symbolRaw);
      if (sym && typeof sym.token === 'string') symbols.push({ token: sym.token, label: String(sym.label ?? sym.token) });
    }
    rules.push({ id: item.id, name: item.name, description: String(item.description ?? ''), slots, symbols });
  }
  return {
    id: id.trim(),
    name: name.trim(),
    version: typeof version === 'string' && version.trim() ? version.trim() : '1.0',
    description: typeof description === 'string' ? description : '',
    conflictsWith: Array.isArray(record.conflictsWith) ? record.conflictsWith.filter((item): item is string => typeof item === 'string') : [],
    rules,
  };
}

export function buildSnapshot(pack: RulePack, rule: RuleDef): RuleSnapshot {
  return {
    packId: pack.id,
    packName: pack.name,
    packVersion: pack.version,
    ruleId: rule.id,
    ruleName: rule.name,
    rule,
    contentHash: contentHash(rule),
  };
}

export class RuleLibrary {
  packs: RulePack[] = loadPacks();

  save(): void {
    try {
      localStorage.setItem(PACK_STORAGE_KEY, JSON.stringify(this.packs));
    } catch {
      // 存储空间不足时保留内存中的库，供本次会话继续使用。
    }
  }

  get(id: string): RulePack | undefined {
    return this.packs.find((pack) => pack.id === id);
  }

  findRule(packId: string, ruleId: string): { pack: RulePack; rule: RuleDef } | undefined {
    const pack = this.get(packId);
    const rule = pack?.rules.find((item) => item.id === ruleId);
    return pack && rule ? { pack, rule } : undefined;
  }

  /** 按规则名称在全部包中查找；返回同名匹配的所有规则（用于保留来源、区分跨包同名）。 */
  findRuleByName(ruleName: string): { pack: RulePack; rule: RuleDef }[] {
    const matches: { pack: RulePack; rule: RuleDef }[] = [];
    this.packs.forEach((pack) => {
      pack.rules.forEach((rule) => {
        if (rule.name === ruleName) matches.push({ pack, rule });
      });
    });
    return matches;
  }

  importPack(text: string): ImportResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: '不是合法的 JSON 文件。' };
    }
    const pack = cleanPack(parsed);
    if (!pack) return { ok: false, message: '规则包结构无效：需要 id、name 与合法的 rules 列表。' };
    if (!pack.rules.length) return { ok: false, message: '规则包至少要包含一条规则。' };
    const existing = this.get(pack.id);
    this.packs = this.packs.filter((item) => item.id !== pack.id);
    this.packs.push({ ...pack, builtin: existing?.builtin });
    this.save();
    return {
      ok: true,
      pack,
      message: existing ? `已更新规则包「${pack.name}」至 ${pack.version}，引用旧内容的步骤将标记为待复核。` : `已导入规则包「${pack.name}」（${pack.rules.length} 条规则）。`,
    };
  }

  /** 演示用：不修改版本号，仅改动规则内容，引用该规则的步骤应立即变为待复核。 */
  bumpRuleContent(packId: string, ruleId: string, note: string): RulePack | undefined {
    const pack = this.get(packId);
    if (!pack) return undefined;
    pack.rules = pack.rules.map((rule) => (rule.id === ruleId ? { ...rule, description: `${rule.description}【${note} ${new Date().toLocaleString('zh-CN')}】` } : rule));
    this.save();
    return pack;
  }

  /** 演示用：整包发布内容修订（版本号不变），包内全部规则的引用都会失效待复核。 */
  bumpPack(packId: string, note: string): RulePack | undefined {
    const pack = this.get(packId);
    if (!pack) return undefined;
    const stamp = new Date().toLocaleString('zh-CN');
    pack.rules = pack.rules.map((rule) => ({ ...rule, description: `${rule.description}【${note} ${stamp}】` }));
    this.save();
    return pack;
  }
}

function loadPacks(): RulePack[] {
  const fallback = builtinPacks();
  try {
    const raw = localStorage.getItem(PACK_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const packs = parsed.map((item) => cleanPack(item)).filter((item): item is RulePack => Boolean(item));
    if (!packs.length) return fallback;
    // 内置包以磁盘版本为准，但新内置包会补齐。
    fallback.forEach((builtin) => {
      if (!packs.some((pack) => pack.id === builtin.id)) packs.push(builtin);
      else {
        const stored = packs.find((pack) => pack.id === builtin.id);
        if (stored) stored.builtin = true;
      }
    });
    return packs;
  } catch {
    return fallback;
  }
}
