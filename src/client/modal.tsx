/**
 * 应用内弹窗基础设施（替代原生 alert/confirm/prompt）：
 * - Modal：Esc 只关最顶层（模块级深度栈支持嵌套，如 GitLabPanel 内的子弹窗）、
 *   焦点陷阱 + 挂载时聚焦 + 卸载时恢复、body 滚动锁、进场/退场动画。
 * - ConfirmDialog / PromptDialog + DialogsProvider：返回 Promise，
 *   调用点保持原有的 async 流程。
 * @module dsh-kanban/client/modal
 */

import React from 'react'
import { IcClose, IcWarning } from './icons.tsx'
import { useT } from './locales.ts'

/* ---------------- 模块级深度栈（Esc 只作用于最顶层弹窗） ---------------- */

let modalSeq = 0
const modalStack: number[] = []

/* ---------------- Modal ---------------- */

export interface ModalProps {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  /** 自定义底栏；省略 = 默认底栏（关闭按钮）；null = 无底栏。 */
  footer?: React.ReactNode | null
  onClose: () => void
  width?: 'md' | 'xl'
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({ title, icon, children, footer, onClose, width = 'md' }: ModalProps): React.ReactElement {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [closing, setClosing] = React.useState(false)
  const myDepth = React.useRef(0)
  const closingRef = React.useRef(false)
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose
  const titleId = React.useId()
  const t = useT()

  const requestClose = React.useCallback((): void => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    setTimeout(() => onCloseRef.current(), 160)
  }, [])

  React.useEffect(() => {
    myDepth.current = ++modalSeq
    modalStack.push(myDepth.current)
    const previouslyFocused = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    if (panel) {
      const autofocus = panel.querySelector<HTMLElement>('[data-autofocus]')
      const first = autofocus ?? panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== myDepth.current) return
      // 灯箱打开时 Esc 只关灯箱（灯箱组件自己监听 Esc），不关整个弹窗。
      if (document.querySelector('.kb-lightbox')) return
      e.preventDefault()
      requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      const idx = modalStack.indexOf(myDepth.current)
      if (idx >= 0) modalStack.splice(idx, 1)
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [requestClose])

  const trapTab = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0)
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const depthIndex = modalStack.indexOf(myDepth.current)
  const zIndex = 10000 + (depthIndex >= 0 ? depthIndex : 0) * 10

  return (
    <div
      className={closing ? 'kb-modal__overlay kb-modal__overlay--closing' : 'kb-modal__overlay'}
      style={{ zIndex }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`kb-modal kb-modal--${width}${closing ? ' kb-modal--closing' : ''}`}
        onKeyDown={trapTab}
      >
        <div className="kb-modal__head">
          {icon ? <span className="kb-modal__head-icon">{icon}</span> : null}
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="kb-iconbtn kb-modal__close" onClick={requestClose} aria-label={t('close')}><IcClose size={16} /></button>
        </div>
        <div className="kb-modal__body">{children}</div>
        {footer === null ? null : footer !== undefined
          ? <div className="kb-modal__foot">{footer}</div>
          : <div className="kb-modal__foot"><button type="button" className="kb-btn" onClick={requestClose}>{t('close')}</button></div>}
      </div>
    </div>
  )
}

/* ---------------- Confirm / Prompt 对话框 ---------------- */

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
}

export interface ChoiceOption { value: string; label: string; primary?: boolean }
export interface ChoiceOptions { title: string; message: string; options: ChoiceOption[] }

