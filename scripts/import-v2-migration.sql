-- ═══════════════════════════════════════════════════════════════════════════
-- IMPORT V2 — kjøres i Supabase SQL editor.
--
-- ⚠ DESTRUKTIVT (avtalt): sletter ALLE transaksjoner og importlogger for en
-- ren start. Butikknavn+kategorier fra dagens `merchants` beholdes som seed.
-- Etterpå re-importeres kontoutskriftene gjennom den nye importfanen.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) Riv gamle transaksjonstabeller ────────────────────────────────────────
drop table if exists transactions;
drop table if exists finance_imports;
drop table if exists merchant_rules;

-- Behold gamle butikker midlertidig som seed-kilde
alter table if exists merchants rename to merchants_legacy;

-- ── 2) Nye tabeller ──────────────────────────────────────────────────────────

create table merchants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text not null default 'annet',
  -- merchant: vanlig butikk · person: privatperson (P2P) · internal: egen konto/
  -- kortflytting · settlement: kredittkortregning (dekkes av kortets import) ·
  -- intermediary: betalingsformidler (Vipps/Klarna) — navngis per transaksjon
  kind       text not null default 'merchant'
             check (kind in ('merchant','person','internal','settlement','intermediary')),
  created_at timestamptz default now()
);
create unique index merchants_name_uniq on merchants ((lower(name)));

-- Læringstabellen: normalisert banktekst → butikk. Hver bekreftelse i
-- importgjennomgangen skriver én rad her; neste import treffer automatisk.
create table merchant_aliases (
  alias       text primary key,
  merchant_id uuid not null references merchants(id) on delete cascade,
  created_at  timestamptz default now()
);
create index merchant_aliases_merchant_idx on merchant_aliases (merchant_id);

create table finance_imports (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,          -- 'bank_M' | 'bank_L' | 'trumf'
  month         text not null,          -- '2026-06' (dominerende måned)
  filename      text,
  file_hash     text,                   -- sha-256 av filbytes — varsler eksakt re-import
  row_count     int,                    -- importerte rader
  skipped_count int,                    -- utelatte rader (interne, duplikater, …)
  imported_at   timestamptz default now()
);

create table transactions (
  id                 uuid primary key default gen_random_uuid(),
  import_id          uuid references finance_imports(id) on delete cascade,
  date               date not null,
  description        text not null,     -- butikknavn (denormalisert for visning)
  merchant_id        uuid references merchants(id) on delete set null,
  amount             numeric not null,  -- negativ = utgift, positiv = inn
  source             text not null,     -- 'bank_M' | 'bank_L' | 'trumf' | 'felles'
  category           text not null default 'annet',
  category_confirmed boolean default false,
  kind               text not null default 'purchase'
                     check (kind in ('purchase','refund','income','investment','internal','card_settlement','p2p')),
  month              text not null,     -- '2026-06'
  raw_description    text,              -- bankens originaltekst — røres aldri
  note               text,
  meta               jsonb,             -- kjøpstid, valuta/kurs, kanal, referanser …
  fingerprint        text               -- dato|beløp|råtekst-hash til duplikatsjekk
);
create index transactions_month_idx       on transactions (month);
create index transactions_source_idx      on transactions (source);
create index transactions_fingerprint_idx on transactions (fingerprint);
create index transactions_merchant_idx    on transactions (merchant_id);

-- ── 3) Tilganger (samme mønster som resten av appen) ─────────────────────────
grant select, insert, update, delete on public.merchants        to authenticated;
grant select, insert, update, delete on public.merchant_aliases to authenticated;
grant select, insert, update, delete on public.finance_imports  to authenticated;
grant select, insert, update, delete on public.transactions     to authenticated;

alter table merchants        enable row level security;
alter table merchant_aliases enable row level security;
alter table finance_imports  enable row level security;
alter table transactions     enable row level security;

create policy "authenticated_merchants"        on merchants        for all using (auth.role() = 'authenticated');
create policy "authenticated_merchant_aliases" on merchant_aliases for all using (auth.role() = 'authenticated');
create policy "authenticated_finance_imports"  on finance_imports  for all using (auth.role() = 'authenticated');
create policy "authenticated_transactions"     on transactions     for all using (auth.role() = 'authenticated');

-- ── 4) Seed: gamle butikker (navn + kategori dere allerede har kuratert) ─────
insert into merchants (name, category)
select distinct on (lower(trim(name))) trim(name), category
from merchants_legacy
where trim(coalesce(name, '')) <> ''
on conflict ((lower(name))) do nothing;

-- Gamle nøkler blir aliaser, så eksisterende mappinger fortsatt treffer
insert into merchant_aliases (alias, merchant_id)
select lower(trim(l.key)), m.id
from merchants_legacy l
join merchants m on lower(m.name) = lower(trim(l.name))
where trim(coalesce(l.key, '')) <> ''
on conflict (alias) do nothing;

drop table merchants_legacy;

