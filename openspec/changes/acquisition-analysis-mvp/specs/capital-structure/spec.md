## ADDED Requirements

### Requirement: Sources and uses storage
Each scenario SHALL store sources and uses as JSONB arrays on the `acquisition_scenarios` table. Each source/use item SHALL have a `name` (string) and `amount` (number in NOKm). The total of sources SHALL equal the total of uses.

#### Scenario: Store sources and uses
- **WHEN** a scenario has sources [{"name": "Ordinary Equity", "amount": 3352}, {"name": "Preferred Equity", "amount": 1534}, {"name": "Net Debt", "amount": 3786}] and uses [{"name": "Enterprise Value", "amount": 8671}]
- **THEN** the sources and uses are stored as JSONB arrays on the scenario record

### Requirement: Display sources and uses tables
The frontend scenario detail page SHALL display sources and uses in a two-column layout. Each column SHALL show a table with name and amount rows, plus a total row at the bottom. Amounts SHALL be formatted as NOKm with appropriate number formatting.

#### Scenario: Render sources and uses side by side
- **WHEN** a user views a scenario with 3 sources and 7 uses
- **THEN** the page shows two tables: "Sources" (left) with 3 rows + total, "Uses" (right) with 7 rows + total

#### Scenario: Show balanced totals
- **WHEN** sources total 8,671 NOKm and uses total 8,671 NOKm
- **THEN** both total rows display 8,671 with no imbalance warning

### Requirement: Capital structure summary
The scenario SHALL display key capital structure metrics: ordinary_equity, preferred_equity, preferred_equity_rate, net_debt, and total enterprise_value. These SHALL be shown as a summary above the sources/uses detail.

#### Scenario: Show capital structure summary
- **WHEN** a scenario has OE=3,352, PE=1,534 @9.5% PIK, ND=3,786, EV=8,671
- **THEN** a summary card displays these values with the PIK rate formatted as percentage

### Requirement: Stacked bar chart visualization
The frontend SHALL render a stacked bar chart showing the capital structure composition. The bar SHALL show three segments: ordinary equity (bottom), preferred equity (middle), and net debt (top). Each segment SHALL be labeled with its amount and percentage of total. The chart SHALL use ECIT brand colors.

#### Scenario: Render stacked bar with three segments
- **WHEN** a scenario has OE=3,352 (38.7%), PE=1,534 (17.7%), ND=3,786 (43.7%)
- **THEN** a stacked bar chart displays with three colored segments proportional to their values, each labeled with amount and percentage

#### Scenario: Handle missing capital structure data
- **WHEN** a scenario has no capital structure data (all null)
- **THEN** the stacked bar chart section is not rendered

### Requirement: Edit sources and uses inline
The frontend SHALL allow users to add, edit, and remove source/use items inline. Users SHALL be able to change item names and amounts, add new items with a "+" button, and remove items with a delete button. Changes SHALL be persisted via the scenario PUT endpoint.

#### Scenario: Add a new source item
- **WHEN** a user clicks "+" in the sources section and enters name="Mezzanine" amount=500
- **THEN** the new source appears in the table and is saved to the scenario

#### Scenario: Remove a use item
- **WHEN** a user clicks the delete button on a use item
- **THEN** the item is removed from the uses array and the change is saved
