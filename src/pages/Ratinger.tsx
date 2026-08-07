import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../lib/useScrollLock';
import { useRatings, type Rating, type RatingCat, type RatingPatch } from '../contexts/RatingContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Card, Btn, Tag, Ico } from '../components';
import { supabase } from '../lib/supabase';
import { resizeImage } from '../lib/resizeImage';

async function uploadImage(file: File): Promise<string> {
  const img = await resizeImage(file);
  const ext = img.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('rating-images').upload(path, img, { contentType: img.type });
  if (error) throw error;
  return path;
}

async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('rating-images').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

type SortKey = 'score_desc' | 'score_asc' | 'newest' | 'alpha';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score_desc', label: 'Høyest score' },
  { key: 'score_asc',  label: 'Lavest score' },
  { key: 'newest',     label: 'Nyeste' },
  { key: 'alpha',      label: 'Alfabetisk' },
];

// How many ratings to reveal per "Vis flere" click. Cards are only mounted as
// they become visible, so their images (and signed-URL fetches) load lazily —
// not all at once.
const PAGE = 10;

function catLabel(cat: string): string {
  const MAP: Record<string, string> = {
    mat: 'Mat', film: 'Film', serie: 'Serier', bok: 'Bøker',
    musikk: 'Musikk', sted: 'Steder', opplevelse: 'Opplevelser',
  };
  return MAP[cat] ?? (cat.charAt(0).toUpperCase() + cat.slice(1));
}

// Deterministic per-category colour (same palette as Ting vi vil gjøre).
const CAT_PALETTE = [
  '#3B82B8','#7AB394','#C9963A','#D95F5F','#8B6EC9','#4A8A6E','#C97A3B','#5A6B82',
];
const catColor = (cats: string[], name: string) => CAT_PALETTE[cats.indexOf(name) % CAT_PALETTE.length] ?? 'var(--ink-4)';

function scoreColor(s: number) {
  if (s >= 9) return '#7AB394';
  if (s >= 5) return 'var(--ink-2)';
  return 'var(--warn)';
}

// Fixed badge backgrounds used behind white text — must stay dark enough for
// contrast in BOTH themes, so they can't use the theme-flipping --ink/--warn tokens
// (those go light in dark mode, making white text vanish).
function scoreBadgeBg(s: number): string {
  if (s >= 9) return '#7AB394';
  if (s >= 5) return '#5A6B82';
  return '#C2772F';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── created_at ⇄ date-input (YYYY-MM-DD, local) ──────────────────────────────
function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const todayIso = () => localDateIso(new Date());
const isoDateOf = (ts: string) => localDateIso(new Date(ts));
// Store a picked date at local noon so it renders as the same day in any timezone.
const dateToCreatedAt = (dateIso: string) => new Date(`${dateIso}T12:00:00`).toISOString();

function avgScore(r: Rating): number {
  const scores = [r.score_m, r.score_l].filter((s): s is number => s != null && s > 0);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

function ScorePips({ score }: { score: number }) {
  const col = scoreColor(score);
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} style={{
          width: 12, height: 3, borderRadius: 2,
          background: i < score ? col : 'var(--line-2)',
          opacity: i < score ? 1 : 0.4,
        }} />
      ))}
    </div>
  );
}

function PersonScore({ name, score, comment, onEditComment }: {
  name: string; score?: number; comment?: string;
  onEditComment?: (current: string) => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {name}
      </div>
      {score !== undefined ? (
        <>
          <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: scoreColor(score) }}>
            {score}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)', marginLeft: 3 }}>/ 10</span>
          </div>
          <ScorePips score={score} />
        </>
      ) : (
        <div style={{ fontSize: 18, color: 'var(--ink-4)', fontWeight: 300, lineHeight: 1 }}>—</div>
      )}
      {onEditComment ? (
        <div
          onClick={() => onEditComment(comment ?? '')}
          title="Klikk for å redigere kommentar"
          style={{ marginTop: 5, cursor: 'text' }}
        >
          {comment ? (
            <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>«{comment}»</div>
          ) : (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--line-2)', borderBottom: '1px dashed var(--line-2)', paddingBottom: 1 }}>
              + legg til kommentar
            </div>
          )}
        </div>
      ) : (
        comment && <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 12, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>«{comment}»</div>
      )}
    </div>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useScrollLock();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <img
        src={src}
        alt=""
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '100%', maxHeight: '90vh',
          borderRadius: 8,
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          display: 'block',
        }}
      />
      <button
        onClick={onClose}
        style={{
          position: 'fixed', top: 16, right: 16,
          background: 'rgba(0,0,0,0.5)', border: 0, borderRadius: 6,
          color: '#fff', fontSize: 18, lineHeight: 1,
          width: 36, height: 36, display: 'grid', placeItems: 'center',
          cursor: 'pointer',
        }}
      >×</button>
    </div>,
    document.body
  );
}

