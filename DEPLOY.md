# Deploy na Hostinger (VPS) — CRM Joitec (Node)

Guia para subir o **CRM Joitec** (Node + SQLite) num VPS Hostinger usando Docker
Compose, **convivendo com os projetos que já rodam** no mesmo servidor:
`projeto-leads` (Python) e o **Odin CRM** (Node).

## Como os três projetos convivem

O `projeto-leads` já roda um **Caddy** que ocupa as portas **80 e 443** e emite o
HTTPS automático. Só um serviço pode usar essas portas, então o CRM Joitec **não
sobe um Caddy próprio**: ele se conecta ao Caddy que já existe através de uma rede
Docker compartilhada (`web`) — a mesma que o Odin CRM já usa — e o Caddy passa a
servir mais um domínio.

```
                    ┌──────────────────── VPS ────────────────────┐
   Internet  ──►  Caddy (80/443, do projeto-leads)
                    │      ├─ dominio-antigo         → frontend (projeto-leads)
                    │      ├─ grupoodin-crm...       → crm-frontend    ─► backend (Odin)
                    │      └─ joitec-crm.duckdns.org → joitec-frontend ─► backend (Joitec)
                    └──────────────────────────────────────────────┘
```

- **Backend** (Node/Express/tRPC): SQLite em volume, uploads em volume, porta interna 3001.
- **Frontend** (nginx): serve o React e faz proxy de `/trpc`, `/upload` e `/uploads` para o backend.
- **Banco**: SQLite em arquivo, no volume `joitec-crm_db_data` (não some em redeploy).

> **Isolamento do Odin:** o `docker-compose.yml` fixa `name: joitec-crm`, então os
> containers, volumes e a rede interna ficam com prefixo `joitec-crm_*` e o alias de
> rede é `joitec-frontend`. Nada colide com o Odin CRM (que usa `crm-frontend`).

---

## Pré-requisitos

VPS Hostinger com Ubuntu e Docker já instalado (o `projeto-leads` e o Odin já
usam). Se precisar: `curl -fsSL https://get.docker.com | sh`.

---

## 1. Preparar o domínio DuckDNS

1. Em https://www.duckdns.org, crie o subdomínio **`joitec-crm`**.
2. No campo **current ip** aponte para o **IP do seu VPS** e salve.
   (Resultado: `joitec-crm.duckdns.org` → IP do VPS.)

> O Let's Encrypt trata cada subdomínio `*.duckdns.org` como domínio próprio,
> então o HTTPS funciona normalmente para o Joitec junto com o Odin.

---

## 2. Garantir a rede compartilhada (uma única vez no VPS)

A rede `web` provavelmente já existe (o Odin CRM a usa). Se não existir:

```bash
docker network create web
```

Se já existir, o comando só avisa — pode ignorar.

---

## 3. Enviar o código e configurar o `.env`

Clone numa pasta **própria** (separada do Odin), ex.: `joitec-crm`:

```bash
git clone https://github.com/NetaoDaMassa/CRM---JOITEC-DISTRIBUIDORA-DE-PECAS.git joitec-crm
cd joitec-crm
cp .env.example .env
nano .env
```

Preencha:
- `JWT_SECRET` — gere com `openssl rand -hex 32` (use um **diferente** do Odin).
- `CLIENT_URL` — `https://joitec-crm.duckdns.org` (com `https://`, sem barra final).
- `ANTHROPIC_API_KEY` — opcional (só para a extração de itens do PDF via IA).

---

## 4. Subir o CRM Joitec

```bash
docker compose up -d --build
```

Isso sobe `backend` + `frontend`. As **migrações do banco rodam sozinhas** na
inicialização do backend (não precisa de comando manual). O frontend entra na rede
`web` com o alias **`joitec-frontend`**, que o Caddy vai usar no próximo passo.

Confira que subiu:

```bash
docker compose ps
docker compose logs -f backend   # deve mostrar as migrações aplicadas e o 🚀
```

---

