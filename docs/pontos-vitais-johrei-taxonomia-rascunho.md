# Pontos Vitais do Johrei — Taxonomia (RASCUNHO p/ revisão do ministro)

> Fonte: `mioshiec2` (Vol. 2) — seções *O Método do Johrei*, *Princípio do Johrei*,
> *Processo de Purificação*, *Três Venenos* e *Análise Corporal da Doença*.
> Objetivo: organizar o acervo num **guia de consulta para ministrantes**, em três eixos
> (Região do corpo × Condição × Fundamento) + **Descobertas**, na interface de
> **exploração guiada** (nunca prescrição).
> Página (oculta): `pontos-vitais-johrei.html`. Gerador: `scripts/build_johrei_points.mjs`.
> Status: rascunho gerado dos títulos PT/JA do índice. **Revisar e corrigir os agrupamentos.**

---

## ⚠ PONTO QUE EXIGE REVISÃO MINISTERIAL: `JK3`–`JK26`

No índice, **`JK1` e `JK2`** são *"Pontos Vitais do Johrei (Teoria Geral / 総論)"* — seguros.
Mas **`JK3` a `JK26`** têm título genérico *"Pontos Vitais do Johrei N (Tópicos Específicos / 各論)"* —
**o título não diz de que doença ou região cada um trata.** O corpo desses artigos vive no
Supabase Storage (não em disco), então não foi possível classificá-los automaticamente.

**Decisão atual (conservadora):** todos os `JK1`–`JK26` + `JKzyunzyo` ficam juntos no grupo
**F3 "Os pontos vitais do Johrei (急所)"**, em ordem numérica, como lista de estudo completa —
**sem afirmar a doença/região de cada um**. Errar a região num guia ministerial é pior que omitir.

**Tarefa para o ministro:** ao ler `JK3`–`JK26`, anotar o tema real de cada um. Com isso, cada
`JK` pode ser promovido para o grupo de **região** e/ou **condição** correto (multi-eixo é
permitido) — basta editar o `MAP` em `scripts/build_johrei_points.mjs` e rodar de novo.

---

## EIXO — Por região do corpo (`regiao`)

Ancorado nos Ensinamentos sobre a *importância* de cada parte (急所) + a *Análise Corporal da
Doença* (`BB*`), que é organizada por região.

- **R1. Cabeça, cérebro e nuca** — `zunou` (Importância do Cérebro), `enzui` (Importância do Bulbo
  Raquidiano), `BB1` (Doenças do Cérebro)
- **R2. Olhos, ouvidos, nariz e face** — `BB2` (olhos/ouvidos/nariz/nevralgia facial), `BB3`
  (boca/face/epilepsia → também em *Mente*)
- **R3. Pescoço e ombros** — `kubi` (Importância do Pescoço), `kata1`·`kata2` (Importância dos Ombros)
- **R4. Tórax: coração e pulmões** — `sinzou` (Arte da Cura do Coração), `BB4` (TB/asma/pleurisia/
  pneumonia → também em *Tuberculose*), `BB5` (coração/estômago/… → também em *Abdômen*)
- **R5. Abdômen: estômago, fígado e intestinos** — `BB5`, `BB6` (rins/diabetes/intestino → também em *Rins*)
- **R6. Rins e lombar** — `zinzou` (Arte da Cura dos Rins), `kosi` (Importância da Lombar), `BB6`
- **R7. Baixo-ventre: bexiga, genitais e ânus** — `BB7` (bexiga/genitais/ânus), `BB9` (doenças femininas)
- **R8. Nervos, articulações e membros** — `BB8` (nevralgia/reumatismo/beribéri/micose)

> Fora por ora (a colocar após revisão): `BB10` (doenças infantis), `BB11` (outras), `BTB*`
> (Análise Corporal — Evangelho do Paraíso), e os `JK` específicos quando seus temas forem confirmados.

---

## EIXO — Por condição (`sintoma`)

- **S1. Tuberculose** — `kaze1K`·`kaze2K`·`kaze3K` (Resfriado e TB), `KB1`–`KB6` (Análise da TB),
  `Kseisin` (TB e Ação Espiritual), `BB4`
- **S2. Mente e nervos** — `SJ1`·`SJ2`·`SJ3` (Pontos Vitais do Johrei para a Doença Mental), `BB3`
- **S3. Resfriado, febre e purificação** — `kaze1`·`kaze2`, `binetu` (Febre Baixa), `heikin`
  (Purificação Equilibrada), `Bkansha` (Agradeça pela Doença) — todos também em *F5*
- **S4. Germes e contágio** — `baikin1`–`baikin4` (Germes), `JS6` (Encefalite/Sarampo) — também em *F5*

---

## EIXO — Fundamentos (`fundamento`)

