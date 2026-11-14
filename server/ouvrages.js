// Ouvrages composés : un article du catalogue peut être composé d'autres articles (quantités par unité d'ouvrage).
// Son coût et son prix de vente sont recalculés à chaque changement de composition ou de prix d'un composant.
import { db, round2 } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS catalog_components (
  parent_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 1, PRIMARY KEY(parent_id, child_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS catalog_links (
  item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  linked_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  PRIMARY KEY(item_id, linked_id)
)`);
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const err = (m, status = 400) => Object.assign(new Error(m), { status });

export const componentsOf = (parentId) => db.prepare(`SELECT cc.child_id, cc.qty, ci.label, ci.unit, ci.price_ht, ci.cost_material, ci.labor_hours, ci.labor_rate, ci.cost_sub, ci.archived
  FROM catalog_components cc JOIN catalog_items ci ON ci.id=cc.child_id WHERE cc.parent_id=? ORDER BY ci.category, ci.label`).all(parentId);

/** Recalcule coûts et prix d'un ouvrage à partir de ses composants. */
export function recomputeOuvrage(parentId) {
  const comps = componentsOf(parentId); if (!comps.length) return;
  const cur = db.prepare('SELECT * FROM catalog_items WHERE id=?').get(parentId);
  const sum = (f) => comps.reduce((s, c) => s + c.qty * c[f], 0);
  const hours = sum('labor_hours'); const labor = comps.reduce((s, c) => s + c.qty * c.labor_hours * c.labor_rate, 0);
  const n = { cost_material: round2(sum('cost_material')), labor_hours: r3(hours), labor_rate: hours > 0 ? round2(labor / hours) : cur.labor_rate, cost_sub: round2(sum('cost_sub')), price_ht: round2(sum('price_ht')) };
  const cost = (x) => x.cost_material + x.labor_hours * x.labor_rate + x.cost_sub;
  if (n.price_ht === cur.price_ht && round2(cost(n)) === round2(cost(cur)) && n.labor_hours === cur.labor_hours) return;
  db.prepare("UPDATE catalog_items SET cost_material=?,labor_hours=?,labor_rate=?,cost_sub=?,price_ht=?,updated_at=datetime('now') WHERE id=?").run(n.cost_material, n.labor_hours, n.labor_rate, n.cost_sub, n.price_ht, parentId);
  db.prepare('INSERT INTO catalog_history(item_id,price_ht,cost_total,note) VALUES(?,?,?,?)').run(parentId, n.price_ht, round2(cost(n)), 'Recalcul de l\'ouvrage');
}
export const recomputeParentsOf = (childId) => { for (const r of db.prepare('SELECT parent_id FROM catalog_components WHERE child_id=?').all(childId)) recomputeOuvrage(r.parent_id); };

/** Texte « Comprend : … » ajouté à la ligne de devis quand on insère un ouvrage. */
export function ouvrageDescription(itemId) {
  const c = componentsOf(itemId); if (!c.length) return null;
  const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
  return 'Comprend : ' + c.map((x) => `${fmt(x.qty)} ${x.unit} ${x.label}`).join(' ; ');
}

export function mountOuvrages(app, { catRow }) {
  app.get('/api/catalog/:id/components', (req, res) => res.json(componentsOf(Number(req.params.id))));
  app.put('/api/catalog/:id/components', (req, res) => {
    try {
      const pid = Number(req.params.id); if (!db.prepare('SELECT 1 FROM catalog_items WHERE id=?').get(pid)) return res.sendStatus(404);
      const list = Array.isArray(req.body.components) ? req.body.components : [];
      if (db.prepare('SELECT 1 FROM catalog_components WHERE child_id=?').get(pid)) throw err('Cet article est déjà un composant d\'un autre ouvrage : il ne peut pas être lui-même composé.');
      const seen = new Set(); const clean = [];
      for (const c of list) {
        const cid = Number(c.child_id); const qty = Number(String(c.qty).replace(',', '.'));
        if (cid === pid) throw err('Un ouvrage ne peut pas se contenir lui-même.');
        if (!(qty > 0)) throw err('Quantité invalide.'); if (seen.has(cid)) throw err('Composant en double.'); seen.add(cid);
        if (!db.prepare('SELECT 1 FROM catalog_items WHERE id=? AND archived=0').get(cid)) throw err('Composant introuvable.');
        if (db.prepare('SELECT 1 FROM catalog_components WHERE parent_id=?').get(cid)) throw err('Un composant ne peut pas être lui-même un ouvrage composé.');
        clean.push({ cid, qty });
      }
      db.transaction(() => { db.prepare('DELETE FROM catalog_components WHERE parent_id=?').run(pid); for (const c of clean) db.prepare('INSERT INTO catalog_components(parent_id,child_id,qty) VALUES(?,?,?)').run(pid, c.cid, c.qty); })();
      recomputeOuvrage(pid);
      res.json({ item: catRow(pid), components: componentsOf(pid) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  /* ---- Ouvrages liés : « pensez-y » (liens choisis + associations apprises des devis précédents) ---- */
  const linkRows = (id) => db.prepare(`SELECT ci.id, ci.label, ci.unit, ci.price_ht, ci.category FROM catalog_links l JOIN catalog_items ci ON ci.id=l.linked_id WHERE l.item_id=? AND ci.archived=0 ORDER BY ci.label`).all(id);
  app.get('/api/catalog/:id/links', (req, res) => res.json(linkRows(Number(req.params.id))));
  app.put('/api/catalog/:id/links', (req, res) => {
    const id = Number(req.params.id); if (!db.prepare('SELECT 1 FROM catalog_items WHERE id=?').get(id)) return res.sendStatus(404);
    const ids = [...new Set((Array.isArray(req.body.linked) ? req.body.linked : []).map(Number).filter((n) => n && n !== id))];
    db.transaction(() => { db.prepare('DELETE FROM catalog_links WHERE item_id=?').run(id); for (const l of ids) if (db.prepare('SELECT 1 FROM catalog_items WHERE id=?').get(l)) db.prepare('INSERT INTO catalog_links(item_id,linked_id) VALUES(?,?)').run(id, l); })();
    res.json(linkRows(id));
  });
  app.get('/api/quotes/:id/suggestions', (req, res) => {
    const qid = Number(req.params.id);
    const lines = db.prepare('SELECT l.item_id, l.section_id, ci.label FROM lines l JOIN catalog_items ci ON ci.id=l.item_id WHERE l.quote_id=? AND l.item_id IS NOT NULL ORDER BY l.position,l.id').all(qid);
    const have = new Set(lines.map((l) => l.item_id)); const out = new Map();
    const push = (it, line, source, count) => {
      if (have.has(it.id)) return; const cur = out.get(it.id);
      if (cur) { if (!cur.because.includes(line.label)) cur.because.push(line.label); if (source === 'lie') cur.source = 'lie'; return; }
      out.set(it.id, { item_id: it.id, label: it.label, unit: it.unit, price_ht: it.price_ht, section_id: line.section_id, because: [line.label], source, count });
    };
    for (const l of lines) for (const it of linkRows(l.item_id)) push(it, l, 'lie', null);
    // Associations apprises : articles qui figurent avec celui-ci dans au moins 2 autres devis.
    const learn = db.prepare(`SELECT l2.item_id AS id, ci.label, ci.unit, ci.price_ht, COUNT(DISTINCT l2.quote_id) AS n
      FROM lines l1 JOIN lines l2 ON l2.quote_id=l1.quote_id AND l2.item_id<>l1.item_id JOIN catalog_items ci ON ci.id=l2.item_id
      WHERE l1.item_id=? AND l1.quote_id<>? AND l2.item_id IS NOT NULL AND ci.archived=0 GROUP BY l2.item_id HAVING n>=2 ORDER BY n DESC LIMIT 4`);
    for (const l of lines) for (const r of learn.all(l.item_id, qid)) push(r, l, 'appris', r.n);
    res.json([...out.values()].sort((a, b) => (a.source === b.source ? 0 : a.source === 'lie' ? -1 : 1)).slice(0, 8));
  });
}
