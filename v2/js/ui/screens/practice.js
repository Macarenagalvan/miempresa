import { el } from '../render.js';
import { field } from '../forms/observation.js';
import { listHoyNotes, addOfficeNote, updateOfficeNote } from '../../domain/office-note.js';
import { link } from '../journal-insights.js';
import { getPlanRules, savePlanRules, normalizeRules, hasRules } from '../../domain/plan-rules.js';
import { confirmDialog, toast } from '../feedback.js';

const PLAN_PREFIX = 'Mi plan de trading\n';

function numInput(name, value, placeholder) {
  return el('input', { className: 'input', type: 'number', min: '0', step: 'any', inputmode: 'decimal', name, value: value == null ? '' : String(value), placeholder: placeholder || 'apagada' });
}

function rulesPanel(rules) {
  const r = rules || normalizeRules({});
  const f = {
    maxIdeas: numInput('maxIdeas', r.maxIdeas), maxLosses: numInput('maxLosses', r.maxLosses), signalsLimit: numInput('signalsLimit', r.signalsLimit),
    propRisk: numInput('propRisk', r.prop.risk), propStop: numInput('propStop', r.prop.dailyStop), propCap: numInput('propCap', r.prop.dailyCap), propWeek: numInput('propWeek', r.prop.weeklyStop),
    ownRisk: numInput('ownRisk', r.own.risk), ownStop: numInput('ownStop', r.own.dailyStop),
    ladder: el('input', { className: 'input', name: 'ladder', value: r.funded.ladder.join(' / '), placeholder: 'ej. 75 / 100 / 125' }),
    drop: numInput('drop', r.funded.dropAfter),
  };
  const status = el('p', { role: 'status' });
  const save = el('button', { type: 'button', text: 'Guardar reglas' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await savePlanRules({
        maxIdeas: f.maxIdeas.value, maxLosses: f.maxLosses.value, signalsLimit: f.signalsLimit.value,
        prop: { risk: f.propRisk.value, dailyStop: f.propStop.value, dailyCap: f.propCap.value, weeklyStop: f.propWeek.value },
        own: { risk: f.ownRisk.value, dailyStop: f.ownStop.value },
        funded: { ladder: f.ladder.value.split(/[\/;,\s]+/).filter(Boolean), dropAfter: f.drop.value },
      });
      status.textContent = 'Reglas guardadas. En Hoy vas a ver cómo vas.';
    } catch (e) { status.textContent = e.message; } finally { save.disabled = false; }
  });
  const grid = (items) => el('div', { className: 'plan-rule-grid' }, items.map(([label, input]) => field(label, input)));
  return el('section', { className: 'panel' }, [
    el('h2', { text: 'Reglas en números' }),
    el('p', { className: 'meta', text: 'El journal las controla en Hoy. Vacío = regla apagada. Montos en la moneda de cada cuenta.' }),
    el('h3', { text: 'Para mí (todas las cuentas juntas)' }),
    grid([['Ideas máximas por día', f.maxIdeas], ['Pérdidas que cierran el día', f.maxLosses], ['Señales que cierran el día', f.signalsLimit]]),
    el('h3', { text: 'Challenge y fondeada (cada cuenta)' }),
    grid([['Riesgo por trade', f.propRisk], ['Stop diario', f.propStop], ['Techo diario', f.propCap], ['Stop semanal', f.propWeek]]),
    el('h3', { text: 'Capital propio' }),
    grid([['Riesgo por trade', f.ownRisk], ['Stop diario', f.ownStop]]),
    el('h3', { text: 'Fondeada: escalera de riesgo' }),
    grid([['Riesgo por escalón (sube con cada cobro)', f.ladder], ['Bajar un escalón si caigo', f.drop]]),
    save, status,
  ]);
}

function decodePlanLink(raw) {
  const b64 = String(raw).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  if (!data || (typeof data.text !== 'string' && !data.rules)) throw new Error('Link inválido.');
  const rules = data.rules ? normalizeRules(data.rules) : null;
  return { text: typeof data.text === 'string' ? data.text.slice(0, 20000) : null, rules: rules && hasRules(rules) ? rules : null, append: data.mode === 'append' };
}

