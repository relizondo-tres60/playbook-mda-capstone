# Integraciones futuras

La carga inicial es por archivo, que es lo correcto: valida el proceso completo sin
depender de que ningun sistema corporativo abra una interfaz. La arquitectura ya deja
preparado el reemplazo de ese paso por una integracion automatica.

## Como esta preparado hoy

El punto de extension es **la funcion que produce la matriz de celdas**, no el resto del
sistema. Toda la cadena posterior (deteccion EXT, normalizacion, cruce, campanas, correo)
consume filas ya estandarizadas y no sabe de donde vinieron.

```
  hoy:      archivo (CSV/XLSX)  --> parseSpreadsheet() --> string[][] --> normalizeRow() --> D1
  manana:   API de AD Manager   --> fetchFromApi()     --> string[][] --> normalizeRow() --> D1
                                    (nuevo, ~50 lineas)     igual         igual            igual
```

Tres piezas del diseno actual sostienen ese cambio:

1. **`imports.source_system`** ya existe en el esquema, con valor `'ad_manager'`. Una carga
   por API se registra igual, cambiando ese campo. La bitacora y las exportaciones no cambian.
2. **`imports.column_map`** guarda el mapeo cabecera-origen → campo canonico como JSON.
   Un origen con nombres distintos se resuelve agregando alias en
   `src/lib/normalize.js` (`COLUMN_ALIASES`), sin tocar el resto.
3. **`imported_accounts.raw_json`** conserva el registro original completo, venga de donde
   venga. La evidencia de auditoria se mantiene identica.

## AD Manager Plus (ManageEngine)

Expone una API REST con autenticacion por token.

```javascript
// src/services/sources/admanager.js  (nuevo)
export async function fetchAccounts(env) {
  const res = await fetch(`${env.ADMANAGER_BASE_URL}/api/json/user/getUsers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      AUTHTOKEN: env.ADMANAGER_TOKEN,
      domainName: env.ADMANAGER_DOMAIN,
      searchFilter: JSON.stringify({ sAMAccountName: '*EXT*' }),
    }),
  });
  const data = await res.json();
  // Devolver la misma forma que parseSpreadsheet: [cabeceras, ...filas]
  return toMatrix(data.users);
}
```

Trabajo estimado: **1 a 2 dias**, la mayor parte en acordar el filtro y las credenciales
con el equipo que administra la herramienta. El codigo nuevo es acotado.

Consideracion operativa: el Worker debe alcanzar la instancia de AD Manager. Si vive en la
red interna, la via limpia es **Cloudflare Tunnel** (`cloudflared`) publicandola solo hacia
el Worker, sin exponerla a internet.

## Microsoft Graph (Entra ID / Azure AD)

Si el directorio esta sincronizado con Entra ID, Graph es una alternativa mas simple: la
autenticacion es la misma mecanica de JWT que ya implementa `src/services/gmail.js` para
Google, cambiando el emisor.

```javascript
const res = await fetch(
  "https://graph.microsoft.com/v1.0/users?$filter=startswith(userPrincipalName,'ext')" +
  "&$select=userPrincipalName,displayName,mail,department,jobTitle,companyName,accountEnabled,signInActivity",
  { headers: { Authorization: `Bearer ${token}` } }
);
```

Permiso necesario: `User.Read.All` (aplicacion). Trabajo estimado: **1 a 2 dias**.

## Capstone / sistemas corporativos de contratos

La mayor ganancia no esta en las cuentas, sino en el **catalogo de contratos**: hoy los
administradores de contrato se cargan a mano y esa es la principal fuente de revision
manual. Si Capstone (u otro sistema de gestion de contratos) puede entregar la relacion
empresa → administrador → contrato → faena → vigencia, el porcentaje de asignacion
automatica sube de forma directa.

Diseno propuesto:

```
POST /api/sync/contracts          (autenticado con una clave de servicio)
{
  "source": "capstone",
  "contracts": [
    { "companyName": "Servicios Integrales SPA", "taxId": "76.123.456-7",
      "contractNumber": "CTR-2026-0011", "site": "Mantos Blancos",
      "administratorName": "Juan Perez", "administratorEmail": "juan.perez@servintegrales.cl",
      "validFrom": "2026-01-01", "validTo": "2026-12-31" }
  ]
}
```

El endpoint reutilizaria `resolveCompany()` para la normalizacion de nombres y haria upsert
sobre `contract_administrators`. Trabajo estimado: **2 a 3 dias**, incluyendo la conciliacion
con lo cargado a mano.

Beneficio esperado: la asignacion automatica pasaria del ~80% actual a cerca del 95%, y la
vigencia del contrato dejaria de tener que informarla el administrador en el portal.

## Ejecucion automatica de bajas

**Recomendacion: no hacerlo, o hacerlo con aprobacion explicita.**

Es tecnicamente posible (AD Manager y Graph exponen la operacion), pero cambia el perfil de
riesgo del sistema: hoy la aplicacion no tiene credenciales de dominio y no puede
deshabilitar a nadie. Si aun asi se decide avanzar, el diseno minimo razonable es:

1. Un rol `executor`, distinto de `admin`.
2. Aprobacion explicita cuenta por cuenta en el panel, nunca un lote completo.
3. Ejecucion en dos fases: `-WhatIf` primero, resultado revisado, luego ejecucion real.
4. Ventana de reversion de 48 horas con la accion inversa registrada.
5. Credenciales acotadas a `Disable-ADAccount` sobre las OU de externos, nada mas.

Mientras eso no exista, la exportacion con revision humana es el control adecuado.

## Notificaciones adicionales

**Microsoft Teams / Slack:** un webhook al cerrar la campana, con el resumen (respondidas,
vencidas, cuentas a dar de baja). Es un `fetch` dentro de `closeCampaign()`. Menos de un dia.

**Recordatorio interno:** un correo al equipo de identidades tres dias antes del
vencimiento, listando los administradores que no han respondido. La plantilla
`internal_summary` ya esta contemplada en el enum de `email_deliveries.kind`.

## Sincronizacion inversa: confirmar la baja

Cerraria el ciclo: hoy el sistema dice que hay que dar de baja, pero no verifica que se
haya hecho. Una segunda importacion al mes siguiente permitiria contrastar la cola de bajas
del mes anterior contra el estado real en AD y reportar las que siguen activas.

Es un reporte, no una integracion nueva: los datos ya estan. Trabajo estimado: **1 dia**.

## Orden sugerido

| Prioridad | Integracion | Beneficio | Esfuerzo |
|---|---|---|---|
| 1 | Catalogo de contratos desde Capstone | Sube la asignacion automatica a ~95% | 2-3 dias |
| 2 | Verificacion de bajas ejecutadas | Cierra el ciclo de auditoria | 1 dia |
| 3 | Carga automatica desde AD Manager o Graph | Elimina el paso manual mensual | 1-2 dias |
| 4 | Notificacion a Teams | Visibilidad del equipo | < 1 dia |
| 5 | Ejecucion automatica de bajas | Ahorra trabajo, agrega riesgo | evaluar con seguridad |

La numeracion no es por dificultad sino por retorno: la carga manual del archivo toma
minutos una vez al mes, mientras que la revision manual de asignaciones es lo que
realmente consume tiempo.
