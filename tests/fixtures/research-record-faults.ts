import Database from "better-sqlite3";

/** Injects a real SQLite failure at the Validator completion write seam. */
export async function withValidatorCompletionWriteFailure<T>(
  databasePath: string,
  action: () => Promise<T>,
): Promise<T> {
  const triggerName = "fail_validator_completion_write";
  const database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON research_events
      WHEN NEW.kind = 'campaign.attempt-completed'
        AND NEW.schema_version = 2
        AND json_extract(NEW.payload_json, '$.completion.role') = 'validator'
      BEGIN
        SELECT RAISE(ABORT, 'Injected Validator completion write failure');
      END;
    `);
  } finally {
    database.close();
  }
  try {
    return await action();
  } finally {
    const cleanup = new Database(databasePath);
    try {
      cleanup.exec(`DROP TRIGGER ${triggerName}`);
    } finally {
      cleanup.close();
    }
  }
}
