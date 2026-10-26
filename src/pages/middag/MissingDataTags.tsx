import { Tag } from '../../components';
import { getMissingDataTags, MISSING_DATA_LABEL, type MissingDataTag } from '../../lib/missingData';

/**
 * Avledede varseltagger («mangler ingredienser» / «mangler oppskrift»). Egen
 * `missing`-stil så de ikke ligner brukertagger, og ingen fjern-/rediger-
 * knapp — de styres helt av dataene på oppskriften.
 */
export default function MissingDataTags({ recipe, only }: {
  recipe: Parameters<typeof getMissingDataTags>[0];
  only?: readonly MissingDataTag[];
}) {
  const missing = getMissingDataTags(recipe, only);
  if (missing.length === 0) return null;
  return (
    <>
      {missing.map(t => <Tag key={t} kind="missing">⚠ {MISSING_DATA_LABEL[t]}</Tag>)}
    </>
  );
}
