import { runCli } from "./cli/main.js";

runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n오류: ${message}`);
  process.exitCode = 1;
});
