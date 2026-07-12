# Deploy na Hostinger (VPS) — Odin CRM (Node)

Guia para subir o **Odin CRM** (Node + SQLite) num VPS Hostinger usando Docker
Compose, **convivendo com o projeto antigo** (`projeto-leads`, em Python) no mesmo
servidor.

## Como os dois projetos convivem

O `projeto-leads` já roda um **Caddy** que ocupa as portas **80 e 443** e emite o
HTTPS automático. Só um serviço pode usar essas portas, então o CRM **não sobe um
Caddy próprio**: ele se conecta ao Caddy que já existe através de uma rede Docker
compartilhada (`web`), e o Caddy passa a servir os dois domínios.

```
                    ┌──────────────── VPS ────────────────┐
   Internet  ──►  Caddy (80/443, do projeto-leads)
                    │      ├─ dominio-antigo   → frontend (projeto-leads)
                    │      └─ crm.duckdns.org  → crm-frontend ─► backend (CRM)
                    └──────────────────────────────────────┘
```

- **Backend** (Node/Express/tRPC): SQLite em volume, uploads em volume, porta interna 3001.
- **Frontend** (nginx): serve o React e faz proxy de `/trpc`, `/upload` e `/uploads` para o backend.
- **Banco**: SQLite em arquivo, no volume `db_data` (não some em redeploy).

---

## Pré-requisitos

VPS Hostinger com Ubuntu e Docker já instalado (o `projeto-leads` já usa). Se
precisar: `curl -fsSL https://get.docker.com | sh`.

---

## 1. Preparar o domínio DuckDNS

1. Em https://www.duckdns.org, crie um subdomínio (ex.: `grupoodin-crm`).
2. No campo **current ip** aponte para o **IP do seu VPS** e salve.
   (Resultado: `grupoodin-crm.duckdns.org` → IP do VPS.)

> O Let's Encrypt trata cada subdomínio `*.duckdns.org` como domínio próprio,
> então o HTTPS funciona normalmente.

---

## 2. Criar a rede compartilhada (uma única vez no VPS)

```bash
docker network create web
```

Se já existir de uma configuração anterior, o comando só avisa — pode ignorar.

---

## 3. Enviar o código e configurar o `.env`

```bash
git clone https://github.com/NetaoDaMassa/CRM-GRUPO-ODIN.git crm-odin
cd crm-odin
cp .env.example .env
nano .env
```

Preencha:
- `JWT_SECRET` — gere com `openssl rand -hex 32`.
- `CLIENT_URL` — o domínio DuckDNS com `https://` e sem barra final,
  ex.: `https://grupoodin-crm.duckdns.org`.

---

## 4. Subir o CRM

```bash
docker compose up -d --build
```

Isso sobe `backend` + `frontend`. As **migrações do banco rodam sozinhas** na
inicialização do backend (não precisa de comando manual). O frontend entra na rede
`web` com o nome **`crm-frontend`**, que o Caddy vai usar no próximo passo.

Confira que subiu:

```bash
docker compose ps
docker compose logs -f backend   # deve mostrar "[db] migrações aplicadas" e o 🚀
```

---

## 5. Conectar o Caddy do projeto-leads ao CRM

Faça isso **na pasta do projeto-leads** no VPS (ex.: `cd ~/projeto-leads`).

### 5a. Colocar o Caddy na rede `web`

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

### 5b. Adicionar o domínio do CRM ao Caddyfile

No `Caddyfile` do **projeto-leads**, adicione ao final (troque pelo seu domínio):

```caddy
grupoodin-crm.duckdns.org {
	encode gzip
	reverse_proxy crm-frontend:80
}
```

### 5c. Aplicar

```bash
docker compose up -d          # recria o Caddy já conectado à rede web
docker compose logs -f caddy  # aguarde "certificate obtained successfully"
```

No primeiro acesso a `https://grupoodin-crm.duckdns.org` o Caddy emite o
certificado automaticamente.

---

## 6. Popular o banco (apenas na primeira vez)

Cria usuários, regiões (DDDs) e templates iniciais:

```bash
# na pasta do CRM
docker compose exec backend node dist/db/seed.js
```

Credenciais iniciais (**troque as senhas após o primeiro acesso**):

| Perfil | Usuário | Senha |
|--------|---------|-------|
| Administrador | admin | admin123 |
| Vendedor | carlos / ana / pedro | Odin@2024 |

---

## Atualizar a aplicação (redeploy)

```bash
cd crm-odin
git pull
docker compose up -d --build
```

As migrações novas rodam sozinhas na subida. O banco e os uploads persistem nos volumes.

---

## Persistência e backup

- **Banco**: volume `db_data` (arquivo SQLite em `/app/data/odin_crm.db`).
- **Uploads**: volume `uploads` (`/app/uploads`).

Backup do banco:

```bash
docker compose cp backend:/app/data/odin_crm.db ./backup_$(date +%F).db
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

- **502 no navegador** — o Caddy não achou `crm-frontend`. Confirme que o CRM está
  no ar (`docker compose ps`) e que o Caddy foi recriado após entrar na rede `web`
  (passo 5c).
- **Certificado não emite** — verifique se o DuckDNS aponta para o IP do VPS e se as
  portas 80/443 estão liberadas no firewall.
- **`network web not found`** — rode `docker network create web` (passo 2).
