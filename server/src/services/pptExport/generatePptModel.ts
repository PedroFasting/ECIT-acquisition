/**
 * PPT Export Service — Investment Committee Presentation
 *
 * Generates a .pptx presentation per scenario containing 8 slides:
 *   1. Title — Scenario name, companies, date, ECIT branding
 *   2. Transaction Overview — Key deal params + entry EV summary
 *   3. Pro Forma P&L — Revenue/EBITDA bars + margin table
 *   4. Sources & Uses — S&U tables + EV composition donut
 *   5. Leverage & Debt — Debt bars + leverage metrics
 *   6. Equity Bridge — EV → EQV → per-share waterfall
 *   7. Deal Returns — IRR/MoM heatmap matrices
 *   8. Sensitivity — Heatmap + synergies timeline
 *
 * Uses the same ExportData object as the Excel export.
 */

import PptxGenJS from "pptxgenjs";
import type { ExportData } from "../excelExport/types.js";

import { buildTitleSlide } from "./slides/titleSlide.js";
import { buildTransactionOverviewSlide } from "./slides/transactionOverview.js";
import { buildProFormaSlide } from "./slides/proFormaSlide.js";
import { buildSourcesUsesSlide } from "./slides/sourcesUsesSlide.js";
import { buildDebtProfileSlide } from "./slides/debtProfileSlide.js";
import { buildEquityBridgeSlide } from "./slides/equityBridgeSlide.js";
import { buildDealReturnsSlide } from "./slides/dealReturnsSlide.js";
import { buildSensitivitySlide } from "./slides/sensitivitySlide.js";

export async function generatePptModel(data: ExportData): Promise<PptxGenJS> {
  const pres = new PptxGenJS();

  // Presentation metadata
  pres.author = "ECIT Acquisition Analysis";
  pres.company = "ECIT";
  pres.subject = data.scenarioName;
  pres.title = `${data.scenarioName} — IC Deck`;

  // 16:9 widescreen layout
  pres.layout = "LAYOUT_WIDE";

  // Build all 8 slides
  buildTitleSlide(pres, data);
  buildTransactionOverviewSlide(pres, data);
  buildProFormaSlide(pres, data);
  buildSourcesUsesSlide(pres, data);
  buildDebtProfileSlide(pres, data);
  buildEquityBridgeSlide(pres, data);
  buildDealReturnsSlide(pres, data);
  buildSensitivitySlide(pres, data);

  return pres;
}