-- ── 5) Seed: kjente kjeder og aktører (fuzzy-forslag matcher mot navnene) ────
insert into merchants (name, category, kind) values
  -- Dagligvarer
  ('Kiwi','dagligvarer','merchant'), ('Rema 1000','dagligvarer','merchant'),
  ('Coop Mega','dagligvarer','merchant'), ('Coop Extra','dagligvarer','merchant'),
  ('Coop Prix','dagligvarer','merchant'), ('Coop Obs!','dagligvarer','merchant'),
  ('Coop Marked','dagligvarer','merchant'), ('Meny','dagligvarer','merchant'),
  ('Joker','dagligvarer','merchant'), ('Bunnpris','dagligvarer','merchant'),
  ('Spar','dagligvarer','merchant'), ('Obs!','dagligvarer','merchant'),
  ('Nærbutikken','dagligvarer','merchant'), ('Matkroken','dagligvarer','merchant'),
  ('Torggata Kolonial','dagligvarer','merchant'), ('Vinmonopolet','dagligvarer','merchant'),
  ('Scanasia','dagligvarer','merchant'), ('Schouterrassen','dagligvarer','merchant'),
  -- Kiosk
  ('Narvesen','kiosk','merchant'), ('7-Eleven','kiosk','merchant'),
  ('Deli de Luca','kiosk','merchant'), ('Circle K','kiosk','merchant'),
  -- Kafé & restaurant
  ('McDonald''s','kafé','merchant'), ('Max Burgers','kafé','merchant'),
  ('Foodora','kafé','merchant'), ('Wolt','kafé','merchant'), ('Just Eat','kafé','merchant'),
  ('4service','kafé','merchant'), ('Compass Group','kafé','merchant'),
  ('Jacobs','kafé','merchant'), ('Smak Carl Berner','kafé','merchant'),
  ('Tupolski','kafé','merchant'), ('Hunger','kafé','merchant'),
  -- Hjem & bygg
  ('Maxbo','hjem','merchant'), ('Clas Ohlson','hjem','merchant'), ('IKEA','hjem','merchant'),
  ('Biltema','hjem','merchant'), ('Jula','hjem','merchant'), ('Bauhaus','hjem','merchant'),
  ('Byggmakker','hjem','merchant'), ('Jernia','hjem','merchant'), ('Obs Bygg','hjem','merchant'),
  ('Coop Byggmix','hjem','merchant'), ('KID Interiør','hjem','merchant'),
  ('Culina','hjem','merchant'), ('Normal','hjem','merchant'), ('Thorstensen','hjem','merchant'),
  -- Klær & sport
  ('H&M','klær','merchant'), ('Zara','klær','merchant'), ('Weekday','klær','merchant'),
  ('Cubus','klær','merchant'), ('XXL','klær','merchant'), ('Stadium','klær','merchant'),
  ('Anton Sport','klær','merchant'), ('Naturkompaniet','klær','merchant'),
  ('Volt Fashion','klær','merchant'), ('M&E Second Hand','klær','merchant'), ('Bergans','klær','merchant'),
  -- Transport
  ('Entur','transport','merchant'), ('Ruter','transport','merchant'), ('Vy','transport','merchant'),
  ('Flytoget','transport','merchant'), ('Hyre','transport','merchant'),
  ('Nor-Way Bussekspress','transport','merchant'),
  -- Abonnementer
  ('Apple','abonnement','merchant'), ('Spotify','abonnement','merchant'),
  ('Netflix','abonnement','merchant'), ('HBO','abonnement','merchant'),
  ('Viaplay','abonnement','merchant'), ('Google','abonnement','merchant'),
  ('Adobe','abonnement','merchant'), ('Dropbox','abonnement','merchant'),
  ('Proton','abonnement','merchant'), ('Anthropic','abonnement','merchant'),
  ('Bladkongen','abonnement','merchant'), ('Tekna','abonnement','merchant'),
  ('Webhuset','abonnement','merchant'),
  -- Arrangementer
  ('Billettservice','arrangement','merchant'), ('Forsvarsmuseet','arrangement','merchant'),
  -- Trening
  ('SiO Athletica','trening','merchant'), ('SiO','trening','merchant'),
  ('Fresh Fitness','trening','merchant'), ('EVO','trening','merchant'),
  ('Elixia','trening','merchant'), ('Vestkantbadet','trening','merchant'),
  ('Valle Isdrift','trening','merchant'),
  -- Velvære
  ('Cutters','velvære','merchant'), ('Nikita Hair','velvære','merchant'),
  ('Adam og Eva','velvære','merchant'), ('Kicks','velvære','merchant'),
  ('Vita','velvære','merchant'), ('Sephora','velvære','merchant'),
  ('Rituals','velvære','merchant'), ('Lush','velvære','merchant'),
  ('The Body Shop','velvære','merchant'), ('Yves Rocher','velvære','merchant'),
  -- Helse
  ('Apotek 1','helse','merchant'), ('Vitusapotek','helse','merchant'),
  ('Boots','helse','merchant'), ('Sykehusapoteket','helse','merchant'),
  ('Diabetikersenteret','helse','merchant'), ('Diabetesforbundet','helse','merchant'),
  -- Utdanning
  ('Udemy','utdanning','merchant'), ('Coursera','utdanning','merchant'),
  ('Skillshare','utdanning','merchant'), ('Pluralsight','utdanning','merchant'),
  ('MasterClass','utdanning','merchant'), ('Duolingo','utdanning','merchant'),
  ('Babbel','utdanning','merchant'), ('Folkeuniversitetet','utdanning','merchant'),
  ('Akademika','utdanning','merchant'),
  -- Gambling
  ('Norsk Tipping','gambling','merchant'), ('Norsk Rikstoto','gambling','merchant'),
  ('Unibet','gambling','merchant'), ('Betsson','gambling','merchant'),
  ('Bet365','gambling','merchant'), ('LeoVegas','gambling','merchant'),
  ('ComeOn','gambling','merchant'), ('Casumo','gambling','merchant'),
  ('Coolbet','gambling','merchant'), ('PokerStars','gambling','merchant'),
  -- Bolig & strøm
  ('Sameiet Olaf Schous Vei 12-18','bolig','merchant'), ('Ren Røros Strøm','bolig','merchant'),
  ('Fjordkraft','bolig','merchant'), ('Munkholmen Eiendom','bolig','merchant'),
  ('El Alliansen','bolig','merchant'), ('Boliglån','bolig','merchant'),
  -- Forsikring
  ('Gjensidige','forsikring','merchant'), ('If Forsikring','forsikring','merchant'),
  ('Storebrand','forsikring','merchant'),
  -- Finans & skatt
  ('DNB','finans','merchant'), ('Storebrand Bank','finans','merchant'),
  ('Buypass','finans','merchant'), ('Skatteetaten','finans','merchant'),
  -- Investering
  ('Kron','investering','merchant'), ('Nordnet','investering','merchant'),
  ('Tomra','investering','merchant'),
  -- Reise
  ('SkiStar','reise','merchant'), ('Norwegian','reise','merchant'), ('SAS','reise','merchant'),
  -- Inntektskilder
  ('Netcompany','inntekt','merchant'), ('Statens Lånekasse','inntekt','merchant'),
  ('Nav','inntekt','merchant'), ('Trumf AS','inntekt','merchant'),
  -- Annet
  ('FINN.no','annet','merchant'), ('Posten','annet','merchant'),
  -- Interne (flytting mellom egne kontoer — auto-utelates)
  ('Revolut','overføring','internal'), ('Intern overføring','overføring','internal'),
  -- Kortoppgjør (regningen dekkes av kortets egen import — auto-utelates)
  ('Norgesgruppen Finans','finans','settlement'), ('Kredittbanken','finans','settlement'),
  ('Morrow Bank','finans','settlement'),
  -- Betalingsformidlere (butikken bak navngis per transaksjon)
  ('Vipps','annet','intermediary'), ('Klarna','annet','intermediary'),
  ('PayPal','annet','intermediary'), ('MobilePay','annet','intermediary'),
  ('Apple Pay','annet','intermediary'), ('Google Pay','annet','intermediary'),
  ('SumUp','annet','intermediary'), ('Adyen','annet','intermediary'),
  ('Trustly','annet','intermediary')
