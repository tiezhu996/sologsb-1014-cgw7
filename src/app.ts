import m, { type Component } from 'mithril';
import katex from 'katex';
import { compareVersion, ProofStore, ruleLibrary } from './store';
import { isPremiseAxiom, snapshotDiff, STATEMENT_BINDING, statusLabel, validateBinding } from './rulebindings';
import type { ProofDocument, ProofStep, RulePack, RuleSlot } from './types';

const store = new ProofStore();

const snippets = [
  { label: '∀', value: '\\forall ' },
  { label: '∃', value: '\\exists ' },
  { label: '→', value: '\\to ' },
  { label: '⇔', value: '\\iff ' },
  { label: '≠', value: '\\ne ' },
  { label: '≤', value: '\\le ' },
  { label: '≥', value: '\\ge ' },
  { label: '∈', value: '\\in ' },
  { label: '∑', value: '\\sum_{i=1}^{n} ' },
  { label: '√', value: '\\sqrt{}' },
  { label: '分式', value: '\\frac{}{}' },
  { label: '上标', value: '^{}' },
  { label: '下标', value: '_{}' },
];

const typeLabel: Record<ProofStep['type'], string> = {
  premise: '前提',
  derivation: '推导',
  goal: '目标 / 结论',
};

// 规则包详情 / 导入弹窗的瞬时界面状态。
type ModalState =
  | { kind: 'none' }
  | { kind: 'pack'; pack: RulePack }
  | { kind: 'import'; text: string; message: string; ok: boolean };

function renderRichText(text: string): m.Children {
  const parts = text.split(/(\$[^$]+\$)/g);
  return parts.map((part) => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      try {
        return m.trust(katex.renderToString(part.slice(1, -1), { throwOnError: false, output: 'html' }));
      } catch {
        return part;
      }
    }
    return part;
  });
}

function shortId(id: string): string {
  return id.replace(/^step-/, '').slice(-4).toUpperCase();
}

function download(name: string, content: string, mime: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: mime }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindingLine(step: ProofStep): string {
  const binding = step.binding;
  if (isPremiseAxiom(step)) return '公理起点（无需规则包引用）';
  if (!binding) return '缺少规则包引用';
  const source = binding.snapshot ? `${binding.snapshot.packName} · ${binding.snapshot.ruleName}（${binding.snapshot.packVersion}）` : `待确认映射：${binding.legacyRuleName ?? step.rule}`;
  return `依据：${source} · ${statusLabel(binding.status)}`;
}

function exportMarkdown(document: ProofDocument): string {
  const lines = [`# ${document.title}`, '', `**证明目标：** $${document.goal}$`, ''];
  document.steps.forEach((step, index) => {
    const refs = step.references.map((id) => `步骤 ${document.steps.findIndex((item) => item.id === id) + 1}`).filter((ref) => ref !== '步骤 0');
    lines.push(`## ${index + 1}. ${step.statement}`);
    lines.push('');
    lines.push(`- 类型：${typeLabel[step.type]}`);
    if (step.binding?.snapshot) {
      const snap = step.binding.snapshot;
      lines.push(`- 推理规则：${snap.ruleName}（规则包《${snap.packName}》${snap.packVersion}，引用状态：${statusLabel(step.binding.status)}）`);
      const premises = snap.rule.slots
        .filter((slot) => slot.kind === 'premise')
        .map((slot) => {
          const bound = step.binding!.slots[slot.id];
          const boundIndex = document.steps.findIndex((item) => item.id === bound);
          return `${slot.label}=${boundIndex >= 0 ? `步骤 ${boundIndex + 1}` : '未绑定'}`;
        });
      if (premises.length) lines.push(`- 槽位绑定：${premises.join('；')}`);
    } else {
      lines.push(`- 推理规则：${step.rule}`);
    }
    if (refs.length) lines.push(`- 依据：${refs.join('、')}`);
    if (step.note) lines.push(`- 旁注：${step.note}`);
    if (step.counterexample) lines.push(`- 反例：${step.counterexample}`);
    if (step.alternative) lines.push(`- 替代分支：${step.alternative}`);
    lines.push('');
  });
  lines.push('## 符号表');
  Object.entries(document.symbols).forEach(([symbol, meaning]) => lines.push(`- $${symbol}$：${meaning}`));
  return lines.join('\n');
}

