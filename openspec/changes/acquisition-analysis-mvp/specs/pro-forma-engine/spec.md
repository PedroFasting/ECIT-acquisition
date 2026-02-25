## ADDED Requirements

### Requirement: Generate pro forma periods from scenario
The system SHALL generate combined pro forma periods when a scenario is created or updated via `POST /api/scenarios/:id/generate-pro-forma`. The engine SHALL match acquirer and target periods by `period_date`, summing revenue and EBITDA components. Only periods present in both the acquirer and target models SHALL be included in the pro forma.

#### Scenario: Generate pro forma for matching periods
- **WHEN** a scenario references an acquirer model with periods 2025-2029 and a target model with periods 2025-2029
- **THEN** the system generates 5 pro_forma_periods with combined financials for each year

#### Scenario: Handle non-overlapping periods
- **WHEN** the acquirer model has periods 2024-2029 and the target model has periods 2025-2028
- **THEN** the system generates pro forma periods only for 2025-2028 (the overlap)

### Requirement: Combined revenue calculation
Each pro forma period SHALL calculate: `acquirer_revenue` from the acquirer model's `revenue_total`, `target_revenue` from the target model's `revenue_total`, `total_revenue` as the sum of acquirer + target + other_revenue. Revenue growth SHALL be calculated as the year-over-year change in total_revenue.

#### Scenario: Sum revenues correctly
- **WHEN** the acquirer has revenue_total=5000 and target has revenue_total=800 for 2026
- **THEN** the pro forma period shows acquirer_revenue=5000, target_revenue=800, total_revenue=5800

#### Scenario: Calculate revenue growth
- **WHEN** the pro forma total_revenue is 5000 for 2025 and 5800 for 2026
- **THEN** the 2026 period shows revenue_growth=0.16 (16%)

### Requirement: Combined EBITDA calculation with synergies
Each pro forma period SHALL calculate: `acquirer_ebitda` and `target_ebitda` from respective models' `ebitda_total`, `total_ebitda_excl_synergies` as the sum of all EBITDA components, `cost_synergies` from the scenario's synergy timeline, `total_ebitda_incl_synergies` as total EBITDA + synergies. Margins SHALL be calculated against total_revenue.

#### Scenario: Apply cost synergies from timeline
- **WHEN** a scenario has cost_synergies_timeline `{"2026": 20, "2027": 40, "2028": 50}` and pro forma EBITDA excl synergies is 1000 for 2027
- **THEN** the 2027 period shows cost_synergies=40, total_ebitda_incl_synergies=1040

#### Scenario: No synergies defined
- **WHEN** a scenario has an empty cost_synergies_timeline
- **THEN** total_ebitda_incl_synergies equals total_ebitda_excl_synergies for all periods

### Requirement: Combined cash flow calculation
Each pro forma period SHALL calculate combined cash flow by summing acquirer and target components: capex, change_nwc, other_cash_flow_items, operating_fcf, minority_interest, operating_fcf_excl_minorities. Cash conversion SHALL be calculated as operating_fcf / total_ebitda_incl_synergies.

#### Scenario: Sum cash flow components
- **WHEN** acquirer has operating_fcf=400 and target has operating_fcf=80 for 2026
- **THEN** the pro forma period shows operating_fcf=480

### Requirement: Pro forma periods stored in database
Generated pro forma periods SHALL be stored in the `pro_forma_periods` table with a unique constraint on (scenario_id, period_date). Regenerating pro forma SHALL delete existing periods for the scenario before inserting new ones.

#### Scenario: Regenerate overwrites existing pro forma
- **WHEN** a user triggers pro forma generation for a scenario that already has pro forma periods
- **THEN** the old pro forma periods are deleted and replaced with newly calculated ones

### Requirement: Display pro forma table in scenario view
The frontend scenario detail page SHALL display a combined pro forma financial table with periods as columns. The table SHALL show sections for Revenue (acquirer, target, total, growth), EBITDA (acquirer, target, excl synergies, synergies, incl synergies, margins), and Cash Flow (capex, NWC, operating FCF, cash conversion).

#### Scenario: Show pro forma with color-coded sections
- **WHEN** a user views a scenario that has 5 pro forma periods
- **THEN** the pro forma table displays all periods with revenue, EBITDA, and cash flow sections clearly separated
