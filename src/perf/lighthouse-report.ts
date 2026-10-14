import type { LighthousePageReport } from "../types.js";
import { logWarn } from "../utils/logger.js";
import { renderPerfHtml, unwrapLhr } from "./extract.js";

type GenerateReportHtml = (lhr: unknown) => string;

let generator: Promise<GenerateReportHtml | null> | undefined;

/** Only the report generator is loaded; Lighthouse's Chrome runner is never used. */
function loadGenerator(): Promise<GenerateReportHtml | null> {
  generator ??= import("lighthouse/report/generator/report-generator.js")
    .then(({ ReportGenerator }) => (lhr: unknown) => ReportGenerator.generateReportHtml(lhr as never))
    .catch((error: unknown) => {
      logWarn("Lighthouse report generator unavailable; using the MigraLens fallback report", {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });
  return generator;
}

/** Official Google Lighthouse HTML report when a full LHR is available, otherwise the MigraLens summary page. */
export async function renderLighthouseReportHtml(report: LighthousePageReport, lhr: unknown): Promise<string> {
  const result = unwrapLhr(lhr);
  if (result) {
    const generate = await loadGenerator();
    if (generate) {
      try {
        return generate(result);
      } catch (error) {
        logWarn("Lighthouse report generation failed; using fallback", {
          url: report.url,
          device: report.device,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return renderPerfHtml(report);
}
