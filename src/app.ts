import m, { type Component } from 'mithril';
import katex from 'katex';
import { compareVersion, effectiveBindingStatus, ProofStore, SAMPLE_PACKAGES } from './store';
import type { EffectiveBindingStatus, ProofDocument, ProofStep } from './types';

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

const bindingStatusMeta: Record<EffectiveBindingStatus, { label: string; className: string }> = {
  ok: { label: '已绑定', className: 'is-ok' },
  pending: { label: '待确认', className: 'is-pending' },
  stale: { label: '待复核', className: 'is-stale' },
  orphan: { label: '来源缺失', className: 'is-stale' },
  unbound: { label: '未绑定', className: 'is-stale' },
};

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

function ruleSourceOf(step: ProofStep): string {
  return step.binding ? `${step.rule} · ${step.binding.packageName} v${step.binding.packageVersion}` : step.rule;
}

function slotSummaryOf(document: ProofDocument, step: ProofStep): string {
  const binding = step.binding;
  if (!binding) return '';
  const parts: string[] = [];
  binding.snapshot.premiseSlots.forEach((slot) => {
    const target = binding.slots[slot.id];
    const index = target ? document.steps.findIndex((item) => item.id === target) : -1;
    parts.push(`${slot.label} ← ${index >= 0 ? `步骤 ${index + 1}` : '未绑定'}`);
  });
  binding.snapshot.conclusionSlots.forEach((slot) => parts.push(`${slot.label} → 本步骤`));
  return parts.join('；');
}

function exportMarkdown(document: ProofDocument): string {
  const lines = [`# ${document.title}`, '', `**证明目标：** $${document.goal}$`, ''];
  document.steps.forEach((step, index) => {
    const refs = step.references.map((id) => `步骤 ${document.steps.findIndex((item) => item.id === id) + 1}`).filter((ref) => ref !== '步骤 0');
    lines.push(`## ${index + 1}. ${step.statement}`);
    lines.push('');
    lines.push(`- 类型：${typeLabel[step.type]}`);
    lines.push(`- 推理规则：${ruleSourceOf(step)}`);
    const slots = slotSummaryOf(document, step);
    if (slots) lines.push(`- 槽位绑定：${slots}`);
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
    const support = refs.length ? `（依据 ${refs.join(', ')}；${ruleSourceOf(step)}）` : `（${ruleSourceOf(step)}）`;
    lines.push(`  \\item ${step.statement} ${support}`);
    if (step.note) lines.push(`  \\par\\small 旁注：${step.note}`);
  });
  lines.push('\\end{enumerate}', '\\end{document}');
  return lines.join('\n');
}

export class ProofApp implements Component {
  private importOpen = false;
  private importText = '';
  private importError = '';

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

