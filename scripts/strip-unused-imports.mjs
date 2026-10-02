// Supprime les imports inutilises signales par `tsc --noEmit` (TS6133 / TS6192).
//
// Pourquoi : un composant importe mais jamais rendu disparait silencieusement de
// l'interface. C'est arrive sur /users (InviteUser) et /meetings (CreateMeeting) :
// les imports etaient presents, mais l attribut `actions` du PageHeader n avait pas
// ete applique, donc les boutons n'existaient pas a l'ecran et rien ne le signalait.
//
// Usage : node scripts/strip-unused-imports.mjs
// Idempotent : a executer apres chaque session, avant `npm run build`.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const RE_UNUSED_IDENT = /^.+?\((\d+),(\d+)\): error TS6133: '(.+?)' is declared/;
const RE_UNUSED_IMPORT = /^.+?\((\d+),(\d+)\): error TS6192: All imports in import/;

function collectErrors() {
  let out = '';
  try {
    out = execSync('npx tsc --noEmit 2>&1', { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Etend la declaration d'import demarree a `start` jusqu'a son point-virgule. */
function importStatementEnd(src, start) {
  let i = src.indexOf('{', start);
  if (i === -1) return src.indexOf(';', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.indexOf(';', j);
    }
  }
  return src.indexOf(';', start);
}

function removeSpecifier(stmt, ident) {
  // '*' = declaration entierement inutilisee (TS6192).
  if (ident === '*') return null;
  // Retire un seul specifier de la liste `{ a, b as c, d }`.
  const open = stmt.indexOf('{');
  const close = stmt.indexOf('}', open);
  if (open === -1 || close === -1) return stmt;

  const specifiers = stmt.slice(open + 1, close).split(',');
  const kept = specifiers.filter((s) => s.trim().split(/\s+as\s+/)[0].trim() !== ident);
  if (kept.length === specifiers.length) return stmt;

  if (kept.some((s) => s.trim() !== '')) {
    return stmt.slice(0, open + 1) + kept.join(', ') + stmt.slice(close);
  }
  // Liste vide. Si la declaration ne contenait que ces accolades, on supprime
  // l'import entier ; sinon on conserve la partie restante (import par defaut).
  const prefix = stmt.slice(0, open).trim();
  if (prefix === 'import') return null;
  const rest = (stmt.slice(0, open) + stmt.slice(close + 1)).replace(/,\s*/, '').trim();
  const bare = rest.replace(/^import\s*/, '');
  if (bare === ';' || bare === '') return null;
  return rest;
}

function main() {
  let total = 0;
  // 4 passes suffisent : sur un meme fichier les erreurs se concentrent sur les
// memes lignes d'import, et decaler les numeros de ligne reste local.
for (let pass = 1; pass <= 4; pass++) {
    const grouped = new Map();
    for (const line of collectErrors()) {
      const m = line.match(RE_UNUSED_IDENT) || line.match(RE_UNUSED_IMPORT);
      if (!m) continue;
      const [, ln, , ident] = m;
      const file = line.slice(0, line.indexOf('('));
      if (!grouped.has(file)) grouped.set(file, []);
      // TS6192 ("tous les imports de la declaration sont inutilises") ne nomme aucun
      // identifiant : on utilise '*' pour supprimer la declaration entiere.
      grouped.get(file).push({ ln: Number(ln), ident: m[3] ?? '*' });
    }
    if (grouped.size === 0) break;

    let changed = 0;
    for (const [file, errs] of grouped) {
      let src = readFileSync(file, 'utf8');
      // En fin de passage, vers la fin du fichier : les numeros de ligne se
      // decalent apres chaque suppression, on les trie donc decroissants.
      // offsets[n] = index de depart de la ligne n+1 (offsets[0] = 0).
      const offsets = [0];
      for (let i = 0; i < src.length; i++) if (src[i] === '\n') offsets.push(i + 1);

      for (const e of errs.sort((a, b) => b.ln - a.ln)) {
        // tsc pointe l'identifiant inutilise, pas la ligne `import`. Sur un import
        // multi-lignes (`import {\n  a,\n  b, // b inutilise\n} from '...'`) on doit
        // donc remonter au debut de la declaration avant de la reecrire.
        let start = offsets[e.ln - 1];
        if (start === undefined) continue;
        const importIdx = src.lastIndexOf('import ', start);
        if (importIdx === -1) continue;
        if (src.slice(importIdx + 'import '.length, start).includes(';')) continue;
        start = importIdx;
        const end = importStatementEnd(src, start);
        if (end === -1) continue;
        const stmt = src.slice(start, end + 1);
        // Garde-fou : seules les declarations d'import sont modifiees. Sans ce
        // test, une variable inutilisee dans le corps d'une fonction (`const { id }
        // = await params;`) etait transformee en `const  = await params;`.
        if (!stmt.trimStart().startsWith('import')) continue;
        const next = removeSpecifier(stmt, e.ident);
        if (next === stmt) continue; // rien a retirer : on ne recompte pas
        src = src.slice(0, start) + (next === null ? '' : next) + src.slice(end + 1);
        changed++;
      }
      writeFileSync(file, src);
    }
    total += changed;
    if (changed === 0) break;
    console.log(`passe ${pass}: ${changed} import(s) supprime(s)`);
  }
  console.log(`\n${total} import(s) inutilise(s) supprime(s) au total.`);
}

main();