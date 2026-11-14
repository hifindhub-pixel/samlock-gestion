// Compatibilité better-sqlite3 -> node:sqlite (intégré à Node, aucune compilation native).
import { DatabaseSync } from 'node:sqlite';

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
// Comme better-sqlite3 : les clés d'objet absentes de la requête sont ignorées (évite un 500 sur un champ en trop).
const cleanArgs = (args, names) => args.map((a) => {
  if (a && typeof a === 'object' && !Buffer.isBuffer(a) && !(a instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(a).filter(([k]) => !names || names.has(k)).map(([k, v]) => [k, clean(v)]));
  }
  return clean(a);
});

export default class Database {
  constructor(file) { this.raw = new DatabaseSync(file); this._tx = 0; }
  exec(sql) { return this.raw.exec(sql); }
  pragma(s) { const r = this.raw.prepare('PRAGMA ' + s).all(); return r; }
  prepare(sql) {
    const st = this.raw.prepare(sql);
    const names = new Set([...sql.matchAll(/[@:$]([A-Za-z_]\w*)/g)].map((m) => m[1]));
    return {
      run: (...a) => { const r = st.run(...cleanArgs(a, names)); return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }; },
      get: (...a) => st.get(...cleanArgs(a, names)),
      all: (...a) => st.all(...cleanArgs(a, names)),
    };
  }
  transaction(fn) {
    return (...args) => {
      if (this._tx > 0) return fn(...args);
      this.raw.exec('BEGIN');
      this._tx++;
      try { const r = fn(...args); this.raw.exec('COMMIT'); return r; }
      catch (e) { try { this.raw.exec('ROLLBACK'); } catch {} throw e; }
      finally { this._tx--; }
    };
  }
  close() { this.raw.close(); }
}
