// DANFE (PDF) e XML da NF-e de saída, direto do SAP (João, 2026-11-09).
// O TaxPlus anexa os dois arquivos na aba Anexos da nota depois da
// autorização (Parâmetros Gerais → Outros (6) → "Importar XML autorizado na
// aba anexo" e "Importar DANFe na aba anexo", marcados em todas as empresas
// em 09/11/2026). Notas emitidas antes disso não têm anexo — o CRM avisa.
// Só leitura: GET da nota, do anexo e do arquivo.
import { comSessaoSap } from './sapServiceLayer.js'

// Filial (BPL_ID) do SAP por empresa do CRM.
export const FILIAL_SAP_POR_SLUG: Record<string, number> = { 'odin-compressores': 1, joitec: 3, 'odin-tubos': 4 }

export type ArquivoNota = { dados: Buffer; nome: string; tipo: string }

export async function baixarArquivoNotaSap(filial: number, nfNumero: string, formato: 'pdf' | 'xml'): Promise<ArquivoNota | { erro: string }> {
  const numero = Number(nfNumero)
  if (!Number.isInteger(numero) || numero <= 0) return { erro: 'Número da NF inválido' }
  return comSessaoSap(async (sap) => {
    const { value: notas } = await sap.get<{ value: { DocEntry: number; AttachmentEntry: number | null }[] }>(
      `/Invoices?$filter=SequenceSerial eq ${numero} and BPL_IDAssignedToInvoice eq ${filial} and Cancelled eq 'tNO'&$select=DocEntry,AttachmentEntry&$orderby=DocEntry desc&$top=1`
    )
    const nota = notas[0]
    if (!nota) return { erro: `NF ${numero} não encontrada no SAP` }
    if (!nota.AttachmentEntry) return { erro: `A NF ${numero} não tem o DANFE/XML anexado no SAP (as notas emitidas antes do ajuste no SAP, em 09/11/2026, ficaram sem anexo)` }
    const anexo = await sap.get<{ Attachments2_Lines?: { FileName: string; FileExtension: string }[] }>(`/Attachments2(${nota.AttachmentEntry})`)
    const linhas = (anexo.Attachments2_Lines ?? []).filter((l) => l.FileExtension?.toLowerCase() === formato)
    // XML: prefere o procNFe (nota + protocolo de autorização).
    const linha = linhas.find((l) => /^procnfe/i.test(l.FileName)) ?? linhas[0]
    if (!linha) return { erro: `A NF ${numero} não tem ${formato === 'pdf' ? 'o DANFE (PDF)' : 'o XML'} anexado no SAP` }
    const nomeArquivo = `${linha.FileName}.${linha.FileExtension}`
    const { dados } = await sap.getArquivo(`/Attachments2(${nota.AttachmentEntry})/$value?filename='${encodeURIComponent(nomeArquivo)}'`)
    if (!dados.length) return { erro: 'O SAP devolveu o arquivo vazio' }
    return {
      dados,
      nome: `${formato === 'pdf' ? 'DANFE' : 'XML'} NF ${numero}.${formato}`,
      tipo: formato === 'pdf' ? 'application/pdf' : 'application/xml',
    }
  })
}
