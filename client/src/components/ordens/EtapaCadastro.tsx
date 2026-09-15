// Etapa "Cadastro" — ponto de partida antes da Liberação Financeira. Não
// tem dados próprios da ordem, mas o João pediu (2026-09-02) pra poder
// corrigir o cadastro do cliente aqui mesmo, sem precisar sair do pedido
// e ir até a tela de Clientes — dados chegam errados às vezes na conversão
// da proposta.
//
// Extensão 2026-09-15 (pedido do João): cadastro completo, com endereço
// estruturado (número/complemento/bairro/CEP) e inscrição estadual — antes
// só tinha um "Endereço" solto sem os demais campos, e o pedido tinha que
// nascer com a informação incompleta.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input } from '../ui/Input'

type Cliente = {
  id: number
  versao: number
  razaoSocial?: string | null
  cnpj?: string | null
  cpf?: string | null
  inscricaoEstadual?: string | null
  telefoneWhatsapp?: string | null
  email?: string | null
  nomeContato?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
} | null | undefined

export default function EtapaCadastro({ cliente, isAdmin, readonly }: { cliente: Cliente; isAdmin: boolean; readonly: boolean }) {
  const utils = trpc.useUtils()
  const [editando, setEditando] = useState(false)
  const [razaoSocial, setRazaoSocial] = useState(cliente?.razaoSocial ?? '')
  const [cnpj, setCnpj] = useState(cliente?.cnpj ?? '')
  const [cpf, setCpf] = useState(cliente?.cpf ?? '')
  const [inscricaoEstadual, setInscricaoEstadual] = useState(cliente?.inscricaoEstadual ?? '')
  const [telefone, setTelefone] = useState(cliente?.telefoneWhatsapp ?? '')
  const [email, setEmail] = useState(cliente?.email ?? '')
  const [nomeContato, setNomeContato] = useState(cliente?.nomeContato ?? '')
  const [endereco, setEndereco] = useState(cliente?.endereco ?? '')
  const [numero, setNumero] = useState(cliente?.numero ?? '')
  const [complemento, setComplemento] = useState(cliente?.complemento ?? '')
  const [bairro, setBairro] = useState(cliente?.bairro ?? '')
  const [cidade, setCidade] = useState(cliente?.cidade ?? '')
  const [estado, setEstado] = useState(cliente?.estado ?? '')
  const [cep, setCep] = useState(cliente?.cep ?? '')
  const podeEditar = isAdmin && !readonly

  const salvarMut = trpc.clientes.update.useMutation({
    onSuccess() {
      toast.success('Cliente atualizado')
      utils.ordens.core.obterPorId.invalidate()
      setEditando(false)
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function abrirEdicao() {
    setRazaoSocial(cliente?.razaoSocial ?? '')
    setCnpj(cliente?.cnpj ?? '')
    setCpf(cliente?.cpf ?? '')
    setInscricaoEstadual(cliente?.inscricaoEstadual ?? '')
    setTelefone(cliente?.telefoneWhatsapp ?? '')
    setEmail(cliente?.email ?? '')
    setNomeContato(cliente?.nomeContato ?? '')
    setEndereco(cliente?.endereco ?? '')
    setNumero(cliente?.numero ?? '')
    setComplemento(cliente?.complemento ?? '')
    setBairro(cliente?.bairro ?? '')
    setCidade(cliente?.cidade ?? '')
    setEstado(cliente?.estado ?? '')
    setCep(cliente?.cep ?? '')
    setEditando(true)
  }

  function salvar() {
    if (!cliente) return
    salvarMut.mutate({
      id: cliente.id,
      versao: cliente.versao,
      razaoSocial: razaoSocial || undefined,
      cnpj: cnpj || undefined,
      cpf: cpf || undefined,
      inscricaoEstadual: inscricaoEstadual || undefined,
      telefoneWhatsapp: telefone || undefined,
      email: email || undefined,
      nomeContato: nomeContato || undefined,
      endereco: endereco || undefined,
      numero: numero || undefined,
      complemento: complemento || undefined,
      bairro: bairro || undefined,
      cidade: cidade || undefined,
      estado: estado || undefined,
      cep: cep || undefined,
    })
  }

  if (!editando) {
    const enderecoCompleto = [
      cliente?.endereco,
      cliente?.numero,
      cliente?.complemento,
      cliente?.bairro ? `- ${cliente.bairro}` : null,
      cliente?.cidade,
      cliente?.estado,
      cliente?.cep,
    ]
      .filter(Boolean)
      .join(', ')

    return (
      <div className="space-y-4">
        <p className="text-sm text-dark-400 text-center py-4">Pedido registrado. Avance para Liberação Financeira.</p>
        {cliente && (
          <div className="bg-dark-900/60 border border-dark-700 rounded-xl p-4 space-y-1 text-sm">
            <p className="text-dark-100 font-medium">{cliente.razaoSocial}</p>
            {cliente.cnpj && <p className="text-dark-400 text-xs">CNPJ: {cliente.cnpj}</p>}
            {cliente.cpf && <p className="text-dark-400 text-xs">CPF: {cliente.cpf}</p>}
            {cliente.inscricaoEstadual && <p className="text-dark-400 text-xs">Inscrição Estadual: {cliente.inscricaoEstadual}</p>}
            {cliente.nomeContato && <p className="text-dark-400 text-xs">Contato: {cliente.nomeContato}</p>}
            {cliente.telefoneWhatsapp && <p className="text-dark-400 text-xs">Telefone: {cliente.telefoneWhatsapp}</p>}
            {cliente.email && <p className="text-dark-400 text-xs">E-mail: {cliente.email}</p>}
            {enderecoCompleto && <p className="text-dark-400 text-xs">Endereço: {enderecoCompleto}</p>}
          </div>
        )}
        {podeEditar && cliente && (
          <div className="text-center">
            <Button variant="secondary" size="sm" onClick={abrirEdicao}>Editar cliente</Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Input label="Razão social" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
        <Input label="CPF" value={cpf} onChange={(e) => setCpf(e.target.value)} />
        <Input label="Inscrição Estadual" value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)} />
        <Input label="Nome do contato" value={nomeContato} onChange={(e) => setNomeContato(e.target.value)} />
        <Input label="Telefone/WhatsApp" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        <Input label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <Input label="Endereço" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
        <Input label="Número" value={numero} onChange={(e) => setNumero(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Complemento" value={complemento} onChange={(e) => setComplemento(e.target.value)} />
        <Input label="Bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_1fr_100px] gap-3">
        <Input label="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
        <Input label="Estado (UF)" value={estado} onChange={(e) => setEstado(e.target.value)} maxLength={2} />
        <Input label="CEP" value={cep} onChange={(e) => setCep(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={() => setEditando(false)}>Cancelar</Button>
        <Button size="sm" loading={salvarMut.isPending} onClick={salvar}>Salvar</Button>
      </div>
    </div>
  )
}
