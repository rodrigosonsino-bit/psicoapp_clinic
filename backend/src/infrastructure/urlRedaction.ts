// O token de agendamento público (/api/book/:token e /api/book-public/:token) é um
// segredo de portador — quem o tem pode agendar/ver a agenda do terapeuta. Ele aparece
// na própria URL, então qualquer log ou evento de erro que registre a URL crua vaza o
// token. Redige o segmento de token (mesmo se malformado) em vez de validar como UUID —
// um token malformado ainda é sensível e não deve aparecer em claro.
const BOOKING_TOKEN_PATH = /(\/api\/book(?:-public)?\/)[^/?#]+/;

export function redactBookingToken(url: string): string {
    return url.replace(BOOKING_TOKEN_PATH, '$1:token');
}
