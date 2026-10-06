/**
 * Kuruluş kurulumu: departmanları ve SLA sürelerini bir JSON dosyasından
 * veritabanına işler.
 *
 *   Geliştirme:  npm run setup -- config/kurulus.json
 *   Sunucu:      node dist/cli/setup.js config/kurulus.json
 *
 * Önce göçlerin uygulanmış olması gerekir (npm run db:deploy).
 * Tekrar çalıştırmak güvenlidir; dosyada olmayan departmanlar silinmez.
 */
import { readFileSync } from 'node:fs';
import { prisma } from '../db.js';
import { applyOrgConfig, orgConfigSchema } from '../setup/org-config.js';

const file = process.argv[2];
if (!file) {
  console.error('Kullanım: setup <yapılandırma.json>   (örnek: config/kurulus.example.json)');
  process.exit(2);
}

let json: unknown;
try {
  json = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`${file} okunamadı: ${(err as Error).message}`);
  process.exit(2);
}

const parsed = orgConfigSchema.safeParse(json);
if (!parsed.success) {
  console.error(`${file} geçersiz:`);
  for (const i of parsed.error.issues) console.error(`  - ${i.path.join('.')}: ${i.message}`);
  process.exit(2);
}

try {
  const r = await applyOrgConfig(prisma, parsed.data);
  console.log(`Kurulum uygulandı (${file}).`);
  console.log(`  Yeni departman:        ${r.created.join(', ') || '—'}`);
  console.log(`  Güncellenen departman: ${r.updated.join(', ') || '—'}`);
  console.log(`  SLA (saat):            Normal ${parsed.data.sla.NORMAL} · Yüksek ${parsed.data.sla.YUKSEK} · Kritik ${parsed.data.sla.KRITIK}`);
  if (r.notInConfig.length) {
    console.log(`  [UYARI] Dosyada olmayan etkin departmanlar (dokunulmadı): ${r.notInConfig.join(', ')}`);
  }
} catch (err) {
  console.error(`Kurulum uygulanamadı: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
