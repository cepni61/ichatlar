/**
 * Tohum verisi. Departmanlar, SLA kuralları, demo kullanıcılar ve
 * ichatlar4.html'deki kayıt şablonlarından üretilmiş örnek kayıtlar.
 *
 * Üretimde kullanıcılar Entra ID'den gelir — bu betiğin kullanıcı kısmı
 * yalnızca geliştirme ve demo içindir. `SEED_RECORDS=false` ile kayıt
 * üretimi kapatılıp sadece departman + SLA kurulumu yapılabilir.
 */
import { PrismaClient } from '@prisma/client';
import { Priority, RecordStatus, RecordType, Role } from '../src/domain/enums.js';

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const hAgo = (h: number) => new Date(Date.now() - h * HOUR);
const dAgo = (d: number) => new Date(Date.now() - d * DAY);

const DEPARTMENTS = [
  { id: 'ik', name: 'İnsan Kaynakları', short: 'İK', order: 1 },
  { id: 'ki', name: 'Kurumsal İletişim', short: 'Kurumsal İlt.', order: 2 },
  { id: 'idari', name: 'İdari İşler', short: 'İdari İşler', order: 3 },
  { id: 'fin', name: 'Finans', short: 'Finans', order: 4 },
  { id: 'sat', name: 'Satın Alma', short: 'Satın Alma', order: 5 },
  { id: 'kalite', name: 'Kalite', short: 'Kalite', order: 6 },
];

const SLA = [
  { priority: Priority.NORMAL, hours: 48, warnRatio: 0.7 },
  { priority: Priority.YUKSEK, hours: 24, warnRatio: 0.7 },
  { priority: Priority.KRITIK, hours: 8, warnRatio: 0.7 },
];

/** Demo kullanıcılar — e-postalar örnek alan adında, gerçek kişi değil. */
const USERS = [
  { key: 'u1', name: 'Ömer Uygun', dept: 'ik', role: Role.TEAM_MEMBER },
  { key: 'u2', name: 'Ayşe Kaya', dept: 'ik', role: Role.TEAM_MEMBER },
  { key: 'u3', name: 'Mehmet Demir', dept: 'ik', role: Role.MANAGER },
  { key: 'u4', name: 'Melda Yalçın', dept: 'ik', role: Role.TEAM_MEMBER },
  { key: 'u5', name: 'Deniz Acar', dept: 'ki', role: Role.TEAM_MEMBER },
  { key: 'u6', name: 'Selin Aydın', dept: 'ki', role: Role.MANAGER },
  { key: 'u7', name: 'Kerem Yıldız', dept: 'idari', role: Role.TEAM_MEMBER },
  { key: 'u8', name: 'Murat Koç', dept: 'idari', role: Role.TEAM_MEMBER },
  { key: 'u9', name: 'Zeynep Şahin', dept: 'fin', role: Role.TEAM_MEMBER },
  { key: 'u10', name: 'Ece Sarı', dept: 'fin', role: Role.MANAGER },
  { key: 'u11', name: 'Elif Arslan', dept: 'sat', role: Role.TEAM_MEMBER },
  { key: 'u12', name: 'Cem Öztürk', dept: 'kalite', role: Role.TEAM_MEMBER },
  { key: 'admin', name: 'Sistem Yöneticisi', dept: null, role: Role.ADMIN },
];

const slug = (name: string) =>
  name
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');

