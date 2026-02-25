## Context

ECIT Acquisition Analysis er en intern webapplikasjon for a analysere potensielle oppkjopskandidater. Applikasjonen er under utvikling med en fungerende MVP:

**Navaerende tilstand:**
- React/Vite/TypeScript frontend, Node/Express API, PostgreSQL i Docker
- 8 databasetabeller, 21 API-endepunkter, 8 frontend-sider
- Grunnleggende flyt fungerer: selskaper -> modeller -> scenarier -> pro forma
- Deal returns, sources & uses, og accretion-analyse er implementert i frontend
- Import stotter JSON og CSV, men **ikke Excel (.xlsx)** som er ECIT sitt primaerformat
- Datamodellen dekker P&L og cash flow, men **mangler equity bridge** (aksjer, NIBD, EQV, MIP/TSO/warrants, per-aksje)
- Fargetema er Towerbrook-inspirert (plum/wine), ikke ECIT-profil (navy/cream)

**Referansedata:**
- Excel-testfil med to modellvarianter (Baseline/Ambitious) i ett ark, 2025-2029
- Inneholder full equity bridge med utvanningsberegninger
- Input-seksjon med fellesparametere (oppkjopsmultippel, aksjeandel, warrant strikes)

**Begrensninger:**
- Intern applikasjon, ikke eksternt eksponert
- Single-tenant i forste versjon (Docker Compose lokalt)
- Sensitive finansdata krever autentisering
- Brukere er ikke-tekniske (M&A-team, ledelse)

## Goals / Non-Goals

