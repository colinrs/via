import { describe, expect, it } from 'vitest'

import { isTunnelState } from './via'

describe('isTunnelState', () => {
  it('accepts only runtime states exposed by the Rust backend', () => {
    expect(isTunnelState('active')).toBe(true)
    expect(isTunnelState('dynamic')).toBe(false)
  })
})
