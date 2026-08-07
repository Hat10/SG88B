// Kategoriforslag for NYE butikker (regex-heuristikk). Kun et forslag i UI-et —
// kategorien lagres på butikken og styres derfra etterpå.

// Innebygde kategorier (seed for categories-tabellen + fallback-etiketter).
// Flyttet hit fra api/import/categorize.ts da importen ble bygget om.
export const CATEGORY_LABELS: Record<string, string> = {
  dagligvarer: 'Dagligvarer',
  kiosk:       'Kiosk',
  kafé:        'Kafé & Restaurant',
  hjem:        'Hjem & Bygg',
  klær:        'Klær & Shopping',
  transport:   'Transport',
  abonnement:  'Abonnementer',
  forsikring:  'Forsikring',
  trening:     'Trening',
  velvære:     'Velvære',
  helse:       'Helse & Apotek',
  utdanning:   'Utdanning & læring',
  bolig:       'Bolig & Strøm',
  arrangement: 'Arrangementer',
  gambling:    'Gambling',
  reise:       'Reise',
  finans:      'Finans & Skatt',
  overføring:  'Overføring',
  inntekt:     'Inntekt',
  investering: 'Investering',
  annet:       'Annet',
};

const RULES: Array<[RegExp, string]> = [
  [/kiwi|rema\s*1000|\brema\b|\bmeny\b|coop|joker|\bspar\b|bunnpris|\bextra\b|\bobs\b(?!\s+bygg)|nærbutikk|matkroken|\bprix\b|kolonial|dagligvare|vinmonopolet/i, 'dagligvarer'],
  [/narvesen|7.?eleven|deli de luca|circle k|\bmix\b/i, 'kiosk'],
  [/kafé|cafe|kafe|restaurant|pizza|burger|sushi|deli\b|delikatesse|bakeri|bakehuset|espresso|kaffe|foodora|wolt|just eat|compass group|4service|\bmcd\b|mcdonald|max\s+burgers|\bsmak\b|peppes|egon\b/i, 'kafé'],
  [/maxbo|ikea|\bbiltema\b|clas ohl|jula\b|byggmak|bauhaus|obs\s+bygg|jernia|\bkid\b|culina|lampehuset|kremmerhuset|princess\b|søstrene grene|panduro|jysk|montér|obos.?butikken/i, 'hjem'],
  [/\bh&m\b|zara|weekday|cubus|jack & jones|vila\b|vero moda|bik bok|carlings|dressmann|\bxxl\b|stadium\b|anton\s+sport|volt\s+fashion|naturkompaniet|bergans|intersport|sport\s*1|\bnormal\b|second\s*hand|fretex|uff\b/i, 'klær'],
  [/entur|ruter\b|vy\s|vy\b|flytoget|\bnsb\b|kolumbus|\bhyre\b|bolt\b|uber|taxi|drosje|bysykkel|voi\b|tier\b|ryde\b|parkering|easypark|apcoa|onepark|bussekspress|flybuss|nor.?way/i, 'transport'],
  [/apple\.com|apple\b|spotify|netflix|hbo\b|viaplay|disney|google|adobe|dropbox|proton|openai|anthropic|claude|chatgpt|icloud|youtube|audible|storytel|bladkongen|aftenposten|\bvg\b|dagbladet|klassekampen|morgenbladet|tekna\b|webhuset|domene/i, 'abonnement'],
  [/gjensidige|if\s+forsikring|storebrand|tryg\b|fremtind|codan|frende|eika\s+forsikring/i, 'forsikring'],
  [/\bsio\b|athletica|fitness|elixia|\bevo\b|sats\b|treningssenter|vestkantbadet|isdrift|svømmehall|klatring|padel/i, 'trening'],
  [/frisør|barber|cutters|nikita|salong|\bspa\b|massasje|hudpleie|negl|solstudio|kicks\b|\bvita\b|sephora|rituals|\blush\b|body\s+shop|yves\s+rocher|parfyme/i, 'velvære'],
  [/apotek|boots\b|vitusapotek|sykehusapotek|diabetiker|diabetes|legesenter|legevakt|tannlege|fysioterap|kiropraktor|optiker|specsavers|brilleland|synsam/i, 'helse'],
  [/udemy|coursera|skillshare|pluralsight|masterclass|duolingo|babbel|folkeuniversitet|akademika|semesteravgift|studieavgift|kursavgift|universitet|høg?skole|\bntnu\b|\bnmbu\b/i, 'utdanning'],
  [/norsk\s+tipping|rikstoto|unibet|betsson|bet365|leovegas|comeon|casumo|coolbet|pokerstars|casino|betting|lotto\b|bingo\b/i, 'gambling'],
  [/sameiet|borettslag|fjordkraft|røros\s+strøm|tibber|hafslund|elvia|fortum|strøm\b|el\s+alliansen|eiendom\b|husleie|kommunale\s+avgifter|renovasjon|boliglån/i, 'bolig'],
  [/billettservice|ticketmaster|kino\b|konsert|teater|museum|festival|billett/i, 'arrangement'],
  [/hotell|hotel\b|airbnb|booking\.com|hotels\.com|expedia|norwegian\b|sas\b|widerøe|ryanair|klm\b|lufthansa|fjordline|color\s+line|dfds|hurtigruten|skistar|flyplass/i, 'reise'],
  [/skatteetaten|skatt\b|gebyr\b|renter\b|purregebyr|inkasso|nets\b|buypass/i, 'finans'],
  [/fondskonto|aksjefond|indeksfond|aksjesparekonto|\bkron\b|nordnet|utbytte/i, 'investering'],
];

export function suggestCategory(text: string): string {
  for (const [re, cat] of RULES) {
    if (re.test(text)) return cat;
  }
  return 'annet';
}