const SHIELD_PATH = "M5235 12454 c-38 -14 -162 -51 -275 -84 -521 -150 -686 -267 -789 -558 l-26 -74 -232 -154 c-128 -84 -233 -152 -233 -149 0 2 18 33 41 67 56 87 112 208 153 330 36 109 140 508 133 514 -2 2 -52 -26 -111 -61 -447 -269 -730 -549 -846 -839 -63 -156 -75 -286 -40 -420 l21 -78 -43 -37 c-99 -84 -276 -252 -365 -346 -79 -84 -91 -94 -75 -60 57 117 112 322 132 490 18 162 8 446 -25 692 l-6 43 -113 -143 c-179 -227 -258 -334 -338 -457 -146 -224 -189 -337 -219 -574 -27 -219 18 -530 85 -585 15 -12 21 -11 46 7 16 12 32 22 35 22 3 0 -28 -46 -69 -102 -77 -108 -247 -376 -310 -490 -21 -38 -39 -68 -40 -68 -2 0 1 24 7 53 5 28 10 133 10 232 0 262 -17 348 -173 843 -41 128 -77 229 -80 225 -7 -8 -99 -291 -174 -533 -49 -159 -112 -406 -132 -520 -11 -61 -18 -149 -18 -245 0 -167 17 -260 76 -399 34 -79 158 -309 169 -314 4 -2 -4 -33 -18 -70 -43 -111 -139 -402 -159 -479 -10 -40 -21 -73 -25 -73 -4 0 -10 21 -14 48 -10 71 -100 331 -160 464 -29 65 -74 146 -99 182 -25 36 -97 150 -160 253 -145 241 -166 249 -166 68 0 -44 -5 -150 -10 -235 -47 -714 -20 -995 118 -1265 57 -110 153 -212 261 -275 73 -43 73 -44 67 -80 -15 -93 -37 -372 -43 -542 l-6 -188 -49 92 c-65 120 -184 312 -261 418 -112 156 -179 230 -291 320 -61 49 -142 114 -179 144 -99 81 -118 75 -93 -27 8 -34 38 -188 66 -342 77 -430 128 -616 226 -824 122 -259 320 -462 575 -592 l57 -28 11 -83 c24 -167 76 -434 111 -572 10 -39 17 -72 16 -73 -2 -2 -18 18 -36 43 -58 81 -172 188 -270 254 -52 35 -162 111 -245 170 -237 168 -609 410 -630 410 -15 0 5 -48 110 -269 160 -338 335 -681 410 -806 181 -303 443 -513 783 -630 57 -19 120 -35 139 -35 33 0 36 -3 61 -63 38 -91 252 -511 301 -590 44 -72 42 -73 -26 -21 -109 83 -327 204 -508 283 -135 59 -232 91 -399 131 -71 17 -192 54 -268 80 -205 73 -213 59 -70 -116 53 -66 143 -180 198 -254 130 -173 244 -299 386 -427 284 -256 408 -332 656 -403 204 -59 310 -69 476 -49 l89 11 26 -34 c100 -128 339 -376 546 -567 l80 -74 -152 77 c-171 86 -197 93 -528 140 -485 69 -997 111 -1058 88 -15 -7 -13 -12 20 -43 71 -68 497 -378 657 -479 127 -80 248 -139 406 -198 282 -105 396 -126 641 -119 202 6 268 18 429 82 l116 46 138 -86 c150 -94 393 -230 496 -278 168 -78 187 -88 150 -82 -19 3 -140 8 -268 12 -318 8 -393 -1 -902 -101 -151 -30 -359 -69 -462 -88 -221 -39 -235 -50 -109 -86 43 -12 202 -61 352 -108 514 -160 614 -178 969 -179 228 0 267 2 363 23 230 48 386 122 526 248 62 56 89 75 105 71 11 -2 89 -23 172 -46 83 -23 224 -57 313 -75 88 -18 163 -35 166 -38 2 -2 -19 -10 -48 -17 -133 -34 -494 -203 -1027 -480 -302 -157 -394 -212 -377 -223 31 -20 546 0 842 33 365 40 834 203 1026 357 71 57 145 131 220 219 l36 43 205 0 206 0 143 -137 c247 -236 286 -257 729 -391 254 -77 330 -89 821 -123 441 -31 469 -31 469 2 0 25 -265 168 -430 232 -52 20 -138 64 -190 98 -136 88 -249 149 -385 209 -124 54 -457 170 -487 170 -10 0 -18 3 -18 8 0 4 46 16 103 26 121 22 370 84 515 128 56 17 103 29 105 27 1 -2 9 -17 17 -34 50 -97 385 -270 610 -314 175 -35 548 -32 740 4 173 34 786 221 880 270 41 21 39 50 -2 64 -52 16 -402 87 -648 130 -400 71 -517 85 -720 85 -179 0 -223 -5 -458 -49 -15 -3 -4 5 23 17 238 104 606 307 842 466 117 79 121 80 109 49 -24 -58 4 -93 106 -131 116 -44 227 -60 408 -60 181 0 253 11 445 69 175 53 310 114 476 215 277 168 659 430 718 494 30 32 22 53 -24 62 -59 11 -709 -38 -950 -72 -295 -41 -564 -126 -765 -243 l-55 -32 55 48 c217 189 432 408 624 635 54 64 58 67 79 54 93 -58 350 -39 616 46 132 42 215 86 356 187 330 236 456 363 653 657 83 124 150 204 225 265 70 58 88 85 66 100 -19 13 -61 5 -214 -41 -71 -21 -195 -55 -275 -76 -149 -38 -259 -76 -390 -137 -180 -83 -420 -231 -569 -351 -81 -65 -83 -66 -60 -29 123 199 316 566 384 731 15 36 29 55 37 52 75 -26 355 81 560 215 122 81 296 248 361 350 123 193 470 884 533 1062 29 82 14 83 -107 11 -141 -85 -580 -377 -709 -473 -119 -89 -265 -230 -333 -324 -26 -35 -47 -61 -47 -59 0 3 13 56 30 119 36 141 83 371 110 549 12 74 22 135 23 135 1 1 20 7 43 13 58 17 250 134 323 197 126 111 216 231 302 405 96 193 157 405 219 762 22 128 55 290 72 359 43 176 32 195 -69 111 -129 -109 -491 -500 -613 -663 -74 -99 -144 -222 -190 -332 l-37 -87 -6 217 c-6 190 -24 435 -43 585 -6 44 -5 46 14 41 39 -10 114 38 213 136 84 84 102 108 141 191 79 166 120 328 138 547 17 211 12 384 -25 853 -24 301 -8 292 -139 79 -210 -343 -369 -644 -417 -794 -18 -58 -23 -100 -27 -248 -2 -98 -6 -177 -8 -175 -2 2 -19 67 -39 143 -45 175 -139 470 -204 638 -33 86 -43 123 -32 113 45 -41 96 0 166 136 52 101 116 286 141 408 29 146 8 303 -92 675 -51 190 -187 609 -204 630 -33 40 -81 -49 -190 -350 -49 -137 -61 -211 -72 -476 -8 -182 -9 -294 -1 -385 5 -71 9 -130 8 -132 -2 -2 -28 44 -58 101 -115 214 -286 481 -436 681 -79 106 -82 125 -6 46 22 -23 62 -58 89 -78 l49 -36 23 27 c48 56 77 219 77 432 0 347 -88 566 -377 940 -57 74 -286 355 -318 390 -9 10 -4 -213 13 -646 9 -247 23 -361 54 -454 19 -56 90 -207 130 -275 15 -25 20 -36 11 -26 -109 134 -399 425 -559 564 -34 29 -37 34 -23 48 28 27 40 97 40 224 0 145 -13 208 -61 305 -87 175 -291 410 -501 577 -125 99 -370 258 -399 258 -30 0 -1 -160 82 -439 64 -216 106 -299 234 -465 45 -58 49 -67 25 -51 -16 10 -92 53 -169 96 -175 96 -317 178 -329 189 -5 5 -13 37 -18 72 -19 138 -132 306 -281 419 -140 106 -272 158 -756 300 -154 45 -181 48 -181 19 0 -44 269 -402 437 -580 138 -147 328 -253 527 -296 64 -13 86 -26 278 -161 114 -80 207 -148 205 -150 -2 -1 -55 1 -117 6 -137 11 -258 1 -418 -35 -145 -32 -348 -93 -467 -139 -255 -99 -226 -115 320 -175 154 -17 287 -33 295 -35 8 -3 98 -9 199 -15 204 -12 518 1 631 24 l65 14 115 -94 c63 -51 144 -120 180 -152 l65 -60 -90 24 c-181 48 -289 59 -585 58 -299 -1 -362 -9 -368 -50 -4 -30 21 -47 158 -107 69 -30 226 -103 350 -162 222 -106 442 -197 552 -229 84 -24 270 -54 386 -62 l104 -7 105 -137 c57 -76 132 -178 166 -226 53 -77 58 -86 32 -69 -221 146 -708 323 -941 342 -76 6 -93 -2 -75 -36 20 -36 729 -636 872 -737 205 -146 443 -282 533 -305 l45 -11 47 -107 c48 -108 174 -435 174 -451 0 -5 -51 43 -112 107 -141 144 -254 230 -444 339 -282 162 -464 241 -464 202 0 -21 49 -92 121 -173 120 -138 266 -354 393 -584 32 -57 74 -127 95 -155 120 -162 346 -381 513 -498 49 -35 96 -67 104 -73 22 -15 65 -317 93 -645 4 -52 7 -96 6 -98 -1 -1 -17 39 -35 90 -43 126 -108 249 -175 333 -70 87 -624 660 -639 660 -21 0 -8 -62 63 -305 148 -503 245 -768 371 -1015 100 -198 222 -378 350 -518 l53 -58 -7 -82 c-16 -181 -83 -617 -96 -617 -4 0 -10 28 -13 63 -19 203 -133 460 -405 912 -113 189 -170 267 -190 263 -25 -5 -26 -93 -7 -413 34 -587 64 -912 97 -1040 45 -182 174 -468 259 -576 l28 -36 -58 -144 c-94 -232 -271 -601 -271 -564 0 6 5 75 10 154 20 297 -38 698 -151 1036 -44 133 -79 195 -109 195 -27 0 -37 -24 -45 -115 -9 -103 -43 -280 -110 -575 -110 -482 -130 -620 -122 -858 6 -179 17 -240 79 -419 l32 -92 -86 -113 c-89 -117 -278 -341 -299 -354 -9 -5 -10 0 -5 17 13 48 46 256 56 358 15 151 12 487 -5 706 -9 104 -17 195 -19 200 -2 6 -38 -60 -81 -145 -117 -234 -270 -512 -347 -633 -195 -307 -240 -475 -264 -982 l-6 -141 -62 -45 c-136 -102 -446 -309 -461 -309 -3 0 13 29 35 64 110 173 220 456 274 704 22 99 66 385 60 391 -7 8 -543 -530 -697 -699 -294 -324 -423 -546 -452 -781 l-7 -56 -136 -46 c-110 -37 -383 -117 -399 -117 -2 0 41 45 96 100 208 208 406 511 454 695 33 130 47 125 -120 41 -132 -65 -256 -118 -518 -218 -44 -17 -134 -58 -200 -92 -108 -55 -130 -71 -221 -161 -166 -166 -305 -372 -308 -455 l-1 -37 -74 -7 c-112 -9 -537 -7 -563 3 -16 6 -30 28 -47 72 -32 86 -94 210 -133 267 -52 77 -167 185 -261 246 -102 67 -222 125 -397 191 -235 88 -456 189 -569 257 l-33 21 7 -34 c51 -229 237 -520 510 -797 61 -62 104 -110 96 -108 -9 3 -79 21 -156 41 -77 20 -201 56 -276 81 l-136 44 -7 63 c-28 249 -107 399 -372 697 -95 106 -765 802 -769 798 -9 -8 49 -324 85 -465 81 -322 173 -545 297 -721 14 -20 8 -18 -48 14 -85 49 -325 207 -422 279 -56 41 -77 62 -72 73 3 8 11 50 16 91 28 195 -32 501 -156 797 -50 119 -85 184 -186 351 -66 108 -227 407 -305 566 -21 42 -43 77 -50 77 -18 0 -24 -135 -24 -545 0 -501 7 -577 76 -785 10 -29 -209 216 -349 393 l-86 107 25 57 c53 120 104 406 104 586 0 173 -36 392 -144 874 -66 295 -103 491 -108 573 -2 34 -7 46 -21 48 -13 3 -27 -16 -56 -80 -64 -137 -136 -414 -198 -758 -35 -198 -37 -412 -5 -590 12 -63 19 -116 18 -118 -2 -1 -55 100 -118 225 -101 201 -210 446 -249 555 l-12 36 61 68 c104 113 235 404 267 592 41 241 118 1314 99 1374 -8 26 -26 22 -60 -14 -113 -121 -422 -672 -488 -869 -35 -105 -65 -266 -73 -386 -3 -57 -8 -102 -10 -100 -16 17 -100 503 -124 719 l-12 108 26 20 c73 58 395 522 468 675 85 178 401 1183 387 1227 -6 16 -144 -110 -343 -313 -351 -356 -428 -480 -544 -869 -28 -92 8 392 51 683 l21 148 41 21 c70 35 225 156 324 252 185 179 315 345 560 716 85 129 198 294 252 366 54 72 103 141 109 152 16 29 14 52 -4 52 -41 0 -415 -210 -655 -369 -119 -78 -281 -225 -361 -327 -24 -31 -52 -66 -61 -78 -32 -39 146 443 215 584 20 39 27 46 71 57 64 16 232 97 366 178 217 131 421 284 625 469 66 60 174 154 240 209 175 145 217 186 213 211 -4 30 -47 31 -173 6 -325 -66 -615 -183 -854 -346 -51 -35 -95 -64 -97 -64 -16 0 321 465 362 501 15 13 50 18 149 22 288 13 537 88 905 272 91 45 235 113 320 150 85 37 170 79 188 92 93 70 -17 103 -343 103 -285 0 -538 -35 -704 -98 -22 -8 157 150 281 249 68 54 106 78 117 74 53 -21 194 -46 306 -56 161 -13 328 -2 725 46 157 20 357 41 445 48 157 13 210 26 202 50 -16 49 -347 175 -597 227 -196 40 -472 50 -620 21 -25 -5 -46 -8 -48 -7 -1 2 85 71 191 153 l193 151 110 11 c240 24 407 116 645 353 134 134 254 276 329 390 63 94 77 132 59 154 -15 18 -20 17 -104 -12z";

