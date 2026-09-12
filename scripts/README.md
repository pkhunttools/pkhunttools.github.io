# Atualização offline da Wiki

O site publicado não faz pedidos à Wiki durante o uso. Para reconstruir os
datasets locais de movesets, TMs e Movedex a partir das 19 páginas oficiais:

```powershell
node outputs/pkhunt-tools/scripts/update-wiki-data.mjs
```

O gerador só substitui os arquivos após validar as 19 páginas, os movesets
casados e cada referência de TM. A execução grava `../data/learnsets-v6.19.1.js`,
`../data/tm-compatibility-v6.19.1.js`, `../data/moves-v6.19.1.js` e o relatório
`../data/wiki-update-report.json`.

Fonte e data de geração ficam no próprio relatório. Não é necessário executar
este script para abrir o site estático.
