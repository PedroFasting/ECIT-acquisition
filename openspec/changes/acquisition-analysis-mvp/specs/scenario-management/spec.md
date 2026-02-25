## ADDED Requirements

### Requirement: CRUD operations for acquisition scenarios
The system SHALL provide REST endpoints for managing scenarios: `POST /api/scenarios` (create), `GET /api/scenarios` (list all with company/model names), `GET /api/scenarios/:id` (get with deal returns, pro forma, and acquirer/target periods), `PUT /api/scenarios/:id` (update), `DELETE /api/scenarios/:id` (delete with cascade). Each scenario SHALL link an acquirer model to a target model.

#### Scenario: Create a scenario linking acquirer and target
- **WHEN** an authenticated user sends POST to `/api/scenarios` with acquirer_model_id, target_model_id, name, and deal terms
- **THEN** the system creates the scenario and returns it with status 201

#### Scenario: List scenarios with model and company names
- **WHEN** an authenticated user sends GET to `/api/scenarios`
- **THEN** the response includes all scenarios with resolved `acquirer_company_name`, `acquirer_model_name`, `target_company_name`, `target_model_name`

#### Scenario: Get scenario with all related data
- **WHEN** an authenticated user sends GET to `/api/scenarios/:id`
- **THEN** the response includes the scenario with `deal_returns`, `pro_forma_periods`, `acquirer_periods`, and `target_periods` arrays

#### Scenario: Delete scenario cascades to returns and pro forma
- **WHEN** an authenticated user deletes a scenario
- **THEN** the scenario, all its deal_returns, and all its pro_forma_periods are deleted

### Requirement: Deal parameters on scenario
Each scenario SHALL store deal parameters: acquisition_date, share_price, enterprise_value, equity_value, ordinary_equity, preferred_equity, preferred_equity_rate, net_debt, rollover_shareholders. These parameters describe the acquisition terms and capital structure at deal close.

#### Scenario: Store deal terms
- **WHEN** a scenario is created with share_price=82, enterprise_value=8671, equity_value=4886, preferred_equity_rate=0.095
- **THEN** all deal parameters are stored and retrievable

### Requirement: Cost synergies timeline
Each scenario SHALL store a `cost_synergies_timeline` as JSONB mapping years to synergy amounts (e.g. `{"2026": 20, "2027": 40}`). This timeline SHALL be used by the pro forma engine when generating combined financials.

#### Scenario: Define synergies ramping over time
- **WHEN** a user sets cost_synergies_timeline to `{"2026": 15, "2027": 30, "2028": 45, "2029": 50}`
- **THEN** the timeline is stored and used for pro forma generation

### Requirement: Scenario status management
Each scenario SHALL have a `status` field with values: "draft", "active", or "archived". New scenarios SHALL default to "draft". Users SHALL be able to update the status via the PUT endpoint.

#### Scenario: Transition scenario from draft to active
- **WHEN** a user updates a scenario's status from "draft" to "active"
- **THEN** the status is persisted and reflected in subsequent GET requests

### Requirement: Frontend scenario creation form
The frontend SHALL provide a form for creating new scenarios. The form SHALL include: scenario name, description, acquirer model selector (dropdown of all models grouped by company), target model selector (same format), deal parameters fields, and synergies timeline input. Company names SHALL be shown alongside model names in the selectors.

#### Scenario: Create scenario via form
- **WHEN** a user fills in the scenario form selecting "ECIT / Management case" as acquirer and "Argon / Sellside case" as target, enters deal parameters, and submits
- **THEN** the scenario is created and the user is navigated to the scenario detail page

#### Scenario: Validate required fields
- **WHEN** a user tries to submit the scenario form without selecting both an acquirer and target model
- **THEN** the form shows validation errors indicating which fields are required
