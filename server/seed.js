// Données de démarrage SAMLOCK : catalogue serrurerie, fournisseurs, sous-traitants, quelques clients de démonstration.
// npm run seed (réinitialise)  ·  npm run empty (vide tout, garde les paramètres)
import { db } from './db.js';
import { importAfdbHistory, importTiimeHistory } from './stock.js';
import { importTiimeInvoices } from './history.js';

if (process.argv.includes('--reset')) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('settings')").all().map((t) => t.name);
  db.exec('PRAGMA foreign_keys=OFF');
  for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* table virtuelle */ } }
  try { db.exec('DELETE FROM sqlite_sequence'); } catch { /* ignore */ }
  db.exec('PRAGMA foreign_keys=ON');
}
if (process.argv.includes('--empty')) { console.log('Base vidée (les paramètres sont conservés).'); process.exit(0); }
if (db.prepare('SELECT COUNT(*) n FROM contacts').get().n > 0) { console.log('Base déjà remplie (utilisez --reset).'); process.exit(0); }

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const C = (c) => db.prepare('INSERT INTO contacts(kind,name,company,email,phone,address,postal,city,source,siret,trade,decennale_until,urssaf_until,client_type) VALUES(@kind,@name,@company,@email,@phone,@address,@postal,@city,@source,@siret,@trade,@decennale_until,@urssaf_until,@client_type)')
  .run({ company: null, email: null, phone: null, address: null, postal: null, city: null, source: null, siret: null, trade: null, decennale_until: null, urssaf_until: null, client_type: 'particulier', ...c }).lastInsertRowid;

// --- Fournisseurs
const f1 = C({ kind: 'fournisseur', name: 'AFDB – Au Forum du Bâtiment', company: 'AFDB – Quincaillerie Montpellier 2', email: 'demandes.client@afdb.fr', phone: '04 30 05 22 22', address: '163 rue de la Jasse Maurin', postal: '34070', city: 'Montpellier', notes: 'Compte pro SAMLOCK C2008101. Commercial : Sébastien Denoun (sebastien.denoun@afdb.fr). Comptabilité : demandes.client@afdb.fr' });
const f2 = f1;

// --- Sous-traitants (conformité à tenir à jour : URSSAF + assurance RC pro / décennale)
const s1 = C({ kind: 'sous_traitant', name: 'Yanis Ferrand', company: 'YF Serrurerie', trade: 'Serrurier-dépanneur', email: 'yf.serrurerie@example.com', phone: '06 10 20 30 40', city: 'Castelnau-le-Lez', postal: '34170', siret: '812 345 678 00019', decennale_until: day(220), urssaf_until: day(90) });
const s2 = C({ kind: 'sous_traitant', name: 'Omar Haddad', company: 'Haddad Métallerie', trade: 'Blindage / portes', email: 'haddad.metal@example.com', phone: '06 20 30 40 50', city: 'Lunel', postal: '34400', siret: '823 456 789 00027', decennale_until: day(-12), urssaf_until: day(60) });

// --- Clients de démonstration
const c1 = C({ kind: 'client', name: 'Claire Dubois', email: 'claire.dubois@example.com', phone: '06 12 34 56 78', address: '8 rue de la Loge', postal: '34000', city: 'Montpellier', source: 'Site – demande de devis' });
const c2 = C({ kind: 'client', name: 'Cabinet Lemoine Gestion', company: 'Cabinet Lemoine Gestion', email: 'syndic@lemoine-gestion.example', phone: '04 67 00 00 10', address: '12 avenue de Toulouse', postal: '34070', city: 'Montpellier', source: 'Appel entrant', client_type: 'professionnel' });
C({ kind: 'client', name: 'FAIRFAIR GROUP', company: 'FAIRFAIR GROUP', source: 'Assistance (dossiers n°…)', client_type: 'professionnel', notes: 'Donneur d’ordre assistance : facturation par n° de dossier, TVA 20 %, prise en charge plafonnée (reste à payer par l’assuré).' });
C({ kind: 'apporteur', name: 'Agence Comédie Immobilier', company: 'Agence Comédie Immobilier', email: 'contact@comedie-immo.example', phone: '04 67 00 00 20', city: 'Montpellier', postal: '34000', source: 'Partenariat' });