type DialogState =
  | { key: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { key: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { key: number; kind: 'choice'; opts: ChoiceOptions; resolve: (v: string | null) => void }

interface DialogsApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  prompt: (opts: PromptOptions) => Promise<string | null>
  choice: (opts: ChoiceOptions) => Promise<string | null>
}

const DialogsCtx = React.createContext<DialogsApi>({ confirm: async () => false, prompt: async () => null, choice: async () => null })

export function DialogsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const seq = React.useRef(0)

  const confirm = React.useCallback((opts: ConfirmOptions): Promise<boolean> =>
    new Promise<boolean>((resolve) => setDialog({ key: ++seq.current, kind: 'confirm', opts, resolve })), [])
  const prompt = React.useCallback((opts: PromptOptions): Promise<string | null> =>
    new Promise<string | null>((resolve) => setDialog({ key: ++seq.current, kind: 'prompt', opts, resolve })), [])
  const choice = React.useCallback((opts: ChoiceOptions): Promise<string | null> =>
    new Promise<string | null>((resolve) => setDialog({ key: ++seq.current, kind: 'choice', opts, resolve })), [])

  const close = React.useCallback((value: boolean | string | null): void => {
    const current = dialog
    setDialog(null)
    if (current && current.kind === 'confirm') current.resolve(value === true)
    else if (current) current.resolve(value as string | null)
  }, [dialog])

  return (
    <DialogsCtx.Provider value={{ confirm, prompt, choice }}>
      {children}
      {dialog?.kind === 'confirm'
        ? <ConfirmDialog key={dialog.key} opts={dialog.opts} onClose={(v) => close(v)} />
        : null}
      {dialog?.kind === 'prompt'
        ? <PromptDialog key={dialog.key} opts={dialog.opts} onClose={(v) => close(v)} />
        : null}
      {dialog?.kind === 'choice'
        ? <ChoiceDialog key={dialog.key} opts={dialog.opts} onClose={(v) => close(v)} />
        : null}
    </DialogsCtx.Provider>
  )
}

/** 应用内 confirm 对话框；返回 Promise<boolean>。 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  return React.useContext(DialogsCtx).confirm
}

/** 应用内 prompt 对话框；返回 Promise<string | null>（取消为 null）。 */
export function usePrompt(): (opts: PromptOptions) => Promise<string | null> {
  return React.useContext(DialogsCtx).prompt
}

/** 应用内多选一对话框；返回所选 value（取消为 null）。 */
export function useChoice(): (opts: ChoiceOptions) => Promise<string | null> {
  return React.useContext(DialogsCtx).choice
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (v: boolean) => void }): React.ReactElement {
  const t = useT()
  return (
    <Modal
      title={opts.title}
      icon={<IcWarning size={14} />}
      width="md"
      onClose={() => onClose(false)}
      footer={<>
        <button type="button" className="kb-btn" onClick={() => onClose(false)}>{t('cancel')}</button>
        <button type="button" className={opts.danger ? 'kb-btn kb-btn--danger' : 'kb-btn kb-btn--primary'} data-autofocus onClick={() => onClose(true)}>{opts.confirmLabel ?? t('confirm')}</button>
      </>}
    >
      <p className="kb-dialog__msg">{opts.message}</p>
    </Modal>
  )
}

function PromptDialog({ opts, onClose }: { opts: PromptOptions; onClose: (v: string | null) => void }): React.ReactElement {
  const [value, setValue] = React.useState(opts.initial ?? '')
  const t = useT()
  const submit = (): void => { if (value.trim()) onClose(value) }
  return (
    <Modal
      title={opts.title}
      width="md"
      onClose={() => onClose(null)}
      footer={<>
        <button type="button" className="kb-btn" onClick={() => onClose(null)}>{t('cancel')}</button>
        <button type="button" className="kb-btn kb-btn--primary" disabled={!value.trim()} onClick={submit}>{opts.confirmLabel ?? t('ok')}</button>
      </>}
    >
      <div className="kb-form">
        <div className="kb-field">
          {opts.label ? <span className="kb-field__label">{opts.label}</span> : null}
          <input
            className="kb-input" data-autofocus value={value} placeholder={opts.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
        </div>
      </div>
    </Modal>
  )
}

function ChoiceDialog({ opts, onClose }: { opts: ChoiceOptions; onClose: (v: string | null) => void }): React.ReactElement {
  const t = useT()
  return (
    <Modal
      title={opts.title}
      width="md"
      onClose={() => onClose(null)}
      footer={<>
        <button type="button" className="kb-btn" onClick={() => onClose(null)}>{t('cancel')}</button>
        {opts.options.map((o) => (
          <button key={o.value} type="button" className={o.primary ? 'kb-btn kb-btn--primary' : 'kb-btn'} onClick={() => onClose(o.value)}>{o.label}</button>
        ))}
      </>}
    >
      <p className="kb-dialog__msg">{opts.message}</p>
    </Modal>
  )
}
