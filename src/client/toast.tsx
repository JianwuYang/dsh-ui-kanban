/**
 * 应用内 toast 通知：底部居中堆叠，aria-live 播报，180ms 进场 / 160ms 退场动画，
 * 3s 自动消失、点击立即关闭。替代原先 AppState.toast + 定时器的实现。
 * @module dsh-kanban/client/toast
 */

import React from 'react'
import { IcWarning } from './icons.tsx'

interface ToastItem { id: number; text: string; kind: 'info' | 'error'; exiting: boolean }

export type ToastKind = 'info' | 'error'

type ToastFn = (text: string, kind?: ToastKind) => void

const ToastCtx = React.createContext<ToastFn>(() => {})

let toastSeq = 0

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [items, setItems] = React.useState<ToastItem[]>([])

  const dismiss = React.useCallback((id: number): void => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, exiting: true } : x)))
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 180)
  }, [])

  const toast = React.useCallback((text: string, kind: ToastKind = 'info'): void => {
    const id = ++toastSeq
    setItems((xs) => [...xs.slice(-3), { id, text, kind, exiting: false }])
    setTimeout(() => dismiss(id), 3000)
  }, [dismiss])

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {items.length > 0 ? (
        <div className="kb-toast__viewport">
          {items.map((t) => (
            <div
              key={t.id}
              role="status"
              className={[
                'kb-toast',
                t.kind === 'error' ? 'kb-toast--error' : '',
                t.exiting ? 'kb-toast--exit' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => dismiss(t.id)}
            >
              {t.kind === 'error' ? <span className="kb-toast__icon"><IcWarning size={14} /></span> : null}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </ToastCtx.Provider>
  )
}

/** 弹 toast；error 变体带警告图标与 danger 色。 */
export function useToast(): ToastFn {
  return React.useContext(ToastCtx)
}
