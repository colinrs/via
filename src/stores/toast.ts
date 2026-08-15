import { reactive } from 'vue'

export type ToastTone = 'error' | 'success' | 'info'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface ToastController {
  toasts: Toast[]
  push(message: string, tone: ToastTone): void
  dismiss(id: number): void
}

export function createToastController(durationMs = 4000): ToastController {
  const state = reactive({ toasts: [] as Toast[] })
  let nextId = 0

  const dismiss = (id: number) => {
    const index = state.toasts.findIndex((toast) => toast.id === id)
    if (index >= 0) state.toasts.splice(index, 1)
  }

  const push = (message: string, tone: ToastTone) => {
    const id = ++nextId
    state.toasts.push({ id, message, tone })
    setTimeout(() => dismiss(id), durationMs)
  }

  return { toasts: state.toasts, push, dismiss }
}
