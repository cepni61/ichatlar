import { readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { cleanFilename, contentDisposition, mimeFor } from '../../src/domain/attachments.js';
import { saveStream } from '../../src/lib/storage.js';
import { env } from '../../src/env.js';

describe('ek dosya türü', () => {
  it('iş belgeleri ve görseller kabul edilir, tür uzantıdan belirlenir', () => {
    expect(mimeFor('rapor.PDF')).toBe('application/pdf');
    expect(mimeFor('tablo.xlsx')).toContain('spreadsheetml');
    expect(mimeFor('ekran.png')).toBe('image/png');
  });

  it('tarayıcıda ya da bilgisayarda çalışabilecek türler reddedilir', () => {
    for (const n of ['sayfa.html', 'cizim.svg', 'betik.js', 'kurulum.exe', 'makro.docm', 'uzantisiz', 'rapor.pdf.exe']) {
      expect(mimeFor(n), n).toBeNull();
    }
  });
});

describe('dosya adı temizleme', () => {
  it('yol parçalarını ve tehlikeli karakterleri atar, Türkçeyi korur', () => {
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('C:\\Users\\x\\Çözüm Raporu.pdf')).toBe('Çözüm Raporu.pdf');
    expect(cleanFilename('a"b<c>.pdf')).toBe('abc.pdf');
    expect(cleanFilename('..')).toBe('dosya');
  });

  it('uzun adı uzantıyı koruyarak kısaltır', () => {
    const n = cleanFilename('x'.repeat(300) + '.pdf');
    expect(n.length).toBe(120);
    expect(n.endsWith('.pdf')).toBe(true);
  });
});

describe('indirme başlığı', () => {
  it('ASCII yedek ad ve UTF-8 asıl ad içerir, tırnak kaçmaz', () => {
    const h = contentDisposition('Çözüm "son".pdf');
    expect(h).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(h).toContain(encodeURIComponent('Çözüm "son".pdf'));
    expect(h.split('filename="')[1]!.split('"')[0]).not.toContain('"');
  });

  it('yedek ad Türkçe harfleri okunur ASCII karşılığına çevirir', () => {
    expect(contentDisposition('İzin Çizelgesi ığüşö.pdf')).toContain('filename="Izin Cizelgesi iguso.pdf"');
  });
});

describe('ek dosyanın diske yazılması', () => {
  it('yarıda kesilen yükleme diskte parça dosya bırakmaz', async () => {
    const files = () => readdir(env.STORAGE_DIR, { recursive: true, withFileTypes: true })
      .then((l) => l.filter((e) => e.isFile()).length, () => 0);
    const before = await files();
    const cut = new Readable({
      read() {
        this.push(Buffer.alloc(1024));
        this.destroy(new Error('bağlantı koptu'));
      },
    });
    await expect(saveStream(cut)).rejects.toThrow('bağlantı koptu');
    expect(await files()).toBe(before);
  });
});
