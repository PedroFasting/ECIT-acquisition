## ADDED Requirements

### Requirement: Organic growth comparison chart
The frontend SHALL display a bar chart comparing organic revenue growth rates between the acquirer and target across all periods. The chart SHALL use grouped bars (acquirer vs target side by side) with period years on the x-axis and growth percentage on the y-axis.

#### Scenario: Show growth comparison
- **WHEN** a user views the accretion analysis section of a scenario with 5 periods
- **THEN** a grouped bar chart displays organic_growth for both acquirer and target for each period

#### Scenario: Handle missing growth data
- **WHEN** one or more periods have null organic_growth values
- **THEN** those bars are omitted from the chart without breaking the visualization

### Requirement: EBITDA margin comparison chart
The frontend SHALL display a bar chart comparing EBITDA margins between acquirer and target across all periods. The chart SHALL use grouped bars with period years on the x-axis and margin percentage on the y-axis.

#### Scenario: Show margin comparison
- **WHEN** the acquirer has EBITDA margins of 20-25% and the target has 15-18%
- **THEN** the chart clearly shows the margin differential between the two entities

### Requirement: Standalone vs pro forma comparison
The frontend SHALL display a comparison showing key metrics for acquirer standalone vs the combined pro forma entity. Metrics SHALL include: revenue, EBITDA, EBITDA margin, operating FCF, and cash conversion. Each metric SHALL show the standalone value, pro forma value, and the absolute/percentage change (accretion).

#### Scenario: Show accretion table
- **WHEN** the acquirer standalone has EBITDA=1,200 and the pro forma has EBITDA=1,500
- **THEN** the comparison shows EBITDA standalone=1,200, pro forma=1,500, accretion=+300 (+25%)

#### Scenario: Highlight positive accretion
- **WHEN** a metric improves in the pro forma vs standalone (e.g. margin increases)
- **THEN** the accretion value is displayed in green

#### Scenario: Highlight negative accretion
- **WHEN** a metric worsens in the pro forma vs standalone (e.g. cash conversion decreases)
- **THEN** the accretion value is displayed in red

### Requirement: EBITDA evolution chart
The frontend SHALL display a chart showing EBITDA evolution over time for: acquirer standalone, target standalone, and combined pro forma (with and without synergies). This enables visual assessment of how the acquisition changes the EBITDA trajectory.

#### Scenario: Show EBITDA evolution with synergies
- **WHEN** a scenario has 5 periods with synergies ramping from 0 to 50 NOKm
- **THEN** the chart shows four lines/areas: acquirer EBITDA, target EBITDA, combined excl synergies, combined incl synergies

### Requirement: Revenue composition chart
The frontend SHALL display a stacked area or bar chart showing revenue composition over time in the pro forma view: acquirer revenue, target revenue, and any M&A revenue contribution. This shows how the target changes the revenue mix.

#### Scenario: Show revenue composition
- **WHEN** a pro forma has acquirer_revenue=5,000, target_revenue=800 for 2026
- **THEN** the chart shows a stacked visualization with acquirer and target revenue clearly separated
