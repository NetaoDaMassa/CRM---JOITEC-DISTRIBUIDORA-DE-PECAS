// Leitura/escrita de .zip (o .pptx é um zip) só com o zlib do Node — sem
// dependência nova. Cobre o que os PowerPoints da Odin usam: entradas
// "stored" (0) ou "deflate" (8), sem zip64 (arquivos bem abaixo de 4 GB).
import zlib from 'zlib'

export type ArquivosZip = Map<string, Buffer>

export function lerZip(buf: Buffer): ArquivosZip {
  // Fim do diretório central: assinatura 0x06054b50 nos últimos ~64 KB.
  let fim = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fim = i
      break
    }
  }
  if (fim < 0) throw new Error('Arquivo não é um .zip/.pptx válido')
  const total = buf.readUInt16LE(fim + 10)
  let p = buf.readUInt32LE(fim + 16)
  const out: ArquivosZip = new Map()
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Diretório do zip corrompido')
    const metodo = buf.readUInt16LE(p + 10)
    const tamComp = buf.readUInt32LE(p + 20)
    const lenNome = buf.readUInt16LE(p + 28)
    const lenExtra = buf.readUInt16LE(p + 30)
    const lenComent = buf.readUInt16LE(p + 32)
    const offLocal = buf.readUInt32LE(p + 42)
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome)
    p += 46 + lenNome + lenExtra + lenComent
    if (nome.endsWith('/')) continue
    const lNome = buf.readUInt16LE(offLocal + 26)
    const lExtra = buf.readUInt16LE(offLocal + 28)
    const ini = offLocal + 30 + lNome + lExtra
    const dados = buf.subarray(ini, ini + tamComp)
    if (metodo === 0) out.set(nome, Buffer.from(dados))
    else if (metodo === 8) out.set(nome, zlib.inflateRawSync(dados))
    else throw new Error(`Compressão ${metodo} não suportada (${nome})`)
  }
  return out
}

const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// `[Content_Types].xml` vai primeiro (o PowerPoint é chato com isso).
export function escreverZip(arquivos: ArquivosZip): Buffer {
  const nomes = [...arquivos.keys()].sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0))
  const partes: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const nome of nomes) {
    const dados = arquivos.get(nome)!
    const nomeBuf = Buffer.from(nome, 'utf8')
    // Imagem já vem comprimida — guardar sem recomprimir economiza tempo.
    const jaComprimido = /\.(png|jpe?g|gif|emf|wmf|wdp|mp4|m4a)$/i.test(nome)
    const comp = jaComprimido ? dados : zlib.deflateRawSync(dados, { level: 6 })
    const metodo = jaComprimido ? 0 : 8
    const crc = crc32(dados)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // nomes em UTF-8
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(dados.length, 22)
    local.writeUInt16LE(nomeBuf.length, 26)
    local.writeUInt16LE(0, 28)
    partes.push(local, nomeBuf, comp)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(metodo, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0x21, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(comp.length, 20)
    cen.writeUInt32LE(dados.length, 24)
    cen.writeUInt16LE(nomeBuf.length, 28)
    cen.writeUInt32LE(offset, 42)
    central.push(cen, nomeBuf)
    offset += 30 + nomeBuf.length + comp.length
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(nomes.length, 8)
  fim.writeUInt16LE(nomes.length, 10)
  fim.writeUInt32LE(tamCentral, 12)
  fim.writeUInt32LE(offset, 16)
  return Buffer.concat([...partes, ...central, fim])
}
