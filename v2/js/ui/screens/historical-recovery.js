import { el } from '../render.js';
import { field } from '../forms/observation.js';
import { go } from '../router.js';
import { reviewHistoricalStudy, convertHistoricalStudy, studyOutcomeLabel } from '../../domain/historical-study.js';
import { listTradeImages } from '../../storage/repos/attachments.js';

export function historicalCaptures(images) {
  return el('div', { className: 'thumb-row' }, images.map(image => {
    if (!(image.blob instanceof Blob) || !image.blob.size) return el('p', { className: 'err', text: 'Captura sin contenido recuperable: ' + (image.name || image.id) });
    const src = URL.createObjectURL(image.blob);
    const img = el('img', { className: 'thumb', src, alt: image.name || 'Gráfico histórico original' });
    img.onload = () => URL.revokeObjectURL(src);
    return el('div', { className: 'thumb-card' }, [img, el('p', { text: image.name || 'Captura original' })]);
  }));
}
export async function renderHistoricalTrade(ctx, trade) {
  const images = await listTradeImages(trade.id);
  const nodes = [el('h1', { text: trade.asset || 'Histórico por revisar' }),
    el('p', { className: 'kicker', text: trade.studyConversion ? 'Original conservado · vinculado a un estudio' : 'Registro antiguo pendiente de clasificar' }),
    el('p', { text: 'Este análisis no exige rellenar precios ni resultados ficticios. Revisá si fue un estudio o una operación simulada.' }),
    el('p', { text: trade.note || 'Sin notas originales.' }),
    historicalCaptures(images), el('p', { className: 'meta', text: 'Procedencia: ' + (trade.sourceRef?.importId || trade.recordSource || 'Sin especificar') }),
    el('a', { href: '#/backtesting', text: 'Volver a Backtesting' })];
  if (trade.studyConversion) {
    nodes.push(el('button', { type: 'button', text: 'Abrir estudio recuperado', onclick: () => go('observacion/' + trade.studyConversion.observationId) }));
    return [el('section', { className: 'panel historical-recovery' }, nodes)];
  }
  const review = await reviewHistoricalStudy(trade.id);
  nodes.push(el('p', { text: review.date.date ? 'Fecha histórica disponible: ' + review.date.date : 'Fecha histórica desconocida o incierta. No se usará la fecha de importación.' }));
  for (const source of review.date.sources) nodes.push(el('p', { className: 'meta', text: 'Fecha original (' + source.field + '): ' + source.value }));
  if (review.existing) nodes.push(el('a', { href: '#/observacion/' + review.existing.id, text: 'Ver estudio conservado tras la reversión' }));
  if (review.blockers.length) nodes.push(el('p', { className: 'err', role: 'alert', text: review.blockers.join(' ') }));
  else {
    const outcome = el('select', { className: 'input', name: 'recoveryOutcome' }, ['UNREVIEWED', 'NO_TRADE', 'TRADE_TAKEN'].map(value => el('option', { value, text: studyOutcomeLabel(value) })));
    outcome.value = review.existing?.studyOutcome || 'UNREVIEWED';
    const reviewed = el('input', { type: 'checkbox', name: 'recoveryReviewed' });
    const unknown = el('input', { type: 'checkbox', name: 'recoveryUnknownDate' });
    const error = el('p', { className: 'err', role: 'alert' });
    const convert = el('button', { type: 'button', text: 'Convertir en estudio', disabled: true });
    const enable = () => { convert.disabled = !reviewed.checked || (review.date.uncertain && !unknown.checked); };
    reviewed.onchange = enable; unknown.onchange = enable;
    convert.onclick = async () => {
      if (convert.disabled) return;
      convert.disabled = true;
      try {
        const study = await convertHistoricalStudy(trade.id, { signature: review.signature, reviewed: reviewed.checked, acceptUnknownDate: unknown.checked, outcome: outcome.value });
        go('observacion/' + study.id);
      } catch (e) { error.textContent = e.message; enable(); }
    };
    nodes.push(field('Clasificación del estudio', outcome), el('label', {}, [reviewed, ' Revisé el original y sus capturas; corresponde a un estudio histórico.']),
      review.date.uncertain ? el('label', {}, [unknown, ' Conservar fecha desconocida; no voy a inventar una fecha.']) : null,
      el('p', { className: 'hint', text: 'Se conservarán el original y sus gráficos. Podrás revertir desde el estudio. La recuperación se realiza solo con sincronización pausada.' }), error, convert);
  }
  nodes.push(el('button', { type: 'button', className: 'ghost', text: 'Revisar como operación simulada', onclick: () => go('trade/' + trade.id + '/editar') }));
  return [el('section', { className: 'panel historical-recovery' }, nodes)];
}
