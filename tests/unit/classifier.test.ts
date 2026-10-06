import { describe, expect, it } from 'vitest';
import { featurize, predict, train, type Doc } from '../../src/ml/classifier.js';

const keys = (title: string, desc = '') => [...featurize(title, desc).weights.keys()];

describe('ML özellik çıkarımı', () => {
  it('sabit önek kökleme: aynı kavramın ekli hâlleri tek özellik', () => {
    expect(keys('bordro bordrom bordroya')).toEqual(['bordr']);
  });

  it('yokluk eki ayrı özellik: "reçetesiz" ile "reçete" karışmaz', () => {
    const a = keys('Reçetesiz ürün');
    const b = keys('Reçete koşulu');
    expect(a).toContain('recet~');
    expect(b).toContain('recet');
    expect(a).not.toContain('recet');
  });

  it('kısa ve -siz ile biten olağan kelimeler bozulmaz', () => {
    // "siz" (zamir) 3 harf, ön kısmı 3 harften kısa olduğu için eke sayılmaz
    expect(keys('ödenmesi')).toEqual(['odenm']);
  });

  it('başlık açıklamadan ağır basar', () => {
    const f = featurize('izin', 'bordro');
    expect(f.weights.get('izin')).toBeGreaterThan(f.weights.get('bordr')!);
  });
});

describe('ML sınıflandırıcı', () => {
  const doc = (code: string, departmentId: string, title: string, description: string): Doc => ({
    code, departmentId, features: featurize(title, description), corrected: false,
  });
  const docs = [
    doc('1', 'kamu', 'Reçete ödeme koşulu', 'Uzman hekim raporu ve reçete şartı'),
    doc('2', 'kamu', 'Reçete kuralı değişti', 'Ödeme kapsamındaki reçete rapor koşulu'),
    doc('3', 'tuketici', 'Reçetesiz ürün kampanyası', 'Reçetesiz vitamin için market kampanyası'),
    doc('4', 'tuketici', 'Reçetesiz marka listeleme', 'Reçetesiz takviye zincir markette'),
  ];
  const model = train(docs, [{ id: 'kamu', name: 'Kamu' }, { id: 'tuketici', name: 'Tüketici' }]);

  it('reçete sorusunu geri ödemeye, reçetesiz sorusunu tüketici sağlığına yönlendirir', () => {
    expect(predict(model, featurize('Reçete rapor koşulu', '')).ranked[0]!.departmentId).toBe('kamu');
    expect(predict(model, featurize('Reçetesiz ürün', 'market')).ranked[0]!.departmentId).toBe('tuketici');
  });
});