function ConsensusBadge() {
  const green = '#4A7C3F';
  return (
    <svg width="70" height="68" viewBox="0 0 1280 1248" style={{ display: 'block' }}>
      <g transform="translate(0,1248) scale(0.1,-0.1)">
        <path fill={green} d={SHIELD_PATH} />
      </g>
      <text x="640" y="555" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="180" fontWeight="900" fill={green} letterSpacing="16">{"M & L"}</text>
      <text x="640" y="670" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="100" fontWeight="800" fill={green} letterSpacing="10">ANBEFALER</text>
    </svg>
  );
}

function RatingCard({ r, onDelete, onEdit }: { r: Rating; onDelete: (r: Rating) => void; onEdit: (r: Rating) => void }) {
  const { updateRating } = useRatings();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isLandscape, setIsLandscape] = useState<boolean | null>(null);
  const [editingComment, setEditingComment] = useState<'M' | 'L' | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingComment) commentRef.current?.focus();
  }, [editingComment]);

  const openComment = (who: 'M' | 'L', current: string) => {
    setCommentDraft(current);
    setEditingComment(who);
  };

  const saveComment = async () => {
    if (!editingComment) return;
    const patch = editingComment === 'M'
      ? { comment_m: commentDraft.trim() || undefined }
      : { comment_l: commentDraft.trim() || undefined };
    await updateRating(r.id, patch);
    setEditingComment(null);
  };

  useEffect(() => {
    if (!r.image_path) return;
    signedUrl(r.image_path).then(setImgUrl);
  }, [r.image_path]);

  const portrait = isLandscape === false;
  const landscape = isLandscape === true;
  const consensus = (r.score_m ?? 0) >= 9 && (r.score_l ?? 0) >= 9;

  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10, paddingRight: consensus ? 58 : 0 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.3 }}>{r.title}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <Tag kind="outline">{catLabel(r.cat)}</Tag>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)' }}>{fmtDate(r.created_at)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button onClick={() => onEdit(r)} style={{
          background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5,
          padding: '5px 9px', cursor: 'pointer', color: 'var(--ink-2)',
          fontSize: 13, lineHeight: 1, display: 'grid', placeItems: 'center',
        }}>✎</button>
        <button onClick={() => onDelete(r)} aria-label="Slett rating" style={{
          background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 5,
          padding: '5px 9px', cursor: 'pointer', color: 'var(--ink-2)',
          fontSize: 14, lineHeight: 1, display: 'grid', placeItems: 'center',
        }}>×</button>
      </div>
    </div>
  );

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    setIsLandscape(el.naturalWidth >= el.naturalHeight);
  };

  return (
    <div className="card" style={{ padding: '14px 16px', position: 'relative' }}>
      {consensus && (
        <div style={{ position: 'absolute', top: -12, right: -14, zIndex: 2 }}>
          <ConsensusBadge />
        </div>
      )}
      {header}

      {imgUrl && isLandscape === null && (
        <img src={imgUrl} alt="" onLoad={onImgLoad} style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }} />
      )}

      {/* Inline comment editor */}
      {editingComment && (
        <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {editingComment === 'M' ? 'Mikkel' : 'Leah'} — kommentar
          </div>
          <textarea
            ref={commentRef}
            rows={2}
            value={commentDraft}
            onChange={e => setCommentDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveComment(); } if (e.key === 'Escape') setEditingComment(null); }}
            placeholder="Skriv en kommentar…"
            style={{
              width: '100%', resize: 'none', fontFamily: 'var(--font-serif)', fontStyle: 'italic',
              fontSize: 13, padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--accent)', background: 'var(--surface)',
              color: 'var(--ink)', lineHeight: 1.5, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditingComment(null)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)' }}>Avbryt</button>
            <button onClick={saveComment} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--ink)', color: 'var(--surface)', cursor: 'pointer', fontWeight: 600 }}>Lagre</button>
          </div>
        </div>
      )}

      {portrait ? (
        <div style={{ display: 'flex', gap: 12, paddingTop: 10, borderTop: '1px solid var(--line-2)', alignItems: 'flex-start' }}>
          <button
            onClick={() => setLightboxOpen(true)}
            style={{ display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}
          >
            <img src={imgUrl!} alt="" style={{ display: 'block', width: 110, height: 'auto', maxHeight: 200, borderRadius: 6 }} />
          </button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <PersonScore name="Mikkel" score={r.score_m} comment={r.comment_m} onEditComment={r.score_l !== undefined ? c => openComment('M', c) : undefined} />
            <div style={{ height: 1, background: 'var(--line-2)' }} />
            <PersonScore name="Leah" score={r.score_l} comment={r.comment_l} onEditComment={r.score_m !== undefined ? c => openComment('L', c) : undefined} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
            <PersonScore name="Mikkel" score={r.score_m} comment={r.comment_m} onEditComment={r.score_l !== undefined ? c => openComment('M', c) : undefined} />
            <div style={{ width: 1, background: 'var(--line-2)', flexShrink: 0 }} />
            <PersonScore name="Leah" score={r.score_l} comment={r.comment_l} onEditComment={r.score_m !== undefined ? c => openComment('L', c) : undefined} />
          </div>
          {landscape && (
            <button
              onClick={() => setLightboxOpen(true)}
              style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in', marginTop: 12, borderRadius: 6, overflow: 'hidden' }}
            >
              <img src={imgUrl!} alt="" style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6 }} />
            </button>
          )}
        </>
      )}

      {lightboxOpen && imgUrl && <ImageLightbox src={imgUrl} onClose={() => setLightboxOpen(false)} />}
    </div>
  );
}

