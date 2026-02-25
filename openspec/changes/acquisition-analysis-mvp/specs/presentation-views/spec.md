## ADDED Requirements

### Requirement: ECIT brand color theme
The application SHALL use ECIT brand colors defined as CSS custom properties: `--color-ecit-dark: #03223F` (navy - sidebar, headers), `--color-ecit-navy: #002C55` (darker navy - hover states), `--color-ecit-accent: #57A5E4` (sky blue - links, highlights, active states), `--color-ecit-cream: #F4EDDC` (warm cream - card backgrounds), `--color-ecit-light: #FBF7EF` (off-white - page background), `--color-ecit-positive: #22c55e` (green - positive values), `--color-ecit-negative: #ef4444` (red - negative values). The existing Towerbrook colors (#2d1b2e, #5c2d4a, #8b3a62) SHALL be completely replaced.

#### Scenario: Sidebar uses ECIT navy
- **WHEN** a user views any page in the application
- **THEN** the sidebar background is ECIT navy (#03223F), not Towerbrook plum (#2d1b2e)

#### Scenario: Active links use accent blue
- **WHEN** a navigation item is selected or a link is active
- **THEN** it uses the ECIT accent blue (#57A5E4) for highlighting

#### Scenario: Page backgrounds use warm tones
- **WHEN** a user views the main content area
- **THEN** the page background is off-white (#FBF7EF) and cards use warm cream (#F4EDDC)

### Requirement: Professional table styling
All data tables SHALL use a consistent, presentation-ready style: alternating row backgrounds (cream/white), compact but readable cell padding, right-aligned numeric values, header rows with navy background and white text, section separator rows for grouped tables. Number formatting SHALL use Norwegian locale (space as thousands separator, comma as decimal).

#### Scenario: Financial table is presentation-ready
- **WHEN** a user views a financial periods table or pro forma table
- **THEN** the table has navy headers, alternating row colors, right-aligned numbers formatted with Norwegian conventions

#### Scenario: Section headers in grouped tables
- **WHEN** a financial table has sections (Revenue, EBITDA, Cash Flow)
- **THEN** each section has a visually distinct header row separating the groups

### Requirement: Responsive chart styling with ECIT colors
All charts (Recharts) SHALL use ECIT brand colors for data series: primary series in navy (#03223F), secondary in accent blue (#57A5E4), additional series in derived shades. Charts SHALL have cream backgrounds, readable axis labels, and tooltips styled to match the theme.

#### Scenario: Bar chart uses ECIT palette
- **WHEN** a bar chart displays acquirer vs target comparison
- **THEN** acquirer bars use navy (#03223F) and target bars use accent blue (#57A5E4)

#### Scenario: Chart tooltips match theme
- **WHEN** a user hovers over a chart data point
- **THEN** the tooltip uses a navy background with cream text matching the ECIT theme

### Requirement: Key metrics dashboard cards
The dashboard and scenario pages SHALL display key metrics in summary cards at the top. Cards SHALL show: metric name, current value (large text), trend or comparison (delta), and period label. Cards SHALL use cream backgrounds with navy text and colored accents for positive/negative trends.

#### Scenario: Show scenario summary metrics
- **WHEN** a user views a scenario detail page
- **THEN** summary cards show key metrics: EV, EQV, EBITDA (latest period), IRR range, revenue (latest period)

### Requirement: Layout for screen-sharing
The application layout SHALL be optimized for screen-sharing in meetings: high contrast between text and background, minimum 14px font size for data tables, clear visual hierarchy, and printable views without sidebar. The layout SHALL work well at 1920x1080 resolution.

#### Scenario: Readable at presentation distance
- **WHEN** the application is shared on a meeting room screen
- **THEN** financial data, chart labels, and key metrics are readable without squinting

#### Scenario: Print view without sidebar
- **WHEN** a user triggers print (Cmd+P) on a scenario detail page
- **THEN** the sidebar is hidden and the content expands to fill the page width

### Requirement: ScenarioDetailPage decomposition
The ScenarioDetailPage (currently 1,528 lines) SHALL be decomposed into dedicated sub-components: `ProFormaTable`, `DealReturnsMatrix`, `CapitalStructure`, `AccretionAnalysis`, `EbitdaChart`, `RevenueChart`, `KeyMetricsCards`, `EquityBridgeTable`. Each component SHALL manage its own display logic and receive data via props from the parent page. The parent page SHALL handle data fetching and state management.

#### Scenario: Decomposed page renders identically
- **WHEN** a user views the scenario detail page after decomposition
- **THEN** the page renders all sections identically to the monolithic version with no visual regressions

#### Scenario: Components are independently importable
- **WHEN** a developer imports `DealReturnsMatrix` from `components/scenario/`
- **THEN** it renders correctly given the appropriate props without depending on ScenarioDetailPage state

### Requirement: Norwegian language UI
All user-facing text in the UI SHALL be in Norwegian (bokmal). This includes: navigation labels, page titles, table headers, button labels, form labels, error messages, and metric descriptions. Technical identifiers (API field names, component names) SHALL remain in English.

#### Scenario: Navigation in Norwegian
- **WHEN** a user views the sidebar navigation
- **THEN** links show Norwegian labels: "Oversikt", "Selskaper", "Modeller", "Scenarier"

#### Scenario: Table headers in Norwegian
- **WHEN** a user views a financial table
- **THEN** headers show Norwegian labels: "Omsetning", "Vekst", "Marginer", "Kontantstr0m"
