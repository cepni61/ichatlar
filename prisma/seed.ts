/**
 * Demo verisi — yalnızca geliştirme ve deneme. CANLIDA ÇALIŞTIRILMAZ.
 *
 *   npm run db:seed              departmanlar + SLA + demo kullanıcılar; kayıt yoksa 300 demo kayıt
 *   npm run db:seed -- --reset   demo verisini silip baştan kurar
 *
 * Departmanlar ve SLA config/kurulus.example.json'dan, kuruluş kurulumuyla
 * (setup) aynı kodla işlenir. Kişiler ve kayıt konuları prisma/demo-data.ts'te.
 * `SEED_RECORDS=false` ile yalnızca departman + SLA + kullanıcı kurulur.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { Priority, RecordStatus, RecordType } from '../src/domain/enums.js';
import { applyOrgConfig, orgConfigSchema } from '../src/setup/org-config.js';
import { CONTEXT, COUNTS, TOPICS, USERS } from './demo-data.js';

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const hAgo = (h: number) => new Date(Date.now() - h * HOUR);
const dAgo = (d: number) => new Date(Date.now() - d * DAY);

const CONFIG = orgConfigSchema.parse(
  JSON.parse(readFileSync(new URL('../config/kurulus.example.json', import.meta.url), 'utf8')),
);
const DEPARTMENTS = CONFIG.departments;

const slug = (name: string) =>
  name
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');

/*
 * Durum, öncelik ve yaş döngüleri. Uzunlukları (20, 9, 7) ikişer ikişer
 * aralarında asal olmalı: ortak böleni olan iki döngü bazı birleşimleri hiç
 * üretmez (ör. 20 ve 8 ile "Kritik + Yeni" kayıt hiç oluşmuyordu).
 */
const ST_CYCLE: RecordStatus[] = [
  'COZULDU', 'COZULDU', 'YENI', 'COZULDU', 'INCELENIYOR', 'COZULDU', 'COZULDU', 'CALISILIYOR',
  'COZULDU', 'YENI', 'COZULDU', 'EK_BILGI', 'COZULDU', 'UZERIME_ALINDI', 'KAPATILDI',
  'YENI', 'COZULDU', 'CALISILIYOR', 'COZULDU', 'REDDEDILDI',
].map((s) => RecordStatus[s as keyof typeof RecordStatus]);

const PR_CYCLE: Priority[] = [
  'NORMAL', 'NORMAL', 'YUKSEK', 'NORMAL', 'KRITIK', 'NORMAL', 'YUKSEK', 'NORMAL', 'NORMAL',
].map((p) => Priority[p as keyof typeof Priority]);

const NEW_BANDS = [0.45, 0.88, 1.6, 0.72, 1.15, 0.55, 0.95];
const OPEN_BANDS = [0.3, 0.82, 0.55, 1.18, 0.88, 0.42, 0.95];

// ─────────────────────────────────────────────────────────────── sıfırlama

/**
 * Demo verisini siler. İki koruma: canlıda çalışmaz ve veritabanında demo
 * dışı (Entra'dan gelmiş) bir kullanıcı varsa çalışmaz — o, gerçek kullanımın
 * işaretidir.
 */
async function resetDemo() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('--reset canlıda çalıştırılamaz.');
  }
  const real = await prisma.user.count({ where: { NOT: { entraOid: { startsWith: 'seed:' } } } });
  if (real > 0) {
    throw new Error(
      `Veritabanında ${real} demo dışı kullanıcı var; bu gerçek veri olabilir. --reset yapılmadı.`,
    );
  }

  console.log('Demo verisi siliniyor…');
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.suggestion.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.recordEvent.deleteMany(),
    prisma.record.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.department.deleteMany(),
    prisma.counter.deleteMany(),
  ]);

  // ML veritabanındaki çalıştırma ve sonuç kayıtları eski kayıt numaralarına
  // bağlı; yeni kayıtlar aynı numaraları alacağı için istatistikler karışırdı.
  // Model sunucu açılışında yeni veriyle yeniden eğitilir.
  try {
    const require = createRequire(import.meta.url);
    const { PrismaClient: MlClient } = require('.prisma/ml-client') as typeof import('.prisma/ml-client');
    const ml = new MlClient();
    await ml.$transaction([
      ml.outcome.deleteMany(),
      ml.similarityMatch.deleteMany(),
      ml.departmentPrediction.deleteMany(),
      ml.inference.deleteMany(),
      ml.trainingSample.deleteMany(),
      ml.termWeight.deleteMany(),
      ml.departmentPrior.deleteMany(),
      ml.modelVersion.deleteMany(),
    ]);
    await ml.$disconnect();
    console.log('ML veritabanı temizlendi.');
  } catch (err) {
    console.log(`ML veritabanı temizlenemedi (atlandı): ${(err as Error).message.split('\n')[0]}`);
  }
}

