import { and, between, count, eq, gte, inArray, isNull, sum } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, registroContato, metasMensais, notifications, vendas, funilMensal } from '../db/schema.js'
import { diasUteisDecorridos, diasUteisNoMes, hojeBr, hojeBrString, mesReferenciaAtual } from './dataBr.js'
import { passouDoFimDoExpediente } from './expediente.js'

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

// Manda o resumo só depois do fim do expediente (configurável em
// Configurações → Horário de expediente) e no máximo uma vez por dia — igual
// ao padrão de "já rodou hoje?" do backup e das notificações de cliente sem
// contato. `forcar` pula os dois gates — usado pelo botão manual do admin,
// pra testar sem esperar o fim do dia. Roda uma vez por empresa (multi-empresa).
export async function executarResumoDiario(opts?: { forcar?: boolean }): Promise<{ criadas: number }> {
  const forcar = opts?.forcar ?? false
  if (!forcar && !(await passouDoFimDoExpediente())) return { criadas: 0 }

  const todasEmpresas = await db.query.empresas.findMany()
  let criadas = 0
  for (const empresa of todasEmpresas) {
    criadas += await executarResumoDiarioParaEmpresa(empresa.id, forcar)
  }
  return { criadas }
}

async function executarResumoDiarioParaEmpresa(empresaId: number, forcar: boolean): Promise<number> {
  const hoje = hojeBrString()
  const inicioHoje = `${hoje} 00:00:00`
  const fimHoje = `${hoje} 23:59:59`
  const mesAtual = mesReferenciaAtual()

  const diasUteisMes = diasUteisNoMes(mesAtual)
  const diasUteisAteHoje = diasUteisDecorridos(mesAtual)

  const vendedores = await db.query.users.findMany({
    where: and(eq(users.isActive, true), eq(users.superAdmin, false), eq(users.empresaId, empresaId)),
  })

  if (!forcar) {
    // `notifications` não tem empresaId próprio — checa "já enviado hoje" só
    // pra quem é desta empresa (senão a 1ª empresa a rodar no dia bloquearia
    // as outras).
    const idsDestaEmpresa = vendedores.map((v) => v.id)
    const jaEnviadoHoje = idsDestaEmpresa.length
      ? await db.query.notifications.findFirst({
          where: and(
            eq(notifications.type, 'resumo_diario'),
            gte(notifications.createdAt, inicioHoje),
            inArray(notifications.vendedorId, idsDestaEmpresa)
          ),
        })
      : null
    if (jaEnviadoHoje) return 0
  }

  const metas = await db.query.metasMensais.findMany({ where: eq(metasMensais.mesReferencia, mesAtual) })
  const metaPorVendedor = new Map(metas.map((m) => [m.vendedorId, m]))

  let criadas = 0
  let totalVendasHoje = 0
  let totalValorHoje = 0
  let totalLigacoesHoje = 0
  let vendedoresNoRitmo = 0

  for (const v of vendedores) {
    const [{ vendasHoje, valorHoje }] = await db
      .select({ vendasHoje: count(), valorHoje: sum(vendas.valorFechado).mapWith(Number) })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(eq(funilMensal.vendedorId, v.id), between(vendas.dataFechamento, inicioHoje, fimHoje), isNull(vendas.deletedAt)))

    const [{ ligacoesHoje }] = await db
      .select({ ligacoesHoje: count() })
      .from(registroContato)
      .where(
        and(
          eq(registroContato.vendedorId, v.id),
          eq(registroContato.tipo, 'ligacao'),
          between(registroContato.dataHora, inicioHoje, fimHoje),
          isNull(registroContato.deletedAt)
        )
      )

    const [{ valorFechadoMes }] = await db
      .select({ valorFechadoMes: sum(vendas.valorFechado).mapWith(Number) })
      .from(vendas)
      .innerJoin(funilMensal, eq(funilMensal.id, vendas.funilMensalId))
      .where(and(eq(funilMensal.vendedorId, v.id), eq(vendas.mesReferencia, mesAtual), isNull(vendas.deletedAt)))

    const meta = metaPorVendedor.get(v.id)
    const metaFaturamentoDia = meta?.metaFaturamento ? meta.metaFaturamento / diasUteisMes : null
    const metaAcumuladaAteHoje = metaFaturamentoDia ? metaFaturamentoDia * diasUteisAteHoje : null
    const noRitmo = metaAcumuladaAteHoje ? (valorFechadoMes ?? 0) >= metaAcumuladaAteHoje : false

    totalVendasHoje += vendasHoje
    totalValorHoje += valorHoje ?? 0
    totalLigacoesHoje += ligacoesHoje
    if (noRitmo) vendedoresNoRitmo++

    await db.insert(notifications).values({
      vendedorId: v.id,
      type: 'resumo_diario',
      title: 'Resumo do dia',
      message: `Hoje: ${vendasHoje} venda(s) (${formatarMoeda(valorHoje ?? 0)}), ${ligacoesHoje} ligação(ões). ${
        noRitmo ? 'Você está no ritmo da meta do mês! 🎯' : 'Ainda dá tempo de alcançar o ritmo da meta do mês.'
      }`,
    })
    criadas++
  }

  // Admins desta empresa + todo superAdmin (independente da empresa dele) —
  // senão o dono/gestor geral nunca recebe o resumo de uma empresa que não é
  // a "casa" da própria conta.
  const todosAdmins = await db.query.users.findMany({ where: and(eq(users.role, 'admin'), eq(users.isActive, true)) })
  const admins = todosAdmins.filter((a) => a.empresaId === empresaId || a.superAdmin)
  for (const admin of admins) {
    await db.insert(notifications).values({
      vendedorId: admin.id,
      type: 'resumo_diario',
      title: 'Resumo do dia — equipe',
      message: `Hoje: ${totalVendasHoje} venda(s) (${formatarMoeda(totalValorHoje)}), ${totalLigacoesHoje} ligação(ões). ${vendedoresNoRitmo} de ${vendedores.length} vendedor(es) no ritmo da meta do mês.`,
    })
    criadas++
  }

  return criadas
}
