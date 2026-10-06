/**
 * Yerel geliştirme için gömülü PostgreSQL 17.
 *
 * Gerçek PostgreSQL ikili dosyaları npm paketinden gelir (embedded-postgres,
 * devDependency): kurulum, yönetici yetkisi ya da Docker gerekmez. Yalnızca
 * geliştirme ve deneme içindir — kuruluşta uygulama BT'nin PostgreSQL
 * sunucusuna DATABASE_URL ile bağlanır, bu betik orada kullanılmaz.
 *
 *   npm run db:local          başlatır (zaten çalışıyorsa bir şey yapmaz)
 *   npm run db:local:stop     durdurur
 *   npm run db:local:status   çalışıyor mu
 *
 * NEDEN PROJE KLASÖRÜNDE DEĞİL: PostgreSQL'in Windows programları yolda
 * ASCII dışı karakter olunca (ör. "Masaüstü", "Topluluğu") kendi dosyalarını
 * bulamıyor. Ayrıca veri klasörünün OneDrive gibi eşitlenen bir yerde durması
 * veri bozulmasına yol açabilir. Programlar ve veri bu yüzden kullanıcının
 * yerel klasörüne alınır: Windows'ta %LOCALAPPDATA%\ichatlar, diğerlerinde
 * ~/.ichatlar. ICHATLAR_LOCAL_DIR ile değiştirilebilir.
 *
 * Sunucu yalnızca localhost'u dinler ve parola ister (scram-sha-256).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Yerel geliştirme ayarları — .env.example'daki DATABASE_URL bunlarla eşleşir. */
export const LOCAL_DEV = {
  port: 5433,
  user: 'ichatlar',
  password: 'ichatlar-local',
  dataDirName: 'pgdata',
} as const;

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** Programların ve verinin duracağı, yolunda ASCII dışı karakter olmayan klasör. */
export function localBaseDir(): string {
  if (process.env.ICHATLAR_LOCAL_DIR) return process.env.ICHATLAR_LOCAL_DIR;
  const candidates =
    process.platform === 'win32'
      ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ichatlar'),
         process.env.ProgramData && path.join(process.env.ProgramData, 'ichatlar')]
      : [path.join(os.homedir(), '.ichatlar')];
  const dir = candidates.find((c): c is string => !!c && isAscii(c));
  if (!dir) {
    throw new Error(
      'PostgreSQL için Türkçe karakter içermeyen bir klasör bulunamadı. ' +
        'ICHATLAR_LOCAL_DIR ortam değişkenini ör. C:\\ichatlar olarak ayarlayın.',
    );
  }
  return dir;
}

/** Bu platformun PostgreSQL programları; gerekirse ASCII yola kopyalanır. */
function binDir(): string {
  const pkgDir = path.join(projectRoot, 'node_modules', ...platformPackage().split('/'));
  const pkgJson = path.join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) {
    throw new Error(`${platformPackage()} bulunamadı — önce "npm install" çalıştırın.`);
  }
  const nativeDir = path.join(pkgDir, 'native');
  if (isAscii(nativeDir)) return path.join(nativeDir, 'bin');

  const version = JSON.parse(readFileSync(pkgJson, 'utf8')).version as string;
  const dest = path.join(localBaseDir(), `pg-${version}`);
  // pg_ctl en son kopyalanır: varlığı kopyanın tamamlandığının işaretidir.
  if (!existsSync(path.join(dest, 'bin', exe('pg_ctl')))) {
    console.log(`  PostgreSQL programları kopyalanıyor → ${dest} (bir kez, ~100 MB)`);
    copyTree(nativeDir, dest, path.join('bin', exe('pg_ctl')));
  }
  return path.join(dest, 'bin');
}

/**
 * Klasörü dosya dosya kopyalar. fs.cpSync kullanılmıyor: Node 24'te Windows'ta
 * kaynak yolunda ASCII dışı karakter varsa süreci hata vermeden çökertiyor.
 * `last` göreli yolundaki dosya en sona bırakılır.
 */
function copyTree(src: string, dest: string, last: string) {
  const deferred: [string, string][] = [];
  const walk = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, entry.name);
      const d = path.join(to, entry.name);
      if (entry.isDirectory()) walk(s, d);
      else if (path.relative(dest, d) === last) deferred.push([s, d]);
      else copyFileSync(s, d);
    }
  };
  walk(src, dest);
  for (const [s, d] of deferred) copyFileSync(s, d);
}