// ─────────────────────────────────────────────────────────────── kurulum

async function main() {
  if (process.argv.includes('--reset')) await resetDemo();

  console.log('Departmanlar ve SLA…');
  const setup = await applyOrgConfig(prisma, CONFIG);
  if (setup.notInConfig.length) {
    console.log(`  [UYARI] Yapılandırmada olmayan departmanlar: ${setup.notInConfig.join(', ')} (--reset ile temizlenir)`);
  }

  console.log('Demo kullanıcılar…');
  const userIds = new Map<string, string>();
  for (const u of USERS) {
    const row = await prisma.user.upsert({
      // Entra yoksa oid yerine kararlı bir yer tutucu kullanılır; gerçek
      // girişte oid ile eşleşen ayrı kullanıcı açılır.
      where: { entraOid: `seed:${u.key}` },
      create: {
        entraOid: `seed:${u.key}`,
        email: `${slug(u.name)}@ornek.com`,
        name: u.name,
        role: u.role,
        departmentId: u.dept,
      },
      update: { name: u.name, role: u.role, departmentId: u.dept, active: true },
      select: { id: true },
    });
    userIds.set(u.key, row.id);
  }

  if (process.env.SEED_RECORDS === 'false') {
    console.log('SEED_RECORDS=false — kayıt üretilmedi.');
    return;
  }
  const existing = await prisma.record.count();
  if (existing > 0) {
    console.log(`Zaten ${existing} kayıt var, örnek kayıt üretimi atlandı. Baştan kurmak için: npm run db:seed -- --reset`);
    return;
  }

  console.log('Örnek kayıtlar…');
  const records = buildRecords(userIds);

  // Kayıt numaraları açılış sırasına göre verilir: en eski kayıt KAY-…-0001.
  records.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const year = new Date().getFullYear();
  let seq = 0;
  for (const r of records) {
    await prisma.record.create({
      data: { ...r, code: `KAY-${year}-${String(++seq).padStart(4, '0')}` },
    });
  }
  await prisma.counter.upsert({ where: { year }, create: { year, seq }, update: { seq } });

  const byDept = DEPARTMENTS.map((d) => `${d.short} ${records.filter((r) => r.departmentId === d.id).length}`);
  console.log(`${seq} kayıt oluşturuldu: ${byDept.join(' · ')}`);
  console.log('\nGeliştirme girişi için:');
  console.log(`  http://localhost:3000/auth/dev-login?email=${slug('Ömer Uygun')}@ornek.com`);
}

/**
 * Ünitelerin konularından kayıtları üretir. Üniteler sırayla birer kayıt
 * verir (round-robin) ki durum döngüsü her üniteye eşit dağılsın. Her konu
 * en fazla 4 biçimde görünür: 2 başlık × 2 açıklama.
 */
