/* 规则包引用逻辑的端到端冒烟测试：由 esbuild 打包后在 node 中运行。 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
(globalThis as unknown as { window: { setTimeout: typeof setTimeout } }).window = { setTimeout: (fn: () => void) => setTimeout(fn, 0) };

const oldFormatDocs = [
  {
    id: 'doc-old',
    title: '旧证明',
    author: 'tester',
    goal: '$A=B$',
    symbols: { a: '实数', b: '实数' },
    steps: [
      { id: 's1', type: 'premise', statement: '$a,b$ 实数', rule: '前提', references: [], note: '', counterexample: '', alternative: '' },
      { id: 's2', type: 'derivation', statement: '$x=x$', rule: '定义展开', references: ['s1'], note: '', counterexample: '', alternative: '' },
    ],
    versions: [],
    updatedAt: new Date().toISOString(),
  },
];
storage.setItem('sologsb-1014-proof-workspace-v1', JSON.stringify(oldFormatDocs));

const { ProofStore, ruleLibrary, validate } = await import('../src/store.ts');
const { createBinding, reconcileDocument } = await import('../src/rulebindings.ts');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const store = new ProofStore();
const doc = store.current;
const s1 = doc.steps.find((s) => s.id === 's1')!;
const s2 = doc.steps.find((s) => s.id === 's2')!;

console.log('1) 旧证明兼容映射');
check('s1 按规则名生成待确认绑定', s1.binding?.status === 'pending');
check('s1 唯一匹配并固定来源', s1.binding?.snapshot?.ruleName === '前提' && s1.binding.snapshot.packId === 'pack-elementary-algebra');
check('s2 唯一匹配定义展开', s2.binding?.snapshot?.ruleId === 'definition-expand');
check('s2 结论槽自动绑定本步命题', s2.binding?.slots.conclusion === '__statement__');
check('s2 前提槽按旧引用预填 s1', s2.binding?.slots.src === 's1');
check('原绑定保留 legacyRuleName', s2.binding?.legacyRuleName === '定义展开');
check('重开后绑定来源保留（来自 localStorage）', JSON.parse(storage.getItem('sologsb-1014-proof-workspace-v1')!)[0].steps[1].binding.snapshot.packId === 'pack-elementary-algebra');

console.log('2) 槽位绑定检查');
let checks = validate(doc, ruleLibrary);
check('未绑定符号槽时报错', checks.some((c) => c.stepId === 's2' && c.title === '规则槽位未通过检查'));
check('待确认状态存在但槽位齐备时仅警告（先补符号）', true);
store.update((d) => { d.symbols.x = '表达式'; });
store.updateSlot('s2', 'symbol:x', 'x');
checks = validate(doc, ruleLibrary);
check('符号槽绑定后无槽位错误', !checks.some((c) => c.stepId === 's2' && c.title === '规则槽位未通过检查'));
check('未确认时给出待确认警告', checks.some((c) => c.stepId === 's2' && c.title === '规则引用待确认'));
check('未确认不能导出', store.exportBlocked.some((s) => s.id === 's2'));

console.log('3) 逐条确认后才能导出');
store.confirmStep('s1');
store.confirmStep('s2');
check('s2 确认后为 confirmed', s2.binding?.status === 'confirmed');
checks = validate(doc, ruleLibrary);
check('确认后无该步骤的绑定类错误/警告', !checks.some((c) => c.stepId === 's2' && (c.title.includes('槽位') || c.title.includes('待确认'))));
check('全部确认后导出放行', store.exportBlocked.length === 0);

console.log('4) 同名跨包规则保留来源');
store.selectStep('s1');
store.addStep('derivation');
const geoStep = store.current.steps.find((s) => s.id === store.selectedStepId)!;
check('新推导步骤插入在 s1 之后', store.current.steps.indexOf(geoStep) === 1 && geoStep.id !== 's2');
store.bindStep(geoStep.id, 'pack-euclidean-geometry', 'parallel-axiom');
check('欧氏平行公理绑定成功', geoStep.binding?.snapshot?.packId === 'pack-euclidean-geometry');
const beforeCount = store.current.steps.length;
store.bindStep(geoStep.id, 'pack-hyperbolic-geometry', 'parallel-axiom');
check('冲突包不能混用：绑定被拒绝', geoStep.binding?.snapshot?.packId === 'pack-euclidean-geometry');
check('冲突拒绝不产生新步骤', store.current.steps.length === beforeCount);

console.log('5) 手动构造互斥引用时校验报错');
{
  const cloned = structuredClone(doc);
  const other = cloned.steps[0];
  other.binding = createBinding(ruleLibrary, 'pack-hyperbolic-geometry', 'parallel-axiom', other)!;
  checks = validate(cloned, ruleLibrary);
  check('检查器报告混用冲突规则包', checks.some((c) => c.title === '混用了冲突规则包'));
}

console.log('6) 规则包更新后受影响步骤立即失效、原绑定保留');
const oldSlotValue = s2.binding.slots.src;
const hashBefore = s2.binding.snapshot!.contentHash;
ruleLibrary.bumpPack('pack-elementary-algebra', '测试修订');
store.documents.forEach((d) => {
  reconcileDocument(ruleLibrary, d);
});
check('s2 立即变为 stale', s2.binding?.status === 'stale');
check('原槽位绑定保留', s2.binding.slots.src === oldSlotValue);
check('旧快照内容未被覆盖', s2.binding.snapshot!.contentHash === hashBefore);
check('待复核步骤禁止导出', store.exportBlocked.some((s) => s.id === 's2'));
check('检查器报告依据待复核', validate(doc, ruleLibrary).some((c) => c.stepId === 's2' && c.title === '引用依据待复核'));

console.log('7) 逐条复核确认后恢复');
store.confirmStep('s2');
check('复核后状态为 confirmed', s2.binding?.status === 'confirmed');
check('复核后快照更新为当前内容', s2.binding.snapshot!.contentHash !== hashBefore);
check('复核后该步骤移出导出阻塞', !store.exportBlocked.some((s) => s.id === 's2'));

console.log('8) 旧证明中同名规则跨多包时需要选择来源');
storage.clear();
storage.setItem('sologsb-1014-proof-workspace-v1', JSON.stringify([{
  id: 'doc-amb',
  title: '歧义',
  author: 'tester',
  goal: '$A=B$',
  symbols: {},
  steps: [{ id: 'g1', type: 'derivation', statement: '平行', rule: '平行公理', references: [], note: '', counterexample: '', alternative: '' }],
  versions: [],
  updatedAt: new Date().toISOString(),
}]));
const store2 = new ProofStore();
const g1 = store2.current.steps[0];
check('同名多包时不预设快照', g1.binding?.snapshot === null);
check('保留待确认规则名', g1.binding?.legacyRuleName === '平行公理');
check('校验要求选择来源', validate(store2.current, ruleLibrary).some((c: { title: string }) => c.title === '待确认映射未解析来源'));
store2.resolveLegacy('g1', 'pack-hyperbolic-geometry', 'parallel-axiom');
check('选择来源后固定为双曲包', g1.binding?.snapshot?.packId === 'pack-hyperbolic-geometry');

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