function platformPackage(): string {
  const key = `${process.platform}-${process.arch}`;
  const map: Record<string, string> = {
    'win32-x64': '@embedded-postgres/windows-x64',
    'darwin-arm64': '@embedded-postgres/darwin-arm64',
    'darwin-x64': '@embedded-postgres/darwin-x64',
    'linux-x64': '@embedded-postgres/linux-x64',
    'linux-arm64': '@embedded-postgres/linux-arm64',
  };
  const pkg = map[key];
  if (!pkg) throw new Error(`Gömülü PostgreSQL bu platformu desteklemiyor: ${key}`);
  return pkg;
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

function run(bin: string, args: string[], opts: { allowFail?: boolean; detach?: boolean } = {}) {
  const res = spawnSync(path.join(binDir(), exe(bin)), args, {
    cwd: localBaseDir(),
    encoding: 'utf8',
    windowsHide: true,
    // `pg_ctl start` çıktı borularını başlattığı sunucuya devreder; boru
    // bağlanırsa sunucu açık kaldıkça spawnSync hiç dönmez. Sunucu çıktısı
    // zaten -l ile günlük dosyasına gidiyor.
    ...(opts.detach ? { stdio: 'ignore' as const } : {}),
  });
  if (res.status !== 0 && !opts.allowFail) {
    const detail = opts.detach ? `Ayrıntı: ${path.join(localBaseDir(), '*.log')}` : res.stderr || res.stdout;
    throw new Error(`${bin} başarısız (kod ${res.status}):\n${detail}`);
  }
  return res;
}

export interface LocalPgOptions {
  port: number;
  user: string;
  password: string;
  dataDirName: string;
}

const dataDir = (o: LocalPgOptions) => path.join(localBaseDir(), o.dataDirName);

export function isRunning(o: LocalPgOptions = LOCAL_DEV): boolean {
  if (!existsSync(path.join(dataDir(o), 'PG_VERSION'))) return false;
  return run('pg_ctl', ['status', '-D', dataDir(o)], { allowFail: true }).status === 0;
}

/**
 * Kümeyi gerekirse kurar ve başlatır. Zaten çalışıyorsa dokunmaz.
 * Veritabanlarını oluşturmaz: `prisma migrate` hedef veritabanı yoksa kendisi oluşturur.
 * Bu çağrıyla başlatıldıysa true döner.
 */
export function startLocalPostgres(o: LocalPgOptions = LOCAL_DEV): boolean {
  const dir = dataDir(o);
  mkdirSync(localBaseDir(), { recursive: true });

  if (!existsSync(path.join(dir, 'PG_VERSION'))) {
    console.log(`  Yerel PostgreSQL kuruluyor → ${dir}`);
    const pwfile = path.join(os.tmpdir(), `ichatlar-pw-${process.pid}`);
    writeFileSync(pwfile, o.password, { mode: 0o600 });
    try {
      run('initdb', [
        '-D', dir,
        '-U', o.user,
        `--pwfile=${pwfile}`,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        // Türkçe büyük/küçük harf: "İZİN" ile "izin" ILIKE'ta eşleşsin diye ICU tr-TR.
        '--locale-provider=icu',
        '--icu-locale=tr-TR',
        '--locale=C',
        '--lc-messages=C',
      ]);
    } finally {
      rmSync(pwfile, { force: true });
    }
  }

  if (isRunning(o)) return false;

  run('pg_ctl', [
    'start', '-w', '-D', dir,
    '-l', path.join(localBaseDir(), `${o.dataDirName}.log`),
    '-o', `-p ${o.port} -c listen_addresses=localhost`,
  ], { detach: true });
  return true;
}

export function stopLocalPostgres(o: LocalPgOptions = LOCAL_DEV) {
  if (!isRunning(o)) return false;
  run('pg_ctl', ['stop', '-w', '-m', 'fast', '-D', dataDir(o)]);
  return true;
}

// Doğrudan çalıştırıldıysa: start | stop | status
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? 'start';
  const url = `postgresql://${LOCAL_DEV.user}:***@localhost:${LOCAL_DEV.port}/ichatlar`;
  try {
    if (cmd === 'stop') {
      console.log(stopLocalPostgres() ? '  Yerel PostgreSQL durduruldu.' : '  Yerel PostgreSQL zaten kapalı.');
    } else if (cmd === 'status') {
      console.log(isRunning() ? `  Çalışıyor: ${url}` : '  Kapalı.');
      process.exitCode = isRunning() ? 0 : 1;
    } else {
      const started = startLocalPostgres();
      console.log(`  ${started ? 'Başlatıldı' : 'Zaten çalışıyor'}: ${url}\n  Veri: ${dataDir(LOCAL_DEV)}`);
    }
  } catch (err) {
    console.error(`  [HATA] ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
