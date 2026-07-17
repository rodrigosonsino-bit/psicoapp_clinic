import { Pool, PoolClient } from 'pg';

/**
 * Recalcula/sincroniza o registro mensal de faturamento (psychotherapy_monthly_records) de um
 * paciente a partir do estado real de agendamentos, pagamentos e cutover — chamado tanto fora
 * de transação (saveMonthlyRecord, saveAppointment) quanto dentro de uma transação já aberta
 * pelo chamador (deleteAppointment, updateAppointmentStatus, registerPayment, voidPayment),
 * por isso aceita `Pool | PoolClient` em vez de assumir um dos dois.
 *
 * Extraído de PostgresPsychotherapyRepository.syncMonthlyRecord (linha 2695 antes da extração)
 * sem alterar nenhuma linha de lógica — ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export async function syncMonthlyRecord(
    client: Pool | PoolClient,
    tenantId: string,
    patientId: string,
    month: string
): Promise<void> {
    const patientRes = await client.query(`
        SELECT name, status, payment_type, default_session_price_cents
        FROM psychotherapy_patients
        WHERE tenant_id = $1 AND id = $2
    `, [tenantId, patientId]);

    if (patientRes.rows.length === 0) return;
    const patient = patientRes.rows[0];

    // month = 'YYYY-MM'; BRT = UTC-3 (sem horário de verão desde 2019)
    const monthStart = new Date(`${month}-01T03:00:00.000Z`);
    const monthEnd   = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

    const apptsRes = await client.query(`
        SELECT
            COUNT(*) FILTER (WHERE status != 'canceled') AS active_count,
            COUNT(*) FILTER (WHERE status = 'no_show')   AS no_show_count
        FROM psychotherapy_appointments
        WHERE tenant_id = $1 AND patient_id = $2
          AND scheduled_at >= $3 AND scheduled_at < $4
    `, [tenantId, patientId, monthStart, monthEnd]);

    const activeCount = parseInt(apptsRes.rows[0].active_count, 10);
    const absences    = parseInt(apptsRes.rows[0].no_show_count, 10);

    // expected_sessions é sempre a contagem real de agendamentos do mês, pra Mensal e
    // Por Sessão igualmente — sem piso fixo (nem 4/semanal, nem 2/quinzenal). Pro Mensal,
    // o valor cobrado (expectedAmount, abaixo) já é fixo independente da contagem; o que
    // esse número decide é só a META de sessões usada pra fechar "Pago" no fluxo de
    // +/-/Dar Baixa (ver saveMonthlyRecord/MonthlyRecords.tsx) — um piso artificial aqui
    // travava o mês em "Parcial" quando o paciente realmente teve menos sessões que o
    // piso no mês (ex: terapia começando/terminando no meio do mês). Achado real: Lucas,
    // Mensal/Semanal com só 1 sessão real em junho, preso em "Parcial" mesmo pagando-a.
    const expectedSessions = activeCount;

    const sessionPrice = patient.default_session_price_cents ?? 0;
    const expectedAmount = patient.payment_type === 'monthly'
        ? sessionPrice
        : sessionPrice * Math.max(expectedSessions - absences, 0);

    // Se não há sessões esperadas nem pagas, limpar o registro e sair
    if (expectedSessions === 0) {
        // Verifica se há pagamentos vinculados antes de deletar
        const hasPaymentsRes = await client.query(`
            SELECT 1 FROM financial_payments fp
            JOIN psychotherapy_monthly_records mr ON mr.id = fp.monthly_record_id
            WHERE mr.tenant_id = $1 AND mr.patient_id = $2 AND mr.month = $3 AND fp.status = 'confirmed'
            LIMIT 1;
        `, [tenantId, patientId, month]);

        if (hasPaymentsRes.rows.length === 0) {
            await client.query(`
                DELETE FROM psychotherapy_monthly_records
                WHERE tenant_id = $1 AND patient_id = $2 AND month = $3
                  AND paid_sessions = 0;
            `, [tenantId, patientId, month]);
            return;
        }
    }

    // Upsert inicial para garantir a existência do registro com os metadados corretos
    const upsertRes = await client.query(`
        INSERT INTO psychotherapy_monthly_records (
            id, tenant_id, patient_id, month,
            patient_name_snapshot, status, payment_type,
            session_price_cents, expected_sessions, absences,
            paid_sessions, payment_status, previous_month_paid_cents,
            expected_amount_cents
        ) VALUES (
            gen_random_uuid(), $1, $2, $3,
            $4, $5, $6, $7, $8, $9,
            0, 'pending', 0, $10
        )
        ON CONFLICT (tenant_id, month, patient_id) WHERE patient_id IS NOT NULL
        DO UPDATE SET
            patient_name_snapshot = EXCLUDED.patient_name_snapshot,
            -- status/payment_type NÃO são sobrescritos aqui: são overrides explícitos por
            -- mês (dropdown "Modalidade" em Faturamento Mensal) e não devem reverter pro
            -- padrão do cadastro do paciente sempre que agendamentos mudam ou o registro é
            -- resincronizado. Achado real: alterar a modalidade de um paciente no mês não
            -- ficava salvo, pois saveMonthlyRecord chama syncMonthlyRecord logo em seguida,
            -- que reescrevia status/payment_type com o valor antigo do cadastro.
            expected_sessions     = EXCLUDED.expected_sessions,
            absences              = EXCLUDED.absences,
            expected_amount_cents = EXCLUDED.expected_amount_cents,
            updated_at = NOW()
        RETURNING id, paid_sessions, payment_status, expected_amount_cents;
    `, [
        tenantId, patientId, month,
        patient.name, patient.status, patient.payment_type,
        sessionPrice, expectedSessions, absences, expectedAmount
    ]);

    const record = upsertRes.rows[0];

    // Verificar se há cutover aprovado para o tenant e se o mês do registro é pós-cutover
    const cutoverRes = await client.query(`
        SELECT cutover_at FROM tenant_financial_cutovers
        WHERE tenant_id = $1 AND status = 'approved';
    `, [tenantId]);

    const cutoverAt = cutoverRes.rows[0]?.cutover_at;
    const isPostCutover = cutoverAt && (monthStart.getTime() >= new Date(cutoverAt).getTime());

    if (isPostCutover) {
        // Sobrescreve o status baseado nos pagamentos confirmados do ledger
        const payRes = await client.query(`
            SELECT COALESCE(SUM(amount_cents), 0) AS total_paid
            FROM financial_payments
            WHERE monthly_record_id = $1 AND status = 'confirmed';
        `, [record.id]);

        const totalPaid = parseInt(payRes.rows[0].total_paid, 10);
        let paymentStatus = 'pending';
        if (totalPaid >= expectedAmount && expectedAmount > 0) {
            paymentStatus = 'paid';
        } else if (totalPaid > 0) {
            paymentStatus = 'partial';
        }

        const paidSessions = patient.payment_type === 'per_session'
            ? (sessionPrice > 0 ? Math.floor(totalPaid / sessionPrice) : expectedSessions)
            : (totalPaid >= expectedAmount ? expectedSessions : 0);

        await client.query(`
            UPDATE psychotherapy_monthly_records
            SET paid_sessions = $1, payment_status = $2, updated_at = NOW()
            WHERE id = $3;
        `, [paidSessions, paymentStatus, record.id]);
    } else {
        // Fluxo legado (pré-cutover): paid_sessions/payment_status são editados manualmente
        // na tela de Faturamento Mensal (não vêm do ledger). Se expected_sessions/absences
        // mudou agora (ex: sessão marcada "Faltou" DEPOIS que os pagamentos já tinham sido
        // registrados), payment_status ficava travado no valor antigo, pois só era
        // recalculado no ato de pagar/gerar mês. Recalcula aqui pra refletir o novo alvo.
        const target = Math.max(expectedSessions - absences, 0);
        const paidSessions = record.paid_sessions;
        let paymentStatus: 'pending' | 'partial' | 'paid' = 'pending';
        if (paidSessions >= target) {
            paymentStatus = 'paid';
        } else if (paidSessions > 0) {
            paymentStatus = 'partial';
        }

        if (paymentStatus !== record.payment_status) {
            await client.query(`
                UPDATE psychotherapy_monthly_records
                SET payment_status = $1, updated_at = NOW()
                WHERE id = $2;
            `, [paymentStatus, record.id]);
        }
    }
}
