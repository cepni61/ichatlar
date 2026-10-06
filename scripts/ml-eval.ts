/**
 * ML ekip önerisinin gerçek isabetini ölçer: eğitim verisinde HİÇ geçmeyen,
 * elle yazılmış taleplerle.
 *
 *   npm run ml:eval
 *
 * Neden ayrı bir ölçüm: eğitim sırasında raporlanan birini-dışarıda-bırak
 * isabeti demo verisinde yanıltıcı derecede yüksek çıkar — her konu birkaç
 * biçimde tekrarlandığı için model test edilen kaydın "kardeşini" görmüş olur.
 * Buradaki sorular demo şablonlarından bağımsız yazıldı.
 *
 * Set B hiç düzeltme yapılmadan yazıldı (temiz). Set A ilk ölçümde düşen
 * soruları içerir; o düşüşlerden sonra veri ve model iyileştirildiği için
 * Set A artık iyimserdir — yalnızca gerilemeyi yakalamak için duruyor.
 *
 * Ekip kimlikleri demo yapılandırmasındakilerdir (config/kurulus.example.json).
 * Model sunucudakiyle aynı yoldan (ML veritabanı veya yeniden eğitim) yüklenir;
 * çalıştırma kaydı yazılmaz.
 */
import { ensureModel, suggestDepartment } from '../src/ml/service.js';
import { connectMl, disconnectMl } from '../src/ml/db.js';
import { disconnect } from '../src/db.js';

type Q = [dept: string, title: string, description: string];

const SET_B: Q[] = [
  ['bt', "Teams'te ekran paylaşımı çalışmıyor", 'Toplantıda ekranımı paylaşmaya çalışınca uygulama donuyor.'],
  ['bt', 'Yeni telefona kurumsal uygulamalar', 'Şirket telefonumu değiştirdim, Authenticator ve e-posta kurulumu gerekiyor.'],
  ['ik', 'Evlilik izni kaç gün', 'Önümüzdeki ay evleniyorum, evlilik izni hakkım kaç gün?'],
  ['ik', 'Kreş yardımı başvurusu', 'Çocuğum için kreş yardımından yararlanmak istiyorum, hangi belgeler gerekli?'],
  ['finans', 'Banka hesap bilgisi değişikliği', 'Masraf iadelerinin yatacağı banka hesabımı değiştirmek istiyorum.'],
  ['finans', 'Yıl sonu kapanış takvimi', 'Muhasebe yıl sonu kapanışı için faturaların son gönderim tarihi nedir?'],
  ['tedarik', 'Soğuk zincir aracı arızası', 'Sevkiyat aracındaki soğutucu arızalandı, ürünler başka araca aktarılmalı.'],
  ['tedarik', 'Fason üretim termini', 'Fason üreticideki partinin teslim tarihi kaydı, stok planı etkilenecek.'],
  ['ismuk', 'Kampanya sonrası satış raporu', 'Son kampanyanın bölge bazında satış etkisini gösteren rapor hazırlanabilir mi?'],
  ['ismuk', 'Hekim hedef listesinde mükerrer kayıt', 'Saha ekibinin ziyaret ettiği hekim hedef listesinde mükerrer kayıtlar var.'],
  ['kalite', 'Kutuda baskı hatası', 'Kutudaki son kullanma tarihi baskısı okunmuyor, ürün geri çekilmeli mi?'],
  ['kalite', 'Denetim bulgusunun kapatılması', 'Geçen ayki iç denetimde çıkan bulgunun düzeltici faaliyeti tamamlandı mı?'],
  ['medikal', 'İki ilacın birlikte kullanımı', 'Bir eczacı iki ilacımızın birlikte kullanımında etkileşim olup olmadığını soruyor.'],
  ['medikal', 'Bilimsel yayın talebi', 'Ürünün faz 3 çalışma yayınlarının tam metnini hekime iletmek istiyorum.'],
  ['kamu', 'Fiyat listesinde hata', 'Bakanlığın yayımladığı fiyat listesinde ürünümüzün fiyatı hatalı görünüyor.'],
  ['kamu', 'Yerli üretim teşviki görüşmesi', 'Sağlık Bakanlığı ile yerli üretim teşvikleri hakkında görüşme planlanıyor.'],
  ['spesifik', 'Onkoloji servisinde ilaç bulunamıyor', 'Bir üniversite hastanesinin onkoloji servisi ilacımızı bulamadığını bildirdi.'],
  ['spesifik', 'Nadir hastalıkta erken tanı', 'Nadir metabolik hastalıklarda erken tanı farkındalık programı düzenlemek istiyoruz.'],
  ['temel', 'Antibiyotik numune talebi', 'Pratisyen hekimler antibiyotik ürünümüz için numune talep ediyor.'],
  ['temel', 'Güneş kremi yeni sezon', 'Yaz sezonu için güneş koruyucu ürünlerimizin eczane siparişleri artırılmalı.'],
  ['tuketici', 'Reklam filminin onayı', 'Yeni televizyon reklamımızın senaryosu için marka ekibinin onayı gerekiyor.'],
  ['tuketici', 'Online mağaza yorumları', 'E-ticaret sitesindeki vitamin ürünümüze olumsuz tüketici yorumları geliyor.'],
  ['isgel', 'Yurt dışı fuar katılımı', 'Uluslararası ilaç fuarında yeni distribütörlerle görüşmek için stand açmak istiyoruz.'],
  ['isgel', 'Ürün portföyü satın alma fırsatı', 'Satılık bir ürün portföyü için şirket satın alma değerlendirmesi yapılabilir mi?'],
  ['gm', 'Basında çıkan haber', 'Şirketimiz hakkında çıkan haber için genel müdürlük açıklaması yapılacak mı?'],
  ['gm', 'Organizasyon yapısı değişikliği', 'Yeni organizasyon şemasının ve yönetim değişikliklerinin duyurusu ne zaman yapılacak?'],
];

