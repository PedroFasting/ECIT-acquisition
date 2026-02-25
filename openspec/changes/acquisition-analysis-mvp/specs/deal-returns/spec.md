## ADDED Requirements

### Requirement: Deal returns matrix storage
The system SHALL store deal return calculations in the `deal_returns` table with fields: scenario_id, return_case (string label), exit_multiple (NTM EBITDA multiple), irr (decimal), mom (money-on-money multiple), irr_delta (vs standalone), and mom_delta (vs standalone). The combination of (scenario_id, return_case, exit_multiple) SHALL be unique.

#### Scenario: Store returns for multiple cases and multiples
- **WHEN** a scenario has 3 return cases ("ECIT standalone", "ECIT+Argon post DD", "ECIT+Argon sellside") at 5 exit multiples (10x-14x)
- **THEN** the system stores 15 deal_returns records with IRR, MoM, and deltas for each combination

### Requirement: CRUD for deal returns
The system SHALL provide endpoints: `POST /api/scenarios/:id/deal-returns` (bulk create/update), `GET /api/scenarios/:id/deal-returns` (list all for scenario), `DELETE /api/scenarios/:id/deal-returns` (delete all for scenario). The POST endpoint SHALL accept an array of return entries and upsert on (scenario_id, return_case, exit_multiple).

#### Scenario: Bulk upsert deal returns
- **WHEN** an authenticated user sends POST with an array of 15 deal return objects
- **THEN** all returns are upserted and the response confirms the count

#### Scenario: Retrieve deal returns grouped by case
- **WHEN** an authenticated user sends GET to `/api/scenarios/:id/deal-returns`
- **THEN** the response includes all returns for the scenario, enabling client-side grouping by return_case

### Requirement: Delta calculation against standalone
Each deal return row SHALL include `irr_delta` and `mom_delta` fields representing the difference versus the standalone reference case. Positive deltas indicate the combined scenario outperforms standalone. The client SHALL compute and display these deltas.

#### Scenario: Calculate positive delta
- **WHEN** "ECIT standalone" shows IRR=30.0% at 12x and "ECIT+Argon post DD" shows IRR=33.3% at 12x
- **THEN** the delta for the combined case is irr_delta=+3.3pp (0.033)

### Requirement: Display deal returns as editable matrix
The frontend SHALL display deal returns as a matrix table with exit multiples as columns and return cases as rows. Each cell SHALL show both IRR and MoM values. The table SHALL be editable - users can click cells to input or modify IRR/MoM values. Changes SHALL be saved via the bulk upsert endpoint.

#### Scenario: View matrix with color-coded cells
- **WHEN** a user views the deal returns section of a scenario with 3 cases at 5 multiples
- **THEN** a matrix table displays with 3 rows, 5 columns, each cell showing IRR% and MoM

#### Scenario: Edit a cell value
- **WHEN** a user clicks a cell in the matrix and changes the IRR from 30.0% to 31.5%
- **THEN** the updated value is saved to the database and the cell reflects the new value

### Requirement: Color coding for deal returns
The matrix cells SHALL be color-coded based on IRR values: green gradient for higher returns (>25%), yellow for moderate returns (15-25%), red gradient for low returns (<15%). Delta values SHALL be shown with green for positive and red for negative.

#### Scenario: High IRR shows green
- **WHEN** a cell has IRR=33.3%
- **THEN** the cell background uses a green shade indicating strong returns

#### Scenario: Negative delta shows red
- **WHEN** a combined case has irr_delta=-2.0pp compared to standalone
- **THEN** the delta is displayed in red text
