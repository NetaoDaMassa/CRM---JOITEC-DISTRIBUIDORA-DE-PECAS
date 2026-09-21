// Busca o cadastro completo de um contato no Brevo pelo e-mail — usado só
// pra enriquecer um Lead recém-criado a partir de clique/resposta (que só
// vem com e-mail no webhook), com o que a pessoa preencheu no formulário de
// assinatura: nome, telefone, empresa, cidade. Opcional (empresa sem chave
// de API configurada simplesmente não enriquece nada, sem erro).
//
// Nomes de atributo variam por conta Brevo (cada empresa configura os
// próprios campos no formulário) — testado contra a conta real da Joitec
// (atributos NOME/SOBRENOME/WHATSAPP/CITY/COMPANY_NAME em 2026-09-21) com
// alguns sinônimos comuns como fallback pra quando as outras empresas
// ligarem a integração delas.
export type BrevoContatoEnriquecido = {
  nome: string | null
  telefone: string | null // só dígitos, com DDI se veio assim (ex: 5547999998888)
  empresa: string | null
  cidade: string | null
}

function primeiroValor(attrs: Record<string, unknown>, chaves: string[]): string | null {
  for (const chave of chaves) {
    const valor = attrs[chave]
    if (typeof valor === 'string' && valor.trim()) return valor.trim()
  }
  return null
}

export async function buscarContatoBrevo(apiKey: string, email: string): Promise<BrevoContatoEnriquecido | null> {
  try {
    const resposta = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
      headers: { 'api-key': apiKey, accept: 'application/json' },
    })
    // 404 = e-mail não tem cadastro de contato no Brevo (comum — nem todo
    // clique vem de alguém na lista) — não é erro, só segue sem enriquecer.
    if (!resposta.ok) return null

    const dados = (await resposta.json()) as { attributes?: Record<string, unknown> }
    const attrs = dados.attributes ?? {}

    const primeiroNome = primeiroValor(attrs, ['NOME', 'PRENOM', 'FIRSTNAME', 'NAME'])
    const sobrenome = primeiroValor(attrs, ['SOBRENOME', 'NOM', 'LASTNAME'])
    const nome = [primeiroNome, sobrenome].filter(Boolean).join(' ').trim() || null

    const telefoneRaw = primeiroValor(attrs, ['WHATSAPP', 'SMS', 'PHONE', 'TELEFONE', 'TELEFONO'])
    const telefone = telefoneRaw ? telefoneRaw.replace(/\D/g, '') || null : null

    const empresa = primeiroValor(attrs, ['COMPANY_NAME', 'SOCIETE', 'COMPANY', 'EMPRESA'])
    const cidade = primeiroValor(attrs, ['CITY', 'VILLE', 'CIDADE'])

    return { nome, telefone, empresa, cidade }
  } catch (err) {
    console.error('[brevo api] falha ao buscar contato:', err)
    return null
  }
}
