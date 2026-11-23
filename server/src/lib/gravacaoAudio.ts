import { spawn } from 'node:child_process'
import { baixarGravacaoGoto } from './goto.js'

// Download do áudio de uma gravação de ligação — usado pelo player
// (/pabx-gravacao/:id) e pela "Analisar ligação" (lib/avaliacaoLigacao.ts).
// Separado do index.ts em 2026-11-23 sem mudar o comportamento do player.

export class ErroGravacao extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export function paraMp3(entrada: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-f', 'mp3', '-b:a', '48k', 'pipe:1'])
    const saida: Buffer[] = []
    let erro = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), 60_000)
    p.stdout.on('data', (d: Buffer) => saida.push(d))
    p.stderr.on('data', (d: Buffer) => (erro += d.toString()))
    p.on('error', (e) => (clearTimeout(timer), reject(e)))
    p.on('close', (code) => (clearTimeout(timer), code === 0 ? resolve(Buffer.concat(saida)) : reject(new Error(erro.slice(0, 200) || `ffmpeg saiu com ${code}`))))
    p.stdin.on('error', () => {})
    p.stdin.end(entrada)
  })
}

// Um link de linkGravacao (uma "parte"): "goto:<id>" (Joitec) ou URL da PABXONE360 (Odin).
export async function baixarAudioGravacao(link: string): Promise<{ audio: Buffer; mime: string; ext: string }> {
  // GoTo (Joitec): "goto:<recordingId>" — baixa pela API da GoTo.
  if (link.startsWith('goto:')) {
    let audio: Buffer
    try {
      audio = (await baixarGravacaoGoto(link.slice(5))).audio
    } catch (e) {
      throw new ErroGravacao((e as Error).message, 502)
    }
    // Já vem em MP3 ("ID3" ou cabeçalho de quadro 0xFFEx) — só converte se não for.
    const jaMp3 = audio.subarray(0, 3).toString('latin1') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
    const mp3 = jaMp3 ? audio : await paraMp3(audio).catch(() => null)
    return mp3?.length ? { audio: mp3, mime: 'audio/mpeg', ext: 'mp3' } : { audio, mime: 'audio/wav', ext: 'wav' }
  }
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new ErroGravacao('Link de gravação inválido', 404)
  }
  // A API devolve o link num IP (https://45.170.138.172/…) com certificado
  // autoassinado; o mesmo download_audio.php responde no domínio oficial,
  // que tem certificado válido — usa o domínio.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    url.hostname = 'pabxone360.com.br'
    url.protocol = 'https:'
    url.port = ''
  }
  let resp: Response
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch (e) {
    const causa = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message
    throw new ErroGravacao(`Não consegui buscar a gravação na PABXONE360 (${causa})`, 502)
  }
  if (!resp.ok || !resp.body) throw new ErroGravacao(`PABXONE360 não devolveu o áudio (${resp.status})`, 502)
  const tipo = resp.headers.get('content-type') ?? ''
  // "Parâmetros inválidos!" / link vencido vem como página HTML, não áudio.
  if (/text\/|json/i.test(tipo)) {
    throw new ErroGravacao(`PABXONE360 não devolveu o áudio: ${(await resp.text()).replace(/<[^>]+>/g, ' ').trim().slice(0, 120)}`, 502)
  }
  // Vem como application/force-download; o arquivo é WAV ("RIFF") —
  // descobre pelo começo do arquivo pro navegador tocar.
  let audio: Buffer = Buffer.from(await resp.arrayBuffer())
  const inicio = audio.subarray(0, 4).toString('latin1')
  let [mime, ext] =
    inicio === 'RIFF' ? ['audio/wav', 'wav'] : inicio === 'OggS' ? ['audio/ogg', 'ogg'] : /audio/i.test(tipo) ? [tipo, 'mp3'] : ['audio/mpeg', 'mp3']
  // WAV de telefonia (GSM/µ-law…) o Chrome não toca — converte pra MP3.
  if (inicio === 'RIFF') {
    const mp3 = await paraMp3(audio).catch((e) => (console.error('[pabx-gravacao] ffmpeg:', (e as Error).message), null))
    if (mp3?.length) [audio, mime, ext] = [mp3, 'audio/mpeg', 'mp3']
  }
  return { audio, mime, ext }
}
