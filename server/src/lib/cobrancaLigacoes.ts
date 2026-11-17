import { and, eq, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clienteTelefones, clientes, cobrancaContatos, cobrancaTitulos, pabxLigacoesProcessadas, permissoesAdmin } from '../db/schema.js'
import { diasUteisAposVencimento } from './cobrancaSap.js'

// Ligação da Cobrança registrada sozinha (João, 2026-11-17: "quando for
// ligar, quero disponibilizar o áudio da ligação e o registro automático").
// Toda ligação do PABX (Odin, PABXONE360) e da GoTo (Joitec) já fica em
// pabx_ligacoes_processadas com quem ligou (ramal → usuário), o número, se
// foi atendida e a gravação. Aqui: ligação de quem tem a tela Cobrança pra
// um telefone de cliente com título A COBRAR vira contato de cobrança (com a
// gravação ligada), sem ninguém precisar clicar em nada.

const JANELA_HORAS = 48
// Clique manual em "Ligar" (sem PABX: abre o discador e registra na hora)
// e a ligação de verdade que chega depois são a mesma — junta as duas.
const JUNTAR_ANTES_MIN = 20
const JUNTAR_DEPOIS_MIN = 5

// Número só com dígitos, sem 55 e sem o 0 da operadora/DDD.
export function telefoneNacional(t: string | null | undefined): string {
  // Ex.: "0556599887766" (prefixo do PABX + 55) → "65999887766".
  let d = (t ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  return d.replace(/^0+/, '')
}

// Mesmo telefone? Compara os 8 últimos dígitos e, quando os dois têm DDD,
// o DDD também (celular com ou sem o 9 na frente bate igual).
export function mesmoTelefone(a: string, b: string): boolean {
  if (a.length < 8 || b.length < 8) return false
  if (a.slice(-8) !== b.slice(-8)) return false
  const ddd = (x: string) => (x.length >= 10 ? x.slice(0, 2) : null)
  const da = ddd(a)
  const dbb = ddd(b)
  return !da || !dbb || da === dbb
}

function duracaoTexto(seg: number | null): string {
  if (!seg) return '0s'
  const m = Math.floor(seg / 60)
  return m ? `${m}min ${seg % 60}s` : `${seg}s`
}

const diaBr = (utc: string) => new Date(new Date(`${utc.replace(' ', 'T')}Z`).getTime() - 3 * 3600_000).toISOString().slice(0, 10)
const somarMin = (utc: string, min: number) => new Date(new Date(`${utc.replace(' ', 'T')}Z`).getTime() + min * 60_000).toISOString().replace('T', ' ').slice(0, 19)

export async function registrarLigacoesCobranca(): Promise<number> {
  const quem = [...new Set((await db.select({ id: permissoesAdmin.userId }).from(permissoesAdmin).where(eq(permissoesAdmin.feature, 'cobranca_sap'))).map((p) => p.id))]
  if (!quem.length) return 0
  const desde = new Date(Date.now() - JANELA_HORAS * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
  const ligacoes = await db
    .select()
    .from(pabxLigacoesProcessadas)
    .where(and(inArray(pabxLigacoesProcessadas.userId, quem), gte(pabxLigacoesProcessadas.dataHora, desde), isNotNull(pabxLigacoesProcessadas.numeroExterno)))
  if (!ligacoes.length) return 0
  const jaLigadas = new Set(
    (
      await db
        .select({ id: cobrancaContatos.pabxLigacaoId })
        .from(cobrancaContatos)
        .where(inArray(cobrancaContatos.pabxLigacaoId, ligacoes.map((l) => l.id)))
    ).map((c) => c.id)
  )
  const novas = ligacoes.filter((l) => !jaLigadas.has(l.id) && telefoneNacional(l.numeroExterno).length >= 8)
  if (!novas.length) return 0

  // Telefones dos clientes com título a cobrar (cadastro principal + extras).
  const titulos = await db.select().from(cobrancaTitulos).where(eq(cobrancaTitulos.status, 'cobrar'))
  if (!titulos.length) return 0
  const codigos = [...new Set(titulos.map((t) => t.codigoCliente))]
  const cads = await db
    .select({ id: clientes.id, codigo: clientes.codigo, codigoAntigo: clientes.codigoAntigo, telefone: clientes.telefoneWhatsapp })
    .from(clientes)
    .where(and(isNull(clientes.deletedAt), or(inArray(clientes.codigo, codigos), inArray(clientes.codigoAntigo, codigos))))
  const extras = cads.length ? await db.select().from(clienteTelefones).where(inArray(clienteTelefones.clienteId, cads.map((c) => c.id))) : []
  const telefonesDoCodigo = new Map<string, string[]>()
  const anotar = (codigo: string | null, tel: string | null) => {
    const n = telefoneNacional(tel)
    if (!codigo || n.length < 8) return
    telefonesDoCodigo.set(codigo, [...(telefonesDoCodigo.get(codigo) ?? []), n])
  }
  for (const c of cads) {
    const tels = [c.telefone, ...extras.filter((e) => e.clienteId === c.id).map((e) => e.numero)]
    for (const t of tels) {
      anotar(c.codigo, t)
      anotar(c.codigoAntigo, t)
    }
  }

  let registradas = 0
  for (const l of novas) {
    const num = telefoneNacional(l.numeroExterno)
    const codigosDaLigacao = codigos.filter((cod) => (telefonesDoCodigo.get(cod) ?? []).some((t) => mesmoTelefone(t, num)))
    const doCliente = titulos.filter((t) => codigosDaLigacao.includes(t.codigoCliente))
    if (!doCliente.length) continue
    const quando = l.dataHora ?? l.criadoEm
    const dia = diaBr(quando)
    const situacao = `${l.direcao === 'INBOUND' ? 'Ligação recebida' : 'Ligação'} (registro automático): ${l.efetiva ? `atendida, ${duracaoTexto(l.duracaoSegundos)}` : 'não atendida'}`
    for (const t of doCliente) {
      // Clique manual em "Ligar" dessa pessoa pouco antes: é a mesma ligação.
      const manual = await db.query.cobrancaContatos.findFirst({
        where: and(
          eq(cobrancaContatos.tituloId, t.id),
          eq(cobrancaContatos.canal, 'ligacao'),
          isNull(cobrancaContatos.pabxLigacaoId),
          l.userId ? eq(cobrancaContatos.userId, l.userId) : undefined,
          gte(cobrancaContatos.createdAt, somarMin(quando, -JUNTAR_ANTES_MIN))
        ),
      })
      if (manual && manual.createdAt <= somarMin(quando, JUNTAR_DEPOIS_MIN)) {
        await db
          .update(cobrancaContatos)
          .set({ pabxLigacaoId: l.id, observacao: manual.observacao ? `${manual.observacao} · ${situacao}` : situacao })
          .where(eq(cobrancaContatos.id, manual.id))
        continue
      }
      const d = diasUteisAposVencimento(t.vencimento, dia)
      await db.insert(cobrancaContatos).values({
        tituloId: t.id,
        canal: 'ligacao',
        tipo: 'cobranca',
        diaRegua: d >= 1 && d <= 5 ? d : null,
        observacao: situacao,
        userId: l.userId,
        pabxLigacaoId: l.id,
        createdAt: quando,
      })
    }
    registradas++
  }
  return registradas
}
