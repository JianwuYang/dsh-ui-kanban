/**
 * KanbanApp 的全部弹窗：设置 / 新建 issue / GitLab 工作区（含 4 个子弹窗）/
 * issue 详情 / 图片灯箱。统一走 Modal（Esc/焦点/嵌套）+ toast + 应用内确认/输入框，
 * 不再使用原生 alert/confirm/prompt。
 * @module dsh-kanban/client/kanban-modals
 */

import React from 'react'
import {
  api, type BoardIssue, type BoardIssueDetail, type CreateMeta, type CreateMetaField,
  type CreateUserOption, type GitlabIssue, type GitlabListState, type GitlabMr,
  type JiraTransitionOption, type SettingsPayload,
} from './api.ts'
import { IcBranch, IcCheck, IcChevronDown, IcChevronLeft, IcChevronRight, IcClose, IcComment, IcExternalLink, IcGear, IcGitlab, IcImage, IcLink, IcPlus, IcSearch, IcSend, IcSync, IcTrash, IcWarning } from './icons.tsx'
import { Modal, useChoice, useConfirm } from './modal.tsx'
import type { PromptContentPartLike } from './types.ts'
import { Avatar, CopyButton, EmptyState, SegToggle, SkeletonCards, SkeletonDetail, StatusDot, formatDateTime } from './primitives.tsx'
import { t as translate, useT, type TKey } from './locales.ts'
import { priorityAccent, statusAccent, tintStyle, typeAccent } from './colors.ts'
import { useToast } from './toast.tsx'

/* ------------------------------ 小部件 ------------------------------ */

function Field({ label, required = false, children, error }: { label: string; required?: boolean; children: React.ReactNode; error?: string }): React.ReactElement {
  return (
    <label className="kb-field">
      <span className="kb-field__label">{label}{required ? <span className="kb-field__req">*</span> : null}</span>
      {children}
      {error ? <span className="kb-field__error" role="alert">{error}</span> : null}
    </label>
  )
}

/** 卡片/工具栏里的外链小按钮（打开 GitLab 页面）。 */
function ExtLink({ href, label }: { href: string; label: string }): React.ReactElement {
  return (
    <a className="kb-iconbtn kb-iconbtn--ghost kb-card__extlink" href={href} target="_blank" rel="noreferrer noopener"
      aria-label={label} title={label} onClick={(e) => e.stopPropagation()}>
      <IcExternalLink size={12} />
    </a>
  )
}

/** 统一风格的 select（appearance:none + 右侧 chevron）。 */
function SelectControl({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }): React.ReactElement {
  return (
    <div className="kb-select-wrap">
      <select className="kb-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="kb-select-wrap__chevron"><IcChevronDown size={12} /></span>
    </div>
  )
}

/**
 * 芯片式多值输入（模块/标签/版本等数组字段）：已选值显示为可移除的 chip；
 * 输入时下拉过滤 allowedValues 建议（点击加入），自由输入的新值回车添加。
 * 值模型与父级一致：逗号分隔字符串（jiraFieldValue 再按字段拆分）。
 */