**Goals:**
- Stotte Excel-import som primaer datakilde, med automatisk gjenkjenning av modellstruktur
- Utvide datamodellen med full equity bridge (aksjer, NIBD, option debt, EQV, pref equity, MIP/TSO/warrants, per-aksje)
- ECIT-inspirert visuell profil (navy #03223F, cream #F4EDDC, accent blue #57A5E4)
- Presentasjonsklare visninger som kan vises direkte i moter
- Rask arbeidsflyt: last opp Excel -> se analyse -> del med teamet

**Non-Goals:**
- Automatisk IRR/MoM-beregning pa server (manuelt input i forste versjon)
- Real-time samarbeid / multi-user editing
- Eksport til PowerPoint/PDF (fremtidig feature)
- IFRS16-justeringer i modellen
- Direkte Excel-redigering i nettleseren
- Automatisk oppkjopsmultippel-beregning fra markedsdata

## Decisions

### 1. Excel-parsing: exceljs (ikke SheetJS/xlsx)

**Valg:** `exceljs` for server-side parsing av .xlsx-filer.

**Alternativer vurdert:**
- `SheetJS/xlsx`: Mer utbredt, men community-versjonen mangler skrivefunksjonalitet og har uklar lisens for kommersiell bruk
- `exceljs`: MIT-lisensiert, god TypeScript-stotte, stotter bade lesing og skriving, aktiv vedlikeholdt

**Rationale:** MIT-lisens, TypeScript-vennlig, tilstrekkelig for vart behov. Kan ogsa brukes til eventuell fremtidig eksport.

### 2. Modellstruktur-gjenkjenning: Monstbasert parsing

**Valg:** Parse Excel-filen rad-for-rad og gjenkjenn modellblokker basert pa navnekonvensjoner ("Name: ...Plan...").

**Tilnarming:**
1. Scan forste kolonne for "Name:"-rader som markerer start pa en modell
2. For hver modell: finn periodekolonner (arstal i header-rad), deretter map kjente radnavn til felter
3. Input-seksjon (rad 1-8) parses som fellesparametere for hele filen
4. Returnerer en array av modeller med perioder og metadata

**Alternativer vurdert:**
- Brukerdefinert mapping (bruker velger hvilke celler som mapper til hvilke felt): Mer fleksibelt, men mye mer komplekst UI og treigere arbeidsflyt
- Fast celleposisjon-mapping: For fragilt, bryter ved minste formatendring

**Rationale:** Balanse mellom fleksibilitet og enkelhet. Fungerer for ECIT sitt standard Excel-format. Validering viser bruker hva som ble tolket, sa de kan verifisere.

### 3. Equity bridge: Nye kolonner i financial_periods + model_parameters JSONB

**Valg:** Legg til dedikerte kolonner for de mest brukte verdsettelsesfelter, og bruk modell-nivaa JSONB for input-parametere.

**Nye kolonner pa financial_periods:**
```
share_count          NUMERIC(15,4)   -- Antall aksjer i perioden
nibd                 NUMERIC(15,1)   -- Net interest-bearing debt
option_debt          NUMERIC(15,1)   -- Option debt (incl Mgt Holding)
adjustments          NUMERIC(15,1)   -- Andre justeringer
enterprise_value     NUMERIC(15,1)   -- EV for perioden
equity_value         NUMERIC(15,1)   -- EQV
preferred_equity     NUMERIC(15,1)   -- Preferred equity belop
per_share_pre        NUMERIC(15,4)   -- Per share for MIP/TSO
mip_amount           NUMERIC(15,1)   -- MIP utvanning
tso_amount           NUMERIC(15,1)   -- TSO utvanning
warrants_amount      NUMERIC(15,1)   -- Existing warrants utvanning
eqv_post_dilution    NUMERIC(15,1)   -- EQV etter MIP/TSO/ExW
per_share_post       NUMERIC(15,4)   -- Per share etter utvanning
acquired_revenue     NUMERIC(15,1)   -- Oppkjopt revenue (MNOK)
```

**Nytt felt pa financial_models:**
```
model_parameters     JSONB           -- Input-parametere
```

`model_parameters` inneholder:
```json
{
  "shares_at_completion": 331.63,
  "shares_at_year_end": 356.10,
  "tso_warrants": { "count": 54.03, "strike": 10 },
  "mip_share_pct": 0.0559,
  "existing_warrants": { "count": 17.34, "strike": 7.31 },
  "acquisition_multiple": 10,
  "acquisition_share_pct": 0.10,
  "preferred_equity_rate": 0.0963
}
```

**Alternativer vurdert:**
- Alt i `extra_data` JSONB: Fleksibelt, men mister SQL-querybarhet og type-sikkerhet
- Egne tabeller for equity bridge: Over-normalisert for dette brukstilfellet
- Ny tabell `valuation_periods` separert fra `financial_periods`: Unodvendig kompleksitet, dataene horer naturlig sammen per periode

**Rationale:** Dedikerte kolonner for data som vises i tabeller og brukes i beregninger. JSONB for input-parametere som varierer mellom modeller og primart brukes som referanse.

### 4. Fargetema: CSS custom properties med ECIT-profil

**Valg:** Oppdater `:root` CSS-variabler og Tailwind-konfig til ECIT-farger.

```css
:root {
  --color-ecit-dark:     #03223F;   /* Navy - sidebar, headers */
  --color-ecit-navy:     #002C55;   /* Darker navy - hover, accents */
  --color-ecit-accent:   #57A5E4;   /* Sky blue - links, highlights */
  --color-ecit-cream:    #F4EDDC;   /* Warm cream - backgrounds */
  --color-ecit-light:    #FBF7EF;   /* Off-white - page bg */
  --color-ecit-positive: #22c55e;   /* Beholder - positivt delta */
  --color-ecit-negative: #ef4444;   /* Beholder - negativt delta */
}
```

**Alternativer vurdert:**
- Beholde Towerbrook-tema: Brukeren har eksplisitt bedt om ECIT-profil
- Mork tema (dark mode): Ikke prioritert, ECIT sin profil er light-based

### 5. Komponentstruktur: Dekomponere ScenarioDetailPage

**Valg:** Bryt opp ScenarioDetailPage (1528 linjer) i dedikerte komponenter.

```
components/
  scenario/
    ProFormaTable.tsx         -- Combined financial table
    DealReturnsMatrix.tsx     -- IRR/MoM editable grid
    CapitalStructure.tsx      -- Sources & uses + stacked bar
    AccretionAnalysis.tsx     -- Growth/margin comparison
    EbitdaChart.tsx           -- EBITDA evolution chart
    RevenueChart.tsx          -- Revenue comparison chart
    KeyMetricsCards.tsx       -- Top-level metric cards
    EquityBridgeTable.tsx     -- NEW: Aksjer, EQV, per-share
```

**Rationale:** ScenarioDetailPage er 46% av all side-kode. Dekomponering gir bedre vedlikeholdbarhet, testing, og gjenbruk. Hver komponent far sitt eget state-management der nodvendig.

### 6. Excel-import endpoint

**Valg:** Nytt API-endepunkt `POST /api/import/excel/:companyId` som:
1. Mottar .xlsx via multer
2. Parser med exceljs
3. Oppretter en eller flere financial_models for selskapet
4. Upsert-er perioder per modell
5. Returnerer oversikt over hva som ble importert

Pa modell-nivaa (ikke company) fordi en fil kan inneholde flere modeller for samme selskap. CompanyId brukes for a knytte modellene til riktig selskap.

**Alternativer vurdert:**
- Import pa modell-nivaa (som eksisterende JSON/CSV): Krever at bruker oppretter modeller manuelt forst, darliger UX for Excel med flere modeller i ett ark
- Frontend-parsing (client-side): Storre bundelstorrelse, vanskeligere validering

## Risks / Trade-offs

**[R1] Excel-format endres** -> Parsing kan brekke hvis ECIT endrer rad-rekkefolgje eller navnekonvensjoner. **Mitigering:** Validering med tydelig feilmelding om hva som ikke ble gjenkjent. Fallback til manuell felt-mapping i fremtidig versjon.

**[R2] Database-migrering** -> Nye kolonner pa financial_periods krever ALTER TABLE. **Mitigering:** Alle nye kolonner er nullable, sa eksisterende data forblir intakt. Legger til kolonner, fjerner ingen.

**[R3] Per-aksje beregninger er modellspesifikke** -> ECIT sin utvanningslogikk (MIP/TSO/warrants) kan vaere mer kompleks enn det vi modellerer. **Mitigering:** Vi importerer ferdigberegnede verdier fra Excel, ikke beregner selv. Modellen er en visningsmodell, ikke en beregningsmodell.

**[R4] Stor ScenarioDetailPage-refaktorering** -> Risk for regresjoner ved dekomponering. **Mitigering:** Trekk ut en komponent om gangen, verifiser i nettleser mellom hvert steg.

## Open Questions

1. **Skal vi stotte flere ark i en Excel-fil?** Testfilen har ett ark, men fremtidige filer kan ha flere (f.eks. P&L, Balance sheet, Cash flow i separate ark).

2. **Skal per-aksje-verdier vises i pro forma-visningen?** Combined pro forma har i dag bare revenue/EBITDA/FCF. Equity bridge for combined entity er mer kompleks (ulik aksjestruktur).

3. **Trenger vi versjonering av modeller?** Hvis bruker laster opp ny Excel, overskriver vi eksisterende modell eller oppretter ny versjon?
