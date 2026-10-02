// Avatar simples com foto (users.fotoUrl) ou iniciais, bolinha de
// online/offline opcional. Usado em toda tela de chat — lista de
// conversas, mensagens, seletor de pessoa. Pedido do João, 2026-10-02.
export default function Avatar({
  nome,
  fotoUrl,
  online,
  size = 'md',
}: {
  nome: string
  fotoUrl?: string | null
  online?: boolean
  size?: 'xs' | 'sm' | 'md'
}) {
  const dimensao = size === 'xs' ? 'w-6 h-6 text-[10px]' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  const bolinha = size === 'xs' ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5'

  return (
    <div className="relative shrink-0">
      <div className={`${dimensao} rounded-full bg-dark-700 text-dark-300 flex items-center justify-center font-bold overflow-hidden`}>
        {fotoUrl ? <img src={fotoUrl} alt={nome} className="w-full h-full object-cover" /> : nome.charAt(0).toUpperCase()}
      </div>
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 ${bolinha} rounded-full border-2 border-dark-800 ${online ? 'bg-green-500' : 'bg-dark-600'}`}
        />
      )}
    </div>
  )
}
