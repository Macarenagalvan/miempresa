import {getMeta,putMeta} from '../storage/repos/meta.js';
import {getAccount} from '../storage/repos/accounts.js';
import {MT5_SOURCE_TIMEZONES} from '../config.js';

export function importPreference(meta,accountId){
 return meta?.mt5Profiles?.[accountId] || (meta?.mt5Sync?.accountId===accountId?{timeZone:meta.mt5Sync.timeZone,broker:'',login:''}:null);
}
export async function saveImportPreference(accountId,input){
 const account=await getAccount(accountId);
 if(!account||account.status==='ARCHIVED')throw new Error('Elegí una cuenta activa.');
 if(!MT5_SOURCE_TIMEZONES.includes(input.timeZone))throw new Error('Elegí el horario del servidor.');
 const login=String(input.login||'').trim();if(login&&!/^\d+$/.test(login))throw new Error('El número MT5 solo debe contener dígitos.');
 const meta=await getMeta();
 const next={broker:String(input.broker||'').trim().slice(0,120),login,timeZone:input.timeZone};
 await putMeta({...meta,mt5LastAccountId:accountId,mt5Profiles:{...meta.mt5Profiles,[accountId]:next}});
 return next;
}