/** [tür, başlık, açıklama, çözüm] — ichatlar4.html'den birebir. */
const TPL: Record<string, [string, string, string, string][]> = {
  ik: [
    ['bilgi', 'İşe giriş belgesi talebi', 'Banka kredisi başvurum için işe giriş bildirgemin bir kopyasını rica ediyorum.', 'Belge e-imzalı olarak hazırlandı ve kurumsal e-posta adresinize iletildi.'],
    ['bilgi', 'Yıllık izin bakiyesi düzeltme talebi', 'İzin bakiyem sistemde eksik görünüyor, geçen yıldan devreden günler işlenmemiş.', 'Devir kaydı manuel olarak işlendi, bakiye güncellendi ve ekran görüntüsü paylaşıldı.'],
    ['oneri', 'Oryantasyon programının zenginleştirilmesi', 'Yeni başlayanlar için departman tanıtım turu ve mentör eşleştirmesi eklenmesini öneriyorum.', 'Öneri kabul edildi; yeni oryantasyon akışına departman turu ve ilk hafta mentör ataması eklendi.'],
    ['bilgi', 'Eğitim katılım belgesi talebi', 'Geçen ay tamamladığım liderlik eğitimi için katılım belgesi rica ediyorum.', 'Katılım belgesi PDF olarak iletildi ve özlük dosyanıza eklendi.'],
    ['bilgi', 'Bordro dökümü talebi', 'Son üç aya ait bordro dökümlerime ihtiyacım var.', 'Bordrolar İK portalında erişime açıldı, ayrıca e-posta ile de gönderildi.'],
    ['oneri', 'Esnek çalışma saatleri önerisi', 'Giriş-çıkış saatlerinde bir saatlik esneklik uygulamasına geçilmesini öneriyorum.', 'Pilot uygulama kararı alındı; iki departmanda üç ay boyunca denenecek.'],
    ['bilgi', 'Çalışma belgesi talebi', 'Vize başvurum için güncel çalışma belgesi rica ediyorum.', 'Çalışma belgesi aynı gün hazırlanıp elden teslim edildi.'],
    ['oneri', 'Kariyer haritalarının güncellenmesi', 'Departman bazlı kariyer haritalarının güncel rollerle yenilenmesini öneriyorum.', 'Kariyer haritaları güncellendi ve intranette yayınlandı.'],
    ['bilgi', 'Özel sağlık sigortası kapsam güncellemesi', 'Yeni doğan çocuğumun sağlık sigortası kapsamına eklenmesini talep ediyorum.', 'Sigorta şirketine bildirim yapıldı, kapsam güncellemesi tamamlandı.'],
    ['bilgi', 'BES kesintisi düzeltme talebi', 'Bu ayki bireysel emeklilik kesintim çift yapılmış görünüyor.', 'Fazla kesinti tespit edildi; iade bir sonraki bordroya yansıtıldı.'],
    ['oneri', 'İç eğitim kataloğu oluşturulması', 'Tüm iç eğitimlerin tek katalogda toplanmasını ve dönemsel yayınlanmasını öneriyorum.', 'Eğitim kataloğu hazırlandı; çeyrek bazında güncellenerek yayınlanacak.'],
    ['bilgi', 'Fazla mesai onayı düzeltme talebi', 'Geçen haftaki fazla mesai kaydım onay akışında görünmüyor.', 'Kayıt yönetici onayına yeniden gönderildi ve işleme alındı.'],
    ['oneri', 'Çalışan takdir programı önerisi', 'Aylık teşekkür kartı uygulaması ile ekipler arası takdirin görünür olmasını öneriyorum.', 'Öneri kabul edildi; takdir programı iletişim planıyla birlikte devreye alınacak.'],
    ['bilgi', 'Görev tanımı güncelleme talebi', 'Görev tanımım mevcut sorumluluklarımı yansıtmıyor, güncellenmesini talep ediyorum.', 'Yöneticiyle birlikte görev tanımı revize edildi ve sisteme yüklendi.'],
    ['oneri', 'Mentorluk programı başlatılması', 'Deneyimli çalışanlarla yeni mezunları eşleştiren bir mentorluk programı öneriyorum.', 'Mentorluk programı pilotu on eşleşme ile başlatıldı.'],
    ['bilgi', 'Performans hedef girişi süre uzatımı', 'Hedef giriş ekranı kapandı, girişimi tamamlayamadım; süre uzatımı rica ediyorum.', 'Ekran üç gün süreyle yeniden açıldı, hedef girişi tamamlandı.'],
    ['oneri', 'Uzaktan çalışma politikasının netleştirilmesi', 'Hibrit çalışma günlerinin ekip bazında netleştirilmesini öneriyorum.', 'Politika güncellendi; ekip bazlı gün planı tüm yöneticilere iletildi.'],
    ['bilgi', 'Doğum yardımı ödemesi talebi', 'Doğum yardımı ödemesinin tarafıma yapılmasını talep ediyorum.', 'Gerekli belgeler tamamlandı; ödeme bordro dönemine yansıtıldı.'],
    ['oneri', 'Yan hakların çalışan anketiyle belirlenmesi', 'Yan hak paketinin yıllık çalışan anketi ile şekillendirilmesini öneriyorum.', 'Anket tasarlandı; sonuçlar gelecek yıl yan hak planlamasına girdi olacak.'],
    ['bilgi', 'Askerlik sevk belgesi bildirimi', 'Askerlik sevk tarihimi bildirmek ve ücretsiz izin sürecini başlatmak istiyorum.', 'Ücretsiz izin süreci başlatıldı, dönüş planı yöneticinizle paylaşıldı.'],
    ["bilgi", "Emeklilik için hizmet dökümü talebi", "SGK emeklilik başvurumda kullanmak üzere kurumdaki hizmet dökümüme ihtiyacım var.", "Hizmet dökümü İK sisteminden alınıp kaşeli ve imzalı olarak elden teslim edildi."],
    ["bilgi", "Evlilik izni kaç gün kullanılabilir", "Önümüzdeki ay evleniyorum; evlilik izninin süresi ve başvuru şeklini öğrenmek istiyorum.", "Yönetmelik gereği 3 iş günü ücretli evlilik izni tanımlı; başvuru İK Portalı > İzin Talebi ekranından yapılır. Bilgi notu iletildi."],
    ["oneri", "Anlaşmalı kreş desteği sağlanması", "Küçük çocuğu olan çalışanlar için anlaşmalı kreş veya kreş desteği sunulmasını öneriyorum.", "Bölgedeki üç kreşle görüşüldü; iki kurumla indirimli anlaşma yapıldı ve duyurusu yayınlandı."],
    ["bilgi", "Kullanılmayan iznin bir sonraki yıla devri", "Bu yıl kullanamadığım izin günlerinin ne kadarının gelecek yıla devredebileceğini öğrenmek istiyorum.", "Devir kuralı en fazla 10 gün olarak uygulanmaktadır; kalan bakiyeniz ve devir tutarınız e-posta ile iletildi."],
    ["oneri", "Mülakatlarda yapılandırılmış soru seti", "İşe alım görüşmelerinde pozisyona özel standart soru seti ve puanlama kullanılmasını öneriyorum.", "Yetkinlik bazlı soru bankası ve değerlendirme formu hazırlandı; işe alım ekibine eğitim verildi."],
    ["bilgi", "Staj programı başvuru takvimi", "Yaz dönemi staj programının başvuru tarihlerini ve kontenjanı öğrenmek istiyorum.", "Başvurular Mart ayında açılıyor; program takvimi ve kontenjan bilgisi paylaşıldı."],
    ["oneri", "Çalışan memnuniyet anketinin altı ayda bir yapılması", "Yıllık yerine altı aylık nabız anketiyle geri bildirimin daha hızlı toplanmasını öneriyorum.", "Kısa nabız anketi tasarlandı; yılda iki kez uygulanmak üzere takvime alındı."],
    ["bilgi", "İstirahat raporu teslim süreci", "Aldığım istirahat raporunu kaç gün içinde ve hangi kanaldan iletmem gerektiğini öğrenmek istiyorum.", "Raporun ilk iş günü içinde İK Portalı üzerinden yüklenmesi yeterlidir; adım adım kılavuz gönderildi."],
    ["oneri", "Doğum sonrası kademeli işe dönüş", "Doğum izni sonrası ilk ay yarı zamanlı çalışma imkânı tanınmasını öneriyorum.", "Pilot uygulama onaylandı; ilk ay yarı zamanlı dönüş seçeneği politikaya eklendi."],
    ["bilgi", "Performans sonucuna itiraz süreci", "Değerlendirme sonucuma itiraz etmek istiyorum, izlenecek adımları öğrenebilir miyim?", "İtiraz formu iletildi; süreç yönetici, İK iş ortağı ve bölüm direktörü ile üçlü görüşme şeklinde işletildi."],
    ["oneri", "İç ilan sisteminin kurulması", "Açık pozisyonların dışarıya ilan edilmeden önce çalışanlara duyurulmasını öneriyorum.", "İç ilan panosu intranette açıldı; pozisyonlar bir hafta boyunca önce çalışanlara duyuruluyor."],
    ["bilgi", "Engelli vergi indirimi başvurusu", "Vergi indiriminden yararlanmak için hangi belgeleri sunmam gerektiğini öğrenmek istiyorum.", "Gerekli belge listesi iletildi; başvuru bordro ekibine yönlendirildi ve indirim bir sonraki dönemde uygulandı."],
    ["oneri", "Yabancı dil eğitimi desteği", "Görevi gereği yabancı dil kullanan çalışanlara online dil eğitimi desteği verilmesini öneriyorum.", "Online platform lisansı alındı; ilk etapta 40 kişilik kontenjanla başlatıldı."],
    ["bilgi", "İzin onay akışında yönetici değişikliği", "Yöneticim değişti ancak izin taleplerim eski yöneticime gidiyor, düzeltilmesini rica ederim.", "Organizasyon şeması güncellendi; onay akışı yeni yöneticinize yönlendirildi."],
    ["oneri", "Çıkış mülakatı sonuçlarının raporlanması", "Ayrılan çalışanların geri bildirimlerinin çeyreklik özet raporla yönetime sunulmasını öneriyorum.", "Çıkış mülakatı formu standartlaştırıldı; ilk çeyreklik özet rapor yönetim ekibiyle paylaşıldı."],
    ["bilgi", "Ücret zammı uygulama tarihi", "Bu yılki ücret artışının hangi maaş döneminde yansıyacağını öğrenmek istiyorum.", "Artış Ocak bordrosuna yansıtılmıştır; fark ödemesi aynı ay içinde hesaba geçmiştir."],
  ],
  ki: [
    ['bilgi', 'Kurumsal sunum şablonu talebi', 'Müşteri sunumu için güncel kurumsal sunum şablonuna ihtiyacım var.', 'Güncel şablon seti paylaşıldı ve intranet bağlantısı iletildi.'],
    ['oneri', 'İç iletişim bülteninin aylık yayınlanması', 'Bültenin düzenli aylık formata geçmesini öneriyorum.', 'Bülten aylık periyoda alındı; ilk sayı yayınlandı.'],
    ['bilgi', 'Etkinlik duyurusu yayınlama talebi', 'Departman etkinliğimizin intranet ve panolarda duyurulmasını rica ediyorum.', 'Duyuru görseli hazırlandı ve tüm iç kanallarda yayınlandı.'],
    ['oneri', 'Intranet ana sayfasının sadeleştirilmesi', 'Ana sayfada en çok kullanılan bağlantıların öne çıkarılmasını öneriyorum.', 'Ana sayfa düzeni yenilendi; hızlı erişim alanı eklendi.'],
    ['bilgi', 'Logo kullanım kılavuzu talebi', 'Tedarikçiyle paylaşmak üzere logo kullanım kılavuzuna ihtiyacım var.', 'Marka kılavuzu ve doğru logo paketi iletildi.'],
    ['oneri', 'Çalışan başarı hikayeleri köşesi', 'İntranette aylık çalışan başarı hikayeleri köşesi açılmasını öneriyorum.', 'Köşe açıldı; ilk hikaye yayına alındı.'],
    ['bilgi', 'Sosyal medya paylaşım onayı', 'Ekibimizin aldığı ödül haberinin kurumsal hesaplardan paylaşılmasını talep ediyorum.', 'İçerik onaylandı ve kurumsal hesaplardan paylaşıldı.'],
    ['oneri', 'Tek kanal kayıt yönetimi iletişimi', 'Yeni kayıt yönetim sisteminin tüm çalışanlara tanıtım kampanyasıyla duyurulmasını öneriyorum.', 'İletişim planı hazırlandı; tanıtım videosu ve e-posta serisi yayınlandı.'],
    ["bilgi", "Basın bülteni onay süreci", "Departmanımızın projesi için basın bülteni hazırlamak istiyoruz, onay adımlarını öğrenebilir miyiz?", "Bülten taslağı Kurumsal İletişim'e iletilir, hukuk ve yönetim onayı sonrası yayınlanır; akış şeması paylaşıldı."],
    ["oneri", "Aylık yönetici video mesajı", "Genel müdür mesajının yazılı bülten yerine kısa video formatında paylaşılmasını öneriyorum.", "İlk video mesaj çekildi; aylık yayın takvimine alındı ve izlenme oranı yazılı bültenin iki katı oldu."],
    ["bilgi", "Kurumsal fotoğraf arşivine erişim", "Sunumda kullanmak üzere kurumsal fotoğraf arşivine erişim yetkisi rica ediyorum.", "Arşiv klasörüne görüntüleme yetkisi tanımlandı; kullanım koşulları iletildi."],
    ["oneri", "Intranet arama motorunun iyileştirilmesi", "İntranette doküman aramak zor; arama sonuçlarının departman ve tarihe göre filtrelenmesini öneriyorum.", "Arama modülü güncellendi; departman, tarih ve doküman türü filtreleri eklendi."],
    ["bilgi", "Kartvizit basım talebi", "Yeni görevim için kartvizit bastırmak istiyorum, süreç nasıl işliyor?", "Kartvizit talep formu iletildi; tasarım onayı sonrası baskı 5 iş gününde teslim edildi."],
    ["oneri", "Sürdürülebilirlik raporunun çalışanlara özetlenmesi", "Yıllık sürdürülebilirlik raporunun çalışanlar için kısa bir infografikle özetlenmesini öneriyorum.", "Tek sayfalık infografik hazırlandı; intranet ve panolarda yayınlandı."],
    ["bilgi", "Kurumsal e-posta imza şablonu", "Güncel e-posta imza şablonunu ve nasıl kurulacağını öğrenmek istiyorum.", "Güncel imza şablonu ve kurulum adımları gönderildi."],
  ],
  idari: [
    ['bilgi', 'Ofis sıcaklığı ayarı talebi', 'Üçüncü kat öğleden sonra aşırı ısınıyor, klima ayarının gözden geçirilmesini rica ediyorum.', 'Bina yönetimiyle görüşüldü; setpoint 22°C ye çekildi, ölçümler normale döndü.'],
    ['oneri', 'Yemekhanede vejetaryen seçenek', 'Her gün en az bir vejetaryen ana yemek bulunmasını öneriyorum.', 'Tedarikçiyle anlaşıldı; menüye günlük vejetaryen ana yemek eklendi.'],
    ['bilgi', 'Toplantı odası ekipman talebi', 'B2 toplantı odasına HDMI kablosu ve sunum tıklayıcısı gerekiyor.', 'Ekipmanlar temin edildi ve odaya sabitlendi.'],
    ['oneri', 'Servis saatlerinin gözden geçirilmesi', 'Sabah giriş yoğunluğuna göre servis saatlerinin yeniden değerlendirilmesini öneriyorum.', 'Alternatif saat anketi yapıldı; iki güzergâhta kalkış saati güncellendi.'],
    ['bilgi', 'Otopark kartı talebi', 'Yeni aracım için otopark geçiş kartı talep ediyorum.', 'Kart tanımlandı ve elden teslim edildi.'],
    ['oneri', 'Ofis geri dönüşüm istasyonları', 'Katlara cam, plastik ve kağıt ayrıştırma üniteleri konulmasını öneriyorum.', 'Her kata üçlü geri dönüşüm ünitesi yerleştirildi.'],
    ['bilgi', 'Kartlı geçiş yetkisi güncelleme', 'Arşiv odasına erişim yetkimin tanımlanmasını talep ediyorum.', 'Yetki tanımı yapıldı; kart aynı gün aktif edildi.'],
    ['oneri', 'Toplantı odası rezervasyon sürecinin sadeleştirilmesi', 'Rezervasyonun takvim üzerinden tek adımda yapılabilmesini öneriyorum.', 'Takvim entegrasyonu devreye alındı; rezervasyon tek adıma indirildi.'],
    ["bilgi", "Ofis temizlik hizmeti saatleri", "Çalışma alanlarının hangi saatlerde temizlendiğini öğrenmek istiyorum.", "Temizlik programı 07:00-09:00 ve 18:00 sonrası olarak uygulanmaktadır; detaylı çizelge paylaşıldı."],
    ["oneri", "Kat mutfaklarına filtreli su sistemi", "Damacana yerine kat mutfaklarına filtreli su sistemi kurulmasını öneriyorum.", "Üç katta pilot kurulum yapıldı; plastik tüketimi azaldığı için tüm katlara yaygınlaştırma kararı alındı."],
    ["bilgi", "Kargo ve posta gönderim süreci", "Kurumsal kargo göndermek için izlenecek adımları öğrenmek istiyorum.", "Gönderi formu ve anlaşmalı kargo bilgileri iletildi; günlük son teslim saati 16:00 olarak bildirildi."],
    ["oneri", "Bisiklet park alanı ve duş kabini", "İşe bisikletle gelenler için kapalı park alanı ve duş imkânı sağlanmasını öneriyorum.", "Zemin katta bisiklet park alanı oluşturuldu; mevcut duş kabinleri kullanıma açıldı."],
    ["bilgi", "Arşiv odası kullanım talimatı", "Fiziksel arşive doküman teslim ederken uyulması gereken kuralları öğrenmek istiyorum.", "Arşivleme talimatı ve etiket şablonu gönderildi; teslim randevusu oluşturuldu."],
    ["oneri", "Toplantı odalarına doluluk ekranı", "Oda kapılarına anlık doluluk gösteren küçük ekranlar konulmasını öneriyorum.", "Altı toplantı odasına takvim entegrasyonlu doluluk ekranı kuruldu."],
    ["bilgi", "Yangın tatbikatı tarihi", "Bu yılki yangın tahliye tatbikatının ne zaman yapılacağını öğrenmek istiyorum.", "Tatbikat tarihi ve kat sorumluları listesi tüm çalışanlara duyuruldu."],
    ["oneri", "Ortak alanların bitkilendirilmesi", "Ortak çalışma alanlarına bakımı kolay bitkiler yerleştirilmesini öneriyorum.", "Peyzaj firmasıyla anlaşıldı; ortak alanlara bakım sözleşmeli bitkiler yerleştirildi."],
  ],
  fin: [
    ['bilgi', 'Seyahat masraf iadesi talebi', 'Geçen haftaki şehir dışı görev masraflarımın iadesini talep ediyorum.', 'Beyan onaylandı; iade ödemesi banka hesabınıza aktarıldı.'],
    ['bilgi', 'Fatura kopyası talebi', 'Mart ayına ait eğitim faturasının kopyasını rica ediyorum.', 'Fatura kopyası e-arşivden alınarak iletildi.'],
    ['oneri', 'Masraf beyanının mobilden yapılabilmesi', 'Fiş fotoğrafı ile mobil masraf beyanı imkânı öneriyorum.', 'Mobil beyan özelliği yol haritasına alındı; pilot kullanım başladı.'],
    ['bilgi', 'Seyahat avansı talebi', 'Yaklaşan saha ziyareti için seyahat avansı talep ediyorum.', 'Avans onaylandı ve hesaba yatırıldı.'],
    ['bilgi', 'Tedarikçi ödeme durumu sorgusu', 'Tedarikçimiz ödemesinin durumunu soruyor, kontrol edilmesini rica ederim.', 'Ödeme planı kontrol edildi; ödeme gerçekleşti ve tedarikçi bilgilendirildi.'],
    ['oneri', 'Bütçe raporu şablonunun sadeleştirilmesi', 'Aylık bütçe raporunun bir yönetici özeti sayfasıyla başlamasını öneriyorum.', 'Şablona yönetici özeti eklendi; yeni format kullanıma alındı.'],
    ["bilgi", "Yurt dışı harcırah tutarları", "Yurt dışı görevde günlük harcırah tutarlarını öğrenmek istiyorum.", "Ülke bazlı güncel harcırah tablosu iletildi; avans talebi için form yönlendirildi."],
    ["oneri", "Masraf onay limitlerinin güncellenmesi", "Onay limitleri uzun süredir güncellenmedi; enflasyona göre revize edilmesini öneriyorum.", "Limitler gözden geçirildi; yönetici onay eşikleri güncellenerek yürürlüğe alındı."],
    ["bilgi", "Gider merkezi kodu sorgulama", "Faturayı doğru kodla iletebilmek için departmanımın gider merkezi kodunu öğrenmek istiyorum.", "Gider merkezi kodu bildirildi; sık kullanılan kodlar listesi de paylaşıldı."],
    ["oneri", "Tedarikçi faturalarının otomatik eşleştirilmesi", "E-arşiv faturalarının sipariş numarasıyla otomatik eşleştirilmesini öneriyorum.", "Otomatik eşleştirme kuralı devreye alındı; manuel kontrol yükü belirgin şekilde azaldı."],
    ["bilgi", "Kurumsal kredi kartı ekstre mutabakatı", "Kurumsal kartımın ekstre mutabakatını hangi tarihe kadar tamamlamam gerektiğini öğrenmek istiyorum.", "Mutabakat son tarihi her ayın 5'i olarak bildirildi; eksik fişler için hatırlatma listesi gönderildi."],
    ["oneri", "Ay sonu kapanış takviminin öne alınması", "Kapanış raporlarının ayın 10'u yerine 7'sinde tamamlanmasını öneriyorum.", "Süreç adımları sadeleştirildi; kapanış takvimi üç gün öne çekilerek uygulanmaya başlandı."],
    ["bilgi", "Damga vergisi kesintisi hakkında bilgi", "Sözleşmemde görünen damga vergisi kesintisinin nasıl hesaplandığını öğrenmek istiyorum.", "Hesaplama yöntemi ve oran bilgisi örnekle açıklandı."],
  ],
  sat: [
    ['bilgi', 'Yeni monitör talebi', 'Mevcut monitörümde renk bozulması başladı, değişim talep ediyorum.', 'Envanterden 24 inç monitör tahsis edildi ve kurulumu yapıldı.'],
    ['bilgi', 'Kırtasiye siparişi talebi', 'Ekibimiz için dosya, kalem ve defter siparişi rica ediyorum.', 'Sipariş verildi; ürünler ekibe teslim edildi.'],
    ['oneri', 'Tedarikçi değerlendirme anketi', 'Yıllık tedarikçi değerlendirmesinin anketle sistematik yapılmasını öneriyorum.', 'Anket formu tasarlandı ve yıllık değerlendirme sürecine eklendi.'],
    ['bilgi', 'Ergonomik sandalye talebi', 'Bel rahatsızlığım nedeniyle ergonomik sandalye talep ediyorum.', 'Sağlık raporu doğrultusunda ergonomik sandalye temin edildi.'],
    ['oneri', 'Toplu alım takvimi oluşturulması', 'Sık kullanılan sarf malzemeleri için çeyreklik toplu alım takvimi öneriyorum.', 'Toplu alım takvimi oluşturuldu; ilk dönem alımı tamamlandı.'],
    ["bilgi", "Sipariş durumu sorgulama", "Geçen hafta açtığım satın alma talebinin hangi aşamada olduğunu öğrenmek istiyorum.", "Talep tedarikçi onayında; tahmini teslim tarihi bildirildi ve takip numarası paylaşıldı."],
    ["oneri", "Onaylı tedarikçi listesinin yayınlanması", "Hangi tedarikçilerden alım yapılabileceğinin intranette yayınlanmasını öneriyorum.", "Onaylı tedarikçi listesi kategori bazında intranette yayınlandı ve çeyreklik güncelleme takvimine alındı."],
    ["bilgi", "Dizüstü bilgisayar yenileme döngüsü", "Bilgisayarımın kaç yılda bir yenilendiğini öğrenmek istiyorum.", "Yenileme döngüsü 4 yıl olarak uygulanmaktadır; cihazınızın yenileme tarihi bildirildi."],
    ["oneri", "Sarf malzemede otomatik stok uyarısı", "Kritik stok seviyesine düşen malzemeler için otomatik uyarı kurulmasını öneriyorum.", "Stok modülüne eşik uyarısı tanımlandı; kritik seviyede otomatik talep açılıyor."],
    ["bilgi", "Yazılım lisans yenileme tarihi", "Kullandığımız tasarım yazılımının lisansının ne zaman yenileneceğini öğrenmek istiyorum.", "Lisans bitiş tarihi ve yenileme süreci bildirildi; kesintisiz geçiş için talep önceden açıldı."],
    ["oneri", "Çevre dostu ürün tercih politikası", "Kırtasiye ve temizlik alımlarında geri dönüştürülmüş ürünlerin tercih edilmesini öneriyorum.", "Satın alma kriterlerine çevresel puan eklendi; kırtasiye alımının önemli kısmı geri dönüştürülmüş ürüne geçirildi."],
    ["bilgi", "Satın alma talep formu doldurma", "Talep formundaki teknik şartname alanını nasıl dolduracağımı öğrenmek istiyorum.", "Örnek doldurulmuş form ve alan açıklamaları gönderildi."],
  ],
  kalite: [
    ['bilgi', 'Doküman revizyon talebi', 'P-04 prosedüründeki onay akışının güncellenmesini talep ediyorum.', 'Doküman revize edildi; yeni versiyon yayınlandı.'],
    ['oneri', 'Onay adımlarının sadeleştirilmesi', 'İç denetim formlarındaki çift onay adımının tekilleştirilmesini öneriyorum.', 'Akış analizi yapıldı; tek onaylı yeni akış devreye alındı.'],
    ['bilgi', 'Denetim raporu erişim talebi', 'Son iç denetim raporuna erişim yetkisi rica ediyorum.', 'Erişim yetkisi tanımlandı ve rapor paylaşıldı.'],
    ["bilgi", "ISO belgelendirme denetim takvimi", "Bu yılki dış denetimin hangi tarihte yapılacağını öğrenmek istiyorum.", "Denetim tarihi ve kapsam bilgisi paylaşıldı; hazırlık kontrol listesi gönderildi."],
    ["oneri", "Düzeltici faaliyet takibinin dijitalleştirilmesi", "DÖF kayıtlarının Excel yerine sistem üzerinden takip edilmesini öneriyorum.", "DÖF modülü devreye alındı; termin takibi ve otomatik hatırlatma aktif edildi."],
    ["bilgi", "Prosedür güncelleme talep süreci", "Bir prosedürde değişiklik önermek istiyorum, süreç nasıl işliyor?", "Revizyon talep formu iletildi; değerlendirme ve yayın adımları açıklandı."],
    ["oneri", "Kalite göstergelerinin aylık paylaşılması", "Kalite performans göstergelerinin aylık özetle tüm departmanlara iletilmesini öneriyorum.", "Aylık kalite panosu hazırlandı; departman yöneticilerine düzenli olarak gönderiliyor."],
    ["bilgi", "Müşteri şikayeti kayıt formu", "Gelen bir müşteri şikayetini hangi form üzerinden kayıt altına alacağımı öğrenmek istiyorum.", "Şikayet kayıt formu ve sınıflandırma rehberi iletildi; kayıt sisteme işlendi."],
  ],
};

