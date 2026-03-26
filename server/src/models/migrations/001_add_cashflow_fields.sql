-- Migration: Add tax and net_cashflow columns to financial_periods
-- Run this on existing databases to add the new cash flow fields.
-- Safe to run multiple times (uses IF NOT EXISTS pattern via DO block).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'financial_periods' AND column_name = 'tax'
  ) THEN
    ALTER TABLE financial_periods ADD COLUMN tax NUMERIC(15,1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'financial_periods' AND column_name = 'net_cashflow'
  ) THEN
    ALTER TABLE financial_periods ADD COLUMN net_cashflow NUMERIC(15,1);
  END IF;
END
$$;
