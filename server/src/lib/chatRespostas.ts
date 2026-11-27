import { getConfigTexto, setConfig } from './configuracoes.js'

// Respostas prontas do chat (João, 2026-11-27). Cada pessoa tem a sua lista;
// quem nunca mexeu vê as padrão abaixo. Guardado em configuracoes (sem tabela
// nova): chave chat_respostas_user_<id>, valor = JSON com a lista.

export const RESPOSTAS_PADRAO = [
  'Recebido, obrigado! 👍',
  'Vou verificar e já te retorno.',
  'Pode seguir ✅',
  'Crédito liberado ✅',
  'Crédito negado ❌ — só pagamento antecipado.',
  'Pedido liberado para faturar ✅',
  'Nota emitida ✅',
  'Separado e pronto para coleta 📦',
  'Aguardando retorno do cliente.',
  'Me passa o nº do pedido do SAP, por favor?',
]

const chave = (userId: number) => `chat_respostas_user_${userId}`

export async function lerRespostas(userId: number): Promise<string[]> {
  const bruto = await getConfigTexto(chave(userId))
  if (!bruto) return RESPOSTAS_PADRAO
  try {
    const lista = JSON.parse(bruto)
    return Array.isArray(lista) ? lista.filter((x) => typeof x === 'string') : RESPOSTAS_PADRAO
  } catch {
    return RESPOSTAS_PADRAO
  }
}

export async function salvarRespostas(userId: number, lista: string[]): Promise<string[]> {
  const limpa = [...new Set(lista.map((s) => s.trim()).filter(Boolean))].slice(0, 60)
  await setConfig(chave(userId), JSON.stringify(limpa))
  return limpa
}
