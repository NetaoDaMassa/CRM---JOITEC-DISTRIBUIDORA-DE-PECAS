// Conversions API do Meta Ads — manda de volta pro Meta o sinal de "esse
// lead virou cliente qualificado/venda de verdade", pra ele aprender a
// trazer mais gente parecida com quem realmente compra (em vez de só
// otimizar pra "preencheu o formulário"). Só dispara pra leads que vieram do
// próprio Meta Ads (ver `meta_ads_lead` em tracking.ts) — não faz sentido
// mandar de volta um sinal sobre alguém que o Meta nem trouxe. Pedido do
// João, 2026-10-16.
import crypto from 'node:crypto'
import { getConfigTexto, setConfig } from './configuracoes.js'

function sha256(valor: string): string {
  return crypto.createHash('sha256').update(valor.trim().toLowerCase()).digest('hex')
}

function chavePixelId(empresaId: number): string {
  return `meta_capi_pixel_id_${empresaId}`
}
function chaveAccessToken(empresaId: number): string {
  return `meta_capi_access_token_${empresaId}`
}

export async function metaCapiConfigurado(empresaId: number): Promise<boolean> {
  return !!(await getConfigTexto(chavePixelId(empresaId)))
}

export async function salvarCredenciaisMetaCapi(empresaId: number, pixelId: string, accessToken: string): Promise<void> {
  await setConfig(chavePixelId(empresaId), pixelId.trim())
  await setConfig(chaveAccessToken(empresaId), accessToken.trim())
}

interface EnviarEventoMetaInput {
  empresaId: number
  // 'Lead' = virou cliente qualificado (etapa Negociação/Ganho); 'Purchase'
  // = venda fechada (etapa Ganho, com o valor final do pedido).
  eventName: 'Lead' | 'Purchase'
  phone?: string | null
  ddd?: number | null
  email?: string | null
  value?: number | null
  // Estável por lead+evento (ex: "lead-123-ganho") — evita duplicar a
  // contagem no Meta se a mesma etapa for salva de novo por engano.
  eventId: string
}

// Nunca lança erro — falha de rede/token errado não pode derrubar a troca de
// etapa do lead no CRM, que é o que importa de verdade pro vendedor.
export async function enviarEventoMeta(input: EnviarEventoMetaInput): Promise<void> {
  try {
    const pixelId = await getConfigTexto(chavePixelId(input.empresaId))
    const accessToken = await getConfigTexto(chaveAccessToken(input.empresaId))
    if (!pixelId || !accessToken) return // integração não configurada pra essa empresa ainda

    const userData: Record<string, string[]> = {}
    if (input.phone) {
      const digitos = input.phone.replace(/\D/g, '')
      const completo = input.ddd ? `55${input.ddd}${digitos}` : digitos
      if (completo) userData.ph = [sha256(completo)]
    }
    if (input.email?.trim()) userData.em = [sha256(input.email)]
    if (Object.keys(userData).length === 0) return // sem telefone/e-mail não dá pra casar com nada no Meta

    const evento: Record<string, unknown> = {
      event_name: input.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: 'system_generated',
      user_data: userData,
    }
    if (input.eventName === 'Purchase' && input.value) {
      evento.custom_data = { value: input.value, currency: 'BRL' }
    }

    const resp = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evento], access_token: accessToken }),
    })
    if (!resp.ok) {
      console.error(`[meta-capi] falha ao enviar "${input.eventName}" (empresa ${input.empresaId}):`, await resp.text())
    }
  } catch (err) {
    console.error(`[meta-capi] erro ao enviar "${input.eventName}" (empresa ${input.empresaId}):`, err)
  }
}
