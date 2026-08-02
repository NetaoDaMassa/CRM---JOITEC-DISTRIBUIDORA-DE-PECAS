import fs from 'fs'
import path from 'path'
import { getConfigNumero } from './configuracoes.js'

const BACKUPS_DIR = process.env.BACKUPS_DIR ?? './backups'
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./joitec_crm.db'
  return url.replace(/^file:/, '')
}

function timestampArquivo(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export interface BackupInfo {
  arquivo: string
  tamanhoBytes: number
  criadoEm: string
}

// Backup = cópia do arquivo SQLite (+ pasta de uploads, com os PDFs de
// pedido) num diretório à parte, com timestamp no nome. Sem compressão —
// simplicidade > espaço em disco pro tamanho de banco que esse projeto tem.
export async function executarBackup(): Promise<BackupInfo> {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true })

  const ts = timestampArquivo()
  const nomeArquivo = `joitec_crm_${ts}.db`
  const destino = path.join(BACKUPS_DIR, nomeArquivo)
  fs.copyFileSync(dbFilePath(), destino)

  const uploadsDestino = path.join(BACKUPS_DIR, `uploads_${ts}`)
  if (fs.existsSync(UPLOADS_DIR)) {
    fs.cpSync(UPLOADS_DIR, uploadsDestino, { recursive: true })
  }

  await podarBackupsAntigos()

  const stat = fs.statSync(destino)
  return { arquivo: nomeArquivo, tamanhoBytes: stat.size, criadoEm: stat.mtime.toISOString() }
}

async function podarBackupsAntigos(): Promise<void> {
  const retencaoDias = await getConfigNumero('backup_retencao_dias', 30)
  const limite = Date.now() - retencaoDias * 24 * 60 * 60 * 1000

  if (!fs.existsSync(BACKUPS_DIR)) return
  for (const nome of fs.readdirSync(BACKUPS_DIR)) {
    const caminho = path.join(BACKUPS_DIR, nome)
    const stat = fs.statSync(caminho)
    if (stat.mtimeMs < limite) {
      fs.rmSync(caminho, { recursive: true, force: true })
    }
  }
}

export function listarBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUPS_DIR)) return []
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((n) => n.endsWith('.db'))
    .map((nome) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, nome))
      return { arquivo: nome, tamanhoBytes: stat.size, criadoEm: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
}

// Roda uma vez por dia (idempotente: só faz o backup se ainda não existe um
// arquivo criado hoje).
export async function executarBackupSeNecessario(): Promise<BackupInfo | null> {
  const hoje = new Date().toISOString().slice(0, 10)
  const jaTemHoje = listarBackups().some((b) => b.arquivo.includes(hoje))
  if (jaTemHoje) return null
  return executarBackup()
}
