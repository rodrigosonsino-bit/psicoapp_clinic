// Fallback deliberadamente genérico — nunca renderiza error.message, stack ou
// componentStack ao usuário: podem carregar prontuário/nota clínica do paciente
// que estava em tela no momento do erro (LGPD art. 11, dado de saúde).
export function ErrorFallback() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Algo deu errado</h1>
      <p>Recarregue a página. Se o problema persistir, contate o suporte.</p>
    </div>
  );
}
