// Rene hjelpere for Gangskjermens håndtering av skjermtastaturet (iPad/iPhone).
//
// iOS Safari endrer IKKE layout-viewporten når tastaturet åpnes (innerWidth/innerHeight
// er uendret), men visualViewport.height krymper — og Safari kan i tillegg panorere
// visualViewport (offsetTop > 0) for å vise tekstfeltet. En ekte størrelsesendring
// (rotasjon, Split View) endrer derimot innerWidth.

/**
 * Skal en visualViewport-/resize-hendelse ignoreres av Gangskjerm-layouten?
 * Ja når en hurtig-popup med tekstfelt er åpen (tastaturet kommer opp og layouten bak
 * skal stå stille) — med mindre bredden endret seg, som betyr rotasjon/ekte resize.
 */
export function shouldIgnoreViewportResize(o: { popupOpen: boolean; widthChanged: boolean }): boolean {
  return o.popupOpen && !o.widthChanged;
}

export interface PopupLayout {
  /** Overlayets topp (px, relativt til layout-viewporten) — følger visualViewport. */
  top: number;
  /** Overlayets høyde (px) = det synlige området over tastaturet. */
  height: number;
  alignItems: 'center' | 'flex-start';
  /** Padding (px) rundt modalen i overlayet. */
  padding: { top: number; side: number };
  /** Maks høyde (px) for modalen så den aldri blir høyere enn det synlige området. */
  modalMaxHeight: number;
}

/**
 * Plassering av hurtig-popupen ut fra visualViewport.
 * - Mus/desktop (ikke `coarse`): sentrert, som før (høyde/topp = visualViewport, normalt hele skjermen).
 * - Touch (`coarse`): festet øverst. Da ligger tekstfeltet allerede over tastaturet FØR det åpnes,
 *   så Safari ikke trenger å panorere siden for å vise det (som flyttet hele Gangskjermen opp).
 */
export function popupLayout(o: { vvTop: number; vvHeight: number; coarse: boolean; isMobile: boolean }): PopupLayout {
  const side = o.isMobile ? 12 : 20;
  if (!o.coarse) {
    return {
      top: o.vvTop, height: o.vvHeight, alignItems: 'center',
      padding: { top: side, side }, modalMaxHeight: o.vvHeight - 40,
    };
  }
  const padTop = o.isMobile ? 12 : 32;
  return {
    top: o.vvTop, height: o.vvHeight, alignItems: 'flex-start',
    padding: { top: padTop, side }, modalMaxHeight: o.vvHeight - padTop - side,
  };
}
