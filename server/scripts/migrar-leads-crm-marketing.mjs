// Script avulso — migra o histórico do módulo de Leads do sistema separado
// CRM de marketing (odin-tubos-crm--master, público em crm-odin.duckdns.org)
// pro Joitec CRM. Fase 1 da migração descrita em
// /Users/weslley/.claude/plans/stateful-soaring-moore.md — só cópia de
// dados, sem afetar em nada o sistema de origem (leitura pura lá).
//
// Uso:
//   node migrar-leads-crm-marketing.mjs --source <odin_crm.db> --target <joitec_crm.db> [--apply]
//
// Sem --apply roda em modo dry-run (padrão): só imprime o relatório de
// contagens/problemas, não grava nada no destino. Só roda de verdade com
// --apply explícito, depois de revisar o dry-run.
//
// Idempotente: por lead, usa `leads.origem_lead_id` (empresa_id, origem_lead_id)
// pra saber se aquele lead do sistema antigo já foi migrado — se já foi,
// pula ele e todo o histórico/notas/anexos/tentativas/tracking dele.
// Regiões/DDDs/vendedores-por-região/campanhas são casados por nome (não por
// id) — também seguro rodar de novo, reaproveita o que já existe.
//
// Não copia os arquivos físicos dos anexos (isso é feito à parte, via
// `docker cp` direto entre os volumes de uploads) — aqui só entra o
// metadado (lead_attachments), que já sai correto se os arquivos forem
// copiados com os mesmos nomes.
//
// Requer só @libsql/client (já é dependência do projeto, roda com `node`
// puro, sem precisar de tsx/build) — mesmo estilo dos scripts avulsos
// .mjs já usados no sistema de origem (server/create-campaigns.mjs lá).

import { createClient } from '@libsql/client'

const args = process.argv.slice(2)
function argVal(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const SOURCE_PATH = argVal('--source')
const TARGET_PATH = argVal('--target')
const APPLY = args.includes('--apply')

if (!SOURCE_PATH || !TARGET_PATH) {
  console.error('Uso: node migrar-leads-crm-marketing.mjs --source <odin_crm.db> --target <joitec_crm.db> [--apply]')
  process.exit(1)
}

// Mapeamento de empresa (slug antigo -> slug novo) — decisão confirmada com
// o João em 2026-08-24: leads da Compretec (63, sem vendedor migrável ainda)
// vão pra "Compretec E-commerce".
const EMPRESA_SLUG_MAP = {
  'odin-tubos': 'odin-tubos',
  'odin-compressores': 'odin-compressores',
  joitec: 'joitec',
  compretec: 'compretec-ecommerce',
}

const src = createClient({ url: `file:${SOURCE_PATH}` })
const dst = createClient({ url: `file:${TARGET_PATH}` })

// O destino é o banco AO VIVO da aplicação (gente usando o sistema
// enquanto isso roda) — SQLITE_BUSY é esperado de vez em quando por causa
// de trava momentânea entre esta conexão e as da aplicação. busy_timeout
// manda o SQLite esperar e tentar de novo sozinho por até 30s antes de
// desistir, em vez de falhar na hora. Reforçado com um retry manual no
// helper `insert()` abaixo pra qualquer SQLITE_BUSY que escape disso.
await dst.execute('PRAGMA busy_timeout = 30000')

async function comRetry(fn, tentativas = 5) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn()
    } catch (err) {
      const ehBusy = err?.code === 'SQLITE_BUSY' || /database is locked/i.test(String(err?.message))
      if (!ehBusy || i === tentativas - 1) throw err
      const espera = 500 * (i + 1)
      console.log(`  ⏳ banco ocupado, tentando de novo em ${espera}ms (tentativa ${i + 1}/${tentativas})...`)
      await new Promise((r) => setTimeout(r, espera))
    }
  }
}

async function dstExec(query) {
  return comRetry(() => dst.execute(query))
}

