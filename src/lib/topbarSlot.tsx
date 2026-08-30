import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Lar en lazy-lastet side portalere innhold inn i den sticky toppbaren i
// App.tsx (raden med «felles / <side>»-brødsmulestien) — først brukt av
// Trening for å flytte Felles/Andreas/Taran-fanene og «Registrer økt» dit i
// stedet for en egen rad under sidetittelen. Egen, liten fil i stedet for i
// App.tsx selv, slik at en side som bruker den ikke drar med seg hele
// App.tsx-modulen inn i sin egen chunk (se App.tsx sin kommentar om at hver
// side skal lastes som sin egen, slanke chunk).
const TopbarSlotContext = createContext<HTMLDivElement | null>(null);
export const TopbarSlotProvider = TopbarSlotContext.Provider;

export function TopbarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}
