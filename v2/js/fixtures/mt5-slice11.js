export const MT5_SLICE11_HEADER =
  "ID;Fecha;Hora;Fecha salida;Hora salida;Duracion;Cuenta;Modo;Estrategia;Variante;Tipo;Direccion;Orden;"
  + "Activo;Mercado;Sesion;Entrada;SL;TP;Salida;SL tecnico;TP tecnico;Fibonacci;Confirmaciones;Patron;Gestion;"
  + "Capital inicial;Capital final;Riesgo $;Riesgo %;RR Inicial;RR Final;B/P Bruto;Comisiones;B/P Neto;"
  + "Resultado;Lotaje;Link;Notas";

function row(values) {
  const cols = new Array(39).fill("");
  Object.entries(values).forEach(([idx, val]) => {
    cols[Number(idx)] = String(val);
  });
  return cols.join(";");
}

export const MT5_SLICE11_ROWS = {
  longWin: row({
    0: "10011",
    1: "2026-08-27",
    2: "14:10",
    3: "2026-08-27",
    4: "16:40",
    6: "Bullfy 121791 1 STEP",
    7: "Operado",
    11: "Long",
    13: "EURUSDc",
    14: "Forex",
    16: "1.16850",
    19: "1.17120",
    32: "27.00",
    33: "-2.40",
    34: "24.60",
    35: "Win",
    36: "0.10",
    38: "Auto MT5",
  }),
  shortLoss: row({
    0: "10012",
    1: "2026-08-27",
    2: "15:05",
    3: "2026-08-27",
    4: "17:10",
    6: "Bullfy 121791 1 STEP",
    7: "Operado",
    11: "Short",
    13: "XAUUSD.m",
    14: "Metales",
    16: "2460.20",
    19: "2468.10",
    32: "-18.00",
    33: "-1.50",
    34: "-19.50",
    35: "Loss",
    36: "0.05",
    38: "Auto MT5",
  }),
  beSp500: row({
    0: "10013",
    1: "2026-08-26",
    2: "18:00",
    3: "2026-08-26",
    4: "19:30",
    6: "Bullfy 121791 1 STEP",
    7: "Operado",
    11: "Long",
    13: "US500",
    14: "Indices",
    16: "6462.25",
    19: "6462.25",
    32: "0.80",
    33: "-0.80",
    34: "0.00",
    35: "BE",
    36: "1.00",
    38: "Auto MT5",
  }),
  quotedNote: row({
    0: "10014",
    1: "2026-08-25",
    2: "09:15",
    3: "2026-08-25",
    4: "11:00",
    6: "Bullfy 121791 1 STEP",
    7: "Operado",
    11: "Short",
    13: "NZDUSD",
    14: "Forex",
    16: "0.59010",
    19: "0.58840",
    32: "12.00",
    33: "-0.60",
    34: "11.40",
    35: "Win",
    36: "0.20",
    38: "\"nota;con;puntos\"",
  }),
  unknownSymbol: row({
    0: "19999",
    1: "2026-08-27",
    2: "10:00",
    3: "2026-08-27",
    4: "11:00",
    6: "Bullfy 121791 1 STEP",
    7: "Operado",
    11: "Long",
    13: "FOOBAR99",
    14: "Forex",
    16: "1.00000",
    19: "1.00100",
    32: "1.00",
    33: "0.00",
    34: "1.00",
    35: "Win",
    36: "0.10",
    38: "Auto MT5",
  }),
  invalidNoId: row({
    1: "2026-08-27",
    2: "10:00",
    3: "2026-08-27",
    4: "11:00",
    11: "Long",
    13: "EURUSD",
    16: "1.10",
    19: "1.11",
    34: "1.00",
    35: "Win",
    36: "0.10",
  }),
};

export function asMt5Csv(lines) {
  return "sep=;\r\n" + MT5_SLICE11_HEADER + "\r\n" + lines.join("\r\n") + "\r\n";
}
