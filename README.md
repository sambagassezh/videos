# Vídeos Sambagasse

"Manda teu vídeo!" — site onde o público envia vídeos da roda direto do celular,
em qualidade original (sem compressão), em 5 idiomas (pt, en, de, fr, it).
Os vídeos caem numa pasta do Google Drive; quem mandou e a autorização ficam numa planilha.
Quem envia não precisa de conta Google.

```
Videos/
├── docs/                 # o site (é isso que o GitHub Pages publica)
│   ├── index.html        # ← colar a URL do App da Web em SCRIPT_URL
│   └── images/           # logo.png e roda.jpg (foto do topo)
└── apps_script/          # o "servidor": colar no Apps Script da planilha
    ├── Code.gs
    └── appsscript.json   # permissões mínimas (só arquivos que ele criou + a planilha)
```

## Configurar (uma vez, ~10 min)

1. **Conta:** de preferência uma conta Gmail só pra isso (ex. `sambagasse.videos@gmail.com`).
2. **Planilha:** no Google Drive dessa conta → *Novo → Planilhas Google* →
   nomeie `Sambagasse – Vídeos`.
3. **Script:** na planilha → *Extensões → Apps Script*.
   - ⚙️ *Configurações do projeto* → marque **"Mostrar arquivo de manifesto appsscript.json no editor"**.
   - Volte ao editor (`< >`): abra `appsscript.json`, apague tudo e cole o de `apps_script/appsscript.json`.
   - Abra `Código.gs`, apague tudo e cole o `apps_script/Code.gs`. 💾 Salvar.
   - Confira que em *Serviços* (barra da esquerda) aparece **Drive** (vem do appsscript.json).
     Se não aparecer: *Serviços* → **+** → *Drive API* → *Adicionar*. Sem isso o `setup` dá erro 403.
4. **Autorizar e preparar:** escolha a função `setup` no menu de cima → **▶ Executar** →
   *Revisar permissões* → escolha a conta → "O Google não verificou este app" →
   *Avançado* → *Acessar … (não seguro)* → *Permitir*.
   (É normal: o "app" é o seu próprio script.) No *Registro de execução* aparece
   o link da pasta.
5. **Publicar:** *Implantar → Nova implantação* → ⚙️ tipo **App da Web** →
   *Executar como:* **Eu** · *Quem pode acessar:* **Qualquer pessoa** → *Implantar*.
   Copie a **URL do App da Web** (termina em `/exec`). Abrindo ela no navegador deve
   aparecer `Sambagasse vídeos: ok`.
6. **Site:** cole essa URL em `SCRIPT_URL` no `docs/index.html` e publique no GitHub Pages
   (*Settings → Pages* → branch `main`, pasta `/docs`).
7. **Compartilhar:** no Drive, compartilhe a pasta `Sambagasse – Vídeos` (e a planilha)
   com as contas da banda.

## Cada festa

    https://sambagassezh.github.io/videos/?festa=outubro-2026

Faça o QR code com esse link. Cada festa vira uma subpasta no Drive
(sem `?festa=` vai pra `sem-festa`).

## Mudou o Code.gs?

*Implantar → Gerenciar implantações* → ✏️ → *Versão:* **Nova versão** → *Implantar*.
Assim a URL continua a mesma. (Uma "Nova implantação" cria URL nova.)

## Limites e aviso (em `Code.gs`)

- Aceita praticamente tudo: `MAX_MB = 50000` (50 GB) por vídeo, só pra barrar arquivo absurdo
  (mesmo valor em `docs/index.html`). `MAX_PER_DAY = 300` vídeos por dia.
- **Aviso por email:** se uma mesma visita ao site passar de `ALERT_GB = 5` GB no total, chega um
  email (uma vez) com festa, nome, quantidade e tamanho. O envio continua normalmente.
  O destinatário fica em ⚙️ *Configurações do projeto → Propriedades do script → `ALERT_EMAIL`*
  (o `setup` preenche com o email da conta; troque ali se quiser outro).
- Espaço: o da conta Google (15 GB grátis, dividido com o Gmail dela).

## Segurança

- Quem envia nunca recebe o login nem o token da conta: o site manda pedaços do vídeo
  pro script, e o script repassa pro Drive.
- O script só tem permissão pra mexer nos arquivos que **ele mesmo** criou e nesta planilha;
  não enxerga o resto do Drive nem o Gmail.
- Ninguém de fora consegue ver, listar nem apagar os vídeos.
