export function renderTemplate(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [chave, valor]) => acc.replaceAll(`{{${chave}}}`, valor), text)
}
