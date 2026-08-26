# Despliegue en Cloudflare

## Requisitos

- Cuenta de Cloudflare con Workers, D1 y R2 habilitados.
- Node.js 20 o superior.
- Un dominio o subdominio (ejemplo: `ext-audit.tres60.cl`).

## 1. Crear los recursos

```bash
cd ext-audit
npm install

# Base de datos
npx wrangler d1 create ext_audit
# Copiar el database_id devuelto en wrangler.toml (dos veces: [[d1_databases]]
# y [[env.production.d1_databases]])

# Bucket para las planillas originales
npx wrangler r2 bucket create ext-audit-files
```

## 2. Configurar `wrangler.toml`

Reemplazar `REEMPLAZAR_CON_ID_REAL` por el `database_id` real y ajustar
`APP_BASE_URL` en `[env.production.vars]` al dominio definitivo. **`APP_BASE_URL` debe
ser exacta**: es la base de los enlaces que reciben los administradores externos.

## 3. Cargar los secretos

Los secretos nunca van en `wrangler.toml` ni en el repositorio.

```bash
# Secreto de aplicacion (firma de tokens, hash de IPs en la bitacora)
openssl rand -base64 32 | npx wrangler secret put APP_SECRET --env production

# Token de arranque, se usa una sola vez
openssl rand -base64 32 | npx wrangler secret put SETUP_TOKEN --env production

# Google Workspace (ver GOOGLE-WORKSPACE.md)
npx wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env production
npx wrangler secret put GOOGLE_SA_PRIVATE_KEY --env production
npx wrangler secret put GOOGLE_IMPERSONATE_USER --env production
```

## 4. Migrar y desplegar

```bash
npx wrangler d1 migrations apply ext_audit --remote --env production
npx wrangler deploy --env production
```

## 5. Inicializar el primer usuario

```bash
curl -X POST https://ext-audit.tres60.cl/api/setup \
  -H 'Content-Type: application/json' \
  -d '{
        "setupToken": "<SETUP_TOKEN>",
        "email": "relizondo@tres60.cl",
        "name": "Rodrigo Elizondo",
        "password": "<clave de al menos 12 caracteres>"
      }'
```

El endpoint deja de funcionar apenas existe un usuario. Tras inicializar, conviene
rotar el secreto: `npx wrangler secret delete SETUP_TOKEN --env production`.

## 6. Dominio

En el panel de Cloudflare: **Workers & Pages → ext-audit-prod → Settings → Domains &
Routes → Add custom domain** e ingresar `ext-audit.tres60.cl`. El certificado TLS se
emite automaticamente.

---

## Convivencia con las integraciones ya existentes del repositorio

El repositorio que hoy aloja este proyecto ya tiene dos integraciones de
Cloudflare conectadas, anteriores a `ext-audit`:

| Integracion | Que despliega |
|---|---|
| Cloudflare Pages (`playbook-mda`) | el sitio estatico del playbook |
| Workers Builds (`playbook-mda-capstone`) | un Worker asociado al repositorio |

**Workers Builds construye a partir del repositorio completo.** Al aparecer
`ext-audit/wrangler.toml` intenta tomarlo como su configuracion, y falla porque
`database_id` es un marcador de posicion y el `name` del servicio no coincide.
Esa falla es una proteccion util: si el despliegue prosperara, publicaria la
aplicacion de auditoria **encima del Worker del playbook**, que es justamente lo
que no debe ocurrir.

Hay que resolverlo del lado de Cloudflare, en el dashboard, eligiendo una de
estas dos opciones:

1. **Acotar el servicio existente** (recomendado si `ext-audit` se despliega por
   GitHub Actions, como propone este proyecto).
   *Workers & Pages → playbook-mda-capstone → Settings → Builds*: fijar
   **Root directory** en la carpeta del playbook y agregar `ext-audit/*` a
   **Build watch paths → Exclude**, para que los cambios de este proyecto no
   disparen ese build.

