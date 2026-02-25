## ADDED Requirements

### Requirement: Import financial periods from JSON
The system SHALL accept JSON data via `POST /api/import/json/:modelId` either as a file upload or as a `data` field in the request body. The JSON SHALL contain an array of period objects (either at root level or under a `periods` key). Each period object SHALL be upserted into `financial_periods` using model_id + period_date as the unique key.

#### Scenario: Import JSON from request body
- **WHEN** an authenticated user sends a POST to `/api/import/json/:modelId` with `{ "data": { "periods": [...] } }` in the body
- **THEN** the system upserts all periods for the specified model and returns a count of imported periods

#### Scenario: Import JSON as file upload
- **WHEN** an authenticated user uploads a .json file to `/api/import/json/:modelId`
- **THEN** the system parses the file and upserts all periods for the specified model

#### Scenario: Model does not exist
- **WHEN** the user sends import data for a modelId that does not exist
- **THEN** the system returns HTTP 404 with error "Model not found"

#### Scenario: Invalid data format
- **WHEN** the user sends data that is not an array and does not have a `periods` array
- **THEN** the system returns HTTP 400 with an error explaining the expected format

### Requirement: Import financial periods from CSV
The system SHALL accept CSV file uploads via `POST /api/import/csv/:modelId`. The CSV SHALL have column headers mapping to financial period fields. The system SHALL automatically derive `period_date` from period labels containing 4-digit years and `period_type` from label suffixes (A=actual, B=budget, E/F=forecast). Percentage values SHALL be parsed from formats like "15.8%" to 0.158.

#### Scenario: Import CSV with standard column names
- **WHEN** an authenticated user uploads a CSV file with columns "period", "Revenue", "EBITDA", "% margin"
- **THEN** the system maps columns to database fields, converts percentages, and upserts periods

#### Scenario: Handle missing or null values in CSV
- **WHEN** a CSV row contains empty cells or "-" or "N/A" values
- **THEN** the system stores null for those fields without failing the import

#### Scenario: Reject non-CSV file
- **WHEN** the user does not include a file in the upload
- **THEN** the system returns HTTP 400 with error "No CSV file uploaded"

### Requirement: Import geographic revenue breakdown
The system SHALL support importing geographic revenue data alongside period data in JSON format. Geographic data SHALL be provided as a `geography` array of objects with `period_date`, `country`, `revenue_amount`, and `revenue_pct`. The system SHALL upsert into `revenue_geography` on (model_id, period_date, country).

#### Scenario: Import periods with geography data
- **WHEN** the JSON payload includes a `geography` array with entries for "Norway", "Sweden", "Denmark"
- **THEN** the system upserts revenue_geography records for each country and period combination

### Requirement: Import service line revenue breakdown
The system SHALL support importing service line revenue data alongside period data in JSON format. Service data SHALL be provided as a `services` array of objects with `period_date`, `service_name`, `revenue_amount`, and `revenue_pct`. The system SHALL upsert into `revenue_service` on (model_id, period_date, service_name).

#### Scenario: Import periods with service line data
- **WHEN** the JSON payload includes a `services` array with entries for "IT", "F&A (excl. payroll)", "Payroll and HR"
- **THEN** the system upserts revenue_service records for each service and period combination

### Requirement: Transactional import
All import operations (JSON, CSV, Excel) SHALL be wrapped in a database transaction. If any period fails to insert/update, the entire import SHALL be rolled back and an error returned.

#### Scenario: Rollback on partial failure
- **WHEN** an import succeeds for 3 out of 5 periods but the 4th period has invalid data causing a database error
- **THEN** all 5 periods are rolled back and the system returns an error with details
