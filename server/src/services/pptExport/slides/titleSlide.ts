/**
 * Slide 1 — Title Slide
 *
 * Scenario name, acquirer + target, date, ECIT branding.
 */
import PptxGenJS from "pptxgenjs";
import type { ExportData } from "../../excelExport/types.js";
import { COLORS, FONTS, SLIDE_WIDTH, SLIDE_HEIGHT } from "../styles.js";

export function buildTitleSlide(pres: PptxGenJS, data: ExportData): void {
  const slide = pres.addSlide();

  // Full-slide navy background
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT,
    fill: { color: COLORS.navy },
  });

  // Gold accent line
  slide.addShape("rect", {
    x: 1, y: 2.2, w: SLIDE_WIDTH - 2, h: 0.04,
    fill: { color: COLORS.gold },
  });

  // Title — scenario name
  slide.addText(data.scenarioName, {
    x: 1, y: 2.5, w: SLIDE_WIDTH - 2, h: 1,
    fontFace: FONTS.title,
    fontSize: 32,
    bold: true,
    color: COLORS.white,
    align: "center",
  });

  // Subtitle — companies
  slide.addText(`${data.acquirerName}  +  ${data.targetName}`, {
    x: 1, y: 3.4, w: SLIDE_WIDTH - 2, h: 0.5,
    fontFace: FONTS.body,
    fontSize: 18,
    color: COLORS.gold,
    align: "center",
  });

  // Another gold line
  slide.addShape("rect", {
    x: 1, y: 4.1, w: SLIDE_WIDTH - 2, h: 0.04,
    fill: { color: COLORS.gold },
  });

  // Sub-subtitle — "Investment Committee Presentation"
  slide.addText("Investment Committee Presentation", {
    x: 1, y: 4.4, w: SLIDE_WIDTH - 2, h: 0.4,
    fontFace: FONTS.body,
    fontSize: 14,
    color: COLORS.lightBlue,
    align: "center",
  });

  // Date
  const dateStr = new Date().toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  slide.addText(dateStr, {
    x: 1, y: 5.2, w: SLIDE_WIDTH - 2, h: 0.4,
    fontFace: FONTS.body,
    fontSize: 12,
    color: COLORS.lightBlue,
    align: "center",
  });

  // Bottom branding
  slide.addText("ECIT  |  Confidential", {
    x: 0.5, y: SLIDE_HEIGHT - 0.5, w: SLIDE_WIDTH - 1, h: 0.3,
    fontFace: FONTS.body,
    fontSize: 8,
    color: "667799",
    align: "center",
  });
}
