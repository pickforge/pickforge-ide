# Drift Schema Snapshots

`pickforge_database_v6.json` is the first tracked Drift schema snapshot.
Earlier schema versions predate this snapshot policy and are represented by the
hand-built migration fixtures in `test/core/drift/migration_v*_to_v*_test.dart`.

When `PickforgeDatabase.schemaVersion` changes:

1. Generate a new snapshot:

   ```bash
   fvm dart run drift_dev schema dump lib/core/drift/pickforge_database.dart test/core/drift/schema/pickforge_database_v<N>.json
   ```

2. Keep the previous snapshot.
3. Add or update migration tests from every released schema version to the
   latest schema.
4. Record the migration and backup decision in the release PR.
