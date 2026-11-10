// Tipos de erro da Expedição. Os de "embalagem e despacho" contam para quem
// embalou e podem ser anotados até depois da coleta (João, 2026-11-10: "um
// volume foi e um ficou para trás", "não viram na NF que era Correios").
export const TIPOS_ERRO_ITEM = [
  { value: 'faltou', label: 'Faltou item' },
  { value: 'sobrou', label: 'Item a mais' },
  { value: 'trocado', label: 'Item trocado' },
  { value: 'quantidade', label: 'Quantidade errada' },
  { value: 'avaria', label: 'Avaria' },
  { value: 'outro', label: 'Outro' },
] as const

export const TIPOS_ERRO_EMBALAGEM = [
  { value: 'volume_ficou', label: 'Volume ficou para trás' },
  { value: 'envio_errado', label: 'Despachou pelo transporte errado (ex.: era Correios)' },
  { value: 'nao_despachado', label: 'Pedido não foi despachado' },
  { value: 'etiqueta_errada', label: 'Etiqueta / volume trocado' },
  { value: 'embalagem_mal_feita', label: 'Embalagem mal feita (chegou avariado)' },
] as const

export const TIPOS_ERRO = [...TIPOS_ERRO_ITEM, ...TIPOS_ERRO_EMBALAGEM]
export type TipoErro = (typeof TIPOS_ERRO)[number]['value']
export const labelTipoErro = (t: string) => TIPOS_ERRO.find((x) => x.value === t)?.label ?? t
export const ehErroDeEmbalagem = (t: string) => TIPOS_ERRO_EMBALAGEM.some((x) => x.value === t)
