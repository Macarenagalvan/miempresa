import {el} from './render.js';
import {go} from './router.js';
import {previewDeletion,deleteEntity} from '../domain/delete-entity.js';

export function deleteButton(kind,record,after){
 const button=el('button',{type:'button',className:'ghost delete-entity',text:'Borrar','aria-label':'Borrar '+(typeof record==='function'?'cuenta seleccionada':record.name||record.firm)});
 button.addEventListener('click',async()=>{
  const target=typeof record==='function'?record():record;if(!target)return;
  button.disabled=true;
  const dialog=el('dialog',{className:'delete-dialog','aria-labelledby':'delete-title'});
  const summary=el('div'),error=el('p',{className:'err',role:'alert'}),include=el('input',{type:'checkbox'});
  const cancel=el('button',{type:'button',className:'ghost',text:'Cancelar'}),confirm=el('button',{type:'button',className:'delete-entity',text:'Sí, borrar',disabled:true});confirm.disabled=true;
  let preview=null,version=0,busy=false;
  const option=el('label',{className:'journal-confirm'},[include,el('span',{text:'Borrar también las cuentas vinculadas y sus operaciones'})]);option.hidden=true;
  const load=async()=>{const v=++version;confirm.disabled=true;error.textContent='';try{const p=await previewDeletion(kind,target.id,include.checked);if(v!==version)return;preview=p;option.hidden=kind!=='challenge'||!p.related;summary.replaceChildren(el('p',{text:'Vas a borrar «'+p.name+'».'}),el('p',{text:`Se eliminarán ${p.counts.accounts} cuentas, ${p.counts.trades} operaciones, ${p.counts.movements} movimientos, ${p.counts.asrs} revisiones, ${p.counts.attachments} capturas y ${p.counts.payouts} cobros de fondeo.`}),kind==='challenge'&&!include.checked?el('p',{text:'Las cuentas vinculadas y sus operaciones se conservan; se quita su vínculo con este fondeo.'}):el('p',{text:'Las demás cuentas y fondeos se conservan.'}),el('p',{className:'hint',text:'El borrado es permanente en el journal. No cambia nada en MT5. Podés guardar un respaldo desde Configuración antes de continuar.'}));confirm.disabled=false;}catch(e){error.textContent=e.message;}};
  cancel.onclick=()=>dialog.close();include.onchange=load;
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dialog.addEventListener('close',()=>{version++;dialog.remove();button.disabled=false;});
  confirm.onclick=async()=>{if(busy||confirm.disabled||!preview)return;busy=true;confirm.disabled=cancel.disabled=include.disabled=true;error.textContent='';try{await deleteEntity(kind,target.id,include.checked,preview.signature);dialog.close();go(after|| (kind==='account'?'cuentas':'fondeo'));}catch(e){error.textContent=e.message;cancel.disabled=false;}finally{busy=false;}};
  dialog.append(el('h2',{id:'delete-title',text:kind==='account'?'Borrar cuenta':'Borrar fondeo'}),summary,option,error,el('div',{className:'row-actions'},[cancel,confirm]));document.body.append(dialog);dialog.showModal();cancel.focus();await load();
 });return button;
}
export const deletableRow=(row,kind,record,after)=>el('div',{className:'deletable-row'},[row,deleteButton(kind,record,after)]);
