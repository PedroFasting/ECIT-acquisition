## ADDED Requirements

### Requirement: Equity bridge columns on financial periods
The `financial_periods` table SHALL be extended with the following nullable columns for equity bridge data: `share_count` (NUMERIC 15,4), `nibd` (NUMERIC 15,1), `option_debt` (NUMERIC 15,1), `adjustments` (NUMERIC 15,1), `enterprise_value` (NUMERIC 15,1), `equity_value` (NUMERIC 15,1), `preferred_equity` (NUMERIC 15,1), `per_share_pre` (NUMERIC 15,4), `mip_amount` (NUMERIC 15,1), `tso_amount` (NUMERIC 15,1), `warrants_amount` (NUMERIC 15,1), `eqv_post_dilution` (NUMERIC 15,1), `per_share_post` (NUMERIC 15,4), `acquired_revenue` (NUMERIC 15,1). All new columns SHALL be nullable to maintain backward compatibility with existing data.

#### Scenario: Existing data unaffected by migration
- **WHEN** the ALTER TABLE adds new columns to financial_periods
- **THEN** all existing period records retain their values and new columns default to null

#### Scenario: Import period with equity bridge data
- **WHEN** a period is imported or upserted with share_count, nibd, equity_value, and per_share_post values
- **THEN** those values are stored in the corresponding columns alongside existing P&L and cash flow data

### Requirement: Model parameters JSONB field
The `financial_models` table SHALL have a `model_parameters` JSONB column for storing input parameters that apply to the entire model. This includes: shares_at_completion, shares_at_year_end, tso_warrants (count + strike), mip_share_pct, existing_warrants (count + strike), acquisition_multiple, acquisition_share_pct, and preferred_equity_rate.

#### Scenario: Store model parameters from Excel import
- **WHEN** the Excel parser extracts input parameters from the shared input section
- **THEN** the parameters are stored as a JSONB object on the financial_models record

#### Scenario: Retrieve model with parameters
- **WHEN** a user requests GET /api/models/:id for a model that has model_parameters
- **THEN** the response includes the model_parameters field with the stored JSONB data

### Requirement: Display equity bridge in model detail view
The frontend model detail page SHALL display equity bridge data in a table with periods as columns. The table SHALL show rows for: Number of shares, NIBD, Option debt, Adjustments, EV, EQV, Preferred equity, Per share (before MIP & TSO), MIP, TSO, Existing warrants, EQV (post dilution), Per share (post dilution). Rows with all-null values across periods SHALL be hidden.

#### Scenario: Show equity bridge table for model with full data
- **WHEN** a user views the model detail page for a model that has equity bridge data for 5 periods
- **THEN** the page displays an equity bridge table with period columns and all populated rows visible

#### Scenario: Hide equity bridge section when no data
- **WHEN** a user views the model detail page for a model that has no equity bridge data (all columns null)
- **THEN** the equity bridge table section is not rendered

### Requirement: Display model input parameters
The frontend model detail page SHALL display model input parameters in a summary card when `model_parameters` is present. Parameters SHALL be formatted appropriately (percentages as "5.59%", currency as "NOK 10", counts as plain numbers).

#### Scenario: Show input parameters card
- **WHEN** a user views the model detail page for a model with model_parameters containing shares, warrants, and acquisition parameters
- **THEN** a "Modellparametere" card displays all parameters with appropriate formatting

#### Scenario: Hide parameters card when absent
- **WHEN** a user views a model that has no model_parameters (null or empty)
- **THEN** the parameters card is not rendered

### Requirement: TypeScript types for equity bridge
The `FinancialPeriod` TypeScript interface SHALL be extended with fields for all new equity bridge columns. The `FinancialModel` interface SHALL include an optional `model_parameters` field typed as a structured object.

#### Scenario: Type-safe access to equity bridge fields
- **WHEN** frontend code accesses `period.share_count` or `period.per_share_post`
- **THEN** TypeScript recognizes these as `number | null` without type errors
