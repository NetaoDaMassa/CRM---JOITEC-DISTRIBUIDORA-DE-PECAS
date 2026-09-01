// Etapa "Cadastro" — sem formulário, só um aviso (mesmo comportamento do
// odincrm original: cadastro não tem dados próprios, é só o ponto de
// partida antes da Liberação Financeira).
export default function EtapaCadastro() {
  return <p className="text-sm text-dark-400 text-center py-6">Pedido registrado. Avance para Liberação Financeira.</p>
}
