// Portable references survive export/restore. No database or network access here.
export function recoveryErrors({ trades = [], observations = [], attachments = [] }) {
  const errors = [], seen = new Set();
  for (const obs of observations.filter(o => o.recovery)) {
    const r = obs.recovery, trade = trades.find(t => t.id === r.tradeId);
    if (seen.has(r.tradeId)) errors.push('Hay dos estudios de recuperación para el mismo original.');
    seen.add(r.tradeId);
    if (r.version !== 1 || !trade || r.originalTrade?.id !== r.tradeId || r.originalTrade?.context !== 'BACKTEST' || r.originalTrade?.studyConversion || obs.context !== 'BACKTEST' || obs.stageId !== trade.stageId) errors.push('Vínculo de recuperación histórica inválido.');
    if (!Array.isArray(r.attachmentIds) || new Set(r.attachmentIds).size !== r.attachmentIds.length) errors.push('Referencias de capturas históricas inválidas.');
    else for (const id of r.attachmentIds) if (!attachments.some(a => a.id === id && a.entityType === 'trade' && a.entityId === r.tradeId)) errors.push('Falta una captura original del estudio recuperado.');
    if (!obs.archived && trade?.studyConversion?.observationId !== obs.id) errors.push('El estudio activo perdió el vínculo con su original.');
    if (!obs.archived && trade) {
      const { studyConversion, ...original } = trade;
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
      if (JSON.stringify(canonical(original)) !== JSON.stringify(canonical(r.originalTrade))) errors.push('La copia de recuperación no coincide con el original conservado.');
    }
    if (!Array.isArray(r.history) || !r.dateProvenance || !Array.isArray(r.dateProvenance.sources)) errors.push('Falta la trazabilidad de la recuperación.');
    if (obs.archived && trade?.studyConversion?.observationId === obs.id) errors.push('La reversión conserva un vínculo activo inválido.');
  }
  for (const trade of trades.filter(t => t.studyConversion)) {
    if (!observations.some(o => o.id === trade.studyConversion.observationId && !o.archived && o.recovery?.tradeId === trade.id)) errors.push('El original apunta a un estudio ausente.');
  }
  return errors;
}