const SET_A: Q[] = [
  ['bt', 'İnternet çok yavaş, Wi-Fi sürekli düşüyor', 'Ofisteki kablosuz ağa bağlanınca sayfalar açılmıyor.'],
  ['bt', 'Yeni başlayan arkadaş için hesap açılması', 'Ekibe katılan çalışan için dizüstü bilgisayar ve kullanıcı hesabı açılması gerekiyor.'],
  ['ik', 'Doğum izni sonrası yarı zamanlı çalışma', 'Doğum izni dönüşünde yarı zamanlı çalışma hakkımı kullanmak istiyorum.'],
  ['ik', 'Kıdem tazminatı hesaplaması', 'Emekliliğim yaklaşıyor, kıdem tazminatımın nasıl hesaplanacağını öğrenmek istiyorum.'],
  ['finans', 'Döviz kuru farkı faturası', 'Euro bazlı faturada kur farkı nasıl muhasebeleşecek?'],
  ['finans', 'Seyahat harcamalarımın geri ödemesi', 'Ankara seyahatindeki taksi ve otel masraflarımı geri almak istiyorum.'],
  ['tedarik', 'Siparişler depodan çıkmıyor', 'Ecza depolarından gelen siparişler lojistik merkezde bekliyor, sevk edilmiyor.'],
  ['tedarik', 'Hammadde fiyat artışı', 'Tedarikçi etken madde fiyatlarına zam yaptı, alternatif tedarikçi bulunabilir mi?'],
  ['ismuk', 'Mümessil tablet uygulaması hatası', 'Saha ekibinin kullandığı CRM tablet uygulaması ziyaret girişinde hata veriyor.'],
  ['ismuk', 'Pazar payı ve hedef analizi', 'Bölgelere göre pazar payı ve satış hedef gerçekleşme analizini görmek istiyorum.'],
  ['kalite', 'Tablette kırılma şikayeti', 'Bir hasta kutudan kırık tabletler çıktığını bildirdi, parti numarası elimde.'],
  ['kalite', 'Temiz oda sıcaklık sapması', 'Üretim alanındaki temiz odada sıcaklık limit dışına çıktı, sapma açılmalı mı?'],
  ['medikal', 'Gebelikte kullanım sorusu', 'Bir jinekolog ürünün gebelikte kullanımına dair güvenlilik verisi istiyor.'],
  ['medikal', 'Hekim yan etki bildirdi', 'Kardiyolog hastasında döküntü gelişti dedi, bu olayı nereye bildirmeliyim?'],
  ['kamu', 'Ürün reçete ödeme koşulu', 'Ürünümüzün SGK tarafından ödenmesi için gereken rapor koşulu değişti mi?'],
  ['kamu', 'Devlet hastanesi doğrudan alım', 'Devlet hastanesinin doğrudan alım ilanına teklif vermek istiyoruz.'],
  ['spesifik', 'Kanser ilacı hastaya ulaşmıyor', 'Onkoloji hastası ilacını eczaneden temin edemiyor, erişim için ne yapabiliriz?'],
  ['spesifik', 'Biyolojik ilacın saklanması', 'Hastanedeki biyoteknolojik ürünün saklama sıcaklığı hakkında hemşireler soru soruyor.'],
  ['temel', 'Ağrı kesici eczane kampanyası', 'Ağrı kesici ürünümüz için eczanelere yönelik bahar kampanyası planlayabilir miyiz?'],
  ['temel', 'Cilt bakım kreminde büyük boy', 'Nemlendirici kremimizin büyük boy ambalajı eczanelerde talep görüyor.'],
  ['tuketici', 'Sosyal medya fenomen iş birliği', 'Vitamin markamız için sosyal medya fenomenleriyle iş birliği yapmak istiyoruz.'],
  ['tuketici', 'Takviye ürünü market rafında', 'Gıda takviyemizin zincir marketlerde daha görünür olması için ne yapabiliriz?'],
  ['isgel', "Doğu Avrupa'ya ihracat", "Doğu Avrupa'daki bir distribütör ürünlerimizi ithal etmek istiyor."],
  ['isgel', 'Yabancı firmayla ortaklık teklifi', 'Bir Kore firması biyobenzer ürün için lisans ve ortaklık teklif etti.'],
  ['gm', 'Şirket vizyonu ve değerleri', 'Şirketimizin yeni vizyon ve değerler çalışmasının sonuçları ne zaman açıklanacak?'],
  ['gm', 'Üst yönetime öneri', 'Genel müdüre doğrudan iletmek istediğim şirket geneli bir önerim var.'],
];

