import fs from 'node:fs/promises';
import path from 'node:path';
import { policyRowsFromDocs } from '../knowledge/policies.js';
import { storage } from '../services/storage.service.js';
import { insertFile } from './file.model.js';
import { seedPolicyClauseSources } from '../services/source.service.js';

/** Idempotent demo data: policies, clause sources, the CLM-1042 scenario, and a deterministic backlog. */

const DEMO = {
  id: 'CLM-1042',
  customer_name: 'John Doe',
  vehicle: '2024 Fictional Motors Sedan',
  policy_id: 'AT-MOT-2026-X99',
  priority: 'high',
  incident_type: 'front_end_collision',
  estimated_amount: 4800,
  description:
    'The accident happened on March 12, 2026 at the junction of Maple Avenue and 4th Street. ' +
    'Another vehicle failed to yield and hit the front of my car. The front bumper is damaged and the left headlight is cracked.',
};

const NAMES = ['Amira Haddad', 'Lucas Meyer', 'Sofia Alvarez', 'Noah Bennett', 'Yasmine Khelil', 'Oliver Grant', 'Leila Bensaid', 'Ethan Walker', 'Mia Rossi', 'Karim Belkacem', 'Chloe Martin', 'Omar Said'];
const VEHICLES = ['2019 Honda Civic', '2020 Ford Focus', '2018 Hyundai Elantra', '2022 Kia Sportage', '2017 Renault Clio', '2021 VW Golf', '2019 Peugeot 308', '2023 Toyota Yaris'];
const INCIDENTS = ['front_end_collision', 'rear_end_collision', 'side_impact', 'glass_damage', 'other'];
const PRIORITIES = ['low', 'medium', 'high'];
const SHAPES = [
  { stage: 'intake', status: 'PENDING', analysis_state: 'not_started' },
  { stage: 'evidence_collection', status: 'PENDING', analysis_state: 'not_started' },
  { stage: 'evidence_collection', status: 'MORE_INFO_REQUIRED', analysis_state: 'reviewed' },
  { stage: 'decided', status: 'APPROVED', analysis_state: 'reviewed' },
  { stage: 'decided', status: 'APPROVED', analysis_state: 'reviewed' },
];

const exists = (p) => fs.access(p).then(() => true, () => false);

async function registerFile(db, claimId, kind, absPath, mime, dataDir) {
  if (!(await exists(absPath))) return false;
  const name = path.basename(absPath);
  // Older builds stored absolute paths that break on any other machine: make them portable (relative to DATA_DIR).
  await db.query(
    "UPDATE claim_files SET stored_path = substr(stored_path, length($1) + 2) WHERE claim_id=$2 AND storage='local' AND stored_path LIKE $3",
    [dataDir, claimId, `${dataDir}/%`],
  );
  const dup = await db.query('SELECT 1 FROM claim_files WHERE claim_id=$1 AND original_name=$2', [claimId, name]);
  if (dup.rowCount) return true;
  const { size } = await fs.stat(absPath);
  // keepSource: the local driver references the file in place; the cloudinary driver uploads a copy.
  const put = await storage.put({ claimId, srcPath: absPath, filename: name, mimeType: mime, kind, keepSource: true });
  await insertFile(db, { claim_id: claimId, kind, original_name: name, mime_type: mime, size_bytes: size, ...put });
  return true;
}

/** Run inside a transaction. `dataDir` is the absolute data/ folder holding the sample photos and report. */
export async function seedDemoData(db, dataDir) {
  for (const p of await policyRowsFromDocs()) {
    await db.query(
      `INSERT INTO policies (id, name, filename, coverage_summary) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, filename=EXCLUDED.filename, coverage_summary=EXCLUDED.coverage_summary`,
      [p.id, p.name, p.filename, p.coverage_summary],
    );
  }
  await seedPolicyClauseSources(db);

  // Demo claim (the scenario the whole demo is built around)
  await db.query(
    `INSERT INTO claims (id, customer_name, vehicle, description, policy_id, priority, incident_type, estimated_amount, stage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'evidence_collection')
     ON CONFLICT (id) DO UPDATE SET customer_name=EXCLUDED.customer_name, vehicle=EXCLUDED.vehicle,
       description=EXCLUDED.description, policy_id=EXCLUDED.policy_id`,
    [DEMO.id, DEMO.customer_name, DEMO.vehicle, DEMO.description, DEMO.policy_id, DEMO.priority, DEMO.incident_type, DEMO.estimated_amount],
  );
  // CLM-002 of the policy requires at least four clear photographs, so the demo claim ships with four.
  const imgs = ['CLM-1042_front_bumper.jpg', 'CLM-1042_left_headlight.jpg', 'CLM-1042_overview.jpg', 'CLM-1042_front_right.jpg'];
  for (const f of imgs) await registerFile(db, DEMO.id, 'image', path.join(dataDir, 'images', f), 'image/jpeg', dataDir);
  const pdf = path.join(dataDir, 'claims', DEMO.id, 'accident_report.pdf');
  const txt = path.join(dataDir, 'claims', DEMO.id, 'accident_report.txt');
  if (!(await registerFile(db, DEMO.id, 'report', pdf, 'application/pdf', dataDir))) {
    await registerFile(db, DEMO.id, 'report', txt, 'text/plain', dataDir);
  }

  // A realistic backlog so Dashboard / Claims / Analytics have shape. Deterministic, no randomness.
  for (let i = 1; i <= 24; i++) {
    const shape = SHAPES[i % SHAPES.length];
    const id = `CLM-${1000 + i}`;
    const created = `now() - interval '${i * 31} hours'`;
    await db.query(
      `INSERT INTO claims (id, customer_name, vehicle, description, policy_id, priority, incident_type, estimated_amount,
                           stage, status, analysis_state, created_at, updated_at, decided_at)
       VALUES ($1,$2,$3,$4,'AT-MOT-2026-X99',$5,$6,$7,$8,$9,$10, ${created}, ${created},
               CASE WHEN $9 = 'APPROVED' THEN ${created} + interval '${6 + (i % 5) * 5} hours' END)
       ON CONFLICT (id) DO UPDATE SET policy_id = EXCLUDED.policy_id`,
      [id, NAMES[i % NAMES.length], VEHICLES[i % VEHICLES.length], 'Seeded sample claim.', PRIORITIES[i % 3],
       INCIDENTS[i % INCIDENTS.length], 900 + ((i * 377) % 6000), shape.stage, shape.status, shape.analysis_state],
    );
  }

  await db.query("DELETE FROM sources WHERE source_id ~ '^src_pol_[0-9]'"); // invented clauses from an earlier iteration
  // Retire policy records from earlier iterations that no longer have a document or any claim.
  await db.query(`DELETE FROM policies p WHERE p.id LIKE 'POL-AUTO-%' AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.policy_id = p.id)`);
}