function buildRecords(userIds: Map<string, string>) {
  const slaHours: Record<Priority, number> = {
    NORMAL: CONFIG.sla.NORMAL, YUKSEK: CONFIG.sla.YUKSEK, KRITIK: CONFIG.sla.KRITIK,
  };
  const staff = USERS.filter((u) => u.dept);

  for (const d of DEPARTMENTS) {
    const topics = TOPICS[d.id];
    const count = COUNTS[d.id] ?? 0;
    if (!topics) throw new Error(`demo-data.ts: "${d.id}" için konu yok`);
    if (count > topics.length * 4) {
      throw new Error(`demo-data.ts: "${d.id}" için ${count} kayıt istenmiş, en fazla ${topics.length * 4} benzersiz kayıt üretilebilir`);
    }
  }

  // Round-robin sıra: [departman, o departmandaki sıra no]
  const queue: [string, number][] = [];
  for (let k = 0, added = true; added; k++) {
    added = false;
    for (const d of DEPARTMENTS) {
      if (k < (COUNTS[d.id] ?? 0)) {
        queue.push([d.id, k]);
        added = true;
      }
    }
  }

  return queue.map(([deptId, k], i) => {
    const d = DEPARTMENTS.find((x) => x.id === deptId)!;
    const topics = TOPICS[deptId]!;
    const topic = topics[k % topics.length]!;
    const round = Math.floor(k / topics.length); // 0..3
    const title = topic.titles[round % 2]!;
    const extra = CONTEXT[(i * 3) % CONTEXT.length]!;
    const description = [topic.details[Math.floor(round / 2) % 2]!, extra].filter(Boolean).join(' ');

    const status = ST_CYCLE[i % ST_CYCLE.length]!;
    const priority = PR_CYCLE[i % PR_CYCLE.length]!;
    const closed = status === 'COZULDU' || status === 'KAPATILDI' || status === 'REDDEDILDI';
    const isNew = status === RecordStatus.YENI;

    const team = staff.filter((u) => u.dept === deptId);
    const outsiders = staff.filter((u) => u.dept !== deptId);
    const creator = outsiders[(i * 7) % outsiders.length]!;
    const assignee = isNew ? null : team[i % team.length] ?? null;

    const limitH = slaHours[priority];
    let createdAt: Date;
    let firstResponseAt: Date | null = null;
    let resolvedAt: Date | null = null;
    if (closed) {
      const c = 4 + ((i * 2.7) % 85);
      createdAt = dAgo(c);
      firstResponseAt = dAgo(c - (0.15 + (i % 6) * 0.09));
      resolvedAt = dAgo(Math.max(0.4, c - 1 - (i % 5) * 0.7));
    } else if (isNew) {
      // Yaş, kaydın kendi SLA hedefinin oranı: panoda "akışta / daralıyor /
      // gecikmiş" üç durum da temsil edilir.
      createdAt = hAgo(Math.max(1, limitH * NEW_BANDS[i % NEW_BANDS.length]!));
    } else {
      const h = Math.max(1.5, limitH * OPEN_BANDS[i % OPEN_BANDS.length]!);
      createdAt = hAgo(h);
      firstResponseAt = hAgo(h * 0.8);
    }

    // Her beşinci kayıt ikinci bir üniteyle paylaşılır.
    const others = DEPARTMENTS.filter((x) => x.id !== deptId);
    const dept2 = i % 5 === 2 ? others[i % others.length]! : null;

    const by = (key: string) => userIds.get(key)!;
    const events: { type: string; text: string; at: Date; byId: string | null }[] = [
      { type: 'CREATE', at: createdAt, byId: by(creator.key), text: `Kayıt oluşturuldu ve ${d.name} ekibine iletildi.` },
    ];
    if (dept2) {
      events.push({ type: 'ASSIGN', at: createdAt, byId: by(creator.key), text: `Kayıt ayrıca ${dept2.name} ekibiyle paylaşıldı.` });
    }
    if (assignee) {
      events.push({
        type: 'ASSIGN', at: firstResponseAt ?? createdAt, byId: by(assignee.key),
        text: `Kayıt ${assignee.name} tarafından üzerine alındı.`,
      });
    }
    if (resolvedAt && status === RecordStatus.COZULDU && assignee) {
      events.push({ type: 'COMMENT', at: resolvedAt, byId: by(assignee.key), text: topic.resolution });
    }

    return {
      type: topic.type === 'oneri' ? RecordType.ONERI : RecordType.BILGI,
      title,
      description,
      priority,
      status,
      departmentId: deptId,
      department2Id: dept2?.id ?? null,
      createdById: by(creator.key),
      assigneeId: assignee ? by(assignee.key) : null,
      // Yeni kayıt formunda anonim gönderim yok; demo verisinde de yok.
      anonymous: false,
      resolution: status === RecordStatus.COZULDU ? topic.resolution : null,
      createdAt,
      firstResponseAt,
      resolvedAt,
      closedAt: closed ? resolvedAt : null,
      slaDueAt: new Date(createdAt.getTime() + limitH * HOUR),
      events: { create: events },
    };
  });
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