function MultiValueField({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}): React.ReactElement {
  const t = useT()
  const [input, setInput] = React.useState('')
  // 建议下拉的显隐：聚焦/输入时展开，选中后、失焦或 Esc 收起。
  const [open, setOpen] = React.useState(false)
  const selected = value.split(',').map((s) => s.trim()).filter(Boolean)
  const commit = (raw: string): void => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    setOpen(false)
    if (!parts.length) { setInput(''); return }
    const next = [...selected]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next.join(','))
    setInput('')
  }
  const remove = (item: string): void => onChange(selected.filter((s) => s !== item).join(','))
  const q = input.trim().toLowerCase()
  const suggestions = open
    ? options.filter((o) => !selected.includes(o) && (!q || o.toLowerCase().includes(q))).slice(0, 8)
    : []
  return (
    <div className="kb-multi">
      {selected.length > 0 ? (
        <div className="kb-multi__chips">
          {selected.map((s) => (
            <span key={s} className="kb-tag">{s}
              <button type="button" className="kb-tag__x" aria-label={t('removeAttachAria', { name: s })} onClick={() => remove(s)}><IcClose size={10} /></button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="kb-combo">
        <input className="kb-input" value={input} placeholder={t('multiPlaceholder')}
          onFocus={() => { if (options.length > 0) setOpen(true) }}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(input) }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
          }} />
        {suggestions.length > 0 ? (
          <ul className="kb-combo__menu" role="listbox">
            {suggestions.map((o) => (
              <li key={o} role="option" aria-selected={false} onMouseDown={() => commit(o)}>{o}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------ 设置 ------------------------------ */

type SettingsTab = 'jira' | 'gitlab'

export function SettingsModal({ settings, onClose, onSave }: {
  settings: SettingsPayload['settings']
  onClose: () => void; onSave: (s: NonNullable<SettingsPayload['settings']>) => void | Promise<void>
}): React.ReactElement {
  const [tab, setTab] = React.useState<SettingsTab>('jira')
  const [jira, setJira] = React.useState(settings?.jira ?? { baseUrl: '', apiToken: '', projectKey: '', jql: '' })
  const [gitlab, setGitlab] = React.useState(settings?.gitlab ?? { baseUrl: '', apiToken: '', project: '', allowSelfSigned: true, branches: [] })
  const [testResult, setTestResult] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const toast = useToast()
  const t = useT()

  const save = async (): Promise<void> => {
    setBusy(true)
    // localRepo 不随表单保存（默认即工作区目录；PUT 按节合并，省略不影响已有覆盖）
    try { await onSave({ jira, gitlab }) }
    catch (error) { toast(error instanceof Error ? error.message : t('saveFailed'), 'error') }
    finally { setBusy(false) }
  }
  const testJira = async (): Promise<void> => {
    setTestResult(null)
    try {
      const r = await api.testSettings(jira)
      setTestResult(r.ok ? { ok: true, text: t('testOk', { user: r.user ?? '' }) } : { ok: false, text: t('testFail', { error: r.error ?? '' }) })
    } catch (e) { setTestResult({ ok: false, text: e instanceof Error ? e.message : t('testFail', { error: '' }) }) }
  }
  const testGitlab = async (): Promise<void> => {
    setTestResult(null)
    try {
      const r = await api.testGitlab(gitlab)
      setTestResult(r.ok ? { ok: true, text: t('testOk', { user: r.user ?? '' }) } : { ok: false, text: t('testFail', { error: r.error ?? '' }) })
    } catch (e) { setTestResult({ ok: false, text: e instanceof Error ? e.message : t('testFail', { error: '' }) }) }
  }

  const tabs: { value: SettingsTab; label: string }[] = [
    { value: 'jira', label: t('tabJira') },
    { value: 'gitlab', label: t('tabGitlab') },
  ]

  return (
    <Modal title={t('settingsTitle')} icon={<IcGear size={14} />} onClose={onClose} width="xl" footer={null}>
      <div className="kb-tabs">
        {tabs.map((t) => (
          <button key={t.value} className={tab === t.value ? 'kb-tab kb-tab--on' : 'kb-tab'} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}>{t.label}</button>
        ))}
      </div>

      {tab === 'jira' ? (
        <div className="kb-form">
          <Field label={t('fieldBaseUrl')}><input className="kb-input" value={jira.baseUrl} onChange={(e) => setJira({ ...jira, baseUrl: e.target.value })} placeholder="https://jira.example.com" /></Field>
          <Field label={t('fieldApiToken')}><input className="kb-input" type="password" value={jira.apiToken} onChange={(e) => setJira({ ...jira, apiToken: e.target.value })} placeholder={t('tokenPlaceholder')} /></Field>
          <Field label={t('fieldProjectKey')}><input className="kb-input" value={jira.projectKey} onChange={(e) => setJira({ ...jira, projectKey: e.target.value })} placeholder={t('projectKeyPlaceholder')} /></Field>
          <Field label={t('fieldJql')}><input className="kb-input" value={jira.jql} onChange={(e) => setJira({ ...jira, jql: e.target.value })} placeholder={t('jqlPlaceholder')} /></Field>
          {testResult ? <p className={testResult.ok ? 'kb-note kb-note--ok' : 'kb-note kb-note--error'} role="status">{testResult.text}</p> : null}
          <div className="kb-form__footer">
            <button className="kb-btn kb-btn--ghost" onClick={() => void testJira()}>{t('testConnection')}</button>
            <button className="kb-btn kb-btn--primary" disabled={busy} onClick={() => void save()}>{t('save')}</button>
          </div>
        </div>
      ) : tab === 'gitlab' ? (
        <div className="kb-form">
          <Field label={t('fieldBaseUrl')}><input className="kb-input" value={gitlab.baseUrl} onChange={(e) => setGitlab({ ...gitlab, baseUrl: e.target.value })} placeholder="https://gitlab.example.com" /></Field>
          <Field label={t('fieldApiToken')}><input className="kb-input" type="password" value={gitlab.apiToken} onChange={(e) => setGitlab({ ...gitlab, apiToken: e.target.value })} /></Field>
          <Field label={t('fieldProjectPath')}><input className="kb-input" value={gitlab.project} onChange={(e) => setGitlab({ ...gitlab, project: e.target.value })} placeholder={t('projectPathPlaceholder')} /></Field>
          <label className="kb-check"><input type="checkbox" checked={gitlab.allowSelfSigned ?? true} onChange={(e) => setGitlab({ ...gitlab, allowSelfSigned: e.target.checked })} /> {t('trustSelfSigned')}</label>
          {testResult ? <p className={testResult.ok ? 'kb-note kb-note--ok' : 'kb-note kb-note--error'} role="status">{testResult.text}</p> : null}
          <div className="kb-form__footer">
            <button className="kb-btn kb-btn--ghost" onClick={() => void testGitlab()}>{t('testConnection')}</button>
            <button className="kb-btn kb-btn--primary" disabled={busy} onClick={() => void save()}>{t('save')}</button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

/* ------------------------------ 新建 issue ------------------------------ */

export function CreateModal({ onClose, onCreated, target }: { onClose: () => void; onCreated: () => void; target?: string }): React.ReactElement {
  const [meta, setMeta] = React.useState<CreateMeta | null>(null)
  const [metaError, setMetaError] = React.useState<string | null>(null)
  const [typeId, setTypeId] = React.useState('')
  const [summary, setSummary] = React.useState('')
  const [summaryError, setSummaryError] = React.useState(false)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const t = useT()
  // 创建失败的内联错误（不弹 toast——toast 3 秒消失，表单场景里等于吞掉错误）
  const [error, setError] = React.useState<string | null>(null)

  const loadMeta = React.useCallback((issueType?: string): void => {
    setMetaError(null)
    api.getCreateMeta(issueType, target).then((m) => {
      setMeta(m)
      // 后端在未指定类型时已返回首个类型的字段；自动选中首个类型（同 ui-kanban 行为），
      // 保证提交时 issuetype 一定有值、字段与选中类型一致。
      if (!issueType && m.issueTypes.length > 0) setTypeId(m.issueTypes[0]!.id)
    }).catch((e) => setMetaError(e instanceof Error ? e.message : t('loadMetaFailed')))
  }, [target])

  React.useEffect(() => { loadMeta() }, [loadMeta])

  const fields = meta?.fields ?? []
  const openType = (next: string): void => {
    setTypeId(next)
    setValues({})
    if (next) loadMeta(next)
  }

  const setValue = (id: string, v: string): void => setValues((s) => ({ ...s, [id]: v }))
  const jiraFieldValue = (field: CreateMetaField, raw: string): unknown => {
    const type = field.type
    if (raw === '') return undefined
    if (type === 'date' || type === 'datetime') return raw
    if (type === 'priority') return { name: raw }
    if (type === 'option') return { value: raw }
    if (type === 'user') return { name: raw }
    if (type === 'issuetype') return { name: raw }
    if (type === 'project') return { key: raw }
    if (type === 'array') {
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
      if (parts.length === 0) return undefined
      if (field.id === 'labels') return parts
      return parts.map((name) => ({ name }))
    }
    return raw
  }

  const create = async (): Promise<void> => {
    if (!summary.trim()) { setSummaryError(true); return }
    setError(null)
    const fieldMap: Record<string, unknown> = { project: { key: meta?.projectKey ?? '' } }
    if (typeId) fieldMap.issuetype = { id: typeId }
    for (const field of fields) {
      if (['project', 'summary', 'issuetype', 'attachment', 'issuelinks'].includes(field.id)) continue
      const raw = values[field.id] ?? ''
      const value = jiraFieldValue(field, raw)
      if (value !== undefined) fieldMap[field.id] = value
    }
    setBusy(true)
    try { await api.createIssue({ summary, fields: fieldMap }); onCreated() }
    catch (e) { setError(e instanceof Error ? e.message : t('createFailed')) }
    finally { setBusy(false) }
  }

  const isAssignee = (f: CreateMetaField): boolean => f.type === 'user' || f.id === 'assignee'
  const isDescription = (f: CreateMetaField): boolean => f.id === 'description' || f.name === 'Description'

  // 字段分组：摘要整行；类型与优先级并排；负责人/描述整行；其余小字段两列排布。
  // issuetype 只在顶部的「问题类型」下拉渲染一次（create 里也跳过它，避免双份值覆盖）。
  const priorityField = fields.find((f) => f.id === 'priority')
  const restFields = fields.filter((f) => !['project', 'summary', 'issuetype', 'priority', 'attachment', 'issuelinks'].includes(f.id))
  const fullFields = restFields.filter((f) => isAssignee(f) || isDescription(f))
  const gridFields = restFields.filter((f) => !isAssignee(f) && !isDescription(f))

  const renderControl = (f: CreateMetaField): React.ReactElement => {
    const v = values[f.id] ?? ''
    if (isAssignee(f)) return <AssigneeField value={v} onChange={(nv) => setValue(f.id, nv)} target={target} />
    if (isDescription(f)) return <textarea className="kb-input" rows={4} value={v} onChange={(e) => setValue(f.id, e.target.value)} />
    if (f.type === 'date') return <input className="kb-input" type="date" value={v} onChange={(e) => setValue(f.id, e.target.value)} />
    // 数组字段（模块/标签/版本等）：芯片式多值输入——已有值进下拉建议，也能自由输入新值（回车添加）。
    if (f.type === 'array') return <MultiValueField value={v} onChange={(nv) => setValue(f.id, nv)} options={f.allowedValues ?? []} />
    if ((f.allowedValues ?? []).length) {
      return <SelectControl value={v} onChange={(nv) => setValue(f.id, nv)}
        options={[{ value: '', label: t('select') }, ...(f.allowedValues ?? []).map((x) => ({ value: x, label: x }))]} />
    }
    return <input className="kb-input" value={v} onChange={(e) => setValue(f.id, e.target.value)} />
  }

  return (
    <Modal title={t('createIssueTitle')} icon={<IcPlus size={14} />} onClose={onClose} width="md"
      footer={<>
        <button type="button" className="kb-btn" onClick={onClose}>取消</button>
        <button type="button" className="kb-btn kb-btn--primary" disabled={busy} onClick={() => void create()}>{busy ? t('creating') : t('create')}</button>
      </>}>
      {metaError ? (
        <div className="kb-banner">
          <span className="kb-banner__icon"><IcWarning size={14} /></span>
          <span>{metaError}</span>
          <span style={{ marginLeft: 'auto' }}><button className="kb-btn kb-btn--sm" onClick={() => loadMeta(typeId || undefined)}>{t('retry')}</button></span>
        </div>
      ) : !meta ? <SkeletonDetail /> : (
        <div className="kb-form">
          <Field label={t('summaryLabel')} required error={summaryError ? t('summaryRequired') : undefined}>
            <input className={`kb-input kb-input--lg${summaryError ? ' kb-input--error' : ''}`} autoFocus data-autofocus value={summary}
              placeholder={t('summaryPlaceholder')} onChange={(e) => { setSummary(e.target.value); setSummaryError(false) }} />
          </Field>
          <div className="kb-form__grid2">
            <Field label={t('issueTypeLabel')}>
              <SelectControl value={typeId} onChange={openType}
                options={[{ value: '', label: t('selectType') }, ...(meta.issueTypes ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
            </Field>
            {priorityField ? <Field label={priorityField.name} required={priorityField.required}>{renderControl(priorityField)}</Field> : null}
          </div>
          {fullFields.map((f) => (
            <Field key={f.id} label={f.name} required={f.required}>{renderControl(f)}</Field>
          ))}
          {gridFields.length > 0 ? (
            <div className="kb-form__grid2">
              {gridFields.map((f) => (
                <Field key={f.id} label={f.name} required={f.required}>{renderControl(f)}</Field>
              ))}
            </div>
          ) : null}
          {error ? (
            <div className="kb-banner" role="alert">
              <span className="kb-banner__icon"><IcWarning size={14} /></span>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  )
}

function AssigneeField({ value, onChange, target }: { value: string; onChange: (v: string) => void; target?: string }): React.ReactElement {
  const t = useT()
  const [options, setOptions] = React.useState<CreateUserOption[]>([])
  // value 是 Jira 用户名（提交用）；输入框显示 displayName 或用户正在输入的查询串。
  // 手输的文本不是合法用户名，必须从下拉列表里选中一人（同 ui-kanban 的 ComboSelect）。
  const [display, setDisplay] = React.useState(value)
  // 下拉显隐：聚焦/输入时展开，选中后、失焦或 Esc 收起。
  const [open, setOpen] = React.useState(false)
  const focus = async (): Promise<void> => {
    setOpen(true)
    if (options.length === 0) { try { setOptions(await api.searchAssignees('', target)) } catch { setOptions([]) } }
  }
  const search = async (q: string): Promise<void> => {
    setDisplay(q)
    onChange('')
    setOpen(true)
    try { setOptions(await api.searchAssignees(q, target)) } catch { setOptions([]) }
  }
  const select = (o: CreateUserOption): void => {
    onChange(o.name)
    setDisplay(o.displayName)
    setOptions([])
    setOpen(false)
  }
  return (
    <div className="kb-combo">
      <input className="kb-input" value={display} placeholder={t('assigneePlaceholder')}
        onFocus={() => void focus()} onChange={(e) => void search(e.target.value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }} />
      {open && options.length > 0 ? (
        <ul className="kb-combo__menu" role="listbox">
          {options.map((o) => (
            <li key={o.name} role="option" aria-selected={value === o.name} onMouseDown={() => select(o)}>
              <Avatar name={o.displayName} size="sm" />{o.displayName} <small>{o.name}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* ------------------------------ GitLab 工作区 ------------------------------ */

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function jiraNumbers(keys: string[]): string {
  return keys.join('、')
}

/** GitLab 状态的界面文案（内部值仍是 API 的 opened/closed/merged/all）。 */
const STATE_LABELS: Record<GitlabListState, TKey> = {
  all: 'stateAll', opened: 'stateOpened', closed: 'stateClosed', merged: 'stateMerged',
}

function stateChipClass(state: string): string {
  return state === 'merged' ? 'kb-gitlab__state kb-gitlab__state--merged'
    : state === 'opened' ? 'kb-gitlab__state kb-gitlab__state--opened'
    : 'kb-gitlab__state kb-gitlab__state--closed'
}

const stateLabel = (state: string): string => {
  const key = (STATE_LABELS as Record<string, TKey>)[state]
  return key ? translate(key) : state
}

/**
 * 可点选列表（勾选 Jira 事项 / 关联议题等）：整行可点、选中态高亮 + 对勾、
 * 超过 8 项时带筛选框，右上角显示已选计数。
 */
function SelectableList({ options, selected, onToggle, filterPlaceholder }: {
  options: { value: string; label: string }[]
  selected: ReadonlySet<string>
  onToggle: (value: string, on: boolean) => void
  filterPlaceholder?: string
}): React.ReactElement {
  const t = useT()
  const [filter, setFilter] = React.useState('')
  const q = filter.trim().toLowerCase()
  const visible = options.filter((o) => !q || o.label.toLowerCase().includes(q))
  return (
    <div className="kb-selectlist">
      {options.length > 8 ? (
        <div className="kb-selectlist__filter">
          <div className="kb-search">
            <span className="kb-search__icon"><IcSearch size={13} /></span>
            <input className="kb-input" value={filter} placeholder={filterPlaceholder ?? t('noMatch')} onChange={(e) => setFilter(e.target.value)} aria-label={filterPlaceholder} />
          </div>
          <span className="kb-selectlist__count">{t('selectedCount', { n: selected.size })}</span>
        </div>
      ) : null}
      <div className="kb-selectlist__body">
        {visible.map((o) => {
          const on = selected.has(o.value)
          return (
            <button type="button" key={o.value}
              className={on ? 'kb-selectlist__item kb-selectlist__item--on' : 'kb-selectlist__item'}
              role="checkbox" aria-checked={on} onClick={() => onToggle(o.value, !on)}>
              <span className="kb-selectlist__check">{on ? <IcCheck size={12} /> : null}</span>
              <span className="kb-selectlist__label">{o.label}</span>
            </button>
          )
        })}
        {visible.length === 0 ? <div className="kb-selectlist__empty">{t('noMatch')}</div> : null}
      </div>
    </div>
  )
}

export function GitLabPanel({ onClose, projectId, jiraIssues }: {
  onClose: () => void; projectId: string | null; jiraIssues: BoardIssue[]
}): React.ReactElement {
  const [tab, setTab] = React.useState<'issues' | 'mrs'>('issues')
  const [state, setState] = React.useState<GitlabListState>('opened')
  const [search, setSearch] = React.useState('')
  const [issues, setIssues] = React.useState<GitlabIssue[]>([])
  const [mrs, setMrs] = React.useState<GitlabMr[]>([])
  const [busy, setBusy] = React.useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const t = useT()

  const target = projectId ?? undefined

  // GitLab 项目首页链接（工具栏「打开 GitLab」按钮）
  const [projectUrl, setProjectUrl] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    let cancelled = false
    api.getSettings(target).then((s) => {
      if (cancelled) return
      const g = s.settings?.gitlab
      if (!g?.baseUrl) { setProjectUrl(undefined); return }
      const p = g.project.trim()
      setProjectUrl(p.startsWith('http') ? p : `${g.baseUrl.replace(/\/+$/, '')}/${p}`)
    }).catch(() => { if (!cancelled) setProjectUrl(undefined) })
    return () => { cancelled = true }
  }, [projectId])

  // create issue from Jira
  const [createIssueOpen, setCreateIssueOpen] = React.useState(false)
  const [selectedJira, setSelectedJira] = React.useState<Set<string>>(new Set())
  const [createTitle, setCreateTitle] = React.useState('')
  const [createDesc, setCreateDesc] = React.useState('')
  const [creatingIssue, setCreatingIssue] = React.useState(false)

  // link Jira to an existing GitLab issue
  const [linkJiraIssue, setLinkJiraIssue] = React.useState<number | null>(null)
  const [linkJiraSelected, setLinkJiraSelected] = React.useState<Set<string>>(new Set())
  const [savingLink, setSavingLink] = React.useState(false)

  // link an existing GitLab issue to an existing MR
  const [linkMrIssue, setLinkMrIssue] = React.useState<number | null>(null)

  // create MR
  const [createMrOpen, setCreateMrOpen] = React.useState(false)
  const [mrSourceMode, setMrSourceMode] = React.useState<'existing' | 'new'>('existing')
  const [mrSource, setMrSource] = React.useState('')
  const [mrNewBranch, setMrNewBranch] = React.useState('')
  const [mrBranches, setMrBranches] = React.useState<string[]>([])
  const [mrTarget, setMrTarget] = React.useState('')
  const [mrTitle, setMrTitle] = React.useState('')
  const [mrIssueIids, setMrIssueIids] = React.useState<Set<number>>(new Set())
  const [creatingMr, setCreatingMr] = React.useState(false)

  const load = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      if (tab === 'issues') setIssues(await api.gitlabIssues(state, search, target))
      else setMrs(await api.gitlabMrs(state, search, target))
    } catch (e) { toast(e instanceof Error ? e.message : t('loadFailed'), 'error') } finally { setBusy(false) }
  }, [tab, state, search, projectId, toast])

  React.useEffect(() => { void load() }, [load])

  const closeIssue = async (iid: number): Promise<void> => {
    if (!(await confirm({ title: t('closeIssueTitle'), message: t('closeIssueMsg', { iid }), confirmLabel: t('close'), danger: true }))) return
    try { await api.gitlabCloseIssue(iid, target); void load() } catch (e) { toast(e instanceof Error ? e.message : t('closeFailed'), 'error') }
  }
  const closeMr = async (iid: number): Promise<void> => {
    if (!(await confirm({ title: t('closeMrTitle'), message: t('closeMrMsg', { iid }), confirmLabel: t('close'), danger: true }))) return
    try { await api.gitlabCloseMr(iid, target); void load() } catch (e) { toast(e instanceof Error ? e.message : t('closeFailed'), 'error') }
  }

  // Prefill the create-issue title/description from the selected Jira issues.
  React.useEffect(() => {
    if (!createIssueOpen) return
    const jiras = jiraIssues.filter((i) => selectedJira.has(i.key))
    if (jiras.length) {
      setCreateTitle(`${jiraNumbers(jiras.map((i) => i.key))} ${jiras[0]?.summary ?? ''}`)
      setCreateDesc(jiras.map((j) => `${j.key}: ${j.summary}`).join('\n'))
    } else {
      setCreateTitle(''); setCreateDesc('')
    }
  }, [createIssueOpen, selectedJira, jiraIssues])

  const createIssue = async (): Promise<void> => {
    const jiras = jiraIssues.filter((i) => selectedJira.has(i.key)).map((i) => ({ key: i.key, summary: i.summary }))
    if (!jiras.length) return
    setCreatingIssue(true)
    try {
      await api.gitlabCreateIssueFromJira(jiras, createTitle || undefined, createDesc || undefined, target)
      setCreateIssueOpen(false); setSelectedJira(new Set()); setCreateTitle(''); setCreateDesc('')
      toast(t('gitlabIssueCreated')); void load()
    } catch (e) { toast(e instanceof Error ? e.message : t('createFailed'), 'error') } finally { setCreatingIssue(false) }
  }

  const linkJira = async (): Promise<void> => {
    if (linkJiraIssue == null) return
    const keys = jiraIssues.filter((i) => linkJiraSelected.has(i.key)).map((i) => i.key)
    if (!keys.length) return
    setSavingLink(true)
    try {
      await api.gitlabLinkJira(linkJiraIssue, keys, target)
      setLinkJiraIssue(null); setLinkJiraSelected(new Set())
      toast(t('jiraLinked')); void load()
    } catch (e) { toast(e instanceof Error ? e.message : t('linkFailed'), 'error') } finally { setSavingLink(false) }
  }

  const unlinkJira = async (iid: number, key: string): Promise<void> => {
    try { await api.gitlabUnlinkJira(iid, [key], target); void load() } catch (e) { toast(e instanceof Error ? e.message : t('unlinkFailed'), 'error') }
  }

  const linkIssueToMr = async (iid: number, mrIid: number): Promise<void> => {
    try { await api.gitlabLinkIssueToMr(iid, mrIid, target); setLinkMrIssue(null); toast(t('linked')); void load() } catch (e) { toast(e instanceof Error ? e.message : t('linkFailed'), 'error') }
  }

  // Load the project's branches when the create-MR modal opens.
  const mainBranch = mrBranches[0] ?? 'main'
  React.useEffect(() => {
    if (!createMrOpen) return
    api.gitlabBranches('', target).then((r) => {
      setMrBranches(r.branches)
      const first = r.branches[0] ?? ''
      if (first && !mrTarget) setMrTarget(first)
    }).catch(() => setMrBranches([]))
  }, [createMrOpen, projectId])

  const primaryBranchName = React.useMemo(() => {
    const primary = issues.find((i) => mrIssueIids.has(i.iid))
    return primary ? (slugify(primary.title) || `issue-${primary.iid}`) : (slugify(mrTitle) || 'new-branch')
  }, [issues, mrIssueIids, mrTitle])

  const unlinkedIssues = React.useMemo(() => issues.filter((i) => i.mrIid == null), [issues])

  const createMr = async (): Promise<void> => {
    const branch = mrTarget || mainBranch
    const source = mrSourceMode === 'new' ? (mrNewBranch || primaryBranchName) : mrSource
    if (!source || !branch) { toast(t('branchRequired'), 'error'); return }
    setCreatingMr(true)
    try {
      await api.gitlabCreateMr({ sourceBranch: source, targetBranch: branch, title: mrTitle || source, issueIids: [...mrIssueIids], createBranch: mrSourceMode === 'new' }, target)
      setCreateMrOpen(false); setMrSource(''); setMrNewBranch(''); setMrTitle(''); setMrIssueIids(new Set()); setMrSourceMode('existing')
      toast(t('mrCreated')); void load()
    } catch (e) { toast(e instanceof Error ? e.message : t('mrCreateFailed'), 'error') } finally { setCreatingMr(false) }
  }

  const toggleSet = <T,>(set: Set<T>, item: T, on: boolean): Set<T> => {
    const next = new Set(set)
    if (on) next.add(item); else next.delete(item)
    return next
  }

  const stateOptions: GitlabListState[] = tab === 'issues' ? ['opened', 'closed', 'all'] : ['opened', 'closed', 'merged', 'all']

  return (
    <Modal title={t('gitlabTitle')} icon={<IcGitlab size={14} />} onClose={onClose} width="xl">
      {/* 面板正文：标签页 + 工具栏固定，只有下方列表滚动 */}
      <div className="kb-gitlab">
        <div className="kb-tabs kb-tabs--with-actions">
          <button className={tab === 'issues' ? 'kb-tab kb-tab--on' : 'kb-tab'} role="tab" aria-selected={tab === 'issues'} onClick={() => setTab('issues')}>{t('tabIssues')}</button>
          <button className={tab === 'mrs' ? 'kb-tab kb-tab--on' : 'kb-tab'} role="tab" aria-selected={tab === 'mrs'} onClick={() => setTab('mrs')}>{t('tabMrs')}</button>
          <span className="kb-tabs__spacer" />
          <button className="kb-btn kb-btn--sm" disabled={!jiraIssues.length} onClick={() => { setCreateIssueOpen(true); setSelectedJira(new Set()); setCreateTitle(''); setCreateDesc('') }}>
            <IcPlus size={13} />{t('createFromJira')}
          </button>
          <button className="kb-btn kb-btn--sm" onClick={() => { setCreateMrOpen(true); setMrSourceMode('existing'); setMrSource(''); setMrNewBranch(''); setMrTitle(''); setMrIssueIids(new Set()) }}>
            <IcBranch size={13} />{t('createMr')}
          </button>
        </div>
        <div className="kb-gitlab__toolbar">
          <SegToggle value={state} onChange={setState} options={stateOptions.map((s) => ({ value: s, label: t(STATE_LABELS[s]) }))} label={t('stateAll')} />
          <div className="kb-gitlab__search">
            <div className="kb-search">
              <span className="kb-search__icon"><IcSearch size={13} /></span>
              <input className="kb-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchGitlab')} aria-label={t('searchGitlab')} />
            </div>
          </div>
          <button className="kb-btn kb-btn--ghost" onClick={() => void load()}><IcSync size={13} />{t('refresh')}</button>
          {projectUrl ? <a className="kb-btn kb-btn--ghost" href={projectUrl} target="_blank" rel="noreferrer noopener"><IcExternalLink size={12} />{t('openGitlab')}</a> : null}
        </div>
        <div className="kb-gitlab__list-wrap">
          {busy ? <SkeletonCards cards={4} /> : tab === 'issues' ? (
            <div className="kb-gitlab__list">
              {issues.length === 0 ? <EmptyState title={t('noIssues')} hint={t('noIssuesHint')} /> : issues.map((i) => (
                <div className="kb-card" key={i.iid}>
                  <div className="kb-card__top">
                    <span className="kb-card__key">#{i.iid}</span>
                    <span className={stateChipClass(i.state)}>{stateLabel(i.state)}</span>
                    <span className="kb-card__copy">
                      <CopyButton issue={{ key: `#${i.iid}`, summary: i.title, description: i.description }} label={t('copyAria', { key: `#${i.iid}` })} stopPropagation />
                      {i.webUrl ? <ExtLink href={i.webUrl} label={t('openGitlab') + ` #${i.iid}`} /> : null}
                    </span>
                  </div>
                  <div className="kb-card__summary">{i.title}</div>
                  {i.jiraKeys.length > 0 ? (
                    <div className="kb-card__tags">{i.jiraKeys.map((k) => (
                      <span className="kb-tag" key={k}>{k}
                        <button type="button" className="kb-tag__x" title={t('unlinkAria', { key: k })} aria-label={t('unlinkAria', { key: k })} onClick={() => void unlinkJira(i.iid, k)}><IcClose size={10} /></button>
                      </span>
                    ))}</div>
                  ) : null}
                  {i.mrIid ? <div className="kb-card__assignee"><IcBranch size={12} /> MR !{i.mrIid}</div> : null}
                  <div className="kb-gitlab__actions">
                    <button className="kb-btn kb-btn--ghost kb-btn--sm" onClick={() => { setLinkJiraIssue(i.iid); setLinkJiraSelected(new Set()) }}><IcLink size={12} />{t('linkJira')}</button>
                    <button className="kb-btn kb-btn--ghost kb-btn--sm" onClick={() => setLinkMrIssue(i.iid)}><IcBranch size={12} />{t('linkMr')}</button>
                    {i.state === 'opened' ? <button className="kb-btn kb-btn--ghost kb-btn--sm" onClick={() => void closeIssue(i.iid)}><IcClose size={12} />{t('close')}</button> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="kb-gitlab__list">
              {mrs.length === 0 ? <EmptyState title={t('noMrs')} hint={t('noMrsHint')} /> : mrs.map((m) => (
                <div className="kb-card" key={m.iid}>
                  <div className="kb-card__top">
                    <span className="kb-card__key">!{m.iid}</span>
                    <span className={stateChipClass(m.state)}>{stateLabel(m.state)}</span>
                    {m.webUrl ? <span className="kb-card__copy"><ExtLink href={m.webUrl} label={t('openGitlab') + ` !${m.iid}`} /></span> : null}
                  </div>
                  <div className="kb-card__summary">{m.title}</div>
                  {m.sourceBranch ? <div className="kb-gitlab__branchrow"><IcBranch size={12} /><span>{m.sourceBranch} → {m.targetBranch ?? ''}</span></div> : null}
                  {m.jiraKeys.length > 0 ? <div className="kb-card__tags">{m.jiraKeys.map((k) => <span className="kb-tag" key={k}>{k}</span>)}</div> : null}
                  <div className="kb-gitlab__actions">
                    {m.issueIids?.length ? <span className="kb-note">#{m.issueIids.join(', #')}</span> : null}
                    {m.state === 'opened' ? <button className="kb-btn kb-btn--ghost kb-btn--sm" onClick={() => void closeMr(m.iid)}><IcClose size={12} />{t('close')}</button> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 从 Jira 创建议题 */}
      {createIssueOpen ? (
        <Modal title={t('createIssueFromJiraTitle')} icon={<IcPlus size={14} />} onClose={() => setCreateIssueOpen(false)} width="md"
          footer={<>
            <button className="kb-btn" onClick={() => setCreateIssueOpen(false)}>取消</button>
            <button className="kb-btn kb-btn--primary" disabled={creatingIssue || selectedJira.size === 0} onClick={() => void createIssue()}>
              {creatingIssue ? t('creating') : selectedJira.size > 0 ? t('createCount', { n: selectedJira.size }) : t('create')}
            </button>
          </>}>
          <div className="kb-form">
            <p className="kb-note">选择要合并到一个 GitLab 议题的 Jira 事项，标题和描述会自动生成：</p>
            {jiraIssues.length === 0 ? <p className="kb-note">没有可用的 Jira 事项（先在板上同步）。</p> : (
              <SelectableList
                options={jiraIssues.map((i) => ({ value: i.key, label: `${i.key} · ${i.summary}` }))}
                selected={selectedJira}
                onToggle={(v, on) => setSelectedJira((s) => toggleSet(s, v, on))}
                filterPlaceholder={t('filterJiraPlaceholder')} />
            )}
            <Field label={t('titleLabel')}><input className="kb-input" value={createTitle} placeholder={t('titleAutoPlaceholder')} onChange={(e) => setCreateTitle(e.target.value)} /></Field>
            <Field label={t('descriptionLabel')}><textarea className="kb-input" rows={4} value={createDesc} placeholder={t('titleAutoPlaceholder')} onChange={(e) => setCreateDesc(e.target.value)} /></Field>
          </div>
        </Modal>
      ) : null}

      {/* 链接 Jira 到现有 GitLab issue */}
      {linkJiraIssue != null ? (
        <Modal title={t('linkJiraTitle', { iid: linkJiraIssue })} icon={<IcLink size={14} />} onClose={() => setLinkJiraIssue(null)} width="md"
          footer={<>
            <button className="kb-btn" onClick={() => setLinkJiraIssue(null)}>取消</button>
            <button className="kb-btn kb-btn--primary" disabled={savingLink || linkJiraSelected.size === 0} onClick={() => void linkJira()}>
              {savingLink ? t('linking') : linkJiraSelected.size > 0 ? t('linkCount', { n: linkJiraSelected.size }) : t('link')}
            </button>
          </>}>
          <div className="kb-form">
            <p className="kb-note">选择要链接到该议题的 Jira 事项：</p>
            {jiraIssues.length === 0 ? <p className="kb-note">没有可用的 Jira 事项（先在板上同步）。</p> : (
              <SelectableList
                options={jiraIssues.map((i) => ({ value: i.key, label: `${i.key} · ${i.summary}` }))}
                selected={linkJiraSelected}
                onToggle={(v, on) => setLinkJiraSelected((s) => toggleSet(s, v, on))}
                filterPlaceholder={t('filterJiraPlaceholder')} />
            )}
          </div>
        </Modal>
      ) : null}

      {/* 创建合并请求 */}
      {createMrOpen ? (
        <Modal title={t('createMrTitle')} icon={<IcBranch size={14} />} onClose={() => setCreateMrOpen(false)} width="md"
          footer={<>
            <button className="kb-btn" onClick={() => setCreateMrOpen(false)}>取消</button>
            <button className="kb-btn kb-btn--primary" disabled={creatingMr || (mrSourceMode === 'existing' ? !mrSource : !(mrNewBranch || primaryBranchName))} onClick={() => void createMr()}>{creatingMr ? t('creating') : t('create')}</button>
          </>}>
          <div className="kb-form">
            <SegToggle value={mrSourceMode} onChange={setMrSourceMode} label={t('sourceModeAria')}
              options={[{ value: 'existing', label: t('existingBranch') }, { value: 'new', label: t('newBranch') }]} />
            {mrSourceMode === 'existing' ? (
              <Field label={t('sourceBranch')}>
                <SelectControl value={mrSource} onChange={setMrSource}
                  options={[{ value: '', label: t('selectBranch') }, ...mrBranches.map((b) => ({ value: b, label: b }))]} />
              </Field>
            ) : (
              <Field label={t('newBranchName')}>
                <input className="kb-input" value={mrNewBranch} onChange={(e) => setMrNewBranch(e.target.value)} placeholder={primaryBranchName || t('newBranchFallback')} />
                <span className="kb-note">{t('newBranchHint')}</span>
              </Field>
            )}
            <Field label={t('targetBranch')}>
              <SelectControl value={mrTarget || mainBranch} onChange={setMrTarget}
                options={(mrBranches.length === 0 ? ['main'] : mrBranches).map((b) => ({ value: b, label: b }))} />
            </Field>
            {mrSourceMode === 'existing' && mrSource ? (
              <div className="kb-gitlab__branchrow kb-gitlab__branchrow--preview"><IcBranch size={12} /><span>{mrSource} → {mrTarget || mainBranch}</span></div>
            ) : null}
            {mrSourceMode === 'new' ? (
              <div className="kb-gitlab__branchrow kb-gitlab__branchrow--preview"><IcBranch size={12} /><span>{mrNewBranch || primaryBranchName || 'new-branch'} → {mrTarget || mainBranch}</span></div>
            ) : null}
            <Field label={t('mrTitleLabel')}><input className="kb-input" value={mrTitle} placeholder={t('mrTitlePlaceholder')} onChange={(e) => setMrTitle(e.target.value)} /></Field>
            <Field label={t('linkedIssuesLabel')}>
              {unlinkedIssues.length ? (
                <SelectableList
                  options={unlinkedIssues.map((i) => ({ value: String(i.iid), label: `#${i.iid} · ${i.title}` }))}
                  selected={new Set([...mrIssueIids].map(String))}
                  onToggle={(v, on) => setMrIssueIids((s) => toggleSet(s, Number(v), on))}
                  filterPlaceholder={t('filterIssuesPlaceholder')} />
              ) : <span className="kb-note">没有可关联的议题</span>}
            </Field>
          </div>
        </Modal>
      ) : null}

      {/* 关联 issue 到现有 MR */}
      {linkMrIssue != null ? (
        <Modal title={t('linkIssueToMrTitle', { iid: linkMrIssue })} icon={<IcBranch size={14} />} onClose={() => setLinkMrIssue(null)} width="md">
          <div className="kb-form">
            <p className="kb-note">选择要关联的合并请求：</p>
            {mrs.length === 0 ? <p className="kb-note">暂无合并请求</p> : (
              <div className="kb-gitlab__select-list">
                {mrs.map((m) => (
                  <div className="kkb-proj" key={m.iid}>
                    <span>!{m.iid} · {m.title}</span>
                    <button className="kb-btn kb-btn--ghost kb-btn--sm" onClick={() => void linkIssueToMr(linkMrIssue, m.iid)}>关联</button>
                  </div>
                ))}
              </div>
            )}
            <div className="kb-form__footer"><button className="kb-btn kb-btn--ghost" onClick={() => setLinkMrIssue(null)}>取消</button></div>
          </div>
        </Modal>
      ) : null}
    </Modal>
  )
}

/* ------------------------------ issue 详情 ------------------------------ */

export function DetailModal({ issueKey, onClose, onChanged, onSendToSession }: {
  issueKey: string; onClose: () => void; onChanged: () => void
  onSendToSession?: (key: string, target: 'current' | 'new', images?: PromptContentPartLike[]) => Promise<void>
}): React.ReactElement {
  const [detail, setDetail] = React.useState<BoardIssueDetail | null>(null)
  const [comment, setComment] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [uploaded, setUploaded] = React.useState<string[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [lightbox, setLightbox] = React.useState<{ images: string[]; index: number } | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const toast = useToast()
  const confirm = useConfirm()
  const choice = useChoice()
  const t = useT()
  const [sending, setSending] = React.useState(false)

  // 丢进会话分析：确认发送位置（当前会话 / 新建会话）后经官方 prompt 入口发送。
  // 图片附件经 attachment-proxy 拉取后以官方 image content part（base64）随附。
  const sendToSession = async (): Promise<void> => {
    const imageCount = (detail?.attachments ?? []).filter((a) => (a.mimeType ?? '').startsWith('image/')).length
    const target = await choice({
      title: t('sendTitle'),
      message: imageCount > 0 ? t('sendMsg', { key: issueKey, n: imageCount }) : t('sendMsgNoImg', { key: issueKey }),
      options: [
        { value: 'current', label: t('sendCurrent'), primary: true },
        { value: 'new', label: t('sendNew') },
      ],
    })
    if (!target || !onSendToSession) return
    const where = target as 'current' | 'new'
    setSending(true)
    try {
      const images = await gatherIssueImages(detail)
      await onSendToSession(issueKey, where, images)
      if (target === 'current') toast(images.length > 0 ? t('sentToast', { n: images.length }) : t('sentToastNoImg'))
      // 'new' 时发送成功后面板会自动关闭，用户直接看到新会话，无需 toast
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sendFailed'), 'error')
    } finally {
      setSending(false)
    }
  }

  const allImages = React.useMemo(() => {
    const srcs = [...extractImageSrcs(detail?.descriptionHtml)]
    for (const c of detail?.comments ?? []) srcs.push(...extractImageSrcs(c.bodyHtml))
    return srcs
  }, [detail])

  // Clicking an image inside rendered content opens the lightbox (full size).
  React.useEffect(() => {
    const el = contentRef.current
    if (!el || !allImages.length) return
    const handler = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName.toLowerCase() === 'img') {
        const src = target.getAttribute('src')
        const idx = src ? allImages.indexOf(src) : -1
        if (idx >= 0) {
          e.preventDefault()
          setLightbox({ images: allImages.map(toFullImageSrc), index: idx })
        }
      }
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [allImages])

  const loadDetail = React.useCallback(async (): Promise<void> => {
    try { setDetail(await api.getIssueDetail(issueKey)) }
    catch { setDetail(null) }
  }, [issueKey])

  React.useEffect(() => { let cancelled = false; api.getIssueDetail(issueKey).then((d) => { if (!cancelled) setDetail(d) }).catch(() => { if (!cancelled) setDetail(null) }); return () => { cancelled = true } }, [issueKey])

  const move = async (transition: JiraTransitionOption): Promise<void> => {
    setBusy(true)
    try { await api.transitionIssue(issueKey, transition.id); await onChanged(); await loadDetail() }
    catch (e) { toast(e instanceof Error ? e.message : t('loadFailed'), 'error') }
    finally { setBusy(false) }
  }
  const addComment = async (): Promise<void> => {
    if (!comment.trim()) return
    setBusy(true)
    try { await api.addComment(issueKey, comment); setComment(''); setUploaded([]); await loadDetail() }
    catch (e) { toast(e instanceof Error ? e.message : t('commentFailed'), 'error') }
    finally { setBusy(false) }
  }
  const handleUpload = async (file: File): Promise<void> => {
    if (!detail || uploading) return
    setUploading(true)
    try {
      const dataBase64 = await readFileAsBase64(file)
      const res = await api.uploadAttachment(issueKey, { filename: file.name, mime: file.type, dataBase64 })
      const token = `!${res.filename}|thumbnail!`
      setComment((c) => (c ? `${c}\n${token}` : token))
      setUploaded((l) => [...l, res.filename])
    } catch (e) { toast(e instanceof Error ? e.message : t('uploadFailed'), 'error') } finally { setUploading(false) }
  }
  // Paste an image (Ctrl+V) into the composer → upload + insert a Jira reference.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files: File[] = []
    const items = e.clipboardData?.items
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) files.push(f)
        }
      }
    }
    if (!files.length && e.clipboardData?.files) {
      for (const f of e.clipboardData.files) {
        if (f.type.startsWith('image/')) files.push(f)
      }
    }
    if (files.length) {
      e.preventDefault()
      for (const f of files) void handleUpload(f)
    }
  }
  const remove = async (): Promise<void> => {
    if (!(await confirm({ title: t('deleteIssueTitle'), message: t('deleteIssueMsg', { key: issueKey }), confirmLabel: t('delete'), danger: true }))) return
    try { await api.deleteIssue(issueKey); await onChanged(); onClose() }
    catch (e) { toast(e instanceof Error ? e.message : t('deleteFailed'), 'error') }
  }

  return (
    <Modal title={detail ? `${detail.key} · ${detail.summary}` : issueKey} onClose={onClose} width="xl"
      footer={detail ? (
        <>
          {onSendToSession ? <button className="kb-btn kb-btn--ghost" disabled={sending} onClick={() => void sendToSession()}><IcSend size={12} />{sending ? t('sending') : t('sendToSession')}</button> : null}
          {detail.url ? <a className="kb-btn kb-btn--ghost" href={detail.url} target="_blank" rel="noreferrer noopener"><IcExternalLink size={12} />在 Jira 中打开</a> : null}
          <span className="kb-modal__foot-spacer" />
          {detail.canDelete ? <button className="kb-btn kb-btn--danger" onClick={() => void remove()}><IcTrash size={12} />删除</button> : null}
          <button className="kb-btn kb-btn--ghost" onClick={() => void loadDetail()}><IcSync size={12} />刷新</button>
          <button className="kb-btn" onClick={onClose}>关闭</button>
        </>
      ) : undefined}>
      {!detail ? <SkeletonDetail /> : (
        <div className="kb-detail" ref={contentRef}>
          <div className="kb-detail__meta">
            <span className="kb-detail__chip">
              <StatusDot category={detail.status.category} name={t('statusChip', { name: detail.status.name })} color={statusAccent(detail.status.color, detail.status.name)} />
            </span>
            {detail.issueType ? <span className="kb-detail__chip" style={tintStyle(typeAccent(detail.issueType))}>{t('typeChip', { name: detail.issueType })}</span> : null}
            {detail.priority ? <span className="kb-detail__chip" style={tintStyle(priorityAccent(detail.priority))}>{t('priorityChip', { name: detail.priority })}</span> : null}
            {detail.assignee ? <span className="kb-detail__chip"><Avatar name={detail.assignee} size="sm" />{detail.assignee}</span> : null}
          </div>

          {(detail.descriptionHtml || detail.description) ? (
            <div className="kb-detail__section">
              <div className="kb-detail__label">描述</div>
              {detail.descriptionHtml
                ? <div className="kb-detail__html" dangerouslySetInnerHTML={{ __html: detail.descriptionHtml }} />
                : <div className="kb-detail__desc">{detail.description}</div>}
            </div>
          ) : null}

          {(detail.attachments ?? []).length > 0 ? (
            <div className="kb-detail__section">
              <div className="kb-detail__label"><IcImage size={13} />附件（{(detail.attachments ?? []).length}）</div>
              <div className="kb-detail__transitions">
                {(detail.attachments ?? []).map((a) => (
                  <a key={a.id} className="kb-tag" href={a.url} target="_blank" rel="noreferrer noopener" title={a.url}>{a.filename}</a>
                ))}
              </div>
            </div>
          ) : null}

          {detail.transitions.length > 0 ? (
            <div className="kb-detail__section">
              <div className="kb-detail__label">流转（点击目标状态移动 issue）</div>
              <div className="kb-detail__transitions">
                {detail.transitions.map((t) => (
                  <button className="kb-btn" key={t.id} disabled={busy} onClick={() => void move(t)}>
                    <StatusDot category={t.toStatus.category} name={t.name} color={statusAccent(t.toStatus.color, t.name)} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="kb-detail__section">
            <div className="kb-detail__label"><IcComment size={13} />评论（{detail.comments?.length ?? detail.commentCount ?? 0}）</div>
            <div className="kb-detail__comments">
              {(detail.comments ?? []).map((c) => (
                <div className="kb-comment" key={c.id}>
                  <span className="kb-comment__avatar"><Avatar name={c.author ?? '?'} size="lg" /></span>
                  <div className="kb-comment__wrap">
                    <div className="kb-comment__meta">{c.author ?? t('unknownAuthor')}{c.created ? ` · ${formatDateTime(c.created)}` : ''}</div>
                    {c.bodyHtml
                      ? <div className="kb-detail__html kb-comment__body" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
                      : <div className="kb-comment__body">{c.body}</div>}
                  </div>
                </div>
              ))}
              {(detail.comments ?? []).length === 0 ? <p className="kb-note">暂无评论</p> : null}
            </div>
          </div>

          <div className="kb-detail__add">
            <textarea className="kb-input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} onPaste={handlePaste} placeholder={t('commentPlaceholder')} aria-label={t('commentAria')} />
            {uploaded.length > 0 ? (
              <div className="kb-composer__files">
                {uploaded.map((f) => (
                  <span key={f} className="kb-composer__file">
                    <IcImage size={11} />{f}
                    <button type="button" className="kb-tag__x" aria-label={t('removeAttachAria', { name: f })} onClick={() => setUploaded((l) => l.filter((x) => x !== f))}><IcClose size={10} /></button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="kb-composer__bar">
              <div className="kb-composer__left">
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = '' }} />
                <button className="kb-btn kb-btn--ghost kb-btn--sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  {uploading ? <IcSync size={12} className="kb-spin" /> : <IcImage size={12} />}{uploading ? t('uploading') : t('imageBtn')}
                </button>
                <span className="kb-note">粘贴或选择图片，自动上传并插入引用</span>
              </div>
              <button className="kb-btn kb-btn--primary" disabled={busy || !comment.trim()} onClick={() => void addComment()}>评论</button>
            </div>
          </div>

        </div>
      )}

      {lightbox ? <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} onNavigate={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))} /> : null}
    </Modal>
  )
}

/** Jira 内联图从缩略图换到原图（经 host 代理）。 */
function toFullImageSrc(src: string): string {
  const marker = 'attachment-proxy?url='
  const idx = src.indexOf(marker)
  if (idx < 0) return src
  let decoded: string
  try {
    decoded = decodeURIComponent(src.slice(idx + marker.length))
  } catch {
    return src
  }
  const full = decoded.replace('/secure/thumbnail/', '/secure/attachment/')
  if (full === decoded) return src
  return src.slice(0, idx + marker.length) + encodeURIComponent(full)
}

/** Collect every `src` of an inline `<img>` in rendered HTML. */
function extractImageSrcs(html: string | undefined | null): string[] {
  if (!html) return []
  const out: string[] = []
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    const src = m[1]
    if (src && !out.includes(src)) out.push(src)
  }
  return out
}

/** Read a File as a base64 data-URL and return the payload (without the prefix). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const MAX_SEND_IMAGES = 4
const MAX_SEND_IMAGE_BYTES = 10 * 1024 * 1024

/** Blob → base64（去 data: 前缀）。 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 拉取 issue 的图片附件（经 attachment-proxy 免 token），转成官方 image content
 * part（base64）随「丢进会话分析」一起发送；获取失败/超限的图片跳过。
 */
async function gatherIssueImages(detail: BoardIssueDetail | null): Promise<PromptContentPartLike[]> {
  if (!detail) return []
  const images = (detail.attachments ?? [])
    .filter((a) => (a.mimeType ?? '').startsWith('image/'))
    .slice(0, MAX_SEND_IMAGES)
  const parts: PromptContentPartLike[] = []
  for (const a of images) {
    try {
      const res = await fetch(`/kanban-api/attachment-proxy?url=${encodeURIComponent(a.url)}`)
      if (!res.ok) continue
      const blob = await res.blob()
      if (blob.size === 0 || blob.size > MAX_SEND_IMAGE_BYTES) continue
      const data = await blobToBase64(blob)
      if (!data) continue
      parts.push({ type: 'image', mediaType: blob.type || 'image/png', data, name: a.filename })
    } catch {
      // 图片获取失败则跳过，文本照常发送
    }
  }
  return parts
}

/* ------------------------------ 图片灯箱 ------------------------------ */

export function Lightbox({ images, index, onClose, onNavigate }: {
  images: string[]; index: number; onClose: () => void; onNavigate: (i: number) => void
}): React.ReactElement {
  const t = useT()
  const closeRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
      else if (e.key === 'ArrowRight' && index < images.length - 1) onNavigate(index + 1)
    }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [index, images.length, onClose, onNavigate])

  return (
    <div className="kb-lightbox" onClick={onClose}>
      <button type="button" className="kb-lightbox__nav kb-lightbox__prev" aria-label={t('prevImage')} onClick={(e) => { e.stopPropagation(); if (index > 0) onNavigate(index - 1) }}><IcChevronLeft size={20} /></button>
      {images[index] ? <img className="kb-lightbox__img" src={images[index]} alt="" onClick={(e) => e.stopPropagation()} /> : null}
      <button type="button" className="kb-lightbox__nav kb-lightbox__next" aria-label={t('nextImage')} onClick={(e) => { e.stopPropagation(); if (index < images.length - 1) onNavigate(index + 1) }}><IcChevronRight size={20} /></button>
      <button type="button" ref={closeRef} className="kb-lightbox__close" aria-label={t('close')} onClick={(e) => { e.stopPropagation(); onClose() }}><IcClose size={18} /></button>
      {images.length > 1 ? <div className="kb-lightbox__count">{index + 1} / {images.length}</div> : null}
    </div>
  )
}
