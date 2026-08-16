// Etter en ny deploy peker en allerede-åpen fane fortsatt på gamle,
// hash-navngitte chunk-filer i minnet (React.lazy-importene i App.tsx) — de
// finnes ikke lenger på serveren, siden den nye deployen bare har de nye
// hashene. Et forsøk på å laste en slik chunk (typisk ved navigasjon til en
// side som ikke er besøkt siden fanen ble åpnet) feiler da med en
// nettleser-spesifikk feilmelding. En full sideoppdatering henter riktig
// index.html + chunk-referanser på nytt og løser det helt av seg selv — det
// er derfor trygt å automatisere, i motsetning til service worker-oppdatering
// (se ServiceWorkerUpdater i App.tsx), der SIDEN SOM ALLEREDE VISES fortsatt
// fungerer fint og vi bevisst lar brukeren velge tidspunkt selv.
const STALE_CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chrome/Edge
  /error loading dynamically imported module/i,   // Firefox
  /importing a module script failed/i,            // Safari
];

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return STALE_CHUNK_PATTERNS.some(p => p.test(message));
}

const RELOAD_GUARD_KEY = 'felles_stale_chunk_reload';

/**
 * Prøver én automatisk sideoppdatering per fane-økt for en stale chunk-
 * referanse. Returnerer true hvis den faktisk trigget en reload (kalleren
 * trenger ikke vise noen feil da — siden er på vei ut uansett), false hvis
 * vi allerede har prøvd én gang denne økten uten at det løste seg — da er
 * det trolig et ekte problem (reelt offline, eller en ødelagt deploy), og vi
 * vil ikke risikere en uendelig reload-løkke ved å prøve på nytt.
 *
 * sessionStorage (ikke en modul-variabel) fordi selve reload()-et nullstiller
 * alt JS-minne — en vanlig variabel ville "glemt" at vi allerede har prøvd,
 * og løkken ville aldri stoppet.
 */
export function recoverFromStaleChunk(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    // sessionStorage utilgjengelig (f.eks. privat nettlesing) — prøv reload
    // uansett, uten løkke-vern; bedre enn å aldri prøve i det hele tatt.
  }
  window.location.reload();
  return true;
}

// Vite sin egen, dedikerte hendelse for akkurat dette — dispatches når en
// <link rel="modulepreload"> (som Vite auto-injiserer for hver React.lazy-
// side) feiler. Dekker navigasjon FØR feilen når helt frem til en React
// ErrorBoundary (se der for det andre laget av samme vern, for tilfeller som
// ikke går via modulepreload).
export function installStaleChunkRecovery() {
  window.addEventListener('vite:preloadError', (event: Event) => {
    event.preventDefault();
    recoverFromStaleChunk();
  });
}
