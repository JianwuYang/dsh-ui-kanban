/**
 * 设置卡片（settings.plugin.item 插槽）：在 设置 → 插件 → Configurable 里
 * 注册一张 dsh-kanban 配置卡片，让公共配置（dataDir / allowSelfSigned /
 * verbose / activeProject）可以在 GUI 里点击修改。
 *
 * 数据链路：host 半边（src/index.ts）把配置注册成 settings 命名空间 `dsh-kanban`
 * （cordis.yml 配置是 composition base 层）；本模块经 settingsScope 服务绑定该命名
 * 空间，读取解析值、展示表单、把用户改动写进用户设置文档；host 半边实时读取命名空间
 * 解析值，因此保存后立即生效。项目的 Jira / GitLab 连接配置用 kanban-configure
 * 工具配置（涉及密钥，GUI 卡片只管理全局 host/token 与公共开关）。
 *
 * 关于"开箱即用"：卡片在任何状态下都渲染。harness 的 Web 网关只把白名单内的 settings
 * 命名空间暴露给设置面板（WEB_SETTINGS_NAMESPACES），第三方命名空间不在名单时
 * settings.describe 回答 settings-not-exposed——此时卡片渲染"未暴露"说明。
 * @module dsh-kanban/client/config-card
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { NAMESPACE } from './constants.ts'
import { IcChevronDown } from './icons.tsx'
import { t, useT, type TKey } from './locales.ts'
import type { SettingsScopeBinderLike, SettingsScopeLike } from './types.ts'

type FieldKind = 'text' | 'checkbox' | 'host' | 'secret'

interface FieldSpec {
  field: string
  kind: FieldKind
  labelKey: TKey
  hintKey: TKey
}

const FIELDS: readonly FieldSpec[] = [
  { field: 'jira.baseUrl', kind: 'host', labelKey: 'fieldGlobalJiraUrl', hintKey: 'fieldGlobalJiraUrlHint' },
  { field: 'jira.apiToken', kind: 'secret', labelKey: 'fieldGlobalJiraToken', hintKey: 'fieldGlobalJiraTokenHint' },
  { field: 'gitlab.baseUrl', kind: 'host', labelKey: 'fieldGlobalGitlabUrl', hintKey: 'fieldGlobalGitlabUrlHint' },
  { field: 'gitlab.apiToken', kind: 'secret', labelKey: 'fieldGlobalGitlabToken', hintKey: 'fieldGlobalGitlabTokenHint' },
  { field: 'dataDir', kind: 'text', labelKey: 'fieldDataDir', hintKey: 'fieldDataDirHint' },
  { field: 'allowSelfSigned', kind: 'checkbox', labelKey: 'fieldAllowSelfSigned', hintKey: 'fieldAllowSelfSignedHint' },
  { field: 'verbose', kind: 'checkbox', labelKey: 'fieldVerbose', hintKey: 'fieldVerboseHint' },
]

/** Read the global connection host (baseUrl) from a section value object. */
function hostBaseUrl(section: Record<string, unknown>, field: string): string {
  const obj = section[field]
  if (obj && typeof obj === 'object') {
    const b = (obj as Record<string, unknown>).baseUrl
    if (typeof b === 'string') return b
  }
  return ''
}

/** Parent key from a dotted field path (e.g. 'jira.baseUrl' -> 'jira'). */
function parentOf(field: string): string {
  const dot = field.indexOf('.')
  return dot === -1 ? field : field.slice(0, dot)
}

type StagedEdit = { kind: 'edit'; text: string } | { kind: 'clear' } | { kind: 'toggle'; value: boolean }

interface FieldState { text?: string; checked?: boolean; overridden: boolean; invalid: boolean }
interface CardShell {
  status: 'loading' | 'ready' | 'unavailable'
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}
interface PlannedWrite { field: string; run: (() => Promise<boolean>) | undefined }

