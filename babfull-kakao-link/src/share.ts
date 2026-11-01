import { startLocalShareServer } from "./share/localShareServer.js";

try {
  startLocalShareServer();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`오류: ${message}`);
  process.exitCode = 1;
}
