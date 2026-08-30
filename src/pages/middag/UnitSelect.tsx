import { INGREDIENT_UNITS } from '../../contexts/MatplanContext';

// Delt mellom oppskrift-editoren (OppskrifterTab) og «Legg til kjøpsfrekvens»
// i StapleManager (nå på Handleliste-siden, src/pages/Handleliste.tsx) —
// samme nedtrekksmeny for enhet. Trukket ut hit etter at Enhet-plassholderens
// disabled/hidden-fiks (den skal aldri være et valgbart alternativ i selve
// den nedfelte listen, kun grå plasshoildertekst før noe er valgt) først bare
// ble gjort i det ene av de to stedene den fantes — én komponent betyr den
// typen fiks nå kun trengs én gang, ikke én gang per skjema.
export default function UnitSelect({ value, onChange, style }: {
  value: string; onChange: (unit: string) => void; style?: React.CSSProperties;
}) {
  // Frittekst-enheter fra før nedtrekksmenyen fantes (f.eks. «Liter») matcher
  // kanskje ikke noen av de faste valgene — vis den som et ekstra valg i
  // stedet for å la den stille forsvinne til tomt ved redigering.
  const options: readonly string[] = value && !(INGREDIENT_UNITS as readonly string[]).includes(value)
    ? [value, ...INGREDIENT_UNITS] : INGREDIENT_UNITS;
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value)} style={style}>
      <option value="" disabled hidden>Enhet</option>
      {options.map(u => <option key={u} value={u}>{u}</option>)}
    </select>
  );
}
