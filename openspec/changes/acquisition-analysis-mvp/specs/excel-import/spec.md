## ADDED Requirements

### Requirement: Upload Excel file for a company
The system SHALL accept .xlsx file uploads via `POST /api/import/excel/:companyId` and parse them server-side using exceljs. The endpoint SHALL use multer for file handling with a 10MB size limit. The upload SHALL be authenticated via JWT.

#### Scenario: Successful upload of valid .xlsx file
- **WHEN** an authenticated user uploads a valid .xlsx file to `/api/import/excel/:companyId` for an existing company
- **THEN** the system accepts the file and begins parsing

#### Scenario: Reject non-xlsx file
- **WHEN** an authenticated user uploads a file that is not .xlsx (e.g. .xls, .csv, .pdf)
- **THEN** the system returns HTTP 400 with an error message indicating only .xlsx files are supported

#### Scenario: Reject file exceeding size limit
- **WHEN** an authenticated user uploads an .xlsx file larger than 10MB
- **THEN** the system returns HTTP 413 with an error message about the file size limit

#### Scenario: Company does not exist
- **WHEN** an authenticated user uploads an .xlsx file for a companyId that does not exist in the database
- **THEN** the system returns HTTP 404 with an error message indicating the company was not found

### Requirement: Auto-detect model blocks in Excel sheet
The system SHALL scan the first column of the first worksheet for rows containing "Name:" to identify the start of each model block. Each model block continues until the next "Name:" row or end of data. The model name SHALL be extracted from the cell value after "Name:" (e.g. "Name: Baseline Plan" -> "Baseline Plan").

#### Scenario: Detect two model blocks
- **WHEN** the system parses an .xlsx file with "Name: Baseline Plan" at row 11 and "Name: Ambitious Plan" at row 40
- **THEN** the system identifies two model blocks: "Baseline Plan" (starting row 11) and "Ambitious Plan" (starting row 40)

#### Scenario: Detect single model block
- **WHEN** the system parses an .xlsx file with only one "Name:" row
- **THEN** the system identifies exactly one model block

#### Scenario: No model blocks found
- **WHEN** the system parses an .xlsx file that contains no "Name:" rows in the first column
- **THEN** the system returns an error indicating no model blocks were detected in the file

### Requirement: Parse period columns from header row
The system SHALL identify period columns by scanning for cells containing 4-digit year values (2020-2040) in the header area of each model block. Each year column SHALL be mapped to a period_date of `YYYY-12-31` with period_label derived from the year.

#### Scenario: Parse periods 2025-2029
- **WHEN** the system finds columns with values 2025, 2026, 2027, 2028, 2029 in the header row of a model block
- **THEN** the system creates 5 period mappings with dates 2025-12-31 through 2029-12-31

### Requirement: Map known row labels to financial fields
The system SHALL map row labels in each model block to `financial_periods` fields. The mapping SHALL support at minimum: "Revenue" -> revenue_total, "EBITDA" -> ebitda_total, "EBITDA %" -> ebitda_margin, "Organic growth %" -> organic_growth, "Acquired revenue" -> acquired_revenue, "Number of shares" -> share_count, "NIBD" -> nibd, "Option debt" -> option_debt, "EV" -> enterprise_value, "EQV" -> equity_value, "Preferred equity" -> preferred_equity, "Per share (before MIP & TSO)" -> per_share_pre, "MIP" -> mip_amount, "TSO" -> tso_amount, "Existing warrants" -> warrants_amount, "EQV (post MIP, TSO, ExW)" -> eqv_post_dilution, "Per share (post MIP, TSO, ExW)" -> per_share_post.

#### Scenario: Map all known rows successfully
- **WHEN** the system encounters a model block containing all known row labels
- **THEN** each row label is mapped to its corresponding database field and values are extracted for each period column

#### Scenario: Handle unknown row labels
- **WHEN** the system encounters rows with labels not in the mapping (e.g. "Adjustments", custom rows)
- **THEN** the system stores unrecognized rows in `extra_data` JSONB using the row label as key

### Requirement: Parse shared input parameters
The system SHALL parse input parameters from the rows above the first model block (typically rows 1-8). These parameters include: number of ordinary shares at completion, number of shares at year-end, TSO warrants count and strike price, MIP share percentage, existing warrants count and strike price, acquisition multiple, and acquired with shares percentage. These SHALL be stored in `model_parameters` JSONB on the `financial_models` record.

#### Scenario: Parse input section with all parameters
- **WHEN** the system parses the input section containing "Number of ordinary shares (completion)", "TSO warrants", "MIP share %", "Existing warrants", "Acquired companies multiple", "Acquired with shares %"
- **THEN** the system creates a `model_parameters` object containing all parsed values with their numeric values

#### Scenario: Input parameters shared across models
- **WHEN** the file contains multiple model blocks with one shared input section
- **THEN** the same `model_parameters` are applied to all models created from the file

### Requirement: Create financial models and periods from parsed data
The system SHALL create one `financial_models` record per detected model block, linked to the specified companyId. For each model, the system SHALL upsert `financial_periods` records for each parsed period. If a model with the same name already exists for the company, its periods SHALL be updated (upsert on model_id + period_date).

#### Scenario: Create two models from file with two blocks
- **WHEN** the system successfully parses a file with "Baseline Plan" and "Ambitious Plan" model blocks, each with 5 periods
- **THEN** the system creates 2 financial_models records and 10 financial_periods records, returning a summary of what was created

#### Scenario: Update existing model on re-import
- **WHEN** the system parses a file containing a model named "Baseline Plan" for a company that already has a model with that name
- **THEN** the existing model's periods are updated (upserted) rather than creating duplicate models

### Requirement: Return import summary
The system SHALL return a JSON response summarizing the import result, including: number of models created/updated, model names, number of periods per model, and any rows that were not recognized.

#### Scenario: Summary after successful import
- **WHEN** the system completes parsing and persisting a file with 2 models and 5 periods each
- **THEN** the response includes `{ models: [{ name, periodsCount, status: "created"|"updated" }], totalPeriods, unrecognizedRows: [...] }`
