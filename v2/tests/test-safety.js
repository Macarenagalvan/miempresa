import { isolatedQa, journalDatabaseName } from '../js/runtime-isolation.js';
if (!isolatedQa || !journalDatabaseName.startsWith('JournalV2-QA-')) {
  throw new Error('Pruebas bloqueadas: ejecutá el runner aislado. No se abre la base real del Journal.');
}