const relatorio = {
  empresasSemMapa: [],
  vendedoresSemCorrespondencia: new Map(), // username -> {name, empresaAntigaId}
  contadores: {},
}
function conta(tabela, chave) {
  relatorio.contadores[tabela] ??= { inseridos: 0, pulados: 0 }
  relatorio.contadores[tabela][chave]++
}

// Em dry-run, devolve um id sintético (negativo) em vez de gravar de
// verdade — sem isso, tabelas que dependem do id gerado (regiões,
// campanhas, visitantes) ficariam com o mapa vazio e o relatório de
// dry-run subestimaria tudo que depende delas (DDDs, vendedores por
// região, eventos de rastreamento).
let proximoIdFalso = -1
async function insert(table, columns, values) {
  if (!APPLY) return proximoIdFalso--
  const placeholders = columns.map(() => '?').join(', ')
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
  const r = await dstExec({ sql, args: values })
  return Number(r.lastInsertRowid)
}

async function main() {
  console.log(`\nModo: ${APPLY ? '⚠️  APLICANDO DE VERDADE (gravando no destino)' : '🔎 DRY-RUN (nada será gravado)'}\n`)

  // ── 1) Empresas ────────────────────────────────────────────────────────
  const empresasSrc = (await src.execute('SELECT id, name, slug FROM companies')).rows
  const empresasDst = (await dstExec('SELECT id, nome, slug FROM empresas')).rows
  const empresaIdMap = new Map() // old company.id -> new empresas.id
  for (const e of empresasSrc) {
    const novoSlug = EMPRESA_SLUG_MAP[e.slug]
    if (!novoSlug) {
      relatorio.empresasSemMapa.push(`${e.slug} (id antigo ${e.id}) — sem mapeamento definido`)
      continue
    }
    const alvo = empresasDst.find((x) => x.slug === novoSlug)
    if (!alvo) {
      relatorio.empresasSemMapa.push(`${e.slug} -> ${novoSlug} (empresa não existe no Joitec CRM)`)
      continue
    }
    empresaIdMap.set(e.id, alvo.id)
  }

  // ── 2) Vendedores (users) — casados por username, escopados pela empresa mapeada ──
  const usersSrc = (await src.execute('SELECT id, company_id, username, name FROM users')).rows
  const usersDstRows = (await dstExec('SELECT id, empresa_id, username FROM users')).rows
  const usersDstByKey = new Map()
  for (const u of usersDstRows) usersDstByKey.set(`${u.empresa_id}:${u.username}`, u.id)
  const vendorIdMap = new Map() // old users.id -> new users.id
  for (const u of usersSrc) {
    const novaEmpresaId = empresaIdMap.get(u.company_id)
    if (!novaEmpresaId) continue
    const novoId = usersDstByKey.get(`${novaEmpresaId}:${u.username}`)
    if (novoId) vendorIdMap.set(u.id, novoId)
    else relatorio.vendedoresSemCorrespondencia.set(u.username, { name: u.name, companyIdAntigo: u.company_id })
  }
  // Admin de cada empresa nova (pra fallback de autor de nota/tentativa/anexo
  // quando o vendedor original não tem correspondência) — prioriza superAdmin.
  const adminsDst = (await dstExec("SELECT id, empresa_id, super_admin FROM users WHERE role = 'admin'")).rows
  const adminPorEmpresa = new Map()
  for (const a of adminsDst) {
    const atual = adminPorEmpresa.get(a.empresa_id)
    if (!atual || (a.super_admin && !atual.super_admin)) adminPorEmpresa.set(a.empresa_id, a)
  }
  // Último recurso: o superAdmin "dono" de toda a operação — garante que
  // nenhuma nota/anexo/tentativa vira órfã só porque a empresa (ex:
  // Compretec E-commerce) ainda não tem nenhum admin próprio cadastrado.
  const superAdminGlobal = adminsDst.find((a) => a.super_admin)?.id ?? null
  function autorFallback(novaEmpresaId, oldUserId) {
    const mapeado = vendorIdMap.get(oldUserId)
    if (mapeado) return mapeado
    return adminPorEmpresa.get(novaEmpresaId)?.id ?? superAdminGlobal
  }

  // ── 3) Regiões (por nome, dentro da empresa) ──────────────────────────
  const regionsSrc = (await src.execute('SELECT id, company_id, name FROM regions')).rows
  const regionIdMap = new Map() // old regions.id -> new lead_regions.id
  for (const r of regionsSrc) {
    const novaEmpresaId = empresaIdMap.get(r.company_id)
    if (!novaEmpresaId) continue
    const existente = (
      await dstExec({
        sql: 'SELECT id FROM lead_regions WHERE empresa_id = ? AND name = ?',
        args: [novaEmpresaId, r.name],
      })
    ).rows[0]
    if (existente) {
      regionIdMap.set(r.id, existente.id)
      conta('lead_regions', 'pulados')
      continue
    }
    const novoId = await insert('lead_regions', ['empresa_id', 'name'], [novaEmpresaId, r.name])
    if (novoId) regionIdMap.set(r.id, novoId)
    conta('lead_regions', 'inseridos')
  }

  // ── 4) DDDs (por ddd, dentro da empresa) ──────────────────────────────
  const dddsSrc = (await src.execute('SELECT id, company_id, ddd, region_id FROM ddds')).rows
  for (const d of dddsSrc) {
    const novaEmpresaId = empresaIdMap.get(d.company_id)
    const novaRegiaoId = regionIdMap.get(d.region_id)
    if (!novaEmpresaId || !novaRegiaoId) { conta('lead_ddds', 'pulados'); continue }
    const existente = (
      await dstExec({ sql: 'SELECT id FROM lead_ddds WHERE empresa_id = ? AND ddd = ?', args: [novaEmpresaId, d.ddd] })
    ).rows[0]
    if (existente) {
      conta('lead_ddds', 'pulados')
      continue
    }
    await insert('lead_ddds', ['empresa_id', 'ddd', 'region_id'], [novaEmpresaId, d.ddd, novaRegiaoId])
    conta('lead_ddds', 'inseridos')
  }

  // ── 5) Vendedores por região ───────────────────────────────────────────
  const regionVendorsSrc = (await src.execute('SELECT id, region_id, vendor_id FROM region_vendors')).rows
  for (const rv of regionVendorsSrc) {
    const novaRegiaoId = regionIdMap.get(rv.region_id)
    const novoVendorId = vendorIdMap.get(rv.vendor_id)
    if (!novaRegiaoId || !novoVendorId) { conta('lead_region_vendedores', 'pulados'); continue }
    const existente = (
      await dstExec({
        sql: 'SELECT id FROM lead_region_vendedores WHERE region_id = ? AND vendor_id = ?',
        args: [novaRegiaoId, novoVendorId],
      })
    ).rows[0]
    if (existente) {
      conta('lead_region_vendedores', 'pulados')
      continue
    }
    await insert('lead_region_vendedores', ['region_id', 'vendor_id'], [novaRegiaoId, novoVendorId])
    conta('lead_region_vendedores', 'inseridos')
  }

  // ── 6) Estado do rodízio (preserva o cursor pra não resetar a rotação) ─
  const rrSrc = (await src.execute('SELECT id, region_id, next_index FROM round_robin_state')).rows
  for (const rr of rrSrc) {
    const novaRegiaoId = regionIdMap.get(rr.region_id)
    if (!novaRegiaoId) { conta('lead_round_robin_state', 'pulados'); continue }
    const existente = (
      await dstExec({ sql: 'SELECT id FROM lead_round_robin_state WHERE region_id = ?', args: [novaRegiaoId] })
    ).rows[0]
    if (existente) {
      conta('lead_round_robin_state', 'pulados')
      continue
    }
    await insert('lead_round_robin_state', ['region_id', 'next_index'], [novaRegiaoId, rr.next_index])
    conta('lead_round_robin_state', 'inseridos')
  }

  // ── 7) Campanhas (por nome, dentro da empresa) ─────────────────────────
  const campaignsSrc = (await src.execute('SELECT id, company_id, name, channel, description, is_active FROM campaigns')).rows
  const campaignIdMap = new Map()
  for (const c of campaignsSrc) {
    const novaEmpresaId = empresaIdMap.get(c.company_id)
    if (!novaEmpresaId) continue
    const existente = (
      await dstExec({ sql: 'SELECT id FROM lead_campaigns WHERE empresa_id = ? AND name = ?', args: [novaEmpresaId, c.name] })
    ).rows[0]
    if (existente) {
      campaignIdMap.set(c.id, existente.id)
      conta('lead_campaigns', 'pulados')
      continue
    }
    const novoId = await insert(
      'lead_campaigns',
      ['empresa_id', 'name', 'channel', 'description', 'is_active'],
      [novaEmpresaId, c.name, c.channel, c.description, c.is_active]
    )
    if (novoId) campaignIdMap.set(c.id, novoId)
    conta('lead_campaigns', 'inseridos')
  }

  // ── 8) Leads em si — o núcleo, com idempotência por origem_lead_id ─────
  const leadsSrc = (
    await src.execute(
      `SELECT id, company_id, name, phone, ddd, email, company, city, segment, status, vendor_id, region_id,
              campaign_id, source, observations, next_contact_at, follow_up_count, requires_attachment,
              status_changed_at, idle_alert_sent_at, auto_reassigned_at, last_contact_at, attempt_count,
              sla_status, abordagem_4h_alert_sent_at, last_contact_stale_alert_sent_at, cod_sap, order_value,
              final_order_value, payment_method, loss_reason, disqualify_reason, final_consumer_reason,
              negotiation_tag, created_at, updated_at, assigned_at, deleted_at, deleted_by
       FROM leads`
    )
  ).rows

  // Leads já migrados anteriormente (idempotência) — por empresa nova. Guarda
  // o id novo pra popular leadIdMap MESMO pra quem já existe — importante
  // pra permitir "completar" um lead cujos filhos (notas/anexos/
  // histórico/tentativas) ficaram faltando de uma rodada anterior que caiu
  // no meio (ver checagem por tabela mais abaixo, passos 9-12).
  const jaMigrados = new Map() // `${novaEmpresaId}:${origemLeadId}` -> id novo
  const existentesRows = (
    await dstExec('SELECT id, empresa_id, origem_lead_id FROM leads WHERE origem_lead_id IS NOT NULL')
  ).rows
  for (const e of existentesRows) jaMigrados.set(`${e.empresa_id}:${e.origem_lead_id}`, e.id)

  const leadIdMap = new Map() // old leads.id -> new leads.id
  for (const l of leadsSrc) {
    const novaEmpresaId = empresaIdMap.get(l.company_id)
    if (!novaEmpresaId) continue
    const existenteId = jaMigrados.get(`${novaEmpresaId}:${l.id}`)
    if (existenteId) {
      leadIdMap.set(l.id, existenteId)
      conta('leads', 'pulados')
      continue
    }
    const novoVendorId = l.vendor_id ? vendorIdMap.get(l.vendor_id) ?? null : null
    const novaRegiaoId = l.region_id ? regionIdMap.get(l.region_id) ?? null : null
    const novaCampanhaId = l.campaign_id ? campaignIdMap.get(l.campaign_id) ?? null : null
    const novoDeletedBy = l.deleted_by ? vendorIdMap.get(l.deleted_by) ?? null : null

    const novoId = await insert(
      'leads',
      [
        'empresa_id', 'name', 'phone', 'ddd', 'email', 'company', 'city', 'segment', 'status', 'vendor_id',
        'region_id', 'campaign_id', 'source', 'observations', 'next_contact_at', 'follow_up_count',
        'requires_attachment', 'status_changed_at', 'idle_alert_sent_at', 'auto_reassigned_at', 'last_contact_at',
        'attempt_count', 'sla_status', 'abordagem_4h_alert_sent_at', 'last_contact_stale_alert_sent_at', 'cod_sap',
        'order_value', 'final_order_value', 'payment_method', 'loss_reason', 'disqualify_reason',
        'final_consumer_reason', 'negotiation_tag', 'origem_lead_id', 'created_at', 'updated_at', 'assigned_at',
        'deleted_at', 'deleted_by',
      ],
      [
        novaEmpresaId, l.name, l.phone, l.ddd, l.email, l.company, l.city, l.segment, l.status, novoVendorId,
        novaRegiaoId, novaCampanhaId, l.source, l.observations, l.next_contact_at, l.follow_up_count,
        l.requires_attachment, l.status_changed_at, l.idle_alert_sent_at, l.auto_reassigned_at, l.last_contact_at,
        l.attempt_count, l.sla_status, l.abordagem_4h_alert_sent_at, l.last_contact_stale_alert_sent_at, l.cod_sap,
        l.order_value, l.final_order_value, l.payment_method, l.loss_reason, l.disqualify_reason,
        l.final_consumer_reason, l.negotiation_tag, l.id, l.created_at, l.updated_at, l.assigned_at, l.deleted_at,
        novoDeletedBy,
      ]
    )
    if (APPLY) leadIdMap.set(l.id, novoId)
    else leadIdMap.set(l.id, `DRYRUN:${l.id}`) // permite validar contagem dos filhos mesmo sem gravar
    conta('leads', 'inseridos')
  }

  // Helper: dado um old lead id, resolve a empresa nova dele (pros filhos).
  const empresaPorOldLeadId = new Map()
  for (const l of leadsSrc) {
    const novaEmpresaId = empresaIdMap.get(l.company_id)
    if (novaEmpresaId && leadIdMap.has(l.id)) empresaPorOldLeadId.set(l.id, novaEmpresaId)
  }

  // Pra cada tabela filha, marca quais leads (id novo) já têm pelo menos 1
  // linha migrada — cobre o caso de uma rodada anterior ter caído no meio
  // (ex: banco ocupado) depois de inserir o lead mas antes de terminar os
  // filhos dele: aqui a gente completa só o que faltou, sem duplicar o que
  // já tinha entrado.
  async function leadsComFilhosEm(tabela) {
    const r = await dstExec(`SELECT DISTINCT lead_id FROM ${tabela}`)
    return new Set(r.rows.map((row) => row.lead_id))
  }
  const leadsComNotas = await leadsComFilhosEm('lead_notes')
  const leadsComAnexos = await leadsComFilhosEm('lead_attachments')
  const leadsComHistorico = await leadsComFilhosEm('lead_history')
  const leadsComTentativas = await leadsComFilhosEm('lead_contact_attempts')

  // ── 9) Notas ────────────────────────────────────────────────────────────
  const notesSrc = (await src.execute('SELECT id, lead_id, user_id, type, content, next_contact_at, created_at FROM lead_notes')).rows
  for (const n of notesSrc) {
    const novoLeadId = leadIdMap.get(n.lead_id)
    const novaEmpresaId = empresaPorOldLeadId.get(n.lead_id)
    if (!novoLeadId || !novaEmpresaId) continue
    if (leadsComNotas.has(novoLeadId)) { conta('lead_notes', 'pulados'); continue }
    const autorId = autorFallback(novaEmpresaId, n.user_id)
    if (!autorId) { conta('lead_notes', 'pulados'); continue }
    await insert(
      'lead_notes',
      ['lead_id', 'user_id', 'type', 'content', 'next_contact_at', 'created_at'],
      [novoLeadId, autorId, n.type, n.content, n.next_contact_at, n.created_at]
    )
    conta('lead_notes', 'inseridos')
  }

  // ── 10) Anexos (metadado — arquivo físico copiado à parte) ────────────
  const attSrc = (
    await src.execute('SELECT id, lead_id, user_id, filename, original_name, mime_type, size, created_at FROM lead_attachments')
  ).rows
  for (const a of attSrc) {
    const novoLeadId = leadIdMap.get(a.lead_id)
    const novaEmpresaId = empresaPorOldLeadId.get(a.lead_id)
    if (!novoLeadId || !novaEmpresaId) continue
    if (leadsComAnexos.has(novoLeadId)) { conta('lead_attachments', 'pulados'); continue }
    const autorId = autorFallback(novaEmpresaId, a.user_id)
    if (!autorId) { conta('lead_attachments', 'pulados'); continue }
    await insert(
      'lead_attachments',
      ['lead_id', 'user_id', 'filename', 'original_name', 'mime_type', 'size', 'created_at'],
      [novoLeadId, autorId, a.filename, a.original_name, a.mime_type, a.size, a.created_at]
    )
    conta('lead_attachments', 'inseridos')
  }

  // ── 11) Histórico (userId/from/to vendor são nullable, não precisa fallback) ──
  const histSrc = (
    await src.execute(
      'SELECT id, lead_id, user_id, action, from_status, to_status, from_vendor_id, to_vendor_id, details, created_at FROM lead_history'
    )
  ).rows
  for (const h of histSrc) {
    const novoLeadId = leadIdMap.get(h.lead_id)
    const novaEmpresaId = empresaPorOldLeadId.get(h.lead_id)
    if (!novoLeadId || !novaEmpresaId) continue
    if (leadsComHistorico.has(novoLeadId)) { conta('lead_history', 'pulados'); continue }
    const novoUserId = h.user_id ? vendorIdMap.get(h.user_id) ?? null : null
    const novoFromVendor = h.from_vendor_id ? vendorIdMap.get(h.from_vendor_id) ?? null : null
    const novoToVendor = h.to_vendor_id ? vendorIdMap.get(h.to_vendor_id) ?? null : null
    await insert(
      'lead_history',
      ['empresa_id', 'lead_id', 'user_id', 'action', 'from_status', 'to_status', 'from_vendor_id', 'to_vendor_id', 'details', 'created_at'],
      [novaEmpresaId, novoLeadId, novoUserId, h.action, h.from_status, h.to_status, novoFromVendor, novoToVendor, h.details, h.created_at]
    )
    conta('lead_history', 'inseridos')
  }

  // ── 12) Tentativas de contato ──────────────────────────────────────────
  const attemptsSrc = (
    await src.execute('SELECT id, lead_id, user_id, channel, result, next_action_at, created_at FROM lead_contact_attempts')
  ).rows
  for (const c of attemptsSrc) {
    const novoLeadId = leadIdMap.get(c.lead_id)
    const novaEmpresaId = empresaPorOldLeadId.get(c.lead_id)
    if (!novoLeadId || !novaEmpresaId) continue
    if (leadsComTentativas.has(novoLeadId)) { conta('lead_contact_attempts', 'pulados'); continue }
    const autorId = autorFallback(novaEmpresaId, c.user_id)
    if (!autorId) { conta('lead_contact_attempts', 'pulados'); continue }
    await insert(
      'lead_contact_attempts',
      ['lead_id', 'user_id', 'channel', 'result', 'next_action_at', 'created_at'],
      [novoLeadId, autorId, c.channel, c.result, c.next_action_at, c.created_at]
    )
    conta('lead_contact_attempts', 'inseridos')
  }

  // ── 13) Visitantes rastreados ───────────────────────────────────────────
  const visitorsSrc = (
    await src.execute(
      'SELECT id, company_id, visitor_uid, first_seen_at, last_seen_at, lead_id, utm_source, utm_medium, utm_campaign FROM tracking_visitors'
    )
  ).rows
  const visitorIdMap = new Map()
  // Só processa eventos (passo 14) de visitantes inseridos NESTA rodada —
  // visitante já existente de uma rodada anterior teve os eventos dele
  // migrados junto naquela vez (visitante e eventos sempre andam juntos no
  // mesmo passo), então reprocessar de novo só duplicaria. Mesma lógica já
  // usada pra leads/notas/anexos/histórico acima.
  const visitantesNovosDesteRun = new Set()
  for (const v of visitorsSrc) {
    const novaEmpresaId = empresaIdMap.get(v.company_id)
    if (!novaEmpresaId) continue
    const novoLeadId = v.lead_id ? leadIdMap.get(v.lead_id) ?? null : null
    const existente = (
      await dstExec({
        sql: 'SELECT id FROM lead_tracking_visitors WHERE empresa_id = ? AND visitor_uid = ?',
        args: [novaEmpresaId, v.visitor_uid],
      })
    ).rows[0]
    if (existente) {
      visitorIdMap.set(v.id, existente.id)
      conta('lead_tracking_visitors', 'pulados')
      continue
    }
    const novoId = await insert(
      'lead_tracking_visitors',
      ['empresa_id', 'visitor_uid', 'first_seen_at', 'last_seen_at', 'lead_id', 'utm_source', 'utm_medium', 'utm_campaign'],
      [novaEmpresaId, v.visitor_uid, v.first_seen_at, v.last_seen_at, novoLeadId, v.utm_source, v.utm_medium, v.utm_campaign]
    )
    if (novoId) {
      visitorIdMap.set(v.id, novoId)
      visitantesNovosDesteRun.add(v.id)
    }
    conta('lead_tracking_visitors', 'inseridos')
  }

  // ── 14) Eventos de rastreamento ─────────────────────────────────────────
  const eventsSrc = (
    await src.execute(
      'SELECT id, visitor_id, company_id, event_type, page_url, page_title, metadata, created_at FROM tracking_events'
    )
  ).rows
  for (const ev of eventsSrc) {
    const novoVisitorId = visitorIdMap.get(ev.visitor_id)
    const novaEmpresaId = empresaIdMap.get(ev.company_id)
    if (!novoVisitorId || !novaEmpresaId || !visitantesNovosDesteRun.has(ev.visitor_id)) {
      conta('lead_tracking_events', 'pulados')
      continue
    }
    await insert(
      'lead_tracking_events',
      ['visitor_id', 'empresa_id', 'event_type', 'page_url', 'page_title', 'metadata', 'created_at'],
      [novoVisitorId, novaEmpresaId, ev.event_type, ev.page_url, ev.page_title, ev.metadata, ev.created_at]
    )
    conta('lead_tracking_events', 'inseridos')
  }

  // ── Relatório final ──────────────────────────────────────────────────
  console.log('📊 Resumo:')
  for (const [tabela, c] of Object.entries(relatorio.contadores)) {
    console.log(`  ${tabela}: ${c.inseridos} inseridos, ${c.pulados} pulados`)
  }
  if (relatorio.empresasSemMapa.length) {
    console.log('\n⚠️  Empresas sem mapeamento (nada migrado delas):')
    relatorio.empresasSemMapa.forEach((e) => console.log(`  - ${e}`))
  }
  if (relatorio.vendedoresSemCorrespondencia.size) {
    console.log(`\n⚠️  ${relatorio.vendedoresSemCorrespondencia.size} vendedor(es) do sistema antigo sem conta correspondente no Joitec CRM (leads/notas/anexos deles caem no admin da empresa):`)
    for (const [username, info] of relatorio.vendedoresSemCorrespondencia) {
      console.log(`  - ${username} (${info.name})`)
    }
  }
  console.log(APPLY ? '\n✅ Migração aplicada.' : '\n🔎 Dry-run concluído — nada foi gravado. Revise o resumo acima e rode de novo com --apply.')
}

main()
  .catch((err) => {
    console.error('❌ Erro na migração:', err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