/** 暂存表单：编辑只进草稿，Save 是唯一写入点，保存后从 Host 接受的结果回读。 */
class CardForm {
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  constructor(private readonly scope: SettingsScopeLike) {
    scope.subscribe(() => this.publish())
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      status: snapshot.status,
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  fieldState(field: string): FieldState {
    const spec = this.spec(field)
    const staged = this.staged.get(field)
    const section = this.sectionValue()
    const stored = this.stored(field)
    if (spec.kind === 'checkbox') {
      if (staged === undefined) return { checked: section[field] === true, overridden: stored, invalid: false }
      if (staged.kind === 'toggle') return { checked: staged.value, overridden: true, invalid: false }
      return { checked: section[field] === true, overridden: false, invalid: false }
    }
    if (spec.kind === 'host') {
      const cur = hostBaseUrl(section, parentOf(field))
      if (staged === undefined) return { text: cur, overridden: stored, invalid: false }
      if (staged.kind === 'clear') return { text: cur, overridden: false, invalid: false }
      if (staged.kind !== 'edit') return { text: '', overridden: false, invalid: false }
      return { text: staged.text, overridden: true, invalid: false }
    }
    if (spec.kind === 'secret') {
      // The token is `role('secret')` and never returned to the browser; the
      // field always renders the (staged) user input, empty unless they type.
      const text = staged && staged.kind === 'edit' ? staged.text : ''
      return { text, overridden: stored, invalid: false }
    }
    if (staged === undefined) return { text: this.format(spec, section[field]), overridden: stored, invalid: false }
    if (staged.kind === 'clear') return { text: this.format(spec, section[field]), overridden: false, invalid: false }
    if (staged.kind !== 'edit') return { text: '', overridden: false, invalid: false }
    return { text: staged.text, overridden: true, invalid: false }
  }

  edit(field: string, text: string): void {
    this.staged.set(field, { kind: 'edit', text })
    this.failed = false
    this.publish()
  }

  toggle(field: string, value: boolean): void {
    this.staged.set(field, { kind: 'toggle', value })
    this.failed = false
    this.publish()
  }

  resetField(field: string): void {
    this.staged.set(field, { kind: 'clear' })
    this.failed = false
    this.publish()
  }

  discard(): void {
    if (this.staged.size === 0 && !this.failed) return
    this.staged.clear()
    this.failed = false
    this.publish()
  }

  async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap((item) => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) landed = await write() && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    const global: { jira?: Record<string, string>; gitlab?: Record<string, string> } = {}
    let dirtyGlobal = false
    for (const [field, staged] of this.staged) {
      const spec = this.spec(field)
      if (spec.kind === 'host' || spec.kind === 'secret') {
        const [parent, key] = field.split('.')
        if (parent === undefined || key === undefined) continue
        const target = global[parent as 'jira' | 'gitlab'] ?? (global[parent as 'jira' | 'gitlab'] = {})
        if (staged.kind === 'clear') { target[key] = ''; dirtyGlobal = true; continue }
        if (staged.kind !== 'edit') continue
        if (spec.kind === 'host') { target[key] = staged.text; dirtyGlobal = true }
        // A secret sends ONLY when the user typed a new value; blank keeps the
        // host-side token (the browser never saw it and must not clobber it).
        else if (staged.text !== '') { target[key] = staged.text; dirtyGlobal = true }
        continue
      }
      if (staged.kind === 'toggle') { plan.push({ field, run: () => this.store(field, staged.value) }); continue }
      if (staged.kind === 'clear') { if (this.stored(field)) plan.push({ field, run: () => this.clear(field) }); continue }
      if (staged.text === this.format(spec, this.sectionValue()[field])) continue
      plan.push({ field, run: staged.text === '' ? () => this.clear(field) : () => this.store(field, staged.text) })
    }
    if (dirtyGlobal) plan.push({ field: '_global', run: () => this.saveGlobal(global) })
    return plan
  }

  private async store(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    return this.stored(field) && this.sectionValue()[field] === value
  }

