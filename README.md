# Painel PCM — CRV Industrial

Painel de acompanhamento de O.S. (Ordens de Serviço) abertas: classificação automática de
problema, reincidência, retrabalho por frota, SLA de retorno, alocação de frota, cobrança de
reincidência (WhatsApp/e-mail) e painel de TV rotativo.

Reescrita como app real (back-end Flask + Postgres) de um Claude Artifact HTML single-file.
As O.S. e a frota vêm **ao vivo** do MySQL da empresa (`vw_ordem_servico_frota` /
`vw_bi_fluxo_dFrota`, `id_empresa=8`) via botão "Atualizar agora" — não depende mais de
exportar planilha do CHBWEB. Back-end Flask + SQLAlchemy. Usa SQLite localmente e Postgres
(Supabase) em produção. Sem login.

## Rodar local

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env    # preencha MARIADB_USER/MARIADB_PASS
python app.py              # http://localhost:5003
```

O SQLite local (`painel_pcm.db`) é criado automaticamente na primeira execução. Sem
`DATABASE_URL` definido, o app sempre usa SQLite — não precisa de Supabase pra desenvolver.

## Deploy (Render + Supabase)

1. Crie um projeto no [Supabase](https://supabase.com).
2. Copie a connection string do **Connection Pooling** (Settings → Database → Connection
   pooling, modo "Session", porta 5432) — não a conexão direta (`db.xxx.supabase.co`), que é
   IPv6-only e falha em redes sem IPv6. Formato:
   ```
   postgresql://postgres.<project-ref>:[SENHA]@aws-0-<região>.pooler.supabase.com:5432/postgres
   ```
   Se a senha tiver caracteres especiais (`@`, `#` etc.), faça o URL-encode (ex.: `@` → `%40`).
3. Crie um Web Service no [Render](https://render.com) apontando para este repositório (ele
   detecta o `render.yaml`).
4. Preencha no Render as env vars marcadas como `sync: false` (não vêm do `render.yaml`):
   - `DATABASE_URL` — a connection string do Supabase acima.
   - `MARIADB_HOST`, `MARIADB_USER`, `MARIADB_PASS`, `MARIADB_DB` — acesso ao MySQL da empresa
     (mesmo banco usado pelo [bot do WhatsApp PCM] e pelo Controle PCM, host
     `rdscontroladoria-read.grupojapungu.com`, somente leitura).
5. `SECRET_KEY` é gerada automaticamente pelo Render (`generateValue: true`).
6. Depois do primeiro deploy, abra o painel e clique em **Atualizar agora** — isso popula a
   base (O.S. abertas + frota na hora, histórico em segundo plano).

## Estrutura

- `app.py` — rotas Flask (`/api/...`).
- `models.py` — modelos SQLAlchemy.
- `business.py` — motor de classificação (regras por família de equipamento), reincidência e
  retrabalho — porta do artefato original, fonte única de verdade (front consome via
  `/api/constants` e `/api/os` já processado).
- `mariadb_client.py` — cliente somente leitura do MySQL da empresa.
- `sync.py` — orquestra a sincronização (abertas/frota síncrono, histórico incremental em
  thread de background).
- `static/js/` — frontend (JS puro, sem build step): `core.js` (dashboard/ficha),
  `admin.js` (alocação/contatos/classificação), `cobranca.js`, `tv.js`.
