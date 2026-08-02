# CRM Joitec — Como Iniciar (desenvolvimento local)

O banco é **SQLite** (arquivo local), então **não precisa de Docker nem MySQL** para
rodar em desenvolvimento. Para subir na VPS, veja o **[DEPLOY.md](./DEPLOY.md)**.

## Pré-requisitos
- Node.js 20+
- npm 10+

---

## 1. Instalar dependências

Na raiz do projeto:

```bash
npm install
```

---

## 2. Configurar o `.env` do backend

```bash
cp server/.env.example server/.env
```

Abra `server/.env` e defina um `JWT_SECRET` qualquer (em dev pode ser simples). O
`DATABASE_URL` padrão (`file:./joitec_crm.db`) já cria o banco na pasta `server/`.

---

## 3. Criar as tabelas (migrações)

```bash
npm run db:migrate
```

> As migrações também rodam sozinhas ao iniciar o backend; este passo é para já ter
> as tabelas antes do seed.

---

## 4. Popular com dados iniciais

```bash
npm run db:seed
```

Cria a empresa **Joitec Distribuidora de Peças**, o admin e os vendedores (cada um
com sua região fixa — modelo de **carteira fixa**, sem rodízio).

---

## 5. Iniciar o sistema

```bash
npm run dev
```

Sobe os dois servidores em paralelo:
- **Backend (API):** http://localhost:3001
- **Frontend (CRM):** http://localhost:5173

Acesse: **http://localhost:5173**

---

## Credenciais (desenvolvimento)

Todas as senhas do seed são `Joitec@2026` (troque em produção).

| Perfil | Usuário | Senha |
|--------|---------|-------|
| Administrador | `admin` | `Joitec@2026` |
| Vendedores | `guilherme`, `camila`, `antonio`, `douglas`, `claudia`, `gino`, `enzo`, `sarah`, `gustavo`, `kati`, `yuri`, `caio`, `jean`, `sergio` | `Joitec@2026` |

---

## Funcionalidades principais

### Painel Admin
- **Dashboard** com métricas
- **Leads** — lista com filtros, transferência, exclusão, limpeza em massa
- **Kanban** — arrastar e soltar entre status
- **Relatórios** — exportar Excel com filtros
- **Vendedores** — criar, editar, ativar/desativar
- **Multi-empresa** — separação de dados por empresa

### Painel Vendedor
- **Meu Painel** — leads da carteira, alertas de anexo obrigatório
- **Meus Leads** — lista filtrada
- **Kanban** pessoal
- **Follow-ups** com agendamento de próximo contato

### Funil de status
```
Novo → Abordagem → Qualificado → Em Negociação → Ganho / Perdido / Desqualificado
```

### Carteira fixa por região
Cada vendedor atende uma **região fixa** — os leads são atribuídos conforme a região,
sem rodízio round-robin.

---

## Parar o sistema

Pressione **Ctrl+C** no terminal onde o `npm run dev` está rodando.