async function applyPlanLink(raw, notes) {
  history.replaceState(null, '', '#/practica');
  let pack;
  try { pack = decodePlanLink(raw); } catch (_) { toast('El link no se pudo leer.', { tone: 'error' }); return; }
  const current = notes.find((n) => n.text.startsWith(PLAN_PREFIX));
  const body = [];
  if (pack.text) body.push(pack.append && current ? 'Agrega una sección al final de tu plan. Lo que ya tenías no se toca.' : (current ? 'Reemplaza el texto de tu plan por la versión nueva.' : 'Carga el texto de tu plan.'));
  if (pack.rules) body.push('Carga las reglas en números. Desde ahora Hoy te avisa cuando llegás a un límite.');
  const ok = await confirmDialog({ title: '¿Cargar tu trading plan?', body, confirmText: 'Sí, cargar' });
  if (!ok) return;
  if (pack.text) {
    const already = pack.append && current && current.text.includes(pack.text.trim());
    const text = pack.append && current ? (already ? current.text : current.text.replace(/\s+$/, '') + '\n\n' + pack.text) : PLAN_PREFIX + pack.text;
    if (current) await updateOfficeNote(current.id, { text }); else await addOfficeNote({ text });
  }
  if (pack.rules) await savePlanRules(pack.rules);
  toast('Plan cargado.', { tone: 'ok', timeout: 3000 });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export async function renderPractice(ctx) {
 const notes=await listHoyNotes();
 if (ctx?.route?.query?.cargar) { const raw = ctx.route.query.cargar; setTimeout(() => applyPlanLink(raw, notes), 50); }
 const rules = await getPlanRules();
 const now=new Date(),day=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
 const planPrefix=PLAN_PREFIX,routinePrefix='Mi rutina · '+day+'\n';
 let plan=notes.find(n=>n.text.startsWith(planPrefix)),routine=notes.find(n=>n.text.startsWith(routinePrefix));
 const planText=el('textarea',{className:'input',rows:'16',name:'trading-plan',placeholder:'Escribí tus reglas, mercados, horarios, condiciones de entrada, gestión del riesgo y condiciones para dejar de operar.'});
 planText.value=plan?plan.text.slice(planPrefix.length):'';
 const result=el('p',{role:'status','aria-live':'polite'}),err=el('p',{className:'err',role:'alert'});
 const save=el('button',{type:'button',text:'Guardar mi plan'});
 save.addEventListener('click',async()=>{save.disabled=true;err.textContent='';try{if(!planText.value.trim())throw new Error('Escribí tu plan antes de guardarlo.');const text=planPrefix+planText.value;plan=plan?await updateOfficeNote(plan.id,{text}):await addOfficeNote({text});result.textContent='Plan guardado. Se incluye en tus respaldos y notas.';}catch(e){err.textContent=e.message;}finally{save.disabled=false;}});
 const tasks=['Revisé mi plan y las condiciones del día','Definí el riesgo y mis límites de hoy','Registré las operaciones y sus capturas','Revisé los resultados y anoté lo aprendido'];
 const boxes=tasks.map(text=>{const box=el('input',{type:'checkbox'});box.checked=Boolean(routine?.text.includes('[x] '+text));return {text,box};});
 const journal=el('textarea',{className:'input',rows:'4',placeholder:'Cómo me sentí, qué respeté y qué quiero mejorar.',name:'routine-note'});
 journal.value=routine?.text.split('\nReflexión:\n')[1]||'';
 const saveRoutine=el('button',{type:'button',text:'Guardar rutina de hoy'}),routineStatus=el('p',{role:'status'});
 saveRoutine.addEventListener('click',async()=>{saveRoutine.disabled=true;err.textContent='';try{const text=routinePrefix+boxes.map(({text,box})=>(box.checked?'[x] ':'[ ] ')+text).join('\n')+'\nReflexión:\n'+journal.value;routine=routine?await updateOfficeNote(routine.id,{text}):await addOfficeNote({text});routineStatus.textContent='Rutina del '+day+' guardada.';}catch(e){err.textContent=e.message;}finally{saveRoutine.disabled=false;}});
 return [el('section',{className:'panel'},[el('h1',{text:'Mi plan y rutina'})]),rulesPanel(rules),el('div',{className:'journal-two'},[el('section',{className:'panel'},[el('h2',{text:'Mi plan de trading'}),field('Plan completo',planText),save,result]),el('section',{className:'panel'},[el('h2',{text:'Rutina · '+day}),...boxes.map(({text,box})=>el('label',{className:'journal-confirm'},[box,el('span',{text})])),field('Reflexión del día',journal),saveRoutine,routineStatus])]),err];
}
