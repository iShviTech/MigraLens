import { runPerformanceCli } from "../audit/performance.js";

runPerformanceCli().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
