// Correção ÚNICA (João, 2026-11-25) — SÓ ODIN COMPRESSORES: até hoje,
// desqualificar um lead passava o lead pro "primeiro admin" da empresa (o
// Roberto). Lá a regra mudou: o lead fica com quem desqualificou. Este script
// desfaz o passado:
//
//  - lead cujo dono ATUAL é um admin e cuja última desqualificação foi feita
//    por OUTRA pessoa → volta pra quem desqualificou;
//  - pula o lead se, depois dessa desqualificação, alguém transferiu ele de
//    propósito (há evento de transferência/reatribuição) — não desfaz decisão
//    manual;
//  - vale também pra lead que já saiu de Desqualificado (ex.: voltou pra Em
//    Negociação ainda no nome do admin);
//  - proposta criada a partir desse lead DEPOIS da desqualificação, que nasceu
//    no nome do mesmo admin, vai junto pra quem desqualificou.
//
// Registra no histórico do lead e no log de auditoria da proposta.
// Sem --aplicar só mostra o que faria (não grava nada).
//
// Rodar na VPS:
//   docker compose run --rm --no-deps -T backend node dist/scripts/devolverDesqualificadosAoDono.js
//   docker compose run --rm --no-deps -T backend node dist/scripts/devolverDesqualificadosAoDono.js --aplicar

import { config } from 'dotenv'
config()

import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'

const APLICAR = process.argv.includes('--aplicar')

type Linha = {
  lead_id: number
  lead_nome: string
  empresa_id: number
  status: string
  vendor_id: number
  admin_nome: string
  desq_por: number
  desq_por_nome: string
  desq_em: string
  proposta_id: number | null
  proposta_vendedor: number | null
  proposta_criada: string | null
}

async function main() {
  const linhas = (await db.all(sql`
    WITH ultima_desq AS (
      SELECT h.lead_id, h.user_id, h.created_at,
             ROW_NUMBER() OVER (PARTITION BY h.lead_id ORDER BY h.id DESC) rn, h.id hid
      FROM lead_history h
      WHERE h.to_status = 'desqualificado' AND h.action = 'status_alterado' AND h.user_id IS NOT NULL
    )
    SELECT l.id lead_id, l.name lead_nome, l.empresa_id, l.status, l.vendor_id,
           ua.name admin_nome, d.user_id desq_por, ud.name desq_por_nome, d.created_at desq_em,
           p.id proposta_id, p.vendedor_id proposta_vendedor, p.created_at proposta_criada
    FROM leads l
    JOIN users ua ON ua.id = l.vendor_id AND ua.role = 'admin'
    JOIN ultima_desq d ON d.lead_id = l.id AND d.rn = 1
    JOIN users ud ON ud.id = d.user_id AND ud.is_active = 1 AND ud.empresa_id = l.empresa_id
    LEFT JOIN propostas p ON p.id = l.convertido_para_proposta_id
    WHERE l.deleted_at IS NULL
      AND l.empresa_id = (SELECT id FROM empresas WHERE slug = 'odin-compressores')
      AND d.user_id <> l.vendor_id
      AND NOT EXISTS (
        SELECT 1 FROM lead_history t
        WHERE t.lead_id = l.id AND t.id > d.hid
          AND (t.to_vendor_id IS NOT NULL OR t.action IN ('transferido', 'reatribuicao_automatica', 'reaberto_desqualificado'))
      )
    ORDER BY l.empresa_id, d.user_id, l.id
  `)) as Linha[]

  const resumo = new Map<string, number>()
  let propostas = 0
  for (const r of linhas) {
    const k = `empresa ${r.empresa_id}: ${r.admin_nome} → ${r.desq_por_nome}`
    resumo.set(k, (resumo.get(k) ?? 0) + 1)
    const levaProposta = r.proposta_id != null && r.proposta_vendedor === r.vendor_id && r.proposta_criada! >= r.desq_em
    if (levaProposta) propostas++
    if (r.status !== 'desqualificado' || levaProposta) {
      console.log(`  lead #${r.lead_id} ${r.lead_nome} [${r.status}] ${r.admin_nome} → ${r.desq_por_nome}${levaProposta ? ` + proposta #${r.proposta_id}` : ''}`)
    }

    if (!APLICAR) continue
    await db.run(sql`UPDATE leads SET vendor_id = ${r.desq_por}, updated_at = datetime('now') WHERE id = ${r.lead_id} AND vendor_id = ${r.vendor_id}`)
    await db.run(sql`
      INSERT INTO lead_history (empresa_id, lead_id, user_id, action, from_vendor_id, to_vendor_id, details)
      VALUES (${r.empresa_id}, ${r.lead_id}, NULL, 'transferido', ${r.vendor_id}, ${r.desq_por},
              ${`Correção 25/11: lead desqualificado tinha ido pro admin (${r.admin_nome}); volta pra quem desqualificou (${r.desq_por_nome})`})
    `)
    if (levaProposta) {
      await db.run(sql`UPDATE propostas SET vendedor_id = ${r.desq_por}, updated_at = datetime('now') WHERE id = ${r.proposta_id} AND vendedor_id = ${r.vendor_id}`)
      await db.run(sql`
        INSERT INTO log_auditoria (tabela, registro_id, acao, campo, valor_anterior, valor_novo, alterado_por)
        VALUES ('propostas', ${r.proposta_id}, 'editar', 'vendedor_id', ${String(r.vendor_id)}, ${String(r.desq_por)}, NULL)
      `)
    }
  }

  console.log('\nResumo:')
  for (const [k, n] of resumo) console.log(`  ${k}: ${n} lead(s)`)
  console.log(`  propostas que vão junto: ${propostas}`)
  console.log(APLICAR ? '\nAPLICADO.' : '\nSó simulação — nada foi gravado. Rode com --aplicar pra gravar.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
