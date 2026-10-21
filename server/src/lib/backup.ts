import fs from 'fs'
import path from 'path'
import { createClient } from '@libsql/client'
import { getConfigNumero } from './configuracoes.js'
import { hojeBr } from './dataBr.js'

const BACKUPS_DIR = process.env.BACKUPS_DIR ?? './backups'
const DATABASE_URL = process.env.DATABASE_URL ?? 'file:./joitec_crm.db'

function timestampArquivo(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export interface BackupInfo {
  arquivo: string
  tamanhoBytes: number
  criadoEm: string
}

// Backup = cópia do banco SQLite num diretório à parte, com timestamp no
// nome. Mudou em 2026-10-21 (CRM travando): antes copiava o arquivo com
// copyFileSync E a pasta inteira de uploads (10 GB) com cpSync — tudo
// síncrono, o servidor ficava ~4 min sem responder ninguém, todo dia e logo
// depois de cada deploy. Agora:
//  - só o banco, via `VACUUM INTO` (cópia consistente mesmo com gente
//    gravando, ~segundos pra 175 MB). Os uploads já ficam num volume próprio
//    do Docker que sobrevive a deploy — copiar 10 GB por dia (x30 dias de
//    retenção) também encheria o disco;
//  - BACKUPS_DIR precisa ser um volume (docker-compose: `backups`), senão o
//    backup some junto com o container a cada deploy (era o que acontecia).
export async function executarBackup(): Promise<BackupInfo> {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true })

  const ts = timestampArquivo()
  const nomeArquivo = `joitec_crm_${ts}.db`
  const destino = path.resolve(BACKUPS_DIR, nomeArquivo)
  // Conexão própria: na conexão principal do servidor sempre tem consulta
  // em andamento e o SQLite recusa ("cannot VACUUM - SQL statements in
  // progress").
  const conexao = createClient({ url: DATABASE_URL })
  try {
    await conexao.execute({ sql: 'VACUUM INTO ?', args: [destino] })
  } finally {
    conexao.close()
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
// arquivo criado hoje), e só de madrugada — antes rodava na primeira hora
// cheia depois de subir o servidor, ou seja, logo depois de todo deploy.
export async function executarBackupSeNecessario(): Promise<BackupInfo | null> {
  const horaBr = hojeBr().getUTCHours()
  if (horaBr < 2 || horaBr > 5) return null
  const hoje = new Date().toISOString().slice(0, 10)
  const jaTemHoje = listarBackups().some((b) => b.arquivo.includes(hoje))
  if (jaTemHoje) return null
  return executarBackup()
}
