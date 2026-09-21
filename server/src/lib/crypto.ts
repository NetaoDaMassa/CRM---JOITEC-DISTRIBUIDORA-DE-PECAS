// Criptografia simétrica de campo (AES-256-GCM) — pedido explícito do João,
// 2026-09-21, pro token de página do Instagram (page_access_token) nunca
// ficar em texto puro no banco. Primeira vez que este CRM faz isso: GoTo
// Connect e Brevo guardam token/API key em texto puro hoje (ver goto.ts/
// configuracoes.ts, empresas.brevoApiKey) — não mexemos neles, só o novo
// dado (Instagram) nasce já criptografado.
//
// Chave em INSTAGRAM_TOKEN_ENCRYPTION_KEY (.env), 32 bytes em base64 — gerar
// com `openssl rand -base64 32`. GCM guarda o IV (12 bytes) e a auth tag (16
// bytes) junto do texto cifrado, tudo em base64 numa string só
// ("iv.tag.cifrado"), pra não precisar de 3 colunas separadas no banco.
import crypto from 'crypto'

const ALGORITMO = 'aes-256-gcm'
const TAMANHO_IV = 12

function chave(): Buffer {
  const b64 = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY
  if (!b64) throw new Error('INSTAGRAM_TOKEN_ENCRYPTION_KEY não configurada no .env — gere com: openssl rand -base64 32')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length !== 32) throw new Error('INSTAGRAM_TOKEN_ENCRYPTION_KEY precisa decodificar pra exatamente 32 bytes (openssl rand -base64 32)')
  return buf
}

export function encryptSecret(texto: string): string {
  const iv = crypto.randomBytes(TAMANHO_IV)
  const cifra = crypto.createCipheriv(ALGORITMO, chave(), iv)
  const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  const tag = cifra.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), cifrado.toString('base64')].join('.')
}

export function decryptSecret(valor: string): string {
  const [ivB64, tagB64, cifradoB64] = valor.split('.')
  if (!ivB64 || !tagB64 || !cifradoB64) throw new Error('Valor criptografado em formato inesperado')
  const decifra = crypto.createDecipheriv(ALGORITMO, chave(), Buffer.from(ivB64, 'base64'))
  decifra.setAuthTag(Buffer.from(tagB64, 'base64'))
  const texto = Buffer.concat([decifra.update(Buffer.from(cifradoB64, 'base64')), decifra.final()])
  return texto.toString('utf8')
}