// --- Interventions
db.prepare("INSERT INTO projects(contact_id,title,address,city,stage) VALUES(?,?,?,?,?)").run(c1, 'Ouverture de porte claquée + changement de cylindre', '8 rue de la Loge', 'Montpellier', 'prospect');
db.prepare("INSERT INTO projects(contact_id,title,address,city,stage) VALUES(?,?,?,?,?)").run(c2, 'Remplacement serrure 3 points – porte d’entrée du hall', '12 avenue de Toulouse', 'Montpellier', 'visite_technique');

// --- Catalogue (stock suivi pour les pièces)
const I = db.prepare('INSERT INTO catalog_items(ref,label,unit,category,supplier_id,cost_material,labor_hours,labor_rate,cost_sub,price_ht,vat,brand,track_stock,stock_qty,stock_min,stock_target,stock_location) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const links = [];
const item = (ref, label, unit, cat, sup, mat, h, price, o = {}) => { const r = I.run(ref, label, unit, cat, sup, mat, h, 60, 0, price, 20, o.brand || null, o.stock ? 1 : 0, o.qty || 0, o.min || 0, o.target || 0, o.loc || null); if (o.sref) db.prepare('UPDATE catalog_items SET supplier_ref=? WHERE id=?').run(o.sref, r.lastInsertRowid); for (const [pr, q] of o.parts || []) links.push([r.lastInsertRowid, pr, q]); return r; };
// Articles repris des factures Tiime SAMLOCK (n° 547 à 558, nov. 2026) — prix de vente HT.
// Quantités en stock inconnues : suivi activé, stock à 0 (à inventorier dans Stock).
// Main-d'œuvre & déplacement
item('MO-DEP', 'Main d’œuvre', 'h', 'Main-d’œuvre', null, 0, 1, 55);
item('DEP-Z1', 'Déplacement zone 1 (à hauteur de 15 km – lun. au ven. 9h–18h)', 'forfait', 'Déplacement', null, 0, 0, 35);
item('DEP-30', 'Déplacement – jusqu’à 30 km', 'u', 'Déplacement', null, 0, 0, 35);
item('DEP-50', 'Déplacement – 30 à 50 km', 'u', 'Déplacement', null, 0, 0, 55);
item('DEP-100', 'Déplacement – 50 à 100 km', 'u', 'Déplacement', null, 0, 0, 75);
// Majorations horaires (factures : 18h–21h = 50 €, 21h–00h = 80 €)
item('MAJ-50', 'Majoration 18h à 21h', 'forfait', 'Majorations', null, 0, 0, 50);
item('MAJ-80', 'Majoration 21h à 00h', 'forfait', 'Majorations', null, 0, 0, 80);
item('MAJ-100', 'Majoration 00h à 6h', 'forfait', 'Majorations', null, 0, 0, 100);
// Ouvertures de porte
item('OUV-PIL', 'Ouverture porte Pastille/Delateur', 'forfait', 'Dépannage', null, 0, 1, 180);
item('OUV-FRAISE', 'Ouverture de porte fermée à double tour – percage du cylindre à la fraise carbure', 'forfait', 'Dépannage', null, 0, 1, 130);
item('OUV-FRAISE-2T', 'Ouverture de porte fermée à double tour – pare attaque activé – désactivation du pare attaque – percage à la fraise carbure', 'forfait', 'Dépannage', null, 0, 1.5, 260);
item('OUV-A2P', 'Ouverture de porte a2p 1 étoile – pare attaque activé', 'forfait', 'Dépannage', null, 0, 1.5, 170);
// Cylindres
item('CYL-HER', 'Fourniture et pose d’un cylindre renforcé Heracles Y7c+ 30*30 – 5 clés renforcées + carte de reproduction', 'u', 'Cylindres', f1, 13.15, 0.5, 180, { brand: 'Heracles', parts: [['CYL-HER-Y7C-3030', 1]] });
item('CYL-HER-PROP', 'Fourniture d’un cylindre renforcé Heracles Y7+ 30*40 – carte de propriété + 5 clés renforcées', 'article', 'Cylindres', null, 0, 0.5, 190, { brand: 'Heracles', parts: [['CYL-HER-Y7C-3040', 1]] });
item('CYL-HER-60', 'Fourniture et pose d’un cylindre renforcé Heracles y7c+ 30*60 – 5 clés renforcées + carte de reproduction', 'u', 'Cylindres', f1, 18.55, 0.5, 210, { brand: 'Heracles', parts: [['CYL-HER-Y7C-3060', 1]] });
item('CYL-HER-LARD', 'Fourniture et pose d’un cylindre renforcé Heracles y7c+ 30*30 pour serrure à larder', 'u', 'Cylindres', f1, 13.15, 0.5, 180, { brand: 'Heracles', parts: [['CYL-HER-Y7C-3030', 1]] });
item('CYL-VACH', 'Fourniture d’un cylindre vachette radialis a2p', 'u', 'Cylindres', null, 0, 0.5, 440, { brand: 'Vachette', parts: [['CYL-VAC-RADIALR-325425', 1]] });
// Serrures
item('SER-LARD-3P', 'Fourniture et pose d’une serrure à larder 3 points de fermeture a2p', 'u', 'Serrures', null, 0, 1.5, 420);
item('SER-LARD-1E', 'Fourniture et pose d’une serrure à larder 3 points a2p 1 étoile', 'u', 'Serrures', null, 0, 1.5, 420);
item('SER-LARD-VACH', 'Fourniture d’une serrure à larder vachette 5000 a2p', 'u', 'Serrures', null, 0, 1.5, 640, { brand: 'Vachette', parts: [['SER-VAC-5000-SGN2', 1]] });
item('COFFRE-LARD', 'Fourniture et pose d’un coffre à larder axe 50', 'u', 'Serrures', null, 0, 0.5, 80);
// Accessoires
item('POIGNEE-HIONNA', 'Fourniture et pose d’une poignée Heracles HIONNA', 'u', 'Accessoires', f1, 0, 0.5, 120, { brand: 'Heracles' });
item('PROT-PICARD', 'Fourniture et pose d’un protège cylindre d’une serrure carencée Picard', 'u', 'Accessoires', null, 0, 0.5, 187, { brand: 'Picard' });

// Complément (factures 497 à 508, sept. 2026)
item('MIS-SEC', 'Mise en sécurité provisoire – pose d’une serrure 1 point + cylindre (offert en cas de devis accepté)', 'forfait', 'Dépannage', null, 0, 1, 150);
item('SUPP-NUIT', 'Supplément nuit / week-end', 'forfait', 'Majorations', null, 0, 0, 30);
item('DEP-SUPP', 'Déplacement supplémentaire', 'forfait', 'Déplacement', null, 0, 0, 60);
item('FRAISE-CARB', 'Fraise carbure diamant cylindrique à bout rond', 'u', 'Consommables', f1, 12.9, 0, 80.89, { parts: [['FRA-HAN-6X18-80', 1]] });
item('CYL-Y7-DBL', 'Cylindre à double entrée Y7/Y7+ Heracles 30x40', 'u', 'Cylindres', f1, 13.9, 0.5, 224.84, { brand: 'Heracles', parts: [['CYL-HER-Y7C-3040', 1]] });
item('CYL-Y8C', 'Cylindre à double entrée Y8C HSH Heracles 30x40', 'u', 'Cylindres', f1, 31, 0.5, 327.91, { brand: 'Heracles' });
item('CYL-Y8C-3030', 'Fourniture et pose d’un cylindre Heracles y8c 30*30 – 5 clés renforcées + carte de propriété', 'u', 'Cylindres', f1, 31, 0.5, 250, { brand: 'Heracles', parts: [['CYL-HER-Y8C-3030', 1]] });
item('VERROU-5G', 'Fourniture verrou Heracles 5G – Canon 30mm – 4 clés paracentrique', 'article', 'Serrures', null, 0, 0.75, 180, { brand: 'Heracles' });
item('SER-LARD-TF3100', 'Fourniture et pose d’une serrure à larder 3 points de fermeture Heracles TF3100 a2p*', 'u', 'Serrures', f1, 39, 1.5, 350, { brand: 'Heracles', parts: [['SER-HER-TF3100-3P', 1]] });
item('SER-DECENA', 'Serrure à larder Decena – Ferco', 'u', 'Serrures', f1, 72, 1.5, 420.5, { brand: 'Ferco', parts: [['SER-FER-DECENA-50', 1]] });
item('POIGNEE-SALOME', 'Poignée blindée double béquille Salome Heracles (Entraxe 70)', 'u', 'Accessoires', f1, 39, 0.5, 341.87, { brand: 'Heracles', parts: [['POI-HER-SALOME-ARG', 1]] });
item('POIGNEE-SALOME-DB', 'Fourniture et pose d’une poignée blindée Heracles Salome double béquille', 'u', 'Accessoires', null, 0, 0.5, 220, { brand: 'Heracles', parts: [['POI-HER-SALOME-ARG', 1]] });

// --- Pièces en stock (achats AFDB, historique 2026). Référence interne uniforme FAMILLE-MARQUE-MODÈLE-DIMENSION ;
// la référence fournisseur AFDB (n° chrono) sert à rapprocher les réceptions. Prix de revient = dernier prix d’achat HT.
// Quantités à inventorier (0) ; prix de vente porté par les articles « fourniture et pose » qui les consomment.
item('CYL-HER-Y7C-3030', 'Cylindre double entrée Heracles Y7C+ 30x30', 'u', 'Cylindres', f1, 13.15, 0, 0, { stock: true, sref: '010384', brand: 'Heracles' });
item('CYL-HER-Y7C-3040', 'Cylindre double entrée Heracles Y7C+ 30x40', 'u', 'Cylindres', f1, 13.9, 0, 0, { stock: true, sref: '010385', brand: 'Heracles' });
item('CYL-HER-Y7C-3050', 'Cylindre double entrée Heracles Y7C+ 30x50', 'u', 'Cylindres', f1, 15.99, 0, 0, { stock: true, sref: '011252', brand: 'Heracles' });
item('CYL-HER-Y7C-3060', 'Cylindre double entrée Heracles Y7C+ 30x60', 'u', 'Cylindres', f1, 18.55, 0, 0, { stock: true, sref: '011263', brand: 'Heracles' });
item('CYL-HER-Y7C-4050', 'Cylindre double entrée Heracles Y7C+ 40x50', 'u', 'Cylindres', f1, 21.17, 0, 0, { stock: true, sref: '011261', brand: 'Heracles' });
item('CYL-HER-Y7P-3030-B12', 'Cylindres Heracles Y7+ 30x30 – boîte de 12', 'u', 'Cylindres', f1, 135.0, 0, 0, { stock: true, sref: '842459', brand: 'Heracles' });
item('CYL-HER-Y8C-3030', 'Cylindre double entrée Heracles Y8C HSH 30x30', 'u', 'Cylindres', f1, 31.0, 0, 0, { stock: true, sref: '844595', brand: 'Heracles' });
item('CYL-HER-5G-3030', 'Cylindre double entrée Heracles 5G laiton nickelé 30x30', 'u', 'Cylindres', f1, 6.08, 0, 0, { stock: true, sref: '364090', brand: 'Heracles' });
item('CYL-HER-5G-1030', 'Demi-cylindre Heracles 5G laiton nickelé 10x30', 'u', 'Cylindres', f1, 5.4, 0, 0, { stock: true, sref: '364102', brand: 'Heracles' });
item('CYL-VAC-RADIALR-325425', 'Cylindre double entrée Vachette Radial-R A2P** 32,5x42,5', 'u', 'Cylindres', f1, 160.61, 0, 0, { stock: true, sref: '860058', brand: 'Vachette' });
item('CYL-BRI-DUALXP-3040', 'Cylindre double entrée Bricard Dual XP S2 A2P** 30x40', 'u', 'Cylindres', f1, 158.31, 0, 0, { stock: true, sref: '514752', brand: 'Bricard' });
item('CYL-FIC-2D787M-JEU', 'Jeu de cylindres Fichet 2D 787M – 4 clés', 'u', 'Cylindres', f1, 305.0, 0, 0, { stock: true, sref: '098790', brand: 'Fichet' });
item('SER-HER-TF3100-3P', 'Serrure à larder 3 points Heracles série 3100 A2P1* 2040x18 bronze', 'u', 'Serrures', f1, 39.0, 0, 0, { stock: true, sref: '532460', brand: 'Heracles' });
item('SER-VAC-5000-SGN2', 'Serrure à larder 3 points Vachette Trilock 5000 SGN2 A2P** 18 mm', 'u', 'Serrures', f1, 184.88, 0, 0, { stock: true, sref: '235050', brand: 'Vachette' });
item('SER-VAC-5090-5P', 'Serrure 5 points Vachette 5090 SPN1 A2P*', 'u', 'Serrures', f1, 87.88, 0, 0, { stock: true, sref: '856036', brand: 'Vachette' });
item('SER-BRI-8162-3P', 'Serrure à larder 3 points Bricard 8162 A2P**', 'u', 'Serrures', f1, 178.0, 0, 0, { stock: true, sref: '514864', brand: 'Bricard' });
item('SER-FER-DECENA-50', 'Serrure à larder Ferco Decena axe 50', 'u', 'Serrures', f1, 72.0, 0, 0, { stock: true, sref: '210624', brand: 'Ferco' });
item('SER-FER-DECENA-40', 'Serrure à larder Ferco Decena axe 40', 'u', 'Serrures', f1, 72.0, 0, 0, { stock: true, sref: '210623', brand: 'Ferco' });
item('VER-HER-5G-BOUTON', 'Verrou à bouton Heracles 5G cylindre 45 – 4 clés', 'u', 'Serrures', f1, 18.8, 0, 0, { stock: true, sref: '587015', brand: 'Heracles' });
item('COF-VAC-5000-PROV', 'Coffre provisoire à pêne dormant Vachette 5000 SGN2', 'u', 'Serrures', f1, 21.23, 0, 0, { stock: true, sref: '373375', brand: 'Vachette' });
item('COF-HER-L130-40', 'Coffre monopoint à larder Heracles clé L 40 blanc', 'u', 'Serrures', f1, 2.35, 0, 0, { stock: true, sref: '435478', brand: 'Heracles' });
item('CRE-FER-EUROPA-50', 'Crémone à larder Ferco Europa axe 50 – 4 galets', 'u', 'Serrures', f1, 44.63, 0, 0, { stock: true, sref: '430386', brand: 'Ferco' });
item('CRE-FER-EUROPA-40', 'Crémone à larder Ferco Europa axe 40 – 4 galets', 'u', 'Serrures', f1, 38.21, 0, 0, { stock: true, sref: '430385', brand: 'Ferco' });
item('CRE-FER-FMATIC-4070', 'Crémone Ferco Fercomatic 40/70 – 2 galets', 'u', 'Serrures', f1, 49.0, 0, 0, { stock: true, sref: '434387', brand: 'Ferco' });
item('GAC-FER-GALET', 'Gâche galet Ferco rainure 7/8x4 bois', 'u', 'Accessoires', f1, 2.87, 0, 0, { stock: true, sref: '381427', brand: 'Ferco' });
item('POI-HER-SALOME-ARG', 'Poignée double béquille Heracles Salome argent', 'u', 'Accessoires', f1, 39.0, 0, 0, { stock: true, sref: '030432', brand: 'Heracles' });
item('POI-HER-SALOME-ETR', 'Poignée étroite Heracles Salome', 'u', 'Accessoires', f1, 44.0, 0, 0, { stock: true, sref: '007672', brand: 'Heracles' });
item('ENS-HER-HIONNA-03', 'Ensemble sur plaque Heracles Hionna type clé I argent', 'u', 'Accessoires', f1, 19.33, 0, 0, { stock: true, sref: '005396', brand: 'Heracles' });
item('KIT-HER-HIONNA-02', 'Kit béquille aluminium Heracles Hionna champagne', 'u', 'Accessoires', f1, 11.3, 0, 0, { stock: true, sref: '009355', brand: 'Heracles' });
item('POI-HOP-TOKYO-BLC', 'Poignée de fenêtre à clé Hoppe Tokyo 7x35 blanc', 'u', 'Accessoires', f1, 17.34, 0, 0, { stock: true, sref: '365102', brand: 'Hoppe' });
item('POI-MAD-5071', 'Poignée pour feuille demi-tour Madelin 5071', 'u', 'Accessoires', f1, 29.24, 0, 0, { stock: true, sref: '783773', brand: 'Madelin' });
item('BAT-RON-911A', 'Batteuse Ronis 911A 1/2 tour', 'u', 'Accessoires', f1, 4.5, 0, 0, { stock: true, sref: '005254', brand: 'Ronis' });
item('DIS-HAN-INOX125', 'Disque à tronçonner inox 125x1 Hanger', 'u', 'Consommables', f1, 1.0, 0, 0, { stock: true, sref: '482635', brand: 'Hanger' });
item('FRA-HAN-6X18-80', 'Fraise carbure cylindrique bout rond 6x18 L80 Hanger', 'u', 'Consommables', f1, 12.9, 0, 0, { stock: true, sref: '486762', brand: 'Hanger' });
item('FOR-HAN-COBALT95', 'Boîte de 5 forets cobalt Ø9,5 Hanger', 'u', 'Consommables', f1, 18.79, 0, 0, { stock: true, sref: '517198', brand: 'Hanger' });
item('FOR-HAN-HSS5', 'Boîte de 10 forets HSS Ø5 Hanger', 'u', 'Consommables', f1, 6.64, 0, 0, { stock: true, sref: '793572', brand: 'Hanger' });
item('FOR-HAN-HSS6', 'Boîte de 10 forets HSS Ø6 Hanger', 'u', 'Consommables', f1, 7.36, 0, 0, { stock: true, sref: '793575', brand: 'Hanger' });
item('SCI-BOS-TREPAN-25', 'Scie trépan carbure Bosch 25x60', 'u', 'Consommables', f1, 18.58, 0, 0, { stock: true, sref: '877790', brand: 'Bosch' });
item('SCI-BOS-TREPAN-32', 'Scie trépan carbure Bosch 32x60', 'u', 'Consommables', f1, 20.24, 0, 0, { stock: true, sref: '877791', brand: 'Bosch' });
item('SCI-SELFCUT-1424', 'Trousse 6 scies cloches Self Cut Speed 14-24', 'u', 'Consommables', f1, 15.82, 0, 0, { stock: true, sref: '877929' });

// Liaison prestations → pièces (la facture fait sortir les pièces du stock)
for (const [itemId, ref, q] of links) { const part = db.prepare('SELECT id FROM catalog_items WHERE ref=?').get(ref); if (part) db.prepare('INSERT OR REPLACE INTO item_parts(item_id,part_id,qty) VALUES(?,?,?)').run(itemId, part.id, q); else console.warn('Pièce introuvable :', ref); }

if (!process.env.SKIP_AFDB) { console.log('Factures Tiime :', JSON.stringify(importTiimeInvoices())); console.log('Historique achats AFDB :', JSON.stringify(importAfdbHistory())); console.log('Historique ventes Tiime :', JSON.stringify(importTiimeHistory()));
  // Article générique « Clé plate » : vendu sans achat dédié → pas de suivi de stock.
  db.prepare("UPDATE catalog_items SET track_stock=0 WHERE supplier_ref='131097' AND label='Clé plate'").run();
  // Seuils de réapprovisionnement d'après le rythme de vente des 12 derniers mois (une seule fois).
  if (!db.prepare("SELECT 1 FROM settings WHERE key='stock_levels_init'").get()) {
    let n = 0;
    for (const r of db.prepare("SELECT c.id, -SUM(m.qty) AS sold FROM catalog_items c JOIN stock_moves m ON m.item_id=c.id WHERE c.track_stock=1 AND m.qty<0 AND c.stock_min=0 GROUP BY c.id HAVING sold>=3").all()) {
      const month = r.sold / 12, min = Math.max(1, Math.ceil(month * 1.5)), target = Math.max(min + 1, Math.ceil(month * 3));
      db.prepare('UPDATE catalog_items SET stock_min=?, stock_target=? WHERE id=?').run(min, target, r.id); n++;
    }
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('stock_levels_init',?)").run(new Date().toISOString());
    console.log('Seuils de stock initialisés :', n);
  } }
console.log('Base SAMLOCK initialisée : catalogue, fournisseurs, sous-traitants, clients de démonstration.');
