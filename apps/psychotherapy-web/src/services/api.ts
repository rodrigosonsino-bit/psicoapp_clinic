import { tokenStorage } from './auth';


const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Refresh em fila única (single-flight).
 *
 * O backend ROTACIONA o refresh token a cada uso (revoga o anterior). Se várias
 * requisições recebem 401 ao mesmo tempo (ex.: o access token de 15 min expirou
 * e a tela disparou vários fetches juntos), cada uma tentaria renovar com o mesmo
 * refresh token — a primeira revoga o token e as demais falham com "inválido",
 * matando a sessão inteira. Aqui garantimos que só UMA renovação aconteça por vez;
 * as demais aguardam a mesma promise e reaproveitam o novo access token.
 */
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = tokenStorage.getRefreshToken();
      if (!refreshToken) {
        throw new Error('Sem refresh token');
      }

      const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!refreshResponse.ok) {
        throw new Error('Refresh failed');
      }

      const refreshData = await refreshResponse.json();
      if (!refreshData.accessToken || !refreshData.refreshToken) {
        throw new Error('Invalid tokens received');
      }

      tokenStorage.setTokens(refreshData.accessToken, refreshData.refreshToken);
      return refreshData.accessToken as string;
    })().finally(() => {
      // Libera a fila assim que termina (sucesso ou falha).
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function fetchApi<T = unknown>(
  endpoint: string,
  options: RequestInit & { responseType?: 'json' | 'blob' | 'text' } = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const accessToken = tokenStorage.getAccessToken();
  if (accessToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Se receber 401 e não for uma rota de auth direta, tentar o auto-refresh do token
  if (
    response.status === 401 &&
    endpoint !== '/auth/refresh' &&
    endpoint !== '/auth/login' &&
    endpoint !== '/auth/2fa/login' &&
    endpoint !== '/auth/register'
  ) {
    try {
      // Refresh compartilhado: requisições concorrentes aguardam a mesma renovação.
      const newAccessToken = await refreshAccessToken();

      // Repetir a requisição original uma vez com o novo token.
      const retryHeaders: HeadersInit = {
        ...headers,
        'Authorization': `Bearer ${newAccessToken}`,
      };

      const retryResponse = await fetch(url, {
        ...options,
        headers: retryHeaders,
      });

      if (!retryResponse.ok) {
        let errorMsg = `Erro ${retryResponse.status}`;
        try {
          const errData = await retryResponse.json();
          errorMsg = errData.error || errData.message || errorMsg;
        } catch { /* ignore non-JSON error response body */ }
        throw new Error(errorMsg);
      }

      if (retryResponse.status === 204) {
        return null as unknown as T;
      }

      if (options.responseType === 'blob') return retryResponse.blob() as unknown as T;
      if (options.responseType === 'text') return retryResponse.text() as unknown as T;
      return retryResponse.json();
    } catch (refreshError) {
      // Se o refresh falhar de fato, limpar os tokens e redirecionar para login.
      tokenStorage.clearTokens();
      window.location.href = '/auth';
      throw new Error('Sessão expirada. Por favor, faça login novamente.', { cause: refreshError });
    }
  }

  if (!response.ok) {
    let errorMsg = `Erro ${response.status}`;
    try {
      const data = await response.json();
      errorMsg = data.error || data.message || errorMsg;
    } catch { /* ignore JSON parse error for non-JSON responses */ }
    throw new Error(errorMsg);
  }

  // Se a resposta for 204 No Content, não tentamos fazer o parse do JSON
  if (response.status === 204) {
    return null as unknown as T;
  }

  if (options.responseType === 'blob') return response.blob() as unknown as T;
  if (options.responseType === 'text') return response.text() as unknown as T;
  return response.json();
}
