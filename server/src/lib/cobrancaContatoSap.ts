// Contato do cliente no SAP pra Cobrança (João, 2026-11-18: "pegar número do
// SAP + número do cadastro que o vendedor coloca no CRM pra facilitar a hora
// da cobrança"). Só leitura (GET /BusinessPartners). No SAP o DDD vem em
// Phone2 e o número em Phone1; Cellular às vezes já vem com DDD.
import { comSessaoSap } from './sapServiceLayer.js'

export type ContatoSap = { telefones: string[]; emails: string[]; contato: string | null }

type Bp = { CardCode: string; Phone1: string | null; Phone2: string | null; Cellular: string | null; EmailAddress: string | null; ContactPerson: string | null }

const TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map<string, { em: number; dados: ContatoSap | null }>()
let buscando: Promise<void> | null = null
const pendentes = new Set<string>()

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

function paraContato(b: Bp): ContatoSap {
  const ddd = digitos(b.Phone2)
  const comDdd = (n: string) => (n && ddd.length === 2 && n.length <= 9 ? ddd + n : n)
  const telefones = [...new Set([digitos(b.Cellular), digitos(b.Phone1)].map(comDdd).filter((n) => n.length >= 8))]
  const emails = [...new Set((b.EmailAddress ?? '').split(/[;,\s]+/).map((e) => e.trim()).filter((e) => e.includes('@')))]
  return { telefones, emails, contato: b.ContactPerson?.trim() || null }
}

async function buscarLotes(codigos: string[]) {
  await comSessaoSap(async (sap) => {
    for (let i = 0; i < codigos.length; i += 20) {
      const lote = codigos.slice(i, i + 20)
      const filtro = lote.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(' or ')
      const achados = await sap.getTodos<Bp>(`/BusinessPartners?$filter=${filtro}&$select=CardCode,Phone1,Phone2,Cellular,EmailAddress,ContactPerson`, 20)
      const agora = Date.now()
      const porCodigo = new Map(achados.map((b) => [b.CardCode.trim().toUpperCase(), b]))
      for (const c of lote) {
        const b = porCodigo.get(c.trim().toUpperCase())
        cache.set(c, { em: agora, dados: b ? paraContato(b) : null })
      }
    }
  })
}

// Devolve o que já tem em cache e manda buscar o que falta (espera no máximo
// `esperarMs` — a tela não pode travar se o SAP estiver lento; o resto
// aparece na próxima vez que abrir/atualizar).
export async function contatosSap(codigos: string[], esperarMs = 6000): Promise<Map<string, ContatoSap | null>> {
  const agora = Date.now()
  const faltam = codigos.filter((c) => {
    const e = cache.get(c)
    return !e || agora - e.em > TTL_MS
  })
  if (faltam.length) {
    for (const c of faltam) pendentes.add(c)
    if (!buscando) {
      const lote = [...pendentes]
      pendentes.clear()
      buscando = buscarLotes(lote)
        .catch((e) => console.error('[cobranca] contato SAP:', e instanceof Error ? e.message : e))
        .finally(() => (buscando = null))
    }
    await Promise.race([buscando, new Promise((r) => setTimeout(r, esperarMs))])
  }
  return new Map(codigos.map((c) => [c, cache.get(c)?.dados ?? null]))
}
