import { describe, it, expect } from 'vitest';
import { shouldIgnoreViewportResize, popupLayout } from '../keyboardViewport';

describe('shouldIgnoreViewportResize', () => {
  it('ignorerer høydekrymping (tastatur) mens popupen er åpen', () => {
    expect(shouldIgnoreViewportResize({ popupOpen: true, widthChanged: false })).toBe(true);
  });
  it('tar imot ekte resize (rotasjon: bredden endres) også med popup åpen', () => {
    expect(shouldIgnoreViewportResize({ popupOpen: true, widthChanged: true })).toBe(false);
  });
  it('uten popup oppdateres alltid som før', () => {
    expect(shouldIgnoreViewportResize({ popupOpen: false, widthChanged: false })).toBe(false);
    expect(shouldIgnoreViewportResize({ popupOpen: false, widthChanged: true })).toBe(false);
  });
});

describe('popupLayout', () => {
  it('mus/desktop: sentrert og identisk med tidligere mål (høyde − 40)', () => {
    expect(popupLayout({ vvTop: 0, vvHeight: 768, coarse: false, isMobile: false })).toEqual({
      top: 0, height: 768, alignItems: 'center', padding: { top: 20, side: 20 }, modalMaxHeight: 728,
    });
    expect(popupLayout({ vvTop: 0, vvHeight: 700, coarse: false, isMobile: true }).padding).toEqual({ top: 12, side: 12 });
  });
  it('touch: festet øverst, begrenset til det synlige området over tastaturet', () => {
    const l = popupLayout({ vvTop: 0, vvHeight: 430, coarse: true, isMobile: false });
    expect(l.alignItems).toBe('flex-start');
    expect(l.padding.top).toBe(32);
    expect(l.modalMaxHeight).toBe(430 - 32 - 20);
  });
  it('følger visualViewport når Safari har panorert (offsetTop > 0)', () => {
    const l = popupLayout({ vvTop: 140, vvHeight: 430, coarse: true, isMobile: false });
    expect(l.top).toBe(140);
    expect(l.height).toBe(430);
  });
});