function ScorePicker({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <div className="card-eyebrow">{label}</div>
        {value > 0
          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: scoreColor(value) }}>{value}/10</span>
          : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>ikke vurdert</span>
        }
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {[1,2,3,4,5,6,7,8,9,10].map(n => (
          <button key={n} onClick={() => onChange(value === n ? 0 : n)} style={{
            flex: '0 0 calc(20% - 4px)', padding: '8px 0', border: '1px solid', minHeight: 38,
            borderColor: value === n ? scoreBadgeBg(n) : 'var(--line-2)',
            borderRadius: 4, background: value === n ? scoreBadgeBg(n) : 'transparent',
            color: value === n ? '#fff' : 'var(--ink-3)',
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
          }}>{n}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Category manager panel ──────────────────────────────────────────────────

function CatPanel({ categories, onAdd, onRename, onRemove, onClose }: {
  categories: string[];
  onAdd: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onRemove: (name: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // category being renamed
  const [editVal, setEditVal] = useState('');
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();
  useScrollLock();

  const add = () => {
    const name = input.trim().toLowerCase(); // categories are stored lower-case
    if (!name || categories.includes(name)) return;
    onAdd(name);
    setInput('');
  };

  const saveRename = (oldName: string) => {
    const name = editVal.trim().toLowerCase();
    if (!name) return;
    if (name !== oldName && categories.includes(name)) { notify('Kategorien finnes allerede'); return; }
    if (name !== oldName) { onRename(oldName, name); notify(`Kategori endret til «${catLabel(name)}»`); }
    setEditing(null);
  };

  return createPortal((
    <div style={{ position: 'fixed', inset: 0, zIndex: 302, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(11,37,69,0.45)' }} onClick={onClose} />
      <div style={{
        position: 'relative', background: 'var(--surface)', borderRadius: 12,
        width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(11,37,69,0.18)',
        display: 'flex', flexDirection: 'column', maxHeight: '80dvh', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div>
            <div className="card-eyebrow">Innstillinger</div>
            <h3 className="card-title" style={{ marginTop: 2 }}>🏷️ Kategorier</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)' }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 20px' }}>
          {categories.length === 0 && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)', padding: '8px 0' }}>Ingen kategorier ennå</div>
          )}
          {categories.map(c => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              {editing === c ? (
                <>
                  <input className="input" autoFocus value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(c); if (e.key === 'Escape') setEditing(null); }}
                    style={{ flex: 1, minWidth: 0 }} />
                  <button onClick={() => saveRename(c)} className="btn primary sm" style={{ flexShrink: 0 }}>Lagre</button>
                  <button onClick={() => setEditing(null)} aria-label="Avbryt" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)', flexShrink: 0 }}>×</button>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: catColor(categories, c), flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{catLabel(c)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { setEditing(c); setEditVal(c); }} aria-label={`Gi nytt navn til ${catLabel(c)}`} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)' }}>✎</button>
                    <button onClick={async () => { if (!await confirm({ title: 'Slett kategori?', message: `«${catLabel(c)}»`, confirmLabel: 'Slett' })) return; onRemove(c); notify('Kategori slettet', { actionLabel: 'Angre', onAction: () => onAdd(c) }); }} aria-label={`Slett kategori ${c}`} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)' }}>×</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--line)', flexShrink: 0, display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Ny kategori…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            style={{ flex: 1 }} />
          <button onClick={add} disabled={!input.trim()} className="btn primary"
            style={{ opacity: !input.trim() ? 0.4 : 1 }}>Legg til</button>
        </div>
      </div>
    </div>
  ), document.body);
}

// ─── Rating form ─────────────────────────────────────────────────────────────

const EMPTY_FORM = { title: '', cat: '', score_m: 0, score_l: 0, comment_m: '', comment_l: '', image_path: '', date: '' };
type FormState = typeof EMPTY_FORM;
const freshForm = (): FormState => ({ ...EMPTY_FORM, date: todayIso() });

function ImagePicker({ imagePath, imageFile, onChange, onRemove }: {
  imagePath: string;
  imageFile: File | null;
  onChange: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imagePath || imageFile) { setExistingUrl(null); return; }
    signedUrl(imagePath).then(setExistingUrl);
  }, [imagePath, imageFile]);
  const preview = imageFile ? URL.createObjectURL(imageFile) : existingUrl;

  return (
    <div>
      <div className="card-eyebrow" style={{ marginBottom: 6 }}>Bilde</div>
      {preview ? (
        <div style={{ position: 'relative' }}>
          <img
            src={preview}
            alt=""
            style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 6 }}
          />
          <button
            onClick={onRemove}
            style={{
              position: 'absolute', top: 6, right: 6,
              background: 'rgba(0,0,0,0.5)', border: 0, borderRadius: 4,
              color: '#fff', fontSize: 13, padding: '4px 8px', cursor: 'pointer',
              lineHeight: 1,
            }}
          >× Fjern</button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', padding: '14px 0', border: '1px dashed var(--line)',
            borderRadius: 6, background: 'transparent', cursor: 'pointer',
            color: 'var(--ink-4)', fontSize: 13,
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>📷</span> Legg til bilde
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f); e.target.value = ''; }}
      />
    </div>
  );
}

