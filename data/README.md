# Dossier de données

Rempli par « Télécharger les données » (ou `npm run fetch-data`) :

    maps.json
    maps/<carte>/catalog.json, structures.bin, forbidden.bin, rss.bin, province.bin …
    sprites/*.png

## Vos images de carte

Déposez votre PNG dans `maps/<carte>/map.png` (ex. `maps/LostLand_Map_4_2_v2/map.png`).
Il est utilisé à la place des images du site, à sa résolution native.

Si votre PNG ne couvre pas la même étendue que celle du catalogue, utilisez
« Calibrer l'image de fond » dans l'éditeur (ou créez `maps/<carte>/overrides.json` :
`{ "bounds": [ouest, sud, est, nord] }`, en unités de jeu).
La zone jouable est toujours [0, 0, taille native] : tout ce qui est en dehors est assombri et non constructible.