const quiet = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return quiet; } } as never;

function run(name: string, set: Q[]) {
  let top1 = 0, top3 = 0, low = 0, wrongButSure = 0;
  console.log(`\n${name}`);
  for (const [want, title, desc] of set) {
    const s = suggestDepartment(title, desc);
    const ids = (s?.candidates ?? []).map((c) => c.departmentId);
    const ok1 = ids[0] === want;
    const ok3 = ids.slice(0, 3).includes(want);
    const isLow = s?.lowConfidence ?? true;
    top1 += +ok1; top3 += +ok3; low += +isLow;
    if (!ok1 && !isLow) wrongButSure++;
    if (!ok1) {
      const c0 = s?.candidates[0];
      console.log(
        `  ${ok3 ? '~' : '✗'} ${want} → ${c0?.departmentId ?? '-'} %${Math.round((c0?.probability ?? 0) * 100)}` +
          `${isLow ? ' (düşük güven)' : ''}  [${ids.slice(0, 3).join(', ')}]  "${title}"`,
      );
    }
  }
  const pct = (n: number) => `${n}/${set.length} (%${Math.round((n / set.length) * 100)})`;
  console.log(`  İlk öneri doğru: ${pct(top1)} · İlk 3'te: ${pct(top3)} · Düşük güvenli: ${low} · Yanlış ama emin: ${wrongButSure}`);
}

await connectMl(quiet);
await ensureModel(quiet);
run('Set B — temiz, hiç ayarlanmadı', SET_B);
run('Set A — ilk ölçüm (iyileştirmeden sonra iyimser)', SET_A);
await disconnectMl();
await disconnect();
