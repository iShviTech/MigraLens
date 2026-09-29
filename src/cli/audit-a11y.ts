import { runAccessibilityCli } from "../audit/accessibility.js";

runAccessibilityCli().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
