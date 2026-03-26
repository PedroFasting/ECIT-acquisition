# ECIT Acquisition Analysis

Analyseverktoy for oppkjop — modellering av finansielle scenarier, pro forma-analyser, deal returns (IRR/MoM), og sensitivitetsanalyser.

## Tech Stack

| Lag       | Teknologi                                                        |
|-----------|------------------------------------------------------------------|
| Frontend  | React 19, React Router 7, Vite 7, TailwindCSS 4, Recharts       |
| Backend   | Express 5, TypeScript 5, Zod 4                                   |
| Database  | PostgreSQL 16                                                    |
| Runtime   | Node.js 22                                                       |
| Testing   | Vitest 4, Testing Library                                        |

## Kom i gang

### Med Docker (anbefalt)

```bash
docker compose up --build
```

Apne [http://localhost:5173](http://localhost:5173). Logg inn med `admin@ecit.no` og sett passord (min. 8 tegn) ved forste innlogging.

### Uten Docker

Forutsetninger: Node.js 22+, PostgreSQL kjorende pa port 5433.

```bash
# Start kun databasen via Docker
docker compose up db

# Server (ny terminal)
cd server
npm install
npm run dev

# Client (ny terminal)
cd client
npm install
npm run dev
```

Server kjorer pa [http://localhost:3001](http://localhost:3001), client pa [http://localhost:5173](http://localhost:5173).

## Miljovariabler

Settes i `docker-compose.yml` for Docker-oppsett. For lokal utvikling:

| Variabel       | Standard                          | Beskrivelse              |
|----------------|-----------------------------------|--------------------------|
| `DATABASE_URL` | `postgresql://ecit:ecit_dev_2026@localhost:5433/ecit_acquisition` | PostgreSQL connection string |
| `JWT_SECRET`   | `dev-secret-do-not-use-in-prod`   | JWT-signeringsnokkel (ma settes i prod) |
| `NODE_ENV`     | `development`                     | Aktiverer SSL for DB i production |
| `VITE_API_URL` | `http://localhost:3001`           | API-URL for frontend proxy |

## Porter

| Tjeneste   | Port |
|------------|------|
| Client     | 5173 |
| Server     | 3001 |
| PostgreSQL | 5433 |

## Prosjektstruktur

```
client/          React frontend (Vite + TailwindCSS)
server/          Express API backend (TypeScript)
sample-data/     JSON-testdata for import
openspec/        Spesifikasjoner og endringsdokumenter
```

## Testing

```bash
# Server-tester (236+ tester — deal returns, pro forma, finansiell integritet)
cd server && npm test

# Client-tester (helpers, error handling)
cd client && npm test
```

## Import av data

Applikasjonen stotter import av finansielle modeller fra:

- **Excel** (.xlsx) — last opp via selskapsside, parser automatisk P&L-blokker
- **JSON** — strukturert periodedata (se `sample-data/` for eksempler)
- **CSV** — periodata via filopplasting

## API

API-et krever JWT-autentisering (Bearer token). Alle endepunkter er under `/api/`.

| Omrade     | Endepunkter                                           |
|------------|-------------------------------------------------------|
| Auth       | Login, registrer bruker (admin)                       |
| Selskaper  | CRUD + forutsetninger (assumptions)                   |
| Modeller   | CRUD + perioder (bulk upsert)                         |
| Scenarier  | CRUD + calculate returns, sensitivity, pro forma, Excel-eksport |
| Import     | Excel, JSON, CSV                                      |

Se `server/src/routes/` for komplett API-oversikt, og `server/src/schemas.ts` for Zod-valideringsskjemaer.

## Sprak

Stotter norsk (bokmal) og engelsk. Sprak velges automatisk fra nettleser, og kan overstyres via localStorage.