function RatingForm({ form, setForm, imageFile, setImageFile, categories, onSubmit, submitLabel, isEdit, onCancelEdit }: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  imageFile: File | null;
  setImageFile: React.Dispatch<React.SetStateAction<File | null>>;
  categories: string[];
  onSubmit: () => void;
  submitLabel: string;
  isEdit?: boolean;
  onCancelEdit?: () => void;
}) {
  const canSubmit = form.title.trim() && form.cat && (form.score_m > 0 || form.score_l > 0);

  return (
    <div className="col" style={{ gap: 10 }}>
      {isEdit && onCancelEdit && (
        <button onClick={onCancelEdit} style={{ background: 'transparent', border: 0, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer', padding: '2px 0', textAlign: 'left' }}>← Ny rating</button>
      )}
      <input
        className="input"
        placeholder="Navn / tittel…"
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
      />
      <select className="input" value={form.cat} onChange={e => setForm(f => ({ ...f, cat: e.target.value }))}>
        <option value="">Velg kategori…</option>
        {categories.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
      </select>

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Dato</div>
        <input className="input" type="date" value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: '100%' }} />
      </div>

      <ScorePicker label="Mikkel" value={form.score_m} onChange={n => setForm(f => ({ ...f, score_m: n }))} />
      <textarea
        className="input"
        rows={2}
        placeholder="Mikkel sin kommentar…"
        value={form.comment_m}
        onChange={e => setForm(f => ({ ...f, comment_m: e.target.value }))}
        style={{ resize: 'none', fontFamily: 'inherit', fontStyle: form.comment_m ? 'italic' : 'normal', fontSize: 13 }}
      />

      <ScorePicker label="Leah" value={form.score_l} onChange={n => setForm(f => ({ ...f, score_l: n }))} />
      <textarea
        className="input"
        rows={2}
        placeholder="Leah sin kommentar…"
        value={form.comment_l}
        onChange={e => setForm(f => ({ ...f, comment_l: e.target.value }))}
        style={{ resize: 'none', fontFamily: 'inherit', fontStyle: form.comment_l ? 'italic' : 'normal', fontSize: 13 }}
      />

      <ImagePicker
        imagePath={form.image_path}
        imageFile={imageFile}
        onChange={file => setImageFile(file)}
        onRemove={() => { setImageFile(null); setForm(f => ({ ...f, image_path: '' })); }}
      />

      <Btn primary onClick={onSubmit} icon={Ico.plus} style={{ opacity: canSubmit ? 1 : 0.4 }}>
        {submitLabel}
      </Btn>
    </div>
  );
}

function MobileFormScreen({ form, setForm, imageFile, setImageFile, categories, onSubmit, onClose, screenTitle, submitLabel }: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  imageFile: File | null;
  setImageFile: React.Dispatch<React.SetStateAction<File | null>>;
  categories: string[];
  onSubmit: () => void;
  onClose: () => void;
  screenTitle: string;
  submitLabel: string;
}) {
  useScrollLock();
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 300, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 14, color: 'var(--ink-3)', cursor: 'pointer', padding: '4px 8px' }}>← Avbryt</button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{screenTitle}</span>
        <div style={{ width: 60 }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
        <RatingForm form={form} setForm={setForm} imageFile={imageFile} setImageFile={setImageFile} categories={categories} onSubmit={onSubmit} submitLabel={submitLabel} />
      </div>
    </div>,
    document.body
  );
}

