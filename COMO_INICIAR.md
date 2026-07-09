# Odin CRM — Como Iniciar

## Pré-requisitos
- Node.js 20+
- Docker Desktop (para o MySQL)
- npm 10+

---

## 1. Instalar dependências

Abra o terminal na pasta do projeto e execute:

```bash
npm install
```

---

## 2. Subir o banco de dados (MySQL via Docker)

```bash
docker-compose up -d
```

Aguarde ~10 segundos para o MySQL inicializar.

---

## 3. Criar as tabelas

```bash
npm run db:generate
npm run db:migrate
```

---

## 4. Popular com dados iniciais

```bash
npm run db:seed
```

Isso vai criar:
- Admin: `admin` / `admin123`
- Vendedor Carlos: `carlos` / `Odin@2024`
- Vendedora Ana: `ana` / `Odin@2024`
- Vendedor Pedro: `pedro` / `Odin@2024`
- 5 regiões (Norte, Nordeste, Centro-Oeste, Sudeste, Sul) com DDDs configurados

---

## 5. Iniciar o sistema

```bash
npm run dev
```

Abre dois servidores:
- **Backend (API):** http://localhost:3001
- **Frontend (CRM):** http://localhost:5173

Acesse: **http://localhost:5173**

---

## Credenciais

| Perfil | Usuário | Senha |
|--------|---------|-------|
| Administrador | admin | admin123 |
| Vendedor | carlos | Odin@2024 |
| Vendedora | ana | Odin@2024 |
| Vendedor | pedro | Odin@2024 |

---

## Funcionalidades principais

### Painel Admin
- **Dashboard** com métricas e rodízio
- **Leads** — lista com filtros, transferência, exclusão, limpeza em massa
- **Kanban** — arrastar e soltar entre status
- **Relatórios** — exportar Excel com filtros
- **Vendedores** — criar, editar, ativar/desativar
- **Regiões & Rodízio** — configurar DDDs e acompanhar próximo vendedor

### Painel Vendedor
- **Meu Painel** — leads, alertas de anexo obrigatório
- **Meus Leads** — lista filtrada
- **Kanban** pessoal
- **Follow-ups** com agendamento de próximo contato

### Funil de status
```
Novo → Abordagem → Qualificado → Em Negociação → Ganho / Perdido / Desqualificado
```

### Rodízio automático
Ao cadastrar um lead, o sistema identifica a região pelo DDD e distribui para o próximo vendedor da fila.

---

## Parar o sistema

```bash
# Parar servidores: Ctrl+C no terminal
# Parar banco:
docker-compose down
```
