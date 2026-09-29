/**
 * Alan hataları. Rota katmanı bunları yakalayıp HTTP durumuna çevirir;
 * iş kuralları HTTP'den habersiz kalır.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Kayıt') => new AppError(404, 'NOT_FOUND', `${what} bulunamadı.`);

export const forbidden = (message = 'Bu işlem için yetkiniz yok.') =>
  new AppError(403, 'FORBIDDEN', message);

export const unauthorized = () =>
  new AppError(401, 'UNAUTHORIZED', 'Oturum bulunamadı, giriş yapmanız gerekiyor.');

export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);