  /** Merge-only write of the GLOBAL jira/gitlab host+token (keeps the redacted secret). */
  private async saveGlobal(patch: { jira?: Record<string, string>; gitlab?: Record<string, string> }): Promise<boolean> {
    try {
      const res = await fetch('/kanban-api/settings/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      return res.ok
    } catch {
      return false
    }
  }

  private async clear(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  private sectionValue(): Record<string, unknown> {
    const value = this.scope.getSnapshot().value
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }

  private stored(field: string): boolean {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null && Object.prototype.hasOwnProperty.call(user, field)
  }

  private spec(field: string): FieldSpec {
    const spec = FIELDS.find((candidate) => candidate.field === field)
    if (spec === undefined) throw new Error(`card has no field ${field}`)
    return spec
  }

  private format(_spec: FieldSpec, value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

export function registerConfigCard(ctx: Context): void {
  let form: CardForm | undefined
  const settingsScope: SettingsScopeBinderLike | undefined = ctx.get('settingsScope')
  if (settingsScope === undefined) {
    console.warn(`[${NAMESPACE}] settingsScope service absent; the config card shows the unmounted state`)
  } else {
    form = new CardForm(settingsScope.bind({ namespace: NAMESPACE }))
  }

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
    { name: 'settings.plugin.item', key: NAMESPACE },
    () => React.createElement(ConfigCard, { form }),
  ))
}

function ConfigCard({ form }: { form: CardForm | undefined }): React.ReactElement | null {
  const [, forceRender] = React.useReducer((c: number) => c + 1, 0)
  const [open, setOpen] = React.useState(false)
  useT() // 语言切换时重渲染（renderField 走模块级 t）
  React.useEffect(() => (form === undefined ? undefined : form.subscribe(forceRender)), [form])

  if (form === undefined) {
    return statusCard(t('cardNotMounted'), t('cardNotMountedBody'))
  }

  const shell = form.shell()
  if (!shell.available) {
    if (shell.status === 'unavailable') {
      return statusCard(
        t('cardNotExposed'),
        t('cardNotExposedBody'),
        t('cardNotExposedRemedy'),
      )
    }
    return statusCard(t('cardLoading'), t('cardLoadingBody'))
  }

  const blocked = !shell.dirty || shell.invalid || shell.saving

  return React.createElement('li', { className: open ? 'kkb-card-open kkb-config-card' : 'kkb-config-card' },
    React.createElement('button', {
      type: 'button',
      className: 'kkb-config-head',
      'aria-expanded': open,
      onClick: () => setOpen(!open),
    },
      React.createElement('span', { className: 'kkb-config-head-text' },
        React.createElement('span', { className: 'kkb-config-name' }, NAMESPACE),
        React.createElement('span', { className: 'kkb-config-desc' }, t('cardDesc')),
      ),
      shell.dirty ? React.createElement('span', { className: 'kkb-pending' }, t('unsaved')) : null,
      React.createElement('span', { className: open ? 'kkb-chevron kkb-chevron-open' : 'kkb-chevron' },
        React.createElement(IcChevronDown, { size: 14 })),
    ),
    open ? React.createElement('div', { className: 'kkb-config-body' },
      !shell.writable ? React.createElement('p', { className: 'kkb-read-only', role: 'status' }, t('readOnlyNote')) : null,
      FIELDS.map((spec) => renderField(form, spec, shell)),
      React.createElement('div', { className: 'kkb-config-footer' },
        shell.failed ? React.createElement('p', { className: 'kkb-failed', role: 'status' }, t('cardSaveFailed')) : null,
        React.createElement('button', { type: 'button', className: 'kkb-discard', disabled: !shell.dirty || shell.saving, onClick: () => form.discard() }, t('discard')),
        React.createElement('button', { type: 'button', className: 'kkb-save', disabled: blocked, onClick: () => { void form.save() } }, shell.saving ? t('saving') : t('save')),
      ),
    ) : null,
  )
}

function statusCard(title: string, body: string, remedy?: string): React.ReactElement {
  return React.createElement('li', { className: 'kkb-config-card' },
    React.createElement('div', { className: 'kkb-config-status' },
      React.createElement('p', { className: 'kkb-config-status-title' }, title),
      React.createElement('p', { className: 'kkb-config-status-body' }, body),
      remedy === undefined ? null : React.createElement('p', { className: 'kkb-config-status-body' }, remedy),
    ),
  )
}

function renderField(form: CardForm, spec: FieldSpec, shell: CardShell): React.ReactElement {
  const state = form.fieldState(spec.field)
  const disabled = !shell.writable
  const inputType = spec.kind === 'checkbox' ? 'checkbox' : spec.kind === 'secret' ? 'password' : 'text'
  const control = spec.kind === 'checkbox'
    ? React.createElement('input', {
        id: `kkb-${spec.field}`, type: 'checkbox', checked: state.checked === true, disabled,
        onChange: (event) => form.toggle(spec.field, (event.target as unknown as { checked: boolean }).checked),
      })
    : React.createElement('input', {
        id: `kkb-${spec.field}`, type: inputType, value: state.text ?? '', disabled,
        onChange: (event) => form.edit(spec.field, (event.target as unknown as { value: string }).value),
      })

  return React.createElement('div', { className: 'kkb-field' },
    React.createElement('div', { className: 'kkb-field-head' },
      React.createElement('label', { className: 'kkb-label', htmlFor: `kkb-${spec.field}` }, t(spec.labelKey)),
      state.overridden
        ? React.createElement('span', { className: 'kkb-badges' },
            React.createElement('span', { className: 'kkb-badge' }, t('overridden')),
            React.createElement('button', { type: 'button', className: 'kkb-reset', disabled, 'aria-label': t('resetAria', { label: t(spec.labelKey) }), onClick: () => form.resetField(spec.field) }, t('reset')),
          )
        : null,
    ),
    control,
    React.createElement('p', { className: 'kkb-hint' }, t(spec.hintKey)),
  )
}