## 5. Conectar o Caddy do projeto-leads ao CRM Joitec

Faça isso **na pasta do projeto-leads** no VPS (ex.: `cd ~/projeto-leads`).

O Caddy provavelmente **já está na rede `web`** (por causa do Odin). Se estiver,
pule direto para o **5b**. Caso contrário, faça o 5a primeiro.

### 5a. (Só se ainda não estiver) Colocar o Caddy na rede `web`

Edite o `docker-compose.yml` do **projeto-leads**, no serviço `caddy`, adicione a
rede `web` e declare-a como externa:

```yaml
  caddy:
    image: caddy:2-alpine
    # ... (resto igual) ...
    networks:
      - default
      - web

# no final do arquivo, junto do bloco "volumes:", adicione:
networks:
  web:
    external: true
```

### 5b. Adicionar o domínio do Joitec ao Caddyfile

No `Caddyfile` do **projeto-leads**, adicione ao final (junto do bloco do Odin):

```caddy
joitec-crm.duckdns.org {
	encode gzip
	reverse_proxy joitec-frontend:80
}
```

### 5c. Aplicar

```bash
docker compose up -d          # recria o Caddy já enxergando o joitec-frontend
docker compose logs -f caddy  # aguarde "certificate obtained successfully"
```

No primeiro acesso a `https://joitec-crm.duckdns.org` o Caddy emite o certificado
automaticamente.

---

## 6. Popular o banco (apenas na primeira vez)

Cria usuários, empresas e dados iniciais:

```bash
# na pasta do CRM Joitec
docker compose exec backend node dist/db/seed.js
```

> **Troque as senhas** logo após o primeiro acesso.

---

## Deploy automatizado (GitHub Actions)

O repositório tem um workflow em `.github/workflows/deploy.yml` que atualiza a VPS
por SSH. Ele é **disparado manualmente** (aba **Actions → Deploy CRM Joitec → Run
workflow**).

Configure uma vez os **Secrets** do repositório
(**Settings → Secrets and variables → Actions**):

| Secret | Valor |
|--------|-------|
| `VPS_HOST` | IP do VPS |
| `VPS_USER` | usuário SSH (ex.: `root`) |
| `VPS_SSH_KEY` | chave **privada** SSH com acesso ao VPS |
| `VPS_PROJECT_PATH` | caminho da pasta do Joitec no VPS (ex.: `/root/joitec-crm`) |

Ao rodar, o workflow faz na VPS: `git pull` → `docker compose up -d --build` →
`docker image prune -f`. As migrações novas rodam sozinhas na subida; banco e
uploads persistem nos volumes.

### Atualizar manualmente (alternativa, direto no VPS)

```bash
cd joitec-crm
git pull
docker compose up -d --build
```

---

## Persistência e backup

- **Banco**: volume `joitec-crm_db_data` (arquivo SQLite em `/app/data/joitec_crm.db`).
- **Uploads**: volume `joitec-crm_uploads` (`/app/uploads`).

Backup do banco:

```bash
docker compose cp backend:/app/data/joitec_crm.db ./backup_$(date +%F).db
```

---

## Comandos úteis

```bash
docker compose logs -f             # logs de tudo
docker compose logs -f backend     # só o backend
docker compose restart backend     # reiniciar um serviço
docker compose down                # parar o CRM (dados persistem nos volumes)
docker compose up -d --build       # subir/redeploy
```

## Solução de problemas

- **502 no navegador** — o Caddy não achou `joitec-frontend`. Confirme que o CRM
  está no ar (`docker compose ps`) e que o Caddy foi recriado após o passo 5.
- **Certificado não emite** — verifique se o DuckDNS aponta para o IP do VPS e se as
  portas 80/443 estão liberadas no firewall.
- **`network web not found`** — rode `docker network create web` (passo 2).
- **Conflito com o Odin** — confirme que o Joitec foi clonado numa pasta separada e
  que o `docker-compose.yml` tem `name: joitec-crm` no topo (isola volumes/rede).
