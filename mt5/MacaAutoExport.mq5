#property strict
#property version "1.00"
#property description "Exporta historial cerrado a CSV MACA. Solo lectura: no envia ordenes ni usa red."
input int IntervaloSegundos=60;

struct PositionRow {
 long id;
 string symbol;
 int side;
 datetime opened,closed;
 double vin,vout,entrysum,exitsum,gross,costs;
 int entries,exits;
 bool unsupported;
};
PositionRow rows[];
string previous="";
int FindRow(long id){for(int i=0;i<ArraySize(rows);i++)if(rows[i].id==id)return i;int n=ArraySize(rows);ArrayResize(rows,n+1);ZeroMemory(rows[n]);rows[n].id=id;rows[n].side=-1;return n;}
string Safe(string s){string bad="\\/:*?\"<>|;";for(int i=0;i<StringLen(bad);i++)StringReplace(s,StringSubstr(bad,i,1),"_");return s;}
string Cell(string s){StringReplace(s,"\"","\"\"");return "\""+s+"\"";}
string Day(datetime t){string s=TimeToString(t,TIME_DATE);StringReplace(s,".","-");return s;}
bool StillOpen(long id){for(int i=0;i<PositionsTotal();i++){if(PositionGetTicket(i)>0&&PositionGetInteger(POSITION_IDENTIFIER)==id)return true;}return false;}
void ExportHistory(){
 if(!TerminalInfoInteger(TERMINAL_CONNECTED)){Comment("MACA: esperando conexion para leer historial.");return;}
 if(!HistorySelect(0,TimeCurrent())){Print("MACA: no se pudo leer historial: ",GetLastError());return;}
 ArrayResize(rows,0);
 int separateCosts=0;
 for(int i=0;i<HistoryDealsTotal();i++){
  ulong ticket=HistoryDealGetTicket(i);if(ticket==0)continue;
  long id=HistoryDealGetInteger(ticket,DEAL_POSITION_ID);
  long type=HistoryDealGetInteger(ticket,DEAL_TYPE);
  if(id<=0){if(type==DEAL_TYPE_COMMISSION||type==DEAL_TYPE_COMMISSION_DAILY||type==DEAL_TYPE_COMMISSION_MONTHLY||type==DEAL_TYPE_CHARGE)separateCosts++;continue;}
  int n=FindRow(id);
  rows[n].gross+=HistoryDealGetDouble(ticket,DEAL_PROFIT);
  rows[n].costs+=HistoryDealGetDouble(ticket,DEAL_COMMISSION)+HistoryDealGetDouble(ticket,DEAL_SWAP)+HistoryDealGetDouble(ticket,DEAL_FEE);
  if(type!=DEAL_TYPE_BUY&&type!=DEAL_TYPE_SELL){rows[n].unsupported=true;continue;}
  string symbol=HistoryDealGetString(ticket,DEAL_SYMBOL);
  if(rows[n].symbol!=""&&rows[n].symbol!=symbol)rows[n].unsupported=true;
  rows[n].symbol=symbol;
  long entry=HistoryDealGetInteger(ticket,DEAL_ENTRY);
  datetime time=(datetime)HistoryDealGetInteger(ticket,DEAL_TIME);
  double volume=HistoryDealGetDouble(ticket,DEAL_VOLUME),price=HistoryDealGetDouble(ticket,DEAL_PRICE);
  if(entry==DEAL_ENTRY_IN){
   if(rows[n].side!=-1&&rows[n].side!=(int)type)rows[n].unsupported=true;
   rows[n].side=(int)type;rows[n].vin+=volume;rows[n].entrysum+=volume*price;rows[n].entries++;
   if(rows[n].opened==0||time<rows[n].opened)rows[n].opened=time;
  }else if(entry==DEAL_ENTRY_OUT||entry==DEAL_ENTRY_OUT_BY){
   rows[n].vout+=volume;rows[n].exitsum+=volume*price;rows[n].exits++;
   if(time>rows[n].closed)rows[n].closed=time;
  }else{rows[n].unsupported=true;}
 }
 string columns="ID;Fecha;Hora;Fecha salida;Hora salida;Duracion;Cuenta;Modo;Estrategia;Variante;Tipo;Direccion;Orden;Activo;Mercado;Sesion;Entrada;SL;TP;Salida;SL tecnico;TP tecnico;Fibonacci;Confirmaciones;Patron;Gestion;Capital inicial;Capital final;Riesgo $;Riesgo %;RR Inicial;RR Final;B/P Bruto;Comisiones;B/P Neto;Resultado;Lotaje;Link;Notas";
 string content="sep=;\r\n"+columns+"\r\n";
 string login=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)),server=Safe(AccountInfoString(ACCOUNT_SERVER));
 int exported=0,skipped=0,opened=0;
 for(int i=0;i<ArraySize(rows);i++){
  if(StillOpen(rows[i].id)){opened++;continue;}
  if(rows[i].unsupported||rows[i].vin<=0||rows[i].vout<=0||MathAbs(rows[i].vin-rows[i].vout)>0.00000001||rows[i].opened==0||rows[i].closed<rows[i].opened){skipped++;continue;}
  string c[39];for(int j=0;j<39;j++)c[j]="";
  double net=NormalizeDouble(rows[i].gross+rows[i].costs,2);
  c[0]=IntegerToString(rows[i].id);c[1]=Day(rows[i].opened);c[2]=TimeToString(rows[i].opened,TIME_MINUTES);c[3]=Day(rows[i].closed);c[4]=TimeToString(rows[i].closed,TIME_MINUTES);
  c[6]=login;c[7]="Operado";c[11]=rows[i].side==DEAL_TYPE_BUY?"Long":"Short";c[13]=rows[i].symbol;
  c[16]=DoubleToString(rows[i].entrysum/rows[i].vin,10);c[19]=DoubleToString(rows[i].exitsum/rows[i].vout,10);
  c[32]=DoubleToString(rows[i].gross,2);c[33]=DoubleToString(rows[i].costs,2);c[34]=DoubleToString(net,2);c[35]=net>0?"Win":net<0?"Loss":"BE";c[36]=DoubleToString(rows[i].vin,8);
  c[38]="MACA_AUTO_V1|server="+server+"|currency="+AccountInfoString(ACCOUNT_CURRENCY)+"|partials="+(rows[i].entries>1||rows[i].exits>1?"1":"0")+"|horario=servidor";
  for(int j=0;j<39;j++)content+=(j>0?";":"")+Cell(c[j]);content+="\r\n";exported++;
 }
 string name="MACA\\maca_mt5_"+server+"_"+login+".csv";
 string status="MACA: "+IntegerToString(exported)+" cerradas; "+IntegerToString(opened)+" abiertas excluidas; "+IntegerToString(skipped)+" posiciones no compatibles; "+IntegerToString(separateCosts)+" cargos sin posicion.\n"+TerminalInfoString(TERMINAL_COMMONDATA_PATH)+"\\Files\\"+name+"\nArrastra el CSV a Importar MT5. El journal no se actualiza solo.";
 if(content==previous){Comment(status);return;}
 FolderCreate("MACA",FILE_COMMON);
 string temp=name+".tmp";
 int f=FileOpen(temp,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON,0,CP_UTF8);
 if(f==INVALID_HANDLE){Print("MACA: no se pudo crear archivo: ",GetLastError());return;}
 ResetLastError();uint written=FileWriteString(f,content);int writeError=GetLastError();FileFlush(f);FileClose(f);
 if(written==0||writeError!=0){Print("MACA: error de escritura; se conserva el CSV anterior.");return;}
 if(!FileMove(temp,FILE_COMMON,name,FILE_COMMON|FILE_REWRITE)){Print("MACA: no se pudo actualizar CSV: ",GetLastError());return;}
 previous=content;Comment(status);Print(status);
}
int OnInit(){if(IntervaloSegundos<10)return INIT_PARAMETERS_INCORRECT;if(!EventSetTimer(IntervaloSegundos))return INIT_FAILED;ExportHistory();return INIT_SUCCEEDED;}
void OnTimer(){ExportHistory();}
void OnDeinit(const int reason){EventKillTimer();Comment("");}