on conflict ((lower(name))) do nothing;

-- Tving riktig kind selv om navnet fantes fra før i gamle merchants
update merchants set kind = 'intermediary'
  where lower(name) in ('vipps','klarna','paypal','mobilepay','apple pay','google pay','sumup','adyen','trustly');
update merchants set kind = 'settlement'
  where lower(name) in ('norgesgruppen finans','kredittbanken','morrow bank');
update merchants set kind = 'internal'
  where lower(name) in ('revolut','intern overføring');

-- ── 6) Seed: aliaser som gjør de kjente mønstrene til EKSAKTE treff ──────────
insert into merchant_aliases (alias, merchant_id)
select v.alias, m.id
from (values
  -- Egne navn → intern flytting (overføringer mellom deres kontoer)
  ('jo mikkel nysæther ofrim',            'intern overføring'),
  ('leah kristoffersen larsen',           'intern overføring'),
  ('kontoregulering',                     'intern overføring'),
  -- Kredittkortoppgjør sett i ekte DNB-data
  ('norgesgruppen finans as',             'norgesgruppen finans'),
  ('norgesgruppen trumf',                 'norgesgruppen finans'),
  ('innbetaling trumf',                   'norgesgruppen finans'),
  -- Faste motparter fra ekte data
  ('boliglån',                            'boliglån'),
  ('netcompany norway as',                'netcompany'),
  ('statens lånekasse for utdanning',     'statens lånekasse'),
  ('nav',                                 'nav'),
  ('compass group norge as',              'compass group'),
  ('sameiet olaf schous vei 12-18',       'sameiet olaf schous vei 12-18'),
  -- Betalingsformidlere (Revolut-eksporten bruker bare «Vipps» o.l.)
  ('vipps',                               'vipps'),
  ('klarna',                              'klarna'),
  ('paypal',                              'paypal')
) as v(alias, merchant_name)
join merchants m on lower(m.name) = v.merchant_name
on conflict (alias) do nothing;

commit;
