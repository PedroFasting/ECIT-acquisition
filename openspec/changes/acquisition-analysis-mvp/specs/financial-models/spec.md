## ADDED Requirements

### Requirement: CRUD operations for companies
The system SHALL provide REST endpoints for managing companies: `POST /api/companies` (create), `GET /api/companies` (list all), `GET /api/companies/:id` (get one with models), `PUT /api/companies/:id` (update), `DELETE /api/companies/:id` (delete with cascade). Companies SHALL have a `company_type` of either "acquirer" or "target". The company slug SHALL be auto-generated from the name.

#### Scenario: Create a new target company
- **WHEN** an authenticated user sends POST to `/api/companies` with `{ "name": "Argon AS", "company_type": "target", "country": "Norway", "sector": "IT Services" }`
- **THEN** the system creates the company with an auto-generated slug "argon-as" and returns the created record

#### Scenario: List companies with model counts
- **WHEN** an authenticated user sends GET to `/api/companies`
- **THEN** the system returns all companies with a `model_count` field showing how many financial models each company has

#### Scenario: Get company with embedded models
- **WHEN** an authenticated user sends GET to `/api/companies/:id`
- **THEN** the system returns the company record with a `models` array containing all financial models for that company

#### Scenario: Delete company cascades to models
- **WHEN** an authenticated user deletes a company that has financial models and periods
- **THEN** the company, all its models, and all associated periods are deleted (CASCADE)

### Requirement: CRUD operations for financial models
The system SHALL provide REST endpoints for managing financial models: `POST /api/models` (create), `GET /api/models/company/:companyId` (list for company), `GET /api/models/:id` (get with periods), `PUT /api/models/:id` (update), `DELETE /api/models/:id` (delete). Each model SHALL belong to exactly one company and have a unique name within that company.

#### Scenario: Create a financial model
- **WHEN** an authenticated user sends POST to `/api/models` with `{ "company_id": 1, "name": "Management case", "model_type": "management" }`
- **THEN** the system creates the model and returns it with status 201

#### Scenario: Get model with periods
- **WHEN** an authenticated user sends GET to `/api/models/:id`
- **THEN** the system returns the model with a `periods` array ordered by period_date, plus `geography` and `services` arrays

#### Scenario: Reject duplicate model name per company
- **WHEN** a user tries to create a model with the same name as an existing model for the same company
- **THEN** the system returns HTTP 409 with an error about duplicate model names

### Requirement: Bulk upsert financial periods
The system SHALL provide `PUT /api/models/:id/periods` for bulk upserting financial periods. The endpoint SHALL accept an array of period objects and upsert on (model_id, period_date). This enables both initial data load and incremental updates.

#### Scenario: Upsert 5 periods for a model
- **WHEN** an authenticated user sends PUT to `/api/models/:id/periods` with 5 period objects
- **THEN** the system inserts or updates all 5 periods and returns the updated periods

#### Scenario: Update existing period values
- **WHEN** a period for model_id=1 and period_date=2025-12-31 already exists and the user upserts with new revenue_total
- **THEN** the existing period is updated with the new values while preserving fields not included in the update

### Requirement: Financial model metadata
Each financial model SHALL store: company_id, name, description, model_type (one of: base, upside, downside, management, sellside, post_dd, custom), is_active flag, and timestamps. The model SHALL also display period_count, first_period, and last_period in list views.

#### Scenario: Model list shows period metadata
- **WHEN** a user requests models for a company
- **THEN** each model in the response includes `period_count`, `first_period`, and `last_period` derived from its financial_periods
