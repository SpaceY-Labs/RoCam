import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock the Navbar so it doesn't pull in all router/lingui complexity
vi.mock('@/components/navbar', () => ({
  Navbar: () => <nav data-testid="mock-navbar">Navbar</nav>,
}))

import DefaultLayout from './default'

const renderLayout = (children?: React.ReactNode, className?: string) =>
  render(
    <MemoryRouter>
      <DefaultLayout className={className}>{children}</DefaultLayout>
    </MemoryRouter>
  )

describe('DefaultLayout', () => {
  it('renders Navbar', () => {
    renderLayout()
    expect(screen.getByTestId('mock-navbar')).toBeInTheDocument()
  })

  it('renders children inside main', () => {
    renderLayout(<span>page content</span>)
    expect(screen.getByText('page content')).toBeInTheDocument()
  })

  it('applies custom className to main element', () => {
    renderLayout(<span>child</span>, 'custom-class')
    const main = screen.getByRole('main')
    expect(main).toHaveClass('custom-class')
  })

  it('main always has flex-grow class', () => {
    renderLayout()
    const main = screen.getByRole('main')
    expect(main).toHaveClass('flex-grow')
  })

  it('wraps everything in a relative flex container', () => {
    const { container } = renderLayout(<span>x</span>)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('relative', 'flex', 'flex-col', 'min-h-screen')
  })
})