const ST_CYCLE: RecordStatus[] = [
  'COZULDU', 'COZULDU', 'YENI', 'COZULDU', 'INCELENIYOR', 'COZULDU', 'COZULDU', 'CALISILIYOR',
  'COZULDU', 'YENI', 'COZULDU', 'EK_BILGI', 'COZULDU', 'UZERIME_ALINDI', 'KAPATILDI',
  'YENI', 'COZULDU', 'CALISILIYOR', 'COZULDU', 'REDDEDILDI',
].map((s) => RecordStatus[s as keyof typeof RecordStatus]);

const PR_CYCLE: Priority[] = [
  'NORMAL', 'NORMAL', 'YUKSEK', 'NORMAL', 'KRITIK', 'NORMAL', 'YUKSEK', 'NORMAL',
].map((p) => Priority[p as keyof typeof Priority]);

async function main() {
  const seedRecords = process.env.SEED_RECORDS !== 'false';

  console.log('Departmanlar…');
  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { id: d.id },
      create: d,
      update: { name: d.name, short: d.short, order: d.order, active: true },
    });
  }

  console.log('SLA kuralları…');
  for (const s of SLA) {
    await prisma.slaRule.upsert({
      where: { priority: s.priority },
      create: s,
      update: { hours: s.hours, warnRatio: s.warnRatio },
    });
  }

  console.log('Demo kullanıcılar…');
  const userIds = new Map<string, string>();
  for (const u of USERS) {
    const email = `${slug(u.name)}@ornek.com`;
    const row = await prisma.user.upsert({
      // Entra yoksa oid yerine kararlı bir yer tutucu kullanılır; gerçek
      // girişte oid ile eşleşen ayrı kullanıcı açılır.
      where: { entraOid: `seed:${u.key}` },
      create: {
        entraOid: `seed:${u.key}`,
        email,
        name: u.name,
        role: u.role,
        departmentId: u.dept,
      },
      update: { name: u.name, role: u.role, departmentId: u.dept, active: true },
      select: { id: true },
    });
    userIds.set(u.key, row.id);
  }

  if (!seedRecords) {
    console.log('SEED_RECORDS=false — kayıt üretilmedi.');
    return;
  }

  const existing = await prisma.record.count();
  if (existing > 0) {
    console.log(`Zaten ${existing} kayıt var, örnek kayıt üretimi atlandı.`);
    return;
  }

  console.log('Örnek kayıtlar…');
  const slaHours: Record<Priority, number> = { NORMAL: 48, YUKSEK: 24, KRITIK: 8 };
  const userList = USERS.filter((u) => u.dept);
  let i = 0;
  let seq = 0;
  const year = new Date().getFullYear();

  for (const d of DEPARTMENTS) {
    const team = userList.filter((u) => u.dept === d.id);
    for (const [typeSlug, title, description, resolution] of TPL[d.id] ?? []) {
      const status = ST_CYCLE[i % ST_CYCLE.length]!;
      const priority = PR_CYCLE[i % PR_CYCLE.length]!;
      const closed = ['COZULDU', 'KAPATILDI', 'REDDEDILDI'].includes(status);
      const isNew = status === RecordStatus.YENI;

      const outsiders = userList.filter((u) => u.dept !== d.id);
      const creator = outsiders[i % outsiders.length]!;
      const assignee = isNew ? null : team[i % team.length] ?? null;

      const limitH = slaHours[priority];
      let createdAt: Date;
      let firstResponseAt: Date | null = null;
      let resolvedAt: Date | null = null;

      if (closed) {
        const c = 4 + ((i * 2.7) % 55);
        createdAt = dAgo(c);
        firstResponseAt = dAgo(c - (0.15 + (i % 6) * 0.09));
        resolvedAt = dAgo(Math.max(0.4, c - 1 - (i % 5) * 0.7));
      } else if (isNew) {
        // Yaşlar kaydın kendi SLA hedefinin oranı olarak verilir; böylece
        // panoda "akışta / daralıyor / gecikmiş" üç durum da temsil edilir.
        const band = [0.45, 0.88, 1.6, 0.72, 1.15, 0.55, 0.95][i % 7]!;
        createdAt = hAgo(Math.max(1, limitH * band));
      } else {
        const band = [0.3, 0.82, 0.55, 1.18, 0.88, 0.42, 0.95][i % 7]!;
        const h = Math.max(1.5, limitH * band);
        createdAt = hAgo(h);
        firstResponseAt = hAgo(h * 0.8);
      }

      const dept2 = i % 5 === 2 ? DEPARTMENTS.filter((x) => x.id !== d.id)[i % 5]?.id ?? null : null;
      const dept2Name = dept2 ? DEPARTMENTS.find((x) => x.id === dept2)!.name : null;
      const slaDueAt = new Date(createdAt.getTime() + limitH * HOUR);

      const events: { type: any; text: string; at: Date; byId: string | null }[] = [
        {
          type: 'CREATE',
          at: createdAt,
          byId: userIds.get(creator.key)!,
          text: `Kayıt oluşturuldu ve ${d.name} ekibine iletildi.`,
        },
      ];
      if (dept2Name) {
        events.push({
          type: 'ASSIGN', at: createdAt, byId: userIds.get(creator.key)!,
          text: `Kayıt ayrıca ${dept2Name} ekibiyle paylaşıldı.`,
        });
      }
      if (assignee) {
        events.push({
          type: 'ASSIGN', at: firstResponseAt ?? createdAt, byId: userIds.get(assignee.key)!,
          text: `Kayıt ${assignee.name} tarafından üzerine alındı.`,
        });
      }
      if (resolvedAt && status === RecordStatus.COZULDU && assignee) {
        events.push({
          type: 'COMMENT', at: resolvedAt, byId: userIds.get(assignee.key)!, text: resolution,
        });
      }

      await prisma.record.create({
        data: {
          code: `KAY-${year}-${String(++seq).padStart(4, '0')}`,
          type: typeSlug === 'oneri' ? RecordType.ONERI : RecordType.BILGI,
          title,
          description,
          priority,
          status,
          departmentId: d.id,
          department2Id: dept2,
          createdById: userIds.get(creator.key)!,
          assigneeId: assignee ? userIds.get(assignee.key)! : null,
          anonymous: i % 8 === 3,
          resolution: status === RecordStatus.COZULDU ? resolution : null,
          createdAt,
          firstResponseAt,
          resolvedAt,
          closedAt: closed ? resolvedAt : null,
          slaDueAt,
          events: { create: events },
        },
      });

      i++;
    }
  }

  await prisma.counter.upsert({
    where: { year },
    create: { year, seq },
    update: { seq },
  });

  console.log(`${seq} kayıt oluşturuldu.`);
  console.log('\nGeliştirme girişi için:');
  console.log(`  http://localhost:3000/auth/dev-login?email=${slug('Ömer Uygun')}@ornek.com`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