2. **Dar a `ext-audit` su propio servicio de Workers Builds.**
   Crear un Worker nuevo conectado al mismo repositorio con **Root directory**
   `ext-audit/`, y en ese caso **desactivar** el workflow
   `.github/workflows/ext-audit-deploy.yml`, para no tener dos caminos de
   despliegue compitiendo por el mismo Worker.

Elegir una u otra, no ambas: dos mecanismos desplegando el mismo Worker se
pisan entre si y hacen imposible saber que version esta publicada.

---

## Despliegue continuo con GitHub Actions

`.github/workflows/ext-audit-ci.yml` corre en cada push y PR que toque `ext-audit/`:
verifica sintaxis e imports, ejecuta las 69 pruebas unitarias, valida el esquema de D1 sobre
SQLite y compila el Worker con `wrangler deploy --dry-run`.

`.github/workflows/ext-audit-deploy.yml` corre al integrar a `main`: repite las
verificaciones, aplica las migraciones de D1, despliega y comprueba `/api/health` con
reintentos.

### Secretos y variables del repositorio

| Nombre | Tipo | Valor |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | token con permisos de Workers, D1 y R2 |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | ID de la cuenta de Cloudflare |
| `EXT_AUDIT_BASE_URL` | Variable | URL publica, para la verificacion de salud |

El token se crea en **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**,
agregando permisos de lectura/escritura sobre D1 y R2.

---

## Desarrollo local

```bash
cd ext-audit
npm install
cp .dev.vars.example .dev.vars     # editar; NUNCA commitear .dev.vars

npm run db:migrate:local
npm run db:seed:local              # catalogo de empresas y administradores de ejemplo
npm run dev                        # http://localhost:8787
```

Con `MAIL_PROVIDER=console` no se envia ningun correo: cada envio se registra en la
consola y en `email_deliveries` con estado `sent`. Es el modo correcto para probar el
flujo completo sin escribirle a nadie.

Inicializar el usuario local:

```bash
curl -X POST http://localhost:8787/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"setupToken":"cambiar-por-un-valor-aleatorio-largo","email":"relizondo@tres60.cl","name":"Rodrigo","password":"Clave.Local.2026"}'
```

Luego importar `samples/admanager_export_sample.csv` desde el panel: son 19 filas con los
casos dificiles ya incluidos (empresas mal escritas, managers en DN, cuentas ya
deshabilitadas, cuentas sin empresa y cuentas internas que **no** deben entrar).

### Probar el cron sin esperar

```bash
npm run cron:test
# en otra terminal:
curl "http://localhost:8787/__scheduled?cron=0+8+*+*+*"
```

O desde el panel, pestana **Configuracion**, con los botones de ejecucion manual.

### Verificaciones locales

```bash
npm test          # 69 pruebas unitarias
npm run check     # sintaxis, imports y esquema de base de datos
```

---

## Rollback

```bash
npx wrangler deployments list --env production
npx wrangler rollback <deployment-id> --env production
```

Las migraciones de D1 **no** se revierten con el rollback del Worker. El esquema es
aditivo por diseno (columnas nuevas, tablas nuevas), de modo que una version anterior del
Worker sigue funcionando contra un esquema mas nuevo. Si una migracion futura necesita ser
destructiva, debe partirse en dos despliegues: primero agregar, migrar datos y desplegar
el codigo que usa lo nuevo; recien despues eliminar lo viejo.

## Respaldos

```bash
# Exportar la base completa
npx wrangler d1 export ext_audit --remote --output backup-$(date +%F).sql --env production
```

Las planillas originales quedan en R2 bajo `imports/<campaignId>/<importId>/`, con su
SHA-256 registrado en la tabla `imports`. Conviene activar versionado y una regla de
ciclo de vida en el bucket segun la politica de retencion de la auditoria.

## Costos

Para el volumen esperado (cientos de cuentas, una campana mensual, decenas de
administradores) el sistema cabe holgadamente en los planes gratuitos de Workers, D1 y R2.
El unico costo relevante es el dominio y la licencia de Google Workspace que ya existe.
