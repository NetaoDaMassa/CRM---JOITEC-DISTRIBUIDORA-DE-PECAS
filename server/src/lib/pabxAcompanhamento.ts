// Acompanhamento rápido do botão "Ligar" (Click2Call PABXONE360) —
// 2026-11-04, João: vendedores reclamavam que a ligação levava "alguns
// minutos" pra aparecer no CRM. A sincronização geral (scheduler.ts) roda a
// cada 1 minuto; aqui, quando alguém liga PELO BOTÃO, o CRM passa a
// perguntar à PABXONE360 a cada ~10s (janela curta, só desde o clique) até
// a ligação aparecer — ela só aparece na API DEPOIS de terminar. Para por
// ramal quando a ligação com número externo daquele ramal é gravada (por
// esta passada ou pela do minuto — o claim em pabx_ligacoes_processadas
// impede duplicar), ou depois de 40 min.
//
// Também mede quanto a PABXONE360 demora pra liberar a ligação depois que
// ela termina (config `pabxone360_atraso_api`, aparece na tela de
// Configuração) — é o mínimo possível de atraso, que não depende da gente.
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { pabxLigacoesProcessadas } from '../db/schema.js'
import { setConfig } from './configuracoes.js'
import { agoraSqlite } from './dataBr.js'
import { duracaoMinimaPabx, lerCredenciaisPabx, pabxLigada, registrarLigacoesAutomaticasPabxone360 } from './pabxone360.js'

const INTERVALO_MS = 10_000
const DURACAO_MAX_MS = 40 * 60_000
// Folga pra trás: relógio do PABX x servidor podem diferir um pouco.
const FOLGA_MS = 2 * 60_000

interface Acompanhamento {
  ramal: string
  desde: Date
  ate: number
}

const acompanhando = new Map<string, Acompanhamento>()
let timer: ReturnType<typeof setInterval> | null = null
let rodando = false

const paraSqlite = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19)

export function acompanharLigacao(ramal: string) {
  const agora = new Date()
  const atual = acompanhando.get(ramal)
  acompanhando.set(ramal, { ramal, desde: atual && atual.ate > agora.getTime() ? atual.desde : agora, ate: agora.getTime() + DURACAO_MAX_MS })
  if (!timer) timer = setInterval(() => void rodada(), INTERVALO_MS)
}

async function rodada() {
  if (rodando) return
  rodando = true
  try {
    const agora = Date.now()
    for (const [ramal, a] of acompanhando) if (a.ate < agora) acompanhando.delete(ramal)
    if (!acompanhando.size) {
      if (timer) clearInterval(timer)
      timer = null
      return
    }
    if (!(await pabxLigada())) return
    const cred = await lerCredenciaisPabx()
    if (!cred) return

    const desdeMin = new Date(Math.min(...[...acompanhando.values()].map((a) => a.desde.getTime())) - FOLGA_MS)
    const resultados = await registrarLigacoesAutomaticasPabxone360(cred, desdeMin, new Date(), await duracaoMinimaPabx())

    // Mede o atraso da API nas ligações que ESTA passada pegou primeiro.
    if (resultados.length) {
      const linhas = await db
        .select({ dataHora: pabxLigacoesProcessadas.dataHora, duracao: pabxLigacoesProcessadas.duracaoSegundos, ramal: pabxLigacoesProcessadas.ramal })
        .from(pabxLigacoesProcessadas)
        .where(inArray(pabxLigacoesProcessadas.chamadaId, resultados.map((r) => r.chamadaId)))
      for (const l of linhas) {
        if (!l.dataHora || !l.ramal || !acompanhando.has(l.ramal)) continue
        const fim = new Date(`${l.dataHora.replace(' ', 'T')}Z`).getTime() + (l.duracao ?? 0) * 1000
        const atrasoS = Math.round((Date.now() - fim) / 1000)
        if (atrasoS >= 0 && atrasoS < 3600) {
          console.log(`[pabxone360] ligação do ramal ${l.ramal} apareceu ${atrasoS}s depois de terminar`)
          await setConfig('pabxone360_atraso_api', `${agoraSqlite()} — ${atrasoS}s (ramal ${l.ramal})`).catch(() => {})
        }
      }
    }

    // Para de acompanhar o ramal cuja ligação (com número externo) já foi
    // gravada desde o clique — por esta passada ou pela do minuto.
    for (const [ramal, a] of acompanhando) {
      const achou = await db.query.pabxLigacoesProcessadas.findFirst({
        where: and(
          eq(pabxLigacoesProcessadas.ramal, ramal),
          gte(pabxLigacoesProcessadas.criadoEm, paraSqlite(a.desde)),
          isNotNull(pabxLigacoesProcessadas.numeroExterno)
        ),
        columns: { id: true },
      })
      if (achou) acompanhando.delete(ramal)
    }
  } catch (err) {
    console.error('[pabxone360] erro no acompanhamento rápido:', (err as Error)?.message ?? err)
  } finally {
    rodando = false
  }
}
