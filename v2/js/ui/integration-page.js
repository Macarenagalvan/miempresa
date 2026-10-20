import { getAuthClient, readSupabaseConfig } from '../services/auth.js';
import { MACA_OAUTH_CLIENT_ID } from '../integration-config.js';
import { getMeta } from '../storage/repos/meta.js';
import { el } from './render.js';

const status=document.getElementById('status'), content=document.getElementById('content');
document.getElementById('reload').onclick=()=>location.reload();
const labels={asset:'Activo',direction:'Dirección',openedAt:'Fecha de entrada',entry:'Entrada',initialSL:'Stop Loss',tp:'Take Profit',strategy:'Estrategia',result:'Resultado',exit:'Salida',closedAt:'Fecha de cierre',netPnl:'Resultado monetario',note:'Observaciones'};
function button(label,action) {
  const node=el('button',{type:'button',text:label});
  node.onclick=async()=>{node.disabled=true;try{await action();}catch(e){status.textContent=e.message;node.disabled=false;}};
  return node;
}
async function start() {
  if(top!==self) throw Error('Abrí esta página directamente para confirmar.');
  const client=await getAuthClient();
  if(!client) throw Error('Configurá la sincronización en Maca primero.');
  const {data,error}=await client.auth.getSession();
  if(error || !data.session) throw Error('Iniciá sesión en Maca y volvé a comprobar.');
  const {data:verified,error:verificationError}=await client.auth.getUser();
  if(verificationError || !verified?.user) throw Error('La sesión no es válida. Volvé a iniciar sesión.');
  const params=new URLSearchParams(location.search);
  async function rpc(name,args) {const {data,error}=await client.rpc(name,args);if(error) throw Error(error.message);return data;}
  status.textContent='Sesión: '+verified.user.email;
  if(params.has('proposal')) {
    const id=params.get('proposal');
    const review=await rpc('maca_review',{p_id:id,p_approve:false});
    content.append(el('h2',{text:review.trade.isDraft?'Guardar como BORRADOR':'Guardar backtest cerrado'}));
    const list=el('dl',{});
    for(const [key,label] of Object.entries(labels)) {
      const draftField={result:'draftResult',exit:'draftExit',closedAt:'draftClosedAt',netPnl:'draftNetPnl'}[key];
      const value=review.trade[key]??review.trade[draftField];
      list.append(el('dt',{text:label}),el('dd',{text:value==null?'Sin completar':String(value)}));
    }
    content.append(list,el('p',{text:'Faltantes: '+(review.missing.map(k=>labels[k]||k).join(', ')||'Ninguno')}));
    content.append(button('Confirmo estos datos y autorizo guardarlos',async()=>{
      await rpc('maca_review',{p_id:id,p_approve:true});
      content.replaceChildren(el('p',{text:'Aprobado. Volvé a ChatGPT y pedile guardar la propuesta confirmada. La aprobación vence a los 30 minutos de preparada.'}));
    }),button('Cancelar',async()=>{location.href='../index.html#/backtesting';}));
    return;
  }
  if(!MACA_OAUTH_CLIENT_ID) throw Error('La integración todavía no fue configurada para esta versión.');
  async function connection(enabled) {
    const meta=await getMeta();
    return rpc('maca_connection',{p_client_id:MACA_OAUTH_CLIENT_ID,p_stage_id:meta?.activeStageId||'',p_enabled:enabled});
  }
  if(params.has('authorization_id')) {
    const id=params.get('authorization_id'), cfg=readSupabaseConfig();
    // This isolated consent page uses the documented Auth REST endpoints;
    // it does not upgrade or change the application's existing Auth SDK.
    async function oauth(path,body) {
      const {data:sessionData}=await client.auth.getSession();
      const response=await fetch(cfg.url+'/auth/v1/oauth/authorizations/'+encodeURIComponent(id)+path,{
        method:body?'POST':'GET',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+sessionData.session.access_token,'Content-Type':'application/json'},
        ...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok) throw Error('No se pudo validar la autorización OAuth.');return response.json();
    }
    const details=await oauth('');
    const request=await rpc('maca_oauth_request',{p_authorization_id:id});
    if(request.clientId!==MACA_OAUTH_CLIENT_ID || request.scope!=='email' || new URL(request.redirectUri).origin!=='https://chatgpt.com') throw Error('Cliente o permisos no autorizados.');
    if(details.client && details.client.id!==MACA_OAUTH_CLIENT_ID) throw Error('Cliente no autorizado.');
    content.append(el('h2',{text:'Conectar '+(details.client?.name||'Maca Backtesting')}),
      el('p',{text:'Compartirá tu correo para identificar la sesión. Solo podrá preparar backtests y guardar los que apruebes. No tendrá acceso a cuentas, saldos, operaciones reales ni órdenes.'}),
      button('Autorizar integración de Backtesting',async()=>{
        await connection(true);
        const result=details.redirect_url?details:await oauth('/consent',{action:'approve'});
        const redirect=new URL(result.redirect_url);
        if(redirect.protocol!=='https:' || redirect.origin!=='https://chatgpt.com') throw Error('Destino OAuth no permitido.');
        location.href=redirect.href;
      }),button('Rechazar',async()=>{
        if(details.redirect_url) {await connection(false);location.href='../index.html#/backtesting';return;}
        const result=await oauth('/consent',{action:'deny'});const redirect=new URL(result.redirect_url);
        if(redirect.protocol!=='https:' || redirect.origin!=='https://chatgpt.com') throw Error('Destino OAuth no permitido.');
        location.href=redirect.href;
      }));
  } else content.append(el('p',{text:'Desconectar bloquea inmediatamente nuevos guardados y descarta las aprobaciones pendientes. Los registros guardados se conservan.'}),
    button('Desconectar ChatGPT',async()=>{await connection(false);content.replaceChildren(el('p',{text:'Integración desconectada. Quitá también la conexión en ChatGPT → Apps.'}));}));
}
start().catch(e=>{status.textContent=e.message;});
