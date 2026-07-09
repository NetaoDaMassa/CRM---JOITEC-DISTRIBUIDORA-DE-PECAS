export function renderTemplate(text: string, vars: { nome: string }): string {
  return text.replaceAll('{{nome}}', vars.nome)
}
