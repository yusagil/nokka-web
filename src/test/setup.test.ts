import { describe, it, expect } from 'vitest'

describe('test setup', () => {
  it('vitest is configured correctly', () => {
    expect(true).toBe(true)
  })

  it('jest-dom matchers are available', () => {
    const element = document.createElement('div')
    element.textContent = 'Nokka'
    document.body.appendChild(element)
    expect(element).toBeInTheDocument()
    document.body.removeChild(element)
  })
})
