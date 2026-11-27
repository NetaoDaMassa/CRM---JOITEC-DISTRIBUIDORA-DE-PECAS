import { comSessaoSap, sapConfigurado } from './sapServiceLayer.js'
import { hojeBrString } from './dataBr.js'

// "Última Cosulta Serasa" do cadastro do cliente no SAP (U_TS_UltConsSerasa,
// aba Condições de pagamento). João, 2026-11-27: a busca "Antes de pedir:
// esse cliente já foi consultado?" usa isso pros clientes que nunca foram
// consultados pelo CRM. O SAP só guarda a DATA — não diz se está limpo.
// Foto em memória refeita de 30 em 30 min (scheduler), igual o limite.
export interface SerasaSap {
  cardCode: string
  nome: string
  doc: string // só números
  data: string // YYYY-MM-DD
}

type Bp = { CardCode: string; CardName: string | null; FederalTaxID: string | null; U_TS_UltConsSerasa: string | null }
const CAMPOS = 'CardCode,CardName,FederalTaxID,U_TS_UltConsSerasa'

let porCodigo = new Map<string, SerasaSap>()
let porDoc = new Map<string, SerasaSap>()
let fotoEm = 0
let carregando: Promise<number> | null = null

export async function atualizarFotoSerasa(): Promise<number> {
  if (!sapConfigurado()) return 0
  const lista = await comSessaoSap(async (sap) => {
    try {
      return await sap.getTodos<Bp>(`/BusinessPartners?$filter=CardType eq 'cCustomer' and U_TS_UltConsSerasa ne null&$select=${CAMPOS}`)
    } catch {
      // Se o SAP não aceitar filtrar o campo do usuário, traz todos e filtra aqui.
      return (await sap.getTodos<Bp>(`/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=${CAMPOS}`)).filter((b) => b.U_TS_UltConsSerasa)
    }
  })
  const hoje = hojeBrString()
  const novoCodigo = new Map<string, SerasaSap>()
  const novoDoc = new Map<string, SerasaSap>()
  for (const b of lista) {
    const data = (b.U_TS_UltConsSerasa ?? '').slice(0, 10)
    // Ignora data vazia e data no futuro (erro de digitação: 2029, 2030).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > hoje) continue
    const s: SerasaSap = { cardCode: b.CardCode.toUpperCase(), nome: b.CardName ?? b.CardCode, doc: (b.FederalTaxID ?? '').replace(/\D/g, ''), data }
    novoCodigo.set(s.cardCode, s)
    if (s.doc.length >= 11) {
      const atual = novoDoc.get(s.doc)
      if (!atual || atual.data < s.data) novoDoc.set(s.doc, s)
    }
  }
  porCodigo = novoCodigo
  porDoc = novoDoc
  fotoEm = Date.now()
  return novoCodigo.size
}

// Sem foto ainda: dispara a carga e espera no máximo `esperaMs` (a busca
// não fica travada esperando o SAP; na próxima já vem).
async function garantirFoto(esperaMs = 4000) {
  if (fotoEm || !sapConfigurado()) return
  if (!carregando) {
    carregando = atualizarFotoSerasa()
      .catch((e) => {
        console.error('[sap-serasa] foto:', e instanceof Error ? e.message : e)
        return 0
      })
      .finally(() => {
        carregando = null
      })
  }
  await Promise.race([carregando, new Promise((r) => setTimeout(r, esperaMs))])
}

// Data mais recente entre os códigos do SAP e o CNPJ/CPF do cliente.
export async function serasaSapDoCliente(codigos: string[], doc: string | null | undefined): Promise<SerasaSap | null> {
  await garantirFoto()
  const achados = [...codigos.map((c) => porCodigo.get(c.trim().toUpperCase())), doc ? porDoc.get(doc.replace(/\D/g, '')) : undefined].filter((s): s is SerasaSap => !!s)
  return achados.sort((a, b) => b.data.localeCompare(a.data))[0] ?? null
}

// Clientes do SAP que batem com a busca (código exato, CNPJ/CPF ou nome) —
// pra quem não tem cadastro no CRM.
export async function buscarSerasaSap(q: string, limite = 10): Promise<SerasaSap[]> {
  await garantirFoto()
  const termo = q.trim().toUpperCase()
  const digitos = q.replace(/\D/g, '')
  const soNumero = digitos.length >= 5 && /^[\d.\/\-\s]+$/.test(q)
  const exato = porCodigo.get(termo)
  if (exato) return [exato]
  const r: SerasaSap[] = []
  for (const s of porCodigo.values()) {
    if (soNumero ? s.doc.includes(digitos) : termo.length >= 3 && s.nome.toUpperCase().includes(termo)) r.push(s)
    if (r.length >= limite) break
  }
  return r
}
