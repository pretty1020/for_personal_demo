import { usesJson } from "@/lib/db";
import { runStandaloneValidationForFile } from "@/lib/standalone/run-validation";
import { runMariaDbValidationForFile } from "@/lib/services/mariadb-validation";

export async function runValidationForFile(fileId: string): Promise<void> {
  if (usesJson()) {
    await runStandaloneValidationForFile(fileId);
    return;
  }
  await runMariaDbValidationForFile(fileId);
}
