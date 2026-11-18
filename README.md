# Bocha 3D — Simulador de cancha

Simulador de **bocha em 3D para o navegador**, no computador, tablet ou celular, sem
instalar nada e sem cadastro.

**▶ Jogar:** https://gabrielseibel.github.io/bocha-3d/

Cancha de saibro coberta, tabelas, torcida apoiada na mureta, bolas azuis e vermelhas e o
bolim branco. Os lançamentos são **pelo alto, em parábola**, com física de verdade: a bola
voa, cai no saibro, quica pouco, rola e para pelo atrito, bate em outras bolas e pode
deslocar o bolim.

## Recursos

- **Física própria e determinística** (480 Hz): parábola com arrasto do ar, impacto no
  saibro, deslizamento → rolamento, colisões entre bolas em 3D (inclusive **tiro de ar**),
  tabelas laterais e de fundo.
- **Altura, força e direção importam**: bola alta cai e para perto; bola baixa rola muito;
  tiro rasante e forte tira a bola adversária do lugar.
- **Modos**: contra o computador (fácil, médio, difícil), dois jogadores no mesmo aparelho e
  treinamento livre (bolas ilimitadas, distância de cada bola, bola adversária para treinar
  o tiro, bolim aleatório ou lançado).
- **Pontuação automática** com distância de cada bola até o bolim, destaque da bola vencedora
  e placar até 12 pontos (6 a 21, configurável).
- **Câmeras**: atrás do jogador, seguindo a bola em voo, enquadrando o bolim, visão geral, e
  uma janela com a câmera do bolim durante a mira.
- **Efeitos**: sombra dinâmica no voo, poeira e marcas no saibro, rastro da bola, câmera lenta
  nos tiros, torcida que comemora, sons sintetizados (queda, choque, tabela, rolamento,
  aplausos, fanfarra).
- **Responsivo**: controles por mouse, teclado e toque; layout para celular na horizontal e
  na vertical; qualidade gráfica automática.

## Como jogar

| | Mouse / toque | Teclado |
|---|---|---|
| Força | arrastar para **baixo** (ou barra **Força**) | `W` / `S` |
| Direção | arrastar para os **lados** (ou ◀ ▶) | `←` / `→` |
| Altura | barra **Altura** (ou roda do mouse) | `↑` / `↓` |
| Posição na cabeceira | ◀ ▶ em **Posição** | `A` / `D` |
| Lançar | soltar o arraste ou **LANÇAR** | `Espaço` / `Enter` |
| Câmera / distâncias / menu | botões no canto | `C` / `V` / `Esc` |

`Shift` faz ajuste fino. Na câmera do bolim e na visão geral, arrastar gira a câmera e a
roda/pinça aproxima.

## Regras

Cada equipe tem 4 bolas. A equipe que começa lança o bolim (precisa parar entre as linhas
tracejadas) e a primeira bola. Depois joga sempre a equipe que **não** tem a bola mais
próxima. No fim da rodada, quem tem a bola mais próxima marca 1 ponto por bola mais perto
que a melhor adversária. Bola que bate no fundo sem tocar outra é anulada (opcional).

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:5191
npm test           # física, regras, IA e partida (Vitest)
npm run build      # build estático em dist/
npm run calibrate  # tabela de calibração da física (tools/out/)
```

Tecnologias: TypeScript, Three.js, Vite, Web Worker (IA), Web Audio. Sem servidor nem banco
de dados: tudo roda no navegador. O deploy para o GitHub Pages é automático a cada push na
`main` (`.github/workflows/deploy.yml`).

Detalhes de arquitetura, modelo físico e IA em [ARCHITECTURE.md](ARCHITECTURE.md).
