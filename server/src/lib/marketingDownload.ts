// Arquivos/Mídia — download de verdade (João, 2026-11-16: "o botão de baixar,
// baixe de verdade"). Antes o botão só abria /uploads/<arquivo> numa aba nova:
// foto, PDF e vídeo o navegador MOSTRAVA em vez de salvar, e com o nome
// "marketing-<uuid>". Agora marketing.prepararDownload confere o acesso e
// devolve um link curto (2 min) pra GET /marketing-arquivo/baixar/:token,
// que manda o arquivo como anexo com o nome original — ou um .zip quando são
// vários (seleção). Link curto porque um <a>/location.href não manda o
// cabeçalho Authorization, e assim o navegador baixa sozinho (barra de
// progresso nativa, funciona no celular, sem carregar tudo na memória).
import { createReadStream, statSync } from 'fs'
import { randomBytes } from 'crypto'
import type { Writable } from 'stream'

type Pedido = { arquivos: { caminho: string; nome: string }[]; expira: number }
const pedidos = new Map<string, Pedido>()
const VALIDADE_MS = 2 * 60 * 1000

export function criarTokenDownload(arquivos: Pedido['arquivos']): string {
  const agora = Date.now()
  for (const [t, p] of pedidos) if (p.expira < agora) pedidos.delete(t)
  const token = randomBytes(24).toString('base64url')
  pedidos.set(token, { arquivos, expira: agora + VALIDADE_MS })
  return token
}

export function lerTokenDownload(token: string): Pedido['arquivos'] | null {
  const p = pedidos.get(token)
  if (!p || p.expira < Date.now()) return null
  return p.arquivos
}

// Nomes repetidos dentro do zip ganham " (2)", " (3)"...
export function nomesUnicos(nomes: string[]): string[] {
  const usados = new Set<string>()
  return nomes.map((n) => {
    const limpo = n.replace(/[\\/:*?"<>|]/g, '_').trim() || 'arquivo'
    let final = limpo
    const ponto = limpo.lastIndexOf('.')
    const base = ponto > 0 ? limpo.slice(0, ponto) : limpo
    const ext = ponto > 0 ? limpo.slice(ponto) : ''
    for (let i = 2; usados.has(final.toLowerCase()); i++) final = `${base} (${i})${ext}`
    usados.add(final.toLowerCase())
    return final
  })
}

// ZIP simples, sem compressão (foto/vídeo/PDF já vêm comprimidos), escrito em
// fluxo: cabeçalho local com bit 3 (CRC/tamanho num "data descriptor" depois
// dos dados) pra não precisar ler o arquivo duas vezes. Nomes em UTF-8 (bit 11).
// Sem ZIP64 — cada arquivo do upload tem no máx. 300 MB; total acima de 4 GB
// não é esperado aqui.
const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(crc: number, buf: Buffer): number {
  let c = crc ^ 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dataDos(d: Date): { hora: number; data: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    data: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

function escrever(saida: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (saida.write(buf)) return resolve()
    const onErr = (e: Error) => (saida.off('drain', onDrain), reject(e))
    const onDrain = () => (saida.off('error', onErr), resolve())
    saida.once('drain', onDrain)
    saida.once('error', onErr)
  })
}

export async function escreverZip(saida: Writable, arquivos: { caminho: string; nome: string }[]): Promise<void> {
  const nomes = nomesUnicos(arquivos.map((a) => a.nome))
  const central: Buffer[] = []
  let offset = 0
  for (let i = 0; i < arquivos.length; i++) {
    const nome = Buffer.from(nomes[i], 'utf8')
    let mtime = new Date()
    try {
      mtime = statSync(arquivos[i].caminho).mtime
    } catch {
      continue // arquivo sumiu do disco — pula em vez de quebrar o zip inteiro
    }
    const { hora, data } = dataDos(mtime)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0808, 6) // bit 3 (data descriptor) + bit 11 (UTF-8)
    local.writeUInt16LE(0, 8) // sem compressão
    local.writeUInt16LE(hora, 10)
    local.writeUInt16LE(data, 12)
    local.writeUInt16LE(nome.length, 26)
    await escrever(saida, local)
    await escrever(saida, nome)
    let crc = 0
    let tamanho = 0
    for await (const pedaco of createReadStream(arquivos[i].caminho)) {
      const b = pedaco as Buffer
      crc = crc32(crc, b)
      tamanho += b.length
      await escrever(saida, b)
    }
    const desc = Buffer.alloc(16)
    desc.writeUInt32LE(0x08074b50, 0)
    desc.writeUInt32LE(crc, 4)
    desc.writeUInt32LE(tamanho, 8)
    desc.writeUInt32LE(tamanho, 12)
    await escrever(saida, desc)

    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x0808, 8)
    c.writeUInt16LE(0, 10)
    c.writeUInt16LE(hora, 12)
    c.writeUInt16LE(data, 14)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(tamanho, 20)
    c.writeUInt32LE(tamanho, 24)
    c.writeUInt16LE(nome.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, nome)
    offset += 30 + nome.length + tamanho + 16
  }
  const dir = Buffer.concat(central)
  const fim = Buffer.alloc(22)
  const total = central.length / 2
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(total, 8)
  fim.writeUInt16LE(total, 10)
  fim.writeUInt32LE(dir.length, 12)
  fim.writeUInt32LE(offset, 16)
  await escrever(saida, dir)
  await escrever(saida, fim)
}
