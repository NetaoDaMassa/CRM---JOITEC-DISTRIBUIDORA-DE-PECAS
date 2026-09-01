// Mapa etapa → componente, compartilhado entre a aba "Dados da Etapa" (só a
// etapa atual do pedido) e o acordeão de Histórico (qualquer etapa já
// passada, em modo leitura ou edição). Espelha o STAGE_COMPONENTS +
// os 2 casos de "etapa dupla" do odincrm original (ver OrderModal.tsx lá).
import type { Stage, OrderType } from '../../lib/ordensShared'
import EtapaCadastro from './EtapaCadastro'
import EtapaFinanceiro from './EtapaFinanceiro'
import EtapaPedido from './EtapaPedido'
import EtapaFrete from './EtapaFrete'
import EtapaPreparacao from './EtapaPreparacao'
import EtapaFreteFinalizado from './EtapaFreteFinalizado'
import EtapaFaturamento from './EtapaFaturamento'
import EtapaConferencia from './EtapaConferencia'
import EtapaColeta from './EtapaColeta'
import EtapaRastreio from './EtapaRastreio'
import EtapaQualidade from './EtapaQualidade'
import EtapaPosVenda from './EtapaPosVenda'

export type OrdemParaEtapa = {
  id: number
  orderType: string
  status: string
  cancelMotivo?: string | null
  cliente?: {
    razaoSocial?: string | null
    telefoneWhatsapp?: string | null
    email?: string | null
    cnpj?: string | null
    nomeContato?: string | null
    endereco?: string | null
    cidade?: string | null
    estado?: string | null
  } | null
  vendedor?: { whatsapp?: string | null } | null
  updatedAt?: string
}

export function renderEtapa(stage: Stage, ordem: OrdemParaEtapa, isAdmin: boolean, readonly: boolean) {
  const ordemId = ordem.id
  const orderType = ordem.orderType as OrderType
  const clienteNome = ordem.cliente?.razaoSocial
  const clienteWhatsapp = ordem.cliente?.telefoneWhatsapp
  const clienteEmail = ordem.cliente?.email
  const vendedorWhatsapp = ordem.vendedor?.whatsapp

  switch (stage) {
    case 'cadastro':
      return <EtapaCadastro />
    case 'liberacao_financeira':
      return <EtapaFinanceiro ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} cliente={ordem.cliente} />
    case 'pedido':
      return <EtapaPedido ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} />
    case 'cotacao_frete':
      // Máquina: cotação de frete + preparação empilhadas (preparação não é
      // etapa visível pra máquina, é pré-requisito checado no gate seguinte).
      return (
        <div className="space-y-6">
          <EtapaFrete ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} vendedorWhatsapp={vendedorWhatsapp} clienteNome={clienteNome} />
          <div className="border-t border-dark-700 pt-4">
            <p className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-3">Preparação</p>
            <EtapaPreparacao ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} atualizadoEm={ordem.updatedAt} />
          </div>
        </div>
      )
    case 'preparacao':
      // Só existe como etapa visível própria pra peça (máquina trata junto
      // com cotação de frete, ver caso acima).
      return <EtapaPreparacao ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} atualizadoEm={ordem.updatedAt} />
    case 'frete_finalizado':
      if (orderType === 'peca') {
        // Peça não tem "cotacao_frete" separada — escolhe o frete e já
        // finaliza tudo nesta única etapa.
        return (
          <div className="space-y-6">
            <EtapaFrete ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} vendedorWhatsapp={vendedorWhatsapp} clienteNome={clienteNome} />
            <EtapaFreteFinalizado ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} />
          </div>
        )
      }
      return <EtapaFreteFinalizado ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} />
    case 'faturamento':
      return <EtapaFaturamento ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} />
    case 'conferencia':
      return <EtapaConferencia ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} />
    case 'coleta':
      return <EtapaColeta ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} />
    case 'rastreio':
      return <EtapaRastreio ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} clienteNome={clienteNome} clienteWhatsapp={clienteWhatsapp} clienteEmail={clienteEmail} vendedorWhatsapp={vendedorWhatsapp} />
    case 'qualidade':
      return <EtapaQualidade ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} clienteNome={clienteNome} clienteEmail={clienteEmail} />
    case 'concluido':
      return <p className="text-sm text-dark-400 text-center py-6">✅ Venda concluída! Avance para registrar o Feedback/Finalizado.</p>
    case 'pos_venda':
      return <EtapaPosVenda ordemId={ordemId} isAdmin={isAdmin} readonly={readonly} orderType={orderType} clienteNome={clienteNome} clienteWhatsapp={clienteWhatsapp} />
    default:
      return null
  }
}
