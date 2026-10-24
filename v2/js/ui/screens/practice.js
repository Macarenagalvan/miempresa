import { el } from '../render.js';
import { field } from '../forms/observation.js';
import { listHoyNotes, addOfficeNote, updateOfficeNote } from '../../domain/office-note.js';
import { link } from '../journal-insights.js';

export async function renderPractice(){
 const notes=await listHoyNotes();
 const now=new Date(),day=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
 const planPrefix='Mi plan de trading\n',routinePrefix='Mi rutina · '+day+'\n';
 let plan=notes.find(n=>n.text.startsWith(planPrefix)),routine=notes.find(n=>n.text.startsWith(routinePrefix));
 const planText=el('textarea',{className:'input',rows:'12',name:'trading-plan',placeholder:'Escribí tus reglas, mercados, horarios, condiciones de entrada, gestión del riesgo y condiciones para dejar de operar.'});
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
 return [el('section',{className:'panel'},[el('p',{className:'kicker',text:'Preparar · operar · revisar'}),el('h1',{text:'Mi plan y rutina'}),el('p',{className:'meta',text:'Tus reglas y tu revisión diaria, junto a las operaciones. Se conservan como notas del journal.'}),el('div',{className:'journal-actions'},[link('Revisar operaciones','historial'),link('Ver estadísticas','numeros'),link('Respaldar mis datos','sistema')])]),el('div',{className:'journal-two'},[el('section',{className:'panel'},[el('h2',{text:'Mi plan de trading'}),field('Reglas personales',planText),save,result]),el('section',{className:'panel'},[el('h2',{text:'Rutina · '+day}),...boxes.map(({text,box})=>el('label',{className:'journal-confirm'},[box,el('span',{text})])),field('Reflexión del día',journal),saveRoutine,routineStatus])]),err];
}