function exportLatex(document: ProofDocument): string {
  const lines = ['\\documentclass{article}', '\\usepackage{amsmath,amssymb}', '\\begin{document}', `\\section*{${document.title}}`, `\\textbf{证明目标：} $${document.goal}$`, '\\begin{enumerate}'];
  document.steps.forEach((step) => {
    const refs = step.references.map((id) => document.steps.findIndex((item) => item.id === id) + 1).filter(Boolean);
    const ruleName = step.binding?.snapshot?.ruleName ?? step.rule;
    const packName = step.binding?.snapshot ? `，来自《${step.binding.snapshot.packName}》${step.binding.snapshot.packVersion}` : '';
    const support = refs.length ? `（依据 ${refs.join(', ')}；${ruleName}${packName}）` : `（${ruleName}${packName}）`;
    lines.push(`  \\item ${step.statement} ${support}`);
    if (step.note) lines.push(`  \\par\\small 旁注：${step.note}`);
  });
  lines.push('\\end{enumerate}', '\\end{document}');
  return lines.join('\n');
}

export class ProofApp implements Component {
  private modal: ModalState = { kind: 'none' };
  private importFile: File | null = null;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const inEditor = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? store.redo() : store.undo();
      m.redraw();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      store.redo();
      m.redraw();
      return;
    }
    if (command && event.key === 'Enter') {
      event.preventDefault();
      store.addStep(event.shiftKey ? 'goal' : 'derivation');
      m.redraw();
      return;
    }
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault();
      store.save();
      store.notify('已保存到浏览器');
      m.redraw();
      return;
    }
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !inEditor) {
      event.preventDefault();
      const steps = store.current.steps;
      const index = steps.findIndex((step) => step.id === store.selectedStepId);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, steps.length - 1) : Math.max(index - 1, 0);
      store.selectStep(steps[next]?.id ?? '');
      document.querySelector(`[data-step="${store.selectedStepId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      m.redraw();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !inEditor && store.selectedStepId) {
      event.preventDefault();
      store.removeStep(store.selectedStepId);
      m.redraw();
    }
  };

  oncreate(): void {
    window.addEventListener('keydown', this.onKeyDown);
  }

  onremove(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private doExport(kind: 'md' | 'tex'): void {
    const blockers = store.exportBlocked;
    if (blockers.length) {
      const positions = blockers
        .map((step) => store.current.steps.indexOf(step) + 1)
        .filter((n) => n > 0)
        .join('、');
      store.notify(`无法导出：步骤 ${positions} 仍有待确认/待复核的规则引用`);
      return;
    }
    if (kind === 'md') download(`${store.current.title}.md`, exportMarkdown(store.current), 'text/markdown;charset=utf-8');
    else download(`${store.current.title}.tex`, exportLatex(store.current), 'application/x-tex;charset=utf-8');
  }

  private readImportFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      this.modal = { kind: 'import', text: String(reader.result ?? ''), message: '', ok: false };
      m.redraw();
    };
    reader.readAsText(file);
  }

  private renderPackPanel(): m.Children {
    const used = new Set(store.current.steps.map((step) => step.binding?.snapshot?.packId).filter(Boolean) as string[]);
    return m('section.panel.rule-pack-panel', [
      m('div.panel-heading', [
        m('span', '规则包库'),
        m('button.icon-button', { onclick: () => { this.modal = { kind: 'import', text: '', message: '', ok: false }; }, title: '导入规则包 JSON' }, '⇪'),
      ]),
      m('div.pack-list', ruleLibrary.packs.map((pack) => m('button.pack-item', {
        onclick: () => { this.modal = { kind: 'pack', pack }; },
        title: pack.description,
      }, [
        m('span.pack-mark', { class: pack.builtin ? 'is-builtin' : '' }, pack.builtin ? '内置' : '导入'),
        m('span.pack-copy', [
          m('strong', pack.name),
          m('small', `v${pack.version} · ${pack.rules.length} 条规则${used.has(pack.id) ? ' · 本文已引用' : ''}`),
        ]),
      ]))),
    ]);
  }

  private renderPackModal(pack: RulePack): m.Children {
    // 弹窗打开期间规则库可能被更新（如模拟修订），按 id 实时取最新内容。
    const currentInLibrary = ruleLibrary.get(pack.id);
    const livePack = currentInLibrary ?? pack;
    return m('div.modal-overlay', { onclick: () => { this.modal = { kind: 'none' }; } }, [
      m('section.modal-dialog.pack-dialog', { onclick: (event: Event) => event.stopPropagation() }, [
        m('header.modal-head', [
          m('div', [m('span.eyebrow', 'RULE PACK'), m('h2', `${livePack.name} v${livePack.version}`)]),
          m('button.modal-close', { onclick: () => { this.modal = { kind: 'none' }; } }, '×'),
        ]),
        m('div.modal-body', [
          m('p.pack-description', livePack.description),
          livePack.conflictsWith.length > 0 && m('p.pack-conflict', `互斥规则包：${livePack.conflictsWith.map((id) => ruleLibrary.get(id)?.name ?? id).join('、')}`),
          m('div.pack-rule-list', livePack.rules.map((rule) => m('div.pack-rule', [
            m('div.pack-rule-head', [m('strong', rule.name), m('small', rule.id)]),
            m('p', rule.description),
            m('div.pack-rule-meta', [
              m('span', `前提槽 ${rule.slots.filter((slot) => slot.kind === 'premise').length}`),
              m('span', `结论槽 ${rule.slots.filter((slot) => slot.kind === 'conclusion').length}`),
              m('span', `符号 ${rule.symbols.map((sym) => sym.token).join('、') || '无'}`),
            ]),
          ]))),
        ]),
        m('footer.modal-foot', [
          currentInLibrary?.builtin
            ? m('button.button.is-small.is-warning', { onclick: () => { store.bumpRulePack(livePack.id); this.modal = { kind: 'none' }; } }, '模拟发布修订（使引用失效）')
            : m('span.button-hint', '导入同 id 的 JSON 可更新此规则包'),
          m('div', [
            m('button.button.is-small', { onclick: () => download(`${livePack.name}.json`, JSON.stringify(livePack, null, 2), 'application/json') }, '导出 JSON'),
            m('button.button.is-small.is-light', { onclick: () => { this.modal = { kind: 'none' }; } }, '关闭'),
          ]),
        ]),
      ]),
    ]);
  }

  private renderImportModal(state: Extract<ModalState, { kind: 'import' }>): m.Children {
    return m('div.modal-overlay', { onclick: () => { this.modal = { kind: 'none' }; } }, [
      m('section.modal-dialog', { onclick: (event: Event) => event.stopPropagation() }, [
        m('header.modal-head', [
          m('div', [m('span.eyebrow', 'IMPORT'), m('h2', '导入规则包')]),
          m('button.modal-close', { onclick: () => { this.modal = { kind: 'none' }; } }, '×'),
        ]),
        m('div.modal-body', [
          m('p.pack-description', '规则包声明每条规则的前提槽、结论槽与符号环境。步骤绑定槽位后才能通过检查；同 id 重新导入会更新内容，引用旧内容的步骤立即标记为待复核。'),
          m('div.file-drop', [
            m('input', {
              type: 'file',
              accept: '.json,application/json',
              onchange: (event: Event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (file) {
                  this.importFile = file;
                  this.readImportFile(file);
                }
              },
            }),
            this.importFile && m('small', `已读取：${this.importFile.name}`),
          ]),
          m('textarea.textarea', {
            rows: 9,
            placeholder: '也可以直接粘贴规则包 JSON……',
            value: state.text,
            oninput: (event: Event) => { this.modal = { kind: 'import', text: (event.target as HTMLTextAreaElement).value, message: '', ok: false }; },
          }),
          state.message && m('p.import-message', { class: state.ok ? 'is-ok' : 'is-error' }, state.message),
        ]),
        m('footer.modal-foot', [
          m('span.button-hint', '槽位未绑定的步骤不能通过检查，也不能导出'),
          m('div', [
            m('button.button.is-small.is-link', {
              disabled: !state.text.trim(),
              onclick: () => {
                const result = store.importRulePack(state.text);
                if (result.ok) {
                  this.modal = { kind: 'none' };
                  store.notify(result.message);
                } else {
                  this.modal = { kind: 'import', text: state.text, message: result.message, ok: false };
                }
              },
            }, '导入并核对引用'),
            m('button.button.is-small.is-light', { onclick: () => { this.modal = { kind: 'none' }; } }, '取消'),
          ]),
        ]),
      ]),
    ]);
  }

  private renderSlotEditor(document: ProofDocument, step: ProofStep): m.Children {
    const binding = step.binding;
    if (!binding?.snapshot) {
      // 旧证明兼容映射：规则名称解析到多个来源时，要求用户先选择规则包。
      const legacyName = binding?.legacyRuleName ?? step.rule;
      const candidates = ruleLibrary.findRuleByName(legacyName);
      return [
        m('div.binding-banner.is-error', [
          m('strong', '待确认映射：缺少规则来源'),
          m('p', `旧证明只记录了规则名称「${legacyName}」。${candidates.length ? '该名称在多个规则包中存在同名规则，请保留来源并选择其一：' : '库中没有同名规则，请导入对应规则包后重试。'}`),
        ]),
        candidates.length > 0 && m('div.source-choice', candidates.map(({ pack, rule }) => m('button.button.is-small.is-light.source-button', {
          onclick: () => { store.resolveLegacy(step.id, pack.id, rule.id); m.redraw(); },
        }, [m('strong', rule.name), m('small', `《${pack.name}》v${pack.version}`)]))),
        this.renderRuleSelector(step),
      ];
    }

    const snap = binding.snapshot;
    const currentRule = ruleLibrary.findRule(snap.packId, snap.ruleId)?.rule;
    const slotIssues = new Map(validateBinding(binding, step, document).map((issue) => [issue.slotId, issue.message]));
    const premiseSteps = document.steps.filter((item) => item.id !== step.id);

    return [
      m('div.binding-source', [
        m('div.binding-source-head', [
          m('div', [m('strong.binding-rule-name', snap.ruleName), m('small', `《${snap.packName}》 v${snap.packVersion}`)]),
          m('span.binding-status', { class: binding.status }, statusLabel(binding.status)),
        ]),
        m('p.binding-rule-desc', snap.rule.description),
      ]),
      binding.status === 'stale' && m('div.binding-banner.is-warning', [
        m('strong', '规则包已更新，依据待复核'),
        m('p', '原槽位绑定已保留。请对照下方快照差异，确认新内容后才能导出。'),
        m('div.snapshot-diff', [
          m('div.snapshot-diff-row.diff-header', [m('span', ''), m('span', '引用时固定的内容'), m('span', '包内当前内容')]),
          ...snapshotDiff(snap, currentRule).map((row) => m('div.snapshot-diff-row', [
            m('span.snapshot-field', row.field),
            m('span.snapshot-old', row.frozen),
            m('span.snapshot-new', row.latest),
          ])),
        ]),
      ]),
      m('div.slot-editor', snap.rule.slots.map((slot) => this.renderSlotControl(document, step, slot, slotIssues, premiseSteps))),
      m('div.binding-actions', [
        m('button.button.is-small.is-link', { onclick: () => { store.confirmStep(step.id); m.redraw(); } }, binding.status === 'stale' ? '✓ 复核并确认依据' : '✓ 确认引用依据'),
        m('button.button.is-small.is-light', { onclick: () => { store.unbindStep(step.id); m.redraw(); } }, '解除引用'),
      ]),
      this.renderRuleSelector(step),
    ];
  }

  private renderSlotControl(
    document: ProofDocument,
    step: ProofStep,
    slot: RuleSlot,
    issues: Map<string, string>,
    premiseSteps: ProofStep[],
  ): m.Children {
    const binding = step.binding!;
    const value = binding.slots[slot.id] ?? '';
    const issue = issues.get(slot.id);
    if (slot.kind === 'conclusion') {
      return m('div.slot-row', [
        m('label.field-label', `结论槽 · ${slot.label}`),
        m('div.conclusion-slot', { class: value === STATEMENT_BINDING ? 'is-bound' : 'is-missing' }, value === STATEMENT_BINDING ? '⇄ 已绑定本步命题' : '未绑定本步命题'),
      ]);
    }
    if (slot.kind === 'symbol') {
      return m('div.slot-row', { class: issue ? 'has-issue' : '' }, [
        m('label.field-label', `符号环境 · ${slot.label}`),
        m('div.symbol-bind-row', [
          m('code.symbol-token', slot.hint ?? ''),
          m('div.select.is-small.is-fullwidth', m('select', {
            value,
            onchange: (event: Event) => store.updateSlot(step.id, slot.id, (event.target as HTMLSelectElement).value),
          }, [
            m('option', { value: '' }, '映射到文档符号表中的符号'),
            ...Object.keys(document.symbols).map((key) => m('option', { value: key }, `$${key}$ — ${document.symbols[key]}`)),
          ])),
        ]),
        issue && m('small.slot-error', issue),
      ]);
    }
    return m('div.slot-row', { class: issue ? 'has-issue' : '' }, [
      m('label.field-label', `前提槽 · ${slot.label}${slot.required ? '' : '（可选）'}`),
      slot.hint && m('small.slot-hint', slot.hint),
      m('div.select.is-small.is-fullwidth', m('select', {
        value,
        onchange: (event: Event) => store.updateSlot(step.id, slot.id, (event.target as HTMLSelectElement).value),
      }, [
        m('option', { value: '' }, '选择作为依据的步骤'),
        ...premiseSteps.map((item) => m('option', { value: item.id }, `步骤 ${document.steps.indexOf(item) + 1} · ${item.statement.replace(/\$/g, '').slice(0, 28)}`)),
      ])),
      issue && m('small.slot-error', issue),
    ]);
  }

  private renderRuleSelector(step: ProofStep): m.Children {
    const current = step.binding?.snapshot;
    return m('div.rule-source-picker', [
      m('label.field-label', '更换规则来源（同名跨包规则保留各自来源）'),
      m('div.pack-rule-groups', ruleLibrary.packs.map((pack) => m('div.pack-rule-group', [
        m('small.pack-group-name', `${pack.name} v${pack.version}`),
        m('div.pack-rule-buttons', pack.rules.map((rule) => m('button.button.is-small', {
          class: current?.packId === pack.id && current.ruleId === rule.id ? 'is-link' : 'is-white',
          onclick: () => { store.bindStep(step.id, pack.id, rule.id); m.redraw(); },
        }, rule.name))),
      ]))),
    ]);
  }

  view(): m.Children {
    const document = store.current;
    const selected = store.selectedStep;
    const checks = store.checks;
    const errors = checks.filter((check) => check.severity === 'error').length;
    const warnings = checks.filter((check) => check.severity === 'warning').length;
    const selectedVersion = document.versions.find((version) => version.id === store.compareVersionId);
    const diff = selectedVersion ? compareVersion(document, selectedVersion) : [];
    const pendingCount = store.exportBlocked.length;

    return m('div.app-shell', [
      m('header.topbar', [
        m('div.brand', [
          m('div.brand-mark', '∑'),
          m('div', [m('p.eyebrow', 'FORMAL NOTEBOOK'), m('h1', '格致 · 证明编辑器')]),
        ]),
        m('div.topbar-center', [
          m('span.status-dot', { class: errors ? 'has-error' : 'is-ok' }),
          errors ? `${errors} 个结构错误` : '证明结构可检查',
          pendingCount > 0 && m('span.pending-pill', `${pendingCount} 步待确认`),
          m('span.topbar-separator'),
          `自动保存于 ${new Date(document.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        ]),
        m('div.actions', [
          m('button.button.is-light', { onclick: () => { store.undo(); m.redraw(); }, disabled: !store.undoStack.length, title: '撤销 Ctrl+Z' }, '↶ 撤销'),
          m('button.button.is-light', { onclick: () => { store.redo(); m.redraw(); }, disabled: !store.redoStack.length, title: '重做 Ctrl+Y' }, '↷ 重做'),
          m('button.button.is-link', { onclick: () => { store.addStep('derivation'); m.redraw(); }, title: '添加步骤 Ctrl+Enter' }, '+ 添加步骤'),
        ]),
      ]),
      m('main.workspace', [
        m('aside.left-rail', [
          m('section.panel.document-panel', [
            m('div.panel-heading', [m('span', '证明文档'), m('button.icon-button', { onclick: () => { store.addDocument(); m.redraw(); }, title: '新建证明' }, '+')]),
            m('div.document-list', store.documents.map((item) => m('button.document-item', {
              class: item.id === document.id ? 'is-active' : '',
              onclick: () => { store.selectDocument(item.id); m.redraw(); },
            }, [
              m('span.document-glyph', item.steps.length),
              m('span.document-copy', [m('strong', item.title), m('small', `${item.steps.length} 步 · ${item.author}`)]),
              m('span.chevron', '›'),
            ]))),
          ]),
          this.renderPackPanel(),
          m('section.panel.version-panel', [
            m('div.panel-heading', [m('span', '版本快照'), m('span.count-badge', document.versions.length)]),
            document.versions.length === 0 && m('p.empty-copy', '保存快照后，可以并排查看改动。'),
            m('div.version-list', document.versions.map((version) => m('button.version-item', {
              class: version.id === store.compareVersionId ? 'is-active' : '',
              onclick: () => { store.compareVersionId = store.compareVersionId === version.id ? '' : version.id; m.redraw(); },
            }, [
              m('span', version.name),
              m('small', new Date(version.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
            ]))),
            m('button.button.is-fullwidth.is-small', { onclick: () => { store.createVersion(); m.redraw(); } }, '＋ 保存当前版本'),
          ]),
          m('section.check-summary', [
            m('div.check-summary-head', [
              m('div', [m('span.eyebrow', 'LIVE CHECK'), m('h2', '证明检查')]),
              m('span.check-total', { class: errors ? 'has-error' : '' }, errors + warnings),
            ]),
            m('div.check-summary-bars', [
              m('span', { style: { width: `${Math.max(8, 100 - errors * 24 - warnings * 12)}%` } }),
            ]),
            m('p', errors ? '修正错误后再保存为定稿。' : warnings ? '结构有效，仍有待核对项。' : '当前结构、引用关系与规则绑定完整。'),
          ]),
        ]),
        m('section.editor-column', [
          m('div.editor-titlebar', [
            m('div', [
              m('input.title-input', { value: document.title, oninput: (event: Event) => { store.update((item) => { item.title = (event.target as HTMLInputElement).value; }); } }),
              m('div.editor-meta', [`${document.author} · ${document.steps.length} 个步骤`, m('span.keyboard-hint', '拖动 ⠿ 排序')]),
            ]),
            m('div.export-actions', [
              m('button.button.is-small', { class: pendingCount ? 'is-static' : '', title: pendingCount ? '存在待确认/待复核的规则引用，不能导出' : '', onclick: () => this.doExport('md') }, '导出 Markdown'),
              m('button.button.is-small', { class: pendingCount ? 'is-static' : '', title: pendingCount ? '存在待确认/待复核的规则引用，不能导出' : '', onclick: () => this.doExport('tex') }, '导出 LaTeX'),
            ]),
          ]),
          pendingCount > 0 && m('div.export-guard', [
            m('strong', `导出门控：${pendingCount} 个步骤的规则引用未确认`),
            m('span', '规则包更新或旧证明缺少槽位绑定时，需逐条确认后才能导出。'),
          ]),
          m('section.goal-card', [
            m('div.goal-label', '证明目标'),
            m('div.goal-formula', renderRichText(`$${document.goal}$`)),
            m('input.formula-input', {
              value: document.goal,
              onfocus: (event: Event) => { store.lastInput = event.target as HTMLInputElement; },
              oninput: (event: Event) => store.update((item) => { item.goal = (event.target as HTMLInputElement).value; }),
              'aria-label': '证明目标',
            }),
          ]),
          m('div.steps-toolbar', [
            m('div', [m('strong', '证明步骤'), m('span.steps-count', `${document.steps.length} 步`)]),
            m('div.steps-toolbar-actions', [
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('premise'); m.redraw(); } }, '＋ 前提'),
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('derivation'); m.redraw(); } }, '＋ 推导'),
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('goal'); m.redraw(); } }, '＋ 结论'),
            ]),
          ]),
          m('div.steps-list', document.steps.length === 0 && m('div.empty-state', '尚无步骤。按 Ctrl+Enter 开始添加。'), document.steps.map((step, index) => {
            const stepChecks = checks.filter((check) => check.stepId === step.id);
            const binding = step.binding;
            return m('article.step-card', {
              'data-step': step.id,
              class: [step.id === store.selectedStepId ? 'is-selected' : '', binding?.status === 'stale' ? 'is-stale' : '', binding?.status === 'pending' ? 'is-pending' : ''].join(' '),
              draggable: true,
              onclick: () => { store.selectStep(step.id); m.redraw(); },
              ondragstart: () => { store.dragStepId = step.id; },
              ondragover: (event: DragEvent) => event.preventDefault(),
              ondrop: (event: DragEvent) => { event.preventDefault(); store.moveStep(store.dragStepId, step.id); store.dragStepId = ''; m.redraw(); },
            }, [
              m('div.step-rail', [
                m('span.drag-handle', { title: '拖动排序' }, '⠿'),
                m('span.step-number', String(index + 1).padStart(2, '0')),
              ]),
              m('div.step-body', [
                m('div.step-head', [
                  m('span.tag', { class: step.type === 'goal' ? 'is-success' : step.type === 'premise' ? 'is-info' : 'is-light' }, typeLabel[step.type]),
                  binding?.snapshot
                    ? m('span.rule-chip.is-pack', { title: `${binding.snapshot.packName} v${binding.snapshot.packVersion}` }, `${binding.snapshot.ruleName} · ${binding.snapshot.packName.replace(/规则包|公理包/, '')}`)
                    : m('span.rule-chip', binding?.legacyRuleName ?? step.rule),
                  binding && !isPremiseAxiom(step) && m('span.binding-chip', { class: binding.status }, statusLabel(binding.status)),
                  m('span.step-id', `#${shortId(step.id)}`),
                  stepChecks.length > 0 && m('span.issue-badge', `${stepChecks.length} 项检查`),
                  m('button.step-menu', { onclick: (event: Event) => { event.stopPropagation(); store.removeStep(step.id); m.redraw(); }, title: '删除步骤' }, '×'),
                ]),
                m('div.step-statement', renderRichText(step.statement)),
                m('div.step-footer', [
                  m('span.binding-line', bindingLine(step)),
                  step.note && m('span.has-note', '含旁注'),
                  step.counterexample && m('span.has-counterexample', '含反例'),
                  step.alternative && m('span.has-branch', '含替代分支'),
                ]),
              ]),
            ]);
          })),
        ]),
        m('aside.right-rail', [
          selected ? m('section.panel.inspector', [
            m('div.panel-heading', [m('span', '步骤检查器'), m('span.inspector-step', `#${shortId(selected.id)}`)]),
            m('label.field-label', '步骤类型'),
            m('div.select.is-fullwidth', m('select', { value: selected.type, onchange: (event: Event) => store.updateStep({ type: (event.target as HTMLSelectElement).value as ProofStep['type'] }) }, Object.entries(typeLabel).map(([value, label]) => m('option', { value }, label)))),
            m('label.field-label', '命题或推导式'),
            m('textarea.textarea.formula-textarea', {
              value: selected.statement,
              rows: 4,
              onfocus: (event: Event) => { store.lastInput = event.target as HTMLTextAreaElement; },
              oninput: (event: Event) => store.updateStep({ statement: (event.target as HTMLTextAreaElement).value }),
            }),
            m('div.formula-toolbar', snippets.map((snippet) => m('button.formula-key', {
              title: `插入 ${snippet.label}`,
              onclick: (event: Event) => {
                event.preventDefault();
                const input = store.lastInput;
                if (!input) return;
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                const next = input.value.slice(0, start) + snippet.value + input.value.slice(end);
                input.value = next;
                if (input instanceof HTMLTextAreaElement) store.updateStep({ statement: next });
                else store.update((doc) => { doc.goal = next; });
                input.focus();
                const cursor = start + snippet.value.length;
                input.setSelectionRange(cursor, cursor);
                m.redraw();
              },
            }, snippet.label))),
            m('div.binding-editor', isPremiseAxiom(selected)
              ? m('div.binding-banner.is-info', [m('strong', '公理起点'), m('p', '显式前提无需引用规则包；如需要可在下方选择规则来源。'), this.renderRuleSelector(selected)])
              : this.renderSlotEditor(document, selected)),
            m('div.field-grid', [
              m('div', [m('label.field-label', '旁注'), m('textarea.textarea.is-small', { rows: 2, value: selected.note, placeholder: '记录思路或条件', oninput: (event: Event) => store.updateStep({ note: (event.target as HTMLTextAreaElement).value }) })]),
              m('div', [m('label.field-label', '反例 / 边界情况'), m('textarea.textarea.is-small', { rows: 2, value: selected.counterexample, placeholder: '尝试寻找反例', oninput: (event: Event) => store.updateStep({ counterexample: (event.target as HTMLTextAreaElement).value }) })]),
              m('div', [m('label.field-label', '替代分支'), m('textarea.textarea.is-small', { rows: 2, value: selected.alternative, placeholder: '另一种可行推导', oninput: (event: Event) => store.updateStep({ alternative: (event.target as HTMLTextAreaElement).value }) })]),
            ]),
            m('button.button.is-small.is-white.is-fullwidth.add-symbol', {
              onclick: () => {
                const symbolName = window.prompt('输入符号名称');
                if (!symbolName) return;
                const meaning = window.prompt('输入符号含义') ?? '待补充';
                store.update((doc) => { doc.symbols[symbolName] = meaning; });
                m.redraw();
              },
            }, '＋ 登记新符号'),
          ]) : m('section.panel.inspector', m('p.empty-copy', '选择一个步骤进行检查。')),
          m('section.panel.symbol-panel', [
            m('div.panel-heading', [m('span', '符号表'), m('span.count-badge', Object.keys(document.symbols).length)]),
            m('div.symbol-list', Object.entries(document.symbols).map(([symbolKey, meaning]) => m('div.symbol-row', [
              m('code', symbolKey),
              m('input.symbol-meaning', { value: meaning, oninput: (event: Event) => store.update((item) => { item.symbols[symbolKey] = (event.target as HTMLInputElement).value; }) }),
            ]))),
          ]),
          m('section.panel.checks-panel', [
            m('div.panel-heading', [m('span', '检查结果'), m('span.count-badge', checks.length)]),
            m('div.check-list', checks.map((check) => m('button.check-item', {
              class: check.severity,
              onclick: () => { if (check.stepId) { store.selectStep(check.stepId); globalThis.document.querySelector(`[data-step="${check.stepId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } m.redraw(); },
            }, [
              m('span.check-icon', check.severity === 'error' ? '×' : check.severity === 'warning' ? '!' : '✓'),
              m('span', [m('strong', check.title), m('small', check.detail)]),
            ]))),
          ]),
          m('section.shortcut-card', [
            m('span.eyebrow', 'KEYBOARD'),
            m('p', [m('kbd', 'Ctrl'), ' + ', m('kbd', 'Enter'), ' 新步骤']),
            m('p', [m('kbd', 'Alt'), ' + ', m('kbd', '↑↓'), ' 切换步骤']),
            m('p', [m('kbd', 'Ctrl'), ' + ', m('kbd', 'Z'), ' 撤销']),
          ]),
        ]),
      ]),
      selectedVersion && m('div.diff-overlay', { onclick: () => { store.compareVersionId = ''; m.redraw(); } }, [
        m('section.diff-dialog', { onclick: (event: Event) => event.stopPropagation() }, [
          m('header.diff-head', [
            m('div', [m('span.eyebrow', 'VERSION DIFF'), m('h2', `${selectedVersion.name} ↔ 当前版本`)]),
            m('button.delete', { onclick: () => { store.compareVersionId = ''; m.redraw(); } }),
          ]),
          m('div.diff-summary', [
            m('span.tag.is-danger', `删除 ${diff.filter((item) => item.kind === 'removed').length}`),
            m('span.tag.is-success', `新增 ${diff.filter((item) => item.kind === 'added').length}`),
            m('span.tag.is-warning', `修改 ${diff.filter((item) => item.kind === 'changed').length}`),
            m('span.tag.is-light', `未变 ${diff.filter((item) => item.kind === 'same').length}`),
          ]),
          m('div.diff-table', [
            m('div.diff-row.diff-header', [m('span', '位置'), m('span', '旧版本'), m('span', '当前版本')]),
            ...diff.map((item) => m('div.diff-row', { class: `is-${item.kind}` }, [
              m('span.diff-label', item.label),
              m('span', item.before || '—'),
              m('span', item.after || '—'),
            ])),
          ]),
        ]),
      ]),
      this.modal.kind === 'pack' && this.renderPackModal(this.modal.pack),
      this.modal.kind === 'import' && this.renderImportModal(this.modal),
      store.toast && m('div.toast-notification', store.toast),
    ]);
  }
}
