import { afterEach, describe, expect, it, vi } from 'vitest'

import { createToastController } from './toast'

describe('toast controller', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('appends toasts and dismisses a single toast by id', () => {
    vi.useFakeTimers()
    const controller = createToastController()
    controller.push('first', 'error')
    controller.push('second', 'success')
    expect(controller.toasts.map((toast) => toast.message)).toEqual([
      'first',
      'second',
    ])
    controller.dismiss(controller.toasts[0].id)
    expect(controller.toasts.map((toast) => toast.message)).toEqual(['second'])
  })

  it('auto-dismisses a toast after the configured duration', () => {
    vi.useFakeTimers()
    const controller = createToastController(1000)
    controller.push('transient', 'info')
    expect(controller.toasts).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(controller.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(controller.toasts).toHaveLength(0)
  })

  it('dismissing an unknown id is a no-op', () => {
    vi.useFakeTimers()
    const controller = createToastController()
    controller.push('kept', 'info')
    controller.dismiss(999)
    expect(controller.toasts).toHaveLength(1)
  })
})
