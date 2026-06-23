-- Personalização da página pública de agendamento, por tenant (profissional).
-- Aditivo e 100% retrocompatível: coluna JSONB nullable; código antigo a ignora,
-- e a página pública cai no comportamento padrão quando o valor é NULL.
--
-- Formato esperado (todos os campos opcionais):
--   {
--     "professionLabel": "Psicoterapeuta",
--     "displayName":     "Espaço Clarear",
--     "accentColor":     "#6d5dfc",
--     "welcomeMessage":  "Atendo ansiedade e luto..."
--   }
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS booking_page JSONB;
