import HandlelisteCard from './middag/HandlelisteCard';

// Eget menypunkt for handlelisten — viser nøyaktig samme komponent (og
// dermed samme sanntidsdata) som Dagligvarer-fanen på Middag-siden. Se
// HandlelisteCard.tsx for hvorfor de to stedene alltid er synkroniserte.
export default function PageHandleliste() {
  return (
    <div className="grid grid-12">
      <div className="col-12"><HandlelisteCard /></div>
    </div>
  );
}