- **F1. Por que o Johrei cura — o princípio** — `konpon1`·`konpon2`, `JG1`–`JG4`, `JKG1`–`JKG7`,
  `kannen1`·`kannen2` (o Johrei NÃO é terapia mental), `Jk` (Efeitos), `Jigi` (Significado)
- **F2. Como ministrar — método e atitude** — `JH1`–`JH7` (inclui `JH5`/`JH6`: uso concomitante de
  Johrei e medicina é proibido), `Jkawaru`, `Jkaisuu1`–`3` (frequência), `Jga`, `Jsounen`
  (pensamentos), `Jzyunzyo` (ordem), `Jnorito` (oração), `Jsongen` (dignidade), `Jziko` (auto-Johrei)
- **F3. Os pontos vitais do Johrei (急所)** — `JK1`–`JK26`, `JKzyunzyo` (ordem dos pontos vitais),
  `JdokusoIDOU` (movimentação das toxinas). **Ver o aviso ⚠ acima.**
- **F4. Os três venenos e as toxinas** — `3doku`, `nendoku1`–`3` (veneno natural), `yakudoku1`–`3`
  (toxina medicamentosa), `shoudoku1`–`3` (desinfetante), `kanpou1`–`3` (fitoterápico), `nyoudoku`
  (urêmica), `dokukai1`–`3` (homem-massa de toxinas), `kusuriGYAKU` (ação reversa dos remédios),
  `yakudokuTEISI` (toxinas que paralisam a purificação), `shutou1`–`3` (vacinação)
- **F5. O processo de purificação** — `JS1`–`JS6` (Processo de Purificação), + `kaze*`, `binetu`,
  `heikin`, `baikin*`, `Bkansha` (compartilhados com S3/S4)

> Fora por ora (a avaliar): `JG5`–`JG11` (A Era do Tratamento), `YJG1`–`5` (Noite→Dia),
> `KG1`–`3` (Limites da Ciência), `shutou4`–`9`, `shoudoku`/`kanpou` adicionais, `taiyou`, `ti`.

---

## Descobertas (eixo `perguntas`) — porta de entrada para os ministrantes

12 descobertas *iluminadas* — cada uma aponta para o Ensinamento que responde.
Os hashes de deep-link são estáveis: `#q-<id>`.

| id | Pergunta | Lições |
|----|----------|--------|
| `q-ordem` | Existe uma ordem certa para ministrar o Johrei? | `JKzyunzyo`, `Jzyunzyo` |
| `q-o-que-e-acupo` | O que é um 'ponto vital' do Johrei? | `JK1`, `JK2` |
| `q-pensamentos` | O que os pensamentos do ministrante têm a ver com o Johrei? | `Jsounen` |
| `q-bulbo` | Por que o bulbo raquidiano é tão importante? | `enzui` |
| `q-ombros` | Por que os ombros recebem tanta atenção? | `kata1`, `kata2` |
| `q-medicina` | Pode-se aplicar Johrei e tomar remédios ao mesmo tempo? | `JH5`, `JH6` |
| `q-resfriado` | O resfriado é um mal — ou uma limpeza a agradecer? | `kaze1`, `Bkansha` |
| `q-travar-purificacao` | Por que remédios travam a purificação? | `yakudokuTEISI`, `yakudoku1` |
| `q-cientifico` | O Johrei é compatível com a ciência? | `JG4`, `JKG1` |
| `q-mental` | O Johrei é sugestão ou terapia mental? | `kannen1`, `kannen2` |
| `q-febre` | Toda febre deve ser baixada? | `binetu`, `kaze2` |
| `q-mente-pontos` | Quais os pontos vitais para quem sofre da mente? | `SJ2`, `SJ3` |

> **Revisar as descobertas iluminadas contra o conteúdo real** das lições apontadas — algumas
> associações foram inferidas do título. Se uma lição não responder bem à pergunta, trocar a
> lição (editar `PERGUNTAS` no gerador).

---

## Disciplina editorial

O guia **indexa os Ensinamentos e aponta para eles; nunca prescreve procedimento**. Cada item leva
ao texto de Meishu-Sama (`reader.html?vol=mioshiec2&file=…`). Termos como "tuberculose" ou
"paralisia" são rótulos *do Ensinamento-fonte*, não diagnósticos do guia. Sem veredito, sem promessa
de cura.

## Como corrigir e republicar

1. Editar `GROUPS` / `MAP` / `PERGUNTAS` em `scripts/build_johrei_points.mjs`.
2. `node scripts/build_johrei_points.mjs` (zerar todos os avisos `⚠️`).
3. Se mudou dados ou render: `node scripts/bump-versions.mjs bump johrei_points.js johrei-points.js`.
