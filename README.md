# Círculo

Registro de hábitos em três toques, pensado pra usar logo depois do hábito: escolhe o emoji, gira o anel, salva.

**App:** https://vinidotruan.github.io/circulo/

## Instalar no celular

- **iPhone (Safari):** abrir o link → botão Compartilhar → *Adicionar à Tela de Início*.
- **Android (Chrome):** abrir o link → menu ⋮ → *Instalar app*.

Os dados ficam só no aparelho (IndexedDB). O app funciona offline depois da primeira abertura.

## Como usar

- Deslize o círculo pra trocar de hábito. Toque no emoji do centro (ou em Registrar) pra marcar.
- Gire o anel: tempo vai de 0 a 120 min (de 5 em 5), repetições de 0 a 40. O anel abre no último valor registrado.
- Segure o emoji do centro pra editar ou apagar o hábito.
- Depois de salvar, dá pra desfazer pelo aviso.

## Estrutura

- `app/`: o app publicado (HTML, CSS e JS puros, sem build).
- `scripts/build_assets.py`: gera os ícones e baixa as fontes (`python3 scripts/build_assets.py`).
- `scripts/e2e.mjs`: teste ponta a ponta no Chrome headless.

## Testar localmente

```sh
cd app && python3 -m http.server 8765
# em outro terminal
node scripts/e2e.mjs http://localhost:8765/ e2e-out
```

## Publicar

Todo push na `main` que mexe em `app/` publica no GitHub Pages pelo workflow `.github/workflows/pages.yml`.
Ao mudar arquivos do app, troque `VERSION` em `app/sw.js` pra os celulares baixarem a versão nova.
