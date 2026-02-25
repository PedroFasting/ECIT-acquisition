-- ECIT Acquisition Analysis Tool - Database Schema

-- Users for authentication
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'analyst',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Companies: ECIT (acquirer) and targets
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  company_type VARCHAR(20) NOT NULL CHECK (company_type IN ('acquirer', 'target')),
  description TEXT,
  currency VARCHAR(10) DEFAULT 'NOKm',
  -- Metadata
  country VARCHAR(100),
  sector VARCHAR(255),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Financial models: multiple named scenarios per company
-- e.g. "Management case", "Sellside case", "Post DD case"
CREATE TABLE IF NOT EXISTS financial_models (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  model_type VARCHAR(50) DEFAULT 'base' CHECK (model_type IN ('base', 'upside', 'downside', 'management', 'sellside', 'post_dd', 'custom')),
  is_active BOOLEAN DEFAULT true,
  model_parameters JSONB,                  -- Input parameters (shares, warrants, multiples, etc.)
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, name)
);

-- Financial periods: yearly data per model
-- Stores all financial line items for a given year
CREATE TABLE IF NOT EXISTS financial_periods (
  id SERIAL PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,              -- e.g. 2024-12-31
  period_label VARCHAR(20) NOT NULL,      -- e.g. "2024A", "2025B", "2026E"
  period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('actual', 'budget', 'estimate', 'forecast')),
  
  -- Revenue breakdown
  revenue_managed_services NUMERIC(15,1),
  revenue_professional_services NUMERIC(15,1),
  revenue_other NUMERIC(15,1),
  revenue_total NUMERIC(15,1),
  revenue_organic NUMERIC(15,1),
  revenue_ma NUMERIC(15,1),               -- M&A revenue contribution
  
  -- Growth rates (stored as decimals, e.g. 0.158 = 15.8%)
  revenue_growth NUMERIC(8,4),
  organic_growth NUMERIC(8,4),
  managed_services_growth NUMERIC(8,4),
  professional_services_growth NUMERIC(8,4),
  
  -- EBITDA breakdown
  ebitda_managed_services NUMERIC(15,1),
  ebitda_professional_services NUMERIC(15,1),
  ebitda_central_costs NUMERIC(15,1),
  ebitda_organic NUMERIC(15,1),           -- Organic EBITDA (pre-IFRS)
  ebitda_ma NUMERIC(15,1),                -- M&A EBITDA contribution
  ebitda_total NUMERIC(15,1),             -- Total EBITDA (pre-IFRS)
  ebitda_incl_synergies NUMERIC(15,1),
  cost_synergies NUMERIC(15,1),
  
  -- Margins (stored as decimals)
  margin_managed_services NUMERIC(8,4),
  margin_professional_services NUMERIC(8,4),
  margin_central_costs NUMERIC(8,4),
  ebitda_margin NUMERIC(8,4),
  
  -- Cash flow
  capex NUMERIC(15,1),
  capex_pct_revenue NUMERIC(8,4),
  change_nwc NUMERIC(15,1),
  other_cash_flow_items NUMERIC(15,1),
  operating_fcf NUMERIC(15,1),
  minority_interest NUMERIC(15,1),
  operating_fcf_excl_minorities NUMERIC(15,1),
  cash_conversion NUMERIC(8,4),
  
  -- Equity bridge
  share_count NUMERIC(15,4),               -- Number of shares in period
  nibd NUMERIC(15,1),                      -- Net interest-bearing debt
  option_debt NUMERIC(15,1),               -- Option debt (incl Mgt Holding)
  adjustments NUMERIC(15,1),               -- Other adjustments
  enterprise_value NUMERIC(15,1),          -- EV for the period
  equity_value NUMERIC(15,1),              -- EQV
  preferred_equity NUMERIC(15,1),          -- Preferred equity amount
  per_share_pre NUMERIC(15,4),             -- Per share before MIP/TSO
  mip_amount NUMERIC(15,1),               -- MIP dilution
  tso_amount NUMERIC(15,1),               -- TSO dilution
  warrants_amount NUMERIC(15,1),           -- Existing warrants dilution
  eqv_post_dilution NUMERIC(15,1),         -- EQV after MIP/TSO/ExW
  per_share_post NUMERIC(15,4),            -- Per share after dilution
  acquired_revenue NUMERIC(15,1),          -- Acquired revenue (MNOK)
  
  -- Extensible: store additional line items as JSON
  extra_data JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(model_id, period_date)
);

-- Revenue breakdown by geography (for strategic analysis)
CREATE TABLE IF NOT EXISTS revenue_geography (
  id SERIAL PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  country VARCHAR(100) NOT NULL,
  revenue_amount NUMERIC(15,1),
  revenue_pct NUMERIC(8,4),
  UNIQUE(model_id, period_date, country)
);

-- Revenue breakdown by service line
CREATE TABLE IF NOT EXISTS revenue_service (
  id SERIAL PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  service_name VARCHAR(255) NOT NULL,     -- e.g. "IT", "F&A (excl. payroll)", "Payroll and HR", "Tech"
  revenue_amount NUMERIC(15,1),
  revenue_pct NUMERIC(8,4),
  UNIQUE(model_id, period_date, service_name)
);