  private tryExport(kind: 'md' | 'tex'): void {
    if (!store.canExport) {
      const pending = store.unconfirmedSteps;
      store.notify(`还有 ${pending.length} 个步骤的规则绑定待确认，请逐条确认后再导出`);
      if (pending[0]) {
        store.selectStep(pending[0].id);
        globalThis.document.querySelector(`[data-step="${pending[0].id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      m.redraw();
      return;
    }
    const document = store.current;
    if (kind === 'md') download(`${document.title}.md`, exportMarkdown(document), 'text/markdown;charset=utf-8');
    else download(`${document.title}.tex`, exportLatex(document), 'application/x-tex;charset=utf-8');
  }

  view(): m.Children {
    const document = store.current;
    const selected = store.selectedStep;
    const checks = store.checks;
    const errors = checks.filter((check) => check.severity === 'error').length;
    const warnings = checks.filter((check) => check.severity === 'warning').length;
    const unconfirmed = store.unconfirmedSteps.length;
    const selectedVersion = document.versions.find((version) => version.id === store.compareVersionId);
    const diff = selectedVersion ? compareVersion(document, selectedVersion) : [];

    return m('div.app-shell', [
      m('header.topbar', [
        m('div.brand', [
          m('div.brand-mark', '∑'),
          m('div', [m('p.eyebrow', 'FORMAL NOTEBOOK'), m('h1', '格致 · 证明编辑器')]),
        ]),
        m('div.topbar-center', [
          m('span.status-dot', { class: errors ? 'has-error' : 'is-ok' }),
          errors ? `${errors} 个结构错误` : '证明结构可检查',
          unconfirmed > 0 && m('span.topbar-separator'),
          unconfirmed > 0 && m('span.unconfirmed-flag', `${unconfirmed} 条规则绑定待确认`),
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
          m('section.panel.package-panel', [
            m('div.panel-heading', [m('span', '规则包'), m('button.icon-button', { onclick: () => { this.importOpen = true; this.importError = ''; m.redraw(); }, title: '导入规则包' }, '+')]),
            m('div.package-list', store.packages.map((pkg) => {
              const expanded = store.expandedPackageId === pkg.id;
              const usedCount = document.steps.filter((step) => step.binding?.packageId === pkg.id).length;
              return m('div.package-item', { class: expanded ? 'is-expanded' : '' }, [
                m('button.package-row', { onclick: () => { store.expandedPackageId = expanded ? '' : pkg.id; m.redraw(); } }, [
                  m('span.package-copy', [
                    m('strong', pkg.name),
                    m('small', `v${pkg.version} · ${pkg.rules.length} 条规则${usedCount ? ` · 本证明引用 ${usedCount} 次` : ''}`),
                  ]),
                  pkg.builtin && m('span.pkg-badge', '内置'),
                  pkg.conflictsWith.length > 0 && m('span.pkg-badge.is-conflict', '互斥'),
                  m('span.chevron', expanded ? '▾' : '›'),
                ]),
                expanded && m('div.package-rules', [
                  pkg.conflictsWith.length > 0 && m('p.package-conflict-note', `与「${pkg.conflictsWith.map((id) => store.packages.find((item) => item.id === id || item.name === id)?.name ?? id).join('、')}」互斥，不能混用`),
                  pkg.rules.map((rule) => m('div.package-rule', [
                    m('div.package-rule-head', [m('strong', rule.name), m('span.rule-slots', `前提槽 ${rule.premiseSlots.length} · 结论槽 ${rule.conclusionSlots.length}`)]),
                    rule.statement && m('div.package-rule-statement', renderRichText(rule.statement)),
                    m('div.package-rule-meta', [
                      rule.premiseSlots.length > 0 && m('span', `前提槽：${rule.premiseSlots.map((slot) => slot.label).join('、')}`),
                      rule.conclusionSlots.length > 0 && m('span', `结论槽：${rule.conclusionSlots.map((slot) => slot.label).join('、')}`),
                      Object.keys(rule.symbols).length > 0 && m('span', `符号环境：${Object.entries(rule.symbols).map(([key, value]) => `${key}（${value}）`).join('、')}`),
                    ]),
                  ])),
                  !pkg.builtin && m('button.button.is-small.is-white.is-fullwidth.package-remove', { onclick: () => { store.removePackage(pkg.id); m.redraw(); } }, '移除规则包'),
                ]),
              ]);
            })),
            m('p.empty-copy', '步骤绑定规则包中的规则与槽位后，步骤才能通过检查。'),
          ]),
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
            m('p', errors ? '修正错误后再保存为定稿。' : unconfirmed ? `${unconfirmed} 条规则绑定待确认，逐条确认后才能导出。` : warnings ? '结构有效，仍有待核对项。' : '当前结构与引用关系完整。'),
          ]),
        ]),
        m('section.editor-column', [
          m('div.editor-titlebar', [
            m('div', [
              m('input.title-input', { value: document.title, oninput: (event: Event) => { store.update((item) => { item.title = (event.target as HTMLInputElement).value; }); } }),
              m('div.editor-meta', [`${document.author} · ${document.steps.length} 个步骤`, m('span.keyboard-hint', '拖动 ⠿ 排序')]),
            ]),
            m('div.export-actions', [
              m('button.button.is-small', { onclick: () => this.tryExport('md'), title: store.canExport ? '导出 Markdown' : '存在待确认的规则绑定' }, '导出 Markdown'),
              m('button.button.is-small', { onclick: () => this.tryExport('tex'), title: store.canExport ? '导出 LaTeX' : '存在待确认的规则绑定' }, '导出 LaTeX'),
            ]),
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
            const bindingStatus = effectiveBindingStatus(step, store.packages);
            const statusMeta = bindingStatusMeta[bindingStatus];
            return m('article.step-card', {
              'data-step': step.id,
              class: step.id === store.selectedStepId ? 'is-selected' : '',
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
                  m('span.rule-chip', { title: step.binding ? `来源：${step.binding.packageName} v${step.binding.packageVersion}` : '未绑定规则包' }, step.binding ? `${step.rule} · ${step.binding.packageName}` : step.rule),
                  bindingStatus !== 'ok' && m('span.step-binding-badge', { class: statusMeta.className }, statusMeta.label),
                  m('span.step-id', `#${shortId(step.id)}`),
                  stepChecks.length > 0 && m('span.issue-badge', `${stepChecks.length} 项检查`),
                  m('button.step-menu', { onclick: (event: Event) => { event.stopPropagation(); store.removeStep(step.id); m.redraw(); }, title: '删除步骤' }, '×'),
                ]),
                m('div.step-statement', renderRichText(step.statement)),
                m('div.step-footer', [
                  m('span', step.references.length ? `依据：${step.references.map((reference) => {
                    const referenceIndex = document.steps.findIndex((item) => item.id === reference);
                    return referenceIndex >= 0 ? `步骤 ${referenceIndex + 1}` : `缺失 ${shortId(reference)}`;
                  }).join('、')}` : '独立前提'),
                  step.note && m('span.has-note', '含旁注'),
                  step.counterexample && m('span.has-counterexample', '含反例'),
                  step.alternative && m('span.has-branch', '含替代分支'),
                ]),
              ]),
            ]);
          })),
        ]),
        m('aside.right-rail', [
          selected ? this.renderInspector(document, selected) : m('section.panel.inspector', m('p.empty-copy', '选择一个步骤进行检查。')),
          m('section.panel.symbol-panel', [
            m('div.panel-heading', [m('span', '符号表'), m('span.count-badge', Object.keys(document.symbols).length)]),
            m('div.symbol-list', Object.entries(document.symbols).map(([symbol, meaning]) => m('div.symbol-row', [
              m('code', symbol),
              m('input.symbol-meaning', { value: meaning, oninput: (event: Event) => store.update((item) => { item.symbols[symbol] = (event.target as HTMLInputElement).value; }) }),
            ]))),
          ]),
          m('section.panel.checks-panel', [
            m('div.panel-heading', [m('span', '检查结果'), m('span.count-badge', checks.length)]),
            m('div.check-list', checks.map((check) => {
              const confirmable = (check.id.startsWith('binding-stale-') || check.id.startsWith('binding-pending-')) && check.stepId;
              return m('div.check-item', {
                class: check.severity,
                role: 'button',
                tabindex: 0,
                onclick: () => { if (check.stepId) { store.selectStep(check.stepId); globalThis.document.querySelector(`[data-step="${check.stepId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } m.redraw(); },
              }, [
                m('span.check-icon', check.severity === 'error' ? '×' : check.severity === 'warning' ? '!' : '✓'),
                m('span', [m('strong', check.title), m('small', check.detail)]),
                confirmable && m('button.check-confirm', {
                  onclick: (event: Event) => { event.stopPropagation(); store.confirmBinding(check.stepId!); m.redraw(); },
                  title: '确认此步骤的规则' + (check.id.startsWith('binding-stale-') ? '，按当前规则内容继续' : '的规则映射'),
                }, '确认'),
              ]);
            })),
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
      this.importOpen && m('div.diff-overlay', { onclick: () => { this.importOpen = false; m.redraw(); } }, [
        m('section.diff-dialog.import-dialog', { onclick: (event: Event) => event.stopPropagation() }, [
          m('header.diff-head', [
            m('div', [m('span.eyebrow', 'RULE PACKAGE'), m('h2', '导入规则包')]),
            m('button.delete', { onclick: () => { this.importOpen = false; m.redraw(); } }),
          ]),
          m('div.import-body', [
            m('p.import-tip', '粘贴规则包 JSON。每条规则需声明前提槽、结论槽与符号环境；包 id 相同视为更新，更新后受影响的步骤会立即标记为待复核，原绑定保留。'),
            m('textarea.textarea.import-textarea', {
              rows: 9,
              placeholder: '{"id":"pkg-...","name":"...","version":"1.0","conflictsWith":[],"rules":[{"id":"rule-...","name":"...","statement":"...","premiseSlots":[{"id":"...","label":"..."}],"conclusionSlots":[{"id":"...","label":"..."}],"symbols":{}}]}',
              value: this.importText,
              oninput: (event: Event) => { this.importText = (event.target as HTMLTextAreaElement).value; },
            }),
            this.importError && m('p.import-error', this.importError),
            m('div.import-actions', [
              m('button.button.is-link', {
                onclick: () => {
                  const result = store.importPackageText(this.importText);
                  if (result.ok) {
                    this.importOpen = false;
                    this.importText = '';
                    this.importError = '';
                  } else {
                    this.importError = result.message;
                  }
                  m.redraw();
                },
              }, '导入 / 更新'),
              m('button.button', { onclick: () => { this.importOpen = false; m.redraw(); } }, '取消'),
            ]),
            m('div.import-samples', [
              m('span.eyebrow', '示例规则包'),
              SAMPLE_PACKAGES.map((pkg) => m('button.button.is-small.is-white', {
                onclick: () => { store.installSample(pkg.id); this.importOpen = false; m.redraw(); },
                title: pkg.id === 'pkg-algebra' ? '与内置包同 id，用于演示包更新后步骤待复核' : pkg.conflictsWith.length ? '与内置包互斥，用于演示冲突包不能混用' : '包含与内置包同名的规则，用于演示来源保留',
              }, `${pkg.name} v${pkg.version}${pkg.id === 'pkg-algebra' ? '（演示更新）' : ''}`)),
            ]),
          ]),
        ]),
      ]),
      store.toast && m('div.toast-notification', store.toast),
    ]);
  }

  private renderInspector(document: ProofDocument, selected: ProofStep): m.Children {
    const binding = selected.binding;
    const status = effectiveBindingStatus(selected, store.packages);
    const statusMeta = bindingStatusMeta[status];
    const pkg = binding ? store.packages.find((item) => item.id === binding.packageId) : undefined;
    const rule = pkg?.rules.find((item) => item.id === binding?.ruleId);
    const content = rule ?? binding?.snapshot;

    return m('section.panel.inspector', [
      m('div.panel-heading', [m('span', '步骤检查器'), m('span.inspector-step', `#${shortId(selected.id)}`)]),
      m('label.field-label', '步骤类型'),
      m('div.select.is-fullwidth', m('select', { value: selected.type, onchange: (event: Event) => store.updateStep({ type: (event.target as HTMLSelectElement).value as ProofStep['type'] }) }, Object.entries(typeLabel).map(([value, label]) => m('option', { value }, label)))),
      m('label.field-label', '推理规则（按规则包分组）'),
      m('div.select.is-fullwidth', m('select', {
        value: binding ? `${binding.packageId}/${binding.ruleId}` : '',
        onchange: (event: Event) => {
          const [packageId, ruleId] = (event.target as HTMLSelectElement).value.split('/');
          store.bindRule(selected.id, packageId, ruleId);
          m.redraw();
        },
      }, [
        !binding && m('option', { value: '', disabled: true }, selected.rule ? `旧规则「${selected.rule}」未绑定，请选择来源` : '选择规则包中的规则…'),
        store.packages.map((item) => m('optgroup', { label: `${item.name} v${item.version}` }, item.rules.map((itemRule) => m('option', { value: `${item.id}/${itemRule.id}` }, itemRule.name)))),
      ])),
      binding && content && m('div.binding-card', { class: `is-${status}` }, [
        m('div.binding-head', [
          m('span.binding-source', `${binding.packageName} v${binding.packageVersion}`),
          m('span.binding-status', { class: statusMeta.className }, statusMeta.label),
        ]),
        status === 'stale' && pkg && m('p.binding-hint', `规则包已更新到 v${pkg.version}，原绑定内容保留，确认后按当前内容继续。`),
        status === 'pending' && m('p.binding-hint', '由旧规则名自动映射生成，请核对来源与槽位后确认。'),
        status === 'orphan' && m('p.binding-hint', '来源规则包或规则已移除，请重新选择规则。'),
        status === 'stale' && rule && m('div.binding-diff', [
          m('div', [m('span.diff-tag', '绑定时'), renderRichText(binding.snapshot.statement || '—')]),
          m('div', [m('span.diff-tag', '当前包'), renderRichText(rule.statement || '—')]),
        ]),
        status !== 'stale' && content.statement && m('div.binding-statement', renderRichText(content.statement)),
        content.premiseSlots.map((slot) => m('div.slot-row', [
          m('span.slot-label', `前提槽 · ${slot.label}`),
          m('div.select.is-small.is-fullwidth', m('select', {
            value: binding.slots[slot.id] ?? '',
            onchange: (event: Event) => { store.assignSlot(selected.id, slot.id, (event.target as HTMLSelectElement).value); m.redraw(); },
          }, [
            m('option', { value: '' }, '未绑定'),
            selected.references.map((reference) => {
              const referenceIndex = document.steps.findIndex((item) => item.id === reference);
              return m('option', { value: reference, disabled: referenceIndex < 0 }, referenceIndex >= 0 ? `步骤 ${referenceIndex + 1}` : `缺失 ${shortId(reference)}`);
            }),
          ])),
        ])),
        content.conclusionSlots.map((slot) => m('div.slot-row', [
          m('span.slot-label', `结论槽 · ${slot.label}`),
          m('span.slot-target', '本步骤'),
        ])),
        Object.keys(content.symbols).length > 0 && m('div.binding-symbols', Object.entries(content.symbols).map(([key, value]) => m('span.symbol-chip', `${key}：${value}`))),
        selected.references.length === 0 && content.premiseSlots.length > 0 && m('p.binding-hint', '请先在下方勾选引用步骤，再为每个前提槽选择依据。'),
        (status === 'pending' || status === 'stale') && m('button.button.is-small.is-link.is-fullwidth', {
          onclick: () => { store.confirmBinding(selected.id); m.redraw(); },
        }, status === 'stale' ? '确认按当前规则内容继续' : '确认此映射'),
      ]),
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
          else store.update((document) => { document.goal = next; });
          input.focus();
          const cursor = start + snippet.value.length;
          input.setSelectionRange(cursor, cursor);
          m.redraw();
        },
      }, snippet.label))),
      m('label.field-label', '引用步骤'),
      m('div.reference-list', document.steps.filter((step) => step.id !== selected.id).map((step) => m('label.reference-item', [
        m('input', {
          type: 'checkbox',
          checked: selected.references.includes(step.id),
          onchange: (event: Event) => {
            const checked = (event.target as HTMLInputElement).checked;
            const references = checked ? [...selected.references, step.id] : selected.references.filter((id) => id !== step.id);
            store.updateStep({ references });
          },
        }),
        m('span', `步骤 ${document.steps.indexOf(step) + 1}`),
        m('small', step.statement.replace(/\$/g, '')),
      ]))),
      m('div.field-grid', [
        m('div', [m('label.field-label', '旁注'), m('textarea.textarea.is-small', { rows: 2, value: selected.note, placeholder: '记录思路或条件', oninput: (event: Event) => store.updateStep({ note: (event.target as HTMLTextAreaElement).value }) })]),
        m('div', [m('label.field-label', '反例 / 边界情况'), m('textarea.textarea.is-small', { rows: 2, value: selected.counterexample, placeholder: '尝试寻找反例', oninput: (event: Event) => store.updateStep({ counterexample: (event.target as HTMLTextAreaElement).value }) })]),
        m('div', [m('label.field-label', '替代分支'), m('textarea.textarea.is-small', { rows: 2, value: selected.alternative, placeholder: '另一种可行推导', oninput: (event: Event) => store.updateStep({ alternative: (event.target as HTMLTextAreaElement).value }) })]),
      ]),
      m('button.button.is-small.is-white.is-fullwidth.add-symbol', {
        onclick: () => {
          const symbol = window.prompt('输入符号名称');
          if (!symbol) return;
          const meaning = window.prompt('输入符号含义') ?? '待补充';
          store.update((document) => { document.symbols[symbol] = meaning; });
          m.redraw();
        },
      }, '＋ 登记新符号'),
    ]);
  }
}
