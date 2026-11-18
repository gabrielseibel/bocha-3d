# Arquitetura — Bocha 3D

Planejamento e estrutura dos componentes do simulador. O objetivo central é que o
**lançamento pelo alto** seja convincente, estratégico e determinístico: a física é
própria (não uma animação), roda igual no jogo, nos testes e na IA.

## Visão geral

```
                ┌──────────────┐   mira (x0, direção, altura, força)
   Entrada ───▶ │   Game       │ ─────────────────────────────┐
 (arraste,      │ orquestrador │                              ▼
  teclado,      └──────┬───────┘                      ┌──────────────┐
  HUD)                 │ regras / turnos              │ physics/     │
                       ▼                              │ World (480Hz)│
               ┌──────────────┐  settle()            └──────┬───────┘
               │ game/Match   │ ◀────────────────────────────┘ eventos
               │ game/rules   │   (quedas, choques, tabelas)
               └──────┬───────┘
      vez da CPU      │                     ┌──────────────────────┐
         ┌────────────┴──────────┐          │ render/ (Three.js)   │
         ▼                       │          │ cancha, bolas, povo, │
 ┌───────────────┐  plano        │          │ câmera, efeitos      │
 │ ai/ Web Worker│ ──────────────┘          └──────────────────────┘
 │ simula 100+   │                          ┌──────────────────────┐
 │ arremessos    │                          │ ui/ (DOM) + audio/   │
 └───────────────┘                          └──────────────────────┘
```

## Módulos

| Pasta | Responsabilidade |
|---|---|
| `src/config.ts` | Constantes físicas (bola 107 mm / 920 g, bolim 48 mm / 90 g, saibro, tabelas) e dimensões da cancha (ajustáveis). |
| `src/physics/world.ts` | Motor de física próprio, passo fixo de 1/480 s, determinístico. |
| `src/physics/shot.ts` | Parâmetros de mira → ponto de soltura e velocidade inicial; previsão do voo; limites (tabelas, telhado). |
| `src/game/rules.ts` | Regras puras: distância borda a borda, pontuação, quem joga a seguir. |
| `src/game/match.ts` | Estado da partida: rodadas, bolim válido/inválido, bolas anuladas, placar, treino. |
| `src/game/game.ts` | Orquestra física, câmera, IA, efeitos, som e interface; laço principal. |
| `src/ai/` | Planejador da IA (`planner.ts`), Web Worker e cliente com fallback. |
| `src/render/` | Cena Three.js: cancha, ambiente, torcida e jogador, bolas, efeitos, guia de mira, câmera. |
| `src/ui/` | HUD, telas (menu, configurações, ajuda, pausa, fim de rodada, vitória), entrada e rótulos de distância. |
| `src/audio/sfx.ts` | Sons sintetizados com Web Audio (sem arquivos). |
| `tests/` | Vitest: física, regras, IA e partida. |

## Física (o coração do simulador)

Coordenadas: `x` lateral, `y` para cima, a cancha se estende de `z = 0` (cabeceira de
arremesso) até `z = -comprimento` (fundo).

1. **Lançamento** — a força é mapeada em velocidade por `v² = v_min² + (v_max² − v_min²)·força`,
   então a distância cresce de forma quase linear com a força. A altura é o ângulo de saída
   (8° a 62°). A bola sai do ponto da mão do jogador (0,42 a 0,72 m de altura).
2. **Voo** — gravidade + arrasto do ar (quadrático). Parábola real; a sombra fica logo abaixo
   da bola (luz quase vertical), o que dá a leitura de altura.
3. **Impacto no saibro** — restituição baixa que cai com a velocidade (o barro absorve),
   a bola **afunda** (perde velocidade tangencial proporcional à velocidade vertical do
   impacto) e o atrito de Coulomb, limitado a μ·impulso normal, leva ao rolamento. Por isso
   **bola alta cai e para perto** (ponto) e **bola baixa rola muito**.
4. **Rolamento** — deslizamento → rolamento puro (bola maciça, I = 2/5·m·r²), resistência ao
   rolamento + arrasto do saibro, até parar e "dormir".
5. **Colisões** — esfera-esfera em 3D com impulso (resina: restituição 0,84). Funciona no ar
   (tiro de ar) e no chão; o bolim leve dispara longe quando acertado. Bola empurrada contra o
   chão por um tiro também perde energia no saibro.
6. **Tabelas** — planos rígidos nas laterais e no fundo (nada atravessa). A mira é limitada
   para o voo não passar por cima da mureta, e a força é limitada pelo telhado conforme a
   altura escolhida.

## Regras implementadas

- 4 bolas por equipe, bolim lançado pela equipe que começa (configurável: automático).
- Bolim precisa parar entre as linhas tracejadas; se falhar, a outra equipe tenta e depois o
  "árbitro" posiciona. Quem tinha o direito joga a primeira bola.
- Joga a equipe que **não** tem a bola mais próxima; quem acabou as bolas passa a vez.
- Pontuação: 1 ponto por bola mais próxima que a melhor adversária; empate não pontua.
- Bola que bate no fundo sem tocar outra é anulada (opcional); bola que não passa da linha
  de arremesso é anulada.
- Quem vence a rodada lança o próximo bolim. Partida até 12 pontos (6 a 21).

## IA

Para cada jogada candidata — **ponto** (3 alturas × 3 posições), **tiro** (arcos baixos
direto na bola adversária que está ganhando), **empurrar** e **bater no bolim** — a IA simula o
arremesso completo no mesmo motor físico, avalia a posição (pontos garantidos, margem,
proximidade) e escolhe a melhor. A avaliação "robusta" repete os melhores candidatos com o
erro de mão da dificuldade, o que faz a IA preferir jogadas seguras quando é imprecisa.
Precisão medida (média até o bolim): fácil ~70 cm, médio ~25 cm, difícil ~8 cm.

## Câmera

- **Arremesso**: atrás e acima do jogador (sobre o ombro), enquadrando até o bolim.
- **Acompanhamento**: segue a bola em voo com antecipação pela velocidade.
- **Assentamento**: enquadra o bolim e tudo que ainda se move; volta sozinha para a mira.
- **Bolim** e **visão geral**: órbita livre (arrastar/pinça/roda).
- **Janela do bolim** (picture-in-picture) durante a mira, com zoom automático nas bolas
  próximas — essencial no celular.

## Desempenho

- Física com corpos "dormindo" (só pares com algo em movimento são testados).
- Qualidade automática (resolução, sombras, árvores, torcida) e redução se o FPS cair.
- Texturas e sons procedurais: nenhum asset para baixar além do JS e das fontes.

## Testes

- `tests/physics.test.ts`: determinismo, força × distância, altura × parábola, rolagem após
  a queda, parada natural, 200 arremessos aleatórios sem atravessar tabelas, tiro, bolim
  deslocado, regra do fundo.
- `tests/rules.test.ts`: o exemplo do enunciado (azul 12/18 cm × vermelho 25/32 cm = 2 pontos),
  empate, ordem de lançamento.
- `tests/ai.test.ts`: precisão por dificuldade, IA difícil tira bola colada no bolim, bolim válido.
- `tests/match.test.ts`: rodada completa, fim de partida, bolim inválido duas vezes, treino.
- `npm run calibrate`: tabela de calibração (queda, parada, rolagem, ápice por altura/força).