-- Acquisition scenarios: combines acquirer + target with deal terms
CREATE TABLE IF NOT EXISTS acquisition_scenarios (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Deal participants (nullable: SET NULL when a model is deleted)
  acquirer_model_id INTEGER REFERENCES financial_models(id) ON DELETE SET NULL,
  target_model_id INTEGER REFERENCES financial_models(id) ON DELETE SET NULL,
  
  -- Deal terms
  acquisition_date DATE,
  share_price NUMERIC(15,2),              -- e.g. NOK 82 per share
  enterprise_value NUMERIC(15,1),
  equity_value NUMERIC(15,1),
  
  -- Capital structure
  ordinary_equity NUMERIC(15,1),
  preferred_equity NUMERIC(15,1),
  preferred_equity_rate NUMERIC(8,4),     -- e.g. 0.095 for 9.5% PIK
  net_debt NUMERIC(15,1),
  rollover_shareholders NUMERIC(15,1),
  
  -- Sources & Uses (stored as JSON for flexibility)
  sources JSONB DEFAULT '[]',
  uses JSONB DEFAULT '[]',
  
  -- Deal assumptions
  exit_date DATE,
  cost_synergies_timeline JSONB DEFAULT '{}',
  
  -- Deal parameters for IRR/MoM calculation
  deal_parameters JSONB DEFAULT '{}',
  
  -- Status
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Deal returns: IRR/MoM calculations at various exit multiples
CREATE TABLE IF NOT EXISTS deal_returns (
  id SERIAL PRIMARY KEY,
  scenario_id INTEGER NOT NULL REFERENCES acquisition_scenarios(id) ON DELETE CASCADE,
  
  -- Which case is this return for
  return_case VARCHAR(100) NOT NULL,       -- e.g. "ECIT standalone", "ECIT + Argon - post DD", "ECIT + Argon - sellside"
  
  -- Exit parameters
  exit_multiple NUMERIC(8,2) NOT NULL,     -- NTM EBITDA exit multiple (10x, 11x, etc.)
  
  -- Returns
  irr NUMERIC(8,4),                        -- e.g. 0.307 = 30.7%
  mom NUMERIC(8,2),                        -- Money on Money, e.g. 3.0x
  
  -- Delta vs standalone
  irr_delta NUMERIC(8,4),
  mom_delta NUMERIC(8,2),
  
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(scenario_id, return_case, exit_multiple)
);

-- Pro forma combined financials (materialized view of merged data)
CREATE TABLE IF NOT EXISTS pro_forma_periods (
  id SERIAL PRIMARY KEY,
  scenario_id INTEGER NOT NULL REFERENCES acquisition_scenarios(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  period_label VARCHAR(20) NOT NULL,
  
  -- Combined revenue breakdown by source
  acquirer_revenue NUMERIC(15,1),
  target_revenue NUMERIC(15,1),
  other_revenue NUMERIC(15,1),            -- Qlosr, M&A pipeline, etc.
  total_revenue NUMERIC(15,1),
  revenue_growth NUMERIC(8,4),
  
  -- Combined EBITDA
  acquirer_ebitda NUMERIC(15,1),
  target_ebitda NUMERIC(15,1),
  other_ebitda NUMERIC(15,1),
  ma_ebitda NUMERIC(15,1),
  total_ebitda_excl_synergies NUMERIC(15,1),
  ebitda_margin_excl_synergies NUMERIC(8,4),
  cost_synergies NUMERIC(15,1),
  total_ebitda_incl_synergies NUMERIC(15,1),
  ebitda_margin_incl_synergies NUMERIC(8,4),
  
  -- Combined cash flow
  total_capex NUMERIC(15,1),
  total_change_nwc NUMERIC(15,1),
  total_other_cash_flow NUMERIC(15,1),
  operating_fcf NUMERIC(15,1),
  minority_interest NUMERIC(15,1),
  operating_fcf_excl_minorities NUMERIC(15,1),
  cash_conversion NUMERIC(8,4),
  
  -- Extra / overrides
  extra_data JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(scenario_id, period_date)
);

-- Insert default admin user (password: admin123 - change in production!)
INSERT INTO users (email, password_hash, name, role) VALUES 
  ('admin@ecit.no', '$2b$10$placeholder_will_be_set_on_first_login', 'Admin', 'admin')
ON CONFLICT DO NOTHING;

-- Create indexes for common queries
CREATE INDEX idx_financial_periods_model ON financial_periods(model_id);
CREATE INDEX idx_financial_periods_date ON financial_periods(period_date);
CREATE INDEX idx_deal_returns_scenario ON deal_returns(scenario_id);
CREATE INDEX idx_pro_forma_scenario ON pro_forma_periods(scenario_id);
CREATE INDEX idx_companies_type ON companies(company_type);
CREATE INDEX idx_models_company ON financial_models(company_id);
