// Kategorisering av handlelistevarer — delt mellom kategori-heuristikken
// (MatplanContext.tsx, kjøres når en grocery_items-rad opprettes) og
// Handlemodus-visningen (pages/middag/ShoppingMode.tsx), som grupperer varene
// under disse overskriftene. Rekkefølgen her ER visningsrekkefølgen i
// Handlemodus — «Annet» ligger bevisst sist, som fallback-bøtte for varer
// ingen nøkkelord traff.
export const GROCERY_CATEGORIES = [
  'Frukt & grønt',
  'Meieri, egg & kjølevarer',
  'Brød & bakervarer',
  'Tørrvarer',
  'Vegetar',
  'Pålegg',
  'Frysevarer',
  'Drikke',
  'Husholdning',
  'Rengjøring',
  'Annet',
] as const;

export type GroceryCategory = (typeof GROCERY_CATEGORIES)[number];

export const CATEGORY_EMOJI: Record<GroceryCategory, string> = {
  'Frukt & grønt': '🥦',
  'Meieri, egg & kjølevarer': '🥛',
  'Brød & bakervarer': '🍞',
  'Tørrvarer': '🥫',
  'Vegetar': '🌱',
  'Pålegg': '🥪',
  'Frysevarer': '🧊',
  'Drikke': '🥤',
  'Husholdning': '🧻',
  'Rengjøring': '🧽',
  'Annet': '🛒',
};

// Nøkkelord per kategori — delvis (substring), case-insensitiv match mot
// varenavnet. «Meieri, egg & kjølevarer» dekker bevisst også fersk kjøtt/fisk
// (samme kjøledisk i butikken), siden det ikke finnes noen egen Kjøtt & fisk-
// kategori i denne lista. «Pålegg» holder seg bevisst til spesifikke
// pålegg-ord (skinke, leverpostei, syltetøy, ...) — IKKE ost/brunost/geitost,
// som fanges av det generiske «ost»-ordet i Meieri-lista i stedet (se
// guessCategory() under for hvorfor rekkefølgen på kategoriene ikke er det
// som avgjør en kollisjon).
const CATEGORY_KEYWORDS: Record<Exclude<GroceryCategory, 'Annet'>, string[]> = {
  'Frukt & grønt': [
    'eple', 'pære', 'banan', 'appelsin', 'sitron', 'lime', 'drue', 'mango', 'ananas', 'kiwi',
    'avokado', 'tomat', 'agurk', 'salat', 'spinat', 'paprika', 'løk', 'hvitløk', 'gulrot',
    'potet', 'brokkoli', 'blomkål', 'squash', 'sopp', 'chili', 'ingefær', 'mais', 'selleri',
    'purre', 'rødbet', 'melon', 'bær', 'jordbær', 'bringebær', 'blåbær', 'basilikum',
    'persille', 'koriander', 'mynte', 'gressløk', 'rucola', 'isbergsalat', 'vårløk',
  ],
  'Meieri, egg & kjølevarer': [
    'melk', 'yoghurt', 'yogurt', 'rømme', 'fløte', 'smør', 'margarin', 'ost', 'egg', 'kesam',
    'cottage cheese', 'kremfløte', 'kefir', 'skyr', 'crème fraîche', 'kjøttdeig',
    'kylling', 'laks', 'torsk', 'biff', 'svinekjøtt', 'bacon', 'pølse', 'reker', 'makrell',
    'ørret', 'lammekjøtt', 'kalkun', 'indrefilet', 'entrecote', 'karbonade', 'sjømat',
    'kjøttboller', 'fiskeboller', 'fiskepinner', 'tunfisk',
  ],
  'Brød & bakervarer': [
    'brød', 'rundstykker', 'loff', 'knekkebrød', 'bagel', 'baguette', 'boller', 'kake',
    'kjeks', 'mel', 'gjær', 'bakepulver', 'vaniljesukker', 'hvetemel', 'rugmel', 'lefse',
    'wraps', 'tortilla', 'pizzabunn', 'pitabrød', 'croissant',
  ],
  'Tørrvarer': [
    'ris', 'pasta', 'spaghetti', 'nudler', 'sukker', 'salt', 'pepper', 'krydder', 'olje',
    'eddik', 'saus', 'ketchup', 'sennep', 'hermetikk', 'bønner', 'kokosmelk', 'buljong',
    'havregryn', 'müsli', 'nøtter', 'mandler', 'peanøtter', 'tørket frukt', 'honning',
    'sjokolade', 'kakao',
  ],
  'Vegetar': [
    'tofu', 'tempeh', 'falafel', 'hummus', 'vegetarburger', 'veggisdeig', 'plantebasert',
    'soyakjøtt', 'quorn', 'seitan', 'linser', 'kikerter',
  ],
  'Pålegg': [
    'skinke', 'salami', 'servelat', 'leverpostei', 'kaviar', 'syltetøy', 'majones',
    'peanøttsmør', 'nugatti', 'sjokoladepålegg', 'makrell i tomat',
  ],
  'Frysevarer': ['frossen', 'fryst', 'iskrem', 'fryseboks'],
  'Drikke': ['juice', 'brus', 'cola', 'saft', 'vann', 'mineralvann', 'øl', 'vin', 'kaffe', 'te'],
  'Husholdning': [
    'dopapir', 'tørkepapir', 'tannkrem', 'tannbørste', 'shampoo', 'sjampo', 'såpe',
    'deodorant', 'bleier', 'våtservietter', 'søppelsekk', 'folie', 'bakepapir', 'lys', 'batteri',
  ],
  'Rengjøring': [
    'oppvaskmiddel', 'vaskemiddel', 'rengjøringsmiddel', 'oppvaskbørste', 'klorin',
    'vindusspray', 'skuremiddel', 'allrent', 'vaskepulver', 'tøymykner',
    'oppvasktabletter', 'mikrofiberklut', 'svamp', 'kluter',
  ],
};

// Delvis-match kan i prinsippet gi flere treff for samme varenavn (f.eks.
// «vin» i Drikke er en substring av «vindusspray» i Rengjøring) — det
// LENGSTE matchende nøkkelordet vinner, på tvers av alle kategorier, ikke
// bare det første som treffer i kategori-rekkefølgen. Det løser slike
// kollisjoner uten å måtte holde nøkkelordlistene manuelt fri for enhver
// substring-overlapp: en mer spesifikk (lengre) match slår alltid en mer
// generisk (kortere) en.
export function guessCategory(name: string): GroceryCategory | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;

  let best: { category: GroceryCategory; length: number } | null = null;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [GroceryCategory, string[]][]) {
    for (const kw of keywords) {
      if (lower.includes(kw) && (!best || kw.length > best.length)) {
        best = { category, length: kw.length };
      }
    }
  }
  return best?.category ?? null;
}
