import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  // Pages live in the URL now; every test starts on the swap page.
  history.replaceState(null, '', '/')
})

// jsdom lacks the layout and pointer APIs that bits-ui focus and dismiss handling call.
window.scrollTo = () => {}
Element.prototype.scrollIntoView ??= function scrollIntoView(): void {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {}
window.matchMedia ??= (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList
