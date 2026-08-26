/**
 * Verificacion estatica sin dependencias: comprueba que todos los modulos del
 * Worker parsean y que sus imports internos resuelven a archivos existentes.
 * Se ejecuta en CI antes del despliegue.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');

/** @param {string} dir */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = await walk(ROOT);
const errors = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');

  // 1. El modulo debe parsear como ESM.
  try {
    new Function(`return import(${JSON.stringify('data:text/javascript,')})`);
    await import(`file://${file}?check=${Date.now()}`).catch((e) => {
      // Los modulos que dependen del runtime de Workers pueden fallar al
      // evaluar; solo interesan los errores de sintaxis.
      if (e instanceof SyntaxError) throw e;
    });
  } catch (e) {
    errors.push(`${relative(process.cwd(), file)}: ${e.message}`);
    continue;
  }

  // 2. Los imports relativos deben apuntar a archivos existentes.
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(source))) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) {
      errors.push(`${relative(process.cwd(), file)}: import no resuelto -> ${m[1]}`);
    }
  }
}

if (errors.length) {
  console.error('Errores encontrados:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} modulos verificados (sintaxis e imports).`);
