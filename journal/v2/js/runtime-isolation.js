// Only the offline runner's reserved origin can select a disposable database.
const marker = globalThis.__JOURNAL_QA__;
export const isolatedQa = globalThis.location?.origin === 'https://journal.test'
  && typeof marker === 'string' && /^[a-z0-9-]{16,80}$/.test(marker);
export const journalDatabaseName = isolatedQa ? 'JournalV2-QA-' + marker : 'TradingJournal';
