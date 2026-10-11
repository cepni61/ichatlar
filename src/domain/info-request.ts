import { RecordStatus, RecordType } from './enums.js';
import { isOpen } from './constants.js';
import { canTransition } from './permissions.js';

/**
 * Ek bilgi yanıtlanınca kayıt istekten önceki durumuna döner. O durum Ek
 * Bilgi'nin kendisiyse, kapalıysa ya da oraya geçilemiyorsa (ör.
 * Sahiplenildi) iş sürüyor demektir: bilgide Çalışılıyor, öneride
 * Değerlendiriliyor.
 */
export function statusAfterInfo(type: string, before: string): RecordStatus {
  if (before !== RecordStatus.EK_BILGI && isOpen(before) && canTransition(RecordStatus.EK_BILGI, before)) {
    return before as RecordStatus;
  }
  return type === RecordType.ONERI ? RecordStatus.DEGERLENDIRILIYOR : RecordStatus.CALISILIYOR;
}
