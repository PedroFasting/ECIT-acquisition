## Why

ECIT trenger et internt verktoy for a analysere potensielle oppkjopskandidater raskt og visuelt. I dag gjores dette i regneark og PowerPoint, noe som er tidkrevende, feilutsatt og vanskelig a dele. Malet er en webapplikasjon der man kan laste opp budsjettmodeller (fra Excel), se selskaper sammen i pro forma-visning, kjore ulike scenarier, og produsere presentasjonsklare analyser - uten a matte bygge slides manuelt.

## What Changes

- **Excel-import**: Last opp budsjettmodeller direkte fra Excel (.xlsx). Filen kan inneholde flere modellvarianter i samme ark (f.eks. "Baseline Plan" og "Ambitious Plan"), og systemet parser strukturen automatisk. Stotter ogsa JSON/CSV.
- **Verdsettelsesmodell**: Utover P&L og cash flow, stotte for full equity bridge: antall aksjer, NIBD, option debt, EQV, preferred equity (PIK), MIP/TSO/warrants-utvanning, og per-aksje-beregninger. Dette reflekterer slik ECIT faktisk modellerer internt.
- **Selskapsvisning**: Se grunndata for hvert selskap - revenue, EBITDA, marginer, vekst, oppkjopt revenue, NIBD, EQV og per-aksje - i tabellformat med perioder som kolonner
- **Flere modellvarianter**: Hvert selskap kan ha flere modeller (Baseline, Ambitious, Management case, Sellside case, Post DD case osv.) som kan sammenlignes
- **Pro forma-kombinering**: Automatisk sammenslaning av oppkjoper + target til combined pro forma-tall, matchet pa perioder
- **Scenarioanalyse**: Opprett scenarier som kobler en oppkjoper-modell med en target-modell. Hvert scenario inneholder deal returns (IRR/MoM-matrise), kapitalstruktur (sources & uses), og accretion-analyse
- **Deal returns**: IRR/MoM-matrise med konfigurerbare cases og exit-multipler, delta-beregning mot standalone, fargekoding
- **Kapitalstruktur**: Sources & uses-tabeller, visuell stacked bar chart med ordinary equity / preferred equity / net debt
- **Accretion-analyse**: Sammenligning av organisk vekst og EBITDA-marginer mellom target og oppkjoper, standalone vs pro forma
- **Presentasjonsklar visning**: Profesjonelt utseende med ECIT-inspirert fargetema (navy blue #03223F / #002C55, warm cream #F4EDDC / #FBF7EF, accent blue #57A5E4), klar for skjermdeling eller eksport
- **Autentisering**: Login med JWT, sensitiv finansdata krever tilgangskontroll
- **Persistens**: PostgreSQL-database i Docker, data overlever omstart

## Reference Data

Testfil: `Div filer/ECIT - Modell for sammenlikning oppkjop TEST.xlsx`

Filen inneholder to modeller i ett ark med folgende struktur:

**Input-seksjon (felles):**
- Number of ordinary shares (completion + 31.12.25)
- TSO warrants (antall + strike price)
- MIP share %, Existing warrants (antall + strike)
- Acquired companies multiple, Acquired with shares %

**Per modell (Baseline Plan / Ambitious Plan), perioder 2025-2029:**
- Number of shares (utvides arlig pga oppkjop med aksjer)
- Organic growth %, Acquired revenue (MNOK)
- Revenue, EBITDA, EBITDA %
- NIBD (incl various), Option debt (incl Mgt Holding)
- Adjustments, EV, EQV
- Preferred equity (med PIK-rente ~9.6%)
- Per share (before MIP & TSO)
- MIP, TSO, Existing warrants (utvanningsbelop)
- EQV (post MIP, TSO, ExW), Per share (post MIP, TSO, ExW)

## Capabilities

### New Capabilities
- `excel-import`: Parsing av .xlsx-filer med flere modellvarianter i samme ark, automatisk gjenkjenning av modellstruktur, mapping av rader til felt, stotte for input-seksjoner med fellesparametere
- `data-import`: Import av finansielle modeller fra JSON/CSV som alternativ til Excel, validering og feilhandtering
- `financial-models`: CRUD for selskaper og finansielle modeller med periodedata (revenue, EBITDA, marginer, cash flow, vekstrater)
- `valuation-model`: Utvidet datamodell med equity bridge: antall aksjer, NIBD, option debt, EQV, preferred equity (PIK-rente), MIP/TSO/warrants-utvanning, per-aksje verdier for/etter utvanning. Fellesparametere som oppkjopsmultippel og aksjeandel
- `pro-forma-engine`: Automatisk generering av combined pro forma-perioder fra oppkjoper + target, med synergistotte
- `scenario-management`: Opprettelse og administrasjon av oppkjopsscenarier med deal-parametere (pris, EV, kapitalstruktur)
- `deal-returns`: IRR/MoM-matrise med flere cases, exit-multipler, delta-beregning mot standalone-referanse
- `capital-structure`: Sources & uses-modell, kapitalstruktur-visualisering (stacked bar), preferred/ordinary equity og net debt
- `accretion-analysis`: Sammenligning av target vs oppkjoper pa vekst og marginer, standalone vs pro forma visualisering
- `presentation-views`: Profesjonelle, presentasjonsklare visninger av alle analyser med ECIT-inspirert tema og layout

### Modified Capabilities
<!-- Ingen eksisterende capabilities a modifisere - dette er forste versjon -->

## Impact

- **Backend**: Node/Express API med full REST-grensesnitt, PostgreSQL-database (skjema ma utvides med nye felter for equity bridge)
- **Frontend**: React + Vite + TypeScript SPA med Recharts for grafer, Tailwind CSS for styling
- **Infrastruktur**: Docker Compose for database, dev-servere for API (port 3001) og klient (port 5173)
- **Sikkerhet**: JWT-autentisering, bcrypt for passord, CORS-konfigurasjon
- **Avhengigheter**: recharts, lucide-react, csv-parse, multer, pg, jsonwebtoken, bcryptjs, **xlsx/exceljs** (ny - for Excel-parsing)
- **Database-endringer**: financial_periods trenger nye kolonner (share_count, nibd, option_debt, eqv, preferred_equity, per_share_pre_dilution, per_share_post_dilution, mip_amount, tso_amount, warrants_amount). Ny tabell eller JSON-felt for modell-input-parametere (oppkjopsmultippel, aksjeandel, warrant strikes)
- **Data**: Finansielle modeller med historiske og forecast-perioder, verdsettelsesdata med equity bridge, oppkjopsscenarier med deal returns og pro forma