// ─── Recommendation list ─────────────────────────────────────────────────────

const CAT_EMOJI: Record<string, string> = {
  mat: '🍽️', film: '🎬', serie: '📺', bok: '📚',
  musikk: '🎵', sted: '📍', opplevelse: '✨', gym: '🏋️',
};

function RecommendationList({ ratings }: { ratings: Rating[] }) {
  const consensus = ratings.filter(r =>
    r.score_m != null && r.score_l != null && r.score_m >= 9 && r.score_l >= 9
  );

  // Group by category, preserving insertion order of first occurrence
  const byCategory = consensus.reduce<Record<string, Rating[]>>((acc, r) => {
    (acc[r.cat] = acc[r.cat] ?? []).push(r);
    return acc;
  }, {});

  // Sort each group by average score desc
  for (const cat in byCategory) {
    byCategory[cat].sort((a, b) => avgScore(b) - avgScore(a));
  }

  const catOrder = Object.keys(byCategory).sort((a, b) =>
    catLabel(a).localeCompare(catLabel(b), 'nb')
  );

  if (consensus.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        Ingen konsensus 9+ ennå — ratingene fylles på!
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px', borderRadius: 10,
        background: 'var(--ink-fixed)', color: 'rgba(207,224,239,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(207,224,239,0.45)', marginBottom: 6 }}>
            Mikkel & Leah anbefaler
          </div>
          <div style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            {consensus.length} ting vi <em style={{ fontStyle: 'italic' }}>elsker</em>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(207,224,239,0.4)', marginBottom: 4 }}>
            Konsensus
          </div>
          <div style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: '#7AB394' }}>
            9+
          </div>
        </div>
      </div>

      {/* Categories */}
      {catOrder.map(cat => (
        <div key={cat}>
          {/* Category header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 16 }}>{CAT_EMOJI[cat] ?? '⭐'}</span>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{catLabel(cat)}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginLeft: 2 }}>{byCategory[cat].length}</span>
          </div>

          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {byCategory[cat].map((r, i) => {
              const avg = avgScore(r);
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 6,
                  background: i % 2 === 0 ? 'var(--surface)' : 'transparent',
                }}>
                  {/* Rank */}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', width: 16, flexShrink: 0, textAlign: 'right' }}>
                    {i + 1}.
                  </span>

                  {/* Title + comments */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{r.title}</div>
                    {(r.comment_m || r.comment_l) && (
                      <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {r.comment_m && (
                          <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
                            M: «{r.comment_m}»
                          </span>
                        )}
                        {r.comment_l && (
                          <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
                            L: «{r.comment_l}»
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Scores */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>M</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: scoreColor(r.score_m!) }}>{r.score_m}</span>
                    </div>
                    <span style={{ color: 'var(--line-2)', fontSize: 10 }}>·</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>L</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: scoreColor(r.score_l!) }}>{r.score_l}</span>
                    </div>
                    <div style={{
                      marginLeft: 4, width: 28, height: 28, borderRadius: '50%',
                      background: scoreBadgeBg(avg), color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 800,
                      border: '2px solid rgba(255,255,255,0.4)',
                    }}>
                      {avg % 1 === 0 ? avg : avg.toFixed(1)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Stats card ──────────────────────────────────────────────────────────────

function StatsCard({ ratings, catFilter }: { ratings: Rating[]; catFilter: string }) {
  const group = catFilter === 'alle' ? ratings : ratings.filter(r => r.cat === catFilter);
  const mScores = group.map(r => r.score_m).filter((s): s is number => s !== undefined);
  const lScores = group.map(r => r.score_l).filter((s): s is number => s !== undefined);
  const mAvg = mScores.length ? (mScores.reduce((a, b) => a + b, 0) / mScores.length).toFixed(1) : '–';
  const lAvg = lScores.length ? (lScores.reduce((a, b) => a + b, 0) / lScores.length).toFixed(1) : '–';

  return (
    <Card eyebrow={catFilter === 'alle' ? 'Alle kategorier' : catLabel(catFilter)} title="Statistikk">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div className="card-eyebrow">Mikkel snitt</div>
          <div style={{ fontSize: 32, fontWeight: 300, letterSpacing: '-0.03em', marginTop: 4, color: mAvg !== '–' ? scoreColor(parseFloat(mAvg)) : 'var(--ink-3)' }}>
            {mAvg}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>{mScores.length} ratinger</div>
        </div>
        <div>
          <div className="card-eyebrow">Leah snitt</div>
          <div style={{ fontSize: 32, fontWeight: 300, letterSpacing: '-0.03em', marginTop: 4, color: lAvg !== '–' ? scoreColor(parseFloat(lAvg)) : 'var(--ink-3)' }}>
            {lAvg}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>{lScores.length} ratinger</div>
        </div>
      </div>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PageRatinger() {
  const { ratings, categories, addRating, updateRating, removeRating, addCategory, renameCategory, removeCategory } = useRatings();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();

  const handleDeleteRating = async (r: Rating) => {
    if (!await confirm({ title: 'Slett rating?', message: `«${r.title}»`, confirmLabel: 'Slett' })) return;
    void removeRating(r.id);
    notify('Rating slettet', {
      actionLabel: 'Angre',
      onAction: () => void addRating({
        title: r.title, cat: r.cat, score_m: r.score_m, score_l: r.score_l,
        comment_m: r.comment_m, comment_l: r.comment_l, image_path: r.image_path,
        created_at: r.created_at,
      }),
    });
  };
  const [cat, setCat]               = useState<RatingCat | 'alle'>('alle');
  const [sort, setSort]             = useState<SortKey>('newest');
  const [searchText, setSearchText]  = useState('');
  const [form, setForm]             = useState<FormState>(freshForm);
  const [imageFile, setImageFile]   = useState<File | null>(null);
  const [editId, setEditId]         = useState<string | null>(null);
  const [mobileFormOpen, setMobileFormOpen] = useState(false);
  const [showCatPanel, setShowCatPanel]     = useState(false);
  const [visibleCount, setVisibleCount]     = useState(PAGE);
  const [showRecs, setShowRecs]             = useState(false);
  const [isMobile, setIsMobile]     = useState(window.innerWidth < 768);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (cat !== 'alle' && !categories.includes(cat)) setCat('alle');
  }, [categories, cat]);

  const startAdd = () => {
    setForm(freshForm());
    setImageFile(null);
    setEditId(null);
    if (isMobile) setMobileFormOpen(true);
  };

  const startEdit = (r: Rating) => {
    setForm({
      title: r.title,
      cat: r.cat,
      score_m:   r.score_m   ?? 0,
      score_l:   r.score_l   ?? 0,
      comment_m: r.comment_m ?? '',
      comment_l: r.comment_l ?? '',
      image_path: r.image_path ?? '',
      date: isoDateOf(r.created_at),
    });
    setImageFile(null);
    setEditId(r.id);
    if (isMobile) setMobileFormOpen(true);
  };

  const cancelEdit = () => {
    setEditId(null);
    setImageFile(null);
    setForm(freshForm());
  };

  const [uploading, setUploading] = useState(false);
  // Synchronous re-entry lock: set before the first await so rapid double-taps
  // on a slow connection can't fire a second insert/update (which duplicated rows).
  const submitting = useRef(false);

  const handleSubmit = async () => {
    if (submitting.current) return;
    if (!form.title.trim() || !form.cat || (form.score_m === 0 && form.score_l === 0)) return;
    submitting.current = true;
    setUploading(true);
    try {
      let image_path = form.image_path || undefined;
      if (imageFile) image_path = await uploadImage(imageFile);

      if (editId) {
        const orig = ratings.find(x => x.id === editId);
        const patch: RatingPatch = {
          title: form.title.trim(),
          cat: form.cat,
          score_m:   form.score_m   > 0 ? form.score_m   : undefined,
          score_l:   form.score_l   > 0 ? form.score_l   : undefined,
          comment_m: form.comment_m.trim() || undefined,
          comment_l: form.comment_l.trim() || undefined,
          image_path,
        };
        // Only rewrite the timestamp when the date actually changed.
        if (form.date && orig && form.date !== isoDateOf(orig.created_at)) {
          patch.created_at = dateToCreatedAt(form.date);
        }
        await updateRating(editId, patch);
        setEditId(null);
      } else {
        await addRating({
          title: form.title.trim(),
          cat: form.cat,
          score_m:   form.score_m   > 0 ? form.score_m   : undefined,
          score_l:   form.score_l   > 0 ? form.score_l   : undefined,
          comment_m: form.comment_m.trim() || undefined,
          comment_l: form.comment_l.trim() || undefined,
          image_path,
          // Keep the DB default (now()) for a plain "today"; only set when moved.
          created_at: form.date && form.date !== todayIso() ? dateToCreatedAt(form.date) : undefined,
        });
      }
      setForm(freshForm());
      setImageFile(null);
      setMobileFormOpen(false);
    } finally {
      submitting.current = false;
      setUploading(false);
    }
  };

  const filtered = ratings
    .filter(r => (cat === 'alle' || r.cat === cat) && r.title.toLowerCase().includes(searchText.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'score_desc') return avgScore(b) - avgScore(a);
      if (sort === 'score_asc')  return avgScore(a) - avgScore(b);
      if (sort === 'alpha')      return a.title.localeCompare(b.title, 'nb');
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  // `filtered` is fully sorted above; we only slice for display, so sorting
  // always considers every rating — not just the ones currently shown.
  const visible = filtered.slice(0, visibleCount);


  return (
    <>
      {mobileFormOpen && (
        <MobileFormScreen
          form={form} setForm={setForm} imageFile={imageFile} setImageFile={setImageFile}
          categories={categories}
          onSubmit={handleSubmit} onClose={() => { setMobileFormOpen(false); cancelEdit(); }}
          screenTitle={editId ? 'Rediger rating' : 'Ny rating'}
          submitLabel={uploading ? 'Laster opp…' : editId ? 'Oppdater' : 'Legg til'}
        />
      )}
      {showCatPanel && (
        <CatPanel
          categories={categories}
          onAdd={addCategory}
          onRename={renameCategory}
          onRemove={removeCategory}
          onClose={() => setShowCatPanel(false)}
        />
      )}

      {/* Mobile top bar */}
      {isMobile && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {showRecs ? (
              <button onClick={() => setShowRecs(false)} className="btn ghost" style={{ flex: 1, fontSize: 13 }}>← Tilbake til ratinger</button>
            ) : (
              <>
                <Btn primary onClick={startAdd} icon={Ico.plus} style={{ flex: 1 }}>Legg til rating</Btn>
                <button
                  onClick={() => setShowCatPanel(true)}
                  className="btn ghost"
                  style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >🏷️ Kategorier ✎</button>
              </>
            )}
          </div>
          {!showRecs && (
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <input
                type="text"
                placeholder="🔍 Søk i ratinger…"
                value={searchText}
                onChange={(e) => { setSearchText(e.target.value); setVisibleCount(PAGE); }}
                className="input"
                style={{ fontSize: 13 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="input" value={cat} onChange={e => { setCat(e.target.value as RatingCat | 'alle'); setVisibleCount(PAGE); }}
                  style={{ flex: 1, fontSize: 13 }}>
                  <option value="alle">Alle</option>
                  {categories.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select>
                <select className="input" value={sort} onChange={e => { setSort(e.target.value as SortKey); setVisibleCount(PAGE); }}
                  style={{ flex: 1, fontSize: 13 }}>
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>
          )}
          {!showRecs && (
            <button onClick={() => setShowRecs(true)} className="btn ghost" style={{ fontSize: 12, padding: '6px 0' }}>
              ⭐ Anbefalingsliste
            </button>
          )}
        </div>
      )}

      {/* Desktop filter row */}
      {!isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {!showRecs && <>
                <button onClick={() => { setCat('alle'); setVisibleCount(PAGE); }}
                  className={'tag' + (cat === 'alle' ? ' accent' : ' outline')}
                  style={{ cursor: 'pointer' }}>Alle</button>
                {categories.map(c => (
                  <button key={c} onClick={() => { setCat(c); setVisibleCount(PAGE); }}
                    className={'tag' + (cat === c ? ' accent' : ' outline')}
                    style={{ cursor: 'pointer' }}>
                    {catLabel(c)}
                    <span className="mono" style={{ marginLeft: 5, opacity: 0.6, fontSize: 9 }}>
                      {ratings.filter(r => r.cat === c).length}
                    </span>
                  </button>
                ))}
              </>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!showRecs && (
                <button onClick={() => setShowCatPanel(true)} className="btn ghost"
                  style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}>🏷️ Kategorier ✎</button>
              )}
              <button
                onClick={() => setShowRecs(v => !v)}
                className={'btn' + (showRecs ? ' primary' : ' ghost')}
                style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap' }}
              >
                {showRecs ? '← Tilbake' : '⭐ Anbefalingsliste'}
              </button>
              {!showRecs && (
                <select className="input sm" value={sort} onChange={e => { setSort(e.target.value as SortKey); setVisibleCount(PAGE); }}
                  style={{ width: 'auto', padding: '4px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              )}
            </div>
          </div>
          {!showRecs && (
            <input
              type="text"
              placeholder="🔍 Søk i ratinger…"
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); setVisibleCount(PAGE); }}
              className="input"
              style={{ fontSize: 13, width: '100%' }}
            />
          )}
        </div>
      )}

      <div className="grid grid-12">

        {/* Main content area */}
        <div className={isMobile ? 'col-12 col' : 'col-8 col'}>
          {showRecs ? (
            <RecommendationList ratings={ratings} />
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {filtered.length === 0 && (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  Ingen ratinger enda
                </div>
              )}
              {visible.map(r => <RatingCard key={r.id} r={r} onDelete={handleDeleteRating} onEdit={startEdit} />)}
              {(visibleCount < filtered.length || visibleCount > PAGE) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {visibleCount < filtered.length && (
                    <button
                      onClick={() => setVisibleCount(c => c + PAGE)}
                      style={{
                        flex: 1, padding: '8px 0',
                        background: 'transparent', border: '1px solid var(--line-2)',
                        borderRadius: 8, cursor: 'pointer', fontSize: 12,
                        fontFamily: 'var(--font-mono)', color: 'var(--ink-4)',
                      }}
                    >
                      {`Vis ${Math.min(PAGE, filtered.length - visibleCount)} til (${filtered.length - visibleCount} igjen)`}
                    </button>
                  )}
                  {visibleCount > PAGE && (
                    <button
                      onClick={() => setVisibleCount(PAGE)}
                      style={{
                        flexShrink: 0, padding: '8px 14px',
                        background: 'transparent', border: '1px solid var(--line-2)',
                        borderRadius: 8, cursor: 'pointer', fontSize: 12,
                        fontFamily: 'var(--font-mono)', color: 'var(--ink-4)',
                      }}
                    >
                      Vis færre
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop sidebar — floats with the page so editing a rating far down the
            list doesn't require scrolling back up. Caps its height and scrolls
            internally so a tall form's save button stays reachable on short screens. */}
        {!isMobile && (
          <div className="col-4">
            <div style={{
              position: 'sticky', top: 16,
              display: 'flex', flexDirection: 'column', gap: 8,
              maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
            }}>
              <Card eyebrow={editId ? 'Rediger' : 'Ny rating'} title={editId ? 'Oppdater' : 'Legg til'}>
                <RatingForm
                  form={form} setForm={setForm} imageFile={imageFile} setImageFile={setImageFile}
                  categories={categories}
                  onSubmit={handleSubmit}
                  submitLabel={uploading ? 'Laster opp…' : editId ? 'Oppdater' : 'Legg til'}
                  isEdit={!!editId}
                  onCancelEdit={cancelEdit}
                />
              </Card>
              <StatsCard ratings={filtered} catFilter={cat} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
