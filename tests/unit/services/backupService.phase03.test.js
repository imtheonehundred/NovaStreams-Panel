'use strict';

const fs = require('fs');
const path = require('path');

describe('Phase 03 backup safety follow-up', () => {
  const backupServiceJs = fs.readFileSync(path.join(__dirname, '../../../services/backupService.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(__dirname, '../../../routes/admin.js'), 'utf8');

  it('creates the restore safety backup without pruning until after import', () => {
    expect(backupServiceJs).toContain('const safetyBackup = await createBackup({ skipPrune: true });');
    expect(backupServiceJs).toContain('await runCommand(cmd);\n  await pruneOldBackups();');
    expect(backupServiceJs).not.toContain('const safetyBackup = await createBackup();');
  });

  it('enforces safety backup creation in the admin restore route source', () => {
    expect(adminJs).toContain('await backupService.restoreBackup(rows[0].filename);');
    expect(adminJs).not.toContain('createSafetyBackup: req.body');
    expect(adminJs).not.toContain('createSafetyBackup !== false');
  });
});
