## 1. Database Schema Extension

- [x] 1.1 Add equity bridge columns to financial_periods (share_count, nibd, option_debt, adjustments, enterprise_value, equity_value, preferred_equity, per_share_pre, mip_amount, tso_amount, warrants_amount, eqv_post_dilution, per_share_post, acquired_revenue) - all nullable NUMERIC
- [x] 1.2 Add model_parameters JSONB column to financial_models table
- [x] 1.3 Update init.sql to include new columns for fresh installs
- [x] 1.4 Run ALTER TABLE statements against running database and verify with \d financial_periods

## 2. TypeScript Types Update

- [x] 2.1 Extend FinancialPeriod interface in client/src/types/index.ts with equity bridge fields
- [x] 2.2 Add ModelParameters interface and add optional model_parameters to FinancialModel interface
- [x] 2.3 Verify TypeScript compiles clean for both server and client

## 3. Backend API Updates for Equity Bridge

- [x] 3.1 Update models route GET /api/models/:id to include model_parameters in response
- [x] 3.2 Update models route POST/PUT to accept and persist model_parameters
- [x] 3.3 Update periods upsert in models route to include all new equity bridge columns in INSERT and ON CONFLICT UPDATE
- [x] 3.4 Update JSON import endpoint to handle equity bridge fields in period data
- [x] 3.5 Verify existing API endpoints still work with sample data

## 4. Excel Import - Server Side

- [x] 4.1 Install exceljs dependency in server package
- [x] 4.2 Create Excel parser module (server/src/services/excelParser.ts) with model block detection scanning for "Name:" rows
- [x] 4.3 Implement period column detection (scan for 4-digit years in header row)
- [x] 4.4 Implement row label to field mapping (Revenue, EBITDA, share_count, NIBD, EQV, etc.)
- [x] 4.5 Implement input parameters parsing from rows above first model block
- [x] 4.6 Add POST /api/import/excel/:companyId endpoint in import route using multer
- [x] 4.7 Wire parser to create financial_models and upsert financial_periods per model block
- [x] 4.8 Return import summary (models created/updated, period counts, unrecognized rows)
- [x] 4.9 Test Excel import with test file (Div filer/ECIT - Modell for sammenlikning oppkjop TEST.xlsx)

## 5. ECIT Color Theme

- [x] 5.1 Replace Towerbrook CSS custom properties in client/src/index.css with ECIT colors (#03223F, #002C55, #57A5E4, #F4EDDC, #FBF7EF)
- [x] 5.2 Update Layout.tsx sidebar from plum/wine to ECIT navy background
- [x] 5.3 Update all page components to use ECIT color variables (buttons, links, hover states, active states)
- [x] 5.4 Update Recharts color palette in all chart components to use ECIT navy/accent blue
- [x] 5.5 Verify no Towerbrook colors (#2d1b2e, #5c2d4a, #8b3a62) remain in the codebase

## 6. ScenarioDetailPage Decomposition

- [x] 6.1 Create components/scenario/ directory structure
- [x] 6.2 Extract KeyMetricsCards component with summary metric cards
- [x] 6.3 Extract ProFormaTable component with combined financial table
- [x] 6.4 Extract DealReturnsMatrix component with editable IRR/MoM grid
- [x] 6.5 Extract CapitalStructure component with sources/uses tables and stacked bar chart
- [x] 6.6 Extract AccretionAnalysis component with growth/margin comparison
- [x] 6.7 Extract EbitdaChart component with EBITDA evolution chart
- [x] 6.8 Extract RevenueChart component with revenue composition chart
- [x] 6.9 Create EquityBridgeTable component for equity bridge data display
- [x] 6.10 Refactor ScenarioDetailPage to compose extracted components via props
- [x] 6.11 Verify scenario detail page renders identically after decomposition

## 7. Valuation Model Frontend

- [x] 7.1 Add equity bridge table section to ModelDetailPage showing share_count, NIBD, EQV, per_share fields by period
- [x] 7.2 Add model parameters card to ModelDetailPage displaying model_parameters JSONB with formatted values
- [x] 7.3 Conditionally hide equity bridge section when all values are null
- [x] 7.4 Conditionally hide parameters card when model_parameters is null/empty

## 8. Accretion Analysis Views

- [x] 8.1 Build organic growth comparison grouped bar chart (acquirer vs target by period)
- [x] 8.2 Build EBITDA margin comparison grouped bar chart
- [x] 8.3 Build standalone vs pro forma accretion table (revenue, EBITDA, margin, FCF, cash conversion with deltas)
- [x] 8.4 Build EBITDA evolution chart (acquirer, target, combined excl/incl synergies)
- [x] 8.5 Build revenue composition stacked chart (acquirer + target revenue by period)

## 9. Table Styling and Presentation Polish

- [x] 9.1 Apply consistent table styling: navy headers, alternating cream/white rows, right-aligned numbers
- [x] 9.2 Implement Norwegian number formatting (space as thousands separator, comma as decimal)
- [x] 9.3 Add deal returns matrix color coding (green >25% IRR, yellow 15-25%, red <15%)
- [x] 9.4 Style delta values with green (positive) / red (negative) colors
- [x] 9.5 Add print CSS to hide sidebar and expand content for Cmd+P
- [x] 9.6 Verify Norwegian language labels on all navigation, headers, buttons, and form labels

## 10. Frontend Excel Upload Integration

- [x] 10.1 Add Excel upload button/dropzone to CompanyDetailPage
- [x] 10.2 Wire upload to POST /api/import/excel/:companyId with file FormData
- [x] 10.3 Show import summary result (models detected, periods imported, warnings)
- [x] 10.4 Refresh model list after successful import
- [x] 10.5 Show error message for rejected files (wrong type, too large, parse failure)

## 11. End-to-End Verification

- [x] 11.1 Test full flow: upload Excel -> verify models created -> view equity bridge -> create scenario -> view pro forma
- [x] 11.2 Verify deal returns matrix displays and edits correctly with color coding
- [x] 11.3 Verify capital structure stacked bar chart renders with ECIT colors
- [x] 11.4 Verify accretion analysis charts render with comparison data
- [x] 11.5 Verify TypeScript compiles clean for both server and client
- [x] 11.6 Verify all API endpoints return correct data with equity bridge fields
