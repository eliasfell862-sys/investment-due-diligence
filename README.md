# Investment Due Diligence Model

Local-first investment due diligence workstation for professional VC/PE investors. Upload deal materials, analyze across 11 modules, and export professional Word reports — all from your browser.

## Quick Start

```bash
cd app
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Desktop App

```bash
npm run electron:dev       # Development with hot reload
npm run electron:build     # Build portable .exe
npm run electron:dist      # Build .msi installer
```

Output in `app/release/`.

## Features

### 11 Analysis Modules

| Module | Description |
|--------|-------------|
| Company Overview | Basic info, business model, milestones |
| Team Assessment | Founder/team evaluation, key person risk |
| Industry & Market | TAM/SAM/SOM, value chain, growth drivers |
| Competitor Analysis | Structured comparison matrix |
| Product & Technology | Product pipeline, IP, moats |
| Financial Analysis | P&L, cash flow, unit economics, ratios |
| Valuation Model | DCF, comparables, VC method |
| Equity & Financing | Cap table, ESOP, dilution |
| Risk Assessment | 9-category matrix, fatal flaws, clause recommendations |
| Exit Path | Exit scenarios, IRR/MOIC |
| Investment Decision | 5-tier scoring, logic chain, bear case |

### 6 Calculation Engines

All engines are pure TypeScript, offline-capable, with 40-digit Decimal precision and full audit trails:

- **Formula Dictionary** — 70+ financial metric definitions
- **3-Scenario Forecast** — 36/48/60-month P&L, cash flow, financing needs
- **Valuation Triangulation** — DCF + comparables + VC method
- **Equity & Dilution** — Cap table, ESOP, liquidation waterfall, IRR/MOIC
- **Risk Engine** — Residual risk scoring, fatal flaws, loss probability, clause mapping
- **Decision Engine** — Stage-weighted scoring, 5-tier investment decision

### Word Report

One-click export to `.docx` with:
- Cover page, table of contents, headers/footers
- Executive summary, investment highlights, bear case
- Full financial tables, risk matrix, competitor comparison
- Embedded ECharts (revenue waterfall, margin trends)
- Source attribution and audit trail

### AI Research (Optional)

Configure an OpenAI-compatible API key to enable industry, competitor, and policy research. All queries include source annotations and retrieval dates. Offline by default.

## Architecture

```
app/src/
├── domain/          # Pure TypeScript domain models & rules
├── engines/         # 6 calculation engines (zero UI dependency)
│   ├── formulas/    # Formula dictionary
│   ├── forecast/    # 3-scenario forecast
│   ├── valuation/   # DCF, comparables, VC method
│   ├── equity/      # Cap table, liquidation, returns
│   ├── risk/        # Risk scoring, fatal flaws, clauses
│   └── decision/    # Investment decision engine
├── infrastructure/  # IndexedDB, Excel/PDF parsing, charts, Word export
├── features/        # React UI (11 analysis modules + data room + reports)
└── app/             # App shell, routing
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Data | IndexedDB (Dexie), Zod validation |
| Charts | ECharts 6 |
| Reports | docx (Word), pdfjs-dist (PDF extraction) |
| Compute | decimal.js (40-digit, ROUND_HALF_EVEN) |
| Desktop | Electron + electron-builder |
| Testing | Vitest, Testing Library (1,535 tests) |

## Data Privacy

All project data stays in your browser's IndexedDB. No cloud upload. The optional AI research only sends your query text — no project data, no files. API keys stored in localStorage, never in reports or logs.

## License

MIT
